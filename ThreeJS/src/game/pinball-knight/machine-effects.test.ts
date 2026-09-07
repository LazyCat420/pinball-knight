/**
 * WHAT A COMPLETED MACHINE CHANGES.
 *
 * `machines.ts` shipped a full lifecycle — unlit → qualifying → lit → armed →
 * collected → cooling — an event queue and a listener hook, and NOTHING
 * LISTENED. Completing a machine paid gold and changed nothing else, so the
 * machine layer was a score checklist: "light three loops" meant a bigger
 * number, not a different dungeon.
 *
 * `machine-effects.ts` is the first consequence, and it is deliberately built
 * out of things that already ship: the sealed vault chest (`lamp-puzzle.ts`,
 * with its CHEST_UNLIT → CHEST_LIT colour ramp and its two existing unlock
 * routes) and the `state.vfx` / `showToast` / `shakeT` vocabulary.
 *
 * ── The four properties, and how each one fails ────────────────────────────
 *
 *   1. ONE completion is ONE seal. The queue publishes `advance`, `lit`,
 *      `armed` and `collected` for a single run of a machine, and machines.ts
 *      ALSO fans every event out to `onMachineEvent` listeners. A consumer that
 *      counts events instead of collects pays four times; a consumer that both
 *      subscribes AND drains pays twice for one shot. Both are silent.
 *   2. Overcharge is a WINDOW. Re-arming it must refresh the clock, not add to
 *      it — a machine re-arms every MACHINE_COOL_TIME (2s), so an additive
 *      window is an infinite one after a minute of hammering one spot.
 *   3. Floor reset clears BOTH. `machines.ts` documents its registry as
 *      floor-scoped for the same reason: a consequence that leaks down the
 *      stairs arrives on depth 8 already half-solved.
 *   4. The two SHIPPED routes to the vault — every brazier, or the overlord —
 *      still work byte-for-byte. This file adds a third route; it must not
 *      become the only one, and `vault-chest.test.ts` is the wider guard.
 *
 * Every number this file asserts is DERIVED — from the module's own exported
 * constants, or from what the brazier route does with the same chest — rather
 * than transcribed, so tuning the window or the ladder cannot fail a test for
 * having been tuned.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";

// The vault payout builds real item sprites — a canvas node does not have.
// Same stub, same reason, as vault-chest.test.ts.
vi.mock("./engine/render/sprite", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createStaticSprite: () => ({ mesh: new THREE.Object3D(), dispose: () => {} }),
}));

import { state, type PinballPart, type PinballPartKind } from "./state";
import { hitMachine, tickMachines, resetMachines, onMachineEvent, type MachineEvent } from "./machines";
import { MACHINE_ARM_TIME, MACHINE_COOL_TIME } from "./constants";
import { installLampPuzzle, lightLamp, openVaultOnBossDefeat, updateLampPuzzle, disposeLampPuzzle, vaultLit } from "./lamp-puzzle";
import type { LampPuzzlePlan } from "./maze/lamp-puzzle";
import {
  updateMachineEffects,
  resetMachineEffects,
  machineVaultSeals,
  machineVaultCharges,
  MACHINES_PER_SEAL,
  overchargeActive,
  overchargeRemaining,
  overchargeRung,
  overchargeShareFor,
  OVERCHARGE_TIME,
  OVERCHARGE_SHARE_STEP,
  OVERCHARGE_MAX_SHARE,
} from "./machine-effects";

/** Three braziers and a chest — the smallest floor `lampCountFor` can author. */
const PLAN: LampPuzzlePlan = {
  lamps: [
    { i: 3, j: 3, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 },
    { i: 9, j: 3, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 },
    { i: 6, j: 9, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 },
  ],
  vault: { i: 6, j: 6 },
  loot: ["gold", "health", "gold"],
};

const grid = { w: 12, h: 12, t: new Uint8Array(144), shapes: new Uint8Array(144) };

/** A live part of machine `id` at sequence position `seq`, with no mesh. */
function asmPart(id: number, name: string, seq: number, kind: PinballPartKind = "rollover"): PinballPart {
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

/** `n` machines of `total` steps each, all on the floor at once. */
function placeMachines(n: number, total = 3): PinballPart[][] {
  const all: PinballPart[][] = [];
  for (let k = 0; k < n; k++) all.push(Array.from({ length: total }, (_, s) => asmPart(k + 1, "orbit", s)));
  state.pinballParts = all.flat();
  return all;
}

/**
 * Run one machine from unlit to COLLECTED, exactly the way the game does:
 * every step in order, the arm on the clock, then the collect shot.
 *
 * Deliberately does NOT drain — the drain is the thing under test.
 */
function collectMachine(parts: PinballPart[]): void {
  for (const p of parts) hitMachine(p);
  tickMachines(MACHINE_ARM_TIME + 0.01); // `lit` spins up to `armed` on the clock
  hitMachine(parts[0]); // …and the separate collect shot banks it
}

/** The gold `machines.ts` priced the last collect at — captured off the LISTENER
 *  hook, which is independent of the queue, so watching costs the drain nothing. */
function watchGold(): { last: () => number } {
  let gold = 0;
  onMachineEvent((e: MachineEvent) => {
    if (e.kind === "collected") gold = e.gold ?? 0;
  });
  return { last: () => gold };
}

function install(): THREE.Scene {
  const scene = new THREE.Scene();
  state.scene = scene;
  state.groundItems = [];
  installLampPuzzle(PLAN, grid, scene);
  return scene;
}

function glowOf(): THREE.MeshStandardMaterial {
  const c = state.lampPuzzle?.chest;
  if (!c) throw new Error("no chest");
  return c.userData.glow as THREE.MeshStandardMaterial;
}

function braziers(): PinballPart[] {
  return PLAN.lamps.map((l): PinballPart => ({ kind: "lamp", x: l.i, z: l.j, lit: false }) as PinballPart);
}

beforeEach(() => {
  disposeLampPuzzle(state.scene ?? null);
  resetMachines();
  resetMachineEffects();
  state.scene = null;
  state.groundItems = [];
  state.pinballParts = [];
  state.player = null;
  state.vfx = null;
  state.goldRun = 0;
  state.shakeT = 0;
});

/**
 * Clear enough DISTINCT machines to bank exactly one seal.
 *
 * Derived from MACHINES_PER_SEAL, never transcribed. These tests are about the
 * vault's THIRD ROUTE — "a machine's progress lands beside a brazier's" — which
 * is true at any ratio; the ratio itself is asserted once, in its own swept
 * test. Hardcoding "one machine, one seal" here is what made six of them go red
 * when the ratio was tuned to 2:1 for 8-10-machine floors.
 */
function collectOneSeal(): void {
  const ms = placeMachines(MACHINES_PER_SEAL);
  for (const m of ms) collectMachine(m);
  updateMachineEffects(1 / 60);
}

describe("§the third route — a completed machine advances the vault", () => {
  it("banks exactly ONE charge for one completion, however the events arrive", () => {
    // A full run of a 3-step machine queues advance×3 + lit + armed + collected.
    // Counting events pays 6; subscribing AND draining pays 2. Both look right.
    //
    // Asserted on CHARGES, not seals, and the seal count is DERIVED from
    // MACHINES_PER_SEAL rather than transcribed. The distinction is the whole
    // point of the test: "one completion is one unit of progress" is the
    // idempotence property, and it must hold at any ratio. An earlier version
    // hardcoded `seals === 1`, which quietly asserted a 1:1 ratio as a
    // side-effect and went red the moment the ratio was retuned to 2:1 — a test
    // failing for having been correctly tuned is the classic pinned-constant trap.
    const [a] = placeMachines(1);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    expect(machineVaultCharges()).toBe(1);
    expect(machineVaultSeals()).toBe(Math.floor(1 / MACHINES_PER_SEAL));

    // …and the drain is empty now, so a second tick must not find it again.
    updateMachineEffects(1 / 60);
    expect(machineVaultCharges()).toBe(1);
  });

  it("gives a machine ONE seal per floor however many times it is re-run", () => {
    // The anti-farm rule. A machine re-arms after MACHINE_COOL_TIME, so an
    // uncapped seal would let one spot open the vault in ~10 seconds.
    const [a] = placeMachines(1);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    tickMachines(MACHINE_COOL_TIME + 0.01); // cooling → unlit, ready to run again
    collectMachine(a);
    updateMachineEffects(1 / 60);
    expect(machineVaultCharges()).toBe(1); // re-running it earns nothing more
  });

  it("gives a DIFFERENT machine its own seal", () => {
    const [a, b] = placeMachines(2);
    collectMachine(a);
    collectMachine(b);
    updateMachineEffects(1 / 60);
    expect(machineVaultCharges()).toBe(2);
    expect(machineVaultSeals()).toBe(Math.floor(2 / MACHINES_PER_SEAL));
  });

  it("converts charges to seals at exactly MACHINES_PER_SEAL, swept", () => {
    // The ratio itself, asserted as a PROPERTY over a sweep rather than at one
    // point. This is the test that would catch a broken conversion at any ratio,
    // and it is the one the three above deliberately no longer duplicate.
    const machines = placeMachines(6);
    for (let n = 1; n <= machines.length; n++) {
      collectMachine(machines[n - 1]);
      updateMachineEffects(1 / 60);
      expect(machineVaultCharges()).toBe(n);
      expect(machineVaultSeals()).toBe(Math.floor(n / MACHINES_PER_SEAL));
    }
  });

  it("warms the chest the way a brazier does — the same colour on the ramp", () => {
    // The claim is "advances vault progress the way a brazier does". So the
    // oracle is the BRAZIER, not a colour constant transcribed from the source.
    install();
    const dark = (updateLampPuzzle(1 / 60), glowOf().emissive.getHex());
    state.pinballParts = braziers();
    lightLamp(state.pinballParts[0]);
    updateLampPuzzle(1 / 60);
    const warm = glowOf().emissive.getHex();
    expect(warm).not.toBe(dark); // the ramp does something at all

    // A fresh floor: one machine seal, no brazier touched.
    disposeLampPuzzle(state.scene ?? null);
    install();
    updateLampPuzzle(1 / 60);
    expect(glowOf().emissive.getHex()).toBe(dark);
    collectOneSeal();
    updateLampPuzzle(1 / 60);
    expect(glowOf().emissive.getHex()).toBe(warm);
    expect(state.lampPuzzle!.lit).toBe(0); // and it did NOT fake a lit brazier
  });

  it("counts toward the same total the braziers count toward", () => {
    install();
    const total = state.lampPuzzle!.total;
    collectOneSeal();
    expect(vaultLit()).toBe(1);
    state.pinballParts = braziers();
    lightLamp(state.pinballParts[0]);
    expect(vaultLit()).toBe(2);
    expect(vaultLit()).toBeLessThan(total); // …and 2 of 3 does NOT open it
    expect(state.lampPuzzle!.unlocked).toBe(false);
  });

  it("opens the vault when seals and braziers together finish it", () => {
    install();
    const total = state.lampPuzzle!.total;
    collectOneSeal();
    const lamps = braziers();
    state.pinballParts = lamps;
    for (let k = 0; k < total - 1; k++) lightLamp(lamps[k]);
    updateLampPuzzle(1 / 60); // the chest owns the open; this is the frame it sees it
    expect(state.lampPuzzle!.unlocked).toBe(true);
    expect(state.groundItems.map((g) => g.id)).toEqual(PLAN.loot);
  });
});

describe("§overcharge — a timed window the floor can see", () => {
  it("arms on a collect and reports itself ON", () => {
    const [a] = placeMachines(1);
    expect(overchargeActive()).toBe(false);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    expect(overchargeActive()).toBe(true);
    expect(overchargeRemaining()).toBeCloseTo(OVERCHARGE_TIME, 5);
  });

  it("expires on its own timer, at OVERCHARGE_TIME", () => {
    const [a] = placeMachines(1);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    let t = 0;
    for (let k = 0; k < Math.ceil((OVERCHARGE_TIME + 1) * 60) && overchargeActive(); k++) {
      updateMachineEffects(1 / 60);
      t += 1 / 60;
    }
    expect(overchargeActive()).toBe(false);
    expect(t).toBeGreaterThanOrEqual(OVERCHARGE_TIME - 1 / 60);
    expect(t).toBeLessThanOrEqual(OVERCHARGE_TIME + 1 / 60);
    expect(overchargeRung()).toBe(0); // the ladder falls with the window
  });

  it("REFRESHES on a re-arm rather than stacking", () => {
    // `t += TIME` instead of `t = TIME` is a one-character difference and makes
    // the window permanent, because a machine re-arms every 2 seconds.
    const [a, b] = placeMachines(2);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    const half = OVERCHARGE_TIME / 2;
    updateMachineEffects(half);
    expect(overchargeRemaining()).toBeCloseTo(half, 5);
    const before = overchargeRemaining();
    collectMachine(b);
    updateMachineEffects(1 / 60);
    // The clock is NOT touched — not refreshed to full, not extended. A collect
    // landing inside the window buys a RUNG on the payout ladder instead.
    // With 8-10 machines on a floor either clock-touching rule makes overcharge
    // permanently on, which is the whole reason the ladder exists.
    expect(overchargeRemaining()).toBeLessThan(before);
    expect(overchargeRemaining()).toBeLessThanOrEqual(OVERCHARGE_TIME);
    expect(overchargeRung()).toBeGreaterThan(0);
  });

  it("ladders the payout of the collects that land INSIDE the window", () => {
    const seen = watchGold();
    const [a, b] = placeMachines(2);
    collectMachine(a);
    const before = state.goldRun;
    updateMachineEffects(1 / 60);
    expect(state.goldRun).toBe(before); // the collect that ARMS it pays no bonus
    expect(overchargeRung()).toBe(0);

    collectMachine(b);
    const paid = state.goldRun;
    updateMachineEffects(1 / 60);
    expect(overchargeRung()).toBe(1);
    expect(state.goldRun - paid).toBe(Math.round(seen.last() * OVERCHARGE_SHARE_STEP));
    expect(state.goldRun - paid).toBeGreaterThan(0);
  });

  it("caps the ladder — the window cannot be farmed into a jackpot machine", () => {
    const seen = watchGold();
    const rungs = Math.ceil(OVERCHARGE_MAX_SHARE / OVERCHARGE_SHARE_STEP);
    const all = placeMachines(rungs + 3);
    for (const m of all) {
      collectMachine(m);
      updateMachineEffects(1 / 60);
    }
    expect(overchargeActive()).toBe(true); // all of it inside one window
    expect(overchargeShareFor(overchargeRung())).toBe(OVERCHARGE_MAX_SHARE);
    const paid = state.goldRun;
    const last = all[all.length - 1];
    tickMachines(MACHINE_COOL_TIME + 0.01);
    collectMachine(last);
    updateMachineEffects(1 / 60);
    expect(state.goldRun - paid).toBe(Math.round(seen.last() * OVERCHARGE_MAX_SHARE));
  });
});

describe("§the floor boundary — nothing leaks down the stairs", () => {
  it("clears overcharge AND the machine seals when the floor is torn down", () => {
    install();
    collectOneSeal();
    expect(machineVaultSeals()).toBe(1);
    expect(overchargeActive()).toBe(true);

    // The EXACT per-floor path: disposeLevel() → disposeLampPuzzle().
    disposeLampPuzzle(state.scene ?? null);
    expect(machineVaultSeals()).toBe(0);
    expect(overchargeActive()).toBe(false);
    expect(overchargeRung()).toBe(0);
  });

  it("clears them on ARRIVAL too, so a torn-down-elsewhere floor still starts cold", () => {
    // startLevel/floor-enter both call installLampPuzzle; that is the arrival path.
    const [a] = placeMachines(1);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    install();
    expect(machineVaultSeals()).toBe(0);
    expect(overchargeActive()).toBe(false);
  });

  it("does not carry a seal into the NEXT floor's chest", () => {
    const [a] = placeMachines(1);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    install(); // the next floor
    updateLampPuzzle(1 / 60);
    expect(vaultLit()).toBe(0);
    expect(state.lampPuzzle!.unlocked).toBe(false);
  });
});

describe("§non-regression — the two shipped routes are unchanged", () => {
  it("still opens on every brazier, with no machine ever touched", () => {
    install();
    const lamps = braziers();
    state.pinballParts = lamps;
    lamps.forEach(lightLamp);
    expect(machineVaultSeals()).toBe(0);
    expect(state.lampPuzzle!.unlocked).toBe(true);
    expect(state.groundItems.map((g) => g.id)).toEqual(PLAN.loot);
  });

  it("still opens on the overlord, and still reports itself solved", () => {
    install();
    openVaultOnBossDefeat();
    expect(state.lampPuzzle!.unlocked).toBe(true);
    expect(state.lampPuzzle!.lit).toBe(state.lampPuzzle!.total);
    expect(state.groundItems.map((g) => g.id)).toEqual(PLAN.loot);
  });

  it("pays the vault ONCE when a seal and the overlord both land", () => {
    install();
    const [a] = placeMachines(1);
    collectMachine(a);
    updateMachineEffects(1 / 60);
    updateLampPuzzle(1 / 60);
    openVaultOnBossDefeat();
    const n = state.groundItems.length;
    expect(n).toBe(PLAN.loot.length);
    updateLampPuzzle(1 / 60);
    expect(state.groundItems.length).toBe(n);
  });

  it("is a no-op on a floor that rolled no puzzle", () => {
    state.lampPuzzle = null;
    const [a] = placeMachines(1);
    collectMachine(a);
    expect(() => updateMachineEffects(1 / 60)).not.toThrow();
    expect(vaultLit()).toBe(0);
    expect(state.groundItems).toHaveLength(0);
  });
});
