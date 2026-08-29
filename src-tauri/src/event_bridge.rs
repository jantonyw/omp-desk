//! Bounded, coalescing bridge from omp stdout frames to the webview `rpc_event` channel.
//!
//! High-volume assistant deltas are batched (~16ms / N) and queued with a cap that
//! drops the oldest stream events under backpressure. Critical kinds are never dropped.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::Notify;

use crate::process::RpcEvent;

/// Max queued non-critical events waiting to be emitted to the webview.
const STREAM_QUEUE_CAP: usize = 128;
/// Flush coalesced deltas after this many merged pieces.
const COALESCE_MAX_PARTS: usize = 32;
/// Flush coalesced deltas after this much wall time.
const COALESCE_WINDOW: Duration = Duration::from_millis(16);

/// Kinds / frame types that must always reach the UI.
fn is_critical(ev: &RpcEvent) -> bool {
    match ev.kind.as_str() {
        "ready" | "response" | "exited" | "protocol_error" | "extension_ui_request" | "status"
        | "stderr" => true,
        "event" => {
            let ty = ev
                .frame
                .as_ref()
                .and_then(|f| f.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            matches!(
                ty,
                "prompt_result"
                    | "available_commands_update"
                    | "agent_end"
                    | "agent_start"
                    | "message_end"
                    | "message_start"
                    | "tool_execution_start"
                    | "tool_execution_end"
            )
        }
        _ => false,
    }
}

/// Assistant stream token that can be merged with neighbors.
fn coalesce_key(ev: &RpcEvent) -> Option<&'static str> {
    if ev.kind != "event" {
        return None;
    }
    let evt = ev
        .frame
        .as_ref()?
        .get("assistantMessageEvent")?
        .as_object()?;
    let ty = evt.get("type")?.as_str()?;
    match ty {
        "text_delta" => Some("text_delta"),
        "thinking_delta" => Some("thinking_delta"),
        _ => None,
    }
}

fn delta_text(ev: &RpcEvent) -> Option<&str> {
    ev.frame
        .as_ref()?
        .get("assistantMessageEvent")?
        .get("delta")?
        .as_str()
}

struct PendingCoalesce {
    /// Template event (first frame); delta string is rewritten on flush.
    template: RpcEvent,
    key: &'static str,
    parts: usize,
    first_at: Instant,
}

struct QueueState {
    items: VecDeque<RpcEvent>,
    /// How many non-critical items are in `items`.
    stream_count: usize,
    coalesce: Option<PendingCoalesce>,
}

impl QueueState {
    fn new() -> Self {
        Self {
            items: VecDeque::with_capacity(STREAM_QUEUE_CAP + 16),
            stream_count: 0,
            coalesce: None,
        }
    }

    fn flush_coalesce(&mut self) {
        let Some(pending) = self.coalesce.take() else {
            return;
        };
        self.push_stream(pending.template);
    }

    fn drop_oldest_stream(&mut self) {
        if let Some(i) = self.items.iter().position(|e| !is_critical(e)) {
            self.items.remove(i);
            self.stream_count = self.stream_count.saturating_sub(1);
        }
    }

    fn push_stream(&mut self, ev: RpcEvent) {
        while self.stream_count >= STREAM_QUEUE_CAP {
            self.drop_oldest_stream();
        }
        self.items.push_back(ev);
        self.stream_count += 1;
    }

    fn push_critical(&mut self, ev: RpcEvent) {
        self.flush_coalesce();
        self.items.push_back(ev);
    }

    fn append_delta(pending: &mut PendingCoalesce, piece: &str) {
        if let Some(frame) = pending.template.frame.as_mut() {
            if let Some(ame) = frame.get_mut("assistantMessageEvent") {
                if let Some(obj) = ame.as_object_mut() {
                    let prev = obj
                        .get("delta")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    obj.insert("delta".into(), serde_json::Value::String(prev + piece));
                }
            }
        }
        pending.parts += 1;
    }

    fn push(&mut self, ev: RpcEvent) {
        if is_critical(&ev) {
            self.push_critical(ev);
            return;
        }

        if let Some(key) = coalesce_key(&ev) {
            let Some(piece) = delta_text(&ev).map(str::to_string) else {
                self.flush_coalesce();
                self.push_stream(ev);
                return;
            };

            match self.coalesce.as_mut() {
                Some(pending) if pending.key == key => {
                    Self::append_delta(pending, &piece);
                    if pending.parts >= COALESCE_MAX_PARTS
                        || pending.first_at.elapsed() >= COALESCE_WINDOW
                    {
                        self.flush_coalesce();
                    }
                }
                Some(_) => {
                    self.flush_coalesce();
                    self.coalesce = Some(PendingCoalesce {
                        template: ev,
                        key,
                        parts: 1,
                        first_at: Instant::now(),
                    });
                }
                None => {
                    self.coalesce = Some(PendingCoalesce {
                        template: ev,
                        key,
                        parts: 1,
                        first_at: Instant::now(),
                    });
                }
            }
            return;
        }

        self.flush_coalesce();
        self.push_stream(ev);
    }

    fn coalesce_due(&self) -> bool {
        self.coalesce
            .as_ref()
            .is_some_and(|p| p.first_at.elapsed() >= COALESCE_WINDOW)
    }

    fn pop_front(&mut self) -> Option<RpcEvent> {
        let ev = self.items.pop_front()?;
        if !is_critical(&ev) {
            self.stream_count = self.stream_count.saturating_sub(1);
        }
        Some(ev)
    }
}

/// Cloneable handle used by the omp reader tasks (sync `send`, never blocks long).
#[derive(Clone)]
pub struct EventOutbox {
    state: Arc<Mutex<QueueState>>,
    notify: Arc<Notify>,
}

impl EventOutbox {
    pub fn new() -> (Self, EventDrain) {
        let state = Arc::new(Mutex::new(QueueState::new()));
        let notify = Arc::new(Notify::new());
        (
            Self {
                state: state.clone(),
                notify: notify.clone(),
            },
            EventDrain { state, notify },
        )
    }

    pub fn send(&self, ev: RpcEvent) {
        if let Ok(mut guard) = self.state.lock() {
            guard.push(ev);
        }
        self.notify.notify_one();
    }
}

/// Consumer side: drains the outbox into `app.emit("rpc_event", …)`.
pub struct EventDrain {
    state: Arc<Mutex<QueueState>>,
    notify: Arc<Notify>,
}

impl EventDrain {
    /// Runs for the app lifetime (same as the previous unbounded forwarder).
    pub async fn run<F>(self, mut emit: F)
    where
        F: FnMut(RpcEvent) + Send,
    {
        loop {
            let _ = tokio::time::timeout(COALESCE_WINDOW, self.notify.notified()).await;

            loop {
                let ev = {
                    let Ok(mut guard) = self.state.lock() else {
                        break;
                    };
                    if guard.coalesce_due() {
                        guard.flush_coalesce();
                    }
                    guard.pop_front()
                };
                match ev {
                    Some(ev) => emit(ev),
                    None => break,
                }
            }
        }
    }
}
