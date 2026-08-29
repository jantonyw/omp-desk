//! IDE sidebar commands: host-side file system + git support for the
//! Explorer / Source Control / Browser views.
//!
//! All paths are resolved against a `root` (the session cwd from Settings,
//! falling back to the process cwd), canonicalized, and prefix-checked so
//! the webview can never read or write outside it. Git runs the system
//! `git` CLI with `cwd = root`; nothing here touches omp or its RPC.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{json, CmdResult};

/// Hard caps that keep one bad tree / file / diff from stalling the UI.
const MAX_ENTRIES: usize = 5000;
const MAX_READ_BYTES: u64 = 1024 * 1024; // 1 MiB text read cap
const MAX_DIFF_BYTES: usize = 200 * 1024; // ~200 KB per diff side
const GIT_NET_TIMEOUT_SECS: u64 = 120;

/// Directory names never descended into by `fs_list`.
const SKIP_DIRS: [&str; 5] = ["node_modules", "target", "dist", ".git", ".omp"];

/// Resolve the workspace root: Settings `#cwd` when non-empty, otherwise the
/// process current directory. Canonicalized so every later prefix check is
/// against the real path.
fn root_dir(root: &str) -> Result<PathBuf, String> {
    let root = if root.trim().is_empty() {
        std::env::current_dir().map_err(|e| format!("current_dir: {e}"))?
    } else {
        PathBuf::from(root)
    };
    let root = root
        .canonicalize()
        .map_err(|e| format!("root not accessible: {e}"))?;
    if !root.is_dir() {
        return Err("root is not a directory".to_string());
    }
    Ok(root)
}

/// Resolve `rel` under the (canonicalized) root and reject anything that
/// escapes it — including via `..` or symlinks, since canonicalize follows
/// them before the prefix check.
fn resolve_under(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let canon = root
        .join(rel)
        .canonicalize()
        .map_err(|e| format!("path not accessible: {e}"))?;
    if !canon.starts_with(root) {
        return Err("path escapes root".to_string());
    }
    Ok(canon)
}

/// Resolve the target of a write. If the target already exists (including as
/// a symlink), canonicalize the FULL path and prefix-check it, so a symlink
/// pointing outside the root is rejected while one still under the root
/// resolves to its canonical target. If the target does not exist yet,
/// canonicalize the parent directory and re-join the file name (a fresh name
/// cannot be a symlink).
fn resolve_write_target(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let joined = root.join(rel);
    // `symlink_metadata` stats the path itself, so a symlink counts as
    // existing (even a dangling one) and is canonicalized before the write
    // instead of being blindly followed by `std::fs::write`.
    if joined.symlink_metadata().is_ok() {
        let canon = joined
            .canonicalize()
            .map_err(|e| format!("path not accessible: {e}"))?;
        if !canon.starts_with(root) {
            return Err("path escapes root".to_string());
        }
        return Ok(canon);
    }
    let parent = joined
        .parent()
        .ok_or_else(|| "invalid path".to_string())?;
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("parent not accessible: {e}"))?;
    if !parent.starts_with(root) {
        return Err("path escapes root".to_string());
    }
    let name = joined
        .file_name()
        .ok_or_else(|| "invalid path".to_string())?;
    Ok(parent.join(name))
}

#[derive(Serialize)]
struct FsEntry {
    name: String,
    /// Path relative to the root, `/`-separated.
    path: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<FsEntry>>,
}

/// Recursive walk bounded by `MAX_ENTRIES`. Symlinks are skipped entirely
/// (no following, so no cycles and no surprise escapes); `SKIP_DIRS` are
/// pruned by name.
fn walk_dir(
    dir: &Path,
    rel: &str,
    count: &mut usize,
    truncated: &mut bool,
) -> Vec<FsEntry> {
    let mut entries = Vec::new();
    let mut items: Vec<_> = match std::fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return entries,
    };
    // Dirs first, then files, alphabetical within each group.
    items.sort_by(|a, b| {
        let da = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let db = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        db.cmp(&da).then_with(|| a.file_name().cmp(&b.file_name()))
    });
    for item in items {
        if *count >= MAX_ENTRIES {
            *truncated = true;
            break;
        }
        let ft = match item.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        if ft.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            *count += 1;
            let children = walk_dir(&item.path(), &child_rel, count, truncated);
            entries.push(FsEntry {
                name,
                path: child_rel,
                kind: "dir",
                children: Some(children),
            });
        } else {
            *count += 1;
            entries.push(FsEntry {
                name,
                path: child_rel,
                kind: "file",
                children: None,
            });
        }
    }
    entries
}

/// Recursive tree of the workspace root. Sync on purpose: the walk is plain
/// `std::fs`, and Tauri runs sync commands on its blocking pool.
#[tauri::command]
pub fn fs_list(root: String) -> CmdResult {
    let root = root_dir(&root)?;
    let mut count = 0usize;
    let mut truncated = false;
    let entries = walk_dir(&root, "", &mut count, &mut truncated);
    Ok(json(&serde_json::json!({
        "root": root.display().to_string(),
        "entries": entries,
        "truncated": truncated,
    })))
}

/// Read a text file. Rejects anything over 1 MiB and anything that is not
/// clean UTF-8 (NUL bytes count as binary).
#[tauri::command]
pub fn fs_read(root: String, path: String) -> CmdResult {
    let root = root_dir(&root)?;
    let target = resolve_under(&root, &path)?;
    let meta = std::fs::metadata(&target).map_err(|e| format!("stat: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err("file larger than 1 MiB".to_string());
    }
    let bytes = std::fs::read(&target).map_err(|e| format!("read: {e}"))?;
    if bytes.contains(&0) {
        return Err("binary file".to_string());
    }
    let content =
        String::from_utf8(bytes).map_err(|_| "binary or non-UTF-8 file".to_string())?;
    Ok(json(&serde_json::json!({ "path": path, "content": content })))
}

/// Write a text file. The target must stay inside the root.
#[tauri::command]
pub fn fs_write(root: String, path: String, content: String) -> CmdResult {
    let root = root_dir(&root)?;
    let target = resolve_write_target(&root, &path)?;
    std::fs::write(&target, content).map_err(|e| format!("write: {e}"))?;
    Ok(json(&serde_json::json!({ "ok": true, "path": path })))
}

/// Run `git` with `cwd = root`, args passed as an array (never a shell).
/// Returns stdout on success, stderr (or exit status) as the error.
async fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    run_git_with(root, args, false).await
}

/// `run_git` for diff commands. `git diff` — including `--no-index`, which
/// exits 1 whenever the two files differ (the normal case vs `/dev/null`) —
/// reports differences as exit code 1 with the diff on stdout, so for these
/// commands exit 1 with stdout is a successful result, not an error.
/// Exit 0 is still success; exit 1 with empty stdout and any other non-zero
/// exit are still errors (stderr).
async fn run_git_diff(root: &Path, args: &[&str]) -> Result<String, String> {
    run_git_with(root, args, true).await
}

async fn run_git_with(root: &Path, args: &[&str], diff_exit_1_ok: bool) -> Result<String, String> {
    let out = tokio::process::Command::new("git")
        .args(args)
        .current_dir(root)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| format!("git spawn failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success()
        || (diff_exit_1_ok && out.status.code() == Some(1) && !stdout.trim().is_empty())
    {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.trim().is_empty() {
            Err(format!("git exited with {}", out.status))
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

/// Network git commands get a hard timeout so a hung remote cannot hang
/// the panel forever.
async fn run_git_net(root: &Path, args: &[&str]) -> Result<String, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(GIT_NET_TIMEOUT_SECS),
        run_git(root, args),
    )
    .await
    .map_err(|_| "git command timed out".to_string())?
}

/// Porcelain v1 status: branch + ahead/behind + XY/path entries.
/// Uses `-z` so paths with spaces / special characters come through unquoted.
#[tauri::command]
pub async fn git_status(root: String) -> CmdResult {
    let root = root_dir(&root)?;
    let out = run_git(&root, &["status", "--porcelain=v1", "-b", "-z"]).await?;
    let mut branch = String::new();
    let mut ahead: Option<u32> = None;
    let mut behind: Option<u32> = None;
    let mut files = Vec::new();
    let fields: Vec<&str> = out.split('\0').collect();
    let mut i = 0;
    while i < fields.len() {
        let field = fields[i];
        i += 1;
        if field.is_empty() {
            continue;
        }
        if let Some(rest) = field.strip_prefix("## ") {
            let mut parts = rest.split(" [");
            let head = parts.next().unwrap_or("");
            branch = match head.strip_prefix("No commits yet on ") {
                Some(b) => b.to_string(),
                None => head.split("...").next().unwrap_or("").to_string(),
            };
            if let Some(bracket) = parts.next() {
                for kv in bracket.trim_end_matches(']').split(", ") {
                    if let Some(v) = kv.strip_prefix("ahead ") {
                        ahead = v.parse().ok();
                    } else if let Some(v) = kv.strip_prefix("behind ") {
                        behind = v.parse().ok();
                    }
                }
            }
            continue;
        }
        if field.len() < 4 {
            continue;
        }
        let xy = &field[..2];
        let path = field[3..].to_string();
        files.push(serde_json::json!({ "xy": xy, "path": path }));
        if xy.starts_with('R') || xy.starts_with('C') {
            // In -z mode renames carry the old path as an extra field.
            i += 1;
        }
    }
    Ok(json(&serde_json::json!({
        "branch": branch,
        "ahead": ahead,
        "behind": behind,
        "files": files,
    })))
}

fn cap_diff(s: String) -> String {
    if s.len() > MAX_DIFF_BYTES {
        let mut t: String = s.chars().take(MAX_DIFF_BYTES).collect();
        t.push_str("\n… (diff truncated)");
        t
    } else {
        s
    }
}

/// Diff for one path: unstaged + staged. Untracked files fall back to a
/// no-index diff so the whole file shows as added.
#[tauri::command]
pub async fn git_diff(root: String, path: String) -> CmdResult {
    let root = root_dir(&root)?;
    let unstaged = match run_git_diff(&root, &["diff", "--", &path]).await {
        Ok(s) => s,
        Err(_) => String::new(),
    };
    let staged = match run_git_diff(&root, &["diff", "--cached", "--", &path]).await {
        Ok(s) => s,
        Err(_) => String::new(),
    };
    let mut untracked = String::new();
    if unstaged.is_empty() && staged.is_empty() {
        if let Ok(target) = resolve_under(&root, &path) {
            if target.is_file() {
                let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
                let p = target.to_string_lossy();
                if let Ok(s) = run_git_diff(&root, &["diff", "--no-index", "--", null, &p]).await {
                    untracked = cap_diff(s);
                }
            }
        }
    }
    Ok(json(&serde_json::json!({
        "path": path,
        "unstaged": cap_diff(unstaged),
        "staged": cap_diff(staged),
        "untracked": untracked,
    })))
}

#[tauri::command]
pub async fn git_stage(root: String, path: String) -> CmdResult {
    let root = root_dir(&root)?;
    run_git(&root, &["add", "--", &path]).await?;
    Ok(json(&serde_json::json!({ "ok": true })))
}

#[tauri::command]
pub async fn git_unstage(root: String, path: String) -> CmdResult {
    let root = root_dir(&root)?;
    // `reset HEAD` needs a commit; fall back to dropping the entry from the
    // index for unborn branches.
    match run_git(&root, &["reset", "-q", "HEAD", "--", &path]).await {
        Ok(_) => {}
        Err(_) => {
            run_git(&root, &["rm", "-r", "--cached", "--", &path]).await?;
        }
    }
    Ok(json(&serde_json::json!({ "ok": true })))
}

/// Discard local changes for one path. Untracked files are simply removed;
/// tracked ones go through `git restore` (checkout as fallback).
#[tauri::command]
pub async fn git_discard(root: String, path: String, untracked: bool) -> CmdResult {
    let root = root_dir(&root)?;
    if untracked {
        let target = resolve_under(&root, &path)?;
        if !target.is_file() {
            return Err("not a file".to_string());
        }
        std::fs::remove_file(&target).map_err(|e| format!("remove: {e}"))?;
        return Ok(json(&serde_json::json!({ "ok": true })));
    }
    match run_git(&root, &["restore", "--", &path]).await {
        Ok(_) => {}
        Err(_) => {
            run_git(&root, &["checkout", "--", &path]).await?;
        }
    }
    Ok(json(&serde_json::json!({ "ok": true })))
}

#[tauri::command]
pub async fn git_commit(root: String, message: String) -> CmdResult {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("commit message is empty".to_string());
    }
    let root = root_dir(&root)?;
    run_git(&root, &["commit", "-m", &message]).await?;
    Ok(json(&serde_json::json!({ "ok": true })))
}

#[tauri::command]
pub async fn git_fetch(root: String) -> CmdResult {
    let root = root_dir(&root)?;
    run_git_net(&root, &["fetch"]).await?;
    Ok(json(&serde_json::json!({ "ok": true })))
}

#[tauri::command]
pub async fn git_pull(root: String) -> CmdResult {
    let root = root_dir(&root)?;
    run_git_net(&root, &["pull"]).await?;
    Ok(json(&serde_json::json!({ "ok": true })))
}

/// Push to the configured upstream. Never uses --force.
#[tauri::command]
pub async fn git_push(root: String) -> CmdResult {
    let root = root_dir(&root)?;
    run_git_net(&root, &["push"]).await?;
    Ok(json(&serde_json::json!({ "ok": true })))
}

/// Recent commits: hash, author, date, subject (max 50, newest first).
#[tauri::command]
pub async fn git_log(root: String) -> CmdResult {
    let root = root_dir(&root)?;
    let out = run_git(
        &root,
        &[
            "log",
            "-n",
            "50",
            "--pretty=format:%h%x1e%an%x1e%ad%x1e%s",
            "--date=short",
        ],
    )
    .await?;
    let commits: Vec<serde_json::Value> = out
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\x1e');
            let hash = parts.next()?;
            let author = parts.next().unwrap_or("");
            let date = parts.next().unwrap_or("");
            let subject = parts.next().unwrap_or("");
            Some(serde_json::json!({
                "hash": hash,
                "author": author,
                "date": date,
                "subject": subject,
            }))
        })
        .collect();
    Ok(json(&commits))
}
