use tauri::Url;

pub fn allows_bundled_navigation(url: &Url) -> bool {
    if url.port().is_some() || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_origins_allow_assets_but_reject_alternate_ports_credentials_and_remote_hosts() {
        for address in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://tauri.localhost/assets/app.js",
        ] {
            assert!(
                allows_bundled_navigation(&Url::parse(address).unwrap()),
                "{address}"
            );
        }
        for address in [
            "http://tauri.localhost:6553/",
            "https://tauri.localhost:8443/",
            "http://user:password@tauri.localhost/",
            "http://tauri.localhost.evil.invalid/",
            "https://example.invalid/",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,example",
        ] {
            assert!(
                !allows_bundled_navigation(&Url::parse(address).unwrap()),
                "{address}"
            );
        }
    }
}
