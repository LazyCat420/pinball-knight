/**
 * PINBALL PART COLLISION — what happens when the knight touches a part.
 *
 * Split out of entities/player.ts, where this lived as a 300-line if/else chain.
 * The chain's final `else` was a CATCH-ALL that applied deflector physics to any
 * kind without a branch of its own — which silently mis-handled `glove` (a
 * self-firing hazard owned by entities/hazards.ts) by overwriting the launch
 * hazards.ts had just applied with a zero heading, since a glove is placed with
 * dir2 = (0,0). Dispatch is now an EXHAUSTIVE `Record<PinballPartKind, …>`, so
 * a new part kind is a compile error here until it is handled — no catch-all,
 * no silent fallback.
 *
 * Called from updatePinball (momentum live) AND from the normal movement path
 * (walking) — every part can START a momentum ride, which is what makes the maze
 * read as a machine: step on a spring or graze a bumper and you're flying, no
 * overcharge required.
 *
 * Part cooldowns/hit animations are ticked by the parts renderer (one owner);
 * this only consumes ready parts and stamps cooldownT/hitT.
 */
import { PART_TOUCH_BROAD_SQ } from "../constants";
import { state, type Player, type PinballPart, type PinballPartKind } from "../state";
import { canMawSwallow, MAW_COOLDOWN } from "./maw";
import {
  PLAYER_R,
  PINBALL_MAX_SPEED,
  BUMPER_RADIUS,
  BUMPER_KICK_MULT,
  BUMPER_KICK_ADD,
  BUMPER_LIT_HITS,
  BUMPER_KICK_LIT,
  BUMPER_LIT_GOLD,
  JACKPOT_BUMPERS,
  JACKPOT_GOLD,
  JACKPOT_DAMAGE,
  BUMPER_MIN_EXIT,
  BUMPER_COOLDOWN,
  BUMPER_SCATTER,
  SPRING_SPEED,
  SPRING_COOLDOWN,
  RAMP_SPEED,
  RAMP_COOLDOWN,
  RAMP_STEER_LOCK,
  BOOSTER_SPEED,
  BOOSTER_RADIUS,
  BOOSTER_COOLDOWN,
  BOOSTER_STEER_LOCK,
  BOOSTER_JAM_HITS,
  BOOSTER_JAM_RADIUS,
  BOOSTER_JAM_WINDOW,
  BOOSTER_JAM_COOLDOWN,
  CORNER_BOOST_RADIUS,
  CORNER_BOOST_SPEED,
  CORNER_BOOST_COOLDOWN,
  CORNER_BOOST_STEER_LOCK,
  CORNER_BOOST_MIN_ENTRY,
  CURVE_BOOST_RADIUS,
  CURVE_BOOST_SPEED,
  CURVE_BOOST_COOLDOWN,
  CURVE_BOOST_STEER_LOCK,
  JUMP_PAD_RADIUS,
  JUMP_PAD_SPEED,
  JUMP_PAD_COOLDOWN,
  JUMP_PAD_STEER_LOCK,
  DEFLECTOR_GRAB_TIME,
  DEFLECTOR_THROW_SPEED,
  DEFLECTOR_THROW_BOOST,
  DEFLECTOR_COOLDOWN,
  OIL_RADIUS,
  OIL_LAUNCH_SPEED,
  OIL_LAUNCH_MULT,
  OIL_SLICK_TIME,
  OIL_COOLDOWN,
  SPINPAD_SPEED,
  SPINPAD_COOLDOWN,
  spinPadPhase,
  SLING_SPEED_MULT,
  SLING_ADD,
  SLING_MIN_EXIT,
  SLING_COOLDOWN,
  TARGET_HIT_SPEED,
  TARGET_RADIUS,
  TARGET_GOLD,
  TARGET_CLEAR_GOLD,
  BANK_CLEAR_GOLD,
  TRAPDOOR_COOLDOWN,
  ROLLOVER_RADIUS,
  ROLLOVER_COOLDOWN,
  FRENZY_PART_HITS,
  FRENZY_GOLD,
  FLIPPER_SPEED,
  FLIPPER_COOLDOWN,
  FLIPPER_RADIUS,
  MIRROR_RADIUS,
  MIRROR_COOLDOWN,
  MIRROR_BOOST,
  MAGSTRIP_RADIUS,
  MAGSTRIP_SPEED_CAP,
  MAGBOOTS_STRIP_LAUNCH,
  MAGSTRIP_BOOTS_COOLDOWN,
  WATER_STEAM_COOLDOWN,
  PIT_RADIUS,
  GRAVEPIT_RADIUS,
  PIT_CLIMB_COOLDOWN,
  PIT_GOLD_PENALTY,
  PIT_DAMAGE,
} from "../constants";
import { comboWindow } from "./combo-curve";
import { moveCircle } from "../engine/collision";
import { addGold, spendGold } from "../../../utils/gold-wallet";
import { showPickupNote, showToast } from "../ui";
import { PALETTE_HEX } from "../render/palette";
import { recordShot, hitOrbitRail, hitRollover, trySkillShot } from "../shots";
import { lightLamp } from "../lamp-puzzle";
import { screenDirToWorld } from "../engine/camera";
import { syncActorMesh, damageZombie } from "./combat";
import { materialBumperMult, materialBumperScatterMult, tryWaterSteam, stoneMagstripCap, stoneIgnoresOil, stoneBridgesPit, lavaVaporizesOil } from "./marble";
import { requestShake, requestHitstop } from "../engine/juice";
import { sfxRoll, sfxBumper, sfxSpring, sfxSpin, sfxTarget, sfxHurt, sfxHeavy } from "../sfx";

/**
 * The player-owned behaviours a part can trigger. Passed in rather than imported
 * so this module does not cycle back into entities/player.ts — and so tests can
 * drive a part hit with stubs instead of the whole player module.
 */
export interface PinballDeps {
  /** Launch the airborne ramp arc (bypasses wall collision mid-flight). */
  startRampHop(dirX: number, dirZ: number, speed: number): void;
  /** Open the hatch and hand off to the rollercoaster ride. */
  startDrop(x: number, z: number): void;
  /** Set the post-dash no-steer window to exactly `t` (the ramp's dash panel). */
  setSteerLock(t: number): void;
  /** Extend the no-steer window to at least `t`, never shortening it (boosters). */
  raiseSteerLock(t: number): void;
}

/** Everything a handler needs about one player↔part contact. */
export interface PartContact {
  part: PinballPart;
  p: Player;
  /** Player position minus part position. */
  dx: number;
  dz: number;
  /** Squared distance — handlers own their own radius test. */
  d2: number;
  /** True when called from the momentum ride, false from the walking path. */
  inMomentum: boolean;
  /** Smoothed walking speed (u/s); the oil slick converts it into a launch. */
  curSpeed: number;
  deps: PinballDeps;
}

/**
 * A handler consumes one contact. Return "stop" to abandon the rest of the
 * sweep for this frame — only the pit does this, because falling in relocates
 * the player and every later part's distance test would be stale.
 */
type PartHandler = (c: PartContact) => "stop" | void;

/**
 * Bookkeeping every PART trigger shares: tick the bounce combo, shake a web
 * off (parts are the webspinner's cleanse), count part-hits toward the
 * FRENZY bonus and pay it once per combo.
 *
 * Exported because three non-contact events in entities/player.ts also count as
 * links in a chain: banking an arc corner, exiting the trapdoor ride, and
 * setting down from a ramp hop.
 */
export function onPartTrigger(): void {
  const p = state.player;
  if (!p) return;
  p.bounceCombo += 1;
  p.bounceComboT = comboWindow(p.bounceCombo);
  if (p.webbedT > 0) {
    p.webbedT = 0;
    showPickupNote("🕸️ web SHAKEN OFF");
  }
  state.partComboHits += 1;
  if (!state.frenzyPaid && state.partComboHits >= FRENZY_PART_HITS) {
    state.frenzyPaid = true;
    state.goldRun += FRENZY_GOLD;
    addGold(FRENZY_GOLD, "dungeon-game");
    showToast("🪩 FRENZY", `${state.partComboHits} parts in one chain · +${FRENZY_GOLD}g`);
    requestShake(0.25);
  }
}

/**
 * JACKPOT (Slice 5) — enough bumpers lit: a floor-wide burst of gold + damage +
 * a flash, then every bumper resets so the light-em-up loop can run again.
 */
function fireJackpot(): void {
  const p = state.player;
  state.goldRun += JACKPOT_GOLD;
  addGold(JACKPOT_GOLD, "dungeon-game");
  showToast("🪩 JACKPOT!", `bumpers lit · +${JACKPOT_GOLD}g`);
  requestShake(0.4);
  state.jackpotT = 3;
  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const dx = z.x - (p?.x ?? z.x);
    const dz = z.z - (p?.z ?? z.z);
    const dd = Math.hypot(dx, dz) || 1;
    damageZombie(z, JACKPOT_DAMAGE, dx / dd, dz / dd, 4);
  }
  if (p) state.vfx?.sparks(p.x, 0.6, p.z, 0, 0, 30);
  // reset every bumper so the floor can be re-lit for another jackpot
  for (const part of state.pinballParts) if (part.kind === "bumper") part.hits = 0;
  state.bumpersLit = 0;
  state.jackpots += 1;
  recordShot("jackpot");
}

/**
 * Fall into a GRAVE PIT — the hole a departing knight tore in the floor. This
 * one is LETHAL, and lethal without qualification: it ignores armor, Stoneskin,
 * i-frames and shields, and it does not route through hitPlayerRanged.
 *
 * That bluntness is deliberate and is the only thing that works here. Every
 * softer option fails in practice:
 *   · armor/Stoneskin would make death depend on loadout, so the same fall
 *     kills one player and tickles another with no visible difference;
 *   · i-frames are topped up constantly by rolling, wall contact and bumper
 *     bounces (player.ts stamps them in seven places), so an i-frame-respecting
 *     hole would silently fail to kill a player who arrived at speed — which is
 *     exactly how anyone arrives.
 * A hole you can fall into and survive by accident is worse than no hole: it
 * teaches players the wrong thing about a hazard that is meant to be absolute.
 *
 * God mode still saves you — that is a debug switch, not a game mechanic.
 */
function fallInGravePit(px: number, pz: number): void {
  const p = state.player;
  if (!p || p.hp <= 0) return;
  if (state.godMode) return;
  p.momSpeed = 0;
  p.momX = 0;
  p.momZ = 0;
  p.rideT = -1;
  p.ridePts = [];
  // Centre them in the hole and drop them out of sight — they are not climbing
  // out of this one, and leaving the sprite on the rim would read as survival.
  p.x = px;
  p.z = pz;
  p.sprite.mesh.position.y = -0.55;
  p.hp = 0; // death is polled from hp <= 0 in core's sim step
  state.hudDirty = true;
  requestShake(0.5);
  state.vfx?.burst(px, 0.2, pz, PALETTE_HEX[11], 22, 3.2);
  syncActorMesh(p);
  showToast("🕳️ SWALLOWED", "the floor gave way where a knight fell");
  sfxHurt();
}

/**
 * Fall into a PIT: a heart, a fistful of gold and ALL your speed, then you
 * climb back out at the rim you went in at. Deliberately NOT a teleport — the
 * trapdoor is the only thing on the floor that relocates you.
 */
function fallInPit(px: number, pz: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p) return;
  p.momSpeed = 0;
  p.rideT = -1;
  p.ridePts = [];
  // Haul out along the way you came in — the side of the rim nearest you.
  // Dead-centre (a straight drop) has no "in" direction, so pick one.
  let ox = p.x - px;
  let oz = p.z - pz;
  let ol = Math.hypot(ox, oz);
  if (ol < 1e-3) {
    const a = Math.random() * Math.PI * 2;
    ox = Math.cos(a);
    oz = Math.sin(a);
    ol = 1;
  }
  const out = PIT_RADIUS + PLAYER_R + 0.14;
  const tx = px + (ox / ol) * out;
  const tz = pz + (oz / ol) * out;
  if (g) {
    // moveCircle so the climb-out can't post us inside a wall band.
    const res = moveCircle(g, p.x, p.z, PLAYER_R, tx - p.x, tz - p.z);
    p.x = res.x;
    p.z = res.z;
  } else {
    p.x = tx;
    p.z = tz;
  }
  p.sprite.mesh.position.y = 0;
  if (p.iframes <= 0 && p.shieldT <= 0) {
    p.hp = Math.max(0, p.hp - PIT_DAMAGE);
    p.iframes = Math.max(p.iframes, 0.6);
  }
  const lost = Math.min(PIT_GOLD_PENALTY, state.goldRun);
  if (lost > 0) {
    state.goldRun -= lost;
    spendGold(lost);
  }
  state.hudDirty = true;
  requestShake(0.4);
  syncActorMesh(p);
  showPickupNote(`🕳️ FELL IN A PIT — climbing out${lost > 0 ? ` · −${lost}g` : ""}`);
  sfxHurt();
}

/** True if the player is standing over a magnet strip (walk-slow check). */
export function overMagStrip(): boolean {
  const p = state.player;
  if (!p) return false;
  for (const part of state.pinballParts) {
    if (part.kind !== "magstrip") continue;
    const dx = p.x - part.x;
    const dz = p.z - part.z;
    if (dx * dx + dz * dz <= MAGSTRIP_RADIUS * MAGSTRIP_RADIUS) return true;
  }
  return false;
}

/**
 * Parts whose consequences are owned by entities/hazards.ts, not by contact:
 * they fire on their OWN clock and sweep a lane, so touching one must do
 * nothing here. `glove` belongs in this set — it was the kind that fell through
 * the old catch-all and had its hazards.ts launch overwritten with a zero
 * heading on the very frame it connected.
 */
const selfFiring: PartHandler = () => {};

/**
 * Per-kind collision. EXHAUSTIVE by construction: adding a `PinballPartKind`
 * without adding it here is a type error, which is the whole point of the table.
 */
export const PART_HANDLERS: Record<PinballPartKind, PartHandler> = {
  bumper: ({ part, p, dx, dz, d2 }) => {
    const r = BUMPER_RADIUS + PLAYER_R * 0.5;
    if (d2 > r * r) return;
    const d = Math.sqrt(d2) || 1;
    // Radial exit with the authentic ±6° scatter (active parts only — plain
    // walls stay mirror-perfect, per the research).
    const scatter = (Math.random() * 2 - 1) * BUMPER_SCATTER * materialBumperScatterMult();
    const cs = Math.cos(scatter);
    const sn = Math.sin(scatter);
    const nx = dx / d;
    const nz = dz / d;
    p.momX = nx * cs - nz * sn;
    p.momZ = nx * sn + nz * cs;
    // Slice 5 — light the bumper on its BUMPER_LIT_HITS-th pop: a lit bumper
    // kicks harder, pays gold, and counts toward the floor JACKPOT.
    part.hits = (part.hits ?? 0) + 1;
    const lit = part.hits >= BUMPER_LIT_HITS;
    const nowLit = part.hits === BUMPER_LIT_HITS;
    // Stone marble is too heavy for a bumper to shove much (materialBumperMult).
    p.momSpeed = Math.min(
      PINBALL_MAX_SPEED,
      Math.max(p.momSpeed * BUMPER_KICK_MULT + (lit ? BUMPER_KICK_LIT : BUMPER_KICK_ADD) * materialBumperMult(), BUMPER_MIN_EXIT),
    );
    onPartTrigger();
    part.cooldownT = BUMPER_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.5, part.z, dx, dz, lit ? 18 : 12);
    requestShake(lit ? 0.22 : 0.16);
    requestHitstop(0.03);
    sfxBumper();
    if (lit) {
      state.goldRun += BUMPER_LIT_GOLD;
      addGold(BUMPER_LIT_GOLD, "dungeon-game");
    }
    if (nowLit) {
      // Only the LIGHTING pop earns a shot identity. Recording every bumper
      // contact would flood the five-deep chain and bury the shots that mean
      // something — lighting one is an event, tapping one is traffic.
      recordShot("bumper");
      state.bumpersLit += 1;
      const need = Math.min(state.bumperTotal || JACKPOT_BUMPERS, JACKPOT_BUMPERS);
      if (state.bumpersLit >= need) fireJackpot();
    }
  },

  spring: ({ part, p, d2 }) => {
    if (d2 > 0.42 * 0.42) return;
    p.momX = part.dirX;
    p.momZ = part.dirZ;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, SPRING_SPEED));
    onPartTrigger();
    part.cooldownT = SPRING_COOLDOWN;
    part.hitT = 0;
    state.vfx?.dust(part.x, 0.1, part.z);
    state.vfx?.sparks(part.x, 0.3, part.z, part.dirX, part.dirZ, 8);
    requestShake(0.14);
    sfxSpring();
  },

  ramp: ({ part, p, d2, deps }) => {
    if (d2 > 0.42 * 0.42) return;
    p.momX = part.dirX;
    p.momZ = part.dirZ;
    // Sonic's booster rule: a FLOOR, never a brake — plus a short steer lock
    // so the panel actually carries you down its lane before you can bend it.
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, RAMP_SPEED));
    recordShot("ramp");
    trySkillShot(part);
    deps.setSteerLock(RAMP_STEER_LOCK);
    part.cooldownT = RAMP_COOLDOWN;
    part.hitT = 0;
    // A2 — the ramp LAUNCHES: an airborne arc that flies OVER wall bands and
    // sets down on the far floor (collision bypassed mid-air). Falls back to
    // the flat dash above if there's no clear landing ahead.
    deps.startRampHop(part.dirX, part.dirZ, p.momSpeed);
    // Loud, directional feedback: a spark spray up the launch lane + a kick +
    // a distinct whoosh, so a ramp launch is unmistakable (not a silent shove).
    state.vfx?.dust(p.x, 0.06, p.z);
    state.vfx?.sparks(part.x, 0.45, part.z, part.dirX, part.dirZ, 16);
    requestShake(0.12);
    sfxSpin();
  },

  booster: ({ part, p, d2, deps }) => {
    // The moving-walkway pad: snap the heading to its arrow and FLOOR the
    // speed (Sonic booster rule — set, don't slow). Fires from a cold walk
    // too, so stepping onto a booster LANE launches you and each subsequent
    // pad in the chain re-aims + tops you up, railing you down the lane.
    if (d2 > BOOSTER_RADIUS * BOOSTER_RADIUS) return;
    // ── JAM GUARD ────────────────────────────────────────────────────────
    // A pad aimed at a SHARP CORNER fires the ball a fraction of a tile into
    // the wall, which bounces it straight back onto the pad, which fires it
    // again: the ball ping-pongs between corner and booster and the player
    // has no input that escapes it (the steer lock re-arms on every re-fire).
    // The pocket-rattle damp in player.ts cannot break this one, because it
    // scrubs momSpeed and THIS handler's floor immediately restores it — the
    // guard damps and the booster undoes the damping, forever.
    //
    // So the pad owns the fix: catching the same ball, in the same spot, more
    // than a couple of times in a row means the pad IS the trap. It stands
    // down for long enough that the ball's own bounce carries it clear. The
    // streak is keyed to a POSITION (not just a count) so a legitimate chain —
    // where each re-fire happens further down the lane — never trips it.
    const jammed = (part.jamT ?? 0) > 0 && Math.hypot(p.x - (part.jamX ?? 0), p.z - (part.jamZ ?? 0)) < BOOSTER_JAM_RADIUS;
    part.jamN = jammed ? (part.jamN ?? 0) + 1 : 1;
    part.jamX = p.x;
    part.jamZ = p.z;
    part.jamT = BOOSTER_JAM_WINDOW;
    if (part.jamN > BOOSTER_JAM_HITS) {
      // Stand down: no re-aim, no speed floor, no steer lock — everything that
      // would re-enter the loop. The pad goes dark and the ball keeps whatever
      // momentum the wall left it, so the pocket damp can finally land and the
      // knight rolls out under his own control.
      part.jamN = 0;
      part.cooldownT = BOOSTER_JAM_COOLDOWN;
      part.hitT = 0;
      state.vfx?.dust(part.x, 0.15, part.z); // a cough, not a launch — the pad visibly gives up
      return;
    }
    p.momX = part.dirX;
    p.momZ = part.dirZ;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, BOOSTER_SPEED));
    deps.raiseSteerLock(BOOSTER_STEER_LOCK);
    onPartTrigger();
    part.cooldownT = BOOSTER_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.25, part.z, part.dirX, part.dirZ, 10);
    sfxSpin();
  },

  boostcorner: ({ part, p, d2, deps }) => {
    // ── THE CORNER BOOSTER — a turn that pays you for taking it.
    //
    // Geometry: (dirX,dirZ) is the leg the ball ARRIVES on, pointing back the
    // way it came (so the incoming velocity is roughly −dir); (dir2X,dir2Z) is
    // the leg it leaves along. Same convention as the deflector's two legs, so
    // the level plan reads the same for both and a corner booster can degrade
    // into a deflector without re-authoring anything.
    if (d2 > CORNER_BOOST_RADIUS * CORNER_BOOST_RADIUS) return;
    // WHICH WAY IS THE BALL GOING? This is the whole reason the part exists.
    //
    // The straight pad it replaces re-fired anything that touched it, which in
    // a corner meant re-firing its own rebound: pad shoves ball at the outside
    // wall, wall returns it, pad shoves again. The old code met that with a
    // runway requirement (≥3 tiles ahead, so the launch never came back) and a
    // runtime jam guard, i.e. two mitigations for a case it could not detect.
    //
    // Here it is simply detectable. A ball travelling roughly along the exit
    // leg is a REBOUND coming back at the corner, not an entry — the exit is
    // where we just sent it. Decline, and let the wall bounce and the pocket
    // damp do their normal work; the pad will catch it again on the next real
    // approach. No jam guard needed because the loop cannot start.
    const along = p.momX * part.dir2X + p.momZ * part.dir2Z;
    const speed = p.momSpeed;
    if (speed > 0.5 && along > 0.7) return; // already heading out — nothing to redirect
    p.momX = part.dir2X;
    p.momZ = part.dir2Z;
    // A graze walks round the corner; a real run gets the speed floor. Without
    // the entry test, brushing a corner pad on foot flings you, which reads as
    // the level grabbing the controls.
    p.momSpeed =
      speed >= CORNER_BOOST_MIN_ENTRY
        ? Math.min(PINBALL_MAX_SPEED, Math.max(speed, CORNER_BOOST_SPEED))
        : Math.min(PINBALL_MAX_SPEED, Math.max(speed, CORNER_BOOST_MIN_ENTRY));
    deps.raiseSteerLock(CORNER_BOOST_STEER_LOCK);
    onPartTrigger();
    recordShot("ramp"); // a banked shot, same family as a ramp for the combo ledger
    part.cooldownT = CORNER_BOOST_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.3, part.z, part.dir2X, part.dir2Z, 12);
    requestShake(0.1);
    sfxSpin();
  },

  boostcurve: ({ part, p, d2, deps }) => {
    // ── THE CURVED BOOSTER — a lane pad on an authored arc.
    //
    // Unlike every other launcher its heading is a TANGENT, not a cardinal:
    // (dirX,dirZ) is a unit vector at an arbitrary angle, set from the arc the
    // pad was placed on. That is deliberate and load-bearing — a run of these
    // round a fillet reads as one continuous curved lane instead of a staircase
    // of axis-aligned pads, which is what "curved boosters" actually means.
    //
    // The knock-on: every generator pass that reasons about facings gates on
    // `Math.abs(dirI) + Math.abs(dirJ) === 1`, so this kind is excluded from
    // the duel breaker, the runway re-aim and the loop breaker automatically.
    // It cannot form a cardinal duel, so that exclusion is correct.
    //
    // ⚠️ WHAT USED TO BE CLAIMED HERE — "its arc is a piece of authored geometry
    // rather than a placement guess, so there is nothing for them to repair" —
    // WAS NOT TRUE, and it is the sentence that let the defect sit. No
    // ArcFeature is involved anywhere in this kind. The heading comes from
    // `smoothTangent` over a ROUTE, i.e. over the lattice staircase a Φ descent
    // leaves behind, and it is exactly as much of a placement guess as any
    // booster's. It just cannot be repaired afterwards, which is the opposite of
    // not needing to be. The gate therefore lives at authoring time, in
    // `layStationSpine` (`curveOk`), where the tangent is checked for runway and
    // downhill on its own vector rather than on the cardinal step beneath it.
    if (d2 > CURVE_BOOST_RADIUS * CURVE_BOOST_RADIUS) return;
    const len = Math.hypot(part.dirX, part.dirZ) || 1;
    p.momX = part.dirX / len;
    p.momZ = part.dirZ / len;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, CURVE_BOOST_SPEED));
    deps.raiseSteerLock(CURVE_BOOST_STEER_LOCK);
    onPartTrigger();
    part.cooldownT = CURVE_BOOST_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.25, part.z, p.momX, p.momZ, 10);
    sfxSpin();
  },

  jumppad: ({ part, p, d2, deps }) => {
    // ── THE JUMP PAD — the hop, made visible.
    //
    // The airborne arc already existed: `startRampHop` flies the knight over a
    // wall band and sets down on the far side, and the generator aimed a
    // `vault`-flagged RAMP at a crossable band to use it. But a vault ramp and
    // an ordinary ramp are the same mesh, so the one shot on the floor that
    // jumps the maze looked exactly like the twenty that don't — and worse, it
    // looked broken, because it is a launcher aimed point-blank at a wall.
    //
    // Same flight, own part, own silhouette. `startRampHop` falls back to a
    // flat dash when it finds no clear landing, so a jump pad whose far side
    // got walled off by a later pass degrades to a shove rather than a splat.
    if (d2 > JUMP_PAD_RADIUS * JUMP_PAD_RADIUS) return;
    p.momX = part.dirX;
    p.momZ = part.dirZ;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, JUMP_PAD_SPEED));
    recordShot("ramp");
    trySkillShot(part);
    deps.setSteerLock(JUMP_PAD_STEER_LOCK);
    part.cooldownT = JUMP_PAD_COOLDOWN;
    part.hitT = 0;
    deps.startRampHop(part.dirX, part.dirZ, p.momSpeed);
    state.vfx?.dust(p.x, 0.06, p.z);
    state.vfx?.sparks(part.x, 0.5, part.z, part.dirX, part.dirZ, 20);
    requestShake(0.16);
    sfxSpin();
  },

  deflector: ({ part, p, d2, inMomentum }) => {
    // GRAB-THROW corner: the deflector CATCHES the knight and hurls him around
    // the bend, rather than smoothly banking. Only meaningful while carrying
    // momentum, and only when actually cornering into it (not grazing past).
    if (!inMomentum || p.grabT > 0 || d2 > 0.5 * 0.5) return;
    // Which leg did we come IN along? We get THROWN out along the OTHER one.
    const inFrom1 = p.momX * -part.dirX + p.momZ * -part.dirZ; // heading INTO leg 1
    const inFrom2 = p.momX * -part.dir2X + p.momZ * -part.dir2Z;
    if (inFrom1 < 0.3 && inFrom2 < 0.3) return; // grazing past, not cornering
    if (inFrom1 >= inFrom2) {
      p.throwDirX = part.dir2X;
      p.throwDirZ = part.dir2Z;
    } else {
      p.throwDirX = part.dirX;
      p.throwDirZ = part.dirZ;
    }
    // Snap onto the rail and wind up: updatePinball pins the knight here for
    // DEFLECTOR_GRAB_TIME, then releases the throw. Speed floors at a real hurl
    // and multiplies a fast entry, clamped to the ceiling.
    p.grabT = DEFLECTOR_GRAB_TIME;
    p.grabX = part.x;
    p.grabZ = part.z;
    p.throwSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * DEFLECTOR_THROW_BOOST, DEFLECTOR_THROW_SPEED));
    // The CATCH — a hard thunk + a shove of hitstop so the grab reads, and
    // sparks gathering onto the rail. The THROW (burst + launch) fires on
    // release in updatePinball.
    onPartTrigger();
    part.cooldownT = DEFLECTOR_COOLDOWN + DEFLECTOR_GRAB_TIME;
    part.hitT = 0;
    requestHitstop(0.05);
    requestShake(0.12);
    state.vfx?.sparks(part.x, 0.35, part.z, 0, 0, 10);
    sfxHeavy();
    // D2 — if this rail is a corner of an ORBIT, it might have just advanced
    // (or completed) a lap. hitOrbitRail owns that bookkeeping.
    if (part.orbit !== undefined) hitOrbitRail(part);
    else recordShot("bank");
    trySkillShot(part);
  },

  // Wall-mounted piston. Fires on its own clock and sweeps a lane; the launch,
  // the damage and the combo tick all live in entities/hazards.ts.
  glove: selfFiring,

  oil: ({ part, p, d2, inMomentum, curSpeed }) => {
    // The slick: a WALKING touch converts your stride into a frictionless
    // slide along your heading; riding over it re-greases the momentum.
    if (d2 > OIL_RADIUS * OIL_RADIUS) return;
    if (stoneIgnoresOil()) return; // 🪨 a boulder doesn't hydroplane — keeps grip
    if (lavaVaporizesOil(part.x, part.z)) return; // 🔥 the slick flashes to flame
    if (inMomentum) {
      p.oilT = OIL_SLICK_TIME; // keep the ride greased (no friction, dead steering)
      return; // no cooldown stamp — the slick is a zone, not a trigger
    }
    if (curSpeed < 0.5) return; // standing on oil is just standing
    const a = state.input?.axis() ?? { x: 0, z: 0 };
    if (a.x === 0 && a.z === 0) return;
    const wd = screenDirToWorld(a.x, a.z);
    const wl = Math.hypot(wd.x, wd.z) || 1;
    p.momX = wd.x / wl;
    p.momZ = wd.z / wl;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(curSpeed * OIL_LAUNCH_MULT, OIL_LAUNCH_SPEED));
    p.oilT = OIL_SLICK_TIME;
    part.cooldownT = OIL_COOLDOWN;
    part.hitT = 0;
    state.vfx?.dust(p.x, 0.04, p.z);
    sfxRoll();
  },

  spinpad: ({ part, p, d2 }) => {
    // THE TURNTABLE. This used to be the slot machine — `Math.random()` picked
    // a heading and flung you at it. That made it the one part in the machine
    // you could neither aim nor learn: no skill expression, no setup, and a
    // live `Math.random()` sitting in a physics path that co-op replays.
    //
    // Now it's a rotating deflector. The pad carries a spin PHASE that turns at
    // a fixed rate, and the exit is your entry heading rotated by wherever the
    // phase has got to. Everything a player needs is on screen — the pad's
    // rotation is drawn — so the shot becomes "time your entry", which is what
    // a real spinner asks of you. Deterministic, so it replays identically in
    // co-op, and `recordShot` finally gives it an identity to chain from.
    if (d2 > 0.45 * 0.45) return;
    const inLen = Math.hypot(p.momX, p.momZ);
    // Standing on it with no heading: fall back to the pad's own facing rather
    // than reaching for a random one.
    const ix = inLen > 0.01 ? p.momX / inLen : part.dirX;
    const iz = inLen > 0.01 ? p.momZ / inLen : part.dirZ;
    const turn = spinPadPhase(state.elapsed, part.i);
    const cs = Math.cos(turn);
    const sn = Math.sin(turn);
    p.momX = ix * cs - iz * sn;
    p.momZ = ix * sn + iz * cs;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, SPINPAD_SPEED));
    onPartTrigger();
    part.cooldownT = SPINPAD_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.3, part.z, p.momX, p.momZ, 10);
    requestShake(0.14);
    sfxSpin();
    recordShot("spin");
  },

  slingshot: ({ part, p, d2, inMomentum }) => {
    if (d2 > 0.5 * 0.5) return;
    if (inMomentum) {
      // Passing the gate with momentum PINGS you out along the lane —
      // whichever way you were already mostly going.
      const along = p.momX * part.dirX + p.momZ * part.dirZ >= 0 ? 1 : -1;
      p.momX = part.dirX * along;
      p.momZ = part.dirZ * along;
      p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * SLING_SPEED_MULT + SLING_ADD, SLING_MIN_EXIT));
    } else {
      p.momX = part.dirX;
      p.momZ = part.dirZ;
      p.momSpeed = SLING_MIN_EXIT;
    }
    onPartTrigger();
    part.cooldownT = SLING_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.35, part.z, p.momX, p.momZ, 9);
    sfxSpring();
    // The momentum PING is the shot; the standing-start nudge is just a nudge.
    if (inMomentum) recordShot("sling");
  },

  lamp: ({ part, d2 }) => {
    // A light-puzzle brazier: roll (or walk) over it to light it. Forgiving —
    // no speed gate, since it's a puzzle, not a skill shot. Idempotent.
    if (part.lit) return;
    if (d2 > TARGET_RADIUS * TARGET_RADIUS) return;
    lightLamp(part);
  },

  target: ({ part, p, dx, dz, d2, inMomentum }) => {
    if (part.bank !== undefined) {
      // Slice 6 — drop-target BANK: light in 1-2-3 order; a wrong-order hit
      // resets the whole bank; lighting all pays a bonus.
      if (!inMomentum || p.momSpeed < TARGET_HIT_SPEED || part.lit) return;
      if (d2 > TARGET_RADIUS * TARGET_RADIUS) return;
      const bankParts = state.pinballParts.filter((q) => q.kind === "target" && q.bank === part.bank);
      const expected = Math.min(...bankParts.filter((q) => !q.lit).map((q) => q.seq ?? 0));
      part.hitT = 0;
      onPartTrigger();
      if (part.seq === expected) {
        part.lit = true;
        state.vfx?.sparks(part.x, 0.6, part.z, dx, dz, 10);
        sfxTarget();
        if (bankParts.every((q) => q.lit)) {
          state.goldRun += BANK_CLEAR_GOLD;
          addGold(BANK_CLEAR_GOLD, "dungeon-game");
          showToast("🎯 TARGET BANK!", `1·2·3 lit · +${BANK_CLEAR_GOLD}g`);
          recordShot("bank");
          requestShake(0.3);
        } else {
          showPickupNote(`🎯 BANK ${(part.seq ?? 0) + 1}/${bankParts.length}`);
        }
      } else {
        for (const q of bankParts) q.lit = false; // out of order → reset
        sfxSpring();
        showPickupNote("🎯 SEQUENCE RESET");
      }
      state.hudDirty = true;
      return;
    }
    // Bullseyes break to MOMENTUM only — the floor's objective layer.
    if (part.done || !inMomentum || p.momSpeed < TARGET_HIT_SPEED) return;
    if (d2 > TARGET_RADIUS * TARGET_RADIUS) return;
    part.done = true;
    part.hitT = 0;
    state.targetsHit += 1;
    onPartTrigger();
    recordShot("target");
    trySkillShot(part);
    state.goldRun += TARGET_GOLD;
    addGold(TARGET_GOLD, "dungeon-game");
    state.vfx?.sparks(part.x, 0.6, part.z, dx, dz, 14);
    requestShake(0.14);
    sfxTarget();
    if (state.targetsHit >= state.targetsTotal && state.targetsTotal > 0) {
      state.goldRun += TARGET_CLEAR_GOLD;
      addGold(TARGET_CLEAR_GOLD, "dungeon-game");
      showToast("🎯 ALL TARGETS DOWN", `the machine pays out · +${TARGET_CLEAR_GOLD}g`);
    } else {
      showPickupNote(`🎯 TARGET ${state.targetsHit}/${state.targetsTotal} +${TARGET_GOLD}g`);
    }
    state.hudDirty = true;
  },

  trapdoor: ({ part, p, d2, deps }) => {
    // The hatch swings open, swallows you, THEN the rollercoaster takes over
    // — see startDrop → startRide. The floor's one and only teleport.
    if (d2 > 0.42 * 0.42) return;
    if (p.rideT >= 0 || p.dropT >= 0) return;
    part.cooldownT = TRAPDOOR_COOLDOWN;
    part.hitT = 0; // drives the hinge-open animation in render/pinball-parts
    recordShot("trapdoor");
    deps.startDrop(part.x, part.z);
  },

  flipper: ({ part, p, d2, inMomentum }) => {
    // The big paddle CATAPULTS you along its swing at the hardest speed in the
    // machine (walking or riding). Slice 7 — AIM-ASSIST: the exit is the paddle
    // angle BLENDED with your approach line, so a skilled entry angle lets you
    // aim off the flipper (paddle still dominates, so it can't reverse you).
    if (d2 > FLIPPER_RADIUS * FLIPPER_RADIUS) return;
    let ex = part.dirX;
    let ez = part.dirZ;
    if (inMomentum && p.momSpeed > 0.5) {
      const bx = part.dirX * 0.72 + p.momX * 0.38;
      const bz = part.dirZ * 0.72 + p.momZ * 0.38;
      const bl = Math.hypot(bx, bz) || 1;
      ex = bx / bl;
      ez = bz / bl;
    }
    p.momX = ex;
    p.momZ = ez;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed, FLIPPER_SPEED));
    onPartTrigger();
    part.cooldownT = FLIPPER_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.5, part.z, ex, ez, 16);
    requestShake(0.22);
    sfxSpring();
    recordShot("flipper");
  },

  mirror: ({ part, p, d2, inMomentum }) => {
    // A bank shot: REFLECT the incoming momentum across the mirror's surface
    // line (unlike the deflector's corner-bank). Momentum only.
    if (!inMomentum || d2 > MIRROR_RADIUS * MIRROR_RADIUS) return;
    // surface dir = (part.dirX, part.dirZ) (may be a diagonal); normal = its
    // perpendicular, normalised so the reflection preserves speed.
    const nl = Math.hypot(part.dirX, part.dirZ) || 1;
    const nx = -part.dirZ / nl;
    const nz = part.dirX / nl;
    const dot = p.momX * nx + p.momZ * nz;
    if (Math.abs(dot) < 0.2) return; // travelling along the mirror, nothing to bounce
    p.momX -= 2 * dot * nx;
    p.momZ -= 2 * dot * nz;
    p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * MIRROR_BOOST);
    onPartTrigger();
    part.cooldownT = MIRROR_COOLDOWN;
    part.hitT = 0;
    state.vfx?.sparks(part.x, 0.4, part.z, p.momX, p.momZ, 8);
    sfxRoll();
    recordShot("mirror");
  },

  pit: ({ part, p, d2 }) => {
    // A hole: fall in unless the coaster is carrying you over it. The climb
    // out sets us on the rim, so lock the hole briefly — otherwise a bounce
    // straight back in reads as the pit "grabbing" you.
    if (p.rideT >= 0 || p.dropT >= 0 || d2 > PIT_RADIUS * PIT_RADIUS) return;
    if (stoneBridgesPit()) return; // 🪨 too heavy to be swallowed — plows across
    part.cooldownT = PIT_CLIMB_COOLDOWN;
    fallInPit(part.x, part.z);
    return "stop"; // the fall owns this frame
  },

  gravepit: ({ part, p, d2 }) => {
    // A GRAVE PIT kills. Same "am I over it" gate as a pit — the coaster still
    // carries you across, because a ride is explicitly above the floor and
    // taking that away would make an unrelated mechanic feel broken.
    if (p.rideT >= 0 || p.dropT >= 0 || d2 > GRAVEPIT_RADIUS * GRAVEPIT_RADIUS) return;
    fallInGravePit(part.x, part.z);
    return "stop"; // the fall owns this frame
  },

  // Electrified plate. Damage window ticks in entities/hazards.ts.
  electric: selfFiring,
  // Fire vent. Plume + burn window tick in entities/hazards.ts.
  firevent: selfFiring,

  magstrip: ({ part, p, d2, inMomentum }) => {
    // The anti-speed zone: over it, momentum is DRAGGED to a crawl and
    // steering goes heavy — unless Magnet Boots invert it into a LAUNCH.
    if (d2 > MAGSTRIP_RADIUS * MAGSTRIP_RADIUS) return;
    if (p.magBootsT > 0) {
      // boots: a strip flings you along your heading instead of trapping you
      if (inMomentum && p.momSpeed < MAGBOOTS_STRIP_LAUNCH) {
        p.momSpeed = MAGBOOTS_STRIP_LAUNCH;
        onPartTrigger();
        part.cooldownT = MAGSTRIP_BOOTS_COOLDOWN;
        state.vfx?.sparks(part.x, 0.3, part.z, p.momX, p.momZ, 8);
      }
      return;
    }
    // 💧 Water FLASH-BOILS on the field: the trap becomes a steam launch.
    if (inMomentum && part.cooldownT <= 0 && tryWaterSteam()) {
      onPartTrigger();
      part.cooldownT = WATER_STEAM_COOLDOWN;
      return;
    }
    // 🪨 Stone plows through — the magnet can't grip a boulder (higher clamp).
    const cap = stoneMagstripCap() ?? MAGSTRIP_SPEED_CAP;
    if (p.momSpeed > cap) p.momSpeed = cap;
    if (Math.random() < 0.3) state.vfx?.sparks(part.x, 0.2, part.z, 0, 1, 2);
  },

  rollover: ({ part, d2 }) => {
    // D3 — a lane trigger: rolling over it LIGHTS it. Walking counts too (a
    // rollover is a switch, not a launcher), so a bank is something you can
    // deliberately go and complete rather than only hit at speed.
    if (d2 > ROLLOVER_RADIUS * ROLLOVER_RADIUS) return;
    part.cooldownT = ROLLOVER_COOLDOWN;
    part.hitT = 0;
    hitRollover(part);
    trySkillShot(part);
    state.vfx?.sparks(part.x, 0.3, part.z, 0, 0, 4);
  },

  // ── Track-B Runtime Movers ─────────────────────────────────────────
  swingarm: selfFiring,

  scoop: ({ part, p, d2, inMomentum }) => {
    // Saucer scoop: holds the knight for 1.1s and ejects along authored dirX, dirZ.
    if (p.grabT > 0 || d2 > 0.6 * 0.6) return;
    p.grabT = 1.1; // SCOOP_HOLD
    p.grabX = part.x;
    p.grabZ = part.z;
    p.throwDirX = part.dirX || 1;
    p.throwDirZ = part.dirZ || 0;
    p.throwSpeed = Math.min(PINBALL_MAX_SPEED, Math.max(p.momSpeed * 1.25, 14.0));
    onPartTrigger();
    part.cooldownT = 2.0;
    part.hitT = 0;
    requestHitstop(0.06);
    requestShake(0.15);
    state.vfx?.sparks(part.x, 0.4, part.z, 0, 0, 12);
    sfxHeavy();
    recordShot("bank");
  },

  maw: ({ part, p, d2, inMomentum, deps }) => {
    if (p.rideT >= 0 || p.dropT >= 0 || p.grabT > 0) return;
    const pSpeed = inMomentum ? p.momSpeed : Math.hypot(p.momX, p.momZ);
    if (!canMawSwallow(part, p.x, p.z, pSpeed, p.momX, p.momZ)) {
      // Glancing blow or slow walk: bounce off teeth
      if (d2 <= 0.6 * 0.6) {
        const d = Math.sqrt(d2) || 1;
        p.momX = (p.x - part.x) / d;
        p.momZ = (p.z - part.z) / d;
        p.momSpeed = Math.max(p.momSpeed * 0.5, 4.0);
        part.hitT = 0;
        state.vfx?.sparks(part.x, 0.3, part.z, p.momX, p.momZ, 4);
      }
      return;
    }
    // Swallow!
    part.cooldownT = MAW_COOLDOWN;
    part.hitT = 0;
    recordShot("trapdoor");
    onPartTrigger();
    deps.startDrop(part.x, part.z);
  },
};

/**
 * Sweep every ready part against the player and fire the matching handler.
 *
 * @param inMomentum true when called from the momentum ride, false when walking
 * @param curSpeed   smoothed walk speed, the oil slick's launch input
 */
export function touchPinballParts(inMomentum: boolean, curSpeed: number, deps: PinballDeps): void {
  const p = state.player;
  if (!p || state.pinballParts.length === 0) return;

  for (const part of state.pinballParts) {
    if (part.cooldownT > 0) continue;
    const dx = p.x - part.x;
    const dz = p.z - part.z;
    const d2 = dx * dx + dz * dz;
    // BROAD PHASE. Every handler's first act is a radius test against its own
    // (small) trigger distance, so a part tens of tiles away can only ever
    // return "no". Rejecting those here skips the call and the per-kind work
    // behind it. The cutoff is deliberately far larger than any part's real
    // trigger radius — this must never change WHICH parts fire, only how
    // quickly we discover that distant ones do not. A tight gate here would
    // be a collision bug, not an optimisation.
    if (d2 > PART_TOUCH_BROAD_SQ) continue;
    const stop = PART_HANDLERS[part.kind]({ part, p, dx, dz, d2, inMomentum, curSpeed, deps });
    if (stop === "stop") return;
  }
}
