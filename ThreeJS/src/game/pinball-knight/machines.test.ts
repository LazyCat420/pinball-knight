/**
 * MACHINES — the per-assembly progression, and the seam that carries a machine's
 * identity into the running game.
 *
 * ## The bug this file was written against
 *
 * `maze/assembly-place.ts` stamps an `AssemblyRef` onto every part it places, so
 * a floor's level plan genuinely knows that these six spots are ONE Orbit. That
 * identity was then DROPPED at the runtime seam: `render/pinball-parts.ts`
 * copied `bank`, `seq`, `lit`, `phase`, `spin`, `variant`, `field`, `orbit`,
 * `orbitSeq`, `lane` and `laneSeq` off the spot and not `asm`. A grep at the
 * time found `asm` read by exactly two modules, `dev/pattern-census.ts` and
 * `dev/floor-svg.ts` — both offline tools. Nothing in the playing game could say
 * which machine a part belonged to, so nothing could reward completing one.
 *
 * The first test below is the one that saw that red: it builds a part spot
 * carrying an `asm` ref, runs the real `createPinballParts`, and asks the
 * runtime part what machine it is in.
 *
 * ## Why the state model is shaped the way it is
 *
 * The thing being replaced is `shots.ts hitOrbitRail`, which tracked laps in a
 * SINGLE GLOBAL SLOT — `state.orbitActive` / `orbitLast` / `orbitCount` — against
 * a hardcoded `% 4`. Three properties fall straight out of that and are pinned
 * here, because a re-simplification would quietly restore all three bugs:
 *
 *   1. Two machines on one floor must progress INDEPENDENTLY. One slot cannot.
 *   2. The sequence length is DERIVED from the parts the floor placed. `% 4`
 *      cannot express a three-corner or six-corner ring.
 *   3. A lapsed window costs ONE STEP, not the run. The old code reset to zero,
 *      which meant one missed timed shot erased everything.
 *
 * ## Where the evidence has to come from
 *
 * Measured before this file was written: across 20 floors (5 seeds × depths
 * 1/8/16/24) the count of parts carrying `orbit`/`orbitSeq` is 0.0 PER FLOOR at
 * every depth — the only producer is a rail ring gated on a room the pipeline
 * no longer emits. The legacy path is dead code in the shipped game, so the
 * legacy regression test at the bottom guards a byte-for-byte behaviour that
 * nothing exercises. It is NOT proof that machines work. Every assertion about
 * the feature itself goes through the `asm` path.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { state, freshPlayerFields, type PinballPart, type PinballPartKind } from "./state";
import { createPinballParts } from "./render/pinball-parts";
import { PART_HANDLERS, type PinballDeps } from "./entities/pinball-collide";
import type { Grid } from "./engine/grid";
import type { PinballPartSpot } from "./maze/decorate";
import type { AssemblyRef } from "./maze/assembly";
import { MACHINES } from "./maze/assembly-lib";
import { hitOrbitRail } from "./shots";
import {
  newMachine,
  newCircuit,
  advanceMachine,
  tickMachine,
  machineGold,
  tierMult,
  circuitAdvance,
  circuitMult,
  resetMachines,
  hitMachine,
  tickMachines,
  drainMachineEvents,
  machineFor,
  machineRegistry,
  type MachineState,
  type MachineEvent,
} from "./machines";
import {
  MACHINE_WINDOW,
  MACHINE_ARM_TIME,
  MACHINE_ARM_WINDOW,
  MACHINE_COOL_TIME,
  MACHINE_TIER_MAX,
  MACHINE_CIRCUIT_MAX,
  TARGET_HIT_SPEED,
} from "./constants";

/** A grid with no walls — `tileCenter` is all `createPinballParts` reads. */
function flatGrid(w = 8, h = 8): Grid {
  return { w, h, t: new Uint8Array(w * h).fill(1), shapes: new Uint8Array(w * h) };
}

function spot(i: number, j: number, kind: PartSpotKindLike, asm?: AssemblyRef): PinballPartSpot {
  return { i, j, kind, dirI: 0, dirJ: 1, dir2I: 0, dir2J: 0, asm } as PinballPartSpot;
}
type PartSpotKindLike = PinballPartSpot["kind"];

/** A live part standing in for one an assembly placed, with no mesh: every
 *  assertion here is about bookkeeping, and a mesh would only drag THREE in. */
function asmPart(id: number, name: string, seq: number | undefined, kind: PinballPartKind = "rollover"): PinballPart {
  return {
    kind,
    i: 0,
    j: 0,
    x: 0,
    z: 0,
    dirX: 0,
    dirZ: 1,
    dir2X: 0,
    dir2Z: 0,
    cooldownT: 0,
    hitT: -1,
    asm: { id, name, role: "score", seq },
    mesh: {} as never,
  };
}

/** One machine's worth of parts on the floor: `total` of them, seq 0..total-1. */
function placeMachine(id: number, name: string, total: number): PinballPart[] {
  return Array.from({ length: total }, (_, k) => asmPart(id, name, k));
}

/** Walk a live machine from unlit to armed by hitting its steps in order. */
function qualify(parts: PinballPart[]): MachineEvent[] {
  const seen: MachineEvent[] = [];
  for (const p of parts) seen.push(...hitMachine(p));
  seen.push(...tickMachines(MACHINE_ARM_TIME + 0.01));
  return seen;
}

beforeEach(() => {
  state.pinballParts = [];
  resetMachines();
});

describe("the runtime seam carries a machine's identity", () => {
  it("keeps `asm` on the part it builds from a spot that has one", () => {
    // THE BUG. `assembly-place.partsOf` stamps this ref onto every spot, and
    // `createPinballParts` used to copy ten sibling fields off the spot and not
    // this one — so an authored machine arrived in the running game as an
    // anonymous scatter of parts. Everything else in this file is downstream of
    // this single missing assignment.
    const g = flatGrid();
    const ref: AssemblyRef = { id: 7, name: "orbit", role: "turn", seq: 2 };
    state.pinballParts = [];
    createPinballParts([spot(3, 3, "rollover", ref)], g, new THREE.Scene());

    expect(state.pinballParts).toHaveLength(1);
    expect(state.pinballParts[0].asm).toEqual(ref);
  });

  it("leaves `asm` undefined on a loose part, so the legacy path still owns it", () => {
    const g = flatGrid();
    state.pinballParts = [];
    createPinballParts([spot(2, 2, "rollover")], g, new THREE.Scene());
    expect(state.pinballParts[0].asm).toBeUndefined();
  });
});

describe("a machine the LIBRARY authored survives into a live progression", () => {
  /**
   * The synthetic machines everywhere else in this file are hand-built parts.
   * This one is the shipped ORBIT definition out of `maze/assembly-lib.ts`, put
   * through the real `createPinballParts` seam and then through the real state
   * machine — because the failure this whole slice is about was not a wrong
   * number, it was an authored thing not arriving. A model that only ever
   * agrees with fixtures it built itself cannot notice that again.
   */
  it("derives ORBIT's length from its own parts and collects a full run", () => {
    const orbit = MACHINES.find((m) => m.name === "orbit");
    expect(orbit).toBeDefined();

    // The same ref `assembly-place.partsOf` stamps, on the same parts.
    const g = flatGrid(16, 16);
    const spots = orbit!.parts.map((p) =>
      spot(2 + p.ci, 2 + p.cj, p.kind, { id: 42, name: orbit!.name, role: p.role, seq: p.seq }),
    );
    state.pinballParts = [];
    createPinballParts(spots, g, new THREE.Scene());

    const live = state.pinballParts.filter((p) => p.asm?.id === 42);
    expect(live).toHaveLength(orbit!.parts.length);

    const steps = live
      .filter((p) => p.asm!.seq !== undefined)
      .sort((a, b) => a.asm!.seq! - b.asm!.seq!);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(machineFor(steps[0])!.total).toBe(new Set(steps.map((p) => p.asm!.seq)).size);

    const seen = qualify(steps);
    expect(seen.filter((e) => e.kind === "lit")).toHaveLength(1);
    const collected = hitMachine(steps[0]);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ kind: "collected", name: "orbit" });
    expect(collected[0].gold).toBeGreaterThan(0);
  });
});

describe("two machines on one floor progress independently", () => {
  it("does not let one machine's step count bleed into the other's", () => {
    // The property the single global slot (`state.orbitActive` + `orbitCount`)
    // could not have: interleaving two circuits used to make each hit look like
    // a lapse of the other, so neither ever completed.
    const a = placeMachine(1, "orbit", 4);
    const b = placeMachine(2, "rollover-bank", 3);
    state.pinballParts = [...a, ...b];

    hitMachine(a[0]);
    hitMachine(b[0]);
    hitMachine(a[1]);
    hitMachine(b[1]);

    const ma = machineFor(a[0]);
    const mb = machineFor(b[0]);
    expect(ma?.step).toBe(2);
    expect(ma?.total).toBe(4);
    expect(mb?.step).toBe(2);
    expect(mb?.total).toBe(3);
  });

  it("completes one machine while the other is still mid-sequence", () => {
    const a = placeMachine(1, "orbit", 3);
    const b = placeMachine(2, "ramp-return", 3);
    state.pinballParts = [...a, ...b];

    hitMachine(b[0]); // b takes one step and is then left alone
    const seen = qualify(a);

    expect(seen.filter((e) => e.kind === "lit").map((e) => e.id)).toEqual([1]);
    expect(machineFor(a[0])?.phase).toBe("armed");
    expect(machineFor(b[0])?.step).toBe(1);
    expect(machineFor(b[0])?.phase).toBe("qualifying");
  });
});

describe("the sequence length is derived from the parts on the floor", () => {
  for (const total of [3, 4, 6]) {
    it(`completes and collects a ${total}-step machine`, () => {
      // The hardcoded `% 4` could only ever express one of these three.
      const parts = placeMachine(1, "orbit", total);
      state.pinballParts = parts;

      const seen = qualify(parts);
      expect(seen.filter((e) => e.kind === "advance")).toHaveLength(total);
      expect(seen.filter((e) => e.kind === "lit")).toHaveLength(1);
      expect(seen.filter((e) => e.kind === "armed")).toHaveLength(1);
      expect(seen.at(-1)).toMatchObject({ kind: "armed", total });

      const collected = hitMachine(parts[0]);
      expect(collected).toHaveLength(1);
      expect(collected[0]).toMatchObject({ kind: "collected", id: 1, total });
      expect(collected[0].gold).toBeGreaterThan(0);
    });
  }

  it("reports the derived total on every event it emits", () => {
    const parts = placeMachine(1, "orbit", 6);
    state.pinballParts = parts;
    const seen = qualify(parts);
    expect(seen.length).toBeGreaterThan(0); // `every` on [] is vacuously true
    expect(seen.every((e) => e.total === 6)).toBe(true);
  });
});

describe("a lapsed window decays progress by one step, it does not confiscate it", () => {
  it("steps back one, and takes another whole window to lose the next", () => {
    // The explicit design correction. The old orbit reset `orbitCount` to 0 the
    // instant the window lapsed, so one missed timed shot erased four good ones.
    const m = newMachine(1, "orbit", 4);
    advanceMachine(m, 0);
    advanceMachine(m, 1);
    advanceMachine(m, 2);
    expect(m.step).toBe(3);

    tickMachine(m, MACHINE_WINDOW + 0.01);
    expect(m.step).toBe(2);
    expect(m.phase).toBe("qualifying");

    tickMachine(m, MACHINE_WINDOW + 0.01);
    expect(m.step).toBe(1);
    expect(m.phase).toBe("qualifying");
  });

  it("expects the step BEFORE the one it just lost, so the decay is walkable", () => {
    const m = newMachine(1, "orbit", 4);
    advanceMachine(m, 0);
    advanceMachine(m, 1);
    advanceMachine(m, 2);
    tickMachine(m, MACHINE_WINDOW + 0.01); // step 3 → 2, so seq 2 is wanted again
    const back = advanceMachine(m, 2);
    expect(back.map((e) => e.kind)).toEqual(["advance"]);
    expect(m.step).toBe(3);
  });

  it("falls all the way to unlit only after one window per step", () => {
    const m = newMachine(1, "orbit", 3);
    advanceMachine(m, 0);
    advanceMachine(m, 1);
    tickMachine(m, MACHINE_WINDOW + 0.01);
    expect(m.step).toBe(1);
    tickMachine(m, MACHINE_WINDOW + 0.01);
    expect(m.step).toBe(0);
    expect(m.phase).toBe("unlit");
  });

  it("decays an ARMED machine back into the sequence rather than to nothing", () => {
    const m = newMachine(1, "orbit", 4);
    for (const s of [0, 1, 2, 3]) advanceMachine(m, s);
    tickMachine(m, MACHINE_ARM_TIME + 0.01);
    expect(m.phase).toBe("armed");

    tickMachine(m, MACHINE_ARM_WINDOW + 0.01);
    expect(m.phase).toBe("qualifying");
    expect(m.step).toBe(3);
  });
});

describe("the tier ladder scales the payout and is capped", () => {
  it("pays more at each tier", () => {
    const gold = [1, 2, 3, 4].map((t) => machineGold(4, t, 1));
    for (let k = 1; k < gold.length; k++) expect(gold[k]).toBeGreaterThan(gold[k - 1]);
  });

  it("stops paying more past MACHINE_TIER_MAX", () => {
    const capped = machineGold(4, MACHINE_TIER_MAX, 1);
    expect(capped).toBeGreaterThan(0); // 0 === 0 would satisfy the cap for free
    expect(machineGold(4, MACHINE_TIER_MAX + 1, 1)).toBe(capped);
    expect(machineGold(4, MACHINE_TIER_MAX + 9, 1)).toBe(capped);
    expect(tierMult(MACHINE_TIER_MAX + 5)).toBe(tierMult(MACHINE_TIER_MAX));
  });

  it("pays a longer machine more than a short one at the same tier", () => {
    expect(machineGold(6, 1, 1)).toBeGreaterThan(machineGold(3, 1, 1));
  });

  it("ladders the tier when the SAME machine is run again", () => {
    const parts = placeMachine(1, "orbit", 3);
    state.pinballParts = parts;

    qualify(parts);
    const first = hitMachine(parts[0]);
    expect(first[0]).toMatchObject({ kind: "collected", tier: 1 });

    tickMachines(MACHINE_COOL_TIME + 0.01); // collected → cooling → unlit
    expect(machineFor(parts[0])?.phase).toBe("unlit");
    expect(machineFor(parts[0])?.tier).toBe(2);

    qualify(parts);
    const second = hitMachine(parts[0]);
    expect(second[0]).toMatchObject({ kind: "collected", tier: 2 });
    expect(second[0].gold!).toBeGreaterThan(first[0].gold!);
  });

  it("caps the tier a machine can reach", () => {
    const m = newMachine(1, "orbit", 2);
    for (let run = 0; run < MACHINE_TIER_MAX + 4; run++) {
      advanceMachine(m, 0);
      advanceMachine(m, 1);
      tickMachine(m, MACHINE_ARM_TIME + 0.01);
      advanceMachine(m, 0); // collect
      tickMachine(m, MACHINE_COOL_TIME + 0.01);
    }
    expect(m.tier).toBe(MACHINE_TIER_MAX);
  });
});

describe("circuit continuity rewards working the table, not one machine", () => {
  it("extends on A → B → A", () => {
    const c = newCircuit();
    circuitAdvance(c, 1);
    circuitAdvance(c, 2);
    circuitAdvance(c, 1);
    expect(c.chain).toBe(2);
    expect(circuitMult(c)).toBeGreaterThan(1);
  });

  it("does NOT extend on A → A", () => {
    const c = newCircuit();
    circuitAdvance(c, 1);
    circuitAdvance(c, 1);
    circuitAdvance(c, 1);
    expect(c.chain).toBe(0);
    expect(circuitMult(c)).toBe(1);
    // POSITIVE CONTROL, in the same test: a chain that never moves would pass
    // the two assertions above for the wrong reason. One alternation must move
    // it, from exactly the state the repeats left behind.
    circuitAdvance(c, 2);
    expect(c.chain).toBe(1);
  });

  it("caps the chain", () => {
    const c = newCircuit();
    for (let k = 0; k < MACHINE_CIRCUIT_MAX + 6; k++) circuitAdvance(c, k % 2);
    expect(c.chain).toBe(MACHINE_CIRCUIT_MAX);
  });

  it("raises the payout of a machine collected on an alternating circuit", () => {
    const a = placeMachine(1, "orbit", 3);
    state.pinballParts = a;
    qualify(a);
    const solo = hitMachine(a[0])[0].gold!;

    resetMachines();
    const b = placeMachine(1, "orbit", 3);
    const other = placeMachine(2, "rollover-bank", 3);
    state.pinballParts = [...b, ...other];
    for (let k = 0; k < 3; k++) {
      hitMachine(b[k]);
      hitMachine(other[k]);
    }
    tickMachines(MACHINE_ARM_TIME + 0.01);
    const woven = hitMachine(b[0])[0].gold!;
    expect(woven).toBeGreaterThan(solo);
  });
});

describe("an out-of-order hit restarts qualifying at that step", () => {
  it("does not advance the count, and expects the step after the one hit", () => {
    // The legacy orbit's one good instinct, kept: railing a corner out of
    // sequence is a fresh attempt starting THERE, not a lap that skipped ahead.
    const m = newMachine(1, "orbit", 4);
    advanceMachine(m, 0);
    advanceMachine(m, 1);
    expect(m.step).toBe(2);

    advanceMachine(m, 3); // not the corner that was next
    expect(m.step).toBe(1);
    expect(m.phase).toBe("qualifying");

    advanceMachine(m, 0); // 3 → 0 wraps, so this IS the next one
    expect(m.step).toBe(2);
  });

  it("treats a repeat of the step just hit as out of order, not as progress", () => {
    const m = newMachine(1, "orbit", 4);
    advanceMachine(m, 0);
    advanceMachine(m, 0);
    expect(m.step).toBe(1);
  });

  it("cannot complete a machine by hammering one part of it", () => {
    const parts = placeMachine(1, "orbit", 3);
    state.pinballParts = parts;
    const seen: MachineEvent[] = [];
    for (let k = 0; k < 10; k++) seen.push(...hitMachine(parts[0]));
    expect(seen.filter((e) => e.kind === "lit")).toHaveLength(0);
    expect(machineFor(parts[0])?.step).toBe(1);
  });
});

describe("the event queue is a reliable one-shot feed for a later slice", () => {
  it("emits exactly one `collected` for a collect", () => {
    const parts = placeMachine(1, "orbit", 3);
    state.pinballParts = parts;
    qualify(parts);
    drainMachineEvents();

    hitMachine(parts[0]);
    expect(drainMachineEvents().filter((e) => e.kind === "collected")).toHaveLength(1);
  });

  it("does not double-emit when the queue is drained twice", () => {
    const parts = placeMachine(1, "orbit", 3);
    state.pinballParts = parts;
    qualify(parts);
    hitMachine(parts[0]);

    const first = drainMachineEvents();
    expect(first.filter((e) => e.kind === "collected")).toHaveLength(1);
    expect(drainMachineEvents()).toEqual([]);
  });

  it("queues the same events the hit returned, in order", () => {
    const parts = placeMachine(1, "orbit", 3);
    state.pinballParts = parts;
    const returned = qualify(parts);
    expect(returned.length).toBeGreaterThan(0); // [] equals [] for free
    expect(drainMachineEvents()).toEqual(returned);
  });

  it("forgets every machine on a floor reset", () => {
    const parts = placeMachine(1, "orbit", 3);
    state.pinballParts = parts;
    qualify(parts);
    expect(machineFor(parts[0])?.step).toBe(3); // there was something to forget
    resetMachines();
    expect(drainMachineEvents()).toEqual([]);
    state.pinballParts = parts;
    expect(machineFor(parts[0])?.step ?? 0).toBe(0);
  });
});

/**
 * ONE-SHOT PARTS — the drop targets a machine is built out of, and the loose
 * target that must not learn anything from them.
 *
 * A `target` sets `done: true` when it breaks and, on its own, never re-arms:
 * that is the floor's "break them all" objective, and it is correct for a loose
 * target. It is fatal for a MACHINE. `target-bank` is three targets and nothing
 * else, and `gargoyle-scoop` is three targets guarding a maw — so a machine
 * whose sequence runs through a target could qualify once per floor and never
 * tier, which is the whole tier/cooldown design not happening.
 *
 * Every assertion below goes through the REAL collide handler
 * (`PART_HANDLERS.target`, `PART_HANDLERS.maw`), not through `hitMachine`
 * directly, because the defect had two halves — the target handler never called
 * the machine at all, AND a broken target could not be hit twice. Driving the
 * state machine on its own would have shown the second half and missed the
 * first, which is the same shape of miss as testing ORBIT through
 * `hitOrbitRail`: two of its four steps are boosters that route nowhere near it.
 */
describe("a machine's drop targets re-arm with the machine; a loose target never does", () => {
  let drops = 0;

  const deps: PinballDeps = {
    startRampHop: () => {},
    startDrop: () => {
      drops += 1;
    },
    setSteerLock: () => {},
    raiseSteerLock: () => {},
    aimHint: () => null,
  };

  beforeEach(() => {
    drops = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
    state.vfx = null; // every VFX call in the handlers is optional-chained
    state.targetsTotal = 0;
    state.targetsHit = 0;
    state.goldRun = 0;
    state.shotChain = [];
    state.namedPaid = {};
  });

  /**
   * Hit `part` for real: the player on top of it, travelling INTO its face fast
   * enough to break a target (`TARGET_HIT_SPEED`) and to be swallowed by a maw
   * (`MAW_SWALLOW_SPEED` = 10, and `canMawSwallow` builds the throat as `-dir`,
   * so one vector serves both kinds).
   */
  function strike(part: PinballPart, speed = 15): void {
    const p = state.player!;
    expect(speed).toBeGreaterThan(TARGET_HIT_SPEED);
    p.x = part.x;
    p.z = part.z;
    p.momX = -part.dirX;
    p.momZ = -part.dirZ;
    p.momSpeed = speed;
    part.cooldownT = 0;
    PART_HANDLERS[part.kind]({ part, p, dx: 0, dz: 0, d2: 0, inMomentum: true, curSpeed: speed, deps });
  }

  /** A machine every step of which is a one-shot part — the `target-bank` shape. */
  function bank(id: number, n = 2): PinballPart[] {
    const parts = Array.from({ length: n }, (_, k) => asmPart(id, "target-bank", k, "target"));
    for (const p of parts) p.done = false; // what `createPinballParts` stamps
    return parts;
  }

  /** A target with no `asm`: the floor's own bullseye, owned by the objective. */
  function looseTarget(): PinballPart {
    const p = asmPart(-1, "none", undefined, "target");
    delete p.asm;
    p.done = false;
    return p;
  }

  /** One whole pass of a bank machine: break it in order, wait out the arm,
   *  take the collect shot, sit out the cooldown. Returns the `collected`s. */
  function runBank(parts: PinballPart[]): MachineEvent[] {
    drainMachineEvents();
    for (const p of parts) strike(p);
    tickMachines(MACHINE_ARM_TIME + 0.01);
    // The bank has to be STANDING here or there is nothing left to collect
    // with — see the ruling in machines.ts.
    const standing = parts.find((p) => !p.done);
    expect(standing, "a completed bank left no part standing to take the collect shot").toBeDefined();
    strike(standing!);
    const out = drainMachineEvents().filter((e) => e.kind === "collected");
    tickMachines(MACHINE_COOL_TIME + 0.01);
    return out;
  }

  it("completes a machine whose whole sequence is drop targets, TWICE", () => {
    // THE DEFECT. Before the fix the target handler never called the machine at
    // all, and a broken target could never be hit again — so this machine could
    // qualify once per floor, at most, and never tier.
    const parts = bank(1, 2);
    state.pinballParts = parts;

    expect(runBank(parts)).toHaveLength(1);
    expect(machineFor(parts[0])?.phase).toBe("unlit");
    expect(parts.every((p) => p.done === false)).toBe(true); // the bank came back up

    expect(runBank(parts)).toHaveLength(1);
  });

  it("ladders the tier across repeat completions of a target machine", () => {
    const parts = bank(2, 2);
    state.pinballParts = parts;
    const tiers = [runBank(parts), runBank(parts), runBank(parts)].map((out) => {
      expect(out).toHaveLength(1);
      return out[0].tier;
    });
    expect(tiers).toEqual([1, 2, 3]);
  });

  it("leaves a LOOSE target down forever, even while a machine beside it re-arms", () => {
    // THE NON-REGRESSION THAT MATTERS. A loose target staying dead IS the
    // floor's break-them-all objective; a re-arm that reached it would make
    // that objective unachievable-then-repeatable and the counter meaningless.
    const loose = looseTarget();
    const parts = bank(3, 2);
    state.pinballParts = [loose, ...parts];
    state.targetsTotal = 3;

    strike(loose);
    expect(loose.done).toBe(true);
    expect(state.targetsHit).toBe(1);
    expect(machineFor(loose)).toBeNull(); // it belongs to no machine, so nothing owns its state

    runBank(parts);
    runBank(parts);

    expect(loose.done).toBe(true);
    strike(loose); // and a dead bullseye is still not hittable
    expect(loose.done).toBe(true);
    // 1 loose + this machine's own targets, each counted ONCE IN ITS LIFE no
    // matter how many times the bank re-ran. Derived, not transcribed: an
    // earlier version asserted 1 here, which quietly claimed a machine's
    // targets never touch the floor objective at all — contradicting the test
    // below, which shows they do (and must, since `targetsTotal` counts them).
    expect(state.targetsHit).toBe(1 + parts.length);
  });

  it("counts a machine's target toward the floor objective exactly once, however often it re-arms", () => {
    // `assembly-place.partsOf` stamps `asm` and `seq` but never `bank`, so
    // `core.ts` counts a machine's targets in `state.targetsTotal` alongside the
    // loose ones. If a re-armed target re-counted, `targetsHit` would run past
    // `targetsTotal` and the ALL TARGETS DOWN bonus would pay on every repeat.
    const parts = bank(4, 2);
    state.pinballParts = parts;
    state.targetsTotal = parts.length;

    runBank(parts);
    expect(state.targetsHit).toBe(2);
    runBank(parts);
    runBank(parts);
    expect(state.targetsHit).toBe(2);
  });

  it("runs the REAL gargoyle-scoop: break the bank, take the mouth, collect, bank back up", () => {
    // The library's definition, through the real `createPinballParts` seam and
    // the real collide handlers. A hand-made stand-in would have agreed with
    // whatever I built it from; this one has to agree with the shipped machine
    // — including that its fourth step is a `maw`, which no test I invented
    // would have thought to route through.
    const scoop = MACHINES.find((m) => m.name === "gargoyle-scoop");
    expect(scoop).toBeDefined();

    const g = flatGrid(16, 16);
    state.pinballParts = [];
    createPinballParts(
      scoop!.parts.map(
        (p) =>
          ({
            i: 2 + p.ci,
            j: 2 + p.cj,
            kind: p.kind,
            dirI: p.dir.di,
            dirJ: p.dir.dj,
            dir2I: p.dir2?.di ?? 0,
            dir2J: p.dir2?.dj ?? 0,
            seq: p.seq,
            asm: { id: 9, name: scoop!.name, role: p.role, seq: p.seq },
          }) as PinballPartSpot,
      ),
      g,
      new THREE.Scene(),
    );

    const steps = state.pinballParts
      .filter((p) => p.asm?.id === 9)
      .sort((a, b) => a.asm!.seq! - b.asm!.seq!);
    // Derived from the library, not transcribed: if the machine is re-authored
    // this reads the new shape rather than agreeing with the old one.
    expect(steps.map((p) => p.kind)).toEqual(scoop!.parts.map((p) => p.kind));
    expect(steps.filter((p) => p.kind === "target")).toHaveLength(3);
    expect(steps.at(-1)!.kind).toBe("maw");
    expect(machineFor(steps[0])!.total).toBe(scoop!.parts.length);

    const targets = steps.filter((p) => p.kind === "target");
    const maw = steps.at(-1)!;

    const drive = (): MachineEvent[] => {
      drainMachineEvents();
      for (const t of targets) {
        strike(t);
        expect(t.done).toBe(true); // the bank falls, one target at a time
      }
      expect(machineFor(steps[0])!.step).toBe(targets.length);

      const swallowed = drops;
      strike(maw); // …and the mouth is open
      expect(drops).toBe(swallowed + 1); // the maw really swallowed: the machine's 4th step is a ride
      expect(drainMachineEvents().some((e) => e.kind === "lit")).toBe(true);
      // The bank RESETS the moment the machine lights — a real drop-target bank
      // does, and here it must: the collect shot needs something to hit.
      expect(targets.every((t) => t.done === false)).toBe(true);

      tickMachines(MACHINE_ARM_TIME + 0.01);
      expect(machineFor(steps[0])!.phase).toBe("armed");
      strike(targets[0]);
      const out = drainMachineEvents().filter((e) => e.kind === "collected");
      tickMachines(MACHINE_COOL_TIME + 0.01);
      expect(machineFor(steps[0])!.phase).toBe("unlit");
      expect(targets.every((t) => t.done === false)).toBe(true); // …and re-armed
      return out;
    };

    const first = drive();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: "gargoyle-scoop", total: 4, tier: 1 });
    expect(first[0].gold!).toBeGreaterThan(0);

    const second = drive();
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ tier: 2 });
  });

  it("does not wire a SLINGSHOT into its machine — the impact ruling, kept", () => {
    // `assembly.ts`: impact parts are "where flow is meant to become chaos", and
    // `portsChain` refuses to build a combo through one. A sling pair's two arms
    // ping the ball back and forth on their own, so an ordered 2-step sequence
    // across them would complete itself, repeatedly, for free. `SLING_PAIR` is
    // left as scenery on purpose; this pins that it stayed that way.
    const slings = MACHINES.find((m) => m.name === "sling-pair")!.parts;
    expect(slings.every((p) => p.kind === "slingshot")).toBe(true);

    const parts = slings.map((p, k) => asmPart(5, "sling-pair", k, "slingshot"));
    state.pinballParts = parts;
    for (let k = 0; k < 6; k++) for (const p of parts) strike(p);

    expect(drainMachineEvents()).toEqual([]);
    expect(machineRegistry().get(5)).toBeUndefined();
  });
});

describe("LEGACY — a loose orbit part with no `asm` behaves exactly as it did", () => {
  /**
   * Measured 2026-09-06 over 20 floors (5 seeds × depths 1/8/16/24): parts
   * carrying `orbit`/`orbitSeq` = 0.0 per floor at every depth, because the one
   * producer is gated on a room the pipeline stopped emitting. This test guards
   * a path nothing runs. It is a regression fence, NOT evidence the feature
   * works — that evidence is in the `asm` blocks above.
   */
  function rail(orbit: number, seq: number): PinballPart {
    return {
      kind: "deflector",
      i: 0,
      j: 0,
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
      dir2X: 0,
      dir2Z: 1,
      cooldownT: 0,
      hitT: -1,
      orbit,
      orbitSeq: seq,
      mesh: {} as never,
    };
  }

  beforeEach(() => {
    state.orbitActive = -1;
    state.orbitLast = -1;
    state.orbitCount = 0;
    state.orbitT = 0;
    state.orbitLaps = 0;
    state.goldRun = 0;
    state.shotChain = [];
    state.namedPaid = {};
  });

  it("still pays a lap for four corners taken in order", () => {
    const ring = [rail(1, 0), rail(1, 1), rail(1, 2), rail(1, 3)];
    state.pinballParts = ring;
    for (const p of ring) hitOrbitRail(p);
    expect(state.orbitLaps).toBe(1);
    expect(state.goldRun).toBeGreaterThan(0);
    expect(state.orbitCount).toBe(1); // rolls straight into the next lap
  });

  it("still restarts the lap on an out-of-order corner", () => {
    const ring = [rail(1, 0), rail(1, 1), rail(1, 2), rail(1, 3)];
    state.pinballParts = ring;
    hitOrbitRail(ring[0]);
    hitOrbitRail(ring[2]);
    expect(state.orbitCount).toBe(1);
    expect(state.orbitLast).toBe(2);
    expect(state.orbitLaps).toBe(0);
  });

  it("still creates no machine record for a part with no `asm`", () => {
    const ring = [rail(1, 0), rail(1, 1)];
    state.pinballParts = ring;
    hitOrbitRail(ring[0]);
    expect(machineFor(ring[0])).toBeNull();
    expect(drainMachineEvents()).toEqual([]);
  });
});

/** Types referenced only to keep the compiler honest about the shapes above. */
export type _MachineStateShape = MachineState;
