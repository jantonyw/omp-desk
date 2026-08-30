import React from "react";
import type { OmpUpdateStatus } from "../client";
import type { ThemeId } from "../theme";

interface TopBarProps {
  theme: ThemeId;
  settingsOpen: boolean;
  updateStatus: OmpUpdateStatus | null;
  onThemeChange: (theme: ThemeId) => void;
  onToggleSettings: () => void;
  onCheckUpdate: () => void;
  onApplyUpdate: () => void;
}

function updateLabel(status: OmpUpdateStatus | null): string {
  if (!status) return "omp · …";
  const current = status.current || "omp";
  switch (status.state) {
    case "checking":
      return `${current} · checking`;
    case "updating":
      return `${current} · updating`;
    case "available":
      return status.pending_apply
        ? `${current} → ${status.latest ?? "?"} · waiting`
        : `${current} → ${status.latest ?? "?"}`;
    case "failed":
      return `${current} · update failed`;
    case "up_to_date":
    default:
      return `${current} · up to date`;
  }
}

export function TopBar({
  theme,
  settingsOpen,
  updateStatus,
  onThemeChange,
  onToggleSettings,
  onCheckUpdate,
  onApplyUpdate,
}: TopBarProps): React.ReactElement {
  const state = updateStatus?.state;
  const busy = state === "checking" || state === "updating";
  const canApply =
    state === "available" || Boolean(updateStatus?.pending_apply);

  return (
    <header id="topbar">
      <span className="brand">omp-desk</span>
      <div className="topbar-center">
        <span
          className={`omp-update-status${state ? ` is-${state}` : ""}`}
          title={updateStatus?.error || updateLabel(updateStatus)}
        >
          {updateLabel(updateStatus)}
        </span>
        <button
          type="button"
          className="omp-update-btn"
          disabled={busy}
          onClick={onCheckUpdate}
        >
          Check
        </button>
        {canApply && (
          <button
            type="button"
            className="omp-update-btn"
            disabled={busy}
            onClick={onApplyUpdate}
          >
            Update
          </button>
        )}
      </div>

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
