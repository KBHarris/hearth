//! Client-only activities, carried inside signed MLS application content.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ScheduledEvent {
    pub title: String,
    pub description: String,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub starts_at: u64,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub ends_at: u64,
    pub location: String,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum Rsvp {
    Going,
    Interested,
    Declined,
}
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum PlaybackProvider {
    Youtube,
    Spotify,
    Soundcloud,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct PlaybackPosition {
    pub revision: u32,
    pub playing: bool,
    pub position_ms: u32,
    #[cfg_attr(feature = "typescript", ts(type = "number"))]
    pub sent_at: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct SharedPlayback {
    pub title: String,
    pub provider: PlaybackProvider,
    pub url: String,
    pub position: PlaybackPosition,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum Activity {
    Event {
        event: ScheduledEvent,
    },
    EventCancel {
        id: String,
    },
    Rsvp {
        id: String,
        response: Rsvp,
    },
    Playback {
        playback: SharedPlayback,
    },
    PlaybackUpdate {
        id: String,
        position: PlaybackPosition,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct LocalEvent {
    pub event: ScheduledEvent,
    pub cancelled: bool,
    pub rsvps: std::collections::BTreeMap<String, Rsvp>,
}
