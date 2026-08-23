//! The one custom material the particles render through — hand-written WGSL
//! with storage-buffer instancing, per `docs/src/game/architecture.md` (NOT
//! `bevy_hanabi`: the pool is a CPU simulation and its slots are the source of
//! truth, so the GPU only ever expands them).
//!
//! ONE ENTITY, ONE DRAW. The mesh carries `6 * CAP` vertices, each stamped with
//! its own particle index and quad corner; the vertex shader reads those and
//! expands a camera-facing quad from the view basis. That is why a dead slot
//! costs nothing: its size is 0, so the two triangles are degenerate and
//! rasterise zero fragments.
//!
//! The index is carried in the VERTEX DATA rather than derived from
//! `@builtin(vertex_index)` — see [`particle_mesh`] for the slab-offset trap
//! that made, and would silently re-make, the whole effect invisible.
//!
//! BLENDING. `AlphaMode::Add` maps to Bevy's `PREMULTIPLIED_ALPHA_BLENDING`
//! pipeline key — `result = 1*src + (1-src_a)*dst` — so the fragment shader has
//! to premultiply and write alpha 0 itself to land on true additive
//! (`bevy_pbr/src/render/pbr_functions.wgsl:801-828` does exactly this for
//! `StandardMaterial`). That key also sets `depth_write_enabled = false` with
//! the depth test still on, which is the legacy `depthTest: true,
//! depthWrite: false` pair.
//!
//! PORTS-NOTHING — wgpu material plumbing for the FX pools

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

/// The two triangles of a centred unit quad, in the order the vertices are
/// emitted: bl, br, tr — bl, tr, tl.
const QUAD: [[f32; 2]; 6] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
];

/// The expansion mesh: `6 * cap` vertices carrying `[particle_index, corner_x,
/// corner_y]` in the POSITION slot.
///
/// WHY THE INDEX RIDES THE VERTEX DATA AND NOT `@builtin(vertex_index)`.
/// Bevy packs every mesh into a shared vertex SLAB and draws with
/// `pass.draw(vertex_buffer_slice.range, ..)` (`bevy_pbr/src/render/mesh.rs`
/// :3234), so `vertex_index` starts at this mesh's offset INTO THAT SLAB, not
/// at 0. The offset depends on what else the scene loaded, so the obvious
/// `vertex_index / 6` is wrong by an amount that changes per scene — it read
/// far past the 256-slot storage buffer, every particle came back size 0, and
/// NOTHING rendered with no error anywhere (a WGSL out-of-bounds read is
/// clamped, not diagnosed). Values carried in the attribute travel with the
/// vertex, so the slab offset cannot reach them.
///
/// The POSITION slot is used as plain storage — the vertex shader never treats
/// it as a position, and no mesh transform is applied. Bevy's pipeline derives
/// its vertex buffer layout from the mesh's attribute set, so keeping exactly
/// this one attribute also pins the layout to `@location(0)`.
///
/// The entity carries `NoFrustumCulling`, which is what keeps Bevy from
/// computing an `Aabb` out of these non-positions (the legacy pool sets
/// `points.frustumCulled = false` for the same reason).
pub fn particle_mesh(cap: usize) -> Mesh {
    let mut verts = Vec::with_capacity(cap * 6);
    for p in 0..cap {
        for c in QUAD {
            verts.push([p as f32, c[0], c[1]]);
        }
    }
    Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    )
    .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, verts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::render::render_resource::ShaderSize;

    /// Six vertices per slot, each carrying its own particle index and corner.
    ///
    /// The index MUST come from the attribute, never from `vertex_index` —
    /// see the note on [`particle_mesh`]. This asserts the baked values so a
    /// future "simplification" back to `vertex_index / 6` fails here rather
    /// than by rendering nothing at all, silently, in one scene.
    #[test]
    fn every_vertex_carries_its_particle_index_and_corner() {
        use bevy::mesh::VertexAttributeValues;
        let cap = super::super::pool::CAP;
        let m = particle_mesh(cap);
        assert_eq!(m.count_vertices(), cap * 6);
        assert_eq!(m.primitive_topology(), PrimitiveTopology::TriangleList);
        assert!(m.indices().is_none(), "non-indexed");

        let Some(VertexAttributeValues::Float32x3(v)) = m.attribute(Mesh::ATTRIBUTE_POSITION)
        else {
            panic!("POSITION must be Float32x3");
        };
        assert_eq!(v.len(), cap * 6);
        // Slot 0's six corners, then slot 1's, then the last slot's.
        for (c, want) in QUAD.iter().enumerate() {
            assert_eq!(v[c], [0.0, want[0], want[1]], "slot 0 corner {c}");
            assert_eq!(v[6 + c], [1.0, want[0], want[1]], "slot 1 corner {c}");
        }
        assert_eq!(v[(cap - 1) * 6][0], (cap - 1) as f32, "last slot's index");
        // The corners must span a centred unit quad, not a 0..1 one — the
        // oracle's PlaneGeometry(1,1) is centred, so the pool's position is the
        // particle's CENTRE.
        let xs: Vec<f32> = QUAD.iter().map(|c| c[0]).collect();
        assert_eq!(xs.iter().cloned().fold(f32::MAX, f32::min), -0.5);
        assert_eq!(xs.iter().cloned().fold(f32::MIN, f32::max), 0.5);
    }

    /// The std430 footprint the WGSL `Particle` struct assumes. If this ever
    /// changes, `particles.wgsl` reads garbage — silently, and only at runtime.
    #[test]
    fn instance_is_thirty_two_bytes() {
        assert_eq!(ParticleInstance::SHADER_SIZE.get(), 32);
    }
}
