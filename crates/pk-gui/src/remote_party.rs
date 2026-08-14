//! Remote Party Renderer state & interpolation for multiplayer peers.
//!
//! PORTS: `render/remote-party.ts`

use std::collections::HashMap;

pub const INTERP_RATE: f32 = 12.0;
pub const WALK_THRESHOLD: f32 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Facing {
    S,
    N,
    E,
    W,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RemotePeerView {
    pub id: String,
    pub slot: u8,
    pub name: String,
    pub target_x: f32,
    pub target_z: f32,
    pub current_x: f32,
    pub current_z: f32,
    pub facing: Facing,
    pub clip: String,
    pub dead: bool,
    pub last_seen_t: f32,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct RemotePartyManager {
    pub peers: HashMap<String, RemotePeerView>,
}

impl RemotePartyManager {
    pub fn new() -> Self {
        Self {
            peers: HashMap::new(),
        }
    }

    /// Ingests a peer presence packet and updates target position/action clip.
    pub fn update_peer(
        &mut self,
        id: &str,
        slot: u8,
        name: &str,
        x: f32,
        z: f32,
        clip: &str,
        dead: bool,
    ) {
        let peer = self.peers.entry(id.to_string()).or_insert_with(|| RemotePeerView {
            id: id.to_string(),
            slot,
            name: name.to_string(),
            target_x: x,
            target_z: z,
            current_x: x,
            current_z: z,
            facing: Facing::S,
            clip: clip.to_string(),
            dead,
            last_seen_t: 0.0,
        });

        peer.target_x = x;
        peer.target_z = z;
        peer.clip = clip.to_string();
        peer.dead = dead;
        peer.last_seen_t = 0.0;
    }

    /// Ticks interpolation towards target coordinates and updates facing direction.
    pub fn step(&mut self, dt: f32) {
        let lerp_factor = (1.0 - (-INTERP_RATE * dt).exp()).clamp(0.0, 1.0);

        for peer in self.peers.values_mut() {
            peer.last_seen_t += dt;

            let dx = peer.target_x - peer.current_x;
            let dz = peer.target_z - peer.current_z;
            let dist = (dx * dx + dz * dz).sqrt();

            if dist > WALK_THRESHOLD * dt {
                if dx.abs() > dz.abs() {
                    peer.facing = if dx > 0.0 { Facing::E } else { Facing::W };
                } else {
                    peer.facing = if dz > 0.0 { Facing::S } else { Facing::N };
                }
            }

            peer.current_x += dx * lerp_factor;
            peer.current_z += dz * lerp_factor;
        }
    }

    /// Prunes peers that have not refreshed within `max_age` seconds.
    pub fn prune_stale(&mut self, max_age: f32) {
        self.peers.retain(|_, peer| peer.last_seen_t <= max_age);
    }
}
