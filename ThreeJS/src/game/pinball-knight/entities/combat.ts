/**
 * Hit resolution — damage, i-frames, knockback, durability and death all
 * resolve HERE, in one place, rather than being smeared across player.ts,
 * zombie.ts and projectiles.ts.
 */
import { state, activeWeapon, type Zombie, type EnemyKind } from "../state";
import { typeDropMult, ZOMBIE_TYPES, type ZombieType } from "../zombie-types";
import { awardKillXp, skillAgg, playerMaxHp, playerManaMax } from "../skill-runtime";
import {
  KNOCKBACK_ZOMBIE,
  KNOCKBACK_PLAYER,
  PLAYER_IFRAMES,
  ZOMBIE_DAMAGE,
  BAT_DAMAGE,
  SLIME_DAMAGE,
  SPIDER_DAMAGE,
  GHOST_DAMAGE,
  ZOMBIE_R,
  PLAYER_R,
  GOLD_PER_KILL,
  PPU,
  HITSTOP_HIT,
  HITSTOP_KILL,
  SHAKE_ON_HIT,
  SHAKE_ON_KILL,
  ULT_CHARGE_PER_KILL,
  MANA_PER_KILL,
  BRUTE_DAMAGE,
  BRUTE_KNOCKBACK,
  REAPER_DAMAGE,
  GHOST_VULN_TIME,
  GOLEM_DAMAGE,
  CHOMPER_DAMAGE,
  MAGNET_DAMAGE,
  PIN_SLIDE_FROM_HIT,
  PIN_STRIKE_WINDOW,
  PIN_STRIKE_COUNT,
  PIN_STRIKE_GOLD,
  WEB_TIME,
  CARD_PINBALL_SPEED,
  MOMENTUM_WEAPON_MAX,
  CARD_CHILL_TIME,
  CARD_BURN_TIME,
  CARD_BURN_DMG,
  CARD_BOLT_LENGTH,
  CARD_BOLT_HALF_WIDTH,
  CARD_BOLT_DAMAGE,
  CARD_BOLT_COOLDOWN,
  CRYSTAL_SHARD_DMG,
  CRYSTAL_SHARDS,
  WISP_BLINK_CD,
  WISP_BLINK_DIST,
  COMBO_ZONE_CRUISE,
  CHOMPER_SHOVE_MAX,
  GATE_MIN_FACTOR,
  DODGE_RANGED_CHANCE,
  SPEED_ONLY_T,
  JESTER_DISC_DAMAGE,
  ROTORTAIL_TIMBER_DAMAGE,
  STILTNECK_BLAST_DAMAGE,
  JESTER_SPRING_KICK,
  CROAKER_BEAM_DAMAGE,
  PINBALL_MAX_SPEED, FISH_FEET_DAMAGE } from "../constants";
import { comboKillGold, comboDamageMult, momentumScaled, comboWindow, momentumT, momentumGate } from "./combo-curve";
import { painBase, painChance, staggerTime, accrue } from "./stagger";
import { MOMENTUM_GATES } from "./enemy-rules";
// CYCLE NOTE: marble.ts already imports damageZombie from here, so this closes
// a mutual import. It is safe because both sides are hoisted FUNCTION
// DECLARATIONS called at simulation time, not module-evaluation time — nothing
// here reads a marble binding while either module is still initialising. (This
// is why the pair works where ui.ts's MATERIAL_CHIP had to be inlined: ui
// evaluates a table at module scope.)
import { materialResistsDrain } from "./marble";
import { moveCircle } from "../engine/collision";
import type { Facing } from "../engine/render/animator";
import { screenDirToWorld } from "../engine/camera";
import { addGold } from "../../../utils/gold-wallet";
import { WEAPONS, GEAR, POTIONS, degradeWeapon, absorbDamage, upgradeDamageMult, RAGE_DAMAGE_MULT, STONESKIN_DAMAGE_MULT, GREED_GOLD_MULT, STATIC_ARC_DAMAGE, STATIC_ARC_RANGE } from "../items";
import { aggregateCards } from "../cards";
import { recordDeathTrace } from "../dev/death-debug";

/**
 * Player's outgoing damage: the base weapon damage run through the active
 * weapon's socketed CARDS (percent then flat), the pinball-synergy bonus while
 * riding momentum, and finally the rage buff. The one choke point every player
 * hit (melee, ranged, ram) passes through, so a card lifts them all.
 */
/** Set by playerDamage when the last roll CRIT; read + cleared by damageZombie's
 *  floating-number so the hit reads as a crit. Player hits call playerDamage
 *  immediately before damageZombie, so the flag never leaks to other sources. */
let _lastCrit = false;
/** Which tool landed the blow currently resolving — read by `tallyKill` so the
 *  bestiary can count RAM kills separately. Set at the top of every damage
 *  resolution, so it can never describe an earlier hit. */
let _killSrc: DamageSource = "steel";

export function playerDamage(base: number): number {
  const p = state.player;
  let dmg = base;
  _lastCrit = false;
  const w = state.weaponSlots[state.activeSlot];
  // WEAPONSMITH UPGRADE (+1, +2, …). Applied before the cards so a card's
  // percentage multiplies the upgraded base, which is what makes stacking an
  // upgrade AND a good card feel like a real build rather than two flat adds.
  if (w?.upgrade) dmg *= upgradeDamageMult(w.upgrade);
  if (w && w.cards && w.cards.length) {
    const agg = aggregateCards(w.cards);
    dmg = dmg * agg.damageMult + agg.damageFlat;
    // PINBALL SYNERGY, on the shared ramp. This used to be a cliff at
    // CARD_PINBALL_SPEED — nothing at 7.9 u/s, the whole multiplier at 8.1, and
    // no reason to ever go faster. Now it scales the whole way to terminal.
    if (agg.pinballMult > 1 && p) dmg *= momentumScaled(agg.pinballMult, p.momSpeed);
    // MARBLE SYNERGY: bonus while any material is riding (Elementalist/Attunement).
    if (agg.materialMult > 1 && p && p.material && p.materialT > 0) dmg *= agg.materialMult;
    // CRIT roll: a real chance for an amplified hit (Keen Mind / Assassin / …).
    if (agg.critChance > 0 && Math.random() < agg.critChance) {
      dmg *= agg.critMult;
      _lastCrit = true;
    }
  }
  // WRECKING BALL: the one weapon whose damage RIDES your momentum. Swinging
  // mid-roll is normally awkward; this weapon makes it the point. Scales from
  // 1x at a standstill to MOMENTUM_WEAPON_MAX at terminal speed.
  const wd = WEAPONS[activeWeapon().id];
  if (wd.momentumScaling && p && p.momSpeed > 0) {
    // Was its own bespoke linear ramp (speed/PINBALL_MAX_SPEED); folded onto
    // the shared curve so the weapon, the cards and the tree all agree on what
    // "fast" is worth.
    dmg *= momentumScaled(MOMENTUM_WEAPON_MAX, p.momSpeed);
  }
  const skills = skillAgg();
  dmg *= skills.damageMult;
  if (skills.pinballDamageMult > 1 && p) dmg *= momentumScaled(skills.pinballDamageMult, p.momSpeed);
  // THE CHAIN ITSELF (combo-curve Part 7). Every lever the bounce combo drove
  // before this was speed, economy or screen juice — a 100x chain hit exactly
  // as hard as an 8x one unless you had drafted a pinballMult card. This is the
  // free, build-independent half of that fantasy: nothing below the Cruise gate,
  // then a concave ramp capped at COMBO_DMG_MAX.
  //
  // Deliberately AFTER the card and skill multipliers so it stacks with them
  // rather than replacing them — an invested pinball build should still clearly
  // out-damage a bare one carrying the same chain.
  if (p && p.bounceCombo > COMBO_ZONE_CRUISE) dmg *= comboDamageMult(p.bounceCombo);
  if (p && p.rageT > 0) dmg *= RAGE_DAMAGE_MULT;
  return dmg;
}

/**
 * Stamp the active weapon's ON-HIT card statuses (chill / burn) onto a struck
 * enemy. Called at every player hit site after the damage lands.
 */
export function applyCardOnHit(z: Zombie): void {
  const w = state.weaponSlots[state.activeSlot];
  if (w && w.cards && w.cards.length) {
    const agg = aggregateCards(w.cards);
    // Each status stamps a small flash the moment it LANDS — a chill or a DoT
    // applied silently reads as the monster randomly slowing/shrinking later.
    if (agg.chill) {
      z.chillT = CARD_CHILL_TIME;
      state.vfx?.burst(z.x, 0.6, z.z, 0xbfe8ff, 4, 2.0);
    }
    if (agg.burn) {
      z.dotT = CARD_BURN_TIME;
      z.dotDmg = CARD_BURN_DMG;
      z.dotTickT = 0;
      state.vfx?.burst(z.x, 0.6, z.z, 0xf0a63c, 4, 2.2);
    }
    if (agg.bolt) fireBolt(z);
    // LIFESTEAL: the blow feeds the knight (Leech / Vampiric Edge / Blood Pact).
    if (agg.lifesteal > 0) {
      const p2 = state.player;
      if (p2 && p2.hp > 0) {
        const max = playerMaxHp();
        if (p2.hp < max) {
          p2.hp = Math.min(max, p2.hp + agg.lifesteal);
          state.hudDirty = true;
          state.vfx?.sparks(p2.x, 0.7, p2.z, 0, 1, 3);
        }
      }
    }
  }
  // ── Craft brews that ride EVERY hit (no weapon/card needed) ──
  const p = state.player;
  if (!p) return;
  // Venom Coat: your strikes poison — the same DoT the burn card stamps.
  if (p.venomCoatT > 0) {
    z.dotT = CARD_BURN_TIME;
    z.dotDmg = CARD_BURN_DMG;
    z.dotTickT = 0;
    state.vfx?.blood(z.x, 0.6, z.z, "green", 3); // the coat visibly smears on
  }
  // Static Charge: the blow ARCS to the nearest OTHER living foe — a free zap
  // that ignores the momentum gates (it's lightning, not steel).
  if (p.staticT > 0) arcStatic(z);
}

/** Static Charge's chain: zap the nearest living zombie other than `from`. */
function arcStatic(from: Zombie): void {
  let best: Zombie | null = null;
  let bestD = STATIC_ARC_RANGE;
  for (const other of state.zombies) {
    if (other === from || other.mode === "dead") continue;
    const d = Math.hypot(other.x - from.x, other.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  if (!best) return;
  state.vfx?.sparks(best.x, 0.7, best.z, from.x - best.x, from.z - best.z, 10);
  damageZombie(best, STATIC_ARC_DAMAGE, best.x - from.x, best.z - from.z, 0, true);
}

/** Height (blocks) the thunderbolt is drawn at — enemy torso, so it visibly
 * crosses the foes it hits. */
const BOLT_Y = 0.7;

/**
 * STORM-CARD THUNDERBOLT — on hit, a bolt whips out from the struck enemy along
 * the strike line (player → foe, so it continues "in front" away from you),
 * damaging every living foe within a narrow lane for CARD_BOLT_LENGTH blocks.
 * Throttled by p.boltCdT so rapid swings can't chain-spam it. Force-damages
 * (like static arc) — it's lightning, so the momentum gates don't apply.
 */
function fireBolt(struck: Zombie): void {
  const p = state.player;
  if (!p || p.boltCdT > 0) return;

  // Direction: from the player toward the struck foe, continuing outward. Fall
  // back to the player's facing when they're standing on top of the enemy.
  let dx = struck.x - p.x;
  let dz = struck.z - p.z;
  let d = Math.hypot(dx, dz);
  if (d < 0.01) {
    const [fx, fz] = FACING_VEC[p.facing];
    dx = fx;
    dz = fz;
    d = Math.hypot(dx, dz) || 1;
  }
  const nx = dx / d;
  const nz = dz / d;
  p.boltCdT = CARD_BOLT_COOLDOWN;

  // Damage every living foe inside the lane: projection along the bolt within
  // [0, length] AND perpendicular distance within the half-width.
  for (const other of state.zombies) {
    if (other.mode === "dead") continue;
    const rx = other.x - struck.x;
    const rz = other.z - struck.z;
    const along = rx * nx + rz * nz; // distance down the bolt
    if (along < -0.4 || along > CARD_BOLT_LENGTH) continue;
    const perp = Math.abs(rx * -nz + rz * nx); // distance off the centre line
    if (perp > CARD_BOLT_HALF_WIDTH) continue;
    damageZombie(other, CARD_BOLT_DAMAGE, nx, nz, 0, true);
    state.vfx?.sparks(other.x, 0.7, other.z, nx, nz, 6);
  }

  // The bolt itself, plus a spark burst where it terminates.
  state.vfx?.bolt(struck.x, BOLT_Y, struck.z, nx, nz, CARD_BOLT_LENGTH);
  state.vfx?.sparks(struck.x + nx * CARD_BOLT_LENGTH, BOLT_Y, struck.z + nz * CARD_BOLT_LENGTH, nx, nz, 8);
}

/**
 * Callback invoked at (x,z) when a boss dies — core registers it to drop the
 * reward (gold + a health potion). A callback rather than a direct import keeps
 * combat.ts free of a circular dependency on core.ts.
 */
let onBossDefeated: ((x: number, z: number) => void) | null = null;
export function setBossDefeatedHandler(fn: (x: number, z: number) => void): void {
  onBossDefeated = fn;
}

/**
 * Co-op combat bridge (injected by core, same pattern as the handlers above —
 * combat must not import the net layer). On a REPLICA floor the authority owns
 * every zombie's HP: `isReplica` gates the local hp write, `forward` ships the
 * final computed damage to the authority, and `onKill` lets the authority
 * broadcast deaths so every screen gets the gibs + shared gold.
 */
interface CoopCombatBridge {
  isReplica(): boolean;
  forward(z: Zombie, dmg: number, dx: number, dz: number, push: number): void;
  onKill(z: Zombie): void;
}
let coopBridge: CoopCombatBridge | null = null;
export function setCoopCombatBridge(b: CoopCombatBridge): void {
  coopBridge = b;
}

/**
 * A big slime's death SPLITS it into two minis. Spawning lives in core (it owns
 * makeZombie/sheets), and it must be DEFERRED to the end of the sim step —
 * killZombie fires inside loops over state.zombies, and minis born mid-swing
 * would be hit by the very blow that split their parent.
 */
let onSlimeSplit: ((x: number, z: number, speed: number) => void) | null = null;
export function setSlimeSplitHandler(fn: (x: number, z: number, speed: number) => void): void {
  onSlimeSplit = fn;
}
import { sfxHit, sfxZombieDie, sfxHurt, sfxBreak } from "../sfx";
import { showToast, showPickupNote, updateFpsStreak } from "../ui";
import { faceOnDamage } from "../hud-face";

/**
 * Facing → WORLD ground direction. Facings are SCREEN-relative (the art's "E"
 * is screen-right), so under the isometric yaw each cardinal maps to a world
 * diagonal. Attack arcs, projectile aim, knockback and steering all use these.
 */
export const FACING_VEC: Record<Facing, [number, number]> = (() => {
  const v = (sx: number, sz: number): [number, number] => {
    const w = screenDirToWorld(sx, sz);
    return [w.x, w.z];
  };
  return { N: v(0, -1), S: v(0, 1), E: v(1, 0), W: v(-1, 0) };
})();

const FLASH_TIME = 0.12;

const ISO = Math.SQRT1_2;

/** One-shot toast for the momentum-gate lesson (goblin/golem clink). */
let _gateHintShown = false;
/** One-shot "the reaper is immune" explainer — reset per run with the rest. */
let _reaperImmuneShown = false;

/** Rolling ledger for the bowling STRIKE bonus (3+ pins inside the window). */
let _pinKills = 0;
let _pinKillT = 0;
let _strikePaid = false;

/** Reset the per-run combat feel state (called by core on launch/retry). */
export function resetCombatJuice(): void {
  _reaperImmuneShown = false;
  _gateHintShown = false;
  _pinKills = 0;
  _pinKillT = 0;
  _strikePaid = false;
}

/** Tick the strike window (from core.simulate). */
export function tickCombatTimers(dt: number): void {
  if (_pinKills > 0) {
    _pinKillT -= dt;
    if (_pinKillT <= 0) {
      _pinKills = 0;
      _strikePaid = false;
    }
  }
}

/**
 * Snap an actor's mesh to its logical position so its texels land on whole
 * render-target pixels — unsnapped sprites shimmer as they move (BLUEPRINT
 * §4.3). Under the 45° yaw, world axes no longer map to screen axes, so the
 * snap happens on the camera-aligned diagonals (u = screen-x, v = depth).
 */
export function syncActorMesh(a: { sprite: { mesh: { position: { set(x: number, y: number, z: number): void } } }; x: number; z: number }): void {
  const u = (a.x - a.z) * ISO;
  const v = (a.x + a.z) * ISO;
  const su = Math.round(u * PPU) / PPU;
  const sv = Math.round(v * PPU) / PPU;
  a.sprite.mesh.position.set((sv + su) * ISO, 0, (sv - su) * ISO);
}

/**
 * The one damage funnel for zombies — melee swings and every projectile end
 * up here. (dirx,dirz) is the incoming hit direction (need not be unit);
 * `push` scales the wall-aware knockback.
 */
/**
 * @param force skip the momentum gates and the reaper's immunity.
 * @param src   which TOOL delivered the blow. Only the sub-type exceptions read
 *   it (DECLONE §6.2) — "bounce-immune" needs to know a body-ram from a swing,
 *   "dodges-ranged" needs to know an arrow from either. It defaults to `steel`
 *   because that is the answer for every source that has no opinion (burn
 *   ticks, hazards, abilities), and a wrong default here would quietly hand
 *   every DoT the properties of a ram.
 *
 * ONLY the debug panel's Kill All passes this. Those gates are deliberate
 * teaching rules — a goblin shrugs off a standing poke, a golem needs
 * smash-speed, a drifting ghost is untouchable, the Death Dealer cannot be hurt
 * at all — and they apply to the player at all times. But they also applied to
 * Kill All, which is a QA tool whose entire job is to empty the floor: it called
 * damageZombie with zero momentum, so ghosts, goblins and golems survived it and
 * the button silently under-delivered.
 */
export type DamageSource = "steel" | "bounce" | "ranged";

/** What a gate-refused blow says, per family. A refused hit MUST announce
 *  itself — a hit that lands for nothing and says nothing reads as a bug. */
const GATE_REFUSED_TOAST: Partial<Record<EnemyKind, string>> = {
  golem: "🧱 IT SHRUGS OFF STEEL",
  goblin: "🟢 IT BOUNCES OFF STEEL",
  jester: "🤡 THE SPRING THROWS YOU OFF",
};

/**
 * The jester's spring recoil: hurl the knight away from it and tick the bounce
 * combo, exactly as a bumper would.
 *
 * The combo tick matters — without it this is a punishment, and with it the
 * refused swing still FEEDS the ride. That is the difference between a monster
 * that stops you and a monster that redirects you, and redirection is what this
 * game is about.
 */
function springOffJester(z: Zombie): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;
  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const d = Math.hypot(dx, dz);
  // Degenerate only if the knight is exactly on the jester; push it off along
  // its own travel so the launch is never a silent no-op.
  const nx = d > 1e-4 ? dx / d : p.momX || 1;
  const nz = d > 1e-4 ? dz / d : p.momZ || 0;
  p.momX = nx;
  p.momZ = nz;
  p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, JESTER_SPRING_KICK));
  p.bounceCombo += 1;
  p.bounceComboT = comboWindow(p.bounceCombo);
  // i-frames so being thrown does not deliver you straight into the plate that
  // is already in the air.
  p.iframes = Math.max(p.iframes, 0.25);
  state.vfx?.sparks(z.x, 0.7, z.z, nx, nz, 12);
  state.shakeT = Math.max(state.shakeT, 0.16);
}

export function damageZombie(
  z: Zombie,
  damage: number,
  dirx: number,
  dirz: number,
  push: number,
  force = false,
  src: DamageSource = "steel",
): void {
  const g = state.grid;
  if (!g || z.mode === "dead") return;

  // The DEATH DEALER cannot be harmed — steel passes through it with a puff of
  // cold ectoplasm and nothing else. No damage, no knockback, no hitstop
  // reward: the game is telling you to run, not to try harder.
  if (z.kind === "reaper" && !force) {
    state.vfx?.sparks(z.x, 0.6, z.z, dirx, dirz, 6);
    // Live QA hit this thing for a full minute believing it was a broken boss.
    // Silence reads as a bug — say the rule out loud the first time steel
    // passes through it (once per run; resetCombatJuice clears the flag).
    if (!_reaperImmuneShown) {
      _reaperImmuneShown = true;
      showToast("☠ IT CANNOT BE SLAIN", "the Death Dealer only chases — RUN for the stairs");
    }
    return;
  }

  const p = state.player;
  const momentum = p ? p.momSpeed : 0;

  // ── The momentum gates (Wave B — "hit things fast" is a teachable rule) ──
  // GHOST: immune while drifting — it only exists to steel while materialized
  // (winding up its touch, or inside the window after it lands).
  if (!force && z.kind === "ghost" && (z.vulnT ?? 0) <= 0 && z.mode !== "windup") {
    state.vfx?.sparks(z.x, 0.6, z.z, dirx, dirz, 5);
    return;
  }
  // ── GOBLIN / GOLEM: the gate is now a CURVE (DECLONE §6.2) ──
  //
  // Both taught a real rule — rubber shrugs off a standing poke, masonry needs
  // smash-speed — and both then flattened it into a switch: 7.9 u/s did
  // nothing, 8.1 did everything, and 22 did no more than 8.1. `momentumGate`
  // keeps the landmark and removes the cliff, so below the bar you CHIP
  // (GOLEM_GATE_SOFT of your damage at the bar itself) and above it every
  // further unit of speed still pays all the way to terminal.
  //
  // The clink survives at the bottom of the curve, because the teaching moment
  // is what made these two worth having: a hit that lands for nothing has to
  // SAY so, or the rule is invisible.
  // The bar, the softness and WHICH KINDS THIS OWNS all come from
  // MOMENTUM_GATES (entities/enemy-rules.ts), which is the SAME table the
  // bestiary prints from — so what the screen teaches and what the code
  // enforces cannot drift apart. `gatesDamage` used to be a `z.kind === …` list
  // right here, which is a second roster to keep in step by hand.
  const gate = force ? undefined : MOMENTUM_GATES[z.kind];
  if (gate?.gatesDamage) {
    const f = momentum <= gate.minSpeed ? 0 : momentumGate(momentum, gate.bar, gate.soft);
    if (f <= GATE_MIN_FACTOR) {
      const id = z.dbgId || z.nid || z.kind;
      console.log(`[combat:gate] 🟢 ${id} (${z.kind}) bounced attack — requires momentum > ${gate.bar} (momSpeed: ${momentum.toFixed(1)})`);
      state.vfx?.sparks(z.x, 0.5, z.z, dirx, dirz, 4);
      state.shakeT = Math.max(state.shakeT, 0.05);
      if (!_gateHintShown) {
        _gateHintShown = true;
        showToast(GATE_REFUSED_TOAST[z.kind] ?? "🟢 IT BOUNCES OFF STEEL", "hit it at PINBALL SPEED");
      }
      // ── THE JESTER SPRINGS YOU OFF ──
      // Refusing the blow is not enough for this one: the coil on its head is
      // the whole creature, so a swing it catches has to VISIBLY go somewhere.
      // It throws the knight away along the line from monster to player — the
      // goblin's bumper pop (entities/zombie.ts), moved from CONTACT to the
      // refused SWING, because what the jester punishes is committing to melee
      // rather than merely standing close.
      //
      // Only on the refused hit, deliberately. Land it at momentum and you
      // compressed the spring past its travel, so there is nothing left to
      // throw you with — which is the same sentence as the damage rule and is
      // what makes the pair learnable instead of two separate facts.
      if (z.kind === "jester") springOffJester(z);
      sfxHit();
      return;
    }
    damage *= f;
  }
  // CHOMPER: a momentum hit doesn't just hurt it — it SHOVES the plant off its
  // chokepoint, opening the road. Was a flat ×3 the instant you were moving at
  // all; now the shove RIDES the ramp, so a hard arrival clears the chokepoint
  // and a nudge merely rocks it.
  push *= z.kind === "chomper" ? momentumScaled(CHOMPER_SHOVE_MAX, momentum) : 1;

  // ── SUB-TYPE EXCEPTION (DECLONE §6.2) — one rule per zombie flavour ──
  // HM's weapon puzzle in pure data: see `ZombieTypeDef.exception`. All three
  // resolve here, at the single damage funnel, so no exception can be honoured
  // by one damage source and quietly ignored by another.
  const exc = z.ztype ? ZOMBIE_TYPES[z.ztype].exception : undefined;
  if (exc && !force) {
    if (exc === "bounce-immune" && src === "bounce") {
      // The shove still lands — it is immune to the DAMAGE, not to physics, and
      // being punted across the room is the honest feedback for "wrong tool".
      // It RETURNS rather than falling through with damage 0: the rest of the
      // funnel refreshes hitstop and prints a floating "0", and a ram that
      // freezes the sim to tell you it did nothing is a worse bug than the one
      // the exception is worth.
      if (push > 0) {
        const d = Math.hypot(dirx, dirz) || 1;
        const res = moveCircle(g, z.x, z.z, ZOMBIE_R, (dirx / d) * push, (dirz / d) * push);
        z.x = res.x;
        z.z = res.z;
        syncActorMesh(z);
      }
      state.vfx?.sparks(z.x, 0.55, z.z, dirx, dirz, 5);
      z.aggro = true;
      sfxHit();
      return;
    } else if (exc === "dodges-ranged" && src === "ranged") {
      // Entropy, not dice (entities/stagger.ts): a reliable fraction of arrows
      // miss, never an unlucky streak of five.
      if (accrue(z, "dodgeEntropy", DODGE_RANGED_CHANCE)) {
        state.vfx?.sparks(z.x, 0.7, z.z, -dirx, -dirz, 4);
        z.aggro = true;
        return;
      }
    } else if (exc === "speed-only" && momentumT(momentum) < SPEED_ONLY_T && damage >= z.hp) {
      // Wearable down to 1 hp at any pace; the KILLING blow needs the ride.
      damage = Math.max(0, z.hp - 1);
      state.vfx?.sparks(z.x, 0.8, z.z, dirx, dirz, 4);
    }
  }

  // PIN: knockback becomes a SLIDE (integrated by zombie.updatePin, chaining
  // into the crew) rather than an instant shove.
  if (z.kind === "pin" && push > 0) {
    const d = Math.hypot(dirx, dirz) || 1;
    const slide = Math.max(PIN_SLIDE_FROM_HIT * Math.min(1, push), 2.4);
    z.slideVX = (dirx / d) * slide;
    z.slideVZ = (dirz / d) * slide;
    push = 0; // the slide IS the knockback
  }

  // CRYSTALBACK: ramming it at pinball speed shatters a shard-spray back INTO
  // you — a reflector that taxes momentum. It still takes the hit; the shards
  // are the price of the ram. (Weapon hits at walking speed are safe.)
  // The spray SCALES rather than arming at a bar: a graze throws one shard, a
  // full-speed ram throws the whole reflector back at you. Same rule ("momentum
  // is taxed here"), now with something to learn above the old threshold.
  if (z.kind === "crystalback" && p && p.hp > 0 && p.iframes <= 0) {
    const cg = MOMENTUM_GATES.crystalback!;
    const t = momentumGate(momentum, cg.bar, cg.soft);
    const shards = Math.round(CRYSTAL_SHARDS * t);
    if (shards >= 1) {
      hitPlayerRanged(Math.max(1, Math.round(CRYSTAL_SHARD_DMG * t)), z.x, z.z);
      state.vfx?.sparks(p.x, 0.5, p.z, p.x - z.x, p.z - z.z, shards);
    }
  }

  // WARDEN SHIELD: a damage-absorb bubble eats the blow first. A full absorb is
  // a shield-break spark and no HP lost — nothing below this runs.
  if ((z.shieldHp ?? 0) > 0) {
    const absorbed = Math.min(z.shieldHp!, damage);
    z.shieldHp! -= absorbed;
    damage -= absorbed;
    state.vfx?.sparks(z.x, 0.7, z.z, dirx, dirz, 6);
    z.aggro = true;
    if (damage <= 0) {
      z.flashT = FLASH_TIME;
      return;
    }
  }

  // ── CO-OP REPLICA: the floor authority owns this zombie's HP. Our momentum
  // gates already ran above (they're about the ATTACKER), so forward the final
  // damage and keep only the local juice — authoritative hp arrives in the next
  // world snapshot, and a death comes back as a kill act.
  if (coopBridge?.isReplica() && z.nid) {
    coopBridge.forward(z, damage, dirx, dirz, push);
    z.flashT = FLASH_TIME;
    z.sprite.setTint(0xff6a6a);
    state.vfx?.damage(z.x, 1.05, z.z, damage, "out");
    state.vfx?.sparks(z.x, 0.6, z.z, dirx, dirz, 9);
    state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
    state.shakeT = Math.max(state.shakeT, SHAKE_ON_HIT);
    return;
  }

  // Which tool is about to (maybe) finish it, for the bestiary's ram tally.
  // Same trick as `_lastCrit`: killZombie is called from inside this function
  // and from nowhere else that matters, so a module-scope hand-off is honest
  // and avoids threading a source through six call sites that don't care.
  _killSrc = src;
  z.hp -= damage;
  recordDeathTrace(z, "damage", { damage, hp: z.hp, src, momentum });
  z.aggro = true; // hitting a dormant zombie certainly wakes it
  z.flashT = FLASH_TIME;
  z.sprite.setTint(0xff6a6a);

  // FLOATING DAMAGE NUMBER. This is the single funnel every source of harm to a
  // zombie passes through (melee, every projectile, burn ticks, bumpers, pin
  // chains, abilities), so hooking here — rather than at each call site — means
  // no source can land silently.
  //
  // The game has no crit ROLL, but it does have amplified hits: rage and the
  // pinball-synergy multiplier (see playerDamage above) both genuinely multiply
  // the number, so those read as crits rather than inventing a fake stat.
  const crit = _lastCrit;
  _lastCrit = false;
  const amped = crit || (!!p && (p.rageT > 0 || momentum > CARD_PINBALL_SPEED));
  state.vfx?.damage(z.x, 1.05, z.z, damage, amped ? "crit" : "out");

  const ghost = z.kind === "ghost";
  // Impact juice: sparks along the blow, a spray of rot, a beat of hit-freeze
  // and a small camera kick. A GHOST sheds cold ECTOPLASM (blue sparks), not
  // green gore. Kills get the bigger version below.
  state.vfx?.sparks(z.x, 0.6, z.z, dirx, dirz, ghost ? 12 : 9);
  if (!ghost) state.vfx?.blood(z.x, 0.6, z.z, "green", 8);
  state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
  state.shakeT = Math.max(state.shakeT, SHAKE_ON_HIT);

  if (push > 0) {
    const d = Math.hypot(dirx, dirz);
    if (d > 1e-4) {
      if (ghost) {
        // A ghost phases — shove it WITHOUT wall-clamping (it drifts through them).
        z.x += (dirx / d) * push;
        z.z += (dirz / d) * push;
      } else {
        const res = moveCircle(g, z.x, z.z, ZOMBIE_R, (dirx / d) * push, (dirz / d) * push);
        z.x = res.x;
        z.z = res.z;
      }
      syncActorMesh(z);
    }
  }

  // WISP: survives the blow, then short-BLINKS away from you — evasive, hard to
  // pin. Throttled so it can't teleport every tick of a fast weapon.
  if (z.hp > 0 && z.kind === "wisp" && (z.castT ?? 0) <= 0 && p) {
    z.castT = WISP_BLINK_CD;
    let bx = z.x - p.x;
    let bz = z.z - p.z;
    const bd = Math.hypot(bx, bz) || 1;
    bx /= bd;
    bz /= bd;
    // Ghost-style phase: no wall clamp (it drifts through), then a puff at both ends.
    state.vfx?.sparks(z.x, 0.6, z.z, 0, 1, 8);
    z.x += bx * WISP_BLINK_DIST;
    z.z += bz * WISP_BLINK_DIST;
    syncActorMesh(z);
    state.vfx?.sparks(z.x, 0.6, z.z, 0, 1, 8);
  }

  if (z.hp <= 0) {
    killZombie(z);
    return;
  }
  sfxHit();

  // ── IMPACT-SCALED STAGGER (DECLONE §6.1; entities/stagger.ts) ──
  //
  // Doom's pain chance, priced in momentum: this is the dial that turns damage
  // into CROWD CONTROL, and until now the game had none. Fodder at terminal
  // speed staggers on nearly every hit, so a ricochet chain through a pack
  // reads as a chain; a brute barely flinches; a golem and the King never do.
  //
  // Two gates before the accumulator, both deliberate:
  //   · the blow must have a DIRECTION. Burn ticks and fire puddles call this
  //     funnel with (0,0,0) — a damage-over-time that stunlocks is not an
  //     impact mechanic, it is a permanent disable with extra steps.
  //   · it must not already be staggered, or the second hit of a fast weapon
  //     would refresh the window forever off one entropy crossing.
  //
  // NO DICE. `accrue` banks chance × 100 per impact and fires on 100, so the
  // long-run rate is exactly the printed chance with bounded variance and
  // co-op peers agree by construction. `coop-determinism.test.ts` is the gate.
  const impact = Math.hypot(dirx, dirz);
  if (impact > 1e-4 && (z.staggerT ?? 0) <= 0) {
    const base = painBase(z);
    if (base > 0 && accrue(z, "painEntropy", painChance(base, momentum))) {
      z.staggerT = staggerTime(momentum);
      state.vfx?.sparks(z.x, 0.9, z.z, dirx, dirz, 5);
    }
  }
}

/**
 * The break moment in the WORLD, not just the toast: a steel-grey shatter and a
 * dust puff at the owner. Shared by a weapon wearing out and a gear piece dying
 * to the hit it soaked — until now both were sfxBreak + a corner toast, which
 * mid-combat nobody reads.
 */
function breakFx(x: number, z: number): void {
  state.vfx?.burst(x, 0.6, z, 0x9aa4b4, 8, 3);
  state.vfx?.dust(x, 0.15, z);
}

/**
 * One use of the active weapon (a connected swing, or a shot leaving the
 * barrel). Handles the whole break path: the slot empties, and if the OTHER
 * slot still holds something we auto-switch to it — an empty hand with a
 * loaded gun on your belt would just be annoying.
 */
export function wearActiveWeapon(): void {
  const slot = state.weaponSlots[state.activeSlot];
  if (!slot) return; // fists — nothing to wear down

  const def = WEAPONS[slot.id];
  const worn = degradeWeapon(slot);
  if (!worn.broke) {
    state.weaponSlots[state.activeSlot] = worn.weapon;
    state.hudDirty = true;
    return;
  }

  state.weaponSlots[state.activeSlot] = null;
  sfxBreak();
  if (state.player) breakFx(state.player.x, state.player.z);
  const spent = def.kind === "ranged" ? "out of ammo" : "broke";
  const other = 1 - state.activeSlot;
  if (state.weaponSlots[other]) {
    state.activeSlot = other;
    showToast(`${def.icon} ${def.label.toUpperCase()} ${spent.toUpperCase()}`, `switched to ${WEAPONS[state.weaponSlots[other]!.id].label.toLowerCase()}`);
  } else {
    showToast(`${def.icon} ${def.label.toUpperCase()} ${spent.toUpperCase()}`, "fists it is");
  }
  state.hudDirty = true;
}

/**
 * How a specific melee MOVE scales the equipped weapon on connect. A plain light
 * swing passes 1× everything; a heavy or combo finisher widens the arc, extends
 * reach, hits harder and shoves further. Defaults keep the old single-swing
 * behaviour for any caller that doesn't pass one.
 */
export interface MeleeScale {
  damageMul: number;
  arcMul: number;
  rangeMul: number;
  knockbackMul: number;
  /** Extra hit-freeze over the base HITSTOP_HIT — heavies freeze longer (feel dial). */
  hitstopMul?: number;
}
const UNIT_MELEE: MeleeScale = { damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1 };

/**
 * The player's melee swing lands, with whatever is in hand: range, arc and
 * damage come from the equipped weapon SCALED by the current move (light /
 * combo finisher / heavy). A swing that CONNECTS costs a point of durability.
 * Weapons break on use — the swing that breaks the chair still hits with it.
 *
 * arcMul WIDENS the arc: since the gate is `dot >= arcCos`, a wider arc means a
 * SMALLER cosine threshold, so we lerp arcCos toward -1 (full circle) by arcMul.
 */
export function resolvePlayerAttack(scale: MeleeScale = UNIT_MELEE, onHit?: (z: Zombie) => void): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return false;

  const w = WEAPONS[activeWeapon().id];
  const [fx, fz] = FACING_VEC[p.facing];
  const range = w.range * scale.rangeMul;
  // Widen the arc for heavy/finisher: pull the cosine gate toward -1.
  const arcCos = w.arcCos - (w.arcCos - -1) * Math.min(1, Math.max(0, scale.arcMul - 1));
  let landed = false;

  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    // At point-blank range the arc test divides by ~0 — inside the bodies'
    // combined radius it's a hit no matter the angle.
    if (d > PLAYER_R + ZOMBIE_R) {
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < arcCos) continue;
    }

    landed = true;
    // Knockback along the swing, wall-aware. Heavier weapons + heavier moves shove harder.
    const dmg = playerDamage(w.damage * scale.damageMul);
    // The weapon's own shove multiplier rides on top of the move's (the chair
    // is a crowd-shover, not a damage dealer — that IS its identity).
    const push = KNOCKBACK_ZOMBIE * (1 + (dmg - 1) * 0.35) * scale.knockbackMul * (w.knockbackMult ?? 1);
    damageZombie(z, dmg, d > 1e-4 ? dx : fx, d > 1e-4 ? dz : fz, push);
    applyCardOnHit(z);
    onHit?.(z); // per-victim presentation hook (katana finisher cut-through ghosts)
  }

  if (landed) {
    wearActiveWeapon();
    // The move's own freeze on top of damageZombie's base beat — a heavy or a
    // wall special CRUNCHES where a light taps (per-attack hitstop dial).
    state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT * (scale.hitstopMul ?? 1));
  }

  return landed;
}

/**
 * Callback for a shattered BRICK GOLEM — core spawns the ricocheting shard
 * spray (it owns projectiles' scene access). Same handler pattern as the
 * slime split, same reason (no circular import).
 */
let onGolemShatter: ((x: number, z: number) => void) | null = null;
export function setGolemShatterHandler(fn: (x: number, z: number) => void): void {
  onGolemShatter = fn;
}

/** BLOATER death → a fire puddle (core owns floor-fx to avoid a circular import). */
let onBloaterBurst: ((x: number, z: number) => void) | null = null;
export function setBloaterBurstHandler(fn: (x: number, z: number) => void): void {
  onBloaterBurst = fn;
}

/** SPORELING death → a toxic spore cloud (OPEN_WORK 2.1). */
let onSporelingBurst: ((x: number, z: number) => void) | null = null;
export function setSporelingBurstHandler(fn: (x: number, z: number) => void): void {
  onSporelingBurst = fn;
}

/**
 * Card-drop roll on a kill — core owns the spawn (scene access + rng).
 *
 * `kind` reached this signature for the AFFINITY roll (cards.ts): a card dropped
 * by a Ghost should be a Ghost's card. `dropMult` carries the zombie SUB-TYPE's
 * loot weight so a 9-HP hulk does not pay a 2-HP midget's wage.
 */
let onCardRoll: ((x: number, z: number, boss: boolean, kind: EnemyKind, dropMult: number, subType?: ZombieType) => void) | null = null;
export function setCardRollHandler(fn: (x: number, z: number, boss: boolean, kind: EnemyKind, dropMult: number, subType?: ZombieType) => void): void {
  onCardRoll = fn;
}

let onCoinDrop: ((x: number, z: number, value: number) => void) | null = null;
export function setCoinDropHandler(fn: (x: number, z: number, value: number) => void): void {
  onCoinDrop = fn;
}

/** Reagent-drop roll on a kill — core owns the spawn (scene access + rng). */
let onReagentDrop: ((x: number, z: number, kind: EnemyKind, boss: boolean, dropMult: number) => void) | null = null;
export function setReagentDropHandler(fn: (x: number, z: number, kind: EnemyKind, boss: boolean, dropMult: number) => void): void {
  onReagentDrop = fn;
}

/**
 * Record a kill for the BESTIARY. Two keys per zombie — the family ("zombie") and
 * the sub-type ("zombie:hulk") — because the bestiary reveals a sub-type's row
 * only once you have actually met one, so the screen teaches through play rather
 * than handing over the whole table up front.
 */
function tallyKill(z: Zombie): void {
  const bump = (k: string): number => {
    const n = (state.killsByKind[k] ?? 0) + 1;
    state.killsByKind[k] = n;
    return n;
  };
  bump(z.kind);
  // ── A BOSS IS CREDITED AS ITSELF ──
  //
  // Every boss is a `brute` under the hood (it reuses the enemy pipeline), so
  // this used to record a brute kill and nothing else: four distinct guardians
  // all counted as the same mob, and the tally could not tell you which ones
  // you had actually beaten. Namespaced like the zombie sub-types next door,
  // for the same reasons the comment below gives.
  if (z.bossKind) bump(`boss:${z.bossKind}`);
  // ── HOW you killed it, not just how many (DECLONE §6.5) ──
  // Namespaced into the SAME record rather than two new state fields, and that
  // is deliberate: `killsByKind` is already reset in every place a run resets,
  // already serialized wherever the tally is, and already keyed by string
  // ("zombie:hulk"). Two parallel records would be two more things to remember
  // to clear, and forgetting one is how a stat starts lying between runs. The
  // "#" separator cannot collide with the ":" the sub-type keys use.
  if (_killSrc === "bounce") state.killsByKind[`${z.kind}#ram`] = (state.killsByKind[`${z.kind}#ram`] ?? 0) + 1;
  const combo = state.player?.bounceCombo ?? 0;
  const bestKey = `${z.kind}#combo`;
  if (combo > (state.killsByKind[bestKey] ?? 0)) state.killsByKind[bestKey] = combo;
  if (!z.ztype) return;
  const n = bump(`${z.kind}:${z.ztype}`);
  // FIRST of a sub-type this run: name it. Eight zombie flavours the player
  // cannot name are eight zombies; a one-line callout on the first kill is what
  // makes the roster legible, and it fires once rather than on every hit — a tag
  // on each blow would be noise in a horde and would teach nothing after the
  // first one. The bestiary tab carries the detail from there.
  if (n === 1) {
    const d = ZOMBIE_TYPES[z.ztype];
    showToast(`🧟 ${d.label.toUpperCase()} SLAIN`, "a new kind of dead — see the BESTIARY");
  }
}

export function killZombie(z: Zombie): void {
  if (z.mode === "dead" || (z.anim as any).isDying?.() || (z.anim as any).isDead?.()) return;
  z.deathFacing = z.anim.getFacing();
  z.mode = "dead";
  z.corpseT = 0;
  z.staggerT = 0;
  z.windupT = 0;
  z.flashT = 0;
  z.sprite.setTint(z.baseTint ?? null);
  z.sprite.setBlobVisible(false); // Hide standing contact shadow so corpse lies flat on floor
  if (typeof (z.anim as any).triggerDeath === "function") {
    (z.anim as any).triggerDeath(z.deathFacing);
  } else {
    z.anim.play("death");
  }
  const id = z.dbgId || z.nid || z.kind;
  const indices = (z.anim as any)?.debugIndices?.() ?? [];
  console.log(`[death:start] 💀 ${id} (${z.kind}) killed | facing: ${z.deathFacing} | death cels: [${indices.join(", ")}]`);
  recordDeathTrace(z, "kill", { facing: z.deathFacing });
  coopBridge?.onKill(z); // co-op: authority tells the floor (no-op solo/replica)
  // A big slime splits into two fast minis (minis never split again).
  if (z.kind === "slime" && !z.mini) onSlimeSplit?.(z.x, z.z, z.speed);
  // A BLOATER bursts into a burning puddle — don't melee-kill it at your feet.
  if (z.kind === "bloater") onBloaterBurst?.(z.x, z.z);
  // A brick golem SHATTERS — the masonry becomes a spray of ricochet shards.
  if (z.kind === "golem") onGolemShatter?.(z.x, z.z);
  // A SPORELING bursts into a toxic spore cloud when it dies (OPEN_WORK 2.1).
  if (z.kind === "sporeling") onSporelingBurst?.(z.x, z.z);
  // Bowling ledger: pins downed close together are one STRIKE.
  if (z.kind === "pin") {
    _pinKills += 1;
    _pinKillT = PIN_STRIKE_WINDOW;
    if (_pinKills >= PIN_STRIKE_COUNT && !_strikePaid) {
      _strikePaid = true;
      state.goldRun += PIN_STRIKE_GOLD;
      addGold(PIN_STRIKE_GOLD, "dungeon-game");
      showToast("🎳 STRIKE!", `${_pinKills} pins down · +${PIN_STRIKE_GOLD}g`);
      state.shakeT = Math.max(state.shakeT, 0.2);
    }
  }
  // A death pops a bigger burst, a longer freeze and a heavier kick. A GHOST
  // dissipates into a cold ectoplasm puff (a spray of blue sparks) — no gore.
  if (z.kind === "ghost") {
    state.vfx?.sparks(z.x, 0.6, z.z, 0, 0, 22);
  } else {
    state.vfx?.blood(z.x, 0.6, z.z, "green", 20);
    state.vfx?.sparks(z.x, 0.6, z.z, 0, 0, 6);
  }
  // In first person you're right on top of the kill — double the gore with a
  // second red splatter so a frag reads as a proper Doom-style gib.
  if (state.fpsActive) {
    state.vfx?.blood(z.x, 0.7, z.z, "red", 16);
    state.vfx?.sparks(z.x, 0.7, z.z, 0, 0, 8);
  }
  // Killing a boss (the Reaper King) is the milestone: a huge gore blast, a
  // bonus gold windfall and a guaranteed health-potion drop right where it fell.
  if (z.boss) {
    state.vfx?.blood(z.x, 0.9, z.z, "red", 40);
    state.vfx?.blood(z.x, 0.6, z.z, "green", 40);
    state.vfx?.sparks(z.x, 0.9, z.z, 0, 0, 24);
    state.shakeT = Math.max(state.shakeT, 0.6);
    onBossDefeated?.(z.x, z.z);
  }
  state.hitstopT = Math.max(state.hitstopT, z.boss ? HITSTOP_KILL * 2.5 : HITSTOP_KILL);
  state.shakeT = Math.max(state.shakeT, SHAKE_ON_KILL);
  state.kills++;
  awardKillXp(!!z.boss); // character XP — the skill tree's fuel
  // ── BESTIARY tally (bestiary.ts) ── keyed by kind, and by `zombie:<ztype>` so
  // the sub-types reveal individually. Same funnel as the drops on purpose.
  tallyKill(z);
  // A zombie SUB-TYPE weights its own loot: a hulk is worth more than a midget.
  const dropMult = z.ztype ? typeDropMult(z.ztype) : 1;
  onCardRoll?.(z.x, z.z, !!z.boss, z.kind, dropMult, z.ztype); // roll a modifier-card drop
  onReagentDrop?.(z.x, z.z, z.kind, !!z.boss, dropMult); // roll themed alchemy reagents
  // Every kill DROPS coins on the floor (magnet-collected) rather than silently
  // crediting the purse — a visible payout. Falls back to an instant credit if
  // no drop handler is wired (e.g. a headless test harness). Greed Draught
  // doubles the payout while it's active.
  const greedMul = state.player && state.player.greedT > 0 ? GREED_GOLD_MULT : 1;
  // A tougher zombie sub-type pays proportionally more (capped at 2x inside
  // typeDropMult) — otherwise the fastest gold in the game is farming midgets.
  const killGold = Math.max(1, Math.round(GOLD_PER_KILL * greedMul * dropMult));
  if (onCoinDrop) {
    onCoinDrop(z.x, z.z, killGold);
  } else {
    state.goldRun += killGold;
    addGold(killGold, "dungeon-game");
  }
  // Greed Draught doubling was invisible: the payout is bigger but a 4-coin pop
  // and a 2-coin pop read the same at speed. The flask-coloured flare marks
  // every kill the brew is inflating.
  if (greedMul > 1) state.vfx?.burst(z.x, 0.5, z.z, POTIONS.greed.color, 8, 3);
  // STYLE KILL: a kill carried by pinball momentum (a ball ram, or any hit
  // landed mid-ride) pays bonus gold that scales with the live bounce combo —
  // the machine rewards playing like a ball, not walking up and stabbing.
  const p = state.player;
  if (p && p.momSpeed > 0) {
    // Part 6 — TIERED jackpot gold: +3g per DOUBLING of the combo (2/5/8/11/…),
    // logarithmic so a 64× chain pays 10× a 1× kill without ever breaking the
    // economy, and — unlike the old flat +1/step capped at 12 — mastery always
    // reads as progress. `bonus` is floored so it stays whole coins.
    const bonus = Math.floor(comboKillGold(p.bounceCombo) * greedMul);
    // Routed through the coin drop too: a style kill is a bigger physical payout
    // at the same corpse, so it should visibly drop MORE coins than a plain kill
    // rather than silently bumping a counter next to a 2-coin pop.
    if (onCoinDrop) {
      onCoinDrop(z.x, z.z, bonus);
    } else {
      state.goldRun += bonus;
      addGold(bonus, "dungeon-game");
    }
    showPickupNote(`💥 STYLE KILL +${bonus}g${p.bounceCombo >= 3 ? ` · combo ×${p.bounceCombo}` : ""}`);
    // ── A KILL SUSTAINS THE CHAIN ──
    // Kills used to have no relationship with the bounce combo at all: the
    // window ran on bounces alone, so wading into a pack and killing four
    // things — the most productive play available — DROPPED a chain you had
    // earned, purely because swinging isn't bouncing. Hotline Miami shipped
    // exactly this regression in HM2 (it stopped letting non-kill actions hold
    // the timer) and it is the one change its players complained about.
    //
    // Inverted for a game whose verb is bouncing, not killing: bounces still
    // GROW the count, and a kill landed with momentum REFRESHES the window. It
    // cannot start a chain from nothing and it cannot inflate one — it just
    // means combat no longer punishes you for being good at it.
    if (p.bounceCombo > 0) p.bounceComboT = Math.max(p.bounceComboT, comboWindow(p.bounceCombo));
  }
  if (state.fpsActive) {
    // Rampage kills build a streak (reset by a lull, tracked in fps.ts) and
    // punch the camera + extend the rampage a hair, so a hot streak feels like
    // a rolling wrecking-ball. No ult-charge (can't refuel itself).
    state.fpsStreak++;
    state.fpsStreakT = 0;
    state.fpsKick = Math.min(0.12, state.fpsKick + 0.05);
    state.fpsTimer += 0.4; // small reward: a good streak lasts a touch longer
    state.shakeT = Math.max(state.shakeT, 0.18);
    state.hitstopT = Math.max(state.hitstopT, 0.03); // a crisp micro-freeze per frag
    updateFpsStreak();
  } else {
    // Charge the rampage ultimate from ordinary kills only.
    state.ultCharge = Math.min(1, state.ultCharge + ULT_CHARGE_PER_KILL);
    // A small mana top-up too (see abilities.ts), so the Q/E skills stay in
    // rotation. Inlined rather than imported to keep combat ↔ abilities acyclic.
    // Clamps to playerManaMax() so Mana Well ranks actually enlarge the pool.
    if (p) p.mana = Math.min(playerManaMax(), p.mana + MANA_PER_KILL);
  }
  state.hudDirty = true;
  sfxZombieDie();
}

/**
 * Bite damage per enemy family — the ONE source of truth, and EXHAUSTIVE by
 * type so a new EnemyKind is a compile error here rather than silently
 * inheriting a zombie's bite.
 *
 * It used to be a `Partial<>` listing five kinds with an `?? ZOMBIE_DAMAGE`
 * fallback, which left BAT_/SLIME_/SPIDER_/GHOST_DAMAGE declared in constants.ts
 * but wired to nothing — they happened to equal ZOMBIE_DAMAGE, so the numbers
 * were right by coincidence and re-tuning any of them would have done nothing.
 *
 * A brute's haymaker hits harder and shoves you further than a normal bite; the
 * reaper's touch is worse — two hearts and a brute-class shove. Kinds listed as
 * ZOMBIE_DAMAGE bite for a plain hit by design (the spitter's SPITTER_DAMAGE is
 * carried by its projectile, not its bite — see entities/projectiles.ts).
 *
 * Hoisted to module scope: it was being reallocated on every single player hit.
 */
const DMG_BY_KIND: Record<EnemyKind, number> = {
  zombie: ZOMBIE_DAMAGE,
  spider: SPIDER_DAMAGE,
  brute: BRUTE_DAMAGE,
  spitter: ZOMBIE_DAMAGE,
  ghost: GHOST_DAMAGE,
  bat: BAT_DAMAGE,
  slime: SLIME_DAMAGE,
  reaper: REAPER_DAMAGE,
  goblin: ZOMBIE_DAMAGE,
  pin: ZOMBIE_DAMAGE,
  golem: GOLEM_DAMAGE,
  chomper: CHOMPER_DAMAGE,
  magnet: MAGNET_DAMAGE,
  webspinner: ZOMBIE_DAMAGE,
  sporeling: ZOMBIE_DAMAGE,
  // Melee fallback only — the plate carries JESTER_DISC_DAMAGE itself.
  jester: JESTER_DISC_DAMAGE,
  // Melee fallback only — the beams carry CROAKER_BEAM_DAMAGE themselves.
  croaker: CROAKER_BEAM_DAMAGE,
  // Melee fallback only — the timber carries ROTORTAIL_TIMBER_DAMAGE itself.
  rotortail: ROTORTAIL_TIMBER_DAMAGE,
  // Melee fallback only — the bomb's blast carries STILTNECK_BLAST_DAMAGE.
  stiltneck: STILTNECK_BLAST_DAMAGE,
  // "heavy kick strikes", per its bestiary line — it had ZOMBIE_DAMAGE.
  fish_feet: FISH_FEET_DAMAGE,
  // ── Expansion roster ──
  hound: SPIDER_DAMAGE,
  bloater: ZOMBIE_DAMAGE,
  necromancer: ZOMBIE_DAMAGE,
  warden: BRUTE_DAMAGE,
  wisp: GHOST_DAMAGE,
  sapper: SPIDER_DAMAGE,
  crystalback: GOLEM_DAMAGE,
  mimic: BRUTE_DAMAGE,
};

/**
 * A zombie's bite connects. Damage routes through the armor (helmet first,
 * then chest) before touching hearts; absorbing costs those pieces
 * durability, and a piece worn to nothing is destroyed.
 */
export function hitPlayer(z: Zombie): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;
  if (state.godMode) return; // debug god mode: untouchable
  if (p.iframes > 0 || p.shieldT > 0) return; // shield potion = untouchable

  const raw = DMG_BY_KIND[z.kind];
  // Stoneskin halves the bite before the armor even sees it (ceil so a 1-dmg
  // nip still stings for 1 — a floor of "0" would read as full immunity).
  const damage = p.stoneT > 0 ? Math.ceil(raw * STONESKIN_DAMAGE_MULT) : raw;
  // Stoneskin's save happens at the exact moment it saves — grit off the hide,
  // or halving damage is indistinguishable from the monster rolling low.
  if (p.stoneT > 0) {
    state.vfx?.burst(p.x, 0.55, p.z, POTIONS.stoneskin.color, 5, 2.2);
    state.vfx?.dust(p.x, 0.15, p.z);
  }
  const heavyHitter = z.kind === "brute" || z.kind === "reaper" || z.kind === "golem" || z.kind === "chomper";
  // A HULK sub-type hits like the heavies it is the size of — reusing the shove
  // the brute already uses rather than inventing a second knockback path.
  const hulkPush = z.ztype ? ZOMBIE_TYPES[z.ztype].knockback : undefined;
  const knockback = hulkPush ?? (heavyHitter ? BRUTE_KNOCKBACK : KNOCKBACK_PLAYER);
  // A ghost that just landed its touch stays MATERIALIZED — the punish window.
  if (z.kind === "ghost") z.vulnT = GHOST_VULN_TIME;

  const absorbed = absorbDamage(state.gear, damage);
  state.gear = absorbed.gear;
  for (const slot of absorbed.destroyed) {
    showToast(`${GEAR[slot].icon} ${GEAR[slot].label.toUpperCase()} DESTROYED`);
    sfxBreak();
    breakFx(p.x, p.z);
  }
  p.hp -= absorbed.hpDamage;

  // FLAWLESS-FLOOR tally. Counted on the CONTACT, not on `hpDamage`, so armour
  // soaking the bite still breaks the streak — the reward is for not being
  // touched, and letting a helmet launder a hit would make it a gear check.
  state.levelHitsTaken += 1;
  p.iframes = PLAYER_IFRAMES;
  p.flashT = FLASH_TIME;
  p.sprite.setTint(0xff5555);
  if (absorbed.hpDamage > 0) {
    state.vfx?.blood(p.x, 0.6, p.z, "red", 10);
    // Damage TAKEN reads red. Only what actually reached hearts is shown — a
    // bite the armor ate whole is a 0, and a floating 0 reads as a miss.
    state.vfx?.damage(p.x, 1.15, p.z, absorbed.hpDamage, "in");
  }
  state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
  state.shakeT = absorbed.hpDamage > 0 ? 0.25 : 0.12; // armor soaks the flinch too
  state.hudDirty = true;
  sfxHurt();
  faceOnDamage(Math.atan2(z.z - p.z, z.x - p.x)); // wince + glance toward the biter

  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const d = Math.hypot(dx, dz) || 1;
  const res = moveCircle(g, p.x, p.z, PLAYER_R, (dx / d) * knockback, (dz / d) * knockback);
  p.x = res.x;
  p.z = res.z;
  syncActorMesh(p);
  if (z.kind === "brute") state.shakeT = Math.max(state.shakeT, 0.35); // heavy slam
  // SAPPER: the bite DRAINS your active marble material — a hard counter that
  // makes a material a resource to protect, not just spend.
  // 💎 DIAMOND CANNOT BE BROKEN — including by the one enemy built to break
  // marbles. Every other material is fair game, which is what makes diamond's
  // immunity a reason to pick it rather than a line of flavour text.
  if (z.kind === "sapper" && p.material && p.materialT > 0 && !materialResistsDrain()) {
    p.material = null;
    p.materialT = 0;
    p.fuseMaterial = null;
    p.fuseT = 0;
    state.hudDirty = true;
    state.vfx?.sparks(p.x, 0.7, p.z, 0, 1, 12);
    showToast("⚡ MATERIAL DRAINED", "the sapper stole your marble");
  } else if (z.kind === "sapper" && materialResistsDrain()) {
    // The bite lands and FAILS — say so, or an immunity is indistinguishable
    // from the sapper's drain simply not having fired.
    state.vfx?.sparks(p.x, 0.7, p.z, 0, 1, 8);
    showToast("💎 UNBREAKABLE", "the sapper cannot cut diamond");
  }

  // CHOMPER: Giant Venus flytrap bite GRABS and HOLDS the player until spammed free!
  if (z.kind === "chomper" && (p.chomperGrabT ?? 0) <= 0) {
    p.chomperGrabT = 4.0;
    p.chomperGrabEscape = 5;
    p.chomperGrabHost = z;
    showToast("🪴 GRABBED BY CHOMPER!", "SPAM buttons to break free!");
  }
}

/**
 * A hostile projectile (the spitter's acid glob) lands on the player. Same
 * armor/i-frame/flash funnel as a bite, but no knockback source — just a
 * damage number and the impact point for the flinch direction.
 */
export function hitPlayerRanged(damage: number, srcX: number, srcZ: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0 || state.godMode || p.iframes > 0 || p.shieldT > 0) return; // godMode/shield: untouchable

  const dmg = p.stoneT > 0 ? Math.ceil(damage * STONESKIN_DAMAGE_MULT) : damage; // Stoneskin
  if (p.stoneT > 0) {
    state.vfx?.burst(p.x, 0.55, p.z, POTIONS.stoneskin.color, 5, 2.2); // grit — see hitPlayer
    state.vfx?.dust(p.x, 0.15, p.z);
  }
  const absorbed = absorbDamage(state.gear, dmg);
  state.gear = absorbed.gear;
  for (const slot of absorbed.destroyed) {
    showToast(`${GEAR[slot].icon} ${GEAR[slot].label.toUpperCase()} DESTROYED`);
    sfxBreak();
    breakFx(p.x, p.z);
  }
  p.hp -= absorbed.hpDamage;
  state.levelHitsTaken += 1; // flawless-floor tally (see hitPlayer)
  p.iframes = PLAYER_IFRAMES;
  p.flashT = FLASH_TIME;
  p.sprite.setTint(0x8fc46b); // acid-green flash, not the usual red bite
  if (absorbed.hpDamage > 0) {
    state.vfx?.blood(p.x, 0.6, p.z, "green", 8);
    state.vfx?.damage(p.x, 1.15, p.z, absorbed.hpDamage, "in");
  }
  state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
  state.shakeT = Math.max(state.shakeT, absorbed.hpDamage > 0 ? 0.2 : 0.1);
  state.hudDirty = true;
  sfxHurt();
  faceOnDamage(Math.atan2(srcZ - p.z, srcX - p.x)); // glance toward the glob's origin

  // A small shove away from where the glob came from.
  const dx = p.x - srcX;
  const dz = p.z - srcZ;
  const d = Math.hypot(dx, dz) || 1;
  const res = moveCircle(g, p.x, p.z, PLAYER_R, (dx / d) * (KNOCKBACK_PLAYER * 0.5), (dz / d) * (KNOCKBACK_PLAYER * 0.5));
  p.x = res.x;
  p.z = res.z;
  syncActorMesh(p);
}

/**
 * The WEB SPINNER's silk lands: no damage, a hard slow. Any pinball-part
 * touch shakes it off early (see player.onPartTrigger).
 */
export function webPlayer(): void {
  const p = state.player;
  if (!p || p.hp <= 0 || p.shieldT > 0) return;
  p.webbedT = WEB_TIME;
  p.sprite.setTint(0xdfe7f2);
  p.flashT = 0.2;
  showToast("🕸️ WEBBED", "slowed — touch any pinball part to shake it off");
  state.hudDirty = true;
}

/** Tick a hit flash back toward untinted. Shared by player and zombies. */
export function updateFlash(a: { flashT: number; sprite: { setTint(hex: number | null): void }; baseTint?: number | null }, dt: number): void {
  if (a.flashT <= 0) return;
  a.flashT -= dt;
  // Reskinned kinds (reaper, golem, goblin…) rest at a base tint, not white.
  if (a.flashT <= 0) a.sprite.setTint(a.baseTint ?? null);
}
