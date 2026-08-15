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
//! 3. **TEXTURES** (V-1, 2026-08-11). Every material here was a flat
//!    `base_color` — the right stone FAMILY since the `BIOME_STONE` remap, and
//!    one colour where the oracle has flagstone, moss, coursing and cracks.
//!    The bake now exists (`crate::maze_art`), so the floor, the four wall
//!    variants and the dressed caps carry their painted pixels and their
//!    height-field normal maps. This is where the moss BUCKET finally pays for
//!    itself: it has carried the right SELECTION since the batching pass with
//!    no material of its own, and the day its texture landed cost one line.
//!
//! Deliberately NOT ported yet (P3/V-4, and each would change the picture):
//! banners and decor, the knee-high treatment for shaped tiles and arc sweeps,
//! shaped tiles at their real heights, and legacy's removable meshes for
//! `T_CRACKED` bands (whose face texture IS baked, and unused until the bands
//! are geometry).
//!
//! PORTS: `maze/build.ts`

use std::collections::BTreeMap;

use bevy::asset::RenderAssetUsages;
use bevy::math::Affine2;
use bevy::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::prelude::*;
use pk_core::grid::{is_low_wall, is_walkable, shape_at, tile_center, Grid};
use pk_core::tile_shape::{is_round, is_slant, round_center, shape_normal, SHAPE_FULL};

use crate::dungeon_light::Stone;
use crate::maze_art;
use crate::{WALL_H, WALL_LOW};

/// One batched draw: every tile in the bucket shares a mesh shape, a height
/// and a material, so they merge into a single entity.
///
/// `Ord` is derived and load-bearing: the plan keys a [`BTreeMap`] with this,
/// so bucket order — and therefore spawn order and entity order — is a pure
/// function of the grid, not of a hash seed.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Bucket {
    /// Full-height stone box, split by the WALL SURFACE it carries.
    ///
    /// ⚠️ **`surface` IS A `WALL_*` ID, NEVER A `FLOOR_*` ONE.** `Grid.surfaces`
    /// holds two vocabularies in one byte and walkability is the disambiguator
    /// (see [`wash_buckets`]) — every tile that reaches this key is solid, so
    /// the byte is a wall id by construction.
    ///
    /// Splitting the key is what lets a merged mesh do what the oracle does per
    /// INSTANCE: `build.ts:1395` calls `setColorAt` with `surf.hex` on each
    /// wall, and a merged bucket has no per-instance colour to set. One bucket
    /// per (shape, surface) gives each its own tinted material instead. Measured
    /// on the shipped floors this takes the box buckets from 3 to 12 on L1/L3
    /// and 3 to 9 on L5 — nine extra draw calls at the very worst.
    Full { surface: u8 },
    /// Full-height box on the legacy moss variant, `(i*7 + j*13) % 4 == 0`.
    /// Carries its own damp-rot face bake as of V-1; it existed for two passes
    /// before that with the plain stone material, because the SELECTION is the
    /// thing that has to match the oracle and a selection with no bucket
    /// cannot be checked.
    Moss { surface: u8 },
    /// Knee-high camera-side rim — the Diablo rule (`pk_core::grid::is_low_wall`).
    Low { surface: u8 },
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

/// Face groups a box bucket splits into — see [`FaceGroup`]. The oracle gives
/// every wall box six materials (four coursed sides, two dressed caps); a
/// merged mesh carries one, so each bucket becomes this many entities.
const FACE_GROUPS: usize = 2;

impl WallPlan {
    /// Entities this plan spawns: [`FACE_GROUPS`] per non-empty bucket, one for
    /// the arcs if any, plus the floor plane. Equals the draw count, since each
    /// is one mesh with one material.
    ///
    /// This was `buckets.len() + …` while every bucket drew in one flat colour.
    /// The baked textures split sides from caps, which doubles the bucket term
    /// — an upper bound, since a bucket with no cap faces spawns one entity.
    pub fn batched_entities(&self) -> usize {
        self.buckets.len() * FACE_GROUPS + usize::from(!self.arcs.is_empty()) + 1
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
                            shaped_height(low) / 2.0,
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
                            shaped_height(low) / 2.0,
                            (f64::from(j) + c.z - gh2) as f32,
                        ),
                        yaw: 0.0,
                    });
                continue;
            }

            // The tile is SOLID here (walkable was skipped at the top), so its
            // surface byte is a `WALL_*` id — see the `Bucket::Full` doc.
            let surface = grid
                .surfaces
                .as_ref()
                .map_or(pk_core::surfaces::WALL_STONE, |s| {
                    s[(j * grid.w + i) as usize]
                });
            let (bucket, hh) = if low {
                (Bucket::Low { surface }, WALL_LOW / 2.0)
            } else if (i * 7 + j * 13) % 4 == 0 {
                // legacy: every ~4th tall wall grows moss — breaks up runs.
                (Bucket::Moss { surface }, WALL_H / 2.0)
            } else {
                (Bucket::Full { surface }, WALL_H / 2.0)
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
        Bucket::Full { .. } | Bucket::Moss { .. } => Mesh::from(Cuboid::new(1.0, WALL_H, 1.0)),
        Bucket::Low { .. } => Mesh::from(Cuboid::new(1.0, WALL_LOW, 1.0)),
        // ⚠️ A SHAPED RIM IS KNEE-HIGH, exactly as a square one is.
        // The oracle picks `height = low ? WALL_LOW : WALL_H` for slants and
        // round shells alike (`build.ts:1476`), and this port drew every shaped
        // tile at `WALL_H` regardless — 10 tiles on L1, 8 on L3 and 12 on L5
        // stood full-height where the camera-side rim exists precisely so the
        // player can see over it. The `low` flag has been in the key since the
        // batching pass so that this day cost one line; this is that line.
        //
        // A wedge along the hypotenuse is still a P3-debt approximation of the
        // triangular prism — the SILHOUETTE is unchanged by this pass, only the
        // height.
        Bucket::Slant { low, .. } => Mesh::from(Cuboid::new(
            std::f64::consts::SQRT_2 as f32,
            shaped_height(low),
            0.5,
        )),
        Bucket::Round { low, .. } => Mesh::from(Cylinder::new(1.0, shaped_height(low))),
    }
}

/// How tall a shaped tile stands — `build.ts:1476`'s `low ? WALL_LOW : WALL_H`.
///
/// Named rather than inlined because THREE call sites have to agree: the mesh,
/// the placement's Y (a Bevy primitive is centred on its origin, so a shorter
/// box also sits lower) and the test that pins them together. Two of the three
/// disagreeing is a tile sunk into the floor or floating over it.
fn shaped_height(low: bool) -> f32 {
    if low {
        WALL_LOW
    } else {
        WALL_H
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

/// Which of a wall's faces a texture belongs on.
///
/// The oracle hands a box SIX materials, not one:
/// `[faceMat, faceMat, capMat, capMat, faceMat, faceMat]` in three.js's
/// `+x, -x, +y, -y, +z, -z` order (`build.ts:1425`) — coursed masonry on the
/// four sides, the bordered grid cap on top and bottom, "so the coursed texture
/// doesn't smear across a horizontal face".
///
/// A merged bucket is ONE mesh with ONE material, so the split has to happen in
/// the geometry instead: each bucket becomes two entities, one per face group.
/// Splitting by the NORMAL rather than by vertex index is deliberate — it needs
/// no knowledge of how Bevy happens to order a `Cuboid`'s faces this version,
/// and it does the right thing for the cylinder shells as well.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum FaceGroup {
    /// Vertical-ish: the coursed wall face.
    Side,
    /// Horizontal-ish: the dressed cap, top and bottom alike.
    Cap,
}

/// The half of `mesh` whose triangles face `group`, or `None` if it has none.
///
/// A triangle is classified by its first vertex normal, which is exact for the
/// flat-shaded boxes and wedges this is called on. `0.5` is a wide margin
/// rather than a tuned threshold: box normals are axis-aligned, so every
/// triangle scores 0 or 1 and nothing sits near the boundary.
pub(crate) fn split_faces(mesh: &Mesh, group: FaceGroup) -> Option<Mesh> {
    let (Some(VertexAttributeValues::Float32x3(pos)), Some(VertexAttributeValues::Float32x3(nrm))) = (
        mesh.attribute(Mesh::ATTRIBUTE_POSITION),
        mesh.attribute(Mesh::ATTRIBUTE_NORMAL),
    ) else {
        return None;
    };
    let uv = match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
        Some(VertexAttributeValues::Float32x2(v)) => v.as_slice(),
        _ => &[],
    };
    let idx: Vec<u32> = match mesh.indices() {
        Some(Indices::U32(v)) => v.clone(),
        Some(Indices::U16(v)) => v.iter().map(|&k| u32::from(k)).collect(),
        None => (0..pos.len() as u32).collect(),
    };

    // Vertices are re-indexed rather than copied wholesale: a bucket's cap is
    // 1/3 of its vertices, and shipping the other 2/3 as unreferenced data
    // would double the upload for no drawn triangle.
    let mut remap = vec![u32::MAX; pos.len()];
    let (mut o_pos, mut o_nrm, mut o_uv, mut o_idx) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for tri in idx.chunks_exact(3) {
        let horizontal = nrm[tri[0] as usize][1].abs() > 0.5;
        if horizontal != (group == FaceGroup::Cap) {
            continue;
        }
        for &v in tri {
            let vi = v as usize;
            if remap[vi] == u32::MAX {
                remap[vi] = o_pos.len() as u32;
                o_pos.push(pos[vi]);
                o_nrm.push(nrm[vi]);
                if !uv.is_empty() {
                    o_uv.push(uv[vi]);
                }
            }
            o_idx.push(remap[vi]);
        }
    }
    if o_idx.is_empty() {
        return None;
    }

    let mut out = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    )
    .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, o_pos)
    .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, o_nrm)
    .with_inserted_indices(Indices::U32(o_idx));
    if !o_uv.is_empty() {
        out.insert_attribute(Mesh::ATTRIBUTE_UV_0, o_uv);
    }
    Some(out)
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
    images: &mut Assets<Image>,
    grid: &Grid,
    stone: Stone,
) -> Vec<Entity> {
    let plan = plan_walls(grid);
    let mut out = Vec::with_capacity(plan.batched_entities());
    // The baked stone for THIS biome. Until this landed every material here was
    // a flat `base_color` — the right FAMILY since the `BIOME_STONE` remap, but
    // one colour where the oracle has flagstone, moss, cracks and coursing.
    let tex = maze_art::load(images, stone.biome);

    // ── Floor plane ──
    let (gw, gh) = (grid.w as f32, grid.h as f32);
    out.push(
        commands
            .spawn((
                Mesh3d(meshes.add(Plane3d::default().mesh().size(gw, gh))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color_texture: Some(tex.floor.clone()),
                    normal_map_texture: Some(tex.floor_normal.clone()),
                    // The floor is ONE plane under the whole grid and the
                    // flagstone texture spans `FLOOR_BLOCK` tiles, so the
                    // repeat is the grid measured in texture blocks —
                    // `cachedTiled("floor", …, grid.w / FLOOR_BLOCK, grid.h /
                    // FLOOR_BLOCK)` (`build.ts:1215`). Getting this wrong does
                    // not fail; it just makes the flagstones the wrong size.
                    uv_transform: Affine2::from_scale(Vec2::new(
                        gw / maze_art::FLOOR_BLOCK,
                        gh / maze_art::FLOOR_BLOCK,
                    )),
                    // The biome's DARK stone still tints the map. It is white
                    // in the oracle (`map` with no `color`), and it is kept
                    // here at full white for the same reason — the biome is
                    // already IN the pixels (`css()` remaps before painting),
                    // so tinting again would double the colour.
                    base_color: Color::WHITE,
                    // LIT, as of the light rig (`dungeon_light`). These
                    // materials were `unlit` while the dungeon had no lights at
                    // all, which made the torch pool a no-op — see that
                    // module's header.
                    perceptual_roughness: 0.95,
                    metallic: 0.0,
                    ..default()
                })),
                Transform::from_xyz(0.0, 0.0, 0.0),
            ))
            .id(),
    );

    // ── Walls: full-height stone, knee-high camera-side rims (the Diablo rule)
    //
    // Roughness is the oracle's per-material figure, and the two differ:
    // faces 0.92 (`build.ts:1418`), caps 0.95 (`:1363`).
    // `tint` MULTIPLIES the baked pixels; the stone identity is WHITE, not a
    // colour, exactly as the oracle's `setRGB(1,1,1)` is (`build.ts:1396`).
    let face = |map: &Handle<Image>, normal: &Handle<Image>, tint: Color| StandardMaterial {
        base_color_texture: Some(map.clone()),
        normal_map_texture: Some(normal.clone()),
        base_color: tint,
        perceptual_roughness: 0.92,
        metallic: 0.0,
        ..default()
    };
    // Shaped tiles get their own meshes — square boxes would contradict the
    // collider ("see = hit" is the tile-shape contract; these are P3-debt
    // approximations of it, not violations). The oracle paints them with the
    // PLAIN tall face (`build.ts:1453`).
    let shaped_mat = materials.add(face(&tex.wall, &tex.wall_normal, Color::WHITE));
    let cap_mat = materials.add(StandardMaterial {
        base_color_texture: Some(tex.cap.clone()),
        normal_map_texture: Some(tex.cap_normal.clone()),
        perceptual_roughness: 0.95,
        metallic: 0.0,
        ..default()
    });

    for (bucket, mesh) in build_meshes(&plan) {
        // ── THE WALL WASH (V-2) ──
        // One material per (shape, surface) bucket, tinted by the surface's own
        // hex. This is the merged-mesh equivalent of the oracle's per-INSTANCE
        // `setColorAt(k, surf.hex)`: a merged bucket has no instance to colour,
        // so the split in the KEY carries what the instance colour carried.
        //
        // Moss and the low rims are tinted too. They are the same masonry — a
        // rubber wall that happens to have grown moss still bounces like rubber
        // and must still read as rubber, and the knee-high rim is the piece the
        // ball hits MOST.
        let side_mat = match bucket {
            Bucket::Full { surface } => {
                materials.add(face(&tex.wall, &tex.wall_normal, wall_tint(surface)))
            }
            // Moss is its own PAINT, not its own geometry — the bucket has
            // existed since the batching pass precisely so this day cost one
            // line.
            Bucket::Moss { surface } => {
                materials.add(face(&tex.wall_moss, &tex.wall_normal, wall_tint(surface)))
            }
            // The knee-high rims have their own face bake: a full design
            // squashed to 0.35 world units would read as stripes, so the
            // painter draws a different one (`makeWallTexture(_, low = true)`).
            Bucket::Low { surface } => materials.add(face(
                &tex.wall_low,
                &tex.wall_low_normal,
                wall_tint(surface),
            )),
            Bucket::Slant { .. } | Bucket::Round { .. } => shaped_mat.clone(),
        };
        // Two entities per bucket, one material each — the merged-mesh stand-in
        // for the oracle's six-material box. A bucket with no cap faces (there
        // are none today, but a future capless shell would be one) spawns one.
        //
        // ⚠️ The round shell is CAPLESS in the oracle (`side: DoubleSide`, no
        // cap material) and Bevy's `Cylinder` has end discs. Giving those the
        // cap texture is the closer of the two available wrongs; making the
        // shell genuinely capless is V-4, with the rest of the shaped-tile
        // heights.
        for (group, material) in [(FaceGroup::Side, &side_mat), (FaceGroup::Cap, &cap_mat)] {
            let Some(part) = split_faces(&mesh, group) else {
                continue;
            };
            out.push(
                commands
                    .spawn((
                        Mesh3d(meshes.add(part)),
                        MeshMaterial3d(material.clone()),
                        // The stamps carry world positions, so the batch entity
                        // sits at the origin.
                        Transform::IDENTITY,
                    ))
                    .id(),
            );
        }
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

/// The multiply-tint for a WALL surface — the other half of the wash.
///
/// The oracle sets this per instance (`build.ts:1395`):
/// ```js
/// mesh.setColorAt(k, surf.id === WALL_STONE
///   ? tintScratch.setRGB(1, 1, 1)
///   : tintScratch.setHex(surf.hex, THREE.SRGBColorSpace));
/// ```
/// Two things in that line are load-bearing and both are kept here:
///
/// 1. **Stone is WHITE, not "no tint".** In three.js the first `setColorAt`
///    allocates `instanceColor` ZERO-FILLED, so an instance never written
///    renders BLACK — which is why the oracle writes every instance in a
///    tinted bucket including the stone ones. This port has no instance colour
///    at all (merged meshes), so the equivalent hazard is a `base_color` left
///    at its default; returning an explicit [`Color::WHITE`] makes the identity
///    a value rather than an omission.
/// 2. **The hex is sRGB.** `setColorAt` does not colour-space-convert the way
///    a `material.color` setter does, so the oracle passes `SRGBColorSpace`
///    explicitly or "the tint renders washed out". `Color::srgb_u8` is that
///    same declaration.
///
/// The tint MULTIPLIES the baked masonry rather than replacing it, so a rubber
/// wall is the biome's own stone seen through red — the courses, the joints and
/// the normal map all still read. Replacing the albedo would give four flat
/// colours and lose the bake, which is the mistake `floor_wash`'s header names
/// for the floor ("reads as a spilled bucket of blue, not as ice").
fn wall_tint(surface: u8) -> Color {
    let hex = pk_core::surfaces::wall_surface(surface).hex;
    if hex == 0x00ff_ffff {
        // The identity tint, spelled as itself.
        return Color::WHITE;
    }
    Color::srgb_u8(
        ((hex >> 16) & 0xff) as u8,
        ((hex >> 8) & 0xff) as u8,
        (hex & 0xff) as u8,
    )
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

    /// The face split has to PARTITION — every triangle in exactly one group.
    ///
    /// The failure this pins is not a crash: a split that dropped triangles
    /// leaves holes in the masonry, and one that duplicated them z-fights. Both
    /// read as a texture problem rather than a geometry one, which is why the
    /// counts are asserted rather than eyeballed on the A/B sheet.
    #[test]
    fn the_face_split_partitions_a_box() {
        let cube = Mesh::from(Cuboid::new(1.0, WALL_H, 1.0));
        let whole = tri_count(&cube);
        let sides = split_faces(&cube, FaceGroup::Side).expect("a box has sides");
        let caps = split_faces(&cube, FaceGroup::Cap).expect("a box has caps");
        assert_eq!(
            tri_count(&sides) + tri_count(&caps),
            whole,
            "triangles lost or doubled"
        );
        // Four upright faces and two horizontal ones, two triangles each.
        assert_eq!(tri_count(&sides), 8);
        assert_eq!(tri_count(&caps), 4);
    }

    /// …and it must partition BY NORMAL, not by vertex index.
    ///
    /// A split that happened to produce 8/4 by slicing the index buffer at the
    /// right offset would pass the test above and put the coursed wall texture
    /// on the floor-facing cap. Assert what each group actually faces.
    #[test]
    fn each_group_holds_only_faces_that_point_its_way() {
        let cube = Mesh::from(Cuboid::new(1.0, WALL_H, 1.0));
        for (group, want_horizontal) in [(FaceGroup::Side, false), (FaceGroup::Cap, true)] {
            let part = split_faces(&cube, group).unwrap();
            let Some(VertexAttributeValues::Float32x3(nrm)) =
                part.attribute(Mesh::ATTRIBUTE_NORMAL)
            else {
                panic!("{group:?} kept its normals");
            };
            for n in nrm {
                assert_eq!(
                    n[1].abs() > 0.5,
                    want_horizontal,
                    "{group:?} holds a face with normal {n:?}"
                );
            }
        }
    }

    /// UVs survive the re-index. Without them the texture is not merely
    /// misplaced — `StandardMaterial` samples at (0,0) and every wall in the
    /// floor becomes one flat colour, which is precisely what V-1 was fixing
    /// and would look like the textures had never landed.
    #[test]
    fn the_split_keeps_its_uvs() {
        let cube = Mesh::from(Cuboid::new(1.0, WALL_H, 1.0));
        for group in [FaceGroup::Side, FaceGroup::Cap] {
            let part = split_faces(&cube, group).unwrap();
            let Some(VertexAttributeValues::Float32x2(uv)) = part.attribute(Mesh::ATTRIBUTE_UV_0)
            else {
                panic!("{group:?} kept its uvs");
            };
            let Some(VertexAttributeValues::Float32x3(pos)) =
                part.attribute(Mesh::ATTRIBUTE_POSITION)
            else {
                panic!("{group:?} kept its positions");
            };
            assert_eq!(uv.len(), pos.len(), "{group:?}: one uv per vertex");
            // A face's texture spans it exactly once (`build.ts:1408` stretches
            // rather than repeats), so the corners must reach both extremes.
            assert!(uv.iter().any(|c| c[0] <= 0.001) && uv.iter().any(|c| c[0] >= 0.999));
        }
    }

    /// Unreferenced vertices must not ride along: a cap is a third of a box's
    /// triangles and would otherwise ship a whole box's vertex buffer.
    #[test]
    fn the_split_drops_the_vertices_it_does_not_draw() {
        let cube = Mesh::from(Cuboid::new(1.0, WALL_H, 1.0));
        let caps = split_faces(&cube, FaceGroup::Cap).unwrap();
        assert_eq!(caps.count_vertices(), 8, "two quads, four corners each");
    }

    fn tri_count(m: &Mesh) -> usize {
        match m.indices() {
            Some(Indices::U32(v)) => v.len() / 3,
            Some(Indices::U16(v)) => v.len() / 3,
            None => m.count_vertices() / 3,
        }
    }

    /// The wash buckets only ever read a WALKABLE tile's byte.
    ///
    /// The regression this pins is silent: a solid tile carrying `WALL_RUBBER`
    /// (1) would be washed as `FLOOR_ICE` (1) — a blue patch on a wall, and the
    /// wrong material named. Built as a grid where every SOLID tile carries the
    /// id of a washed floor surface and no walkable one does, so a reader that
    /// skips the walkability branch produces buckets where the correct one
    /// produces none.
    /// The lowest and highest y in a mesh's positions.
    fn y_bounds(mesh: &Mesh) -> (f32, f32) {
        let VertexAttributeValues::Float32x3(pos) = mesh
            .attribute(Mesh::ATTRIBUTE_POSITION)
            .expect("a mesh has positions")
        else {
            panic!("positions are not Float32x3");
        };
        pos.iter().fold((f32::MAX, f32::MIN), |(lo, hi), p| {
            (lo.min(p[1]), hi.max(p[1]))
        })
    }

    /// ⚠️ A SHAPED RIM STANDS KNEE-HIGH AND SITS ON THE FLOOR.
    ///
    /// Three things have to agree — the mesh height, the placement's Y, and
    /// the rule itself — and two of the three agreeing is a tile sunk into the
    /// floor or floating over it, which reads as a geometry bug rather than a
    /// height one. This pins all three by measuring the mesh's own bounds
    /// against the stamp that positions it.
    ///
    /// The port drew every shaped tile at `WALL_H` until this pass. Counted
    /// over the shipped floors with the renderer's own filters — exposed, and
    /// a slant or round shell (shapes 1-8; shape 9 is the ARC and renders
    /// per-feature) — that is **10 tiles on L1, 8 on L3 and 12 on L5** standing
    /// full-height where the camera-side rim exists so the player can SEE OVER
    /// IT. A small set, and each one is a corner the camera cannot see past.
    #[test]
    fn a_shaped_rim_is_knee_high_and_its_base_sits_on_the_floor() {
        for low in [false, true] {
            let want = if low { WALL_LOW } else { WALL_H };
            assert_eq!(shaped_height(low), want);

            for bucket in [
                Bucket::Slant { shape: 1, low },
                Bucket::Round { shape: 5, low },
            ] {
                // Bounds from the VERTICES, not from a helper — this is the
                // geometry the GPU will actually draw.
                let mesh = bucket_shape(bucket);
                let (lo, hi) = y_bounds(&mesh);
                let h = hi - lo;
                assert!(
                    (h - want).abs() < 1e-4,
                    "{bucket:?} is {h} tall, expected {want}"
                );
                // The stamp lifts it by half its height, so its base lands on
                // y = 0. Anything else is a tile in the floor or in the air.
                let base = want / 2.0 + lo;
                assert!(
                    base.abs() < 1e-4,
                    "{bucket:?} would sit at y={base}, not on the floor"
                );
            }
        }
        // The rim must be SHORTER than a wall or none of this means anything.
        // A const assert rather than a runtime one: both are compile-time
        // constants, so this fails the BUILD rather than a test run.
        const _: () = assert!(WALL_LOW < WALL_H);
    }

    /// …and the plan really does place them there, on a real grid.
    #[test]
    fn the_plan_stamps_shaped_rims_at_the_rim_height() {
        let floor = crate::authored_floor::load(5, 1).expect("a shipped floor");
        let plan = plan_walls(&floor.grid);
        let mut low_seen = 0usize;
        let mut tall_seen = 0usize;
        for (bucket, cells) in &plan.buckets {
            let low = match bucket {
                Bucket::Slant { low, .. } | Bucket::Round { low, .. } => *low,
                _ => continue,
            };
            let want = shaped_height(low) / 2.0;
            for c in cells {
                assert!(
                    (c.pos.y - want).abs() < 1e-4,
                    "{bucket:?} stamped at y={}, expected {want}",
                    c.pos.y
                );
            }
            if low {
                low_seen += cells.len();
            } else {
                tall_seen += cells.len();
            }
        }
        // ⚠️ TWELVE, NOT 147. A first cut of this asserted 147 and failed at
        // 12 — the estimate counted every non-zero shape byte, and shape 9 is
        // the ARC, which renders per-FEATURE and never per-tile. Slants and
        // round shells are shapes 1-8, and L5 carries 12 exposed rims among
        // them. If this hits zero the `low` flag stopped being computed and
        // every shaped rim silently went full-height again.
        assert_eq!(low_seen, 12, "L5's shaped rims went missing");
        assert!(tall_seen > 0, "every shaped tile became a rim");
    }

    /// ⚠️ THE WALL WASH IS A MULTIPLY, AND STONE IS WHITE.
    ///
    /// Two ways to get this wrong, both of which look fine in a byte count:
    /// a stone wall tinted to anything but white would repaint the whole
    /// dungeon, and a non-stone tint that came back white would silently
    /// restore the bug V-2 exists to fix — 618 tiles on L3 that hit differently
    /// than they look.
    #[test]
    fn stone_is_the_identity_tint_and_every_other_surface_is_not() {
        use pk_core::surfaces::{WALL_BRASS, WALL_ICE, WALL_MUD, WALL_RUBBER, WALL_STONE};

        assert_eq!(
            wall_tint(WALL_STONE),
            Color::WHITE,
            "stone must be the identity tint, or every wall in the game is repainted"
        );
        for s in [WALL_RUBBER, WALL_ICE, WALL_MUD, WALL_BRASS] {
            assert_ne!(
                wall_tint(s),
                Color::WHITE,
                "{} came back as the identity tint — it would be invisible",
                pk_core::surfaces::wall_surface(s).label
            );
        }
        // …and the tint is the SURFACE TABLE's own hex, not a second palette
        // invented here. A copy would drift from the physics it describes.
        let rubber = pk_core::surfaces::wall_surface(WALL_RUBBER);
        let want = Color::srgb_u8(
            ((rubber.hex >> 16) & 0xff) as u8,
            ((rubber.hex >> 8) & 0xff) as u8,
            (rubber.hex & 0xff) as u8,
        );
        assert_eq!(wall_tint(WALL_RUBBER), want);

        // An unknown id falls back to stone rather than panicking or going
        // black — `wall_surface` promises that and the renderer runs per frame.
        assert_eq!(wall_tint(200), Color::WHITE);
    }

    /// ⚠️ A WALL'S SURFACE MUST SPLIT THE BUCKET, OR THE MERGE HIDES IT.
    ///
    /// The oracle tints per INSTANCE; a merged mesh has no instance, so the
    /// only place the difference can live is the key. If two surfaces shared a
    /// bucket they would share one material and the rarer one would vanish
    /// into the commoner one's colour.
    #[test]
    fn two_wall_surfaces_never_share_a_bucket() {
        let mut g = Grid::solid(7, 7);
        for k in 1..6 {
            pk_core::grid::set_tile(&mut g, k, 3, pk_core::grid::T_FLOOR);
        }
        // Two solid neighbours of that corridor, different materials, same
        // shape and same rim-ness — so ONLY the surface distinguishes them.
        pk_core::grid::set_surface(&mut g, 2, 2, pk_core::surfaces::WALL_RUBBER);
        pk_core::grid::set_surface(&mut g, 4, 2, pk_core::surfaces::WALL_MUD);

        let plan = plan_walls(&g);
        let surfaces: Vec<u8> = plan
            .buckets
            .keys()
            .filter_map(|b| match b {
                Bucket::Full { surface } | Bucket::Moss { surface } | Bucket::Low { surface } => {
                    Some(*surface)
                }
                _ => None,
            })
            .collect();
        assert!(
            surfaces.contains(&pk_core::surfaces::WALL_RUBBER),
            "the rubber wall never got its own bucket: {surfaces:?}"
        );
        assert!(
            surfaces.contains(&pk_core::surfaces::WALL_MUD),
            "the mud wall never got its own bucket: {surfaces:?}"
        );
    }

    /// ⚠️ THE SHIPPED FLOORS REALLY DO CARRY THESE WALLS — the whole reason
    /// V-2 exists, measured on the data rather than argued.
    ///
    /// In the FILES: L3 carries 455 mud / 89 brass / 74 rubber solid tiles and
    /// L5 carries 375 rubber / 107 brass. Every one of them BOUNCES DIFFERENTLY
    /// (`pk_core::surfaces` drives `collide`), and until this pass every one was
    /// painted as stone — a wall that hits differently than it looks.
    ///
    /// ⚠️ THE PLANNED COUNT IS SMALLER THAN THE FILE COUNT, AND THAT IS
    /// CORRECT. A first cut of this test asserted ≥600 on L3 and failed at 213.
    /// The renderer culls walls with no walkable neighbour (`exposed`) and
    /// skips shaped tiles, so of L3's 618 non-stone walls only 213 are ones a
    /// player can ever see or hit — re-derived independently over the JSON, it
    /// is 213 exactly. Asserting the FILE's number here would have been a
    /// number invented for the test rather than measured from the renderer.
    #[test]
    fn the_shipped_floors_carry_walls_that_are_not_stone() {
        use pk_core::surfaces::WALL_STONE;

        // Exposed, full-shape, non-stone wall tiles — counted over the shipped
        // JSON with the renderer's own two filters.
        for (level, want_min) in [(3, 213), (5, 244)] {
            let floor = crate::authored_floor::load(level, 1).expect("a shipped floor");
            let plan = plan_walls(&floor.grid);
            let painted: usize = plan
                .buckets
                .iter()
                .filter(|(b, _)| {
                    matches!(
                        b,
                        Bucket::Full { surface }
                            | Bucket::Moss { surface }
                            | Bucket::Low { surface }
                        if *surface != WALL_STONE
                    )
                })
                .map(|(_, cells)| cells.len())
                .sum();
            assert_eq!(
                painted, want_min,
                "L{level} planned {painted} non-stone wall tiles, expected {want_min} — the \
                 surface byte is missing, the bucket key stopped splitting on it, or the \
                 cull changed"
            );
        }
    }

    /// A grid with NO surface byte must still plan — every generated floor is
    /// that grid until `surface-paint.ts` is ported, and the fallback is stone
    /// rather than a panic in a per-frame path.
    #[test]
    fn a_grid_with_no_surfaces_plans_every_wall_as_stone() {
        let mut g = Grid::solid(5, 5);
        for k in 1..4 {
            pk_core::grid::set_tile(&mut g, k, 2, pk_core::grid::T_FLOOR);
        }
        g.surfaces = None;
        let plan = plan_walls(&g);
        assert!(
            !plan.buckets.is_empty(),
            "a surfaceless grid planned nothing"
        );
        for b in plan.buckets.keys() {
            if let Bucket::Full { surface } | Bucket::Moss { surface } | Bucket::Low { surface } = b
            {
                assert_eq!(
                    *surface,
                    pk_core::surfaces::WALL_STONE,
                    "a surfaceless grid invented a wall surface"
                );
            }
        }
    }

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
                    Bucket::Low { .. } => {
                        assert!(is_low_wall(&g, i, j), "({i},{j}) is not a rim");
                        low += 1;
                    }
                    Bucket::Moss { .. } => {
                        assert!(!is_low_wall(&g, i, j), "({i},{j}) is a rim, not moss");
                        assert_eq!((i * 7 + j * 13) % 4, 0, "({i},{j}) is off the lattice");
                        moss += 1;
                    }
                    Bucket::Full { .. } => {
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
            plan.batched_entities() <= 8 * FACE_GROUPS,
            "batched to {} entities",
            plan.batched_entities()
        );
        // ⚠️ This factor was 20 while a bucket was one entity. V-1's face split
        // doubles the batched count BY CONSTRUCTION — that is the price of the
        // oracle's two materials per box (coursed sides, dressed cap) under a
        // one-material-per-mesh renderer — so the ratio it can possibly reach
        // halved with it. Lowering the number without saying so would have hid
        // a real regression behind an identical-looking green test, so: 10× is
        // the same claim as the old 20×, restated against the new entity count,
        // and the demo floor is the WORST case in the game for it (625 tiles,
        // five buckets). A real floor is ~194×146.
        assert!(
            s.per_tile_entities() > 10 * plan.batched_entities(),
            "batching must be worth doing even on the demo floor: {} per-tile vs {} batched",
            s.per_tile_entities(),
            plan.batched_entities()
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
            plan.batched_entities() <= 8 * FACE_GROUPS,
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
            plan.batched_entities() <= 8 * FACE_GROUPS,
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
        let shape = bucket_shape(Bucket::Full {
            surface: pk_core::surfaces::WALL_STONE,
        });
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
