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
import { playerManaMax, skillAgg } from "./skill-runtime";
import type { Zombie } from "./state";
import { FACING_VEC, damageZombie } from "./entities/combat";
import { spawnFloorFx } from "./entities/floor-fx";
import {
  MANA_REGEN,
  ARCANE_PULSE_RADIUS,
  ARCANE_PULSE_DAMAGE,
  FLIPPER_LAUNCH_SPEED,
  MAGNET_AURA_PULL,
  BLADESTORM_RADIUS,
  BLADESTORM_DAMAGE,
  BLADESTORM_TICK,
  PULSE_WAVE_DUR,
  PULSE_RING_LAG,
  PULSE_RIM_BURSTS,
  FLIPPER_TRAIL_T,
  FLIPPER_TRAIL_MIN_SPEED,
  FLIPPER_TRAIL_RADIUS,
  FLIPPER_TRAIL_LIFE,
  FLIPPER_TRAIL_GHOST_T,
  OIL_SLICK_RADIUS,
  OIL_SLICK_LIFE,
  PULSE_CAST_FORKS,
  PULSE_MID_FORKS,
  PULSE_CRACKLE_ARCS,
  PULSE_CRACKLE_EVERY,
  PULSE_SIGIL_LIFE,
  PULSE_SIGIL_SPIN,
  PULSE_COLUMN_MOTES,
  PULSE_C_LIGHT,
  PULSE_C_MID,
  BLADESTORM_BLADES,
  BLADESTORM_SPIN,
  MAGNET_FIELD_R,
  MAGNET_PULSE_EVERY,
  MAGNET_LEASH_MAX,
  TIMECRAWL_FIELD_R,
  TIMECRAWL_SMEAR,
} from "./constants";
import { sfxSpin, sfxBumper, sfxFreeze, sfxSwing } from "./audio";
import { clamp } from "../../utils/math";

export type AbilityId = "flippercharge" | "arcanepulse" | "magnetaura" | "timecrawl" | "bladestorm" | "slickfield";

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
  // Colour is STEEL, matching the blades actually drawn in the world (vfx.blades
  // + the cast ring). It read blood-red in the HUD while the orbiting crescents
  // rendered steel — the slot glow is supposed to be the ability's tell.
  bladestorm: { id: "bladestorm", label: "Blade Storm", icon: "🌪️", cost: 40, cooldown: 9, color: "#c8ccd4", detail: "Orbiting blades for 5s" },
  slickfield: { id: "slickfield", label: "Slick Field", icon: "🛢️", cost: 25, cooldown: 8, color: "#8a5fd0", detail: "Spill oil — foes skid, the ball glides, fire ignites it" },
};

export const ABILITY_IDS: AbilityId[] = ["flippercharge", "arcanepulse", "magnetaura", "timecrawl", "bladestorm", "slickfield"];

/**
 * A live Arcane Pulse shockwave: damage rides the EXPANDING ring (matching the
 * vfx.ring visual), so each foe is struck the frame the wave front crosses it —
 * with a mini-bolt snapped back to the cast point, D2-Nova style. Module-local:
 * waves live well under a second, so run teardown never needs to clear them.
 */
interface PulseWave {
  x: number;
  z: number;
  t: number;
  hit: Set<Zombie>;
  /** Has the mid-flight lightning crown gone off yet? (once per wave) */
  forked: boolean;
  /** Countdown to the next crackle off the live wave front. */
  crackleT: number;
}
const pulseWaves: PulseWave[] = [];

/** Ease-out wave-front radius at time `t` — mirrors RingPool's expansion curve. */
function pulseRadius(t: number): number {
  const k = Math.min(1, t / PULSE_WAVE_DUR);
  return ARCANE_PULSE_RADIUS * (1 - (1 - k) * (1 - k));
}

/**
 * ARCANE PULSE — a spell being CAST, not a circle being drawn.
 *
 * The old build was three fat hoops on the floor, and it read as exactly that:
 * "a circle". Every element below exists to bury that read under an actual
 * arcane discharge, in the order the eye picks them up:
 *
 *   1. a RUNE SIGIL struck under the caster (counter-rotating, glyphed) — the
 *      single strongest "this is magic" signal, and the thing a plain annulus
 *      can never be;
 *   2. a LIGHTNING CROWN forking out along the ground, re-fired mid-flight and
 *      again at the rim, so arcs are on screen for the whole wave rather than
 *      one 0.2s flash;
 *   3. a vertical COLUMN of arcane motes off the cast point — the spell has an
 *      up, not just an outward;
 *   4. and only THEN the shockwave rings — now a THIN, sharp wave-front line at
 *      reduced opacity (RingOpts.thin), a leading edge instead of a hoop.
 *
 * Colours are PALETTE-NATIVE arcane blues (29/30/31) plus near-white cores. The
 * composite pass quantizes to 32 colours, and off-palette purple (0x8800ff)
 * once snapped to blood red — the original "red circle". Nothing in this effect
 * is allowed to be red, including the on-hit pop (arcane burst, not blood).
 */
export function spawnPulseWave(x: number, z: number): void {
  pulseWaves.push({ x, z, t: 0, hit: new Set(), forked: false, crackleT: 0 });
  const vfx = state.vfx;
  if (!vfx) return;
  // 1 — the glyph. Wider than the damage radius and slower than the wave, so it
  // is still burning when the front lands.
  vfx.sigil(x, z, PULSE_C_LIGHT, ARCANE_PULSE_RADIUS * 1.05, PULSE_SIGIL_LIFE, PULSE_SIGIL_SPIN);
  vfx.sigil(x, z, 0xffffff, ARCANE_PULSE_RADIUS * 0.45, PULSE_SIGIL_LIFE * 0.7, -PULSE_SIGIL_SPIN * 1.9);
  // 2 — the discharge.
  forkCrown(x, z, PULSE_CAST_FORKS, ARCANE_PULSE_RADIUS * 0.55, 0);
  // 3 — the column: a hot core pop plus motes thrown UP the cast point.
  vfx.burst(x, 0.5, z, PULSE_C_LIGHT, 18, 5);
  for (let k = 0; k < PULSE_COLUMN_MOTES; k++) {
    vfx.ember(x + (Math.random() * 2 - 1) * 0.35, 0.15 + Math.random() * 1.5, z + (Math.random() * 2 - 1) * 0.35);
  }
  // 4 — the wave front, quiet and sharp underneath all of it.
  vfx.ring(x, z, 0xffffff, ARCANE_PULSE_RADIUS, PULSE_WAVE_DUR, { thin: true });
  vfx.ring(x, z, PULSE_C_LIGHT, ARCANE_PULSE_RADIUS, PULSE_WAVE_DUR * 1.3, { thin: true, delay: PULSE_RING_LAG, opacity: 0.8 });
  vfx.ring(x, z, PULSE_C_MID, ARCANE_PULSE_RADIUS * 0.8, PULSE_WAVE_DUR * 1.6, { delay: PULSE_RING_LAG * 2.5, opacity: 0.35 });
}

/**
 * A ring of `n` ground bolts radiating from (x,z) out to `len`, offset by
 * `phase` so successive crowns don't land on the same spokes. The arcane
 * signature: the pulse is a discharge that FORKS, and each fork is a real
 * thunderbolt from the same pool the Storm cards use.
 */
function forkCrown(x: number, z: number, n: number, len: number, phase: number): void {
  const vfx = state.vfx;
  if (!vfx) return;
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2;
    vfx.bolt(x, 0.45, z, Math.cos(a), Math.sin(a), len * (0.8 + Math.random() * 0.4));
  }
}

function tickPulseWaves(dt: number): void {
  for (let i = pulseWaves.length - 1; i >= 0; i--) {
    const w = pulseWaves[i];
    w.t += dt;
    const r = pulseRadius(w.t);
    // Mid-flight, the discharge forks a SECOND crown — longer, rotated off the
    // cast one — so the arcs chase the wave front out instead of firing once at
    // the origin and leaving a bare ring to finish the trip alone.
    if (!w.forked && w.t >= PULSE_WAVE_DUR * 0.45) {
      w.forked = true;
      forkCrown(w.x, w.z, PULSE_MID_FORKS, ARCANE_PULSE_RADIUS * 0.95, Math.PI / PULSE_MID_FORKS);
    }
    // CRACKLE: a couple of short arcs snapping outward FROM the live wave front
    // on a fast beat. This is what keeps the front reading as energy travelling
    // rather than as a hoop being scaled up — the arcs are always exactly where
    // the damage is.
    w.crackleT -= dt;
    if (w.crackleT <= 0 && r > 0.5) {
      w.crackleT = PULSE_CRACKLE_EVERY;
      for (let k = 0; k < PULSE_CRACKLE_ARCS; k++) {
        const a = Math.random() * Math.PI * 2;
        state.vfx?.bolt(w.x + Math.cos(a) * r * 0.55, 0.4, w.z + Math.sin(a) * r * 0.55, Math.cos(a), Math.sin(a), r * 0.55);
      }
    }
    for (const z of state.zombies) {
      if (z.mode === "dead" || w.hit.has(z)) continue;
      const dx = z.x - w.x;
      const dz = z.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d > r || d > ARCANE_PULSE_RADIUS) continue;
      w.hit.add(z);
      const inv = d || 1;
      damageZombie(z, ARCANE_PULSE_DAMAGE, dx / inv, dz / inv, 6);
      // The wave-front impact, in two halves that do DIFFERENT jobs — keep both:
      // the blood spray is the hit landing on a body (the same feedback every
      // other damage source in the game gives, and the thing that makes a kill
      // read), while the arcane pop + the arc snapped back to the cast point say
      // the SHOCKWAVE is what did it.
      state.vfx?.blood(z.x, 0.6, z.z, "red", 6);
      state.vfx?.burst(z.x, 0.6, z.z, PULSE_C_LIGHT, 10, 3);
      if (d > 0.4) state.vfx?.bolt(w.x, 0.6, w.z, dx, dz, d);
    }
    if (w.t >= PULSE_WAVE_DUR) {
      // The rim arrives: impact pops evenly around the circumference, each one
      // struck by its own short bolt so the wave EARTHS itself at the edge
      // rather than simply fading out.
      for (let k = 0; k < PULSE_RIM_BURSTS; k++) {
        const a = (k / PULSE_RIM_BURSTS) * Math.PI * 2;
        const rx = w.x + Math.cos(a) * ARCANE_PULSE_RADIUS;
        const rz = w.z + Math.sin(a) * ARCANE_PULSE_RADIUS;
        state.vfx?.burst(rx, 0.25, rz, PULSE_C_LIGHT, 6, 2.2);
      }
      forkCrown(w.x, w.z, PULSE_RIM_BURSTS, ARCANE_PULSE_RADIUS, Math.PI / PULSE_RIM_BURSTS);
      pulseWaves.splice(i, 1);
    }
  }
}

// Fire-trail tile tracker — which tile last received a burn scar, so a fast
// ride drops exactly one scar per tile crossed instead of one per frame.
let trailIx = Number.NaN;
let trailIz = Number.NaN;
let trailGhostT = 0;

// Sustained-aura scratch. Each buff whose LOOK is a state rather than an event
// keeps its beat here: pool-friendly cadences (a ring/ghost per tick, never per
// frame) and the blade ring's live phase. Module-local like pulseWaves — these
// only matter while the buff is up, and every one of them is re-seeded on cast.
let magnetPulseT = 0;
let crawlSmearT = 0;
let bladeAngle = 0;

/** Live mana, clamped to the (skill-extended) pool. */
export function getMana(): number {
  return clamp(state.player?.mana ?? 0, 0, playerManaMax());
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
  state.abilityCd[id] = def.cooldown * skillAgg().cooldownMult; // Swift Casting ranks

  switch (id) {
    case "flippercharge": {
      const [fx, fz] = p.momSpeed > 0 ? [p.momX, p.momZ] : FACING_VEC[p.facing];
      const len = Math.hypot(fx, fz) || 1;
      p.momX = fx / len;
      p.momZ = fz / len;
      // max(), NOT assignment. This used to overwrite momentum outright, so
      // casting the game's signature SPEED ability while already travelling
      // faster than FLIPPER_LAUNCH_SPEED made you SLOWER — you paid mana to
      // brake. A launch can only ever launch.
      p.momSpeed = Math.max(p.momSpeed, FLIPPER_LAUNCH_SPEED);
      p.turboT = Math.max(p.turboT, 0.9); // ride it out with no friction
      p.iframes = Math.max(p.iframes, 0.35);
      // The launch IGNITES: flame ghosts + embers while riding, and a burning
      // scar per tile crossed (spawned in tickAbilities below).
      p.fireTrailT = FLIPPER_TRAIL_T;
      trailIx = Math.floor(p.x);
      trailIz = Math.floor(p.z);
      state.shakeT = Math.max(state.shakeT, 0.18);
      state.vfx?.sparks(p.x, 0.5, p.z, -p.momX, -p.momZ, 12);
      state.vfx?.burst(p.x, 0.4, p.z, 0xff6600, 12, 3);
      sfxBumper();
      break;
    }
    case "arcanepulse": {
      spawnPulseWave(p.x, p.z);
      state.shakeT = Math.max(state.shakeT, 0.3);
      sfxSpin();
      break;
    }
    case "magnetaura":
      p.magnetAuraT = 4;
      magnetPulseT = 0; // the field pulses on the very first frame it is up
      // A PULL, so everything about it runs inward: two collapsing rings that
      // accelerate into the knight (RingPool's inward mode) instead of the
      // outward wave every other cast uses. The aura's ongoing suction is drawn
      // in tickAbilities — the cast is just the field snapping on.
      // Sharp collapsing LINES, not fat hoops — same lesson as the pulse: a
      // wide annulus scaled to a 3-tile radius reads as "a circle on the floor"
      // rather than as a field closing in.
      //
      // The glyph is re-struck on every beat AT THE KNIGHT (see tickAbilities),
      // never once at the cast point: this aura MOVES WITH YOU — items are
      // pulled toward wherever you are — so a sigil pinned to the ground would
      // visibly detach the moment you rolled away, which is exactly the
      // "animation doesn't match what's happening" problem this wave is about.
      state.vfx?.ring(p.x, p.z, 0x6fd0e8, MAGNET_FIELD_R, 0.5, { inward: true, thin: true });
      state.vfx?.ring(p.x, p.z, 0x2e6d8f, MAGNET_FIELD_R * 0.7, 0.6, { delay: 0.12, inward: true, thin: true });
      state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 10);
      sfxSpin();
      break;
    case "timecrawl":
      state.slowT = 3;
      crawlSmearT = 0; // the horde starts smearing immediately, not a beat late
      // A cold front rolling out, then the world holding its breath: one wide
      // pale ring, one slow echo, and a low frost burst. The horde's own
      // smeared afterimages (tickAbilities) are what actually sell the SLOW.
      // The sigil's graduated rim ticks read as a CLOCK FACE, the one shape
      // that says "time" rather than "an area effect". It turns almost
      // imperceptibly (0.16 rad/s) — the dial has stalled, which is the whole
      // fantasy. Deliberately a short CAST flourish, not a 3s field marker:
      // Time Crawl slows the horde EVERYWHERE, so it has no centre to mark, and
      // a long-lived glyph would just sit on the floor detaching from the
      // knight. The ongoing effect is carried by the horde's smear ghosts below.
      state.vfx?.sigil(p.x, p.z, 0xbfe8ff, TIMECRAWL_FIELD_R, 1.2, 0.16);
      state.vfx?.ring(p.x, p.z, 0xbfe8ff, TIMECRAWL_FIELD_R, 0.55, { thin: true });
      state.vfx?.ring(p.x, p.z, 0x6fd0e8, TIMECRAWL_FIELD_R * 1.15, 1.1, { delay: 0.1, thin: true, opacity: 0.7 });
      state.vfx?.burst(p.x, 0.35, p.z, 0xbfe8ff, 20, 3);
      state.flashT = Math.max(state.flashT, 0.12); // the instant everything stalls
      sfxFreeze();
      break;
    case "bladestorm":
      p.bladeStormT = 5;
      p.bladeStormTickT = 0;
      bladeAngle = 0;
      // The blades come OUT: a fast steel ring snapping to its orbit radius.
      state.vfx?.ring(p.x, p.z, 0xc8ccd4, BLADESTORM_RADIUS, 0.28, { thin: true });
      state.vfx?.burst(p.x, 0.6, p.z, 0xeef1f5, 12, 4);
      sfxSwing();
      break;
    case "slickfield":
      // One big spilled pool (≈3×3 tiles). The floor-fx overlap loop does the
      // rest: foes skid, the rolling ball glides, overlapping fire ignites it.
      spawnFloorFx("oil", p.x, p.z, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
      state.vfx?.burst(p.x, 0.2, p.z, 0x1f3d52, 26, 2.5); // low dark floor-hugging eruption
      // The pool SPREADS: a ring racing out to the slick's own edge, so the
      // spill has a visible leading front instead of a disc appearing whole.
      state.vfx?.ring(p.x, p.z, 0x2e6d8f, OIL_SLICK_RADIUS, 0.42);
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
  if (state.infMana && p.mana < playerManaMax()) {
    p.mana = playerManaMax();
    state.hudDirty = true;
  }
  if (state.noCooldown) {
    for (const id of ABILITY_IDS) if ((state.abilityCd[id] ?? 0) > 0) state.abilityCd[id] = 0;
  }

  // Passive mana regen.
  if (p.mana < playerManaMax()) {
    const before = p.mana;
    p.mana = Math.min(playerManaMax(), p.mana + MANA_REGEN * dt);
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

  // Arcane Pulse shockwaves — damage rides the expanding wave front.
  if (pulseWaves.length > 0) tickPulseWaves(dt);

  // Flipper Charge fire trail: while the ride is hot, flame afterimages +
  // embers off the knight, and one burning scar per NEW tile crossed. Slowing
  // below the threshold gutters the fire early — no standing-still bonfires.
  if (p.fireTrailT > 0) {
    p.fireTrailT = Math.max(0, p.fireTrailT - dt);
    if (p.momSpeed >= FLIPPER_TRAIL_MIN_SPEED) {
      trailGhostT -= dt;
      if (trailGhostT <= 0) {
        trailGhostT = FLIPPER_TRAIL_GHOST_T;
        state.vfx?.ghost(p.sprite.mesh, 0xff4400, 0.22, 0.35);
      }
      state.vfx?.ember(p.x, 0.25, p.z);
      state.vfx?.ember(p.x, 0.4, p.z);
      const ix = Math.floor(p.x);
      const iz = Math.floor(p.z);
      if (ix !== trailIx || iz !== trailIz) {
        trailIx = ix;
        trailIz = iz;
        spawnFloorFx("fire", p.x, p.z, FLIPPER_TRAIL_RADIUS, FLIPPER_TRAIL_LIFE);
        state.vfx?.burst(p.x, 0.3, p.z, 0xf0a63c, 6, 2); // the tile CATCHES behind the ride
      }
    } else if (p.momSpeed <= 0.01) {
      p.fireTrailT = 0; // the ride ended — the fire goes with it
    }
  }

  // Time Crawl timer (effect lives at the updateZombies call) + its look. The
  // buff's whole point is that the HORDE is crawling, so that is what gets
  // drawn: every live foe leaves a pale-blue afterimage, smearing where it was
  // a beat ago. A ring around the player alone would say "you cast something";
  // ghosts on the enemies say "they are stuck in treacle".
  if (state.slowT > 0) {
    state.slowT = Math.max(0, state.slowT - dt);
    crawlSmearT -= dt;
    if (crawlSmearT <= 0) {
      crawlSmearT = TIMECRAWL_SMEAR;
      for (const z of state.zombies) {
        if (z.mode === "dead") continue;
        state.vfx?.ghost(z.sprite.mesh, 0xbfe8ff, 0.5, 0.3);
      }
      // A slow shallow ripple off the knight keeps the FIELD readable when the
      // room happens to be empty.
      state.vfx?.ring(p.x, p.z, 0x6fd0e8, TIMECRAWL_FIELD_R, 0.9, { thin: true, opacity: 0.55 });
    }
    if (state.slowT === 0) state.hudDirty = true;
  }

  // Magnet Aura: drift ground items toward the knight.
  if (p.magnetAuraT > 0) {
    p.magnetAuraT = Math.max(0, p.magnetAuraT - dt);
    // The field, made visible: collapsing rings on a steady beat, plus an arc
    // snapped onto whatever loot is currently being dragged in — the aura
    // should look like it is REELING things, not like a buff icon.
    magnetPulseT -= dt;
    if (magnetPulseT <= 0) {
      magnetPulseT = MAGNET_PULSE_EVERY;
      // Glyph + collapsing line, both at the knight's LIVE position, with the
      // glyph outliving its beat so successive strikes overlap into one field
      // that travels with you rather than a strobe.
      state.vfx?.sigil(p.x, p.z, 0x6fd0e8, MAGNET_FIELD_R, MAGNET_PULSE_EVERY * 1.35, -1.1);
      state.vfx?.ring(p.x, p.z, 0x6fd0e8, MAGNET_FIELD_R, 0.45, { inward: true, thin: true });
      let leashed = 0;
      for (const it of state.groundItems) {
        if (leashed >= MAGNET_LEASH_MAX) break;
        if (it.blockedUntilAway) continue;
        const dx = p.x - it.x;
        const dz = p.z - it.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5 || d > MAGNET_FIELD_R) continue;
        state.vfx?.bolt(it.x, 0.4, it.z, dx, dz, d);
        leashed++;
      }
    }
    for (const it of state.groundItems) {
      if (it.blockedUntilAway) continue;
      // Coins are NOT dragged here. They run their own burst/rest/magnet flight
      // (core.updateCoins) and the aura widens that flight's capture range
      // instead — letting both systems write one coin's position in the same
      // frame would double its speed and fight the arc.
      if (it.kind === "coin") continue;
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
    // The blades themselves — a keep-alive ring of crescents actually circling
    // the knight at the damage radius, so the hitbox is something you can SEE
    // (this buff used to be invisible: sparks on a hit and nothing else).
    bladeAngle += BLADESTORM_SPIN * dt;
    state.vfx?.blades(p.x, 0.55, p.z, bladeAngle, BLADESTORM_BLADES, BLADESTORM_RADIUS * 0.72, 0xc8ccd4);
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
        // Each bite lands ON the foe — a cut where the blade actually connected,
        // not a generic puff at the knight's feet.
        state.vfx?.sparks(z.x, 0.6, z.z, dx / inv, dz / inv, 7);
        hit = z;
      }
      if (hit) state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 6);
    }
    if (p.bladeStormT === 0) state.hudDirty = true;
  }
}

