//! Monster hit reactions, floating combat damage numbers, hurt flash, and hitstop juice.
//!
//! PORTS: `engine/render/damage-text.ts`

use bevy::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DamageTextKind {
    Out,
    Crit,
    In,
}

pub const POOL_SIZE: usize = 32;
pub const POP_PEAK: f32 = 1.45;
pub const HEAD_WORLD_H: f32 = 0.75;
pub const GLYPH_WORLD_H: f32 = 0.25;

#[derive(Clone, Debug, PartialEq)]
pub struct DamageTextStyle {
    pub color: Color,
    pub font_size: f32,
    pub is_crit: bool,
}

pub fn format_damage(amount: f64) -> String {
    format!("{}", amount.round() as i64)
}

pub fn damage_text_style(amount: f64, kind: DamageTextKind) -> DamageTextStyle {
    match kind {
        DamageTextKind::Crit => DamageTextStyle {
            color: Color::srgb(1.0, 0.85, 0.2),
            font_size: 22.0,
            is_crit: true,
        },
        DamageTextKind::In => DamageTextStyle {
            color: Color::srgb(0.9, 0.2, 0.2),
            font_size: 16.0,
            is_crit: false,
        },
        DamageTextKind::Out => {
            if amount >= 50.0 {
                DamageTextStyle {
                    color: Color::srgb(1.0, 0.6, 0.1),
                    font_size: 18.0,
                    is_crit: false,
                }
            } else {
                DamageTextStyle {
                    color: Color::srgb(1.0, 1.0, 1.0),
                    font_size: 14.0,
                    is_crit: false,
                }
            }
        }
    }
}

pub fn damage_text_frame(age: f32, life: f32) -> (f32, f32, f32) {
    let t = (age / life).clamp(0.0, 1.0);
    let alpha = if t > 0.7 { 1.0 - (t - 0.7) / 0.3 } else { 1.0 };
    let scale = if t < 0.2 { 1.0 + (t / 0.2) * (POP_PEAK - 1.0) } else { POP_PEAK - (t - 0.2) * 0.4 };
    let rise = age * 0.8;
    (alpha, scale, rise)
}

#[derive(Default, Clone, Debug)]
pub struct DamageTextPool {
    pub active_count: usize,
}

impl DamageTextPool {
    pub fn new() -> Self {
        Self { active_count: 0 }
    }

    pub fn spawn(&mut self, _amount: f64, _kind: DamageTextKind) {
        if self.active_count < POOL_SIZE {
            self.active_count += 1;
        }
    }

    pub fn clear(&mut self) {
        self.active_count = 0;
    }
}

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

/// Advances active floating damage numbers, applying upward velocity and alpha fade out.
#[allow(dead_code)]
pub fn step_damage_numbers(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut DamageNumberText, &mut Transform, &mut TextColor)>,
) {
    let dt = time.delta_secs();
    for (entity, mut dmg, mut tf, mut color) in q.iter_mut() {
        dmg.lifetime -= dt;
        if dmg.lifetime <= 0.0 {
            commands.entity(entity).despawn();
        } else {
            tf.translation += dmg.velocity * dt;
            let alpha = (dmg.lifetime / dmg.max_lifetime).clamp(0.0, 1.0);
            color.0.set_alpha(alpha);
        }
    }
}
