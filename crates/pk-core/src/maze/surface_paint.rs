//! Surface painter — stamps contiguous terrain material patches onto floors.
//!
//! PORTS: `maze/surface-paint.ts`

use crate::grid::{at, set_surface, Grid, T_FLOOR};
use crate::rng::Mulberry32;
use crate::surfaces::{
    FLOOR_GRIP, FLOOR_ICE, FLOOR_SAND, FLOOR_STEEL, FLOOR_STONE,
};

pub const PATCH_MIN_R: f64 = 2.5;
pub const PATCH_MAX_R: f64 = 6.0;
pub const SAFE_R: i32 = 4;

#[derive(Debug, Clone, PartialEq)]
pub struct SurfaceMix {
    pub stone: f64,
    pub ice: f64,
    pub sand: f64,
    pub steel: f64,
    pub grip: f64,
}

impl Default for SurfaceMix {
    fn default() -> Self {
        Self {
            stone: 1.0,
            ice: 0.0,
            sand: 0.0,
            steel: 0.0,
            grip: 0.0,
        }
    }
}

impl SurfaceMix {
    pub fn pick_material(&self, rng: &mut Mulberry32) -> u8 {
        let total = self.stone + self.ice + self.sand + self.steel + self.grip;
        if total <= 0.0 {
            return FLOOR_STONE;
        }
        let roll = rng.next_f64() * total;
        let mut accum = 0.0;

        accum += self.stone;
        if roll < accum {
            return FLOOR_STONE;
        }
        accum += self.ice;
        if roll < accum {
            return FLOOR_ICE;
        }
        accum += self.sand;
        if roll < accum {
            return FLOOR_SAND;
        }
        accum += self.steel;
        if roll < accum {
            return FLOOR_STEEL;
        }
        FLOOR_GRIP
    }
}

#[derive(Debug, Clone, Default)]
pub struct PaintOpts {
    pub mix: SurfaceMix,
    pub coverage: f64,
    pub safe_spots: Vec<(i32, i32)>,
}

/// Paints `Grid.surfaces` from a material mix. Returns the number of tiles written.
pub fn paint_surfaces(g: &mut Grid, seed: u32, opts: PaintOpts) -> usize {
    if opts.coverage <= 0.0 {
        return 0;
    }

    // Isolated RNG stream derived from floor seed so layout remains bit-exact
    let mut rng = Mulberry32::new(seed ^ 0x5F37_59DF);

    // Collect all reachable floor tiles
    let mut floor_tiles = Vec::new();
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if at(g, i, j) == T_FLOOR {
                floor_tiles.push((i, j));
            }
        }
    }

    if floor_tiles.is_empty() {
        return 0;
    }

    let target_patches = ((floor_tiles.len() as f64 * opts.coverage.clamp(0.0, 1.0)) / 18.0)
        .ceil() as usize;

    let is_safe = |i: i32, j: i32| -> bool {
        opts.safe_spots.iter().any(|&(sx, sz)| {
            let dx = i - sx;
            let dz = j - sz;
            dx.abs() <= SAFE_R && dz.abs() <= SAFE_R
        })
    };

    let mut written = 0;

    for _ in 0..target_patches {
        let center = floor_tiles[(rng.next_f64() * floor_tiles.len() as f64) as usize % floor_tiles.len()];
        if is_safe(center.0, center.1) {
            continue;
        }

        let mat = opts.mix.pick_material(&mut rng);
        if mat == FLOOR_STONE {
            continue;
        }

        let radius = PATCH_MIN_R + rng.next_f64() * (PATCH_MAX_R - PATCH_MIN_R);
        let r_sq = radius * radius;
        let r_int = radius.ceil() as i32;

        let min_i = (center.0 - r_int).max(1);
        let max_i = (center.0 + r_int).min(g.w - 2);
        let min_j = (center.1 - r_int).max(1);
        let max_j = (center.1 + r_int).min(g.h - 2);

        for y in min_j..=max_j {
            for x in min_i..=max_i {
                if at(g, x, y) != T_FLOOR || is_safe(x, y) {
                    continue;
                }
                let dx = (x as f64) - (center.0 as f64);
                let dy = (y as f64) - (center.1 as f64);
                if dx * dx + dy * dy <= r_sq {
                    set_surface(g, x, y, mat);
                    written += 1;
                }
            }
        }
    }

    written
}
