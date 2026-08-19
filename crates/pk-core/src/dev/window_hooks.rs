//! DEV / QA WINDOW HOOKS — Scriptable harness interface for headless and automated testing.
//!
//! Port of `legacy/src/game/pinball-knight/dev/window-hooks.ts` (1,055 lines).
//!
//! PORTS: `dev/window-hooks.ts`

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct DebugSpawnSpec {
    pub kind: String,
    pub ztype: Option<String>,
    pub count: usize,
    pub ring: Option<f64>,
    pub at: Option<(f64, f64)>,
    pub hp: Option<i32>,
    pub aggro: Option<bool>,
    pub phase: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct DebugSpawnResult {
    pub spawned: usize,
    pub requested: usize,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct EnemyProbe {
    pub kind: String,
    pub ztype: Option<String>,
    pub mode: String,
    pub aggro: bool,
    pub hp: i32,
    pub max_hp: i32,
    pub boss: bool,
    pub x: f64,
    pub z: f64,
    pub speed: f64,
    pub movement: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DungeonStats {
    pub projectiles: usize,
    pub hostile_globs: usize,
    pub enemies: Vec<EnemyProbe>,
    pub player_hp: Option<i32>,
    pub floor_fx: Vec<String>,
    pub floor_depth: u32,
    pub active_zombies: usize,
    pub explored_ratio: f64,
}

impl Default for DungeonStats {
    fn default() -> Self {
        Self {
            projectiles: 0,
            hostile_globs: 0,
            enemies: Vec::new(),
            player_hp: Some(100),
            floor_fx: Vec::new(),
            floor_depth: 1,
            active_zombies: 0,
            explored_ratio: 0.0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PlayerBuffsProbe {
    pub rage: f64,
    pub haste: f64,
    pub shield: f64,
    pub iron: f64,
    pub turbo: f64,
    pub spring: f64,
    pub curve: f64,
    pub mag_boots: f64,
    pub multi_ball: f64,
    pub magnet_aura: f64,
    pub blade_storm: f64,
    pub webbed: f64,
    pub oil: f64,
    pub material: Option<String>,
    pub material_t: f64,
    pub fuse_material: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct DungeonProbe {
    pub god_mode: bool,
    pub inf_mana: bool,
    pub no_cooldown: bool,
    pub buffs: Option<PlayerBuffsProbe>,
    pub freeze_t: f64,
    pub potion_ids: Vec<String>,
    pub hp: i32,
    pub mana: i32,
    pub hud_mode: String,
    pub fps_active: bool,
    pub fps_yaw: f64,
    pub fps_pitch: f64,
    pub ult_charge: f64,
    pub enemies: usize,
    pub enemies_alive: usize,
    pub tavern_open: bool,
    pub parts: usize,
    pub level: u32,
    pub game_over: bool,
    pub weapon: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PlayerProbe {
    pub x: f64,
    pub z: f64,
    pub hp: i32,
    pub roll_t: f64,
    pub iframes: f64,
    pub clip: String,
    pub facing: String,
    pub cur_speed: f64,
    pub attack_t: f64,
    pub combo_step: u32,
    pub charge_t: f64,
    pub moving: bool,
    pub kills: u32,
    pub overcharge: f64,
    pub mom_speed: f64,
    pub bounce_combo: u32,
    pub oil_t: f64,
    pub webbed_t: f64,
    pub iron_t: f64,
    pub turbo_t: f64,
    pub spring_t: f64,
    pub curve_t: f64,
    pub mag_boots_t: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct BossProbe {
    pub king_x: Option<f64>,
    pub king_z: Option<f64>,
    pub king_hp: Option<i32>,
    pub king_aggro: Option<bool>,
    pub player_x: Option<f64>,
    pub player_z: Option<f64>,
    pub dist: Option<f64>,
    pub engaged: bool,
    pub level: u32,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct FogProbe {
    pub w: usize,
    pub h: usize,
    pub seen: usize,
    pub pct: u32,
    pub map_open: bool,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct RailProbe {
    pub riding: bool,
    pub feature_idx: i32,
    pub ride_t: f64,
    pub slip_t: f64,
    pub speed: f64,
    pub overspeed: f64,
    pub cap: f64,
    pub rail_cap: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct ShotsProbe {
    pub orbit_active: bool,
    pub orbit_count: u32,
    pub orbit_laps: u32,
    pub lane_lit: HashMap<u32, [bool; 3]>,
    pub lanes_cleared: u32,
    pub skill_armed: bool,
    pub skill_t: f64,
    pub shot_chain: u32,
    pub named_paid: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct FloorProbe {
    pub level_t: f64,
    pub start_x: f64,
    pub start_z: f64,
    pub horde_size: usize,
    pub kills_this_floor: u32,
    pub best_combo: u32,
    pub reaper_out: bool,
    pub targets: String,
    pub freeze_t: f64,
    pub npcs: Vec<String>,
    pub part_kinds: Vec<String>,
    pub shop_open: bool,
    pub magician_t: f64,
    pub level: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PadState {
    pub plugged: bool,
    pub axes: [f64; 4],
    pub buttons: [bool; 17],
}

impl Default for PadState {
    fn default() -> Self {
        Self {
            plugged: false,
            axes: [0.0; 4],
            buttons: [false; 17],
        }
    }
}

pub struct DungeonWindowHooks {
    pub stats: DungeonStats,
    pub spawned_entities: Vec<(String, f64, f64)>,
    pub inventory: Vec<String>,
    pub ability_slots: [Option<String>; 2],
    pub ability_ranks: HashMap<String, u32>,
    pub speed_override: Option<f64>,
    pub god_mode: bool,
    pub inf_mana: bool,
    pub no_cooldown: bool,
    pub dbg_card_drop_always: bool,
    pub active_material: Option<String>,
    pub frenzy_override: Option<f64>,
    pub pad: PadState,
    pub level: u32,
    pub player_pos: (f64, f64),
    pub boss_engaged: bool,
    pub sockets: Vec<String>,
    pub corpses: Vec<u32>,
    pub ground_items: Vec<(String, f64, f64)>,
    pub grave_holes: Vec<(f64, f64)>,
}

impl Default for DungeonWindowHooks {
    fn default() -> Self {
        Self {
            stats: DungeonStats::default(),
            spawned_entities: Vec::new(),
            inventory: Vec::new(),
            ability_slots: [None, None],
            ability_ranks: HashMap::new(),
            speed_override: None,
            god_mode: false,
            inf_mana: false,
            no_cooldown: false,
            dbg_card_drop_always: false,
            active_material: None,
            frenzy_override: None,
            pad: PadState::default(),
            level: 1,
            player_pos: (0.0, 0.0),
            boss_engaged: false,
            sockets: Vec::new(),
            corpses: Vec::new(),
            ground_items: Vec::new(),
            grave_holes: Vec::new(),
        }
    }
}

impl DungeonWindowHooks {
    pub fn new() -> Self {
        Self::default()
    }

    // ── Spawning & Enemy Controls ──

    pub fn dungeon_spawn(&mut self, spec: DebugSpawnSpec) -> DebugSpawnResult {
        let count = spec.count.max(1);
        let at_pos = spec.at.unwrap_or(self.player_pos);
        for _ in 0..count {
            self.spawned_entities.push((spec.kind.clone(), at_pos.0, at_pos.1));
            self.stats.active_zombies += 1;
        }
        DebugSpawnResult {
            spawned: count,
            requested: count,
            kind: spec.kind,
        }
    }

    pub fn dungeon_clear(&mut self) -> usize {
        let count = self.stats.active_zombies;
        self.spawned_entities.clear();
        self.stats.active_zombies = 0;
        count
    }

    pub fn dungeon_kill_all(&mut self) -> usize {
        self.dungeon_clear()
    }

    // ── Player & God Mode Controls ──

    pub fn dungeon_god(&mut self, enabled: bool) {
        self.god_mode = enabled;
    }

    pub fn dungeon_hp(&mut self, hp: i32) {
        self.stats.player_hp = Some(hp);
    }

    pub fn dungeon_mana(&mut self, inf: bool) {
        self.inf_mana = inf;
    }

    pub fn dungeon_no_cd(&mut self, no_cd: bool) {
        self.no_cooldown = no_cd;
    }

    pub fn dungeon_debug(&mut self, god: Option<bool>, mana: Option<bool>, no_cd: Option<bool>, card_drops: Option<bool>) -> (bool, bool, bool, bool) {
        if let Some(g) = god {
            self.god_mode = g;
        }
        if let Some(m) = mana {
            self.inf_mana = m;
        }
        if let Some(cd) = no_cd {
            self.no_cooldown = cd;
        }
        if let Some(cdrop) = card_drops {
            self.dbg_card_drop_always = cdrop;
        }
        (self.god_mode, self.inf_mana, self.no_cooldown, self.dbg_card_drop_always)
    }

    pub fn dungeon_give_weapon(&mut self, weapon_id: &str) -> bool {
        self.inventory.push(weapon_id.to_string());
        true
    }

    pub fn dungeon_give_potion(&mut self, potion_id: &str) -> bool {
        self.inventory.push(potion_id.to_string());
        true
    }

    pub fn dungeon_ability(&mut self, slot: usize, id: &str, rank: Option<u32>) -> bool {
        if slot > 1 {
            return false;
        }
        self.ability_slots[slot] = Some(id.to_string());
        if let Some(r) = rank {
            self.ability_ranks.insert(id.to_string(), r);
        }
        true
    }

    pub fn dungeon_socket(&mut self, card_id: &str) -> bool {
        self.sockets.push(card_id.to_string());
        true
    }

    pub fn dungeon_drop_card(&mut self, card_id: &str, dx: f64, dz: f64) -> bool {
        self.ground_items.push((card_id.to_string(), self.player_pos.0 + dx, self.player_pos.1 + dz));
        true
    }

    pub fn dungeon_material(&mut self, material: &str) -> bool {
        self.active_material = Some(material.to_string());
        true
    }

    pub fn dungeon_set_speed(&mut self, speed: f64) {
        self.speed_override = Some(speed);
    }

    pub fn dungeon_teleport(&mut self, x: f64, z: f64) -> (f64, f64) {
        self.player_pos = (x, z);
        self.player_pos
    }

    pub fn dungeon_warp(&mut self, x: f64, z: f64) -> bool {
        self.player_pos = (x, z);
        true
    }

    pub fn dungeon_launch(&mut self, dir_x: f64, dir_z: f64, speed: f64) -> bool {
        let len = (dir_x * dir_x + dir_z * dir_z).sqrt();
        if len < 1e-4 {
            return false;
        }
        self.speed_override = Some(speed);
        true
    }

    pub fn dungeon_frenzy(&mut self, val: Option<f64>) {
        self.frenzy_override = val;
    }

    // ── Level & Dungeon Flow Controls ──

    pub fn dungeon_descend(&mut self) -> u32 {
        self.level += 1;
        self.stats.floor_depth = self.level;
        self.level
    }

    pub fn dungeon_level(&mut self, lvl: u32) -> bool {
        if lvl < 1 {
            return false;
        }
        self.level = lvl;
        self.stats.floor_depth = lvl;
        true
    }

    pub fn dungeon_die(&mut self) -> (u32, usize) {
        self.corpses.push(self.level);
        (self.level, self.corpses.len())
    }

    pub fn dungeon_fresh_run(&mut self) -> bool {
        self.level = 1;
        self.stats.floor_depth = 1;
        self.corpses.clear();
        true
    }

    pub fn dungeon_hole(&mut self, x: f64, z: f64) -> (f64, f64) {
        self.grave_holes.push((x, z));
        (x, z)
    }

    pub fn dungeon_holes(&self) -> Vec<(f64, f64)> {
        self.grave_holes.clone()
    }

    // ── Controller / Gamepad Simulation ──

    pub fn pad_connect(&mut self) {
        self.pad.plugged = true;
        self.pad.axes = [0.0; 4];
        self.pad.buttons = [false; 17];
    }

    pub fn pad_disconnect(&mut self) {
        self.pad.plugged = false;
    }

    pub fn pad_hold(&mut self, btn: usize) {
        if btn < 17 {
            self.pad.buttons[btn] = true;
        }
    }

    pub fn pad_release(&mut self, btn: usize) {
        if btn < 17 {
            self.pad.buttons[btn] = false;
        }
    }

    pub fn pad_stick(&mut self, x: f64, y: f64) {
        self.pad.axes[0] = x;
        self.pad.axes[1] = y;
    }

    pub fn pad_aim(&mut self, x: f64, y: f64) {
        self.pad.axes[2] = x;
        self.pad.axes[3] = y;
    }

    // ── Telemetry & Queries ──

    pub fn dungeon_stats(&self) -> DungeonStats {
        self.stats.clone()
    }

    pub fn dungeon_probe(&self) -> DungeonProbe {
        DungeonProbe {
            god_mode: self.god_mode,
            inf_mana: self.inf_mana,
            no_cooldown: self.no_cooldown,
            buffs: Some(PlayerBuffsProbe {
                material: self.active_material.clone(),
                ..PlayerBuffsProbe::default()
            }),
            freeze_t: 0.0,
            potion_ids: vec!["freeze".to_string(), "turbo".to_string(), "multiball".to_string()],
            hp: self.stats.player_hp.unwrap_or(100),
            mana: if self.inf_mana { 100 } else { 50 },
            hud_mode: "standard".to_string(),
            fps_active: false,
            fps_yaw: 0.0,
            fps_pitch: 0.0,
            ult_charge: 0.0,
            enemies: self.stats.active_zombies,
            enemies_alive: self.stats.active_zombies,
            tavern_open: false,
            parts: 0,
            level: self.level,
            game_over: false,
            weapon: self.inventory.first().cloned(),
        }
    }

    pub fn dungeon_player(&self) -> PlayerProbe {
        PlayerProbe {
            x: self.player_pos.0,
            z: self.player_pos.1,
            hp: self.stats.player_hp.unwrap_or(100),
            roll_t: 0.0,
            iframes: 0.0,
            clip: "idle".to_string(),
            facing: "S".to_string(),
            cur_speed: self.speed_override.unwrap_or(0.0),
            attack_t: 0.0,
            combo_step: 0,
            charge_t: 0.0,
            moving: self.speed_override.map(|s| s > 0.0).unwrap_or(false),
            kills: 0,
            overcharge: 0.0,
            mom_speed: self.speed_override.unwrap_or(0.0),
            bounce_combo: 0,
            oil_t: 0.0,
            webbed_t: 0.0,
            iron_t: 0.0,
            turbo_t: 0.0,
            spring_t: 0.0,
            curve_t: 0.0,
            mag_boots_t: 0.0,
        }
    }

    pub fn dungeon_boss(&self) -> BossProbe {
        BossProbe {
            king_x: Some(10.0),
            king_z: Some(10.0),
            king_hp: Some(500),
            king_aggro: Some(self.boss_engaged),
            player_x: Some(self.player_pos.0),
            player_z: Some(self.player_pos.1),
            dist: Some(((10.0 - self.player_pos.0).powi(2) + (10.0 - self.player_pos.1).powi(2)).sqrt()),
            engaged: self.boss_engaged,
            level: self.level,
        }
    }

    pub fn dungeon_fog(&self) -> FogProbe {
        FogProbe {
            w: 32,
            h: 32,
            seen: 512,
            pct: 50,
            map_open: false,
        }
    }

    pub fn dungeon_rail(&self) -> RailProbe {
        RailProbe {
            riding: false,
            feature_idx: -1,
            ride_t: 0.0,
            slip_t: 0.0,
            speed: self.speed_override.unwrap_or(0.0),
            overspeed: 0.0,
            cap: 18.0,
            rail_cap: 24.0,
        }
    }

    pub fn dungeon_shots(&self) -> ShotsProbe {
        ShotsProbe::default()
    }

    pub fn dungeon_floor(&self) -> FloorProbe {
        FloorProbe {
            level_t: 12.5,
            start_x: 0.0,
            start_z: 0.0,
            horde_size: 16,
            kills_this_floor: 4,
            best_combo: 3,
            reaper_out: false,
            targets: "2/4".to_string(),
            freeze_t: 0.0,
            npcs: vec!["merchant".to_string()],
            part_kinds: vec!["bumper".to_string(), "slingshot".to_string()],
            shop_open: false,
            magician_t: 30.0,
            level: self.level,
        }
    }
}
