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
    sidebar_opacity: [u32; 2],
    sidebar_blur: [u32; 2],
    pattern_strength: [u32; 2],
    pattern_size: [u32; 2],
    background_fade: [u32; 2],
    background_vignette: [u32; 2],
    wallpaper_utf16: usize,
    wallpaper_name_utf16: usize,
    wallpaper_pixels: u32,
    custom_themes: usize,
    custom_theme_name_utf16: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    themes: Vec<String>,
    accents: Vec<String>,
    backgrounds: Vec<String>,
    patterns: Vec<String>,
    custom_theme_roles: Vec<String>,
    defaults: serde_json::Value,
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
    pub background_pattern: String,
    pub pattern_strength: u32,
    pub pattern_size: u32,
    pub background_fade: u32,
    pub background_vignette: u32,
    /// Omitted keeps the theme's own pane opacity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_opacity: Option<u32>,
    pub pane_blur: u32,
    /// Omitted keeps the theme's own sidebar opacity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sidebar_opacity: Option<u32>,
    pub sidebar_blur: u32,
    pub auto_colors: bool,
    pub custom_themes: Vec<CustomTheme>,
}

/// A theme the reader made or imported: anchor colors for a dark variant, a
/// light one, or both. The runtime checks its shape and never derives colors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dark: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light: Option<std::collections::BTreeMap<String, String>>,
}

impl Appearance {
    /// Reads a stored record, filling fields added since it was written from
    /// the shared defaults. Updates stay strict; only reading is forgiving, so
    /// an upgrade never loses a reader's appearance.
    pub fn from_stored(stored: serde_json::Value) -> Option<Self> {
        let serde_json::Value::Object(stored) = stored else {
            return None;
        };
        let mut record = fixture().defaults.as_object()?.clone();
        record.extend(stored);
        let appearance: Self = serde_json::from_value(serde_json::Value::Object(record)).ok()?;
        appearance.validate().ok()?;
        Some(appearance)
    }
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

/// Lowercase letters, digits and hyphens, starting with a letter or digit.
fn is_custom_theme_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=32).contains(&bytes.len())
        && bytes[0] != b'-'
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

impl CustomTheme {
    fn validate(&self) -> Result<(), JamError> {
        let fixture = fixture();
        if !is_custom_theme_id(&self.id) {
            return Err(JamError::invalid(
                "A custom theme id must be lowercase letters, digits and hyphens.",
            ));
        }
        if self.name.trim().is_empty()
            || utf16(&self.name) > fixture.limits.custom_theme_name_utf16
            || self.name.chars().any(char::is_control)
        {
            return Err(JamError::invalid("A custom theme needs a short name."));
        }
        if self.dark.is_none() && self.light.is_none() {
            return Err(JamError::invalid(
                "A custom theme needs a dark or a light variant.",
            ));
        }
        let complete = |colors: &std::collections::BTreeMap<String, String>| {
            colors.len() == fixture.custom_theme_roles.len()
                && fixture
                    .custom_theme_roles
                    .iter()
                    .all(|role| colors.get(role).is_some_and(|color| is_hex_color(color)))
        };
        if ![&self.dark, &self.light]
            .into_iter()
            .flatten()
            .all(complete)
        {
            return Err(JamError::invalid(
                "A custom theme variant must give every role as #rrggbb.",
            ));
        }
        Ok(())
    }

    fn has(&self, scheme: &str) -> bool {
        match scheme {
            "dark" => self.dark.is_some(),
            "light" => self.light.is_some(),
            _ => false,
        }
    }
}

fn within(value: u32, [min, max]: [u32; 2]) -> bool {
    (min..=max).contains(&value)
}

impl Appearance {
    pub fn validate(&self) -> Result<(), JamError> {
        let fixture = fixture();
        let limits = &fixture.limits;
        if self.custom_themes.len() > limits.custom_themes {
            return Err(JamError::invalid("Too many custom themes."));
        }
        for (index, theme) in self.custom_themes.iter().enumerate() {
            theme.validate()?;
            if self.custom_themes[..index]
                .iter()
                .any(|other| other.id == theme.id)
            {
                return Err(JamError::invalid("Custom theme ids must be unique."));
            }
        }
        // A built-in, or `custom:<id>:<dark|light>` naming a variant that exists.
        let custom = self
            .theme
            .strip_prefix("custom:")
            .and_then(|rest| rest.rsplit_once(':'))
            .is_some_and(|(id, scheme)| {
                self.custom_themes
                    .iter()
                    .any(|theme| theme.id == id && theme.has(scheme))
            });
        if !fixture.themes.contains(&self.theme) && !custom {
            return Err(JamError::invalid("Unknown theme."));
        }
        if !fixture.accents.contains(&self.accent) {
            return Err(JamError::invalid("Unknown accent."));
        }
        if !fixture.backgrounds.contains(&self.background) {
            return Err(JamError::invalid("Unknown background mode."));
        }
        if !fixture.patterns.contains(&self.background_pattern) {
            return Err(JamError::invalid("Unknown background pattern."));
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
            return Err(JamError::invalid("Colors must be #rrggbb."));
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
            (self.sidebar_blur, limits.sidebar_blur),
            (self.pattern_strength, limits.pattern_strength),
            (self.pattern_size, limits.pattern_size),
            (self.background_fade, limits.background_fade),
            (self.background_vignette, limits.background_vignette),
        ];
        if !ranges
            .into_iter()
            .all(|(value, range)| within(value, range))
            || self
                .pane_opacity
                .is_some_and(|value| !within(value, limits.pane_opacity))
            || self
                .sidebar_opacity
                .is_some_and(|value| !within(value, limits.sidebar_opacity))
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
    fn rejects_unknown_names_colors_fonts_and_ranges() {
        assert!(appearance(json!({ "theme": "neon" })).is_err());
        assert!(appearance(json!({ "accent": "chartreuse" })).is_err());
        assert!(appearance(json!({ "background": "video" })).is_err());
        assert!(appearance(json!({ "customAccent": "#FFF" })).is_err());
        assert!(appearance(json!({ "customAccent": "red" })).is_err());
        assert!(appearance(json!({ "codeFont": "x'; } body { color: red" })).is_err());
        assert!(appearance(json!({ "uiFontSize": 40 })).is_err());
        assert!(appearance(json!({ "paneOpacity": 101 })).is_err());
        assert!(appearance(json!({ "surprise": true })).is_err());
        assert!(appearance(json!({ "backgroundPattern": "plasma" })).is_err());
        assert!(appearance(json!({ "sidebarOpacity": 101 })).is_err());
        assert!(appearance(json!({ "autoColors": "yes" })).is_err());
        assert!(appearance(json!({ "theme": "github-dark-dimmed", "paneOpacity": 0 })).is_ok());
        assert!(appearance(json!({ "codeFont": "JetBrains Mono" })).is_ok());
    }

    #[test]
    fn records_from_an_earlier_version_read_with_new_fields_defaulted() {
        let mut old = defaults();
        let object = old.as_object_mut().unwrap();
        for key in [
            "backgroundPattern",
            "sidebarBlur",
            "autoColors",
            "backgroundFade",
            "customThemes",
        ] {
            object.remove(key);
        }
        object.insert("theme".into(), json!("frost"));
        let read = Appearance::from_stored(old).expect("an older record still reads");
        assert_eq!(read.theme, "frost");
        assert_eq!(read.background_pattern, "none");
        assert!(!read.auto_colors);
        assert!(read.custom_themes.is_empty());
        assert!(Appearance::from_stored(json!({ "theme": "neon" })).is_none());
        assert!(Appearance::from_stored(json!([])).is_none());
    }

    fn colors(value: &str) -> serde_json::Value {
        let roles: Vec<String> = serde_json::from_value(
            serde_json::from_str::<serde_json::Value>(include_str!(
                "../../../packages/protocol/fixtures/appearance.json"
            ))
            .unwrap()["customThemeRoles"]
                .clone(),
        )
        .unwrap();
        serde_json::Value::Object(roles.into_iter().map(|role| (role, json!(value))).collect())
    }

    #[test]
    fn custom_themes_are_bounded_and_the_active_one_must_exist() {
        let harbour = json!({ "id": "harbour", "name": "Harbour", "dark": colors("#336699") });
        assert!(appearance(json!({ "customThemes": [harbour.clone()] })).is_ok());
        assert!(
            appearance(
                json!({ "customThemes": [harbour.clone()], "theme": "custom:harbour:dark" })
            )
            .is_ok()
        );
        assert!(
            appearance(
                json!({ "customThemes": [harbour.clone()], "theme": "custom:harbour:light" })
            )
            .is_err()
        );
        assert!(appearance(json!({ "theme": "custom:harbour:dark" })).is_err());
        assert!(appearance(json!({ "customThemes": [harbour.clone(), harbour.clone()] })).is_err());
        let with = |key: &str, value: serde_json::Value| {
            let mut theme = harbour.clone();
            theme[key] = value;
            appearance(json!({ "customThemes": [theme] }))
        };
        assert!(with("id", json!("Harbour!")).is_err());
        assert!(with("name", json!("")).is_err());
        assert!(with("name", json!("line\nbreak")).is_err());
        assert!(with("name", json!("a".repeat(49))).is_err());
        assert!(with("dark", json!({ "canvas": "#000000" })).is_err());
        let mut short = colors("#000000");
        short["canvas"] = json!("red");
        assert!(with("dark", short).is_err());
        assert!(appearance(json!({ "customThemes": [{ "id": "a", "name": "A" }] })).is_err());
        let many: Vec<_> = (0..33)
            .map(|index| json!({ "id": format!("t{index}"), "name": "T", "light": colors("#eeeeee") }))
            .collect();
        assert!(appearance(json!({ "customThemes": many })).is_err());
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
