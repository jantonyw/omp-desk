//! IDE sidebar logic: activity bar + Explorer (file tree & editor), Source
//! Control (git panel), and the in-app Browser. All heavy lifting is
//! host-side — the fs_* / git_* Tauri commands in src-tauri/src/ide.rs — and
//! this module only renders and dispatches. omp RPC and client.ts stay
//! untouched.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "./client";

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
const VIEWS: ViewId[] = ["explorer", "scm", "browser"];

// --- Command wrappers (fs_* / git_* are defined in src-tauri/src/ide.rs) ---

function fsList(root: string): Promise<FsListResult> {
  return invoke("fs_list", { root });
}

function fsRead(root: string, path: string): Promise<{ path: string; content: string }> {
  return invoke("fs_read", { root, path });
}

function fsWrite(root: string, path: string, content: string): Promise<{ ok: boolean }> {
  return invoke("fs_write", { root, path, content });
}

function gitStatusCmd(root: string): Promise<GitStatusResult> {
  return invoke("git_status", { root });
}

function gitDiffCmd(root: string, path: string): Promise<GitDiffResult> {
  return invoke("git_diff", { root, path });
}

function gitStageCmd(root: string, path: string): Promise<{ ok: boolean }> {
  return invoke("git_stage", { root, path });
}

function gitUnstageCmd(root: string, path: string): Promise<{ ok: boolean }> {
  return invoke("git_unstage", { root, path });
}

function gitDiscardCmd(root: string, path: string, untracked: boolean): Promise<{ ok: boolean }> {
  return invoke("git_discard", { root, path, untracked });
}

function gitCommitCmd(root: string, message: string): Promise<{ ok: boolean }> {
  return invoke("git_commit", { root, message });
}

function gitFetchCmd(root: string): Promise<{ ok: boolean }> {
  return invoke("git_fetch", { root });
}

function gitPullCmd(root: string): Promise<{ ok: boolean }> {
  return invoke("git_pull", { root });
}

function gitPushCmd(root: string): Promise<{ ok: boolean }> {
  return invoke("git_push", { root });
}

function gitLogCmd(root: string): Promise<GitCommit[]> {
  return invoke("git_log", { root });
}

// --- Elements ---------------------------------------------------------------

const studioEl = document.getElementById("studio") as HTMLElement;
const abButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#activity-bar .ab-btn"),
);
const viewEls: Record<ViewId, HTMLElement> = {
  explorer: document.getElementById("view-explorer") as HTMLElement,
  scm: document.getElementById("view-scm") as HTMLElement,
  browser: document.getElementById("view-browser") as HTMLElement,
};

// Explorer
const explorerRefreshBtn = document.getElementById("explorer-refresh") as HTMLButtonElement;
const explorerRootEl = document.getElementById("explorer-root") as HTMLElement;
const explorerStatusEl = document.getElementById("explorer-status") as HTMLElement;
const fileTreeEl = document.getElementById("file-tree") as HTMLUListElement;
const editorFilenameEl = document.getElementById("editor-filename") as HTMLElement;
const editorDirtyEl = document.getElementById("editor-dirty") as HTMLElement;
const editorSaveBtn = document.getElementById("editor-save") as HTMLButtonElement;
const editorEl = document.getElementById("editor") as HTMLTextAreaElement;
const editorStatusEl = document.getElementById("editor-status") as HTMLElement;

// Source Control
const scmRefreshBtn = document.getElementById("scm-refresh") as HTMLButtonElement;
const scmBranchEl = document.getElementById("scm-branch") as HTMLElement;
const scmFilesEl = document.getElementById("scm-files") as HTMLUListElement;
const scmStageBtn = document.getElementById("scm-stage") as HTMLButtonElement;
const scmUnstageBtn = document.getElementById("scm-unstage") as HTMLButtonElement;
const scmDiscardBtn = document.getElementById("scm-discard") as HTMLButtonElement;
const scmDiffEl = document.getElementById("scm-diff") as HTMLPreElement;
const scmMessageEl = document.getElementById("scm-message") as HTMLTextAreaElement;
const scmCommitBtn = document.getElementById("scm-commit") as HTMLButtonElement;
const scmFetchBtn = document.getElementById("scm-fetch") as HTMLButtonElement;
const scmPullBtn = document.getElementById("scm-pull") as HTMLButtonElement;
const scmPushBtn = document.getElementById("scm-push") as HTMLButtonElement;
const scmOutputEl = document.getElementById("scm-output") as HTMLElement;
const scmLogEl = document.getElementById("scm-log") as HTMLUListElement;

// Browser
const browserUrlInput = document.getElementById("browser-url") as HTMLInputElement;
const browserGoBtn = document.getElementById("browser-go") as HTMLButtonElement;
const browserBackBtn = document.getElementById("browser-back") as HTMLButtonElement;
const browserOpenExternalBtn = document.getElementById(
  "browser-open-external",
) as HTMLButtonElement;
const browserFrameEl = document.getElementById("browser-frame") as HTMLIFrameElement;
const browserBlockedEl = document.getElementById("browser-blocked") as HTMLElement;

// --- State ------------------------------------------------------------------

/** Provider of the workspace root (Settings #cwd, set by main.ts). */
let getRoot: () => string = () => "";

let currentView: ViewId = "explorer";
let sideOpen = true;

// Explorer
let tree: FsEntry[] = [];
const expandedDirs = new Set<string>();
let openFile: string | null = null;
let savedContent = "";

// Source Control
let scmFiles: GitFile[] = [];
let scmSelected: { path: string; untracked: boolean } | null = null;

// Browser
const BLOCKED_NOTE =
  "This site may block in-app embedding. Use “Open in system browser”.";
let browserUrl = "";
const browserStack: string[] = [];
let browserPos = -1;
let blockedTimer: number | undefined;

// --- Small helpers ----------------------------------------------------------

function setNote(el: HTMLElement, msg: string | null): void {
  el.textContent = msg ?? "";
  el.classList.toggle("error", Boolean(msg));
}

// --- Activity bar -----------------------------------------------------------

function setView(view: ViewId): void {
  currentView = view;
  for (const btn of abButtons) {
    const active = btn.dataset.view === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
  for (const v of VIEWS) {
    viewEls[v].classList.toggle("hidden", v !== view);
  }
  if (view === "explorer") void refreshExplorer();
  if (view === "scm") void refreshScm();
}

function toggleSide(): void {
  sideOpen = !sideOpen;
  studioEl.classList.toggle("side-closed", !sideOpen);
}

function onAbButtonClick(btn: HTMLButtonElement): void {
  const view = btn.dataset.view as ViewId;
  if (view === currentView) {
    toggleSide();
  } else {
    setView(view);
    if (!sideOpen) toggleSide();
  }
}

// --- Explorer: file tree ----------------------------------------------------

async function refreshExplorer(): Promise<void> {
  setNote(explorerStatusEl, null);
  explorerRootEl.textContent = "";
  explorerRootEl.title = "";
  try {
    const res = await fsList(getRoot());
    tree = res.entries;
    explorerRootEl.textContent = res.root;
    explorerRootEl.title = res.root;
    if (res.truncated) {
      explorerStatusEl.textContent = "… too many entries, open a subfolder";
    }
  } catch (err) {
    tree = [];
    setNote(explorerStatusEl, String(err));
  }
  renderTree();
}

function renderTree(): void {
  fileTreeEl.textContent = "";
  fileTreeEl.append(...renderEntries(tree));
}

function renderEntries(entries: FsEntry[]): HTMLElement[] {
  return entries.map((entry) => {
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tree-row";
    row.title = entry.path;
    if (entry.kind === "dir") row.classList.add("dir");
    if (openFile === entry.path) row.classList.add("selected");

    const chev = document.createElement("span");
    chev.className = "tree-chev";
    chev.textContent = entry.kind === "dir" ? "▸" : "";
    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;
    row.append(chev, name);
    li.append(row);

    if (entry.kind === "dir") {
      const children = entry.children ?? [];
      const expanded = expandedDirs.has(entry.path);
      row.classList.toggle("open", expanded);
      if (expanded) li.append(renderList(children));
      row.addEventListener("click", () => {
        if (expandedDirs.has(entry.path)) {
          expandedDirs.delete(entry.path);
          row.classList.remove("open");
          const ul = li.querySelector(":scope > ul");
          if (ul) ul.remove();
        } else {
          expandedDirs.add(entry.path);
          row.classList.add("open");
          li.append(renderList(children));
        }
      });
    } else {
      row.addEventListener("click", () => void openEditorFile(entry.path));
    }
    return li;
  });
}

function renderList(entries: FsEntry[]): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.setAttribute("role", "group");
  ul.append(...renderEntries(entries));
  return ul;
}

// --- Explorer: editor -------------------------------------------------------

async function openEditorFile(path: string): Promise<void> {
  openFile = path;
  renderTree();
  editorFilenameEl.textContent = path;
  editorStatusEl.textContent = "";
  editorEl.value = "";
  editorEl.disabled = true;
  savedContent = "";
  updateDirty();
  try {
    const res = await fsRead(getRoot(), path);
    editorEl.value = res.content;
    savedContent = res.content;
    editorEl.disabled = false;
    editorEl.focus();
  } catch (err) {
    setNote(editorStatusEl, String(err));
  }
  updateDirty();
}

function updateDirty(): void {
  const dirty = !editorEl.disabled && editorEl.value !== savedContent;
  editorDirtyEl.hidden = !dirty;
  editorSaveBtn.disabled = !dirty;
}

async function saveFile(): Promise<void> {
  if (!openFile || editorEl.disabled) return;
  try {
    await fsWrite(getRoot(), openFile, editorEl.value);
    savedContent = editorEl.value;
    updateDirty();
    editorStatusEl.textContent = "saved";
  } catch (err) {
    setNote(editorStatusEl, String(err));
  }
}

// --- Source Control ---------------------------------------------------------

function xyBadge(xy: string): string {
  if (xy === "??") return "?";
  return xy[0] !== " " ? xy[0] : xy[1];
}

function isUntracked(xy: string): boolean {
  return xy === "??";
}

async function refreshScm(): Promise<void> {
  scmBranchEl.textContent = "";
  scmFiles = [];
  scmSelected = null;
  scmDiffEl.textContent = "";
  renderScmFiles();
  try {
    const st = await gitStatusCmd(getRoot());
    let label = st.branch;
    if (st.ahead != null || st.behind != null) {
      const parts: string[] = [];
      if (st.ahead != null) parts.push(`↑${st.ahead}`);
      if (st.behind != null) parts.push(`↓${st.behind}`);
      label += ` · ${parts.join(" ")}`;
    }
    scmBranchEl.textContent = label;
    scmFiles = st.files;
    renderScmFiles();
  } catch (err) {
    setScmOutput(String(err), "error");
  }
  await refreshScmLog();
}

function renderScmFiles(): void {
  scmFilesEl.textContent = "";
  if (scmFiles.length === 0) {
    const li = document.createElement("li");
    li.className = "scm-empty";
    li.textContent = "working tree clean";
    scmFilesEl.append(li);
  }
  for (const f of scmFiles) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scm-file";
    if (scmSelected?.path === f.path) btn.classList.add("selected");
    btn.title = f.path;
    const badge = document.createElement("span");
    badge.className = "scm-badge";
    const b = xyBadge(f.xy);
    badge.dataset.badge = b;
    badge.textContent = b;
    const p = document.createElement("span");
    p.className = "scm-file-path";
    p.textContent = f.path;
    btn.append(badge, p);
    btn.addEventListener("click", () => void selectScmFile(f));
    li.append(btn);
    scmFilesEl.append(li);
  }
  const has = scmSelected != null;
  scmStageBtn.disabled = !has;
  scmUnstageBtn.disabled = !has;
  scmDiscardBtn.disabled = !has;
}

async function selectScmFile(f: GitFile): Promise<void> {
  scmSelected = { path: f.path, untracked: isUntracked(f.xy) };
  renderScmFiles();
  scmDiffEl.textContent = "loading diff…";
  try {
    const d = await gitDiffCmd(getRoot(), f.path);
    const parts = [d.staged, d.unstaged, d.untracked].filter((s) => s.length > 0);
    scmDiffEl.textContent = parts.join("\n") || "(no diff)";
  } catch (err) {
    scmDiffEl.textContent = `diff failed: ${String(err)}`;
  }
}

function setScmOutput(text: string, kind: "ok" | "error" | null): void {
  scmOutputEl.textContent = text;
  scmOutputEl.classList.toggle("ok", kind === "ok");
  scmOutputEl.classList.toggle("error", kind === "error");
}

/** Run a git action on the selected file, then refresh status + diff. */
async function scmFileAction(label: string, fn: () => Promise<unknown>): Promise<void> {
  const sel = scmSelected;
  if (!sel) return;
  try {
    await fn();
    setScmOutput(`${label.toLowerCase()} ok: ${sel.path}`, "ok");
    await refreshScm();
    const still = scmFiles.find((f) => f.path === sel.path);
    if (still) await selectScmFile(still);
  } catch (err) {
    setScmOutput(String(err), "error");
  }
}

async function scmRemoteAction(label: string, fn: () => Promise<unknown>): Promise<void> {
  setScmOutput(`${label}…`, null);
  try {
    await fn();
    setScmOutput(`${label} ok`, "ok");
    await refreshScm();
  } catch (err) {
    setScmOutput(String(err), "error");
  }
}

async function refreshScmLog(): Promise<void> {
  scmLogEl.textContent = "";
  try {
    const commits = await gitLogCmd(getRoot());
    if (commits.length === 0) {
      const li = document.createElement("li");
      li.className = "scm-empty";
      li.textContent = "no commits yet";
      scmLogEl.append(li);
      return;
    }
    for (const c of commits) {
      const li = document.createElement("li");
      li.title = `${c.hash} ${c.author} ${c.date} — ${c.subject}`;
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = c.hash;
      li.append(hash, document.createTextNode(c.subject));
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = ` · ${c.author} · ${c.date}`;
      li.append(meta);
      scmLogEl.append(li);
    }
  } catch (err) {
    const li = document.createElement("li");
    li.className = "scm-empty";
    li.textContent = String(err);
    scmLogEl.append(li);
  }
}

// --- Browser ----------------------------------------------------------------

function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function startBlockedTimer(): void {
  browserBlockedEl.textContent = BLOCKED_NOTE;
  browserBlockedEl.hidden = true;
  if (blockedTimer !== undefined) window.clearTimeout(blockedTimer);
  blockedTimer = window.setTimeout(() => {
    browserBlockedEl.hidden = false;
  }, 8000);
}

function navigateBrowser(raw: string): void {
  const target = normalizeUrl(raw);
  if (!target) return;
  browserUrl = target;
  browserUrlInput.value = target;
  browserFrameEl.src = target;
  browserStack.push(target);
  browserPos = browserStack.length - 1;
  browserBackBtn.disabled = browserPos <= 0;
  startBlockedTimer();
}

// --- Wiring -----------------------------------------------------------------

export function initIde(rootProvider: () => string): { refresh: () => void } {
  getRoot = rootProvider;

  for (const btn of abButtons) {
    btn.addEventListener("click", () => onAbButtonClick(btn));
  }

  // Explorer
  explorerRefreshBtn.addEventListener("click", () => void refreshExplorer());
  editorSaveBtn.addEventListener("click", () => void saveFile());
  editorEl.addEventListener("input", () => {
    setNote(editorStatusEl, null);
    updateDirty();
  });
  editorEl.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editorEl.selectionStart;
      const end = editorEl.selectionEnd;
      editorEl.setRangeText("  ", start, end, "end");
      editorEl.dispatchEvent(new Event("input"));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void saveFile();
    }
  });

  // Source Control
  scmRefreshBtn.addEventListener("click", () => void refreshScm());
  scmStageBtn.addEventListener("click", () => {
    const sel = scmSelected;
    if (sel) void scmFileAction("Stage", () => gitStageCmd(getRoot(), sel.path));
  });
  scmUnstageBtn.addEventListener("click", () => {
    const sel = scmSelected;
    if (sel) void scmFileAction("Unstage", () => gitUnstageCmd(getRoot(), sel.path));
  });
  scmDiscardBtn.addEventListener("click", () => {
    const sel = scmSelected;
    if (!sel) return;
    const msg = sel.untracked
      ? `Delete untracked file "${sel.path}"?`
      : `Discard changes to "${sel.path}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    void scmFileAction("Discard", () => gitDiscardCmd(getRoot(), sel.path, sel.untracked));
  });
  scmMessageEl.addEventListener("input", () => {
    scmCommitBtn.disabled = scmMessageEl.value.trim().length === 0;
  });
  scmCommitBtn.addEventListener("click", () => {
    const msg = scmMessageEl.value.trim();
    if (!msg) return;
    // Commit does not need a selected file, so it does not go through
    // scmFileAction.
    setScmOutput("committing…", null);
    void (async () => {
      try {
        await gitCommitCmd(getRoot(), msg);
        scmMessageEl.value = "";
        scmCommitBtn.disabled = true;
        setScmOutput("commit ok", "ok");
        await refreshScm();
      } catch (err) {
        setScmOutput(String(err), "error");
      }
    })();
  });
  scmFetchBtn.addEventListener("click", () => void scmRemoteAction("fetch", () => gitFetchCmd(getRoot())));
  scmPullBtn.addEventListener("click", () => void scmRemoteAction("pull", () => gitPullCmd(getRoot())));
  scmPushBtn.addEventListener("click", () => void scmRemoteAction("push", () => gitPushCmd(getRoot())));

  // Browser
  browserGoBtn.addEventListener("click", () => navigateBrowser(browserUrlInput.value));
  browserUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") navigateBrowser(browserUrlInput.value);
  });
  browserBackBtn.addEventListener("click", () => {
    if (browserPos <= 0) return;
    browserPos--;
    const url = browserStack[browserPos];
    browserUrl = url;
    browserUrlInput.value = url;
    browserFrameEl.src = url;
    browserBackBtn.disabled = browserPos <= 0;
    startBlockedTimer();
  });
  browserOpenExternalBtn.addEventListener("click", () => {
    const url = normalizeUrl(browserUrl || browserUrlInput.value);
    if (!url) return;
    void openUrl(url).catch((err) => {
      browserBlockedEl.textContent = String(err);
      browserBlockedEl.hidden = false;
    });
  });
  // A real load usually means the site allowed embedding; a timeout means it
  // probably refused (X-Frame-Options / CSP) — cross-origin frames give no
  // better signal.
  browserFrameEl.addEventListener("load", () => {
    if (blockedTimer !== undefined) {
      window.clearTimeout(blockedTimer);
      blockedTimer = undefined;
    }
    browserBlockedEl.hidden = true;
  });

  // Default: Explorer open.
  setView("explorer");

  return {
    refresh(): void {
      void refreshExplorer();
      if (currentView === "scm") void refreshScm();
    },
  };
}
