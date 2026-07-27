import { describe, it, expect, beforeEach } from "vitest";
import { coinCountFor, splitCoinValue, sweepCoins, updateCoins, enforceCoinCap } from "./economy/coins";
import { checkPickups } from "./economy/pickups";
import { state } from "./state";
import type { GroundItem } from "./state";
import {
  COIN_MAGNET_TIME,
  COIN_MAGNET_RANGE,
  COIN_ARM_TIME,
  COIN_REST_Y,
  COIN_CHEST_Y,
  COIN_LIVE_CAP,
  COIN_MAX_PER_DROP,
  COIN_SPAWN_Y,
  COIN_BURST_VY,
} from "./constants";

// Everything under test is imported directly from the economy modules now —
// the old `__coinInternals` bag on core.ts is gone.

/**
 * Coins are the only ground item that carries VALUE, so every path that removes
 * one is a path that can lose or duplicate gold. These tests pin the three
 * invariants that matter: the split never drifts, the flight is wall-clock (not
 * frame-count) timed, and a coin taken off the floor by the cap is still paid.
 *
 * `addGold` writes to localStorage, which doesn't exist under the node test
 * environment — it no-ops there without throwing, so `state.goldRun` is the
 * ledger these assertions read.
 */

/** A GroundItem with a sprite stub — no WebGL, but the same disposal contract. */
function fakeCoin(value: number, x = 0, z = 0, phase: "burst" | "rest" | "magnet" = "rest"): GroundItem {
  let disposed = false;
  return {
    kind: "coin",
    id: "coin",
    value,
    x,
    z,
    bobPhase: 0,
    sprite: {
      mesh: { position: { x, y: 0, z, set(nx: number, ny: number, nz: number) { this.x = nx; this.y = ny; this.z = nz; } } },
      dispose: () => {
        disposed = true;
      },
      get disposed() {
        return disposed;
      },
    } as unknown as GroundItem["sprite"],
    coin: {
      phase,
      y: phase === "burst" ? COIN_SPAWN_Y : COIN_REST_Y,
      vx: 0,
      vy: phase === "burst" ? COIN_BURST_VY : 0,
      vz: 0,
      age: phase === "burst" ? 0 : COIN_ARM_TIME,
      magT: 0,
      fromX: x,
      fromY: COIN_REST_Y,
      fromZ: z,
    },
  };
}

function stubWorld(): void {
  state.player = { x: 0, z: 0, magnetAuraT: 0 } as unknown as typeof state.player;
  state.groundItems = [];
  state.goldRun = 0;
  state.elapsed = 0;
  state.scene = null;
  state.vfx = null;
}

describe("coin value split — the no-drift invariant", () => {
  it("sums to EXACTLY the total for every total/count pair, with no negative shares", () => {
    for (let total = 1; total <= 120; total++) {
      for (let n = 1; n <= COIN_MAX_PER_DROP; n++) {
        const parts = splitCoinValue(total, n);
        expect(parts).toHaveLength(n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total); // no free gold, no eaten gold
        for (const p of parts) expect(p).toBeGreaterThanOrEqual(0);
        // Shares differ by at most one unit — a lopsided split would look wrong
        // even though it adds up.
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("mints a readable handful: never zero, never a fountain, more for a bigger drop", () => {
    expect(coinCountFor(1)).toBe(1);
    expect(coinCountFor(2)).toBe(2); // GOLD_PER_KILL — a pair, not a lone coin
    expect(coinCountFor(40)).toBe(COIN_MAX_PER_DROP); // boss windfall, capped
    expect(coinCountFor(1000)).toBe(COIN_MAX_PER_DROP);
    expect(coinCountFor(6)).toBeGreaterThan(coinCountFor(2)); // style kill > plain kill
  });

  it("credits the full drop through the split, not the pre-split total", () => {
    stubWorld();
    const total = 37;
    const parts = splitCoinValue(total, coinCountFor(total));
    for (const v of parts) state.groundItems.push(fakeCoin(v, 50, 50));
    sweepCoins();
    expect(state.goldRun).toBe(total);
    expect(state.groundItems).toHaveLength(0);
  });
});

describe("magnet flight is wall-clock timed, not frame timed", () => {
  /** Run a coin from capture to absorb at a fixed step; return seconds elapsed. */
  function flightSeconds(fps: number): number {
    stubWorld();
    const dt = 1 / fps;
    // Park the player well outside pickup range so ONLY the flight can collect it.
    state.player = { x: 0, z: 0, magnetAuraT: 0 } as unknown as typeof state.player;
    state.groundItems = [fakeCoin(1, COIN_MAGNET_RANGE * 0.5, 0)];
    let t = 0;
    for (let i = 0; i < 10000 && state.groundItems.length > 0; i++) {
      checkPickups(dt);
      t += dt;
    }
    expect(state.groundItems).toHaveLength(0);
    expect(state.goldRun).toBe(1);
    return t;
  }

  it("takes the same ~COIN_MAGNET_TIME at 30, 60 and 144fps", () => {
    const at30 = flightSeconds(30);
    const at60 = flightSeconds(60);
    const at144 = flightSeconds(144);
    // Each within TWO steps of the nominal flight time. Two, not one: capture
    // and absorb are both edge-detected on a step boundary, so each contributes
    // up to one step of quantisation. That residue shrinks with the step —
    // which is the opposite of the old bug, where the error GREW with refresh.
    for (const [t, fps] of [[at30, 30], [at60, 60], [at144, 144]] as const) {
      expect(t).toBeGreaterThanOrEqual(COIN_MAGNET_TIME);
      expect(t).toBeLessThan(COIN_MAGNET_TIME + 2 / fps + 1e-9);
    }
    // And, the actual regression guard, they agree with EACH OTHER. The old
    // per-frame `x += (px - x) * 0.22` gave 118ms at 60Hz and 49ms at 144Hz —
    // a 2.4x spread. Anything more than a 30fps step apart is that bug back.
    expect(Math.abs(at144 - at60)).toBeLessThan(1 / 30);
    expect(Math.abs(at30 - at60)).toBeLessThan(1 / 30);
  });

  it("is slow enough to actually see — the whole point of the rework", () => {
    // The old magnet ran spawn-to-collected in ~118ms. Anything under ~200ms is
    // back to "the player only sees the number".
    expect(flightSeconds(60)).toBeGreaterThan(0.2);
  });
});

describe("coin flight phases", () => {
  it("bursts UPWARD out of the corpse before it can be captured", () => {
    stubWorld();
    const coin = fakeCoin(1, 0, 0, "burst");
    state.groundItems = [coin];
    // Player standing right on the corpse: the coin must still not be grabbed
    // during the burst, or the pop never gets seen.
    let peak = 0;
    for (let i = 0; i < 6; i++) {
      updateCoins(1 / 60);
      peak = Math.max(peak, coin.coin!.y);
    }
    expect(peak).toBeGreaterThan(COIN_SPAWN_Y); // it went UP, not sideways along the floor
    expect(coin.coin!.phase).toBe("burst");
  });

  it("settles to the floor, then arcs up to CHEST height on the way in", () => {
    stubWorld();
    const coin = fakeCoin(1, 0, 0, "burst");
    state.groundItems = [coin];
    // Player far away so the coin lands and rests instead of being captured.
    state.player = { x: 40, z: 0, magnetAuraT: 0 } as unknown as typeof state.player;
    for (let i = 0; i < 200 && coin.coin!.phase === "burst"; i++) updateCoins(1 / 60);
    expect(coin.coin!.phase).toBe("rest");
    expect(coin.coin!.y).toBeCloseTo(COIN_REST_Y, 1);

    // Now walk up to it: it should leave the floor and finish at chest height.
    state.player = { x: 0, z: 0, magnetAuraT: 0 } as unknown as typeof state.player;
    updateCoins(1 / 60);
    expect(coin.coin!.phase).toBe("magnet");
    let peak = 0;
    while (coin.coin!.magT < COIN_MAGNET_TIME) {
      updateCoins(1 / 60);
      peak = Math.max(peak, coin.coin!.y);
    }
    expect(peak).toBeGreaterThan(COIN_REST_Y + 0.2); // it RISES, it doesn't slide
    expect(coin.coin!.y).toBeCloseTo(COIN_CHEST_Y, 1);
  });

  it("accelerates into the knight rather than sliding at a constant rate", () => {
    stubWorld();
    const coin = fakeCoin(1, 2, 0, "rest");
    state.groundItems = [coin];
    updateCoins(1 / 60); // captures
    expect(coin.coin!.phase).toBe("magnet");
    const start = coin.coin!.fromX;
    const steps = Math.round(COIN_MAGNET_TIME * 60);
    const positions: number[] = [];
    for (let i = 0; i < steps; i++) {
      updateCoins(1 / 60);
      positions.push(coin.x);
    }
    // Ease-IN: less than a quarter of the distance is covered in the first half
    // of the flight (u² gives exactly 25% at the midpoint).
    const half = positions[Math.floor(steps / 2) - 1];
    expect(Math.abs(half - start)).toBeLessThan(Math.abs(start) * 0.3);
  });
});

describe("the cull path never drops gold on the floor forever", () => {
  it("force-credits the excess when the live-coin cap is exceeded", () => {
    stubWorld();
    const over = COIN_LIVE_CAP + 9;
    for (let i = 0; i < over; i++) state.groundItems.push(fakeCoin(3, 50, 50));
    enforceCoinCap();
    expect(state.groundItems).toHaveLength(COIN_LIVE_CAP);
    expect(state.goldRun).toBe(9 * 3); // the culled nine were PAID, not binned

    // …and the survivors still carry their value, so a later sweep pays the rest.
    sweepCoins();
    expect(state.goldRun).toBe(over * 3);
  });

  it("disposes every culled coin's sprite (dispose.ts can't reach a spliced item)", () => {
    stubWorld();
    const coins = Array.from({ length: COIN_LIVE_CAP + 4 }, () => fakeCoin(1, 50, 50));
    state.groundItems.push(...coins);
    enforceCoinCap();
    const culled = coins.filter((c) => !state.groundItems.includes(c));
    expect(culled).toHaveLength(4);
    for (const c of culled) {
      expect((c.sprite as unknown as { disposed: boolean }).disposed).toBe(true);
    }
  });

  it("sweeps the floor when a level ends, so descending never eats a drop", () => {
    stubWorld();
    state.groundItems.push(fakeCoin(2, 9, 9), fakeCoin(5, -9, 9), fakeCoin(1, 0, 40));
    // A non-coin item must survive the sweep untouched — this is a coin ledger,
    // not a floor wipe.
    const potion = { ...fakeCoin(0), kind: "potion" as const, id: "health", coin: undefined };
    state.groundItems.push(potion);
    sweepCoins();
    expect(state.goldRun).toBe(8);
    expect(state.groundItems).toEqual([potion]);
  });
});

describe("Magnet Aura and the coin magnet don't fight", () => {
  it("widens the capture range instead of moving the coin twice", () => {
    stubWorld();
    const far = COIN_MAGNET_RANGE * 1.8; // outside the normal range
    const coin = fakeCoin(1, far, 0, "rest");
    state.groundItems = [coin];
    updateCoins(1 / 60);
    expect(coin.coin!.phase).toBe("rest"); // no aura — stays put

    state.player = { x: 0, z: 0, magnetAuraT: 5 } as unknown as typeof state.player;
    updateCoins(1 / 60);
    expect(coin.coin!.phase).toBe("magnet"); // aura reaches it
    // The flight is still exactly COIN_MAGNET_TIME — the aura changes reach, not
    // speed, so it can't double-advance a coin that's already flying.
    let t = 0;
    while (coin.coin!.magT < COIN_MAGNET_TIME) {
      updateCoins(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(COIN_MAGNET_TIME + 1 / 30);
  });
});
