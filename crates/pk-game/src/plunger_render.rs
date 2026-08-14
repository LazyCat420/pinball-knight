//! 3D Plunger Rig and Interactive Launch Aiming.
//!
//! Renders the launch chute hardware behind the knight while parked on a new floor,
//! animating the striker pullback with charging power, and showing the aiming trajectory.

use bevy::prelude::*;

#[derive(Component)]
pub struct PlungerRig;

#[derive(Component)]
pub struct PlungerStriker;

#[derive(Component)]
pub struct PlungerAimPoint {
    pub step: usize,
}

pub fn update_plunger_rig(
    mut commands: Commands,
    sim: Res<crate::Sim>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut rig_q: Query<(Entity, &mut Transform), (With<PlungerRig>, Without<PlungerStriker>)>,
    mut striker_q: Query<&mut Transform, With<PlungerStriker>>,
    aim_q: Query<(Entity, &PlungerAimPoint)>,
) {
    if !sim.0.plunger_armed {
        // Despawn rig when disarmed
        for (entity, _) in rig_q.iter() {
            commands.entity(entity).despawn();
        }
        for (entity, _) in aim_q.iter() {
            commands.entity(entity).despawn();
        }
        return;
    }

    let p = &sim.0.player;
    let (pdx, pdz) = sim.0.plunger_dir();
    let yaw = (-pdz as f32).atan2(pdx as f32);

    if let Ok((_entity, mut tf)) = rig_q.single_mut() {
        tf.translation = Vec3::new(p.x as f32, 0.0, p.z as f32);
        tf.rotation = Quat::from_rotation_y(yaw);

        // Animate striker drawing back
        if let Ok(mut st_tf) = striker_q.single_mut() {
            let pullback = 0.55 + (sim.0.plunger_power * 0.55) as f32;
            st_tf.translation.x = -pullback;
        }
    } else {
        // Spawn Plunger Rig
        commands
            .spawn((
                crate::DungeonScene,
                PlungerRig,
                Transform::from_xyz(p.x as f32, 0.0, p.z as f32).with_rotation(Quat::from_rotation_y(yaw)),
                Visibility::default(),
            ))
            .with_children(|parent| {
                // Striker child entity
                parent
                    .spawn((
                        PlungerStriker,
                        Transform::from_xyz(-0.55, 0.25, 0.0),
                        Visibility::default(),
                    ))
                    .with_children(|striker| {
                        // Gold Striker Head Disc
                        striker.spawn((
                            Mesh3d(meshes.add(Cylinder::new(0.24, 0.38))),
                            MeshMaterial3d(materials.add(StandardMaterial {
                                base_color: Color::srgb(0.35, 0.25, 0.08),
                                emissive: LinearRgba::from(Color::srgb(1.0, 0.85, 0.25)) * 1.8,
                                metallic: 0.9,
                                perceptual_roughness: 0.2,
                                ..default()
                            })),
                            Transform::from_xyz(0.1, 0.0, 0.0)
                                .with_rotation(Quat::from_rotation_z(std::f32::consts::FRAC_PI_2)),
                        ));
                        // 3 Coiled Spring Rings
                        for k in 0..3 {
                            striker.spawn((
                                Mesh3d(meshes.add(Torus::new(0.05, 0.16))),
                                MeshMaterial3d(materials.add(StandardMaterial {
                                    base_color: Color::srgb(0.22, 0.18, 0.12),
                                    emissive: LinearRgba::from(Color::srgb(1.0, 0.7, 0.1)) * 0.8,
                                    metallic: 0.8,
                                    perceptual_roughness: 0.3,
                                    ..default()
                                })),
                                Transform::from_xyz(-0.12 - (k as f32) * 0.16, 0.0, 0.0)
                                    .with_rotation(Quat::from_rotation_y(std::f32::consts::FRAC_PI_2)),
                            ));
                        }
                    });
            });
    }

    // Trajectory Aiming Line (dotted points extending down launch direction)
    let aim_count = aim_q.iter().count();
    if aim_count == 0 {
        let gold_mat = materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.85, 0.2),
            emissive: LinearRgba::from(Color::srgb(1.0, 0.85, 0.2)) * 2.5,
            unlit: true,
            ..default()
        });
        let dot_mesh = meshes.add(Sphere::new(0.06));
        for step in 1..=8 {
            commands.spawn((
                crate::DungeonScene,
                PlungerAimPoint { step },
                Mesh3d(dot_mesh.clone()),
                MeshMaterial3d(gold_mat.clone()),
                Transform::from_xyz(
                    (p.x + pdx * (step as f64) * 0.5) as f32,
                    0.12,
                    (p.z + pdz * (step as f64) * 0.5) as f32,
                ),
            ));
        }
    } else {
        // Update aim points positions
        for (entity, aim) in aim_q.iter() {
            let dist = (aim.step as f64) * 0.5;
            commands.entity(entity).insert(Transform::from_xyz(
                (p.x + pdx * dist) as f32,
                0.12,
                (p.z + pdz * dist) as f32,
            ));
        }
    }
}
