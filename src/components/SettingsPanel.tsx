import React, { useState, useEffect } from "react";
import type { OmpUpdateStatus, Settings } from "../client";

interface SettingsPanelProps {
  isOpen: boolean;
  settings: Settings;
  updateStatus: OmpUpdateStatus | null;
  onApply: (newSettings: Settings) => void;
  onCheckUpdate: () => void;
  onApplyUpdate: () => void;
}

export function SettingsPanel({
  isOpen,
  settings,
  updateStatus,
  onApply,
  onCheckUpdate,
  onApplyUpdate,
}: SettingsPanelProps): React.ReactElement {
  const [form, setForm] = useState<Settings>(settings);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const busy =
    updateStatus?.state === "checking" || updateStatus?.state === "updating";
  const canApplyUpdate =
    updateStatus?.state === "available" || Boolean(updateStatus?.pending_apply);

  return (
    <section id="settings-panel" className={isOpen ? "open" : ""}>
      <div className="row">
        <label htmlFor="omp-path">omp path</label>
        <input
          id="omp-path"
          type="text"
          spellCheck={false}
          value={form.ompPath}
          onChange={(e) => setForm({ ...form, ompPath: e.target.value })}
        />
      </div>
      <div className="row">
        <label htmlFor="cwd">cwd</label>
        <input
          id="cwd"
          type="text"
          spellCheck={false}
          value={form.cwd}
          onChange={(e) => setForm({ ...form, cwd: e.target.value })}
        />
      </div>
      <div className="row">
        <label htmlFor="model">spawn model</label>
        <input
          id="model"
          type="text"
          spellCheck={false}
          placeholder="empty = omit --model (omp config default)"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
      </div>
      <div className="row checks">
        <label>
          <input
            id="no-session"
            type="checkbox"
            checked={form.noSession}
            onChange={(e) => setForm({ ...form, noSession: e.target.checked })}
          />{" "}
          no-session
        </label>
        <label>
          <input
            id="no-skills"
            type="checkbox"
            checked={form.noSkills}
            onChange={(e) => setForm({ ...form, noSkills: e.target.checked })}
          />{" "}
          no-skills
        </label>
        <label>
          <input
            id="no-rules"
            type="checkbox"
            checked={form.noRules}
            onChange={(e) => setForm({ ...form, noRules: e.target.checked })}
          />{" "}
          no-rules
        </label>
      </div>
      <div className="row">
        <label htmlFor="extra-args">extra args</label>
        <input
          id="extra-args"
          type="text"
          spellCheck={false}
          placeholder="e.g. --plan-yolo (real omp flag)"
          value={form.extraArgs}
          onChange={(e) => setForm({ ...form, extraArgs: e.target.value })}
        />
      </div>
      <div className="row checks">
        <label>
          <input
            id="auto-update-omp"
            type="checkbox"
            checked={form.autoUpdateOmp}
            onChange={(e) => setForm({ ...form, autoUpdateOmp: e.target.checked })}
          />{" "}
          auto-update omp
        </label>
      </div>
      <div className="row">
        <label htmlFor="omp-update-interval">check interval (hours)</label>
        <input
          id="omp-update-interval"
          type="number"
          min="0.25"
          step="0.25"
          value={form.ompUpdateIntervalHours}
          onChange={(e) =>
            setForm({
              ...form,
              ompUpdateIntervalHours: Number(e.target.value),
            })
          }
        />
      </div>
      <div className="row omp-update-row">
        <button
          id="check-omp-update"
          type="button"
          disabled={busy}
          onClick={onCheckUpdate}
        >
          Check now
        </button>
        <button
          id="apply-omp-update"
          type="button"
          disabled={busy || !canApplyUpdate}
          onClick={onApplyUpdate}
        >
          Update now
        </button>
        {updateStatus?.error && (
          <span className="omp-update-error" title={updateStatus.error}>
            {updateStatus.error}
          </span>
        )}
      </div>
      <div className="row">
        <button
          id="apply-settings"
          type="button"
          onClick={() => onApply(form)}
        >
          Apply &amp; restart
        </button>
      </div>
    </section>
  );
}
