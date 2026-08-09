//! Pinball Knight — the Bevy shell (vertical slice).
//!
//! Sim-as-a-resource: `pk_core::simulate` steps in `FixedUpdate` at 60 Hz;
//! everything Bevy-side is a view synced from it with overstep interpolation.
//! The slice renders the demo floor (border walls, pillar field), the knight
//! billboard animated from the real published sheets (embedded), the 38°/45°
//! orthographic camera, and WASD/arrow movement through the ported collision.

use bevy::asset::RenderAssetUsages;
use bevy::camera::ScalingMode;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::image::{Image, ImageSampler};
use bevy::math::Affine2;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use pk_assets::published::SheetManifest;
use pk_core::grid::{is_low_wall, is_walkable, tile_center};
use pk_core::state::{demo_floor, simulate, Facing, FrameInput, SimState};

/// legacy constants/world.ts
const WALL_H: f32 = 1.1;
const WALL_LOW: f32 = 0.35;
/// legacy engine/config.ts camera defaults.
const CAM_TILT: f32 = 38.0 * std::f32::consts::PI / 180.0;
const CAM_YAW: f32 = 45.0 * std::f32::consts::PI / 180.0;
const CAM_DIST: f32 = 40.0;
const VIEW_H: f32 = 11.25;

/// The published knight sheets, embedded so native and wasm load identically.
/// The bake pipeline (M0 exit) replaces embedding with per-rung atlases.
const SHEET_S_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/pinball_knight-S.png");
const SHEET_S_JSON: &str = include_str!("../../../legacy/public/sprites/pinball_knight-S.json");
const SHEET_E_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/pinball_knight-E.png");
const SHEET_E_JSON: &str = include_str!("../../../legacy/public/sprites/pinball_knight-E.json");
const SHEET_N_PNG: &[u8] = include_bytes!("../../../legacy/public/sprites/pinball_knight-N.png");
const SHEET_N_JSON: &str = include_str!("../../../legacy/public/sprites/pinball_knight-N.json");

#[derive(Resource)]
struct Sim(SimState);

/// Buffered input intent, drained by the sim each fixed tick.
#[derive(Resource, Default)]
struct Intent(FrameInput);

/// Last two sim positions, for overstep interpolation in `Update`.
#[derive(Resource)]
struct RenderPos {
    prev: (f64, f64),
    curr: (f64, f64),
}

/// One authored direction's clips: sheet texture + per-clip cell rects (in UV
/// space) on it, plus the world-space quad aspect of a cell.
struct SheetClips {
    material: Handle<StandardMaterial>,
    idle: Vec<[f32; 4]>, // [u, v, uw, vh]
    walk: Vec<[f32; 4]>,
    aspect: f32, // cell w / h
}

#[derive(Resource)]
struct KnightArt {
    s: SheetClips,
    e: SheetClips,
    n: SheetClips,
}

#[derive(Component)]
struct KnightSprite;

#[derive(Component)]
struct DungeonCamera;

fn main() {
    let mut app = App::new();
    app.add_plugins(DefaultPlugins.set(WindowPlugin {
        primary_window: Some(Window {
            title: "Pinball Knight (Rust slice)".into(),
            ..default()
        }),
        ..default()
    }))
    .insert_resource(ClearColor(Color::srgb(0.04, 0.04, 0.07)))
    .insert_resource(Time::<Fixed>::from_hz(60.0))
    .init_resource::<Intent>()
    .add_systems(Startup, setup)
    .add_systems(Update, gather_input)
    .add_systems(FixedUpdate, step_sim)
    .add_systems(Update, (sync_knight, follow_camera).after(gather_input));
    #[cfg(target_arch = "wasm32")]
    app.add_systems(Update, publish_stats);
    app.run();
}

/// `window.__pk` — the sim's externally readable pulse, and the seed of the
/// legacy `__lab()` debug surface. `scripts/pk-check.mjs` polls it to verify
/// from OUTSIDE the app that the sim ticks at 60 Hz and that input moves the
/// knight. Grows fields as subsystems port; keep it cheap.
#[cfg(target_arch = "wasm32")]
fn publish_stats(sim: Res<Sim>) {
    if sim.0.tick % 10 != 0 {
        return;
    }
    let p = &sim.0.player;
    let json = format!(
        r#"{{"tick":{},"x":{},"z":{},"facing":"{:?}","moving":{}}}"#,
        sim.0.tick, p.x, p.z, p.facing, p.moving
    );
    let _ = js_sys::Reflect::set(
        &js_sys::global(),
        &wasm_bindgen::JsValue::from_str("__pk"),
        &wasm_bindgen::JsValue::from_str(&json),
    );
}

fn decode_sheet(
    png: &[u8],
    json: &str,
    images: &mut Assets<Image>,
    materials: &mut Assets<StandardMaterial>,
) -> SheetClips {
    let decoded = image::load_from_memory(png)
        .expect("embedded sheet decodes")
        .to_rgba8();
    // The published sheets are high-res masters (~3256×4520, ~59 MB decoded).
    // Uploading three of those exhausts SwiftShader's mappable budget and is
    // waste on any GPU — quarter them at load (nearest). The per-rung bake (M0 exit)
    // replaces this with properly crushed atlases; until then nearest keeps
    // the pixel-art edges.
    let decoded = if decoded.width() > 1600 {
        image::imageops::resize(
            &decoded,
            decoded.width() / 4,
            decoded.height() / 4,
            image::imageops::FilterType::Nearest,
        )
    } else {
        decoded
    };
    let (w, h) = decoded.dimensions();
    let mut img = Image::new(
        Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        decoded.into_raw(),
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );
    img.sampler = ImageSampler::nearest(); // pixel art stays crisp
    let tex = images.add(img);

    let m: SheetManifest = serde_json::from_str(json).expect("embedded manifest parses");
    let (sw, sh) = (m.source[0] as f32, m.source[1] as f32);
    let uv_cells = |clip: &str| -> Vec<[f32; 4]> {
        m.rows
            .iter()
            .filter(|r| r.clip == clip)
            .flat_map(|r| r.cells.iter())
            .map(|c| {
                let [x0, y0, x1, y1] = *c;
                [
                    x0 as f32 / sw,
                    y0 as f32 / sh,
                    (x1 - x0) as f32 / sw,
                    (y1 - y0) as f32 / sh,
                ]
            })
            .collect()
    };
    let idle = uv_cells("idle");
    let walk = uv_cells("walk");
    let first = idle
        .first()
        .or_else(|| walk.first())
        .expect("sheet has idle or walk cells");
    let aspect = (first[2] * sw) / (first[3] * sh);

    let material = materials.add(StandardMaterial {
        base_color_texture: Some(tex),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        cull_mode: None, // readable when mirrored for W
        ..default()
    });
    SheetClips {
        material,
        idle,
        walk,
        aspect,
    }
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
) {
    // ── Sim ──
    let (grid, spawn) = demo_floor(7);
    let sim = SimState::new(grid, spawn, 7);
    commands.insert_resource(RenderPos {
        prev: spawn,
        curr: spawn,
    });

    // ── Floor plane ──
    let (gw, gh) = (sim.grid.w as f32, sim.grid.h as f32);
    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(gw, gh))),
        MeshMaterial3d(materials.add(StandardMaterial {
            base_color: Color::srgb(0.13, 0.11, 0.10),
            unlit: true,
            ..default()
        })),
        Transform::from_xyz(0.0, 0.0, 0.0),
    ));

    // ── Walls: full-height stone, knee-high camera-side rims (the Diablo rule)
    let wall_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.34, 0.32, 0.30),
        unlit: true,
        ..default()
    });
    let low_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.24, 0.22, 0.21),
        unlit: true,
        ..default()
    });
    let wall_mesh = meshes.add(Cuboid::new(1.0, WALL_H, 1.0));
    let low_mesh = meshes.add(Cuboid::new(1.0, WALL_LOW, 1.0));
    for j in 0..sim.grid.h {
        for i in 0..sim.grid.w {
            if is_walkable(&sim.grid, i, j) {
                continue;
            }
            let (x, z) = tile_center(&sim.grid, i, j);
            let low = is_low_wall(&sim.grid, i, j);
            let (mesh, mat, hh) = if low {
                (low_mesh.clone(), low_mat.clone(), WALL_LOW / 2.0)
            } else {
                (wall_mesh.clone(), wall_mat.clone(), WALL_H / 2.0)
            };
            commands.spawn((
                Mesh3d(mesh),
                MeshMaterial3d(mat),
                Transform::from_xyz(x as f32, hh, z as f32),
            ));
        }
    }

    // ── Knight billboard from the real published sheets ──
    let art = KnightArt {
        s: decode_sheet(SHEET_S_PNG, SHEET_S_JSON, &mut images, &mut materials),
        e: decode_sheet(SHEET_E_PNG, SHEET_E_JSON, &mut images, &mut materials),
        n: decode_sheet(SHEET_N_PNG, SHEET_N_JSON, &mut images, &mut materials),
    };
    let quad_h = 1.15f32;
    let quad_w = quad_h * art.s.aspect;
    commands.spawn((
        KnightSprite,
        Mesh3d(meshes.add(Rectangle::new(quad_w, quad_h))),
        MeshMaterial3d(art.s.material.clone()),
        Transform::from_xyz(spawn.0 as f32, quad_h / 2.0, spawn.1 as f32),
    ));
    commands.insert_resource(art);
    commands.insert_resource(Sim(sim));

    // ── Camera: orthographic, tilt 38°, yaw 45°, 11.25 world-units tall ──
    commands.spawn((
        DungeonCamera,
        Camera3d::default(),
        Tonemapping::None,
        Projection::Orthographic(OrthographicProjection {
            scaling_mode: ScalingMode::FixedVertical {
                viewport_height: VIEW_H,
            },
            ..OrthographicProjection::default_3d()
        }),
        Transform::from_translation(camera_offset()).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}

/// The camera's offset from whatever it's looking at — legacy cameraOffset().
fn camera_offset() -> Vec3 {
    let horiz = CAM_TILT.cos() * CAM_DIST;
    Vec3::new(
        CAM_YAW.sin() * horiz,
        CAM_TILT.sin() * CAM_DIST,
        CAM_YAW.cos() * horiz,
    )
}

fn gather_input(keys: Res<ButtonInput<KeyCode>>, mut intent: ResMut<Intent>) {
    let mut x = 0.0;
    let mut z = 0.0;
    // Screen-relative on the 45° yaw: up on the stick is up on screen, which
    // is the world diagonal the camera looks along.
    if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        x -= 1.0;
        z -= 1.0;
    }
    if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        x += 1.0;
        z += 1.0;
    }
    if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
        x -= 1.0;
        z += 1.0;
    }
    if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
        x += 1.0;
        z -= 1.0;
    }
    intent.0 = FrameInput {
        move_x: x,
        move_z: z,
    };
}

fn step_sim(mut sim: ResMut<Sim>, intent: Res<Intent>, mut rp: ResMut<RenderPos>) {
    rp.prev = (sim.0.player.x, sim.0.player.z);
    simulate(&mut sim.0, &intent.0);
    rp.curr = (sim.0.player.x, sim.0.player.z);
}

fn sync_knight(
    time: Res<Time<Fixed>>,
    sim: Res<Sim>,
    art: Res<KnightArt>,
    rp: Res<RenderPos>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut q: Query<(&mut Transform, &mut MeshMaterial3d<StandardMaterial>), With<KnightSprite>>,
    cam: Query<&Transform, (With<DungeonCamera>, Without<KnightSprite>)>,
) {
    let Ok((mut tf, mut mat)) = q.single_mut() else {
        return;
    };
    let a = time.overstep_fraction() as f64;
    let x = rp.prev.0 + (rp.curr.0 - rp.prev.0) * a;
    let z = rp.prev.1 + (rp.curr.1 - rp.prev.1) * a;
    tf.translation.x = x as f32;
    tf.translation.z = z as f32;

    // Billboard: face the camera plane; mirror for the never-authored W.
    if let Ok(cam_tf) = cam.single() {
        tf.rotation = cam_tf.rotation;
    }
    let mirror = sim.0.player.facing == Facing::W;
    tf.scale.x = if mirror { -1.0 } else { 1.0 };

    let clips = match sim.0.player.facing {
        Facing::S => &art.s,
        Facing::N => &art.n,
        Facing::E | Facing::W => &art.e,
    };
    mat.0 = clips.material.clone();

    // 8 fps walk, 4 fps idle — slice timing; real clip timing ports in M2.
    let cells = if sim.0.player.moving {
        &clips.walk
    } else {
        &clips.idle
    };
    if cells.is_empty() {
        return;
    }
    let fps = if sim.0.player.moving { 8 } else { 4 };
    let frame = (sim.0.tick * fps / 60) as usize % cells.len();
    let [u, v, uw, vh] = cells[frame];
    if let Some(m) = materials.get_mut(&clips.material) {
        m.uv_transform = Affine2 {
            matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
            translation: Vec2::new(u, v),
        };
    }
}

fn follow_camera(
    rp: Res<RenderPos>,
    time: Res<Time<Fixed>>,
    mut cam: Query<&mut Transform, With<DungeonCamera>>,
) {
    let Ok(mut tf) = cam.single_mut() else { return };
    let a = time.overstep_fraction() as f64;
    let x = (rp.prev.0 + (rp.curr.0 - rp.prev.0) * a) as f32;
    let z = (rp.prev.1 + (rp.curr.1 - rp.prev.1) * a) as f32;
    let target = Vec3::new(x, 0.0, z);
    tf.translation = target + camera_offset();
    tf.look_at(target, Vec3::Y);
}
