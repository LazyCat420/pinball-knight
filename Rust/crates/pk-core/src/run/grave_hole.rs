//! Grave Hole Detonation & Pit Scar — Departing co-op knight death explosion and hazard creation.
//!
//! PORTS: `run/grave-hole.ts`

pub const GRAVEPIT_BLAST_RADIUS: f32 = 3.5;
pub const GRAVEPIT_BLAST_LIFE: f32 = 0.45;
pub const GRAVEPIT_BLAST_DAMAGE: f32 = 150.0;

#[derive(Clone, Debug, PartialEq)]
pub struct GraveBlastEnemy {
    pub id: u32,
    pub x: f32,
    pub z: f32,
    pub is_dead: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GraveBlastHit {
    pub enemy_id: u32,
    pub damage: f32,
    pub dir_x: f32,
    pub dir_z: f32,
}

/// Evaluates enemy detonation casualties around a departing knight's snapped grave position.
pub fn plan_grave_blast(center: (f32, f32), enemies: &[GraveBlastEnemy]) -> Vec<GraveBlastHit> {
    let mut hits = Vec::new();
    for enemy in enemies {
        if enemy.is_dead {
            continue;
        }
        let dx = enemy.x - center.0;
        let dz = enemy.z - center.1;
        let d = (dx * dx + dz * dz).sqrt();
        if d > GRAVEPIT_BLAST_RADIUS {
            continue;
        }

        let inv = if d > 1e-3 { 1.0 / d } else { 0.0 };
        hits.push(GraveBlastHit {
            enemy_id: enemy.id,
            damage: GRAVEPIT_BLAST_DAMAGE,
            dir_x: dx * inv,
            dir_z: dz * inv,
        });
    }
    hits
}
