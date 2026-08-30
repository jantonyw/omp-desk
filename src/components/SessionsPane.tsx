import React, { useState, useMemo } from "react";
import type { Status, WorkspaceGroup, SessionHistoryEntry } from "../client";
import type { RpcAvailableSlashCommand } from "../protocol";
import { AgentCollection } from "./AgentCollection";

interface SessionsPaneProps {
  status: Status;
  cwd: string;
  activeSessionId?: string;
  workspaceGroups: WorkspaceGroup[];
  onNewSession: () => void;
  onSelectSession: (session: SessionHistoryEntry) => void;
  onRefreshWorkspaces: () => void;
  onOpenSettings: () => void;
  onAddWorkspace: () => void;
  onInsertAgentSpawn: (text: string) => void;
  onInsertAgentSlash: (cmd: RpcAvailableSlashCommand) => void;
}

function formatRelativeDays(timestamp: string | number): string {
  if (!timestamp) return "";
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);
    if (diffSec < 60) return "刚刚";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时`;
    const days = Math.floor(diffSec / 86400);
    return `${days}天`;
  } catch {
    return "";
  }
}

export function SessionsPane({
  cwd,
  activeSessionId,
  workspaceGroups,
  onNewSession,
  onSelectSession,
  onRefreshWorkspaces,
  onOpenSettings,
  onAddWorkspace,
  onInsertAgentSpawn,
  onInsertAgentSlash,
}: SessionsPaneProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedSessionsMap, setExpandedSessionsMap] = useState<Record<string, boolean>>({});

  // Determine current active group by matching cwd
  const activeGroup = useMemo(() => {
    return workspaceGroups.find(
      (g) => g.path === cwd || cwd.startsWith(g.path) || g.path.startsWith(cwd)
    );
  }, [workspaceGroups, cwd]);

  // Filter groups and sessions based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return workspaceGroups;
    const q = searchQuery.toLowerCase();
    return workspaceGroups
      .map((g) => {
        const matchesGroupName = g.name.toLowerCase().includes(q);
        const filteredSessions = g.sessions.filter((s) =>
          s.title.toLowerCase().includes(q)
        );
        if (matchesGroupName || filteredSessions.length > 0) {
          return {
            ...g,
            sessions: matchesGroupName ? g.sessions : filteredSessions,
          };
        }
        return null;
      })
      .filter((g): g is WorkspaceGroup => g !== null);
  }, [workspaceGroups, searchQuery]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleExpandSessions = (groupId: string) => {
    setExpandedSessionsMap((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  return (
    <aside id="pane-sessions" aria-label="Sessions">
      <div className="workspace-sidebar">
        {/* Top Global New Chat Button (DeepSeek-Harness / Pi layout) */}
        <button
          type="button"
          className="workspace-top-new-chat"
          onClick={onNewSession}
        >
          <span className="workspace-top-icon">⊕</span>
          <span>新会话</span>
        </button>

        {/* Search Bar */}
        <div className="workspace-search-wrap">
          <span className="workspace-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="text"
            className="workspace-search-input"
            placeholder="搜索会话..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Workspace Header */}
        <div className="workspace-header">
          <div className="workspace-header-title">工作区</div>
          <div className="workspace-header-actions">
            <button
              type="button"
              className="workspace-action-icon"
              title="刷新工作区"
              onClick={onRefreshWorkspaces}
            >
              ↻
            </button>
            <button
              type="button"
              className="workspace-action-icon"
              title="添加工作区..."
              onClick={onAddWorkspace}
            >
              +
            </button>
          </div>
        </div>

        {/* Workspace Groups Accordion */}
        <ul className="workspace-tree">
          {filteredGroups.length === 0 ? (
            <li className="empty-hint">暂无工作区记录</li>
          ) : (
            filteredGroups.map((group) => {
              const isCurrentActive = activeGroup?.id === group.id;
              // Group defaults to open if it's active or manually expanded, or when searching
              const isOpen =
                searchQuery.trim() !== "" ||
                isCurrentActive ||
                expandedGroups.has(group.id);
              const isShowingAll = Boolean(expandedSessionsMap[group.id]);
              const visibleSessions = isShowingAll
                ? group.sessions
                : group.sessions.slice(0, 4);
              const remainingCount = group.sessions.length - visibleSessions.length;

              return (
                <li key={group.id} className="workspace-group">
                  {/* Clicking folder header ONLY toggles collapse/expand! Never resets session */}
                  <div
                    className={`workspace-group-header ${
                      isCurrentActive ? "active" : ""
                    }`}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="workspace-folder-icon" aria-hidden="true">
                      {isOpen ? "📂" : "📁"}
                    </span>
                    <span className="workspace-group-name" title={group.path}>
                      {group.name}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="workspace-sessions-list">
                      {group.sessions.length === 0 ? (
                        <div className="empty-hint" style={{ padding: "4px 8px" }}>
                          暂无会话
                        </div>
                      ) : (
                        visibleSessions.map((s) => {
                          const isActiveSession = activeSessionId === s.id;
                          const relativeTime = formatRelativeDays(
                            s.timestamp || s.modified * 1000
                          );
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`workspace-session-row ${
                                isActiveSession ? "active" : ""
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectSession(s);
                              }}
                            >
                              <span
                                className="workspace-session-title"
                                title={s.title}
                              >
                                {s.title}
                              </span>
                              {relativeTime && (
                                <span className="workspace-session-time">
                                  {relativeTime}
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}

                      {remainingCount > 0 && !isShowingAll && (
                        <button
                          type="button"
                          className="workspace-expand-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpandSessions(group.id);
                          }}
                        >
                          展开其余 {remainingCount} 个会话
                        </button>
                      )}

                      {isShowingAll && group.sessions.length > 4 && (
                        <button
                          type="button"
                          className="workspace-expand-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpandSessions(group.id);
                          }}
                        >
                          收起会话
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* Agent Collection */}
        <AgentCollection
          onInsertSpawn={onInsertAgentSpawn}
          onInsertSlash={onInsertAgentSlash}
        />

        {/* Bottom Settings Button */}
        <div className="workspace-bottom-settings">
          <button
            type="button"
            className="workspace-settings-btn"
            onClick={onOpenSettings}
          >
            <span aria-hidden="true">⚙</span>
            <span>设置</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
