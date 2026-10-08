use serde::{Deserialize, Serialize};

/// Public identity/device proof only; private vault material never crosses REST.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DeviceEnrollment {
    pub identity_key: String,
    pub device_key: String,
    pub certificate: String,
    pub account_signature: String,
    pub device_signature: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AccountIdentity {
    pub identity_key: Option<String>,
    pub devices: Vec<DeviceEnrollment>,
}
