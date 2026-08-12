//! The intro's 2D side-scroller gag, painted on the CPU.
//!
//! A faithful port of `paintOverworld`/`beginShatter`/`paintShatter` from
//! legacy `intro/index.ts`: the suspiciously cheerful 1985 overworld the
//! knight sprints through before the world shatters into the dungeon. The
//! legacy code painted a 480-wide 2D canvas with `image-rendering:pixelated`;
//! this paints the same 480-wide RGBA buffer and lets a nearest-sampled
//! fullscreen UI image do the pixelation.
//!
//! Differences owned deliberately (P5 debt, listed in the docs checklist):
//! the HUD/skip text and the block's "?" pulse-scale are Bevy UI / a bitmap
//! glyph instead of the pixel font, and the knight paints into this buffer
//! rather than a second display-resolution canvas (slightly softer sprite).
//! Particle jitter uses a seeded Mulberry32 where legacy used Math.random().
//!
//! PORTS: `intro/index.ts`

use pk_core::intro::{BONK_DUR, JUMP_T, RUN_DUR, SHATTER_DUR};
use pk_core::rng::Mulberry32;

// Choreography-fixed layout (intro/index.ts).
pub const BW: i32 = 480;
/// round(SPRITE_PIXEL_GRID × 1.4): 84 (PPU "wider" × 3/2) × the legacy SCALE.
pub const KH: i32 = 118;
const JUMP_H: f64 = 64.0;
const SCROLL_SPEED: f64 = 150.0;
const BLOCK: i32 = 40; // brick side
const BLOCK_CLEAR: i32 = KH + JUMP_H as i32 - 8; // bottom of brick: headbutt at apex
const CELL: i32 = 40; // shatter piece side

fn kx() -> i32 {
    (f64::from(BW) * 0.3).round() as i32 // knight screen x
}
fn block_world_x() -> f64 {
    f64::from(kx()) + SCROLL_SPEED * RUN_DUR // arrives overhead at bonk
}

/// The knight's E-sheet on the CPU: quartered RGBA pixels plus per-clip cell
/// rects (px, in quartered coords). `ball` may be empty — the published sheet
/// doesn't author it; callers fall back to `run` exactly as legacy did.
pub struct CpuSheet {
    pub w: u32,
    pub h: u32,
    pub px: Vec<u8>,
    pub run: Vec<[u32; 4]>,
    pub roll: Vec<[u32; 4]>,
}

#[derive(Clone, Copy)]
struct Particle2D {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    size: f64,
    color: [u8; 4],
    alpha: f64,
    life: f64,
    max_life: f64,
    gravity: f64,
}

#[derive(Clone, Copy)]
struct CoinPop {
    x: f64,
    y: f64,
    vy: f64,
    rot: f64,
    life: f64,
}

#[derive(Clone, Copy)]
struct Piece {
    sx: i32,
    sy: i32,
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    rot: f64,
    vr: f64,
}

/// All the 2D gag's mutable painting state — what lived in `runPinballIntro`'s
/// closure scope.
pub struct Overworld {
    pub h: i32, // BH: derived from the window aspect at intro start
    ground_y: i32,
    pub buf: Vec<u8>, // BW × h RGBA
    rng: Mulberry32,
    particles: Vec<Particle2D>,
    dust_timer: f64,
    has_launched_jump: bool,
    has_spawned_bonk_fx: bool,
    coin: Option<CoinPop>,
    pub shake: f64,
    pieces: Vec<Piece>,
    snap: Option<Vec<u8>>,
    /// Coin HUD flips 00 → 01 on the bonk; the UI system reads it.
    pub coins: u32,
}

fn hex(c: u32) -> [u8; 4] {
    [(c >> 16) as u8, (c >> 8) as u8, c as u8, 255]
}

impl Overworld {
    pub fn new(window_w: f64, window_h: f64) -> Self {
        let h = (((f64::from(BW) * window_h) / window_w.max(1.0)).round() as i32).clamp(216, 360);
        Self {
            h,
            ground_y: h - 52,
            buf: vec![0; (BW * h * 4) as usize],
            rng: Mulberry32::new(0xC0FFEE),
            particles: Vec::new(),
            dust_timer: 0.0,
            has_launched_jump: false,
            has_spawned_bonk_fx: false,
            coin: None,
            shake: 0.0,
            pieces: Vec::new(),
            snap: None,
            coins: 0,
        }
    }

    fn rand(&mut self) -> f64 {
        self.rng.next_f64()
    }

    // ── Raster primitives (the ctx calls the port needs, nothing more) ──

    fn clear(&mut self) {
        self.buf.fill(0);
    }

    fn plot(&mut self, x: i32, y: i32, c: [u8; 4], a: f64) {
        if x < 0 || y < 0 || x >= BW || y >= self.h {
            return;
        }
        let i = ((y * BW + x) * 4) as usize;
        let a = (a * f64::from(c[3]) / 255.0).clamp(0.0, 1.0);
        if a <= 0.0 {
            return;
        }
        for (dst, src) in self.buf[i..i + 3].iter_mut().zip(c) {
            *dst = (f64::from(src) * a + f64::from(*dst) * (1.0 - a)).round() as u8;
        }
        let da = f64::from(self.buf[i + 3]) / 255.0;
        self.buf[i + 3] = ((a + da * (1.0 - a)) * 255.0).round() as u8;
    }

    fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: [u8; 4], a: f64) {
        for yy in y.max(0)..(y + h).min(self.h) {
            for xx in x.max(0)..(x + w).min(BW) {
                self.plot(xx, yy, c, a);
            }
        }
    }

    /// Vertical linear gradient, top → bottom colour.
    fn vgrad(&mut self, x: i32, y: i32, w: i32, h: i32, top: [u8; 4], bottom: [u8; 4]) {
        for yy in y.max(0)..(y + h).min(self.h) {
            let t = f64::from(yy - y) / f64::from(h.max(1));
            let c = [
                (f64::from(top[0]) + (f64::from(bottom[0]) - f64::from(top[0])) * t) as u8,
                (f64::from(top[1]) + (f64::from(bottom[1]) - f64::from(top[1])) * t) as u8,
                (f64::from(top[2]) + (f64::from(bottom[2]) - f64::from(top[2])) * t) as u8,
                255,
            ];
            for xx in x.max(0)..(x + w).min(BW) {
                self.plot(xx, yy, c, 1.0);
            }
        }
    }

    /// The top half-disc `ctx.arc(cx, cy, r, PI, 0)` + fill produces (canvas
    /// y-down: the sweep passes through "up").
    fn fill_half_disc_up(&mut self, cx: i32, cy: i32, r: i32, c: [u8; 4]) {
        for dy in -r..=0 {
            let span = ((r * r - dy * dy) as f64).sqrt() as i32;
            for dx in -span..=span {
                self.plot(cx + dx, cy + dy, c, 1.0);
            }
        }
    }

    fn fill_circle(&mut self, cx: f64, cy: f64, r: f64, c: [u8; 4], a: f64) {
        let ri = r.ceil() as i32;
        for dy in -ri..=ri {
            for dx in -ri..=ri {
                if f64::from(dx) * f64::from(dx) + f64::from(dy) * f64::from(dy) <= r * r {
                    self.plot(cx as i32 + dx, cy as i32 + dy, c, a);
                }
            }
        }
    }

    fn fill_ellipse(&mut self, cx: f64, cy: f64, rx: f64, ry: f64, c: [u8; 4], a: f64) {
        let (rxi, ryi) = (rx.ceil() as i32, ry.ceil() as i32);
        for dy in -ryi..=ryi {
            for dx in -rxi..=rxi {
                let u = f64::from(dx) / rx.max(1e-6);
                let v = f64::from(dy) / ry.max(1e-6);
                if u * u + v * v <= 1.0 {
                    self.plot(cx as i32 + dx, cy as i32 + dy, c, a);
                }
            }
        }
    }

    /// Nearest-sampled `drawImage` of one sheet cell, dest-driven.
    #[allow(clippy::too_many_arguments)]
    fn blit_cell(&mut self, sheet: &CpuSheet, cell: [u32; 4], dx: f64, dy: f64, dw: f64, dh: f64) {
        let (sx, sy) = (cell[0] as f64, cell[1] as f64);
        let (sw, sh) = ((cell[2] - cell[0]) as f64, (cell[3] - cell[1]) as f64);
        let (x0, y0) = (dx.floor() as i32, dy.floor() as i32);
        let (x1, y1) = ((dx + dw).ceil() as i32, (dy + dh).ceil() as i32);
        for yy in y0.max(0)..y1.min(self.h) {
            for xx in x0.max(0)..x1.min(BW) {
                let u = (f64::from(xx) + 0.5 - dx) / dw;
                let v = (f64::from(yy) + 0.5 - dy) / dh;
                if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
                    continue;
                }
                let px = (sx + u * sw) as u32;
                let py = (sy + v * sh) as u32;
                if px >= sheet.w || py >= sheet.h {
                    continue;
                }
                let si = ((py * sheet.w + px) * 4) as usize;
                let c = [
                    sheet.px[si],
                    sheet.px[si + 1],
                    sheet.px[si + 2],
                    sheet.px[si + 3],
                ];
                if c[3] > 0 {
                    self.plot(xx, yy, c, 1.0);
                }
            }
        }
    }

    /// The pulsing "?" — a 5×7 bitmap at 3× ≈ the 22px pixel-font glyph.
    fn question_mark(&mut self, cx: i32, cy: i32, c: [u8; 4]) {
        const Q: [&[u8; 5]; 7] = [
            b".###.", b"#...#", b"....#", b"...#.", b"..#..", b".....", b"..#..",
        ];
        const S: i32 = 3;
        for (r, row) in Q.iter().enumerate() {
            for (col, ch) in row.iter().enumerate() {
                if *ch == b'#' {
                    self.fill_rect(
                        cx - (5 * S) / 2 + col as i32 * S,
                        cy - (7 * S) / 2 + r as i32 * S,
                        S,
                        S,
                        c,
                        1.0,
                    );
                }
            }
        }
    }

    // ── The overworld (paintOverworld) ──

    /// `include_knight` is false only for the shatter snapshot — legacy
    /// removed the knight's canvas before snapshotting, so he doesn't break
    /// apart with the world; he materialises as the pinball.
    #[allow(clippy::too_many_arguments)]
    pub fn paint(
        &mut self,
        sheet: &CpuSheet,
        t: f64,
        frozen: bool,
        bonk_t: f64,
        dt: f64,
        include_knight: bool,
    ) {
        let bh = self.h;
        let ground_y = self.ground_y;
        let kx = kx();
        let scroll = SCROLL_SPEED * t.min(RUN_DUR);

        // Global screen-shake translate offset.
        let sx_off = if self.shake > 0.0 {
            (self.rand() - 0.5) * 8.0 * self.shake
        } else {
            0.0
        };
        let sy_off = if self.shake > 0.0 {
            (self.rand() - 0.5) * 6.0 * self.shake
        } else {
            0.0
        };
        let ox = sx_off.round() as i32;
        let oy = sy_off.round() as i32;

        // Sky gradient (overdrawn ±8 like the legacy fill, absorbed by clamp).
        self.vgrad(0, 0, BW, bh, hex(0x5ba9ec), hex(0xc4e4ff));

        // Clouds — two parallax layers.
        let cloud = [255, 255, 255, 235];
        for l in 0..2i32 {
            let speed = if l == 0 { 0.18 } else { 0.34 };
            let y0 = if l == 0 { 34 } else { 66 };
            for k in 0..4i32 {
                let span = f64::from(BW + 120);
                let cx =
                    ((f64::from(k * 173 + l * 61) - scroll * speed) % span + span) % span - 60.0;
                let cx = cx.round() as i32 + ox;
                self.fill_rect(cx, y0 + (k % 2) * 10 + oy, 54, 12, cloud, 1.0);
                self.fill_rect(cx + 10, y0 - 8 + (k % 2) * 10 + oy, 34, 10, cloud, 1.0);
            }
        }

        // Hills.
        for k in 0..5i32 {
            let span = f64::from(BW + 260);
            let hx = ((f64::from(k * 220) - scroll * 0.5) % span + span) % span - 130.0;
            self.fill_half_disc_up(
                hx as i32 + ox,
                ground_y + 10 + oy,
                62 + (k % 2) * 26,
                hex(0x4f9e4f),
            );
        }

        // Ground — grass lip over stone brick courses.
        self.fill_rect(ox, ground_y + oy, BW, 6, hex(0x57b74e), 1.0);
        let mut row = 0;
        let mut y = ground_y + 6;
        while y < bh {
            let mut x = -(((scroll as i32) + (row % 2) * 16) % 32);
            while x < BW {
                let c = if row % 2 == 1 {
                    hex(0x8d8577)
                } else {
                    hex(0x7d7568)
                };
                self.fill_rect(x + ox, y + oy, 30, 14, c, 1.0);
                x += 32;
            }
            y += 16;
            row += 1;
        }

        // Spawn running dust particles.
        if !frozen && t < JUMP_T {
            self.dust_timer += dt;
            if self.dust_timer >= 0.12 {
                self.dust_timer = 0.0;
                let (r1, r2, r3, r4) = (self.rand(), self.rand(), self.rand(), self.rand());
                self.particles.push(Particle2D {
                    x: f64::from(kx) - 12.0 + r1 * 6.0,
                    y: f64::from(ground_y) - 2.0,
                    vx: -40.0 - r2 * 30.0,
                    vy: -10.0 - r3 * 15.0,
                    size: 4.0 + r4 * 3.0,
                    color: [220, 210, 190, 255],
                    alpha: 0.75,
                    life: 0.25,
                    max_life: 0.25,
                    gravity: 20.0,
                });
            }
        }

        // Jump launch dust cloud burst.
        if !frozen && t >= JUMP_T && !self.has_launched_jump {
            self.has_launched_jump = true;
            for _ in 0..8 {
                let (r1, r2, r3, r4) = (self.rand(), self.rand(), self.rand(), self.rand());
                self.particles.push(Particle2D {
                    x: f64::from(kx) + (r1 - 0.5) * 16.0,
                    y: f64::from(ground_y) - 1.0,
                    vx: (r2 - 0.5) * 100.0 - 30.0,
                    vy: -30.0 - r3 * 40.0,
                    size: 5.0 + r4 * 4.0,
                    color: [240, 230, 210, 255],
                    alpha: 0.85,
                    life: 0.35,
                    max_life: 0.35,
                    gravity: 40.0,
                });
            }
        }

        // Bonk impact particles & coin pop spawn.
        if frozen && !self.has_spawned_bonk_fx {
            self.has_spawned_bonk_fx = true;
            self.coins = 1;
            let block_center_x = (block_world_x() - scroll).round();
            let block_bottom_y = f64::from(ground_y - BLOCK_CLEAR - 4);

            self.coin = Some(CoinPop {
                x: block_center_x,
                y: block_bottom_y - f64::from(BLOCK) - 6.0,
                vy: -220.0,
                rot: 0.0,
                life: 0.45,
            });

            for i in 0..14 {
                let (r1, r2, r3, r4, r5, r6) = (
                    self.rand(),
                    self.rand(),
                    self.rand(),
                    self.rand(),
                    self.rand(),
                    self.rand(),
                );
                let angle = r1 * std::f64::consts::TAU;
                let speed = 60.0 + r2 * 140.0;
                let life = 0.3 + r3 * 0.25;
                self.particles.push(Particle2D {
                    x: block_center_x + (r4 - 0.5) * 10.0,
                    y: block_bottom_y + (r5 - 0.5) * 6.0,
                    vx: angle.cos() * speed,
                    vy: angle.sin() * speed,
                    size: 3.0 + r6 * 4.0,
                    color: if i % 2 == 0 {
                        hex(0xffe866)
                    } else {
                        hex(0xffffff)
                    },
                    alpha: 1.0,
                    life,
                    max_life: life,
                    gravity: 200.0,
                });
            }
        }

        // Update and draw overworld particles.
        let mut i = 0;
        while i < self.particles.len() {
            let mut p = self.particles[i];
            p.life -= dt;
            if p.life <= 0.0 {
                self.particles.swap_remove(i);
                continue;
            }
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            self.particles[i] = p;
            let a = (p.life / p.max_life).max(0.0) * p.alpha;
            self.fill_rect(
                (p.x - p.size / 2.0).round() as i32 + ox,
                (p.y - p.size / 2.0).round() as i32 + oy,
                p.size.round() as i32,
                p.size.round() as i32,
                p.color,
                a,
            );
            i += 1;
        }

        // The retro question block.
        let bx = (block_world_x() - scroll - f64::from(BLOCK) / 2.0).round() as i32 + ox;
        let bump = if frozen {
            (10.0 * ((bonk_t / 0.2).min(1.0) * std::f64::consts::PI).sin()).round() as i32
        } else {
            0
        };
        let by = ground_y - BLOCK_CLEAR - BLOCK - bump + oy;

        // Block shadow.
        self.fill_rect(bx + 3, by + BLOCK + bump, BLOCK - 6, 4, [0, 0, 0, 255], 0.2);

        if frozen {
            // Hit state: dark stone block feel.
            self.fill_rect(bx, by, BLOCK, BLOCK, hex(0x4a423a), 1.0);
            self.fill_rect(bx + 3, by + 3, BLOCK - 6, BLOCK - 6, hex(0x6b6156), 1.0);
            self.fill_rect(bx + BLOCK - 3, by + 3, 3, BLOCK - 6, hex(0x2d2823), 1.0);
            self.fill_rect(bx + 3, by + BLOCK - 3, BLOCK - 6, 3, hex(0x2d2823), 1.0);
        } else {
            // Active question block: retro golden orange with bevel highlights.
            self.fill_rect(bx, by, BLOCK, BLOCK, hex(0x3a2a10), 1.0);
            self.vgrad(
                bx + 2,
                by + 2,
                BLOCK - 4,
                BLOCK - 4,
                hex(0xf7b731),
                hex(0xd6790a),
            );
            self.fill_rect(bx + 2, by + 2, BLOCK - 4, 3, hex(0xffe875), 1.0);
            self.fill_rect(bx + 2, by + 2, 3, BLOCK - 4, hex(0xffe875), 1.0);
            self.fill_rect(bx + 2, by + BLOCK - 5, BLOCK - 4, 3, hex(0xa85400), 1.0);
            self.fill_rect(bx + BLOCK - 5, by + 2, 3, BLOCK - 4, hex(0xa85400), 1.0);
            for (rx, ry) in [
                (4, 4),
                (BLOCK - 7, 4),
                (4, BLOCK - 7),
                (BLOCK - 7, BLOCK - 7),
            ] {
                self.fill_rect(bx + rx, by + ry, 3, 3, hex(0x4a2c00), 1.0);
            }
            // Pulsing "?": shadow then highlight (the pulse scaled the font;
            // the bitmap glyph keeps the beat with the flash instead).
            let _pulse = (t * 8.0).sin() * 0.15 + 1.0;
            self.question_mark(bx + BLOCK / 2 + 1, by + BLOCK / 2 + 3, hex(0x4d2300));
            self.question_mark(bx + BLOCK / 2, by + BLOCK / 2 + 1, hex(0xffffff));
        }

        // Coin pop effect.
        if let Some(mut c) = self.coin.take() {
            if c.life > 0.0 {
                c.life -= dt;
                c.vy += 600.0 * dt;
                c.y += c.vy * dt;
                c.rot += dt * 18.0;
                let coin_w = (c.rot.cos().abs() * 16.0).max(2.0);
                let a = (c.life / 0.15).min(1.0);
                self.fill_rect(
                    (c.x - coin_w / 2.0).round() as i32 + ox,
                    c.y.round() as i32 - 10 + oy,
                    coin_w.round() as i32,
                    20,
                    hex(0xffe433),
                    a,
                );
                self.fill_rect(
                    (c.x - coin_w / 4.0).round() as i32 + ox,
                    c.y.round() as i32 - 8 + oy,
                    (coin_w / 2.0).round() as i32,
                    16,
                    hex(0xffb700),
                    a,
                );
                self.coin = Some(c);
            }
        }

        // Knight jump arc.
        let mut y_off = 0.0;
        // Cadence synced to scroll speed for zero foot-sliding.
        let mut frame_cell = sheet.run[(t * 14.0) as usize % sheet.run.len().max(1)];
        if t >= JUMP_T {
            let u = ((t - JUMP_T) / (RUN_DUR - JUMP_T)).min(1.0); // 0→1 rise to apex
            y_off = JUMP_H * (u * std::f64::consts::FRAC_PI_2).sin();
            let roll = if sheet.roll.is_empty() {
                &sheet.run
            } else {
                &sheet.roll
            };
            frame_cell = roll[((u * roll.len() as f64) as usize).min(roll.len() - 1)];
        }
        if frozen {
            y_off = JUMP_H; // hold apex during bonk freeze
            let roll = if sheet.roll.is_empty() {
                &sheet.run
            } else {
                &sheet.roll
            };
            frame_cell = roll[roll.len() - 1];
        }

        if include_knight {
            // Contact shadow.
            self.fill_ellipse(
                f64::from(kx + ox),
                f64::from(ground_y + 4 + oy),
                (26.0 - y_off * 0.22).max(6.0),
                6.0,
                [0, 0, 0, 255],
                0.28,
            );

            // Squash & stretch on hitstop.
            let (mut scale_x, mut scale_y) = (1.0, 1.0);
            if frozen {
                let squash = ((bonk_t / BONK_DUR).min(1.0) * std::f64::consts::PI).sin();
                scale_x = 1.0 + squash * 0.18;
                scale_y = 1.0 - squash * 0.14;
            }
            let base_y = f64::from(ground_y) - y_off + 6.0; // feet y
            let kw = f64::from(KH) * scale_x;
            let kh = f64::from(KH) * scale_y;
            self.blit_cell(
                sheet,
                frame_cell,
                f64::from(kx + ox) - kw / 2.0,
                base_y + f64::from(oy) - kh,
                kw,
                kh,
            );
        }

        // Bonk impact flash & starburst.
        if frozen {
            let a = (1.0 - bonk_t / BONK_DUR).max(0.0);
            self.fill_circle(
                f64::from(bx + BLOCK / 2),
                f64::from(by + BLOCK + 4),
                34.0 + 64.0 * (1.0 - a),
                [255, 248, 200, 255],
                0.65 * a,
            );
            for k in 0..8 {
                let ang = f64::from(k) / 8.0 * std::f64::consts::TAU + 0.4;
                let d = 18.0 + 52.0 * (1.0 - a);
                self.fill_rect(
                    (f64::from(bx + BLOCK / 2) + ang.cos() * d) as i32,
                    (f64::from(by + BLOCK / 2) + ang.sin() * d) as i32,
                    5,
                    5,
                    hex(0xffdc64),
                    a,
                );
            }
        }
    }

    // ── The shatter (beginShatter / paintShatter) ──

    /// Snapshot the current frame and break it into kicked, spinning pieces.
    pub fn begin_shatter(&mut self) {
        self.snap = Some(self.buf.clone());
        let cx = block_world_x() - SCROLL_SPEED * RUN_DUR;
        let cy = f64::from(self.ground_y - BLOCK_CLEAR - BLOCK / 2);
        self.pieces.clear();
        let mut y = 0;
        while y < self.h {
            let mut x = 0;
            while x < BW {
                let dx = f64::from(x + CELL / 2) - cx;
                let dy = f64::from(y + CELL / 2) - cy;
                let d = (dx * dx + dy * dy).sqrt().max(24.0);
                let kick = 320.0 / (d / 24.0).sqrt();
                let (r1, r2, r3) = (self.rand(), self.rand(), self.rand());
                self.pieces.push(Piece {
                    sx: x,
                    sy: y,
                    x: f64::from(x),
                    y: f64::from(y),
                    vx: (dx / d) * kick + (r1 - 0.5) * 60.0,
                    vy: (dy / d) * kick - 140.0 - r2 * 90.0,
                    rot: 0.0,
                    vr: (r3 - 0.5) * 5.0,
                });
                x += CELL;
            }
            y += CELL;
        }
    }

    pub fn paint_shatter(&mut self, dt: f64, t: f64) {
        self.clear();
        let Some(snap) = self.snap.take() else { return };
        let alpha = (1.0 - t / SHATTER_DUR).max(0.0);
        let half = f64::from(CELL) / 2.0;
        let reach = (half * std::f64::consts::SQRT_2).ceil() as i32;
        for p in &mut self.pieces {
            p.vy += 1500.0 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
        }
        let h = self.h;
        for p in self.pieces.clone() {
            // Dest-driven rotated blit of the snapshot cell about its centre.
            let (cx, cy) = (p.x + half, p.y + half);
            let (s, c) = p.rot.sin_cos();
            let (x0, x1) = ((cx as i32) - reach, (cx as i32) + reach);
            let (y0, y1) = ((cy as i32) - reach, (cy as i32) + reach);
            for yy in y0.max(0)..y1.min(h) {
                for xx in x0.max(0)..x1.min(BW) {
                    let dx = f64::from(xx) + 0.5 - cx;
                    let dy = f64::from(yy) + 0.5 - cy;
                    // Inverse-rotate into cell space.
                    let u = dx * c + dy * s;
                    let v = -dx * s + dy * c;
                    if u.abs() >= half || v.abs() >= half {
                        continue;
                    }
                    let px = p.sx + (u + half) as i32;
                    let py = p.sy + (v + half) as i32;
                    if px < 0 || py < 0 || px >= BW || py >= h {
                        continue;
                    }
                    let si = ((py * BW + px) * 4) as usize;
                    let col = [snap[si], snap[si + 1], snap[si + 2], snap[si + 3]];
                    if col[3] > 0 {
                        self.plot(xx, yy, col, alpha);
                    }
                }
            }
        }
        self.snap = Some(snap);
    }

    /// SweepStart: the 2D layer goes fully transparent — the dungeon shows.
    pub fn clear_for_sweep(&mut self) {
        self.clear();
        self.pieces.clear();
        self.snap = None;
    }
}
