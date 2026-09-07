/**
 * MACHINE STATE — what a placed pinball MACHINE is doing right now.
 *
 * `maze/assembly-lib.ts` authors machines (an orbit, a ramp-return, a target
 * bank, a pop nest…) and `maze/assembly-place.ts` stamps an `AssemblyRef` onto
 * every part it lands, so a floor's plan genuinely knows that these six spots
 * are ONE Orbit. Until now that identity died at the runtime seam: the plan
 * builder copied ten sibling fields off a part spot and not `asm`, and a grep
 * found `asm` read only by `dev/pattern-census.ts` and `dev/floor-svg.ts` —
 * both offline tools. The playing game could not name a machine, so it could
 * not reward completing one. This module is the half that was missing.
 *
 * ── What this replaces, and why it is not a refactor ───────────────────────
 *
 * `shots.ts hitOrbitRail` tracked lap progress in ONE GLOBAL SLOT —
 * `state.orbitActive`, `state.orbitLast`, `state.orbitCount` — against a
 * hardcoded `% 4`. Three defects come straight out of that shape:
 *
 *   1. Two circuits on one floor fought over the slot. Interleaving them made
 *      every hit look like a lapse of the other, so neither could complete.
 *   2. `% 4` is the ring's length as a LITERAL. A three-corner or six-corner
 *      machine could not be expressed at all, and the library authors both.
 *   3. A lapsed window CONFISCATED the lap: `orbitCount` went to 0. One missed
 *      timed shot erased four good shots, which reads as the table cheating.
 *
 * So: a record per `asm.id`, a length DERIVED from the parts the floor actually
 * placed, and a lapse that costs ONE STEP.
 *
 * ── The lifecycle ─────────────────────────────────────────────────────────
 *
 *   unlit → qualifying → lit → armed → collected → cooling → unlit
 *
 * `qualifying` is the sequence: hit the machine's steps in order. Completing it
 * lights the machine. `lit` spins up for MACHINE_ARM_TIME and becomes `armed`
 * on the CLOCK, not on a hit — deliberately, so that "finish the sequence" and
 * "collect the jackpot" are always two different shots. If arming were a hit
 * instead, a fast return would arm and a slow one would collect: the same shot
 * doing two different things depending on travel time, which is exactly the
 * kind of thing a player reads as a bug. `collected` is the payout instant,
 * `cooling` is the machine visibly spent, and then it re-arms one tier higher.
 *
 * ── Purity ────────────────────────────────────────────────────────────────
 *
 * No THREE, no DOM, and NO GOLD. The core — `advanceMachine`, `tickMachine`,
 * `machineGold`, `circuitAdvance` — takes explicit arguments and mutates only
 * what it is handed, so the whole model is testable without a live floor. The
 * live layer below it (the registry, the queue) reads `state.pinballParts` to
 * derive a machine's length and nothing else. Paying and announcing belong to
 * `shots.ts`, which already owns the one `pay()` helper the game banks through;
 * this module only ever says WHAT HAPPENED.
 */
import { state, type PinballPart } from "./state";
import {
  MACHINE_WINDOW,
  MACHINE_ARM_TIME,
  MACHINE_ARM_WINDOW,
  MACHINE_COOL_TIME,
  MACHINE_GOLD,
  MACHINE_STEP_GOLD,
  MACHINE_TIER_MAX,
  MACHINE_TIER_BONUS,
  MACHINE_CIRCUIT_WINDOW,
  MACHINE_CIRCUIT_MAX,
  MACHINE_CIRCUIT_STEP,
  MACHINE_EVENT_CAP,
} from "./constants";

export type MachinePhase = "unlit" | "qualifying" | "lit" | "armed" | "collected" | "cooling";

export interface MachineState {
  /** Per-floor id of the PLACED machine — `AssemblyRef.id`, not the library's. */
  id: number;
  /** Which machine definition it came from ("orbit", "target-bank", …). */
  name: string;
  /**
   * How many steps this machine's sequence has ON THIS FLOOR — the count of
   * distinct `seq` values among its parts. Never a literal: that is defect 2.
   */
  total: number;
  phase: MachinePhase;
  /** Steps of the sequence completed, 0..total. */
  step: number;
  /** The `seq` of the last step taken, or -1. The NEXT one wanted is
   *  `(last + 1) % total`, which is what makes a ring wrap. */
  last: number;
  /** Seconds left before the current step decays. */
  windowT: number;
  /** Seconds left of the lit machine's spin-up before it arms. */
  armT: number;
  /** Seconds left of the spent machine's cooldown before it re-arms. */
  coolT: number;
  /** 1..MACHINE_TIER_MAX — scales the payout. Ladders on each collect. */
  tier: number;
  /** Completions this floor. Telemetry for the slice that reacts to them. */
  runs: number;
}

/**
 * CIRCUIT CONTINUITY — floor-wide, one per floor rather than one per machine.
 * The multiplier for working the TABLE: alternating between machines extends
 * it, hammering one does not. See `circuitAdvance` for why the two cases differ
 * in how they treat the window as well as the chain.
 */
export interface CircuitState {
  /** Id of the machine last advanced, or -1. */
  last: number;
  /** Alternations in the live chain, 0..MACHINE_CIRCUIT_MAX. */
  chain: number;
  /** Seconds left before the chain lapses. */
  t: number;
}

/**
 * What a machine just did. Deliberately a VALUE with no behaviour attached: the
 * slice that makes a completed machine change the dungeon subscribes to these
 * rather than being called from inside the state machine, so that slice can
 * land without this file learning about doors, loot or floors.
 */
export interface MachineEvent {
  kind: "advance" | "lit" | "armed" | "collected";
  id: number;
  name: string;
  /** Steps done at the moment of the event, and the machine's total. */
  step: number;
  total: number;
  /** The tier this event happened AT — for `collected`, the tier it paid at. */
  tier: number;
  /** `collected` only: the payout, after tier and circuit multiplier. */
  gold?: number;
  /** `collected` only: the floor's circuit multiplier when it was collected. */
  mult?: number;
}

export function newMachine(id: number, name: string, total: number): MachineState {
  return {
    id,
    name,
    total: Math.max(1, total),
    phase: "unlit",
    step: 0,
    last: -1,
    windowT: 0,
    armT: 0,
    coolT: 0,
    tier: 1,
    runs: 0,
  };
}

export function newCircuit(): CircuitState {
  return { last: -1, chain: 0, t: 0 };
}

function ev(m: MachineState, kind: MachineEvent["kind"]): MachineEvent {
  return { kind, id: m.id, name: m.name, step: m.step, total: m.total, tier: m.tier };
}

/**
 * The multiplier a tier is worth. CLAMPED at both ends, and the clamp is the
 * point: `tierMult` is what `machineGold` is built on, so capping here caps the
 * payout everywhere rather than at each call site.
 */
export function tierMult(tier: number): number {
  const t = Math.min(MACHINE_TIER_MAX, Math.max(1, Math.floor(tier)));
  return 1 + (t - 1) * MACHINE_TIER_BONUS;
}

/**
 * What a completed machine pays. Longer machines pay more because they ARE
 * more — a six-corner orbit is four more shots than a two-part sling pair, and
 * paying both the same is what makes a player ignore the hard one.
 */
export function machineGold(total: number, tier: number, mult: number): number {
  const base = MACHINE_GOLD + Math.max(0, Math.max(1, total) - 1) * MACHINE_STEP_GOLD;
  return Math.round(base * tierMult(tier) * Math.max(1, mult));
}

/**
 * Step the machine on a hit of the part carrying `seq`, and say what happened.
 *
 * `seq === undefined` is a part of the machine with no place in its order (a
 * dress piece, or any part of a machine the library authored without a
 * sequence). On a one-step machine it IS the step; on a sequenced one it is
 * scenery and must not advance anything — otherwise a pop nest's spare bumper
 * would qualify an orbit.
 */
export function advanceMachine(m: MachineState, seq: number | undefined): MachineEvent[] {
  // A spent machine ignores hits. The cooldown is the point: without it the
  // collect shot's own rebound would immediately start the next qualification.
  if (m.phase === "cooling" || m.phase === "collected") return [];

  if (m.phase === "armed") {
    m.runs++;
    m.phase = "collected";
    m.coolT = MACHINE_COOL_TIME;
    m.windowT = 0;
    m.armT = 0;
    // The event carries the tier it PAID at, so the ladder is stamped after.
    const out = [ev(m, "collected")];
    m.tier = Math.min(MACHINE_TIER_MAX, m.tier + 1);
    return out;
  }

  // Lit but not yet armed: the lamp chase. A hit here is not progress and not a
  // collect — see the header on why arming is on the clock rather than on this.
  if (m.phase === "lit") return [];

  if (m.total <= 1) {
    if (seq !== undefined && seq !== 0) return [];
    m.step = 1;
    m.last = 0;
  } else {
    if (seq === undefined) return [];
    const wanted = m.last < 0 ? -1 : (m.last + 1) % m.total;
    // A hit out of sequence is a FRESH ATTEMPT STARTING HERE, not a skip
    // forward and not a wipe — the one instinct the legacy orbit had right.
    if (m.windowT > 0 && seq === wanted) m.step++;
    else m.step = 1;
    m.last = seq;
  }

  m.windowT = MACHINE_WINDOW;
  m.phase = "qualifying";
  const out = [ev(m, "advance")];
  if (m.step >= m.total) {
    m.step = m.total;
    m.phase = "lit";
    m.armT = MACHINE_ARM_TIME;
    m.windowT = 0;
    // ⚠️ THE BANK RESETS THE MOMENT THE MACHINE LIGHTS, not when it arms.
    //
    // A real drop-target bank does exactly this, and here it is load-bearing
    // rather than cosmetic: the collect shot needs something standing to hit,
    // and a machine whose sequence is nothing but targets (`target-bank`, and
    // the three-target bank guarding `gargoyle-scoop`'s maw) has no other part.
    // Hold the bank down through `lit` and such a machine lights, arms, and can
    // never be collected — a jackpot that cannot be claimed.
    //
    // `runHolds` is false outside `qualifying`, so this releases the whole bank
    // rather than picking parts, which is what makes it the same rule as the
    // lapse and the cooldown rather than a special case.
    rearmOneShots(m);
    out.push(ev(m, "lit"));
  }
  return out;
}

/**
 * Age one machine's clocks. Every timed transition lives here so that a floor
 * that is not being ticked cannot half-progress.
 *
 * The decay is the design correction this module exists for: a lapsed window
 * drops ONE step and starts a fresh window, so falling from step 4 to nothing
 * costs four whole windows of doing nothing. `last` walks back with it, so the
 * step the player just lost is the step the machine now wants again — a decayed
 * machine has to be walkable or the decay is a wipe with extra ceremony.
 */
export function tickMachine(m: MachineState, dt: number): MachineEvent[] {
  // `collected` is the payout INSTANT — one frame wide — and falls straight
  // through into the cooldown it started, rather than costing a tick of its
  // own. Costing a tick would make the cooldown's length depend on the frame
  // rate, which is the sort of thing that only shows up on someone else's box.
  if (m.phase === "collected") m.phase = "cooling";
  if (m.phase === "cooling") {
    m.coolT -= dt;
    if (m.coolT <= 0) {
      m.coolT = 0;
      m.phase = "unlit";
      m.step = 0;
      m.last = -1;
      m.windowT = 0;
      // The run is over and holds nothing, so the whole bank stands back up.
      rearmOneShots(m);
    }
    return [];
  }
  if (m.phase === "lit") {
    m.armT -= dt;
    if (m.armT > 0) return [];
    m.armT = 0;
    m.phase = "armed";
    m.windowT = MACHINE_ARM_WINDOW;
    // ⚠️ THE LOAD-BEARING CALL. `runHolds` is false outside `qualifying`, so
    // arming releases the machine's whole bank — and it must, because a machine
    // whose sequence is nothing but targets (`target-bank`, and the bank
    // guarding `gargoyle-scoop`'s maw) would otherwise light, arm, and have no
    // part left standing to take the collect shot. It would be a jackpot that
    // can never be claimed. A real drop-target bank resets when it completes;
    // here it MUST.
    rearmOneShots(m);
    return [ev(m, "armed")];
  }
  if (m.phase !== "qualifying" && m.phase !== "armed") return [];
  if (m.windowT <= 0) return [];

  m.windowT -= dt;
  if (m.windowT > 0) return [];

  // An armed machine that was never collected falls back INTO the sequence one
  // step down, rather than to nothing. Same rule as a qualifying lapse.
  m.step = Math.max(0, m.step - 1);
  if (m.step <= 0) {
    m.step = 0;
    m.phase = "unlit";
    m.last = -1;
    m.windowT = 0;
    rearmOneShots(m); // decayed to nothing — the bank is released with the run
    return [];
  }
  m.phase = "qualifying";
  m.last = m.total > 0 ? (m.last - 1 + m.total) % m.total : -1;
  m.windowT = MACHINE_WINDOW;
  // A lapse gives back exactly the ONE target it just cost you: the run now
  // holds one step fewer, so `runHolds` releases that step's target and no
  // other. Handing back the whole bank would make a lapse free; handing back
  // nothing would leave the step the machine now wants again unhittable.
  rearmOneShots(m);
  return [];
}

/**
 * Note that machine `id` was advanced, and extend the floor's circuit if that
 * was an ALTERNATION.
 *
 * A repeat deliberately does neither of the two things an alternation does: it
 * does not raise the chain, and it does not refresh the window. Refreshing on a
 * repeat would let one machine hold a multiplier it never earned, which is the
 * exact behaviour the multiplier exists to discourage.
 */
export function circuitAdvance(c: CircuitState, id: number): void {
  if (c.last === id) return; // held, not extended, and not refreshed
  if (c.last >= 0 && c.t > 0) c.chain = Math.min(MACHINE_CIRCUIT_MAX, c.chain + 1);
  else c.chain = 0; // the chain had lapsed (or never started) — this is its first link
  c.last = id;
  c.t = MACHINE_CIRCUIT_WINDOW;
}

export function circuitTick(c: CircuitState, dt: number): void {
  if (c.t <= 0) return;
  c.t -= dt;
  if (c.t > 0) return;
  c.t = 0;
  c.chain = 0;
  c.last = -1;
}

export function circuitMult(c: CircuitState): number {
  return 1 + Math.min(MACHINE_CIRCUIT_MAX, c.chain) * MACHINE_CIRCUIT_STEP;
}

// ── The live layer: one registry per floor ─────────────────────────────────

const machines = new Map<number, MachineState>();
let circuit: CircuitState = newCircuit();
const queue: MachineEvent[] = [];
const listeners = new Set<(e: MachineEvent) => void>();

/**
 * How many steps machine `id` has on THIS floor: the number of distinct `seq`
 * values among the parts carrying its ref.
 *
 * Distinct values rather than a part count, because the placer can land two
 * parts at the same position in a machine's order (a sling pair's two arms are
 * one beat), and counting those twice would author a sequence the floor cannot
 * complete.
 */
export function machineTotal(id: number): number {
  const seqs = new Set<number>();
  for (const p of state.pinballParts) {
    if (p.asm?.id !== id) continue;
    if (p.asm.seq !== undefined) seqs.add(p.asm.seq);
  }
  return Math.max(1, seqs.size);
}

/**
 * ── ONE-SHOT PARTS: a machine's drop targets, and the ruling that lets a bank
 *    be run twice ────────────────────────────────────────────────────────────
 *
 * `PinballPart.done` is the problem. A `target` sets it the moment it breaks and
 * nothing ever clears it. That is exactly right for a LOOSE target — the floor's
 * "break them all" objective IS "every bullseye down, permanently", and
 * `state.targetsTotal` / `targetsHit` count on it — and it is fatal for a
 * machine. `target-bank` is three targets and nothing else; `gargoyle-scoop` is
 * three targets guarding a maw, and the placer lands it ~3.2 times per floor at
 * depth 24. A machine whose steps are targets could qualify ONCE per floor and
 * never tier: the whole tier/cooldown ladder above simply not happening.
 *
 * The fix NOT taken was to drop `target` out of the derived sequence, so a bank
 * decorates and never gates. It guts the two machines it is meant to rescue:
 * `target-bank`'s sequence would be EMPTY (clamped to one step, satisfied by one
 * hit anywhere), and `gargoyle-scoop` would collapse to "hit the maw" with its
 * bank as scenery. `assembly-lib`'s own header says THE BANK GUARDS THE MOUTH.
 * A fix that makes the guard decorative has fixed the test, not the machine.
 *
 * So a machine stands its OWN one-shot parts back up. Three rules make that safe:
 *
 *  1. CLEAR-ONLY. Nothing here ever sets `done`. Breaking a target is the
 *     player's business and the collide handler's; a machine may only stand one
 *     back up, so it can neither deny a shot nor award one it was not given.
 *  2. ITS OWN PARTS, BY `asm.id`. A loose target carries no `asm`, so no machine
 *     can reach it, and the floor objective is untouched. `machines.test.ts`
 *     spends a whole test on that one non-regression.
 *  3. NOT WHILE THE RUN HOLDS IT. Through `qualifying` the steps already banked
 *     stay down — the bank you broke stays broken — and a lapsed window stands
 *     back up exactly the ONE target it just cost you. That is what makes the
 *     decay in `tickMachine` walkable rather than a wipe: the step the machine
 *     now wants again is a target the player can actually hit again.
 *
 * And the rule that reads as wrong until you try to collect without it: THE BANK
 * RESETS AT `lit`. Every phase after qualifying — lit, armed, collected, cooling
 * — holds nothing, so the whole bank comes back up the instant the sequence
 * completes. A real drop-target bank resets when it completes; here it MUST,
 * because the collect shot is a hit on a part of the machine and a machine made
 * of nothing but targets has no other part to hit. Hold the bank down through
 * `armed` and `target-bank` lights, arms, and can never be collected — a jackpot
 * with no button on it.
 *
 * ⚠️ The re-arm is state-only. `render/pinball-parts.ts` tips a broken target's
 * rings over with a one-way `Math.min(π/2.2, rot + dt*6)` and has no path back,
 * so a re-armed target re-lights but stays lying down until that renderer grows
 * a stand-up. That file is not this slice's to change; the flag it reads is
 * correct from here down.
 */
const ONE_SHOT_KINDS: readonly PinballPart["kind"][] = ["target"];

/**
 * Is `seq` one of the steps this machine's CURRENT run has banked?
 *
 * The held steps are the last `step` of them walking BACK from `last`, not
 * `0..step-1`: an out-of-order hit restarts the run at the step it landed on, so
 * a run of three can be seqs 2-3-0 as easily as 0-1-2. Deriving it from `last`
 * is the same arithmetic `advanceMachine` and `tickMachine` use to decide what
 * comes next, which is what keeps the bank and the sequence telling one story.
 */
function runHolds(m: MachineState, seq: number | undefined): boolean {
  if (m.phase !== "qualifying" || m.step <= 0 || m.last < 0) return false;
  // A one-step machine's single part IS its run, authored with a seq or not.
  if (m.total <= 1) return (seq ?? 0) === 0;
  // Scenery on a sequenced machine has no place in the order, so it can never
  // have been the thing that advanced it — see `advanceMachine`.
  if (seq === undefined) return false;
  for (let k = 0; k < m.step; k++) {
    if ((((m.last - k) % m.total) + m.total) % m.total === seq) return true;
  }
  return false;
}

/** Stand back up every one of THIS machine's one-shot parts that its current
 *  run is no longer holding down. Clear-only, and `asm.id`-scoped: see above. */
function rearmOneShots(m: MachineState): void {
  for (const p of state.pinballParts) {
    if (p.asm?.id !== m.id) continue;
    if (!ONE_SHOT_KINDS.includes(p.kind)) continue;
    if (p.done && !runHolds(m, p.asm.seq)) p.done = false;
  }
}

/** The record for this part's machine, created on first contact. Null for a
 *  loose part — those still belong to the legacy orbit/lane bookkeeping. */
export function machineFor(part: PinballPart): MachineState | null {
  const ref = part.asm;
  if (!ref) return null;
  let m = machines.get(ref.id);
  if (!m) {
    m = newMachine(ref.id, ref.name, machineTotal(ref.id));
    machines.set(ref.id, m);
  }
  return m;
}

function publish(events: MachineEvent[]): void {
  for (const e of events) {
    queue.push(e);
    // A queue nothing drains must not grow for a whole run. Dropping the OLDEST
    // is the right end to lose: a consumer that woke up late wants the recent
    // events, and `collected` is the one it cares about.
    if (queue.length > MACHINE_EVENT_CAP) queue.shift();
    for (const fn of listeners) fn(e);
  }
}

/**
 * A part of a machine was hit. Returns what happened, and queues the same
 * events for anything polling. `shots.ts` uses the return value to pay and
 * announce; a later slice uses the queue to change the world.
 */
export function hitMachine(part: PinballPart): MachineEvent[] {
  const m = machineFor(part);
  if (!m) return [];
  const events = advanceMachine(m, part.asm?.seq);
  if (events.length === 0) return events;

  // The circuit moves on PROGRESS, not on contact — otherwise hammering a
  // cooling machine would hold the multiplier open for free.
  circuitAdvance(circuit, m.id);
  const mult = circuitMult(circuit);
  for (const e of events) {
    if (e.kind !== "collected") continue;
    e.mult = mult;
    e.gold = machineGold(e.total, e.tier, mult);
  }
  publish(events);
  return events;
}

/** Age every machine on the floor plus the circuit chain. */
export function tickMachines(dt: number): MachineEvent[] {
  const events: MachineEvent[] = [];
  for (const m of machines.values()) events.push(...tickMachine(m, dt));
  circuitTick(circuit, dt);
  publish(events);
  return events;
}

/**
 * FLOOR-SCOPED, like `state.orbitLaps`, `state.laneLit` and `state.namedPaid`.
 * A machine's tier, its progress and the floor's circuit chain are all about
 * ONE floor; carrying any of them down the stairs would mean arriving on depth
 * 8 with a tier-4 orbit that was never run there.
 */
export function resetMachines(): void {
  machines.clear();
  circuit = newCircuit();
  queue.length = 0;
}

/** Take every queued event and leave the queue empty — draining twice yields
 *  nothing the second time, so a consumer cannot double-apply a `collected`. */
export function drainMachineEvents(): MachineEvent[] {
  return queue.splice(0, queue.length);
}

/** Subscribe to events as they happen. Returns the unsubscribe. */
export function onMachineEvent(fn: (e: MachineEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Read-only views, for the HUD, the dev overlay and tests. */
export function machineRegistry(): ReadonlyMap<number, MachineState> {
  return machines;
}

export function machineCircuit(): Readonly<CircuitState> {
  return circuit;
}
