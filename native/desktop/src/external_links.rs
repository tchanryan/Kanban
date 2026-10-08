use kanban_workspace::model::{Result, StorageError};
use tauri::Url;

pub trait BrowserLauncher {
    fn open(&self, address: &str) -> Result<()>;
}

pub struct ExternalLinks<L: BrowserLauncher> {
    launcher: L,
}

impl<L: BrowserLauncher> ExternalLinks<L> {
    pub fn new(launcher: L) -> Self {
        Self { launcher }
    }

    pub fn open(&self, address: &str) -> Result<()> {
        if address.len() > 8192
            || address
                .chars()
                .any(|value| value <= ' ' || value == '\u{7f}')
        {
            return Err(StorageError::invalid("Invalid external web link"));
        }
        let url =
            Url::parse(address).map_err(|_| StorageError::invalid("Invalid external web link"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(StorageError::invalid(
                "Only HTTP or HTTPS links without credentials are supported",
            ));
        }
        self.launcher.open(url.as_str())
    }
}

pub struct SystemBrowser;

impl BrowserLauncher for SystemBrowser {
    fn open(&self, address: &str) -> Result<()> {
        #[cfg(windows)]
        {
            let _apartment = crate::windows_dialogs::ComApartment::initialize()?;
            use windows_sys::Win32::UI::{
                Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL,
            };
            let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
            let destination: Vec<u16> = address.encode_utf16().chain(Some(0)).collect();
            // Buffers remain alive through ShellExecute; no command interpreter or parameters are used.
            let result = unsafe {
                ShellExecuteW(
                    std::ptr::null_mut(),
                    operation.as_ptr(),
                    destination.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                )
            };
            if result as isize <= 32 {
                return Err(StorageError::invalid("Could not open the system browser"));
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = address;
            Err(StorageError::invalid(
                "System browser opening is supported on Windows only",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct RecordingBrowser(RefCell<Vec<String>>);
    impl BrowserLauncher for RecordingBrowser {
        fn open(&self, address: &str) -> Result<()> {
            self.0.borrow_mut().push(address.to_owned());
            Ok(())
        }
    }

    #[test]
    fn validates_before_opening_normalized_web_addresses() {
        let service = ExternalLinks::new(RecordingBrowser(RefCell::new(vec![])));
        for address in [
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,x",
            "mailto:user@example.com",
            "//example.com",
            "/relative",
            "",
            "https://user:secret@example.com",
            "https://example.com\n",
        ] {
            assert!(service.open(address).is_err(), "{address}");
        }
        assert!(service
            .open(&format!("https://example.com/{}", "a".repeat(8192)))
            .is_err());
        assert!(service.launcher.0.borrow().is_empty());
        service.open("https://EXAMPLE.com/path?q=one#two").unwrap();
        assert_eq!(
            service.launcher.0.borrow().as_slice(),
            ["https://example.com/path?q=one#two"]
        );
    }
}
