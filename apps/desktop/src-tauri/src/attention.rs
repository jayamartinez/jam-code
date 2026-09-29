//! Telling the user about chats outside JAM's window: the count badge on the
//! taskbar (Windows overlay icon, macOS Dock label) and tray icon, and system
//! notifications. The client decides when; the host validates what it draws.

use tauri::{AppHandle, Window, image::Image};
use tauri_plugin_notification::NotificationExt;

/// Badge images are drawn at the icon's device size, within these bounds.
const MIN_SIZE: u32 = 16;
const MAX_SIZE: u32 = 64;
const MAX_COUNT: u32 = 999;
const MAX_TITLE: usize = 120;
const MAX_BODY: usize = 240;

/// The tray badge's side for an icon of `size` pixels; the client uses the same rule.
fn tray_badge_size(size: u32) -> u32 {
    size * 5 / 8
}

#[derive(serde::Deserialize)]
pub struct Badge {
    count: u32,
    /// The icon's side in device pixels.
    size: u32,
    /// The taskbar overlay, `size` pixels square, RGBA.
    overlay: Vec<u8>,
    /// The tray badge, `tray_badge_size(size)` pixels square, RGBA.
    tray: Vec<u8>,
}

impl Badge {
    fn validate(&self) -> Result<(), String> {
        let square = |side: u32| (side * side * 4) as usize;
        if self.count == 0 || self.count > MAX_COUNT {
            return Err("The badge count is out of range.".into());
        }
        if !(MIN_SIZE..=MAX_SIZE).contains(&self.size)
            || self.overlay.len() != square(self.size)
            || self.tray.len() != square(tray_badge_size(self.size))
        {
            return Err("The badge images have the wrong size.".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub fn set_attention_badge(
    app: AppHandle,
    window: Window,
    badge: Option<Badge>,
) -> Result<(), String> {
    if let Some(badge) = &badge {
        badge.validate()?;
    }
    #[cfg(windows)]
    window
        .set_overlay_icon(
            badge
                .as_ref()
                .map(|badge| Image::new(&badge.overlay, badge.size, badge.size)),
        )
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    window
        .set_badge_label(badge.as_ref().map(|badge| badge.count.to_string()))
        .map_err(|error| error.to_string())?;
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = window;

    if let Some(tray) = app.tray_by_id("jam") {
        let base = crate::lifecycle::tray_image().map_err(|error| error.to_string())?;
        let icon = match &badge {
            Some(badge) => with_badge(&shrink(&base, badge.size), &badge.tray),
            None => base,
        };
        tray.set_icon(Some(icon))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The icon at `size` pixels, each averaging its area of the original, so
/// the OS shows it without rescaling again.
fn shrink(base: &Image<'_>, size: u32) -> Image<'static> {
    let (width, height) = (base.width(), base.height());
    let source = base.rgba();
    let mut pixels = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        let (top, bottom) = (
            y * height / size,
            ((y + 1) * height / size).max(y * height / size + 1),
        );
        for x in 0..size {
            let (left, right) = (
                x * width / size,
                ((x + 1) * width / size).max(x * width / size + 1),
            );
            // Colour is weighted by alpha so transparent edges don't darken it.
            let mut sums = [0u64; 4];
            for sy in top..bottom {
                for sx in left..right {
                    let at = ((sy * width + sx) * 4) as usize;
                    let alpha = u64::from(source[at + 3]);
                    for channel in 0..3 {
                        sums[channel] += u64::from(source[at + channel]) * alpha;
                    }
                    sums[3] += alpha;
                }
            }
            let area = u64::from((bottom - top) * (right - left));
            for channel in 0..3 {
                pixels.push(sums[channel].checked_div(sums[3]).unwrap_or(0) as u8);
            }
            pixels.push((sums[3] / area) as u8);
        }
    }
    Image::new_owned(pixels, size, size)
}

/// The icon with the badge over its lower-right corner, pixel for pixel.
fn with_badge(base: &Image<'_>, badge: &[u8]) -> Image<'static> {
    let size = base.width();
    let side = tray_badge_size(size);
    let offset = size - side;
    let mut pixels = base.rgba().to_vec();
    for y in 0..side {
        for x in 0..side {
            let source = ((y * side + x) * 4) as usize;
            let alpha = u32::from(badge[source + 3]);
            let target = (((offset + y) * size + offset + x) * 4) as usize;
            for channel in 0..3 {
                let over = u32::from(badge[source + channel]);
                let under = u32::from(pixels[target + channel]);
                pixels[target + channel] = ((over * alpha + under * (255 - alpha)) / 255) as u8;
            }
            let under = u32::from(pixels[target + 3]);
            pixels[target + 3] = (alpha + under * (255 - alpha) / 255) as u8;
        }
    }
    Image::new_owned(pixels, size, size)
}

#[tauri::command]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let title: String = title
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TITLE)
        .collect();
    let body: String = body
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_BODY)
        .collect();
    if title.trim().is_empty() {
        return Err("A notification needs a title.".into());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tray_icon_is_shrunk_then_badged_in_its_corner() {
        let base = Image::new_owned(vec![10; 512 * 512 * 4], 512, 512);
        let small = shrink(&base, 24);
        assert_eq!((small.width(), small.height()), (24, 24));
        assert_eq!(small.rgba()[0], 10);
        let side = tray_badge_size(24);
        let icon = with_badge(&small, &vec![200; (side * side * 4) as usize]);
        let at = |x: u32, y: u32| u32::from(icon.rgba()[((y * 24 + x) * 4) as usize]);
        assert_eq!(at(0, 0), 10);
        assert_eq!(at(23, 23), (200 * 200 + 10 * 55) / 255);
    }
}
