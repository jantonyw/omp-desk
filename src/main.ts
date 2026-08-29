import {
  abort,
  appendUser,
  clearChangedFiles,
  clearPlanTasks,
  clearTranscript,
  fetchAvailableModels,
  formatModelRef,
  getAvailableModelsCache,
  getChangedFiles,
  getEntries,
  getLastAssistantText,
  getPlanTasks,
  getStatus,
  handleEvent,
  onChangesChange,
  onModelsChange,
  onPlanTasksChange,
  onTranscriptChange,
  parsePlanSteps,
  promptOrAbortAndPrompt,
  sendPrompt,
  setModel,
  setPlanTasks,
  startSession,
  stopSession,
  subscribeEvents,
  togglePlanTask,
  type BoundModel,
  type Settings,
  type Status,
} from "./client";
import { homeDir } from "@tauri-apps/api/path";
import type { RpcEventPayload } from "./protocol";

// --- DOM -------------------------------------------------------------------

const transcriptEl = document.getElementById("transcript")!;
const composerEl = document.getElementById("composer") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const abortBtn = document.getElementById("abort") as HTMLButtonElement;
const runAbortBtn = document.getElementById("run-abort") as HTMLButtonElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;
const runNewSessionBtn = document.getElementById("run-new-session") as HTMLButtonElement;
const stopSessionBtn = document.getElementById("stop-session") as HTMLButtonElement;
const statusBarEl = document.getElementById("status-bar")!;
const modelSelectEl = document.getElementById("model-select") as HTMLSelectElement;
const modePlanBtn = document.getElementById("mode-plan") as HTMLButtonElement;
const modeExecuteBtn = document.getElementById("mode-execute") as HTMLButtonElement;
const executePlanBtn = document.getElementById("execute-plan") as HTMLButtonElement;
const changesListEl = document.getElementById("changes-list")!;
const tasksListEl = document.getElementById("tasks-list")!;
const clearChangesBtn = document.getElementById("clear-changes") as HTMLButtonElement;
const sessionStateEl = document.getElementById("session-state")!;
const sessionCwdEl = document.getElementById("session-cwd")!;
const sessionMetaEl = document.getElementById("session-meta")!;

const ompPathEl = document.getElementById("omp-path") as HTMLInputElement;
const cwdEl = document.getElementById("cwd") as HTMLInputElement;
const modelEl = document.getElementById("model") as HTMLInputElement;
const noSessionEl = document.getElementById("no-session") as HTMLInputElement;
const noSkillsEl = document.getElementById("no-skills") as HTMLInputElement;
const noRulesEl = document.getElementById("no-rules") as HTMLInputElement;
const extraArgsEl = document.getElementById("extra-args") as HTMLInputElement;
const settingsPanel = document.getElementById("settings-panel")!;
const settingsToggle = document.getElementById("settings-toggle") as HTMLButtonElement;

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

const SETTINGS_KEY = "omp-desk.settings";
const UI_KEY = "omp-desk.ui";

/**
 * Plan invocation notes (real omp surface — do not invent RPC names):
 * - CLI `--plan <model>` sets the planning model (string; also PI_PLAN_MODEL).
 * - CLI `--plan-yolo` forces read-only plan at start, auto-approves the first
 *   proposal, then implements (headless). Pass via Settings → extra args if needed.
 * - rpc-types.ts has no enter_plan_mode / approve_plan command. Interactive
 *   Plan/Execute in this shell therefore uses `prompt` / `abort_and_prompt`
 *   with explicit planning vs execution instructions, then user confirm.
 */
const PLAN_PREFIX =
  "[omp-desk Plan mode] Produce a concrete implementation plan only. " +
  "Do not edit, write, or delete files. Do not run mutating shell commands. " +
  "Respond with a short overview and a numbered list of steps.\n\n";

const EXECUTE_PREFIX =
  "[omp-desk Execute mode] Implement the approved plan below. " +
  "Apply the code changes and mark progress. Follow the steps in order.\n\n";

const homeCwdPromise: Promise<string> = homeDir().catch(() => "/workspace");
const LEGACY_DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

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

function renderTranscript(): void {
  const entries = getEntries();
  const atBottom =
    transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 40;

  let html = "";
  for (const e of entries) {
    if (e.role === "user") {
      html += `<div class="msg user"><div class="role">you</div><div class="body">${escapeHtml(e.text)}</div></div>`;
    } else if (e.role === "assistant") {
      const thinking = e.thinking
        ? `<div class="thinking"><div class="role">thinking</div><div class="body">${escapeHtml(e.thinking)}</div></div>`
        : "";
      const tool = e.toolName
        ? `<div class="tooltag">${escapeHtml(e.toolName)}</div>`
        : "";
      const cls = e.streaming ? "msg assistant streaming" : "msg assistant";
      html += `<div class="${cls}" data-id="${e.id}"><div class="role">omp</div>${tool}<div class="body">${escapeHtml(e.text)}</div>${thinking}</div>`;
    } else if (e.role === "tool") {
      const cls = e.isError ? "msg tool error" : "msg tool";
      html += `<div class="${cls}"><div class="role">tool</div><div class="body">${escapeHtml(e.text)}</div></div>`;
    } else {
      const cls = e.isError ? "msg system error" : "msg system";
      html += `<div class="${cls}"><div class="body">${escapeHtml(e.text)}</div></div>`;
    }
  }
  transcriptEl.innerHTML = html;
  if (atBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function renderStatus(): void {
  const parts: string[] = [];
  if (!status.started) {
    parts.push("not started");
  } else {
    parts.push(status.running ? "running" : "stopped");
    if (status.pid != null) parts.push(`pid ${status.pid}`);
    if (status.ready) parts.push("ready");
    if (status.is_streaming) parts.push("streaming");
    const modelLabel = activeModelRef || status.model || "omp default";
    parts.push(modelLabel);
    parts.push(`${status.message_count} msgs`);
    if (status.session_id) parts.push(`#${status.session_id.slice(0, 8)}`);
    parts.push(workMode === "plan" ? "mode:plan" : "mode:execute");
  }
  statusBarEl.textContent = parts.join(" · ");

  const canSend = status.ready;
  sendBtn.disabled = !canSend;
  abortBtn.disabled = !status.running || !status.is_streaming;
  runAbortBtn.disabled = abortBtn.disabled;
  modelSelectEl.disabled = !status.ready || selectingModel;
  executePlanBtn.disabled = !status.ready || !lastPlanText.trim();

  // Left session pane
  if (!status.started) {
    sessionStateEl.textContent = "not started";
  } else if (!status.running) {
    sessionStateEl.textContent = status.exited ? "exited" : "stopped";
  } else if (status.is_streaming) {
    sessionStateEl.textContent = "streaming";
  } else if (status.ready) {
    sessionStateEl.textContent = "ready";
  } else {
    sessionStateEl.textContent = "starting…";
  }
  sessionCwdEl.textContent = settings.cwd;
  sessionCwdEl.title = settings.cwd;
  const meta: string[] = [];
  if (status.pid != null) meta.push(`pid ${status.pid}`);
  if (activeModelRef || status.model) meta.push(activeModelRef || status.model || "");
  sessionMetaEl.textContent = meta.filter(Boolean).join(" · ");
}

function renderModelSelect(models: BoundModel[], selectedRef: string): void {
  const current = modelSelectEl.value;
  const prefer = selectedRef || current || settings.model || "";
  let html = `<option value="">omp default</option>`;
  for (const m of models) {
    const ref = formatModelRef(m);
    const label = m.name && m.name !== m.id ? `${ref} — ${m.name}` : ref;
    html += `<option value="${escapeHtml(ref)}" data-provider="${escapeHtml(m.provider)}" data-id="${escapeHtml(m.id)}">${escapeHtml(label)}</option>`;
  }
  modelSelectEl.innerHTML = html;
  if (prefer && [...modelSelectEl.options].some((o) => o.value === prefer)) {
    modelSelectEl.value = prefer;
  } else {
    modelSelectEl.value = "";
  }
}

function renderChanges(): void {
  const files = getChangedFiles();
  if (files.length === 0) {
    changesListEl.innerHTML = `<li class="empty-hint">No file changes yet</li>`;
    return;
  }
  changesListEl.innerHTML = files
    .map(
      (f) =>
        `<li><span class="kind ${escapeHtml(f.kind)}">${escapeHtml(f.kind)}</span>${escapeHtml(f.path)}</li>`,
    )
    .join("");
}

function renderTasks(): void {
  const tasks = getPlanTasks();
  if (tasks.length === 0) {
    tasksListEl.innerHTML = `<li class="empty-hint">${
      lastPlanText ? "No parseable steps — plan is in chat" : "Plan steps appear after a Plan turn"
    }</li>`;
    return;
  }
  tasksListEl.innerHTML = tasks
    .map(
      (t) =>
        `<li class="${t.done ? "done" : ""}" data-id="${escapeHtml(t.id)}">` +
        `<input type="checkbox" ${t.done ? "checked" : ""} aria-label="toggle step" />` +
        `<span>${escapeHtml(t.text)}</span></li>`,
    )
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

// --- Actions ---------------------------------------------------------------

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
    // Prefer live status.model / settings after ready.
    const st = await getStatus();
    status = st;
    if (st.model) activeModelRef = st.model;
    renderModelSelect(models, activeModelRef);
    // If settings.model is set and present, highlight it; set_model if mismatch.
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
  renderStatus();
}

async function onModelPick(): Promise<void> {
  if (!status.ready || selectingModel) return;
  const opt = modelSelectEl.selectedOptions[0];
  const ref = modelSelectEl.value;
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
  } catch (err) {
    // Keep previous selection on failure.
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
  const steps = parsePlanSteps(text);
  if (steps.length > 0) setPlanTasks(steps);
  renderTasks();
  renderStatus();
}

function onSend(): void {
  const text = composerEl.value;
  if (!text.trim()) return;
  composerEl.value = "";

  if (workMode === "plan") {
    const payload = PLAN_PREFIX + text;
    appendUser(text);
    void sendPrompt(payload)
      .then(() => {
        // Steps captured on agent_end via onRpcEvent.
      })
      .catch((err) => appendSystem(`[send failed] ${String(err)}`));
    return;
  }

  // Execute mode from composer: still require an approved plan path via Confirm,
  // or send as a normal prompt if user insists while in Execute without plan.
  if (!lastPlanText.trim()) {
    appendUser(text);
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
  void promptOrAbortAndPrompt(EXECUTE_PREFIX + text + "\n\nApproved plan:\n" + lastPlanText, status.is_streaming)
    .catch((err) => appendSystem(`[send failed] ${String(err)}`));
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
  }

  if (ev.kind === "response") {
    const f = ev.frame as { command?: string; success?: boolean; data?: unknown } | undefined;
    if (f?.command === "get_state" || f?.command === "set_model" || f?.command === "cycle_model") {
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
      void getStatus().then((s) => {
        status = s;
        renderStatus();
      });
      if (workMode === "plan") {
        // Defer so finalizeAssistant has run inside handleEvent.
        queueMicrotask(() => capturePlanFromTranscript());
      }
    }
    if (f?.type === "agent_start" || f?.type === "tool_execution_start") {
      void getStatus().then((s) => {
        status = s;
        renderStatus();
      });
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
  void doStart();
  settingsPanel.classList.remove("open");
  settingsToggle.textContent = "Settings";
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

composerEl.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

onTranscriptChange(renderTranscript);
onChangesChange(renderChanges);
onPlanTasksChange(renderTasks);
onModelsChange(() => {
  renderModelSelect(getAvailableModelsCache(), activeModelRef || modelSelectEl.value);
});

// Boot
void (async () => {
  settings = await loadSettings();
  saveSettings(settings);
  applySettingsToForm(settings);
  activeModelRef = settings.model;
  setWorkMode(loadUiMode());
  await subscribeEvents(onRpcEvent);
  renderStatus();
  renderChanges();
  renderTasks();
  await doStart();
})();
