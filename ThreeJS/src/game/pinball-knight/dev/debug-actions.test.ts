/**
 * The two debug-spawn defects behind "spawning in the debugger is super slow,
 * and the code-drawn monster shows before the sprite does".
 *
 * 1. `debugClearEnemies` unparented actors but never RELEASED them, so the
 *    actor pool stayed permanently empty and every `__lab.only`/`ring` spawn
 *    paid a fresh `texture.clone()` — a whole atlas re-uploaded to the GPU.
 * 2. The lab never awaited a kind's imported sheet, so `sheetFor` built a
 *    painter-only atlas on the spawning frame and the sprite replaced it a
 *    moment later: two full atlas builds, and a visible swap between them.
 *
 * Both assert on OBSERVABLE behaviour (pool reuse; which keys were loaded
 * before the spawn), not on the shape of the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../state";
import { debugClearEnemies, makeDebugEnemy, preloadSpawnArt } from "./debug-actions";
import { acquireActorSprite, clearActorSpritePool } from "../engine/render/sprite";
import { sheetFor, sheetKeyForKind } from "../boot/sheets";
import { installSpriteTestDom } from "../testkit/atlas-census";

describe("debug spawn: the lab must not leak sprites or spawn on cold art", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    state.scene = { add: () => {}, remove: () => {} } as any;
    state.zombies = [];
    state.player = { x: 0, z: 0, hp: 100, active: true, facing: "S" } as any;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(1),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
    clearActorSpritePool();
  });

  afterEach(() => {
    state.scene = null;
    state.zombies = [];
    state.player = null;
    state.grid = null;
    clearActorSpritePool();
    restoreDom?.();
    vi.restoreAllMocks();
  });

  it("returns cleared actors to the pool, so the next spawn reuses the mesh", () => {
    const a = makeDebugEnemy("goblin", 2, 2);
    const b = makeDebugEnemy("goblin", 3, 3);
    expect(a, "goblin should spawn").not.toBeNull();
    expect(b, "a second goblin should spawn").not.toBeNull();
    state.zombies.push(a!, b!);
    const meshes = new Set([a!.sprite.mesh, b!.sprite.mesh]);

    debugClearEnemies();

    // The pool is private, so prove reuse the only way a caller can see it:
    // acquire two actors and check they are the meshes we just cleared.
    // Before the fix the pool was empty and these were brand-new meshes, each
    // carrying its own cloned copy of the atlas texture.
    const sheet = sheetFor(sheetKeyForKind("goblin")!);
    const reused = [acquireActorSprite(sheet, false), acquireActorSprite(sheet, false)];
    for (const r of reused) {
      expect(meshes.has(r.mesh), "a cleared actor's mesh must come back from the pool").toBe(true);
    }
    expect(new Set(reused.map((r) => r.mesh)).size, "two distinct actors, not one twice").toBe(2);
  });

  it("does not pool a boss actor — disposeBoss owns those", () => {
    const z = makeDebugEnemy("goblin", 2, 2);
    expect(z).not.toBeNull();
    z!.boss = true;
    state.zombies.push(z!);

    debugClearEnemies();

    const sheet = sheetFor(sheetKeyForKind("goblin")!);
    const fresh = acquireActorSprite(sheet, false);
    expect(fresh.mesh, "a boss mesh must not be handed to the next ordinary spawn").not.toBe(
      z!.sprite.mesh,
    );
  });

  it("preloadSpawnArt resolves a kind's own sheet key", async () => {
    const sheets = await import("../boot/sheets");
    const spy = vi.spyOn(sheets, "loadMonsterSheet").mockResolvedValue(true);
    await preloadSpawnArt("goblin");
    expect(spy.mock.calls.map((c) => c[0])).toContain("goblin");
  });

  it("preloadSpawnArt also loads what ascii_human is actually built from", async () => {
    // debugSpawn constructs an ascii_human out of a computer_screen; preloading
    // only the asked-for kind left the thing you actually see on cold art.
    const sheets = await import("../boot/sheets");
    const spy = vi.spyOn(sheets, "loadMonsterSheet").mockResolvedValue(true);
    await preloadSpawnArt("ascii_human");
    const keys = spy.mock.calls.map((c) => c[0]);
    expect(keys, "the computer_screen it is built from must be preloaded too").toContain(
      "computer_screen",
    );
  });

  it("survives a kind whose sheet fails to load — the painter still spawns it", async () => {
    const sheets = await import("../boot/sheets");
    vi.spyOn(sheets, "loadMonsterSheet").mockRejectedValue(new Error("404"));
    await expect(preloadSpawnArt("goblin"), "a failed fetch must not reject the spawn").resolves
      .toBeUndefined();
    expect(makeDebugEnemy("goblin", 2, 2), "goblin must still spawn on painter art").not.toBeNull();
  });

  it("hydrant_hound has no imported sheet and must still spawn", async () => {
    // The one painter-only kind in the roster: nothing to preload, and the
    // painter IS its shipping art.
    await expect(preloadSpawnArt("hydrant_hound")).resolves.toBeUndefined();
    expect(makeDebugEnemy("hydrant_hound", 2, 2)).not.toBeNull();
  });
});
