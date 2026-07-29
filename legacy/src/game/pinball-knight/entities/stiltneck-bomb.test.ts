/**
 * THE STILTNECK'S BOMB — the one hostile shot with a FUSE and a BLAST.
 *
 * Every other enemy projectile in this game answers the same question ("was the
 * knight on the line?") and takes the same early-out in `updateProjectiles`:
 * `if (pr.hostile) { …check the player…; continue; }`, which is what stops
 * monsters from casually killing each other. The bomb is the one exception, and
 * an exception in a hot loop is exactly the kind of thing that gets tidied away
 * by someone who has not read why it is there — so what is pinned here is the
 * WHY, not the plumbing:
 *
 *   1. IT ALWAYS DETONATES. On the player, on masonry, or on the fuse running
 *      out. If any of those three paths ever despawns quietly instead, the
 *      monster becomes a spitter with a slower glob and the whole design — "you
 *      have to leave the ground, not just the line" — silently stops existing.
 *      A quiet despawn is invisible in play: the bomb reaches you, vanishes, and
 *      reads as a projectile that missed.
 *   2. THE BLAST HURTS THE HORDE. That is the counter-play the family is priced
 *      around (deepest gate, slowest walk, longest tell), and it is the only
 *      hostile damage in the game that does.
 *   3. IT STILL CANNOT TOUCH THE DEATH DEALER. `detonate` passes `force = true`
 *      to `damageZombie` so an explosion ignores momentum gates — an explosion
 *      does not care how fast the KNIGHT happens to be moving — but `force` also
 *      bypasses the reaper's immunity, which is not a rule a monster gets to
 *      break. The skip is explicit and this is what keeps it.
 *   4. FALLOFF IS FOR THE PLAYER ONLY. The knight is asked to read a radius and
 *      commit to leaving it, so the rim has to be survivable; the horde has no
 *      such contract and eats the full number.
 *
 * Rendering/audio are not tested (house rule): `state.vfx` is left undefined so
 * the optional-chained calls no-op.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { state, freshPlayerFields } from "../state";
import { detonate } from "./projectiles";
import {
  STILTNECK_BLAST_RADIUS,
  STILTNECK_BLAST_DAMAGE,
  STILTNECK_BLAST_ENEMY_DAMAGE,
} from "../constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function fakeZombie(kind: string, x: number, z: number): Any {
  return {
    kind,
    hp: 100,
    maxHp: 100,
    mode: "chase",
    x,
    z,
    dotT: 0, dotDmg: 0, dotTickT: 0, chillT: 0, flashT: 0, aggro: false,
    painEntropy: 0, windupT: 0, cooldown: 0, burnT: 0, speed: 1,
    sprite: { setTint() {}, mesh: { position: { set() {} }, scale: { multiplyScalar() {} } } },
    anim: { play() {}, setFacing() {}, setRate() {} },
  };
}

beforeEach(() => {
  state.player = {
    x: 99,
    z: 99,
    ...freshPlayerFields(),
    // `hitPlayerRanged` flashes the knight's billboard on a connect, so the
    // player needs a sprite stub the moment the blast can actually reach them.
    sprite: { setTint() {}, mesh: { position: { set() {} } } },
  } as Any;
  state.player!.hp = 10;
  state.weaponSlots = [null, null];
  state.activeSlot = 0;
  state.zombies = [];
  state.vfx = undefined as never;
  state.scene = undefined as never;
  state.grid = {} as never; // truthy so damageZombie doesn't early-return
  state.godMode = false;
  state.shakeT = 0;
});

describe("the blast is indiscriminate", () => {
  it("hurts MONSTERS inside the radius — the whole counter-play", () => {
    const near = fakeZombie("zombie", 0.5, 0);
    const far = fakeZombie("zombie", STILTNECK_BLAST_RADIUS + 1, 0);
    state.zombies = [near, far];

    detonate(0, 0);

    expect(100 - near.hp, "a zombie inside the blast").toBe(STILTNECK_BLAST_ENEMY_DAMAGE);
    expect(far.hp, "a zombie outside it").toBe(100);
  });

  it("hits the horde at FULL damage — no falloff, unlike the player", () => {
    // Right on the rim, where the knight would take the halved number.
    const rim = fakeZombie("zombie", STILTNECK_BLAST_RADIUS - 0.01, 0);
    state.zombies = [rim];
    detonate(0, 0);
    expect(100 - rim.hp).toBe(STILTNECK_BLAST_ENEMY_DAMAGE);
  });

  it("ignores the momentum gates — an explosion is not a swing", () => {
    // A goblin is rubber: `MOMENTUM_GATES` refuses a blow carried at zero speed,
    // and the knight standing still is the NORMAL case when a bomb lands, so
    // without `force` the bait-it-into-the-horde play would clink off every
    // gated monster in the room and read as the blast being broken.
    const p = state.player!;
    p.momSpeed = 0;
    p.momX = 0;
    p.momZ = 0;
    const goblin = fakeZombie("goblin", 0.4, 0);
    state.zombies = [goblin];
    detonate(0, 0);
    expect(100 - goblin.hp).toBe(STILTNECK_BLAST_ENEMY_DAMAGE);
  });

  it("still cannot touch the DEATH DEALER", () => {
    // `force` is what buys rule 3 above, and `force` is also what would let a
    // stiltneck kill the one thing in the game that cannot be killed. The skip
    // in `detonate` is the only thing standing between those two facts.
    const reaper = fakeZombie("reaper", 0.2, 0);
    state.zombies = [reaper];
    detonate(0, 0);
    expect(reaper.hp).toBe(100);
  });

  it("skips the already-dead, so a corpse cannot soak a blast", () => {
    const corpse = fakeZombie("zombie", 0.2, 0);
    corpse.mode = "dead";
    state.zombies = [corpse];
    detonate(0, 0);
    expect(corpse.hp).toBe(100);
  });
});

describe("the blast falls off for the knight", () => {
  it("hits hardest at the seat and softest at the rim", () => {
    const hpAfter = (dist: number): number => {
      const p = state.player!;
      p.hp = 10;
      p.iframes = 0;
      p.x = dist;
      p.z = 0;
      detonate(0, 0);
      return p.hp;
    };
    const centre = 10 - hpAfter(0);
    const rim = 10 - hpAfter(STILTNECK_BLAST_RADIUS - 0.02);
    expect(centre, "dead centre").toBe(STILTNECK_BLAST_DAMAGE);
    expect(rim, "a graze").toBeGreaterThan(0); // never free — the radius is not a lie
    // THE ROUNDING IS THE MECHANIC, at these numbers. Blast damage is 2, so the
    // scaled value only dips under 1.0 in the last hundredth of the radius —
    // which means `ceil` (the obvious choice, and what shipped first) rounds
    // every graze back to full and the falloff exists only in the comment. This
    // assertion is here to fail if anyone reaches for `ceil` again.
    expect(rim).toBeLessThan(centre);
  });

  it("misses entirely outside the radius", () => {
    const p = state.player!;
    p.x = STILTNECK_BLAST_RADIUS + 0.05;
    p.z = 0;
    p.iframes = 0;
    detonate(0, 0);
    expect(p.hp).toBe(10);
  });

  it("still levels the horde while the knight is in i-frames", () => {
    // A dodge-roll through a bomb protects the KNIGHT, not the room. If the
    // whole detonation were gated on the player being hittable, rolling would
    // quietly cancel the friendly fire too — and the one thing the player is
    // being taught to set up would stop happening exactly when they played well.
    const p = state.player!;
    p.x = 0;
    p.z = 0;
    p.iframes = 1;
    const zb = fakeZombie("zombie", 0.3, 0);
    state.zombies = [zb];
    detonate(0, 0);
    expect(p.hp, "the roll saved the knight").toBe(10);
    expect(100 - zb.hp, "but not the horde").toBe(STILTNECK_BLAST_ENEMY_DAMAGE);
  });
});

describe("the fuse always ends in a blast", () => {
  it("is what makes this different from every other hostile shot", async () => {
    // Read the source rather than simulate the loop: `updateProjectiles` needs a
    // scene, a grid and three.js meshes, and what is actually worth guarding is
    // that all THREE end-of-life paths call `detonate` — fuse expiry, masonry,
    // and player contact. A version that detonates on two of the three is the
    // subtle bug (a bomb that reaches the wall behind you and evaporates), and
    // it is invisible in a play session.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./projectiles.ts", import.meta.url), "utf8"),
    );
    const calls = src.match(/detonate\(pr\.x, pr\.z\)/g) ?? [];
    expect(calls.length, "detonate() call sites in updateProjectiles").toBe(3);
    // And the fuse must not be range ÷ speed like every other entry here — it is
    // a wall-clock countdown, which is the entire mechanic.
    expect(src).toMatch(/life: STILTNECK_BOMB_FUSE/);
  });
});

describe("the show is not optional", () => {
  it("shakes the screen, so a blast is never damage from nowhere", () => {
    // The radius the player is asked to read has to be a radius they SAW.
    // `state.vfx` is undefined here (house rule), so the ring and the fireball
    // no-op — the shake is the one piece of feedback this test can hold onto,
    // and it is enough to catch the whole presentation block being dropped.
    const shake = vi.spyOn(state, "shakeT", "set");
    state.shakeT = 0;
    detonate(0, 0);
    expect(state.shakeT).toBeGreaterThan(0);
    shake.mockRestore();
  });
});
