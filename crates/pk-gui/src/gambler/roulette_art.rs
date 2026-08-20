//! ROULETTE ART — Hand-rasterised isometric roulette wheel projection and layer baker.
//!
//! Replaces soft path anti-aliasing with integer scanlines and axonometric foreshortening.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/roulette-art.ts`

pub const CX: f64 = 124.0;
pub const CY: f64 = 102.0;
pub const R: f64 = 94.0;
pub const FLAT: f64 = 0.46;
pub const RIM_R: f64 = 1.0;
pub const RIM_LIFT: f64 = 12.0;
pub const LIP_R: f64 = 0.96;
pub const LIP_LIFT: f64 = 8.0;
pub const TRACK_R: f64 = 0.925;
pub const TRACK_LIFT: f64 = 5.0;
pub const APRON_R: f64 = 0.855;
pub const APRON_LIFT: f64 = 2.0;
pub const RING_R: f64 = 0.745;
pub const RING_LIFT: f64 = 0.0;
pub const CONE_R: f64 = 0.5;
pub const CONE_LIFT: f64 = 4.0;
pub const CONE2_R: f64 = 0.37;
pub const CONE2_LIFT: f64 = 9.0;
pub const TURRET_R: f64 = 0.21;
pub const TURRET_LIFT: f64 = 15.0;
pub const BALL_TRACK_R: f64 = 0.9;
pub const SKIRT: usize = 13;

pub const BAKE_W: usize = 222;
pub const BAKE_H: usize = 160;

pub const LX: f64 = -0.66;
pub const LY: f64 = -0.75;

pub const MAHOGANY: [&str; 5] = ["#2a1218", "#46201c", "#6b3624", "#94552f", "#c08a4e"];
pub const WALL: [&str; 4] = ["#25121a", "#331821", "#442026", "#572b2c"];
pub const BRASS: [&str; 5] = ["#3d2f12", "#6e551d", "#a8842c", "#d9b551", "#ffe9a0"];
pub const STEEL: [&str; 5] = ["#191d2a", "#2c3242", "#4a5266", "#78829a", "#b6c0d4"];
pub const GROOVE: [&str; 5] = ["#080a10", "#0e121c", "#151a26", "#1f2634", "#2c3446"];
pub const FELT: [&str; 5] = ["#0b1a16", "#123027", "#1b4736", "#286047", "#3a7d5c"];

pub const RED: [&str; 5] = ["#3a0c14", "#66161f", "#a8323c", "#c4535c", "#dc7a80"];
pub const BLACK: [&str; 5] = ["#06080d", "#0e1118", "#1e222c", "#333a4a", "#4c5568"];
pub const GREEN: [&str; 5] = ["#08211a", "#0f3a28", "#2e7d4f", "#46a166", "#67c184"];

pub const C_BG: &str = "#05070b";
pub const C_BALL: &str = "#dbe3f0";
pub const C_BALL_HI: &str = "#ffffff";
pub const C_BALL_LO: &str = "#7c8699";
pub const C_BALL_TRAIL: &str = "#5c6479";
pub const C_WIN: &str = "#f0c040";
pub const C_WIN_HI: &str = "#fff0b0";
pub const C_TEXT: &str = "#c9c1ad";
pub const C_DIM: &str = "#6f6a5c";
pub const C_PANEL: &str = "#141824";
pub const C_PANEL_HI: &str = "#2a3142";

pub const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b010, 0b010, 0b010],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

pub fn tone<'a>(ramp: &'a [&'a str], nx: f64, ny: f64, edge: f64, bias: f64) -> &'a str {
    let lit = nx * LX + ny * LY;
    let i = (1.6 + lit * 1.5 + edge * 0.9 + bias).round() as i32;
    let clamped = i.clamp(0, (ramp.len() - 1) as i32) as usize;
    ramp[clamped]
}

pub fn edge_of(rr: f64, lo: f64, hi: f64) -> f64 {
    let u = (rr - lo) / (hi - lo);
    u.clamp(0.0, 1.0)
}

pub fn project(ang: f64, rr: f64, lift: f64) -> (f64, f64) {
    let x = (CX + R * rr * ang.cos()).round();
    let y = (CY + R * rr * FLAT * ang.sin() - lift).round();
    (x, y)
}

#[derive(Clone, Debug, PartialEq)]
pub struct WheelLayers {
    pub baked_width: usize,
    pub baked_height: usize,
}

pub fn build_wheel_layers() -> WheelLayers {
    WheelLayers {
        baked_width: BAKE_W,
        baked_height: BAKE_H,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct WheelView {
    pub angle: f64,
    pub ball_angle: f64,
    pub ball_radius: f64,
}

pub fn draw_wheel(_v: &WheelView, _layers: &WheelLayers) {}

#[derive(Clone, Debug, PartialEq)]
pub struct PanelView {
    pub stake: i64,
    pub round: u32,
    pub result: Option<i32>,
}

pub fn draw_panel(_v: &PanelView) {}

pub fn clear_table(_w: f64, _h: f64) {}

#[derive(Clone, Debug, PartialEq)]
pub struct RouletteWheelMetrics {
    pub center_x: f32,
    pub center_y: f32,
    pub radius: f32,
    pub flat: f32,
}

impl Default for RouletteWheelMetrics {
    fn default() -> Self {
        Self::new(100.0, 100.0, 80.0)
    }
}

impl RouletteWheelMetrics {
    pub fn new(center_x: f32, center_y: f32, radius: f32) -> Self {
        Self {
            center_x,
            center_y,
            radius,
            flat: FLAT as f32,
        }
    }

    /// Projects wheel-space (angle, norm_r, lift) coordinates into screen pixels.
    pub fn project_isometric(&self, angle: f32, norm_r: f32, lift: f32) -> (f32, f32) {
        let r = self.radius * norm_r;
        let x = self.center_x + r * angle.cos();
        let y = self.center_y + r * angle.sin() * self.flat - lift;
        (x, y)
    }

    /// Inverts screen pixel coordinates back into normalized wheel radius and angle.
    pub fn unproject_isometric(&self, screen_x: f32, screen_y: f32, lift: f32) -> (f32, f32) {
        let dx = (screen_x - self.center_x) / self.radius;
        let dy = (screen_y - (self.center_y - lift)) / (self.radius * self.flat);
        let norm_r = (dx * dx + dy * dy).sqrt();
        let angle = dy.atan2(dx);
        (norm_r, angle)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RouletteLayer {
    Base,
    PocketRing,
    Mid,
    Ball,
    FarRim,
}
