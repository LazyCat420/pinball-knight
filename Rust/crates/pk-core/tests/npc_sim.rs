// Parity test suite for Dungeon NPCs (Magician, Speed Witch, Oracle Frog, Merchant).
// Replicates legacy/src/game/pinball-knight/entities/npc.ts

use pk_core::entities::npc::*;
use pk_core::grid::Grid;
use pk_core::rng::Mulberry32;
use pk_core::state::SimState;

#[test]
fn npc_lifecycle_and_spawns() {
    let mut sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 12345);
    let mut rng = Mulberry32::new(12345);

    spawn_frog(&mut sim, 3, 3);
    spawn_merchant(&mut sim, 8, 8);
    spawn_witch(&mut sim, 4.0, 4.0);

    assert_eq!(sim.npcs.len(), 3);

    // Update NPCs
    update_npcs(&mut sim, 0.1, &mut rng);
    assert_eq!(sim.npcs.len(), 3);

    dispose_npcs(&mut sim);
    assert!(sim.npcs.is_empty());
}
