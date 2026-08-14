//! Visual melee slash arc trail renderer.
//!
//! PORTS: `fx/system.ts`, `fx/pools/slash-pool.ts`, `render/pinball-parts.ts`

use bevy::prelude::*;

#[derive(Component)]
pub struct SlashArcTrail {
    pub lifetime: f32,
    pub max_lifetime: f32,
}

/// Spawns a glowing curved slash blade trail in front of the attacking knight.
pub fn spawn_slash_arc_trail(
    commands: &mut Commands,
    meshes: &mut Assets<Mesh>,
    materials: &mut Assets<StandardMaterial>,
    origin: Vec3,
    facing_dir: Vec2,
    color: Color,
) {
    let angle = facing_dir.y.atan2(facing_dir.x);
    let rot = Quat::from_rotation_y(-angle);

    let mesh = meshes.add(Annulus::new(0.5, 1.25));
    let mat = materials.add(StandardMaterial {
        base_color: color,
        emissive: LinearRgba::from(color) * 3.0,
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    commands.spawn((
        SlashArcTrail {
            lifetime: 0.18,
            max_lifetime: 0.18,
        },
        Mesh3d(mesh),
        MeshMaterial3d(mat),
        Transform::from_translation(origin + Vec3::new(facing_dir.x * 0.7, 0.4, facing_dir.y * 0.7))
            .with_rotation(rot * Quat::from_rotation_x(-std::f32::consts::FRAC_PI_3)),
    ));
}

/// Updates slash blade trails, fading their alpha and scaling slightly before despawning.
pub fn step_slash_trails(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut SlashArcTrail, &mut Transform, &MeshMaterial3d<StandardMaterial>)>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let dt = time.delta_secs();
    for (entity, mut trail, mut tf, mat_handle) in q.iter_mut() {
        trail.lifetime -= dt;
        if trail.lifetime <= 0.0 {
            commands.entity(entity).despawn();
        } else {
            let t = (trail.lifetime / trail.max_lifetime).clamp(0.0, 1.0);
            tf.scale = Vec3::splat(1.0 + (1.0 - t) * 0.3);
            if let Some(mat) = materials.get_mut(&mat_handle.0) {
                mat.base_color.set_alpha(t * 0.75);
            }
        }
    }
}
