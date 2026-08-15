//! TAVERN SCENE BOOTSTRAP & LIFECYCLE ORCHESTRATOR — Walkable hub loop, camera tracking, and station triggers.
//!
//! PORTS: `legacy/src/scenes/tavern/core.ts`

use super::layout::{station_at, Station, ROOM_MAX_X, ROOM_MAX_Z, ROOM_MIN_X, ROOM_MIN_Z};

#[derive(Clone, Debug, PartialEq)]
pub struct TavernSession {
    pub player_pos: (f64, f64),
    pub camera_pos: (f64, f64),
    pub active_station_id: Option<&'static str>,
}

impl Default for TavernSession {
    fn default() -> Self {
        Self::new()
    }
}

impl TavernSession {
    pub fn new() -> Self {
        Self {
            player_pos: (0.0, 0.0),
            camera_pos: (0.0, 0.0),
            active_station_id: None,
        }
    }

    /// Advances tavern locomotion and checks for station focus.
    pub fn step(&mut self, input: (f64, f64), dt: f64) {
        let speed = 4.0;
        self.player_pos.0 = (self.player_pos.0 + input.0 * speed * dt)
            .clamp(ROOM_MIN_X + 0.5, ROOM_MAX_X - 0.5);
        self.player_pos.1 = (self.player_pos.1 + input.1 * speed * dt)
            .clamp(ROOM_MIN_Z + 0.5, ROOM_MAX_Z - 0.5);

        // Lerp camera towards player
        let lerp = (dt * 5.0).min(1.0);
        self.camera_pos.0 += (self.player_pos.0 - self.camera_pos.0) * lerp;
        self.camera_pos.1 += (self.player_pos.1 - self.camera_pos.1) * lerp;

        self.active_station_id = station_at(self.player_pos.0, self.player_pos.1).map(|s| s.id);
    }

    /// Triggers interaction on the currently focused station, if any.
    pub fn interact_station(&self) -> Option<&'static Station> {
        station_at(self.player_pos.0, self.player_pos.1)
    }
}
