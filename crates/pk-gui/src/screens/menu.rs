//! THE KNIGHT MENU — In-game player pause/inventory modal sheet.
//!
//! PORTS: `gui/screens/menu.ts`

use crate::im::{
    fill_rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame,
};
use crate::theme::Ui;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuTab {
    Gear,
    Skills,
    Cards,
    Bestiary,
    Legacy,
    Settings,
}

impl MenuTab {
    pub const ALL: [MenuTab; 6] = [
        MenuTab::Gear,
        MenuTab::Skills,
        MenuTab::Cards,
        MenuTab::Bestiary,
        MenuTab::Legacy,
        MenuTab::Settings,
    ];

    pub fn label(&self) -> &'static str {
        match self {
            MenuTab::Gear => "GEAR",
            MenuTab::Skills => "SKILLS",
            MenuTab::Cards => "CARDS",
            MenuTab::Bestiary => "BESTIARY",
            MenuTab::Legacy => "LEGACY",
            MenuTab::Settings => "SETTINGS",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct KnightMenuState {
    pub tab: MenuTab,
    pub focus_idx: usize,
    pub gold: u32,
    pub level: u32,
    pub skill_points: u32,
    pub hp: f64,
    pub max_hp: f64,
    pub active_weapon: String,
    pub weapon_slots: Vec<String>,
}

impl Default for KnightMenuState {
    fn default() -> Self {
        Self {
            tab: MenuTab::Gear,
            focus_idx: 0,
            gold: 0,
            level: 1,
            skill_points: 0,
            hp: 100.0,
            max_hp: 100.0,
            active_weapon: "Iron Sword".to_string(),
            weapon_slots: vec!["Iron Sword".to_string(), "Rusty Dagger".to_string()],
        }
    }
}

/// Paints the in-game Knight Menu modal sheet and tab views.
pub fn paint_menu(f: &mut UiFrame, state: &mut KnightMenuState, bounds: Rect) {
    // 1. Modal backdrop scrim
    fill_rect(f, &bounds, Ui::SCRIM);
    stroke_rect(f, &bounds, Ui::GOLD, 2.0);

    // 2. Header & Title Bar
    let header_rect = Rect {
        x: bounds.x + 8.0,
        y: bounds.y + 8.0,
        w: bounds.w - 16.0,
        h: 24.0,
    };
    fill_rect(f, &header_rect, Ui::SHEET);
    text(
        f,
        "KNIGHT STATUS & LOADOUT",
        header_rect.x + 8.0,
        header_rect.y + 4.0,
        TextOpts {
            size: 16,
            colour: Some(Ui::HEADING),
            align: Align::Left,
            max: None,
        },
    );

    let stats_blurb = format!("LVL {} | GOLD: {}g | SP: {}", state.level, state.gold, state.skill_points);
    text(
        f,
        &stats_blurb,
        header_rect.x + header_rect.w - 8.0,
        header_rect.y + 6.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT),
            align: Align::Right,
            max: None,
        },
    );

    // 3. Tab Bar
    let tab_bar_y = header_rect.y + header_rect.h + 6.0;
    let tab_w = (bounds.w - 16.0) / (MenuTab::ALL.len() as f64);

    for (i, &tab_item) in MenuTab::ALL.iter().enumerate() {
        let tab_rect = Rect {
            x: bounds.x + 8.0 + (i as f64 * tab_w),
            y: tab_bar_y,
            w: tab_w - 2.0,
            h: 20.0,
        };

        let is_active = state.tab == tab_item;
        let bg_col = if is_active { Ui::GOLD } else { Ui::RAISED };
        let text_col = if is_active { Ui::WELL } else { Ui::TEXT };

        fill_rect(f, &tab_rect, bg_col);
        stroke_rect(f, &tab_rect, Ui::SHEET_EDGE, 1.0);

        text(
            f,
            tab_item.label(),
            tab_rect.x + tab_rect.w / 2.0,
            tab_rect.y + 4.0,
            TextOpts {
                size: 8,
                colour: Some(text_col),
                align: Align::Center,
                max: None,
            },
        );
    }

    // 4. Tab Content Body
    let body_rect = Rect {
        x: bounds.x + 8.0,
        y: tab_bar_y + 24.0,
        w: bounds.w - 16.0,
        h: bounds.h - (tab_bar_y - bounds.y + 32.0),
    };
    fill_rect(f, &body_rect, Ui::WELL);
    stroke_rect(f, &body_rect, Ui::WELL_EDGE, 1.0);

    match state.tab {
        MenuTab::Gear => {
            text(
                f,
                "EQUIPPED WEAPONS & ACCESSORIES",
                body_rect.x + 12.0,
                body_rect.y + 12.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    align: Align::Left,
                    max: None,
                },
            );

            for (i, weapon) in state.weapon_slots.iter().enumerate() {
                let slot_rect = Rect {
                    x: body_rect.x + 12.0,
                    y: body_rect.y + 30.0 + (i as f64 * 28.0),
                    w: body_rect.w - 24.0,
                    h: 24.0,
                };
                fill_rect(f, &slot_rect, Ui::SHEET);
                stroke_rect(f, &slot_rect, Ui::SHEET_EDGE, 1.0);

                let is_active = weapon == &state.active_weapon;
                let prefix = if is_active { "[ACTIVE] " } else { "[INERT]  " };
                text(
                    f,
                    &format!("{}{}", prefix, weapon),
                    slot_rect.x + 8.0,
                    slot_rect.y + 6.0,
                    TextOpts {
                        size: 8,
                        colour: Some(if is_active { Ui::GOOD } else { Ui::TEXT }),
                        align: Align::Left,
                        max: None,
                    },
                );
            }
        }
        MenuTab::Skills => {
            text(
                f,
                "SKILL TREE & ACTIVE ABILITIES",
                body_rect.x + 12.0,
                body_rect.y + 12.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    align: Align::Left,
                    max: None,
                },
            );
        }
        MenuTab::Cards => {
            text(
                f,
                "SOCKETED DUNGEON CARDS",
                body_rect.x + 12.0,
                body_rect.y + 12.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    align: Align::Left,
                    max: None,
                },
            );
        }
        MenuTab::Bestiary => {
            text(
                f,
                "MONSTER BESTIARY & KILLS",
                body_rect.x + 12.0,
                body_rect.y + 12.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    align: Align::Left,
                    max: None,
                },
            );
        }
        MenuTab::Legacy => {
            text(
                f,
                "LEGACY PERKS & RUN UPGRADES",
                body_rect.x + 12.0,
                body_rect.y + 12.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    align: Align::Left,
                    max: None,
                },
            );
        }
        MenuTab::Settings => {
            text(
                f,
                "AUDIO & VIDEO PREFERENCES",
                body_rect.x + 12.0,
                body_rect.y + 12.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    align: Align::Left,
                    max: None,
                },
            );
        }
    }
}
