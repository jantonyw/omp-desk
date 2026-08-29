import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import type { TranscriptEntry, WorkspaceGroup } from "../client";
import type { BoundModel, RpcAvailableSlashCommand } from "../protocol";
import { formatModelRef } from "../protocol";
import { TraceView } from "./TraceView";
import { renderMarkdown } from "../markdown-renderer";

const ROLE_LABELS = new Set(["default", "smol", "slow", "plan"]);

function modelRoleAnnotation(m: BoundModel): string {
  const found: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const low = v.toLowerCase();
    if (ROLE_LABELS.has(low)) found.push(low);
  };
  push(m.role);
  for (const r of m.roles ?? []) push(r);
  for (const t of m.tags ?? []) push(t);
  const extra = m as BoundModel & Record<string, unknown>;
  for (const key of ROLE_LABELS) {
    if (extra[key] === true) found.push(key);
  }
  return [...new Set(found)].join(", ");
}

const TranscriptMessageItem = React.memo(function TranscriptMessageItem({
  entry,
}: {
  entry: TranscriptEntry;
}) {
  const e = entry;
  if (e.role === "user") {
    return (
      <div className="msg user">
        <div className="role">You</div>
        <div className="body">{e.text}</div>
      </div>
    );
  }
  if (e.role === "assistant") {
    const cls = e.streaming ? "msg assistant streaming" : "msg assistant";
    const bodyClass = e.streaming ? "body" : "body md";
    return (
      <div className={cls} data-id={e.id}>
        <div className="role">Omp</div>
        {e.toolName && <div className="tooltag">{e.toolName}</div>}
        {e.thinking && (
          <div className="thinking">
            <div className="role">Thinking</div>
            <div className="body">{e.thinking}</div>
          </div>
        )}
        {e.streaming ? (
          <div className={bodyClass}>
            {e.text || ""}
            <span className="streaming-cursor">▌</span>
          </div>
        ) : (
          <div
            className={bodyClass}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(e.text) }}
          />
        )}
      </div>
    );
  }
  if (e.role === "tool") {
    const isError = Boolean(e.isError);
    const toolLabel = e.toolName ? `${e.toolName}` : "tool output";
    return (
      <div className={`msg tool ${isError ? "error" : ""}`}>
        <div className="tool-output-card">
          <div className="tool-output-head">
            <span className="tool-output-tag">🛠️ {toolLabel}</span>
            {isError && <span className="status-pill" data-kind="error">Error</span>}
            <button
              type="button"
              className="code-block-copy"
              onClick={() => navigator.clipboard.writeText(e.text)}
            >
              Copy
            </button>
          </div>
          <pre className="tool-output-pre"><code>{e.text}</code></pre>
        </div>
      </div>
    );
  }
  const cls = e.isError ? "msg system error" : "msg system";
  return (
    <div className={cls}>
      <div className="body">{e.text}</div>
    </div>
  );
});

interface ChatPaneProps {
  workMode: "chat" | "plan" | "execute";
  entries: TranscriptEntry[];
  composerText: string;
  isStreaming: boolean;
  canSend: boolean;
  models: BoundModel[];
  activeModelRef: string;
  selectingModel: boolean;
  isReady: boolean;
  slashOpen: boolean;
  slashIndex: number;
  slashFiltered: RpcAvailableSlashCommand[];
  currentCwd: string;
  workspaceGroups: WorkspaceGroup[];
  composerRef: React.RefObject<HTMLTextAreaElement>;
  transcriptRef: React.RefObject<HTMLElement>;
  onSetWorkMode: (mode: "chat" | "plan" | "execute") => void;
  onComposerChange: (text: string) => void;
  onComposerKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSlashTrigger: () => void;
  onInsertSlash: (cmd: RpcAvailableSlashCommand) => void;
  onSend: () => void;
  onAbort: () => void;
  onSelectModel: (ref: string, provider?: string, modelId?: string) => void;
  onRefreshModels: () => void;
  onSelectWorkspace: (path: string) => void;
  onAddWorkspace: () => void;
}

export function ChatPane({
  workMode,
  entries,
  composerText,
  isStreaming,
  canSend,
  models,
  activeModelRef,
  selectingModel,
  isReady,
  slashOpen,
  slashIndex,
  slashFiltered,
  currentCwd,
  workspaceGroups,
  composerRef,
  transcriptRef,
  onSetWorkMode,
  onComposerChange,
  onComposerKeyDown,
  onSlashTrigger,
  onInsertSlash,
  onSend,
  onAbort,
  onSelectModel,
  onRefreshModels,
  onSelectWorkspace,
  onAddWorkspace,
}: ChatPaneProps): React.ReactElement {
  const [activeViewTab, setActiveViewTab] = useState<"chat" | "trace">("chat");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [wsPickerOpen, setWsPickerOpen] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const wsSwitcherRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);

  const emptyChat = !entries.some((e) => e.role === "user" || e.role === "assistant");

  // Instant pixel-accurate scroll to bottom
  const scrollToBottom = useCallback((instant = false) => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight + 10000;
    }
    if (bottomAnchorRef.current) {
      bottomAnchorRef.current.scrollIntoView({
        behavior: instant ? "auto" : "auto",
        block: "end",
      });
    }
  }, [transcriptRef]);

  // Synchronously lock to bottom before paint on session load
  useLayoutEffect(() => {
    if (activeViewTab === "chat" && entries.length > 0) {
      scrollToBottom(true);
    }
  }, [entries[0]?.id, entries.length, activeViewTab, scrollToBottom]);

  // Track ongoing stream or layout expansions
  useEffect(() => {
    if (activeViewTab === "chat" && entries.length > 0) {
      scrollToBottom(true);
      const raf = requestAnimationFrame(() => scrollToBottom(true));
      const t1 = setTimeout(() => scrollToBottom(true), 30);
      const t2 = setTimeout(() => scrollToBottom(true), 100);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [entries, isStreaming, activeViewTab, scrollToBottom]);

  // Get current workspace name
  const currentWorkspaceName = useMemo(() => {
    const found = workspaceGroups.find(
      (g) => g.path === currentCwd || currentCwd.startsWith(g.path)
    );
    if (found) return found.name;
    return currentCwd.split(/[/\\]/).pop() || "工作区";
  }, [workspaceGroups, currentCwd]);

  // Click outside to close popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        modelPickerOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        modelBtnRef.current &&
        !modelBtnRef.current.contains(target)
      ) {
        setModelPickerOpen(false);
      }
      if (
        wsPickerOpen &&
        wsSwitcherRef.current &&
        !wsSwitcherRef.current.contains(target)
      ) {
        setWsPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelPickerOpen, wsPickerOpen]);

  return (
    <section
      id="pane-chat"
      className={emptyChat && activeViewTab === "chat" ? "empty-chat" : ""}
      aria-label="Chat"
    >
      <nav
        className="mode-tabs"
        aria-label="Work mode"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingRight: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 对话 (Chat) | 轨迹 (Trace) Tab Switcher (Image #2 layout) */}
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <button
              type="button"
              className={`mode-tab ${activeViewTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveViewTab("chat")}
            >
              对话
            </button>
            <button
              type="button"
              className={`mode-tab ${activeViewTab === "trace" ? "active" : ""}`}
              onClick={() => setActiveViewTab("trace")}
            >
              轨迹
            </button>
          </div>

          <span style={{ color: "var(--border)", userSelect: "none" }}>|</span>

          {/* Chat | Plan | Execute 3 Work Mode Tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
            <button
              type="button"
              id="mode-chat"
              className={`mode-tab ${workMode === "chat" ? "active" : ""}`}
              aria-pressed={workMode === "chat"}
              onClick={() => onSetWorkMode("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              id="mode-plan"
              className={`mode-tab ${workMode === "plan" ? "active" : ""}`}
              aria-pressed={workMode === "plan"}
              onClick={() => onSetWorkMode("plan")}
            >
              Plan
            </button>
            <button
              type="button"
              id="mode-execute"
              className={`mode-tab ${workMode === "execute" ? "active" : ""}`}
              aria-pressed={workMode === "execute"}
              onClick={() => onSetWorkMode("execute")}
            >
              Execute
            </button>
          </div>
        </div>

        {/* Workspace Switcher Pill & Popover (Image #1 layout) */}
        <div className="workspace-switcher-wrap" ref={wsSwitcherRef}>
          <button
            type="button"
            className={`workspace-switcher-btn ${wsPickerOpen ? "open" : ""}`}
            onClick={() => setWsPickerOpen((v) => !v)}
            title="切换当前工作区"
          >
            <span aria-hidden="true">📁</span>
            <span>{currentWorkspaceName}</span>
            <span style={{ fontSize: "10px", opacity: 0.6 }}>▾</span>
          </button>

          {wsPickerOpen && (
            <div className="workspace-popover">
              <ul className="workspace-popover-list">
                {workspaceGroups.map((g) => {
                  const isActive =
                    g.path === currentCwd ||
                    currentCwd.startsWith(g.path) ||
                    g.path.startsWith(currentCwd);
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        className={`workspace-popover-item ${
                          isActive ? "active" : ""
                        }`}
                        onClick={() => {
                          onSelectWorkspace(g.path);
                          setWsPickerOpen(false);
                        }}
                      >
                        <div className="workspace-popover-item-main">
                          <span aria-hidden="true">📁</span>
                          <span className="workspace-popover-item-name">
                            {g.name}
                          </span>
                        </div>
                        {isActive && (
                          <span className="workspace-popover-check">✓</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="workspace-popover-divider" />
              <button
                type="button"
                className="workspace-popover-add"
                onClick={() => {
                  onAddWorkspace();
                  setWsPickerOpen(false);
                }}
              >
                <span>+</span>
                <span>添加工作区...</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      <div id="chat-stage">
        {/* If in Trace View: render TraceView */}
        {activeViewTab === "trace" ? (
          <TraceView entries={entries} />
        ) : (
          <>
            <div
              id="welcome"
              className="welcome"
              aria-hidden={emptyChat ? "false" : "true"}
            >
              <h1 className="welcome-title">Ask omp</h1>
              <p className="welcome-sub">how can I help?</p>
            </div>

            <main id="transcript" ref={transcriptRef}>
              {entries.map((e) => (
                <TranscriptMessageItem key={e.id} entry={e} />
              ))}

              {isStreaming &&
                (!entries.length ||
                  entries[entries.length - 1]?.role === "user" ||
                  (entries[entries.length - 1]?.role === "assistant" &&
                    !entries[entries.length - 1]?.text.trim() &&
                    !entries[entries.length - 1]?.thinking &&
                    !entries[entries.length - 1]?.toolName)) && (
                  <div className="msg assistant streaming loading-bubble">
                    <div className="role">Omp</div>
                    <div className="loading-dots" aria-label="Thinking">
                      <span className="loading-dot" />
                      <span className="loading-dot" />
                      <span className="loading-dot" />
                    </div>
                  </div>
                )}
              <div
                ref={bottomAnchorRef}
                style={{ height: "40px", minHeight: "40px", flexShrink: 0, opacity: 0 }}
              />
            </main>
          </>
        )}

        <footer id="composer-bar">
          <div className="composer-wrap">
            <div
              id="slash-palette"
              className={`slash-palette ${slashOpen ? "" : "hidden"}`}
              role="listbox"
              aria-label="Slash commands"
              aria-hidden={!slashOpen}
            >
              {slashFiltered.map((c, i) => {
                const aliases = (c.aliases ?? []).length
                  ? (c.aliases ?? []).map((a) => `/${a}`).join(" ")
                  : "";
                return (
                  <button
                    key={c.name}
                    type="button"
                    className={`slash-item ${i === slashIndex ? "active" : ""}`}
                    role="option"
                    aria-selected={i === slashIndex}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => onInsertSlash(c)}
                  >
                    <span className="slash-name">/{c.name}</span>
                    {aliases && <span className="slash-alias">{aliases}</span>}
                    {c.description && (
                      <span className="slash-desc">{c.description}</span>
                    )}
                    {c.input?.hint && (
                      <span className="slash-hint">{c.input.hint}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="composer-well">
              <button
                id="slash-trigger"
                type="button"
                className="composer-icon-btn"
                title="Slash commands"
                aria-label="Insert slash command"
                onClick={onSlashTrigger}
              >
                /
              </button>
              <textarea
                ref={composerRef}
                id="composer"
                placeholder={
                  workMode === "chat"
                    ? "Chat mode: Ask anything (/ for commands · Enter send)..."
                    : workMode === "plan"
                    ? "Plan mode: Describe your goal to generate a structured implementation plan..."
                    : "Execute mode: Implement code changes and execute tasks..."
                }
                rows={2}
                spellCheck={false}
                value={composerText}
                onChange={(e) => onComposerChange(e.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <div className="composer-actions">
                <button
                  id="abort"
                  type="button"
                  className="abort-ghost"
                  disabled={!isStreaming}
                  hidden={!isStreaming}
                  onClick={onAbort}
                >
                  Abort
                </button>
                <button
                  id="send"
                  type="button"
                  className="send-circle"
                  disabled={!canSend}
                  title="Send"
                  aria-label="Send"
                  onClick={onSend}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                    fill="none"
                  >
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Bottom Toolbar with Popover Model Selector (Image #2 layout) */}
            <div className="composer-toolbar">
              <div className="composer-tools-left">
                {modelPickerOpen && (
                  <div className="model-popover" ref={popoverRef}>
                    <div className="model-popover-head">
                      <span className="model-popover-title">Models</span>
                      <button
                        type="button"
                        className="model-popover-refresh"
                        title="Reload models from omp"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRefreshModels();
                        }}
                      >
                        ↻
                      </button>
                    </div>
                    <ul className="model-popover-list">
                      <li>
                        <button
                          type="button"
                          className={`model-popover-item ${
                            !activeModelRef ? "active" : ""
                          }`}
                          onClick={() => {
                            onSelectModel("");
                            setModelPickerOpen(false);
                          }}
                        >
                          <span className="model-popover-idx">1</span>
                          <div className="model-popover-info">
                            <span className="model-popover-name">
                              CLI default
                            </span>
                            <span className="model-popover-desc">
                              Oh My Pi
                            </span>
                          </div>
                        </button>
                      </li>
                      {models.map((m, idx) => {
                        const ref = formatModelRef(m);
                        const role = modelRoleAnnotation(m);
                        const isActive = activeModelRef === ref;
                        const desc = role
                          ? `${m.provider} via Oh My Pi · ${role}`
                          : `${m.provider} via Oh My Pi · ${ref}`;
                        return (
                          <li key={ref}>
                            <button
                              type="button"
                              className={`model-popover-item ${
                                isActive ? "active" : ""
                              }`}
                              onClick={() => {
                                onSelectModel(ref, m.provider, m.id);
                                setModelPickerOpen(false);
                              }}
                            >
                              <span className="model-popover-idx">
                                {idx + 2}
                              </span>
                              <div className="model-popover-info">
                                <span className="model-popover-name">
                                  {ref}
                                </span>
                                <span className="model-popover-desc">
                                  {desc}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <button
                  ref={modelBtnRef}
                  type="button"
                  className={`composer-model-btn ${
                    modelPickerOpen ? "open" : ""
                  }`}
                  title="Switch model"
                  disabled={!isReady || selectingModel}
                  onClick={() => setModelPickerOpen((v) => !v)}
                >
                  <span className="composer-model-icon">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 4h12M8 4v9M5 13h6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="composer-model-name">
                    {activeModelRef || "CLI default"}
                  </span>
                  <span className="composer-model-chevron">▾</span>
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </section>
  );
}
