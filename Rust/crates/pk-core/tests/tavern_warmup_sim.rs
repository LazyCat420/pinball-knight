// Parity test suite for Tavern WebGPU Pipeline Warmup.
// Replicates legacy/src/scenes/tavern/warmup.ts

use pk_core::tavern::warmup::{TavernWarmupMesh, TavernWarmupScheduler};

#[test]
fn warmup_scheduler_reveals_compiles_and_restores_cleanly() {
    let mut meshes = vec![
        TavernWarmupMesh {
            id: 1,
            visible: false,
            frustum_culled: true,
        },
        TavernWarmupMesh {
            id: 2,
            visible: true,
            frustum_culled: false,
        },
        TavernWarmupMesh {
            id: 3,
            visible: true,
            frustum_culled: true,
        },
    ];

    let mut scheduler = TavernWarmupScheduler::new();

    // 1. Reveal sweep
    scheduler.reveal_for_compile(&mut meshes);
    assert_eq!(scheduler.saved_states.len(), 2); // mesh 1 and mesh 3 were hidden/culled
    assert!(meshes.iter().all(|m| m.visible && !m.frustum_culled));

    // 2. Sequential compilation
    scheduler.compile_step();
    scheduler.compile_step();
    scheduler.compile_step();
    assert_eq!(scheduler.compiled_units_count, 3);

    // 3. Restore before warm frames
    scheduler.restore(&mut meshes);
    assert_eq!(meshes[0].visible, false);
    assert_eq!(meshes[0].frustum_culled, true);
    assert_eq!(meshes[1].visible, true);
    assert_eq!(meshes[1].frustum_culled, false);
    assert_eq!(meshes[2].visible, true);
    assert_eq!(meshes[2].frustum_culled, true);

    // 4. Render 2 presentation frames
    scheduler.render_warm_frame();
    scheduler.render_warm_frame();
    assert_eq!(scheduler.warm_frames_rendered, 2);
}
