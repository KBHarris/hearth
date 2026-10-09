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

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DeviceRestore {
    pub enrollment: DeviceEnrollment,
    pub link_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DeviceLinkOffer {
    pub id: String,
    pub device_key: String,
    pub envelope: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DeviceLinkEnvelope {
    pub envelope: String,
    pub expires_in_seconds: u32,
}
