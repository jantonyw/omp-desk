import { homeDir } from "@tauri-apps/api/path";
import type { Settings } from "./client";

const SETTINGS_KEY = "omp-desk.settings";
const LEGACY_DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
const homeCwdPromise: Promise<string> = homeDir().catch(() => "/workspace");

export function defaultSettings(): Settings {
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

export async function loadSettings(): Promise<Settings> {
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

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export interface SettingsFormElements {
  ompPath: HTMLInputElement;
  cwd: HTMLInputElement;
  model: HTMLInputElement;
  noSession: HTMLInputElement;
  noSkills: HTMLInputElement;
  noRules: HTMLInputElement;
  extraArgs: HTMLInputElement;
}

export async function readSettingsForm(form: SettingsFormElements): Promise<Settings> {
  const home = await homeCwdPromise;
  return {
    ompPath: form.ompPath.value.trim() || "omp",
    cwd: form.cwd.value.trim() || home,
    model: form.model.value.trim(),
    noSession: form.noSession.checked,
    noSkills: form.noSkills.checked,
    noRules: form.noRules.checked,
    extraArgs: form.extraArgs.value,
  };
}

export function applySettingsToForm(form: SettingsFormElements, s: Settings): void {
  form.ompPath.value = s.ompPath;
  form.cwd.value = s.cwd;
  form.model.value = s.model;
  form.noSession.checked = s.noSession;
  form.noSkills.checked = s.noSkills;
  form.noRules.checked = s.noRules;
  form.extraArgs.value = s.extraArgs;
}

export function initSettingsPanel(
  panelEl: HTMLElement,
  toggleBtn: HTMLButtonElement,
  applyBtn: HTMLElement,
  form: SettingsFormElements,
  onApply: (newSettings: Settings) => Promise<void> | void,
): {
  getSettings: () => Promise<Settings>;
  setSettings: (s: Settings) => void;
  close: () => void;
} {
  toggleBtn.addEventListener("click", () => {
    panelEl.classList.toggle("open");
    const isOpen = panelEl.classList.contains("open");
    toggleBtn.textContent = isOpen ? "Hide settings" : "Settings";
  });

  applyBtn.addEventListener("click", async () => {
    const s = await readSettingsForm(form);
    saveSettings(s);
    await onApply(s);
    panelEl.classList.remove("open");
    toggleBtn.textContent = "Settings";
  });

  return {
    getSettings: () => readSettingsForm(form),
    setSettings: (s: Settings) => {
      saveSettings(s);
      applySettingsToForm(form, s);
    },
    close: () => {
      panelEl.classList.remove("open");
      toggleBtn.textContent = "Settings";
    },
  };
}
