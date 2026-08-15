//! Pinball Knight ball transformation and 3D rolling physics controller.
//!
//! PORTS: `engine/render/animator.ts`, `engine/render/figure.ts`, `entities/marble.ts`

use bevy::prelude::*;

pub const BALL_MIN_SPEED: f64 = 4.8;

#[derive(Component)]
pub struct BallSparkParticle {
    pub lifetime: f32,
    pub max_lifetime: f32,
    pub velocity: Vec3,
}

/// Computes the 3D camera plane pitch tilt for the rolling ball.
pub fn compute_ball_pitch_rotation(cam_rot: Quat, mom_speed: f64, is_rolling: bool) -> Quat {
    let speed_ratio = (((mom_speed + if is_rolling { 5.0 } else { 0.0 }) / 14.0).min(1.0)) as f32;
    let pitch = 0.38 * speed_ratio;
    cam_rot * Quat::from_rotation_x(-pitch)
}

/// Spawns particle sparks at the contact point when the ball strikes a wall or bumper.
pub fn spawn_ball_impact_sparks(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    origin: Vec3,
    normal: Vec3,
    spark_color: Color,
    count: usize,
) {
    let mesh = meshes.add(Sphere::new(0.04));
    let mat = materials.add(StandardMaterial {
        base_color: spark_color,
        emissive: LinearRgba::from(spark_color) * 3.5,
        unlit: true,
        ..default()
    });

    for i in 0..count {
        let angle = (i as f32) * (std::f32::consts::TAU / count as f32);
        let spread = Vec3::new(angle.cos() * 2.5, (i as f32 % 3.0) * 1.5 + 1.0, angle.sin() * 2.5);
        let vel = (normal * 4.0 + spread) * 0.8;

        commands.spawn((
            BallSparkParticle {
                lifetime: 0.28,
                max_lifetime: 0.28,
                velocity: vel,
            },
            Mesh3d(mesh.clone()),
            MeshMaterial3d(mat.clone()),
            Transform::from_translation(origin + normal * 0.1),
        ));
    }
}

/// Steps all active impact spark particles.
pub fn step_ball_sparks(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut BallSparkParticle, &mut Transform)>,
) {
    let dt = time.delta_secs();
    for (entity, mut spark, mut tf) in q.iter_mut() {
        spark.lifetime -= dt;
        if spark.lifetime <= 0.0 {
            commands.entity(entity).despawn();
        } else {
            tf.translation += spark.velocity * dt;
            spark.velocity.y -= 9.8 * dt; // gravity drop
            let t = spark.lifetime / spark.max_lifetime;
            tf.scale = Vec3::splat(t);
        }
    }
}
