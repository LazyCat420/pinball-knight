// ✨ PARTICLES — one draw, `6 * CAP` vertices, no per-particle instancing state
// beyond a storage buffer the CPU pool refills each frame.
//
// The vertex shader IGNORES the mesh entirely. `vertex_index / 6` is the
// particle, `vertex_index % 6` is the corner of its two triangles, and the quad
// is expanded on the view's right/up basis so it always faces the camera —
// the same billboard `SpriteNodeMaterial` gave the oracle.
//
// A dead slot has size 0, so its six vertices collapse to a point and the
// rasteriser emits nothing. That is the whole retirement mechanism; there is no
// discard and no branch.

#import bevy_pbr::mesh_view_bindings::view

struct Particle {
    pos: vec3<f32>,
    // WORLD units. The pool stores render pixels; the CPU divides by PPU.
    size: f32,
    // LINEAR rgb — the scene target is a linear buffer.
    color: vec3<f32>,
    alpha: f32,
}

@group(#{MATERIAL_BIND_GROUP}) @binding(0) var<storage, read> particles: array<Particle>;

struct VertexIn {
    @builtin(vertex_index) index: u32,
    // Present only because Bevy's mesh pipeline builds the vertex buffer layout
    // from the mesh's attributes. Never read.
    @location(0) position: vec3<f32>,
}

struct VertexOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) alpha: f32,
}

@vertex
fn vertex(in: VertexIn) -> VertexOut {
    let p = particles[in.index / 6u];

    // Two triangles over a centred unit quad: (bl, br, tr) (bl, tr, tl).
    // A local `var` rather than a module `const` so the runtime index is legal
    // WGSL — dynamic indexing needs a reference, not a value.
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5, -0.5),
        vec2<f32>( 0.5,  0.5),
        vec2<f32>(-0.5,  0.5),
    );
    let c = corners[in.index % 6u];

    // Billboard on the view basis. `world_from_view`'s first two columns are
    // the camera's right and up in world space.
    let right = view.world_from_view[0].xyz;
    let up = view.world_from_view[1].xyz;
    let world = p.pos + right * (c.x * p.size) + up * (c.y * p.size);

    var out: VertexOut;
    out.clip_position = view.clip_from_world * vec4<f32>(world, 1.0);
    out.color = p.color;
    out.alpha = p.alpha;
    return out;
}

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4<f32> {
    // FLAT, HARD-EDGED, NO FALLOFF — this matches the oracle exactly.
    //
    // `fx/pools/particle-pool.ts` builds a `SpriteNodeMaterial` whose entire
    // fragment is `colorNode = vec4(aColor, aAlpha)`: no texture, no radial
    // ramp, no `discard`. Its own comment records why that is deliberate —
    // "Verified by pixel readback: 0 partially-transparent pixels, i.e. no
    // anti-aliased rim. That is the same hard-square look the old fragment
    // shader gave, which the palette quantiser depends on." A soft rim would
    // feed the pixel pass a gradient it snaps unpredictably across palette
    // entries.
    //
    // For a hard-edged DISC instead (same 0-partial-alpha property, round
    // silhouette), the quad's corner would need to reach the fragment as a uv
    // and this becomes:
    //     if (dot(uv, uv) > 0.25) { discard; }
    //
    // `AlphaMode::Add` runs on PREMULTIPLIED_ALPHA_BLENDING, so premultiply and
    // zero the alpha to get `result = src_a*src + 1*dst`.
    return vec4<f32>(in.color * in.alpha, 0.0);
}
