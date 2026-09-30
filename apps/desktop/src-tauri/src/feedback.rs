//! Help → Report a bug / Suggest a feature / Documentation: JAM Code's own
//! GitHub pages, opened in the default browser. A bug report is prefilled
//! with the app version, OS and WebView only: never paths, projects or chats.

use jam_runtime::{
    JamError,
    system_open::{PROJECT_PAGES, open_project_page},
};

#[tauri::command]
pub fn open_feedback(app: tauri::AppHandle, kind: String) -> Result<(), JamError> {
    let url = match kind.as_str() {
        "bug" => format!(
            "{PROJECT_PAGES}issues/new?template=bug.yml&version={}&environment={}",
            encode(&app.package_info().version.to_string()),
            encode(&environment()),
        ),
        "feature" => format!("{PROJECT_PAGES}issues/new?template=feature.yml"),
        "docs" => format!("{PROJECT_PAGES}#readme"),
        _ => return Err(JamError::invalid("Unknown feedback page.")),
    };
    open_project_page(&url)
}

/// "Windows (x86_64) · WebView2 153.0.4234.48".
fn environment() -> String {
    let os = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        other => other,
    };
    let webview = tauri::webview_version().unwrap_or_else(|_| "unknown".into());
    let engine = if cfg!(windows) { "WebView2" } else { "WebKit" };
    format!("{os} ({}) · {engine} {webview}", std::env::consts::ARCH)
}

/// Percent-encodes a query value: letters, digits and `-._~` stay as they are.
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn query_values_are_percent_encoded() {
        assert_eq!(super::encode("0.1.0-alpha"), "0.1.0-alpha");
        assert_eq!(
            super::encode("macOS (arm64) · x&y"),
            "macOS%20%28arm64%29%20%C2%B7%20x%26y"
        );
    }
}
