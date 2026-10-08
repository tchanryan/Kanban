use kanban_workspace::model::{Result, StorageError};
use std::path::PathBuf;

pub trait FolderDestination {
    fn choose(&self) -> Result<Option<PathBuf>>;
}
pub struct WindowsFolderDestination {
    pub owner: isize,
}
impl FolderDestination for WindowsFolderDestination {
    #[cfg(windows)]
    fn choose(&self) -> Result<Option<PathBuf>> {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt};
        use windows_sys::Win32::{System::Com::CoTaskMemFree, UI::Shell::*};
        let _apartment = crate::windows_dialogs::ComApartment::initialize()?;
        let title: Vec<u16> = "Choose a folder for additional Kanban backups\0"
            .encode_utf16()
            .collect();
        let mut display = vec![0u16; 260];
        let dialog = BROWSEINFOW {
            hwndOwner: self.owner as _,
            pszDisplayName: display.as_mut_ptr(),
            lpszTitle: title.as_ptr(),
            ulFlags: BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_EDITBOX,
            ..Default::default()
        };
        let selected = unsafe { SHBrowseForFolderW(&dialog) };
        if selected.is_null() {
            return Ok(None);
        }
        let mut path = vec![0u16; 32768];
        let resolved =
            unsafe { SHGetPathFromIDListEx(selected, path.as_mut_ptr(), path.len() as u32, 0) };
        unsafe {
            CoTaskMemFree(selected.cast());
        }
        if resolved == 0 {
            return Err(StorageError::invalid("Choose a filesystem folder"));
        }
        let length = path
            .iter()
            .position(|value| *value == 0)
            .ok_or_else(|| StorageError::invalid("Invalid selected folder"))?;
        Ok(Some(PathBuf::from(OsString::from_wide(&path[..length]))))
    }
    #[cfg(not(windows))]
    fn choose(&self) -> Result<Option<PathBuf>> {
        Err(StorageError::invalid(
            "Folder selection is supported on Windows only",
        ))
    }
}
