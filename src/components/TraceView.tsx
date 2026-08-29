import React, { useState, useMemo, useRef } from "react";
import type { TranscriptEntry } from "../client";
import {
  buildTraceFromTranscript,
  computeTraceMetrics,
  formatDuration,
} from "../trace";

interface TraceViewProps {
  entries: TranscriptEntry[];
}

export function TraceView({ entries }: TraceViewProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const events = useMemo(() => buildTraceFromTranscript(entries), [entries]);
  const metrics = useMemo(() => computeTraceMetrics(events), [events]);

  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(
      (ev) =>
        ev.name?.toLowerCase().includes(q) ||
        ev.text?.toLowerCase().includes(q) ||
        ev.argsSummary?.toLowerCase().includes(q) ||
        ev.result?.toLowerCase().includes(q)
    );
  }, [events, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scrollToEvent = (id: string) => {
    setHighlightedId(id);
    const node = itemRefs.current[id];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="trace-view-container">
      {/* 1. Header Stats Bar & Search */}
      <div className="trace-stats-bar">
        <div className="trace-stats-left">
          <div className="trace-stat-item">
            <span className="trace-stat-icon">⏱</span>
            <span className="trace-stat-label">Duration</span>
            <span className="trace-stat-value">
              {formatDuration(metrics.totalDurationMs)}
            </span>
          </div>
          <div className="trace-stat-item">
            <span className="trace-stat-icon">▤</span>
            <span className="trace-stat-label">Turns</span>
            <span className="trace-stat-value">{metrics.turnsCount}</span>
          </div>
          <div className="trace-stat-item">
            <span className="trace-stat-icon">🛠️</span>
            <span className="trace-stat-label">Calls</span>
            <span className="trace-stat-value">{metrics.toolCallsCount}</span>
          </div>
          {metrics.errorsCount > 0 && (
            <div className="trace-stat-item error">
              <span className="trace-stat-icon">⚠️</span>
              <span className="trace-stat-label">Errors</span>
              <span className="trace-stat-value">{metrics.errorsCount}</span>
            </div>
          )}
        </div>

        <div className="trace-search-wrap">
          <input
            type="text"
            className="trace-search-input"
            placeholder="搜索轨迹..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="trace-search-clear"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2. Multi-Track Waterfall Timeline Chart (Gantt lanes) */}
      <div className="trace-chart-card">
        <div className="trace-lanes">
          {/* Input Lane */}
          <div className="trace-lane">
            <span className="trace-lane-label">Input</span>
            <div className="trace-lane-track">
              {events.map((ev, i) =>
                ev.category === "input" ? (
                  <div
                    key={`chart-${ev.id}-${i}`}
                    className="trace-block block-input"
                    title={ev.text || "User input"}
                    onClick={() => scrollToEvent(ev.id)}
                  />
                ) : (
                  <div
                    key={`chart-gap-${i}`}
                    className="trace-block-placeholder"
                  />
                )
              )}
            </div>
          </div>

          {/* Model Lane */}
          <div className="trace-lane">
            <span className="trace-lane-label">Model</span>
            <div className="trace-lane-track">
              {events.map((ev, i) =>
                ev.category === "model" ? (
                  <div
                    key={`chart-${ev.id}-${i}`}
                    className="trace-block block-model"
                    title={ev.text || "Model inference"}
                    onClick={() => scrollToEvent(ev.id)}
                  />
                ) : (
                  <div
                    key={`chart-gap-${i}`}
                    className="trace-block-placeholder"
                  />
                )
              )}
            </div>
          </div>

          {/* Tools Lane */}
          <div className="trace-lane">
            <span className="trace-lane-label">Tools</span>
            <div className="trace-lane-track">
              {events.map((ev, i) =>
                ev.category === "tool" ? (
                  <div
                    key={`chart-${ev.id}-${i}`}
                    className={`trace-block block-tool ${
                      ev.isError ? "error" : ""
                    }`}
                    title={`${ev.name}: ${ev.argsSummary || ""}`}
                    onClick={() => scrollToEvent(ev.id)}
                  />
                ) : (
                  <div
                    key={`chart-gap-${i}`}
                    className="trace-block-placeholder"
                  />
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Execution Timeline Feed */}
      <div className="trace-feed-wrap">
        {filteredEvents.length === 0 ? (
          <div className="empty-hint" style={{ padding: "32px", textAlign: "center" }}>
            {searchQuery ? "无匹配的轨迹事件" : "暂无轨迹数据"}
          </div>
        ) : (
          <div className="trace-feed">
            {filteredEvents.map((ev) => {
              const isExpanded = expandedItems.has(ev.id);
              const isHighlighted = highlightedId === ev.id;
              const isAssistant = ev.role === "assistant";
              const isTool = ev.role === "tool";
              const isUser = ev.role === "user";

              return (
                <div
                  key={ev.id}
                  ref={(el) => {
                    itemRefs.current[ev.id] = el;
                  }}
                  className={`trace-row ${isHighlighted ? "highlighted" : ""}`}
                >
                  <div className="trace-rail">
                    <span
                      className={`trace-dot ${ev.isError ? "error" : ""} ${
                        isUser ? "user" : isTool ? "tool" : "assistant"
                      }`}
                    />
                    <div className="trace-rail-line" />
                  </div>

                  <div className="trace-item-body">
                    <div className="trace-item-head">
                      {isUser && <span className="trace-badge user">USER</span>}
                      {isAssistant && (
                        <span className="trace-badge assistant">ASSISTANT</span>
                      )}
                      {isTool && (
                        <span
                          className={`trace-badge tool ${
                            ev.isError ? "error" : ""
                          }`}
                        >
                          TOOL
                        </span>
                      )}
                      {ev.role === "system" && (
                        <span className="trace-badge system">SYSTEM</span>
                      )}

                      {/* Tool name & arguments / Response summary */}
                      <div className="trace-summary-row">
                        {isTool && (
                          <span className="trace-tool-name">{ev.name}</span>
                        )}
                        {ev.argsSummary && (
                          <span
                            className="trace-args-preview"
                            title={ev.argsSummary}
                          >
                            {ev.argsSummary}
                          </span>
                        )}
                        {ev.result && (
                          <span
                            className={`trace-result-preview ${
                              ev.isError ? "error" : ""
                            }`}
                          >
                            → {ev.result}
                          </span>
                        )}
                        {!isTool && ev.text && (
                          <span className="trace-text-preview">{ev.text}</span>
                        )}
                      </div>

                      {(ev.args || ev.result || ev.thinking) && (
                        <button
                          type="button"
                          className="trace-toggle-btn"
                          onClick={() => toggleExpand(ev.id)}
                        >
                          {isExpanded ? "收起" : "详情"}
                        </button>
                      )}
                    </div>

                    {/* Expandable Details Pane */}
                    {isExpanded && (
                      <div className="trace-expanded-details">
                        {ev.thinking && (
                          <div className="trace-detail-block">
                            <div className="trace-detail-title">Thinking</div>
                            <pre className="trace-detail-code">
                              {ev.thinking}
                            </pre>
                          </div>
                        )}
                        {ev.args && (
                          <div className="trace-detail-block">
                            <div className="trace-detail-title">Arguments</div>
                            <pre className="trace-detail-code">
                              {JSON.stringify(ev.args, null, 2)}
                            </pre>
                          </div>
                        )}
                        {ev.result && (
                          <div className="trace-detail-block">
                            <div
                              className={`trace-detail-title ${
                                ev.isError ? "error" : ""
                              }`}
                            >
                              Result {ev.isError ? "(Error)" : ""}
                            </div>
                            <pre
                              className={`trace-detail-code ${
                                ev.isError ? "error" : ""
                              }`}
                            >
                              {ev.result}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
