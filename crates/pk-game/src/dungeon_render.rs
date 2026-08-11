//! DUNGEON RENDERER — a floor's static geometry, culled and batched.
//!
//! Port of the wall section of `legacy/src/game/pinball-knight/maze/build.ts`
//! (`buildMaze`, ~L1234-1435). The slice's first renderer spawned ONE ENTITY
//! PER TILE with its own transform. That is fine for the 25×25 `demo_floor`
//! and fatal for a generated one: `levelConfig` runs to a 96×72-cell maze,
//! which `thickenWalls` doubles into a ~194×146 tile grid — tens of thousands
//! of entities, each paying transform propagation, visibility and render-world
//! extraction every single frame.
//!
//! Two ports fix that, in the oracle's order:
//!
//! 1. **OCCLUSION CULL.** A wall tile with no walkable 8-neighbour is buried
//!    inside solid rock and can never be seen, so it is never built. See
//!    [`exposed`] — and read the note there on why this is safe for THIS
//!    camera specifically, which is not obvious.
//!
//! 2. **BATCHING.** Tiles sort into buckets (full / moss / knee-high rim /
//!    slant / round / arc) and each bucket becomes ONE mesh, one entity, one
//!    draw. legacy uses `THREE.InstancedMesh`; Bevy 0.17 has no equivalent
//!    type, which leaves two idiomatic routes:
//!
//!    - a **merged mesh** per bucket — append transformed vertex data, and
//!    - a **custom material with a storage buffer** of per-instance data,
//!      which is what `fx/material.rs` does for the particle pool.
//!
//!    This module merges. Walls are static for the life of a floor, so the
//!    per-instance transform is a constant that may as well be baked; merging
//!    needs no custom shader, no WGSL to keep in step with `StandardMaterial`,
//!    and behaves identically on wasm/WebGPU and on native. The storage-buffer
//!    route earns its complexity when instances MOVE (particles do), and walls
//!    do not. The cost paid is frustum granularity: a merged bucket is one
//!    `Aabb` spanning the floor, so it is all-or-nothing to the frustum, where
//!    12 000 separate entities could each be rejected. That trade is correct
//!    here — the floor is what the camera is looking at, so per-tile frustum
//!    rejection saves little, while per-tile ECS work costs every frame.
//!
//! Deliberately NOT ported yet (P3, and each would change the picture):
//! textures and the moss material, banners/decor/torches/lights, the
//! knee-high treatment for shaped tiles and arc sweeps, and legacy's
//! removable meshes for `T_CRACKED` bands. The moss BUCKET is ported now —
//! only its material is still plain stone — so the split costs nothing on the
//! day the texture lands.

use std::collections::BTreeMap;

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use pk_core::grid::{is_low_wall, is_walkable, shape_at, tile_center, Grid};
use pk_core::tile_shape::{is_round, is_slant, round_center, shape_normal, SHAPE_FULL};

use crate::dungeon_light::Stone;
use crate::units::c;
use crate::{WALL_H, WALL_LOW};

/// One batched draw: every tile in the bucket shares a mesh shape, a height
/// and a material, so they merge into a single entity.
///
/// `Ord` is derived and load-bearing: the plan keys a [`BTreeMap`] with this,
/// so bucket order — and therefore spawn order and entity order — is a pure
/// function of the grid, not of a hash seed.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Bucket {
    /// Full-height stone box.
    Full,
    /// Full-height box on the legacy moss variant, `(i*7 + j*13) % 4 == 0`.
    /// Same material as [`Bucket::Full`] until the textures land; the point of
    /// carrying it now is that the SELECTION is the thing that has to match
    /// the oracle, and a selection with no bucket cannot be checked.
    Moss,
    /// Knee-high camera-side rim — the Diablo rule (`pk_core::grid::is_low_wall`).
    Low,
    /// Slant prism, split by `(shape, low)` exactly as the oracle splits it.
    /// `low` does not change the height YET (see the module header: shaped
    /// tiles still draw full-height, which is what the slice draws today), but
    /// it is in the key so the day it does, no call site moves.
    Slant { shape: u8, low: bool },
    /// Round quarter-disc shell, split by `(shape, low)`.
    Round { shape: u8, low: bool },
}

/// Where one stamp of a bucket's shape goes. Translation and a yaw — never a
/// scale, which is why [`Merged::push`] can rotate normals without a normal
/// matrix.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Placement {
    pub pos: Vec3,
    pub yaw: f32,
}

/// What the cull and the bucketing actually did, so the win is a number and
/// not an adjective.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct PlanStats {
    /// `w * h`.
    pub tiles: usize,
    /// Non-walkable tiles, including the ARC slices drawn by their feature.
    pub wall_tiles: usize,
    /// Wall tiles this renderer would draw per-tile — i.e. what the
    /// one-entity-per-tile version spawned, before any cull.
    pub candidates: usize,
    /// Candidates dropped for having no walkable 8-neighbour.
    pub culled: usize,
    /// Candidates kept and stamped into a bucket.
    pub drawn: usize,
    /// Stepped boxes swept along the multi-tile arc features.
    pub arc_segments: usize,
}

/// The MEASUREMENT surface, and only that — the shipped renderer spawns from
/// `WallPlan::buckets` and never asks these questions, so they are test-gated
/// rather than carried into the binary. They are still the deliverable: a
/// batching claim with no number attached is worthless.
#[cfg(test)]
impl PlanStats {
    /// Entities the pre-batching renderer spawned for this grid: one per
    /// drawable wall tile, one per arc segment, plus the floor plane.
    pub fn per_tile_entities(&self) -> usize {
        self.candidates + self.arc_segments + 1
    }

    /// Share of drawable wall tiles the occlusion cull removed.
    pub fn culled_fraction(&self) -> f64 {
        if self.candidates == 0 {
            0.0
        } else {
            self.culled as f64 / self.candidates as f64
        }
    }
}

/// Every wall in a grid, sorted into the buckets that will each become one
/// mesh. Render-free and Bevy-`App`-free: this is the part worth testing.
pub(crate) struct WallPlan {
    pub buckets: BTreeMap<Bucket, Vec<Placement>>,
    /// Arc-guide segments — one bucket in all but name (they carry their own
    /// brass material), kept separate because they come from `grid.arcs`
    /// rather than from tiles and so are not subject to the tile cull.
    pub arcs: Vec<Placement>,
    /// Measurement only — see the `#[cfg(test)] impl PlanStats` above.
    #[cfg_attr(not(test), allow(dead_code))]
    pub stats: PlanStats,
}

impl WallPlan {
    /// Entities this plan spawns: one per non-empty bucket, one for the arcs
    /// if any, plus the floor plane. Equals the draw count, since each is one
    /// mesh with one material.
    pub fn batched_entities(&self) -> usize {
        self.buckets.len() + usize::from(!self.arcs.is_empty()) + 1
    }
}

/// legacy: "a wall buried inside a solid block can never be seen". A wall tile
/// with at least one walkable 8-neighbour is built; one without is skipped
/// outright.
///
/// Why removing a tile cannot punch a visible hole, which is the part that
/// looks unsafe: the camera is orthographic at 38° tilt / 45° yaw, and a fully
/// enclosed tile is a 1×1 pit `WALL_H` deep in an otherwise flat wall top. The
/// sightline enters over the near rim at `WALL_H` and drops
/// `√2 · tan 38° = 1.104` crossing the cell — against `WALL_H = 1.1`. It
/// grazes the far bottom corner and sees nothing. `WALL_H` is not an arbitrary
/// 1.1; it is that angle's self-occluding depth, which is exactly what makes
/// this cull free rather than merely cheap.
fn exposed(g: &Grid, i: i32, j: i32) -> bool {
    for dj in -1..=1 {
        for di in -1..=1 {
            if is_walkable(g, i + di, j + dj) {
                return true;
            }
        }
    }
    false
}

/// Sort a grid's walls into buckets. Pure — no `Assets`, no `World`.
pub(crate) fn plan_walls(grid: &Grid) -> WallPlan {
    let mut buckets: BTreeMap<Bucket, Vec<Placement>> = BTreeMap::new();
    let mut stats = PlanStats {
        tiles: (grid.w as usize) * (grid.h as usize),
        ..PlanStats::default()
    };
    let (gw2, gh2) = (f64::from(grid.w) / 2.0, f64::from(grid.h) / 2.0);

    for j in 0..grid.h {
        for i in 0..grid.w {
            if is_walkable(grid, i, j) {
                continue;
            }
            stats.wall_tiles += 1;
            let shape = shape_at(grid, i, j);
            // ARC slices render from their feature below, never per-tile.
            if !(shape == SHAPE_FULL || is_slant(shape) || is_round(shape)) {
                continue;
            }
            stats.candidates += 1;
            if !exposed(grid, i, j) {
                stats.culled += 1;
                continue;
            }
            stats.drawn += 1;

            let (x, z) = tile_center(grid, i, j);
            let low = is_low_wall(grid, i, j);

            if is_slant(shape) {
                // A wedge along the hypotenuse, offset onto the solid side.
                let n = shape_normal(shape).expect("slant shape has a normal");
                let yaw = if (n.x > 0.0) == (n.z > 0.0) {
                    std::f32::consts::FRAC_PI_4
                } else {
                    -std::f32::consts::FRAC_PI_4
                };
                buckets
                    .entry(Bucket::Slant { shape, low })
                    .or_default()
                    .push(Placement {
                        pos: Vec3::new(
                            (x - n.x * 0.25) as f32,
                            WALL_H / 2.0,
                            (z - n.z * 0.25) as f32,
                        ),
                        yaw,
                    });
                continue;
            }
            if is_round(shape) {
                // Quarter-disc corner: a radius-1 cylinder on the arc centre;
                // the surplus quarters sink into the solid backing tiles.
                let c = round_center(shape).expect("round shape has a centre");
                buckets
                    .entry(Bucket::Round { shape, low })
                    .or_default()
                    .push(Placement {
                        pos: Vec3::new(
                            (f64::from(i) + c.x - gw2) as f32,
                            WALL_H / 2.0,
                            (f64::from(j) + c.z - gh2) as f32,
                        ),
                        yaw: 0.0,
                    });
                continue;
            }

            let (bucket, hh) = if low {
                (Bucket::Low, WALL_LOW / 2.0)
            } else if (i * 7 + j * 13) % 4 == 0 {
                // legacy: every ~4th tall wall grows moss — breaks up runs.
                (Bucket::Moss, WALL_H / 2.0)
            } else {
                (Bucket::Full, WALL_H / 2.0)
            };
            buckets.entry(bucket).or_default().push(Placement {
                pos: Vec3::new(x as f32, hh, z as f32),
                yaw: 0.0,
            });
        }
    }

    // Multi-tile arc guides: segment boxes swept along each feature's circle
    // (the collider resolves against the true arc; this is its visual echo).
    // Not culled — they are per-FEATURE, and legacy's exposure test never saw
    // them either.
    let mut arcs = Vec::new();
    for f in &grid.arcs {
        let segs = ((f.span / 0.2).ceil() as usize).max(4);
        for s in 0..segs {
            let a = f.a0 + f.span * (s as f64 + 0.5) / segs as f64;
            arcs.push(Placement {
                pos: Vec3::new(
                    (f.cx + libm::cos(a) * f.r - gw2) as f32,
                    WALL_H / 2.0,
                    (f.cz + libm::sin(a) * f.r - gh2) as f32,
                ),
                yaw: -a as f32,
            });
        }
    }
    stats.arc_segments = arcs.len();

    WallPlan {
        buckets,
        arcs,
        stats,
    }
}

/// The primitive one stamp of a bucket draws — identical to the per-tile
/// meshes the slice used, so merging cannot change the silhouette.
fn bucket_shape(bucket: Bucket) -> Mesh {
    match bucket {
        Bucket::Full | Bucket::Moss => Mesh::from(Cuboid::new(1.0, WALL_H, 1.0)),
        Bucket::Low => Mesh::from(Cuboid::new(1.0, WALL_LOW, 1.0)),
        // A wedge along the hypotenuse — a P3-debt approximation of the
        // triangular prism, unchanged by this pass.
        Bucket::Slant { .. } => {
            Mesh::from(Cuboid::new(std::f64::consts::SQRT_2 as f32, WALL_H, 0.5))
        }
        Bucket::Round { .. } => Mesh::from(Cylinder::new(1.0, WALL_H)),
    }
}

/// The arc-guide segment box.
fn arc_shape() -> Mesh {
    Mesh::from(Cuboid::new(0.8, WALL_H, 0.8))
}

/// A source mesh flattened into plain arrays, so stamping it N times costs N
/// vector appends rather than N tessellations and N `Mesh` allocations.
struct Stamp {
    pos: Vec<[f32; 3]>,
    nrm: Vec<[f32; 3]>,
    uv: Vec<[f32; 2]>,
    idx: Vec<u32>,
}

impl Stamp {
    fn new(mesh: &Mesh) -> Self {
        let pos = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
            _ => Vec::new(),
        };
        let nrm = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
            Some(VertexAttributeValues::Float32x3(v)) => v.clone(),
            _ => Vec::new(),
        };
        let uv = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
            Some(VertexAttributeValues::Float32x2(v)) => v.clone(),
            _ => Vec::new(),
        };
        // A non-indexed source is stamped as a trivial 0..n index run, so the
        // merge path has exactly one shape to handle.
        let idx = match mesh.indices() {
            Some(Indices::U32(v)) => v.clone(),
            Some(Indices::U16(v)) => v.iter().map(|&k| u32::from(k)).collect(),
            None => (0..pos.len() as u32).collect(),
        };
        Self { pos, nrm, uv, idx }
    }
}

/// Accumulates transformed copies of one [`Stamp`] into a single mesh.
struct Merged {
    pos: Vec<[f32; 3]>,
    nrm: Vec<[f32; 3]>,
    uv: Vec<[f32; 2]>,
    idx: Vec<u32>,
}

impl Merged {
    fn with_capacity(stamp: &Stamp, n: usize) -> Self {
        Self {
            pos: Vec::with_capacity(stamp.pos.len() * n),
            nrm: Vec::with_capacity(stamp.nrm.len() * n),
            uv: Vec::with_capacity(stamp.uv.len() * n),
            idx: Vec::with_capacity(stamp.idx.len() * n),
        }
    }

    fn push(&mut self, stamp: &Stamp, at: Placement) {
        let base = self.pos.len() as u32;
        let rot = Quat::from_rotation_y(at.yaw);
        for v in &stamp.pos {
            self.pos
                .push((at.pos + rot * Vec3::from_array(*v)).to_array());
        }
        // Rotation-only, so the normal transform IS the rotation — no inverse
        // transpose, and the vectors stay unit length.
        for n in &stamp.nrm {
            self.nrm.push((rot * Vec3::from_array(*n)).to_array());
        }
        self.uv.extend_from_slice(&stamp.uv);
        self.idx.extend(stamp.idx.iter().map(|k| k + base));
    }

    fn into_mesh(self) -> Mesh {
        // `RenderAssetUsages::default()` keeps the main-world copy, which
        // `calculate_bounds` needs to give the entity an `Aabb`; a
        // RENDER_WORLD-only mesh would drop out of view-visibility entirely.
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::default(),
        )
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, self.pos)
        .with_inserted_indices(Indices::U32(self.idx));
        if !self.nrm.is_empty() {
            mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.nrm);
        }
        if !self.uv.is_empty() {
            mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uv);
        }
        mesh
    }
}

/// Stamp `cells` copies of `shape` into one mesh.
fn merge(shape: &Mesh, cells: &[Placement]) -> Mesh {
    let stamp = Stamp::new(shape);
    let mut merged = Merged::with_capacity(&stamp, cells.len());
    for &c in cells {
        merged.push(&stamp, c);
    }
    merged.into_mesh()
}

/// Every mesh a plan needs, built but not yet uploaded — the measurable half
/// of [`spawn_grid_meshes`], and the half a test can run without an `App`.
pub(crate) fn build_meshes(plan: &WallPlan) -> Vec<(Bucket, Mesh)> {
    plan.buckets
        .iter()
        .map(|(&bucket, cells)| (bucket, merge(&bucket_shape(bucket), cells)))
        .collect()
}

/// Spawn the floor plane, batched wall meshes (Diablo-rule low rims),
/// shaped-tile meshes and arc-guide segments for a grid — shared by the
/// dungeon floor and the intro's title maze. Returns every entity so callers
/// can tag them.
///
/// One entity per BUCKET, not per tile. See the module header.
pub(crate) fn spawn_grid_meshes(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    grid: &Grid,
    stone: Stone,
) -> Vec<Entity> {
    let plan = plan_walls(grid);
    let mut out = Vec::with_capacity(plan.batched_entities());

    // ── Floor plane ──
    let (gw, gh) = (grid.w as f32, grid.h as f32);
    out.push(
        commands
            .spawn((
                Mesh3d(meshes.add(Plane3d::default().mesh().size(gw, gh))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    // The biome's DARK stone — the flagstone floor's base tone.
                    // Was a warm grey that answered to no biome; see `Stone`.
                    base_color: c(stone.dark),
                    // LIT, as of the light rig (`dungeon_light`). These four
                    // materials were `unlit` while the dungeon had no lights at
                    // all, which made the torch pool a no-op — see that module's
                    // header. Roughness 0.95: stone, with no specular highlight
                    // to give away that the normal maps have not been baked yet.
                    perceptual_roughness: 0.95,
                    ..default()
                })),
                Transform::from_xyz(0.0, 0.0, 0.0),
            ))
            .id(),
    );

    // ── Walls: full-height stone, knee-high camera-side rims (the Diablo rule)
    let wall_mat = materials.add(StandardMaterial {
        // MID stone: the wall faces, which is most of what the camera sees.
        base_color: c(stone.mid),
        perceptual_roughness: 0.95,
        ..default()
    });
    let low_mat = materials.add(StandardMaterial {
        // LIGHT stone on the knee-high rims: the camera looks down at their
        // TOPS, and the oracle's cap texture is the lightest of the three.
        base_color: c(stone.light),
        perceptual_roughness: 0.95,
        ..default()
    });
    // Shaped tiles get their own meshes — square boxes would contradict the
    // collider ("see = hit" is the tile-shape contract; these are P3-debt
    // approximations of it, not violations).
    let shaped_mat = materials.add(StandardMaterial {
        base_color: c(stone.mid),
        perceptual_roughness: 0.95,
        ..default()
    });

    for (bucket, mesh) in build_meshes(&plan) {
        let material = match bucket {
            // Moss shares stone until its texture lands — the bucket exists
            // for the selection, not yet for a different look.
            Bucket::Full | Bucket::Moss => wall_mat.clone(),
            Bucket::Low => low_mat.clone(),
            Bucket::Slant { .. } | Bucket::Round { .. } => shaped_mat.clone(),
        };
        out.push(
            commands
                .spawn((
                    Mesh3d(meshes.add(mesh)),
                    MeshMaterial3d(material),
                    // The stamps carry world positions, so the batch entity
                    // sits at the origin.
                    Transform::IDENTITY,
                ))
                .id(),
        );
    }

    let arc_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.55, 0.45, 0.28), // brass-ish: the ball guide
        // Lit like the rest of the floor. Left `unlit` it would be the only
        // surface in the dungeon that ignores a torch, and a guide that does not
        // catch the light reads as a decal rather than a rail.
        perceptual_roughness: 0.5,
        metallic: 0.4,
        ..default()
    });
    if !plan.arcs.is_empty() {
        out.push(
            commands
                .spawn((
                    Mesh3d(meshes.add(merge(&arc_shape(), &plan.arcs))),
                    MeshMaterial3d(arc_mat),
                    Transform::IDENTITY,
                ))
                .id(),
        );
    }
    out
}

// ── SURFACE WASH ───────────────────────────────────────────────────────────

/// What a painted floor tile is MADE OF, as a colour.
///
/// `paintSurfaces` (`maze/surface-paint.ts`) covers a median ~1,900 tiles a
/// floor, and until 2026-08-11 the export did not carry the byte at all — so
/// the port's ice was stone, both to the eye and to `pk_core::pinball`'s
/// friction and steering. These are the four wash textures' BASE FILLS,
/// verbatim from `maze/build.ts:816-880`, at the alpha the painter uses:
///
/// | surface | fill | palette |
/// |---|---|---|
/// | `FLOOR_ICE` | `rgba(111, 208, 232, 0.30)` | arcane light 31 |
/// | `FLOOR_SAND` | `rgba(122, 59, 18, 0.34)` | ember 14 |
/// | `FLOOR_STEEL` | `rgba(138, 148, 166, 0.34)` | steel mid 20 |
/// | `FLOOR_GRIP` | `rgba(61, 92, 58, 0.32)` | rot dark 7 |
///
/// ⚠️ THE BASE FILL IS NOT THE TEXTURE. Each of those canvases then draws its
/// grain — crystalline fractures, wind ripples, riveted seams, mineral pebbling
/// — and the painter's own header says why: a flat colour quad "reads as a
/// spilled bucket of blue, not as ice". This is deliberately that flat quad
/// until the wash textures are baked, because the alternative is a floor whose
/// physics and whose paint disagree. The grain is V1's, with the rest of the
/// bake.
fn floor_wash(surface: u8) -> Option<(Color, f32)> {
    match surface {
        pk_core::surfaces::FLOOR_ICE => Some((Color::srgb_u8(111, 208, 232), 0.30)),
        pk_core::surfaces::FLOOR_SAND => Some((Color::srgb_u8(122, 59, 18), 0.34)),
        pk_core::surfaces::FLOOR_STEEL => Some((Color::srgb_u8(138, 148, 166), 0.34)),
        pk_core::surfaces::FLOOR_GRIP => Some((Color::srgb_u8(61, 92, 58), 0.32)),
        // FLOOR_STONE and anything unknown: no wash. A stone patch is a no-op
        // in the painter too — `paintSurfaces` skips it rather than repainting.
        _ => None,
    }
}

/// Which walkable tiles carry each washed surface.
///
/// ⚠️ **WALKABILITY IS THE DISAMBIGUATOR, NOT AN OPTIMISATION.** `Grid.surfaces`
/// holds TWO VOCABULARIES in one byte: a walkable tile carries a `FLOOR_*` id
/// and a solid one carries a `WALL_*` id (`surface-paint.ts:112-116`). Reading a
/// wall's byte through [`floor_wash`] would paint `WALL_ICE` (1) as `FLOOR_ICE`
/// — a different material entirely — so the walkability test here is the same
/// branch the painter makes when it writes.
pub(crate) fn wash_buckets(grid: &Grid) -> BTreeMap<u8, Vec<Placement>> {
    let mut out: BTreeMap<u8, Vec<Placement>> = BTreeMap::new();
    let Some(surfaces) = grid.surfaces.as_ref() else {
        return out;
    };
    for j in 0..grid.h {
        for i in 0..grid.w {
            if !is_walkable(grid, i, j) {
                continue;
            }
            let s = surfaces[(j * grid.w + i) as usize];
            if floor_wash(s).is_none() {
                continue;
            }
            let (x, z) = tile_center(grid, i, j);
            out.entry(s).or_default().push(Placement {
                pos: Vec3::new(x as f32, 0.0, z as f32),
                yaw: 0.0,
            });
        }
    }
    out
}

/// One thin quad per painted tile, merged into a mesh per material.
///
/// Sits 12 mm above the floor plane — the oracle's own "second, very thin quad
/// washed over the flagstone" (`build.ts:1227-1232`), which is what keeps the
/// stone reading THROUGH the patch instead of replacing it.
pub(crate) fn spawn_surface_wash(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    grid: &Grid,
) -> Vec<Entity> {
    let quad: Mesh = Plane3d::default().mesh().size(1.0, 1.0).into();
    wash_buckets(grid)
        .into_iter()
        .filter_map(|(surface, cells)| {
            let (colour, alpha) = floor_wash(surface)?;
            let mut base = colour.to_srgba();
            base.alpha = alpha;
            let mesh = merge(&quad, &cells);
            Some(
                commands
                    .spawn((
                        Mesh3d(meshes.add(mesh)),
                        MeshMaterial3d(materials.add(StandardMaterial {
                            base_color: base.into(),
                            alpha_mode: AlphaMode::Blend,
                            perceptual_roughness: 0.9,
                            // No depth bias games: the quad is lifted in Y
                            // instead, so it cannot z-fight with the floor at a
                            // grazing camera angle.
                            ..default()
                        })),
                        Transform::from_xyz(0.0, 0.012, 0.0),
                    ))
                    .id(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The wash buckets only ever read a WALKABLE tile's byte.
    ///
    /// The regression this pins is silent: a solid tile carrying `WALL_RUBBER`
    /// (1) would be washed as `FLOOR_ICE` (1) — a blue patch on a wall, and the
    /// wrong material named. Built as a grid where every SOLID tile carries the
    /// id of a washed floor surface and no walkable one does, so a reader that
    /// skips the walkability branch produces buckets where the correct one
    /// produces none.
    #[test]
    fn the_wash_never_reads_a_walls_byte() {
        let mut g = Grid::solid(5, 5);
        // A cross of floor through the middle.
        for k in 1..4 {
            pk_core::grid::set_tile(&mut g, k, 2, pk_core::grid::T_FLOOR);
            pk_core::grid::set_tile(&mut g, 2, k, pk_core::grid::T_FLOOR);
        }
        for j in 0..g.h {
            for i in 0..g.w {
                if !is_walkable(&g, i, j) {
                    // Every WALL says "ice" in the floor vocabulary.
                    pk_core::grid::set_surface(&mut g, i, j, pk_core::surfaces::FLOOR_ICE);
                }
            }
        }
        assert!(
            wash_buckets(&g).is_empty(),
            "a wall's surface byte must never reach the floor wash"
        );

        // …and one painted FLOOR tile does produce a bucket.
        pk_core::grid::set_surface(&mut g, 2, 2, pk_core::surfaces::FLOOR_ICE);
        let b = wash_buckets(&g);
        assert_eq!(b.len(), 1, "one material");
        assert_eq!(b[&pk_core::surfaces::FLOOR_ICE].len(), 1, "one tile");
    }

    /// A grid with no surface byte washes nothing rather than panicking — every
    /// generated floor is that grid until `surface-paint.ts` is ported.
    #[test]
    fn a_grid_with_no_surfaces_washes_nothing() {
        let g = Grid::solid(4, 4);
        assert!(wash_buckets(&g).is_empty());
    }

    /// Stone is not a wash. `paintSurfaces` skips a stone patch rather than
    /// repainting, and a stone-coloured quad over the flagstone would dull the
    /// whole floor for nothing.
    #[test]
    fn stone_is_not_washed() {
        assert!(floor_wash(pk_core::surfaces::FLOOR_STONE).is_none());
        assert!(floor_wash(200).is_none());
        for s in [
            pk_core::surfaces::FLOOR_ICE,
            pk_core::surfaces::FLOOR_SAND,
            pk_core::surfaces::FLOOR_STEEL,
            pk_core::surfaces::FLOOR_GRIP,
        ] {
            let (_, alpha) = floor_wash(s).expect("every non-stone floor surface washes");
            assert!((0.25..0.40).contains(&alpha), "wash alpha for {s}");
        }
    }

    use pk_core::grid::{set_tile, T_FLOOR, T_WALL};
    use pk_core::rng::Mulberry32;
    use pk_core::state::demo_floor;
    use std::time::Instant;

    /// The two shapes a shipped floor actually takes, both at FINAL tile
    /// resolution and both ~194×146 — the size `levelConfig`'s capped
    /// `cellsW = 96 / cellsH = 72` reaches through `thickenWalls`.
    ///
    /// They exist because the cull's yield is a property of the LAYOUT, not of
    /// the renderer, and the two generator branches sit at opposite ends of it.
    /// A single fixture would have reported one of these numbers as if it were
    /// the answer.
    const BIG_W: i32 = 194;
    const BIG_H: i32 = 146;

    /// `generateMaze` → `thickenWalls`: a growing-tree perfect maze on a
    /// `(2c+1)×(2h+1)` lattice, every tile doubled. Deterministic.
    fn thickened_maze_floor(cells_w: i32, cells_h: i32, seed: u32) -> Grid {
        let (mw, mh) = (cells_w * 2 + 1, cells_h * 2 + 1);
        let mut maze = Grid::solid(mw, mh);
        let mut rng = Mulberry32::new(seed);
        let mut visited = vec![false; (cells_w * cells_h) as usize];
        let mut active: Vec<(i32, i32)> = vec![(0, 0)];
        visited[0] = true;
        set_tile(&mut maze, 1, 1, T_FLOOR);
        const DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
        while let Some(&(cx, cy)) = active.last() {
            let options: Vec<(i32, i32)> = DIRS
                .iter()
                .map(|&(dx, dy)| (cx + dx, cy + dy))
                .filter(|&(nx, ny)| {
                    nx >= 0
                        && ny >= 0
                        && nx < cells_w
                        && ny < cells_h
                        && !visited[(ny * cells_w + nx) as usize]
                })
                .collect();
            if options.is_empty() {
                active.pop();
                continue;
            }
            let (nx, ny) = options[(rng.next_f64() * options.len() as f64) as usize];
            visited[(ny * cells_w + nx) as usize] = true;
            set_tile(&mut maze, nx * 2 + 1, ny * 2 + 1, T_FLOOR);
            set_tile(&mut maze, cx + nx + 1, cy + ny + 1, T_FLOOR);
            active.push((nx, ny));
        }
        // thickenWalls: every tile becomes a 2×2 block.
        let mut out = Grid::solid(mw * 2, mh * 2);
        for j in 0..mh {
            for i in 0..mw {
                if pk_core::grid::at(&maze, i, j) == T_WALL {
                    continue;
                }
                for (di, dj) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    set_tile(&mut out, i * 2 + di, j * 2 + dj, T_FLOOR);
                }
            }
        }
        out
    }

    /// The track branch (`buildTrackFloor`): a wide circuit plus chambers
    /// carved through solid rock at final resolution. Everything the carve
    /// misses stays rock — which is where interior fill comes from.
    fn carved_track_floor(w: i32, h: i32) -> Grid {
        let mut g = Grid::solid(w, h);
        let carve_rect = |g: &mut Grid, x0: i32, z0: i32, x1: i32, z1: i32| {
            for j in z0.max(1)..=z1.min(h - 2) {
                for i in x0.max(1)..=x1.min(w - 2) {
                    set_tile(g, i, j, T_FLOOR);
                }
            }
        };
        // Two concentric 5-wide circuits and the spurs joining them.
        for (inset, width) in [(10, 5), (34, 5)] {
            carve_rect(&mut g, inset, inset, w - inset, inset + width);
            carve_rect(&mut g, inset, h - inset - width, w - inset, h - inset);
            carve_rect(&mut g, inset, inset, inset + width, h - inset);
            carve_rect(&mut g, w - inset - width, inset, w - inset, h - inset);
        }
        for k in 0..6 {
            let x = 20 + k * 28;
            carve_rect(&mut g, x, 12, x + 4, h - 12);
        }
        // Chambers hanging off the circuit.
        for (cx, cz) in [(60, 40), (130, 40), (60, 100), (130, 100), (95, 70)] {
            carve_rect(&mut g, cx - 8, cz - 6, cx + 8, cz + 6);
        }
        g
    }

    /// The cull predicate IS the legacy one: any walkable 8-neighbour keeps
    /// the tile, and nothing else does.
    #[test]
    fn exposure_is_the_eight_neighbour_test() {
        let mut g = Grid::solid(5, 5);
        assert!(!exposed(&g, 2, 2), "solid rock: nothing is exposed");
        // A diagonal neighbour is enough — the 4-neighbour version would miss
        // exactly the maze pillars that stand between two corridors.
        set_tile(&mut g, 1, 1, T_FLOOR);
        assert!(exposed(&g, 2, 2));
        assert!(!exposed(&g, 3, 3), "two tiles away is still buried");
    }

    /// Bucketing must not quietly move a tile: the rim test wins first (the
    /// Diablo rule), and only the tall remainder is split on legacy's moss
    /// lattice. Checked by reading each placement's world position BACK to a
    /// tile and re-deriving the predicate — a bucket count alone would pass
    /// with the two branches swapped.
    #[test]
    fn bucketing_matches_the_oracle_tile_by_tile() {
        let mut g = Grid::solid(24, 24);
        // A comb of corridors: rim walls, tall walls and buried rock at once.
        for j in 2..22 {
            for i in 2..22 {
                if i % 3 == 0 || j % 5 == 0 {
                    set_tile(&mut g, i, j, T_FLOOR);
                }
            }
        }
        let plan = plan_walls(&g);
        let (mut low, mut moss, mut full) = (0, 0, 0);
        for (bucket, cells) in &plan.buckets {
            for c in cells {
                let (i, j) =
                    pk_core::grid::world_to_tile(&g, f64::from(c.pos.x), f64::from(c.pos.z));
                assert!(exposed(&g, i, j), "a culled tile reached a bucket");
                match bucket {
                    Bucket::Low => {
                        assert!(is_low_wall(&g, i, j), "({i},{j}) is not a rim");
                        low += 1;
                    }
                    Bucket::Moss => {
                        assert!(!is_low_wall(&g, i, j), "({i},{j}) is a rim, not moss");
                        assert_eq!((i * 7 + j * 13) % 4, 0, "({i},{j}) is off the lattice");
                        moss += 1;
                    }
                    Bucket::Full => {
                        assert!(!is_low_wall(&g, i, j), "({i},{j}) is a rim, not stone");
                        assert_ne!((i * 7 + j * 13) % 4, 0, "({i},{j}) belongs to moss");
                        full += 1;
                    }
                    Bucket::Slant { .. } | Bucket::Round { .. } => {}
                }
            }
        }
        assert!(low > 0 && moss > 0 && full > 0, "all three branches fire");
        assert_eq!(low + moss + full, plan.stats.drawn, "one bucket per tile");
        // legacy's `% 4` lattice takes about a quarter of the tall walls.
        let tall = moss + full;
        assert!(
            (moss as f64 / tall as f64 - 0.25).abs() < 0.10,
            "moss took {moss}/{tall} of the tall walls"
        );
    }

    /// `demo_floor` — the floor the slice actually renders today.
    #[test]
    fn demo_floor_batches_to_a_handful_of_draws() {
        let (grid, _) = demo_floor(7);
        let plan = plan_walls(&grid);
        let s = plan.stats;
        println!(
            "demo_floor(7) {}x{} = {} tiles | walls {} | per-tile candidates {} \
             | culled {} ({:.1}%) | drawn {} | arc segs {}",
            grid.w,
            grid.h,
            s.tiles,
            s.wall_tiles,
            s.candidates,
            s.culled,
            100.0 * s.culled_fraction(),
            s.drawn,
            s.arc_segments,
        );
        println!(
            "demo_floor(7) entities: {} per-tile -> {} batched (buckets: {:?})",
            s.per_tile_entities(),
            plan.batched_entities(),
            plan.buckets.keys().collect::<Vec<_>>(),
        );
        assert_eq!(s.tiles, 625);
        // The floor is a bordered room with 1-tile pillars: every wall tile
        // touches floor, so the cull correctly finds nothing to remove. That
        // is the strongest possible statement that the picture is unchanged
        // here — not one tile was dropped.
        assert_eq!(s.culled, 0, "demo_floor has no interior fill to cull");
        assert!(
            plan.batched_entities() <= 8,
            "batched to {} entities",
            plan.batched_entities()
        );
        assert!(
            s.per_tile_entities() > 20 * plan.batched_entities(),
            "batching must be worth doing even on the demo floor"
        );
    }

    /// The maze branch at a real floor's size. The cull is NEARLY WORTHLESS
    /// here and that is not a bug: on a `(2c+1)` lattice every interior wall
    /// tile is 8-adjacent to a cell centre, which is always floor, so only the
    /// outer ring is buried. Batching is what carries this floor.
    #[test]
    fn thickened_maze_floor_scales() {
        let grid = thickened_maze_floor(48, 36, 0xC0FF_EE01);
        assert_eq!((grid.w, grid.h), (BIG_W, BIG_H));
        let t0 = Instant::now();
        let plan = plan_walls(&grid);
        let plan_ms = t0.elapsed().as_secs_f64() * 1e3;
        let t1 = Instant::now();
        let built = build_meshes(&plan);
        let build_ms = t1.elapsed().as_secs_f64() * 1e3;
        let s = plan.stats;
        let verts: usize = built.iter().map(|(_, m)| m.count_vertices()).sum();
        println!(
            "maze {}x{} = {} tiles | walls {} ({:.1}%) | candidates {} \
             | culled {} ({:.1}%) | drawn {}",
            grid.w,
            grid.h,
            s.tiles,
            s.wall_tiles,
            100.0 * s.wall_tiles as f64 / s.tiles as f64,
            s.candidates,
            s.culled,
            100.0 * s.culled_fraction(),
            s.drawn,
        );
        println!(
            "maze entities: {} per-tile -> {} batched | plan {:.2} ms + merge \
             {:.2} ms = {:.2} ms | {} verts in {} meshes",
            s.per_tile_entities(),
            plan.batched_entities(),
            plan_ms,
            build_ms,
            plan_ms + build_ms,
            verts,
            built.len(),
        );
        assert!(
            s.candidates > 12_000,
            "fixture must be a real floor's worth of wall, got {}",
            s.candidates
        );
        // The lattice buries only its border ring — assert the SHAPE of the
        // result, so a future generator change that starts leaving solid rock
        // shows up as a failure here rather than as a silent perf cliff.
        assert!(
            s.culled_fraction() < 0.10,
            "a perfect-maze lattice hides almost nothing: culled {:.1}%",
            100.0 * s.culled_fraction()
        );
        assert!(
            plan.batched_entities() <= 8,
            "batched to {} entities",
            plan.batched_entities()
        );
    }

    /// The track branch: a circuit carved through rock. THIS is where the
    /// cull earns its keep — most of the floor is interior fill.
    #[test]
    fn carved_track_floor_is_mostly_culled() {
        let grid = carved_track_floor(BIG_W, BIG_H);
        let t0 = Instant::now();
        let plan = plan_walls(&grid);
        let plan_ms = t0.elapsed().as_secs_f64() * 1e3;
        let t1 = Instant::now();
        let built = build_meshes(&plan);
        let build_ms = t1.elapsed().as_secs_f64() * 1e3;
        let s = plan.stats;
        let verts: usize = built.iter().map(|(_, m)| m.count_vertices()).sum();
        println!(
            "track {}x{} = {} tiles | walls {} ({:.1}%) | candidates {} \
             | culled {} ({:.1}%) | drawn {}",
            grid.w,
            grid.h,
            s.tiles,
            s.wall_tiles,
            100.0 * s.wall_tiles as f64 / s.tiles as f64,
            s.candidates,
            s.culled,
            100.0 * s.culled_fraction(),
            s.drawn,
        );
        println!(
            "track entities: {} per-tile -> {} batched | plan {:.2} ms + merge \
             {:.2} ms = {:.2} ms | {} verts in {} meshes",
            s.per_tile_entities(),
            plan.batched_entities(),
            plan_ms,
            build_ms,
            plan_ms + build_ms,
            verts,
            built.len(),
        );
        assert!(
            s.culled_fraction() > 0.70,
            "a carved floor is mostly buried rock: culled {:.1}%",
            100.0 * s.culled_fraction()
        );
        assert!(
            plan.batched_entities() <= 8,
            "batched to {} entities",
            plan.batched_entities()
        );
    }

    /// The merge is geometry-preserving: N stamps of a K-vertex primitive give
    /// exactly N·K vertices and N·I indices, and every stamp lands where its
    /// placement said. A merge that quietly dropped or welded vertices would
    /// change the picture, and nothing else in the suite would see it.
    #[test]
    fn merging_preserves_every_stamp() {
        let shape = bucket_shape(Bucket::Full);
        let one = Stamp::new(&shape);
        let cells = vec![
            Placement {
                pos: Vec3::new(-3.0, WALL_H / 2.0, 5.0),
                yaw: 0.0,
            },
            Placement {
                pos: Vec3::new(7.0, WALL_H / 2.0, -2.0),
                yaw: 0.0,
            },
        ];
        let merged = merge(&shape, &cells);
        assert_eq!(merged.count_vertices(), one.pos.len() * cells.len());
        let Some(Indices::U32(idx)) = merged.indices() else {
            panic!("merged meshes are U32-indexed");
        };
        assert_eq!(idx.len(), one.idx.len() * cells.len());
        assert!(
            idx.iter().all(|&k| (k as usize) < merged.count_vertices()),
            "every index must stay inside the merged buffer"
        );
        let Some(VertexAttributeValues::Float32x3(pos)) =
            merged.attribute(Mesh::ATTRIBUTE_POSITION)
        else {
            panic!("merged mesh keeps positions");
        };
        // Each half of the buffer is the source box translated by its cell.
        for (k, cell) in cells.iter().enumerate() {
            for (v, src) in one.pos.iter().enumerate() {
                let got = Vec3::from_array(pos[k * one.pos.len() + v]);
                let want = cell.pos + Vec3::from_array(*src);
                assert!(
                    got.distance(want) < 1e-5,
                    "stamp {k} vertex {v}: {got:?} != {want:?}"
                );
            }
        }
    }

    /// THE PICTURE IS UNCHANGED, checked against an independent implementation.
    ///
    /// The per-tile renderer drew each bucket's primitive at each placement's
    /// `Transform`. Bevy can express exactly that — `Mesh::transformed_by` +
    /// `Mesh::merge` — so building the reference that way and demanding my
    /// merger match it vertex-for-vertex settles the question without a GPU,
    /// and without this test re-deriving my own arithmetic (which would only
    /// prove the code agrees with itself). Run over EVERY bucket the shipped
    /// `demo_floor` produces, arcs included, because the yawed buckets are the
    /// ones a transform bug would hide in.
    #[test]
    fn every_bucket_matches_bevys_own_merge_on_the_demo_floor() {
        let (grid, _) = demo_floor(7);
        let plan = plan_walls(&grid);
        let jobs: Vec<(String, Mesh, &Vec<Placement>)> = plan
            .buckets
            .iter()
            .map(|(&b, cells)| (format!("{b:?}"), bucket_shape(b), cells))
            .chain(std::iter::once((
                "Arc".to_string(),
                arc_shape(),
                &plan.arcs,
            )))
            .collect();
        assert_eq!(jobs.len(), 6, "5 wall buckets + the arc sweep");

        for (name, shape, cells) in jobs {
            assert!(!cells.is_empty(), "{name}: nothing to compare");
            let mut reference: Option<Mesh> = None;
            for c in cells {
                let piece = shape.clone().transformed_by(
                    Transform::from_translation(c.pos).with_rotation(Quat::from_rotation_y(c.yaw)),
                );
                match &mut reference {
                    None => reference = Some(piece),
                    Some(r) => r.merge(&piece).expect("same attribute set"),
                }
            }
            let want = reference.expect("non-empty bucket");
            let got = merge(&shape, cells);

            assert_eq!(got.count_vertices(), want.count_vertices(), "{name}: verts");
            let (Some(Indices::U32(gi)), Some(Indices::U32(wi))) = (got.indices(), want.indices())
            else {
                panic!("{name}: both sides are U32-indexed");
            };
            assert_eq!(gi, wi, "{name}: index buffer");
            for attr in [Mesh::ATTRIBUTE_POSITION, Mesh::ATTRIBUTE_NORMAL] {
                let (
                    Some(VertexAttributeValues::Float32x3(g)),
                    Some(VertexAttributeValues::Float32x3(w)),
                ) = (got.attribute(attr), want.attribute(attr))
                else {
                    panic!("{name}: missing {attr:?}");
                };
                for (k, (a, b)) in g.iter().zip(w.iter()).enumerate() {
                    let (a, b) = (Vec3::from_array(*a), Vec3::from_array(*b));
                    assert!(
                        a.distance(b) < 1e-4,
                        "{name} {attr:?} vertex {k}: {a:?} != {b:?}"
                    );
                }
            }
            let (
                Some(VertexAttributeValues::Float32x2(g)),
                Some(VertexAttributeValues::Float32x2(w)),
            ) = (
                got.attribute(Mesh::ATTRIBUTE_UV_0),
                want.attribute(Mesh::ATTRIBUTE_UV_0),
            )
            else {
                panic!("{name}: missing UVs");
            };
            assert_eq!(g, w, "{name}: uvs");
        }
    }

    /// A yawed stamp rotates its normals with it — otherwise the slant wedges
    /// would light and cull backwards the moment the walls stop being unlit.
    #[test]
    fn merging_rotates_normals() {
        let shape = bucket_shape(Bucket::Slant {
            shape: pk_core::tile_shape::SHAPE_SLANT_NE,
            low: false,
        });
        let merged = merge(
            &shape,
            &[Placement {
                pos: Vec3::ZERO,
                yaw: std::f32::consts::FRAC_PI_2,
            }],
        );
        let Some(VertexAttributeValues::Float32x3(nrm)) = merged.attribute(Mesh::ATTRIBUTE_NORMAL)
        else {
            panic!("merged mesh keeps normals");
        };
        assert!(
            nrm.iter()
                .all(|n| (Vec3::from_array(*n).length() - 1.0).abs() < 1e-4),
            "rotation preserves unit length"
        );
        // A 90° yaw sends every +X face normal to -Z.
        assert!(
            nrm.iter()
                .any(|n| Vec3::from_array(*n).distance(Vec3::NEG_Z) < 1e-4),
            "the +X face must have turned to -Z"
        );
    }
}
