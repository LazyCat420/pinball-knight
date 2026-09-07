//! 🛡️ THE KNIGHT'S FACE — the Doom-status-bar mugshot, painted procedurally.
//!
//! Port of `legacy/src/game/pinball-knight/hud-face.ts` (1,331 lines).
//!
//! PORTS: `hud-face.ts`

use crate::painter::{Painter, Rgba};
use crate::palette::c;

pub const GRID: usize = 36;
pub const SCALE: usize = 2;
/// Backing-store size. The HUD must blit at a whole multiple of this.
pub const FACE_PX: usize = GRID * SCALE; // 72

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expr {
    Fresh,
    Steady,
    Hurt,
    Bloodied,
    Dying,
    Dead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mood {
    Fresh,
    Steady,
    Hurt,
    Bloodied,
    Dying,
    Dead,
    Grin,
    Smile,
    Wince,
}

pub struct FaceState {
    pub hp: u32,
    pub max_hp: u32,
    pub pain_t: f64,
    pub heal_t: f64,
    pub special_t: f64,
    pub look_x: f64,
    pub look_y: f64,
    pub turn: i32, // -1 | 0 | 1
    pub turn_t: f64,
    pub blink_t: f64,
    pub blink_for: f64,
    pub last_sig: String,
    pub rng_state: u32,
    pub scratch: Vec<Rgba>,
    pub buffer: Vec<Rgba>,
}

impl Default for FaceState {
    fn default() -> Self {
        Self {
            hp: 6,
            max_hp: 6,
            pain_t: 0.0,
            heal_t: 0.0,
            special_t: 0.0,
            look_x: 0.0,
            look_y: 0.0,
            turn: 0,
            turn_t: 0.8,
            blink_t: 2.4,
            blink_for: 0.0,
            last_sig: String::new(),
            rng_state: 0x9e3779b9,
            scratch: vec![Rgba::TRANSPARENT; FACE_PX * FACE_PX],
            buffer: vec![Rgba::TRANSPARENT; FACE_PX * FACE_PX],
        }
    }
}

impl FaceState {
    pub fn new() -> Self {
        let mut s = Self::default();
        s.paint();
        s
    }

    fn rnd(&mut self) -> f64 {
        self.rng_state = self.rng_state.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.rng_state as f64) / (0x100000000u64 as f64)
    }

    pub fn set_health(&mut self, current_hp: u32, current_max: u32) {
        self.hp = current_hp;
        self.max_hp = current_max.max(1);
    }

    pub fn on_damage(&mut self, source_angle: Option<f64>) {
        self.pain_t = 0.32;
        if let Some(angle) = source_angle {
            self.look_x = angle.cos();
            self.look_y = angle.sin() * 0.6;
            self.turn = if self.look_x > 0.35 {
                1
            } else if self.look_x < -0.35 {
                -1
            } else {
                0
            };
            self.turn_t = 0.55;
        }
    }

    pub fn on_heal(&mut self) {
        self.heal_t = 0.42;
    }

    pub fn on_special(&mut self) {
        self.special_t = 0.7;
    }

    pub fn tier_of(&self) -> Expr {
        if self.hp == 0 {
            return Expr::Dead;
        }
        let f = (self.hp as f64) / (self.max_hp as f64);
        if f <= 0.18 {
            Expr::Dying
        } else if f <= 0.36 {
            Expr::Bloodied
        } else if f <= 0.55 {
            Expr::Hurt
        } else if f <= 0.78 {
            Expr::Steady
        } else {
            Expr::Fresh
        }
    }

    pub fn expr_now(&self) -> Mood {
        let tier = self.tier_of();
        if tier == Expr::Dead {
            return Mood::Dead;
        }
        if self.special_t > 0.0 {
            return Mood::Grin;
        }
        if self.pain_t > 0.0 {
            return Mood::Wince;
        }
        if self.heal_t > 0.0 {
            return Mood::Smile;
        }
        match tier {
            Expr::Fresh => Mood::Fresh,
            Expr::Steady => Mood::Steady,
            Expr::Hurt => Mood::Hurt,
            Expr::Bloodied => Mood::Bloodied,
            Expr::Dying => Mood::Dying,
            Expr::Dead => Mood::Dead,
        }
    }

    pub fn helmet_stage_of(&self) -> usize {
        match self.tier_of() {
            Expr::Fresh => 0,
            Expr::Steady => 1,
            Expr::Hurt => 2,
            Expr::Bloodied => 3,
            Expr::Dying => 4,
            Expr::Dead => 5,
        }
    }

    pub fn render(&mut self, dt: f64) {
        self.pain_t = (self.pain_t - dt).max(0.0);
        self.heal_t = (self.heal_t - dt).max(0.0);
        self.special_t = (self.special_t - dt).max(0.0);

        self.turn_t -= dt;
        if self.turn_t <= 0.0 && self.pain_t == 0.0 {
            let r = self.rnd();
            self.turn = if r < 0.42 {
                0
            } else if r < 0.71 {
                -1
            } else {
                1
            };
            self.look_x = self.turn as f64;
            self.look_y = if self.rnd() < 0.22 {
                if self.rnd() < 0.5 { -1.0 } else { 1.0 }
            } else {
                0.0
            };
            let hurry = 1.0 - 0.45 * (1.0 - (self.hp as f64) / (self.max_hp as f64));
            self.turn_t = (0.45 + self.rnd() * 0.85) * hurry;
        }
        if self.pain_t == 0.0 && self.turn == 0 {
            self.look_x *= (1.0 - dt * 6.0).max(0.0);
            self.look_y *= (1.0 - dt * 6.0).max(0.0);
        }

        self.blink_for = (self.blink_for - dt).max(0.0);
        self.blink_t -= dt;
        if self.blink_t <= 0.0 {
            self.blink_for = 0.11;
            let tier = self.tier_of();
            self.blink_t = if tier == Expr::Dying {
                0.9 + self.rnd() * 0.4
            } else {
                2.2 + ((self.hp as f64) / (self.max_hp as f64)) * 2.0
            };
        }

        let sig = format!(
            "{:?}:{:?}:{}:{}:{}:{}:{}:{}:{}",
            self.tier_of(),
            self.expr_now(),
            if self.blink_for > 0.0 { 1 } else { 0 },
            self.turn,
            (self.look_x * 2.0).round() as i32,
            (self.look_y * 2.0).round() as i32,
            if self.pain_t > 0.0 { (self.pain_t * 20.0).ceil() as i32 } else { 0 },
            if self.heal_t > 0.0 { 1 } else { 0 },
            if self.special_t > 0.0 { 1 } else { 0 },
        );

        if sig == self.last_sig {
            return;
        }
        self.last_sig = sig;
        self.paint();
    }

    pub fn paint(&mut self) {
        let mood = self.expr_now();
        let tier = self.tier_of();
        let stage = self.helmet_stage_of();
        let recoil = if self.pain_t > 0.18 { 1 } else { 0 };

        // 1. Clear scratch buffer
        for px in self.scratch.iter_mut() {
            *px = Rgba::TRANSPARENT;
        }

        // Draw onto scratch
        let turn = self.turn;
        paint_scalp(&mut self.scratch, stage, turn, recoil);
        paint_helmet(&mut self.scratch, stage, turn, recoil);
        paint_skin(&mut self.scratch, turn, recoil);
        paint_beard(&mut self.scratch, tier, turn, recoil);

        // Feature turn offset (turn * 2)
        paint_brow(&mut self.scratch, mood, tier, turn * 2, recoil);
        paint_eyes(&mut self.scratch, mood, tier, turn * 2, recoil, self.look_y, self.blink_for > 0.0);
        paint_nose(&mut self.scratch, turn * 2, recoil);
        paint_moustache(&mut self.scratch, tier, turn * 2, recoil);
        paint_mouth(&mut self.scratch, mood, turn * 2, recoil);

        paint_damage(&mut self.scratch, tier, turn, recoil);

        // Reaction wash on head only
        let wash = if self.pain_t > 0.0 {
            Some(Rgba {
                r: 168,
                g: 50,
                b: 68,
                a: (0.3 * (self.pain_t / 0.32) * 255.0) as u8,
            })
        } else if self.heal_t > 0.0 {
            Some(Rgba {
                r: 95,
                g: 138,
                b: 79,
                a: (0.22 * (self.heal_t / 0.42) * 255.0) as u8,
            })
        } else if self.special_t > 0.0 {
            Some(Rgba {
                r: 240,
                g: 166,
                b: 60,
                a: (0.18 * 255.0) as u8,
            })
        } else {
            None
        };

        if let Some(w) = wash {
            for p in self.scratch.iter_mut() {
                if p.a > 0 {
                    *p = blend_rgba(*p, w);
                }
            }
        }

        // 2. Clear final output buffer and paint backdrop + outline
        for px in self.buffer.iter_mut() {
            *px = c(0); // C.bg
        }
        fill_buffer_cell(&mut self.buffer, 6, 3, 24, 32, 0, 0, c(1)); // C.bgHi recess

        paint_outline(&self.scratch, &mut self.buffer);

        // Composite scratch onto final buffer
        for y in 0..FACE_PX {
            for x in 0..FACE_PX {
                let idx = y * FACE_PX + x;
                let src = self.scratch[idx];
                if src.a > 0 {
                    self.buffer[idx] = src;
                }
            }
        }
    }

    pub fn rgba_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.buffer.len() * 4);
        for p in &self.buffer {
            bytes.push(p.r);
            bytes.push(p.g);
            bytes.push(p.b);
            bytes.push(p.a);
        }
        bytes
    }

    pub fn blit_into(&self, painter: &mut Painter, dest_x: f64, dest_y: f64) {
        let dx = dest_x.round() as i64;
        let dy = dest_y.round() as i64;
        for y in 0..FACE_PX {
            let py = dy + (y as i64);
            if py < 0 || py >= (painter.h as i64) {
                continue;
            }
            for x in 0..FACE_PX {
                let px = dx + (x as i64);
                if px < 0 || px >= (painter.w as i64) {
                    continue;
                }
                let col = self.buffer[y * FACE_PX + x];
                if col.a > 0 {
                    let idx = ((py as usize) * (painter.w as usize) + (px as usize)) * 4;
                    painter.buf[idx] = col.r;
                    painter.buf[idx + 1] = col.g;
                    painter.buf[idx + 2] = col.b;
                    painter.buf[idx + 3] = col.a;
                }
            }
        }
    }
}

fn blend_rgba(base: Rgba, over: Rgba) -> Rgba {
    let alpha = (over.a as f32) / 255.0;
    let inv = 1.0 - alpha;
    Rgba {
        r: ((base.r as f32) * inv + (over.r as f32) * alpha).round() as u8,
        g: ((base.g as f32) * inv + (over.g as f32) * alpha).round() as u8,
        b: ((base.b as f32) * inv + (over.b as f32) * alpha).round() as u8,
        a: base.a,
    }
}

// ── Drawing Primitives ──

fn cell(buf: &mut [Rgba], gx: i32, gy: i32, gw: i32, gh: i32, off_x: i32, off_y: i32, color: Rgba) {
    fill_buffer_cell(buf, gx, gy, gw, gh, off_x, off_y, color);
}

fn fill_buffer_cell(buf: &mut [Rgba], gx: i32, gy: i32, gw: i32, gh: i32, off_x: i32, off_y: i32, color: Rgba) {
    let start_x = (gx + off_x) * (SCALE as i32);
    let start_y = (gy + off_y) * (SCALE as i32);
    let end_x = start_x + gw * (SCALE as i32);
    let end_y = start_y + gh * (SCALE as i32);

    for py in start_y..end_y {
        if py < 0 || py >= (FACE_PX as i32) {
            continue;
        }
        for px in start_x..end_x {
            if px < 0 || px >= (FACE_PX as i32) {
                continue;
            }
            buf[(py as usize) * FACE_PX + (px as usize)] = color;
        }
    }
}

fn px(buf: &mut [Rgba], gx: i32, gy: i32, off_x: i32, off_y: i32, color: Rgba) {
    cell(buf, gx, gy, 1, 1, off_x, off_y, color);
}

fn mir(gx: i32, gw: i32) -> i32 {
    (GRID as i32) - gx - gw
}

fn sym(buf: &mut [Rgba], gx: i32, gy: i32, gw: i32, gh: i32, off_x: i32, off_y: i32, color: Rgba) {
    cell(buf, gx, gy, gw, gh, off_x, off_y, color);
    cell(buf, mir(gx, gw), gy, gw, gh, off_x, off_y, color);
}

fn sym_px(buf: &mut [Rgba], gx: i32, gy: i32, off_x: i32, off_y: i32, color: Rgba) {
    sym(buf, gx, gy, 1, 1, off_x, off_y, color);
}

fn paint_outline(scratch: &[Rgba], out: &mut [Rgba]) {
    let solid = |gx: i32, gy: i32| -> bool {
        if gx < 0 || gy < 0 || gx >= (GRID as i32) || gy >= (GRID as i32) {
            return false;
        }
        let py = (gy as usize) * SCALE;
        let px = (gx as usize) * SCALE;
        scratch[py * FACE_PX + px].a > 8
    };

    for gy in 0..(GRID as i32) {
        for gx in 0..(GRID as i32) {
            if solid(gx, gy) {
                continue;
            }
            if solid(gx - 1, gy) || solid(gx + 1, gy) || solid(gx, gy - 1) || solid(gx, gy + 1) {
                fill_buffer_cell(out, gx, gy, 1, 1, 0, 0, c(1));
            }
        }
    }
}

// ── Scalp, Armor, and Features ──

fn paint_scalp(buf: &mut [Rgba], stage: usize, off_x: i32, off_y: i32) {
    cell(buf, 12, 4, 12, 7, off_x, off_y, c(23));
    cell(buf, 12, 4, 9, 5, off_x, off_y, c(24));
    cell(buf, 13, 4, 6, 3, off_x, off_y, c(25));
    cell(buf, 14, 4, 3, 1, off_x, off_y, c(17));
    cell(buf, 22, 5, 2, 6, off_x, off_y, c(27));
    cell(buf, 12, 10, 12, 1, off_x, off_y, c(23));
    px(buf, 15, 7, off_x, off_y, c(27));
    px(buf, 20, 6, off_x, off_y, c(27));

    sym(buf, 9, 5, 3, 8, off_x, off_y, c(3));
    sym(buf, 9, 5, 1, 8, off_x, off_y, c(2));
    sym(buf, 10, 6, 2, 4, off_x, off_y, c(4));
    sym_px(buf, 11, 8, off_x, off_y, c(5));
    px(buf, 19, 4, off_x, off_y, c(21));

    if stage < 4 {
        return;
    }
    cell(buf, 10, 2, 16, 2, off_x, off_y, c(3));
    cell(buf, 10, 2, 7, 1, off_x, off_y, c(4));
    cell(buf, 21, 2, 5, 2, off_x, off_y, c(2));
    cell(buf, 12, 1, 2, 1, off_x, off_y, c(4));
    cell(buf, 19, 1, 3, 1, off_x, off_y, c(3));
    px(buf, 20, 0, off_x, off_y, c(4));
    sym(buf, 8, 3, 2, 7, off_x, off_y, c(2));
    sym(buf, 9, 4, 1, 5, off_x, off_y, c(3));
    cell(buf, 11, 5, 3, 1, off_x, off_y, c(11));
    px(buf, 11, 6, off_x, off_y, c(10));
    cell(buf, 21, 6, 3, 1, off_x, off_y, c(10));
    px(buf, 23, 7, off_x, off_y, c(11));
    if stage < 5 {
        return;
    }
    cell(buf, 14, 3, 5, 1, off_x, off_y, c(12));
    px(buf, 16, 4, off_x, off_y, c(13));
    cell(buf, 12, 8, 2, 1, off_x, off_y, c(11));
}

fn paint_helmet(buf: &mut [Rgba], stage: usize, off_x: i32, off_y: i32) {
    if stage >= 5 {
        cell(buf, 10, 33, 16, 3, off_x, off_y, c(19));
        cell(buf, 10, 33, 16, 1, off_x, off_y, c(20));
        cell(buf, 12, 34, 3, 1, off_x, off_y, c(10));
        cell(buf, 21, 35, 4, 1, off_x, off_y, c(11));
        return;
    }

    cell(buf, 10, 33, 16, 3, off_x, off_y, c(19));
    cell(buf, 10, 33, 16, 1, off_x, off_y, c(20));
    sym(buf, 10, 33, 2, 1, off_x, off_y, c(21));
    sym(buf, 11, 34, 1, 1, off_x, off_y, c(20));

    if stage >= 4 {
        cell(buf, 9, 6, 7, 3, off_x, off_y, c(19));
        cell(buf, 9, 6, 7, 1, off_x, off_y, c(20));
        cell(buf, 9, 6, 3, 1, off_x, off_y, c(21));
        cell(buf, 7, 9, 2, 9, off_x, off_y, c(19));
        px(buf, 8, 17, off_x, off_y, c(20));
        px(buf, 10, 5, off_x, off_y, c(19));
        cell(buf, 11, 8, 2, 1, off_x, off_y, c(10));
        return;
    }

    cell(buf, 14, 0, 8, 1, off_x, off_y, c(20));
    cell(buf, 12, 1, 12, 1, off_x, off_y, c(20));
    cell(buf, 10, 2, 16, 1, off_x, off_y, c(20));
    cell(buf, 9, 3, 18, 1, off_x, off_y, c(20));
    cell(buf, 8, 4, 20, 4, off_x, off_y, c(20));
    cell(buf, 7, 8, 22, 1, off_x, off_y, c(20));
    cell(buf, 7, 9, 22, 1, off_x, off_y, c(19));

    if stage == 0 {
        cell(buf, 14, 0, 4, 1, off_x, off_y, c(22));
        cell(buf, 12, 1, 4, 1, off_x, off_y, c(22));
        cell(buf, 10, 2, 4, 1, off_x, off_y, c(21));
        cell(buf, 9, 3, 3, 1, off_x, off_y, c(21));
        cell(buf, 8, 4, 2, 4, off_x, off_y, c(21));
        cell(buf, 7, 8, 4, 1, off_x, off_y, c(21));
        sym(buf, 10, 7, 1, 1, off_x, off_y, c(22));
    } else {
        cell(buf, 12, 1, 3, 1, off_x, off_y, c(21));
        cell(buf, 10, 2, 3, 1, off_x, off_y, c(21));
        cell(buf, 8, 4, 2, 3, off_x, off_y, c(21));
    }

    cell(buf, 20, 0, 2, 1, off_x, off_y, c(19));
    cell(buf, 21, 1, 3, 1, off_x, off_y, c(19));
    cell(buf, 23, 2, 3, 1, off_x, off_y, c(19));
    cell(buf, 24, 3, 3, 1, off_x, off_y, c(19));
    cell(buf, 25, 4, 3, 4, off_x, off_y, c(19));
    cell(buf, 25, 8, 4, 1, off_x, off_y, c(19));

    if stage < 2 {
        cell(buf, 17, 0, 3, 9, off_x, off_y, c(15));
        cell(buf, 17, 0, 1, 9, off_x, off_y, c(16));
        cell(buf, 19, 2, 1, 7, off_x, off_y, c(14));
        px(buf, 17, 1, off_x, off_y, c(17));
        px(buf, 17, 5, off_x, off_y, c(17));
    } else {
        cell(buf, 17, 7, 2, 2, off_x, off_y, c(14));
        px(buf, 18, 6, off_x, off_y, c(19));
        px(buf, 17, 6, off_x, off_y, c(10));
    }

    if stage >= 1 {
        cell(buf, 24, 3, 1, 4, off_x, off_y, c(19));
        cell(buf, 13, 4, 2, 1, off_x, off_y, c(19));
        px(buf, 12, 5, off_x, off_y, c(19));
    }
    if stage >= 2 {
        px(buf, 15, 2, off_x, off_y, c(19));
        cell(buf, 15, 3, 1, 2, off_x, off_y, c(19));
        px(buf, 16, 5, off_x, off_y, c(19));
        px(buf, 14, 5, off_x, off_y, c(19));
        cell(buf, 22, 4, 3, 1, off_x, off_y, c(19));
        px(buf, 21, 5, off_x, off_y, c(19));
    }
    if stage >= 3 {
        cell(buf, 11, 3, 3, 2, off_x, off_y, c(3));
        px(buf, 10, 5, off_x, off_y, c(2));
        cell(buf, 21, 5, 3, 2, off_x, off_y, c(3));
        px(buf, 23, 4, off_x, off_y, c(4));
        cell(buf, 16, 8, 4, 1, off_x, off_y, c(3));
        px(buf, 20, 2, off_x, off_y, c(3));
        cell(buf, 14, 6, 2, 1, off_x, off_y, c(10));
        px(buf, 22, 7, off_x, off_y, c(12));
    }

    let left_bot = if stage >= 3 { 16 } else if stage >= 2 { 21 } else { 25 };
    let left_w = if off_x < 0 { 2 } else { 3 };
    cell(buf, 7, 9, left_w, left_bot - 9, off_x, off_y, c(20));
    cell(buf, 7, 9, 1, left_bot - 9, off_x, off_y, c(21));
    if stage < 3 {
        px(buf, 8, 13, off_x, off_y, c(22));
    }
    if stage >= 2 {
        cell(buf, 7, left_bot - 1, left_w, 1, off_x, off_y, c(19));
    }

    let right_bot = if stage >= 3 { 14 } else if stage >= 2 { 19 } else { 25 };
    let right_w = if off_x > 0 { 2 } else { 3 };
    cell(buf, 29 - right_w, 9, right_w, right_bot - 9, off_x, off_y, c(20));
    cell(buf, 28, 9, 1, right_bot - 9, off_x, off_y, c(19));
    if stage < 2 {
        px(buf, 27, 13, off_x, off_y, c(21));
        px(buf, 27, 20, off_x, off_y, c(21));
    } else {
        cell(buf, 29 - right_w, right_bot - 1, right_w, 1, off_x, off_y, c(19));
    }
}

fn paint_skin(buf: &mut [Rgba], off_x: i32, off_y: i32) {
    cell(buf, 10, 9, 16, 17, off_x, off_y, c(24));
    cell(buf, 11, 26, 14, 2, off_x, off_y, c(24));
    cell(buf, 12, 28, 12, 1, off_x, off_y, c(24));
    cell(buf, 13, 29, 10, 1, off_x, off_y, c(24));
    cell(buf, 14, 30, 8, 1, off_x, off_y, c(24));
    cell(buf, 15, 31, 6, 1, off_x, off_y, c(24));
    cell(buf, 15, 32, 6, 2, off_x, off_y, c(24));
    sym_px(buf, 10, 9, off_x, off_y, c(23));

    cell(buf, 11, 10, 9, 2, off_x, off_y, c(25));
    cell(buf, 11, 10, 5, 1, off_x, off_y, c(17));
    cell(buf, 22, 10, 4, 4, off_x, off_y, c(23));
    cell(buf, 24, 12, 2, 14, off_x, off_y, c(27));
    cell(buf, 10, 12, 1, 14, off_x, off_y, c(23));
    cell(buf, 23, 14, 1, 12, off_x, off_y, c(23));

    cell(buf, 11, 18, 3, 3, off_x, off_y, c(25));
    px(buf, 11, 18, off_x, off_y, c(17));
    cell(buf, 21, 18, 3, 3, off_x, off_y, c(24));
    cell(buf, 11, 21, 4, 1, off_x, off_y, c(23));
    cell(buf, 21, 21, 3, 1, off_x, off_y, c(27));

    sym(buf, 11, 13, 6, 2, off_x, off_y, c(23));
    sym(buf, 11, 13, 6, 1, off_x, off_y, c(27));
    sym(buf, 11, 18, 5, 1, off_x, off_y, c(25));
    sym_px(buf, 10, 15, off_x, off_y, c(26));
    sym_px(buf, 10, 17, off_x, off_y, c(26));
    cell(buf, 17, 11, 1, 3, off_x, off_y, c(27));
    cell(buf, 19, 11, 1, 3, off_x, off_y, c(27));

    cell(buf, 12, 28, 12, 1, off_x, off_y, c(23));
    cell(buf, 13, 29, 10, 1, off_x, off_y, c(23));
    cell(buf, 14, 30, 8, 1, off_x, off_y, c(27));
    cell(buf, 15, 31, 6, 1, off_x, off_y, c(26));
    cell(buf, 15, 32, 6, 2, off_x, off_y, c(27));
    cell(buf, 16, 30, 4, 1, off_x, off_y, c(25));
}

fn paint_brow(buf: &mut [Rgba], mood: Mood, tier: Expr, off_x: i32, off_y: i32) {
    let angry = mood == Mood::Wince || tier == Expr::Dying || tier == Expr::Bloodied;
    let y = if angry { 13 } else { 12 };
    sym(buf, 11, y, 6, 1, off_x, off_y, c(2));
    sym(buf, 11, y - 1, 5, 1, off_x, off_y, c(26));
    sym(buf, 11, y, 3, 1, off_x, off_y, c(3));
    sym_px(buf, 12, y, off_x, off_y, c(4));
    if angry {
        sym(buf, 15, y + 1, 2, 1, off_x, off_y, c(2));
        cell(buf, 17, 14, 2, 1, off_x, off_y, c(26));
    }
}

fn paint_eyes(buf: &mut [Rgba], mood: Mood, tier: Expr, off_x: i32, off_y: i32, look_y: f64, blink: bool) {
    if mood == Mood::Dead {
        // Sockets and exposed skull eyes are handled in paint_death()
        return;
    }
    if blink {
        sym(buf, 11, 14, 5, 3, off_x, off_y, c(23));
        sym(buf, 11, 14, 5, 1, off_x, off_y, c(27));
        sym(buf, 11, 16, 5, 1, off_x, off_y, c(26));
        return;
    }

    let squint = mood == Mood::Wince || tier == Expr::Dying;
    let dy = (look_y.round() as i32).clamp(-1, 1);
    let ox = (off_x / 2).clamp(-1, 1);

    let eh = if squint { 2 } else { 4 };
    let ey = if squint { 15 } else { 14 };
    sym(buf, 11, ey, 5, eh, off_x, off_y, c(22));
    sym(buf, 11, ey, 5, 1, off_x, off_y, c(23));

    // CONJUGATED GAZE — DOOM STATUS BAR STYLE:
    // Both irises and pupils shift together in the direction of the gaze (ox).
    // Left eye spans x: 11..15. Centered iris is at x: 12..13.
    // Right eye spans x: 20..24. Centered iris is at x: 22..23.
    let l_iris_x = 12 + ox;
    let r_iris_x = 22 + ox;
    let iy = if squint { 15 } else { 15 + dy };

    // Irises
    cell(buf, l_iris_x, iy, 2, 2, off_x, off_y, c(29));
    cell(buf, l_iris_x, iy + 1, 2, 1, off_x, off_y, c(30));
    cell(buf, r_iris_x, iy, 2, 2, off_x, off_y, c(29));
    cell(buf, r_iris_x, iy + 1, 2, 1, off_x, off_y, c(30));

    // Pupils (darkest point of gaze, shift with look direction)
    let p_offset = if ox > 0 { 1 } else { 0 };
    px(buf, l_iris_x + p_offset, iy, off_x, off_y, c(1));
    px(buf, r_iris_x + p_offset, iy, off_x, off_y, c(1));

    // Catch-light / Glint (always top-left keylight, so upper-left of each iris)
    if !squint {
        let g_offset = if ox > 0 { 0 } else { 1 };
        px(buf, l_iris_x + g_offset, iy, off_x, off_y, c(18));
        px(buf, r_iris_x + g_offset, iy, off_x, off_y, c(18));
    }

    sym(buf, 11, ey + eh, 5, 1, off_x, off_y, c(25));

    if squint {
        sym(buf, 11, 13, 5, 2, off_x, off_y, c(23));
        sym(buf, 11, 14, 5, 1, off_x, off_y, c(26));
    }
    if tier == Expr::Dying && !squint {
        sym(buf, 11, 13, 5, 1, off_x, off_y, c(22));
    }
}

fn paint_nose(buf: &mut [Rgba], off_x: i32, off_y: i32) {
    cell(buf, 16, 13, 4, 6, off_x, off_y, c(24));
    cell(buf, 16, 13, 2, 6, off_x, off_y, c(25));
    cell(buf, 16, 14, 1, 4, off_x, off_y, c(17));
    cell(buf, 19, 14, 1, 5, off_x, off_y, c(23));

    cell(buf, 16, 18, 4, 2, off_x, off_y, c(25));
    cell(buf, 16, 18, 2, 1, off_x, off_y, c(17));
    cell(buf, 19, 18, 1, 2, off_x, off_y, c(23));

    px(buf, 15, 19, off_x, off_y, c(27));
    px(buf, 20, 19, off_x, off_y, c(26));
    px(buf, 16, 20, off_x, off_y, c(26));
    px(buf, 19, 20, off_x, off_y, c(26));
    cell(buf, 17, 20, 2, 1, off_x, off_y, c(23));
}

fn paint_moustache(buf: &mut [Rgba], tier: Expr, off_x: i32, off_y: i32) {
    let grey = if tier == Expr::Fresh || tier == Expr::Steady { c(28) } else { c(4) };
    sym(buf, 12, 21, 6, 2, off_x, off_y, c(26));
    sym(buf, 12, 21, 4, 1, off_x, off_y, c(27));
    sym_px(buf, 12, 22, off_x, off_y, c(27));
    sym_px(buf, 13, 21, off_x, off_y, grey);
    cell(buf, 17, 21, 2, 1, off_x, off_y, c(23));
}

fn paint_beard(buf: &mut [Rgba], tier: Expr, off_x: i32, off_y: i32) {
    let worn = tier != Expr::Fresh && tier != Expr::Steady;
    let body = if worn { c(27) } else { c(26) };

    cell(buf, 10, 16, 2, 6, off_x, off_y, body);
    cell(buf, 11, 22, 2, 3, off_x, off_y, body);
    cell(buf, 12, 25, 2, 2, off_x, off_y, body);
    cell(buf, 13, 27, 2, 2, off_x, off_y, body);

    cell(buf, 24, 16, 2, 6, off_x, off_y, c(26));
    cell(buf, 23, 22, 2, 3, off_x, off_y, c(26));
    cell(buf, 22, 25, 2, 2, off_x, off_y, c(26));
    cell(buf, 21, 27, 2, 2, off_x, off_y, c(26));

    cell(buf, 16, 28, 4, 3, off_x, off_y, body);
    cell(buf, 18, 28, 2, 3, off_x, off_y, c(26));
    cell(buf, 16, 27, 4, 1, off_x, off_y, c(26));

    px(buf, 10, 18, off_x, off_y, c(28));
    px(buf, 25, 20, off_x, off_y, c(28));
    px(buf, 11, 23, off_x, off_y, c(28));
    px(buf, 24, 23, off_x, off_y, c(28));
    px(buf, 17, 29, off_x, off_y, c(28));
    px(buf, 11, 20, off_x, off_y, c(4));
    px(buf, 18, 30, off_x, off_y, c(4));

    if !worn {
        return;
    }
    px(buf, 12, 21, off_x, off_y, c(28));
    px(buf, 23, 22, off_x, off_y, c(28));
    px(buf, 13, 26, off_x, off_y, c(28));
    px(buf, 19, 30, off_x, off_y, c(4));
}

fn paint_mouth(buf: &mut [Rgba], mood: Mood, off_x: i32, off_y: i32) {
    match mood {
        Mood::Grin => {
            cell(buf, 13, 23, 10, 3, off_x, off_y, c(10));
            cell(buf, 13, 23, 10, 1, off_x, off_y, c(21));
            cell(buf, 14, 25, 8, 1, off_x, off_y, c(21));
            for x in (14..23).step_by(2) {
                px(buf, x, 23, off_x, off_y, c(26));
            }
            sym_px(buf, 12, 23, off_x, off_y, c(25));
            sym_px(buf, 12, 24, off_x, off_y, c(23));
        }
        Mood::Smile => {
            cell(buf, 14, 23, 8, 2, off_x, off_y, c(10));
            cell(buf, 15, 23, 6, 1, off_x, off_y, c(21));
            cell(buf, 14, 25, 8, 1, off_x, off_y, c(25));
            sym_px(buf, 13, 23, off_x, off_y, c(25));
            sym_px(buf, 13, 22, off_x, off_y, c(23));
        }
        Mood::Wince => {
            cell(buf, 13, 23, 10, 3, off_x, off_y, c(10));
            cell(buf, 13, 23, 10, 1, off_x, off_y, c(21));
            cell(buf, 13, 25, 10, 1, off_x, off_y, c(21));
            for x in (14..23).step_by(2) {
                px(buf, x, 24, off_x, off_y, c(11));
            }
            sym_px(buf, 12, 25, off_x, off_y, c(26));
        }
        Mood::Dead => {
            cell(buf, 14, 23, 8, 3, off_x, off_y, c(10));
            cell(buf, 15, 23, 6, 1, off_x, off_y, c(10));
            cell(buf, 15, 24, 2, 1, off_x, off_y, c(21));
            px(buf, 18, 24, off_x, off_y, c(21));
            px(buf, 20, 24, off_x, off_y, c(21));
            cell(buf, 17, 25, 2, 1, off_x, off_y, c(12));
        }
        Mood::Dying => {
            cell(buf, 14, 23, 8, 3, off_x, off_y, c(10));
            cell(buf, 15, 23, 6, 1, off_x, off_y, c(11));
            cell(buf, 15, 24, 3, 1, off_x, off_y, c(21));
            px(buf, 16, 25, off_x, off_y, c(11));
        }
        Mood::Bloodied | Mood::Hurt => {
            cell(buf, 14, 24, 8, 1, off_x, off_y, c(10));
            cell(buf, 14, 23, 8, 1, off_x, off_y, c(27));
            cell(buf, 15, 25, 6, 1, off_x, off_y, c(25));
            sym_px(buf, 13, 23, off_x, off_y, c(23));
            sym_px(buf, 13, 25, off_x, off_y, c(26));
        }
        Mood::Fresh | Mood::Steady => {
            cell(buf, 14, 24, 8, 1, off_x, off_y, c(26));
            cell(buf, 15, 23, 6, 1, off_x, off_y, c(23));
            cell(buf, 16, 25, 4, 1, off_x, off_y, c(25));
        }
    }
}

fn paint_damage(buf: &mut [Rgba], tier: Expr, off_x: i32, off_y: i32) {
    if tier == Expr::Fresh {
        return;
    }
    if tier == Expr::Dead {
        paint_death(buf, off_x, off_y);
        return;
    }

    cell(buf, 11, 20, 4, 1, off_x, off_y, c(11));
    px(buf, 11, 20, off_x, off_y, c(10));
    px(buf, 14, 20, off_x, off_y, c(12));
    if tier == Expr::Steady {
        return;
    }

    cell(buf, 24, 10, 2, 4, off_x, off_y, c(11));
    cell(buf, 24, 10, 1, 4, off_x, off_y, c(10));
    px(buf, 25, 12, off_x, off_y, c(12));
    cell(buf, 24, 14, 1, 3, off_x, off_y, c(10));
    cell(buf, 21, 18, 3, 1, off_x, off_y, c(10));
    px(buf, 22, 18, off_x, off_y, c(12));
    if tier == Expr::Hurt {
        return;
    }

    cell(buf, 14, 26, 3, 1, off_x, off_y, c(13));
    cell(buf, 13, 27, 2, 1, off_x, off_y, c(11));
    cell(buf, 21, 19, 3, 2, off_x, off_y, c(11));
    cell(buf, 22, 20, 2, 1, off_x, off_y, c(12));
    px(buf, 18, 11, off_x, off_y, c(5));
    px(buf, 12, 16, off_x, off_y, c(10));
    if tier == Expr::Bloodied {
        return;
    }

    // Dying
    cell(buf, 11, 10, 5, 1, off_x, off_y, c(11));
    cell(buf, 12, 11, 2, 4, off_x, off_y, c(10));
    px(buf, 13, 15, off_x, off_y, c(12));
    cell(buf, 20, 23, 4, 2, off_x, off_y, c(13));
    cell(buf, 21, 25, 2, 3, off_x, off_y, c(11));
    cell(buf, 11, 13, 5, 1, off_x, off_y, c(10));
    px(buf, 22, 12, off_x, off_y, c(5));
    px(buf, 12, 18, off_x, off_y, c(5));
    px(buf, 16, 9, off_x, off_y, c(5));
}

fn paint_death(buf: &mut [Rgba], off_x: i32, off_y: i32) {
    // ── 1. SUNKEN & DRAINED CORPSE FLESH ──
    cell(buf, 11, 20, 4, 2, off_x, off_y, c(26));
    cell(buf, 10, 24, 2, 2, off_x, off_y, c(26));
    cell(buf, 23, 24, 2, 2, off_x, off_y, c(26));

    cell(buf, 11, 10, 5, 1, off_x, off_y, c(25));
    cell(buf, 16, 14, 1, 4, off_x, off_y, c(25));
    cell(buf, 16, 18, 2, 1, off_x, off_y, c(25));
    px(buf, 11, 18, off_x, off_y, c(25));

    // ── 2. LEFT EYE: DEAD COLLAPSED MORTIS SOCKET (NO CARTOON 'X') ──
    cell(buf, 11, 13, 5, 1, off_x, off_y, c(27)); // deep upper brow shadow
    cell(buf, 11, 14, 5, 2, off_x, off_y, c(23)); // collapsed dead eyelid
    cell(buf, 12, 15, 3, 1, off_x, off_y, c(27)); // sunken eye slit
    px(buf, 13, 15, off_x, off_y, c(1));          // dark center slit
    cell(buf, 11, 17, 5, 1, off_x, off_y, c(26)); // bruised orbital hollow below

    // ── 3. EXPOSED CRANIUM DOME UNDER SHATTERED HELMET ──
    // Fractured metal rim framing the cracked bone dome
    cell(buf, 19, 2, 1, 6, off_x, off_y, c(19));
    px(buf, 20, 2, off_x, off_y, c(12));
    px(buf, 20, 7, off_x, off_y, c(11));

    // Exposed parietal cranium bone
    cell(buf, 20, 2, 5, 6, off_x, off_y, c(4));
    cell(buf, 21, 2, 4, 1, off_x, off_y, c(5));
    cell(buf, 21, 3, 3, 2, off_x, off_y, c(5));
    cell(buf, 24, 4, 1, 4, off_x, off_y, c(3));
    // Cranial fissure / fracture suture lines
    px(buf, 22, 4, off_x, off_y, c(2));
    px(buf, 23, 5, off_x, off_y, c(1));
    px(buf, 23, 6, off_x, off_y, c(2));

    // ── 4. RIGHT EYE: FULL EXPOSED SKELETAL ORBITAL SOCKET ──
    // Supraorbital bone brow ridge above
    cell(buf, 20, 12, 5, 1, off_x, off_y, c(4));
    cell(buf, 21, 12, 3, 1, off_x, off_y, c(5));

    // The deep, hollow, pitch-black skull orbital void
    cell(buf, 20, 13, 5, 5, off_x, off_y, c(1));
    cell(buf, 21, 14, 3, 3, off_x, off_y, c(0)); // deep void black interior

    // Zygomatic cheekbone arch below the eye
    cell(buf, 20, 18, 5, 1, off_x, off_y, c(4));
    cell(buf, 21, 18, 3, 1, off_x, off_y, c(5));
    px(buf, 24, 17, off_x, off_y, c(3));

    // Jagged blood-torn skin edge framing the eye socket
    cell(buf, 19, 13, 1, 6, off_x, off_y, c(11));
    px(buf, 19, 15, off_x, off_y, c(12));
    cell(buf, 25, 13, 1, 5, off_x, off_y, c(10));

    // ── 5. SKELETAL NASAL APERTURE (PIRIFORM CAVITY) ──
    // Cartilage sheared away, exposing the dark triangular skull nasal cavity
    cell(buf, 17, 15, 2, 1, off_x, off_y, c(5));
    cell(buf, 17, 16, 2, 4, off_x, off_y, c(1));
    cell(buf, 17, 17, 2, 2, off_x, off_y, c(0)); // deep void core
    px(buf, 16, 17, off_x, off_y, c(4));
    px(buf, 19, 17, off_x, off_y, c(11));
    px(buf, 16, 18, off_x, off_y, c(3));
    px(buf, 19, 18, off_x, off_y, c(10));
    cell(buf, 17, 20, 2, 1, off_x, off_y, c(2));

    // ── 6. EXPOSED MAXILLA, JAWBONE & GRINNING SKULL TEETH ──
    // Torn cheek border
    cell(buf, 20, 21, 6, 1, off_x, off_y, c(12));
    cell(buf, 20, 22, 1, 5, off_x, off_y, c(11));
    cell(buf, 21, 26, 5, 1, off_x, off_y, c(11));
    px(buf, 26, 22, off_x, off_y, c(10));
    px(buf, 26, 25, off_x, off_y, c(10));

    // Maxilla and jaw bone surface
    cell(buf, 21, 22, 5, 1, off_x, off_y, c(4));
    cell(buf, 22, 22, 3, 1, off_x, off_y, c(5));
    cell(buf, 25, 22, 1, 2, off_x, off_y, c(3));

    // Upper teeth arch (individual teeth in boneHi separated by dark ink notches)
    cell(buf, 21, 23, 5, 1, off_x, off_y, c(5));
    px(buf, 22, 23, off_x, off_y, c(1));
    px(buf, 24, 23, off_x, off_y, c(1));

    // Dark dental interstitial void between upper and lower teeth
    cell(buf, 20, 24, 6, 1, off_x, off_y, c(1));
    cell(buf, 21, 24, 4, 1, off_x, off_y, c(0));

    // Lower teeth arch
    cell(buf, 21, 25, 4, 1, off_x, off_y, c(4));
    px(buf, 23, 25, off_x, off_y, c(1));

    // ── 7. CLEAN COMBAT WOUNDS (PURPOSEFUL, NO NOISE) ──
    cell(buf, 10, 10, 2, 5, off_x, off_y, c(11));
    cell(buf, 10, 10, 1, 5, off_x, off_y, c(10));
    px(buf, 11, 12, off_x, off_y, c(12));

    cell(buf, 14, 26, 3, 1, off_x, off_y, c(13));
    cell(buf, 13, 27, 2, 1, off_x, off_y, c(11));
    cell(buf, 14, 27, 1, 2, off_x, off_y, c(12));
    px(buf, 14, 29, off_x, off_y, c(11));
}

// ── Top-Level 1:1 API Adapters ──

pub fn create_face() -> FaceState {
    FaceState::new()
}

pub fn dispose_face(_state: &mut FaceState) {
    // Reset/dispose hooks matching legacy
}

pub fn set_face_health(state: &mut FaceState, current_hp: u32, current_max: u32) {
    state.set_health(current_hp, current_max);
}

pub fn face_on_damage(state: &mut FaceState, source_angle: Option<f64>) {
    state.on_damage(source_angle);
}

pub fn face_on_heal(state: &mut FaceState) {
    state.on_heal();
}

pub fn face_on_special(state: &mut FaceState) {
    state.on_special();
}

pub fn render_face(state: &mut FaceState, dt: f64) {
    state.render(dt);
}

pub fn dead_face() -> FaceState {
    let mut s = FaceState::default();
    s.hp = 0;
    s.paint();
    s
}

pub fn face_contact_sheet() -> Vec<Rgba> {
    let pad = 16usize;
    let tiers: &[(&str, f64)] = &[
        ("fresh", 1.0),
        ("steady", 0.7),
        ("hurt", 0.5),
        ("bloodied", 0.3),
        ("dying", 0.12),
        ("dead", 0.0),
    ];
    let moods_len = 7usize;
    let width = pad + moods_len * (FACE_PX + pad);
    let height = pad * 2 + tiers.len() * (FACE_PX + pad);
    let mut sheet = vec![c(0); width * height];

    for (row, &(_tier_name, frac)) in tiers.iter().enumerate() {
        for col in 0..moods_len {
            let mut face = FaceState::default();
            face.max_hp = 100;
            face.hp = (frac * 100.0).round() as u32;
            match col {
                1 => face.turn = -1,
                2 => face.turn = 1,
                3 => face.pain_t = 0.3,
                4 => face.heal_t = 0.4,
                5 => face.special_t = 0.6,
                6 => face.blink_for = 0.1,
                _ => {}
            }
            face.paint();

            let dest_x = pad + col * (FACE_PX + pad);
            let dest_y = pad * 2 + row * (FACE_PX + pad);

            for y in 0..FACE_PX {
                for x in 0..FACE_PX {
                    let col_val = face.buffer[y * FACE_PX + x];
                    let idx = (dest_y + y) * width + (dest_x + x);
                    sheet[idx] = col_val;
                }
            }
        }
    }

    sheet
}
