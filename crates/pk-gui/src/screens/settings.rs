//! User Settings Screen — Audio volumes, screen shake, damage numbers, and pixel-grid rendering.
//!
//! PORTS: `gui/screens/settings.ts`

use crate::im::{fill_rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame};
use crate::theme::Ui;

#[derive(Clone, Debug, PartialEq)]
pub struct UserSettings {
    pub master_volume: f32,
    pub sfx_volume: f32,
    pub music_volume: f32,
    pub screen_shake: bool,
    pub damage_numbers: bool,
    pub pixel_scale: u32,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            master_volume: 0.8,
            sfx_volume: 0.9,
            music_volume: 0.7,
            screen_shake: true,
            damage_numbers: true,
            pixel_scale: 2,
        }
    }
}

/// Paints the user preferences settings panel.
pub fn paint_settings(f: &mut UiFrame, settings: &mut UserSettings, bounds: Rect) {
    fill_rect(f, &bounds, Ui::SCRIM);
    stroke_rect(f, &bounds, Ui::GOLD, 2.0);

    // Header
    let header_rect = Rect {
        x: bounds.x + 8.0,
        y: bounds.y + 8.0,
        w: bounds.w - 16.0,
        h: 24.0,
    };
    fill_rect(f, &header_rect, Ui::SHEET);
    text(
        f,
        "SETTINGS & PREFERENCES",
        header_rect.x + 8.0,
        header_rect.y + 4.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::HEADING),
            align: Align::Left,
            max: None,
        },
    );

    let start_y = header_rect.y + 36.0;

    // Volume Sliders
    let sliders = [
        ("MASTER VOLUME", settings.master_volume),
        ("SFX VOLUME", settings.sfx_volume),
        ("MUSIC VOLUME", settings.music_volume),
    ];

    for (i, (label, val)) in sliders.iter().enumerate() {
        let row_y = start_y + (i as f64 * 32.0);
        text(
            f,
            label,
            bounds.x + 16.0,
            row_y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                align: Align::Left,
                max: None,
            },
        );

        let bar_bg = Rect {
            x: bounds.x + 140.0,
            y: row_y,
            w: 160.0,
            h: 16.0,
        };
        fill_rect(f, &bar_bg, Ui::WELL);
        stroke_rect(f, &bar_bg, Ui::WELL_EDGE, 1.0);

        let fill_w = (160.0 * (*val as f64)).clamp(0.0, 160.0);
        let bar_fill = Rect {
            x: bar_bg.x,
            y: bar_bg.y,
            w: fill_w,
            h: bar_bg.h,
        };
        fill_rect(f, &bar_fill, Ui::GOLD);

        text(
            f,
            &format!("{:.0}%", val * 100.0),
            bar_bg.x + bar_bg.w + 8.0,
            row_y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::GOLD),
                align: Align::Left,
                max: None,
            },
        );
    }

    // Gameplay & Graphics Toggles
    let toggle_start_y = start_y + 110.0;
    let toggles = [
        ("SCREEN SHAKE", settings.screen_shake),
        ("DAMAGE NUMBERS", settings.damage_numbers),
    ];

    for (i, (label, enabled)) in toggles.iter().enumerate() {
        let row_y = toggle_start_y + (i as f64 * 28.0);
        text(
            f,
            label,
            bounds.x + 16.0,
            row_y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                align: Align::Left,
                max: None,
            },
        );

        let btn_rect = Rect {
            x: bounds.x + 140.0,
            y: row_y,
            w: 60.0,
            h: 18.0,
        };
        let bg_col = if *enabled { Ui::GOOD } else { Ui::RAISED };
        let text_col = if *enabled { Ui::WELL } else { Ui::TEXT };

        fill_rect(f, &btn_rect, bg_col);
        stroke_rect(f, &btn_rect, Ui::WELL_EDGE, 1.0);

        text(
            f,
            if *enabled { "ON" } else { "OFF" },
            btn_rect.x + btn_rect.w / 2.0,
            btn_rect.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(text_col),
                align: Align::Center,
                max: None,
            },
        );
    }
}
