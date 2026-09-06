/**
 * WHAT THE MACHINE LAYER LOOKS LIKE FROM THE PLAYER'S SEAT.
 *
 * `machines.ts` runs a lifecycle per machine and `machine-effects.ts` turns a
 * completion into a change in the world, and between them they announce with
 * toasts, sparks and the chest's own colour ramp. All of that is a REPORT AFTER
 * THE FACT. None of it answers the question a player has while the ball is
 * still moving: *what is this machine waiting for, and how long have I got?*
 *
 * Without that the sequence is invisible. A three-step orbit reads as three
 * unrelated bumps followed, sometimes, by a toast — which is precisely the
 * "score checklist" the whole layer exists to stop being. So this is the
 * readout: one machine at a time, its progress, and the clock that is running
 * against it.
 *
 * ── WHY THIS FILE HOLDS NO DRAWING ────────────────────────────────────────
 *
 * Everything here is a pure read of `machines.ts` / `machine-effects.ts` into
 * plain values. `gui/screens/hud.ts` paints them and owns every pixel decision.
 * The split is not tidiness: the interesting part is the CHOICE — which of a
 * floor's four machines to show, when to show nothing, which clock is the one
 * that matters in each phase — and a choice buried in a paint call can only be
 * tested through a canvas. Here it is a function that returns a value, and
 * `hud-machines.test.ts` drives every phase through it without a DOM.
 *
 * No THREE, no DOM, no `document`. `gui/no-dom.test.ts` enforces that for the
 * whole gui layer and this sits one step behind it.
 */
import {
  MACHINE_WINDOW,
  MACHINE_ARM_TIME,
  MACHINE_ARM_WINDOW,
  MACHINE_COOL_TIME,
  MACHINE_CIRCUIT_WINDOW,
} from "./constants";
import { machineRegistry, machineCircuit, circuitMult, type MachinePhase, type MachineState } from "./machines";
import {
  MACHINES_PER_SEAL,
  OVERCHARGE_TIME,
  machineVaultCharges,
  machineVaultSeals,
  overchargeActive,
  overchargeRemaining,
  overchargeRung,
  overchargeShare,
} from "./machine-effects";

/**
 * Which phase outranks which, when two machines are live at once.
 *
 * A floor can have four machines and the readout has room for one, so the tie
 * break is a design decision rather than "whichever the Map iterates first".
 * It runs by URGENCY — how soon the player loses something by looking away:
 *
 *   armed      a jackpot is sitting there and MACHINE_ARM_WINDOW is draining
 *   lit        the sequence is done and the arm spin-up is on the clock
 *   qualifying progress that a lapse costs one step of
 *   cooling    spent; nothing to do but watch it come back
 *
 * `unlit` is absent deliberately: a machine at step 0 with no clock running is
 * not news, and showing it would mean the readout is on screen permanently and
 * therefore ignored.
 */
const PHASE_RANK: Record<MachinePhase, number> = {
  armed: 4,
  lit: 3,
  qualifying: 2,
  cooling: 1,
  collected: 0,
  unlit: 0,
};

/** The clock that matters in each phase, and how long it runs for. */
const PHASE_CLOCK: Partial<Record<MachinePhase, { left: (m: MachineState) => number; full: number }>> = {
  qualifying: { left: (m) => m.windowT, full: MACHINE_WINDOW },
  lit: { left: (m) => m.armT, full: MACHINE_ARM_TIME },
  armed: { left: (m) => m.windowT, full: MACHINE_ARM_WINDOW },
  cooling: { left: (m) => m.coolT, full: MACHINE_COOL_TIME },
};

export interface MachineHudRow {
  id: number;
  /** The machine's library name, e.g. "loop-reactor". Uppercased by the painter, not here. */
  name: string;
  phase: MachinePhase;
  step: number;
  total: number;
  tier: number;
  /** Seconds left on the phase's own clock, and that clock's full length. */
  left: number;
  full: number;
  /** `left / full`, clamped to 0..1. 0 when the phase has no clock. */
  frac: number;
}

export interface OverchargeHudRow {
  remaining: number;
  /** `remaining / OVERCHARGE_TIME`, 0..1. */
  frac: number;
  /** Collects landed inside the live window. */
  rung: number;
  /** The bonus share the next in-window collect would pay, 0..1. */
  share: number;
}

export interface VaultHudRow {
  /** Distinct machines completed this floor. */
  charges: number;
  /** Machines per seal — the denominator of the pips. */
  per: number;
  /** Whole seals earned. */
  seals: number;
  /** Machines still owed on the seal in progress. */
  toNext: number;
}

export interface CircuitHudRow {
  chain: number;
  /** The floor's live payout multiplier, e.g. 1.5. */
  mult: number;
  left: number;
  frac: number;
}

export interface MachineHud {
  /** The one machine worth a line right now, or null. */
  machine: MachineHudRow | null;
  overcharge: OverchargeHudRow | null;
  vault: VaultHudRow | null;
  circuit: CircuitHudRow | null;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/**
 * Pick the machine to show.
 *
 * By phase urgency first, then by PROGRESS (a 3-of-4 orbit is a better line
 * than a 1-of-4 one), then by id so that two machines in identical states do
 * not flicker between frames — a readout that swaps every tick is worse than no
 * readout, and `Map` iteration order is an implementation detail to lean on.
 */
export function pickMachine(all: Iterable<MachineState>): MachineState | null {
  let best: MachineState | null = null;
  for (const m of all) {
    if (PHASE_RANK[m.phase] === 0) continue;
    if (!best) {
      best = m;
      continue;
    }
    const a = PHASE_RANK[m.phase];
    const b = PHASE_RANK[best.phase];
    if (a !== b) {
      if (a > b) best = m;
      continue;
    }
    if (m.step !== best.step) {
      if (m.step > best.step) best = m;
      continue;
    }
    if (m.id < best.id) best = m;
  }
  return best;
}

export function machineHudRow(m: MachineState): MachineHudRow {
  const clock = PHASE_CLOCK[m.phase];
  const left = clock ? Math.max(0, clock.left(m)) : 0;
  const full = clock ? clock.full : 0;
  return {
    id: m.id,
    name: m.name,
    phase: m.phase,
    step: m.step,
    total: m.total,
    tier: m.tier,
    left,
    full,
    frac: full > 0 ? clamp01(left / full) : 0,
  };
}

/**
 * The whole readout, as values.
 *
 * Every field is nullable and null MEANS "draw nothing" — the readout is
 * transient like the combo counter and the plunger meter, not a permanent
 * fixture. A floor whose machines are all `unlit` and whose vault has no
 * charges yields four nulls and costs the HUD nothing.
 */
export function machineHud(): MachineHud {
  const m = pickMachine(machineRegistry().values());
  const c = machineCircuit();
  const charges = machineVaultCharges();
  return {
    machine: m ? machineHudRow(m) : null,
    overcharge: overchargeActive()
      ? {
          remaining: overchargeRemaining(),
          frac: clamp01(overchargeRemaining() / OVERCHARGE_TIME),
          rung: overchargeRung(),
          share: overchargeShare(),
        }
      : null,
    // Shown from the FIRST charge, not the first whole seal: "one more machine
    // opens the vault" is the sentence that changes what a player does next,
    // and it is unreadable if the row only appears once the seal has landed.
    vault: charges > 0 ? { charges, per: MACHINES_PER_SEAL, seals: machineVaultSeals(), toNext: MACHINES_PER_SEAL - (charges % MACHINES_PER_SEAL) } : null,
    // `chain` 0 is a machine hit with nothing to alternate with yet — a real
    // multiplier of 1.0, i.e. nothing to say. The row starts at the first
    // ALTERNATION, which is the first time working the table has paid.
    circuit: c.chain > 0 ? { chain: c.chain, mult: circuitMult(c), left: Math.max(0, c.t), frac: clamp01(c.t / MACHINE_CIRCUIT_WINDOW) } : null,
  };
}

/** True when there is anything at all to draw. */
export function machineHudLive(h: MachineHud): boolean {
  return !!(h.machine || h.overcharge || h.vault || h.circuit);
}
