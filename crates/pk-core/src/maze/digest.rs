//! FNV-1a 32 over the generator's state — the Rust half of the maze parity
//! tripwire.
//!
//! Transcribed from `legacy/src/game/pinball-knight/port-maze-fixtures.test.ts`,
//! which is transcribed in turn from the idiom `dev/floor-census.ts` already
//! uses for the same job. `Math.imul` on a `>>> 0` accumulator IS
//! `u32::wrapping_mul`, so the two implementations are the same arithmetic
//! written twice rather than two hashes that happen to agree.
//!
//! ## Why 32 bits is enough here
//!
//! It is not the only thing being compared. Every pass boundary pins seven
//! independent digests, six exact counts and an exact rng draw count, so a
//! divergence has to collide in all of them at once to slip through — and
//! counts do not collide at all. Widening to 64 would cost a hand-rolled
//! 64×64 multiply on the JS side (no native u64) to buy nothing this harness
//! needs.
//!
//! ## The length fold
//!
//! Every digest ends by folding the element COUNT in, little-endian. Without it
//! a truncated array digests identically to a shorter one that ends the same
//! way, and "the port allocated the wrong grid size" is the single most likely
//! early mistake — exactly the one a digest must never miss.
//!
//! ⚠️ Certified, not assumed: `tests/maze_pass_digests.rs` replays the pinned
//! vectors in `assets/fixtures/maze-digest-selftest.json` before it looks at a
//! single floor. A digest that is subtly wrong (a missed length fold, a
//! big-endian f64) fails against every pass of every floor and reads exactly
//! like a broken generator, so the instrument is checked first and separately.
//!
//! PORTS: `dev/floor-census.ts`

use crate::tile_shape::ArcFeature;

pub const FNV_OFFSET: u32 = 0x811c_9dc5;
pub const FNV_PRIME: u32 = 0x0100_0193;

// ── THE WIRE ENCODING, ON ITS OWN ────────────────────────────────────────────
//
// Three one-line functions rather than `to_le_bytes()` at the call site, and
// the reason is the self-test. A big-endian port hashes to something perfectly
// self-consistent; only a comparison against THE ORACLE'S BYTES can name
// endianness as the cause instead of reporting "digest differs". For that
// comparison to bite, the test has to obtain its bytes from the same seam the
// digest uses — inlined, the test would encode with its own `to_le_bytes` and
// certify an encoder it never called.

pub fn le_f64(v: f64) -> [u8; 8] {
    v.to_le_bytes()
}

pub fn le_f32(v: f32) -> [u8; 4] {
    v.to_le_bytes()
}

pub fn le_i16(v: i16) -> [u8; 2] {
    v.to_le_bytes()
}

/// A signed 32-bit field, little-endian — the same four bytes [`Fnv1a::count`]
/// folds a length as.
///
/// Separate because the values it carries can be NEGATIVE: a doorway site's axis
/// components are `-1`, `0` or `1`. The oracle's `foldLen` shifts with `>>>`, so
/// it folds exactly the two's-complement bytes `i32` already has, and `as u32`
/// is that reinterpretation rather than a conversion.
pub fn le_i32(v: i32) -> [u8; 4] {
    (v as u32).to_le_bytes()
}

/// Streaming FNV-1a 32. Cheap to copy; the state is one `u32`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fnv1a(u32);

impl Default for Fnv1a {
    fn default() -> Self {
        Self::new()
    }
}

impl Fnv1a {
    pub fn new() -> Self {
        Self(FNV_OFFSET)
    }

    pub fn byte(&mut self, b: u8) -> &mut Self {
        self.0 = (self.0 ^ u32::from(b)).wrapping_mul(FNV_PRIME);
        self
    }

    pub fn bytes(&mut self, bs: &[u8]) -> &mut Self {
        for &b in bs {
            self.byte(b);
        }
        self
    }

    /// The element-count fold every digest ends with — see the module header.
    pub fn count(&mut self, n: usize) -> &mut Self {
        self.bytes(&(n as u32).to_le_bytes())
    }

    pub fn f64(&mut self, v: f64) -> &mut Self {
        self.bytes(&le_f64(v))
    }

    pub fn f32(&mut self, v: f32) -> &mut Self {
        self.bytes(&le_f32(v))
    }

    pub fn i16(&mut self, v: i16) -> &mut Self {
        self.bytes(&le_i16(v))
    }

    pub fn i32(&mut self, v: i32) -> &mut Self {
        self.bytes(&le_i32(v))
    }

    pub fn finish(&self) -> u32 {
        self.0
    }
}

pub fn digest_bytes(a: &[u8]) -> u32 {
    let mut h = Fnv1a::new();
    h.bytes(a).count(a.len()).finish()
}

/// A run of f64s — the encoding the arc fields use, exposed on its own so the
/// self-test can certify it directly rather than only through a whole feature.
pub fn digest_f64(a: &[f64]) -> u32 {
    let mut h = Fnv1a::new();
    for &v in a {
        h.f64(v);
    }
    h.count(a.len()).finish()
}

/// `mask.dist` — carries `f32::INFINITY` off-track, whose bit pattern is
/// identical to the JS `Float32Array`'s.
pub fn digest_f32(a: &[f32]) -> u32 {
    let mut h = Fnv1a::new();
    for &v in a {
        h.f32(v);
    }
    h.count(a.len()).finish()
}

/// `grid.arc_idx` — `-1` where no feature owns the tile.
pub fn digest_i16(a: &[i16]) -> u32 {
    let mut h = Fnv1a::new();
    for &v in a {
        h.i16(v);
    }
    h.count(a.len()).finish()
}

/// `owner` as one byte. Absent reads as "sweep" — the feature that yields.
fn owner_code(owner: Option<&str>) -> u8 {
    match owner.unwrap_or("sweep") {
        "track" => 1,
        "island" => 2,
        "funnel" => 3,
        _ => 0,
    }
}

/// Digest the arc features IN AUTHORING ORDER.
///
/// The order is itself the signal, exactly as it is in `floor-census`'s fold:
/// it is the order the passes published them in, and two passes swapping would
/// leave every count identical. `compact_arcs` remaps `arc_idx` against this
/// order, so a port that authors the same features in a different order has a
/// different floor even though the walls stand in the same places.
pub fn digest_arcs(arcs: &[ArcFeature]) -> u32 {
    let mut h = Fnv1a::new();
    for f in arcs {
        for v in [f.cx, f.cz, f.r, f.a0, f.span] {
            h.f64(v);
        }
        h.byte(u8::from(f.solid_out));
        h.byte(owner_code(f.owner));
        h.count(f.kicks.len());
        for k in &f.kicks {
            for v in [k.a0, k.span, k.cooldown_t, k.hit_t] {
                h.f64(v);
            }
        }
        h.count(f.lanes.len());
        for l in &f.lanes {
            for v in [l.a0, l.span] {
                h.f64(v);
            }
            h.byte(u8::from(l.cw));
            for v in [l.cooldown_t, l.hit_t] {
                h.f64(v);
            }
        }
    }
    h.count(arcs.len()).finish()
}

/// Digest the PLANNED DOORWAYS in plan order — position, axis and wanted width.
///
/// ⚠️ ADDED WHEN PASS 9 WAS PORTED, for the same reason [`digest_arcs`]'s TS
/// sibling `digestLegs` was added at pass 2, and the case here is worse.
/// `plan-doorways` MUTATES NOTHING: it labels sections, partitions territory and
/// picks one opening per boundary component, all read-only. Measured on all ten
/// corpus floors, every one of the seven digests, all six counts AND the draw
/// count at `plan-doorways` are byte-identical to `repair-1`'s — so before this
/// fold the entire boundary was `{ sites: N, guard: M }`: two integers standing
/// in for nine to twenty-six structured records. A port that got the per-site
/// axis wrong, or emitted the sites in a different order, matched the fixture
/// exactly, and would first diverge at pass 11 where `on_doorway` steers a pass
/// that draws rng — two passes late, with the localiser pointing at the wrong
/// one.
///
/// Order is part of the signal: pass 18 walks this list in order and slides each
/// centre against a grid four curve passes have changed, so two sites swapped is
/// a different floor even when every number in the list is right.
pub fn digest_sites(sites: &[crate::maze::doorways::DoorwaySite]) -> u32 {
    let mut h = Fnv1a::new();
    for s in sites {
        for v in [s.i, s.j, s.ai, s.aj, s.wi, s.wj, s.want, s.a, s.b] {
            h.i32(v);
        }
    }
    h.count(sites.len()).finish()
}

// ── THE WHOLE GRID, FOR THE RUNTIME RATHER THAN FOR THE ORACLE ───────────────

/// Every field of a [`Grid`](crate::grid::Grid), digested.
///
/// The pass digests above answer "did the generator diverge from the oracle".
/// This one answers a different question the shell needs: "is the grid the sim
/// is stepping still the grid the floor authored". A generated floor is
/// installed by CLONING it into `SimState`, and from that moment there are two
/// arrays that are supposed to stay equal forever — the sim only ever reads
/// terrain, it never writes it. "Supposed to" is not a guarantee, and a single
/// `set_tile` added to a future pinball part would desynchronise the collider
/// from the renderer with no symptom until a wall stopped being where it looks.
///
/// ## Why all SEVEN fields and not the three that matter
///
/// `w`, `h`, `t`, `shapes`, `surfaces`, `arcs`, `arc_idx` is the complete field
/// list of `Grid` — checked against the struct by
/// `grid_state_digest_covers_every_field_of_grid`. A digest over "the fields
/// collision reads" would be a judgement call that goes stale the first time
/// something new is read, and this costs one pass over ~5,300 tiles at floor
/// setup.
///
/// ## Absent is not empty and not zero
///
/// `surfaces` and `arc_idx` are `Option`. An absent array digests as the EMPTY
/// one, which cannot collide with a present array on any real floor: the length
/// fold makes `digest_bytes(&[])` unequal to the digest of any `w * h > 0`
/// array, and a grid with no tiles is not a floor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GridStateDigest {
    pub w: i32,
    pub h: i32,
    pub tiles: u32,
    pub shapes: u32,
    pub arcs: u32,
    pub arc_idx: u32,
    pub surfaces: u32,
}

pub fn digest_grid_state(g: &crate::grid::Grid) -> GridStateDigest {
    GridStateDigest {
        w: g.w,
        h: g.h,
        tiles: digest_bytes(&g.t),
        shapes: digest_bytes(&g.shapes),
        arcs: digest_arcs(&g.arcs),
        arc_idx: g
            .arc_idx
            .as_deref()
            .map_or_else(|| digest_i16(&[]), digest_i16),
        surfaces: g
            .surfaces
            .as_deref()
            .map_or_else(|| digest_bytes(&[]), digest_bytes),
    }
}

#[cfg(test)]
mod grid_state_tests {
    use super::*;
    use crate::grid::{ensure_arcs, set_shape, set_surface, set_tile, Grid, T_FLOOR};
    use crate::tile_shape::{ArcFeature, SHAPE_SLANT_NE};

    fn floor_ish() -> Grid {
        let mut g = Grid::solid(9, 7);
        for j in 1..6 {
            for i in 1..8 {
                set_tile(&mut g, i, j, T_FLOOR);
            }
        }
        g
    }

    /// ONE MUTATION PER FIELD, and each must move its OWN digest field.
    ///
    /// A digest that only folded `t` would pass a test that only changed tiles,
    /// which is the shape of the mistake this whole module exists to avoid. So
    /// every field is perturbed separately and the assertion names it.
    #[test]
    fn every_field_of_the_grid_moves_its_own_digest() {
        let base = floor_ish();
        let d0 = digest_grid_state(&base);
        assert_eq!(d0, digest_grid_state(&base.clone()), "a clone must agree");

        let mut g = base.clone();
        set_tile(&mut g, 4, 3, crate::grid::T_WALL);
        assert_ne!(digest_grid_state(&g).tiles, d0.tiles, "t");

        let mut g = base.clone();
        set_shape(&mut g, 0, 0, SHAPE_SLANT_NE);
        assert_ne!(digest_grid_state(&g).shapes, d0.shapes, "shapes");

        let mut g = base.clone();
        set_surface(&mut g, 4, 3, 2);
        assert_ne!(digest_grid_state(&g).surfaces, d0.surfaces, "surfaces");

        let mut g = base.clone();
        g.arcs.push(ArcFeature {
            cx: 1.0,
            cz: 2.0,
            r: 3.0,
            ..Default::default()
        });
        assert_ne!(digest_grid_state(&g).arcs, d0.arcs, "arcs");

        let mut g = base.clone();
        ensure_arcs(&mut g);
        assert_ne!(
            digest_grid_state(&g).arc_idx,
            d0.arc_idx,
            "arc_idx allocated"
        );
        g.arc_idx.as_mut().unwrap()[10] = 0;
        assert_ne!(digest_grid_state(&g).arc_idx, d0.arc_idx, "arc_idx written");

        // Dimensions. A 9×7 and a 7×9 grid of the same solid bytes digest
        // identically on every array — only `w`/`h` separate them.
        let a = Grid::solid(9, 7);
        let b = Grid::solid(7, 9);
        assert_eq!(digest_grid_state(&a).tiles, digest_grid_state(&b).tiles);
        assert_ne!(digest_grid_state(&a), digest_grid_state(&b), "w/h");
    }

    /// THE FIELD LIST ITSELF. A field ADDED to `Grid` and not folded in would
    /// otherwise leave `digest_grid_state` quietly partial, and the immutability
    /// guard it backs would stop covering the new state with nothing saying so.
    ///
    /// Destructuring is the check: this stops compiling the moment `Grid` grows
    /// a field, and the fix is to fold it in above and name it here.
    #[test]
    fn grid_state_digest_covers_every_field_of_grid() {
        let g = floor_ish();
        let Grid {
            w: _,
            h: _,
            t: _,
            shapes: _,
            surfaces: _,
            arcs: _,
            arc_idx: _,
        } = g;
    }

    /// An absent `surfaces` and a present all-zero one are different grids, and
    /// the empty-array encoding is what keeps them apart.
    #[test]
    fn an_absent_array_does_not_digest_as_a_present_zero_one() {
        let bare = floor_ish();
        let mut with = floor_ish();
        set_surface(&mut with, 0, 0, 0); // allocates the array, writes nothing
        assert!(bare.surfaces.is_none() && with.surfaces.is_some());
        assert_ne!(
            digest_grid_state(&bare).surfaces,
            digest_grid_state(&with).surfaces
        );
    }
}
