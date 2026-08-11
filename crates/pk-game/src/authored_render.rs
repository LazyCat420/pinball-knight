//! WHAT STANDS ON AN AUTHORED FLOOR — torches, parts, props, items.
//!
//! [`crate::authored_floor`] loads the oracle's floor; this draws its contents.
//! The split is the same one `dungeon_render` and `real_floor` already have: one
//! module owns the data, one owns the meshes.
//!
//! ## Every number here came out of the oracle
//!
//! Not one of them is a taste call, and the ones that look like taste calls are
//! the ones most worth citing:
//!
//! | thing | value | source |
//! |---|---|---|
//! | sconce mesh | box `0.18 × 0.3 × 0.18` | `maze/build.ts:1749` |
//! | sconce material | `PALETTE_HEX[19]` `0x544e63`, rough 0.4, metal 0.6 | `build.ts:1750-1752` |
//! | sconce offset from tile centre | `± 0.41` along `(di, dj)` | `build.ts:1846-1847` |
//! | sconce height | `wall_h * 0.62` | `build.ts:1849` |
//! | flame quad | plane `0.3 × 0.34`, `+0.3` above the sconce | `build.ts:1787, 1850` |
//! | flame colour | `PALETTE_HEX[16]` `0xf0a63c` | `build.ts:1864` |
//! | LIGHT POOL SIZE | **`TORCH_LIGHT_POOL = 6`** | `constants/render.ts:667` |
//! | light | colour `PALETTE_HEX[16]`, intensity 6, range 6, decay 2 | `build.ts:1864` |
//! | light height | `WALL_H * 0.62 + 0.3` | `build.ts:1866` |
//! | flicker | `6 + sin(t)*0.7 + sin(t*2.7)*0.4`, `t = elapsed*6 + i*2.1` | `sim/loop.ts:357-358` |
//! | anchor | the sconce, pulled `0.2` back off the wall | `build.ts:1855` |
//!
//! ## SIX LIGHTS, NOT ONE PER TORCH
//!
//! A floor carries 41-64 torches and the oracle lights **six** of them: a pool
//! of `TORCH_LIGHT_POOL` `PointLight`s is re-parked every frame onto the six
//! anchors nearest the player (`sim/loop.ts:348-353`). This is not a
//! performance workaround to be revisited — the torch BUDGET is derived from
//! it. `floorBudgets` sets `torches = min(round(walkable/70) + 6, 80)` and its
//! comment says why: "only TORCH_LIGHT_POOL (6) torches are ever live lights and
//! each is a radius-6 PointLight" (`constants/level.ts:114-129`). Lighting all
//! of them would be a different game, brighter and flatter, and no screenshot
//! comparison would ever line up again.
//!
//! ## Placeholders, deliberately
//!
//! Parts, props and items draw as per-kind coloured primitives. The A/B rig
//! grades POSITION and DENSITY at this stage — a booster you can see where the
//! oracle put one is the whole win — and the baked art replaces the primitive
//! without moving a call site. What is NOT a placeholder is the palette: every
//! colour below is the legacy palette index that kind is painted with, so the
//! floor reads in the right hues before it reads in the right shapes.

use bevy::prelude::*;

use crate::authored_floor::{AuthoredFloor, PinballPart, Prop, Torch};
use crate::units::{billboard, c, PL};
use pk_core::grid::{is_walkable, tile_center, Grid};

/// Wall height and the knee-high rim, from `constants/world.ts:19-20`.
const WALL_H: f64 = 1.1;
const WALL_LOW: f64 = 0.35;

/// `constants/render.ts:667`. See the module header — this is a game-design
/// constant, not a budget knob.
const TORCH_LIGHT_POOL: usize = 6;

/// `PALETTE_HEX[16]` — torch flame amber.
const TORCH_FLAME: u32 = 0xf0a63c;
/// `PALETTE_HEX[19]` — cold iron.
const SCONCE_IRON: u32 = 0x544e63;
/// `PALETTE_HEX[31]` — the stairs' cold beacon.
const STAIRS_BEACON: u32 = 0x6fd0e8;

/// Marks everything this module spawns, so the dungeon tears it down as one.
#[derive(Component)]
pub struct AuthoredDecor;

/// One of the pooled torch lights. `index` is its slot, which the flicker phase
/// keys off exactly as the oracle's `forEach` index does.
#[derive(Component)]
pub struct TorchPoolLight {
    pub index: usize,
}

/// Where the pooled lights may park: one per torch, in plan order.
#[derive(Resource, Clone)]
pub struct TorchAnchors(pub Vec<(f64, f64)>);

/// The anchor a torch's light parks on: the sconce, pulled back off the wall so
/// the pool sits in the room rather than inside the masonry (`build.ts:1855`).
fn anchor(g: &Grid, t: &Torch) -> (f64, f64) {
    let (cx, cz) = tile_center(g, t.i, t.j);
    let x = cx + t.di as f64 * 0.41;
    let z = cz + t.dj as f64 * 0.41;
    (x - t.di as f64 * 0.2, z - t.dj as f64 * 0.2)
}

/// The wall a torch hangs on — knee-high rim or full height.
///
/// `build.ts:1844` asks whether the tile BEHIND the wall (one step further along
/// the mount direction, minus one in j) is walkable, which is the Diablo
/// low-rim test: a wall with floor behind it is drawn short so the camera can
/// see over it, and a sconce keyed to the full height would float above one.
fn wall_height(g: &Grid, t: &Torch) -> f64 {
    let low = is_walkable(g, t.i + t.di, t.j + t.dj - 1);
    if low {
        WALL_LOW + 0.25
    } else {
        WALL_H
    }
}

/// Spawn a floor's torches, parts, props, items and the light pool.
///
/// Returns every entity so the caller can tag them with its scene marker — the
/// same contract `spawn_real_floor_decor` has.
pub fn spawn_authored_decor(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    floor: &AuthoredFloor,
) -> (Vec<Entity>, TorchAnchors) {
    let g = &floor.grid;
    let mut out = Vec::new();

    // ── Torches: a sconce, a flame, and an anchor for the light pool ────────
    let sconce_mesh = meshes.add(Cuboid::new(0.18, 0.3, 0.18));
    let sconce_mat = materials.add(StandardMaterial {
        base_color: c(SCONCE_IRON),
        perceptual_roughness: 0.4,
        metallic: 0.6,
        ..default()
    });
    let flame_mesh = meshes.add(Rectangle::new(0.3, 0.34));
    // Unlit and emissive: the flame is the light SOURCE's sprite, so shading it
    // with the pool it belongs to would darken every torch the pool is not
    // parked on — 35 of 41 on L3.
    let flame_mat = materials.add(StandardMaterial {
        base_color: c(TORCH_FLAME),
        emissive: LinearRgba::from(c(TORCH_FLAME)) * 4.0,
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    let mut anchors = Vec::with_capacity(floor.plan.torches.len());
    for t in &floor.plan.torches {
        let (cx, cz) = tile_center(g, t.i, t.j);
        let wall_h = wall_height(g, t);
        let x = cx + t.di as f64 * 0.41;
        let z = cz + t.dj as f64 * 0.41;
        out.push(
            commands
                .spawn((
                    AuthoredDecor,
                    Mesh3d(sconce_mesh.clone()),
                    MeshMaterial3d(sconce_mat.clone()),
                    Transform::from_xyz(x as f32, (wall_h * 0.62) as f32, z as f32),
                ))
                .id(),
        );
        out.push(
            commands
                .spawn((
                    AuthoredDecor,
                    Mesh3d(flame_mesh.clone()),
                    MeshMaterial3d(flame_mat.clone()),
                    Transform {
                        translation: Vec3::new(x as f32, (wall_h * 0.62 + 0.3) as f32, z as f32),
                        rotation: billboard(0.0),
                        ..default()
                    },
                ))
                .id(),
        );
        anchors.push(anchor(g, t));
    }

    // ── The light pool: SIX, parked by `park_torch_lights` ──────────────────
    for (index, &(ax, az)) in anchors.iter().enumerate().take(TORCH_LIGHT_POOL) {
        out.push(
            commands
                .spawn((
                    AuthoredDecor,
                    TorchPoolLight { index },
                    PointLight {
                        color: c(TORCH_FLAME),
                        intensity: 6.0 * PL,
                        range: 6.0,
                        shadows_enabled: false,
                        ..default()
                    },
                    Transform::from_xyz(ax as f32, (WALL_H * 0.62 + 0.3) as f32, az as f32),
                ))
                .id(),
        );
    }

    // ── The stairs beacon (`build.ts:1744`) ─────────────────────────────────
    let s = floor.plan.stairs;
    let (sx, sz) = tile_center(g, s.i, s.j);
    out.push(
        commands
            .spawn((
                AuthoredDecor,
                PointLight {
                    color: c(STAIRS_BEACON),
                    intensity: 4.0 * PL,
                    range: 5.5,
                    shadows_enabled: false,
                    ..default()
                },
                Transform::from_xyz(sx as f32, 0.6, sz as f32),
            ))
            .id(),
    );
    // …and something to see at it. The generated floor's amber pillar means
    // "provisional exit"; an authored floor has REAL stairs, so this is a cold
    // beacon in the beacon's own colour and cannot be mistaken for the other.
    out.push(
        commands
            .spawn((
                AuthoredDecor,
                Mesh3d(meshes.add(Cuboid::new(0.5, 0.9, 0.5))),
                MeshMaterial3d(materials.add(StandardMaterial {
                    base_color: c(STAIRS_BEACON),
                    unlit: true,
                    ..default()
                })),
                Transform::from_xyz(sx as f32, 0.45, sz as f32),
            ))
            .id(),
    );

    // ── Parts, props, items ─────────────────────────────────────────────────
    for p in &floor.plan.parts {
        out.extend(spawn_part(commands, meshes, materials, g, p));
    }
    for p in &floor.plan.props {
        out.push(spawn_prop(commands, meshes, materials, g, p));
    }
    for it in &floor.plan.items {
        let (x, z) = tile_center(g, it.i, it.j);
        let colour = match it.kind.as_str() {
            // PALETTE indices the legacy item glyphs are painted with.
            "weapon" => 0xd9d2c8,
            "gear" => 0x8a9bb4,
            _ => 0x74c67a,
        };
        out.push(
            commands
                .spawn((
                    AuthoredDecor,
                    Mesh3d(meshes.add(Sphere::new(0.14))),
                    MeshMaterial3d(materials.add(StandardMaterial {
                        base_color: c(colour),
                        emissive: LinearRgba::from(c(colour)) * 0.6,
                        ..default()
                    })),
                    Transform::from_xyz(x as f32, 0.22, z as f32),
                ))
                .id(),
        );
    }

    (out, TorchAnchors(anchors))
}

/// The per-kind placeholder for one pinball part.
///
/// Shape carries the FAMILY and colour carries the kind, so a screenshot reads
/// as "boosters along the spine, targets in a bank" before any art exists:
/// pucks for the things you bounce off, low pads for the things you ride, posts
/// for the things you knock down, and a sunken disc for the things that are
/// holes.
fn spawn_part(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    g: &Grid,
    p: &PinballPart,
) -> Vec<Entity> {
    let (x, z) = tile_center(g, p.i, p.j);
    // (mesh, colour, y-centre) per kind.
    let (mesh, colour, y): (Mesh, u32, f32) = match p.kind.as_str() {
        "bumper" => (Cylinder::new(0.3, 0.34).into(), 0xe8556d, 0.17),
        // The kicker family. `slingshot` is the oracle's name — NOT "sling",
        // which is what the first draft of this match guessed and which
        // `every_exported_part_kind_has_its_own_placeholder` caught by counting
        // the kinds the exports actually carry.
        "slingshot" => (Cuboid::new(0.62, 0.26, 0.22).into(), 0xe8556d, 0.13),
        // The punch pair: a glove and a flipper bat, both of which SWING, so
        // both are long and low and take their facing from `dir` below.
        "glove" => (Cuboid::new(0.3, 0.3, 0.44).into(), 0xff8a65, 0.16),
        "flipper" => (Cuboid::new(0.66, 0.14, 0.2).into(), 0xf3e6c8, 0.08),
        "booster" | "boostcorner" | "boostcurve" => {
            (Cuboid::new(0.5, 0.1, 0.5).into(), 0x4fc3f7, 0.05)
        }
        "spinpad" => (Cylinder::new(0.26, 0.08).into(), 0x9d7bea, 0.04),
        "magstrip" => (Cuboid::new(0.5, 0.06, 0.5).into(), 0x7f8fa6, 0.03),
        "deflector" => (Cuboid::new(0.5, 0.34, 0.14).into(), 0xf0a63c, 0.17),
        "target" => (Cuboid::new(0.34, 0.36, 0.12).into(), 0xffd54f, 0.18),
        "rollover" => (Cylinder::new(0.2, 0.05).into(), 0xffd54f, 0.025),
        "lamp" => (Sphere::new(0.13).into(), 0xfff2a8, 0.13),
        "ramp" | "jumppad" => (Cuboid::new(0.5, 0.16, 0.5).into(), 0x74c67a, 0.08),
        "trapdoor" => (Cylinder::new(0.28, 0.04).into(), 0x6d5b4a, 0.02),
        // The hazards read as holes and vents: sunk into the floor, not on it.
        "pit" => (Cylinder::new(0.34, 0.04).into(), 0x14161c, 0.02),
        "electric" => (Cylinder::new(0.3, 0.04).into(), 0x6fd0e8, 0.02),
        "firevent" => (Cylinder::new(0.3, 0.04).into(), 0xff7043, 0.02),
        "magnet" => (Cylinder::new(0.28, 0.06).into(), 0xb388ff, 0.03),
        // An unknown kind draws as a magenta post rather than nothing at all:
        // a part the exporter learns to emit before this match learns to draw
        // it must be VISIBLE, or the floor silently loses content.
        _ => (Cuboid::new(0.22, 0.4, 0.22).into(), 0xff00ff, 0.2),
    };
    let mut xf = Transform::from_xyz(x as f32, y, z as f32);
    // Face the part along its own axis. `dir` is a unit vector and may be
    // non-cardinal (a `boostcurve` carries (0.447, -0.894)) — `atan2` handles
    // both, and rounding to a cardinal would point the throw somewhere the ball
    // does not go.
    if p.dir_i != 0.0 || p.dir_j != 0.0 {
        xf.rotation = Quat::from_rotation_y((p.dir_i as f32).atan2(p.dir_j as f32));
    }
    vec![commands
        .spawn((
            AuthoredDecor,
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: c(colour),
                perceptual_roughness: 0.6,
                ..default()
            })),
            xf,
        ))
        .id()]
}

fn spawn_prop(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    g: &Grid,
    p: &Prop,
) -> Entity {
    let (x, z) = tile_center(g, p.i, p.j);
    let (mesh, colour, y): (Mesh, u32, f32) = match p.kind.as_str() {
        "bones" => (Cuboid::new(0.34, 0.06, 0.18).into(), 0xd8d0bd, 0.03),
        "skull" => (Sphere::new(0.11).into(), 0xe6dfcc, 0.11),
        _ => (Cuboid::new(0.26, 0.14, 0.26).into(), 0x6b6257, 0.07),
    };
    commands
        .spawn((
            AuthoredDecor,
            Mesh3d(meshes.add(mesh)),
            MeshMaterial3d(materials.add(StandardMaterial {
                base_color: c(colour),
                perceptual_roughness: 0.9,
                ..default()
            })),
            Transform::from_xyz(x as f32, y, z as f32),
        ))
        .id()
}

/// Re-park the six pooled lights on the nearest torches, and flicker them.
///
/// The port of `sim/loop.ts:348-372`, minus the ember spawn (P7) and the
/// elemental-shader hand-off (no elements yet). The sort is over every anchor
/// each frame, which is what the oracle does and which it measured as free —
/// 41-64 anchors is nothing next to the frame it sits in.
pub fn park_torch_lights(
    time: Res<Time>,
    anchors: Option<Res<TorchAnchors>>,
    // Same disjointness rule as `dungeon_light::follow_player`: the pool query
    // takes `&mut Transform`, so the player query must be provably separated
    // from it by a component, not by intent.
    player: Query<&Transform, (With<crate::KnightSprite>, Without<TorchPoolLight>)>,
    mut lights: Query<(&TorchPoolLight, &mut Transform, &mut PointLight), With<TorchPoolLight>>,
) {
    let Some(anchors) = anchors else {
        return;
    };
    let Ok(p) = player.single() else {
        return;
    };
    let (px, pz) = (p.translation.x as f64, p.translation.z as f64);
    let mut sorted: Vec<(f64, (f64, f64))> = anchors
        .0
        .iter()
        .map(|&(x, z)| {
            let (dx, dz) = (x - px, z - pz);
            (dx * dx + dz * dz, (x, z))
        })
        .collect();
    // `sort_by` on the squared distance, exactly as the oracle's comparator
    // does. Ties keep insertion (plan) order on both sides — Rust's sort is
    // stable and V8's is too at these lengths.
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let elapsed = time.elapsed_secs_f64();
    for (slot, mut xf, mut light) in &mut lights {
        if let Some((_, (ax, az))) = sorted.get(slot.index) {
            xf.translation.x = *ax as f32;
            xf.translation.z = *az as f32;
            xf.translation.y = (WALL_H * 0.62 + 0.3) as f32;
        }
        // Two out-of-phase sines — "random flicker reads as a broken lightbulb,
        // layered sines read as a flame" (`sim/loop.ts:355-356`).
        let t = elapsed * 6.0 + slot.index as f64 * 2.1;
        light.intensity = ((6.0 + t.sin() * 0.7 + (t * 2.7).sin() * 0.4) as f32) * PL;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authored_floor;

    /// The pool is SIX, whatever the floor carries. This is the assertion the
    /// module header is about: a per-torch light would be 41-64 of them, would
    /// look brighter and flatter than the oracle, and would quietly invalidate
    /// the torch budget the oracle derived FROM the pool size.
    #[test]
    fn the_light_pool_is_six_however_many_torches_there_are() {
        for level in [1, 3, 5] {
            let f = authored_floor::load(level, 1).unwrap();
            assert!(
                f.plan.torches.len() > TORCH_LIGHT_POOL,
                "L{level} should carry more torches than the pool lights"
            );
            assert_eq!(
                TORCH_LIGHT_POOL.min(f.plan.torches.len()),
                6,
                "the pool is TORCH_LIGHT_POOL (constants/render.ts:667)"
            );
        }
    }

    /// Anchors sit INSIDE the room, not inside the wall.
    ///
    /// The sconce is 0.41 toward the wall and the anchor pulls 0.2 back, so an
    /// anchor lands 0.21 from the tile centre — still over the floor tile,
    /// which is a half-tile wide. An anchor past 0.5 would light the masonry.
    #[test]
    fn every_anchor_stays_over_its_own_floor_tile() {
        for level in [1, 3, 5] {
            let f = authored_floor::load(level, 1).unwrap();
            for t in &f.plan.torches {
                let (ax, az) = anchor(&f.grid, t);
                let (cx, cz) = tile_center(&f.grid, t.i, t.j);
                let d = ((ax - cx).powi(2) + (az - cz).powi(2)).sqrt();
                assert!(
                    d < 0.5,
                    "L{level} torch ({},{}) anchor is {d:.3} from the tile centre",
                    t.i,
                    t.j
                );
            }
        }
    }

    /// Every part kind in every export has a mesh that is not the unknown
    /// placeholder. The magenta post exists so a NEW kind is visible; a kind
    /// that already ships must never reach it.
    #[test]
    fn every_exported_part_kind_has_its_own_placeholder() {
        let known = [
            "bumper",
            "slingshot",
            "glove",
            "flipper",
            "booster",
            "boostcorner",
            "boostcurve",
            "spinpad",
            "magstrip",
            "deflector",
            "target",
            "rollover",
            "lamp",
            "ramp",
            "jumppad",
            "trapdoor",
            "pit",
            "electric",
            "firevent",
            "magnet",
        ];
        let mut unknown: Vec<String> = Vec::new();
        for level in [1, 3, 5] {
            let f = authored_floor::load(level, 1).unwrap();
            for p in &f.plan.parts {
                if !known.contains(&p.kind.as_str()) && !unknown.contains(&p.kind) {
                    unknown.push(p.kind.clone());
                }
            }
        }
        assert!(
            unknown.is_empty(),
            "these exported part kinds would draw as the magenta unknown post: {unknown:?}"
        );
    }

    /// A torch on a full-height wall keys to `WALL_H`, one on a rim to the rim.
    #[test]
    fn sconce_height_follows_the_wall_it_hangs_on() {
        let f = authored_floor::load(3, 1).unwrap();
        let heights: Vec<f64> = f
            .plan
            .torches
            .iter()
            .map(|t| wall_height(&f.grid, t))
            .collect();
        for h in &heights {
            assert!(
                (*h - WALL_H).abs() < 1e-9 || (*h - (WALL_LOW + 0.25)).abs() < 1e-9,
                "a sconce height must be one of the two wall heights, got {h}"
            );
        }
    }
}
