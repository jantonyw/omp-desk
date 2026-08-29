export type ThemeId = "dark" | "midnight" | "light" | "system";
export const THEMES: ThemeId[] = ["dark", "midnight", "light", "system"];

const THEME_KEY = "omp-desk.theme";

export function isThemeId(v: string | null): v is ThemeId {
  return v !== null && (THEMES as string[]).includes(v);
}

export function resolveColorScheme(theme: ThemeId): "dark" | "light" {
  if (theme === "light") return "light";
  if (theme === "dark" || theme === "midnight") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeId, selectEl?: HTMLSelectElement | null): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = resolveColorScheme(theme);
  if (selectEl && selectEl.value !== theme) {
    selectEl.value = theme;
  }
}

export function loadTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isThemeId(raw) ? raw : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: ThemeId): void {
  localStorage.setItem(THEME_KEY, theme);
}

export function setTheme(theme: ThemeId, selectEl?: HTMLSelectElement | null): void {
  saveTheme(theme);
  applyTheme(theme, selectEl);
}

export function initTheme(selectEl?: HTMLSelectElement | null): {
  getTheme: () => ThemeId;
  setTheme: (t: ThemeId) => void;
} {
  const current = loadTheme();
  applyTheme(current, selectEl);

  if (selectEl) {
    selectEl.addEventListener("change", () => {
      const v = selectEl.value;
      setTheme(isThemeId(v) ? v : "dark", selectEl);
    });
  }

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (loadTheme() === "system") {
      applyTheme("system", selectEl);
    }
  });

  return {
    getTheme: loadTheme,
    setTheme: (t: ThemeId) => setTheme(t, selectEl),
  };
}
