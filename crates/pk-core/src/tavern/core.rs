//! TAVERN SCENE BOOTSTRAP & LIFECYCLE ORCHESTRATOR — Walkable hub loop, camera tracking, and station triggers.
//!
//! Port of `legacy/src/scenes/tavern/core.ts` (906 lines).
//!
//! PORTS: `legacy/src/scenes/tavern/core.ts`

use super::layout::{station_at, StationKind, ROOM_MAX_X, ROOM_MAX_Z, ROOM_MIN_X, ROOM_MIN_Z};
use super::state::{DioramaState, TavernStats};

pub const ROOM_CENTER_X: f64 = (ROOM_MIN_X + ROOM_MAX_X) / 2.0;
pub const ROOM_CENTER_Z: f64 = (ROOM_MIN_Z + ROOM_MAX_Z) / 2.0;

pub const CAM_LEAN: f64 = 0.72;
pub const CAM_LERP: f64 = 3.4;
pub const CAM_ZOOM_WIDE: f64 = 0.78;

pub const ROOM_FOOTPRINT_TILES_W: f64 = 22.63;
pub const ROOM_FOOTPRINT_TILES_H: f64 = 16.45;
pub const DEFAULT_PPU: f64 = 56.0;

#[derive(Default)]
pub struct TavernOptions {
    pub stats: Option<TavernStats>,
    pub on_descend: Option<Box<dyn FnMut(Option<u32>) + Send + Sync>>,
    pub on_abandon: Option<Box<dyn FnMut() + Send + Sync>>,
    pub is_lobby: bool,
}

pub fn open_tavern_scene(_opts: TavernOptions) -> TavernSession {
    let mut session = TavernSession::new();
    session.is_lobby = _opts.is_lobby;
    if let Some(st) = _opts.stats {
        session.stats = st;
    }
    session
}

pub fn close_tavern() {}

pub fn is_tavern_scene_open() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq)]
pub enum TavernInteractionEvent {
    Descend { floor: Option<u32> },
    Summary,
    Gambler,
    Vendor { vendor_id: String },
    Menu,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TavernSession {
    pub player_pos: (f64, f64),
    pub player_vel: (f64, f64),
    pub player_facing: String,
    pub camera_pos: (f64, f64),
    pub cam_zoom: f64,
    pub time: f64,
    pub active: bool,
    pub frozen: bool,
    pub active_station_id: Option<String>,
    pub open_station: Option<String>,
    pub diorama: DioramaState,
    pub ball_angle: f64,
    pub mote_t: f64,
    pub first_presented: bool,
    pub stats: TavernStats,
    pub lobby_count: usize,
    pub is_lobby: bool,
    pub one_shot_action: Option<String>,
}

impl Default for TavernSession {
    fn default() -> Self {
        Self::new()
    }
}

pub fn fit_zoom(window_w: f64, window_h: f64, ppu: f64) -> f64 {
    let fits = (window_w / ppu) >= ROOM_FOOTPRINT_TILES_W && (window_h / ppu) >= ROOM_FOOTPRINT_TILES_H;
    if fits { 1.0 } else { CAM_ZOOM_WIDE }
}

impl TavernSession {
    pub fn new() -> Self {
        Self {
            player_pos: (ROOM_CENTER_X, ROOM_CENTER_Z),
            player_vel: (0.0, 0.0),
            player_facing: "S".to_string(),
            camera_pos: (ROOM_CENTER_X, ROOM_CENTER_Z),
            cam_zoom: CAM_ZOOM_WIDE,
            time: 0.0,
            active: true,
            frozen: false,
            active_station_id: None,
            open_station: None,
            diorama: DioramaState { lit: 0, ball_speed: 0.0 },
            ball_angle: 0.0,
            mote_t: 0.0,
            first_presented: false,
            stats: TavernStats::default(),
            lobby_count: 1,
            is_lobby: false,
            one_shot_action: None,
        }
    }

    pub fn apply_zoom(&mut self, window_w: f64, window_h: f64, ppu: f64) {
        self.cam_zoom = fit_zoom(window_w, window_h, ppu);
    }

    pub fn panel_open(&self) -> bool {
        self.frozen || self.open_station.is_some()
    }

    /// Advances tavern locomotion, camera lean, and checks for station focus.
    pub fn step(&mut self, input: (f64, f64), dt: f64) {
        if !self.active {
            return;
        }
        self.time += dt;

        let frozen = self.panel_open();

        if !frozen {
            let speed = 4.8;
            self.player_vel = (input.0 * speed, input.1 * speed);

            self.player_pos.0 = (self.player_pos.0 + self.player_vel.0 * dt)
                .clamp(ROOM_MIN_X + 0.5, ROOM_MAX_X - 0.5);
            self.player_pos.1 = (self.player_pos.1 + self.player_vel.1 * dt)
                .clamp(ROOM_MIN_Z + 0.5, ROOM_MAX_Z - 0.5);

            if input.0.abs() > 0.1 || input.1.abs() > 0.1 {
                if input.0.abs() > input.1.abs() {
                    self.player_facing = if input.0 > 0.0 { "E".to_string() } else { "W".to_string() };
                } else {
                    self.player_facing = if input.1 > 0.0 { "S".to_string() } else { "N".to_string() };
                }
            }
        } else {
            self.player_vel = (0.0, 0.0);
        }

        // Station focus detection
        let next_station = if frozen { None } else { station_at(self.player_pos.0, self.player_pos.1) };
        self.active_station_id = next_station.map(|s| s.id.to_string());

        // Camera lean & lerp
        let (target_x, target_z) = if let Some(st) = next_station {
            let lean_x = (st.x + self.player_pos.0) / 2.0;
            let lean_z = (st.z + self.player_pos.1) / 2.0;
            (
                ROOM_CENTER_X + (lean_x - ROOM_CENTER_X) * CAM_LEAN,
                ROOM_CENTER_Z + (lean_z - ROOM_CENTER_Z) * CAM_LEAN,
            )
        } else {
            (
                ROOM_CENTER_X + (self.player_pos.0 - ROOM_CENTER_X) * CAM_LEAN,
                ROOM_CENTER_Z + (self.player_pos.1 - ROOM_CENTER_Z) * CAM_LEAN,
            )
        };

        let k = (dt * CAM_LERP).min(1.0);
        self.camera_pos.0 += (target_x - self.camera_pos.0) * k;
        self.camera_pos.1 += (target_z - self.camera_pos.1) * k;

        // Diorama update
        if self.diorama.ball_speed > 0.0 {
            self.ball_angle += dt * self.diorama.ball_speed;
        }

        // Ambient motes cadence
        self.mote_t -= dt;
        if self.mote_t <= 0.0 {
            self.mote_t = 0.14;
        }

        if !self.first_presented {
            self.first_presented = true;
        }
    }

    /// Triggers interaction on the currently focused station, if any.
    pub fn interact(&mut self) -> Option<TavernInteractionEvent> {
        if self.panel_open() {
            return None;
        }
        let st = station_at(self.player_pos.0, self.player_pos.1)?;
        self.open_station = Some(st.id.to_string());

        match st.action {
            StationKind::Descend => Some(TavernInteractionEvent::Descend { floor: None }),
            StationKind::Summary => Some(TavernInteractionEvent::Summary),
            StationKind::Gambler => Some(TavernInteractionEvent::Gambler),
            StationKind::Vendor(vendor) => Some(TavernInteractionEvent::Vendor { vendor_id: format!("{:?}", vendor) }),
        }
    }

    pub fn close_station(&mut self) {
        self.open_station = None;
    }

    pub fn open_menu(&mut self) -> Option<TavernInteractionEvent> {
        if self.panel_open() {
            return None;
        }
        self.frozen = true;
        Some(TavernInteractionEvent::Menu)
    }

    pub fn close_menu(&mut self) {
        self.frozen = false;
    }

    pub fn apply_counter_fx(&mut self, fx_tags: &[&str]) {
        if fx_tags.contains(&"gear") {
            self.one_shot_action = Some("equip".to_string());
        } else if !fx_tags.is_empty() {
            self.one_shot_action = Some("forge".to_string());
        }
    }

    pub fn trigger_plunger_descend(&mut self) -> Option<u32> {
        self.active = false;
        None
    }
}
