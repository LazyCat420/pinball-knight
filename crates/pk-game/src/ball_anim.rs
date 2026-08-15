//! Pinball Knight ball transformation and 3D rolling physics controller.
//!
//! PORTS: `engine/render/animator.ts`, `engine/render/figure.ts`, `entities/marble.ts`

use bevy::prelude::*;

#[allow(dead_code)]
pub const BALL_MIN_SPEED: f64 = 4.8;

#[derive(Component)]
pub struct BallSparkParticle {
    pub lifetime: f32,
    pub max_lifetime: f32,
    pub velocity: Vec3,
}

#[derive(Resource, Default)]
pub struct MarbleSpinTracker {
    pub spin_angle: f32,
}

impl MarbleSpinTracker {
    pub fn update(&mut self, speed: f32, dt: f32) {
        if speed > 0.1 {
            // omega = v / r (r = 0.3 tiles)
            let delta_theta = (speed * dt) / 0.3;
            self.spin_angle = (self.spin_angle + delta_theta) % std::f32::consts::TAU;
        }
    }
}

/// Computes the dodge roll squash tuck factor (0.72 - 0.84).
pub fn compute_dodge_roll_tuck(tau: f32) -> f32 {
    let t = tau.clamp(0.0, 1.0);
    0.72 + 0.12 * (t * std::f32::consts::PI).sin()
}

/// Computes the 3D rotation for a dodge roll completing a 360 degree spin along the roll direction.
pub fn compute_dodge_roll_rotation(cam_rot: Quat, dir_x: f32, dir_z: f32, tau: f32) -> Quat {
    let t = tau.clamp(0.0, 1.0);
    let spin_angle = -t * std::f32::consts::TAU;
    let roll_axis = Vec3::new(dir_z, 0.0, -dir_x).normalize_or_zero();
    let roll_rot = if roll_axis.length_squared() > 0.01 {
        Quat::from_axis_angle(roll_axis, spin_angle)
    } else {
        Quat::from_rotation_x(spin_angle)
    };
    cam_rot * roll_rot
}

/// Computes the 3D rotation for a continuous pinball marble roll along its velocity vector.
pub fn compute_marble_pinball_rotation(
    cam_rot: Quat,
    dir_x: f32,
    dir_z: f32,
    speed: f32,
    spin_angle: f32,
) -> Quat {
    let speed_ratio = (speed / 14.0).clamp(0.0, 1.0);
    let pitch = 0.38 * speed_ratio;
    let tilt_rot = Quat::from_rotation_x(-pitch);

    let roll_axis = Vec3::new(dir_z, 0.0, -dir_x).normalize_or_zero();
    let spin_rot = if roll_axis.length_squared() > 0.01 {
        Quat::from_axis_angle(roll_axis, -spin_angle)
    } else {
        Quat::IDENTITY
    };
    cam_rot * tilt_rot * spin_rot
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
