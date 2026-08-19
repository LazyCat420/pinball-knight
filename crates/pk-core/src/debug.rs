//! 🛠️ The Debug Panel — God-mode test console and live cheat dispatcher.
//!
//! PORTS: `debug-panel.ts`

use std::sync::atomic::{AtomicBool, Ordering};

static PANEL_VISIBLE: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq)]
pub struct SpawnableEntry {
    pub kind: String,
    pub label: String,
}

pub fn spawnable_enemies() -> Vec<SpawnableEntry> {
    vec![
        SpawnableEntry { kind: "zombie".to_string(), label: "Zombie".to_string() },
        SpawnableEntry { kind: "skeleton".to_string(), label: "Skeleton".to_string() },
        SpawnableEntry { kind: "slime".to_string(), label: "Slime".to_string() },
        SpawnableEntry { kind: "necromancer".to_string(), label: "Necromancer".to_string() },
        SpawnableEntry { kind: "gargoyle".to_string(), label: "Gargoyle".to_string() },
        SpawnableEntry { kind: "dragon".to_string(), label: "Dragon".to_string() },
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct DebugFlags {
    pub god_mode: bool,
    pub infinite_mana: bool,
    pub no_cooldowns: bool,
    pub show_hitboxes: bool,
    pub free_cam: bool,
    pub floor_lock: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DebugAction {
    Heal,
    AddGold(u32),
    GrantXp(u32),
    GrantSkillPoints(u32),
    FillRampage,
    KillAll,
    ClearEnemies,
    NextFloor,
    GotoFloor(u32),
    NextBoss,
    SpawnReaper,
    TeleportStairs,
    SpawnRing,
    GiveWeapon(String),
    ApplyPotion(String),
    ApplyMaterial(String),
    SpawnEnemy(String, usize),
}

#[derive(Clone, Debug, Default)]
pub struct DebugActions {
    pub actions: Vec<DebugAction>,
}

impl DebugActions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, action: DebugAction) {
        self.actions.push(action);
    }
}

pub fn create_debug_panel() {}

pub fn toggle_debug_panel() -> bool {
    let current = PANEL_VISIBLE.load(Ordering::Relaxed);
    let next = !current;
    PANEL_VISIBLE.store(next, Ordering::Relaxed);
    next
}

pub fn dispose_debug_panel() {
    PANEL_VISIBLE.store(false, Ordering::Relaxed);
}

#[derive(Clone, Debug, Default)]
pub struct DebugConsoleState {
    pub flags: DebugFlags,
    pub log: Vec<String>,
}

impl DebugConsoleState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn toggle_god_mode(&mut self) -> bool {
        self.flags.god_mode = !self.flags.god_mode;
        self.flags.god_mode
    }

    pub fn toggle_infinite_mana(&mut self) -> bool {
        self.flags.infinite_mana = !self.flags.infinite_mana;
        self.flags.infinite_mana
    }

    pub fn toggle_no_cooldowns(&mut self) -> bool {
        self.flags.no_cooldowns = !self.flags.no_cooldowns;
        self.flags.no_cooldowns
    }

    pub fn toggle_hitboxes(&mut self) -> bool {
        self.flags.show_hitboxes = !self.flags.show_hitboxes;
        self.flags.show_hitboxes
    }

    pub fn set_floor_lock(&mut self, floor: Option<u32>) {
        self.flags.floor_lock = floor.map(|f| f.clamp(1, 40));
    }

    pub fn dispatch(&mut self, action: DebugAction) {
        match &action {
            DebugAction::Heal => self.log.push("Player healed to maximum HP".to_string()),
            DebugAction::AddGold(g) => self.log.push(format!("Added {} gold to inventory", g)),
            DebugAction::GrantXp(x) => self.log.push(format!("Granted {} XP to player", x)),
            DebugAction::GotoFloor(f) => self.log.push(format!("Warped to floor {}", f)),
            DebugAction::GiveWeapon(w) => self.log.push(format!("Equipped weapon {}", w)),
            _ => self.log.push(format!("Executed debug action: {:?}", action)),
        }
    }

    pub fn log_message(&mut self, msg: impl Into<String>) {
        self.log.push(msg.into());
    }
}
