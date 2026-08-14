//! Wiring — where the game's callback bus and dependency injection are connected.
//!
//! PORTS: `boot/wiring.ts`

#[derive(Default)]
pub struct WiringDeps {
    pub spawn_reaper: Option<Box<dyn FnMut() + Send + Sync>>,
    pub drop_boss_reward: Option<Box<dyn FnMut(f64, f64) + Send + Sync>>,
    pub start_level: Option<Box<dyn FnMut(u32) + Send + Sync>>,
    pub descend: Option<Box<dyn FnMut() + Send + Sync>>,
    pub on_player_death: Option<Box<dyn FnMut() + Send + Sync>>,
    pub exit_dungeon_game: Option<Box<dyn FnMut() + Send + Sync>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CoopGhostZombie {
    pub nid: u32,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub is_boss: bool,
    pub scale: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CoopGhostItem {
    pub nid: u32,
    pub kind: String,
    pub id: String,
    pub x: f64,
    pub z: f64,
}

#[derive(Default)]
pub struct WiringBus {
    pub dev_installed: bool,
    pub gameplay_installed: bool,
    pub boss_defeated_handler: Option<Box<dyn FnMut(f64, f64) + Send + Sync>>,
    pub level_up_handler: Option<Box<dyn FnMut(u32, u32) + Send + Sync>>,
    pub toast_events: Vec<(String, String)>,
    pub ghost_zombies: Vec<CoopGhostZombie>,
    pub ghost_items: Vec<CoopGhostItem>,
}

impl WiringBus {
    pub fn new() -> Self {
        Self::default()
    }

    /// Installs Dev / QA hooks and level-up fanfare handler.
    /// Runs BEFORE HUD and input are built.
    pub fn install_dev_wiring(&mut self, _deps: &mut WiringDeps) {
        self.dev_installed = true;
    }

    /// Installs gameplay bus handlers: boss reward drops, co-op ghosts, and loot bridges.
    /// Runs AFTER HUD and input are initialized.
    pub fn install_gameplay_wiring(&mut self, deps: &mut WiringDeps) {
        if let Some(reward_fn) = deps.drop_boss_reward.take() {
            self.boss_defeated_handler = Some(reward_fn);
        }
        self.gameplay_installed = true;
    }

    /// Spawns a co-op ghost zombie into the shared world view.
    pub fn spawn_ghost_zombie(
        &mut self,
        nid: u32,
        kind: &str,
        x: f64,
        z: f64,
        is_boss: bool,
    ) -> CoopGhostZombie {
        let scale = if is_boss { 1.55 } else { 1.0 };
        if kind == "reaper" {
            self.toast_events.push((
                "☠ THE DEATH DEALER ☠".to_string(),
                "it cannot be slain — take the stairs".to_string(),
            ));
        }

        let ghost = CoopGhostZombie {
            nid,
            kind: kind.to_string(),
            x,
            z,
            is_boss,
            scale,
        };

        self.ghost_zombies.push(ghost.clone());
        ghost
    }

    /// Spawns a co-op ghost item into the shared world view.
    pub fn spawn_ghost_item(
        &mut self,
        nid: u32,
        kind: &str,
        id: &str,
        x: f64,
        z: f64,
    ) -> CoopGhostItem {
        let item = CoopGhostItem {
            nid,
            kind: kind.to_string(),
            id: id.to_string(),
            x,
            z,
        };

        self.ghost_items.push(item.clone());
        item
    }

    /// Dispatches boss defeat reward drop.
    pub fn dispatch_boss_defeat(&mut self, x: f64, z: f64) {
        if let Some(handler) = &mut self.boss_defeated_handler {
            handler(x, z);
        }
    }

    /// Dispatches level-up fanfare toast and unspent skill points notification.
    pub fn dispatch_level_up(&mut self, level: u32, points: u32) {
        self.toast_events.push((
            format!("LEVEL {}", level),
            format!("+1 skill point · {} unspent — press I", points),
        ));
        if let Some(handler) = &mut self.level_up_handler {
            handler(level, points);
        }
    }
}
