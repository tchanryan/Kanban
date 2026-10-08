#[cfg(windows)]
pub struct ComApartment;
#[cfg(windows)]
impl ComApartment {
    pub fn initialize() -> kanban_workspace::model::Result<Self> {
        use windows_sys::Win32::System::Com::{
            CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        };
        let result = unsafe {
            CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            )
        };
        if result < 0 {
            return Err(kanban_workspace::model::StorageError::invalid(
                "Could not initialize the Windows dialog",
            ));
        }
        Ok(Self)
    }
}
#[cfg(windows)]
impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::System::Com::CoUninitialize() };
    }
}
