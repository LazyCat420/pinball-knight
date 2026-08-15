//! 🛠️ The Debug Panel — God-mode test console and live cheat dispatcher.
//!
//! PORTS: `debug-panel.ts`

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

    pub fn set_floor_lock(&mut self, floor: Option<u32>) {
        self.flags.floor_lock = floor.map(|f| f.clamp(1, 40));
    }

    pub fn dispatch(&mut self, action: DebugAction) {
        let msg = match &action {
            DebugAction::Heal => "Action: Player healed to full".to_string(),
            DebugAction::AddGold(n) => format!("Action: Added {} gold", n),
            DebugAction::GrantXp(n) => format!("Action: Granted {} XP", n),
            DebugAction::GrantSkillPoints(n) => format!("Action: Granted {} skill points", n),
            DebugAction::FillRampage => "Action: Filled rampage meter".to_string(),
            DebugAction::KillAll => "Action: Killed all active horde monsters".to_string(),
            DebugAction::ClearEnemies => "Action: Cleared enemy spawns".to_string(),
            DebugAction::NextFloor => "Action: Progressing to next floor".to_string(),
            DebugAction::GotoFloor(n) => format!("Action: Jump to floor {}", n.clamp(&1, &40)),
            DebugAction::NextBoss => "Action: Advanced to boss encounter".to_string(),
            DebugAction::SpawnReaper => "Action: Summoned Death Dealer Reaper".to_string(),
            DebugAction::TeleportStairs => "Action: Teleported player to stairs".to_string(),
            DebugAction::SpawnRing => "Action: Triggered debug shockwave ring".to_string(),
            DebugAction::GiveWeapon(w) => format!("Action: Equipped weapon {}", w),
            DebugAction::ApplyPotion(p) => format!("Action: Quaffed potion {}", p),
            DebugAction::ApplyMaterial(m) => format!("Action: Applied material {}", m),
            DebugAction::SpawnEnemy(k, count) => format!("Action: Spawned {}x {}", count, k),
        };
        self.log.push(msg);
    }
}
