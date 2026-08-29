/**
 * Transport client: wraps the Tauri command surface and the `rpc_event` stream.
 * Owns request-id correlation and the transcript state machine.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentMessage,
  AssistantMessageEvent,
  ContentBlock,
  ExtensionUiRequest,
  RpcEventPayload,
  RpcResponse,
} from "./protocol";

export interface Settings {
  ompPath: string;
  cwd: string;
  model: string;
  noSession: boolean;
  noSkills: boolean;
  noRules: boolean;
  extraArgs: string;
}

export interface Status {
  started: boolean;
  omp_path?: string;
  pid?: number;
  running: boolean;
  ready: boolean;
  protocol_version: number;
  session_id?: string;
  session_file?: string;
  model?: string;
  is_streaming: boolean;
  message_count: number;
  exited: boolean;
}

/** A rendered transcript entry (an assistant turn, a tool call, a user msg). */
export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  thinking?: string;
  toolName?: string;
  toolArgs?: unknown;
  isError?: boolean;
  streaming?: boolean;
}

let entries: TranscriptEntry[] = [];
let listeners: Array<() => void> = [];
let seq = 0;
/** Text of the last user message already rendered, to dedupe omp's echo. */
let lastUserText: string | null = null;
export function getEntries(): TranscriptEntry[] {
  return entries;
}

export function clearTranscript(): void {
  entries = [];
  lastUserText = null;
  emit();
}

export function appendUser(text: string): void {
  entries.push({ id: `u${seq++}`, role: "user", text });
  lastUserText = text;
  emit();
}

/**
 * omp's rpc-ui protocol echoes a user message as *both* `message_start` and
 * `message_end`; together with the optimistic local append in `onSend` that
 * used to render three copies of one message. Render the echo only when it
 * differs from the last user message already shown.
 */
function echoUser(text: string): void {
  if (!text || text === lastUserText) return;
  appendUser(text);
}

function emit(): void {
  for (const l of listeners) l();
}

export function onTranscriptChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Subscribe to the Tauri `rpc_event` stream. Returns an unsubscribe fn. */
export async function subscribeEvents(
  onEvent: (ev: RpcEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<RpcEventPayload>("rpc_event", (e) => onEvent(e.payload));
}

// ---------------------------------------------------------------------------
// Command wrappers
// ---------------------------------------------------------------------------

export async function startSession(settings: Settings): Promise<Status> {
  return invoke<Status>("start_session", {
    settings: {
      omp_path: settings.ompPath,
      cwd: settings.cwd,
      model: settings.model || null,
      no_session: settings.noSession,
      no_skills: settings.noSkills,
      no_rules: settings.noRules,
      extra_args: parseExtraArgs(settings.extraArgs),
    },
  });
}

export async function sendCommand(command: Record<string, unknown>): Promise<void> {
  await invoke("send_command", { command });
}

export async function sendPrompt(message: string): Promise<void> {
  await invoke("send_prompt", { message });
}

export async function abort(): Promise<void> {
  await invoke("abort");
}

export async function getStatus(): Promise<Status> {
  return invoke<Status>("get_status");
}

export async function stopSession(): Promise<void> {
  await invoke("stop_session");
}

export async function respondExtensionUi(
  requestId: string,
  response: Record<string, unknown>,
): Promise<void> {
  await invoke("respond_extension_ui", { requestId, response });
}

export async function openUrl(url: string): Promise<void> {
  await invoke("open_url", { url });
}

function parseExtraArgs(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event handling: reduce stdout frames into transcript entries.
//
// The assistant streams via `message_update` frames whose
// `assistantMessageEvent` carries `text_delta` / `thinking_delta`. We coalesce
// deltas into a live entry and finalize on `message_end` / `agent_end`.
// ---------------------------------------------------------------------------

interface Live {
  id: string;
  role: "assistant";
  text: string;
  thinking: string;
  toolName?: string;
  toolArgs?: unknown;
  streaming?: boolean;
}

let live: Live | null = null;

function resetLive(): void {
  if (live) {
    live.streaming = false;
    live = null;
  }
}

/** Apply one stdout frame to the transcript. */
export function handleEvent(ev: RpcEventPayload): void {
  const f = ev.frame as Record<string, unknown> | undefined;
  const kind = ev.kind;
  const ty = f && typeof f.type === "string" ? f.type : "";

  switch (kind) {
    case "stderr": {
      if (ev.text) {
        entries.push({ id: `s${seq++}`, role: "system", text: ev.text, isError: true });
      }
      break;
    }
    case "protocol_error": {
      entries.push({
        id: `e${seq++}`,
        role: "system",
        text: `[protocol] ${ev.message ?? "error"}`,
        isError: true,
      });
      break;
    }
    case "exited": {
      resetLive();
      entries.push({
        id: `x${seq++}`,
        role: "system",
        text: `[omp exited${ev.code != null ? ` code ${ev.code}` : ""}]`,
      });
      break;
    }
    case "ready": {
      entries.push({ id: `r${seq++}`, role: "system", text: "[omp ready]" });
      break;
    }
    case "response": {
      handleResponse(f as unknown as RpcResponse);
      break;
    }
    case "extension_ui_request": {
      handleExtensionUi(f as unknown as ExtensionUiRequest);
      break;
    }
    case "event":
    default: {
      if (ty === "message_start") {
        const msg = f?.message as AgentMessage | undefined;
        if (msg?.role === "user") {
          echoUser(extractText(msg));
        }
      } else if (ty === "message_update") {
        handleMessageUpdate(f as Record<string, unknown>);
      } else if (ty === "message_end") {
        const msg = f?.message as AgentMessage | undefined;
        if (msg?.role === "assistant") {
          finalizeAssistant(msg);
        } else if (msg?.role === "user") {
          echoUser(extractText(msg));
        }
      } else if (ty === "tool_execution_start") {
        const toolName = String(f?.toolName ?? "tool");
        entries.push({
          id: `t${seq++}`,
          role: "tool",
          text: `call ${toolName}`,
          toolName,
          toolArgs: f?.args,
          streaming: true,
        });
      } else if (ty === "tool_execution_end") {
        const toolName = String(f?.toolName ?? "tool");
        const isError = Boolean(f?.isError);
        entries.push({
          id: `t${seq++}`,
          role: "tool",
          text: `done ${toolName}`,
          toolName,
          isError,
        });
      } else if (ty === "agent_start") {
        // A new turn begins; a fresh live assistant entry starts on first delta.
      } else if (ty === "agent_end") {
        resetLive();
      }
      break;
    }
  }

  emit();
}

function handleResponse(resp: RpcResponse): void {
  if (resp.success) return;
  // Surface non-success responses (parse failures, async scheduling errors).
  entries.push({
    id: `er${seq++}`,
    role: "system",
    text: `[${resp.command}] ${resp.error ?? "error"}`,
    isError: true,
  });
}

function handleExtensionUi(req: ExtensionUiRequest): void {
  // MVP policy: auto-deny interactive dialogs so the stream never hangs, but
  // surface passive notifications and open_url in the transcript.
  switch (req.method) {
    case "notify":
    case "setStatus":
    case "setWidget":
    case "setTitle":
    case "set_editor_text":
    case "cancel":
      return; // passive — no response needed.
    case "open_url": {
      const url = req.launchUrl ?? req.url;
      if (url) void openUrl(url);
      return;
    }
    case "confirm": {
      entries.push({
        id: `ui${seq++}`,
        role: "system",
        text: `[extension: ${req.title ?? "confirm"} → ${req.message ?? ""}] (auto-denied)`,
      });
      void respondExtensionUi(req.id, { confirmed: false });
      break;
    }
    case "select":
    case "input":
    case "editor": {
      entries.push({
        id: `ui${seq++}`,
        role: "system",
        text: `[extension: ${req.title ?? req.method}] (auto-cancelled)`,
      });
      void respondExtensionUi(req.id, { cancelled: true, timedOut: false });
      break;
    }
    default:
      return;
  }
}

function handleMessageUpdate(f: Record<string, unknown>): void {
  const evt = f.assistantMessageEvent as AssistantMessageEvent | undefined;
  if (!evt) return;

  if (evt.type === "start" || evt.type === "text_start" || evt.type === "thinking_start") {
    if (!live) {
      live = { id: `a${seq++}`, role: "assistant", text: "", thinking: "" };
      entries.push(live as TranscriptEntry);
    }
    return;
  }
  if (evt.type === "text_delta" && typeof evt.delta === "string") {
    ensureLive();
    live!.text += evt.delta;
    return;
  }
  if (evt.type === "thinking_delta" && typeof evt.delta === "string") {
    ensureLive();
    live!.thinking += evt.delta;
    return;
  }
  if (evt.type === "text_end" && typeof evt.content === "string") {
    ensureLive();
    live!.text = evt.content;
    return;
  }
  if (evt.type === "thinking_end" && typeof evt.content === "string") {
    ensureLive();
    live!.thinking = evt.content;
    return;
  }
  if (evt.type === "toolcall_end" && evt.toolCall) {
    ensureLive();
    live!.toolName = evt.toolCall.name;
    live!.toolArgs = evt.toolCall.arguments;
    return;
  }
  if (evt.type === "done" || evt.type === "error") {
    resetLive();
  }
}

function ensureLive(): void {
  if (!live) {
    live = { id: `a${seq++}`, role: "assistant", text: "", thinking: "" };
    entries.push(live as TranscriptEntry);
  }
}

function finalizeAssistant(msg: AgentMessage): void {
  // `message_end` carries the complete message; use it to settle the text.
  const text = extractText(msg);
  if (text) {
    if (!live) {
      live = { id: `a${seq++}`, role: "assistant", text: "", thinking: "" };
      entries.push(live as TranscriptEntry);
    }
    if (!live.text) live.text = text;
  }
  resetLive();
}

function extractText(msg: AgentMessage): string {
  let out = "";
  for (const block of msg.content ?? []) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

// Re-export the type for the UI.
export type { RpcResponse, AgentMessage, ContentBlock, ExtensionUiRequest };
