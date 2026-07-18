/**
 * ⚔️ ACTIVE SKILLS — the two Q/E abilities the Diablo HUD hangs off.
 *
 * These spend MANA (see constants MANA_*), a pool that is deliberately kept
 * SEPARATE from the rampage ultimate meter: mana trickles back on its own and
 * tops up a little per kill, so the skills stay in rotation without ever
 * refuelling a god-mode rampage. Each skill leans on machinery the game already
 * has rather than inventing a parallel one — Flipper Charge injects pinball
 * momentum, Time Crawl scales the horde's dt at the update site, Magnet Aura
 * drifts the existing ground items in, Blade Storm reuses damageZombie.
 */
import { state } from "./state";
import type { Zombie } from "./state";
import { FACING_VEC, damageZombie } from "./entities/combat";
import {
  MANA_MAX,
  MANA_REGEN,
  MANA_PER_KILL,
  ARCANE_PULSE_RADIUS,
  ARCANE_PULSE_DAMAGE,
  FLIPPER_LAUNCH_SPEED,
  MAGNET_AURA_PULL,
  BLADESTORM_RADIUS,
  BLADESTORM_DAMAGE,
  BLADESTORM_TICK,
} from "./constants";
import { sfxSpin, sfxBumper, sfxFreeze, sfxSwing } from "./audio";

export type AbilityId = "flippercharge" | "arcanepulse" | "magnetaura" | "timecrawl" | "bladestorm";

export interface AbilityDef {
  id: AbilityId;
  label: string;
  icon: string;
  /** Mana cost (0..MANA_MAX). */
  cost: number;
  /** Seconds before it can fire again. */
  cooldown: number;
  /** Rarity-agnostic glow colour for the skill slot. */
  color: string;
  /** One-liner for the tooltip. */
  detail: string;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  flippercharge: { id: "flippercharge", label: "Flipper Charge", icon: "🏓", cost: 20, cooldown: 3.5, color: "#f0a63c", detail: "Launch forward like a flipper" },
  arcanepulse: { id: "arcanepulse", label: "Arcane Pulse", icon: "✷", cost: 35, cooldown: 5, color: "#b06fe8", detail: "360° arcane damage burst" },
  magnetaura: { id: "magnetaura", label: "Magnet Aura", icon: "🧲", cost: 25, cooldown: 7, color: "#6fd0e8", detail: "Pull nearby loot for 4s" },
  timecrawl: { id: "timecrawl", label: "Time Crawl", icon: "⏳", cost: 50, cooldown: 11, color: "#bfe8ff", detail: "Slow the horde for 3s" },
  bladestorm: { id: "bladestorm", label: "Blade Storm", icon: "🌪️", cost: 40, cooldown: 9, color: "#d95763", detail: "Orbiting blades for 5s" },
};

export const ABILITY_IDS: AbilityId[] = ["flippercharge", "arcanepulse", "magnetaura", "timecrawl", "bladestorm"];

/** Live mana, clamped. */
export function getMana(): number {
  return Math.max(0, Math.min(MANA_MAX, state.player?.mana ?? 0));
}

/** Can the ability in this skill slot fire right now (equipped, off cooldown, affordable)? */
export function canCast(slot: 0 | 1): boolean {
  const id = state.abilitySlots[slot];
  if (!id) return false;
  const def = ABILITIES[id];
  return (state.abilityCd[id] ?? 0) <= 0 && getMana() >= def.cost;
}

/**
 * Fire the ability bound to a skill slot (0 = Q, 1 = E). Returns true if it
 * actually went off (paid + effect applied), false if it was blocked.
 */
export function castAbility(slot: 0 | 1): boolean {
  const p = state.player;
  const id = state.abilitySlots[slot];
  if (!p || !id) return false;
  const def = ABILITIES[id];
  if ((state.abilityCd[id] ?? 0) > 0 || p.mana < def.cost) return false;

  p.mana = Math.max(0, p.mana - def.cost);
  state.abilityCd[id] = def.cooldown;

  switch (id) {
    case "flippercharge": {
      const [fx, fz] = p.momSpeed > 0 ? [p.momX, p.momZ] : FACING_VEC[p.facing];
      const len = Math.hypot(fx, fz) || 1;
      p.momX = fx / len;
      p.momZ = fz / len;
      p.momSpeed = FLIPPER_LAUNCH_SPEED;
      p.turboT = Math.max(p.turboT, 0.9); // ride it out with no friction
      p.iframes = Math.max(p.iframes, 0.35);
      state.shakeT = Math.max(state.shakeT, 0.18);
      state.vfx?.sparks(p.x, 0.5, p.z, -p.momX, -p.momZ, 12);
      sfxBumper();
      break;
    }
    case "arcanepulse": {
      for (const z of state.zombies) {
        if (z.mode === "dead") continue;
        const dx = z.x - p.x;
        const dz = z.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > ARCANE_PULSE_RADIUS) continue;
        const inv = d || 1;
        damageZombie(z, ARCANE_PULSE_DAMAGE, dx / inv, dz / inv, 6);
      }
      state.shakeT = Math.max(state.shakeT, 0.3);
      state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 26);
      sfxSpin();
      break;
    }
    case "magnetaura":
      p.magnetAuraT = 4;
      state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 10);
      sfxSpin();
      break;
    case "timecrawl":
      state.slowT = 3;
      state.vfx?.sparks(p.x, 0.7, p.z, 0, 0, 14);
      sfxFreeze();
      break;
    case "bladestorm":
      p.bladeStormT = 5;
      p.bladeStormTickT = 0;
      sfxSwing();
      break;
  }
  state.hudDirty = true;
  return true;
}

/**
 * Per-frame upkeep: regen mana, cool the skills down, and drive the ongoing
 * effects (magnet pull, blade-storm ticks). Time Crawl is applied at the
 * horde's update call site (dt scale), so it only decays here.
 */
export function tickAbilities(dt: number): void {
  const p = state.player;
  if (!p) return;

  // Debug: keep the pool topped and the skills instantly re-castable.
  if (state.infMana && p.mana < MANA_MAX) {
    p.mana = MANA_MAX;
    state.hudDirty = true;
  }
  if (state.noCooldown) {
    for (const id of ABILITY_IDS) if ((state.abilityCd[id] ?? 0) > 0) state.abilityCd[id] = 0;
  }

  // Passive mana regen.
  if (p.mana < MANA_MAX) {
    const before = p.mana;
    p.mana = Math.min(MANA_MAX, p.mana + MANA_REGEN * dt);
    if (Math.floor(p.mana) !== Math.floor(before)) state.hudDirty = true;
  }

  // Cooldowns.
  for (const id of ABILITY_IDS) {
    const c = state.abilityCd[id] ?? 0;
    if (c > 0) {
      state.abilityCd[id] = Math.max(0, c - dt);
      if (state.abilityCd[id] === 0) state.hudDirty = true;
    }
  }

  // Time Crawl timer (effect lives at the updateZombies call).
  if (state.slowT > 0) {
    state.slowT = Math.max(0, state.slowT - dt);
    if (state.slowT === 0) state.hudDirty = true;
  }

  // Magnet Aura: drift ground items toward the knight.
  if (p.magnetAuraT > 0) {
    p.magnetAuraT = Math.max(0, p.magnetAuraT - dt);
    for (const it of state.groundItems) {
      if (it.blockedUntilAway) continue;
      const dx = p.x - it.x;
      const dz = p.z - it.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(d, MAGNET_AURA_PULL * dt);
      it.x += (dx / d) * step;
      it.z += (dz / d) * step;
      it.sprite.mesh.position.x = it.x;
      it.sprite.mesh.position.z = it.z;
    }
    if (p.magnetAuraT === 0) state.hudDirty = true;
  }

  // Blade Storm: orbiting blades bite everything close on a fixed cadence.
  if (p.bladeStormT > 0) {
    p.bladeStormT = Math.max(0, p.bladeStormT - dt);
    p.bladeStormTickT -= dt;
    if (p.bladeStormT > 0 && p.bladeStormTickT <= 0) {
      p.bladeStormTickT = BLADESTORM_TICK;
      let hit: Zombie | null = null;
      for (const z of state.zombies) {
        if (z.mode === "dead") continue;
        const dx = z.x - p.x;
        const dz = z.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > BLADESTORM_RADIUS) continue;
        const inv = d || 1;
        damageZombie(z, BLADESTORM_DAMAGE, dx / inv, dz / inv, 3);
        hit = z;
      }
      if (hit) state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 6);
    }
    if (p.bladeStormT === 0) state.hudDirty = true;
  }
}

