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
  getAvailableModelsCache,
  getChangedFiles,
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
  type Settings,
  type Status,
} from "./client";
import type { RpcEventPayload } from "./protocol";
import { initIde } from "./ide";
import { initTheme } from "./theme";
import {
  defaultSettings,
  initSettingsPanel,
  loadSettings,
  saveSettings,
  type SettingsFormElements,
} from "./settings";
import { initSlashPalette } from "./slash-palette";
import { initModelSelector } from "./model-selector";
import { escapeHtml, initTranscriptRenderer } from "./transcript-renderer";

// --- DOM References --------------------------------------------------------

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

const settingsFormElements: SettingsFormElements = {
  ompPath: document.getElementById("omp-path") as HTMLInputElement,
  cwd: document.getElementById("cwd") as HTMLInputElement,
  model: document.getElementById("model") as HTMLInputElement,
  noSession: document.getElementById("no-session") as HTMLInputElement,
  noSkills: document.getElementById("no-skills") as HTMLInputElement,
  noRules: document.getElementById("no-rules") as HTMLInputElement,
  extraArgs: document.getElementById("extra-args") as HTMLInputElement,
};
const settingsPanel = document.getElementById("settings-panel")!;
const settingsToggle = document.getElementById("settings-toggle") as HTMLButtonElement;
const applySettingsBtn = document.getElementById("apply-settings")!;
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

type WorkMode = "plan" | "execute";
let workMode: WorkMode = "plan";
let lastPlanText = "";
let selectingModel = false;
let activeModelRef = "";
let settings: Settings = defaultSettings();

const UI_KEY = "omp-desk.ui";

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

// --- Sub-controllers -------------------------------------------------------

initTheme(themeSelectEl);

const transcriptRenderer = initTranscriptRenderer({
  transcriptEl,
  paneChatEl,
  welcomeEl,
});

const slashPalette = initSlashPalette(
  composerEl,
  slashPaletteEl,
  slashTriggerBtn,
);

const modelSelector = initModelSelector(
  { modelSelectEl, modelTabsEl },
  async (provider, modelId, ref) => {
    if (!status.ready || selectingModel) return;

    if (!ref) {
      settings.model = "";
      settingsFormElements.model.value = "";
      saveSettings(settings);
      activeModelRef = status.model || "";
      renderStatus();
      appendSystem(
        "[models] omp default selected for next spawn (omit --model). Active session model unchanged.",
      );
      return;
    }
    if (!provider || !modelId) return;

    const previous = activeModelRef;
    selectingModel = true;
    renderStatus();
    try {
      const updated = await setModel(provider, modelId);
      activeModelRef = formatModelRef(updated) || ref;
      settings.model = activeModelRef;
      settingsFormElements.model.value = activeModelRef;
      saveSettings(settings);
      status = await getStatus().catch(() => status);
      if (status.model) {
        activeModelRef = status.model.includes("/") ? status.model : activeModelRef;
      }
      modelSelector.render(getAvailableModelsCache(), activeModelRef);
    } catch (err) {
      modelSelector.render(getAvailableModelsCache(), previous);
      appendSystem(`[set_model failed] ${String(err)}`);
    } finally {
      selectingModel = false;
      renderStatus();
    }
  },
  () => status.ready && !selectingModel,
);

// --- Status & Views Rendering ----------------------------------------------

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
  modelSelector.setDisabled(!status.ready || selectingModel);
  executePlanBtn.disabled = !status.ready || !lastPlanText.trim();

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

// --- Actions ---------------------------------------------------------------

function appendSystem(text: string): void {
  handleEvent({ kind: "stderr", text });
}

function bumpMessageCount(): void {
  status = { ...status, message_count: (status.message_count || 0) + 1 };
  renderStatus();
}

async function refreshMessageCount(): Promise<void> {
  try {
    await fetchSessionState();
    const st = await getStatus();
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
  const s = await settingsController.getSettings();
  if (forceModel !== undefined) s.model = forceModel;
  saveSettings(s);
  settings = s;
  clearTranscript();
  clearChangedFiles();
  clearPlanTasks();
  lastPlanText = "";
  activeModelRef = s.model;
  modelSelector.render([], activeModelRef);
  modelSelector.setDisabled(true);
  slashPalette.hide();
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

async function onReadyLoadModels(): Promise<void> {
  try {
    const models = await fetchAvailableModels();
    const st = await getStatus();
    status = st;
    if (st.model) activeModelRef = st.model;
    modelSelector.render(models, activeModelRef);
    if (settings.model) {
      const match = models.find((m) => formatModelRef(m) === settings.model);
      if (match && activeModelRef !== settings.model) {
        try {
          const updated = await setModel(match.provider, match.id);
          activeModelRef = formatModelRef(updated) || settings.model;
          modelSelector.render(models, activeModelRef);
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

function onSend(): void {
  const text = composerEl.value;
  if (!text.trim()) return;
  if (slashPalette.isOpen()) {
    // Handled by keydown / slash controller
    return;
  }
  composerEl.value = "";
  slashPalette.hide();

  const isSlash = text.trimStart().startsWith("/");

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
    modelSelector.setDisabled(true);
    slashPalette.hide();
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
            modelSelector.render(getAvailableModelsCache(), ref);
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
      slashPalette.render();
    }
    if (f?.type === "session_info_update" || f?.type === "config_update") {
      void refreshMessageCount();
    }
  }
}

// --- Wire Event Handlers ---------------------------------------------------

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

modePlanBtn.addEventListener("click", () => setWorkMode("plan"));
modeExecuteBtn.addEventListener("click", () => {
  if (!lastPlanText.trim()) {
    appendSystem(
      "[mode] Switch to Plan and capture a plan before Execute, or use Confirm execute.",
    );
  }
  setWorkMode("execute");
});
executePlanBtn.addEventListener("click", () => {
  void onConfirmExecute();
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
  const handled = slashPalette.handleKeydown(e);
  if (handled) return;

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

onTranscriptChange(transcriptRenderer.schedulePaint);
onChangesChange(renderChanges);
onPlanTasksChange(renderTasks);
onModelsChange(() => {
  modelSelector.render(getAvailableModelsCache(), activeModelRef || modelSelectEl.value);
});
onCommandsChange(() => {
  if (composerEl.value.startsWith("/")) {
    slashPalette.render();
  }
});

// IDE sidebar
const ide = initIde(() => settings.cwd);

// Settings Panel Controller
const settingsController = initSettingsPanel(
  settingsPanel,
  settingsToggle,
  applySettingsBtn,
  settingsFormElements,
  async (newSettings) => {
    settings = newSettings;
    await doStart();
    ide.refresh();
  },
);

// --- Boot ------------------------------------------------------------------

void (async () => {
  settings = await loadSettings();
  settingsController.setSettings(settings);
  activeModelRef = settings.model;
  setWorkMode(loadUiMode());
  ide.refresh();
  await subscribeEvents(onRpcEvent);
  renderStatus();
  renderChanges();
  renderTasks();
  transcriptRenderer.updateEmptyChat();
  await doStart();
})();
