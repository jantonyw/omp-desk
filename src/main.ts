import {
  abort,
  appendUser,
  clearTranscript,
  getEntries,
  getStatus,
  handleEvent,
  onTranscriptChange,
  sendPrompt,
  startSession,
  subscribeEvents,
  type Settings,
  type Status,
} from "./client";
import type { RpcEventPayload } from "./protocol";

// --- DOM -------------------------------------------------------------------

const transcriptEl = document.getElementById("transcript")!;
const composerEl = document.getElementById("composer") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const abortBtn = document.getElementById("abort") as HTMLButtonElement;
const newSessionBtn = document.getElementById("new-session") as HTMLButtonElement;
const statusBarEl = document.getElementById("status-bar")!;

// Settings form
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

const SETTINGS_KEY = "omp-desk.settings";

function defaultSettings(): Settings {
  return {
    ompPath: "omp",
    cwd: "/workspace",
    model: "deepseek/deepseek-v4-pro",
    noSession: false,
    noSkills: false,
    noRules: false,
    extraArgs: "",
  };
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // fall through to defaults
  }
  return defaultSettings();
}

function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function readSettingsForm(): Settings {
  return {
    ompPath: ompPathEl.value.trim() || "omp",
    cwd: cwdEl.value.trim() || "/workspace",
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

let settings = loadSettings();
applySettingsToForm(settings);

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
  // Preserve scroll position when appending streaming content.
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
    if (status.model) parts.push(status.model);
    parts.push(`${status.message_count} msgs`);
    if (status.session_id) parts.push(`#${status.session_id.slice(0, 8)}`);
  }
  statusBarEl.textContent = parts.join(" · ");
  sendBtn.disabled = !status.ready;
  abortBtn.disabled = !status.running || !status.is_streaming;
}

// --- Actions ---------------------------------------------------------------

async function doStart(forceModel?: string): Promise<void> {
  const s = readSettingsForm();
  if (forceModel) s.model = forceModel;
  saveSettings(s);
  settings = s;
  clearTranscript();
  try {
    status = await startSession(s);
  } catch (err) {
    appendSystem(`[start failed] ${String(err)}`);
    status = await getStatus().catch(() => status);
    // Avoid local var shadow warnings; keep status accurate.
    status = { ...status, started: false };
  }
  renderStatus();
}

function appendSystem(text: string): void {
  // Use a synthetic event to keep rendering consistent (handleEvent emits).
  handleEvent({ kind: "stderr", text });
}

function onRpcEvent(ev: RpcEventPayload): void {
  handleEvent(ev);
  // Refresh status on lifecycle-relevant frames.
  if (ev.kind === "ready" || ev.kind === "exited") {
    void getStatus().then((s) => {
      status = s;
      renderStatus();
    });
  }
  if (ev.kind === "response") {
    const f = ev.frame as { command?: string } | undefined;
    if (f?.command === "get_state") {
      void getStatus().then((s) => {
        status = s;
        renderStatus();
      });
    }
  }
}

function onSend(): void {
  const text = composerEl.value;
  if (!text.trim()) return;
  appendUser(text);
  composerEl.value = "";
  void sendPrompt(text).catch((err) => appendSystem(`[send failed] ${String(err)}`));
}

// --- Wiring ----------------------------------------------------------------

sendBtn.addEventListener("click", onSend);
abortBtn.addEventListener("click", () => {
  void abort().catch((err) => appendSystem(`[abort failed] ${String(err)}`));
});
newSessionBtn.addEventListener("click", () => {
  void doStart();
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

composerEl.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    onSend();
  }
});

onTranscriptChange(renderTranscript);

// Boot: attach the event listener, then start the session.
void (async () => {
  await subscribeEvents(onRpcEvent);
  renderStatus();
  await doStart();
})();
