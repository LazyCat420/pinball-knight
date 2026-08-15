//! Tavern Pool Presence — Hub end of the drop-in multiplayer presence pool.
//!
//! PORTS: `legacy/src/scenes/tavern/multiplayer.ts`

pub const TAVERN_SCENE: &str = "tavern";

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TavernPoolPresence {
    pub connected: bool,
    pub online_count: usize,
    pub scene: &'static str,
}

impl TavernPoolPresence {
    pub fn new() -> Self {
        Self {
            connected: false,
            online_count: 0,
            scene: TAVERN_SCENE,
        }
    }

    /// Initializes presence for the tavern scene. Returns false if backend is unreachable.
    pub fn init_tavern_pool(&mut self, is_connected: bool, count: usize) -> bool {
        self.connected = is_connected;
        self.online_count = if is_connected { count } else { 0 };
        self.scene = TAVERN_SCENE;
        is_connected
    }

    pub fn is_multiplayer_active(&self) -> bool {
        self.connected
    }

    pub fn pool_online_count(&self) -> usize {
        self.online_count
    }

    pub fn dispose_tavern_pool(&mut self) {
        self.connected = false;
        self.online_count = 0;
    }
}
