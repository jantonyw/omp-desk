import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "../client";

interface FsEntry {
  name: string;
  path: string;
  kind: "file" | "dir";
  children?: FsEntry[];
}

interface FsListResult {
  root: string;
  entries: FsEntry[];
  truncated: boolean;
}

interface GitFile {
  xy: string;
  path: string;
}

interface GitStatusResult {
  branch: string;
  ahead: number | null;
  behind: number | null;
  files: GitFile[];
}

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

interface GitDiffResult {
  path: string;
  unstaged: string;
  staged: string;
  untracked: string;
}

type ViewId = "explorer" | "scm" | "browser";

interface IdeSidePanelProps {
  sideOpen: boolean;
  activeView: ViewId;
  workspaceRoot: string;
  onSelectView: (view: ViewId) => void;
  onToggleSide: () => void;
  onInsertFileReference?: (path: string) => void;
}

export function IdeSidePanel({
  sideOpen,
  activeView,
  workspaceRoot,
  onSelectView,
  onToggleSide,
  onInsertFileReference,
}: IdeSidePanelProps): React.ReactElement {
  // Explorer state
  const [tree, setTree] = useState<FsEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [explorerRoot, setExplorerRoot] = useState<string>("");
  const [explorerStatus, setExplorerStatus] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [editorStatus, setEditorStatus] = useState<string | null>(null);

  // SCM state
  const [scmBranch, setScmBranch] = useState<string>("");
  const [scmFiles, setScmFiles] = useState<GitFile[]>([]);
  const [scmCommits, setScmCommits] = useState<GitCommit[]>([]);
  const [selectedScmFile, setSelectedScmFile] = useState<GitFile | null>(null);
  const [scmDiffText, setScmDiffText] = useState<string>("");
  const [scmMessage, setScmMessage] = useState<string>("");
  const [scmOutput, setScmOutput] = useState<{ text: string; kind: "ok" | "error" | null }>({
    text: "",
    kind: null,
  });

  // Browser state
  const [browserUrl, setBrowserUrl] = useState<string>("http://localhost:5173");
  const [browserFrameSrc, setBrowserFrameSrc] = useState<string>("");
  const [browserBlocked, setBrowserBlocked] = useState<string | null>(null);

  const isDirty = openFile !== null && editorContent !== savedContent;

  const refreshExplorer = useCallback(async () => {
    setExplorerStatus(null);
    try {
      const res = (await invoke("fs_list", { root: workspaceRoot })) as FsListResult;
      setTree(res.entries || []);
      setExplorerRoot(res.root || "");
      if (res.truncated) {
        setExplorerStatus("… too many entries, open a subfolder");
      }
    } catch (err) {
      setTree([]);
      setExplorerStatus(String(err));
    }
  }, [workspaceRoot]);

  const refreshScm = useCallback(async () => {
    try {
      const res = (await invoke("git_status", { root: workspaceRoot })) as GitStatusResult;
      let branchLabel = res.branch || "(detached)";
      if (res.ahead) branchLabel += ` ↑${res.ahead}`;
      if (res.behind) branchLabel += ` ↓${res.behind}`;
      setScmBranch(branchLabel);
      setScmFiles(res.files || []);

      const logs = (await invoke("git_log", { root: workspaceRoot })) as GitCommit[];
      setScmCommits(logs || []);
    } catch (err) {
      setScmBranch("");
      setScmFiles([]);
      setScmCommits([]);
      setScmOutput({ text: String(err), kind: "error" });
    }
  }, [workspaceRoot]);

  useEffect(() => {
    if (sideOpen) {
      if (activeView === "explorer") void refreshExplorer();
      if (activeView === "scm") void refreshScm();
    }
  }, [sideOpen, activeView, refreshExplorer, refreshScm]);

  const handleAbClick = (view: ViewId) => {
    if (view === activeView) {
      onToggleSide();
    } else {
      onSelectView(view);
      if (!sideOpen) onToggleSide();
    }
  };

  const handleOpenFile = async (path: string) => {
    setEditorStatus(null);
    try {
      const res = (await invoke("fs_read", { root: workspaceRoot, path })) as {
        path: string;
        content: string;
      };
      setOpenFile(path);
      setSavedContent(res.content);
      setEditorContent(res.content);
    } catch (err) {
      setEditorStatus(String(err));
    }
  };

  const handleSaveFile = async () => {
    if (!openFile) return;
    setEditorStatus(null);
    try {
      await invoke("fs_write", {
        root: workspaceRoot,
        path: openFile,
        content: editorContent,
      });
      setSavedContent(editorContent);
    } catch (err) {
      setEditorStatus(String(err));
    }
  };

  const handleToggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSelectScm = async (f: GitFile) => {
    setSelectedScmFile(f);
    try {
      const res = (await invoke("git_diff", {
        root: workspaceRoot,
        path: f.path,
      })) as GitDiffResult;
      const combined = [
        res.unstaged && `--- unstaged ---\n${res.unstaged}`,
        res.staged && `--- staged ---\n${res.staged}`,
        res.untracked && `--- untracked ---\n${res.untracked}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      setScmDiffText(combined || "(no diff)");
    } catch (err) {
      setScmDiffText(String(err));
    }
  };

  const handleScmAction = async (
    label: string,
    action: () => Promise<unknown>
  ) => {
    setScmOutput({ text: `${label}…`, kind: null });
    try {
      await action();
      setScmOutput({ text: `${label}: ok`, kind: "ok" });
      await refreshScm();
      if (selectedScmFile) await handleSelectScm(selectedScmFile);
    } catch (err) {
      setScmOutput({ text: `${label}: ${String(err)}`, kind: "error" });
    }
  };

  const handleCommit = async () => {
    if (!scmMessage.trim()) return;
    await handleScmAction("commit", async () => {
      await invoke("git_commit", {
        root: workspaceRoot,
        message: scmMessage.trim(),
      });
      setScmMessage("");
    });
  };

  const renderFsEntries = (entries: FsEntry[]): React.ReactNode => {
    return entries.map((entry) => {
      const isDir = entry.kind === "dir";
      const expanded = expandedDirs.has(entry.path);
      const isCurrentOpen = openFile === entry.path;

      if (isDir) {
        return (
          <li key={entry.path} role="treeitem" aria-expanded={expanded}>
            <button
              type="button"
              className={`tree-row dir ${expanded ? "open" : ""}`}
              title={entry.path}
              onClick={() => handleToggleDir(entry.path)}
            >
              <span className="tree-icon" aria-hidden="true">
                {expanded ? "▾" : "▸"}
              </span>
              <span className="tree-label">{entry.name}</span>
            </button>
            {expanded && entry.children && (
              <ul className="file-tree-sub" role="group">
                {renderFsEntries(entry.children)}
              </ul>
            )}
          </li>
        );
      }

      return (
        <li key={entry.path} role="treeitem">
          <button
            type="button"
            className={`tree-row file ${isCurrentOpen ? "open" : ""}`}
            title={entry.path}
            onClick={() => void handleOpenFile(entry.path)}
          >
            <span className="tree-icon" aria-hidden="true">
              ·
            </span>
            <span className="tree-label">{entry.name}</span>
          </button>
        </li>
      );
    });
  };

  return (
    <>
      <nav id="activity-bar" aria-label="Views">
        <button
          type="button"
          className={`ab-btn ${activeView === "explorer" ? "active" : ""}`}
          data-view="explorer"
          title="Explorer"
          aria-label="Explorer"
          aria-pressed={activeView === "explorer"}
          onClick={() => handleAbClick("explorer")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <path
              d="M7 2 3 6v8h4V2ZM9 2v12h4V4l-2-2H9Z"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className={`ab-btn ${activeView === "scm" ? "active" : ""}`}
          data-view="scm"
          title="Source Control"
          aria-label="Source Control"
          aria-pressed={activeView === "scm"}
          onClick={() => handleAbClick("scm")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <path
              d="M10.5 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-6 5a2 2 0 1 0 .001 4.001A2 2 0 0 0 4.5 9.5Zm1.5-3.2a1.8 1.8 0 0 1 0 3.4M6 6.3a1.8 1.8 0 0 0 0-3.4"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
            <circle
              cx="4.5"
              cy="4.5"
              r="1.6"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
        <button
          type="button"
          className={`ab-btn ${activeView === "browser" ? "active" : ""}`}
          data-view="browser"
          title="Browser"
          aria-label="Browser"
          aria-pressed={activeView === "browser"}
          onClick={() => handleAbClick("browser")}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="1.25"
            />
            <path
              d="M2.5 8h11M8 2c-2 2-2.6 3.8-2.6 6S6 12 8 14c2-2 2.6-3.8 2.6-6S10 2 8 2Z"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
      </nav>

      <aside id="pane-side" aria-label="Side panel">
        {/* Explorer View */}
        <section
          id="view-explorer"
          className={`side-view ${activeView === "explorer" ? "" : "hidden"}`}
          aria-label="Explorer"
        >
          <div className="side-head">
            <span className="pane-title">Explorer</span>
            <button
              id="explorer-refresh"
              type="button"
              className="linkish"
              title="Refresh"
              onClick={refreshExplorer}
            >
              Refresh
            </button>
          </div>
          <div id="explorer-root" className="side-meta" title={explorerRoot}>
            {explorerRoot}
          </div>
          <div
            id="explorer-status"
            className={`side-note ${explorerStatus ? "error" : ""}`}
          >
            {explorerStatus}
          </div>
          <ul id="file-tree" className="file-tree" role="tree" aria-label="Files">
            {renderFsEntries(tree)}
          </ul>
          <div className="editor-pane">
            <div className="editor-head">
              <span id="editor-filename" className="editor-filename" title={openFile || ""}>
                {openFile ? openFile.split(/[/\\]/).pop() : ""}
              </span>
              <span
                id="editor-dirty"
                className="editor-dirty"
                title="Unsaved changes"
                hidden={!isDirty}
              >
                *
              </span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {openFile && onInsertFileReference && (
                  <button
                    type="button"
                    className="linkish"
                    title="Insert @file into chat composer"
                    onClick={() => onInsertFileReference(openFile)}
                  >
                    + 引用到对话
                  </button>
                )}
                <button
                  id="editor-save"
                  type="button"
                  className="linkish"
                  disabled={!isDirty}
                  onClick={handleSaveFile}
                >
                  Save
                </button>
              </div>
            </div>
            <textarea
              id="editor"
              className="editor"
              spellCheck={false}
              placeholder="Select a file to edit"
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
            />
            <div
              id="editor-status"
              className={`side-note ${editorStatus ? "error" : ""}`}
            >
              {editorStatus}
            </div>
          </div>
        </section>

        {/* Source Control View */}
        <section
          id="view-scm"
          className={`side-view ${activeView === "scm" ? "" : "hidden"}`}
          aria-label="Source Control"
        >
          <div className="side-head">
            <span className="pane-title">Source Control</span>
            <button
              id="scm-refresh"
              type="button"
              className="linkish"
              title="Refresh"
              onClick={refreshScm}
            >
              Refresh
            </button>
          </div>
          <div id="scm-branch" className="scm-branch">
            {scmBranch}
          </div>
          <ul id="scm-files" className="scm-files" role="list">
            {scmFiles.map((f) => (
              <li
                key={f.path}
                className={`scm-file ${
                  selectedScmFile?.path === f.path ? "selected" : ""
                }`}
                onClick={() => void handleSelectScm(f)}
              >
                <span className="scm-badge" data-xy={f.xy}>
                  {f.xy}
                </span>
                <span className="scm-path" title={f.path}>
                  {f.path}
                </span>
              </li>
            ))}
          </ul>
          <div className="scm-actions">
            <button
              id="scm-stage"
              type="button"
              disabled={!selectedScmFile}
              onClick={() =>
                selectedScmFile &&
                handleScmAction("stage", () =>
                  invoke("git_stage", {
                    root: workspaceRoot,
                    path: selectedScmFile.path,
                  })
                )
              }
            >
              Stage
            </button>
            <button
              id="scm-unstage"
              type="button"
              disabled={!selectedScmFile}
              onClick={() =>
                selectedScmFile &&
                handleScmAction("unstage", () =>
                  invoke("git_unstage", {
                    root: workspaceRoot,
                    path: selectedScmFile.path,
                  })
                )
              }
            >
              Unstage
            </button>
            <button
              id="scm-discard"
              type="button"
              className="danger"
              disabled={!selectedScmFile}
              onClick={() =>
                selectedScmFile &&
                handleScmAction("discard", () =>
                  invoke("git_discard", {
                    root: workspaceRoot,
                    path: selectedScmFile.path,
                    untracked: selectedScmFile.xy === "??",
                  })
                )
              }
            >
              Discard
            </button>
          </div>
          <pre id="scm-diff" className="scm-diff">
            {scmDiffText}
          </pre>
          <div className="scm-commit">
            <textarea
              id="scm-message"
              rows={2}
              spellCheck={false}
              placeholder="Commit message"
              value={scmMessage}
              onChange={(e) => setScmMessage(e.target.value)}
            />
            <button
              id="scm-commit"
              type="button"
              disabled={!scmMessage.trim()}
              onClick={handleCommit}
            >
              Commit
            </button>
          </div>
          <div className="scm-remote">
            <button
              id="scm-fetch"
              type="button"
              onClick={() =>
                handleScmAction("fetch", () =>
                  invoke("git_fetch", { root: workspaceRoot })
                )
              }
            >
              Fetch
            </button>
            <button
              id="scm-pull"
              type="button"
              onClick={() =>
                handleScmAction("pull", () =>
                  invoke("git_pull", { root: workspaceRoot })
                )
              }
            >
              Pull
            </button>
            <button
              id="scm-push"
              type="button"
              onClick={() =>
                handleScmAction("push", () =>
                  invoke("git_push", { root: workspaceRoot })
                )
              }
            >
              Push
            </button>
          </div>
          <div
            id="scm-output"
            className={`scm-output ${scmOutput.kind ?? ""}`}
            role="status"
          >
            {scmOutput.text}
          </div>
          <div className="scm-log-head">Recent commits</div>
          <ul id="scm-log" className="scm-log" role="list">
            {scmCommits.map((c) => (
              <li key={c.hash} className="scm-commit-row">
                <span className="scm-commit-hash">{c.hash.slice(0, 7)}</span>
                <span className="scm-commit-subject" title={c.subject}>
                  {c.subject}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Browser View */}
        <section
          id="view-browser"
          className={`side-view ${activeView === "browser" ? "" : "hidden"}`}
          aria-label="Browser"
        >
          <div className="browser-bar">
            <input
              id="browser-url"
              type="text"
              spellCheck={false}
              placeholder="https://…"
              aria-label="URL"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setBrowserFrameSrc(browserUrl);
              }}
            />
            <button
              id="browser-go"
              type="button"
              onClick={() => setBrowserFrameSrc(browserUrl)}
            >
              Go
            </button>
            <button
              id="browser-back"
              type="button"
              title="Back"
              aria-label="Back"
              disabled
            >
              ←
            </button>
          </div>
          <div className="browser-actions">
            <button
              id="browser-open-external"
              type="button"
              className="linkish"
              onClick={() => {
                if (browserUrl) {
                  openUrl(browserUrl).catch((err) =>
                    setBrowserBlocked(String(err))
                  );
                }
              }}
            >
              Open in system browser
            </button>
          </div>
          <iframe
            id="browser-frame"
            className="browser-frame"
            title="Browser"
            src={browserFrameSrc || "about:blank"}
          />
          <div
            id="browser-blocked"
            className="side-note"
            hidden={!browserBlocked}
          >
            {browserBlocked ||
              "This site may block in-app embedding. Use “Open in system browser”."}
          </div>
        </section>
      </aside>
    </>
  );
}
