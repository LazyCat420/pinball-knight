//! Floor Loading & Descent Elevator Screen.
//!
//! PORTS: `gui/screens/floor-loading.ts`

use crate::im::{
    fill_rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame,
};
use crate::theme::Ui;

#[derive(Clone, Debug, PartialEq)]
pub struct FloorLoadingState {
    pub floor_num: u32,
    pub theme_title: String,
    pub modifiers: Vec<String>,
    pub progress: f32,
    pub tip: String,
}

impl Default for FloorLoadingState {
    fn default() -> Self {
        Self {
            floor_num: 1,
            theme_title: "CATACOMBS".to_string(),
            modifiers: vec!["Acid Pits".to_string(), "Horde Rush".to_string()],
            progress: 0.0,
            tip: "Roll over booster rubber bands to maximize ball momentum.".to_string(),
        }
    }
}

/// Paints the animated descent elevator loading screen.
pub fn paint_floor_loading(f: &mut UiFrame, state: &FloorLoadingState, bounds: Rect) {
    // Backdrop
    fill_rect(f, &bounds, Ui::WELL);

    // Elevator Cage Frame
    let cage_rect = Rect {
        x: bounds.x + (bounds.w - 360.0) / 2.0,
        y: bounds.y + 40.0,
        w: 360.0,
        h: bounds.h - 80.0,
    };
    fill_rect(f, &cage_rect, Ui::SHEET);
    stroke_rect(f, &cage_rect, Ui::GOLD, 2.0);

    // Header: Floor Depth & Theme
    text(
        f,
        &format!("DESCENDING TO FLOOR {}", state.floor_num),
        cage_rect.x + cage_rect.w / 2.0,
        cage_rect.y + 24.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::HEADING),
            align: Align::Center,
            max: None,
        },
    );

    text(
        f,
        &state.theme_title,
        cage_rect.x + cage_rect.w / 2.0,
        cage_rect.y + 48.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            align: Align::Center,
            max: None,
        },
    );

    // Active Floor Modifiers
    let mod_y = cage_rect.y + 80.0;
    text(
        f,
        "ACTIVE FLOOR MODIFIERS",
        cage_rect.x + cage_rect.w / 2.0,
        mod_y,
        TextOpts {
            size: 8,
            colour: Some(Ui::GOLD),
            align: Align::Center,
            max: None,
        },
    );

    for (i, modifier) in state.modifiers.iter().enumerate() {
        let badge_rect = Rect {
            x: cage_rect.x + 30.0,
            y: mod_y + 18.0 + (i as f64 * 24.0),
            w: cage_rect.w - 60.0,
            h: 20.0,
        };
        fill_rect(f, &badge_rect, Ui::RAISED);
        stroke_rect(f, &badge_rect, Ui::SHEET_EDGE, 1.0);

        text(
            f,
            &format!("⚔ {}", modifier),
            badge_rect.x + 8.0,
            badge_rect.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT),
                align: Align::Left,
                max: None,
            },
        );
    }

    // Loading Progress Bar
    let bar_rect = Rect {
        x: cage_rect.x + 30.0,
        y: cage_rect.y + cage_rect.h - 60.0,
        w: cage_rect.w - 60.0,
        h: 12.0,
    };
    fill_rect(f, &bar_rect, Ui::WELL);
    stroke_rect(f, &bar_rect, Ui::WELL_EDGE, 1.0);

    let fill_w = ((cage_rect.w - 60.0) * (state.progress as f64)).clamp(0.0, cage_rect.w - 60.0);
    let fill_rect_bar = Rect {
        x: bar_rect.x,
        y: bar_rect.y,
        w: fill_w,
        h: bar_rect.h,
    };
    fill_rect(f, &fill_rect_bar, Ui::GOLD);

    // Tip Blurb
    text(
        f,
        &format!("TIP: {}", state.tip),
        cage_rect.x + cage_rect.w / 2.0,
        cage_rect.y + cage_rect.h - 32.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_DIM),
            align: Align::Center,
            max: None,
        },
    );
}
