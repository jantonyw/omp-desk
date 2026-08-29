import React from "react";
import type { Status } from "../client";

interface SessionsPaneProps {
  status: Status;
  cwd: string;
  activeModelRef: string;
  onNewSession: () => void;
  onStopSession: () => void;
}

export function SessionsPane({
  status,
  cwd,
  activeModelRef,
  onNewSession,
  onStopSession,
}: SessionsPaneProps): React.ReactElement {
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

  const fullModel = activeModelRef || status.model || "omp default";
  const tipParts = [fullModel];
  if (status.pid != null) tipParts.push(`pid ${status.pid}`);
  const metaTip = tipParts.join(" · ");

  return (
    <aside id="pane-sessions" aria-label="Sessions">
      <div className="pane-title">Sessions</div>
      <button
        id="new-session"
        type="button"
        className="new-chat-btn"
        onClick={onNewSession}
      >
        New chat
      </button>
      <div
        id="session-card"
        className="session-row-card"
        role="list"
        title={metaTip}
      >
        <div className="boop-row session-boop" role="listitem">
          <span className="boop-source" aria-hidden="true"></span>
          <div className="boop-main">
            <div className="boop-title-row">
              <span className="boop-title">Current session</span>
              <span
                id="session-state"
                className="status-pill"
                data-state={stateLabel}
              >
                {stateLabel}
              </span>
            </div>
            <div id="session-cwd" className="boop-desc" title={cwd}>
              {cwd || "—"}
            </div>
            <div id="session-meta" className="boop-meta" title={metaTip}>
              {fullModel}
            </div>
          </div>
        </div>
      </div>
      <div className="pane-actions">
        <button
          id="stop-session"
          type="button"
          className="ghost-btn"
          onClick={onStopSession}
        >
          Stop
        </button>
      </div>
    </aside>
  );
}
