//! Real-time gateway frames (WebSocket, JSON text frames).
//!
//! Every frame is `{"op": "...", "d": {...}}`. Server-to-client events carry a
//! monotonically increasing `seq` so clients can resume after a disconnect.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(tag = "op", content = "d", rename_all = "snake_case")]
pub enum ClientFrame {
    /// First frame after connecting.
    Identify { protocol: u32, token: String },
    Heartbeat {
        #[cfg_attr(feature = "typescript", ts(type = "number | null"))]
        last_seq: Option<u64>,
    },
    Resume {
        session_id: String,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        last_seq: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[serde(tag = "op", content = "d", rename_all = "snake_case")]
pub enum ServerFrame {
    /// Sent immediately on connect.
    Hello {
        protocol: u32,
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        heartbeat_interval_ms: u64,
    },
    HeartbeatAck,
    Ready {
        session_id: String,
    },
    /// Opaque, already-encrypted event for this client.
    Event {
        #[cfg_attr(feature = "typescript", ts(type = "number"))]
        seq: u64,
        #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
        event: serde_json::Value,
    },
    InvalidSession {
        reason: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let f = ServerFrame::Hello {
            protocol: 1,
            heartbeat_interval_ms: 30_000,
        };
        let json = serde_json::to_string(&f).unwrap();
        assert_eq!(
            json,
            r#"{"op":"hello","d":{"protocol":1,"heartbeat_interval_ms":30000}}"#
        );
        assert_eq!(serde_json::from_str::<ServerFrame>(&json).unwrap(), f);
    }
}
