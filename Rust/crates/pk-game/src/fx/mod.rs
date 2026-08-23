//! ✨ PARTICLES — the tavern's embers, motes and sparks.
//!
//! Port of `legacy/src/game/pinball-knight/fx/pools/particle-pool.ts`: a CPU
//! ring-buffer pool whose live slots are uploaded to one instanced additive
//! material each frame. The tavern spawns exactly three kinds; the same pool
//! serves the dungeon when its FX land.
//!
//! THE SHAPE:
//!   [`pool`]       the simulation — SoA ring buffer, the integrator, the three
//!                  spawners, and a local LCG that never touches the sim's
//!                  Mulberry32.
//!   [`tavern_fx`]  the 0.14 s ambient cadence and the [`SparkBurst`] inbox.
//!   [`material`]   the storage-buffer material and its dummy mesh.
//!   `particles.wgsl`  the billboard expansion and the additive fragment.
//!
//! ONE ENTITY, ONE DRAW, ONE UPLOAD. The pool is CPU-side because the oracle's
//! is, and because the spark spawner's rotation-by-a-random-spread is trivially
//! cheap at these counts — a compute pass would buy nothing and cost the
//! determinism-free simplicity of a plain `for` loop.
//!
//! WHY NOT `bevy_hanabi`: `docs/src/game/architecture.md` picks hand-written
//! WGSL with storage-buffer instancing for exactly this, so the effect
//! constants stay readable next to the oracle they were copied from.
//!
//! PORTS: `fx/pools/particle-pool.ts`

use bevy::asset::embedded_asset;
use bevy::camera::visibility::NoFrustumCulling;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy::render::storage::ShaderStorageBuffer;

pub mod material;
pub mod pool;
pub mod tavern_fx;

use crate::post::sizing::PPU;
use crate::AppState;
use material::{particle_mesh, ParticleInstance, ParticleMaterial};
pub use pool::Particles;
use pool::{CAP, MAX_DT};
pub use tavern_fx::SparkBurst;

/// Handles for the single entity everything renders through.
#[derive(Resource, Debug)]
pub struct ParticleRender {
    pub material: Handle<ParticleMaterial>,
    pub buffer: Handle<ShaderStorageBuffer>,
}

/// Wires the pool, the spawners and the upload.
pub struct FxPlugin;

impl Plugin for FxPlugin {
    fn build(&self, app: &mut App) {
        // The repo has no `assets/` wiring for wasm, so the shader travels in
        // the binary. Resolves to `material::PARTICLE_SHADER`.
        embedded_asset!(app, "particles.wgsl");

        app.add_plugins(MaterialPlugin::<ParticleMaterial>::default())
            .init_resource::<Particles>()
            .init_resource::<tavern_fx::AmbientTimer>()
            .init_resource::<tavern_fx::DungeonAmbientTimer>()
            .add_message::<SparkBurst>()
            .add_systems(Startup, setup_particle_render)
            .add_systems(
                Update,
                (
                    tavern_fx::tavern_ambient.run_if(in_state(AppState::Tavern)),
                    tavern_fx::dungeon_ambient.run_if(in_state(AppState::Dungeon)),
                    tavern_fx::drain_spark_bursts,
                    step_pool,
                    upload_pool,
                )
                    .chain(),
            )
            .add_systems(OnExit(AppState::Tavern), tavern_fx::clear_on_exit)
            .add_systems(OnExit(AppState::Dungeon), tavern_fx::clear_on_exit);
    }
}

/// The one entity: a `6 * CAP`-vertex dummy mesh and the additive material.
///
/// It lives for the whole process rather than per scene. An empty pool renders
/// every slot at size 0, i.e. `CAP` degenerate quads that rasterise nothing —
/// cheaper than spawning and despawning the entity across state changes, and it
/// means a spark raised on the first frame of a scene has somewhere to land.
fn setup_particle_render(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<ParticleMaterial>>,
    mut buffers: ResMut<Assets<ShaderStorageBuffer>>,
) {
    let buffer = buffers.add(ShaderStorageBuffer::from(vec![
        ParticleInstance::default();
        CAP
    ]));
    let material = materials.add(ParticleMaterial {
        particles: buffer.clone(),
    });

    commands.spawn((
        Name::new("particles"),
        Mesh3d(meshes.add(particle_mesh(CAP))),
        MeshMaterial3d(material.clone()),
        Transform::IDENTITY,
        // Particle positions are absolute world coordinates, so the mesh's own
        // (all-zero) vertices give it a point-sized Aabb at the origin. Without
        // this the whole draw is culled the moment the camera looks away from
        // 0,0,0 — the legacy pool sets `points.frustumCulled = false` for the
        // same reason.
        NoFrustumCulling,
        // Nothing here should darken the room; the shadow pass would also be
        // rendering the degenerate dummy geometry, which is pure waste.
        NotShadowCaster,
    ));

    commands.insert_resource(ParticleRender { material, buffer });
}

/// One integration step for every live slot.
fn step_pool(time: Res<Time>, mut fx: ResMut<Particles>) {
    let dt = time.delta_secs().min(MAX_DT);
    fx.pool.update(dt);
}

/// Copies the pool into the storage buffer.
///
/// Every slot goes up, live or not: a dead one carries size 0 and costs the
/// GPU a degenerate triangle pair, which is cheaper than the CPU compaction
/// pass that would be needed to send a dense prefix.
///
/// PIXELS → WORLD happens here, once. The pool's `size` is calibrated in
/// RENDER-TARGET pixels (the units the oracle's `gl_PointSize` used), and the
/// orthographic camera maps one world unit to [`PPU`] of them. Doing the divide
/// on the CPU keeps the shader ignorant of the camera zoom.
fn upload_pool(
    fx: Res<Particles>,
    handles: Res<ParticleRender>,
    mut buffers: ResMut<Assets<ShaderStorageBuffer>>,
    mut materials: ResMut<Assets<ParticleMaterial>>,
) {
    let Some(buffer) = buffers.get_mut(&handles.buffer) else {
        return;
    };

    let p = &fx.pool;
    let mut data = Vec::with_capacity(p.capacity());
    for i in 0..p.capacity() {
        data.push(ParticleInstance {
            pos: p.pos[i],
            size: p.size[i] / PPU,
            color: p.color[i],
            alpha: p.alpha[i],
        });
    }
    buffer.set_data(data);

    // Touching the material is what re-runs `AsBindGroup` against the new GPU
    // buffer. `ShaderStorageBuffer::prepare_asset` CREATES a buffer rather than
    // writing into the old one, so a bind group built against the previous
    // frame's buffer would keep pointing at stale bytes. Bevy's own
    // `examples/shader/storage_buffer.rs` does the same `get_mut` for the same
    // reason.
    let _ = materials.get_mut(&handles.material);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Material::vertex_shader()` is a static method, so the shader's URL has
    /// to be a written-down constant — which means it can silently disagree
    /// with where `embedded_asset!` actually filed the bytes. A wrong path does
    /// not fail the build and does not panic: the shader simply never loads,
    /// the pipeline is never built, and the room is missing its embers with no
    /// message anywhere (this crate has no `LogPlugin`). So the two are pinned
    /// to each other here, through the same macro the registration uses.
    #[test]
    fn the_shader_constant_matches_where_the_macro_files_it() {
        let path = bevy::asset::embedded_path!("particles.wgsl");
        let url = format!("embedded://{}", path.display());
        assert_eq!(url, material::PARTICLE_SHADER);
    }

    /// The upload's pixels→world divide. A `PARTICLE_SCALE` that drifts from
    /// `PPU` is the bug the oracle's `fx/pools/shared.ts` was written to
    /// prevent: a hardcoded 0.05 there once made every ember 3.2x too big.
    #[test]
    fn pixel_sizes_convert_through_ppu() {
        assert!((PPU - 56.0).abs() < f32::EPSILON, "the shipped zoom rung");
        // A 4 px ember is 4/56 = 0.0714… world units across.
        assert!((4.0 / PPU - 0.071_428_57).abs() < 1e-6);
        // …and the same ember at the end of its life (size0 * 0.35) is 1.4 px.
        assert!((4.0 * 0.35 / PPU - 0.025).abs() < 1e-6);
    }
}
