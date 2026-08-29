import React, { useState, useEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { TranscriptEntry } from "../client";
import type { BoundModel, RpcAvailableSlashCommand } from "../protocol";
import { formatModelRef } from "../protocol";

marked.setOptions({ gfm: true, breaks: true });

const MD_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "a",
  "strong",
  "em",
  "blockquote",
  "br",
  "hr",
];

function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MD_TAGS,
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class"],
  });
}

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

interface ChatPaneProps {
  workMode: "plan" | "execute";
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
  composerRef: React.RefObject<HTMLTextAreaElement>;
  transcriptRef: React.RefObject<HTMLElement>;
  onSetWorkMode: (mode: "plan" | "execute") => void;
  onComposerChange: (text: string) => void;
  onComposerKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSlashTrigger: () => void;
  onInsertSlash: (cmd: RpcAvailableSlashCommand) => void;
  onSend: () => void;
  onAbort: () => void;
  onSelectModel: (ref: string, provider?: string, modelId?: string) => void;
  onRefreshModels: () => void;
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
}: ChatPaneProps): React.ReactElement {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);

  const emptyChat = !entries.some((e) => e.role === "user" || e.role === "assistant");

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [entries]);

  // Click outside to close model popover
  useEffect(() => {
    if (!modelPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        modelBtnRef.current &&
        !modelBtnRef.current.contains(target)
      ) {
        setModelPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelPickerOpen]);

  return (
    <section
      id="pane-chat"
      className={emptyChat ? "empty-chat" : ""}
      aria-label="Chat"
    >
      <nav className="mode-tabs" aria-label="Work mode">
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
      </nav>

      <div id="chat-stage">
        <div
          id="welcome"
          className="welcome"
          aria-hidden={emptyChat ? "false" : "true"}
        >
          <h1 className="welcome-title">Ask omp</h1>
          <p className="welcome-sub">how can I help?</p>
        </div>

        <main id="transcript" ref={transcriptRef}>
          {entries.map((e) => {
            if (e.role === "user") {
              return (
                <div key={e.id} className="msg user">
                  <div className="role">You</div>
                  <div className="body">{e.text}</div>
                </div>
              );
            } else if (e.role === "assistant") {
              const cls = e.streaming ? "msg assistant streaming" : "msg assistant";
              const bodyClass = e.streaming ? "body" : "body md";
              return (
                <div key={e.id} className={cls} data-id={e.id}>
                  <div className="role">Omp</div>
                  {e.toolName && <div className="tooltag">{e.toolName}</div>}
                  {e.thinking && (
                    <div className="thinking">
                      <div className="role">Thinking</div>
                      <div className="body">{e.thinking}</div>
                    </div>
                  )}
                  {e.streaming ? (
                    <div className={bodyClass}>{e.text || ""}</div>
                  ) : (
                    <div
                      className={bodyClass}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(e.text) }}
                    />
                  )}
                </div>
              );
            } else if (e.role === "tool") {
              const cls = e.isError ? "msg tool error" : "msg tool";
              return (
                <div key={e.id} className={cls}>
                  <div className="role">Tool</div>
                  <div className="body">{e.text}</div>
                </div>
              );
            } else {
              const cls = e.isError ? "msg system error" : "msg system";
              return (
                <div key={e.id} className={cls}>
                  <div className="body">{e.text}</div>
                </div>
              );
            }
          })}
        </main>

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
                placeholder="Ask me anything (/ for commands · Enter send)"
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
