//! Comprehensive test suite for gui/screens/debug.ts constants, chip label formatters, and console actions.

use pk_gui::screens::debug::*;

struct DummyConsoleActions {
    pub god_mode: bool,
    pub noclip: bool,
    pub spawned_monsters: Vec<String>,
}

impl ConsoleActions for DummyConsoleActions {
    fn toggle_god_mode(&mut self) {
        self.god_mode = !self.god_mode;
    }
    fn toggle_noclip(&mut self) {
        self.noclip = !self.noclip;
    }
    fn spawn_monster(&mut self, kind: &str) {
        self.spawned_monsters.push(kind.to_string());
    }
    fn give_potion(&mut self, _id: &str) {}
    fn set_ability_rank(&mut self, _id: &str, _rank: u32) {}
    fn max_all_skills(&mut self) {}
    fn clear_all_skills(&mut self) {}
}

#[test]
fn debug_constants_and_dimensions() {
    assert_eq!(DESIGN_W, 560.0);
    assert_eq!(DESIGN_H, 340.0);
    assert_eq!(DESIGN_MAX, 2);
    assert_eq!(CHIP_CHARS, 8);
    assert_eq!(ROW_CHARS, 22);
    assert_eq!(BIND_CHARS, 17);
    assert_eq!(HEAD_CHARS, 26);

    assert_eq!(section::CHEATS, "CHEATS");
    assert_eq!(section::MONSTERS, "MONSTERS");
    assert_eq!(section::POTIONS, "POTIONS");
    assert_eq!(section::ABILITIES, "ABILITIES");
    assert_eq!(section::SKILLS, "SKILLS");
    assert_eq!(section::SOUND, "SOUND");

    assert_eq!(skill_acts::MAX, "MAX ALL");
    assert_eq!(skill_acts::CLEAR, "CLEAR");
    assert_eq!(sound_acts::WAKE, "UNMUTE THE APP");
    assert_eq!(bed_label("fire"), "FIRE BED");
    assert_eq!(bed_label("water"), "WATERBED");
}

#[test]
fn debug_chip_label_formatters() {
    assert_eq!(sfx_chip_label("flipper_launch"), "FLIPPER_LAUNCH");
    assert_eq!(sound_heading(false, 0.8), "SOUND: 80%");
    assert_eq!(sound_heading(true, 0.5), "SOUND: MUTED (50%)");

    assert_eq!(monster_chip_label("croaker"), "CROAKER");
    assert_eq!(potion_chip_label("speed_potion"), "SPEED_POTION");
    assert_eq!(skill_chip_label("swift_cast", 0), "SWIFT_CAST");
    assert_eq!(skill_chip_label("swift_cast", 3), "SWIFT_CAST [3]");
}

#[test]
fn console_actions_trait_execution() {
    let mut actions = DummyConsoleActions {
        god_mode: false,
        noclip: false,
        spawned_monsters: Vec::new(),
    };

    actions.toggle_god_mode();
    assert!(actions.god_mode);

    actions.toggle_noclip();
    assert!(actions.noclip);

    actions.spawn_monster("reaper");
    assert_eq!(actions.spawned_monsters, vec!["reaper".to_string()]);
}
