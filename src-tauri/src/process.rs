//! Process manager: spawns the `omp` child in `--mode rpc-ui`, speaks its
//! stdin/stdout JSONL protocol, and streams stdout frames to the frontend as
//! Tauri `rpc_event` payloads.
//!
//! Protocol handling mirrors `oh-my-pi/docs/rpc.md` and `rpc-frame.ts`: v1 is
//! one JSON object per line; after negotiating v2, oversized frames arrive as
//! base64 `rpc_chunk` sequences that we reassemble and validate in order.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

pub const MAX_FRAME_BYTES: u64 = 1024 * 1024;
pub const MAX_REASSEMBLED_BYTES: u64 = 64 * 1024 * 1024;
const CHUNK_PAYLOAD_BYTES: usize = 256 * 1024;

/// Settings identity for one omp session. `model: None` means "let omp use its
/// configured default"; an explicit model is passed as `--model provider/id`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionSettings {
    pub omp_path: String,
    pub cwd: String,
    pub model: Option<String>,
    pub no_session: bool,
    pub no_skills: bool,
    pub no_rules: bool,
    pub extra_args: Vec<String>,
}

/// Public snapshot of the omp session, returned by `get_status`.
#[derive(Debug, Clone, Serialize)]
pub struct SessionStatus {
    pub started: bool,
    pub omp_path: Option<String>,
    pub pid: Option<u32>,
    pub running: bool,
    pub ready: bool,
    pub protocol_version: u32,
    pub session_id: Option<String>,
    pub session_file: Option<String>,
    pub session_name: Option<String>,
    pub model: Option<String>,
    pub is_streaming: bool,
    pub message_count: u64,
    pub exited: bool,
}

/// A frame bound for the frontend. `kind` is the resolved category so the UI
/// never re-derives dispatch logic.
#[derive(Debug, Clone, Serialize)]
pub struct RpcEvent {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// A protocol-v2 chunk sequence currently being reassembled.
struct Pending {
    chunk_id: String,
    index: usize,
    count: usize,
    byte_length: u64,
    received: Vec<u8>,
}

impl Pending {
    fn feed(&mut self, chunk_id: &str, index: usize, data: &str) -> Result<(), String> {
        if chunk_id != self.chunk_id {
            return Err("rpc chunk sequence mismatch".into());
        }
        if index != self.index {
            return Err("rpc chunk sequence mismatch".into());
        }
        let bytes = decode_base64(data)?;
        if bytes.len() > CHUNK_PAYLOAD_BYTES {
            return Err("rpc chunk payload exceeds the transport limit".into());
        }
        self.received.extend_from_slice(&bytes);
        self.index += 1;
        if self.received.len() as u64 > self.byte_length {
            return Err("rpc chunk sequence exceeds declared length".into());
        }
        Ok(())
    }

    fn is_complete(&self) -> bool {
        self.index == self.count
    }

    fn finish(self) -> Result<serde_json::Value, String> {
        if self.received.len() as u64 != self.byte_length {
            return Err("rpc chunk sequence length mismatch".into());
        }
        let text = String::from_utf8(self.received)
            .map_err(|_| "rpc chunk payload is not valid UTF-8".to_string())?;
        serde_json::from_str(&text).map_err(|e| format!("rpc chunk payload is not JSON: {e}"))
    }
}

fn decode_base64(data: &str) -> Result<Vec<u8>, String> {
    if data.is_empty() {
        return Err("invalid rpc chunk data".into());
    }
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "invalid rpc chunk data".to_string())
}

/// Owned struct for the single active omp session.
pub struct OmpProcess {
    host: Arc<Mutex<Host>>,
}

/// Shared handle over the live child + status. Exposed via `OmpProcess::host`
/// so the command layer can send lines, read status, and kill the child.
pub struct Host {
    stdin_tx: Option<mpsc::UnboundedSender<String>>,
    child: Child,
    status: Status,
}

struct Status {
    pid: u32,
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
    omp_path: String,
}

impl OmpProcess {
    /// Spawn `omp` and wire reader tasks for stdout/stderr plus a writer task
    /// for stdin. Emitted events are pushed onto `emit`.
    pub fn spawn(
        settings: &SessionSettings,
        emit: mpsc::UnboundedSender<RpcEvent>,
    ) -> Result<Arc<OmpProcess>, String> {
        if settings.cwd.is_empty() {
            return Err("cwd is empty".to_string());
        }
        let mut cmd = Command::new(&settings.omp_path);
        cmd.arg("--mode").arg("rpc-ui");
        cmd.current_dir(&settings.cwd);
        if let Some(model) = &settings.model {
            let model = model.trim();
            if !model.is_empty() {
                cmd.arg("--model").arg(model);
            }
        }
        if settings.no_session {
            cmd.arg("--no-session");
        }
        if settings.no_skills {
            cmd.arg("--no-skills");
        }
        if settings.no_rules {
            cmd.arg("--no-rules");
        }
        for arg in &settings.extra_args {
            if !arg.is_empty() {
                cmd.arg(arg);
            }
        }
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn `{}`: {e}", settings.omp_path))?;

        let pid = child.id().ok_or_else(|| "child has no pid".to_string())?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "child has no stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "child has no stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "child has no stderr".to_string())?;

        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();

        // Writer task: one JSON object + '\n' per inbound line.
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = stdin_rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err()
                    || stdin.write_all(b"\n").await.is_err()
                    || stdin.flush().await.is_err()
                {
                    break;
                }
            }
            let _ = stdin.shutdown().await;
        });

        // Stderr reader: forward lines as `stderr` events (bounded by reader).
        {
            let emit = emit.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut buf = String::new();
                loop {
                    buf.clear();
                    match reader.read_line(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                    let line = buf.trim_end().to_string();
                    if !line.is_empty() {
                        let _ = emit.send(RpcEvent {
                            kind: "stderr".into(),
                            frame: None,
                            text: Some(line),
                            code: None,
                            message: None,
                        });
                    }
                }
            });
        }

        let initial_status = Status {
            pid,
            running: true,
            ready: false,
            protocol_version: 1,
            session_id: None,
            session_file: None,
            session_name: None,
            model: settings.model.clone(),
            is_streaming: false,
            message_count: 0,
            exited: false,
            omp_path: settings.omp_path.clone(),
        };
        let host = Arc::new(Mutex::new(Host {
            stdin_tx: Some(stdin_tx),
            child,
            status: initial_status,
        }));

        // Lifecycle task: drive the stdout reader until the child exits.
        {
            let host = host.clone();
            let emit = emit.clone();
            tokio::spawn(async move {
                let exit_code = run_stdout_loop(stdout, &host, &emit).await;
                let mut guard = host.lock().await;
                guard.status.running = false;
                guard.status.exited = true;
                guard.status.ready = false;
                guard.status.is_streaming = false;
                let _ = emit.send(RpcEvent {
                    kind: "exited".into(),
                    frame: None,
                    text: None,
                    code: Some(exit_code),
                    message: Some("omp process exited".into()),
                });
            });
        }

        Ok(Arc::new(OmpProcess { host }))
    }

    pub fn host(&self) -> Arc<Mutex<Host>> {
        self.host.clone()
    }
}

/// Read stdout to EOF, decode frames (v1 lines and v2 chunk sequences), update
/// `host.status`, and forward `rpc_event` frames via `emit`. Returns the exit
/// status when the pipe closes (already reaped via `child.wait()`), or `-1` on
/// read error.
async fn run_stdout_loop(
    stdout: tokio::process::ChildStdout,
    host: &Arc<Mutex<Host>>,
    emit: &mpsc::UnboundedSender<RpcEvent>,
) -> i32 {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut pending: Option<Pending> = None;

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => return -1,
        }
        let s = line.trim();
        if s.is_empty() {
            continue;
        }
        let raw: serde_json::Value = match serde_json::from_str(s) {
            Ok(v) => v,
            Err(_) => {
                emit_error(emit, "malformed JSONL line", Some(s.to_string()));
                continue;
            }
        };

        let obj = match raw.as_object() {
            Some(o) => o,
            None => continue,
        };

        // If a chunk sequence is open, every subsequent frame must be a chunk.
        if let Some(p) = pending.as_mut() {
            let ty = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if ty != "rpc_chunk" {
                emit_error(emit, "rpc chunk sequence interrupted", None);
                pending = None;
                continue;
            }
            let index = obj.get("index").and_then(|v| v.as_u64());
            let chunk_id = obj.get("chunkId").and_then(|v| v.as_str());
            let data = obj.get("data").and_then(|v| v.as_str());
            let (Some(index), Some(chunk_id), Some(data)) = (index, chunk_id, data) else {
                emit_error(emit, "invalid rpc chunk data", None);
                pending = None;
                continue;
            };
            if let Err(e) = p.feed(chunk_id, index as usize, data) {
                emit_error(emit, &e, None);
                pending = None;
                continue;
            }
            if p.is_complete() {
                let complete = pending.take().unwrap();
                dispatch_pending(complete, host, emit, &mut pending).await;
            }
            continue;
        }

        let ty = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // New chunk sequence: gather metadata and open `pending`.
        if ty == "rpc_chunk" {
            let chunk_id = obj.get("chunkId").and_then(|v| v.as_str());
            let index = obj.get("index").and_then(|v| v.as_u64());
            let count = obj.get("count").and_then(|v| v.as_u64());
            let byte_length = obj.get("byteLength").and_then(|v| v.as_u64());
            let data = obj.get("data").and_then(|v| v.as_str());

            let (Some(chunk_id), Some(index), Some(count), Some(byte_length), Some(data)) =
                (chunk_id, index, count, byte_length, data)
            else {
                emit_error(emit, "invalid rpc chunk metadata", None);
                continue;
            };
            if chunk_id.is_empty()
                || chunk_id.len() > 128
                || index >= count
                || count < 2
                || byte_length < MAX_FRAME_BYTES
                || byte_length > MAX_REASSEMBLED_BYTES
            {
                emit_error(emit, "invalid rpc chunk metadata", None);
                continue;
            }
            let mut p = Pending {
                chunk_id: chunk_id.to_string(),
                index: 0,
                count: count as usize,
                byte_length,
                received: Vec::with_capacity(byte_length as usize),
            };
            if let Err(e) = p.feed(chunk_id, index as usize, data) {
                emit_error(emit, &e, None);
                continue;
            }
            if p.is_complete() {
                dispatch_pending(p, host, emit, &mut pending).await;
            } else {
                pending = Some(p);
            }
            continue;
        }

        dispatch_frame(raw, host, emit).await;
    }

    // Reap the child to obtain its exit code, if the process already exited.
    let mut guard = host.lock().await;
    let code = guard
        .child
        .wait()
        .await
        .map(|s| s.code().unwrap_or(0))
        .unwrap_or(-1);
    drop(guard);
    code
}

async fn dispatch_pending(
    complete: Pending,
    host: &Arc<Mutex<Host>>,
    emit: &mpsc::UnboundedSender<RpcEvent>,
    pending: &mut Option<Pending>,
) {
    match complete.finish() {
        Ok(frame) => dispatch_frame(frame, host, emit).await,
        Err(e) => emit_error(emit, &e, None),
    }
    *pending = None;
}

fn emit_error(emit: &mpsc::UnboundedSender<RpcEvent>, message: &str, text: Option<String>) {
    let _ = emit.send(RpcEvent {
        kind: "protocol_error".into(),
        frame: None,
        text,
        code: None,
        message: Some(message.to_string()),
    });
}

/// Categorize one complete frame, update shared status, emit the event.
async fn dispatch_frame(
    frame: serde_json::Value,
    host: &Arc<Mutex<Host>>,
    emit: &mpsc::UnboundedSender<RpcEvent>,
) {
    let ty = frame
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    // Update shared status from known frame types.
    {
        let mut guard = host.lock().await;
        match ty.as_str() {
            "ready" => {
                guard.status.ready = true;
                guard.status.protocol_version = frame
                    .get("protocolVersion")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1) as u32;
            }
            "response" => {
                let cmd = frame.get("command").and_then(|c| c.as_str()).unwrap_or("");
                if cmd == "get_state" {
                    if let Some(data) = frame.get("data") {
                        if let Some(sid) = data.get("sessionId").and_then(|v| v.as_str()) {
                            guard.status.session_id = Some(sid.to_string());
                        }
                        if let Some(sf) = data.get("sessionFile").and_then(|v| v.as_str()) {
                            guard.status.session_file = Some(sf.to_string());
                        }
                        if let Some(sn) = data.get("sessionName").and_then(|v| v.as_str()) {
                            guard.status.session_name = Some(sn.to_string());
                        }
                        if let Some(m) = data.get("model") {
                            if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                                guard.status.model = Some(id.to_string());
                            }
                        }
                        if let Some(streaming) = data.get("isStreaming").and_then(|v| v.as_bool())
                        {
                            guard.status.is_streaming = streaming;
                        }
                        if let Some(mc) = data.get("messageCount").and_then(|v| v.as_u64()) {
                            guard.status.message_count = mc;
                        }
                    }
                }
            }
            "agent_start" => {
                guard.status.is_streaming = true;
            }
            "agent_end" => {
                guard.status.is_streaming = false;
            }
            _ => {}
        }
    }

    let kind = match ty.as_str() {
        "ready" => "ready".to_string(),
        "response" => "response".to_string(),
        "extension_ui_request" => "extension_ui_request".to_string(),
        _ => "event".to_string(),
    };

    let _ = emit.send(RpcEvent {
        kind,
        frame: Some(frame),
        text: None,
        code: None,
        message: None,
    });
}

impl Host {
    pub fn status(&self) -> SessionStatus {
        let s = &self.status;
        SessionStatus {
            started: true,
            omp_path: Some(s.omp_path.clone()),
            pid: Some(s.pid),
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

    /// Send one raw JSONL line to the child.
    pub fn send_line(&self, line: &str) -> Result<(), String> {
        match &self.stdin_tx {
            Some(tx) => tx
                .send(line.to_string())
                .map_err(|_| "stdin channel closed".to_string()),
            None => Err("process not started".to_string()),
        }
    }

    pub async fn kill(&mut self) {
        if let Some(tx) = self.stdin_tx.take() {
            drop(tx);
        }
        if self.status.running {
            let _ = self.child.kill().await;
            self.status.running = false;
            self.status.exited = true;
        }
    }
}

static REQ_SEQ: AtomicU64 = AtomicU64::new(1);

pub fn next_req_id() -> String {
    format!("req_{}", REQ_SEQ.fetch_add(1, Ordering::Relaxed))
}
