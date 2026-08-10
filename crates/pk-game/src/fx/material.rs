//! The one custom material the particles render through — hand-written WGSL
//! with storage-buffer instancing, per `docs/src/game/architecture.md` (NOT
//! `bevy_hanabi`: the pool is a CPU simulation and its slots are the source of
//! truth, so the GPU only ever expands them).
//!
//! ONE ENTITY, ONE DRAW. The mesh carries `6 * CAP` dummy vertices and no
//! meaningful attributes; the vertex shader reads `@builtin(vertex_index)`,
//! divides by 6 to find its particle, and expands a camera-facing quad from the
//! view basis. That is why a dead slot costs nothing: its size is 0, so the two
//! triangles are degenerate and rasterise zero fragments.
//!
//! BLENDING. `AlphaMode::Add` maps to Bevy's `PREMULTIPLIED_ALPHA_BLENDING`
//! pipeline key — `result = 1*src + (1-src_a)*dst` — so the fragment shader has
//! to premultiply and write alpha 0 itself to land on true additive
//! (`bevy_pbr/src/render/pbr_functions.wgsl:801-828` does exactly this for
//! `StandardMaterial`). That key also sets `depth_write_enabled = false` with
//! the depth test still on, which is the legacy `depthTest: true,
//! depthWrite: false` pair.

use bevy::asset::RenderAssetUsages;
use bevy::mesh::{MeshVertexBufferLayoutRef, PrimitiveTopology};
use bevy::pbr::{MaterialPipeline, MaterialPipelineKey};
use bevy::prelude::*;
use bevy::render::render_resource::{
    AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError,
};
use bevy::render::storage::ShaderStorageBuffer;
use bevy::shader::ShaderRef;

/// Where `embedded_asset!(app, "particles.wgsl")` in `fx/mod.rs` puts the
/// shader: `<crate>/<dir under src>/<file>`. Written out rather than derived
/// because [`Material::vertex_shader`] is a static method with no world access.
pub const PARTICLE_SHADER: &str = "embedded://pk_game/fx/particles.wgsl";

/// One slot, as the GPU sees it. Std430 puts this at 32 bytes with no padding
/// surprises: `vec3` aligns to 16 and the trailing `f32` fills the gap, which
/// is why `size` follows `pos` and `alpha` follows `color` rather than the two
/// scalars being grouped.
///
/// `size` here is in WORLD UNITS — the pool stores render pixels and the
/// upload divides by `PPU` once, on the CPU, so the shader never has to know
/// what the camera zoom is.
#[derive(Clone, Copy, Debug, Default, ShaderType)]
pub struct ParticleInstance {
    pub pos: Vec3,
    pub size: f32,
    pub color: Vec3,
    pub alpha: f32,
}

/// The additive particle material. One storage buffer, no textures.
#[derive(Asset, TypePath, AsBindGroup, Debug, Clone)]
pub struct ParticleMaterial {
    /// NOTE: `#[storage]` in Bevy 0.17 binds a `Handle<ShaderStorageBuffer>`,
    /// not an inline `Vec<T>` — the derive looks the handle up in
    /// `RenderAssets<GpuShaderStorageBuffer>`
    /// (`bevy_render_macros/src/as_bind_group.rs:467`). The plain-`Vec` form in
    /// the brief does not compile against this version.
    #[storage(0, read_only)]
    pub particles: Handle<ShaderStorageBuffer>,
}

impl Material for ParticleMaterial {
    fn vertex_shader() -> ShaderRef {
        PARTICLE_SHADER.into()
    }

    fn fragment_shader() -> ShaderRef {
        PARTICLE_SHADER.into()
    }

    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Add
    }

    fn specialize(
        _pipeline: &MaterialPipeline,
        descriptor: &mut RenderPipelineDescriptor,
        _layout: &MeshVertexBufferLayoutRef,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        // A billboard is built from the view basis, so its winding flips the
        // moment the camera crosses behind it. Bevy's mesh pipeline defaults to
        // back-face culling, which would blink half the embers out.
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

/// The dummy mesh: `6 * cap` vertices, positions all zero.
///
/// The positions are never read — the vertex shader ignores them and works
/// from `vertex_index` — but the attribute has to EXIST, because Bevy's mesh
/// pipeline derives the vertex buffer layout from the mesh's attribute set and
/// a mesh with none produces a layout the draw command cannot satisfy. Keeping
/// exactly one attribute also pins that layout to `@location(0) position`, so
/// the shader's ignored input can never drift.
///
/// The all-zero positions make the computed `Aabb` a point at the origin, which
/// is why the render entity carries `NoFrustumCulling` (the legacy pool sets
/// `points.frustumCulled = false` for the same reason).
pub fn particle_mesh(cap: usize) -> Mesh {
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[0.0f32; 3]; cap * 6])
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::render::render_resource::ShaderSize;

    /// Six vertices per slot, two triangles — the vertex shader's `index / 6`
    /// and `index % 6` are only correct if the mesh is sized to match.
    #[test]
    fn mesh_has_six_vertices_per_particle() {
        let m = particle_mesh(super::super::pool::CAP);
        assert_eq!(m.count_vertices(), super::super::pool::CAP * 6);
        assert_eq!(m.primitive_topology(), PrimitiveTopology::TriangleList);
        assert!(m.indices().is_none(), "non-indexed: vertex_index is the id");
    }

    /// The std430 footprint the WGSL `Particle` struct assumes. If this ever
    /// changes, `particles.wgsl` reads garbage — silently, and only at runtime.
    #[test]
    fn instance_is_thirty_two_bytes() {
        assert_eq!(ParticleInstance::SHADER_SIZE.get(), 32);
    }
}
