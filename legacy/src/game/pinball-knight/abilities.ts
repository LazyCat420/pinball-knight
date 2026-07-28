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
import { momentumT } from "./entities/combo-curve";
import { requestShake, requestHitstop } from "./engine/juice";
import { moveCircle } from "./engine/collision";
import {
  MANA_REGEN,
  PINBALL_MAX_SPEED,
  MANA_PER_BOUNCE,
  MANA_BOUNCE_MOMENTUM,
  ABILITY_RANK_MAX,
  ABILITY_RANK_STEP,
  ABILITY_RANK_RULE,
  CAST_ANIM,
  CAST_GATHER_EVERY,
  DYNAMO_BOUNCE_MULT,
  BLOOD_PRICE_HP,
  CINDER_WAKE_T,
  CINDER_WAKE_RADIUS,
  CINDER_WAKE_LIFE,
  FROST_RUNE_RADIUS,
  FROST_RUNE_LIFE,
  FROST_RUNE_COUNT,
  FROST_RUNE_RING,
  TAR_PIT_RADIUS,
  TAR_PIT_LIFE,
  LIGHTNING_ROD_RADIUS,
  LIGHTNING_ROD_LIFE,
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
  MAGNET_HORDE_PULL,
  ZOMBIE_R,
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

// ── ABILITY RANKS ─────────────────────────────────────────────────────────────
/**
 * The six abilities used to be a single switch of fixed magnitudes, which meant
 * they were the only progression system in the game with NO progression axis:
 * an Arcane Pulse on floor 1 and on floor 12 were the same spell. Skill points
 * can now be invested into ONE ability instead of the tree — the same wallet,
 * an explicit opportunity cost against a tree node.
 *
 * Ranks are additive (`ABILITY_RANK_STEP` per rank, DECLONE §1.2 farmable
 * bucket), capped at `ABILITY_RANK_MAX`, and escalate in price: 1, 2, then 3
 * points, so maxing one ability costs six — comparable to a whole branch.
 *
 * Rank 2 is the interesting one. It does not print a bigger number; it gives
 * the ability an EXTRA RULE (a planted rod, a ring of frost runes, a tar core).
 * That is what stops "invest in your favourite spell" from being a damage chip
 * with a different label.
 */
export function abilityRank(id: AbilityId): number {
  return Math.min(ABILITY_RANK_MAX, state.abilityRanks[id] ?? 0);
}

/** Points to buy the NEXT rank of an ability (1, 2, 3). */
export function abilityRankCost(rank: number): number {
  return rank + 1;
}

/**
 * The magnitude multiplier a cast goes off at: its ranks, plus Kinetic Focus
 * scaled by how fast you were travelling when the wind-up landed.
 *
 * Both terms are ADDITIVE onto 1 rather than multiplied together — two farmable
 * sources compounding is exactly what the two-bucket rule exists to prevent,
 * and `momentumT` keeps the second term bounded by construction.
 */
export function abilityPower(id: AbilityId): number {
  const agg = skillAgg();
  const speed = state.player?.momSpeed ?? 0;
  return 1 + ABILITY_RANK_STEP * abilityRank(id) + agg.momentumAbilityPower * momentumT(speed);
}

/** Does this ability have its rank-2 extra rule? */
function hasRankRule(id: AbilityId): boolean {
  return abilityRank(id) >= ABILITY_RANK_RULE;
}

/** The slot glow as a hex number the particle pools can take. */
function abilityColor(id: AbilityId): number {
  return parseInt(ABILITIES[id].color.slice(1), 16);
}

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
  /**
   * Reach and bite of THIS wave. Carried per-wave rather than read from the
   * constants at hit time, because ability ranks make two waves in the same run
   * different sizes — and a wave whose drawn ring and damage radius came from
   * different sources is the "animation doesn't match what's happening" bug the
   * pulse rework was written to kill.
   */
  r: number;
  dmg: number;
}
const pulseWaves: PulseWave[] = [];

/** Ease-out wave-front radius at time `t` — mirrors RingPool's expansion curve. */
function pulseRadius(t: number, max: number): number {
  const k = Math.min(1, t / PULSE_WAVE_DUR);
  return max * (1 - (1 - k) * (1 - k));
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
export function spawnPulseWave(x: number, z: number, power = 1): void {
  // Reach grows at a QUARTER of the power (a rank-3 pulse is 19% wider, not
  // 75%): the radius is a physical footprint the player has to read at a glance
  // and route around, while damage is a number they never see. Scaling both by
  // the same factor makes a maxed pulse cover half a room.
  const r = ARCANE_PULSE_RADIUS * (1 + (power - 1) * 0.25);
  pulseWaves.push({ x, z, t: 0, hit: new Set(), forked: false, crackleT: 0, r, dmg: ARCANE_PULSE_DAMAGE * power });
  const vfx = state.vfx;
  if (!vfx) return;
  // 1 — the glyph. Wider than the damage radius and slower than the wave, so it
  // is still burning when the front lands.
  vfx.sigil(x, z, PULSE_C_LIGHT, r * 1.05, PULSE_SIGIL_LIFE, PULSE_SIGIL_SPIN);
  vfx.sigil(x, z, 0xffffff, r * 0.45, PULSE_SIGIL_LIFE * 0.7, -PULSE_SIGIL_SPIN * 1.9);
  // 2 — the discharge.
  forkCrown(x, z, PULSE_CAST_FORKS, r * 0.55, 0);
  // 3 — the column: a hot core pop plus motes thrown UP the cast point.
  vfx.burst(x, 0.5, z, PULSE_C_LIGHT, 18, 5);
  for (let k = 0; k < PULSE_COLUMN_MOTES; k++) {
    vfx.ember(x + (Math.random() * 2 - 1) * 0.35, 0.15 + Math.random() * 1.5, z + (Math.random() * 2 - 1) * 0.35);
  }
  // 4 — the wave front, quiet and sharp underneath all of it.
  vfx.ring(x, z, 0xffffff, r, PULSE_WAVE_DUR, { thin: true });
  vfx.ring(x, z, PULSE_C_LIGHT, r, PULSE_WAVE_DUR * 1.3, { thin: true, delay: PULSE_RING_LAG, opacity: 0.8 });
  vfx.ring(x, z, PULSE_C_MID, r * 0.8, PULSE_WAVE_DUR * 1.6, { delay: PULSE_RING_LAG * 2.5, opacity: 0.35 });
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
    const r = pulseRadius(w.t, w.r);
    // Mid-flight, the discharge forks a SECOND crown — longer, rotated off the
    // cast one — so the arcs chase the wave front out instead of firing once at
    // the origin and leaving a bare ring to finish the trip alone.
    if (!w.forked && w.t >= PULSE_WAVE_DUR * 0.45) {
      w.forked = true;
      forkCrown(w.x, w.z, PULSE_MID_FORKS, w.r * 0.95, Math.PI / PULSE_MID_FORKS);
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
      if (d > r || d > w.r) continue;
      w.hit.add(z);
      const inv = d || 1;
      damageZombie(z, w.dmg, dx / inv, dz / inv, 6);
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
        const rx = w.x + Math.cos(a) * w.r;
        const rz = w.z + Math.sin(a) * w.r;
        state.vfx?.burst(rx, 0.25, rz, PULSE_C_LIGHT, 6, 2.2);
      }
      forkCrown(w.x, w.z, PULSE_RIM_BURSTS, w.r, Math.PI / PULSE_RIM_BURSTS);
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
/** Last bounce-combo reading, so the table's mana trickle pays per NEW bounce
 *  rather than per frame. Module-local like the beats above: a chain that has
 *  lapsed reads 0 and re-arms itself on the next bounce. */
let lastCombo = 0;

/** Live mana, clamped to the (skill-extended) pool. */
export function getMana(): number {
  return clamp(state.player?.mana ?? 0, 0, playerManaMax());
}

/**
 * Can this cast be PAID for right now?
 *
 * Two ways, not one. Normally the pool has to cover the cost. Under the Blood
 * Price keystone an empty pool stops being a wall — the cast fires and takes a
 * heart instead — so affordability has to ask the keystone, or the HUD would
 * grey out a slot the player can demonstrably use. The `hp > BLOOD_PRICE_HP`
 * guard is the soft-failure ledger (DECLONE §1.4): a spell may cost you a
 * heart, it may never be the thing that kills you.
 */
function affordable(id: AbilityId): boolean {
  const p = state.player;
  if (!p) return false;
  if (getMana() >= ABILITIES[id].cost) return true;
  return skillAgg().bloodPrice && (p.hp ?? 0) > BLOOD_PRICE_HP;
}

/** Can the ability in this skill slot fire right now (equipped, off cooldown, affordable)? */
export function canCast(slot: 0 | 1): boolean {
  const id = state.abilitySlots[slot];
  if (!id) return false;
  return (state.abilityCd[id] ?? 0) <= 0 && affordable(id);
}

// ── THE CAST, IN THREE BEATS ──────────────────────────────────────────────────
/**
 * ANTICIPATION → IMPACT → RECOVERY.
 *
 * Every cast in this game used to resolve on the frame the key went down. That
 * is not a small presentation gap — it is the reason a spell had no weight and
 * no tell. In a game where the other half of the screen is a horde that kites,
 * orbits and ambushes, a cast an opponent cannot READ is a cast that may as
 * well be an instant-hit stat change.
 *
 * So a cast now has real, gameplay-affecting latency. `castAbility` pays the
 * cost, arms the cooldown and strikes the WIND-UP: energy collapsing inward on
 * the caster (RingPool's inward mode — the only shape that means "gathering"
 * rather than "going off"), a tinted afterimage of the knight coiling, and a
 * trickle of motes drawn from the ring toward him. Only when the wind-up
 * elapses does the effect fire, with the impact frame carrying the flash, the
 * shake and the hit-freeze. A settle ring closes it out.
 *
 * The wind-ups are DELIBERATELY unequal and deliberately short (`CAST_ANIM`):
 * five frames for the launch, fifteen for the time-stop. Heavy spells telegraph
 * because they are heavy; the signature move barely telegraphs at all, because
 * making Flipper Charge feel like it goes off "later" would be a worse game.
 *
 * Position: the wind-up is struck where you STOOD, the effect goes off where
 * you ARE. Pinning the effect to the wind-up point would visibly detach it from
 * the knight on a fast ride — the same mistake the magnet aura's sigil once
 * made, and the reason that sigil is re-struck at the live position every beat.
 */
interface CastAnim {
  id: AbilityId;
  t: number;
  windup: number;
  recover: number;
  /** Where the wind-up was struck; the anticipation FX stay here. */
  x: number;
  z: number;
  /** Snapshotted at cast time so rank/momentum can't shift mid-flight. */
  power: number;
  fired: boolean;
  /** Beat for the gathering motes. */
  gatherT: number;
}
const casts: CastAnim[] = [];

/** Test seam: how many casts are between the key press and the effect. */
export function castsInFlight(): number {
  return casts.length;
}

/**
 * Drop this module's scratch: casts in flight, live waves, and the bounce
 * reading the mana trickle differences against.
 *
 * A TEST SEAM, deliberately not wired into `resetState`. In the live game
 * `tickAbilities` runs every frame and re-syncs `lastCombo` from the player on
 * the very first one, so a new run cannot inherit a stale reading — but a test
 * that swaps `state.player` between assertions without ticking can, and did:
 * the first version of the trickle test passed for the wrong reason.
 */
export function resetAbilityScratch(): void {
  casts.length = 0;
  pulseWaves.length = 0;
  lastCombo = 0;
  magnetPulseT = 0;
  crawlSmearT = 0;
  bladeAngle = 0;
  trailIx = Number.NaN;
  trailIz = Number.NaN;
}

/** Beat 1 — the wind-up. Everything here says "gathering", nothing says "fired". */
function anticipate(id: AbilityId, x: number, z: number, anim: (typeof CAST_ANIM)[string]): void {
  const vfx = state.vfx;
  const p = state.player;
  const c = abilityColor(id);
  // The collapse runs for exactly the wind-up, so the ring ARRIVES on the
  // impact frame. A ring that finished early or late would read as a separate
  // effect rather than as the charge for this one.
  vfx?.ring(x, z, c, anim.gather, anim.windup, { inward: true, thin: true });
  if (p) vfx?.ghost(p.sprite.mesh, c, anim.windup * 1.6, 0.3);
  vfx?.burst(x, 0.5, z, c, 5, 1.2);
}

/** Beat 3 — the settle. Presentation only; nothing here touches the sim. */
function recover(id: AbilityId, anim: (typeof CAST_ANIM)[string]): void {
  const p = state.player;
  if (!p) return;
  state.vfx?.ring(p.x, p.z, abilityColor(id), anim.gather * 0.55, anim.recover, { thin: true, opacity: 0.3 });
  state.vfx?.mote(p.x, 0.5, p.z);
  state.vfx?.mote(p.x, 0.8, p.z);
}

/**
 * Fire the ability bound to a skill slot (0 = Q, 1 = E). Returns true if the
 * cast STARTED — cost paid, cooldown armed, wind-up struck. The effect itself
 * lands `CAST_ANIM[id].windup` seconds later, in `tickAbilities`.
 */
export function castAbility(slot: 0 | 1): boolean {
  const p = state.player;
  const id = state.abilitySlots[slot];
  if (!p || !id) return false;
  const def = ABILITIES[id];
  if ((state.abilityCd[id] ?? 0) > 0 || !affordable(id)) return false;

  // Blood Price: the pool pays what it can and the body pays the rest. Done
  // BEFORE the mana debit so a partially-full pool still empties into the cast
  // rather than being politely left alone.
  if (p.mana < def.cost) {
    p.hp -= BLOOD_PRICE_HP;
    state.vfx?.blood(p.x, 0.8, p.z, "red", 10);
    state.vfx?.damage(p.x, 1.3, p.z, BLOOD_PRICE_HP, "in");
  }
  p.mana = Math.max(0, p.mana - def.cost);
  state.abilityCd[id] = def.cooldown * skillAgg().cooldownMult; // Swift Casting ranks

  const anim = CAST_ANIM[id];
  casts.push({ id, t: 0, windup: anim.windup, recover: anim.recover, x: p.x, z: p.z, power: abilityPower(id), fired: false, gatherT: 0 });
  anticipate(id, p.x, p.z, anim);
  // The audio is the OPPONENT'S tell, so it plays on the wind-up, not on the
  // effect. A sound that arrives with the damage tells nobody anything.
  castSfx(id);
  state.hudDirty = true;
  return true;
}

/** Each ability's wind-up voice. */
function castSfx(id: AbilityId): void {
  if (id === "flippercharge") sfxBumper();
  else if (id === "timecrawl") sfxFreeze();
  else if (id === "arcanepulse" || id === "magnetaura") sfxSpin();
  else sfxSwing();
}

/**
 * Beat 2 — THE IMPACT FRAME. The effect lands, and the whole juice stack fires
 * in one place: flash, shake, hit-freeze.
 *
 * Shake and hitstop go through the engine's juice GOVERNOR rather than writing
 * `state.shakeT`/`state.hitstopT` directly. Abilities were two of the fourteen
 * call sites that bypassed it, which is exactly the pathology the governor
 * exists for — a Flipper Charge fired into a five-part ricochet used to stack
 * its freeze on top of the chain's and stutter the sim at the one moment the
 * game should feel fastest.
 */
function fireAbility(id: AbilityId, power: number): void {
  const p = state.player;
  if (!p) return;
  const anim = CAST_ANIM[id];
  if (anim.flash > 0) state.flashT = Math.max(state.flashT, anim.flash);
  if (anim.shake > 0) requestShake(anim.shake);
  if (anim.hitstop > 0) requestHitstop(anim.hitstop);

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
      // Ranks buy launch speed, but CLAMPED at the table's terminal speed. A
      // launch that exceeded PINBALL_MAX_SPEED would hand the physics a number
      // it was never tuned for from a menu button — the one thing the mobility
      // clamp in skills.ts exists to make impossible everywhere else.
      p.momSpeed = Math.max(p.momSpeed, Math.min(PINBALL_MAX_SPEED, FLIPPER_LAUNCH_SPEED * power));
      p.turboT = Math.max(p.turboT, 0.9 * power); // ride it out with no friction
      // RANK 2 RULE — the i-frames stop being a launch cushion and cover the
      // WHOLE ride. A charge becomes a line you can commit to through a packed
      // room rather than one you have to aim around it: a different decision,
      // not a bigger number.
      p.iframes = Math.max(p.iframes, hasRankRule("flippercharge") ? 0.9 * power : 0.35);
      // The launch IGNITES: flame ghosts + embers while riding, and a burning
      // scar per tile crossed (spawned in tickAbilities below).
      p.fireTrailT = FLIPPER_TRAIL_T * power;
      trailIx = Math.floor(p.x);
      trailIz = Math.floor(p.z);
      state.vfx?.sparks(p.x, 0.5, p.z, -p.momX, -p.momZ, 12);
      state.vfx?.burst(p.x, 0.4, p.z, 0xff6600, 12, 3);
      break;
    }
    case "arcanepulse": {
      spawnPulseWave(p.x, p.z, power);
      // RANK 2 RULE — the pulse leaves a LIGHTNING ROD standing where it was
      // cast. The wave is a one-shot; the rod keeps working the room after you
      // have rolled away, which is a different tactical object rather than a
      // larger version of the same one.
      if (hasRankRule("arcanepulse")) {
        spawnFloorFx("rod", p.x, p.z, LIGHTNING_ROD_RADIUS, LIGHTNING_ROD_LIFE * power);
        state.vfx?.bolt(p.x, 1.4, p.z, 0, 0.01, 1.4);
      }
      break;
    }
    case "magnetaura":
      p.magnetAuraT = 4 * power;
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
      break;
    case "timecrawl":
      state.slowT = 3 * power;
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
      // RANK 2 RULE — the stall FREEZES THE GROUND. A ring of frost runes is
      // laid around the caster, so the slow outlives the three seconds as
      // terrain: the horde that walked in during the stop is still wading when
      // the clock restarts. Six runes, fixed angles, no RNG — the horde sees
      // these, so a co-op peer has to agree on where they are.
      if (hasRankRule("timecrawl")) {
        for (let k = 0; k < FROST_RUNE_COUNT; k++) {
          const a = (k / FROST_RUNE_COUNT) * Math.PI * 2;
          spawnFloorFx("frost", p.x + Math.cos(a) * FROST_RUNE_RING, p.z + Math.sin(a) * FROST_RUNE_RING, FROST_RUNE_RADIUS, FROST_RUNE_LIFE * power);
        }
      }
      break;
    case "bladestorm":
      p.bladeStormT = 5 * power;
      p.bladeStormTickT = 0;
      bladeAngle = 0;
      // The blades come OUT: a fast steel ring snapping to its orbit radius.
      state.vfx?.ring(p.x, p.z, 0xc8ccd4, BLADESTORM_RADIUS, 0.28, { thin: true });
      state.vfx?.burst(p.x, 0.6, p.z, 0xeef1f5, 12, 4);
      // RANK 2's rule lives in the damage tick (blades shred hostile shots).
      break;
    case "slickfield":
      // One big spilled pool (≈3×3 tiles). The floor-fx overlap loop does the
      // rest: foes skid, the rolling ball glides, overlapping fire ignites it.
      spawnFloorFx("oil", p.x, p.z, OIL_SLICK_RADIUS * (1 + (power - 1) * 0.4), OIL_SLICK_LIFE * power);
      // RANK 2 RULE — the spill CONGEALS. A tar core sits inside the slick, and
      // tar is oil's exact inverse: nothing crosses it at speed, including you.
      // The two together are a doughnut — a fast skid ring around a dead centre
      // — which is a shape to route around rather than a bigger puddle.
      if (hasRankRule("slickfield")) spawnFloorFx("tar", p.x, p.z, TAR_PIT_RADIUS, TAR_PIT_LIFE * power);
      state.vfx?.burst(p.x, 0.2, p.z, 0x1f3d52, 26, 2.5); // low dark floor-hugging eruption
      // The pool SPREADS: a ring racing out to the slick's own edge, so the
      // spill has a visible leading front instead of a disc appearing whole.
      state.vfx?.ring(p.x, p.z, 0x2e6d8f, OIL_SLICK_RADIUS, 0.42);
      break;
  }
  state.hudDirty = true;
}

/**
 * Drive every cast in flight. Three beats, one pass:
 *   t < windup            → gather motes on their own beat
 *   t crosses windup      → the effect fires, once
 *   t past windup+recover → the settle plays and the cast retires
 */
function tickCasts(dt: number): void {
  for (let i = casts.length - 1; i >= 0; i--) {
    const c = casts[i];
    c.t += dt;
    if (!c.fired) {
      // Motes falling INWARD toward the caster off the collapsing ring. Random
      // placement is fine: nothing the horde or a peer can observe reads this,
      // it is a particle spawn point.
      c.gatherT -= dt;
      if (c.gatherT <= 0 && state.vfx) {
        c.gatherT = CAST_GATHER_EVERY;
        const a = Math.random() * Math.PI * 2;
        const anim = CAST_ANIM[c.id];
        state.vfx.ember(c.x + Math.cos(a) * anim.gather * 0.7, 0.2 + Math.random() * 0.9, c.z + Math.sin(a) * anim.gather * 0.7);
      }
      if (c.t < c.windup) continue;
      c.fired = true;
      fireAbility(c.id, c.power);
      continue;
    }
    if (c.t >= c.windup + c.recover) {
      recover(c.id, CAST_ANIM[c.id]);
      casts.splice(i, 1);
    }
  }
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

  const agg = skillAgg();
  const momT = momentumT(p.momSpeed ?? 0);

  // Passive mana regen — the WALL CLOCK source. Dynamo severs it outright:
  // under that keystone the only battery is the table (below).
  if (!agg.dynamo && p.mana < playerManaMax()) {
    const before = p.mana;
    p.mana = Math.min(playerManaMax(), p.mana + MANA_REGEN * dt);
    if (Math.floor(p.mana) !== Math.floor(before)) state.hudDirty = true;
  }

  // ── MANA FROM THE TABLE (DECLONE §4.4) ──
  //
  // The cheapest momentum coupling in the game: every ability becomes a
  // function of how well you are riding, and not one ability EFFECT changed to
  // make it happen. `bounceCombo` is already the ride's own count of things hit
  // without settling, so the trickle needs no new state to keep in sync — only
  // the previous reading.
  //
  // Guarded with `?? 0` because a combo that ever reads undefined would make
  // `combo > lastCombo` false forever and silently switch the whole feature
  // off — the failure mode this repo has a lesson about.
  const combo = p.bounceCombo ?? 0;
  if (combo > lastCombo && p.mana < playerManaMax()) {
    const per = MANA_PER_BOUNCE * (1 + MANA_BOUNCE_MOMENTUM * momT) * (agg.dynamo ? DYNAMO_BOUNCE_MULT : 1);
    p.mana = Math.min(playerManaMax(), p.mana + (combo - lastCombo) * per);
    state.hudDirty = true;
  }
  lastCombo = combo;

  // Cooldowns. Overdrive ranks make the DECAY RATE momentum-scaled — a walking
  // knight recovers on the clock, a screaming one recovers faster. Deliberately
  // the rate rather than the armed duration: a cooldown set at cast time could
  // not have known how you were going to play the next four seconds.
  const cdRate = 1 + agg.momentumCooldownRate * momT;
  for (const id of ABILITY_IDS) {
    const c = state.abilityCd[id] ?? 0;
    if (c > 0) {
      state.abilityCd[id] = Math.max(0, c - dt * cdRate);
      if (state.abilityCd[id] === 0) state.hudDirty = true;
    }
  }

  // Casts in flight — anticipation, the impact frame, the settle.
  if (casts.length > 0) tickCasts(dt);

  // Arcane Pulse shockwaves — damage rides the expanding wave front.
  if (pulseWaves.length > 0) tickPulseWaves(dt);

  // ── CINDER WAKE (keystone) ──
  // Above the threshold the knight IS the fire trail, with no charge to pay
  // for. Shares the Flipper Charge tile tracker on purpose: one scar per tile
  // crossed, whichever source lit it, so a charge fired mid-wake does not
  // double-stamp the lane.
  if (agg.cinderWake && momT >= CINDER_WAKE_T) {
    const ix = Math.floor(p.x);
    const iz = Math.floor(p.z);
    if (ix !== trailIx || iz !== trailIz) {
      trailIx = ix;
      trailIz = iz;
      spawnFloorFx("fire", p.x, p.z, CINDER_WAKE_RADIUS, CINDER_WAKE_LIFE);
      state.vfx?.ember(p.x, 0.3, p.z);
    }
  }

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
    // RANK 2 RULE — the field stops caring what things are made of and starts
    // pulling BODIES. The horde inside the radius is dragged toward the knight,
    // which inverts the ability: a loot vacuum becomes a gravity well you set
    // up before a Blade Storm or a Pulse, and a genuinely bad idea to hold with
    // low hearts. (An "aura reaches further" upgrade was the first draft and
    // was dropped on reading the code: the item drag below has never had a
    // radius at all, so wider reach would have changed literally nothing —
    // rule 1 of the game-dev rules, verify the claim against the code.)
    //
    // Routed through `moveCircle` rather than writing x/z: a foe dragged into
    // geometry is a foe stuck in a wall, and wall-clipping the horde from an
    // ability would be a far worse bug than the one this fixes.
    if (hasRankRule("magnetaura") && state.grid) {
      for (const z of state.zombies) {
        if (z.mode === "dead") continue;
        const dx = p.x - z.x;
        const dz = p.z - z.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6 || d > MAGNET_FIELD_R) continue;
        const step = MAGNET_HORDE_PULL * (1 - d / MAGNET_FIELD_R) * dt;
        const res = moveCircle(state.grid, z.x, z.z, ZOMBIE_R, (dx / d) * step, (dz / d) * step);
        z.x = res.x;
        z.z = res.z;
      }
    }
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
      // Read LIVE rather than snapshotted at cast: Blade Storm is a five-second
      // state, and Kinetic Focus is supposed to reward how fast you are while
      // it runs, not how fast you were when you pressed the key.
      const bite = BLADESTORM_DAMAGE * abilityPower("bladestorm");
      let hit: Zombie | null = null;
      for (const z of state.zombies) {
        if (z.mode === "dead") continue;
        const dx = z.x - p.x;
        const dz = z.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > BLADESTORM_RADIUS) continue;
        const inv = d || 1;
        damageZombie(z, bite, dx / inv, dz / inv, 3);
        // Each bite lands ON the foe — a cut where the blade actually connected,
        // not a generic puff at the knight's feet.
        state.vfx?.sparks(z.x, 0.6, z.z, dx / inv, dz / inv, 7);
        hit = z;
      }
      if (hit) state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 6);
      // RANK 2 RULE — the ring SHREDS incoming fire. Spitter globs that clip
      // the blades die on them, which turns Blade Storm from "a damage aura"
      // into "the answer to a ranged room". Killed by zeroing `life` rather
      // than splicing: the projectile despawn path (scene removal + mesh
      // disposal) stays in exactly one place, the same rule floor-fx follows.
      if (hasRankRule("bladestorm")) {
        for (const pr of state.projectiles) {
          if (!pr.hostile || pr.life <= 0) continue;
          const dx = pr.x - p.x;
          const dz = pr.z - p.z;
          if (dx * dx + dz * dz > BLADESTORM_RADIUS * BLADESTORM_RADIUS) continue;
          pr.life = 0;
          state.vfx?.sparks(pr.x, 0.5, pr.z, -dx, -dz, 6);
        }
      }
    }
    if (p.bladeStormT === 0) state.hudDirty = true;
  }
}

