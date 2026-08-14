// Parity test suite for Render Constants and Lighting Falloffs.
// Replicates legacy/src/game/pinball-knight/constants/render.ts

use pk_core::constants::render::{
    calculate_light_attenuation, ASPECT_RATIO, DESIGN_VIEWPORT_H, DESIGN_VIEWPORT_W,
    RUNG_BACKGROUND, RUNG_DECALS, RUNG_ENTITIES, RUNG_FLOOR, RUNG_GUI, RUNG_NOTIFICATION,
    RUNG_POST_PROCESS, RUNG_PROJECTILES, RUNG_SHADOWS, RUNG_VFX, RUNG_WALLS,
};

#[test]
fn render_sorting_rungs_are_strictly_monotonic() {
    assert!(RUNG_BACKGROUND < RUNG_FLOOR);
    assert!(RUNG_FLOOR < RUNG_DECALS);
    assert!(RUNG_DECALS < RUNG_SHADOWS);
    assert!(RUNG_SHADOWS < RUNG_WALLS);
    assert!(RUNG_WALLS < RUNG_ENTITIES);
    assert!(RUNG_ENTITIES < RUNG_PROJECTILES);
    assert!(RUNG_PROJECTILES < RUNG_VFX);
    assert!(RUNG_VFX < RUNG_POST_PROCESS);
    assert!(RUNG_POST_PROCESS < RUNG_GUI);
    assert!(RUNG_GUI < RUNG_NOTIFICATION);
}

#[test]
fn design_viewport_aspect_ratio() {
    assert_eq!(DESIGN_VIEWPORT_W / DESIGN_VIEWPORT_H, ASPECT_RATIO);
}

#[test]
fn lighting_attenuation_drops_to_zero_at_radius() {
    let inner = calculate_light_attenuation(2.0, 10.0);
    assert!(inner > 0.5);

    let at_radius = calculate_light_attenuation(10.0, 10.0);
    assert_eq!(at_radius, 0.0);

    let outside = calculate_light_attenuation(12.0, 10.0);
    assert_eq!(outside, 0.0);
}
