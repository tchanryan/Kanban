use kanban_workspace::{
    contracts::{Runtime, SystemRuntime},
    model::*,
    portable::{PortableBackup, MAX_BACKUP_BYTES},
};
use std::{fs, io::Write, path::PathBuf};

pub trait SaveDestination {
    fn choose(&self, encrypted: bool) -> Result<Option<PathBuf>>;
}

pub struct PortableFileDelivery<P: SaveDestination> {
    picker: P,
}
impl<P: SaveDestination> PortableFileDelivery<P> {
    pub fn new(picker: P) -> Self {
        Self { picker }
    }
    pub fn save(&self, payload: &str, encrypted: bool) -> Result<bool> {
        if payload.len() > MAX_BACKUP_BYTES {
            return Err(StorageError::invalid("Backup exceeds 100 MB safety limit"));
        }
        let value: serde_json::Value = serde_json::from_str(payload)?;
        if encrypted {
            if value["format"] != "kanban-calendar-encrypted"
                || value["version"] != 1
                || value["kdf"] != "PBKDF2-SHA256"
                || value["iterations"] != 600000
                || !["salt", "iv", "ciphertext"]
                    .iter()
                    .all(|key| value[*key].as_str().is_some_and(|v| !v.is_empty()))
            {
                return Err(StorageError::invalid("Invalid encrypted backup envelope"));
            }
        } else {
            serde_json::from_value::<PortableBackup>(value)?.validate()?;
        }
        let Some(path) = self.picker.choose(encrypted)? else {
            return Ok(false);
        };
        if !path.is_absolute()
            || path
                .extension()
                .is_none_or(|v| !v.eq_ignore_ascii_case("json"))
        {
            return Err(StorageError::invalid(
                "Choose an absolute JSON backup filename",
            ));
        }
        let parent = path
            .parent()
            .ok_or_else(|| StorageError::invalid("Invalid export destination"))?;
        let pending = parent.join(format!(".kanban-{}.pending", SystemRuntime.id()));
        let result = (|| -> Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&pending)?;
            file.write_all(payload.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&pending, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&pending);
        }
        result?;
        Ok(true)
    }
}

pub struct WindowsSaveDestination {
    pub owner: isize,
}
impl SaveDestination for WindowsSaveDestination {
    #[cfg(windows)]
    fn choose(&self, encrypted: bool) -> Result<Option<PathBuf>> {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt};
        use windows_sys::Win32::UI::Controls::Dialogs::*;
        let _apartment = crate::windows_dialogs::ComApartment::initialize()?;
        let mut path = vec![0u16; 32768];
        let name = if encrypted {
            "kanban-encrypted-backup.json"
        } else {
            "kanban-backup.json"
        };
        for (target, value) in path.iter_mut().zip(name.encode_utf16()) {
            *target = value;
        }
        let filter: Vec<u16> = "JSON backup\0*.json\0\0".encode_utf16().collect();
        let extension: Vec<u16> = "json\0".encode_utf16().collect();
        let title: Vec<u16> = "Save Kanban backup\0".encode_utf16().collect();
        let mut dialog = OPENFILENAMEW {
            lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
            hwndOwner: self.owner as _,
            lpstrFilter: filter.as_ptr(),
            lpstrFile: path.as_mut_ptr(),
            nMaxFile: path.len() as u32,
            lpstrDefExt: extension.as_ptr(),
            lpstrTitle: title.as_ptr(),
            Flags: OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_EXPLORER,
            ..Default::default()
        };
        // All buffers outlive the synchronous OS dialog; only its chosen path reaches the writer.
        if unsafe { GetSaveFileNameW(&mut dialog) } == 0 {
            if unsafe { CommDlgExtendedError() } != 0 {
                return Err(StorageError::invalid("Could not open the save dialog"));
            }
            return Ok(None);
        }
        let length = path
            .iter()
            .position(|v| *v == 0)
            .ok_or_else(|| StorageError::invalid("Invalid selected filename"))?;
        Ok(Some(PathBuf::from(OsString::from_wide(&path[..length]))))
    }
    #[cfg(not(windows))]
    fn choose(&self, _: bool) -> Result<Option<PathBuf>> {
        Err(StorageError::invalid(
            "This preview supports Windows file delivery only",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixed(Option<PathBuf>);
    impl SaveDestination for Fixed {
        fn choose(&self, _: bool) -> Result<Option<PathBuf>> {
            Ok(self.0.clone())
        }
    }
    const ENCRYPTED: &str = r#"{"format":"kanban-calendar-encrypted","version":1,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"test","iv":"test","ciphertext":"test"}"#;
    #[test]
    fn delivery_preserves_exact_bytes_and_cancel_leaves_existing_file_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        fs::write(&path, "previous export").unwrap();
        assert!(!PortableFileDelivery::new(Fixed(None))
            .save(ENCRYPTED, true)
            .unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "previous export");
        assert!(PortableFileDelivery::new(Fixed(Some(path.clone())))
            .save(ENCRYPTED, true)
            .unwrap());
        assert_eq!(fs::read_to_string(path).unwrap(), ENCRYPTED);
    }
    #[test]
    fn invalid_data_and_unavailable_destination_cannot_replace_existing_export() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        fs::write(&path, "original").unwrap();
        assert!(PortableFileDelivery::new(Fixed(Some(path.clone())))
            .save("{}", false)
            .is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "original");
        assert!(
            PortableFileDelivery::new(Fixed(Some(dir.path().join("missing/backup.json"))))
                .save(ENCRYPTED, true)
                .is_err()
        );
    }
}
