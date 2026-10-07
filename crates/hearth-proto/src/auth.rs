//! Authentication messages contain OPAQUE protocol bytes, never password fields.
use serde::{Deserialize, Serialize};

macro_rules! message {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Clone, Serialize, Deserialize)]
        #[serde(deny_unknown_fields)]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        pub struct $name { $(pub $field: $ty),* }
    };
}
message!(OwnerRegistrationStart {
    username: String,
    message: String,
    setup_code: String
});
message!(OwnerRegistrationFinish {
    username: String,
    message: String,
    setup_code: String
});
message!(LoginStart {
    username: String,
    message: String
});
message!(LoginFinish {
    exchange_id: String,
    message: String
});
message!(AuthResponse {
    message: String,
    profile: String
});
message!(LoginResponse {
    message: String,
    profile: String,
    exchange_id: String
});
message!(Account {
    id: String,
    username: String,
    owner: bool
});
message!(Session {
    token: String,
    expires_in_seconds: u32,
    account: Account
});
