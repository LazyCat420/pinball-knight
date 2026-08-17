//! Tavern scene bootstrap + loop.
//!
//! Port of `legacy/src/scenes/tavern/core.ts` (906 lines).
//!
//! Owns its own renderer/scene/camera rather than borrowing the dungeon's — the
//! dungeon's are torn down between floors. Everything else (pixel post-pass,
//! iso camera math, sprite pipeline, palette) is shared.
//!
//! PORTS: `legacy/src/scenes/tavern/core.ts`

pub use super::camera::{CAM_LEAN, CAM_LERP};
use super::layout::{
    station_at, Station, ROOM_CENTER_X, ROOM_CENTER_Z, ROOM_MAX_X, ROOM_MAX_Z, ROOM_MIN_X,
    ROOM_MIN_Z,
};
use super::state::TavernStats;

pub const CAMERA_DIST: f64 = 24.0;

pub const BG_COLOR: u32 = 0x07090d;
pub const FOG_COLOR: u32 = 0x141018;
pub const FOG_NEAR: f64 = 28.0;
pub const FOG_FAR: f64 = 64.0;
pub const PLAYER_SPEED: f64 = 4.0;
pub const DIORAMA_BALL_RX: f64 = 0.85;
pub const DIORAMA_BALL_RZ: f64 = 0.5;
pub const DIORAMA_BALL_Y: f64 = 0.13;
pub const DIORAMA_BALL_OFFSET_Z: f64 = -0.1;

#[derive(Clone, Debug, PartialEq)]
pub struct TavernFogConfig {
    pub color: u32,
    pub near: f64,
    pub far: f64,
}

impl Default for TavernFogConfig {
    fn default() -> Self {
        Self {
            color: FOG_COLOR,
            near: FOG_NEAR,
            far: FOG_FAR,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TavernOptions {
    pub stats: TavernStats,
    pub lobby: bool,
}

impl Default for TavernOptions {
    fn default() -> Self {
        Self {
            stats: TavernStats::default(),
            lobby: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TavernSession {
    pub active: bool,
    pub player_pos: (f64, f64),
    pub camera_pos: (f64, f64),
    pub active_station_id: Option<&'static str>,
    pub time: f64,
    pub ball_angle: f64,
    pub options: TavernOptions,
    pub panel_open: bool,
}

impl Default for TavernSession {
    fn default() -> Self {
        Self::new()
    }
}

impl TavernSession {
    pub fn new() -> Self {
        Self {
            active: false,
            player_pos: (0.0, 0.0),
            camera_pos: (ROOM_CENTER_X, ROOM_CENTER_Z),
            active_station_id: None,
            time: 0.0,
            ball_angle: 0.0,
            options: TavernOptions::default(),
            panel_open: false,
        }
    }

    pub fn open(&mut self, opts: TavernOptions) -> bool {
        if self.active {
            return true;
        }
        self.active = true;
        self.options = opts;
        self.time = 0.0;
        self.player_pos = (0.0, 0.0);
        self.camera_pos = (ROOM_CENTER_X, ROOM_CENTER_Z);
        self.active_station_id = None;
        self.panel_open = false;
        true
    }

    pub fn close(&mut self) {
        self.active = false;
        self.active_station_id = None;
    }

    pub fn is_open(&self) -> bool {
        self.active
    }

    /// Advances tavern locomotion, camera lerping, and checks for station focus.
    pub fn step(&mut self, input: (f64, f64), dt: f64) {
        if !self.active {
            return;
        }
        self.time += dt;

        if !self.panel_open {
            self.player_pos.0 = (self.player_pos.0 + input.0 * PLAYER_SPEED * dt)
                .clamp(ROOM_MIN_X + 0.5, ROOM_MAX_X - 0.5);
            self.player_pos.1 = (self.player_pos.1 + input.1 * PLAYER_SPEED * dt)
                .clamp(ROOM_MIN_Z + 0.5, ROOM_MAX_Z - 0.5);
        }

        // Station focus
        let st = if self.panel_open {
            None
        } else {
            station_at(self.player_pos.0, self.player_pos.1)
        };
        self.active_station_id = st.map(|s| s.id);

        // Camera target calculation with station lean
        let focus_pt = st.map(|s| (s.x, s.z));
        let (tx, tz) =
            camera_target_for_focus(self.player_pos.0, self.player_pos.1, focus_pt);

        let k = (dt * CAM_LERP * 60.0).min(1.0);
        self.camera_pos.0 += (tx - self.camera_pos.0) * k;
        self.camera_pos.1 += (tz - self.camera_pos.1) * k;
    }

    /// Triggers interaction on the currently focused station, if any.
    pub fn interact_station(&self) -> Option<&'static Station> {
        if self.panel_open {
            None
        } else {
            station_at(self.player_pos.0, self.player_pos.1)
        }
    }
}

pub fn open_tavern_scene(session: &mut TavernSession, opts: TavernOptions) -> bool {
    session.open(opts)
}

pub fn close_tavern(session: &mut TavernSession) {
    session.close();
}

pub fn is_tavern_scene_open(session: &TavernSession) -> bool {
    session.is_open()
}

/// Calculates the camera target point anchored at the center of the room with player/station lean.
pub fn camera_target_for_focus(
    px: f64,
    pz: f64,
    focus: Option<(f64, f64)>,
) -> (f64, f64) {
    let lean_x = match focus {
        Some((fx, _)) => (fx + px) * 0.5,
        None => px,
    };
    let lean_z = match focus {
        Some((_, fz)) => (fz + pz) * 0.5,
        None => pz,
    };
    let tx = ROOM_CENTER_X + (lean_x - ROOM_CENTER_X) * CAM_LEAN;
    let tz = ROOM_CENTER_Z + (lean_z - ROOM_CENTER_Z) * CAM_LEAN;
    (tx, tz)
}

/// Hearth fire light intensity flickering formula (two summed sines).
pub fn hearth_flicker_intensity(time: f64) -> f64 {
    9.0 * (1.0 + (time * 9.3).sin() * 0.09 + (time * 3.1).sin() * 0.05)
}

/// Forge coals emissive intensity breathing formula.
pub fn coals_emissive_intensity(time: f64) -> f64 {
    1.3 + (time * 5.2).sin() * 0.35
}

/// Diorama bumper cap emissive intensity based on lit status and sine breathing.
pub fn bumper_emissive_intensity(time: f64, idx: usize, lit_count: usize) -> f64 {
    if idx < lit_count {
        0.5 + 0.0_f64.max((time * 2.4 - idx as f64 * 0.9).sin()) * 0.85
    } else {
        0.04
    }
}

/// Diorama run report rolling ball coordinate offset.
pub fn diorama_ball_position(angle: f64) -> (f64, f64, f64) {
    (
        angle.cos() * DIORAMA_BALL_RX,
        DIORAMA_BALL_Y,
        angle.sin() * DIORAMA_BALL_RZ + DIORAMA_BALL_OFFSET_Z,
    )
}
