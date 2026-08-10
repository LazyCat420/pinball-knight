// 🌟 THE BLOOM CHAIN — port of `brightNode` / `blurNode` and the three blits
// in `render()` (`legacy/…/render/pixel-pass.ts` :151-171, :1799-1810).
//
// Three passes over TWO half-res targets, run only when strength > 0.001:
//
//   bright : scene (full res)  → A     keep what is brighter than 0.7
//   blur   : A                 → B     9 taps horizontally
//   blur   : B                 → A     9 taps vertically
//
// so the blurred halo lands back in A, which is what the composite samples.
//
// COLOUR SPACE: every pass here is LINEAR, and it has to be. The composite
// adds this in before its own linear→sRGB, so a bright pass run on display
// values would threshold on a curved luma and the halo would swell in the
// shadows — see the encode contract at the top of composite.wgsl.
//
// HALF RES is not only cheap, it is part of the look: it widens the kernel for
// free, which is why the tap step is derived from the SOURCE dimensions rather
// than a uniform. `textureDimensions` on the bloom target is exactly the
// oracle's `BW`/`BH`.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput

@group(0) @binding(0) var src_tex: texture_2d<f32>;
/// NEAREST — used by `bright` only. The oracle's scene target is
/// `NearestFilter`, so the full-res → half-res bright pass is a 2x2
/// DECIMATION, not an average. Swapping this for linear is a real change to
/// which highlights survive the threshold.
@group(0) @binding(1) var nearest_samp: sampler;
/// LINEAR — used by `blur` only. The oracle's bloom targets are
/// `LinearFilter`; the kernel taps land on texel centres here, but the filter
/// is what the composite's own half-res tap relies on.
@group(0) @binding(2) var linear_samp: sampler;

const REC709 = vec3<f32>(0.2126, 0.7152, 0.0722);
/// config.ts post.bloomThreshold. A constant in the oracle too — `brightMat`
/// wraps it in a uniform that nothing ever pokes.
const BLOOM_THRESHOLD: f32 = 0.7;
/// config.ts post.bloomRadius, in HALF-res texels per tap index.
const BLOOM_RADIUS: f32 = 2.2;
/// Normalised gaussian, sigma ≈ 2 — the same taps as the oracle's GLSL.
const BLUR_W = array<f32, 5>(0.227027, 0.194595, 0.121622, 0.054054, 0.016216);

// ── Bright pass: keep only what is brighter than the threshold, softly. ────
@fragment
fn bright(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let c = textureSample(src_tex, nearest_samp, in.uv).rgb;
    let l = dot(c, REC709);
    // `max(1 - threshold, 0.001)` is the oracle's own guard against a
    // threshold of exactly 1 turning the divide into a NaN factory.
    let k = clamp((l - BLOOM_THRESHOLD) / max(1.0 - BLOOM_THRESHOLD, 0.001), 0.0, 1.0);
    return vec4<f32>(c * k, 1.0);
}

// ── Separable 9-tap gaussian. Direction comes from the shader def, so H and V
// are two pipelines over one kernel rather than a uniform poked between draws
// (which is what the oracle's two blur materials amount to).
@fragment
fn blur(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let dims = vec2<f32>(textureDimensions(src_tex));
#ifdef BLUR_VERTICAL
    let dir = vec2<f32>(0.0, BLOOM_RADIUS / dims.y);
#else
    let dir = vec2<f32>(BLOOM_RADIUS / dims.x, 0.0);
#endif
    var c = textureSample(src_tex, linear_samp, in.uv).rgb * BLUR_W[0];
    for (var i = 1; i < 5; i++) {
        let o = dir * f32(i);
        c += textureSample(src_tex, linear_samp, in.uv + o).rgb * BLUR_W[i];
        c += textureSample(src_tex, linear_samp, in.uv - o).rgb * BLUR_W[i];
    }
    return vec4<f32>(c, 1.0);
}
