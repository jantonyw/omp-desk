import React from "react";
import type { ChangedFile, PlanTask } from "../client";

interface InspectorPaneProps {
  changes: ChangedFile[];
  tasks: PlanTask[];
  hasPlanInChat: boolean;
  canConfirmExecute: boolean;
  isStreaming: boolean;
  onClearChanges: () => void;
  onConfirmExecute: () => void;
  onToggleTask: (id: string) => void;
  onNewSession: () => void;
  onAbort: () => void;
}

export function InspectorPane({
  changes,
  tasks,
  hasPlanInChat,
  canConfirmExecute,
  isStreaming,
  onClearChanges,
  onConfirmExecute,
  onToggleTask,
  onNewSession,
  onAbort,
}: InspectorPaneProps): React.ReactElement {
  return (
    <aside id="pane-inspector" aria-label="Inspector">
      <div className="pane-title">Inspector</div>

      <div className="inspector-section">
        <div className="section-head">
          <span>Changes</span>
          <button
            id="clear-changes"
            type="button"
            className="linkish"
            onClick={onClearChanges}
          >
            Clear
          </button>
        </div>
        <ul id="changes-list" className="boop-list changes-list">
          {changes.length === 0 ? (
            <li className="empty-hint">No changes yet</li>
          ) : (
            changes.map((f, i) => {
              const kind = f.kind || "edit";
              const base = f.path.split(/[/\\]/).pop() || f.path;
              return (
                <li key={`${f.path}-${i}`} className="boop-row">
                  <span
                    className={`boop-source ${kind}`}
                    aria-hidden="true"
                  ></span>
                  <div className="boop-main">
                    <div className="boop-title-row">
                      <span className="boop-title" title={f.path}>
                        {base}
                      </span>
                      <span className="status-pill" data-kind={kind}>
                        {kind}
                      </span>
                    </div>
                    <div className="boop-desc" title={f.path}>
                      {f.path}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="inspector-section grow">
        <div className="section-head">
          <span>Tasks</span>
          <button
            id="execute-plan"
            type="button"
            className="linkish"
            disabled={!canConfirmExecute}
            onClick={onConfirmExecute}
          >
            Confirm execute
          </button>
        </div>
        <ul id="tasks-list" className="boop-list tasks-list">
          {tasks.length === 0 ? (
            <li className="empty-hint">
              {hasPlanInChat
                ? "No parseable steps — plan is in chat"
                : "No tasks yet"}
            </li>
          ) : (
            tasks.map((t) => {
              const kind = t.done ? "done" : "todo";
              return (
                <li
                  key={t.id}
                  className={`boop-row ${t.done ? "done" : ""}`}
                  data-id={t.id}
                >
                  <input
                    type="checkbox"
                    className="task-check"
                    checked={t.done}
                    aria-label="toggle step"
                    onChange={() => onToggleTask(t.id)}
                  />
                  <span
                    className={`boop-source ${kind}`}
                    aria-hidden="true"
                  ></span>
                  <div className="boop-main">
                    <div className="boop-title-row">
                      <span className="boop-title">{t.text}</span>
                      <span className="status-pill" data-kind={kind}>
                        {t.done ? "Done" : "Todo"}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="inspector-section run-section">
        <div className="section-head">
          <span>Run</span>
        </div>
        <div className="run-actions">
          <button
            id="run-new-session"
            type="button"
            className="ghost-btn"
            onClick={onNewSession}
          >
            New chat
          </button>
          <button
            id="run-abort"
            type="button"
            className="ghost-btn"
            disabled={!isStreaming}
            onClick={onAbort}
          >
            Abort
          </button>
        </div>
      </div>
    </aside>
  );
}
