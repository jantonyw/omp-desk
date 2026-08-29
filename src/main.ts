import {
  abort,
  appendUser,
  clearChangedFiles,
  clearPlanTasks,
  clearTranscript,
  EXECUTE_PREFIX,
  fetchAvailableCommands,
  fetchAvailableModels,
  fetchSessionState,
  formatModelRef,
  getAvailableCommandsCache,
  getAvailableModelsCache,
  getChangedFiles,
  getEntries,
  getLastAssistantText,
  getPlanTasks,
  getStatus,
  handleEvent,
  onChangesChange,
  onCommandsChange,
  onModelsChange,
  onPlanTasksChange,
  onTranscriptChange,
  parsePlanSteps,
  PLAN_PREFIX,
  promptOrAbortAndPrompt,
  sendPrompt,
  setModel,
  setPlanTasks,
  startSession,
  stopSession,
  stripMarkdownEmphasis,
  subscribeEvents,
  togglePlanTask,
  type BoundModel,
  type RpcAvailableSlashCommand,
  type Settings,
  type Status,
  type TranscriptHint,
} from "./client";
import { homeDir } from "@tauri-apps/api/path";
import type { RpcEventPayload } from "./protocol";
import { initIde } from "./ide";
import { marked } from "marked";
import DOMPurify from "dompurify";

// --- Markdown --------------------------------------------------------------

marked.setOptions({ gfm: true, breaks: true });

const MD_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "a",
  "strong",
  "em",
  "blockquote",
  "br",
  "hr",
];

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MD_TAGS,
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
  });
}

// --- DOM -------------------------------------------------------------------

const transcriptEl = document.getElementById("transcript")!;
const paneChatEl = document.getElementById("pane-chat")!;
const welcomeEl = document.getElementById("welcome")!;
const composerEl = document.getElementById("composer") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const abortBtn = document.getElementById("abort") as HTMLButtonElement;
const slashTriggerBtn = document.getElementById("slash-trigger") as HTMLButtonElement;
const runAbortBtn = document.getElementById("run-abort") as HTMLButtonElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;
const runNewSessionBtn = document.getElementById("run-new-session") as HTMLButtonElement;
const stopSessionBtn = document.getElementById("stop-session") as HTMLButtonElement;
const statusBarEl = document.getElementById("status-bar")!;
const modelSelectEl = document.getElementById("model-select") as HTMLSelectElement;
const modelTabsEl = document.getElementById("model-tabs")!;
const modePlanBtn = document.getElementById("mode-plan") as HTMLButtonElement;
const modeExecuteBtn = document.getElementById("mode-execute") as HTMLButtonElement;
const executePlanBtn = document.getElementById("execute-plan") as HTMLButtonElement;
const changesListEl = document.getElementById("changes-list")!;
const tasksListEl = document.getElementById("tasks-list")!;
const clearChangesBtn = document.getElementById("clear-changes") as HTMLButtonElement;
const sessionStateEl = document.getElementById("session-state")!;
const sessionCwdEl = document.getElementById("session-cwd")!;
const sessionMetaEl = document.getElementById("session-meta")!;
const slashPaletteEl = document.getElementById("slash-palette")!;

const ompPathEl = document.getElementById("omp-path") as HTMLInputElement;
const cwdEl = document.getElementById("cwd") as HTMLInputElement;
const modelEl = document.getElementById("model") as HTMLInputElement;
const noSessionEl = document.getElementById("no-session") as HTMLInputElement;
const noSkillsEl = document.getElementById("no-skills") as HTMLInputElement;
const noRulesEl = document.getElementById("no-rules") as HTMLInputElement;
const extraArgsEl = document.getElementById("extra-args") as HTMLInputElement;
const settingsPanel = document.getElementById("settings-panel")!;
const settingsToggle = document.getElementById("settings-toggle") as HTMLButtonElement;
const themeSelectEl = document.getElementById("theme-select") as HTMLSelectElement;

// --- State -----------------------------------------------------------------

let status: Status = {
  started: false,
  running: false,
  ready: false,
  protocol_version: 1,
  is_streaming: false,
  message_count: 0,
  exited: false,
};

/** UI mode: Plan asks omp to plan only; Execute implements after confirm. */
type WorkMode = "plan" | "execute";
let workMode: WorkMode = "plan";
let lastPlanText = "";
let selectingModel = false;
let activeModelRef = "";

/** Slash palette highlight index; -1 when closed. */
let slashIndex = -1;
let slashFiltered: RpcAvailableSlashCommand[] = [];

const SETTINGS_KEY = "omp-desk.settings";
const UI_KEY = "omp-desk.ui";
const THEME_KEY = "omp-desk.theme";

type ThemeId = "dark" | "midnight" | "light" | "system";
const THEMES: ThemeId[] = ["dark", "midnight", "light", "system"];

/**
 * Plan invocation notes (real omp surface — do not invent RPC names):
 * - CLI `--plan <model>` sets the planning model (string; also PI_PLAN_MODEL).
 * - CLI `--plan-yolo` forces read-only plan at start, auto-approves the first
 *   proposal, then implements (headless). Pass via Settings → extra args if needed.
 * - rpc-types.ts has no enter_plan_mode / approve_plan command. Interactive
 *   Plan/Execute in this shell therefore uses `prompt` / `abort_and_prompt`
 *   with explicit planning vs execution instructions, then user confirm.
 */

function isThemeId(v: string | null): v is ThemeId {
  return v !== null && (THEMES as string[]).includes(v);
}

function resolveColorScheme(theme: ThemeId): "dark" | "light" {
  if (theme === "light") return "light";
  if (theme === "dark" || theme === "midnight") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = resolveColorScheme(theme);
  if (themeSelectEl.value !== theme) themeSelectEl.value = theme;
}

function loadTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isThemeId(raw) ? raw : "dark";
  } catch {
    return "dark";
  }
}

function saveTheme(theme: ThemeId): void {
  localStorage.setItem(THEME_KEY, theme);
}

function setTheme(theme: ThemeId): void {
  saveTheme(theme);
  applyTheme(theme);
}

const homeCwdPromise: Promise<string> = homeDir().catch(() => "/workspace");
const LEGACY_DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
const ROLE_LABELS = new Set(["default", "smol", "slow", "plan"]);

function defaultSettings(): Settings {
  return {
    ompPath: "omp",
    cwd: "/workspace",
    model: "",
    noSession: false,
    noSkills: false,
    noRules: false,
    extraArgs: "",
  };
}

async function loadSettings(): Promise<Settings> {
  let s: Settings;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    s = raw ? { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) } : defaultSettings();
  } catch {
    s = defaultSettings();
  }
  if (s.cwd === "/workspace") {
    s.cwd = await homeCwdPromise;
  }
  if (s.model === LEGACY_DEFAULT_MODEL) {
    s.model = "";
  }
  return s;
}

function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadUiMode(): WorkMode {
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return "plan";
    const u = JSON.parse(raw) as { mode?: string };
    return u.mode === "execute" ? "execute" : "plan";
  } catch {
    return "plan";
  }
}

function saveUiMode(mode: WorkMode): void {
  localStorage.setItem(UI_KEY, JSON.stringify({ mode }));
}

async function readSettingsForm(): Promise<Settings> {
  const home = await homeCwdPromise;
  return {
    ompPath: ompPathEl.value.trim() || "omp",
    cwd: cwdEl.value.trim() || home,
    model: modelEl.value.trim(),
    noSession: noSessionEl.checked,
    noSkills: noSkillsEl.checked,
    noRules: noRulesEl.checked,
    extraArgs: extraArgsEl.value,
  };
}

function applySettingsToForm(s: Settings): void {
  ompPathEl.value = s.ompPath;
  cwdEl.value = s.cwd;
  modelEl.value = s.model;
  noSessionEl.checked = s.noSession;
  noSkillsEl.checked = s.noSkills;
  noRulesEl.checked = s.noRules;
  extraArgsEl.value = s.extraArgs;
}

let settings: Settings = defaultSettings();

// --- Rendering -------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasChatMessages(): boolean {
  return getEntries().some((e) => e.role === "user" || e.role === "assistant");
}

function updateEmptyChat(): void {
  const empty = !hasChatMessages();
  paneChatEl.classList.toggle("empty-chat", empty);
  welcomeEl.setAttribute("aria-hidden", empty ? "false" : "true");
}

/** Pending paint mode coalesced via rAF (many deltas → one paint per frame). */
let paintScheduled = false;
let paintMode: "stream" | "full" = "full";

function scheduleTranscriptPaint(hint: TranscriptHint): void {
  if (hint.mode === "full") paintMode = "full";
  else if (!paintScheduled) paintMode = "stream";
  // If a full is already pending, keep full.
  if (paintScheduled) return;
  paintScheduled = true;
  requestAnimationFrame(() => {
    paintScheduled = false;
    const mode = paintMode;
    paintMode = "full";
    if (mode === "stream") {
      paintLiveStream();
    } else {
      renderTranscriptFull();
    }
  });
}

/** Update only the live streaming assistant bubble — no marked/DOMPurify. */
function paintLiveStream(): void {
  const entries = getEntries();
  const live = [...entries].reverse().find((e) => e.role === "assistant" && e.streaming);
  if (!live) {
    renderTranscriptFull();
    return;
  }
  const node = transcriptEl.querySelector(`.msg.assistant[data-id="${CSS.escape(live.id)}"]`);
  if (!node) {
    // First paint of this bubble (or DOM was cleared) — structural insert via full render once.
    renderTranscriptFull();
    return;
  }
  const atBottom =
    transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 40;
  const body = node.querySelector(".body");
  if (body) {
    body.classList.remove("md");
    body.textContent = live.text || "";
  }
  let thinkingEl = node.querySelector(".thinking .body") as HTMLElement | null;
  if (live.thinking) {
    let wrap = node.querySelector(".thinking") as HTMLElement | null;
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "thinking";
      wrap.innerHTML = `<div class="role">Thinking</div><div class="body"></div>`;
      node.appendChild(wrap);
      thinkingEl = wrap.querySelector(".body");
    }
    if (thinkingEl) thinkingEl.textContent = live.thinking;
  }
  node.classList.add("streaming");
  updateEmptyChat();
  if (atBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function renderTranscriptFull(): void {
  const entries = getEntries();
  const atBottom =
    transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 40;

  let html = "";
  for (const e of entries) {
    if (e.role === "user") {
      html += `<div class="msg user"><div class="role">You</div><div class="body">${escapeHtml(e.text)}</div></div>`;
    } else if (e.role === "assistant") {
      const thinking = e.thinking
        ? `<div class="thinking"><div class="role">Thinking</div><div class="body">${escapeHtml(e.thinking)}</div></div>`
        : "";
      const tool = e.toolName
        ? `<div class="tooltag">${escapeHtml(e.toolName)}</div>`
        : "";
      const cls = e.streaming ? "msg assistant streaming" : "msg assistant";
      // While streaming: plain text only. Markdown+sanitize once the turn ends.
      const body = e.streaming
        ? escapeHtml(e.text || "")
        : e.text.trim()
          ? renderMarkdown(e.text)
          : "";
      const bodyClass = e.streaming ? "body" : "body md";
      html += `<div class="${cls}" data-id="${e.id}"><div class="role">Omp</div>${tool}<div class="${bodyClass}">${body}</div>${thinking}</div>`;
    } else if (e.role === "tool") {
      const cls = e.isError ? "msg tool error" : "msg tool";
      html += `<div class="${cls}"><div class="role">Tool</div><div class="body">${escapeHtml(e.text)}</div></div>`;
    } else {
      const cls = e.isError ? "msg system error" : "msg system";
      html += `<div class="${cls}"><div class="body">${escapeHtml(e.text)}</div></div>`;
    }
  }
  transcriptEl.innerHTML = html;
  updateEmptyChat();
  if (atBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function renderStatus(): void {
  const modelLabel = activeModelRef || status.model || "omp default";
  const visible: string[] = [];
  const fullTip: string[] = [];

  if (!status.started) {
    visible.push("not started");
    fullTip.push("not started");
  } else {
    const state = !status.running
      ? status.exited
        ? "exited"
        : "stopped"
      : status.is_streaming
        ? "streaming"
        : status.ready
          ? "ready"
          : "starting…";
    visible.push(state);
    fullTip.push(state);
    if (status.pid != null) fullTip.push(`pid ${status.pid}`);
    visible.push(modelLabel);
    fullTip.push(modelLabel);
    visible.push(`${status.message_count} msgs`);
    fullTip.push(`${status.message_count} msgs`);
    if (status.session_id) {
      const short = `#${status.session_id.slice(0, 8)}`;
      visible.push(short);
      fullTip.push(short);
    }
    visible.push(workMode === "plan" ? "Plan" : "Execute");
    fullTip.push(workMode === "plan" ? "mode:plan" : "mode:execute");
  }
  statusBarEl.textContent = visible.join(" · ");
  statusBarEl.title = fullTip.join(" · ");

  const canSend = status.ready;
  sendBtn.disabled = !canSend;
  const showAbort = status.running && status.is_streaming;
  abortBtn.disabled = !showAbort;
  abortBtn.hidden = !showAbort;
  runAbortBtn.disabled = !showAbort;
  modelSelectEl.disabled = !status.ready || selectingModel;
  setModelTabsDisabled(!status.ready || selectingModel);
  executePlanBtn.disabled = !status.ready || !lastPlanText.trim();

  // Left session pane — Boop row status pill (pid in tooltip only)
  let stateLabel = "starting…";
  if (!status.started) {
    stateLabel = "not started";
  } else if (!status.running) {
    stateLabel = status.exited ? "exited" : "stopped";
  } else if (status.is_streaming) {
    stateLabel = "streaming";
  } else if (status.ready) {
    stateLabel = "ready";
  }
  sessionStateEl.textContent = stateLabel;
  sessionStateEl.setAttribute("data-state", stateLabel);
  sessionCwdEl.textContent = settings.cwd || "—";
  sessionCwdEl.title = settings.cwd;
  const fullModel = activeModelRef || status.model || "omp default";
  sessionMetaEl.textContent = fullModel;
  const tipParts = [fullModel];
  if (status.pid != null) tipParts.push(`pid ${status.pid}`);
  sessionMetaEl.title = tipParts.join(" · ");
  const sessionCard = document.getElementById("session-card");
  if (sessionCard) {
    sessionCard.title = tipParts.join(" · ");
  }
}

/** Collect optional default/smol/slow/plan labels if present on the model object. */
function modelRoleAnnotation(m: BoundModel): string {
  const found: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const low = v.toLowerCase();
    if (ROLE_LABELS.has(low)) found.push(low);
  };
  push(m.role);
  for (const r of m.roles ?? []) push(r);
  for (const t of m.tags ?? []) push(t);
  const extra = m as BoundModel & Record<string, unknown>;
  for (const key of ROLE_LABELS) {
    if (extra[key] === true) found.push(key);
  }
  return [...new Set(found)].join(", ");
}

function chipLabel(m: BoundModel): string {
  const id = m.id;
  const provider = m.provider || "";
  // Prefer short id; prefix provider lightly when helpful.
  if (provider && !id.toLowerCase().startsWith(provider.toLowerCase())) {
    return `${provider} · ${id}`;
  }
  return id;
}

function setModelTabsDisabled(disabled: boolean): void {
  for (const btn of modelTabsEl.querySelectorAll<HTMLButtonElement>(".model-chip")) {
    btn.disabled = disabled;
  }
}

function syncModelChipsActive(selectedRef: string): void {
  for (const btn of modelTabsEl.querySelectorAll<HTMLButtonElement>(".model-chip")) {
    const ref = btn.dataset.ref ?? "";
    const on = ref === selectedRef;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function renderModelTabs(models: BoundModel[], selectedRef: string): void {
  const prefer = selectedRef || "";
  const byProvider = new Map<string, BoundModel[]>();
  for (const m of models) {
    const p = m.provider || "unknown";
    const list = byProvider.get(p);
    if (list) list.push(m);
    else byProvider.set(p, [m]);
  }

  const parts: string[] = [];
  const defaultActive = !prefer;
  parts.push(
    `<button type="button" class="model-chip${defaultActive ? " active" : ""}" role="tab" aria-selected="${
      defaultActive ? "true" : "false"
    }" data-ref="" title="omp default">omp default</button>`,
  );

  const providers = [...byProvider.keys()].sort((a, b) => a.localeCompare(b));
  for (const provider of providers) {
    parts.push(
      `<span class="model-provider-label" aria-hidden="true">${escapeHtml(provider)}</span>`,
    );
    const group = byProvider.get(provider)!;
    group.sort((a, b) => a.id.localeCompare(b.id));
    for (const m of group) {
      const ref = formatModelRef(m);
      const role = modelRoleAnnotation(m);
      const label = chipLabel(m);
      const title = role ? `${ref} (${role})` : ref;
      const active = prefer === ref;
      parts.push(
        `<button type="button" class="model-chip${active ? " active" : ""}" role="tab" aria-selected="${
          active ? "true" : "false"
        }" data-ref="${escapeHtml(ref)}" data-provider="${escapeHtml(m.provider)}" data-id="${escapeHtml(
          m.id,
        )}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`,
      );
    }
  }

  modelTabsEl.innerHTML = parts.join("");
  setModelTabsDisabled(!status.ready || selectingModel);
}

function renderModelSelect(models: BoundModel[], selectedRef: string): void {
  const current = modelSelectEl.value;
  const prefer = selectedRef || current || settings.model || "";

  const byProvider = new Map<string, BoundModel[]>();
  for (const m of models) {
    const p = m.provider || "unknown";
    const list = byProvider.get(p);
    if (list) list.push(m);
    else byProvider.set(p, [m]);
  }

  let html = `<option value="">omp default</option>`;
  const providers = [...byProvider.keys()].sort((a, b) => a.localeCompare(b));
  for (const provider of providers) {
    html += `<optgroup label="${escapeHtml(provider)}">`;
    const group = byProvider.get(provider)!;
    group.sort((a, b) => a.id.localeCompare(b.id));
    for (const m of group) {
      const ref = formatModelRef(m);
      const role = modelRoleAnnotation(m);
      // Always show full provider/id — never a truncated display name.
      const label = role ? `${ref} (${role})` : ref;
      html += `<option value="${escapeHtml(ref)}" data-provider="${escapeHtml(m.provider)}" data-id="${escapeHtml(m.id)}">${escapeHtml(label)}</option>`;
    }
    html += `</optgroup>`;
  }
  modelSelectEl.innerHTML = html;
  if (prefer && [...modelSelectEl.options].some((o) => o.value === prefer)) {
    modelSelectEl.value = prefer;
  } else {
    modelSelectEl.value = "";
  }
  modelSelectEl.title = modelSelectEl.value || "omp default";
  renderModelTabs(models, modelSelectEl.value);
}

function renderChanges(): void {
  const files = getChangedFiles();
  if (files.length === 0) {
    changesListEl.innerHTML = `<li class="empty-hint">No changes yet</li>`;
    return;
  }
  changesListEl.innerHTML = files
    .map((f) => {
      const kind = f.kind || "edit";
      const base = f.path.split(/[/\\]/).pop() || f.path;
      return (
        `<li class="boop-row">` +
        `<span class="boop-source ${escapeHtml(kind)}" aria-hidden="true"></span>` +
        `<div class="boop-main">` +
        `<div class="boop-title-row">` +
        `<span class="boop-title" title="${escapeHtml(f.path)}">${escapeHtml(base)}</span>` +
        `<span class="status-pill" data-kind="${escapeHtml(kind)}">${escapeHtml(kind)}</span>` +
        `</div>` +
        `<div class="boop-desc" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</div>` +
        `</div></li>`
      );
    })
    .join("");
}

function renderTasks(): void {
  const tasks = getPlanTasks();
  if (tasks.length === 0) {
    tasksListEl.innerHTML = `<li class="empty-hint">${
      lastPlanText ? "No parseable steps — plan is in chat" : "No tasks yet"
    }</li>`;
    return;
  }
  tasksListEl.innerHTML = tasks
    .map((t) => {
      const label = stripMarkdownEmphasis(t.text);
      const kind = t.done ? "done" : "todo";
      return (
        `<li class="boop-row ${t.done ? "done" : ""}" data-id="${escapeHtml(t.id)}">` +
        `<input type="checkbox" class="task-check" ${t.done ? "checked" : ""} aria-label="toggle step" />` +
        `<span class="boop-source ${kind}" aria-hidden="true"></span>` +
        `<div class="boop-main">` +
        `<div class="boop-title-row">` +
        `<span class="boop-title">${escapeHtml(label)}</span>` +
        `<span class="status-pill" data-kind="${kind}">${kind === "done" ? "Done" : "Todo"}</span>` +
        `</div></div></li>`
      );
    })
    .join("");
}

function setWorkMode(mode: WorkMode): void {
  workMode = mode;
  saveUiMode(mode);
  modePlanBtn.classList.toggle("active", mode === "plan");
  modeExecuteBtn.classList.toggle("active", mode === "execute");
  modePlanBtn.setAttribute("aria-pressed", mode === "plan" ? "true" : "false");
  modeExecuteBtn.setAttribute("aria-pressed", mode === "execute" ? "true" : "false");
  renderStatus();
}

// --- Slash palette ---------------------------------------------------------

function isSlashMode(text: string): boolean {
  return text.startsWith("/");
}

function filterCommands(query: string): RpcAvailableSlashCommand[] {
  const q = query.replace(/^\//, "").toLowerCase();
  const all = getAvailableCommandsCache();
  if (!q) return all.slice(0, 40);
  return all
    .filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if ((c.aliases ?? []).some((a) => a.toLowerCase().includes(q))) return true;
      if ((c.description ?? "").toLowerCase().includes(q)) return true;
      return false;
    })
    .slice(0, 40);
}

function hideSlashPalette(): void {
  slashIndex = -1;
  slashFiltered = [];
  slashPaletteEl.classList.add("hidden");
  slashPaletteEl.innerHTML = "";
  slashPaletteEl.setAttribute("aria-hidden", "true");
}

function renderSlashPalette(): void {
  const text = composerEl.value;
  if (!isSlashMode(text) || text.includes("\n")) {
    hideSlashPalette();
    return;
  }
  // Only suggest while the first token is being typed (before args settle oddly).
  const firstSpace = text.indexOf(" ");
  const query = firstSpace === -1 ? text : text.slice(0, firstSpace);
  // If user already typed args after a known full command name, hide.
  if (firstSpace !== -1) {
    hideSlashPalette();
    return;
  }

  slashFiltered = filterCommands(query);
  if (slashFiltered.length === 0) {
    hideSlashPalette();
    return;
  }
  if (slashIndex < 0 || slashIndex >= slashFiltered.length) slashIndex = 0;

  slashPaletteEl.innerHTML = slashFiltered
    .map((c, i) => {
      const aliases = (c.aliases ?? []).length
        ? `<span class="slash-alias">${escapeHtml((c.aliases ?? []).map((a) => `/${a}`).join(" "))}</span>`
        : "";
      const desc = c.description
        ? `<span class="slash-desc">${escapeHtml(c.description)}</span>`
        : "";
      const hint = c.input?.hint
        ? `<span class="slash-hint">${escapeHtml(c.input.hint)}</span>`
        : "";
      const active = i === slashIndex ? " active" : "";
      return (
        `<button type="button" class="slash-item${active}" data-index="${i}" role="option" aria-selected="${
          i === slashIndex ? "true" : "false"
        }">` +
        `<span class="slash-name">/${escapeHtml(c.name)}</span>${aliases}${desc}${hint}` +
        `</button>`
      );
    })
    .join("");
  slashPaletteEl.classList.remove("hidden");
  slashPaletteEl.setAttribute("aria-hidden", "false");
}

function insertSlashCommand(cmd: RpcAvailableSlashCommand): void {
  const hint = cmd.input?.hint ? " " : "";
  composerEl.value = `/${cmd.name}${hint}`;
  hideSlashPalette();
  composerEl.focus();
  const len = composerEl.value.length;
  composerEl.setSelectionRange(len, len);
}

function slashPaletteOpen(): boolean {
  return !slashPaletteEl.classList.contains("hidden") && slashFiltered.length > 0;
}

// --- Actions ---------------------------------------------------------------

async function refreshMessageCount(): Promise<void> {
  try {
    await fetchSessionState();
    const st = await getStatus();
    // Prefer the higher of local optimistic count vs omp get_state so a race
    // right after send does not flash back to 0.
    status = {
      ...st,
      message_count: Math.max(st.message_count || 0, status.message_count || 0),
    };
    if (st.model) {
      activeModelRef = st.model.includes("/") ? st.model : activeModelRef || st.model;
    }
    renderStatus();
  } catch {
    // get_state may fail mid-exit; keep last known count.
  }
}

async function doStart(forceModel?: string): Promise<void> {
  const s = await readSettingsForm();
  if (forceModel !== undefined) s.model = forceModel;
  saveSettings(s);
  settings = s;
  clearTranscript();
  clearChangedFiles();
  clearPlanTasks();
  lastPlanText = "";
  activeModelRef = s.model;
  availableModelsReset();
  hideSlashPalette();
  try {
    status = await startSession(s);
  } catch (err) {
    appendSystem(`[start failed] ${String(err)}`);
    status = await getStatus().catch(() => status);
    status = { ...status, started: false };
  }
  renderStatus();
  renderChanges();
  renderTasks();
}

function availableModelsReset(): void {
  renderModelSelect([], activeModelRef);
  modelSelectEl.disabled = true;
}

function appendSystem(text: string): void {
  handleEvent({ kind: "stderr", text });
}

async function onReadyLoadModels(): Promise<void> {
  try {
    const models = await fetchAvailableModels();
    const st = await getStatus();
    status = st;
    if (st.model) activeModelRef = st.model;
    renderModelSelect(models, activeModelRef);
    if (settings.model) {
      const match = models.find((m) => formatModelRef(m) === settings.model);
      if (match && activeModelRef !== settings.model) {
        try {
          const updated = await setModel(match.provider, match.id);
          activeModelRef = formatModelRef(updated) || settings.model;
          renderModelSelect(models, activeModelRef);
        } catch {
          // Keep listing; spawn --model may already have applied it.
        }
      }
    }
  } catch (err) {
    appendSystem(`[models] ${String(err)}`);
  }
  try {
    await fetchAvailableCommands();
  } catch (err) {
    appendSystem(`[commands] ${String(err)}`);
  }
  await refreshMessageCount();
  renderStatus();
}

async function onModelPick(): Promise<void> {
  if (!status.ready || selectingModel) return;
  const opt = modelSelectEl.selectedOptions[0];
  const ref = modelSelectEl.value;
  modelSelectEl.title = ref || "omp default";
  syncModelChipsActive(ref);
  if (!ref) {
    // Empty = follow omp default for *next* spawn; do not invent a clear_model RPC.
    settings.model = "";
    modelEl.value = "";
    saveSettings(settings);
    activeModelRef = status.model || "";
    renderStatus();
    appendSystem("[models] omp default selected for next spawn (omit --model). Active session model unchanged.");
    return;
  }
  const provider = opt?.dataset.provider;
  const modelId = opt?.dataset.id;
  if (!provider || !modelId) return;

  const previous = activeModelRef;
  selectingModel = true;
  renderStatus();
  try {
    const updated = await setModel(provider, modelId);
    activeModelRef = formatModelRef(updated) || ref;
    settings.model = activeModelRef;
    modelEl.value = activeModelRef;
    saveSettings(settings);
    status = await getStatus().catch(() => status);
    if (status.model) activeModelRef = status.model.includes("/") ? status.model : activeModelRef;
    syncModelChipsActive(activeModelRef);
  } catch (err) {
    renderModelSelect(getAvailableModelsCache(), previous);
    appendSystem(`[set_model failed] ${String(err)}`);
  } finally {
    selectingModel = false;
    renderStatus();
  }
}

async function onModelChipClick(btn: HTMLButtonElement): Promise<void> {
  if (!status.ready || selectingModel) return;
  const ref = btn.dataset.ref ?? "";
  const provider = btn.dataset.provider;
  const modelId = btn.dataset.id;

  // Keep hidden select in sync for a11y / fallback.
  if ([...modelSelectEl.options].some((o) => o.value === ref)) {
    modelSelectEl.value = ref;
  } else {
    modelSelectEl.value = "";
  }
  modelSelectEl.title = ref || "omp default";
  syncModelChipsActive(ref);

  if (!ref) {
    settings.model = "";
    modelEl.value = "";
    saveSettings(settings);
    activeModelRef = status.model || "";
    renderStatus();
    appendSystem("[models] omp default selected for next spawn (omit --model). Active session model unchanged.");
    return;
  }
  if (!provider || !modelId) {
    // Fall back to select-driven path if chip lacks datasets.
    await onModelPick();
    return;
  }

  const previous = activeModelRef;
  selectingModel = true;
  renderStatus();
  try {
    const updated = await setModel(provider, modelId);
    activeModelRef = formatModelRef(updated) || ref;
    settings.model = activeModelRef;
    modelEl.value = activeModelRef;
    saveSettings(settings);
    status = await getStatus().catch(() => status);
    if (status.model) activeModelRef = status.model.includes("/") ? status.model : activeModelRef;
    renderModelSelect(getAvailableModelsCache(), activeModelRef);
  } catch (err) {
    renderModelSelect(getAvailableModelsCache(), previous);
    appendSystem(`[set_model failed] ${String(err)}`);
  } finally {
    selectingModel = false;
    renderStatus();
  }
}

function capturePlanFromTranscript(): void {
  const text = getLastAssistantText();
  if (!text.trim()) return;
  lastPlanText = text;
  const steps = parsePlanSteps(text).map((t) => ({
    ...t,
    text: stripMarkdownEmphasis(t.text),
  }));
  if (steps.length > 0) setPlanTasks(steps);
  renderTasks();
  renderStatus();
}

function bumpMessageCount(): void {
  status = { ...status, message_count: (status.message_count || 0) + 1 };
  renderStatus();
}

function onSend(): void {
  const text = composerEl.value;
  if (!text.trim()) return;
  if (slashPaletteOpen()) {
    // Enter while palette open inserts; actual send is a second Enter.
    const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
    if (cmd) insertSlashCommand(cmd);
    return;
  }
  composerEl.value = "";
  hideSlashPalette();

  const isSlash = text.trimStart().startsWith("/");

  // Slash lines always go through existing prompt path with no Plan/Execute prefix.
  if (isSlash) {
    appendUser(text);
    bumpMessageCount();
    void promptOrAbortAndPrompt(text, status.is_streaming).catch((err) =>
      appendSystem(`[send failed] ${String(err)}`),
    );
    return;
  }

  if (workMode === "plan") {
    const payload = PLAN_PREFIX + text;
    appendUser(text);
    bumpMessageCount();
    void sendPrompt(payload).catch((err) => appendSystem(`[send failed] ${String(err)}`));
    return;
  }

  if (!lastPlanText.trim()) {
    appendUser(text);
    bumpMessageCount();
    void sendPrompt(text).catch((err) => appendSystem(`[send failed] ${String(err)}`));
    return;
  }
  const ok = window.confirm(
    "Execute mode: send this message to implement (omp will apply changes). Continue?",
  );
  if (!ok) {
    composerEl.value = text;
    return;
  }
  appendUser(text);
  bumpMessageCount();
  void promptOrAbortAndPrompt(
    EXECUTE_PREFIX + text + "\n\nApproved plan:\n" + lastPlanText,
    status.is_streaming,
  ).catch((err) => appendSystem(`[send failed] ${String(err)}`));
}

async function onConfirmExecute(): Promise<void> {
  if (!lastPlanText.trim()) {
    appendSystem("[execute] No plan captured yet. Run a Plan turn first.");
    return;
  }
  const ok = window.confirm(
    "Execute the captured plan? omp will apply file-changing tools.",
  );
  if (!ok) return;
  setWorkMode("execute");
  const message =
    EXECUTE_PREFIX +
    "Approved plan:\n" +
    lastPlanText +
    (getPlanTasks().length
      ? "\n\nSteps:\n" + getPlanTasks().map((t, i) => `${i + 1}. ${t.text}`).join("\n")
      : "");
  appendUser("Execute approved plan");
  bumpMessageCount();
  try {
    await promptOrAbortAndPrompt(message, status.is_streaming);
  } catch (err) {
    appendSystem(`[execute failed] ${String(err)}`);
  }
}

function onRpcEvent(ev: RpcEventPayload): void {
  handleEvent(ev);

  if (ev.kind === "ready") {
    void getStatus().then((s) => {
      status = s;
      if (s.model) activeModelRef = s.model;
      renderStatus();
    });
    void onReadyLoadModels();
  }

  if (ev.kind === "exited") {
    void getStatus().then((s) => {
      status = s;
      renderStatus();
    });
    modelSelectEl.disabled = true;
    hideSlashPalette();
  }

  if (ev.kind === "response") {
    const f = ev.frame as { command?: string; success?: boolean; data?: unknown } | undefined;
    if (
      f?.command === "get_state" ||
      f?.command === "set_model" ||
      f?.command === "cycle_model"
    ) {
      void getStatus().then((s) => {
        status = s;
        if (s.model) activeModelRef = s.model.includes("/") ? s.model : activeModelRef || s.model;
        if (f.command === "set_model" && f.success && f.data) {
          const m = f.data as BoundModel;
          const ref = formatModelRef(m);
          if (ref) {
            activeModelRef = ref;
            renderModelSelect(getAvailableModelsCache(), ref);
          }
        }
        renderStatus();
      });
    }
  }

  if (ev.kind === "event") {
    const f = ev.frame as { type?: string } | undefined;
    if (f?.type === "agent_end") {
      void refreshMessageCount();
      if (workMode === "plan") {
        queueMicrotask(() => capturePlanFromTranscript());
      }
    }
    if (f?.type === "agent_start" || f?.type === "tool_execution_start") {
      void getStatus().then((s) => {
        status = s;
        renderStatus();
      });
    }
    if (f?.type === "available_commands_update") {
      renderSlashPalette();
    }
    if (f?.type === "session_info_update" || f?.type === "config_update") {
      void refreshMessageCount();
    }
  }
}

// --- Wiring ----------------------------------------------------------------

sendBtn.addEventListener("click", onSend);
abortBtn.addEventListener("click", () => {
  void abort().catch((err) => appendSystem(`[abort failed] ${String(err)}`));
});
runAbortBtn.addEventListener("click", () => {
  void abort().catch((err) => appendSystem(`[abort failed] ${String(err)}`));
});
newSessionBtn.addEventListener("click", () => {
  void doStart();
});
runNewSessionBtn.addEventListener("click", () => {
  void doStart();
});
stopSessionBtn.addEventListener("click", () => {
  void stopSession()
    .then(async () => {
      status = await getStatus();
      renderStatus();
    })
    .catch((err) => appendSystem(`[stop failed] ${String(err)}`));
});
settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
  const isOpen = settingsPanel.classList.contains("open");
  settingsToggle.textContent = isOpen ? "Hide settings" : "Settings";
});
document.getElementById("apply-settings")!.addEventListener("click", () => {
  // cwd may have changed — reload the IDE side panel tree from the new root.
  void doStart().then(() => ide.refresh());
  settingsPanel.classList.remove("open");
  settingsToggle.textContent = "Settings";
});

themeSelectEl.addEventListener("change", () => {
  const v = themeSelectEl.value;
  setTheme(isThemeId(v) ? v : "dark");
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (loadTheme() === "system") applyTheme("system");
});

modePlanBtn.addEventListener("click", () => setWorkMode("plan"));
modeExecuteBtn.addEventListener("click", () => {
  if (!lastPlanText.trim()) {
    appendSystem("[mode] Switch to Plan and capture a plan before Execute, or use Confirm execute.");
  }
  setWorkMode("execute");
});
executePlanBtn.addEventListener("click", () => {
  void onConfirmExecute();
});
modelSelectEl.addEventListener("change", () => {
  void onModelPick();
});
modelTabsEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".model-chip") as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  void onModelChipClick(btn);
});
slashTriggerBtn.addEventListener("click", () => {
  if (!composerEl.value.startsWith("/")) {
    composerEl.value = `/${composerEl.value}`;
  }
  composerEl.focus();
  const len = composerEl.value.length;
  // Place caret after leading slash so palette filters from empty query.
  if (composerEl.value === "/") {
    composerEl.setSelectionRange(1, 1);
  } else {
    composerEl.setSelectionRange(len, len);
  }
  renderSlashPalette();
});
clearChangesBtn.addEventListener("click", () => {
  clearChangedFiles();
});
tasksListEl.addEventListener("change", (e) => {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.type === "checkbox") {
    const li = t.closest("li[data-id]");
    const id = li?.getAttribute("data-id");
    if (id) togglePlanTask(id);
  }
});

slashPaletteEl.addEventListener("mousedown", (e) => {
  // Prevent composer blur before click inserts.
  e.preventDefault();
});
slashPaletteEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".slash-item") as HTMLElement | null;
  if (!btn) return;
  const idx = Number(btn.dataset.index);
  const cmd = slashFiltered[idx];
  if (cmd) insertSlashCommand(cmd);
});

composerEl.addEventListener("input", () => {
  renderSlashPalette();
});

composerEl.addEventListener("keydown", (e: KeyboardEvent) => {
  if (slashPaletteOpen()) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashIndex = (slashIndex + 1) % slashFiltered.length;
      renderSlashPalette();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      slashIndex = (slashIndex - 1 + slashFiltered.length) % slashFiltered.length;
      renderSlashPalette();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideSlashPalette();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
      if (cmd) insertSlashCommand(cmd);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const cmd = slashFiltered[slashIndex] ?? slashFiltered[0];
      if (cmd) insertSlashCommand(cmd);
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

onTranscriptChange(scheduleTranscriptPaint);
onChangesChange(renderChanges);
onPlanTasksChange(renderTasks);
onModelsChange(() => {
  renderModelSelect(getAvailableModelsCache(), activeModelRef || modelSelectEl.value);
});
onCommandsChange(() => {
  if (isSlashMode(composerEl.value)) renderSlashPalette();
});

// IDE sidebar (activity bar + Explorer / Source Control / Browser).
const ide = initIde(() => settings.cwd);

// Boot
void (async () => {
  applyTheme(loadTheme());
  settings = await loadSettings();
  saveSettings(settings);
  applySettingsToForm(settings);
  activeModelRef = settings.model;
  setWorkMode(loadUiMode());
  // cwd is final now — reload the IDE tree under the real root.
  ide.refresh();
  await subscribeEvents(onRpcEvent);
  renderStatus();
  renderChanges();
  renderTasks();
  updateEmptyChat();
  await doStart();
})();
