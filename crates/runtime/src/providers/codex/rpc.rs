//! One `codex app-server` process and its JSON-RPC connection.
//!
//! Codex speaks JSON-RPC 2.0 over stdio lines without the `jsonrpc` field.
//! Our requests are correlated by ID; server notifications and server
//! requests are routed to the turn that owns their `threadId`. Anything for
//! an unknown thread is answered (requests) or dropped (notifications) so
//! the server is never left waiting on JAM.
use crate::{
    error::JamError,
    providers::process::{LaunchSpec, Output, StdioChild},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug)]
pub(crate) enum Incoming {
    Notification {
        method: String,
        params: Value,
    },
    /// A request Codex waits on. `id` must be echoed in the response.
    Request {
        id: Value,
        method: String,
        params: Value,
    },
    /// The process exited; no further messages will arrive.
    Exited,
}

#[derive(Debug, Clone)]
pub(crate) struct RpcError {
    pub message: String,
}

impl RpcError {
    pub fn into_jam(self, context: &str) -> JamError {
        JamError::new(
            "provider_error",
            format!(
                "{context}: {}",
                crate::providers::bounded(&crate::providers::plain(&self.message), 400)
            ),
        )
    }
}

type Reply = oneshot::Sender<Result<Value, RpcError>>;

pub(crate) struct Connection {
    pub child: StdioChild,
    next_id: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, Reply>>>,
    routes: Arc<Mutex<HashMap<String, mpsc::Sender<Incoming>>>>,
    pub user_agent: Option<String>,
}

pub(crate) const REQUEST_DEADLINE: Duration = Duration::from_secs(60);

impl Connection {
    /// Starts `codex app-server`, performs the initialize handshake and
    /// returns a ready connection.
    pub async fn start(spec: &LaunchSpec, version: &str) -> Result<Arc<Self>, JamError> {
        let (child, lines) = StdioChild::spawn(spec)?;
        let pending: Arc<Mutex<HashMap<i64, Reply>>> = Arc::default();
        let routes: Arc<Mutex<HashMap<String, mpsc::Sender<Incoming>>>> = Arc::default();
        let mut connection = Self {
            child,
            next_id: AtomicI64::new(1),
            pending: Arc::clone(&pending),
            routes: Arc::clone(&routes),
            user_agent: None,
        };
        let (writer_tx, writer_rx) = mpsc::channel::<Value>(64);
        tokio::spawn(read_loop(lines, pending, routes, writer_tx));
        // Responses to server requests JAM cannot route are written here.
        let initialize = json!({
            "clientInfo": {"name": "jam", "title": "JAM Code", "version": version},
            "capabilities": {
                "experimentalApi": false,
                "requestAttestation": false,
                // Carries host and installation identifiers JAM has no use for.
                "optOutNotificationMethods": ["remoteControl/status/changed"]
            }
        });
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            connection.request_raw("initialize", initialize),
        )
        .await
        .map_err(|_| {
            JamError::new(
                "provider_unavailable",
                "Codex did not finish starting within 20 seconds.",
            )
        })?
        .map_err(|error| error.into_jam("Codex refused to start"))?;
        connection.user_agent = result
            .get("userAgent")
            .and_then(Value::as_str)
            .map(str::to_owned);
        connection
            .notify("initialized", None)
            .await
            .map_err(|_| JamError::new("provider_exited", "Codex exited while starting."))?;
        let connection = Arc::new(connection);
        tokio::spawn(write_unrouted(Arc::downgrade(&connection), writer_rx));
        Ok(connection)
    }

    async fn request_raw(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply, receiver) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, reply);
        }
        let sent = self
            .child
            .send(&json!({"id": id, "method": method, "params": params}))
            .await;
        if sent.is_err() {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(RpcError {
                message: "Codex has exited.".into(),
            });
        }
        receiver.await.unwrap_or_else(|_| {
            Err(RpcError {
                message: "Codex exited before answering.".into(),
            })
        })
    }

    /// A request with JAM's standard deadline.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        match tokio::time::timeout(REQUEST_DEADLINE, self.request_raw(method, params)).await {
            Ok(result) => result,
            Err(_) => Err(RpcError {
                message: format!("Codex did not answer {method} within a minute."),
            }),
        }
    }

    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), JamError> {
        let mut message = json!({"method": method});
        if let Some(params) = params {
            message["params"] = params;
        }
        self.child.send(&message).await
    }

    /// Answers a server request.
    pub async fn respond(&self, id: &Value, result: Value) -> Result<(), JamError> {
        self.child.send(&json!({"id": id, "result": result})).await
    }

    pub async fn respond_error(&self, id: &Value, code: i64, message: &str) {
        let _ = self
            .child
            .send(&json!({"id": id, "error": {"code": code, "message": message}}))
            .await;
    }

    /// Routes this thread's notifications and requests to `sender`.
    pub fn route(&self, thread_id: &str, sender: mpsc::Sender<Incoming>) {
        if let Ok(mut routes) = self.routes.lock() {
            routes.insert(thread_id.to_string(), sender);
        }
    }

    pub fn unroute(&self, thread_id: &str, sender: &mpsc::Sender<Incoming>) {
        if let Ok(mut routes) = self.routes.lock()
            && routes
                .get(thread_id)
                .is_some_and(|current| current.same_channel(sender))
        {
            routes.remove(thread_id);
        }
    }

    pub fn alive(&self) -> bool {
        self.child.exited().is_none()
    }
}

async fn read_loop(
    mut lines: mpsc::Receiver<Output>,
    pending: Arc<Mutex<HashMap<i64, Reply>>>,
    routes: Arc<Mutex<HashMap<String, mpsc::Sender<Incoming>>>>,
    unrouted: mpsc::Sender<Value>,
) {
    while let Some(output) = lines.recv().await {
        let Output::Line(line) = output else {
            continue;
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            // Malformed output is skipped, never shown or executed.
            continue;
        };
        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").cloned();
        match (method, id) {
            (None, Some(id)) => {
                let Some(id) = id.as_i64() else { continue };
                let reply = pending.lock().ok().and_then(|mut p| p.remove(&id));
                if let Some(reply) = reply {
                    let result = match message.get("error") {
                        Some(error) => Err(RpcError {
                            message: error
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("Codex reported an error.")
                                .to_string(),
                        }),
                        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    let _ = reply.send(result);
                }
            }
            (Some(method), id) => {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let thread = params
                    .get("threadId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let route = thread
                    .and_then(|thread| routes.lock().ok().and_then(|r| r.get(&thread).cloned()));
                let incoming = match &id {
                    Some(id) => Incoming::Request {
                        id: id.clone(),
                        method: method.to_string(),
                        params,
                    },
                    None => Incoming::Notification {
                        method: method.to_string(),
                        params,
                    },
                };
                let delivered = match route {
                    Some(route) => route.send(incoming).await.is_ok(),
                    None => false,
                };
                if !delivered && let Some(id) = id {
                    // Nobody in JAM can answer; decline rather than hang Codex.
                    let _ = unrouted.send(id).await;
                }
            }
            _ => {}
        }
    }
    // The process is gone: fail every waiter and tell every turn.
    if let Ok(mut pending) = pending.lock() {
        for (_, reply) in pending.drain() {
            let _ = reply.send(Err(RpcError {
                message: "Codex exited.".into(),
            }));
        }
    }
    let routes = routes.lock().map(|r| r.clone()).unwrap_or_default();
    for route in routes.values() {
        let _ = route.send(Incoming::Exited).await;
    }
}

async fn write_unrouted(connection: std::sync::Weak<Connection>, mut ids: mpsc::Receiver<Value>) {
    while let Some(id) = ids.recv().await {
        let Some(connection) = connection.upgrade() else {
            break;
        };
        connection
            .respond_error(&id, -32000, "No JAM session is waiting for this thread.")
            .await;
    }
}
