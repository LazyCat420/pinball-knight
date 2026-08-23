//! Maze Generation Tuning Constants — Room sizes, progression curves, secret walls, and momentum break speeds.
//!
//! PORTS: `constants/maze.ts`

pub const TRACK_FIRST: bool = true;
pub const SURFACE_BANDS: bool = true;

// Rooms (open playfield areas)
pub const ROOM_MIN_CELLS: u32 = 3;
pub const ROOM_MAX_CELLS: u32 = 6;
pub const ROOMS_BASE: f32 = 5.0;
pub const ROOMS_PER_LEVEL: f32 = 1.2;
pub const ROOMS_MAX: u32 = 14;

// Secret & Breakable Walls
pub const SECRET_BREAK_SPEED: f32 = 7.0; // Momentum needed to shatter gold-glint cracked walls
pub const WALL_BREAK_SPEED: f32 = 15.0; // Terminal momentum to kool-aid smash standard walls
pub const WALL_BREAK_DEPTH: u32 = 2; // Punch through 2-thick wall bands
pub const WALL_BREAK_SPEED_COST: f32 = 0.7; // Speed multiplier kept after punching masonry
pub const SECRETS_BASE: f32 = 4.0;
pub const SECRETS_PER_LEVEL: f32 = 1.0;
pub const SECRETS_MAX: u32 = 10;

/// Derives the target room count for a given dungeon level depth.
pub fn compute_room_count(level: u32) -> u32 {
    let lvl = level.max(1);
    let target = ROOMS_BASE + (lvl - 1) as f32 * ROOMS_PER_LEVEL;
    (target.floor() as u32).min(ROOMS_MAX)
}

/// Derives the cracked secret wall count for a given dungeon level depth.
pub fn compute_secrets_count(level: u32) -> u32 {
    let lvl = level.max(1);
    let target = SECRETS_BASE + (lvl - 1) as f32 * SECRETS_PER_LEVEL;
    (target.floor() as u32).min(SECRETS_MAX)
}
