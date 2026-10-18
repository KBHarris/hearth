use crate::{
    auth::Account, community::Community, device::DeviceEnrollment, messaging::GroupMember,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AccountDeparture {
    pub member: GroupMember,
    pub operation_id: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ExportRecord {
    pub cursor: String,
    #[cfg_attr(feature = "typescript", ts(type = "unknown"))]
    pub data: serde_json::Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct AccountExport {
    pub account: Account,
    pub devices: Vec<DeviceEnrollment>,
    pub communities: Vec<Community>,
    pub blocks: Vec<Account>,
    pub records: Vec<ExportRecord>,
    pub next: Option<String>,
}
