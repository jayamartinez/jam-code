//! Appearance settings: the persistent record of how JAM draws.
//!
//! The runtime stores and validates the record; it never interprets it. Theme
//! and accent names, and every numeric bound, come from the fixture shared
//! with `@jam/protocol`, so the client and the runtime cannot disagree about
//! what is valid.
use crate::error::JamError;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Limits {
    font_utf16: usize,
    ui_font_size: [u32; 2],
    code_font_size: [u32; 2],
    code_line_height: [u32; 2],
    terminal_font_size: [u32; 2],
    terminal_line_height: [u32; 2],
    gradient_angle: [u32; 2],
    background_brightness: [u32; 2],
    background_saturation: [u32; 2],
    background_blur: [u32; 2],
    pane_opacity: [u32; 2],
    pane_blur: [u32; 2],
    wallpaper_utf16: usize,
    wallpaper_name_utf16: usize,
    wallpaper_pixels: u32,
}

#[derive(Deserialize)]
struct Fixture {
    themes: Vec<String>,
    accents: Vec<String>,
    backgrounds: Vec<String>,
    limits: Limits,
}

fn fixture() -> &'static Fixture {
    static FIXTURE: std::sync::OnceLock<Fixture> = std::sync::OnceLock::new();
    FIXTURE.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/appearance.json"
        ))
        .expect("the appearance fixture is valid")
    })
}

/// Every field is required: an update replaces the whole record, so a stored
/// record is always complete for the version that wrote it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Appearance {
    pub theme: String,
    pub accent: String,
    pub custom_accent: String,
    pub ui_font: String,
    pub ui_font_size: u32,
    pub code_font: String,
    pub code_font_size: u32,
    pub code_line_height: u32,
    pub terminal_font: String,
    pub terminal_font_size: u32,
    pub terminal_line_height: u32,
    pub background: String,
    pub background_color: String,
    pub gradient_from: String,
    pub gradient_to: String,
    pub gradient_angle: u32,
    pub background_brightness: u32,
    pub background_saturation: u32,
    pub background_blur: u32,
    /// Omitted keeps the theme's own pane opacity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_opacity: Option<u32>,
    pub pane_blur: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Wallpaper {
    pub data_url: String,
    /// The original file name, for display. Never a path.
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateAppearance {
    pub appearance: Appearance,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetWallpaper {
    pub wallpaper: Option<Wallpaper>,
}

fn utf16(value: &str) -> usize {
    value.encode_utf16().count()
}

fn is_hex_color(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}

/// Letters, digits, spaces and `._-`: every real family name, and never
/// enough to escape the quoted CSS string a client places it in.
fn is_font_family(value: &str) -> bool {
    utf16(value) <= fixture().limits.font_utf16
        && value
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
}

fn within(value: u32, [min, max]: [u32; 2]) -> bool {
    (min..=max).contains(&value)
}

impl Appearance {
    pub fn validate(&self) -> Result<(), JamError> {
        let fixture = fixture();
        let limits = &fixture.limits;
        if !fixture.themes.contains(&self.theme) {
            return Err(JamError::invalid("Unknown theme."));
        }
        if !fixture.accents.contains(&self.accent) {
            return Err(JamError::invalid("Unknown accent."));
        }
        if !fixture.backgrounds.contains(&self.background) {
            return Err(JamError::invalid("Unknown background mode."));
        }
        if ![
            &self.custom_accent,
            &self.background_color,
            &self.gradient_from,
            &self.gradient_to,
        ]
        .iter()
        .all(|color| is_hex_color(color))
        {
            return Err(JamError::invalid("Colours must be #rrggbb."));
        }
        if ![&self.ui_font, &self.code_font, &self.terminal_font]
            .iter()
            .all(|font| is_font_family(font))
        {
            return Err(JamError::invalid(
                "A font family name is too long or has unsupported characters.",
            ));
        }
        let ranges = [
            (self.ui_font_size, limits.ui_font_size),
            (self.code_font_size, limits.code_font_size),
            (self.code_line_height, limits.code_line_height),
            (self.terminal_font_size, limits.terminal_font_size),
            (self.terminal_line_height, limits.terminal_line_height),
            (self.gradient_angle, limits.gradient_angle),
            (self.background_brightness, limits.background_brightness),
            (self.background_saturation, limits.background_saturation),
            (self.background_blur, limits.background_blur),
            (self.pane_blur, limits.pane_blur),
        ];
        if !ranges
            .into_iter()
            .all(|(value, range)| within(value, range))
            || self
                .pane_opacity
                .is_some_and(|value| !within(value, limits.pane_opacity))
        {
            return Err(JamError::invalid("An appearance value is out of range."));
        }
        Ok(())
    }
}

impl Wallpaper {
    pub fn validate(&self) -> Result<(), JamError> {
        let limits = &fixture().limits;
        let data = ["jpeg", "png", "webp"].iter().find_map(|kind| {
            self.data_url
                .strip_prefix(&format!("data:image/{kind};base64,"))
        });
        let base64 = |data: &str| {
            let body = data.trim_end_matches('=');
            !body.is_empty()
                && data.len() - body.len() <= 2
                && body
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
        };
        if utf16(&self.data_url) > limits.wallpaper_utf16 || !data.is_some_and(base64) {
            return Err(JamError::invalid(
                "A wallpaper must be inline JPEG, PNG or WebP data within the size limit.",
            ));
        }
        if utf16(&self.name) > limits.wallpaper_name_utf16
            || self.name.contains(['/', '\\'])
            || !(1..=limits.wallpaper_pixels).contains(&self.width)
            || !(1..=limits.wallpaper_pixels).contains(&self.height)
        {
            return Err(JamError::invalid(
                "A wallpaper's name or dimensions are invalid.",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn defaults() -> serde_json::Value {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/appearance.json"
        ))
        .unwrap();
        fixture["defaults"].clone()
    }

    fn appearance(changes: serde_json::Value) -> Result<Appearance, JamError> {
        let mut value = defaults();
        for (key, item) in changes.as_object().unwrap() {
            value[key] = item.clone();
        }
        let parsed: Appearance =
            serde_json::from_value(value).map_err(|_| JamError::invalid("structure"))?;
        parsed.validate()?;
        Ok(parsed)
    }

    #[test]
    fn the_shared_defaults_are_valid() {
        assert!(appearance(json!({})).is_ok());
        assert!(appearance(json!({ "paneOpacity": 90 })).is_ok());
    }

    #[test]
    fn rejects_unknown_names_colours_fonts_and_ranges() {
        assert!(appearance(json!({ "theme": "neon" })).is_err());
        assert!(appearance(json!({ "accent": "chartreuse" })).is_err());
        assert!(appearance(json!({ "background": "video" })).is_err());
        assert!(appearance(json!({ "customAccent": "#FFF" })).is_err());
        assert!(appearance(json!({ "customAccent": "red" })).is_err());
        assert!(appearance(json!({ "codeFont": "x'; } body { color: red" })).is_err());
        assert!(appearance(json!({ "uiFontSize": 40 })).is_err());
        assert!(appearance(json!({ "paneOpacity": 5 })).is_err());
        assert!(appearance(json!({ "surprise": true })).is_err());
        assert!(appearance(json!({ "codeFont": "JetBrains Mono" })).is_ok());
    }

    #[test]
    fn wallpapers_must_be_bounded_inline_images() {
        let wallpaper = |data_url: &str, name: &str| Wallpaper {
            data_url: data_url.into(),
            name: name.into(),
            width: 1920,
            height: 1080,
        };
        assert!(
            wallpaper("data:image/jpeg;base64,/9j/4AAQ", "sea.jpg")
                .validate()
                .is_ok()
        );
        assert!(
            wallpaper("data:image/svg+xml;base64,PHN2Zz4=", "a.svg")
                .validate()
                .is_err()
        );
        assert!(
            wallpaper("https://example.com/a.jpg", "a.jpg")
                .validate()
                .is_err()
        );
        assert!(
            wallpaper("data:image/png;base64,<script>", "a.png")
                .validate()
                .is_err()
        );
        assert!(
            wallpaper("data:image/png;base64,AAAA", "/Users/me/a.png")
                .validate()
                .is_err()
        );
    }
}
