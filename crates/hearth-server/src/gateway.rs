//! WebSocket gateway. Phase 0 only speaks the handshake; Phase 1 adds auth,
//! resume, and encrypted event fan-out.

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use hearth_proto::{
    PROTOCOL_VERSION,
    gateway::{ClientFrame, ServerFrame},
};

use crate::SharedState;

const HEARTBEAT_INTERVAL_MS: u64 = 30_000;

pub async fn upgrade(ws: WebSocketUpgrade, State(_state): State<SharedState>) -> Response {
    ws.on_upgrade(handle)
}

async fn handle(mut socket: WebSocket) {
    let hello = ServerFrame::Hello {
        protocol: PROTOCOL_VERSION,
        heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
    };
    if send(&mut socket, &hello).await.is_err() {
        return;
    }

    while let Some(Ok(msg)) = socket.recv().await {
        let Message::Text(text) = msg else { continue };
        let reply = match serde_json::from_str::<ClientFrame>(&text) {
            Ok(ClientFrame::Heartbeat { .. }) => ServerFrame::HeartbeatAck,
            Ok(ClientFrame::Identify { .. } | ClientFrame::Resume { .. }) => {
                ServerFrame::InvalidSession {
                    reason: "authentication is not implemented yet".into(),
                }
            }
            Err(_) => ServerFrame::InvalidSession {
                reason: "malformed frame".into(),
            },
        };
        if send(&mut socket, &reply).await.is_err() {
            break;
        }
    }
}

async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> Result<(), axum::Error> {
    let text = serde_json::to_string(frame).expect("server frames serialize");
    socket.send(Message::Text(text.into())).await
}
