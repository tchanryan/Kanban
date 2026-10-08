use super::snapshots::write_new;
use crate::model::{Result, StorageError};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseRecord {
    version: String,
}
pub(crate) fn recorded_version(directory: &Path) -> Result<Option<String>> {
    let path = directory.join("APP_VERSION.json");
    if !path.exists() {
        return Ok(None);
    }
    let record: ReleaseRecord = serde_json::from_slice(&fs::read(path)?)?;
    version(&record.version)?;
    Ok(Some(record.version))
}

pub(crate) fn version(value: &str) -> Result<[u32; 3]> {
    let components: Vec<_> = value.split('.').collect();
    if components.len() != 3 {
        return Err(StorageError::invalid(
            "Application version must contain three numeric components",
        ));
    }
    let mut parsed = [0; 3];
    for (index, component) in components.iter().enumerate() {
        if component.is_empty()
            || !component.bytes().all(|byte| byte.is_ascii_digit())
            || (component.len() > 1 && component.starts_with('0'))
        {
            return Err(StorageError::invalid("Invalid application version"));
        }
        parsed[index] = component
            .parse()
            .map_err(|_| StorageError::invalid("Application version is out of range"))?;
    }
    Ok(parsed)
}

/// Checked before any writable database is opened, including recovery copies.
pub(crate) fn needs_backup(directory: &Path, current: &str) -> Result<bool> {
    let current_version = version(current)?;
    let path = directory.join("APP_VERSION.json");
    if !path.exists() {
        if directory.join("release-initialized").exists() {
            return Err(StorageError::invalid(
                "Application version metadata is missing. Original files are retained.",
            ));
        }
        return Ok(true);
    }
    let previous: ReleaseRecord = serde_json::from_slice(&fs::read(path)?)?;
    let previous_version = version(&previous.version)?;
    if current_version < previous_version {
        return Err(StorageError::invalid(format!("This workspace was opened by version {}. Use that version or a newer application; data has been retained.", previous.version)));
    }
    Ok(current_version > previous_version)
}

pub(crate) fn publish(directory: &Path, current: &str, token: &str) -> Result<()> {
    version(current)?;
    uuid::Uuid::parse_str(token)
        .map_err(|_| StorageError::invalid("Invalid release publication identity"))?;
    let pending = directory.join(format!("{token}.release-pending"));
    write_new(
        &pending,
        &serde_json::to_vec(&ReleaseRecord {
            version: current.into(),
        })?,
    )?;
    fs::rename(pending, directory.join("APP_VERSION.json"))?;
    // Publishing metadata first leaves a recoverable version record if marker creation fails.
    if !directory.join("release-initialized").exists() {
        write_new(&directory.join("release-initialized"), b"kanban-release-1")?;
    }
    Ok(())
}
