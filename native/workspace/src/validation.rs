use crate::model::*;
use serde::Serialize;

pub fn trim(value: &str) -> &str {
    value.trim_matches(|c|matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))
}

pub fn title(value: &str) -> Result<String> {
    let value = trim(value);
    if value.is_empty() || value.encode_utf16().count() > 200 {
        return Err(StorageError::invalid(
            "Title must contain 1–200 UTF-16 code units",
        ));
    }
    Ok(value.into())
}
pub fn text(value: &str) -> Result<()> {
    if value.encode_utf16().count() > 1_000_000 {
        Err(StorageError::invalid("Text exceeds 1 MB limit"))
    } else {
        Ok(())
    }
}
pub fn validate_record<T: Serialize>(record: &T) -> Result<()> {
    let value = serde_json::to_value(record)?;
    let object = value
        .as_object()
        .ok_or_else(|| StorageError::invalid("Invalid record"))?;
    for (field, value) in object {
        if value.is_null() {
            continue;
        }
        if field == "id" || field.ends_with("Id") {
            let id = value
                .as_str()
                .ok_or_else(|| StorageError::invalid("Invalid identifier"))?;
            if !(field == "id" && (id == "app" || id == "global"))
                && uuid::Uuid::parse_str(id).is_err()
            {
                return Err(StorageError::invalid("Invalid UUID"));
            }
        }
        if field.ends_with("At") || field == "archiveAfter" {
            chrono::DateTime::parse_from_rfc3339(value.as_str().unwrap_or(""))
                .map_err(|_| StorageError::invalid("Invalid timestamp"))?;
        }
        if field.ends_with("Date") {
            let date = value.as_str().unwrap_or("");
            if date.len() != 10 || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
                return Err(StorageError::invalid("Invalid calendar date"));
            }
        }
        if field == "title" || field == "name" {
            title(value.as_str().unwrap_or(""))?;
        }
        if field == "description" || field == "content" {
            text(value.as_str().unwrap_or(""))?;
        }
        if field == "revision"
            && !(1..=9_007_199_254_740_991).contains(&value.as_u64().unwrap_or(0))
        {
            return Err(StorageError::invalid("Invalid revision"));
        }
        if field == "orderKey" {
            crate::ordering::validate(value.as_str().unwrap_or(""))?;
        }
    }
    if let (Some(start), Some(end)) = (
        value["plannedStartDate"].as_str(),
        value["dueDate"].as_str(),
    ) {
        if start > end {
            return Err(StorageError::invalid(
                "Planned start must be on or before due date",
            ));
        }
    }
    Ok(())
}
