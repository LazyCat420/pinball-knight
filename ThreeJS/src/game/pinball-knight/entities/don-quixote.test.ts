/**
 * DON QUIXOTE — the wall crash, and the wiring that makes it reachable.
 *
 * Most of this file is about REACHABILITY rather than arithmetic. The first
 * version of this monster shipped a 169-line state machine that nothing in the
 * game ever called, with a test suite that called it directly and passed — so
 * the tests here go through the registries and the constants the update loop
 * actually reads, and assert that his charge is wired to the same `startCharge`
 * path the hound and the mimic already run on.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import * as THREE from "three";
import { donQuixoteWallCrash } from "./don-quixote";
import {
  DON_QUIXOTE_CRASH_SELF_DAMAGE,
  DON_QUIXOTE_CRASH_STUN,
  DON_QUIXOTE_CHARGE_SPEED,
  DON_QUIXOTE_CHARGE_TIME,
  DON_QUIXOTE_ATTACK_WINDUP,
  DON_QUIXOTE_HP,
  HOUND_CHARGE_SPEED,
  HOUND_ATTACK_WINDUP,
} from "../constants";
import { state, type Zombie } from "../state";
import { STATS } from "./zombie";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { DMG_BY_KIND } from "./combat";
import { ENEMY_DROPS } from "../reagents";
import { KIND_INFO } from "../bestiary";
import { HP_BY_KIND, spawnKind } from "../spawn/factory";
import { DON_QUIXOTE_FROM_LEVEL } from "../constants";
import { KIND_SKIN } from "../spawn/kind-skin";
import { SHEET_KEYS, IMPORTED_ART } from "../boot/sheets";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { makeDonQuixotePaints } from "../render/monsters/don-quixote";

/**
 * Build him the way the GAME builds him — through the spawner, not from a
 * literal. A hand-rolled stand-in is how the first pass got a green suite over
 * a monster that could not spawn at all: `makeSkinned` returns null for a kind
 * with no `KIND_SKIN` row, and no test that constructs its own object can ever
 * see that.
 */
function makeDon(hp = DON_QUIXOTE_HP): Zombie {
  const z = spawnKind("don_quixote", 4, 4, 2.0, DON_QUIXOTE_FROM_LEVEL);
  if (!z) throw new Error("spawnKind returned null for don_quixote — check KIND_SKIN / skinSheet");
  z.hp = hp;
  z.mode = "charge";
  z.staggerT = 0;
  return z;
}

describe("Don Quixote", () => {
  let restoreDom: () => void;
  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });
  afterAll(() => restoreDom?.());

  beforeEach(() => {
    // `damageZombie` returns early without a grid, so a crash test with no maze
    // in `state` passes for the wrong reason: no stun, no damage, no failure.
    state.grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
    state.scene = new THREE.Scene(); // the spawner parents every actor mesh
    state.zombies = [];
    state.vfx = null;
    state.shakeT = 0;
  });

  // ── The mechanic ──────────────────────────────────────────────────────────

  it("running the lance into a wall costs him health AND leaves him staggered", () => {
    const z = makeDon();
    state.zombies.push(z);

    const stun = donQuixoteWallCrash(z, 1, 0);

    expect(stun).toBe(DON_QUIXOTE_CRASH_STUN);
    expect(z.staggerT).toBe(DON_QUIXOTE_CRASH_STUN);
    expect(z.hp).toBe(DON_QUIXOTE_HP - DON_QUIXOTE_CRASH_SELF_DAMAGE);
  });

  it("the stun is long enough to be worth steering him into a wall for", () => {
    // A hound's wall slam costs it half a second of cooldown. If the Don's
    // punishment is not decisively longer, the intended way to fight him is
    // strictly worse than trading hits, and the mechanic may as well not exist.
    expect(DON_QUIXOTE_CRASH_STUN).toBeGreaterThan(3 * 0.5);
  });

  it("never extends a stagger that is already running longer", () => {
    const z = makeDon();
    state.zombies.push(z);
    z.staggerT = 3.0;

    donQuixoteWallCrash(z, 0, 1);

    expect(z.staggerT).toBe(3.0);
  });

  it("does nothing to a Don who is already dead", () => {
    const z = makeDon(0);
    state.zombies.push(z);

    expect(donQuixoteWallCrash(z, 1, 0)).toBe(0);
    expect(z.staggerT).toBe(0);
  });

  it("can be the blow that kills him — riding your last hearts into a wall", () => {
    const z = makeDon(DON_QUIXOTE_CRASH_SELF_DAMAGE);
    state.zombies.push(z);

    donQuixoteWallCrash(z, 1, 0);

    expect(z.hp).toBeLessThanOrEqual(0);
  });

  // ── The wiring, which is the part that was missing ────────────────────────

  it("actually spawns from the level he is unlocked on", () => {
    expect(KIND_SKIN.don_quixote).toBeDefined();
    expect(spawnKind("don_quixote", 4, 4, 2.0, DON_QUIXOTE_FROM_LEVEL)).not.toBeNull();
    // ...and NOT before it.
    expect(spawnKind("don_quixote", 4, 4, 2.0, DON_QUIXOTE_FROM_LEVEL - 1)).toBeNull();
  });

  it("charges on the engine's committed-dash path, not on a private one", () => {
    // `leaper` is what puts him in `windup` at range with a visible tell; the
    // windup's release hands him to `startCharge` (entities/zombie.ts).
    expect(MOVEMENT_BY_KIND.don_quixote).toBe("leaper");
    expect(STATS.don_quixote.ranged).toBe(false);
  });

  it("telegraphs and commits longer than the hound he borrows the dash from", () => {
    // Both of these are the whole design: you must be able to see it coming and
    // step out of the line. A charge as snappy as the hound's is not a joust.
    expect(DON_QUIXOTE_ATTACK_WINDUP).toBeGreaterThan(HOUND_ATTACK_WINDUP);
    expect(DON_QUIXOTE_CHARGE_SPEED).toBeLessThan(HOUND_CHARGE_SPEED);
    expect(DON_QUIXOTE_CHARGE_TIME).toBeGreaterThan(0);
  });

  it("reaches far enough on one charge to actually cross a corridor", () => {
    expect(DON_QUIXOTE_CHARGE_SPEED * DON_QUIXOTE_CHARGE_TIME).toBeGreaterThan(4);
  });

  it("is armoured against flinch, so out-trading him is not the answer", () => {
    expect(PAIN_BY_KIND.don_quixote).toBeLessThan(PAIN_BY_KIND.zombie);
  });

  // ── Registration: every table a kind has to land in ───────────────────────

  it("is registered in every per-kind table the game reads", () => {
    expect(HP_BY_KIND.don_quixote).toBe(DON_QUIXOTE_HP);
    expect(DMG_BY_KIND.don_quixote).toBeGreaterThan(0);
    expect(STATS.don_quixote).toBeDefined();
    expect(ENEMY_DROPS.don_quixote.length).toBeGreaterThan(0);
    expect(KIND_INFO.don_quixote.label).toBe("Don Quixote");
    expect(KIND_INFO.don_quixote.blurb).toMatch(/wall/i); // the bestiary teaches the mechanic
  });

  it("has published art AND a painter, and the painter authors the crash clip", () => {
    expect(SHEET_KEYS.has("don_quixote")).toBe(true);
    expect(IMPORTED_ART.don_quixote).toBe("don_quixote");
    expect(SHEET_PAINTERS.don_quixote).toBe(makeDonQuixotePaints);

    const paints = makeDonQuixotePaints();
    for (const dir of ["S", "N", "E"] as const) {
      for (const clip of ["idle", "walk", "attack", "death", "stumble"] as const) {
        expect(paints[dir][clip]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
