// Parity test suite for Dev Mega-Map Bundle Entry.
// Replicates legacy/src/game/pinball-knight/dev/mega-entry.ts

use pk_core::dev::mega_entry::MegaMapBundle;

#[test]
fn mega_map_bundle_interface_availability() {
    let bundle = MegaMapBundle::new();
    assert_eq!(bundle.name, "mega-map-bundle");
}
