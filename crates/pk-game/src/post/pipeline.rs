//! The bloom chain and the composite, as render-graph nodes on the scene
//! camera. Straight port of `pixel-pass.ts`'s `render()` and `finalNode`.
//!
//! ── WHERE THIS SITS IN THE GRAPH ──────────────────────────────────────────
//!
//!     Node3d::EndMainPass → PkBloom → PkComposite → Node3d::Tonemapping
//!
//! Before tonemapping, which is the whole point: the camera runs
//! `Tonemapping::None` (the node then no-ops), so the composite is handed raw
//! linear light exactly as the oracle's `finalNode` was. Everything about the
//! colour handoff is spelled out at the top of `composite.wgsl` — read that
//! before touching either shader.
//!
//! ── WHY THE NODES DO NOT KNOW ABOUT THE RENDER TARGET ─────────────────────
//!
//! A `ViewNode` sees a `ViewTarget` and nothing else, so the low-res `Image`
//! target and `Hdr`/`Msaa::Off` landing on the camera separately change
//! nothing here: `post_process_write()` ping-pongs whatever the view owns, the
//! bloom targets are derived from the camera's own physical size, and the AO
//! ring works in fragment coordinates, which are in the target's space by
//! construction. The one thing that IS specialised is MSAA, because a
//! multisampled depth texture is a different binding TYPE — see
//! `MULTISAMPLED_DEPTH`.
//!
//! ── THE DEPTH SOURCE ──────────────────────────────────────────────────────
//!
//! `ViewDepthTexture` — the main pass's own depth buffer, bound directly. No
//! `DepthPrepass` and so no second geometry pass. That needs one thing from
//! the camera, which `arm_pk_post` does rather than asking `main.rs` for it:
//! `Camera3d::depth_texture_usages` defaults to `RENDER_ATTACHMENT` alone, and
//! a texture without `TEXTURE_BINDING` cannot be put in a bind group at all
//! (wgpu rejects it at validation, not at draw). Bevy arms the same flag the
//! same way for occlusion culling.

use bevy::{
    asset::{embedded_asset, load_embedded_asset},
    core_pipeline::{
        core_3d::graph::{Core3d, Node3d},
        FullscreenShader,
    },
    ecs::query::QueryItem,
    prelude::*,
    shader::PipelineCacheError,
    render::{
        extract_component::{
            ComponentUniforms, DynamicUniformIndex, ExtractComponent, ExtractComponentPlugin,
            UniformComponentPlugin,
        },
        render_graph::{
            NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner,
        },
        render_resource::{
            binding_types::{sampler, texture_2d, texture_depth_2d, texture_depth_2d_multisampled, uniform_buffer},
            BindGroupEntries, BindGroupLayout, BindGroupLayoutEntries, CachedPipelineState,
            CachedRenderPipelineId, ColorTargetState, ColorWrites, Extent3d, FilterMode,
            FragmentState, LoadOp,
            Operations, PipelineCache, RenderPassColorAttachment, RenderPassDescriptor,
            RenderPipelineDescriptor, Sampler, SamplerBindingType, SamplerDescriptor, ShaderStages,
            ShaderType, SpecializedRenderPipeline, SpecializedRenderPipelines, StoreOp,
            TextureDescriptor, TextureDimension, TextureFormat, TextureSampleType, TextureUsages,
            TextureView,
        },
        renderer::{RenderContext, RenderDevice},
        texture::{CachedTexture, TextureCache},
        view::{ExtractedView, Msaa, ViewDepthTexture, ViewTarget},
        Render, RenderApp, RenderStartup, RenderSystems,
    },
};

// ── The oracle's shipped config (config.ts :183-200). ─────────────────────
/// `post.bloomStrength`.
pub const BLOOM_STRENGTH: f32 = 0.9;
/// `post.aoStrength`.
pub const AO_STRENGTH: f32 = 0.85;
/// `post.aoRadius`, in render texels.
pub const AO_RADIUS: f32 = 14.0;
/// `post.vignette`.
pub const VIGNETTE: f32 = 0.32;
/// `post.celSteps`.
pub const CEL_STEPS: f32 = 10.0;
/// `post.celCurve`.
pub const CEL_CURVE: f32 = 0.5;
/// `post.celSaturation`.
pub const CEL_SATURATION: f32 = 1.15;
/// `post.outlineEdgeThreshold` — carried for the outline stub.
pub const EDGE_THRESHOLD: f32 = 0.26;

/// The oracle's depth range: `constants/render.ts` near / far for the dungeon
/// camera. Every AO constant in `composite.wgsl` is expressed in THIS
/// normalisation, which is what `depth_remap` converts Bevy's reversed-Z into.
const LEGACY_NEAR: f32 = 0.1;
const LEGACY_FAR: f32 = 200.0;

/// Set by [`init_pk_pipelines`]. A `RenderStartup` system whose `Res` params
/// are not all present is SKIPPED, not failed, and the only complaint goes
/// through `tracing` — which this binary has no subscriber for. Without this
/// flag the tripwire below cannot tell "the pipelines never built" from "the
/// system that creates them never ran at all".
static INIT_RAN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Bloom runs at HALF the render resolution — cheaper, and a wider blur for
/// free. `Rgba16Float` because the bright pass keeps HDR highlights: an 8-bit
/// target would clip the torch cores that the halo exists to spread.
const BLOOM_FORMAT: TextureFormat = TextureFormat::Rgba16Float;

// ── The uniform block ─────────────────────────────────────────────────────

/// Every uniform `finalNode` takes, declared on day one.
///
/// The ones after `flash` are pinned to 0 because the ORACLE's own shipped
/// config pins them (`QUANTIZE_DEFAULT = false` since 2026-08-03, and outline
/// / dither / scanline / aberration / heat / ui likewise). That makes their
/// absence parity-EXACT rather than parity-approximate — the stubs in
/// `composite.wgsl` sit at the right positions so turning one on is a filled
/// block and a value here, never a reorder of the chain.
///
/// This is the component AND the uniform: it lives on the camera in the main
/// world (so gameplay can poke `flash`), is extracted verbatim, and is written
/// into a dynamic uniform buffer by `UniformComponentPlugin`.
#[derive(Component, Clone, Copy, Debug, ExtractComponent, ShaderType)]
pub struct PkPost {
    /// Render-target size in texels. Only the scanline stub reads it.
    pub resolution: Vec2,
    /// `legacy_depth = x * raw + y`. Recomputed from the live projection every
    /// frame by [`arm_pk_post`]; see that function for the derivation.
    pub depth_remap: Vec2,

    pub bloom: f32,
    pub ao: f32,
    pub ao_radius: f32,
    pub vignette: f32,
    pub cel: f32,
    pub cel_steps: f32,
    pub cel_curve: f32,
    pub cel_saturation: f32,
    /// LIVE — the descend transition washes the frame white through this.
    pub flash: f32,

    // ── Pinned to 0. ──
    pub quantize: f32,
    pub dither: f32,
    pub scanline: f32,
    pub outline: f32,
    pub colour_outline: f32,
    pub aberration: f32,
    pub heat: f32,
    pub ui: f32,
    pub edge_threshold: f32,

    /// `PK_POST_DEBUG` — 0 is the real composite, 1..6 are calibration views.
    pub debug: f32,
    pub _pad: f32,
}

impl Default for PkPost {
    fn default() -> Self {
        Self {
            resolution: Vec2::new(1.0, 1.0),
            // The nominal reversed-Z flip, replaced with the projection-derived
            // pair on the first frame. Never relied on: see `arm_pk_post`.
            depth_remap: Vec2::new(-1.0, 1.0),
            bloom: BLOOM_STRENGTH,
            ao: AO_STRENGTH,
            ao_radius: AO_RADIUS,
            vignette: VIGNETTE,
            cel: 1.0,
            cel_steps: CEL_STEPS,
            cel_curve: CEL_CURVE,
            cel_saturation: CEL_SATURATION,
            flash: 0.0,
            quantize: 0.0,
            dither: 0.0,
            scanline: 0.0,
            outline: 0.0,
            colour_outline: 0.0,
            aberration: 0.0,
            heat: 0.0,
            ui: 0.0,
            edge_threshold: EDGE_THRESHOLD,
            debug: debug_mode(),
            _pad: 0.0,
        }
    }
}

/// `PK_POST_DEBUG=1..6` — the calibration hatch, read once.
///
/// 1 raw depth · 2 remapped depth · 3 remapped x20 · 4 AO term · 5 the `light`
/// scalar · 6 PASS-THROUGH. Mode 6 is the identity check that proves the
/// ping-pong and the encode contract before any of the maths is believed; mode
/// 2/3 are what `depth_remap` was calibrated against.
fn debug_mode() -> f32 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::env::var("PK_POST_DEBUG")
            .ok()
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(0.0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        0.0
    }
}

// ── Graph labels ──────────────────────────────────────────────────────────

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
struct PkBloomLabel;

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
struct PkCompositeLabel;

// ── Plugin ────────────────────────────────────────────────────────────────

pub struct PixelPipelinePlugin;

impl Plugin for PixelPipelinePlugin {
    fn build(&self, app: &mut App) {
        // No `assets/` wiring exists in this crate (everything the game needs
        // is compiled in, so the wasm build is one file), so the shaders embed
        // exactly like the sprite sheets in main.rs.
        embedded_asset!(app, "composite.wgsl");
        embedded_asset!(app, "bloom.wgsl");

        app.add_plugins((
            ExtractComponentPlugin::<PkPost>::default(),
            UniformComponentPlugin::<PkPost>::default(),
        ))
        // `PostUpdate`, after `CameraUpdateSystems`, and both halves of that
        // matter:
        //
        //   * BEFORE EXTRACTION (which is what `PostUpdate` buys) because the
        //     depth-usage flag has to be armed on the frame it is read on. Set
        //     it later and frame 0 owns a depth texture that cannot go in a
        //     bind group, which wgpu treats as a validation error, not a
        //     warning.
        //   * AFTER `CameraUpdateSystems` because `sizing.rs` re-points this
        //     camera at the low-res image and rewrites near/far from
        //     `PostUpdate` — and `depth_remap` is DERIVED from near/far.
        //     Reading the projection before that lands would calibrate the AO
        //     against `default_3d()`'s 1000-unit frustum instead of the
        //     oracle's 199.9, i.e. every depth difference 5x too small and an
        //     AO term that is merely weak rather than obviously broken.
        .add_systems(
            PostUpdate,
            arm_pk_post.after(bevy::camera::CameraUpdateSystems),
        );

        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            return;
        };
        render_app
            .init_resource::<SpecializedRenderPipelines<PkCompositePipeline>>()
            .init_resource::<SpecializedRenderPipelines<PkBloomPipeline>>()
            .add_systems(RenderStartup, init_pk_pipelines)
            .add_systems(
                Render,
                (
                    prepare_pk_bloom_textures.in_set(RenderSystems::PrepareResources),
                    prepare_pk_pipelines.in_set(RenderSystems::Prepare),
                    report_pk_post_status.in_set(RenderSystems::Cleanup),
                ),
            )
            .add_render_graph_node::<ViewNodeRunner<PkBloomNode>>(Core3d, PkBloomLabel)
            .add_render_graph_node::<ViewNodeRunner<PkCompositeNode>>(Core3d, PkCompositeLabel)
            .add_render_graph_edges(
                Core3d,
                (
                    Node3d::EndMainPass,
                    PkBloomLabel,
                    PkCompositeLabel,
                    Node3d::Tonemapping,
                ),
            );
    }
}

// ── Main-world arming ─────────────────────────────────────────────────────

/// Puts [`PkPost`] on every 3D camera, keeps `resolution` / `depth_remap`
/// live, and arms the depth buffer for read-back.
///
/// ── THE DEPTH REMAP, DERIVED ─────────────────────────────────────────────
///
/// Bevy's orthographic matrix passes `far` and `near` to `orthographic_rh` the
/// wrong way round on purpose (reversed-Z), so for a view-space distance `d`:
///
///     raw = (far - d) / (far - near)          raw = 1 at near, 0 at far
///
/// while the oracle's ortho depth is the conventional
///
///     legacy = (d - 0.1) / (200 - 0.1)
///
/// Substituting gives `legacy = a * raw + b` with
///
///     a = -(far - near) / (LEGACY_FAR - LEGACY_NEAR)
///     b = (far - LEGACY_NEAR) / (LEGACY_FAR - LEGACY_NEAR)
///
/// ⚠️ THE SCALE IS THE HALF THAT IS EASY TO MISS. A naive "reversed-Z, so
/// `1 - raw`" gets the DIRECTION right and the UNITS wrong by the ratio of the
/// two frusta — Bevy's `default_3d()` ortho spans 1000 units against the
/// oracle's 199.9, so every AO depth difference would arrive 5x too small and
/// the 0.00015 floor would swallow the whole effect. AO would not vanish, it
/// would just be quietly weak, which is exactly the kind of wrong that ships.
/// Deriving it from the projection also means a change to the camera's near /
/// far is picked up rather than silently re-tuning the AO.
///
/// The void test survives too: Bevy clears reversed-Z depth to 0, which maps
/// to `b` ≈ 5, comfortably past the `>= 0.999` sky cut.
fn arm_pk_post(
    mut commands: Commands,
    mut cams: Query<(
        Entity,
        &Camera,
        &Projection,
        &mut Camera3d,
        Option<&mut PkPost>,
    )>,
) {
    for (entity, camera, projection, mut camera_3d, post) in &mut cams {
        // Guarded so the write only happens once — an unconditional assignment
        // would trip change detection on `Camera3d` every single frame.
        let usages = TextureUsages::from(camera_3d.depth_texture_usages);
        if !usages.contains(TextureUsages::TEXTURE_BINDING) {
            camera_3d.depth_texture_usages = (usages | TextureUsages::TEXTURE_BINDING).into();
        }

        let resolution = camera
            .physical_target_size()
            .unwrap_or(UVec2::ONE)
            .as_vec2()
            .max(Vec2::ONE);

        let span = LEGACY_FAR - LEGACY_NEAR;
        let depth_remap = match projection {
            Projection::Orthographic(ortho) => Vec2::new(
                -(ortho.far - ortho.near) / span,
                (ortho.far - LEGACY_NEAR) / span,
            ),
            // A perspective view's depth is not linear in eye space, so no
            // affine remap can make the oracle's AO thresholds mean the same
            // thing. The nominal flip keeps the void test working and the AO
            // merely becomes distance-dependent; the dungeon camera is ortho,
            // and the rampage FPS camera did not run this pass in the oracle
            // either.
            _ => Vec2::new(-1.0, 1.0),
        };

        match post {
            Some(mut post) => {
                post.resolution = resolution;
                post.depth_remap = depth_remap;
            }
            None => {
                commands.entity(entity).insert(PkPost {
                    resolution,
                    depth_remap,
                    ..default()
                });
            }
        }
    }
}

// ── Pipelines ─────────────────────────────────────────────────────────────

/// Shared plumbing for both passes: the two samplers and the fullscreen vertex
/// stage. The samplers are a pair on purpose — the oracle uses `NearestFilter`
/// on the scene target and `LinearFilter` on the bloom targets, and both
/// choices are load-bearing (see the notes in the shaders).
#[derive(Resource)]
struct PkSamplers {
    nearest: Sampler,
    linear: Sampler,
}

#[derive(Resource)]
struct PkCompositePipeline {
    /// Depth bound as `texture_depth_2d`.
    layout: BindGroupLayout,
    /// Depth bound as `texture_depth_multisampled_2d`. A different binding
    /// TYPE, hence a different layout, hence the specialisation key.
    layout_ms: BindGroupLayout,
    fullscreen: FullscreenShader,
    shader: Handle<Shader>,
}

#[derive(Resource)]
struct PkBloomPipeline {
    layout: BindGroupLayout,
    fullscreen: FullscreenShader,
    shader: Handle<Shader>,
}

#[derive(PartialEq, Eq, Hash, Clone, Copy)]
struct PkCompositeKey {
    format: TextureFormat,
    multisampled_depth: bool,
}

#[derive(PartialEq, Eq, Hash, Clone, Copy)]
enum PkBloomPass {
    Bright,
    BlurH,
    BlurV,
}

impl SpecializedRenderPipeline for PkCompositePipeline {
    type Key = PkCompositeKey;

    fn specialize(&self, key: Self::Key) -> RenderPipelineDescriptor {
        let mut shader_defs = Vec::new();
        let layout = if key.multisampled_depth {
            shader_defs.push("MULTISAMPLED_DEPTH".into());
            self.layout_ms.clone()
        } else {
            self.layout.clone()
        };
        RenderPipelineDescriptor {
            label: Some("pk_composite".into()),
            layout: vec![layout],
            vertex: self.fullscreen.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: self.shader.clone(),
                shader_defs,
                entry_point: Some("fragment".into()),
                targets: vec![Some(ColorTargetState {
                    format: key.format,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
            }),
            ..default()
        }
    }
}

impl SpecializedRenderPipeline for PkBloomPipeline {
    type Key = PkBloomPass;

    fn specialize(&self, key: Self::Key) -> RenderPipelineDescriptor {
        let (label, entry_point, shader_defs) = match key {
            PkBloomPass::Bright => ("pk_bloom_bright", "bright", vec![]),
            PkBloomPass::BlurH => ("pk_bloom_blur_h", "blur", vec![]),
            PkBloomPass::BlurV => ("pk_bloom_blur_v", "blur", vec!["BLUR_VERTICAL".into()]),
        };
        RenderPipelineDescriptor {
            label: Some(label.into()),
            layout: vec![self.layout.clone()],
            vertex: self.fullscreen.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: self.shader.clone(),
                shader_defs,
                entry_point: Some(entry_point.into()),
                targets: vec![Some(ColorTargetState {
                    format: BLOOM_FORMAT,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
            }),
            ..default()
        }
    }
}

fn init_pk_pipelines(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen: Res<FullscreenShader>,
    asset_server: Res<AssetServer>,
) {
    let nearest = render_device.create_sampler(&SamplerDescriptor {
        label: Some("pk_post_nearest"),
        mag_filter: FilterMode::Nearest,
        min_filter: FilterMode::Nearest,
        mipmap_filter: FilterMode::Nearest,
        ..default()
    });
    let linear = render_device.create_sampler(&SamplerDescriptor {
        label: Some("pk_post_linear"),
        mag_filter: FilterMode::Linear,
        min_filter: FilterMode::Linear,
        mipmap_filter: FilterMode::Linear,
        ..default()
    });

    // The binding order here IS the contract with composite.wgsl, and slots
    // 6/7/8 are reserved there for the albedo and UI textures so adding them
    // later never renumbers what already works.
    let composite_entries = |ms: bool| {
        BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                uniform_buffer::<PkPost>(true),
                texture_2d(TextureSampleType::Float { filterable: true }),
                sampler(SamplerBindingType::Filtering),
                texture_2d(TextureSampleType::Float { filterable: true }),
                sampler(SamplerBindingType::Filtering),
                if ms {
                    texture_depth_2d_multisampled()
                } else {
                    texture_depth_2d()
                },
            ),
        )
    };

    let composite = PkCompositePipeline {
        layout: render_device
            .create_bind_group_layout("pk_composite_layout", &composite_entries(false)),
        layout_ms: render_device
            .create_bind_group_layout("pk_composite_layout_ms", &composite_entries(true)),
        fullscreen: fullscreen.clone(),
        shader: load_embedded_asset!(asset_server.as_ref(), "composite.wgsl"),
    };

    let bloom = PkBloomPipeline {
        layout: render_device.create_bind_group_layout(
            "pk_bloom_layout",
            &BindGroupLayoutEntries::sequential(
                ShaderStages::FRAGMENT,
                (
                    texture_2d(TextureSampleType::Float { filterable: true }),
                    sampler(SamplerBindingType::Filtering),
                    sampler(SamplerBindingType::Filtering),
                ),
            ),
        ),
        fullscreen: fullscreen.clone(),
        shader: load_embedded_asset!(asset_server.as_ref(), "bloom.wgsl"),
    };

    INIT_RAN.store(true, std::sync::atomic::Ordering::Relaxed);
    commands.insert_resource(PkSamplers { nearest, linear });
    commands.insert_resource(composite);
    commands.insert_resource(bloom);
}

#[derive(Component)]
struct PkViewPipelines {
    composite: CachedRenderPipelineId,
    bright: CachedRenderPipelineId,
    blur_h: CachedRenderPipelineId,
    blur_v: CachedRenderPipelineId,
    /// The key the composite was specialised with, carried so the node picks
    /// the matching bind group layout from the SAME decision that chose the
    /// pipeline. Reading the sample count off the depth texture in the node
    /// instead would be a second source of truth for one fact, and the two
    /// could only ever disagree silently — as a bind-group/pipeline layout
    /// mismatch, which wgpu reports at draw time into a log nobody reads.
    key: PkCompositeKey,
}

fn prepare_pk_pipelines(
    mut commands: Commands,
    pipeline_cache: Res<PipelineCache>,
    mut composite_cache: ResMut<SpecializedRenderPipelines<PkCompositePipeline>>,
    mut bloom_cache: ResMut<SpecializedRenderPipelines<PkBloomPipeline>>,
    composite: Res<PkCompositePipeline>,
    bloom: Res<PkBloomPipeline>,
    views: Query<(Entity, &ExtractedView, Option<&Msaa>), With<PkPost>>,
) {
    for (entity, view, msaa) in &views {
        let key = PkCompositeKey {
            // Must track the view: `post_process_write` hands back the OTHER
            // half of the same ping-pong, so the destination format is the
            // view's main-texture format, whichever the `Hdr` marker made it.
            format: if view.hdr {
                ViewTarget::TEXTURE_FORMAT_HDR
            } else {
                TextureFormat::bevy_default()
            },
            multisampled_depth: msaa.copied().unwrap_or_default().samples() > 1,
        };
        commands.entity(entity).insert(PkViewPipelines {
            composite: composite_cache.specialize(&pipeline_cache, &composite, key),
            bright: bloom_cache.specialize(&pipeline_cache, &bloom, PkBloomPass::Bright),
            blur_h: bloom_cache.specialize(&pipeline_cache, &bloom, PkBloomPass::BlurH),
            blur_v: bloom_cache.specialize(&pipeline_cache, &bloom, PkBloomPass::BlurV),
            key,
        });
    }
}

/// Says on stderr, exactly once, whether this file's four pipelines actually
/// built — and shouts if one did not.
///
/// ⚠️ THIS IS NOT BELT-AND-BRACES, IT IS THE ONLY REPORT THERE IS. A WGSL
/// error surfaces at RUNTIME, and this binary has no `LogPlugin` (`bevy_log`
/// is not in pk-game's feature list), so `tracing` has no subscriber and
/// `PipelineCache`'s own `error!` on a failed shader module goes nowhere at
/// all. Without this, a broken composite presents as "the game looks like flat
/// 3D again" from a silent, clean-exiting process — the node simply finds no
/// pipeline and returns `Ok`. `eprintln!` deliberately, because it does not go
/// through `tracing`.
///
/// ⚠️ AND IT REPORTS SUCCESS, NOT ONLY FAILURE. A reporter that is silent when
/// the shaders work is silent when it never ran, when no view matched, and
/// when the whole plugin was left out — one observation covering four states
/// is not a check. The success line carries the facts a reader would otherwise
/// have to take on trust: the ADAPTER (software rasteriser or real GPU), the
/// destination FORMAT, whether the MSAA depth path was taken, and the
/// `depth_remap` the AO was actually calibrated with.
fn report_pk_post_status(
    pipeline_cache: Res<PipelineCache>,
    adapter: Res<bevy::render::renderer::RenderAdapterInfo>,
    // ⚠️ NO `ViewTarget` HERE. `render_system` REMOVES it from every view the
    // moment the graph has run (bevy_render `renderer/mod.rs:84`), so a query
    // for it in `Cleanup` matches nothing, always — which is exactly how the
    // first version of this reporter managed to stay silent while all four
    // pipelines were building perfectly. The destination format it was wanted
    // for is carried on `PkViewPipelines::key` instead.
    views: Query<(&PkViewPipelines, &PkPost, &ViewDepthTexture)>,
    with_post: Query<(), With<PkPost>>,
    with_pipelines: Query<&PkViewPipelines>,
    with_depth: Query<(), With<ViewDepthTexture>>,
    mut seen: Local<std::collections::HashSet<String>>,
    mut frames: Local<u32>,
) {
    *frames += 1;

    // ── THE TRIPWIRE. ────────────────────────────────────────────────────
    //
    // Silence from the success line below is ambiguous — it covers "the
    // shaders are still loading", "no view carries `PkPost`", "the RenderStartup
    // init was skipped because a `Res` it wanted did not exist yet" and "the
    // plugin was never added". Bevy reports every one of those through
    // `tracing`, which this binary does not subscribe to, so all four present
    // as a game that simply looks unposted.
    //
    // Three seconds is far past any shader load, so anything still quiet here
    // is broken, and the counts say WHICH link parted.
    if *frames == 180 && seen.is_empty() {
        let states: Vec<String> = with_pipelines
            .iter()
            .flat_map(|p| {
                [
                    ("composite", p.composite),
                    ("bright", p.bright),
                    ("blurH", p.blur_h),
                    ("blurV", p.blur_v),
                ]
            })
            .map(|(name, id)| {
                let state = match pipeline_cache.get_render_pipeline_state(id) {
                    CachedPipelineState::Queued => "queued".to_string(),
                    CachedPipelineState::Creating(_) => "creating".to_string(),
                    CachedPipelineState::Ok(_) => "ok".to_string(),
                    CachedPipelineState::Err(e) => format!("ERR({e})"),
                };
                format!("{name}={state}")
            })
            .collect();
        eprintln!(
            "pk-post: NOT LIVE after {} frames | init_ran={} | views: PkPost={} PkViewPipelines={} \
             ViewDepthTexture={} full-match={} | pipelines: [{}]",
            *frames,
            INIT_RAN.load(std::sync::atomic::Ordering::Relaxed),
            with_post.iter().count(),
            with_pipelines.iter().count(),
            with_depth.iter().count(),
            views.iter().count(),
            states.join(", "),
        );
    }

    for (pipelines, post, depth) in &views {
        let named = [
            ("composite", pipelines.composite),
            ("bloom.bright", pipelines.bright),
            ("bloom.blurH", pipelines.blur_h),
            ("bloom.blurV", pipelines.blur_v),
        ];
        let mut all_ok = true;
        for (name, id) in named {
            match pipeline_cache.get_render_pipeline_state(id) {
                CachedPipelineState::Ok(_) => {}
                // "Not ready yet", not "wrong" — the shaders are embedded
                // assets and load asynchronously, so the first frames are
                // legitimately pending.
                CachedPipelineState::Queued
                | CachedPipelineState::Creating(_)
                | CachedPipelineState::Err(
                    PipelineCacheError::ShaderNotLoaded(_)
                    | PipelineCacheError::ShaderImportNotYetAvailable,
                ) => all_ok = false,
                CachedPipelineState::Err(err) => {
                    all_ok = false;
                    let msg = format!("pk-post: pipeline `{name}` FAILED to build:\n{err}");
                    // De-duplicated: the state is re-read every frame and a
                    // compile error would otherwise scroll at 60Hz.
                    if seen.insert(msg.clone()) {
                        eprintln!("{msg}");
                    }
                }
            }
        }
        if !all_ok {
            continue;
        }
        let msg = format!(
            "pk-post: composite + bloom live | adapter={} ({:?}, {:?}) | target={:?} {}x{} \
             | depth={:?} samples={} ms_path={} | depth_remap=({}, {}) | cel={} steps={} curve={} sat={} \
             bloom={} ao={} r={} vignette={} | debug={}",
            adapter.name,
            adapter.device_type,
            adapter.backend,
            pipelines.key.format,
            post.resolution.x,
            post.resolution.y,
            depth.texture.format(),
            depth.texture.sample_count(),
            pipelines.key.multisampled_depth,
            post.depth_remap.x,
            post.depth_remap.y,
            post.cel,
            post.cel_steps,
            post.cel_curve,
            post.cel_saturation,
            post.bloom,
            post.ao,
            post.ao_radius,
            post.vignette,
            post.debug,
        );
        if seen.insert(msg.clone()) {
            eprintln!("{msg}");
        }
    }
}

/// The two half-res ping-pong targets the bloom chain lives on.
#[derive(Component)]
struct PkBloomTextures {
    a: CachedTexture,
    b: CachedTexture,
}

/// Allocated EVERY frame, even when the strength is 0.
///
/// The alternative — skipping the allocation and binding a fallback — puts
/// Bevy's 1x1 WHITE `FallbackImage` under `col += bloom * u.bloom`, which is
/// only invisible while the strength is exactly 0. Keeping the real targets
/// and having the node clear them instead means "bloom off" is a black tap,
/// not a tap that happens to be multiplied away, and it can never present
/// uninitialised `Rgba16Float` (where a stray Inf would survive the `* 0.0` as
/// a NaN and paint the frame black).
fn prepare_pk_bloom_textures(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    mut texture_cache: ResMut<TextureCache>,
    views: Query<(Entity, &bevy::render::camera::ExtractedCamera), With<PkPost>>,
) {
    for (entity, camera) in &views {
        let Some(size) = camera.physical_target_size else {
            continue;
        };
        // Exactly half; the oracle guarantees even render sizes, and `max(1)`
        // covers the degenerate 1px window a resize can produce.
        let half = (size / 2).max(UVec2::ONE);
        let descriptor = |label: &'static str| TextureDescriptor {
            label: Some(label),
            size: Extent3d {
                width: half.x,
                height: half.y,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format: BLOOM_FORMAT,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        };
        commands.entity(entity).insert(PkBloomTextures {
            a: texture_cache.get(&render_device, descriptor("pk_bloom_a")),
            b: texture_cache.get(&render_device, descriptor("pk_bloom_b")),
        });
    }
}

// ── Nodes ─────────────────────────────────────────────────────────────────

/// One fullscreen-triangle blit. Every pass in this file is one of these; the
/// only thing that differs is which pipeline and which bind group.
fn blit(
    render_context: &mut RenderContext,
    label: &'static str,
    pipeline: &bevy::render::render_resource::RenderPipeline,
    bind_group: &bevy::render::render_resource::BindGroup,
    offsets: &[u32],
    destination: &TextureView,
) {
    let mut pass = render_context
        .command_encoder()
        .begin_render_pass(&RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(RenderPassColorAttachment {
                view: destination,
                depth_slice: None,
                resolve_target: None,
                ops: Operations::default(),
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, bind_group, offsets);
    pass.draw(0..3, 0..1);
}

/// bright → blurH → blurV, over the two half-res targets, landing the halo
/// back in `a` — which is the one the composite samples. Reads the view's main
/// texture WITHOUT `post_process_write`, so the ping-pong is untouched and the
/// composite still gets the scene as its source.
#[derive(Default)]
struct PkBloomNode;

impl ViewNode for PkBloomNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static PkPost,
        &'static PkViewPipelines,
        &'static PkBloomTextures,
    );

    fn run(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext,
        (target, post, pipelines, textures): QueryItem<Self::ViewQuery>,
        world: &World,
    ) -> Result<(), NodeRunError> {
        let pipeline_cache = world.resource::<PipelineCache>();
        let samplers = world.resource::<PkSamplers>();
        let bloom = world.resource::<PkBloomPipeline>();

        // The oracle's own gate — a frame with the strength at 0 pays for
        // nothing but the clear that keeps the composite's tap honest.
        if post.bloom <= 0.001 {
            render_context
                .command_encoder()
                .begin_render_pass(&RenderPassDescriptor {
                    label: Some("pk_bloom_clear"),
                    color_attachments: &[Some(RenderPassColorAttachment {
                        view: &textures.a.default_view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: Operations {
                            load: LoadOp::Clear(LinearRgba::BLACK.into()),
                            store: StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
            return Ok(());
        }

        let (Some(bright_pipeline), Some(blur_h), Some(blur_v)) = (
            pipeline_cache.get_render_pipeline(pipelines.bright),
            pipeline_cache.get_render_pipeline(pipelines.blur_h),
            pipeline_cache.get_render_pipeline(pipelines.blur_v),
        ) else {
            return Ok(());
        };

        let bind = |source: &TextureView| {
            render_context.render_device().create_bind_group(
                None,
                &bloom.layout,
                &BindGroupEntries::sequential((source, &samplers.nearest, &samplers.linear)),
            )
        };
        let bright_bg = bind(target.main_texture_view());
        let blur_h_bg = bind(&textures.a.default_view);
        let blur_v_bg = bind(&textures.b.default_view);

        blit(
            render_context,
            "pk_bloom_bright",
            bright_pipeline,
            &bright_bg,
            &[],
            &textures.a.default_view,
        );
        blit(
            render_context,
            "pk_bloom_blur_h",
            blur_h,
            &blur_h_bg,
            &[],
            &textures.b.default_view,
        );
        blit(
            render_context,
            "pk_bloom_blur_v",
            blur_v,
            &blur_v_bg,
            &[],
            &textures.a.default_view,
        );
        Ok(())
    }
}

/// `finalNode` — one pass, source and destination from the view's own
/// ping-pong.
#[derive(Default)]
struct PkCompositeNode;

impl ViewNode for PkCompositeNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static ViewDepthTexture,
        &'static PkViewPipelines,
        &'static PkBloomTextures,
        &'static DynamicUniformIndex<PkPost>,
    );

    fn run(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext,
        (target, depth, pipelines, bloom_textures, uniform_index): QueryItem<Self::ViewQuery>,
        world: &World,
    ) -> Result<(), NodeRunError> {
        let pipeline_cache = world.resource::<PipelineCache>();
        let composite = world.resource::<PkCompositePipeline>();
        let samplers = world.resource::<PkSamplers>();

        let Some(pipeline) = pipeline_cache.get_render_pipeline(pipelines.composite) else {
            return Ok(());
        };
        let Some(uniforms) = world.resource::<ComponentUniforms<PkPost>>().uniforms().binding()
        else {
            return Ok(());
        };

        // ⚠️ CALL THIS ONCE. It FLIPS the ping-pong as a side effect, so a
        // second call in the same node would hand back a source that nothing
        // has written this frame.
        let post_process = target.post_process_write();

        // From the specialisation key, NOT from the texture — see `PkViewPipelines::key`.
        let layout = if pipelines.key.multisampled_depth {
            &composite.layout_ms
        } else {
            &composite.layout
        };
        let bind_group = render_context.render_device().create_bind_group(
            "pk_composite_bind_group",
            layout,
            &BindGroupEntries::sequential((
                uniforms,
                post_process.source,
                &samplers.nearest,
                &bloom_textures.a.default_view,
                &samplers.linear,
                depth.view(),
            )),
        );

        blit(
            render_context,
            "pk_composite",
            pipeline,
            &bind_group,
            &[uniform_index.index()],
            post_process.destination,
        );
        Ok(())
    }
}
