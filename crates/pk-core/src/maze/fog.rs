//! Fog of War — Flat typed array tracking dungeon floor exploration state.
//!
//! PORTS: `fog.ts`

pub const FOG_HIDDEN: u8 = 0;
pub const FOG_DIM: u8 = 1;
pub const FOG_SEEN: u8 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fog {
    pub w: usize,
    pub h: usize,
    pub v: Vec<u8>,
    pub rev: u64,
}

/// Creates a fresh, fully-hidden fog buffer sized `w * h`.
pub fn create_fog(w: usize, h: usize) -> Fog {
    Fog {
        w,
        h,
        v: vec![FOG_HIDDEN; w * h],
        rev: 0,
    }
}

impl Fog {
    /// Bounds-safe fog lookup. Out of bounds returns FOG_HIDDEN.
    pub fn fog_at(&self, i: isize, j: isize) -> u8 {
        if i < 0 || j < 0 || i >= self.w as isize || j >= self.h as isize {
            FOG_HIDDEN
        } else {
            self.v[j as usize * self.w + i as usize]
        }
    }

    /// Raises tile fog state to at least `level`. Bumps `rev` on actual change.
    pub fn raise(&mut self, i: isize, j: isize, level: u8) {
        if i < 0 || j < 0 || i >= self.w as isize || j >= self.h as isize {
            return;
        }
        let k = j as usize * self.w + i as usize;
        if self.v[k] < level {
            self.v[k] = level;
            self.rev += 1;
        }
    }

    /// Reveals a circular area around `(ci, cj)` up to `radius`.
    /// Walls within `radius + 1` are marked `FOG_DIM` so corridors have visible rims.
    pub fn reveal_around(&mut self, is_wall: impl Fn(isize, isize) -> bool, ci: isize, cj: isize, radius: isize) {
        let r2 = radius * radius;
        let rim = radius + 1;

        for dj in -rim..=rim {
            for di in -rim..=rim {
                let d2 = di * di + dj * dj;
                if d2 > rim * rim {
                    continue;
                }
                let i = ci + di;
                let j = cj + dj;
                if d2 <= r2 {
                    self.raise(i, j, FOG_SEEN);
                } else if is_wall(i, j) {
                    self.raise(i, j, FOG_DIM);
                }
            }
        }
    }

    /// Total count of tiles that have been seen at all (`FOG_DIM` or `FOG_SEEN`).
    pub fn explored_count(&self) -> usize {
        self.v.iter().filter(|&&st| st != FOG_HIDDEN).count()
    }

    /// Fraction of the floor's walkable tiles explored [0.0, 1.0].
    pub fn explored_fraction(&self, is_wall: impl Fn(isize, isize) -> bool) -> f64 {
        let mut walkable = 0usize;
        let mut seen = 0usize;

        for j in 0..self.h {
            for i in 0..self.w {
                if is_wall(i as isize, j as isize) {
                    continue;
                }
                walkable += 1;
                if self.v[j * self.w + i] != FOG_HIDDEN {
                    seen += 1;
                }
            }
        }

        if walkable == 0 {
            0.0
        } else {
            seen as f64 / walkable as f64
        }
    }
}
