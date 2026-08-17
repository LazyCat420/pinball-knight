//! CO-OP DUNGEON LAYER — Multi-peer floor authority election, entity replication, and marble interaction.
//!
//! PORTS-PARTIAL: `coop.ts` - NOT a finished port - 85 rust code lines against 336 legacy (25%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub const SNAP_INTERVAL: f64 = 0.1; // 10Hz snapshot broadcast
pub const GHOST_LERP: f64 = 10.0;
pub const CONTACT_RANGE: f64 = 0.62;
pub const PLAYER_BOUNCE_R: f64 = 0.5;

#[derive(Clone, Debug, PartialEq)]
pub struct SnapZombie {
    pub nid: String,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub hp: i32,
    pub max_hp: Option<i32>,
    pub mode: String,
    pub is_boss: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapItem {
    pub nid: String,
    pub kind: String,
    pub x: f64,
    pub z: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct WorldSnapshot {
    pub floor: u32,
    pub zombies: Vec<SnapZombie>,
    pub items: Vec<SnapItem>,
    pub exit_unlocked: bool,
}

pub struct CoopAuthority;

impl CoopAuthority {
    /// Elects the floor authority as the lexicographically smallest peer ID among participants.
    pub fn elect_authority(peer_ids: &[&str]) -> Option<String> {
        peer_ids.iter().min().map(|s| s.to_string())
    }
}

pub struct MarbleCollision;

impl MarbleCollision {
    /// Resolves elastic collision impulse between two rolling marble knights.
    pub fn bounce_marbles(
        pos_a: (f64, f64),
        vel_a: &mut (f64, f64),
        pos_b: (f64, f64),
        vel_b: &mut (f64, f64),
        radius: f64,
    ) -> bool {
        let dx = pos_b.0 - pos_a.0;
        let dz = pos_b.1 - pos_a.1;
        let dist_sq = dx * dx + dz * dz;
        let min_dist = radius * 2.0;

        if dist_sq >= min_dist * min_dist || dist_sq <= 0.0001 {
            return false;
        }

        let dist = dist_sq.sqrt();
        let nx = dx / dist;
        let nz = dz / dist;

        // Relative velocity along normal
        let kx = vel_a.0 - vel_b.0;
        let kz = vel_a.1 - vel_b.1;
        let p = 2.0 * (nx * kx + nz * kz) / 2.0;

        if p > 0.0 {
            vel_a.0 -= p * nx;
            vel_a.1 -= p * nz;
            vel_b.0 += p * nx;
            vel_b.1 += p * nz;
            true
        } else {
            false
        }
    }
}
