//! Monster hit reactions, floating combat damage numbers, hurt flash, and hitstop juice.
//!
//! PORTS-PARTIAL: `engine/render/damage-text.ts` - NOT a finished port - 13 rust code lines against 185 legacy (7%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `engine/juice.ts` - NOT a finished port - 3 rust code lines against 44 legacy (7%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md
//! PORTS-PARTIAL: `entities/combat.ts` - NOT a finished port - 0 of 22 exported names carried over (0%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use bevy::prelude::*;

#[derive(Component)]
pub struct DamageNumberText {
    pub lifetime: f32,
    pub max_lifetime: f32,
    pub velocity: Vec3,
}

#[derive(Resource, Default)]
pub struct HitstopManager {
    #[allow(dead_code)]
    pub timer: f32,
}

#[allow(dead_code)]
impl HitstopManager {
    pub fn trigger(&mut self, frames: u32) {
        self.timer = (frames as f32) * (1.0 / 60.0);
    }

    pub fn is_frozen(&self) -> bool {
        self.timer > 0.0
    }

    pub fn update(&mut self, dt: f32) {
        if self.timer > 0.0 {
            self.timer = (self.timer - dt).max(0.0);
        }
    }
}

/// Spawns a floating damage number above an enemy's head in 3D world space.
#[allow(dead_code)]
pub fn spawn_floating_damage(
    commands: &mut Commands,
    origin: Vec3,
    damage: i32,
    is_crit: bool,
    color: Color,
) {
    let font_size = if is_crit { 22.0 } else { 16.0 };
    let text = format!("{}", damage);

    commands.spawn((
        DamageNumberText {
            lifetime: 0.75,
            max_lifetime: 0.75,
            velocity: Vec3::new(0.0, 1.8, 0.0),
        },
        Text2d::new(text),
        TextFont {
            font_size,
            ..default()
        },
        TextColor(color),
        Transform::from_translation(origin + Vec3::new(0.0, 1.2, 0.0)),
    ));
}

/// Advances floating combat text position and alpha fadeout.
pub fn step_damage_numbers(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut DamageNumberText, &mut Transform, &mut TextColor)>,
) {
    let dt = time.delta_secs();
    for (entity, mut dtext, mut tf, mut color) in q.iter_mut() {
        dtext.lifetime -= dt;
        if dtext.lifetime <= 0.0 {
            commands.entity(entity).despawn();
        } else {
            tf.translation += dtext.velocity * dt;
            dtext.velocity.y *= 0.95; // ease upward float
            let alpha = (dtext.lifetime / dtext.max_lifetime).clamp(0.0, 1.0);
            color.0.set_alpha(alpha);
        }
    }
}
