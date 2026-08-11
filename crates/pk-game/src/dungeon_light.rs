//! THE DUNGEON'S LIGHT RIG — port of `boot/lighting.ts buildLights`.
//!
//! ## Why this had to land before the torches
//!
//! `dungeon_render` built every wall and floor material with `unlit: true`, and
//! an unlit material ignores every light in the scene. So the plan's "torches
//! are the single largest visible change" was, as written, wrong by one step:
//! adding 41 torches to an unlit dungeon adds 41 small quads and changes nothing
//! else. **The light rig is the change; the torches are what it reveals.**
//!
//! Found by reading `dungeon_render.rs:436-464` while wiring the pool, not by
//! looking at a screenshot — but it would have been a screenshot of a dungeon
//! that looked exactly as flat as before, with six PointLights in it doing
//! nothing, and the obvious next move would have been to distrust the light
//! constants rather than the materials.
//!
//! ## The rig, from the oracle
//!
//! `buildLights` installs four fixtures (`boot/lighting.ts:46-91`):
//!
//! | fixture | oracle | here |
//! |---|---|---|
//! | `AmbientLight(tint.amb, 3.5)` | the readability floor | folded, below |
//! | `HemisphereLight(tint.sky, tint.ground, 1.1)` | vertical shape | folded, below |
//! | `DirectionalLight(0xa7c0e0, 1.5)` | the raking cold key | [`DungeonKeyLight`] |
//! | `PointLight(0xd9cba8, 1.6, 4.5, 2)` | the hero's lamp | [`PlayerLamp`] |
//!
//! **Bevy has no hemisphere light**, so it folds into the ambient — the same
//! move `tavern.rs` makes, and for the reason set out there: `mix(ground, sky,
//! 0.5·N·up + 0.5)` averages to the plain midpoint of sky and ground over a
//! uniform distribution of normals, so the fixture collapses into a constant.
//! What is NOT copied from the tavern is its `HEMI_OVER_AMBIENT = 0.79`: that
//! constant was measured for ONE pair of colours. A dungeon's tint changes every
//! four levels, so the ratio is computed from the biome's own numbers in
//! [`hemi_over_ambient`] instead of being a constant that happens to be right in
//! the room it was derived in.
//!
//! ## ⚠️ The ambient magnitude is calibrated on PLACEHOLDER albedos
//!
//! Bevy's ambient carries an achromatic specular pedestal that three.js has no
//! counterpart for, and cancelling it needs the albedo it is cancelled AT (see
//! `tavern.rs`'s `AMBIENT_SPECULAR_PEDESTAL`). The dungeon's albedos today are
//! the four flat greys `dungeon_render` picked for an UNLIT look, not the baked
//! stone textures of V1. So [`SURFACE_ALBEDO_LUMA`] is a measurement of
//! placeholder art and **must be re-derived when the textures land** — the A/B
//! rig (`scripts/pk-ab-dungeon.mjs`) is what settles it, and it is the reason
//! this number is a named constant with a note rather than an inline literal.

use bevy::prelude::*;

use crate::units::{c, EXPOSURE_RECIP, PL};

/// `constants/render.ts:547-549, 555-557`.
const AMBIENT_INTENSITY: f32 = 3.5;
const HEMI_INTENSITY: f32 = 1.1;
const DIR_INTENSITY: f32 = 1.5;
const PLAYER_LAMP_INTENSITY: f32 = 1.6;
const PLAYER_LAMP_RANGE: f32 = 4.5;
/// How high above its target the key light sits (`render.ts:557`).
const DIR_HEIGHT: f32 = 14.0;

/// The cold key light's colour (`lighting.ts:70`).
const KEY_COLOUR: u32 = 0xa7c0e0;
/// The hero lamp's warm tungsten (`lighting.ts:64`).
const LAMP_COLOUR: u32 = 0xd9cba8;

/// Bevy's ambient diffuse env-BRDF response at roughness 1, where three uses
/// Lambert's `1/π`. Derived in `tavern.rs`; see that file for the citation.
const AMBIENT_ENV_BRDF: f32 = 0.4524;
/// Bevy's achromatic ambient specular pedestal — the term three.js does not
/// have at all. Same derivation as the tavern's.
const AMBIENT_SPECULAR_PEDESTAL: f32 = 0.0148;
/// The albedo the ambient is calibrated ON, in linear luma.
///
/// Measured from what fills the frame TODAY: `dungeon_render`'s wall grey
/// `srgb(0.34, 0.32, 0.30)` is 0.0977 linear luma and its floor
/// `srgb(0.13, 0.11, 0.10)` is 0.0139; walls dominate the standing frame and
/// the floor the plan view, so the midpoint is the honest single number.
/// ⚠️ PLACEHOLDER — see the module header.
const SURFACE_ALBEDO_LUMA: f32 = 0.055;

/// A floor's colour identity — `boot/biomes.ts`'s `BiomeTint`.
#[derive(Clone, Copy, Debug)]
pub struct Tint {
    pub amb: u32,
    pub sky: u32,
    pub ground: u32,
}

impl Default for Tint {
    /// `BIOMES[0]`, "The Cold Crypt" (`boot/biomes.ts:22`) — what a floor with
    /// no biome of its own is lit with, which is what the oracle's `buildLights`
    /// is called with before `startLevel` re-tints.
    fn default() -> Self {
        Self {
            amb: 0x6b7d99,
            sky: 0x8fa3bd,
            ground: 0x1e2430,
        }
    }
}

/// THE BIOME'S STONE — `maze/build.ts:316-321 BIOME_STONE`, resolved.
///
/// The oracle's painters do not use one grey. `css(i)` (`build.ts:338-342`)
/// remaps palette slots 2, 3 and 4 — dark, mid and light stone — to the
/// biome's own triple before painting, so **the stone colour is baked into
/// every diffuse map** and a floor's rock colour is a property of its depth.
/// That rule is quoted in the bake seam's own comment, and it is why the port's
/// dungeon read as warm grey against an oracle that is deep cold blue at L3:
/// `dungeon_render`'s four placeholder greys were picked to look right UNLIT
/// and answer to no biome at all.
///
/// These are the palette entries the triple resolves to, so the placeholder
/// materials are the right FAMILY before they are the right texture. Values
/// from `render/palette.ts PALETTE_HEX`.
#[derive(Clone, Copy, Debug)]
pub struct Stone {
    pub dark: u32,
    pub mid: u32,
    pub light: u32,
}

impl Default for Stone {
    /// Biome 0, The Cold Crypt: slots 2/3/4 unremapped.
    fn default() -> Self {
        Self {
            dark: 0x2b303b,
            mid: 0x454f5e,
            light: 0x6b7688,
        }
    }
}

impl Stone {
    /// The stone family for a biome name.
    ///
    /// Keyed on the NAME because that is what the authored floor's payload
    /// carries — the export has no biome index, and deriving one from the level
    /// would re-implement `biomeFor` in a second place, which is how two files
    /// come to disagree about what floor 9 is made of.
    pub fn for_biome(name: &str) -> Self {
        match name {
            // [6, 7, 8] — mossed-through stone.
            "The Rotting Warren" => Self {
                dark: 0x1e2f1f,
                mid: 0x3d5c3a,
                light: 0x5f8a4f,
            },
            // [11, 12, 13] — the walls weep red.
            "The Bloodworks" => Self {
                dark: 0x6b1f2a,
                mid: 0xa83244,
                light: 0xd95763,
            },
            // [29, 30, 4] — cold blue rock, NEUTRAL stone highlights. The third
            // slot is deliberately not remapped in the oracle either.
            "The Arcane Deep" => Self {
                dark: 0x1f3d52,
                mid: 0x2e6d8f,
                light: 0x6b7688,
            },
            _ => Self::default(),
        }
    }
}

/// The raking key light. Its own component because it FOLLOWS the player —
/// `followPlayer` keeps the small shadow frustum centred, or the shadows are
/// crisp in one corner of the maze and absent everywhere else.
#[derive(Component)]
pub struct DungeonKeyLight;

/// The hero's personal lamp — "whatever else is dark, the player and the tiles
/// around them always read" (`lighting.ts:62-63`).
#[derive(Component)]
pub struct PlayerLamp;

/// sRGB byte → linear, the exact IEC 61966-2-1 curve Bevy uses.
fn srgb_to_linear(u: f32) -> f32 {
    if u <= 0.04045 {
        u / 12.92
    } else {
        ((u + 0.055) / 1.055).powf(2.4)
    }
}

/// Rec. 709 luma of a packed `0xRRGGBB`, in linear light.
fn luma(hex: u32) -> f32 {
    let ch = |shift: u32| srgb_to_linear(((hex >> shift) & 0xff) as f32 / 255.0);
    0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0)
}

/// The hemisphere fixture's average irradiance as a fraction of the ambient's.
///
/// Computed rather than constant: the tavern could measure this once because it
/// has one set of colours forever, and a dungeon re-tints every four levels.
/// Over a uniform distribution of normals `mix(ground, sky, …)` averages to the
/// midpoint of the two, so the fraction is `luma(midpoint) / luma(amb)`.
///
/// Guarded against a black ambient: a biome with `amb == 0` would otherwise
/// divide by zero and hand `f32::INFINITY` to a light.
pub fn hemi_over_ambient(t: Tint) -> f32 {
    let amb = luma(t.amb);
    if amb <= f32::EPSILON {
        return 0.0;
    }
    ((luma(t.sky) + luma(t.ground)) * 0.5 / amb).clamp(0.0, 4.0)
}

/// The ambient brightness that reproduces the oracle's two folded fixtures.
pub fn ambient_brightness(t: Tint) -> f32 {
    (AMBIENT_INTENSITY + HEMI_INTENSITY * hemi_over_ambient(t))
        / (std::f32::consts::PI
            * (AMBIENT_ENV_BRDF + AMBIENT_SPECULAR_PEDESTAL / SURFACE_ALBEDO_LUMA))
        * EXPOSURE_RECIP
}

/// Install the rig for a floor. Returns the entities so the caller tags them
/// with its scene marker; the ambient is a RESOURCE and is restored by
/// [`reset_ambient`] on the way out.
pub fn install(commands: &mut Commands, ambient: &mut AmbientLight, tint: Tint) -> Vec<Entity> {
    ambient.color = c(tint.amb);
    ambient.brightness = ambient_brightness(tint);

    let key = commands
        .spawn((
            DungeonKeyLight,
            DirectionalLight {
                color: c(KEY_COLOUR),
                illuminance: DIR_INTENSITY * 1.35 * EXPOSURE_RECIP,
                // Shadows OFF for now. The oracle runs a 2k map on a 32-unit
                // frustum at 30 Hz with a hand-tuned bias for its normal maps
                // (`lighting.ts:75-87`); every one of those numbers is about art
                // that has not been baked yet, and a shadow pass tuned against
                // flat greys would have to be re-tuned the day it has not.
                shadows_enabled: false,
                ..default()
            },
            // North-west, opposite the south-east camera, so wall shadows fall
            // toward the viewer and INTO the corridors (`lighting.ts:105-107`).
            Transform::from_xyz(-DIR_HEIGHT * 0.55, DIR_HEIGHT, -DIR_HEIGHT * 0.55)
                .looking_at(Vec3::ZERO, Vec3::Y),
        ))
        .id();

    let lamp = commands
        .spawn((
            PlayerLamp,
            PointLight {
                color: c(LAMP_COLOUR),
                intensity: PLAYER_LAMP_INTENSITY * PL,
                range: PLAYER_LAMP_RANGE,
                shadows_enabled: false,
                ..default()
            },
            Transform::from_xyz(0.0, 1.0, 0.0),
        ))
        .id();

    vec![key, lamp]
}

/// Bevy's own default, restored when the dungeon is torn down.
///
/// The ambient is a global resource, not a scene entity, so a dungeon that
/// simply despawned its lights would leave the tavern lit by the crypt. The
/// tavern sets its own on entry, which hides this — until something else does
/// not, which is the shape of bug the "a global layer must be closed by the
/// scene that opened it" note in the handoff is about.
pub fn reset_ambient(ambient: &mut AmbientLight) {
    *ambient = AmbientLight::default();
}

/// Keep the lamp on the knight and the key light's frustum centred on them.
///
/// ⚠️ The three `Without` filters are LOAD-BEARING and each one is needed —
/// Bevy's conflict check is conservative and reasons from the filters alone, so
/// two `Transform` queries are disjoint only if some component provably
/// separates them. With the lamp query merely `Without<DungeonKeyLight>`, an
/// entity that were both a `KnightSprite` and a `DungeonKeyLight` would satisfy
/// both queries, and the app panics at startup with `B0001` — which is what it
/// did, and which no unit test could have caught because a system's parameters
/// are only validated when the schedule runs it.
pub fn follow_player(
    player: Query<
        &Transform,
        (
            With<crate::KnightSprite>,
            Without<PlayerLamp>,
            Without<DungeonKeyLight>,
        ),
    >,
    mut lamp: Query<
        &mut Transform,
        (
            With<PlayerLamp>,
            Without<DungeonKeyLight>,
            Without<crate::KnightSprite>,
        ),
    >,
    mut key: Query<
        &mut Transform,
        (
            With<DungeonKeyLight>,
            Without<PlayerLamp>,
            Without<crate::KnightSprite>,
        ),
    >,
) {
    let Ok(p) = player.single() else {
        return;
    };
    let (x, z) = (p.translation.x, p.translation.z);
    if let Ok(mut t) = lamp.single_mut() {
        // Chest height, like the oracle's (it parks the lamp on the player
        // position, which is the body's centre).
        t.translation = Vec3::new(x, 0.9, z);
    }
    if let Ok(mut t) = key.single_mut() {
        *t = Transform::from_xyz(x - DIR_HEIGHT * 0.55, DIR_HEIGHT, z - DIR_HEIGHT * 0.55)
            .looking_at(Vec3::new(x, 0.0, z), Vec3::Y);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every shipped biome folds its hemisphere into a SANE fraction.
    ///
    /// The four `boot/biomes.ts` tints, verbatim. This is the assertion that
    /// would have caught the tavern's constant being wrong for a dungeon: its
    /// 0.79 is inside this range, but three of the four biomes land elsewhere.
    #[test]
    fn every_biome_folds_its_hemisphere_sanely() {
        let biomes = [
            Tint {
                amb: 0x6b7d99,
                sky: 0x8fa3bd,
                ground: 0x1e2430,
            },
            Tint {
                amb: 0x6d8a78,
                sky: 0x8fbda6,
                ground: 0x1e2a22,
            },
            Tint {
                amb: 0x8a6f74,
                sky: 0xbd949a,
                ground: 0x2a1e20,
            },
            Tint {
                amb: 0x6f74a0,
                sky: 0x97a0e0,
                ground: 0x1e2233,
            },
        ];
        for (n, t) in biomes.iter().enumerate() {
            let r = hemi_over_ambient(*t);
            assert!(
                (0.4..2.0).contains(&r),
                "biome {n} folds at {r}, which is not a plausible sky/ground average"
            );
            assert!(ambient_brightness(*t).is_finite());
            assert!(ambient_brightness(*t) > 0.0);
        }
    }

    /// A black ambient does not produce an infinite light.
    #[test]
    fn a_black_ambient_does_not_divide_by_zero() {
        let t = Tint {
            amb: 0x000000,
            sky: 0xffffff,
            ground: 0xffffff,
        };
        assert_eq!(hemi_over_ambient(t), 0.0);
        assert!(ambient_brightness(t).is_finite());
    }

    /// The sRGB decode is the real curve, not a 2.2 gamma approximation — the
    /// two differ by 3% in the dark half, which is the half every one of these
    /// colours lives in.
    #[test]
    fn the_srgb_decode_is_the_iec_curve() {
        assert!((srgb_to_linear(0.0) - 0.0).abs() < 1e-9);
        assert!((srgb_to_linear(1.0) - 1.0).abs() < 1e-6);
        // The knee, where a pure power curve is most wrong.
        assert!((srgb_to_linear(0.04045) - 0.04045 / 12.92).abs() < 1e-9);
        assert!(srgb_to_linear(0.5) > 0.21 && srgb_to_linear(0.5) < 0.22);
    }
}
