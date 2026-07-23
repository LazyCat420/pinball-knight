/**
 * MARBLE MATERIALS — the "what is the ball made of" axis.
 *
 * A material is NOT a potion: it modifies the pinball ride's physics at the same
 * choke points that already branch on springT/turboT/oilT, plus it fires an
 * emitter on every fast wall bounce and a bigger one from the pounce slam. Held
 * one at a time; a fresh pickup opens a short FUSION window during which the
 * previous material co-fires before it expires (the one novel stacking rule).
 *
 * This module owns:
 *   • metadata (label/icon/tint) for HUD + pickups + debug,
 *   • pure physics helpers the ride reads (restitution/friction/knockback/…),
 *   • applyMaterial / updateMaterial (timers + fusion),
 *   • emitMaterialOnBounce / materialSlam (the shard/slick/shockwave emitters).
 *
 * Everything downstream reuses existing engines: spawnShardBurst (golem shards),
 * spawnFloorFx (new floor scars), damageZombie + the pounce dust-ring for the
 * shockwave, and vfx.ghost for the aura tint.
 */
import { state, type MarbleMaterial } from "../state";
import {
  MATERIAL_DURATION,
  MATERIAL_FUSION_TIME,
  MATERIAL_EMIT_SPEED,
  MATERIAL_EMIT_COOLDOWN,
  DIAMOND_RESTITUTION,
  DIAMOND_WALL_BREAK_SPEED,
  DIAMOND_SECRET_BREAK_SPEED,
  DIAMOND_BOUNCE_SHARDS,
  DIAMOND_BOUNCE_FAN,
  DIAMOND_BOUNCE_DMG,
  DIAMOND_SHARD_SPEED,
  DIAMOND_SLAM_SHARDS,
  DIAMOND_SLAM_SPEED,
  DIAMOND_SLAM_DMG,
  WATER_RESTITUTION,
  WATER_FRICTION_MULT,
  WATER_STEER_MULT,
  WATER_RAM_KNOCKBACK,
  WATER_SLICK_RADIUS,
  WATER_SLICK_LIFE,
  WATER_SLAM_SLICKS,
  WATER_SLAM_SPEED_KICK,
  STONE_RAM_KNOCKBACK,
  STONE_FRICTION_MULT,
  STONE_MAX_SPEED,
  STONE_BUMPER_KICK_MULT,
  STONE_CORNER_ADD_MULT,
  STONE_SHOCK_RADIUS,
  STONE_SHOCK_DMG,
  STONE_SHOCK_GOLEM_MULT,
  STONE_SLAM_RADIUS,
  STONE_SLAM_BASE_DMG,
  STONE_SLAM_DMG_PER_SPEED,
  SECRET_BREAK_SPEED,
  WALL_BREAK_SPEED,
  PINBALL_MAX_SPEED,
  BALL_RAM_KNOCKBACK,
  PLAYER_R,
  ZOMBIE_R,
  WATER_STEAM_LAUNCH,
  WATER_STEAM_RADIUS,
  WATER_STEAM_DMG,
  STONE_MAGSTRIP_CAP,
  DIAMOND_DISCHARGE_RADIUS,
  DIAMOND_DISCHARGE_DMG,
  STORM_LANE_PULL_MULT,
  STORM_STEER_MULT,
  STORM_BOUNCE_ARC_DMG,
  STORM_BOUNCE_ARC_LEN,
  STORM_BOUNCE_ARC_HALF,
  STORM_CLAP_RADIUS,
  STORM_CLAP_DMG,
  STORM_CLAP_STUN,
  STORM_WET_DMG,
  SHADOW_PLAYER_R,
  SHADOW_RESTITUTION,
  SHADOW_BUMPER_SCATTER_MULT,
  SHADOW_LURE_RADIUS,
  SHADOW_LURE_TIME,
  SHADOW_IMPLODE_RADIUS,
  SHADOW_IMPLODE_PULL,
  SHADOW_IMPLODE_DMG,
} from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { moveCircle } from "../collision";
import { spawnShardBurst } from "./projectiles";
import { spawnFloorFx } from "./floor-fx";
import { damageZombie } from "./combat";
import { sfxFreeze, sfxSpring, sfxHeavy, sfxBumper, sfxSpin } from "../audio";

export interface MaterialMeta {
  label: string;
  icon: string;
  /** Pickup-sprite / burst colour. */
  tint: number;
  /** Afterimage-trail tint — deliberately DISTINCT from the buff tells
   *  (diamond can't ride 0x6fd0e8: that already means HASTE on the knight). */
  trail: number;
  /** The transformation sting (also fired on fusion). */
  sfx: () => void;
}

export const MATERIALS: Record<MarbleMaterial, MaterialMeta> = {
  diamond: { label: "Diamond", icon: "💎", tint: PALETTE_HEX[31], trail: 0xd8f6ff, sfx: sfxFreeze },
  water: { label: "Water", icon: "💧", tint: PALETTE_HEX[30], trail: 0x3f9fd8, sfx: sfxSpring },
  stone: { label: "Stone", icon: "🪨", tint: PALETTE_HEX[4], trail: 0x9aa4b4, sfx: sfxHeavy },
  storm: { label: "Storm", icon: "⚡", tint: 0xf0e05a, trail: 0xfff3a0, sfx: sfxBumper },
  shadow: { label: "Shadow", icon: "🌑", tint: 0x2a1e3a, trail: 0x140a1e, sfx: sfxSpin },
};

export const MATERIAL_LIST: MarbleMaterial[] = ["diamond", "water", "stone", "storm", "shadow"];

export function isMaterial(id: string): id is MarbleMaterial {
  return id === "diamond" || id === "water" || id === "stone" || id === "storm" || id === "shadow";
}

/** True when materials are globally enabled and a player currently has one. */
function activeMaterial(): MarbleMaterial | null {
  if (!state.dbgMaterialEnabled) return null;
  const p = state.player;
  return p && p.materialT > 0 ? p.material : null;
}

// ── Apply / update ──────────────────────────────────────────────

/** Pick up (or debug-grant) a material. A 2nd material opens a fusion window. */
export function applyMaterial(id: MarbleMaterial): void {
  const p = state.player;
  if (!p) return;
  const fusing = p.material && p.material !== id && p.materialT > 0;
  if (fusing) {
    // Fusion: the outgoing material co-fires briefly alongside the new one.
    p.fuseMaterial = p.material;
    p.fuseT = MATERIAL_FUSION_TIME;
  }
  p.material = id;
  p.materialT = MATERIAL_DURATION[id];
  // ── The TRANSFORMATION moment — the ball recrystallizes. A tinted radial
  // burst at the knight (white-hot cores bloom), a stack of quick afterimages
  // in the material's trail hue, a kick of shake, and the material's sting.
  // Fusion doubles the burst: two colours collide.
  const meta = MATERIALS[id];
  state.vfx?.burst(p.x, 0.5, p.z, meta.tint, 18, 5);
  state.vfx?.burst(p.x, 0.15, p.z, meta.trail, 10, 3);
  if (fusing && p.fuseMaterial) state.vfx?.burst(p.x, 0.5, p.z, MATERIALS[p.fuseMaterial].tint, 12, 4);
  for (let i = 0; i < 3; i++) state.vfx?.ghost(p.sprite.mesh, meta.trail, 0.4 + i * 0.12, 0.5 - i * 0.12);
  state.shakeT = Math.max(state.shakeT, 0.22);
  state.hitstopT = Math.max(state.hitstopT, 0.04);
  meta.sfx();
  state.hudDirty = true;
}

/** Tick the material + fusion timers; clear the material when it lapses. */
export function updateMaterial(dt: number): void {
  const p = state.player;
  if (!p) return;
  if (p.materialEmitT > 0) p.materialEmitT = Math.max(0, p.materialEmitT - dt);
  if (p.fuseT > 0) {
    p.fuseT = Math.max(0, p.fuseT - dt);
    if (p.fuseT === 0) p.fuseMaterial = null;
  }
  if (p.materialT > 0) {
    const before = p.materialT;
    p.materialT = Math.max(0, p.materialT - dt);
    if (Math.ceil(before) !== Math.ceil(p.materialT) || p.materialT === 0) state.hudDirty = true;
    if (p.materialT === 0) p.material = null;
  }
}

// ── Physics helpers (pure; the ride reads these) ────────────────

/** Flat/slant wall restitution override, or null to use the default. */
export function materialFlatRestitution(): number | null {
  switch (activeMaterial()) {
    case "diamond": return DIAMOND_RESTITUTION;
    case "water": return WATER_RESTITUTION;
    case "shadow": return SHADOW_RESTITUTION;
    default: return null;
  }
}

/** Effective collision radius for the ride sweep (shadow slips tight gaps). */
export function materialPlayerR(): number {
  return activeMaterial() === "shadow" ? SHADOW_PLAYER_R : PLAYER_R;
}

/** Multiplier on bumper exit-scatter (shadow's exits go unpredictable). */
export function materialBumperScatterMult(): number {
  return activeMaterial() === "shadow" ? SHADOW_BUMPER_SCATTER_MULT : 1;
}

/** Effective wall-break thresholds (diamond punches through far more easily). */
export function materialBreakSpeeds(): { secret: number; wall: number } {
  if (activeMaterial() === "diamond") {
    return { secret: DIAMOND_SECRET_BREAK_SPEED, wall: DIAMOND_WALL_BREAK_SPEED };
  }
  return { secret: SECRET_BREAK_SPEED, wall: WALL_BREAK_SPEED };
}

/** Multiplier on momentum friction (water glides, stone drags). */
export function materialFrictionMult(): number {
  switch (activeMaterial()) {
    case "water": return WATER_FRICTION_MULT;
    case "stone": return STONE_FRICTION_MULT;
    default: return 1;
  }
}

/** Multiplier on steering grip (water is slippery, storm is sharp). */
export function materialSteerMult(): number {
  switch (activeMaterial()) {
    case "water": return WATER_STEER_MULT;
    case "storm": return STORM_STEER_MULT;
    default: return 1;
  }
}

/** Multiplier on the lane-centring pull (storm rails corridors). */
export function materialLanePull(): number {
  return activeMaterial() === "storm" ? STORM_LANE_PULL_MULT : 1;
}

/** Ram knockback for the current material (stone shoves hard, water flows). */
export function materialRamKnockback(): number {
  switch (activeMaterial()) {
    case "stone": return STONE_RAM_KNOCKBACK;
    case "water": return WATER_RAM_KNOCKBACK;
    default: return BALL_RAM_KNOCKBACK;
  }
}

/** Extra multiplier on the corner-hit acceleration (stone corners hit harder). */
export function materialCornerAddMult(): number {
  return activeMaterial() === "stone" ? STONE_CORNER_ADD_MULT : 1;
}

/** Multiplier on bumper kick (stone ignores small forces). */
export function materialBumperMult(): number {
  return activeMaterial() === "stone" ? STONE_BUMPER_KICK_MULT : 1;
}

/** Speed ceiling for the current material (stone tops out lower). */
export function materialMaxSpeed(): number {
  return activeMaterial() === "stone" ? STONE_MAX_SPEED : PINBALL_MAX_SPEED;
}

// ── Emitters ────────────────────────────────────────────────────

/** Which materials emit this frame — the active one plus any fusing one. */
function emittingMaterials(): MarbleMaterial[] {
  if (!state.dbgMaterialEnabled) return [];
  const p = state.player;
  if (!p) return [];
  const out: MarbleMaterial[] = [];
  if (p.materialT > 0 && p.material) out.push(p.material);
  if (p.fuseT > 0 && p.fuseMaterial && p.fuseMaterial !== p.material) out.push(p.fuseMaterial);
  return out;
}

/**
 * Fire the material's on-bounce emission. `nx,nz` is the wall's outward normal
 * (points back toward the ball); the shard fan is aimed along the reflected
 * heading. Throttled + speed-gated so it rewards flow, not wall spam.
 */
export function emitMaterialOnBounce(nx: number, nz: number): void {
  const p = state.player;
  if (!p || !state.dbgMaterialOnBounce) return;
  if (p.momSpeed < MATERIAL_EMIT_SPEED || p.materialEmitT > 0) return;
  const mats = emittingMaterials();
  if (mats.length === 0) return;
  p.materialEmitT = MATERIAL_EMIT_COOLDOWN;
  // Contact point on the wall face, and the post-bounce travel heading.
  const cx = p.x + nx * PLAYER_R;
  const cz = p.z + nz * PLAYER_R;
  const heading = Math.atan2(p.momZ, p.momX);
  for (const m of mats) {
    if (m === "diamond") {
      spawnShardBurst(cx, cz, {
        count: DIAMOND_BOUNCE_SHARDS,
        speed: DIAMOND_SHARD_SPEED,
        damage: DIAMOND_BOUNCE_DMG,
        life: 0.6,
        baseAngle: heading,
        fan: DIAMOND_BOUNCE_FAN,
        crystal: true,
      });
      // Prismatic glint at the contact point — the shards' muzzle flash.
      state.vfx?.burst(cx, 0.4, cz, MATERIALS.diamond.trail, 6, 3);
    } else if (m === "water") {
      spawnFloorFx("slick", cx, cz, WATER_SLICK_RADIUS, WATER_SLICK_LIFE);
      // A low wet splash hugging the floor.
      state.vfx?.burst(cx, 0.12, cz, MATERIALS.water.tint, 7, 2.5);
    } else if (m === "stone") {
      stoneShockwave(cx, cz, STONE_SHOCK_RADIUS, STONE_SHOCK_DMG);
    } else if (m === "storm") {
      // A sideways lightning arc perpendicular to the ball's travel — zaps the
      // corridor you just bounced across.
      const hl = Math.hypot(p.momX, p.momZ) || 1;
      stormArc(cx, cz, p.momZ / hl, -p.momX / hl);
      // Storm × water-slick → the floor is a Tesla coil: chain the shock across
      // everything standing on any wet tile (the fusion-window synergy).
      stormElectrifyWet();
    } else if (m === "shadow") {
      // A SHADOW CLONE decoy at the pre-bounce spot — nearby foes break off and
      // chase it (per-enemy lure) while it dissolves. No damage: pure evasion.
      shadowDecoy(p.x, p.z);
    }
  }
}

/** Spawn a shadow-clone decoy: an ink afterimage at (x,z) that nearby foes
 *  peel off to chase (lureT), buying the shadow ball a window to slip away. */
function shadowDecoy(x: number, z: number): void {
  const p = state.player;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    if (dx * dx + dz * dz > SHADOW_LURE_RADIUS * SHADOW_LURE_RADIUS) continue;
    zmb.lureT = SHADOW_LURE_TIME;
    zmb.lureX = x;
    zmb.lureZ = z;
  }
  if (p) state.vfx?.ghost(p.sprite.mesh, MATERIALS.shadow.trail, 0.4, 0.55);
  state.vfx?.burst(x, 0.25, z, MATERIALS.shadow.tint, 6, 1.5);
}

/** A storm lightning arc from (cx,cz) along a unit dir — a narrow damage lane
 *  rendered with the jagged bolt VFX (reuses the CARD_BOLT lane geometry). */
function stormArc(cx: number, cz: number, nx: number, nz: number): void {
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const rx = zmb.x - cx;
    const rz = zmb.z - cz;
    const along = rx * nx + rz * nz;
    if (along < -0.4 || along > STORM_BOUNCE_ARC_LEN) continue;
    if (Math.abs(rx * -nz + rz * nx) > STORM_BOUNCE_ARC_HALF) continue;
    damageZombie(zmb, STORM_BOUNCE_ARC_DMG, nx, nz, 0.2);
  }
  state.vfx?.bolt(cx, 0.4, cz, nx, nz, STORM_BOUNCE_ARC_LEN);
}

/** Storm synergy: discharge into every foe standing on a water slick scar. */
function stormElectrifyWet(): void {
  for (const fx of state.floorFx) {
    if (fx.kind !== "slick") continue;
    let zapped = false;
    for (const zmb of state.zombies) {
      if (zmb.mode === "dead") continue;
      const dx = zmb.x - fx.x;
      const dz = zmb.z - fx.z;
      const rr = fx.radius + ZOMBIE_R;
      if (dx * dx + dz * dz > rr * rr) continue;
      damageZombie(zmb, STORM_WET_DMG, dx, dz, 0.1);
      zapped = true;
    }
    if (zapped) state.vfx?.burst(fx.x, 0.15, fx.z, 0x9fe8ff, 6, fx.radius * 3);
  }
}

/** Fire the material's pounce-slam emission (bigger than a bounce). */
export function materialSlam(): void {
  const p = state.player;
  if (!p || !state.dbgMaterialSlam) return;
  const mats = emittingMaterials();
  for (const m of mats) {
    if (m === "diamond") {
      const rage = p.rageT > 0 ? 1.5 : 1;
      spawnShardBurst(p.x, p.z, {
        count: Math.round(DIAMOND_SLAM_SHARDS * rage),
        speed: DIAMOND_SLAM_SPEED,
        damage: DIAMOND_SLAM_DMG,
        life: 0.7,
        crystal: true,
      });
      state.vfx?.burst(p.x, 0.5, p.z, MATERIALS.diamond.trail, 14, 5);
    } else if (m === "water") {
      for (let n = 0; n < WATER_SLAM_SLICKS; n++) {
        const a = (n / WATER_SLAM_SLICKS) * Math.PI * 2;
        const r = WATER_SLICK_RADIUS * 1.2; // spread the splash patch out around you
        spawnFloorFx("slick", p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, WATER_SLICK_RADIUS, WATER_SLICK_LIFE);
      }
      // A forward speed kick (steam-launch feel), capped to the material ceiling.
      p.momSpeed = Math.min(materialMaxSpeed(), p.momSpeed + WATER_SLAM_SPEED_KICK);
      state.vfx?.burst(p.x, 0.15, p.z, MATERIALS.water.tint, 12, 4);
    } else if (m === "stone") {
      // Boulder slam: trade current speed for a big AoE. Bigger the faster you were.
      const dmg = STONE_SLAM_BASE_DMG + STONE_SLAM_DMG_PER_SPEED * p.momSpeed;
      stoneShockwave(p.x, p.z, STONE_SLAM_RADIUS, dmg);
      p.momSpeed *= 0.3; // most of it went into the ground
      state.shakeT = Math.max(state.shakeT, 0.4);
    } else if (m === "storm") {
      thunderclap(p.x, p.z);
    } else if (m === "shadow") {
      voidImplosion(p.x, p.z);
    }
  }
}

/** 🌑 VOID IMPLOSION: violently yank every nearby foe inward (they crush
 *  together and take collision damage), then release — a gravity-well panic
 *  button. Reuses moveCircle so nobody is shoved into a wall. */
function voidImplosion(x: number, z: number): void {
  const g = state.grid;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = x - zmb.x;
    const dz = z - zmb.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > SHADOW_IMPLODE_RADIUS * SHADOW_IMPLODE_RADIUS) continue;
    const d = Math.hypot(dx, dz) || 1;
    const pull = d * SHADOW_IMPLODE_PULL; // fraction of the way to the centre
    if (g) {
      const r = moveCircle(g, zmb.x, zmb.z, ZOMBIE_R, (dx / d) * pull, (dz / d) * pull);
      zmb.x = r.x;
      zmb.z = r.z;
    }
    damageZombie(zmb, SHADOW_IMPLODE_DMG, -dx, -dz, 0);
  }
  // Collapsing ring of ink motes + a dark core.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    state.vfx?.mote(x + Math.cos(a) * SHADOW_IMPLODE_RADIUS * 0.6, 0.3, z + Math.sin(a) * SHADOW_IMPLODE_RADIUS * 0.6);
  }
  state.vfx?.burst(x, 0.4, z, MATERIALS.shadow.trail, 14, 1.5);
  state.shakeT = Math.max(state.shakeT, 0.3);
}

/** ⚡ THUNDERCLAP: a ring of electricity that damages AND STUNS (freezes in
 *  place, reusing the slick's slipT with zero drift) every foe it passes. */
function thunderclap(x: number, z: number): void {
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    const rr = STORM_CLAP_RADIUS + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    damageZombie(zmb, STORM_CLAP_DMG, dx, dz, 0.5);
    // Stun = a slip with no drift → it stands frozen for the duration.
    zmb.slipT = STORM_CLAP_STUN;
    zmb.slipVX = 0;
    zmb.slipVZ = 0;
  }
  // Concentric bolt spokes + a bright ring so the clap READS as a shockwave.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    state.vfx?.bolt(x, 0.35, z, Math.cos(a), Math.sin(a), STORM_CLAP_RADIUS * 0.7);
  }
  state.vfx?.burst(x, 0.4, z, MATERIALS.storm.trail, 20, STORM_CLAP_RADIUS * 3);
  state.shakeT = Math.max(state.shakeT, 0.35);
}

/** A stone shockwave: radial damage + a dust ring (reuses the pounce-slam look). */
function stoneShockwave(x: number, z: number, radius: number, dmg: number): void {
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    const rr = radius + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    const dealt = zmb.kind === "golem" ? dmg * STONE_SHOCK_GOLEM_MULT : dmg;
    damageZombie(zmb, dealt, dx, dz, 0.8);
  }
  // Dust ring on the perimeter + a warm additive core so the wave READS
  // (dust alone sits below the bloom threshold and vanished on busy frames).
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    state.vfx?.dust(x + Math.cos(a) * radius * 0.7, 0.05, z + Math.sin(a) * radius * 0.7);
  }
  state.vfx?.burst(x, 0.1, z, MATERIALS.stone.trail, 8, radius * 3);
}

// ── MATERIAL × TERRAIN REACTIONS ────────────────────────────────
// The ball's substance reacts to hazard tiles. Called from the hazard handlers
// (pinball-collide PART_HANDLERS + hazards.simulateHazards); each is a no-op
// unless materials AND the terrain toggle are on, so the panel can flip the
// whole layer. See constants MATERIAL × TERRAIN block.

/** True when reactions are enabled AND `m` is the active ride material. */
function reactingAs(m: MarbleMaterial): boolean {
  return state.dbgMaterialTerrain && activeMaterial() === m;
}

/**
 * 💧 Water × magstrip → STEAM ERUPTION. The magnet field flash-boils the water
 * marble: instead of dragging you to a crawl, you erupt — a scalding radial
 * burst (damage + knockback) and a hard launch along your heading. Returns true
 * when it fired (the magstrip handler then SKIPS its slow + stamps a cooldown).
 */
export function tryWaterSteam(): boolean {
  const p = state.player;
  if (!p || !reactingAs("water")) return false;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - p.x;
    const dz = zmb.z - p.z;
    const rr = WATER_STEAM_RADIUS + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    damageZombie(zmb, WATER_STEAM_DMG, dx, dz, 1.2);
  }
  // Erupt along your current heading (or straight up-lane if stalled).
  p.momSpeed = Math.max(p.momSpeed, WATER_STEAM_LAUNCH);
  // A white scald cloud + a low blue splash.
  state.vfx?.burst(p.x, 0.4, p.z, 0xffffff, 20, 5);
  state.vfx?.burst(p.x, 0.12, p.z, MATERIALS.water.tint, 10, 3);
  spawnFloorFx("slick", p.x, p.z, WATER_SLICK_RADIUS, WATER_SLICK_LIFE);
  state.shakeT = Math.max(state.shakeT, 0.3);
  sfxSpring();
  return true;
}

/** 🪨 Stone × magstrip → PLOW: the field can't grip a boulder. Returns the
 *  effective speed clamp, or null to use the normal cap. */
export function stoneMagstripCap(): number | null {
  return reactingAs("stone") ? STONE_MAGSTRIP_CAP : null;
}

/** 🪨 Stone × oil → GRIP: a boulder doesn't hydroplane. True = ignore the slick. */
export function stoneIgnoresOil(): boolean {
  return reactingAs("stone");
}

/** 🪨 Stone × pit → BRIDGE: too heavy to be swallowed while rolling; it plows
 *  across (a plume of dust) instead of falling in. */
export function stoneBridgesPit(): boolean {
  const p = state.player;
  if (!p || !reactingAs("stone") || p.momSpeed <= 0) return false;
  state.vfx?.dust(p.x, 0.05, p.z);
  state.vfx?.burst(p.x, 0.1, p.z, MATERIALS.stone.trail, 6, 2);
  return true;
}

/** 💧 Water × firevent → STEAM: the jet flash-boils the water instead of
 *  burning you. True = skip the burn (a steam puff is emitted). */
export function waterQuenchesFire(x: number, z: number): boolean {
  if (!reactingAs("water")) return false;
  state.vfx?.burst(x, 0.3, z, 0xffffff, 8, 3);
  return true;
}

/**
 * 💎 Diamond × electric → DISCHARGE. The prismatic lattice channels a live
 * plate into a zap on nearby foes and eats the shock itself. Returns true when
 * it fired (the electric handler then SKIPS the player damage). Fires at most
 * on the plate's own zap cadence (the caller already gates on that).
 */
export function tryDiamondDischarge(x: number, z: number): boolean {
  if (!reactingAs("diamond")) return false;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - x;
    const dz = zmb.z - z;
    const rr = DIAMOND_DISCHARGE_RADIUS + ZOMBIE_R;
    if (dx * dx + dz * dz > rr * rr) continue;
    damageZombie(zmb, DIAMOND_DISCHARGE_DMG, dx, dz, 0.4);
  }
  state.vfx?.burst(x, 0.5, z, 0x9fe8ff, 16, DIAMOND_DISCHARGE_RADIUS * 3);
  return true; // absorbed regardless — diamond never takes the shock
}
