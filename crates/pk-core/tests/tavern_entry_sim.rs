// Parity test suite for Public Tavern Entry Interface.
// Replicates legacy/src/scenes/tavern/index.ts

use pk_core::tavern::entry::{resolve_tavern_entry, OpenTavernOptions, TavernEntryKind};

#[test]
fn tavern_entry_flow_routes_between_scene_and_flat_sheet() {
    let opts = OpenTavernOptions::default();

    assert_eq!(resolve_tavern_entry(true, &opts), TavernEntryKind::Scene);
    assert_eq!(resolve_tavern_entry(false, &opts), TavernEntryKind::Dom);
}
