/**
 * Transport client: wraps the Tauri command surface and the `rpc_event` stream.
 * Owns request-id correlation and the transcript state machine.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentMessage,
  AssistantMessageEvent,
  BoundModel,
  ContentBlock,
  ExtensionUiRequest,
  RpcEventPayload,
  RpcResponse,
} from "./protocol";
import { formatModelRef } from "./protocol";

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

export interface ChangedFile {
  path: string;
  tool: string;
  kind: "read" | "write" | "edit" | "other";
}

export interface PlanTask {
  id: string;
  text: string;
  done: boolean;
}

let entries: TranscriptEntry[] = [];
let listeners: Array<() => void> = [];
let seq = 0;
/** Text of the last user message already rendered, to dedupe omp's echo. */
let lastUserText: string | null = null;

let changedFiles: ChangedFile[] = [];
let changeListeners: Array<() => void> = [];

let planTasks: PlanTask[] = [];
let planListeners: Array<() => void> = [];

let availableModels: BoundModel[] = [];
let modelListeners: Array<() => void> = [];

type Pending = {
  resolve: (r: RpcResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, Pending>();
let reqSeq = 1;

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

export function getChangedFiles(): ChangedFile[] {
  return changedFiles;
}

export function clearChangedFiles(): void {
  changedFiles = [];
  for (const l of changeListeners) l();
}

export function onChangesChange(fn: () => void): () => void {
  changeListeners.push(fn);
  return () => {
    changeListeners = changeListeners.filter((l) => l !== fn);
  };
}

export function getPlanTasks(): PlanTask[] {
  return planTasks;
}

export function setPlanTasks(tasks: PlanTask[]): void {
  planTasks = tasks;
  for (const l of planListeners) l();
}

export function clearPlanTasks(): void {
  planTasks = [];
  for (const l of planListeners) l();
}

export function togglePlanTask(id: string): void {
  planTasks = planTasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  for (const l of planListeners) l();
}

export function onPlanTasksChange(fn: () => void): () => void {
  planListeners.push(fn);
  return () => {
    planListeners = planListeners.filter((l) => l !== fn);
  };
}

export function getAvailableModelsCache(): BoundModel[] {
  return availableModels;
}

export function onModelsChange(fn: () => void): () => void {
  modelListeners.push(fn);
  return () => {
    modelListeners = modelListeners.filter((l) => l !== fn);
  };
}

function emitModels(): void {
  for (const l of modelListeners) l();
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

function nextClientId(): string {
  return `desk-${Date.now()}-${reqSeq++}`;
}

/**
 * Send an RPC command and wait for the matching `response` frame by `id`.
 * Real command names only (see rpc-types.ts).
 */
export async function rpcRequest(
  command: Record<string, unknown>,
  timeoutMs = 45000,
): Promise<RpcResponse> {
  const id = typeof command.id === "string" ? command.id : nextClientId();
  const payload = { ...command, id };
  return new Promise<RpcResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout waiting for ${String(command.type)}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    void sendCommand(payload).catch((err) => {
      const p = pending.get(id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(id);
        p.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

/** After ready: list bound models via real RPC `get_available_models`. */
export async function fetchAvailableModels(): Promise<BoundModel[]> {
  const resp = await rpcRequest({ type: "get_available_models" });
  if (!resp.success) {
    throw new Error(resp.error ?? "get_available_models failed");
  }
  const data = resp.data as { models?: BoundModel[] } | undefined;
  availableModels = Array.isArray(data?.models) ? data!.models! : [];
  emitModels();
  return availableModels;
}

/** Switch active model via real RPC `set_model`. */
export async function setModel(provider: string, modelId: string): Promise<BoundModel> {
  const resp = await rpcRequest({ type: "set_model", provider, modelId });
  if (!resp.success) {
    throw new Error(resp.error ?? "set_model failed");
  }
  return resp.data as BoundModel;
}

/** Cycle model via real RPC `cycle_model`. */
export async function cycleModel(): Promise<BoundModel | null> {
  const resp = await rpcRequest({ type: "cycle_model" });
  if (!resp.success) {
    throw new Error(resp.error ?? "cycle_model failed");
  }
  const data = resp.data as { model?: BoundModel } | BoundModel | null;
  if (!data) return null;
  if ("model" in data && data.model) return data.model;
  if ("id" in data && "provider" in data) return data as BoundModel;
  return null;
}

/**
 * Prompt with optional abort-first when the agent is streaming.
 * Uses real commands `abort_and_prompt` or `prompt`.
 */
export async function promptOrAbortAndPrompt(
  message: string,
  isStreaming: boolean,
): Promise<void> {
  if (isStreaming) {
    await rpcRequest({ type: "abort_and_prompt", message });
  } else {
    await sendPrompt(message);
  }
}

// ---------------------------------------------------------------------------
// Plan text → task checklist (UI-side parse; omp has no plan-steps RPC)
// ---------------------------------------------------------------------------

/** Extract numbered / checklist steps from a plan markdown body. */
export function parsePlanSteps(text: string): PlanTask[] {
  const lines = text.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  const re =
    /^(?:#{1,6}\s+)?(?:[-*+]\s+\[[ xX]?\]\s+|[-*+]\s+|\d+[.)]\s+)(.+)$/;
  for (const line of lines) {
    const m = line.trim().match(re);
    if (!m) continue;
    const body = m[1].trim();
    if (body.length < 2) continue;
    // Skip pure section headers that slipped through.
    if (/^(plan|steps?|tasks?|overview|summary)\b/i.test(body) && body.length < 24) {
      continue;
    }
    tasks.push({ id: `pt${tasks.length + 1}`, text: body, done: false });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Event handling: reduce stdout frames into transcript entries.
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

function resolvePending(resp: RpcResponse): void {
  if (!resp.id) return;
  const p = pending.get(resp.id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(resp.id);
  p.resolve(resp);
}

function toolKind(name: string): ChangedFile["kind"] {
  const n = name.toLowerCase();
  if (n === "write" || n.includes("write")) return "write";
  if (n === "edit" || n.includes("edit")) return "edit";
  if (n === "read" || n.includes("read")) return "read";
  return "other";
}

function extractPathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const o = args as Record<string, unknown>;
  for (const key of ["path", "file", "filePath", "filepath", "filename", "target"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function recordChange(toolName: string, args: unknown): void {
  const path = extractPathFromArgs(args);
  if (!path) return;
  const kind = toolKind(toolName);
  if (kind === "other" && !["bash", "grep", "glob", "todo"].includes(toolName.toLowerCase())) {
    // Still record if we have a path.
  }
  const existing = changedFiles.findIndex((c) => c.path === path);
  const entry: ChangedFile = { path, tool: toolName, kind };
  if (existing >= 0) {
    // Prefer write/edit over read when upgrading.
    const prev = changedFiles[existing];
    if (prev.kind === "read" && (kind === "write" || kind === "edit")) {
      changedFiles[existing] = entry;
    } else if (kind === "write" || kind === "edit") {
      changedFiles[existing] = entry;
    }
  } else {
    changedFiles.push(entry);
  }
  for (const l of changeListeners) l();
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
        const args = f?.args;
        recordChange(toolName, args);
        entries.push({
          id: `t${seq++}`,
          role: "tool",
          text: `call ${toolName}`,
          toolName,
          toolArgs: args,
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
  resolvePending(resp);
  if (resp.success) {
    // Cache model list / keep display helpers up to date.
    if (resp.command === "get_available_models") {
      const data = resp.data as { models?: BoundModel[] } | undefined;
      if (Array.isArray(data?.models)) {
        availableModels = data!.models!;
        emitModels();
      }
    }
    return;
  }
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

/** Last completed assistant text in the transcript (for plan capture). */
export function getLastAssistantText(): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.role === "assistant" && e.text.trim() && !e.streaming) {
      return e.text;
    }
  }
  return "";
}

export { formatModelRef };

// Re-export the type for the UI.
export type { RpcResponse, AgentMessage, ContentBlock, ExtensionUiRequest, BoundModel };
