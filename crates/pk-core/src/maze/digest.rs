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
