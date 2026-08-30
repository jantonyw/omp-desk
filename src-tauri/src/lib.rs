//! omp-desk — a Tauri 2 desktop shell around the `omp` coding agent.
//!
//! This crate owns:
//!   1. Process management: spawn/kill the `omp --mode rpc-ui` child and speak
//!      its stdio JSONL protocol (see `process.rs`).
//!   2. The Tauri command surface + `rpc_event` bridge used by the frontend.
//!   3. Idle-only self-update of the configured `omp` CLI via official
//!      `omp update` / `omp update --check` (see `omp_update.rs`).
//!
//! The agent itself, its tools, providers, and the model client all live in
//! `omp`; this app reimplements none of them.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod event_bridge;
pub mod ide;
mod omp_update;
mod process;

use std::sync::Arc;

use event_bridge::EventOutbox;
use omp_update::{spawn_blocked_reason, OmpUpdater, UpdateConfig};
use process::{next_req_id, OmpProcess, RpcEvent, SessionSettings, SessionStatus};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

/// Shared handle to the single active omp session.
struct Session {
    proc: Arc<tokio::sync::Mutex<Option<Arc<OmpProcess>>>>,
    emit: EventOutbox,
    updater: Arc<OmpUpdater>,
}

#[derive(Serialize)]
struct Ack {
    ok: bool,
    id: Option<String>,
}

/// Command result shapes. `Result<_, String>` surfaces the error as a plain
/// string to the JS side.
type CmdResult = Result<serde_json::Value, String>;

fn json<T: Serialize>(v: T) -> serde_json::Value {
    serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
}

fn ack(ok: bool, id: Option<String>) -> serde_json::Value {
    json(Ack { ok, id })
}

/// Spawn (or restart) the omp child. De-serializes settings from the frontend,
/// which supplies the omp path, cwd, model, and toggles captured in the
/// settings panel.
#[tauri::command]
async fn start_session(
    state: State<'_, Session>,
    settings: SessionSettings,
) -> CmdResult {
    if let Some(reason) = spawn_blocked_reason(state.updater.is_updating().await) {
        return Err(reason.to_string());
    }
    let proc = {
        let mut guard = state.proc.lock().await;
        if let Some(old) = guard.take() {
            let host = old.host();
            let mut host = host.lock().await;
            host.kill().await;
        }
        match OmpProcess::spawn(&settings, state.emit.clone()) {
            Ok(p) => {
                *guard = Some(p.clone());
                p
            }
            Err(e) => return Err(e),
        }
    };

    let host = proc.host();
    let host = host.lock().await;
    let status = host.status();
    drop(host);

    let view = SessionStatusView::from_status(&status);
    state.emit.send(RpcEvent {
        kind: "status".into(),
        frame: Some(json(&status)),
        text: None,
        code: None,
        message: None,
    });
    state.updater.remember_session(settings).await;

    Ok(json(view))
}

#[derive(Serialize)]
struct SessionStatusView {
    started: bool,
    omp_path: Option<String>,
    pid: Option<u32>,
    running: bool,
    ready: bool,
    protocol_version: u32,
    session_id: Option<String>,
    session_file: Option<String>,
    session_name: Option<String>,
    model: Option<String>,
    is_streaming: bool,
    message_count: u64,
    exited: bool,
}

impl SessionStatusView {
    fn from_status(s: &SessionStatus) -> Self {
        SessionStatusView {
            started: s.started,
            omp_path: s.omp_path.clone(),
            pid: s.pid,
            running: s.running,
            ready: s.ready,
            protocol_version: s.protocol_version,
            session_id: s.session_id.clone(),
            session_file: s.session_file.clone(),
            session_name: s.session_name.clone(),
            model: s.model.clone(),
            is_streaming: s.is_streaming,
            message_count: s.message_count,
            exited: s.exited,
        }
    }
}

/// Send a raw command object. The frontend builds the full RPC command
/// (including an `id`) as a serde_json `Value`; this command only appends the
/// framing newline and forwards it verbatim.
#[tauri::command]
async fn send_command(state: State<'_, Session>, command: serde_json::Value) -> CmdResult {
    let line = serde_json::to_string(&command).map_err(|e| format!("invalid command: {e}"))?;
    let proc = {
        let guard = state.proc.lock().await;
        guard.clone()
    };
    match proc {
        Some(p) => {
            let host = p.host();
            let host = host.lock().await;
            host.send_line(&line)?;
            let id = command.get("id").and_then(|v| v.as_str()).map(str::to_string);
            Ok(ack(true, id))
        }
        None => Err("no session running".to_string()),
    }
}

/// Convenience: send `prompt` with a fresh request id.
#[tauri::command]
async fn send_prompt(state: State<'_, Session>, message: String) -> CmdResult {
    if message.trim().is_empty() {
        return Err("empty message".to_string());
    }
    let id = next_req_id();
    let command = serde_json::json!({
        "id": id,
        "type": "prompt",
        "message": message,
    });
    send_command(state.clone(), command).await?;
    // Optimistic bump so the status bar moves before get_state catches up.
    if let Some(p) = state.proc.lock().await.clone() {
        let host = p.host();
        let mut host = host.lock().await;
        host.bump_message_count();
    }
    Ok(ack(true, Some(id)))
}

/// Convenience: send `abort`.
#[tauri::command]
async fn abort(state: State<'_, Session>) -> CmdResult {
    let id = next_req_id();
    let command = serde_json::json!({ "id": id, "type": "abort" });
    send_command(state, command).await
}

/// Respond to an `extension_ui_request`. The MVP auto-denies most dialogs;
/// this is the manual path (confirm true/false, or a text value).
#[tauri::command]
async fn respond_extension_ui(
    state: State<'_, Session>,
    request_id: String,
    response: serde_json::Value,
) -> CmdResult {
    let mut command = serde_json::Map::new();
    command.insert("type".to_string(), serde_json::json!("extension_ui_response"));
    command.insert("id".to_string(), serde_json::json!(request_id));
    for (k, v) in response.as_object().cloned().unwrap_or_default() {
        command.insert(k, v);
    }
    send_command(state, serde_json::Value::Object(command)).await
}

/// Snapshot of the shared status, without blocking on the reader task.
#[tauri::command]
async fn get_status(state: State<'_, Session>) -> CmdResult {
    let proc = {
        let guard = state.proc.lock().await;
        guard.clone()
    };
    match proc {
        Some(p) => {
            let host = p.host();
            let host = host.lock().await;
            let status = host.status();
            Ok(json(SessionStatusView::from_status(&status)))
        }
        None => Ok(json(SessionStatusView {
            started: false,
            omp_path: None,
            pid: None,
            running: false,
            ready: false,
            protocol_version: 1,
            session_id: None,
            session_file: None,
            session_name: None,
            model: None,
            is_streaming: false,
            message_count: 0,
            exited: false,
        })),
    }
}

/// Kill the child process.
#[tauri::command]
async fn stop_session(state: State<'_, Session>) -> CmdResult {
    let old = {
        let mut guard = state.proc.lock().await;
        guard.take()
    };
    if let Some(p) = old {
        let host = p.host();
        let mut host = host.lock().await;
        host.kill().await;
    }
    Ok(ack(true, None))
}

#[tauri::command]
async fn get_omp_update_status(state: State<'_, Session>) -> CmdResult {
    Ok(json(state.updater.snapshot().await))
}

#[tauri::command]
async fn check_omp_update(state: State<'_, Session>) -> CmdResult {
    Ok(json(state.updater.check(false).await))
}

#[tauri::command]
async fn apply_omp_update(state: State<'_, Session>) -> CmdResult {
    Ok(json(state.updater.apply().await))
}

#[tauri::command]
async fn configure_omp_update(state: State<'_, Session>, config: UpdateConfig) -> CmdResult {
    Ok(json(state.updater.configure(config).await))
}

/// Open a URL in the system browser (used by extension `open_url` requests).
#[tauri::command]
#[allow(deprecated)]
fn open_url(url: String, app: tauri::AppHandle) -> CmdResult {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(url, None)
        .map(|_| ack(true, None))
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionHistoryEntry {
    pub id: String,
    pub title: String,
    pub timestamp: String,
    pub cwd: String,
    pub file_path: String,
    pub modified: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionMessageEntry {
    pub role: String,
    pub text: String,
    pub timestamp: Option<String>,
    pub tool_name: Option<String>,
    pub is_error: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkspaceGroup {
    pub id: String,
    pub name: String,
    pub path: String,
    pub session_count: usize,
    pub latest_time: u64,
    pub sessions: Vec<SessionHistoryEntry>,
}

#[tauri::command]
fn list_session_history(cwd: Option<String>) -> CmdResult {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())?;
    let sessions_dir = std::path::PathBuf::from(home)
        .join(".omp")
        .join("agent")
        .join("sessions");
    if !sessions_dir.exists() {
        return Ok(json(Vec::<SessionHistoryEntry>::new()));
    }

    let mut entries = Vec::new();
    if let Ok(dirs) = std::fs::read_dir(&sessions_dir) {
        for dir_entry in dirs.flatten() {
            let path = dir_entry.path();
            if path.is_dir() {
                if let Ok(files) = std::fs::read_dir(&path) {
                    for file_entry in files.flatten() {
                        let file_path = file_entry.path();
                        if file_path.extension().map_or(false, |ext| ext == "jsonl") {
                            let metadata = file_entry.metadata().ok();
                            let modified = metadata
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            if let Ok(content) = std::fs::read_to_string(&file_path) {
                                let mut title = String::new();
                                let mut session_id = String::new();
                                let mut session_cwd = String::new();
                                let mut timestamp = String::new();
                                let mut first_user_text = String::new();

                                for line in content.lines().take(40) {
                                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                                        let ty = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                        if ty == "title" {
                                            if let Some(t) = val.get("title").and_then(|v| v.as_str()) {
                                                let t_trim = t.trim();
                                                if !t_trim.is_empty() {
                                                    title = t_trim.to_string();
                                                }
                                            }
                                        } else if ty == "session" {
                                            if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                                                session_id = id.to_string();
                                            }
                                            if let Some(c) = val.get("cwd").and_then(|v| v.as_str()) {
                                                session_cwd = c.to_string();
                                            }
                                            if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
                                                timestamp = ts.to_string();
                                            }
                                        } else if (ty == "message" || ty == "message_start") && first_user_text.is_empty() {
                                            if let Some(msg) = val.get("message") {
                                                let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
                                                if role == "user" {
                                                    if let Some(content_blocks) = msg.get("content").and_then(|c| c.as_array()) {
                                                        for block in content_blocks {
                                                            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                                if let Some(txt) = block.get("text").and_then(|s| s.as_str()) {
                                                                    let clean = txt.lines().next().unwrap_or("").trim();
                                                                    if !clean.is_empty() {
                                                                        first_user_text = clean.chars().take(30).collect::<String>();
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if session_id.is_empty() {
                                    session_id = file_path
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("")
                                        .to_string();
                                }
                                if title.is_empty() {
                                    if !first_user_text.is_empty() {
                                        title = first_user_text;
                                    } else {
                                        title = "Untitled session".to_string();
                                    }
                                }
                                let matches_cwd = match &cwd {
                                    Some(target_cwd) if !target_cwd.is_empty() => {
                                        session_cwd.starts_with(target_cwd) || target_cwd.starts_with(&session_cwd)
                                    }
                                    _ => true,
                                };

                                if matches_cwd {
                                    entries.push(SessionHistoryEntry {
                                        id: session_id,
                                        title,
                                        timestamp,
                                        cwd: session_cwd,
                                        file_path: file_path.to_string_lossy().to_string(),
                                        modified,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(json(entries))
}

#[tauri::command]
fn list_workspace_groups() -> CmdResult {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())?;
    let sessions_dir = std::path::PathBuf::from(home)
        .join(".omp")
        .join("agent")
        .join("sessions");
    if !sessions_dir.exists() {
        return Ok(json(Vec::<WorkspaceGroup>::new()));
    }

    let mut map: std::collections::HashMap<String, Vec<SessionHistoryEntry>> = std::collections::HashMap::new();

    if let Ok(dirs) = std::fs::read_dir(&sessions_dir) {
        for dir_entry in dirs.flatten() {
            let path = dir_entry.path();
            if path.is_dir() {
                if let Ok(files) = std::fs::read_dir(&path) {
                    for file_entry in files.flatten() {
                        let file_path = file_entry.path();
                        if file_path.extension().map_or(false, |ext| ext == "jsonl") {
                            let metadata = file_entry.metadata().ok();
                            let modified = metadata
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                .unwrap_or(0);

                            if let Ok(content) = std::fs::read_to_string(&file_path) {
                                let mut title = String::new();
                                let mut session_id = String::new();
                                let mut session_cwd = String::new();
                                let mut timestamp = String::new();
                                let mut first_user_text = String::new();

                                for line in content.lines().take(40) {
                                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                                        let ty = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                        if ty == "title" {
                                            if let Some(t) = val.get("title").and_then(|v| v.as_str()) {
                                                let t_trim = t.trim();
                                                if !t_trim.is_empty() {
                                                    title = t_trim.to_string();
                                                }
                                            }
                                        } else if ty == "session" {
                                            if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                                                session_id = id.to_string();
                                            }
                                            if let Some(c) = val.get("cwd").and_then(|v| v.as_str()) {
                                                session_cwd = c.to_string();
                                            }
                                            if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
                                                timestamp = ts.to_string();
                                            }
                                        } else if (ty == "message" || ty == "message_start") && first_user_text.is_empty() {
                                            if let Some(msg) = val.get("message") {
                                                let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
                                                if role == "user" {
                                                    if let Some(content_blocks) = msg.get("content").and_then(|c| c.as_array()) {
                                                        for block in content_blocks {
                                                            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                                if let Some(txt) = block.get("text").and_then(|s| s.as_str()) {
                                                                    let clean = txt.lines().next().unwrap_or("").trim();
                                                                    if !clean.is_empty() {
                                                                        first_user_text = clean.chars().take(30).collect::<String>();
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if session_id.is_empty() {
                                    session_id = file_path
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("")
                                        .to_string();
                                }
                                if title.is_empty() {
                                    if !first_user_text.is_empty() {
                                        title = first_user_text;
                                    } else {
                                        title = "Untitled session".to_string();
                                    }
                                }
                                let group_key = if session_cwd.is_empty() {
                                    "未分组".to_string()
                                } else {
                                    session_cwd.clone()
                                };

                                map.entry(group_key).or_default().push(SessionHistoryEntry {
                                    id: session_id,
                                    title,
                                    timestamp,
                                    cwd: session_cwd,
                                    file_path: file_path.to_string_lossy().to_string(),
                                    modified,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let mut groups: Vec<WorkspaceGroup> = Vec::new();
    for (group_path, mut sessions) in map {
        sessions.sort_by(|a, b| b.modified.cmp(&a.modified));
        let latest_time = sessions.first().map(|s| s.modified).unwrap_or(0);
        let name = if group_path == "未分组" {
            "未分组".to_string()
        } else {
            group_path
                .split(['/', '\\'])
                .filter(|s| !s.is_empty())
                .last()
                .unwrap_or(&group_path)
                .to_string()
        };

        groups.push(WorkspaceGroup {
            id: group_path.clone(),
            name,
            path: group_path,
            session_count: sessions.len(),
            latest_time,
            sessions,
        });
    }

    groups.sort_by(|a, b| {
        if a.name == "未分组" {
            std::cmp::Ordering::Greater
        } else if b.name == "未分组" {
            std::cmp::Ordering::Less
        } else {
            b.latest_time.cmp(&a.latest_time)
        }
    });

    Ok(json(groups))
}
#[tauri::command]
fn read_session_transcript(file_path: String) -> CmdResult {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err("File not found".to_string());
    }

    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    let mut last_text = String::new();

    for line in content.lines() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let ty = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
            // In omp session jsonl, "message_end" carries the complete final assistant text,
            // while "message" carries user input and standalone turns.
            if ty == "message_end" || ty == "message" {
                if let Some(msg) = val.get("message") {
                    let role = msg
                        .get("role")
                        .and_then(|v| v.as_str())
                        .unwrap_or("assistant")
                        .to_string();
                    let tool_name = msg
                        .get("toolName")
                        .or_else(|| msg.get("tool_name"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let is_error = msg
                        .get("isError")
                        .or_else(|| msg.get("is_error"))
                        .and_then(|v| v.as_bool());
                    let mut text = String::new();
                    if let Some(content_blocks) = msg.get("content").and_then(|c| c.as_array()) {
                        for block in content_blocks {
                            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(t) = block.get("text").and_then(|s| s.as_str()) {
                                    text.push_str(t);
                                }
                            }
                        }
                    }
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && trimmed != last_text {
                        last_text = trimmed.to_string();
                        let timestamp = val
                            .get("timestamp")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        messages.push(SessionMessageEntry {
                            role,
                            text,
                            timestamp,
                            tool_name,
                            is_error,
                        });
                    }
                }
            }
        }
    }

    Ok(json(messages))
}

fn configure_webview_gpu(app: &tauri::App) {
    // Prefer WebKit/WebView2 hardware compositing.
    // GPU here means the embedded webview's compositor — not a wgpu/Vulkan scene.
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "linux")]
        {
            let _ = window.with_webview(|webview| {
                use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
                let wv = webview.inner();
                if let Some(settings) = wv.settings() {
                    settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Always);
                }
            });
        }
        // macOS WKWebView uses GPU compositing by default; nothing to force-enable.
        // Windows GPU hints are set via tauri.conf.json `additionalBrowserArgs`.
        let _ = window;
    }
}

pub fn run() {
    // Clear software-compositing overrides before the webview is created.
    // GPU = WebKit/WebView2 compositing, not a wgpu scene.
    #[cfg(target_os = "linux")]
    {
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
    }

    let mk = |app: &tauri::App| -> Result<Session, String> {
        let (emit, drain) = EventOutbox::new();
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            drain
                .run(move |ev| {
                    let _ = handle.emit("rpc_event", &ev);
                })
                .await;
        });
        let proc = Arc::new(tokio::sync::Mutex::new(None));
        let updater = Arc::new(OmpUpdater::new(proc.clone(), emit.clone()));
        Ok(Session {
            proc,
            emit,
            updater,
        })
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            configure_webview_gpu(app);
            let session = mk(app)?;
            let handle = app.handle().clone();
            session.updater.bind_app(handle);
            let updater = session.updater.clone();
            app.manage(session);
            tauri::async_runtime::spawn(async move {
                updater.run_loop().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            send_command,
            send_prompt,
            abort,
            respond_extension_ui,
            get_status,
            stop_session,
            get_omp_update_status,
            check_omp_update,
            apply_omp_update,
            configure_omp_update,
            open_url,
            list_session_history,
            list_workspace_groups,
            read_session_transcript,
            ide::fs_list,
            ide::fs_read,
            ide::fs_write,
            ide::git_status,
            ide::git_diff,
            ide::git_stage,
            ide::git_unstage,
            ide::git_discard,
            ide::git_commit,
            ide::git_fetch,
            ide::git_pull,
            ide::git_push,
            ide::git_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running omp-desk");
}
