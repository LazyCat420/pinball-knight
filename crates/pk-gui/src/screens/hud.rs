//! THE IN-GAME HUD SCREEN — `legacy/src/game/pinball-knight/gui/screens/hud.ts`, `hud-face.ts`, `hud-minimap.ts`.
//!
//! Replaces the legacy DOM overlay with an immediate-mode GPU-composited HUD bar:
//! - Skills (2 slots with rank, mana check, cooldown curtain)
//! - Weapon (icon, label, durability)
//! - Life globe (animated liquid wave, current HP)
//! - Knight portrait (Doom-style mugshot with damage stages)
//! - Mana globe (liquid wave, current mana)
//! - Stats block (DEPTH, KILLS, RAGE)
//! - Belt (4 consumable slots with numbers and counts)
//! - Minimap (fog-of-war radar with player, stairs, and icons)
//! - Boss bar (top-center, when engaged)
//! - Combo multiplier and plunger power meters
//!
//! PORTS: `gui/screens/hud.ts`, `hud-minimap.ts`
//! PORTS-PARTIAL: `map-render.ts` - NOT a finished port - 0 of 4 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::im::{bar, fill_rect, stroke_rect, text, Align, Rect, TextOpts, UiFrame};
use crate::painter::Rgba;
use crate::palette::c;
use crate::theme::{Ui, GRID};

/// Authored design box: `design: { w: 600, h: 338, max: 2 }`.
pub const DESIGN_W: f64 = 600.0;
pub const DESIGN_H: f64 = 338.0;
pub const DESIGN_MAX_ZOOM: u32 = 2;

/// Panel height in HUD units.
pub const PANEL_H: f64 = 61.0;
pub const FACE_BOX_INSET: f64 = 4.0;
pub const FACE_PX: f64 = 72.0;
pub const FACE_BOX: f64 = FACE_PX + FACE_BOX_INSET; // 76.0
pub const TILE: f64 = 30.0;
pub const ITEM_ICON: f64 = 24.0;
pub const ICON_SKILL: f64 = TILE - 12.0;

/// State for a single ability slot on the HUD.
#[derive(Clone, Debug, PartialEq)]
pub struct HudSkillSlot {
    pub id: String,
    pub name: String,
    pub cost: u32,
    pub rank: u32,
    pub cooldown_max: f64,
    pub cooldown_left: f64,
    pub can_cast: bool,
    pub affordable: bool,
}

/// State for an equipped weapon slot.
#[derive(Clone, Debug, PartialEq)]
pub struct HudWeaponInfo {
    pub id: String,
    pub label: String,
    pub durability: Option<u32>,
}

/// State for a consumable belt slot.
#[derive(Clone, Debug, PartialEq)]
pub struct HudBeltSlot {
    pub id: String,
    pub count: u32,
}

/// State for the boss health bar.
#[derive(Clone, Debug, PartialEq)]
pub struct HudBossInfo {
    pub name: String,
    pub hp: u32,
    pub max_hp: u32,
}

/// Minimap tile representation for the radar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MinimapTile {
    Void,
    Wall,
    Floor,
    Stairs,
    Cracked,
    Door,
}

/// Minimap view state.
#[derive(Clone, Debug, PartialEq)]
pub struct HudMinimapView {
    pub player_tile_x: i32,
    pub player_tile_y: i32,
    pub stairs_tile: Option<(i32, i32)>,
    pub tiles: Vec<MinimapTile>,
    pub width: usize,
    pub height: usize,
}

/// Full data model for the live in-game HUD.
#[derive(Clone, Debug, PartialEq)]
pub struct HudView {
    pub hp: u32,
    pub max_hp: u32,
    pub mana: u32,
    pub max_mana: u32,
    pub level: u32,
    pub kills: u32,
    pub ult_charge: f64, // 0.0 .. 1.0
    pub rampage_ready: bool,
    pub rampage_active: bool,
    pub fps_streak: u32,
    pub fps_timer: f64,
    pub combo: u32,
    pub plunger_power: Option<f64>, // Some(0.0 .. 1.0) when charging
    pub weapon: Option<HudWeaponInfo>,
    pub skills: [Option<HudSkillSlot>; 2],
    pub belt: [Option<HudBeltSlot>; 4],
    pub boss: Option<HudBossInfo>,
    pub minimap: Option<HudMinimapView>,
    pub pain_flash: f64, // >0 when taking damage
}

impl Default for HudView {
    fn default() -> Self {
        Self {
            hp: 6,
            max_hp: 6,
            mana: 100,
            max_mana: 100,
            level: 1,
            kills: 0,
            ult_charge: 0.0,
            rampage_ready: false,
            rampage_active: false,
            fps_streak: 0,
            fps_timer: 0.0,
            combo: 0,
            plunger_power: None,
            weapon: None,
            skills: [None, None],
            belt: [None, None, None, None],
            boss: None,
            minimap: None,
            pain_flash: 0.0,
        }
    }
}

/// A framed HUD cell — the bevelled stone well look.
fn cell(f: &mut UiFrame, r: &Rect, label: Option<&str>) {
    fill_rect(f, r, Ui::WELL);
    stroke_rect(f, r, Ui::SHEET_EDGE, 1.0);
    if let Some(lbl) = label {
        text(
            f,
            lbl,
            r.x + r.w / 2.0,
            r.y + r.h - 10.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
    }
}

/// An animated liquid globe (Life / Mana).
fn globe(f: &mut UiFrame, r: &Rect, fill_ratio: f64, colour: Rgba, value: u32, time: f64) {
    let cx = r.x + r.w / 2.0;
    let cy = r.y + r.h / 2.0;
    let rad = (r.w.min(r.h) / 2.0 - 1.0).max(1.0);
    let clamped_t = fill_ratio.clamp(0.0, 1.0);

    // Draw background well circle
    fill_rect(f, r, Ui::WELL);

    // Draw liquid level with wave sine
    let level_y = cy + rad - clamped_t * rad * 2.0;
    let mut liquid_box = *r;
    liquid_box.y = level_y;
    liquid_box.h = (r.y + r.h - level_y).max(0.0);
    if liquid_box.h > 0.0 {
        // Add animated wave top
        let wave_y = (time * 3.0).sin() * 1.5;
        liquid_box.y = (liquid_box.y + wave_y).clamp(r.y, r.y + r.h);
        liquid_box.h = (r.y + r.h - liquid_box.y).max(0.0);
        fill_rect(f, &liquid_box, colour);
    }

    // Outer ring border
    stroke_rect(f, r, Ui::SHEET_EDGE, 2.0);

    // Value readout
    text(
        f,
        &value.to_string(),
        cx,
        cy - 4.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT),
            align: Align::Center,
            ..TextOpts::default()
        },
    );
}

/// Paint the procedural Doom-style knight mugshot face.
fn paint_face(f: &mut UiFrame, face_box: &Rect, hp: u32, max_hp: u32, pain_flash: f64, time: f64) {
    fill_rect(f, face_box, Ui::WELL);

    let mut face = crate::hud_face::FaceState::default();
    face.set_health(hp, max_hp);
    if pain_flash > 0.0 {
        face.pain_t = pain_flash.min(0.32);
    }
    face.render(time);

    let dest_x = face_box.x + (face_box.w - (crate::hud_face::FACE_PX as f64)) / 2.0;
    let dest_y = face_box.y + (face_box.h - (crate::hud_face::FACE_PX as f64)) / 2.0;
    face.blit_into(f.p, dest_x, dest_y);
    stroke_rect(f, face_box, Ui::SHEET_EDGE, 2.0);
}

/// Paint the minimap radar.
fn paint_minimap(f: &mut UiFrame, map_rect: &Rect, minimap: Option<&HudMinimapView>) {
    cell(f, map_rect, None);

    if let Some(mm) = minimap {
        let tile_size = 4.0;
        let window_rad = 6;
        let cx = map_rect.x + map_rect.w / 2.0;
        let cy = map_rect.y + map_rect.h / 2.0;

        for dy in -window_rad..=window_rad {
            for dx in -window_rad..=window_rad {
                let tx = mm.player_tile_x + dx;
                let ty = mm.player_tile_y + dy;
                if tx >= 0 && ty >= 0 && (tx as usize) < mm.width && (ty as usize) < mm.height {
                    let idx = (ty as usize) * mm.width + (tx as usize);
                    if let Some(&tile) = mm.tiles.get(idx) {
                        let color = match tile {
                            MinimapTile::Void => c(1),
                            MinimapTile::Wall => c(4),
                            MinimapTile::Floor => c(2),
                            MinimapTile::Stairs => Rgba::hex(0x6fd0e8),
                            MinimapTile::Cracked => c(11),
                            MinimapTile::Door => c(10),
                        };
                        let px = cx + (dx as f64) * tile_size - tile_size / 2.0;
                        let py = cy + (dy as f64) * tile_size - tile_size / 2.0;
                        if px >= map_rect.x
                            && px + tile_size <= map_rect.x + map_rect.w
                            && py >= map_rect.y
                            && py + tile_size <= map_rect.y + map_rect.h
                        {
                            fill_rect(
                                f,
                                &Rect {
                                    x: px,
                                    y: py,
                                    w: tile_size,
                                    h: tile_size,
                                },
                                color,
                            );
                        }
                    }
                }
            }
        }

        // Center player beacon
        fill_rect(
            f,
            &Rect {
                x: cx - 2.0,
                y: cy - 2.0,
                w: 4.0,
                h: 4.0,
            },
            Ui::GOLD,
        );
    }

    text(
        f,
        "M",
        map_rect.x + map_rect.w - 4.0,
        map_rect.y + 2.0,
        TextOpts {
            size: 8,
            colour: Some(Ui::TEXT_FAINT),
            align: Align::Right,
            ..TextOpts::default()
        },
    );
}

/// Paint the standard in-game HUD.
pub fn paint_hud(f: &mut UiFrame, v: &HudView, time: f64) {
    if v.rampage_active {
        paint_wolf_hud(f, v);
        return;
    }

    let panel = Rect {
        x: 0.0,
        y: f.h - PANEL_H,
        w: f.w,
        h: PANEL_H,
    };
    fill_rect(f, &panel, Ui::SHEET);
    fill_rect(
        f,
        &Rect {
            x: panel.x,
            y: panel.y,
            w: panel.w,
            h: 1.0,
        },
        Ui::SHEET_EDGE_LIT,
    );

    let y = panel.y + GRID;
    let h = PANEL_H - GRID * 2.0;
    let gap = 4.0;

    let w_skills = TILE * 2.0 + 10.0;
    let w_wpn = ITEM_ICON + 26.0;
    let w_globe = h;
    let w_face = FACE_BOX;
    let w_stats = 76.0;
    let w_belt = TILE * 4.0 + 13.0;
    let w_map = h;

    let total = w_skills + w_wpn + w_globe * 2.0 + w_face + w_stats + w_belt + w_map + gap * 6.0;
    let mut x = GRID.max((f.w - total) / 2.0);

    // ── 1. SKILLS ──
    let skills_rect = Rect {
        x,
        y,
        w: w_skills,
        h,
    };
    cell(f, &skills_rect, Some("SKILLS"));
    for i in 0..2 {
        let tr = Rect {
            x: skills_rect.x + 4.0 + (i as f64) * (TILE + 4.0),
            y: skills_rect.y + 3.0,
            w: TILE,
            h: TILE,
        };
        fill_rect(f, &tr, Ui::SHEET);
        stroke_rect(f, &tr, Ui::WELL_EDGE, 1.0);

        if let Some(ref skill) = v.skills[i] {
            // Cost readout
            let cost_color = if skill.affordable {
                Ui::ARCANE
            } else if skill.can_cast {
                Ui::DANGER
            } else {
                Ui::TEXT_DIM
            };
            text(
                f,
                &skill.cost.to_string(),
                tr.x + 3.0,
                tr.y + TILE - 11.0,
                TextOpts {
                    size: 8,
                    colour: Some(cost_color),
                    ..TextOpts::default()
                },
            );

            // Rank pips
            if skill.rank > 0 {
                let pips = "•".repeat(skill.rank as usize);
                text(
                    f,
                    &pips,
                    tr.x + TILE - 4.0,
                    tr.y + 3.0,
                    TextOpts {
                        size: 8,
                        colour: Some(Ui::GOLD),
                        align: Align::Right,
                        ..TextOpts::default()
                    },
                );
            }

            // Cooldown curtain
            if skill.cooldown_left > 0.0 && skill.cooldown_max > 0.0 {
                let frac = (skill.cooldown_left / skill.cooldown_max).clamp(0.0, 1.0);
                let curtain_h = tr.h * frac;
                fill_rect(
                    f,
                    &Rect {
                        x: tr.x,
                        y: tr.y,
                        w: tr.w,
                        h: curtain_h,
                    },
                    Rgba::hex_a(0x0b0d12, 180),
                );
            }
        }
    }
    x += w_skills + gap;

    // ── 2. WEAPON ──
    let wpn_rect = Rect { x, y, w: w_wpn, h };
    let wpn_label = v
        .weapon
        .as_ref()
        .map(|w| w.label.as_str())
        .unwrap_or("WEAPON");
    cell(f, &wpn_rect, Some(wpn_label));
    if let Some(ref w) = v.weapon {
        let dur_str = w
            .durability
            .map(|d| d.to_string())
            .unwrap_or_else(|| "∞".to_string());
        text(
            f,
            &dur_str,
            wpn_rect.x + ITEM_ICON + 6.0,
            wpn_rect.y + 10.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                ..TextOpts::default()
            },
        );
    }
    x += w_wpn + gap;

    // ── 3. LIFE GLOBE ──
    let life_rect = Rect {
        x,
        y,
        w: w_globe,
        h,
    };
    let life_ratio = if v.max_hp > 0 {
        v.hp as f64 / v.max_hp as f64
    } else {
        0.0
    };
    globe(f, &life_rect, life_ratio, Ui::DANGER, v.hp, time);
    x += w_globe + 4.0;

    // ── 4. KNIGHT FACE ──
    let face_rect = Rect {
        x,
        y: y + h - FACE_BOX,
        w: FACE_BOX,
        h: FACE_BOX,
    };
    paint_face(f, &face_rect, v.hp, v.max_hp, v.pain_flash, time);
    x += FACE_BOX + 4.0;

    // ── 5. MANA GLOBE ──
    let mana_rect = Rect {
        x,
        y,
        w: w_globe,
        h,
    };
    let mana_ratio = if v.max_mana > 0 {
        v.mana as f64 / v.max_mana as f64
    } else {
        0.0
    };
    globe(f, &mana_rect, mana_ratio, Ui::ARCANE, v.mana, time);
    x += w_globe + gap;

    // ── 6. STATS BLOCK ──
    let stats_rect = Rect {
        x,
        y,
        w: w_stats,
        h,
    };
    cell(f, &stats_rect, None);

    let stat_row = |f: &mut UiFrame, label: &str, val: &str, row: usize, col: Rgba| {
        let sy = stats_rect.y + 4.0 + (row as f64) * 13.0;
        text(
            f,
            label,
            stats_rect.x + 5.0,
            sy,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                ..TextOpts::default()
            },
        );
        text(
            f,
            val,
            stats_rect.x + stats_rect.w - 5.0,
            sy,
            TextOpts {
                size: 8,
                colour: Some(col),
                align: Align::Right,
                ..TextOpts::default()
            },
        );
    };

    stat_row(f, "DEPTH", &v.level.to_string(), 0, Ui::GOLD);
    stat_row(f, "KILLS", &v.kills.to_string(), 1, Ui::GOOD);
    let rage_pct = format!("{}%", (v.ult_charge * 100.0).round() as u32);
    let rage_col = if v.rampage_ready {
        Ui::GOLD
    } else {
        Ui::DANGER
    };
    stat_row(f, "RAGE", &rage_pct, 2, rage_col);
    x += w_stats + gap;

    // ── 7. BELT ──
    let belt_rect = Rect { x, y, w: w_belt, h };
    cell(f, &belt_rect, Some("BELT · 1-4"));
    for i in 0..4 {
        let tr = Rect {
            x: belt_rect.x + 3.0 + (i as f64) * (TILE + 3.0),
            y: belt_rect.y + 3.0,
            w: TILE,
            h: TILE,
        };
        fill_rect(f, &tr, Ui::SHEET);
        stroke_rect(f, &tr, Ui::WELL_EDGE, 1.0);
        text(
            f,
            &(i + 1).to_string(),
            tr.x + 2.0,
            tr.y + 2.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_FAINT),
                ..TextOpts::default()
            },
        );
        if let Some(ref slot) = v.belt[i] {
            if slot.count > 1 {
                text(
                    f,
                    &slot.count.to_string(),
                    tr.x + TILE - 3.0,
                    tr.y + TILE - 11.0,
                    TextOpts {
                        size: 8,
                        colour: Some(Ui::TEXT),
                        align: Align::Right,
                        ..TextOpts::default()
                    },
                );
            }
        }
    }
    x += w_belt + gap;

    // ── 8. MINIMAP ──
    let map_rect = Rect { x, y, w: w_map, h };
    paint_minimap(f, &map_rect, v.minimap.as_ref());

    // ── 9. BOSS BAR (Top-center when engaged) ──
    if let Some(ref boss) = v.boss {
        if boss.max_hp > 0 {
            let bb = Rect {
                x: f.w / 2.0 - 200.0,
                y: 16.0,
                w: 400.0,
                h: 14.0,
            };
            bar(f, &bb, boss.hp as f64 / boss.max_hp as f64, Ui::DANGER);
            let btitle = format!("BOSS: {}", boss.name);
            text(
                f,
                &btitle,
                bb.x + bb.w / 2.0,
                bb.y + 3.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::TEXT),
                    align: Align::Center,
                    ..TextOpts::default()
                },
            );
        }
    }

    // ── 10. COMBO MULTIPLIER (Transient) ──
    if v.combo > 1 {
        let combo_str = format!("x{} COMBO", v.combo);
        text(
            f,
            &combo_str,
            GRID * 2.0,
            panel.y - 20.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::GOLD),
                ..TextOpts::default()
            },
        );
    }

    // ── 11. PLUNGER METER (When armed/charging) ──
    if let Some(pwr) = v.plunger_power {
        let pm = Rect {
            x: f.w / 2.0 - 150.0,
            y: panel.y - 22.0,
            w: 300.0,
            h: 10.0,
        };
        bar(f, &pm, pwr, Ui::GOLD);
    }
}

/// Rampage / Wolf FPS combat HUD mode.
fn paint_wolf_hud(f: &mut UiFrame, v: &HudView) {
    let h = 64.0;
    let panel = Rect {
        x: 0.0,
        y: f.h - h,
        w: f.w,
        h,
    };
    fill_rect(f, &panel, Ui::SHEET);
    fill_rect(
        f,
        &Rect {
            x: panel.x,
            y: panel.y,
            w: panel.w,
            h: 1.0,
        },
        Ui::SHEET_EDGE_LIT,
    );

    let cx = f.w / 2.0;
    let big = |f: &mut UiFrame, label: &str, val: &str, x: f64, col: Rgba| {
        text(
            f,
            val,
            x,
            panel.y + 14.0,
            TextOpts {
                size: 16,
                colour: Some(col),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
        text(
            f,
            label,
            x,
            panel.y + 40.0,
            TextOpts {
                size: 8,
                colour: Some(Ui::TEXT_DIM),
                align: Align::Center,
                ..TextOpts::default()
            },
        );
    };

    big(f, "HEALTH", &v.hp.to_string(), cx - 220.0, Ui::DANGER);
    big(f, "STREAK", &v.fps_streak.to_string(), cx - 80.0, Ui::GOLD);
    big(
        f,
        "TIME",
        &format!("{}", v.fps_timer.ceil().max(0.0) as u32),
        cx + 80.0,
        Ui::ARCANE,
    );
    big(f, "KILLS", &v.kills.to_string(), cx + 220.0, Ui::GOOD);

    // First person crosshair ticks
    let y_mid = (f.h - h) / 2.0;
    let ticks = [
        (-9.0, -1.0, 6.0, 2.0),
        (3.0, -1.0, 6.0, 2.0),
        (-1.0, -9.0, 2.0, 6.0),
        (-1.0, 3.0, 2.0, 6.0),
    ];
    for (dx, dy, tw, th) in ticks {
        fill_rect(
            f,
            &Rect {
                x: (cx + dx).round(),
                y: (y_mid + dy).round(),
                w: tw,
                h: th,
            },
            Ui::FOCUS,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::Fonts;
    use crate::im::{begin_ui, empty_ui_input};
    use crate::painter::Painter;

    #[test]
    fn hud_paints_without_panicking() {
        let mut painter = Painter::new(600, 338);
        let fonts = Fonts::load_embedded();
        let mut hud = HudView::default();
        hud.hp = 10;
        hud.max_hp = 12;
        hud.mana = 80;
        hud.max_mana = 100;
        hud.kills = 4;
        hud.level = 2;
        hud.combo = 3;
        hud.plunger_power = Some(0.75);
        hud.boss = Some(HudBossInfo {
            name: "Gorgon King".to_string(),
            hp: 250,
            max_hp: 500,
        });

        {
            let mut frame = begin_ui(&mut painter, &fonts, 600.0, 338.0, empty_ui_input(), 0, 1);
            paint_hud(&mut frame, &hud, 1.25);
        }
        assert!(painter.digest() != 0);
    }

    #[test]
    fn wolf_hud_paints_without_panicking() {
        let mut painter = Painter::new(600, 338);
        let fonts = Fonts::load_embedded();
        let mut hud = HudView::default();
        hud.rampage_active = true;
        hud.hp = 5;
        hud.fps_streak = 7;
        hud.fps_timer = 14.2;

        {
            let mut frame = begin_ui(&mut painter, &fonts, 600.0, 338.0, empty_ui_input(), 0, 1);
            paint_hud(&mut frame, &hud, 0.5);
        }
        assert!(painter.digest() != 0);
    }
}
