/**
 * WHAT A COMPLETED MACHINE CHANGES — the consequence layer.
 *
 * `machines.ts` shipped the whole lifecycle (unlit → qualifying → lit → armed →
 * collected → cooling), an event queue and a listener hook, and NOTHING
 * LISTENED. Completing a machine paid gold, so the machine layer was a score
 * checklist: "light three loops" meant a bigger number, not a different
 * dungeon. This module is the half that makes it a dungeon change.
 *
 * ── The shape: a REGISTRY, not an if/else ─────────────────────────────────
 *
 * Four consequences are wanted (the user picked all four): open the vault, an
 * overcharge window, a shortcut unlocked, and a change in how enemies behave.
 * Two are built here; two need a gate entity, a floor-graph edit, a minimap
 * layer and combat hooks that live in files this slice does not own. So the
 * dispatcher is a registry of NAMED EFFECTS and the two live ones are just its
 * first two entries — adding "open a gate" later is `registerMachineEffect`
 * from the gate's own module, not surgery in here.
 *
 * Every effect declares its LIFETIME, because the four differ and the
 * differences are exactly what leaks between floors when they are implicit:
 *
 *   cumulative       progress that accretes across a floor and is spent once
 *                    (vault seals — IMPLEMENTED below)
 *   windowed         a timed state that arms, runs, and lapses
 *                    (overcharge — IMPLEMENTED below)
 *   floor-permanent  a one-way change to the floor that never lapses
 *                    (the shortcut gate — NOT IMPLEMENTED, needs a gate entity
 *                    and a floor-graph edit; register one from that module)
 *   prompt           an unanswered QUESTION held across ticks — the push-your-
 *                    luck offer that `gargoyle-scoop`'s two authored eject
 *                    exits are for (safe payout vs timed vault breach). NOT
 *                    IMPLEMENTED. It fits the registry as-is: such an effect
 *                    stores its pending question in its own module state inside
 *                    `apply`, resolves it from its own input path, and MUST
 *                    drop it in `reset` — an unanswered question that survives
 *                    a descent is the same class of bug as a leaked timer.
 *
 * `reset()` is REQUIRED on the interface rather than optional for that reason:
 * `machines.ts` documents its registry as floor-scoped, and a consequence that
 * outlives its floor arrives on depth 8 already half-solved.
 *
 * ── Why the drain and not the listener ────────────────────────────────────
 *
 * `machines.ts` publishes each event to `onMachineEvent` listeners AND queues
 * it for `drainMachineEvents`. Using both would apply every consequence TWICE
 * for one shot, silently. This module uses the DRAIN only: one path, frame-
 * ordered, and `drainMachineEvents` empties as it reads, so a double tick
 * cannot double-apply either. The listener hook is left for read-only
 * observers (the dev overlay, a test watching gold).
 *
 * ── Which machine fires which effect ──────────────────────────────────────
 *
 * An effect may name the machines it reacts to (`names`), so a `loop-reactor`
 * arming overcharge and a `gargoyle-scoop` breaching the vault can read as
 * different objects rather than ten identical score buttons. Both live effects
 * are deliberately left UNRESTRICTED for now: a floor rolls its machines from
 * `MACHINES` (orbit, ramp-return, target-bank, pop-nest, sling-pair,
 * kicker-lane, spinner-gate, rollover-bank, gargoyle-scoop, loop-reactor) and
 * nothing guarantees any particular one is on the floor, so pinning a route to
 * one name today would mean floors where the route does not exist. The field is
 * here so that decision can be made when the placer can guarantee the name.
 */
import { state } from "./state";
import { drainMachineEvents, type MachineEvent } from "./machines";
import { addGold } from "../../utils/gold-wallet";
import { showToast, showPickupNote } from "./ui";
import { sfxTarget, sfxSpring } from "./sfx";

// ── Tuning ────────────────────────────────────────────────────────────────

/**
 * How many DISTINCT machines a floor must complete to be worth one brazier.
 *
 * The denominator moved: the floor is going to hold ~8-10 machines at depth
 * (the "richer, not bigger" call), against the 3-5 braziers `lampCountFor`
 * authors. Pricing a machine at one brazier would make the brazier route dead
 * content — two or three machines would finish a shallow floor's vault on their
 * own. At 2:1, clearing the WHOLE table at depth (10 machines → 5 seals) is
 * worth exactly the whole brazier set (5), and on a shallow floor (3 braziers,
 * ~4 machines) machines can only ever contribute 2 of the 3. So the third route
 * becomes self-sufficient exactly when the floor is dense enough to make
 * clearing it an achievement, and is a contributing route everywhere else.
 *
 * A machine completion is `total` ordered shots inside a decaying window, plus
 * the arm on the clock, plus a separate collect shot; a brazier is one
 * rollover. 2:1 is therefore still generous per unit of effort — the ratio is
 * set by how MANY of each the floor has, not by what one of each costs.
 */
export const MACHINES_PER_SEAL = 2;

/** Seconds the overcharge window runs once armed. */
export const OVERCHARGE_TIME = 8;

/**
 * Seconds after a window lapses before another can arm.
 *
 * This is the whole answer to "eight machines complete over a floor". A window
 * that REFRESHES on every completion is permanently on once completions land
 * closer together than its own length, and with 8-10 machines they will. A
 * window that EXTENDS is worse. So a re-arm while the window is already running
 * is IGNORED — it ladders the payout instead (that is what `rung` is for) — and
 * the lockout bounds the duty cycle at OVERCHARGE_TIME / (OVERCHARGE_TIME +
 * OVERCHARGE_LOCKOUT) = 40%, a bound that does not move when the machine count
 * does. Overcharge stays an EVENT; what you do inside it is the skill.
 */
export const OVERCHARGE_LOCKOUT = 12;

/** Each collect landed inside the window adds this much of its own payout. */
export const OVERCHARGE_SHARE_STEP = 0.25;

/** …up to this much. Modest on purpose: the point is that the world changed. */
export const OVERCHARGE_MAX_SHARE = 1;

/** Seconds between the window's visible heartbeat pulses. */
export const OVERCHARGE_PULSE = 0.55;

/** The overcharge tint — the same arc-violet the vault opens in. */
const HOT = 0xa050e0;

/** Bonus share for a ladder rung. Clamped at BOTH ends, so the cap is here
 *  rather than at each call site. */
export function overchargeShareFor(rung: number): number {
  return Math.min(OVERCHARGE_MAX_SHARE, Math.max(0, Math.floor(rung)) * OVERCHARGE_SHARE_STEP);
}

/**
 * Bank gold. `shots.ts` keeps a private `pay` with these three lines and the
 * comment that it is the one place the game banks — that claim is already
 * local to that file (fifteen other modules call `addGold` directly), and the
 * overcharge bonus is a SEPARATE transaction from the jackpot `shots.ts` paid
 * for the same collect. Exporting `pay` would mean editing `shots.ts`, which
 * this slice does not own.
 */
function pay(amount: number): void {
  if (amount <= 0) return;
  state.goldRun += amount;
  addGold(amount, "dungeon-game");
  state.hudDirty = true;
}

// ── The registry ──────────────────────────────────────────────────────────

/**
 * How long an effect's change lives. Declared rather than inferred: it is what
 * says whether `reset` has anything to do, and getting it wrong is a leak
 * across floors that nothing else in the game would notice.
 */
export type MachineEffectLifetime = "cumulative" | "windowed" | "floor-permanent" | "prompt";

export interface MachineEffect {
  /** Stable name — dev overlay, tests, and the thing you unregister by. */
  id: string;
  lifetime: MachineEffectLifetime;
  /** Event kinds that wake it. Defaults to `collected` only. */
  on?: readonly MachineEvent["kind"][];
  /** Machine names it reacts to. Absent = every machine on the floor. */
  names?: readonly string[];
  /** React to one event. Returns true if it actually changed something. */
  apply?(e: MachineEvent): boolean;
  /** Age a windowed effect. Omit for cumulative / instantaneous ones. */
  tick?(dt: number): void;
  /** Floor teardown. REQUIRED: this is where the leak would be. */
  reset(): void;
  /** One line for the dev overlay / HUD, or null when the effect is idle. */
  describe?(): string | null;
}

const effects: MachineEffect[] = [];

/** Add an effect. Returns the unregister, so a module can own its own lifetime. */
export function registerMachineEffect(fx: MachineEffect): () => void {
  effects.push(fx);
  return () => {
    const k = effects.indexOf(fx);
    if (k >= 0) effects.splice(k, 1);
  };
}

/** Read-only view, for the dev overlay and tests. */
export function machineEffects(): readonly MachineEffect[] {
  return effects;
}

function wants(fx: MachineEffect, e: MachineEvent): boolean {
  const kinds = fx.on ?? (["collected"] as const);
  if (!kinds.includes(e.kind)) return false;
  if (fx.names && !fx.names.includes(e.name)) return false;
  return !!fx.apply;
}

// ── Effect 1 — VAULT SEALS (cumulative) ───────────────────────────────────

/**
 * A third route to the sealed vault chest, alongside lighting every brazier and
 * killing the floor's overlord. `lamp-puzzle.ts` reads `machineVaultSeals()`
 * into the progress it already ramps the chest's colour with, so the machine
 * route is visible on the same object, in the same vocabulary, with no second
 * progress meter invented for it.
 *
 * ONE CHARGE PER DISTINCT MACHINE PER FLOOR. A machine re-arms every
 * MACHINE_COOL_TIME (2s), so a per-COMPLETION charge would let one spot open the
 * vault in ten seconds of hammering — the ratio above would be decoration. The
 * set of ids is the anti-farm rule and the reason the ceiling is "how much of
 * the table did you clear" rather than "how long did you stand here".
 */
const charged = new Set<number>();

/** Distinct machines completed this floor. */
export function machineVaultCharges(): number {
  return charged.size;
}

/** Braziers-worth of vault progress the machines have earned this floor. */
export function machineVaultSeals(): number {
  return Math.floor(charged.size / MACHINES_PER_SEAL);
}

const vaultSealEffect: MachineEffect = {
  id: "vault-seal",
  lifetime: "cumulative",
  apply(e) {
    if (charged.has(e.id)) return false;
    const before = machineVaultSeals();
    charged.add(e.id);
    const seals = machineVaultSeals();
    const pz = state.lampPuzzle;
    if (!pz || pz.unlocked) return true; // charged anyway — the floor may re-seal later
    if (seals > before) {
      // A seal LANDED. The chest owns the open itself (updateLampPuzzle sees
      // the new progress on its next frame); this is only the announcement.
      state.vfx?.burst(pz.vault.x, 0.8, pz.vault.z, HOT, 20, 5);
      state.shakeT = Math.max(state.shakeT, 0.22);
      sfxTarget();
      showPickupNote(`🗝️ THE VAULT ANSWERS — ${Math.min(pz.total, pz.lit + seals)}/${pz.total}`);
    } else {
      const need = MACHINES_PER_SEAL - (charged.size % MACHINES_PER_SEAL);
      showPickupNote(`⚙ ${e.name.toUpperCase()} CLEARED — ${need} more machine${need > 1 ? "s" : ""} breaks a seal`);
    }
    state.hudDirty = true;
    return true;
  },
  reset() {
    charged.clear();
  },
  describe() {
    return charged.size > 0 ? `seals ${machineVaultSeals()} (${charged.size}/${MACHINES_PER_SEAL} per)` : null;
  },
};

// ── Effect 2 — OVERCHARGE (windowed) ──────────────────────────────────────

let overT = 0;
let lockT = 0;
let rung = 0;
let pulseT = 0;
/** The machine that armed the live window — the one drawn hot. */
let hotId = -1;

export function overchargeActive(): boolean {
  return overT > 0;
}

export function overchargeRemaining(): number {
  return overT;
}

/** Seconds before another window may arm. 0 when one may arm now. */
export function overchargeLockout(): number {
  return lockT;
}

/** Collects landed INSIDE the live window, 0 while it is not running. */
export function overchargeRung(): number {
  return rung;
}

/** The bonus share the next in-window collect would pay. */
export function overchargeShare(): number {
  return overT > 0 ? overchargeShareFor(rung + 1) : 0;
}

/**
 * The window made visible without touching a file this slice does not own.
 *
 * A booster's own glow lives in `render/pinball-parts.ts`, so the honest thing
 * available here is the FX vocabulary the rest of the game already speaks: a
 * shockwave ring under the knight on a heartbeat, and sparks off the parts of
 * the machine that armed it, so the object responsible is the one that looks
 * hot. Both read `state` and `state.vfx` only. (Making the boosters THEMSELVES
 * ramp is a follow-up in that file — see the report.)
 */
function pulse(): void {
  const p = state.player;
  if (p) state.vfx?.ring(p.x, p.z, HOT, 1.05, 0.4);
  let n = 0;
  for (const part of state.pinballParts) {
    if (part.asm?.id !== hotId) continue;
    state.vfx?.burst(part.x, 0.5, part.z, HOT, 3, 2.5);
    if (++n >= 6) break; // a machine is 2-6 parts; the cap is for a future big one
  }
}

const overchargeEffect: MachineEffect = {
  id: "overcharge",
  lifetime: "windowed",
  apply(e) {
    if (overT > 0) {
      // Inside the window: LADDER the payout. Deliberately does not extend the
      // clock — see OVERCHARGE_LOCKOUT for why, with 8-10 machines on a floor.
      rung += 1;
      const share = overchargeShareFor(rung);
      const bonus = Math.round((e.gold ?? 0) * share);
      pay(bonus);
      showPickupNote(`⚡ OVERCHARGE ×${(1 + share).toFixed(2)} · +${bonus}g`);
      return true;
    }
    if (lockT > 0) return false; // the rails are still cooling
    overT = OVERCHARGE_TIME;
    rung = 0;
    pulseT = 0;
    hotId = e.id;
    state.shakeT = Math.max(state.shakeT, 0.3);
    sfxSpring();
    showToast("⚡ OVERCHARGE", `${e.name.toUpperCase()} lit the rails — jackpots pay more for ${OVERCHARGE_TIME}s`);
    state.hudDirty = true;
    return true;
  },
  tick(dt) {
    if (overT > 0) {
      overT -= dt;
      pulseT -= dt;
      if (pulseT <= 0) {
        pulseT = OVERCHARGE_PULSE;
        pulse();
      }
      if (overT > 0) return;
      overT = 0;
      rung = 0;
      hotId = -1;
      lockT = OVERCHARGE_LOCKOUT;
      showPickupNote("⚡ the rails cool");
      state.hudDirty = true;
      return;
    }
    if (lockT > 0) lockT = Math.max(0, lockT - dt);
  },
  reset() {
    overT = 0;
    lockT = 0;
    rung = 0;
    pulseT = 0;
    hotId = -1;
  },
  describe() {
    return overT > 0 ? `overcharge ${overT.toFixed(1)}s ×${(1 + overchargeShareFor(rung)).toFixed(2)}` : null;
  },
};

registerMachineEffect(vaultSealEffect);
registerMachineEffect(overchargeEffect);

// ── The tick ──────────────────────────────────────────────────────────────

/**
 * Age the windows, then apply everything the machines did.
 *
 * AGE FIRST, DRAIN SECOND, on purpose: a window armed by an event drained this
 * frame must get its whole declared length rather than one frame less, and a
 * window that lapses this frame must be shut before an event can ladder it.
 *
 * Driven from `sim/loop.ts` beside `updateShots`, which is what ticks
 * `machines.ts` itself.
 */
export function updateMachineEffects(dt: number): void {
  for (const fx of effects) fx.tick?.(dt);
  const events = drainMachineEvents();
  if (events.length === 0) return;
  for (const e of events) {
    for (const fx of effects) {
      if (wants(fx, e)) fx.apply!(e);
    }
  }
}

/**
 * FLOOR-SCOPED, like `machines.resetMachines()`, `state.orbitLaps` and
 * `state.namedPaid`. Called from `installLampPuzzle` (arrival) and
 * `disposeLampPuzzle` (teardown) — the two ends of the per-floor path this
 * slice owns a file on. Anything queued but not yet applied goes with it: an
 * event earned on the last floor must not be spent on this one.
 */
export function resetMachineEffects(): void {
  for (const fx of effects) fx.reset();
  drainMachineEvents();
}

/** One line per live effect, for the dev overlay. */
export function describeMachineEffects(): string[] {
  const out: string[] = [];
  for (const fx of effects) {
    const s = fx.describe?.();
    if (s) out.push(s);
  }
  return out;
}
