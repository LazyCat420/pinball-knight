//! THE PLAYTEST BOT — Autonomous player harness for unattended soak, stress, and loop testing.
//!
//! Drives inputs through the real gamepad layer rather than teleporting to stress physics, collision, and combo chains.
//!
//! PORTS: `playtest-bot.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct PlaytestBotConfig {
    pub mode: String,
    pub duration: Option<f64>,
    pub profile: bool,
}

impl Default for PlaytestBotConfig {
    fn default() -> Self {
        Self {
            mode: "default".to_string(),
            duration: None,
            profile: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PlaytestBotReport {
    pub elapsed: f64,
    pub frames: u64,
    pub stuck_events: u64,
    pub deaths: u64,
    pub max_combo: u32,
    pub kills: u32,
}

#[derive(Clone, Debug)]
pub struct PlaytestBot {
    pub config: PlaytestBotConfig,
    pub running: bool,
    pub elapsed: f64,
    pub frames: u64,
    pub last_x: f64,
    pub last_z: f64,
    pub stuck_timer: f64,
    pub stuck_count: u64,
    pub deaths: u64,
    pub max_combo: u32,
    pub kills: u32,
}

impl Default for PlaytestBot {
    fn default() -> Self {
        Self::new(PlaytestBotConfig::default())
    }
}

impl PlaytestBot {
    pub fn new(config: PlaytestBotConfig) -> Self {
        Self {
            config,
            running: false,
            elapsed: 0.0,
            frames: 0.0 as u64,
            last_x: 0.0,
            last_z: 0.0,
            stuck_timer: 0.0,
            stuck_count: 0,
            deaths: 0,
            max_combo: 0,
            kills: 0,
        }
    }

    pub fn start(&mut self) {
        self.running = true;
        self.elapsed = 0.0;
        self.frames = 0;
        self.stuck_timer = 0.0;
        self.stuck_count = 0;
        self.deaths = 0;
        self.max_combo = 0;
        self.kills = 0;
    }

    pub fn stop(&mut self) -> PlaytestBotReport {
        self.running = false;
        PlaytestBotReport {
            elapsed: self.elapsed,
            frames: self.frames,
            stuck_events: self.stuck_count,
            deaths: self.deaths,
            max_combo: self.max_combo,
            kills: self.kills,
        }
    }

    /// Advances the bot frame by frame, returning synthetic thumbstick axes [x, y] and button mask.
    pub fn step(
        &mut self,
        player_x: f64,
        player_z: f64,
        is_dead: bool,
        combo: u32,
        kills: u32,
        dt: f64,
    ) -> ([f32; 2], u32) {
        if !self.running {
            return ([0.0, 0.0], 0);
        }

        self.frames += 1;
        self.elapsed += dt;
        self.max_combo = self.max_combo.max(combo);
        self.kills = self.kills.max(kills);

        if is_dead {
            self.deaths += 1;
            // Tap retry/tavern button (bit 0 = South / A)
            return ([0.0, 0.0], 1);
        }

        // Check if duration exceeded
        if let Some(dur) = self.config.duration {
            if self.elapsed >= dur {
                self.running = false;
                return ([0.0, 0.0], 0);
            }
        }

        // Stuck detection: displacement < 0.05 while pushing stick for > 1.5s
        let dx = player_x - self.last_x;
        let dz = player_z - self.last_z;
        let dist_sq = dx * dx + dz * dz;

        if dist_sq < 0.0025 {
            self.stuck_timer += dt;
            if self.stuck_timer > 1.5 {
                self.stuck_count += 1;
                self.stuck_timer = 0.0;
            }
        } else {
            self.stuck_timer = 0.0;
        }

        self.last_x = player_x;
        self.last_z = player_z;

        // Oscillate stick based on frame counter to generate continuous traversal
        let angle = (self.frames as f32 * 0.05).sin();
        let stick_x = angle.cos();
        let stick_y = angle.sin();

        // Periodically tap attack / flippers (bit 1 = East / B, bit 2 = West / X)
        let mut buttons = 0;
        if self.frames % 30 < 5 {
            buttons |= 1 << 1; // Flipper / attack tap
        }

        ([stick_x, stick_y], buttons)
    }
}
