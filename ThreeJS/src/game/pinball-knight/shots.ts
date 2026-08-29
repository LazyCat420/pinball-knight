/**
 * SHOT IDENTITY — orbits, rollover lanes, the skill shot and named combos.
 *
 * The machine already had parts, lights and a combo counter, but every hit was
 * anonymous: the combo counted "any bounce" and "any part", so five bumper taps
 * scored exactly like ramp → orbit → target-bank. A pinball table is the
 * opposite — its shots have NAMES, and knowing you just made one is the whole
 * feeling. This module gives a hit an identity and pays out for the sequences
 * that mean something:
 *
 *   D2 ORBIT      — rail all four corners of a room's ring in clockwise order
 *                   without lapsing → a LAP. Laps ladder: each one pays more.
 *   D3 LANES      — roll over every lane of a parallel bank to clear it. Tap
 *                   dodge to ROTATE which lanes are lit (the lane change), so
 *                   the last lane you need is something you can set up.
 *   D4 SKILL SHOT — every floor opens on the plunger; hit the lit target before
 *                   the window lapses and the floor starts with a bonus.
 *   D5 NAMED      — the last few shot identities are matched against a table of
 *                   named combos (RAMP→ORBIT = ORBIT RUNNER, and so on). Each
 *                   name pays once per floor, so it stays an event.
 *
 * Kept out of player.ts so the physics code stays physics: player.ts reports
 * "this kind of shot happened" and this module decides what it was worth.
 */
import { state, type PinballPart } from "./state";
import {
  ORBIT_WINDOW,
  ORBIT_GOLD,
  ORBIT_LAP_BONUS,
  LANE_CLEAR_GOLD,
  SKILL_SHOT_WINDOW,
  SKILL_SHOT_GOLD,
  NAMED_CHAIN_MAX,
  NAMED_COMBOS,
  FLIPPER_TIMED_GOLD,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { showToast, showPickupNote } from "./ui";
import { sfxTarget, sfxSpring, sfxBumper } from "./sfx";

/** Bank the gold in both the run ledger and the wallet — one place, one rule. */
function pay(amount: number): void {
  state.goldRun += amount;
  addGold(amount, "dungeon-game");
  state.hudDirty = true;
}

/**
 * A TIMED FLIPPER — the flipper button's payout, for a knight who arrived
 * inside the live window of a swing they commanded, or who fired themselves off
 * a cradle. Routed through `pay` like every other shot so there is still exactly
 * one place that banks gold; the caller has already recorded the shot itself.
 */
export function payTimedFlip(): void {
  pay(FLIPPER_TIMED_GOLD);
  showPickupNote(`🏏 TIMED FLIP +${FLIPPER_TIMED_GOLD}g`);
}

/**
 * Record a shot's IDENTITY into the live combo chain and pay any named combo it
 * completes. `id` is the shot's name ("ramp", "orbit", "bank", "target", …).
 */
export function recordShot(id: string): void {
  state.shotChain.push(id);
  if (state.shotChain.length > NAMED_CHAIN_MAX) state.shotChain.shift();

  // Longest match first, so RAMP→ORBIT→BANK beats the RAMP→ORBIT inside it.
  for (const combo of NAMED_COMBOS) {
    const n = combo.shots.length;
    if (state.shotChain.length < n) continue;
    const tail = state.shotChain.slice(-n);
    if (!tail.every((s, k) => s === combo.shots[k])) continue;
    if (state.namedPaid[combo.name]) continue; // once per floor — keep it special
    state.namedPaid[combo.name] = true;
    pay(combo.gold);
    showToast(`${combo.icon} ${combo.name}`, `${combo.shots.join(" → ")} · +${combo.gold}g`);
    state.shakeT = Math.max(state.shakeT, 0.3);
    sfxTarget();
    return;
  }
}

/** The combo lapsed — a new chain of shot identities starts from here. */
export function clearShotChain(): void {
  state.shotChain = [];
}

/**
 * D2 — a banked rail belonging to an ORBIT was hit. Advance the lap if it's the
 * next corner clockwise; otherwise (re)start the lap from this corner. A lap
 * only counts as a lap if you actually went round.
 */
export function hitOrbitRail(part: PinballPart): void {
  const id = part.orbit;
  const seq = part.orbitSeq;
  if (id === undefined || seq === undefined) return;

  const continuing = state.orbitActive === id && state.orbitT > 0 && seq === (state.orbitLast + 1) % 4;
  if (!continuing) {
    // A fresh attempt: this corner is lap position 1.
    state.orbitActive = id;
    state.orbitCount = 1;
    state.orbitLast = seq;
    state.orbitT = ORBIT_WINDOW;
    recordShot("bank");
    return;
  }

  state.orbitCount++;
  state.orbitLast = seq;
  state.orbitT = ORBIT_WINDOW;

  if (state.orbitCount < 4) {
    showPickupNote(`↻ ORBIT ${state.orbitCount}/4`);
    return;
  }

  // A full LAP. Each lap this floor pays more — chaining laps is the skill.
  state.orbitLaps++;
  const gold = ORBIT_GOLD + (state.orbitLaps - 1) * ORBIT_LAP_BONUS;
  pay(gold);
  showToast("↻ ORBIT!", `lap ${state.orbitLaps} · +${gold}g`);
  state.shakeT = Math.max(state.shakeT, 0.32);
  sfxSpring();
  recordShot("orbit");
  // Roll straight into the next lap — this corner becomes its first.
  state.orbitCount = 1;
  state.orbitT = ORBIT_WINDOW;
}

/**
 * D3 — rolled over a lane. Light it; clearing every lane in the bank pays out
 * and resets the bank so it can be run again.
 */
export function hitRollover(part: PinballPart): void {
  const id = part.lane;
  const seq = part.laneSeq;
  if (id === undefined || seq === undefined) return;

  const lanes = state.laneLit[id] ?? [];
  if (lanes[seq]) return; // already lit — rolling it again is not progress
  lanes[seq] = true;
  state.laneLit[id] = lanes;
  sfxBumper();

  const total = state.pinballParts.filter((q) => q.lane === id).length;
  const lit = lanes.filter(Boolean).length;
  if (lit < total) {
    showPickupNote(`⋯ LANE ${lit}/${total} — dodge to shift the lit lanes`);
    recordShot("lane");
    return;
  }

  state.lanesCleared++;
  pay(LANE_CLEAR_GOLD);
  showToast("⋯ LANES COMPLETE", `all ${total} lit · +${LANE_CLEAR_GOLD}g`);
  state.shakeT = Math.max(state.shakeT, 0.28);
  state.laneLit[id] = []; // re-arm the bank for another run
  recordShot("lanes");
}

/**
 * D3 — THE LANE CHANGE. A dodge tap rotates which lanes are lit in every bank,
 * exactly like nudging the flipper buttons on a real table to line up the lane
 * you still need. Returns true if anything actually rotated (so the caller can
 * give feedback without spamming it on every dodge).
 */
export function rotateLanes(): boolean {
  let rotated = false;
  for (const key of Object.keys(state.laneLit)) {
    const id = Number(key);
    const lanes = state.laneLit[id];
    const total = state.pinballParts.filter((q) => q.lane === id).length;
    if (!lanes || total === 0) continue;
    const lit = lanes.filter(Boolean).length;
    if (lit === 0 || lit >= total) continue; // nothing to shuffle
    const next: boolean[] = [];
    for (let s = 0; s < total; s++) next[s] = !!lanes[(s - 1 + total) % total];
    state.laneLit[id] = next;
    rotated = true;
  }
  return rotated;
}

/**
 * D4 — arm the floor's SKILL SHOT: hit `target` before the window lapses and
 * the floor opens with a bonus. Called once, off the plunger launch.
 */
export function armSkillShot(target: { i: number; j: number }): void {
  state.skillArmed = true;
  state.skillT = SKILL_SHOT_WINDOW;
  state.skillTarget = target;
  showToast("🎯 SKILL SHOT", "hit the lit target off the launch");
}

/** D4 — did this part hit satisfy the armed skill shot? Pays out if so. */
export function trySkillShot(part: PinballPart): void {
  if (!state.skillArmed || !state.skillTarget) return;
  if (part.i !== state.skillTarget.i || part.j !== state.skillTarget.j) return;
  state.skillArmed = false;
  state.skillT = 0;
  state.skillTarget = null;
  pay(SKILL_SHOT_GOLD);
  showToast("🎯 SKILL SHOT!", `straight off the plunger · +${SKILL_SHOT_GOLD}g`);
  state.shakeT = Math.max(state.shakeT, 0.35);
  sfxTarget();
  recordShot("skill");
}

/**
 * Tick the timed windows. The orbit lap and the skill shot both expire; when
 * the bounce combo itself lapses the shot chain resets, so a named combo has
 * to be one continuous run rather than a shopping list assembled over a floor.
 */
export function updateShots(dt: number): void {
  if (state.orbitT > 0) {
    state.orbitT -= dt;
    if (state.orbitT <= 0) {
      state.orbitActive = -1;
      state.orbitLast = -1;
      state.orbitCount = 0;
    }
  }
  if (state.skillArmed) {
    state.skillT -= dt;
    if (state.skillT <= 0) {
      state.skillArmed = false;
      state.skillTarget = null;
      showPickupNote("🎯 skill shot missed");
    }
  }
  const p = state.player;
  if (p && p.bounceComboT <= 0 && state.shotChain.length > 0 && p.momSpeed <= 0) clearShotChain();
}
