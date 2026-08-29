//! omp-desk — a Tauri 2 desktop shell around the `omp` coding agent.
//!
//! This crate owns exactly two responsibilities:
//!   1. Process management: spawn/kill the `omp --mode rpc-ui` child and speak
//!      its stdio JSONL protocol (see `process.rs`).
//!   2. The Tauri command surface + `rpc_event` bridge used by the frontend.
//!
//! The agent itself, its tools, providers, and the model client all live in
//! `omp`; this app reimplements none of them.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod process;

use std::sync::Arc;

use process::{next_req_id, OmpProcess, RpcEvent, SessionSettings, SessionStatus};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

/// Shared handle to the single active omp session.
struct Session {
    proc: tokio::sync::Mutex<Option<Arc<OmpProcess>>>,
    emit: tokio::sync::mpsc::UnboundedSender<RpcEvent>,
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
    app: tauri::AppHandle,
    settings: SessionSettings,
) -> CmdResult {
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

    // Drain the ready frame / initial events into the event stream. The
    // frontend listens on `rpc_event`; it reacts to `kind == "ready"` by
    let host = proc.host();
    let host = host.lock().await;
    let status = host.status();
    drop(host);

    let view = SessionStatusView::from_status(&status);
    let _ = app.emit("rpc_event", RpcEvent {
        kind: "status".into(),
        frame: Some(json(&status)),
        text: None,
        code: None,
        message: None,
    });

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
    send_command(state, command).await?;
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

pub fn run() {
    let mk = |app: &tauri::App| -> Result<Session, String> {
        let (emit, rx) = tokio::sync::mpsc::unbounded_channel::<RpcEvent>();
        // Forward every reader/writer event to the `rpc_event` channel.
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let mut rx = rx;
            while let Some(ev) = rx.recv().await {
                let _ = handle.emit("rpc_event", &ev);
            }
        });
        Ok(Session {
            proc: tokio::sync::Mutex::new(None),
            emit,
        })
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let session = mk(app)?;
            app.manage(session);
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
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running omp-desk");
}
