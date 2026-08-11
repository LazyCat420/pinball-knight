//! 🍺 THE TAVERN — the walkable between-floor hub (P6 shell).
//!
//! Every number in the scene graph below is `legacy/src/scenes/tavern/
//! build.ts` + `props.ts` verbatim (positions, sizes, palette picks, light
//! placements); the sim it renders is `pk_core::tavern` — the shell never
//! re-derives layout, movement, focus, camera or keeper math.
//!
//! Documented debt (matches the port checklist):
//!  · Props are lit flat colours + emissives — the wall textures are P3 scope.
//!    The ACTORS and the "ENTER MAZE" sign are real baked art now
//!    (`tavern_art`, from `cargo xtask bake --tavern`): keeper cels and the
//!    canvas legend, both unlit like their legacy MeshBasic originals.
//!  · Keepers render as baked cel billboards driven by the REAL ported idle
//!    loops (hammer/dart beats, greet, turn-to-face). Their contact shadow is
//!    painted into the bake; the knight's is a live blob quad.
//!  · Vendor counters / the casino cabinet / the run summary open placeholder
//!    panels: the GUI stack + economy they host are P4/P5 scope. The gambler
//!    GAME LOGIC is fully ported and tested in `pk_core::gambler`.
//!  · Audio (room tone, plunger, greet stings) is P7. VFX pools (embers,
//!    motes, sparks) are P7 — the keeper beats that drive them are ported and
//!    surfaced, the particles aren't drawn yet.
//!  · Entry: `--tavern` / `PK_SCENE=tavern` / `?tavern=1` boots straight in,
//!    and T in the dungeon stands in for the P5 run flow (death/floor-clear).
//!    DESCEND is the real hand-off: it tears the tavern down and builds a
//!    fresh dungeon floor.

use bevy::camera::ScalingMode;
use bevy::prelude::*;

use pk_core::state::Facing;
use pk_core::tavern::camera::{camera_target, ease_camera, ROOM_FOOTPRINT_TILES_H};
use pk_core::tavern::layout::{
    station_at, Rect as LRect, Station, StationKind, KEEPER_SPOTS, OBSTACLES, ROOM_D, ROOM_MAX_X,
    ROOM_MAX_Z, ROOM_MIN_X, ROOM_MIN_Z, ROOM_W, STAIR, STATIONS, WALL_HEIGHT,
};
use pk_core::tavern::npcs::{build_keeper_states, update_keeper, KeeperBeat, KeeperState};
use pk_core::tavern::player::{step_tavern_movement, TavernInput, TavernPose, WALK_CLIP_THRESHOLD};
use pk_core::tavern::state::{read_diorama, DioramaState, TavernStats};
use pk_gui::screens::tavern::{PanelView, StationView, SummaryView};

use crate::gui::{set_view, Gui, GuiViews, ScreenId};
use crate::post::snap::PixelSnapped;
use crate::sfx::SfxEvent;
use crate::tavern_art::{self, BLOB_UNITS, SPRITE_UNITS};
use crate::{camera_offset, AppState, DungeonCamera, KnightArt, VIEW_H};
use pk_core::economy::alchemist::{
    brew, buy_flask, buy_potion, can_craft, Satchel, POTION_STOCK, PRICE_FLASK, REAGENT_IDS,
    RECIPES,
};
use pk_core::economy::armory::{Loadout, ELEMENTAL_STYLE_IDS, GEAR_SLOTS, PRICE_REPAIR_GEAR};
use pk_core::economy::Wallet;
use pk_gui::screens::alchemist::{
    AlchTab, AlchemistAction, AlchemistView, PouchChip, RecipeRow, ShelfRow,
};
use pk_gui::screens::armory::{ArmoryAction, ArmoryView, PlateRow, StyleRow};

// ── Palette picks (legacy build.ts / props.ts, by Cold Crypt index) ──
const STONE_DK: u32 = 0x171a22; // [1]
const STONE: u32 = 0x2b303b; // [2]
const TIMBER: u32 = 0x2a1c14; // [26]
const TIMBER_DK: u32 = 0x4a3222; // [27]
const FLAME: u32 = 0xf0a63c; // [16]
const STEEL: u32 = 0x8a94a6; // [20]
const STEEL_DK: u32 = 0x544e63; // [19]
const BRASS: u32 = 0xd97b29; // [15]
const BLOOD: u32 = 0x6b1f2a; // [11]
const WARM: u32 = 0xf0a63c;
const COLD: u32 = 0x6fd0e8;
const GOLD: u32 = 0xf0c040;

/// legacy constants/render.ts — the dungeon rig the tavern's overrides scale.
const AMBIENT_INTENSITY: f32 = 3.5;
const HEMI_INTENSITY: f32 = 1.1;
const DIR_INTENSITY: f32 = 1.5;
const DIR_HEIGHT: f32 = 14.0;

// ── THREE → BEVY LIGHT UNITS ────────────────────────────────────────────────
//
// Every constant below is DERIVED from the oracle's value, not tuned. They used
// to be hand-fudged by screenshot, which was fine while nothing downstream read
// absolute magnitude — and stopped being fine the moment the pixel pass landed,
// because the bloom bright-pass thresholds LINEAR LUMA AT 0.7 and the cel grade
// posterises absolute luma. A rig that is merely "about right on average" then
// blows every pool it over-drives past the threshold. Measured on the blown
// rig: mean luma matched the oracle to 0.8% while the port clipped 6.3x as many
// pixels and its fire pool carried 0.71 saturation against the oracle's 0.52.
//
// The three conversions, from bevy_pbr 0.17.3 and three.js r160+:
//
//   POINT      three: irradiance = color * intensity(cd) * atten
//              bevy:  irradiance = color * (intensity(lm) / 4π) * atten * EXPOSURE
//                     (`render/light.rs:409` does the /4π; `pbr_functions.wgsl:744`
//                      does the exposure)
//              → lumens = candela * 4π / exposure
//   DIRECTIONAL three: irradiance = color * intensity
//              bevy:  irradiance = color * illuminance * EXPOSURE
//              → illuminance = intensity / exposure
//   AMBIENT    three: `RE_IndirectDiffuse_Physical` → irradiance * albedo/π
//              bevy:  `ambient.wgsl` → EnvBRDFApprox(albedo, F_AB(1, NdotV))
//                     * color * brightness * EXPOSURE, and that fit reduces to
//                     `albedo * 0.4524 - 0.0024` at roughness 1 — NdotV drops
//                     out because F_AB's `r.x` is exactly 0 there. Bevy is
//                     1.42x more efficient per unit of ambient than a Lambert
//                     1/π, so it needs proportionally fewer units.
//              → brightness = intensity / (π * 0.4524) / exposure
//
// The falloff SHAPE needs no correction and never did: three's
// `getDistanceAttenuation(d, cutoff, decay=2)` is `(1 - (d/cutoff)^4)² / d²`,
// and bevy's `getDistanceAttenuation(d², 1/range²)` is the same expression with
// `range` for `cutoff`. So every `distance` in core.ts/props.ts is a `range`
// here, one for one, and the over-brightness was never the falloff.
// `EXPOSURE_RECIP`, `PL`, `c()` and `billboard()` moved to `crate::units` when
// the dungeon needed the same conversions — one definition, so the two scenes
// cannot drift into being lit by two different candela→lumen constants. The
// derivations moved with them.
use crate::units::{billboard, c, EXPOSURE_RECIP, PL};
/// Bevy's ambient DIFFUSE env-BRDF response at roughness 1 (`ambient.wgsl`,
/// `EnvBRDFApprox` with `F_AB(1.0, _) = (0.4524, -0.0024)`), where three uses
/// Lambert's `1/π`.
const AMBIENT_ENV_BRDF: f32 = 0.4524;
/// …and Bevy's ambient SPECULAR term, which three.js has no counterpart for.
///
/// ⚠ THIS IS THE TERM THAT MAKES THE TWO ENGINES' AMBIENTS DIFFERENT IN KIND,
/// NOT JUST IN UNITS. `ambient.wgsl` adds
/// `EnvBRDFApprox(F0, F_AB(roughness,·)) · specular_occlusion` on top of the
/// diffuse response. For this room's dielectrics — `reflectance` at Bevy's
/// default 0.5, so `F0 = 0.16 · 0.5² = 0.04`, and
/// `specular_occlusion = saturate(0.04·3·16.5) = 1` — that is
/// `0.04 · 0.4794 − 0.0019` ≈ 0.0172, of which 0.0148 is left after the
/// diffuse fit's own −0.0024 offset. three.js's
/// `RE_IndirectSpecular_Physical` takes its radiance from an environment map,
/// and this scene has none, so three contributes EXACTLY ZERO here.
///
/// It matters because it is ACHROMATIC AND ALBEDO-INDEPENDENT: it lays the
/// ambient's own colour on every surface at a fixed 0.0148, while this room's
/// albedos are 0.016-0.07 in linear. On the floor (`TIMBER_DK`, linear
/// (0.068, 0.032, 0.016)) it is 48% of the blue response and 32% of the red,
/// which halves the floor's warm/cold ratio from the albedo's 4.28 to 2.08.
/// Measured, before this term was accounted for: the port's floor read
/// rgb(81,60,52) against the oracle's rgb(90,58,42) — the same LUMA to within
/// half a percent, and half the warm cast.
const AMBIENT_SPECULAR_PEDESTAL: f32 = 0.0148;
/// The albedo the ambient is calibrated ON, in luma.
///
/// A pedestal that does not scale with albedo cannot be cancelled at every
/// albedo by one brightness — so it has to be cancelled at the one that fills
/// the frame. This room is floor and wall: `TIMBER_DK` at 0.0385 luma and
/// `STONE` at 0.0294. Everything brighter than this in the room is emissive or
/// unlit (screens, the sign, the marquee) and takes no ambient at all.
const ROOM_ALBEDO_LUMA: f32 = 0.034;
/// The hemisphere light's average irradiance as a fraction of the ambient's,
/// per channel — see the fold-in at `setup_tavern`. Bevy has no hemisphere
/// light, and `mix(ground, sky, 0.5·N·up + 0.5)` averages to the plain midpoint
/// of sky and ground over a uniform distribution of normals, so the whole
/// fixture collapses into the ambient term. Sky `0xb2c0d6` and ground
/// `0x4a3324` average in LINEAR to (0.257, 0.280, 0.345) against the ambient
/// `0x99a0b2`'s (0.319, 0.352, 0.445) — a ratio of 0.806/0.796/0.775, i.e. the
/// same tint to under 2%. That is why one ambient can carry both: the
/// hemisphere's blue sky and warm timber bounce cancel back to the ambient's
/// own colour, so only the MAGNITUDE has to move.
const HEMI_OVER_AMBIENT: f32 = 0.79;

/// The linear-RGB emissive of a THREE `MeshStandardMaterial { emissive: color,
/// emissiveIntensity: intensity }` — which is `linear(color) * intensity` and
/// NOTHING ELSE (`WebGLLights` premultiplies the intensity into the uniform;
/// the shader adds it straight to the outgoing radiance).
///
/// ⚠ NO GAIN TERM, AND THAT IS THE FIX. This used to carry a `* 4.0` that was
/// pure guess, and Bevy does NOT scale emissive by the camera exposure the way
/// it scales lit surfaces (`emissive_exposure_weight` defaults to 0.0, so
/// `pbr_functions.wgsl:721`'s `mix(1.0, exposure, emissive.a)` returns 1.0) —
/// so that 4x landed on the HDR buffer undiluted. The hearth's flame quads at
/// `FLAME, 0.85` went in at linear (2.96, 1.30, 0.15): red nearly 3x past white,
/// luma 1.57 against a bloom bright-pass that thresholds at 0.7. At 1:1 they go
/// in at (0.74, 0.32, 0.04), luma 0.39, and the only thing in the room that
/// still crosses the threshold is the forge's coals — which is exactly the
/// oracle's design (props.ts:388-391 records dropping the marquee from 0.95 to
/// 0.22 for this same reason: "the pixel pass's bloom takes an emissive this
/// large well past the palette's gold and into paper").
fn emissive_rgb(color: u32, intensity: f32) -> LinearRgba {
    c(color).to_linear() * intensity
}

pub struct TavernPlugin;

/// The tavern's per-frame work, named as a set so the GUI layer can paint
/// AFTER it. Without the ordering the menu is one frame stale on every press —
/// which reads as input lag, not as a scheduling bug.
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct TavernSystems;

impl Plugin for TavernPlugin {
    fn build(&self, app: &mut App) {
        // Lazy Update setup, NOT OnEnter: a `?tavern=1` boot makes Tavern the
        // initial state, whose OnEnter fires before Startup has applied its
        // commands — a Res<KnightArt> param there fails validation (measured
        // on the intro: wasm panic on boot). Resource guards make entry order
        // irrelevant, exactly as `setup_dungeon` does it.
        app.add_systems(
            Update,
            setup_tavern
                .run_if(in_state(AppState::Tavern))
                .run_if(resource_exists::<KnightArt>)
                .run_if(not(resource_exists::<TavernRes>)),
        )
        .add_systems(OnExit(AppState::Tavern), teardown_tavern)
        .add_systems(
            FixedUpdate,
            step_tavern
                .run_if(in_state(AppState::Tavern))
                .run_if(resource_exists::<TavernRes>),
        )
        .add_systems(
            Update,
            (
                gather_tavern_input,
                tavern_frame,
                sync_tavern_knight,
                tavern_camera,
            )
                .chain()
                .in_set(TavernSystems)
                .run_if(in_state(AppState::Tavern))
                .run_if(resource_exists::<TavernRes>),
        );
    }
}

/// Which overlay owns the screen — movement and interaction freeze while set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Summary,
    Vendor(&'static str),
    Gambler,
}

#[derive(Resource)]
pub struct TavernRes {
    pub pose: TavernPose,
    prev: (f64, f64),
    curr: (f64, f64),
    input: TavernInput,
    pub cam: (f64, f64),
    /// Seconds since the scene opened — drives flicker, bob and the diorama.
    pub time: f64,
    pub focus: Option<&'static Station>,
    pub open_panel: Option<Panel>,
    /// The run's plate and the permanent sets. `pk_core::economy` owns the
    /// rules; persistence is P5 (the oracle keeps styles + gold in
    /// localStorage, and the port has made no persistence decision yet — see
    /// the 1:1 plan's track F).
    pub loadout: Loadout,
    pub wallet: Wallet,
    /// The run's belt, pouch and flasks — the alchemist's half of the economy.
    /// RUN-scoped in the oracle (`reagents.ts`), so it lives beside the loadout
    /// and not in the wallet.
    pub satchel: Satchel,
    /// Which half of the alchemist's counter is open, and which recipe its
    /// detail strip is describing. Both belong to THIS VISIT, exactly like the
    /// oracle's `TavernUi.alchTab` — a screen that owned them would forget the
    /// tab every time the sheet repainted.
    pub alch_tab: AlchTab,
    pub alch_selected: usize,
    /// The counter's last `ActionResult`, flashed under its heading.
    pub shop_message: Option<String>,
    pub stats: TavernStats,
    diorama: DioramaState,
    /// Integrated, not derived from the clock, so a speed change never
    /// teleports the ball across the playfield.
    ball_angle: f64,
    keepers: Vec<KeeperState>,
}

// ── Scene tags ──
#[derive(Component)]
struct TavernScene;
#[derive(Component)]
struct TavernKnight;
/// The tavern's OWN masked copies of the three knight sheet materials, carried
/// on the knight so `sync_tavern_knight` animates the material it actually
/// assigned (see the spawn block for why the shared ones can't be used).
#[derive(Component)]
struct TavernKnightMats {
    s: Handle<StandardMaterial>,
    e: Handle<StandardMaterial>,
    n: Handle<StandardMaterial>,
}
/// The flat contact shadow under the knight; follows him every frame.
#[derive(Component)]
struct KnightBlob;
#[derive(Component)]
struct KeeperSprite(usize);
#[derive(Component)]
struct SpotlightDisc;
/// A station's accent light, keyed by station id; base intensity remembered
/// for the focus breathe (stations.ts).
#[derive(Component)]
struct AccentLight {
    station: &'static str,
    base: f32,
}
#[derive(Component)]
struct FireLight;
#[derive(Component)]
struct FlameQuad(usize);
#[derive(Component)]
struct BumperCap(usize);
#[derive(Component)]
struct DioramaBall;
#[derive(Component)]
struct Coals;
/// How far the contact blob floats above the feet (legacy sprite.ts:170).
const BLOB_LIFT: f32 = 0.02;

/// The knight quad's height. Centre-origin (unlike the keepers'), so his feet
/// sit half of this below his transform — which is where the blob goes.
const KNIGHT_QUAD_H: f32 = 1.15;

/// A knight sheet material re-cut with `alphaTest` instead of blending. The
/// source lives in `KnightArt` and is shared with the dungeon and the intro,
/// so the tavern clones rather than mutates.
fn masked_clone(
    materials: &mut Assets<StandardMaterial>,
    src: &Handle<StandardMaterial>,
) -> Handle<StandardMaterial> {
    match materials.get(src).cloned() {
        Some(mut m) => {
            m.alpha_mode = AlphaMode::Mask(0.5);
            materials.add(m)
        }
        // Unreachable: the sheets are built in Startup and this scene is gated
        // on `KnightArt`. Degrade to the shared (blended) material rather than
        // panicking a live room.
        None => src.clone(),
    }
}

/// The boot gate: does this launch want the tavern directly? Mirrors the
/// intro's flag styles (native flag/env; wasm query param).
pub fn tavern_boot_gate() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::eval("location.search")
            .ok()
            .and_then(|v| v.as_string())
            .map(|s| s.contains("tavern=1"))
            .unwrap_or(false)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::env::args().any(|a| a == "--tavern")
            || std::env::var("PK_SCENE")
                .map(|v| v == "tavern")
                .unwrap_or(false)
    }
}

struct Build<'w, 's, 'a> {
    commands: &'a mut Commands<'w, 's>,
    meshes: &'a mut Assets<Mesh>,
    materials: &'a mut Assets<StandardMaterial>,
    /// The baked art (`tavern_art`) is decoded straight into `Assets<Image>` —
    /// no `bevy_asset` io on either target, same as the knight sheets.
    images: &'a mut Assets<Image>,
}

impl Build<'_, '_, '_> {
    fn mat(&mut self, color: u32) -> Handle<StandardMaterial> {
        self.materials.add(StandardMaterial {
            base_color: c(color),
            perceptual_roughness: 0.95,
            metallic: 0.05,
            ..default()
        })
    }
    fn metal(&mut self, color: u32, metallic: f32, roughness: f32) -> Handle<StandardMaterial> {
        self.materials.add(StandardMaterial {
            base_color: c(color),
            metallic,
            perceptual_roughness: roughness,
            ..default()
        })
    }
    fn emissive(&mut self, color: u32, intensity: f32) -> Handle<StandardMaterial> {
        self.materials.add(StandardMaterial {
            base_color: c(color),
            emissive: emissive_rgb(color, intensity),
            perceptual_roughness: 0.4,
            ..default()
        })
    }
    fn boxed(
        &mut self,
        w: f64,
        h: f64,
        d: f64,
        m: Handle<StandardMaterial>,
        x: f64,
        y: f64,
        z: f64,
    ) -> Entity {
        self.commands
            .spawn((
                TavernScene,
                Mesh3d(self.meshes.add(Cuboid::new(w as f32, h as f32, d as f32))),
                MeshMaterial3d(m),
                Transform::from_xyz(x as f32, y as f32, z as f32),
            ))
            .id()
    }
    fn cyl(
        &mut self,
        r: f64,
        h: f64,
        m: Handle<StandardMaterial>,
        x: f64,
        y: f64,
        z: f64,
    ) -> Entity {
        self.commands
            .spawn((
                TavernScene,
                Mesh3d(self.meshes.add(Cylinder::new(r as f32, h as f32))),
                MeshMaterial3d(m),
                Transform::from_xyz(x as f32, y as f32, z as f32),
            ))
            .id()
    }
    /// A station's accent light — the colour-coded "you can use this" tell.
    fn accent(&mut self, id: &'static str, color: u32, x: f64, y: f64, z: f64, intensity: f32) {
        self.commands.spawn((
            TavernScene,
            AccentLight {
                station: id,
                base: intensity * PL,
            },
            PointLight {
                color: c(color),
                intensity: intensity * PL,
                range: 6.0,
                shadows_enabled: false,
                ..default()
            },
            Transform::from_xyz(x as f32, y as f32, z as f32),
        ));
    }
    fn point(&mut self, color: u32, intensity: f32, range: f32, x: f64, y: f64, z: f64) {
        self.commands.spawn((
            TavernScene,
            PointLight {
                color: c(color),
                intensity: intensity * PL,
                range,
                shadows_enabled: false,
                ..default()
            },
            Transform::from_xyz(x as f32, y as f32, z as f32),
        ));
    }
}

// A Bevy system's "arguments" are its resource/query bindings, not a call
// signature anyone has to type out.
#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
fn setup_tavern(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut ambient: ResMut<AmbientLight>,
    art: Res<KnightArt>,
    mut cam_q: Query<&mut Projection, With<DungeonCamera>>,
    mut fade_q: Query<&mut BackgroundColor, With<crate::FadeOverlay>>,
    mut sfx: MessageWriter<SfxEvent>,
) {
    // The intro's black hold ends the moment the room exists — the tavern is
    // now the hand-off target, so without this the hub boots behind a black
    // screen and reads as a hang (legacy setIntroFade(0) after onDone()).
    for mut bg in &mut fade_q {
        bg.0 = Color::srgba(0.0, 0.0, 0.0, 0.0);
    }

    // Room tone up over 1.2s: the hearth's filtered noise and a 54 Hz hum.
    // Idempotent, so re-entering the hub does not stack a second bed.
    sfx.write(SfxEvent::TavernEnter);

    // ── Camera: hold the whole staged room (legacy fitZoom's intent) ──
    for mut proj in &mut cam_q {
        if let Projection::Orthographic(o) = &mut *proj {
            o.scaling_mode = ScalingMode::FixedVertical {
                viewport_height: ROOM_FOOTPRINT_TILES_H as f32,
            };
        }
    }

    // ── Light rig (core.ts): warm/cold contrast is the navigation aid ──
    // Brighter than the dungeon's rig, not dimmer — this is a safehouse.
    //
    // ONE ambient carries TWO of the oracle's fixtures: its own
    // `AmbientLight(0x99a0b2, 3.5 * 3.2)` and the `HemisphereLight(sky
    // 0xb2c0d6, ground 0x4a3324, 1.1 * 2.6)` that Bevy has no equivalent for.
    // See `HEMI_OVER_AMBIENT` for why that fold-in costs no hue: the two
    // fixtures' tints agree to under 2% once the hemisphere is averaged.
    ambient.color = c(0x99a0b2);
    ambient.brightness = (AMBIENT_INTENSITY * 3.2 + HEMI_INTENSITY * 2.6 * HEMI_OVER_AMBIENT)
        / (std::f32::consts::PI
            * (AMBIENT_ENV_BRDF + AMBIENT_SPECULAR_PEDESTAL / ROOM_ALBEDO_LUMA))
        * EXPOSURE_RECIP;
    commands.spawn((
        TavernScene,
        DirectionalLight {
            color: c(0xdccbb2),
            illuminance: DIR_INTENSITY * 1.35 * EXPOSURE_RECIP,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_xyz(-6.0, DIR_HEIGHT, -4.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    // Two soft fills over the halves no fixture reaches (SW quarter + south spine).
    let mut b = Build {
        commands: &mut commands,
        meshes: &mut meshes,
        materials: &mut materials,
        images: &mut images,
    };
    b.point(0xffb271, 3.4, 16.0, -4.5, 3.6, 2.6);
    b.point(0xd9b48c, 2.8, 15.0, 1.5, 3.6, 4.4);

    // ══ ROOM SHELL (build.ts) ══
    let floor_mat = b.mat(TIMBER_DK);
    let cx = (ROOM_MIN_X + ROOM_MAX_X) / 2.0;
    let cz = (ROOM_MIN_Z + ROOM_MAX_Z) / 2.0;
    b.boxed(ROOM_W, 0.02, ROOM_D, floor_mat, cx, -0.01, cz); // plank floor
    let runner = b.mat(STONE_DK);
    b.boxed(3.2, 0.02, ROOM_D - 1.0, runner, 0.0, 0.005, 0.0); // spine inlay

    // Walls: only the two the fixed camera can see, plus knee-high near rims.
    let wall = b.mat(STONE);
    b.boxed(
        ROOM_W + 1.0,
        WALL_HEIGHT,
        0.5,
        wall.clone(),
        0.0,
        WALL_HEIGHT / 2.0,
        ROOM_MIN_Z - 0.25,
    );
    b.boxed(
        0.5,
        WALL_HEIGHT,
        ROOM_D + 1.0,
        wall,
        ROOM_MIN_X - 0.25,
        WALL_HEIGHT / 2.0,
        0.0,
    );
    let rim = b.mat(STONE_DK);
    b.boxed(
        ROOM_W + 1.0,
        0.5,
        0.5,
        rim.clone(),
        0.0,
        0.25,
        ROOM_MAX_Z + 0.25,
    );
    b.boxed(0.5, 0.5, ROOM_D + 1.0, rim, ROOM_MAX_X + 0.25, 0.25, 0.0);
    // NO ceiling beams — under a fixed iso camera they project as black bars.

    // ── Hearth — the room's warm anchor, set into the west wall ──
    let hearth_x = ROOM_MIN_X + 0.5;
    let stone_m = b.mat(STONE);
    b.boxed(1.0, 2.4, 3.0, stone_m, hearth_x, 1.2, 0.2); // surround
    let timber_m = b.mat(TIMBER);
    b.boxed(1.3, 0.24, 3.4, timber_m, hearth_x, 2.5, 0.2); // mantel
    let firebox = b.mat(0x120c08);
    b.boxed(0.5, 1.4, 2.0, firebox, hearth_x + 0.35, 0.7, 0.2); // firebox
    let flame_m = b.emissive(FLAME, 0.85);
    for i in 0..3usize {
        let e = b.boxed(
            0.5,
            0.8,
            0.02,
            flame_m.clone(),
            hearth_x + 0.5,
            0.45,
            0.2 + (i as f64 - 1.0) * 0.55,
        );
        b.commands.entity(e).insert((
            FlameQuad(i),
            Transform {
                translation: Vec3::new(
                    (hearth_x + 0.5) as f32,
                    0.45,
                    (0.2 + (i as f64 - 1.0) * 0.55) as f32,
                ),
                rotation: Quat::from_rotation_y(std::f32::consts::FRAC_PI_2),
                ..default()
            },
        ));
    }
    b.commands.spawn((
        TavernScene,
        FireLight,
        PointLight {
            color: c(WARM),
            intensity: 9.0 * PL,
            range: 14.0,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_xyz((hearth_x + 1.0) as f32, 1.5, 0.2),
    ));

    // ── The way back down — stone stairwell at the south wall ──
    let stair_m = b.mat(STONE_DK);
    for i in 0..4 {
        b.boxed(
            STAIR.w,
            0.22,
            0.42,
            stair_m.clone(),
            STAIR.x,
            0.11 - f64::from(i) * 0.14,
            STAIR.z + f64::from(i) * 0.34,
        );
    }
    let mouth = b.mat(0x05070b);
    let mouth_e = b.boxed(
        STAIR.w - 0.2,
        0.02,
        0.9,
        mouth,
        STAIR.x,
        0.05,
        STAIR.z + 1.05,
    );
    b.commands
        .entity(mouth_e)
        .entry::<Transform>()
        .and_modify(|mut t| t.rotation = Quat::from_rotation_x(-0.55));

    // ══ PROPS (props.ts) ══
    build_props(&mut b);

    // ── Spotlight disc (stations.ts) ──
    let disc_m = b.materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 1.0, 1.0, 0.0),
        alpha_mode: AlphaMode::Blend,
        unlit: true,
        ..default()
    });
    b.commands.spawn((
        TavernScene,
        SpotlightDisc,
        Mesh3d(b.meshes.add(Cylinder::new(1.15, 0.01))),
        MeshMaterial3d(disc_m),
        Transform::from_xyz(0.0, 0.03, 0.0),
        Visibility::Hidden,
    ));

    // ── Keepers — the BAKED cels, driven by the real ported idle loops ──
    // One 1.5-unit quad each with a BOTTOM-CENTRE origin (legacy sprite.ts
    // `staticGeometry` translates the shared plane up by SPRITE_UNITS/2), so
    // the idle loops keep positioning them by the feet and the baked
    // billboard rotation pivots where legacy's does. The mesh is shared; only
    // the material is per-keeper, exactly as sprite.ts:1677-1697 explains.
    let keeper_states = build_keeper_states();
    let keeper_mesh = b.meshes.add(
        Mesh::from(Rectangle::new(SPRITE_UNITS, SPRITE_UNITS)).translated_by(Vec3::new(
            0.0,
            SPRITE_UNITS / 2.0,
            0.0,
        )),
    );
    for (i, k) in keeper_states.iter().enumerate() {
        // Missing art is never fatal — the room just loses a body (npcs.ts).
        let Some(cel) = tavern_art::keeper_cel(k.spec.paint_key) else {
            continue;
        };
        let tex = b.images.add(cel);
        let m = b.materials.add(StandardMaterial {
            base_color_texture: Some(tex),
            unlit: true,
            // legacy `alphaTest: 0.5`. Mask, never Blend: the frame is
            // nearest-sampled at low resolution by the pixel pass, where
            // Blend's soft fringes band into halos around every keeper.
            alpha_mode: AlphaMode::Mask(0.5),
            // THREE.DoubleSide — the mirror flips the quad's winding.
            cull_mode: None,
            double_sided: true,
            ..default()
        });
        b.commands.spawn((
            TavernScene,
            KeeperSprite(i),
            Mesh3d(keeper_mesh.clone()),
            MeshMaterial3d(m),
            Transform {
                translation: Vec3::new(k.spec.x as f32, 0.0, k.spec.z as f32),
                rotation: billboard(0.0),
                scale: Vec3::new(k.spec.home as f32, 1.0, 1.0),
            },
            // Authored texels land on whole render pixels (post::snap).
            PixelSnapped,
        ));
        // NO contact-shadow quad: the keepers' ground shadow is painted into
        // the bake.
    }

    // ── The knight billboard — same sheets as the dungeon slice, MASKED ──
    // The shared `KnightArt` materials are AlphaMode::Blend and are used by
    // three scenes, so the tavern takes a CLONE with `Mask(0.5)` (legacy
    // alphaTest 0.5) rather than editing the shared art in main.rs. The
    // dungeon and the intro keep Blend until their own parity pass.
    // `sync_tavern_knight` must animate THE CLONE — hence the component below;
    // driving `art.*.material` would leave these frozen on frame 0.
    let quad_w = KNIGHT_QUAD_H * art.s.aspect;
    let spawn = TavernPose::spawn();
    let knight_mats = TavernKnightMats {
        s: masked_clone(b.materials, &art.s.material),
        e: masked_clone(b.materials, &art.e.material),
        n: masked_clone(b.materials, &art.n.material),
    };
    b.commands.spawn((
        TavernScene,
        TavernKnight,
        Mesh3d(b.meshes.add(Rectangle::new(quad_w, KNIGHT_QUAD_H))),
        MeshMaterial3d(knight_mats.s.clone()),
        Transform::from_xyz(spawn.x as f32, KNIGHT_QUAD_H / 2.0, spawn.z as f32),
        knight_mats,
        PixelSnapped,
    ));

    // The knight's contact shadow — the blob legacy parents to every actor
    // (sprite.ts:160-173). Flat on the floor, 2 cm above the feet, so the
    // billboard reads as standing ON the ground rather than in front of it.
    // A sibling that follows rather than a child, because the parent's baked
    // billboard rotation would otherwise have to be counter-rotated out.
    let blob_tex = b.images.add(tavern_art::blob_image());
    let blob_mat = b.materials.add(StandardMaterial {
        base_color_texture: Some(blob_tex),
        unlit: true,
        alpha_mode: AlphaMode::Blend, // a soft gradient — masking it would ring
        cull_mode: None,
        ..default()
    });
    b.commands.spawn((
        TavernScene,
        KnightBlob,
        Mesh3d(b.meshes.add(Rectangle::new(BLOB_UNITS, BLOB_UNITS))),
        MeshMaterial3d(blob_mat),
        Transform {
            translation: Vec3::new(spawn.x as f32, BLOB_LIFT, spawn.z as f32),
            rotation: Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2),
            ..default()
        },
        PixelSnapped,
    ));

    // ── Prompt + panels ──
    //
    // Nothing is spawned here any more. Both used to be Bevy `Text` nodes with
    // hand-rolled chrome; they are now screens on the GUI stack, painted by the
    // ported legacy toolkit (`gui.rs` → `pk_gui::screens::tavern`). The room
    // owns WHAT they say; it does not own how a sheet looks.

    // ── Scene state ──
    let stats = TavernStats::default();
    let diorama = read_diorama(&stats, 5);
    commands.insert_resource(TavernRes {
        prev: (spawn.x, spawn.z),
        curr: (spawn.x, spawn.z),
        cam: (spawn.x, spawn.z),
        pose: spawn,
        input: TavernInput::default(),
        time: 0.0,
        focus: None,
        open_panel: None,
        loadout: Loadout::default(),
        // ⚠️ A STARTING PURSE, NOT A MEASUREMENT. The oracle's balance is a
        // persisted wallet; until the port has one, an empty purse would grey
        // out every button on the counter and make it untestable by hand.
        wallet: Wallet::new(1200),
        // A stocked pouch until the dungeon's drops are wired (P4): an empty
        // brew book is a screen nobody can tell from a broken one. The counts
        // are a DEV STOCK and are marked as such wherever they are read.
        satchel: dev_satchel(),
        alch_tab: AlchTab::Shelf,
        alch_selected: 0,
        shop_message: None,
        stats,
        diorama,
        ball_angle: 0.0,
        keepers: keeper_states,
    });
}

/// A pouch with something in it, until the dungeon's reagent drops are wired.
///
/// ⚠️ **DEV STOCK, NOT A RULE.** `ENEMY_DROPS` (reagents.ts) is what fills a
/// real pouch and it is P4 — until then the brew book would be sixteen greyed
/// tiles, which is indistinguishable from a broken screen. Two of everything
/// and two flasks makes the cheap half of the book craftable and leaves the
/// Elixir (a Grim Bone, an Ectoplasm, two Slime Gel, TWO flasks and 40g)
/// showing what "not yet" looks like.
fn dev_satchel() -> Satchel {
    let mut s = Satchel {
        flasks: 2,
        ..Satchel::default()
    };
    for id in REAGENT_IDS {
        s.add_reagent(id, 2);
    }
    s
}

/// Station props — every number is props.ts verbatim; secondary dressing is
/// kept where it carries the silhouette and dropped where the pixel pass was
/// doing the reading (documented P3 debt).
#[allow(clippy::too_many_lines)]
fn build_props(b: &mut Build) {
    let cab = b.mat(TIMBER_DK);
    let chrome = b.metal(STEEL, 0.9, 0.2);
    let brass = b.metal(BRASS, 0.8, 0.3);

    // ══ CENTRAL PINBALL TABLE — the run diorama, and the room's thesis ══
    let t = &OBSTACLES[0]; // { x: 0, z: -1.6, w: 2.3, d: 3.2 }
    let rake = 0.2f64;
    let cab_bot = 0.5f64;
    let deck_front = 1.02f64;
    let deck_back = deck_front + t.d * libm::sin(rake);
    let side_lip = 0.16f64;
    let side_top_back = deck_back + side_lip;

    // Legs: four, equal, chrome.
    for sx in [-1.0f64, 1.0] {
        for sz in [-1.0f64, 1.0] {
            b.boxed(
                0.14,
                cab_bot,
                0.14,
                chrome.clone(),
                t.x + sx * (t.w / 2.0 - 0.12),
                cab_bot / 2.0,
                t.z + sz * (t.d / 2.0 - 0.12),
            );
        }
    }
    // The cabinet as a WEDGE: raked side panels (extrude → rotated cuboid
    // approximation, P3 debt), back/front panels, floor pan, lockdown bar.
    let side_len = t.d / libm::cos(rake);
    for sx in [-1.0f64, 1.0] {
        let e = b.boxed(
            0.14,
            side_top_back - cab_bot,
            side_len,
            cab.clone(),
            t.x + sx * (t.w / 2.0 - 0.07),
            (cab_bot + side_top_back) / 2.0 - 0.12,
            t.z,
        );
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(move |mut tr| tr.rotation = Quat::from_rotation_x(rake as f32));
    }
    b.boxed(
        t.w,
        side_top_back - cab_bot,
        0.14,
        cab.clone(),
        t.x,
        (cab_bot + side_top_back) / 2.0,
        t.z - t.d / 2.0 + 0.07,
    );
    b.boxed(
        t.w,
        deck_front + side_lip - cab_bot,
        0.14,
        cab.clone(),
        t.x,
        (cab_bot + deck_front + side_lip) / 2.0,
        t.z + t.d / 2.0 - 0.07,
    );
    let pan = b.mat(0x141018);
    b.boxed(t.w, 0.1, t.d, pan, t.x, cab_bot + 0.05, t.z);
    b.boxed(
        t.w + 0.04,
        0.1,
        0.16,
        brass.clone(),
        t.x,
        deck_front + side_lip,
        t.z + t.d / 2.0 - 0.08,
    );

    // The playfield — raked deck, lit from within.
    let f_w = (t.w - 0.28) / 2.0;
    let f_d = t.d / libm::cos(rake) / 2.0;
    let deck_m = b.materials.add(StandardMaterial {
        base_color: c(0x14283a),
        // props.ts:295 `emissiveIntensity: 0.6` — the 2.4 here was the same
        // guessed 4x gain as `Build::emissive`'s, inlined.
        emissive: emissive_rgb(0x0d2233, 0.6),
        perceptual_roughness: 0.4,
        ..default()
    });
    let deck_y = (deck_front + deck_back) / 2.0;
    let deck = b.boxed(f_w * 2.0, 0.06, f_d * 2.0, deck_m, t.x, deck_y, t.z);
    b.commands
        .entity(deck)
        .entry::<Transform>()
        .and_modify(move |mut tr| tr.rotation = Quat::from_rotation_x(rake as f32));

    // Lit bumper caps — ONE MATERIAL PER CAP (the legacy shared-material bug
    // made five caps pulse in unison; the loop drives these individually).
    // Field-space (x, z) offsets projected onto the raked deck.
    let caps = [
        (-0.5, -0.95),
        (0.48, -1.0),
        (0.0, -0.55),
        (-0.55, -0.1),
        (0.52, -0.15),
    ];
    for (i, (bx, bz)) in caps.iter().enumerate() {
        let m = b.emissive(COLD, 0.5);
        let y = deck_y + (-bz) * libm::sin(rake) + 0.12;
        let e = b.cyl(0.15, 0.16, m, t.x + bx, y, t.z + bz * libm::cos(rake));
        b.commands.entity(e).insert(BumperCap(i));
    }
    // Flippers at the near end, brass, splayed into the drain.
    for sx in [-1.0f64, 1.0] {
        let flipper_m = b.emissive(BRASS, 0.25);
        let z = f_d - 0.36;
        let e = b.boxed(
            0.46,
            0.1,
            0.12,
            flipper_m,
            t.x + sx * 0.34,
            deck_y - z * libm::sin(rake) + 0.1,
            t.z + z * libm::cos(rake),
        );
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(move |mut tr| tr.rotation = Quat::from_rotation_y((sx * 0.5) as f32));
    }
    // The ball — parked until a strong run sends it round.
    let ball_m = b.metal(0xd8dee9, 0.9, 0.15);
    let ball = b
        .commands
        .spawn((
            TavernScene,
            DioramaBall,
            Mesh3d(b.meshes.add(Sphere::new(0.075))),
            MeshMaterial3d(ball_m),
            Transform::from_xyz(t.x as f32, (deck_y + 0.13) as f32, (t.z + 0.2) as f32),
        ))
        .id();
    let _ = ball;
    // Plunger lane divider + shooter rod/knob (the stripe that orients the machine).
    let guide = b.metal(STEEL, 0.75, 0.3);
    b.boxed(
        0.06,
        0.22,
        f_d * 1.7,
        guide.clone(),
        t.x + 0.92,
        deck_y + 0.12,
        t.z - 0.1,
    );
    let knob = b.emissive(BLOOD, 0.9);
    b.cyl(
        0.09,
        0.09,
        knob,
        t.x + 0.92,
        deck_y + 0.06,
        t.z + f_d + 0.26,
    );
    // Drop-target bank across the upper field.
    for i in -1i32..=1 {
        let m = b.emissive(COLD, 0.4);
        b.boxed(
            0.2,
            0.14,
            0.03,
            m,
            t.x + f64::from(i) * 0.26,
            deck_y + 0.4,
            t.z - 1.34,
        );
    }
    // Slingshot kickers above the flippers.
    for sx in [-1.0f64, 1.0] {
        let m = b.emissive(BLOOD, 0.35);
        let e = b.boxed(
            0.4,
            0.11,
            0.08,
            m,
            t.x + sx * 0.74,
            deck_y + 0.02,
            t.z + f_d - 0.75,
        );
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(move |mut tr| tr.rotation = Quat::from_rotation_y((sx * -0.9) as f32));
    }

    // ── THE BACKBOX — tall, vertical, lit marquee facing the camera ──
    let head_h = 1.35f64;
    let head_y = side_top_back - 0.05;
    let head_z = t.z - t.d / 2.0 + 0.16;
    b.boxed(
        t.w - 0.04,
        head_h,
        0.24,
        cab.clone(),
        t.x,
        head_y + head_h / 2.0,
        head_z,
    );
    let bezel = b.mat(0x120e0a);
    b.boxed(
        t.w - 0.2,
        head_h - 0.18,
        0.03,
        bezel,
        t.x,
        head_y + head_h / 2.0,
        head_z + 0.13,
    );
    let marquee = b.emissive(GOLD, 0.22);
    b.boxed(
        t.w - 0.34,
        head_h - 0.36,
        0.05,
        marquee,
        t.x,
        head_y + head_h / 2.0 + 0.02,
        head_z + 0.15,
    );
    for sx in [-1.0f64, 1.0] {
        b.boxed(
            0.07,
            head_h,
            0.28,
            chrome.clone(),
            t.x + sx * (t.w / 2.0 - 0.05),
            head_y + head_h / 2.0,
            head_z + 0.02,
        );
    }
    let topper = b.emissive(COLD, 0.5);
    b.boxed(
        t.w - 0.3,
        0.09,
        0.12,
        topper,
        t.x,
        head_y + head_h + 0.02,
        head_z + 0.1,
    );
    for i in -1i32..=1 {
        let m = b.emissive(COLD, 0.7);
        b.boxed(
            0.2,
            0.16,
            0.04,
            m,
            t.x + f64::from(i) * 0.28,
            head_y + 0.3,
            head_z + 0.16,
        );
    }
    b.accent("table", COLD, t.x, deck_back + 0.35, t.z + 0.2, 3.4);
    b.point(
        GOLD,
        2.4,
        5.0,
        t.x,
        side_top_back + 0.9,
        t.z - t.d / 2.0 + 0.9,
    );

    // ══ FORGE — west/northwest. Warm, loud, metal ══
    let f = &OBSTACLES[1]; // { x: -7.2, z: -2.6 }
    let hearth = b.mat(0x5a4436); // fire-stained brick, NOT the cold stone
    b.boxed(f.w, 1.3, f.d, hearth.clone(), f.x, 0.65, f.z);
    let recess = b.mat(0x120c08);
    b.boxed(1.1, 0.22, 0.9, recess, f.x + 0.4, 1.35, f.z);
    let coals_m = b.emissive(WARM, 1.6);
    let coals = b.boxed(0.95, 0.1, 0.75, coals_m, f.x + 0.4, 1.42, f.z);
    b.commands.entity(coals).insert(Coals);
    // Anvil on a stump.
    b.boxed(0.5, 0.4, 0.5, cab.clone(), f.x + 1.0, 0.2, f.z + 1.3);
    let anvil_m = b.metal(STEEL_DK, 0.75, 0.35);
    b.boxed(0.62, 0.2, 0.3, anvil_m.clone(), f.x + 1.0, 0.5, f.z + 1.3);
    let hot = b.emissive(WARM, 1.2);
    b.boxed(0.3, 0.03, 0.16, hot.clone(), f.x + 1.0, 0.61, f.z + 1.3); // embers on the face
                                                                       // Chimney hood + bellows + quench trough (the smithy tells).
    let hood = b.mat(0x2b2521);
    b.boxed(1.6, 1.1, 1.6, hood, f.x + 0.2, 2.5, f.z);
    b.boxed(0.62, 0.3, 0.5, cab.clone(), f.x - 0.85, 1.62, f.z - 0.15);
    let trough = b.mat(0x0e1418);
    b.boxed(0.52, 0.24, 0.72, trough, f.x - 0.75, 1.4, f.z + 0.45);
    let water = b.metal(0x1b3a48, 0.3, 0.25);
    b.boxed(0.42, 0.02, 0.62, water, f.x - 0.75, 1.51, f.z + 0.45);
    b.boxed(0.5, 0.06, 0.08, hot, f.x + 0.95, 1.4, f.z - 0.25); // glowing billet
    b.boxed(0.4, 0.06, 0.08, anvil_m, f.x + 0.95, 1.4, f.z + 0.05); // cold one
    b.accent("forge", WARM, f.x + 0.8, 1.5, f.z + 0.6, 4.2);
    b.point(WARM, 5.5, 13.0, f.x + 1.2, 2.0, f.z + 1.0); // the wash
    b.point(0xff8a3c, 3.6, 5.0, f.x + 0.4, 1.55, f.z); // the hot core

    // ══ BAR — east. Bottles, brass rail, warm lamps ══
    let bar = &OBSTACLES[2]; // { x: 7.2, z: -2.6 }
    let counter = b.mat(TIMBER);
    b.boxed(bar.w, 1.1, bar.d, counter, bar.x, 0.55, bar.z);
    b.boxed(bar.w, 0.1, bar.d, cab.clone(), bar.x, 1.15, bar.z); // top lip
    b.boxed(
        0.08,
        0.08,
        bar.d - 0.1,
        brass.clone(),
        bar.x - bar.w / 2.0 + 0.07,
        0.95,
        bar.z,
    ); // foot rail
    b.boxed(0.4, 1.8, bar.d, cab.clone(), bar.x + 1.0, 0.9, bar.z); // back shelf
    for i in 0..7usize {
        let tone = [0x3f9d5a, BLOOD, COLD][i % 3];
        let m = b.emissive(tone, 0.32);
        b.cyl(
            0.07,
            0.34,
            m,
            bar.x + 0.85,
            1.15 + f64::from((i % 2) as u32) * 0.55,
            bar.z - 0.8 + i as f64 * 0.26,
        );
    }
    // Taps — the single most legible bar shape — on the counter's front edge.
    b.boxed(
        0.14,
        0.2,
        1.1,
        brass.clone(),
        bar.x - 0.35,
        1.3,
        bar.z - 0.1,
    );
    for i in 0..3 {
        let tz = bar.z - 0.55 + f64::from(i) * 0.45;
        b.cyl(0.035, 0.34, brass.clone(), bar.x - 0.35, 1.55, tz);
        b.cyl(0.055, 0.1, cab.clone(), bar.x - 0.35, 1.76, tz);
    }
    // A keg on its side at the back of the counter.
    let keg = b.cyl(0.26, 0.6, cab.clone(), bar.x + 0.35, 1.46, bar.z - 0.85);
    b.commands
        .entity(keg)
        .entry::<Transform>()
        .and_modify(|mut tr| tr.rotation = Quat::from_rotation_z(std::f32::consts::FRAC_PI_2));
    b.accent("bar", WARM, bar.x - 0.6, 1.7, bar.z, 2.6);

    // ══ CARD DEALER — southeast. Felt table, card trays, cold glow ══
    let d = &OBSTACLES[3]; // { x: 7.2, z: 2.8 }
    let felt = b.mat(0x18313f);
    b.boxed(d.w, 0.12, d.d, felt, d.x, 0.86, d.z);
    for sx in [-1.0f64, 1.0] {
        for sz in [-1.0f64, 1.0] {
            b.boxed(
                0.16,
                0.86,
                0.16,
                cab.clone(),
                d.x + sx * (d.w / 2.0 - 0.2),
                0.43,
                d.z + sz * (d.d / 2.0 - 0.2),
            );
        }
    }
    // Oversized engraved steel cards, standing in a tray.
    let plate = b.metal(STEEL, 0.7, 0.4);
    for i in 0..3 {
        let e = b.boxed(
            0.36,
            0.52,
            0.03,
            plate.clone(),
            d.x - 0.5 + f64::from(i) * 0.5,
            1.18,
            d.z - 0.2,
        );
        let lean = (f64::from(i) - 1.0) * 0.09;
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(move |mut tr| {
                tr.rotation = Quat::from_rotation_z(lean as f32) * Quat::from_rotation_x(-0.22);
            });
    }
    // The low-hung lamp — the pool of light that says "game in progress".
    let post = b.metal(STEEL_DK, 0.6, 0.5);
    b.boxed(0.06, 0.9, 0.06, post, d.x, 2.25, d.z);
    let shade = b.mat(0x241a12);
    b.cyl(0.34, 0.26, shade, d.x, 1.72, d.z);
    let lamp = b.emissive(COLD, 1.1);
    b.cyl(0.28, 0.04, lamp, d.x, 1.6, d.z);
    b.accent("dealer", COLD, d.x, 1.5, d.z + 0.5, 2.4);

    // ══ ARMORY BENCH — southwest. Vice, racks, discarded plate ══
    let a = &OBSTACLES[4]; // { x: -7.2, z: 3.05, w: 2.6, d: 2.5 }
    let bench_d = a.d - 0.7;
    let bench_z = a.z - 0.35;
    let bench_top = b.mat(TIMBER);
    b.boxed(a.w, 0.16, bench_d, bench_top, a.x, 0.88, bench_z);
    for sx in [-1.0f64, 1.0] {
        b.boxed(
            0.18,
            0.88,
            bench_d - 0.3,
            cab.clone(),
            a.x + sx * (a.w / 2.0 - 0.2),
            0.44,
            bench_z,
        );
    }
    // The vice, and YOUR weapon held in it (rune plates land with P4 cards).
    let vice = b.metal(STEEL_DK, 0.7, 0.4);
    b.boxed(0.3, 0.26, 0.3, vice, a.x + 0.7, 1.06, bench_z - 0.4);
    let held_m = b.metal(STEEL, 0.8, 0.3);
    let held = b.boxed(0.1, 0.9, 0.1, held_m, a.x + 0.7, 1.55, bench_z - 0.4);
    b.commands
        .entity(held)
        .entry::<Transform>()
        .and_modify(|mut tr| tr.rotation = Quat::from_rotation_z(0.22));
    // Rack of plate against the wall + helm on a stand.
    b.boxed(0.3, 1.7, bench_d, cab.clone(), a.x - 1.0, 0.85, bench_z);
    for i in 0..3 {
        let m = b.metal(STEEL_DK, 0.6, 0.5);
        b.boxed(
            0.14,
            0.44,
            0.36,
            m,
            a.x - 0.8,
            1.5 - f64::from(i) * 0.5,
            bench_z - 0.5 + f64::from(i) * 0.5,
        );
    }
    let helm_m = b.metal(STEEL, 0.7, 0.35);
    b.commands.spawn((
        TavernScene,
        Mesh3d(b.meshes.add(Sphere::new(0.17))),
        MeshMaterial3d(helm_m),
        Transform::from_xyz((a.x + 0.15) as f32, 1.28, (bench_z + 0.6) as f32),
    ));
    // The keeper's crate bank (the bench grew south to reach its keeper).
    let bank_z = bench_z + bench_d / 2.0 + 0.35;
    let bank = b.mat(TIMBER);
    b.boxed(a.w, 0.62, 0.7, bank, a.x, 0.31, bank_z);
    b.boxed(a.w + 0.04, 0.07, 0.74, cab.clone(), a.x, 0.65, bank_z);
    b.cyl(0.26, 0.56, cab.clone(), a.x - 0.85, 0.96, bank_z); // quench-oil barrel
    let wheel_m = b.mat(0x555a63);
    let wheel = b.cyl(0.26, 0.08, wheel_m, a.x + 0.9, 0.97, bank_z); // grindstone
    b.commands
        .entity(wheel)
        .entry::<Transform>()
        .and_modify(|mut tr| tr.rotation = Quat::from_rotation_z(std::f32::consts::FRAC_PI_2));
    b.accent("armory", WARM, a.x + 0.9, 1.4, a.z + 0.8, 3.4);

    // ══ NOTICE BOARD + DESCENT PLUNGER — north wall. The way out ══
    let n = &OBSTACLES[5]; // { x: 0, z: -6.4 }
    b.boxed(n.w, 2.2, 0.3, cab.clone(), n.x, 1.1, n.z - 0.2); // board backing
    let cork = b.mat(0x241a12);
    b.boxed(n.w - 0.3, 1.7, 0.06, cork, n.x, 1.25, n.z - 0.02); // cork face
                                                                // Pinned notices — uneven in size, tone and angle.
    for i in 0..8i64 {
        let tone = [0xb9ae94, 0xa39779, 0xc9c0a8][(i % 3) as usize];
        let m = b.mat(tone);
        let w = 0.3 + ((i * 29) % 4) as f64 * 0.06;
        let h = 0.3 + ((i * 17) % 5) as f64 * 0.07;
        let x = n.x - 1.5 + (i % 4) as f64 * 0.8;
        let y = 1.05 + (i / 4) as f64 * 0.62 + ((i * 37) % 3) as f64 * 0.06;
        let e = b.boxed(w, h, 0.02, m, x, y, n.z + 0.02);
        let rot = (((i * 53) % 7) - 3) as f64 * 0.05;
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(move |mut tr| tr.rotation = Quat::from_rotation_z(rot as f32));
    }
    // Hooded lantern on the board's post.
    let lantern_y = 2.05;
    let lantern_post = b.metal(STEEL_DK, 0.6, 0.5);
    b.boxed(
        0.09,
        0.34,
        0.09,
        lantern_post,
        n.x - 2.0,
        lantern_y,
        n.z + 0.1,
    );
    let lit = b.emissive(WARM, 1.3);
    b.boxed(0.18, 0.2, 0.18, lit, n.x - 2.0, lantern_y - 0.23, n.z + 0.1);
    // ── "ENTER MAZE" SIGN — housing + inlay + the BAKED lettering panel.
    let sign_w = 4.2;
    let sign_h = 0.8;
    let sign_y = 3.0;
    let sign_z = n.z - 0.32;
    b.boxed(
        sign_w + 0.22,
        sign_h + 0.2,
        0.18,
        cab.clone(),
        n.x,
        sign_y,
        sign_z - 0.07,
    );
    let inlay = b.mat(0x0a1418);
    b.boxed(
        sign_w + 0.02,
        sign_h + 0.02,
        0.04,
        inlay,
        n.x,
        sign_y,
        sign_z + 0.035,
    );
    // The face carries the baked legend (props.ts:40-110, exported by
    // `cargo xtask bake --tavern`). UNLIT, exactly as legacy's
    // MeshBasicMaterial is: a lit material would take the hearth's warm light
    // across the glyphs and the bloom would then eat the thin strokes, which
    // is the whole reason the sign is drawn once at the contrast it wants.
    //
    // The lettering is a GLOW on alpha, so Blend rather than Mask — the
    // canvas's cyan shadowBlur has no hard edge to cut at. Unlit also means
    // `emissive` is ignored by the shader (bevy_pbr pbr.wgsl:82-86 returns
    // base_color and stops), so "lit sign" brightness is a >1 base_color
    // multiplier over the baked pixels instead; the COLD point light below
    // still washes the housing around it.
    let sign_tex = b.images.add(tavern_art::sign_enter_maze());
    let face = b.materials.add(StandardMaterial {
        // 1.0, not a >1 boost: the oracle hangs this on a `MeshBasicMaterial`
        // at plain 0xffffff and lets the canvas's own glow carry the
        // brightness. Any multiplier clips wherever the bake is already
        // near-white — which is the letterforms, the only part that matters.
        base_color: Color::WHITE,
        base_color_texture: Some(sign_tex),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        cull_mode: None,
        // Bevy's Cuboid puts uv v=0 at the face's BOTTOM edge
        // (bevy_mesh primitives/dim3/cuboid.rs:30-33), the opposite of its
        // Rectangle and of THREE's PlaneGeometry that legacy hangs the sign
        // on — so the legend arrives upside down. Mirror v; a 180° rotation
        // would fix the flip and introduce a mirror.
        uv_transform: bevy::math::Affine2 {
            matrix2: Mat2::from_diagonal(Vec2::new(1.0, -1.0)),
            translation: Vec2::new(0.0, 1.0),
        },
        ..default()
    });
    // The legend plane carries the AUTHORED aspect (4.2 x 0.8 = 5.25), not
    // the inset housing panel's. Shrinking it to `sign_w - 0.4` by
    // `sign_h - 0.28` gives 7.31, and since the bake is stretched to whatever
    // quad it lands on, the letters came out ~39% wide.
    b.boxed(sign_w, sign_h, 0.03, face, n.x, sign_y, sign_z + 0.075);
    let rail = b.metal(STEEL_DK, 0.6, 0.5);
    b.boxed(
        sign_w + 0.26,
        0.09,
        0.24,
        rail,
        n.x,
        sign_y + sign_h / 2.0 + 0.13,
        sign_z - 0.05,
    );
    b.point(COLD, 2.2, 5.0, n.x, 2.6, n.z + 1.0); // always-on sign glow
                                                  // THE PLUNGER — a real launcher housing set into the wall beside the board.
    let plunger_x = n.x + n.w / 2.0 + 0.5;
    let housing = b.metal(STEEL_DK, 0.6, 0.5);
    b.boxed(0.5, 1.0, 0.5, housing, plunger_x, 0.5, n.z);
    b.cyl(0.06, 0.8, chrome.clone(), plunger_x, 1.3, n.z);
    let knob2 = b.emissive(BLOOD, 0.9);
    b.cyl(0.16, 0.16, knob2, plunger_x, 1.75, n.z);
    // The spring — the stack of rings IS the "launcher" read.
    for i in 0..7 {
        let m = b.metal(STEEL_DK, 0.85, 0.3);
        b.cyl(0.11, 0.045, m, plunger_x, 1.08 + f64::from(i) * 0.075, n.z);
    }
    // A cold lane of light on the floor pointing at the plunger.
    let lane_m = b.materials.add(StandardMaterial {
        base_color: Color::srgba(0.44, 0.82, 0.91, 0.14),
        alpha_mode: AlphaMode::Blend,
        unlit: true,
        ..default()
    });
    b.boxed(0.8, 0.01, 2.4, lane_m, plunger_x, 0.02, n.z + 1.6);
    b.accent("board", COLD, n.x, 1.8, n.z + 0.8, 2.6);

    // ══ THE GAMBLER'S CORNER — a broken-down arcade cabinet ══
    let gx = 3.9;
    let gz = 5.9;
    b.boxed(1.5, 1.5, 0.9, cab.clone(), gx, 0.75, gz); // cabinet body
    let lip = b.mat(TIMBER);
    b.boxed(1.6, 0.16, 1.0, lip, gx, 1.56, gz); // top lip
    let screen = b.emissive(COLD, 0.55);
    let scr = b.boxed(1.15, 0.8, 0.06, screen, gx, 1.15, gz + 0.44);
    b.commands
        .entity(scr)
        .entry::<Transform>()
        .and_modify(|mut tr| tr.rotation = Quat::from_rotation_x(0.24));
    for i in -1i32..=1 {
        let m = b.emissive(GOLD, 0.5);
        let e = b.boxed(0.24, 0.34, 0.03, m, gx + f64::from(i) * 0.3, 1.16, gz + 0.5);
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(|mut tr| tr.rotation = Quat::from_rotation_x(0.24));
    }
    // The lever: chrome rod, blood-red knob — unmistakably a slot machine.
    let lever = b.cyl(0.05, 0.55, chrome, gx + 0.64, 1.3, gz);
    b.commands
        .entity(lever)
        .entry::<Transform>()
        .and_modify(|mut tr| tr.rotation = Quat::from_rotation_z(-0.3));
    let knob3 = b.emissive(BLOOD, 0.9);
    b.cyl(0.11, 0.11, knob3, gx + 0.76, 1.55, gz);
    // Marquee + coin slot.
    b.boxed(1.5, 0.4, 0.24, cab.clone(), gx, 1.94, gz + 0.3);
    let marq = b.emissive(COLD, 0.9);
    b.boxed(1.3, 0.28, 0.04, marq, gx, 1.94, gz + 0.42);
    b.boxed(0.26, 0.3, 0.05, brass, gx + 0.42, 0.72, gz + 0.43);
    b.accent("gambler", GOLD, gx, 1.7, gz - 0.6, 2.4);

    // ── Freestanding dartboard, east of the cabinet on the open floor ──
    let board_z = ROOM_MAX_Z - 0.2;
    let dart_x = 8.0;
    for px in [-0.5f64, 0.5] {
        b.boxed(0.1, 1.5, 0.1, cab.clone(), dart_x + px, 0.75, board_z);
    }
    let plank = b.mat(TIMBER);
    b.boxed(0.86, 0.86, 0.05, plank, dart_x, 1.15, board_z - 0.05);
    let rings = [0xc9c0a8, BLOOD, 0xc9c0a8, 0x1a1410];
    for (i, tone) in rings.iter().enumerate() {
        let m = b.mat(*tone);
        let e = b.cyl(
            0.4 - i as f64 * 0.095,
            0.015,
            m,
            dart_x,
            1.15,
            board_z - 0.04 + i as f64 * 0.01,
        );
        b.commands
            .entity(e)
            .entry::<Transform>()
            .and_modify(|mut tr| tr.rotation = Quat::from_rotation_x(std::f32::consts::FRAC_PI_2));
    }
    let bull = b.emissive(GOLD, 0.5);
    let e = b.cyl(0.07, 0.017, bull, dart_x, 1.15, board_z + 0.01);
    b.commands
        .entity(e)
        .entry::<Transform>()
        .and_modify(|mut tr| tr.rotation = Quat::from_rotation_x(std::f32::consts::FRAC_PI_2));

    // Bent rails and chrome bumpers mounted into the walls — the tavern is
    // built out of old machine internals.
    for (rx, rz, rw) in [(-4.5f64, -6.6f64, 3.0f64), (4.5, -6.6, 3.0)] {
        let m = b.metal(STEEL_DK, 0.65, 0.4);
        b.boxed(rw, 0.12, 0.12, m.clone(), rx, 2.3, rz);
        b.boxed(rw, 0.12, 0.12, m, rx, 1.9, rz);
    }
    for cx in [-3.2f64, -1.8, 1.8, 3.2] {
        let m = b.emissive(COLD, 0.35);
        b.cyl(0.2, 0.12, m, cx, 2.65, -6.6);
    }
}

fn teardown_tavern(
    mut commands: Commands,
    q: Query<Entity, With<TavernScene>>,
    mut ambient: ResMut<AmbientLight>,
    mut cam_q: Query<&mut Projection, With<DungeonCamera>>,
    mut gui: Gui,
    mut sfx: MessageWriter<SfxEvent>,
) {
    // ⚠️ THE GUI STACK IS NOT A SCENE ENTITY, so despawning `TavernScene` does
    // not take it. The prompt and the panels used to be `Text` nodes tagged with
    // the scene marker and they died with the room; as screens they outlive it,
    // and the first build after the port shipped the tavern's "[E] DESCEND"
    // prompt floating over the dungeon floor. A layer shared by every scene has
    // to be closed by the scene that opened it.
    gui.layer.clear();
    *gui.views = GuiViews::default();
    // The bed fades over 0.6s rather than cutting: the room tone is the last
    // thing you hear on the way down the stairs, and a hard stop on a looping
    // noise source clicks.
    sfx.write(SfxEvent::TavernExit);
    for e in &q {
        commands.entity(e).despawn();
    }
    commands.remove_resource::<TavernRes>();
    // Restore the dungeon's rig + framing.
    ambient.brightness = AmbientLight::default().brightness;
    ambient.color = AmbientLight::default().color;
    for mut proj in &mut cam_q {
        if let Projection::Orthographic(o) = &mut *proj {
            o.scaling_mode = ScalingMode::FixedVertical {
                viewport_height: VIEW_H,
            };
        }
    }
}

fn gather_tavern_input(keys: Res<ButtonInput<KeyCode>>, mut res: ResMut<TavernRes>) {
    let mut x = 0.0;
    let mut z = 0.0;
    // SCREEN-relative axis, exactly the legacy input layer's convention:
    // +z is screen-down. The rotation to world happens inside the ported step.
    if keys.pressed(KeyCode::KeyW) || keys.pressed(KeyCode::ArrowUp) {
        z -= 1.0;
    }
    if keys.pressed(KeyCode::KeyS) || keys.pressed(KeyCode::ArrowDown) {
        z += 1.0;
    }
    if keys.pressed(KeyCode::KeyA) || keys.pressed(KeyCode::ArrowLeft) {
        x -= 1.0;
    }
    if keys.pressed(KeyCode::KeyD) || keys.pressed(KeyCode::ArrowRight) {
        x += 1.0;
    }
    res.input = TavernInput {
        axis_x: x,
        axis_z: z,
        sprint: keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight),
        frozen: res.open_panel.is_some(),
    };
}

fn step_tavern(mut res: ResMut<TavernRes>) {
    res.prev = (res.pose.x, res.pose.z);
    let input = res.input;
    step_tavern_movement(&mut res.pose, &input, 1.0 / 60.0);
    res.curr = (res.pose.x, res.pose.z);
}

/// The per-frame scene work of legacy core.ts `frame()`: focus, prompt,
/// spotlight, accent breathe, flicker, diorama, keepers, panels, interact.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn tavern_frame(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mut gui: Gui,
    mut res: ResMut<TavernRes>,
    mut next: ResMut<NextState<AppState>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut disc_q: Query<
        (
            &mut Transform,
            &mut Visibility,
            &MeshMaterial3d<StandardMaterial>,
        ),
        With<SpotlightDisc>,
    >,
    mut accents: Query<(&AccentLight, &mut PointLight), Without<FireLight>>,
    mut fire: Query<&mut PointLight, With<FireLight>>,
    mut flames: Query<
        (&FlameQuad, &mut Transform),
        (Without<SpotlightDisc>, Without<KeeperSprite>),
    >,
    coals: Query<&MeshMaterial3d<StandardMaterial>, With<Coals>>,
    bumpers: Query<(&BumperCap, &MeshMaterial3d<StandardMaterial>)>,
    mut ball_q: Query<
        &mut Transform,
        (
            With<DioramaBall>,
            Without<FlameQuad>,
            Without<SpotlightDisc>,
            Without<KeeperSprite>,
        ),
    >,
    mut keeper_q: Query<
        (&KeeperSprite, &mut Transform),
        (
            Without<FlameQuad>,
            Without<SpotlightDisc>,
            Without<DioramaBall>,
        ),
    >,
    mut sfx: MessageWriter<SfxEvent>,
) {
    let Gui { layer, views } = &mut gui;
    // Same dt clamp as the legacy frame loop.
    let dt = (time.delta_secs_f64()).min(0.05);
    res.time += dt;
    let t = res.time;

    // ── Station focus (frozen while a panel is up, exactly as legacy) ──
    let frozen = res.open_panel.is_some();
    let next_focus = if frozen {
        None
    } else {
        station_at(res.pose.x, res.pose.z)
    };
    let focus_changed = res.focus.map(|s| s.id) != next_focus.map(|s| s.id);
    if focus_changed {
        res.focus = next_focus;
        // Only the RISING edge sounds. Legacy plays nothing on leaving a
        // station, and adding a tick there turns walking past the bar into a
        // two-note noise every time.
        if next_focus.is_some() {
            sfx.write(SfxEvent::StationFocus);
        }
    }

    // ── Spotlight disc: move + fade toward the focused station ──
    if let Ok((mut tf, mut vis, mat)) = disc_q.single_mut() {
        if let Some(s) = res.focus {
            tf.translation = Vec3::new(s.x as f32, 0.03, s.z as f32);
            *vis = Visibility::Visible;
            if let Some(m) = materials.get_mut(&mat.0) {
                let pulse = 0.22 + libm::sin(t * 4.0) as f32 * 0.05;
                m.base_color = c(s.accent).with_alpha(pulse);
            }
        } else {
            *vis = Visibility::Hidden;
        }
    }

    // ── Accent breathe: every station's light breathes gently; the focused
    // one breathes harder (stations.ts). ──
    for (acc, mut light) in &mut accents {
        let station = STATIONS.iter().find(|s| s.id == acc.station);
        let sx = station.map_or(0.0, |s| s.x);
        let focused = res.focus.map(|s| s.id) == Some(acc.station);
        let (rate, amp, boost) = if focused {
            (5.0, 0.22, 1.5)
        } else {
            (1.6, 0.07, 1.0)
        };
        let breathe = 1.0 + libm::sin(t * rate + sx) * amp;
        light.intensity = acc.base * breathe as f32 * boost;
    }

    // ── Hearth + forge flicker — two summed sines so it never reads as a loop ──
    if let Ok(mut light) = fire.single_mut() {
        let flick = 1.0 + libm::sin(t * 9.3) * 0.09 + libm::sin(t * 3.1) * 0.05;
        light.intensity = 9.0 * PL * flick as f32;
    }
    for (fq, mut tf) in &mut flames {
        let s = 0.85 + libm::sin(t * (7.0 + fq.0 as f64 * 1.7) + fq.0 as f64) * 0.16;
        tf.scale = Vec3::new(1.0, s as f32, 1.0);
    }
    if let Ok(mat) = coals.single() {
        if let Some(m) = materials.get_mut(&mat.0) {
            let e = 1.3 + libm::sin(t * 5.2) * 0.35;
            m.emissive = emissive_rgb(WARM, e as f32);
        }
    }

    // ── The diorama reports the run: lit caps are completed targets; the
    // ball only laps after a strong floor. An unlit cap stays dark. ──
    for (cap, mat) in &bumpers {
        if let Some(m) = materials.get_mut(&mat.0) {
            let e = if cap.0 < res.diorama.lit {
                0.5 + libm::sin(t * 2.4 - cap.0 as f64 * 0.9).max(0.0) * 0.85
            } else {
                0.04
            };
            m.emissive = emissive_rgb(COLD, e as f32);
        }
    }
    if res.diorama.ball_speed > 0.0 {
        res.ball_angle += dt * res.diorama.ball_speed;
        if let Ok(mut tf) = ball_q.single_mut() {
            let table = &OBSTACLES[0];
            tf.translation = Vec3::new(
                (table.x + libm::cos(res.ball_angle) * 0.85) as f32,
                tf.translation.y,
                (table.z + libm::sin(res.ball_angle) * 0.5 - 0.1) as f32,
            );
        }
    }

    // ── Keepers: the ported idle loops (beats surfaced; sfx/VFX are P7) ──
    let focus_id = res.focus.map(|s| s.id);
    let player_x = res.pose.x;
    for (ks, mut tf) in &mut keeper_q {
        let k = &mut res.keepers[ks.0];
        let out = update_keeper(k, t, dt, focus_id, player_x);
        // Only Greet sounds. The hammer and dart beats still throw sparks,
        // but legacy deliberately moved the anvil OFF the idle loop and onto
        // the earned forge purchase — a smithy that clanks every 2.1 seconds
        // forever is the thing that made the room unbearable to stand in.
        for (beat, ..) in &out.beats {
            if *beat == KeeperBeat::Greet {
                sfx.write(SfxEvent::KeeperGreet);
            }
        }
        // The quad's origin is its FEET (bottom-centre mesh), so the pose's y
        // — baseY 0 plus bob/greet-hop — is the translation, not an offset
        // from a box's half-height.
        tf.translation = Vec3::new(out.pose.x as f32, out.pose.y as f32, out.pose.z as f32);
        // `scale_x` is the signed mirror. pk_core clamps |x| >= 0.06 for us
        // (npcs.rs:245-249, mirroring npcs.ts:204-205) — a zero-determinant
        // matrix NaNs the normals and the sprite disappears for good.
        debug_assert!(out.pose.scale_x.abs() >= 0.06 - 1e-9);
        tf.scale = Vec3::new(out.pose.scale_x as f32, 1.0, 1.0);
        // COMPOSE with the baked billboard, never replace it: `rot_z` is the
        // lean, and legacy only ever assigns `mesh.rotation.z` on top of the
        // faceCamera bake (npcs.ts:277).
        tf.rotation = billboard(out.pose.rot_z as f32);
    }

    // ── Panels ──
    //
    // The room decides WHAT is open and what it says; `gui.rs` paints it with
    // the ported toolkit. Three routes close a panel and they must agree, or a
    // sheet stays on screen with nothing driving it:
    //   · `E`, the interact key, handled here;
    //   · `ESC`, handled by the toolkit's cancel-pop;
    //   · the sheet's own CLOSE button, handled by the toolkit.
    // The last two both surface as `layer.closed`, so this reads that FIRST and
    // never guesses — an `open_panel` that disagreed with the stack is how a
    // frozen room with no menu on it happens.
    if layer.closed.is_some() {
        res.open_panel = None;
    }
    if keys.just_pressed(KeyCode::KeyE) {
        if res.open_panel.is_some() {
            // E also closes, so a pad B-press maps later.
            res.open_panel = None;
        } else if let Some(s) = res.focus {
            match s.action {
                StationKind::Descend => {
                    // The plunger: commit and drop into the next floor. The
                    // real hand-off — tear the tavern down and go build one.
                    //
                    // `FloorLoading`, not `Dungeon`: the build used to happen
                    // inside the frame that had just been asked to draw the
                    // dungeon, so the descend was a stall with nothing on
                    // screen. The loading state is where that work has somewhere
                    // to be seen happening.
                    sfx.write(SfxEvent::Plunger);
                    next.set(AppState::FloorLoading);
                    return;
                }
                StationKind::Summary => res.open_panel = Some(Panel::Summary),
                StationKind::Vendor(_) => res.open_panel = Some(Panel::Vendor(s.id)),
                StationKind::Gambler => res.open_panel = Some(Panel::Gambler),
            }
        }
    }
    // The stack is driven from `open_panel` every frame rather than only on the
    // edges: two sources of truth for "is a sheet up" is exactly the drift this
    // whole block is arranged to prevent.
    // ── The counter's action, applied before its view is rebuilt ──
    // Order matters: the view below is built from `res.loadout`, so applying
    // the purchase first is what makes the row read `3/3` on the same frame the
    // button was pressed rather than one frame later.
    if let Some(action) = layer.armory_action.take() {
        // Split borrow: `res.loadout.buy_gear(&mut res.wallet, …)` borrows
        // `res` twice over. Destructuring once is the fix the borrow checker
        // is asking for, and it keeps the rules' signature (state + purse)
        // rather than folding the purse into the loadout to dodge it.
        let TavernRes {
            loadout,
            wallet,
            shop_message,
            open_panel,
            ..
        } = &mut *res;
        match action {
            ArmoryAction::BuyPlate(i) => {
                if let Some(slot) = GEAR_SLOTS.get(i) {
                    *shop_message = loadout.buy_gear(wallet, *slot);
                }
            }
            ArmoryAction::RepairAll => {
                *shop_message = loadout.repair_gear(wallet);
            }
            ArmoryAction::BuyStyle(i) => {
                if let Some(id) = ELEMENTAL_STYLE_IDS.get(i) {
                    // `buy_style` returns None for "not applicable" (already
                    // owned, or free). KEEP the previous message in that case —
                    // blanking it would make a no-op look like a fresh event.
                    if let Some(m) = loadout.buy_style(wallet, *id) {
                        *shop_message = Some(m);
                    }
                }
            }
            ArmoryAction::WearStyle(i) => {
                if let Some(id) = ELEMENTAL_STYLE_IDS.get(i) {
                    if let Some(m) = loadout.wear_style(*id) {
                        *shop_message = Some(m);
                    }
                }
            }
            ArmoryAction::Close => {
                *open_panel = None;
                *shop_message = None;
            }
        }
    }
    // ── The alchemist's action, on the same contract ──
    // Applied BEFORE its view is rebuilt, so a purchase shows on the belt in
    // the frame the button was pressed.
    if let Some(action) = layer.alchemist_action.take() {
        let TavernRes {
            satchel,
            wallet,
            shop_message,
            open_panel,
            alch_tab,
            alch_selected,
            ..
        } = &mut *res;
        match action {
            AlchemistAction::Tab(t) => {
                *alch_tab = t;
                // The tab is not an outcome — leaving the last purchase's
                // message up while the player browses is how the oracle reads.
            }
            AlchemistAction::BuyPotion(i) => {
                if let Some(id) = POTION_STOCK.get(i) {
                    *shop_message = buy_potion(*id, satchel, wallet);
                }
            }
            AlchemistAction::BuyFlask => {
                *shop_message = buy_flask(satchel, wallet);
            }
            AlchemistAction::Select(i) => *alch_selected = i,
            AlchemistAction::Brew(id) => {
                // `brew` returns None for an id no recipe answers to — a
                // different outcome from "missing materials", and it must not
                // blank the last real message.
                if let Some(m) = brew(&id, satchel, wallet) {
                    *shop_message = Some(m);
                }
            }
            AlchemistAction::Close => {
                *open_panel = None;
                *shop_message = None;
            }
        }
    }
    match res.open_panel {
        None => {
            layer.close(ScreenId::RunSummary);
            layer.close(ScreenId::StationPanel);
            layer.close(ScreenId::Armory);
            layer.close(ScreenId::Alchemist);
            set_view(&mut views.summary, None);
            set_view(&mut views.panel, None);
            set_view(&mut views.armory, None);
            set_view(&mut views.alchemist, None);
        }
        Some(Panel::Summary) => {
            set_view(
                &mut views.summary,
                Some(SummaryView {
                    floor: res.stats.floor.to_string(),
                    grade: res.stats.grade.to_string(),
                    kills: res.stats.kills.to_string(),
                    best_combo: format!("x{}", res.stats.best_combo),
                    // ⚠️ NOT ZERO — `TavernStats` has no gear and no purse, because
                    // the economy is P4. A "0 gold" here would be a number the game
                    // never computed, and a number on a summary screen is read as
                    // a measurement. An em dash is read as what it is.
                    gear: "—".into(),
                    purse: "—".into(),
                }),
            );
            layer.open(ScreenId::RunSummary);
        }
        // Every other vendor still gets the placeholder below. This one is
        // wired to `pk_core::economy::armory`, so "Manage Loadout" opens the
        // sheet the oracle paints instead of a sentence promising it.
        Some(Panel::Vendor("armory")) => {
            let l = &res.loadout;
            let gold = res.wallet.balance();
            set_view(
                &mut views.armory,
                Some(ArmoryView {
                    gold,
                    plate: GEAR_SLOTS
                        .iter()
                        .map(|s| PlateRow {
                            label: s.label().to_string(),
                            icon: s.item_id().to_string(),
                            worn: l.worn(*s),
                            base: s.base(),
                            price: s.price(),
                            affordable: gold >= s.price(),
                        })
                        .collect(),
                    styles: ELEMENTAL_STYLE_IDS
                        .iter()
                        .map(|id| StyleRow {
                            label: id.label().to_string(),
                            blurb: id.blurb().to_string(),
                            price: id.price(),
                            owned: l.is_unlocked(*id),
                            worn: l.active == *id,
                            affordable: gold >= id.price(),
                            swatch: id.swatch(),
                        })
                        .collect(),
                    repair_price: PRICE_REPAIR_GEAR,
                    repair_affordable: gold >= PRICE_REPAIR_GEAR,
                    message: res.shop_message.clone(),
                }),
            );
            layer.open(ScreenId::Armory);
        }
        // The alchemist. Same shape as the armorer: the screen is handed rows
        // that are already resolved, and it does no rules of its own.
        Some(Panel::Vendor("bar")) => {
            let gold = res.wallet.balance();
            let s = &res.satchel;
            set_view(
                &mut views.alchemist,
                Some(AlchemistView {
                    gold,
                    tab: res.alch_tab,
                    shelf: POTION_STOCK
                        .iter()
                        .map(|id| ShelfRow {
                            label: id.label().to_string(),
                            blurb: id.description().to_string(),
                            icon: id.item_id().to_string(),
                            price: id.price(),
                            affordable: gold >= id.price(),
                            on_belt: s.count(*id),
                        })
                        .collect(),
                    flask_price: PRICE_FLASK,
                    flask_affordable: gold >= PRICE_FLASK,
                    flasks: s.flasks,
                    // Only what you HAVE. A strip of fourteen chips reading
                    // zero is a wall of nothing, and the empty case has its own
                    // line saying where reagents come from.
                    pouch: REAGENT_IDS
                        .iter()
                        .filter(|id| s.reagents(**id) > 0)
                        .map(|id| PouchChip {
                            icon: id.item_id().to_string(),
                            count: s.reagents(*id),
                            swatch: id.swatch(),
                            label: id.label().to_string(),
                        })
                        .collect(),
                    recipes: RECIPES
                        .iter()
                        .map(|r| RecipeRow {
                            id: r.id.to_string(),
                            label: r.label.to_string(),
                            icon: match r.output {
                                pk_core::economy::alchemist::RecipeOutput::Potion(p) => {
                                    p.item_id().to_string()
                                }
                                // The catalyst has no sprite of its own — it is
                                // not a ground item — so the bootstrap recipe
                                // wears its INPUT, the glass shard it is made
                                // of. Better a true picture of the material
                                // than a borrowed picture of a potion.
                                pk_core::economy::alchemist::RecipeOutput::Flask => {
                                    "glass".to_string()
                                }
                            },
                            // The oracle's have/need line, verbatim in shape:
                            // every input as `have/need`, then the flask cost,
                            // then the gold fee if there is one.
                            needs: r
                                .inputs
                                .iter()
                                .map(|(id, n)| format!("{} {}/{}", id.label(), s.reagents(*id), n))
                                .chain(
                                    (r.flasks > 0)
                                        .then(|| format!("flask {}/{}", s.flasks, r.flasks)),
                                )
                                .chain((r.gold > 0).then(|| format!("{}g", r.gold)))
                                .collect::<Vec<_>>()
                                .join("  "),
                            craftable: can_craft(r, s, gold),
                        })
                        .collect(),
                    selected: res.alch_selected.min(RECIPES.len() - 1),
                    message: res.shop_message.clone(),
                }),
            );
            layer.open(ScreenId::Alchemist);
        }
        Some(panel) => {
            let (title, blurb, body, accent) = match panel {
                Panel::Summary => unreachable!("handled above"),
                Panel::Vendor(id) => {
                    let s = STATIONS
                        .iter()
                        .find(|s| s.id == id)
                        .expect("a live station");
                    (
                        s.label.to_string(),
                        s.blurb.to_string(),
                        "The counter opens here once the economy lands (P4). \
                         The chrome around this line is the real one — sheet, \
                         rivets, 16px heading — painted by the ported toolkit \
                         against the browser-baked goldens."
                            .to_string(),
                        s.accent,
                    )
                }
                Panel::Gambler => (
                    "RISK GOLD".to_string(),
                    "slots · roulette · blackjack · darts".to_string(),
                    "All four games are ported and tested in pk-core::gambler, \
                     RTP Monte-Carlos included. The cabinet screen that drives \
                     them lands with the P5 economy."
                        .to_string(),
                    GOLD,
                ),
            };
            set_view(
                &mut views.panel,
                Some(PanelView {
                    title,
                    blurb,
                    body,
                    accent,
                }),
            );
            layer.open(ScreenId::StationPanel);
        }
    }
    // ── Prompt, LAST ──
    //
    // A screen on the stack, not a `Text` node: the toolkit paints the legacy
    // `createStationPrompt` chrome, and the room only says which station.
    //
    // ⚠️ AFTER the panel block, not before it. `frozen` is read at the top of
    // the frame, so a prompt updated up there is answering the question "was a
    // sheet open when this frame started" — and the frame a sheet OPENS on, that
    // is no. The prompt therefore survived one frame underneath its own panel:
    // a stack depth that was 2 on one frame and 1 on the next, which a browser
    // gate caught by reading the wrong one and disagreeing with itself between
    // runs. Reading `res.open_panel` down here makes it this frame's answer.
    match (res.open_panel.is_some(), res.focus) {
        (false, Some(s)) => {
            set_view(
                &mut views.prompt,
                Some(StationView {
                    label: s.label.to_string(),
                    blurb: s.blurb.to_string(),
                    accent: s.accent,
                }),
            );
            layer.open(ScreenId::StationPrompt);
        }
        _ => {
            layer.close(ScreenId::StationPrompt);
            set_view(&mut views.prompt, None);
        }
    }
}

/// Knight billboard: interpolated pose, facing → sheet, walk/idle clips, and
/// the contact blob that follows his feet.
// The `Without`s are load-bearing, not decoration: three queries touch
// `Transform` and Bevy needs the archetypes proven disjoint.
#[allow(clippy::type_complexity)]
fn sync_tavern_knight(
    time: Res<Time<Fixed>>,
    res: Res<TavernRes>,
    art: Res<KnightArt>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut q: Query<
        (
            &mut Transform,
            &mut MeshMaterial3d<StandardMaterial>,
            &TavernKnightMats,
        ),
        With<TavernKnight>,
    >,
    mut blob_q: Query<&mut Transform, (With<KnightBlob>, Without<TavernKnight>)>,
    cam: Query<
        &Transform,
        (
            With<DungeonCamera>,
            Without<TavernKnight>,
            Without<KnightBlob>,
        ),
    >,
) {
    let Ok((mut tf, mut mat, mats)) = q.single_mut() else {
        return;
    };
    let a = time.overstep_fraction() as f64;
    let x = res.prev.0 + (res.curr.0 - res.prev.0) * a;
    let z = res.prev.1 + (res.curr.1 - res.prev.1) * a;
    tf.translation.x = x as f32;
    tf.translation.z = z as f32;

    if let Ok(cam_tf) = cam.single() {
        tf.rotation = cam_tf.rotation;
    }
    let mirror = res.pose.facing == Facing::W;
    tf.scale.x = if mirror { -1.0 } else { 1.0 };

    // The blob is a sibling, so it tracks the feet by hand — the quad's origin
    // is its centre, so the feet are half a quad below the billboard's y.
    if let Ok(mut blob) = blob_q.single_mut() {
        blob.translation.x = tf.translation.x;
        blob.translation.z = tf.translation.z;
        blob.translation.y = tf.translation.y - tf.scale.y * KNIGHT_QUAD_H / 2.0 + BLOB_LIFT;
    }

    // The MASKED clones, not `art.*.material` — see the spawn block. Driving
    // the shared handles here would leave the tavern's knight on frame 0 AND
    // scribble over the dungeon's and the intro's uv_transform.
    let (clips, sheet_mat) = match res.pose.facing {
        Facing::S => (&art.s, &mats.s),
        Facing::N => (&art.n, &mats.n),
        Facing::E | Facing::W => (&art.e, &mats.e),
    };
    mat.0 = sheet_mat.clone();

    let moving = res.pose.speed > WALK_CLIP_THRESHOLD;
    let cells = if moving { &clips.walk } else { &clips.idle };
    if cells.is_empty() {
        return;
    }
    // Gait quickens with speed (legacy setRate 0.7 + speed/WALK * 0.6), on
    // the slice's 8/4 fps clip timing.
    let rate = if moving {
        0.7 + (res.pose.speed / pk_core::tavern::player::WALK_SPEED) * 0.6
    } else {
        1.0
    };
    let fps = if moving { 8.0 } else { 4.0 } * rate;
    let frame = (res.pose.anim_t * fps) as usize % cells.len();
    let [u, v, uw, vh] = cells[frame];
    if let Some(m) = materials.get_mut(sheet_mat) {
        m.uv_transform = bevy::math::Affine2 {
            matrix2: Mat2::from_diagonal(Vec2::new(uw, vh)),
            translation: Vec2::new(u, v),
        };
    }
}

/// Wide hub camera: anchored on the room's centre, leaning CAM_LEAN toward
/// the player (and further toward a focused station). Never rotates.
fn tavern_camera(
    time: Res<Time>,
    mut res: ResMut<TavernRes>,
    mut cam: Query<&mut Transform, With<DungeonCamera>>,
) {
    let Ok(mut tf) = cam.single_mut() else { return };
    let dt = time.delta_secs_f64().min(0.05);
    let focus = res.focus.map(|s| (s.x, s.z));
    let (tx, tz) = camera_target(res.pose.x, res.pose.z, focus);
    let (mut cx, mut cz) = res.cam;
    ease_camera(&mut cx, &mut cz, tx, tz, dt);
    res.cam = (cx, cz);
    let target = Vec3::new(cx as f32, 0.0, cz as f32);
    tf.translation = target + camera_offset();
    tf.look_at(target, Vec3::Y);
}

/// The keeper spots are data the tests pin; referenced here so the shell and
/// the plan can never disagree about the cast size.
#[allow(dead_code)]
const KEEPER_COUNT: usize = KEEPER_SPOTS.len();
#[allow(dead_code)]
fn _rect_used(_r: &LRect) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// The baked billboard has to point the quad's face AT the camera. Nothing
    /// on screen says so quietly: a wrong Euler order or a sign flip shows up
    /// as sprites skewed or edge-on, which is exactly what the port would look
    /// like if `rot_z` overwrote the bake instead of composing with it.
    #[test]
    fn the_baked_billboard_faces_the_iso_camera() {
        // +Z is the quad's normal (Bevy's Rectangle lies in XY facing +Z).
        let normal = billboard(0.0) * Vec3::Z;
        let to_camera = camera_offset().normalize();
        assert!(
            normal.distance(to_camera) < 1e-5,
            "quad normal {normal:?} does not point at the camera {to_camera:?}"
        );
    }

    /// The lean is a rotation about the sprite's OWN z (legacy sets
    /// `mesh.rotation.z` on a YXZ euler, i.e. innermost/local), so it must
    /// leave the normal — the axis pointing at the camera — untouched.
    #[test]
    fn the_lean_composes_with_the_bake_instead_of_replacing_it() {
        let flat = billboard(0.0);
        let leaned = billboard(0.12);
        assert!(flat.angle_between(leaned) > 1e-3, "the lean did nothing");
        // Same face direction, different roll about it.
        assert!((flat * Vec3::Z).distance(leaned * Vec3::Z) < 1e-5);
        assert!((flat * Vec3::Y).distance(leaned * Vec3::Y) > 1e-3);
    }

    /// The keeper quad's origin is its FEET: the mesh is pushed up so the
    /// sprite occupies y 0..SPRITE_UNITS, which is what lets the ported idle
    /// loops write `pose.y` straight into the transform.
    #[test]
    fn the_keeper_quad_stands_on_its_origin() {
        let mesh = Mesh::from(Rectangle::new(SPRITE_UNITS, SPRITE_UNITS)).translated_by(Vec3::new(
            0.0,
            SPRITE_UNITS / 2.0,
            0.0,
        ));
        let ys: Vec<f32> = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
            Some(bevy::mesh::VertexAttributeValues::Float32x3(p)) => {
                p.iter().map(|v| v[1]).collect()
            }
            _ => panic!("the quad has float positions"),
        };
        let min = ys.iter().copied().fold(f32::INFINITY, f32::min);
        let max = ys.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        assert!(min.abs() < 1e-6, "feet at {min}, not 0");
        assert!((max - SPRITE_UNITS).abs() < 1e-6, "head at {max}");
    }
}
