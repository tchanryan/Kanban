use serde::Serialize;

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct StoredNote {
    pub text: String,
    pub events: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    pub committed: bool,
    pub rolled_back: bool,
    pub reopened: bool,
    pub backup_verified: bool,
}

pub type StorageResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
