//! Game Over Death Screen — run recap, dropped gold explanation, best depth, and return to tavern.
//!
//! PORTS: `gui/screens/game-over.ts`

use crate::im::{button, fill_rect, stroke_rect, text, Align, ButtonOpts, Rect, TextOpts, UiFrame};
use crate::theme::Ui;

pub const DESIGN_BOX_H: f64 = 338.0;
pub const MEASURED_BLOCK_H: f64 = 320.0;

#[derive(Clone, Debug, PartialEq)]
pub struct GameOverState {
    pub depth: u32,
    pub best_depth: u32,
    pub dropped_gold: u32,
    pub player_name: String,
    pub is_record: bool,
}

impl Default for GameOverState {
    fn default() -> Self {
        Self {
            depth: 1,
            best_depth: 1,
            dropped_gold: 0,
            player_name: "KNIGHT".to_string(),
            is_record: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GameOverAction {
    BackToTavern,
}

/// Paints the Game Over death recap screen within the viewport bounds.
pub fn paint_game_over(
    f: &mut UiFrame,
    state: &mut GameOverState,
    bounds: Rect,
) -> Option<GameOverAction> {
    // Scrim overlay
    fill_rect(f, &bounds, Ui::SCRIM);

    let card_w = 280.0;
    let card_h = MEASURED_BLOCK_H;
    let card_x = bounds.x + (bounds.w - card_w) * 0.5;
    let card_y = bounds.y + (bounds.h - card_h) * 0.5;

    let card_rect = Rect {
        x: card_x,
        y: card_y,
        w: card_w,
        h: card_h,
    };

    fill_rect(f, &card_rect, Ui::SHEET);
    stroke_rect(f, &card_rect, Ui::SHEET_EDGE, 2.0);

    // Title: YOU ARE DEAD
    text(
        f,
        "YOU ARE DEAD",
        card_rect.x + card_rect.w * 0.5,
        card_rect.y + 16.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::DANGER),
            align: Align::Center,
            max: None,
        },
    );

    // Depth reached & Best depth
    let depth_str = format!("FLOOR REACHED: {}", state.depth);
    text(
        f,
        &depth_str,
        card_rect.x + card_rect.w * 0.5,
        card_rect.y + 44.0,
        TextOpts {
            size: 12,
            colour: Some(Ui::HEADING),
            align: Align::Center,
            max: None,
        },
    );

    let record_str = if state.is_record {
        "*** NEW BEST DEPTH! ***".to_string()
    } else {
        format!("BEST DEPTH: {}", state.best_depth)
    };
    text(
        f,
        &record_str,
        card_rect.x + card_rect.w * 0.5,
        card_rect.y + 64.0,
        TextOpts {
            size: 10,
            colour: Some(Ui::GOLD),
            align: Align::Center,
            max: None,
        },
    );

    // Dropped gold / corpse run note
    let drop_str = format!("DROPPED: {} GOLD (RECOVERABLE)", state.dropped_gold);
    text(
        f,
        &drop_str,
        card_rect.x + card_rect.w * 0.5,
        card_rect.y + 100.0,
        TextOpts {
            size: 10,
            colour: Some(Ui::TEXT_DIM),
            align: Align::Center,
            max: None,
        },
    );

    // Player name
    let name_str = format!("KNIGHT: {}", state.player_name);
    text(
        f,
        &name_str,
        card_rect.x + card_rect.w * 0.5,
        card_rect.y + 140.0,
        TextOpts {
            size: 12,
            colour: Some(Ui::TEXT),
            align: Align::Center,
            max: None,
        },
    );

    // Back to Tavern Button
    let btn_rect = Rect {
        x: card_rect.x + 24.0,
        y: card_rect.y + card_rect.h - 48.0,
        w: card_rect.w - 48.0,
        h: 32.0,
    };

    if button(f, &btn_rect, "BACK TO THE TAVERN", ButtonOpts::default()) {
        return Some(GameOverAction::BackToTavern);
    }

    None
}

pub fn game_over_screen() -> GameOverState {
    GameOverState::default()
}
