import React from "react";
import type { ThemeId } from "../theme";

interface TopBarProps {
  theme: ThemeId;
  settingsOpen: boolean;
  onThemeChange: (theme: ThemeId) => void;
  onToggleSettings: () => void;
}

export function TopBar({
  theme,
  settingsOpen,
  onThemeChange,
  onToggleSettings,
}: TopBarProps): React.ReactElement {
  return (
    <header id="topbar">
      <span className="brand">omp-desk</span>

      <div className="topbar-actions">
        <label className="theme-picker">
          <span className="theme-label">Theme</span>
          <select
            id="theme-select"
            title="Color theme"
            aria-label="Theme"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value as ThemeId)}
          >
            <option value="dark">Dark</option>
            <option value="midnight">Midnight</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </label>
        <button
          id="settings-toggle"
          type="button"
          onClick={onToggleSettings}
        >
          {settingsOpen ? "Hide settings" : "Settings"}
        </button>
      </div>
    </header>
  );
}
