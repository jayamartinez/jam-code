use crate::Host;
use jam_runtime::{
    JamError,
    protocol::{Event, Request, SubscriptionScope},
    terminal::TerminalEvent,
};
use serde_json::Value;
use std::sync::Arc;
use tauri::{State, ipc::Channel};

#[tauri::command]
pub async fn jam_request(
    app: tauri::AppHandle,
    request: Value,
    host: State<'_, Host>,
) -> Result<Value, JamError> {
    let request: Request = serde_json::from_value(request)
        .map_err(|_| JamError::invalid("Invalid JAM request envelope."))?;
    let runtime = Arc::clone(&host.runtime);
    // SQLite does not run on the window event loop or block Tokio's async workers.
    let method = request.method.clone();
    let result = tauri::async_runtime::spawn_blocking(move || runtime.request(request))
        .await
        .map_err(|_| JamError::new("internal", "The runtime request could not complete."))?;
    if result.is_ok() {
        crate::snapshots::after_request(&app, &method);
    }
    result
}

#[tauri::command]
pub fn jam_subscribe(
    scope: Value,
    on_event: Channel<Event>,
    host: State<'_, Host>,
) -> Result<String, JamError> {
    if scope.get("resourceId").is_some_and(Value::is_null) {
        return Err(JamError::invalid("Optional scope fields must be omitted."));
    }
    let scope: SubscriptionScope = serde_json::from_value(scope)
        .map_err(|_| JamError::invalid("Invalid subscription scope."))?;
    let subscription = host.runtime.subscribe(scope)?;
    let id = subscription.id.clone();
    let runtime = Arc::clone(&host.runtime);
    tauri::async_runtime::spawn(async move {
        let mut receiver = subscription.receiver;
        while let Some(event) = receiver.recv().await {
            if on_event.send(event).is_err() {
                break;
            }
        }
        let _ = runtime.unsubscribe(&subscription.id);
    });
    Ok(id)
}

#[tauri::command]
pub fn jam_unsubscribe(subscription_id: String, host: State<'_, Host>) -> Result<(), JamError> {
    host.runtime.unsubscribe(&subscription_id)
}

/// Streams one terminal's output to one view. The shell is untouched when the
/// view detaches, the channel closes or the window reloads.
#[tauri::command]
pub fn jam_terminal_attach(
    resource_id: String,
    on_event: Channel<TerminalEvent>,
    host: State<'_, Host>,
) -> Result<String, JamError> {
    host.runtime.attach_terminal(
        &resource_id,
        Box::new(move |event| on_event.send(event).is_ok()),
    )
}

#[tauri::command]
pub fn jam_terminal_detach(attachment_id: String, host: State<'_, Host>) -> Result<(), JamError> {
    host.runtime.detach_terminal(&attachment_id)
}
