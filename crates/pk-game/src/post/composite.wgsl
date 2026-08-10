// 🖼 THE COMPOSITE — port of `finalNode` in
// `legacy/src/game/pinball-knight/engine/render/pixel-pass.ts` (:382-892).
//
// ── THE ENCODE CONTRACT. READ THIS BEFORE CHANGING THE RETURN. ─────────────
//
// Getting this wrong is a whole-frame gamma error. It does not look like a
// bug; it looks like an art note ("washed out", "crushed", "muddy"), which is
// how it survives review. So, precisely:
//
//   * `scene_tex` is the view's main texture. Bevy hands us LINEAR light in
//     it, in BOTH configurations: with `Hdr` it is `Rgba16Float` holding raw
//     linear radiance; without, it is `Rgba8UnormSrgb`, and the hardware
//     DECODES sRGB→linear on every sample. Either way `textureSample` returns
//     linear. The camera runs `Tonemapping::None`, so nothing has curved it.
//
//   * The destination is the OTHER half of the same ping-pong, so it has the
//     same format, and the hardware ENCODES linear→sRGB on write (8-bit case)
//     or stores linear floats which the upscaling blit later encodes (HDR
//     case). Either way: WHAT WE RETURN IS TREATED AS LINEAR.
//
//   * But the oracle's math is not linear. It converts to sRGB by hand
//     halfway through (`to_srgb` below) because every constant after that
//     point — the vignette knee, the cel rungs, the ink threshold, the palette
//     itself — was authored against DISPLAY values. Reordering that would
//     silently re-tune all of them.
//
// So the shader ends `srgb_to_linear(col)`: we undo our own hand-written
// encode as the LAST act, purely so the hardware encode downstream puts the
// oracle's bytes on the screen. `srgb_to_linear(to_srgb(x)) == x` — the pair
// is a no-op on a linear frame and the point is what happens BETWEEN them.
//
// ── THE ORDER OF STAGES IS THE LOOK. DO NOT REORDER. ──────────────────────
// scene tap → SSAO (a SCALAR into `light`) → +bloom (linear!) → linear→sRGB
// → vignette (into `light`) → [outline] → [ui] → flash → CEL GRADE →
// [scanline] → back to linear.
//
// Stages in [brackets] are stubs. They are NOT debt: the oracle's own shipped
// config pins each of their uniforms to 0 (`QUANTIZE_DEFAULT = false` since
// 2026-08-03, outline/dither/scanline/aberration/heat likewise), so a stub at
// the right position is parity-exact. They are commented in place so turning
// one on later is a filled block and a uniform flip, never a reorder.

#import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput

// The FULL legacy uniform set, declared on day one. Fields after `flash` are
// pinned to 0 by the Rust side and drive the stubs above.
struct PkPost {
    /// Render-target size in texels. Only the scanline stub reads it — every
    /// other screen-space tap works in fragment coordinates, which are already
    /// texels and survive a viewport offset that a UV would not.
    resolution: vec2<f32>,
    /// `legacy_depth = depth_remap.x * raw + depth_remap.y`.
    ///
    /// Bevy is REVERSED-Z (1 = near, 0 = far, cleared to 0) over the camera's
    /// own near/far; the oracle is conventional 0→1 over near 0.1 / far 200,
    /// and every AO constant below is in the oracle's units. Derived from the
    /// live `OrthographicProjection` on the Rust side, so a change to the
    /// camera's near/far is a recomputed constant, not a rewrite.
    depth_remap: vec2<f32>,

    bloom: f32,
    ao: f32,
    ao_radius: f32,
    vignette: f32,
    cel: f32,
    cel_steps: f32,
    cel_curve: f32,
    cel_saturation: f32,
    flash: f32,

    // ── Pinned to 0. Parity-neutral; see the header. ──
    quantize: f32,
    dither: f32,
    scanline: f32,
    outline: f32,
    colour_outline: f32,
    aberration: f32,
    heat: f32,
    ui: f32,
    edge_threshold: f32,

    /// Calibration hatch — see `PK_POST_DEBUG` on the Rust side. 0 = the real
    /// composite; anything else is an early return.
    debug: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> u: PkPost;
@group(0) @binding(1) var scene_tex: texture_2d<f32>;
// NEAREST. The oracle's scene target is `NearestFilter` and the composite taps
// it 1:1, so this is an exact texel fetch and the filter only matters if
// somebody ever samples off-grid.
@group(0) @binding(2) var scene_samp: sampler;
@group(0) @binding(3) var bloom_tex: texture_2d<f32>;
// LINEAR — the oracle's bloom targets are `LinearFilter`, and they are HALF
// res, so this filter is load-bearing: nearest here would give the halo a
// visible 2x2 stair.
@group(0) @binding(4) var bloom_samp: sampler;
#ifdef MULTISAMPLED_DEPTH
@group(0) @binding(5) var depth_tex: texture_depth_multisampled_2d;
#else
@group(0) @binding(5) var depth_tex: texture_depth_2d;
#endif
// ── RESERVED. DO NOT REUSE — adding these later must not renumber the above.
//   @binding(6) albedo_tex  — MRT slot 1, the material before any light. The
//                             palette snap and the colour-edge outline both
//                             read it and nothing else does.
//   @binding(7) ui_tex      — the uploaded 2D GUI sheet, composited between
//                             the outline and the flash.
//   @binding(8) ui_samp     — nearest; the UI is an unfiltered canvas upload.

const REC709 = vec3<f32>(0.2126, 0.7152, 0.0722);

// ── Transfer functions, by hand ──────────────────────────────────────────
// Written out rather than borrowed from bevy_render::color_operations so the
// knee constants sit next to the header's contract.

fn to_srgb(c: vec3<f32>) -> vec3<f32> {
    let lo = c * 12.92;
    let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(lo, hi, c >= vec3<f32>(0.0031308));
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((max(c, vec3<f32>(0.0)) + 0.055) / 1.055, vec3<f32>(2.4));
    return select(lo, hi, c >= vec3<f32>(0.04045));
}

/// `smoothstep` with NO ordering precondition.
///
/// WGSL leaves `smoothstep(e0, e1, x)` UNDEFINED when `e0 >= e1`, and the
/// vignette below is a DESCENDING ramp (`smoothstep(0.85, 0.32, …)`) straight
/// out of the oracle's GLSL, where descending edges are well defined and
/// idiomatic. Spelling out the interpolation keeps the oracle's expression
/// readable and keeps naga's const-evaluator out of it.
fn sstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

/// Depth in the ORACLE's units: 0 at the near plane, 1 at the far plane.
///
/// `textureLoad` at floored texel coordinates, never `textureSample`:
/// `Depth32Float` is non-filterable on WebGPU, and the oracle samples depth
/// nearest anyway, so this is the faithful fetch AND the portable one.
fn depth_at(p: vec2<f32>) -> f32 {
    let dims = vec2<i32>(textureDimensions(depth_tex));
    let c = clamp(vec2<i32>(floor(p)), vec2<i32>(0), dims - vec2<i32>(1));
    let raw = textureLoad(depth_tex, c, 0);
    return u.depth_remap.x * raw + u.depth_remap.y;
}

/// One AO tap. A concave corner has neighbours CLOSER than the centre; a tap
/// counts when it is moderately closer. `step(0.00015, …)` throws away the
/// flat ground and `smoothstep(0.004, 0.02, …)` fades out the silhouette
/// against the void, so corners darken without haloing every sprite.
fn ao_tap(centre: vec2<f32>, offset: vec2<f32>, c0: f32) -> f32 {
    let diff = c0 - depth_at(centre + offset);
    return step(0.00015, diff) * (1.0 - sstep(0.004, 0.02, diff));
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    let uv = in.uv;
    // gl_FragCoord. Texel units in the render target's own space, so the AO
    // ring's `aoRadius = 14` "render texels" is literally 14 here.
    let frag = in.position.xy;

    // ── 1. The scene tap. LINEAR HDR — see the encode contract. ───────────
    //
    // STUB — chromatic aberration (`u.aberration`, pinned 0). The oracle
    // splits R and B outward from centre on the LIT buffer:
    //   off   = uv - 0.5 * u.aberration
    //   split = vec3(tap(uv + off).r, plain.g, tap(uv - off).b)
    //   col   = mix(plain, split, step(0.0001, u.aberration))
    // It is a mix, not a scale, so aberration = 0 reduces to EXACTLY this
    // single fetch. Frenzy combos ramp it to 0.006.
    var col = textureSample(scene_tex, scene_samp, uv).rgb;

    // STUB — the albedo tap (@binding(6)). MRT attachment 1: the material
    // before any light touched it. Only the palette snap and the colour-edge
    // outline read it, and both are off, so the attachment does not exist yet.

    // ── 2. SSAO from depth. 8 angles x 2 radii x aoRadius = 16 taps. ──────
    let c0 = depth_at(frag);
    var occ = 0.0;
    for (var i = 0; i < 8; i++) {
        let a = f32(i) * 0.7853981634; // 2π / 8
        let d = vec2<f32>(cos(a), sin(a)) * u.ao_radius;
        occ += ao_tap(frag, d * 0.5, c0);
        occ += ao_tap(frag, d, c0);
    }
    // Void/sky is excluded — nothing there to occlude. In the oracle's units
    // the cleared depth maps well past 1, so this catches it comfortably.
    let ao_term = select(occ / 16.0, 0.0, c0 >= 0.999);

    // ⚠️ AO IS A SCALAR AND DOES NOT MULTIPLY THE COLOUR. Every multiplicative
    // darkening term in this shader accumulates into `light` and is spent once
    // at the cel grade. The oracle measured what a colour multiply here costs:
    // a shadowed floor changes HUE, because the darkened value re-snaps to
    // whichever palette family the luma metric happens to favour (24 of 32
    // entries leave their family before 0.35x). The snap is retired, but the
    // discipline is what keeps the grade's "chroma rides along" promise true.
    var light = 1.0 - ao_term * u.ao;

    // ── 3. Bloom, added in LINEAR so bright torch cores bleed a warm halo. ─
    col += textureSample(bloom_tex, bloom_samp, uv).rgb * u.bloom;

    // ── 4. Accurate linear → sRGB. Everything downstream is display-referred.
    col = to_srgb(col);

    // ── 5. Vignette, BEFORE the grade so the falloff snaps to darker rungs. ─
    let q = uv - 0.5;
    let vig = sstep(0.85, 0.32, dot(q, q) * 2.0); // 1 centre → 0 corners
    light *= mix(1.0, vig, u.vignette);

    // ── STUB — ink outline (`u.outline` / `u.colour_outline`, pinned 0). ──
    // The oracle's cel move, and TWO edge terms, because a depth edge alone is
    // blind to a silhouette at the SAME depth (an actor on the floor it stands
    // on). Position matters: AFTER AO and BEFORE the UI, because both this and
    // AO read depth and the UI writes none — an outline downstream of the UI
    // would ink the scene THROUGH a paused menu.
    //   depth_edge  = max over the 4 axis neighbours of |depth - centre|
    //                 > 0.35/200
    //   colour_edge = the same max over luma of the ALBEDO neighbours
    //                 > u.edge_threshold (0.26), killed on the void
    //                 (centre < 0.999) and inside the warm family
    //                 (r >= g on centre AND all four taps)
    //   light *= mix(1.0, select(1.0, 0.45, max(...) > 0.5), u.outline)
    // Needs @binding(6); the whole term rides `light` like everything else.

    // ── STUB — the in-game UI (`u.ui`, pinned 0), @binding(7). ────────────
    // Composited HERE and nowhere else: downstream of every depth-driven pass
    // so it cannot interact with them, upstream of the grade so the menu wears
    // the same bands as the art.
    //   col   = mix(col, ui.rgb, ui.a * u.ui)   // both already sRGB
    //   light = mix(light, 1.0, ui.a * u.ui)    // the UI is not IN the world
    // UV: the RAW uv, never a warped one. The oracle's flip trap lives here —
    // judge it by a corner probe, never a centred menu.

    // ── 6. Full-screen flash. LIVE: the descend transition drives it. ─────
    // Before the grade so the wash bands like everything else.
    col = mix(col, vec3<f32>(1.0), u.flash);

    // ── STUB — Bayer 4x4 ordered dither (`u.dither`, pinned 0). ───────────
    // The oracle dithers the TARGET LUMA at the quantizer, not the colour: a
    // nudge in colour space moves a pixel between MATERIALS and wore the frame
    // in per-pixel confetti. Amplitude 0.03, roughly half a ramp step.

    // ── STUB — 32-entry palette snap (`u.quantize`, pinned 0). ────────────
    // Retired 2026-08-03 in the oracle itself; the cel grade below is what
    // bands the frame now. Reviving it needs @binding(6) (it snaps the ALBEDO,
    // not the lit frame) plus the shaded-palette texture.

    // ── 7. THE CEL GRADE — the visible signature. ─────────────────────────
    //
    // Runs on the LIT colour, after every darkening term has landed in
    // `light`, and it is the LAST thing before the scanlines because it has to
    // see the final pixel: posterizing before AO or the vignette would just
    // have those gradients smeared back across the bands it drew.
    //
    // POSTERIZE: round the luma to `cel_steps` rungs and rescale the pixel's
    // own RGB onto the rounded value. Chroma rides along untouched, so a torch
    // pool stays orange and a rot floor stays green — the grade can brighten
    // or darken a pixel but it can never move it to another material.
    //
    // ⚠️ THE RUNGS ARE SPACED ON A CURVE, NOT EVENLY. Evenly is what made the
    // map grainy, and the mechanism is the CRUSH, not the banding: with 10
    // even rungs the first is luma 0.1, so everything under 0.05 goes pure
    // black — and this dungeon lives almost entirely under 0.35. Measured on
    // Bloodworks masonry, even rungs crushed 11% of the lit range to black and
    // amplified a 1.59:1 neighbour pair to ∞:1; `cel_curve = 0.5` crushes 0%
    // and caps that pair at 1.41x. Rungs land at `(k/steps)^(1/curve)`.
    // `cel_curve = 1` is exactly the old even spacing, for an A/B.
    let lit = col * light;
    let lum = max(dot(lit, REC709), 0.0001);
    let curved = pow(lum, u.cel_curve);
    let banded_curved = floor(curved * u.cel_steps + 0.5) / u.cel_steps;
    // Back out of the curve. `max(…, 1e-6)` because `pow(0, 1/curve)` is
    // 0/0-shaped on some backends: rung 0 must be black, not NaN.
    let banded = pow(max(banded_curved, 0.000001), 1.0 / u.cel_curve);
    let posterized = lit * (banded / lum);
    // SATURATE: push away from the pixel's own grey, then clamp, so an
    // already-vivid pixel flattens to the primary instead of wrapping.
    let grey = dot(posterized, REC709);
    let cel_col = clamp(
        mix(vec3<f32>(grey), posterized, u.cel_saturation),
        vec3<f32>(0.0),
        vec3<f32>(1.0),
    );
    col = mix(lit, cel_col, u.cel);

    // ── STUB — scanlines (`u.scanline`, pinned 0). ────────────────────────
    // Every other ROW of the RENDER target, dimmed to 0.86. A display artefact
    // that lives in front of the picture, so it reads `u.resolution` and never
    // a warped coordinate:
    //   line = (floor(uv.y * u.resolution.y)) % 2
    //   col *= mix(1.0, mix(1.0, 0.86, line), u.scanline)

    // ── The calibration hatch. See `PK_POST_DEBUG`. ───────────────────────
    // Greyscales are emitted as DISPLAY values, so the byte on screen is the
    // number: a readout of 0.5 is 128, whatever the target format.
    if (u.debug > 0.5) {
        var dbg = col;
        if (u.debug < 1.5) {
            // 1 — raw Bevy depth. Reversed-Z: WHITE is near, BLACK is the
            // cleared void. If the void is white here, the clear is not 0.
            let dims = vec2<i32>(textureDimensions(depth_tex));
            let c = clamp(vec2<i32>(floor(frag)), vec2<i32>(0), dims - vec2<i32>(1));
            dbg = vec3<f32>(textureLoad(depth_tex, c, 0));
        } else if (u.debug < 2.5) {
            // 2 — depth AFTER `depth_remap`, in oracle units. This is the one
            // that decides whether the AO thresholds mean anything. Geometry
            // must read 0..1 with NEAR geometry DARKER, and the void must
            // blow past 1 (it clips to white).
            dbg = vec3<f32>(c0);
        } else if (u.debug < 3.5) {
            // 3 — the same, x20. The dungeon occupies a thin slice of the
            // near end, so unscaled it is a black frame with a white void.
            dbg = vec3<f32>(c0 * 20.0);
        } else if (u.debug < 4.5) {
            // 4 — the AO term alone. White = fully occluded.
            dbg = vec3<f32>(ao_term);
        } else if (u.debug < 5.5) {
            // 5 — the accumulated `light` scalar (AO x vignette x outline).
            dbg = vec3<f32>(light);
        } else {
            // 6 — PASS-THROUGH. The identity check: this must be
            // pixel-identical to the frame with the whole plugin removed, and
            // it is what proves the ping-pong and the encode contract before
            // any math is trusted.
            return textureSample(scene_tex, scene_samp, uv);
        }
        return vec4<f32>(srgb_to_linear(clamp(dbg, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
    }

    // ── Back to linear, so the hardware encode reproduces the oracle's bytes.
    return vec4<f32>(srgb_to_linear(col), 1.0);
}
