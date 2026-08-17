//! The sim state and step function — the seed of the `state.ts`/`simulate.ts`
//! port. Grows subsystem by subsystem; the shape (one mutable state, one step
//! function with a hand-ordered call sequence) is the architecture decision
//! and does not change.
//!
//! PORTS: `sim/simulate.ts`, `state.ts`

use crate::collide::{move_circle, MoveResult};
use crate::grid::{set_tile, Grid, T_FLOOR};
use crate::rng::Mulberry32;

pub const WEAPON_SLOTS: usize = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct BeltSlot {
    pub count: u32,
    pub kind: String,
    pub label: String,
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Actor {
    pub x: f64,
    pub z: f64,
    pub vx: f64,
    pub vz: f64,
    pub hp: f64,
    pub max_hp: f64,
    pub radius: f64,
    pub facing: Facing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarbleMaterial {
    Diamond,
    Water,
    Stone,
    Storm,
    Shadow,
    Lava,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZombieMode {
    Idle,
    Chase,
    Windup,
    Dead,
    Charge,
    Slam,
}

pub type Zombie = crate::monsters::types::LiveMonster;

#[derive(Debug, Clone, PartialEq)]
pub struct Npc {
    pub id: u32,
    pub name: String,
    pub x: f64,
    pub z: f64,
    pub dialogue_id: String,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinballPartKind {
    Bumper,
    Flipper,
    Slingshot,
    Spinner,
    DropTarget,
    Rollover,
    Drain,
    Lane,
    Gate,
    Plunger,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PinballPart {
    pub id: u32,
    pub kind: PinballPartKind,
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub points: u32,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CoinFlight {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub target_x: f64,
    pub target_z: f64,
    pub speed: f64,
    pub value: i32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HaulEntry {
    pub item_id: String,
    pub name: String,
    pub rarity: String,
    pub quantity: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GroundItem {
    pub id: u32,
    pub x: f64,
    pub z: f64,
    pub kind: String,
    pub label: String,
    pub collected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloorFxKind {
    Slick,
    Fire,
    ShardField,
    Oil,
    Groove,
    Frost,
    Tar,
    Rod,
    Molten,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FloorFx {
    pub kind: FloorFxKind,
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub duration_t: f64,
    pub active: bool,
}

pub fn player_is_visible_to_enemies(_sim: &SimState) -> bool {
    true
}

pub fn fresh_player_fields() -> Player {
    Player::default()
}

/// Fixed sim step — 60 Hz, exactly the legacy `FIXED_STEP`.
pub const DT: f64 = 1.0 / 60.0;

/// legacy constants/player.ts
pub const PLAYER_SPEED: f64 = 4.2; // tiles/sec
pub const PLAYER_R: f64 = 0.3; // collision circle radius

// ── Sprint (hold Shift) — `constants/player.ts:28-62` ──────────────────────
//
// The gear change is IMMEDIATE (`SPRINT_BASE_MULT` the moment Shift is held —
// a spool starting at 1.0 read as "shift does nothing", playtest 2026-07-15)
// and the CHARGE lerps the rest of the way over the ramp. Free: no stamina.
/// Instant multiplier the moment Shift is held.
pub const SPRINT_BASE_MULT: f64 = 1.35;
/// Top-speed multiplier at full sprint charge.
pub const SPRINT_SPEED_MULT: f64 = 1.85;
/// Seconds of sustained run to reach full sprint.
pub const SPRINT_RAMP_TIME: f64 = 1.5;
/// Seconds for the charge to bleed back to 0 once it starts decaying.
pub const SPRINT_DECAY_TIME: f64 = 0.8;
/// The charge HOLDS this long before decaying, so a swing or a clipped corner
/// does not erase a spool. Without it, combat-heavy play never kept any charge
/// and the ramp read as broken (playtest 2026-07-15).
pub const SPRINT_GRACE: f64 = 0.6;
/// Charge above this unlocks the wall-ride. Not read yet — the wall-ride is
/// `startWallLaunch`, which lands with the rest of `player.ts`.
pub const SPRINT_RIDE_THRESHOLD: f64 = 0.5;
/// Above this charge the walk swaps to the leaning RUN clip (render-side).
pub const RUN_CLIP_THRESHOLD: f64 = 0.12;
/// Seconds to bleed overcharge once fully stopped — `constants/pinball.ts:26`.
pub const OVERCHARGE_DECAY: f64 = 1.0;
/// Walk accel/friction toward the target speed — `constants/player.ts:40-41`.
/// Asymmetric on purpose (tuned 2026-07-20): a press bites in ~0.08s, a release
/// glides for ~0.10s. Equal rates read as "sluggish"; a hard snap reads as jitter.
pub const MOVE_ACCEL: f64 = 55.0;
pub const MOVE_FRICTION: f64 = 42.0;

/// Which authored sprite direction the player reads as. W is never authored —
/// the engine mirrors E (a fact carried from the sheet vocabulary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Facing {
    S,
    N,
    E,
    /// Rendered as E, mirrored.
    W,
}

impl Facing {
    pub fn from_dir(dx: f64, dz: f64) -> Self {
        if dx.abs() >= dz.abs() {
            if dx >= 0.0 {
                Facing::E
            } else {
                Facing::W
            }
        } else if dz >= 0.0 {
            Facing::S
        } else {
            Facing::N
        }
    }
}

pub const PLUNGER_CHARGE_TIME: f64 = 0.8;
pub const PLUNGER_MIN_SPEED: f64 = 8.0;
pub const PLUNGER_SPEED: f64 = 18.0;
pub const PLUNGER_AIM_MAX: f64 = 0.44; // ~25 deg
pub const PLUNGER_AIM_RATE: f64 = 1.2;

#[derive(Debug, Clone)]
pub struct Player {
    pub x: f64,
    pub z: f64,
    pub facing: Facing,
    pub moving: bool,
    // ── Pinball momentum (legacy freshPlayerFields' momentum block) ──
    pub mom_x: f64,
    pub mom_z: f64,
    pub mom_speed: f64,
    pub bounce_combo: f64,
    pub bounce_combo_t: f64,
    /// 0→1 sprint spool. Lerps the top speed and gates the wall-ride; the
    /// aura and the RUN clip read it render-side.
    pub sprint_charge: f64,
    pub overcharge: f64,
    pub oil_t: f64,
    pub turbo_t: f64,
    pub spring_t: f64,
    pub iframes: f64,
    pub steer_lock_t: f64,
    pub grab_t: f64,
    pub grab_x: f64,
    pub grab_z: f64,
    pub throw_dir_x: f64,
    pub throw_dir_z: f64,
    pub throw_speed: f64,
    pub rail: crate::rail::RailState,
    // ── Dodge Roll & Squash State ──
    pub roll_t: f64,
    pub roll_dir_x: f64,
    pub roll_dir_z: f64,
    pub squash_t: f64,
    pub squash_amp: f64,
    pub squash_nx: f64,
    pub squash_nz: f64,
    // ── Combat & Inventory ──
    pub slash: crate::player::MeleeSlash,
    pub inventory: crate::player::PlayerInventory,
    // ── Active Marble Material State ──
    pub marble: crate::marble::MarbleState,
    // ── Health & Mana ──
    pub hp: f64,
    pub max_hp: f64,
    pub mana: f64,
    pub max_mana: f64,
}

pub const ROLL_DURATION: f64 = 0.42;
pub const ROLL_IFRAMES: f64 = 0.22;
pub const ROLL_RECOVERY: f64 = 0.10;
pub const ROLL_MIN_SPEED: f64 = 2.5;
pub const ROLL_DISTANCE: f64 = 1.6;
pub const ROLL_V0: f64 = (2.0 * ROLL_DISTANCE) / ROLL_DURATION;

pub const SQUASH_RECOVER: f64 = 0.18;
pub const SQUASH_DEPTH: f64 = 0.30;
pub const SQUASH_MIN_SPEED: f64 = 5.0;

impl Default for Player {
    fn default() -> Self {
        Self {
            x: 0.0,
            z: 0.0,
            facing: Facing::S,
            moving: false,
            mom_x: 0.0,
            mom_z: 0.0,
            mom_speed: 0.0,
            bounce_combo: 0.0,
            bounce_combo_t: 0.0,
            sprint_charge: 0.0,
            overcharge: 0.0,
            oil_t: 0.0,
            turbo_t: 0.0,
            spring_t: 0.0,
            iframes: 0.0,
            steer_lock_t: 0.0,
            grab_t: 0.0,
            grab_x: 0.0,
            grab_z: 0.0,
            throw_dir_x: 0.0,
            throw_dir_z: 0.0,
            throw_speed: 0.0,
            rail: crate::rail::fresh_rail(),
            roll_t: -1.0,
            roll_dir_x: 0.0,
            roll_dir_z: 0.0,
            squash_t: 0.0,
            squash_amp: 0.0,
            squash_nx: 0.0,
            squash_nz: 0.0,
            slash: crate::player::MeleeSlash::default(),
            inventory: crate::player::PlayerInventory::default(),
            marble: crate::marble::MarbleState::default(),
            hp: 100.0,
            max_hp: 100.0,
            mana: 100.0,
            max_mana: 100.0,
        }
    }
}

impl Player {
    pub fn is_attacking(&self) -> bool {
        self.slash.active
    }

    pub fn is_ball(&self) -> bool {
        self.mom_speed > 4.2 * 1.15
            || self.overcharge >= 1.0
            || self.spring_t > 0.0
            || self.turbo_t > 0.0
    }

    pub fn is_rolling(&self) -> bool {
        self.roll_t >= 0.0
    }

    pub fn note_squash(&mut self, nx: f64, nz: f64, speed: f64) {
        if speed < SQUASH_MIN_SPEED {
            return;
        }
        let (hx, hy) = crate::marble::squash::world_dir_to_screen(nx, nz);
        self.squash_nx = hx;
        self.squash_nz = hy;
        self.squash_amp = (speed / (SQUASH_MIN_SPEED * 2.0)).min(1.0);
        self.squash_t = SQUASH_RECOVER;
    }

    pub fn squash_scale(&self) -> (f32, f32) {
        if self.squash_t <= 0.0 || self.squash_amp <= 0.0 {
            return (1.0, 1.0);
        }
        let t = (self.squash_t / SQUASH_RECOVER).clamp(0.0, 1.0);
        let d = (SQUASH_DEPTH * self.squash_amp * (t * std::f64::consts::FRAC_PI_2).sin()) as f32;
        let flat = (1.0 - d).max(0.2);
        let bulge = 1.0 / flat;
        if self.squash_nx.abs() >= self.squash_nz.abs() {
            (flat, bulge)
        } else {
            (bulge, flat)
        }
    }
}

/// Per-tick input intent, already normalized by the shell.
#[derive(Debug, Clone, Copy, Default)]
pub struct FrameInput {
    pub move_x: f64,
    pub move_z: f64,
    /// Shift held — `InputHandle.sprintHeld()`. The sprint gate also requires
    /// MOVING and not attacking (`player.ts:2128`); the shell publishes the raw
    /// key and the sim applies the gate, so a held Shift while standing still
    /// spools nothing.
    pub sprint: bool,
    /// Space / dodge key pressed.
    pub dodge: bool,
    /// Melee attack key pressed.
    pub attack: bool,
    /// Weapon swap key pressed (Tab / 1 / 2).
    pub swap_weapon: bool,
    /// Skill slot 1 (Q / Flipper Charge).
    pub ability_1: bool,
    /// Skill slot 2 (E / Time Crawl).
    pub ability_2: bool,
    /// Ultimate skill (R / Overcharge Rampage).
    pub ability_ult: bool,
}

#[derive(Debug, Clone)]
pub struct SimState {
    pub grid: Grid,
    pub player: Player,
    pub monsters: Vec<crate::monsters::types::LiveMonster>,
    pub abilities: crate::abilities::PlayerAbilities,
    pub rng: Mulberry32,
    pub tick: u64,
    /// Wall-clock seconds simulated — `state.elapsed` (spinpad phase reads it).
    pub elapsed: f64,
    // ── Pinball machine state (legacy `state` fields the ride touches) ──
    pub parts: Vec<crate::pinball::PinballPart>,
    pub arc_corners: Vec<crate::collide::ArcCorner>,
    pub combo_zone: crate::combo::ComboZone,
    pub part_combo_hits: i32,
    pub frenzy_paid: bool,
    pub gold_run: i64,
    pub bumpers_lit: i32,
    pub bumper_total: i32,
    pub jackpots: i32,
    pub kills: i32,
    // Pocket-rattle guard anchor (module-level in legacy player.ts).
    pub pocket_ax: f64,
    pub pocket_az: f64,
    pub pocket_n: i32,
    pub pocket_t: f64,
    /// Rail gold cadence accumulator (module-level in legacy player.ts).
    pub rail_gold_t: f64,
    /// The SMOOTHED walk speed (module-level `curSpeed` in legacy player.ts).
    /// What actually moves the knight and what the parts are told — the target
    /// speed is only ever a destination for this.
    pub cur_speed: f64,
    /// Sprint-charge grace countdown (module-level `sprintGraceT` in legacy
    /// player.ts). On the state and not a static for the reason every other
    /// module-level timer here is: a replay has to be able to restore it.
    pub sprint_grace_t: f64,
    // ── Plunger Chute Launch ──
    pub plunger_armed: bool,
    pub plunger_charging: bool,
    pub plunger_power: f64,
    pub plunger_aim: f64,
    pub plunger_base_x: f64,
    pub plunger_base_z: f64,
    pub plunger_dir_x: f64,
    pub plunger_dir_z: f64,
}

impl SimState {
    pub fn plunger_dir(&self) -> (f64, f64) {
        let cos_a = self.plunger_aim.cos();
        let sin_a = self.plunger_aim.sin();
        let dx = self.plunger_base_x * cos_a - self.plunger_base_z * sin_a;
        let dz = self.plunger_base_x * sin_a + self.plunger_base_z * cos_a;
        (dx, dz)
    }

    pub fn new(grid: Grid, spawn: (f64, f64), seed: u32) -> Self {
        let arc_corners = crate::collide::compute_arc_corners(&grid);
        // Find opening corridor direction from spawn
        let (si, sj) = crate::grid::world_to_tile(&grid, spawn.0, spawn.1);
        let mut bx = 0.0;
        let mut bz = -1.0;
        let mut facing = Facing::N;
        if !crate::grid::is_walkable(&grid, si, sj.saturating_sub(1)) {
            if crate::grid::is_walkable(&grid, si, sj + 1) {
                bx = 0.0;
                bz = 1.0;
                facing = Facing::S;
            } else if crate::grid::is_walkable(&grid, si + 1, sj) {
                bx = 1.0;
                bz = 0.0;
                facing = Facing::E;
            } else if crate::grid::is_walkable(&grid, si.saturating_sub(1), sj) {
                bx = -1.0;
                bz = 0.0;
                facing = Facing::W;
            }
        }

        Self {
            grid,
            player: Player {
                x: spawn.0,
                z: spawn.1,
                facing,
                moving: false,
                mom_x: 0.0,
                mom_z: 0.0,
                mom_speed: 0.0,
                bounce_combo: 0.0,
                bounce_combo_t: 0.0,
                sprint_charge: 0.0,
                overcharge: 0.0,
                oil_t: 0.0,
                turbo_t: 0.0,
                spring_t: 0.0,
                iframes: 0.0,
                steer_lock_t: 0.0,
                grab_t: 0.0,
                grab_x: 0.0,
                grab_z: 0.0,
                throw_dir_x: 0.0,
                throw_dir_z: 0.0,
                throw_speed: 0.0,
                rail: crate::rail::fresh_rail(),
                roll_t: -1.0,
                roll_dir_x: 0.0,
                roll_dir_z: 0.0,
                squash_t: 0.0,
                squash_amp: 0.0,
                squash_nx: 0.0,
                squash_nz: 0.0,
                slash: crate::player::MeleeSlash::default(),
                inventory: crate::player::PlayerInventory::default(),
                marble: crate::marble::MarbleState::default(),
                hp: 100.0,
                max_hp: 100.0,
                mana: 100.0,
                max_mana: 100.0,
            },
            monsters: Vec::new(),
            abilities: crate::abilities::PlayerAbilities::default(),
            rng: Mulberry32::new(seed),
            tick: 0,
            elapsed: 0.0,
            parts: Vec::new(),
            arc_corners,
            combo_zone: crate::combo::ComboZone::Launch,
            part_combo_hits: 0,
            frenzy_paid: false,
            gold_run: 0,
            bumpers_lit: 0,
            bumper_total: 0,
            jackpots: 0,
            kills: 0,
            pocket_ax: 0.0,
            pocket_az: 0.0,
            pocket_n: 0,
            pocket_t: 0.0,
            rail_gold_t: 0.0,
            cur_speed: 0.0,
            sprint_grace_t: 0.0,
            plunger_armed: true,
            plunger_charging: false,
            plunger_power: 0.0,
            plunger_aim: 0.0,
            plunger_base_x: bx,
            plunger_base_z: bz,
            plunger_dir_x: bx,
            plunger_dir_z: bz,
        }
    }
}

pub fn simulate_step(s: &mut SimState, input: FrameInput) {
    simulate(s, &input);
}

pub fn reset_state(s: &mut SimState) {
    *s = SimState::new(s.grid.clone(), (s.player.x, s.player.z), 42);
}

/// One 60 Hz step. Call order grows to mirror legacy `simulate.ts` as
/// subsystems port; today: part timers → momentum ride → else walking.
pub fn simulate(s: &mut SimState, input: &FrameInput) {
    s.tick += 1;
    s.elapsed += DT;

    // Tick squash spring recovery
    if s.player.squash_t > 0.0 {
        s.player.squash_t = 0.0_f64.max(s.player.squash_t - DT);
    }

    // Tick active marble material and fusion timers
    s.player.marble.update(DT);

    // Tick abilities
    s.abilities.tick(DT);

    // Ability triggers
    if input.ability_1 && s.abilities.slot_1.trigger() {
        let (fx, fz) = match s.player.facing {
            Facing::S => (0.0, 1.0),
            Facing::N => (0.0, -1.0),
            Facing::E => (1.0, 0.0),
            Facing::W => (-1.0, 0.0),
        };
        s.player.mom_x = fx;
        s.player.mom_z = fz;
        s.player.mom_speed = 14.0;
    }
    if input.ability_2 && s.abilities.slot_2.trigger() {
        s.abilities.time_crawl_t = 3.5;
    }
    if input.ability_ult && s.player.overcharge >= 0.99 {
        let (fx, fz) = match s.player.facing {
            Facing::S => (0.0, 1.0),
            Facing::N => (0.0, -1.0),
            Facing::E => (1.0, 0.0),
            Facing::W => (-1.0, 0.0),
        };
        s.player.mom_x = fx;
        s.player.mom_z = fz;
        s.player.mom_speed = 16.0;
        s.player.overcharge = 0.0;
    }

    // Tick slash / attack recovery
    if s.player.slash.active {
        s.player.slash.timer -= DT;
        if s.player.slash.timer <= 0.0 {
            s.player.slash.active = false;
            s.player.slash.timer = 0.0;
        }
    }

    // Weapon swap input
    if input.swap_weapon {
        s.player.inventory.swap_active_slot();
    }

    // Melee attack trigger
    if input.attack && !s.player.slash.active && !s.player.is_ball() && !s.player.is_rolling() {
        let active_weapon = s.player.inventory.active_weapon();
        let def = active_weapon.def();
        s.player.slash.active = true;
        s.player.slash.timer = 0.22 * def.heft;
        s.player.slash.reach = def.range;
        s.player.slash.base_damage = def.damage as f64;
        s.player.slash.hit_entities.clear();
        let (fx, fz) = match s.player.facing {
            Facing::S => (0.0, 1.0),
            Facing::N => (0.0, -1.0),
            Facing::E => (1.0, 0.0),
            Facing::W => (-1.0, 0.0),
        };
        s.player.slash.dir_x = fx;
        s.player.slash.dir_z = fz;
        s.player.inventory.decrement_active_durability();
    }

    // Combat resolution: player slash hitting monsters
    if s.player.slash.active {
        let px = s.player.x;
        let pz = s.player.z;
        let reach = s.player.slash.reach;
        let base_dmg = s.player.slash.base_damage;
        let sx = s.player.slash.dir_x;
        let sz = s.player.slash.dir_z;
        let mom_speed = s.player.mom_speed;
        let combo = s.player.bounce_combo;

        for m in &mut s.monsters {
            if m.mode == crate::monsters::types::EnemyMode::Dead
                || s.player.slash.hit_entities.contains(&m.id)
            {
                continue;
            }
            let dx = m.x - px;
            let dz = m.z - pz;
            let dist = (dx * dx + dz * dz).sqrt();
            if dist <= reach + m.radius {
                let dot = if dist > 0.001 {
                    (dx * sx + dz * sz) / dist
                } else {
                    1.0
                };
                if dot > 0.15 {
                    s.player.slash.hit_entities.push(m.id);
                    let (incoming_dmg, _is_crit) = crate::combat::damage::calculate_player_damage(
                        base_dmg, 0, 1.0, mom_speed, 0.15, 1.5, false,
                    );
                    let hit = crate::combat::damage::resolve_enemy_hit(
                        m.hp,
                        m.max_hp,
                        incoming_dmg,
                        dx,
                        dz,
                        crate::combat::damage::KNOCKBACK_ZOMBIE * 3.0,
                        combo,
                        mom_speed,
                    );
                    m.hp = (m.hp - hit.damage_dealt).max(0.0);
                    m.stagger_t = 0.35;
                    m.kbx = hit.knockback_x;
                    m.kbz = hit.knockback_z;
                    if hit.is_kill {
                        m.mode = crate::monsters::types::EnemyMode::Dead;
                        s.gold_run += (m.damage as i64) * 2 + hit.gold_awarded;
                        s.jackpots += 1;
                        s.kills += 1;
                    }
                }
            }
        }
    }

    // Ball form / pinball momentum ramming monsters
    if s.player.is_ball() || s.player.mom_speed >= 4.5 {
        let px = s.player.x;
        let pz = s.player.z;
        let mom_speed = s.player.mom_speed;
        let combo = s.player.bounce_combo;
        for m in &mut s.monsters {
            if m.mode == crate::monsters::types::EnemyMode::Dead {
                continue;
            }
            let dx = m.x - px;
            let dz = m.z - pz;
            let dist = (dx * dx + dz * dz).sqrt();
            if dist <= (PLAYER_R + m.radius + 0.15) {
                let ram_base = (mom_speed * 1.6).max(6.0);
                let hit = crate::combat::damage::resolve_enemy_hit(
                    m.hp,
                    m.max_hp,
                    ram_base,
                    if mom_speed > 0.1 { s.player.mom_x } else { dx },
                    if mom_speed > 0.1 { s.player.mom_z } else { dz },
                    crate::combat::damage::KNOCKBACK_ZOMBIE * 4.5,
                    combo,
                    mom_speed,
                );
                m.hp = (m.hp - hit.damage_dealt).max(0.0);
                m.stagger_t = 0.45;
                m.kbx = hit.knockback_x;
                m.kbz = hit.knockback_z;
                if hit.is_kill {
                    m.mode = crate::monsters::types::EnemyMode::Dead;
                    s.gold_run += (m.damage as i64) * 3 + hit.gold_awarded;
                    s.jackpots += 1;
                    s.kills += 1;
                }
            }
        }
    }

    // Monster AI & collision against player
    let dt_monster = if s.abilities.time_crawl_t > 0.0 {
        DT * 0.25
    } else {
        DT
    };
    let px = s.player.x;
    let pz = s.player.z;

    for m in &mut s.monsters {
        if m.mode == crate::monsters::types::EnemyMode::Dead {
            continue;
        }
        if m.stagger_t > 0.0 {
            m.stagger_t -= dt_monster;
            let kx = m.kbx * dt_monster;
            let kz = m.kbz * dt_monster;
            let res = crate::collide::move_circle(&s.grid, m.x, m.z, m.radius, kx, kz);
            m.x = res.x;
            m.z = res.z;
            m.kbx *= 0.85;
            m.kbz *= 0.85;
            continue;
        }

        let dx = px - m.x;
        let dz = pz - m.z;
        let dist = (dx * dx + dz * dz).sqrt();

        if dist > 0.05 && dist < 14.0 {
            let speed = m.speed * dt_monster;
            let mx = (dx / dist) * speed;
            let mz = (dz / dist) * speed;
            let res = crate::collide::move_circle(&s.grid, m.x, m.z, m.radius, mx, mz);
            m.x = res.x;
            m.z = res.z;

            // Contact with player
            if dist <= (m.radius + PLAYER_R)
                && s.player.iframes <= 0.0
                && !s.player.is_ball()
                && !s.player.is_rolling()
            {
                s.player.iframes = 0.65;
                s.player.squash_t = 0.18;
                s.player.squash_amp = 0.35;
                s.player.squash_nx = dx / dist;
                s.player.squash_nz = dz / dist;
            }
        }
    }

    // Part cooldowns/timers tick first (the legacy parts renderer's job,
    // owned by the sim here — game state must not depend on being drawn).
    crate::pinball::tick_parts(s, DT);

    // ── Plunger Chute Launch ──
    if s.plunger_armed {
        s.player.iframes = s.player.iframes.max(0.1);

        // Aim left / right with horizontal input
        if input.move_x.abs() > 0.05 {
            s.plunger_aim = (s.plunger_aim + input.move_x * PLUNGER_AIM_RATE * DT)
                .clamp(-PLUNGER_AIM_MAX, PLUNGER_AIM_MAX);
        }
        let (pdx, pdz) = s.plunger_dir();
        s.plunger_dir_x = pdx;
        s.plunger_dir_z = pdz;
        s.player.facing = Facing::from_dir(pdx, pdz);

        if input.dodge {
            s.plunger_charging = true;
            s.plunger_power = 1.0_f64.min(s.plunger_power + DT / PLUNGER_CHARGE_TIME);
            return;
        } else if s.plunger_charging && s.plunger_power > 0.0 {
            // RELEASED → FIRE into play!
            let launch_speed =
                PLUNGER_MIN_SPEED + (PLUNGER_SPEED - PLUNGER_MIN_SPEED) * s.plunger_power;
            s.player.mom_x = pdx;
            s.player.mom_z = pdz;
            s.player.mom_speed = launch_speed;
            s.plunger_armed = false;
            s.plunger_charging = false;
            s.plunger_power = 0.0;
            return;
        }
        return;
    }

    // The momentum ride owns the player while it lasts.
    if crate::pinball::update_pinball(s, DT, (input.move_x, input.move_z)) {
        s.player.moving = s.player.mom_speed > 0.0;
        return;
    }

    let len = (input.move_x * input.move_x + input.move_z * input.move_z).sqrt();

    // ── Dodge Roll (Space while moving) ──
    if input.dodge && s.player.roll_t < 0.0 && (s.player.moving || s.cur_speed >= 0.2 || len > 1e-4)
    {
        let (rx, rz) = if len > 1e-4 {
            (input.move_x / len, input.move_z / len)
        } else {
            match s.player.facing {
                Facing::S => (0.0, 1.0),
                Facing::N => (0.0, -1.0),
                Facing::E => (1.0, 0.0),
                Facing::W => (-1.0, 0.0),
            }
        };
        s.player.roll_dir_x = rx;
        s.player.roll_dir_z = rz;
        s.player.roll_t = 0.0;
        s.player.iframes = s.player.iframes.max(ROLL_IFRAMES);
    }

    // Advance active dodge roll
    if s.player.roll_t >= 0.0 {
        s.player.roll_t += DT;
        if s.player.roll_t <= ROLL_DURATION {
            let tau = s.player.roll_t / ROLL_DURATION;
            let roll_speed = ROLL_V0 * (1.0 - tau);
            let res = move_circle(
                &s.grid,
                s.player.x,
                s.player.z,
                PLAYER_R,
                s.player.roll_dir_x * roll_speed * DT,
                s.player.roll_dir_z * roll_speed * DT,
            );
            s.player.x = res.x;
            s.player.z = res.z;
            if let Some((nx, nz)) = res.hit_n {
                s.player.note_squash(nx, nz, roll_speed);
            }
            if s.player.roll_t < ROLL_IFRAMES {
                s.player.iframes = s.player.iframes.max(ROLL_IFRAMES - s.player.roll_t);
            }
        }
        if s.player.roll_t >= ROLL_DURATION + ROLL_RECOVERY {
            s.player.roll_t = -1.0;
        }
        let cur = s.cur_speed;
        crate::pinball::touch_pinball_parts(
            s,
            true,
            cur,
            (s.player.roll_dir_x, s.player.roll_dir_z),
        );
        return;
    }

    // sqrt, not hypot: sqrt is IEEE-correctly-rounded on every platform, so
    // the TS fixture exporter (Math.sqrt) matches bit-exactly. hypot
    // implementations differ by ulps between runtimes.
    let len = (input.move_x * input.move_x + input.move_z * input.move_z).sqrt();
    s.player.moving = len > 1e-6;

    // ── Sprint spool — `player.ts:2126-2136` ──
    //
    // The gate is (Shift AND moving AND not attacking). `attacking` is always
    // false here: the swing is `player.ts`'s, unported. When combat lands, that
    // term joins this condition — it does not get folded into `input.sprint`,
    // because the shell must not have to know what roots the player.
    //
    // The three-way branch is not two: a charge that is neither filling nor
    // decaying is HOLDING, and collapsing the grace arm into the decay arm is
    // what made the ramp read as broken in the oracle's own playtest.
    let want_sprint = input.sprint && s.player.moving;
    if want_sprint {
        s.player.sprint_charge = 1.0_f64.min(s.player.sprint_charge + DT / SPRINT_RAMP_TIME);
        s.sprint_grace_t = SPRINT_GRACE;
    } else if s.sprint_grace_t > 0.0 {
        s.sprint_grace_t = 0.0_f64.max(s.sprint_grace_t - DT);
    } else {
        s.player.sprint_charge = 0.0_f64.max(s.player.sprint_charge - DT / SPRINT_DECAY_TIME);
    }

    // ── Overcharge — `player.ts:2144-2149` ──
    //
    // Sprinting at a FULL spool overflows into the overcharge meter; any
    // overcharge ARMS pinball and a full meter is the BALL. It bleeds only when
    // genuinely stopped (no full spool AND no momentum), so a walk-frame between
    // bounces does not dump it. `update_pinball` feeds it while bouncing, which
    // is why this runs on the walking path only.
    if want_sprint && s.player.sprint_charge >= 0.999 {
        s.player.overcharge =
            1.0_f64.min(s.player.overcharge + DT / crate::pinball::OVERCHARGE_TIME);
    } else if s.player.mom_speed <= 0.0 {
        s.player.overcharge = 0.0_f64.max(s.player.overcharge - DT / OVERCHARGE_DECAY);
    }

    // Target speed — `player.ts:2152-2185`, minus every multiplier whose
    // subsystem is unported. NOT silently omitted: skills (`skillAgg`), boots,
    // haste, turbo, webbed and the mag-strip drag each multiply this line in the
    // oracle, and each lands with its own subsystem.
    let mut target_speed = PLAYER_SPEED
        * ((if want_sprint { SPRINT_BASE_MULT } else { 1.0 })
            + (SPRINT_SPEED_MULT - SPRINT_BASE_MULT) * s.player.sprint_charge);
    // The FLOOR scales the ordinary walk too, so sand reads as heavy underfoot
    // before any momentum is built (`player.ts:2178-2185`). Applied to the
    // TARGET and not to the rates, so the floor changes how fast you end up
    // going rather than how twitchy the controls feel.
    {
        let (i, j) = crate::grid::world_to_tile(&s.grid, s.player.x, s.player.z);
        target_speed *=
            crate::surfaces::floor_surface(crate::grid::surface_at(&s.grid, i, j)).walk_mult;
    }
    if !s.player.moving {
        target_speed = 0.0;
    }

    // The smoothed speed, ramped toward the target — `player.ts:2188-2190`.
    // This is the value that MOVES the knight and that the parts read, and the
    // asymmetry is the point: accel and friction are different rates, so a
    // release glides and a press bites.
    let rate = if target_speed > s.cur_speed {
        MOVE_ACCEL
    } else {
        MOVE_FRICTION
    } * DT;
    if s.cur_speed < target_speed {
        s.cur_speed = target_speed.min(s.cur_speed + rate);
    } else {
        s.cur_speed = target_speed.max(s.cur_speed - rate);
    }
    let speed = s.cur_speed;

    if s.player.moving {
        let (mx, mz) = (input.move_x / len, input.move_z / len);
        let MoveResult { x, z, .. } = move_circle(
            &s.grid,
            s.player.x,
            s.player.z,
            PLAYER_R,
            mx * speed * DT,
            mz * speed * DT,
        );
        s.player.x = x;
        s.player.z = z;
        // Facing follows the dominant input axis; ties keep the E/W row (the
        // sheet vocabulary's richest direction).
        s.player.facing = if mx.abs() >= mz.abs() {
            if mx >= 0.0 {
                Facing::E
            } else {
                Facing::W
            }
        } else if mz >= 0.0 {
            Facing::S
        } else {
            Facing::N
        };
    }

    // Parts fire from a cold walk too — stepping on a spring/booster STARTS a
    // momentum ride (the machine works without spooling first). `cur_speed` is
    // the instantaneous walk speed; the legacy smoothed curSpeed lands with
    // the full player port (it only changes the oil slick's launch strength).
    let cur = s.cur_speed;
    crate::pinball::touch_pinball_parts(s, false, cur, (input.move_x, input.move_z));
}

/// A deterministic demo floor for the vertical slice: bordered room, carved
/// wander-corridors, scattered pillars. Replaced by the real `maze/` port in
/// M3 — this exists so the slice has something honest to collide with, driven
/// through the same seeded RNG the real generator will use.
pub fn demo_floor(seed: u32) -> (Grid, (f64, f64)) {
    let (w, h) = (25, 25);
    let mut g = Grid::solid(w, h);
    let mut rng = Mulberry32::new(seed);

    // Open interior.
    for j in 1..h - 1 {
        for i in 1..w - 1 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    // Pillar field: deterministic scatter, denser toward the walls, never on
    // the spawn tile block in the middle.
    for j in 2..h - 2 {
        for i in 2..w - 2 {
            let centre = (i - w / 2).abs() <= 2 && (j - h / 2).abs() <= 2;
            if centre {
                continue;
            }
            if rng.next_f64() < 0.10 {
                set_tile(&mut g, i, j, crate::grid::T_WALL);
            }
        }
    }
    // ── Shaped court (fixed tiles, AFTER the rng pass so the pillar stream
    // is untouched; mirrored line-for-line in legacy port-fixtures.test.ts).
    use crate::grid::{ensure_arcs, set_shape};
    use crate::tile_shape::{ArcFeature, LaneBand, SHAPE_ARC, SHAPE_ROUND_NE, SHAPE_SLANT_NE};
    // A SLANT_NE deflector west of spawn: walk west along the spawn row and
    // the diagonal shunts you north-east.
    set_tile(&mut g, 6, 12, crate::grid::T_WALL);
    set_shape(&mut g, 6, 12, SHAPE_SLANT_NE);
    set_tile(&mut g, 5, 12, crate::grid::T_WALL); // west backing leg
    set_tile(&mut g, 6, 13, crate::grid::T_WALL); // south backing leg
                                                  // A ROUND_NE quarter-disc east of spawn: the curved ricochet corner.
    set_tile(&mut g, 17, 12, crate::grid::T_WALL);
    set_shape(&mut g, 17, 12, SHAPE_ROUND_NE);
    set_tile(&mut g, 16, 12, crate::grid::T_WALL);
    set_tile(&mut g, 17, 13, crate::grid::T_WALL);
    // A radius-3 convex arc guide in the SE quadrant (span east→south),
    // wearing a booster lane — the pinball ball-guide, laneRoom geometry.
    ensure_arcs(&mut g);
    g.arcs.push(ArcFeature {
        cx: 18.0,
        cz: 18.0,
        r: 3.0,
        a0: 0.0,
        span: std::f64::consts::FRAC_PI_2,
        lanes: vec![LaneBand {
            a0: 0.0,
            span: std::f64::consts::FRAC_PI_2,
            cw: true,
            cooldown_t: 0.0,
            hit_t: -1.0,
        }],
        ..Default::default()
    });
    for j in 18..=21 {
        for i in 18..=21 {
            let d = crate::jsmath::js_hypot(f64::from(i) + 0.5 - 18.0, f64::from(j) + 0.5 - 18.0);
            if d > 2.0 && d < 4.0 {
                set_tile(&mut g, i, j, crate::grid::T_WALL);
                set_shape(&mut g, i, j, SHAPE_ARC);
                let k = (j * w + i) as usize;
                g.arc_idx.as_mut().unwrap()[k] = 0;
            }
        }
    }
    let spawn = crate::grid::tile_center(&g, w / 2, h / 2);
    (g, spawn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_floor_is_deterministic() {
        let (a, _) = demo_floor(7);
        let (b, _) = demo_floor(7);
        assert_eq!(a.t, b.t);
        let (c, _) = demo_floor(8);
        assert_ne!(a.t, c.t, "different seed must vary the floor");
    }

    #[test]
    fn player_cannot_leave_the_bordered_floor() {
        let (grid, spawn) = demo_floor(7);
        let mut s = SimState::new(grid, spawn, 7);
        s.plunger_armed = false;
        // Hold hard east for ten simulated seconds.
        let input = FrameInput {
            move_x: 1.0,
            move_z: 0.0,
            sprint: false,
            dodge: false,
            ..Default::default()
        };
        for _ in 0..600 {
            simulate(&mut s, &input);
        }
        let east_limit = f64::from(s.grid.w) / 2.0 - 1.0; // inside the border wall
        assert!(s.player.x < east_limit, "clamped inside the border");

        // And again at a FULL SPRINT, which is the case that would breach it:
        // 1.85x the walk is the largest per-tick step the walking path can take,
        // so a border that holds at PLAYER_SPEED is not evidence it holds here.
        let (grid2, spawn2) = demo_floor(7);
        let mut f = SimState::new(grid2, spawn2, 7);
        f.plunger_armed = false;
        let sprinting = FrameInput {
            move_x: 1.0,
            move_z: 0.0,
            sprint: true,
            dodge: false,
            ..Default::default()
        };
        for _ in 0..600 {
            simulate(&mut f, &sprinting);
        }
        assert!(
            f.player.sprint_charge >= 0.999,
            "the sprint should be at full spool after ten seconds"
        );
        assert!(
            f.player.x < east_limit,
            "a full sprint must not breach the border"
        );
        assert!(!crate::collide::circle_collides(
            &f.grid, f.player.x, f.player.z, PLAYER_R
        ));
        assert!(!crate::collide::circle_collides(
            &s.grid, s.player.x, s.player.z, PLAYER_R
        ));
        assert_eq!(s.player.facing, Facing::E);
    }

    #[test]
    fn dodge_roll_lifecycle_and_squash() {
        let (grid, spawn) = demo_floor(7);
        let mut s = SimState::new(grid, spawn, 7);
        s.plunger_armed = false;
        s.cur_speed = 3.5; // above ROLL_MIN_SPEED (2.5)

        // Trigger dodge roll
        let dodge_input = FrameInput {
            move_x: 1.0,
            move_z: 0.0,
            sprint: false,
            dodge: true,
            ..Default::default()
        };
        simulate(&mut s, &dodge_input);
        assert!(s.player.is_rolling());
        assert!(s.player.iframes > 0.0);

        // Step roll body
        let idle_input = FrameInput::default();
        for _ in 0..15 {
            simulate(&mut s, &idle_input);
        }
        assert!(s.player.is_rolling());

        // Test squash deformation
        s.player.note_squash(1.0, 0.0, 8.0);
        let (sqx, sqy) = s.player.squash_scale();
        assert!(sqx < 1.0, "squash compresses along normal");
        assert!(sqy > 1.0, "squash expands perpendicular");
    }

    #[test]
    fn plunger_chute_charge_and_launch() {
        let (grid, spawn) = demo_floor(7);
        let mut s = SimState::new(grid, spawn, 7);
        assert!(s.plunger_armed, "floor must open parked in plunger chute");

        // Aim line steering
        let aim_left = FrameInput {
            move_x: -1.0,
            move_z: 0.0,
            sprint: false,
            dodge: false,
            ..Default::default()
        };
        simulate(&mut s, &aim_left);
        assert!(s.plunger_aim < 0.0, "horizontal input steers the aim line");

        // Pull plunger back (hold dodge)
        let pull = FrameInput {
            move_x: 0.0,
            move_z: 0.0,
            sprint: false,
            dodge: true,
            ..Default::default()
        };
        for _ in 0..30 {
            simulate(&mut s, &pull);
        }
        assert!(s.plunger_charging);
        assert!(s.plunger_power > 0.4);

        // Release plunger → Fire!
        let release = FrameInput::default();
        simulate(&mut s, &release);
        assert!(!s.plunger_armed, "plunger disarms on fire");
        assert!(!s.plunger_charging);
        assert!(
            s.player.mom_speed > PLUNGER_MIN_SPEED,
            "ball launched at high speed"
        );
    }
}
