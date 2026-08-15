//! Lobby Character Select Screen — Choose playable knight/creature skin before descent.
//!
//! PORTS: `gui/screens/character-select.ts`

use crate::im::{
    button, fill_rect, focusable, rect, stroke_rect, text, Align, ButtonOpts, Rect, TextOpts,
    UiFrame,
};
use crate::theme::Ui;

pub const CARD_W: f64 = 150.0;
pub const CARD_H: f64 = 150.0;

#[derive(Clone, Debug, PartialEq)]
pub struct PlayableCandidate {
    pub name: String,
    pub sheet: String,
    pub description: String,
    pub available: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CharacterSelectState {
    pub candidates: Vec<PlayableCandidate>,
    pub selected_idx: usize,
    pub chosen_sheet: String,
}

impl Default for CharacterSelectState {
    fn default() -> Self {
        Self {
            candidates: vec![
                PlayableCandidate {
                    name: "KNIGHT".to_string(),
                    sheet: "knight".to_string(),
                    description: "The Iron Crusader".to_string(),
                    available: true,
                },
                PlayableCandidate {
                    name: "WOLF".to_string(),
                    sheet: "wolf".to_string(),
                    description: "Swift Prowler".to_string(),
                    available: true,
                },
                PlayableCandidate {
                    name: "STILTNECK".to_string(),
                    sheet: "stiltneck".to_string(),
                    description: "Bomb Tosser".to_string(),
                    available: true,
                },
                PlayableCandidate {
                    name: "FROG".to_string(),
                    sheet: "frog".to_string(),
                    description: "High Leaper".to_string(),
                    available: true,
                },
            ],
            selected_idx: 0,
            chosen_sheet: "knight".to_string(),
        }
    }
}

/// Paints the character select screen modal over the lobby viewport.
/// Returns `Some(chosen_sheet)` when the player confirms selection.
pub fn paint_character_select(
    f: &mut UiFrame,
    state: &mut CharacterSelectState,
    bounds: Rect,
) -> Option<String> {
    // Scrim
    fill_rect(f, &bounds, Ui::SCRIM);

    let modal_w = (bounds.w - 32.0).min(640.0);
    let modal_h = (bounds.h - 32.0).min(320.0);
    let modal_rect = rect(
        bounds.x + (bounds.w - modal_w) * 0.5,
        bounds.y + (bounds.h - modal_h) * 0.5,
        modal_w,
        modal_h,
    );

    fill_rect(f, &modal_rect, Ui::SHEET);
    stroke_rect(f, &modal_rect, Ui::SHEET_EDGE, 2.0);

    // Title
    text(
        f,
        "CHOOSE YOUR CHAMPION",
        modal_rect.x + modal_rect.w * 0.5,
        modal_rect.y + 16.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::HEADING),
            align: Align::Center,
            max: None,
        },
    );

    // Grid of cards
    let card_gap = 16.0;
    let total_cards = state.candidates.len();
    let total_w = total_cards as f64 * (CARD_W * 0.8) + (total_cards - 1) as f64 * card_gap;
    let start_x = modal_rect.x + (modal_rect.w - total_w) * 0.5;
    let card_y = modal_rect.y + 54.0;
    let card_w = CARD_W * 0.8;
    let card_h = CARD_H * 0.9;

    let mut newly_selected = None;

    for (i, c) in state.candidates.iter().enumerate() {
        let card_x = start_x + i as f64 * (card_w + card_gap);
        let card_rect = rect(card_x, card_y, card_w, card_h);

        let st = focusable(f, &card_rect, !c.available);
        let is_current = state.selected_idx == i;

        if is_current {
            fill_rect(f, &card_rect, Ui::RAISED);
            stroke_rect(f, &card_rect, Ui::GOLD, 2.0);
        } else {
            fill_rect(f, &card_rect, Ui::WELL);
            stroke_rect(f, &card_rect, Ui::WELL_EDGE, 1.0);
        }

        if st.activated {
            newly_selected = Some(i);
        }

        // Candidate Name
        text(
            f,
            &c.name,
            card_rect.x + card_rect.w * 0.5,
            card_rect.y + 12.0,
            TextOpts {
                size: 12,
                colour: Some(if is_current { Ui::GOLD } else { Ui::TEXT }),
                align: Align::Center,
                max: None,
            },
        );

        // Description
        text(
            f,
            &c.description,
            card_rect.x + card_rect.w * 0.5,
            card_rect.y + card_rect.h - 24.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                align: Align::Center,
                max: None,
            },
        );
    }

    if let Some(idx) = newly_selected {
        state.selected_idx = idx;
        state.chosen_sheet = state.candidates[idx].sheet.clone();
    }

    // Confirm Button
    let btn_rect = rect(
        modal_rect.x + (modal_rect.w - 180.0) * 0.5,
        modal_rect.y + modal_rect.h - 48.0,
        180.0,
        32.0,
    );

    if button(f, &btn_rect, "CONFIRM CHAMPION", ButtonOpts::default()) {
        return Some(state.chosen_sheet.clone());
    }

    None
}
