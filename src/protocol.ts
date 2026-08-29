/**
 * RPC protocol client for the `omp --mode rpc-ui` stdio JSONL protocol.
 *
 * This mirrors the wire contract in `oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-types.ts`.
 * Command names are taken from that file — never invent RPC commands.
 */

/** Bound model entry from `get_available_models` (pi-catalog `Model`). */
export interface BoundModel {
  id: string;
  name: string;
  provider: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  /** Optional role labels if present on the wire (default/smol/slow/plan). */
  role?: string;
  roles?: string[];
  tags?: string[];
}

/** Command shapes (stdin). Mirror of rpc-types.ts `RpcCommand` (subset we use). */
export type RpcCommand =
  | { id?: string; type: "negotiate_protocol"; protocolVersion: number }
  | { id?: string; type: "prompt"; message: string; images?: ImageContent[] }
  | { id?: string; type: "steer"; message: string; images?: ImageContent[] }
  | { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
  | { id?: string; type: "abort" }
  | { id?: string; type: "abort_and_prompt"; message: string; images?: ImageContent[] }
  | { id?: string; type: "new_session"; parentSession?: string }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "get_available_commands" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "cycle_model" }
  | { id?: string; type: "get_available_models" }
  | { id?: string; type: "set_todos"; phases: TodoPhase[] }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "get_messages_page"; cursor?: string; limit?: number };

/** Source of a slash command from omp available-commands (rpc-types.ts). */
export type AvailableSlashCommandSource =
  | "builtin"
  | "skill"
  | "extension"
  | "custom"
  | "mcp_prompt"
  | "file"
  | string;

/** Slash command entry from `get_available_commands` / `available_commands_update`. */
export interface RpcAvailableSlashCommand {
  name: string;
  aliases?: string[];
  description?: string;
  input?: { hint?: string };
  subcommands?: Array<{ name: string; description?: string; usage?: string }>;
  source: AvailableSlashCommandSource;
}

/** Unsolicited stdout frame listing slash commands. */
export interface RpcAvailableCommandsUpdateFrame {
  type: "available_commands_update";
  commands: RpcAvailableSlashCommand[];
}

export interface TodoPhase {
  name?: string;
  todos?: Array<{ id?: string; content?: string; status?: string }>;
}

export interface ImageContent {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

/** Response shape (stdout). */
export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

/** Session state returned by `get_state`. */
export interface SessionState {
  model?: BoundModel;
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode: string;
  followUpMode: string;
  interruptMode: string;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  fastModeEnabled: boolean;
  tokensPerSecond: number | null;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases?: TodoPhase[];
}

/** Extension UI request emitted by the agent. */
export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "cancel"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text"
    | "open_url";
  title?: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options?: string[];
  optionDetails?: Array<{ description?: string }>;
  timeout?: number;
  url?: string;
  launchUrl?: string;
  targetId?: string;
}

/** A message surface (assistant/user) for the transcript. */
export interface AgentMessage {
  role: "user" | "assistant" | "toolResult";
  id?: string;
  content: Array<ContentBlock>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "toolResult"; toolCallId?: string; content?: unknown; isError?: boolean }
  | { type: "image"; image: ImageContent };

/** Assistant stream event (message_update.assistantMessageEvent). */
export interface AssistantMessageEvent {
  type:
    | "start"
    | "text_start"
    | "text_delta"
    | "text_end"
    | "thinking_start"
    | "thinking_delta"
    | "thinking_end"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | "done"
    | "error";
  contentIndex?: number;
  delta?: string;
  content?: string;
  partial?: AgentMessage;
  toolCall?: { id: string; name: string; arguments: unknown };
}

/** A generic stdout frame received by the UI. `kind` is resolved Rust-side. */
export interface RpcEventPayload {
  kind: string;
  frame?: unknown;
  text?: string;
  code?: number;
  message?: string;
}

/** Format a bound model as `provider/id` for display and `--model`. */
export function formatModelRef(m: Pick<BoundModel, "provider" | "id"> | null | undefined): string {
  if (!m?.provider || !m?.id) return "";
  return `${m.provider}/${m.id}`;
}
