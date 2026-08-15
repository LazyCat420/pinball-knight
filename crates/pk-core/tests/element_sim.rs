// Parity test suite for Common Elemental Shader Material Configuration.
// Replicates legacy/src/game/pinball-knight/fx/elements/element.ts

use pk_core::fx::element::{get_element_config, is_element_additive, ElementKind};

#[test]
fn additive_split_matches_specification() {
    assert!(is_element_additive(ElementKind::Fire));
    assert!(is_element_additive(ElementKind::Frost));
    assert!(is_element_additive(ElementKind::Rod));

    assert!(!is_element_additive(ElementKind::Slick));
    assert!(!is_element_additive(ElementKind::Oil));
    assert!(!is_element_additive(ElementKind::Tar));
}

#[test]
fn element_configs_enforce_no_depth_write_and_transparency() {
    let kinds = [
        ElementKind::Fire,
        ElementKind::Slick,
        ElementKind::Frost,
        ElementKind::Oil,
        ElementKind::Tar,
        ElementKind::Rod,
    ];

    for kind in kinds {
        let cfg = get_element_config(kind);
        assert!(cfg.transparent);
        assert!(!cfg.depth_write);
        assert_eq!(cfg.additive, is_element_additive(kind));
    }
}
