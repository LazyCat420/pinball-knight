/**
 * The Tilt Titan ROLLS between charges — and every other monster still walks.
 *
 * The `walk` pose in render/pinball-boss-3d.ts turns the riveted seam ring only
 * (`seam.rotation.x = ph`); `ball.rotation.x` is a static 0.16 lean with a
 * ±0.03 wobble, so the hull and the face do not rotate at all. A chrome sphere
 * crossing the floor without turning reads as SLIDING, and that window is about
 * a quarter of the fight — the largest single contributor to "it spins really
 * slow", because for that stretch it does not spin whatsoever.
 *
 * This drives the REAL `updateZombies`, not a predicate. A helper that returns
 * the right clip while nothing calls it is the exact shape of bug that has
 * already shipped here once: the accessor had a test, the caller using it did
 * not, and a sabotage of the caller left the whole suite green.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../state";
import { makeDebugEnemy, debugClearEnemies } from "../dev/debug-actions";
import { updateZombies } from "./zombie";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { PINBALL_AMBIENT_CLIP } from "../pinball-spin";

/**
 * Wake a spawned monster so `updateZombies` reaches the gait code.
 *
 * A freshly spawned enemy is dormant and short-circuits to an early
 * `play("idle"); continue` long before the walk/roll decision — so without
 * this the test measures the dormant path and proves nothing about the fix.
 */
function wake(z: Record<string, unknown>): void {
  z.aggro = true;
  z.dormant = false;
}

/** Every clip `play()` was asked for, in order. */
function watchClips(z: { anim: { play: (c: string, o?: unknown) => void } }): Array<{ clip: string; opts: unknown }> {
  const calls: Array<{ clip: string; opts: unknown }> = [];
  const real = z.anim.play.bind(z.anim);
  vi.spyOn(z.anim, "play").mockImplementation((clip: string, opts?: unknown) => {
    calls.push({ clip, opts });
    return real(clip, opts);
  });
  return calls;
}

describe("the Tilt Titan rolls instead of walking", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    state.scene = { add: () => {}, remove: () => {} } as never;
    state.zombies = [];
    state.player = { x: 0, z: 0, hp: 100, active: true, facing: "S" } as never;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(1),
      shapes: new Uint8Array(400),
      arcs: [],
    } as never;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    debugClearEnemies();
    state.scene = null;
    state.zombies = [];
    state.player = null;
    state.grid = null;
    restoreDom?.();
  });

  it("plays the rolling clip, LOOPED, for a pinball_boss", () => {
    const z = makeDebugEnemy("pinball_boss", 4, 4);
    expect(z, "the Titan must spawn").not.toBeNull();
    (z as { bossKind?: string }).bossKind = "pinball_boss";
    wake(z as never);
    state.zombies.push(z!);
    const calls = watchClips(z as never);

    for (let i = 0; i < 5; i++) updateZombies(1 / 60);

    expect(calls.length, "the AI must drive the clip").toBeGreaterThan(0);
    const rolls = calls.filter((c) => c.clip === PINBALL_AMBIENT_CLIP);
    expect(rolls.length, `expected ${PINBALL_AMBIENT_CLIP}, got ${calls.map((c) => c.clip).join(",")}`)
      .toBeGreaterThan(0);
    // WITHOUT the loop flag the ball completes one turn and freezes on its last
    // cell — which looks exactly like the static hull this change removes.
    for (const r of rolls) {
      expect(r.opts, "the roll must be looped or it stops after one turn").toMatchObject({ loop: true });
    }
    expect(calls.some((c) => c.clip === "walk"), "the Titan must never walk").toBe(false);
  });

  it("leaves every other monster on its normal gait", () => {
    // Blast radius. The edit sits in shared AI, so a plain monster getting
    // `roll` (or a stray loop override) would be a regression across the roster.
    const z = makeDebugEnemy("goblin", 4, 4);
    expect(z).not.toBeNull();
    wake(z as never);
    state.zombies.push(z!);
    const calls = watchClips(z as never);

    for (let i = 0; i < 5; i++) updateZombies(1 / 60);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.clip === PINBALL_AMBIENT_CLIP), "a goblin must not roll").toBe(false);
    for (const c of calls) {
      expect(c.opts, "a normal monster must get no loop override").toBeUndefined();
    }
  });

  it("keys off bossKind, not the sheet the actor happens to wear", () => {
    // The Titan's zombie is spawned with kind "brute" while wearing the
    // pinball_boss sheet, so anything keyed on `kind` would miss it — and
    // anything keyed on the SHEET would wrongly catch a real brute.
    const z = makeDebugEnemy("brute", 4, 4);
    expect(z).not.toBeNull();
    wake(z as never);
    state.zombies.push(z!);
    const calls = watchClips(z as never);

    for (let i = 0; i < 5; i++) updateZombies(1 / 60);

    expect(calls.some((c) => c.clip === PINBALL_AMBIENT_CLIP), "a plain brute must not roll").toBe(false);
  });
});
