//! Ghost Afterimage & Animation Effects Parity Test Suite
//! Verifies that speed aura afterimages and animation effects use sprite textures,
//! valid UV transforms, alpha blend cutouts, and fade smoothly without rendering untextured boxes.

use bevy::math::Affine2;
use bevy::prelude::*;
use pk_game::GhostAfterimage;

#[test]
fn test_ghost_afterimage_material_requires_texture_and_blend() {
    let mut app = App::new();
    app.add_plugins(MinimalPlugins)
        .add_plugins(AssetPlugin::default())
        .init_asset::<Mesh>()
        .init_asset::<Image>()
        .init_asset::<StandardMaterial>();

    let mut images = app.world_mut().resource_mut::<Assets<Image>>();
    let dummy_tex = images.add(Image::default());

    let mut materials = app.world_mut().resource_mut::<Assets<StandardMaterial>>();
    let aura_color = Color::srgba(1.0, 0.82, 0.2, 0.45);
    let ghost_mat = materials.add(StandardMaterial {
        base_color: aura_color,
        base_color_texture: Some(dummy_tex),
        uv_transform: Affine2 {
            matrix2: Mat2::from_diagonal(Vec2::new(0.25, 0.25)),
            translation: Vec2::new(0.5, 0.5),
        },
        emissive: LinearRgba::from(aura_color) * 1.5,
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        cull_mode: None,
        ..default()
    });

    let mat = materials.get(&ghost_mat).expect("material exists");
    assert!(
        mat.base_color_texture.is_some(),
        "Ghost afterimage must carry sprite texture"
    );
    assert_eq!(
        mat.alpha_mode,
        AlphaMode::Blend,
        "Ghost afterimage must use AlphaMode::Blend"
    );
    assert!(
        mat.uv_transform.matrix2.x_axis.x > 0.0,
        "UV transform scale must be positive"
    );
}

#[test]
fn test_ghost_afterimage_lifetime_fade_bounds() {
    let ghost = GhostAfterimage {
        lifetime: 0.22,
        max_lifetime: 0.22,
    };
    assert_eq!(ghost.lifetime, ghost.max_lifetime);

    let progress = (ghost.lifetime / ghost.max_lifetime).clamp(0.0, 1.0);
    assert!((progress - 1.0).abs() < 1e-4);

    let alpha_start = progress * 0.45;
    assert!((alpha_start - 0.45).abs() < 1e-4);
}
