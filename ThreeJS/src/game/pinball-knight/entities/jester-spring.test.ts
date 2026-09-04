/**
 * THE JESTER'S SPRING RECOIL.
 *
 * The jester's coil catches a standing swing and throws the knight off it. That
 * is two coupled rules, and the coupling is the whole design — so what is worth
 * pinning is not "the kick exists" but that the kick and the damage gate are
 * the SAME condition seen from both sides:
 *
 *   · a swing with no momentum behind it → refused, AND you get thrown
 *   · a swing carried at speed           → lands, AND nothing throws you
 *
 * If those ever drift apart the monster becomes either un-meleeable (thrown
 * even when the hit lands) or toothless (refused with no consequence), and both
 * read as a bug rather than as a rule.
 *
 * Also pinned: the gate check in combat.ts is driven by `MOMENTUM_GATES`
 * `gatesDamage` rather than by a hardcoded list of kinds. That list used to be
 * `z.kind === "goblin" || z.kind === "golem"` inline, i.e. a second roster to
 * keep in step with the table the bestiary prints from — the hand-mirror trap
 * this repo keeps rediscovering.
 *
 * Rendering/audio are not tested (house rule): `state.vfx` is left undefined so
 * the optional-chained calls no-op.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { damageZombie } from "./combat";
import { MOMENTUM_GATES } from "./enemy-rules";
import { JESTER_SPRING_KICK, PLAYER_SPEED } from "../constants";

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
    stagger: 0, painT: 0, knockT: 0, kbx: 0, kbz: 0,
    sprite: { setTint() {}, mesh: { position: { set() {} }, scale: { multiplyScalar() {} } } },
    anim: { play() {}, setFacing() {}, setRate() {} },
  };
}

beforeEach(() => {
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as Any;
  state.weaponSlots = [null, null];
  state.activeSlot = 0;
  state.zombies = [];
  state.vfx = undefined as never;
  state.grid = {} as never; // truthy so damageZombie doesn't early-return
});

/** The knight standing still, three units away along +x from the jester. */
function standingKnightAt(px: number, pz: number): Any {
  const p = state.player!;
  p.x = px;
  p.z = pz;
  p.hp = 10;
  p.momSpeed = 0;
  p.momX = 0;
  p.momZ = 0;
  p.bounceCombo = 0;
  return p;
}

describe("the jester's momentum gate", () => {
  it("is declared in MOMENTUM_GATES and marked as gating damage", () => {
    const g = MOMENTUM_GATES.jester;
    expect(g, "the jester has no momentum gate — the bestiary would print nothing").toBeTruthy();
    expect(g!.gatesDamage).toBe(true);
    expect(g!.text).toMatch(/spring/i);
  });

  it("only the kinds that actually gate damage carry the flag", () => {
    expect(MOMENTUM_GATES.goblin!.gatesDamage).toBeFalsy();
    expect(MOMENTUM_GATES.golem!.gatesDamage).toBe(true);
    expect(MOMENTUM_GATES.chomper!.gatesDamage).toBeFalsy();
    expect(MOMENTUM_GATES.crystalback!.gatesDamage).toBeFalsy();
  });
});

describe("a standing swing at a jester", () => {
  it("is refused: no damage lands", () => {
    const p = standingKnightAt(1, 0);
    const z = fakeZombie("jester", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, 1, 0, 0.3);
    expect(p.momSpeed, "the knight was not thrown").toBeGreaterThan(0);
    expect(z.hp, "a refused blow still took HP off").toBe(100);
  });

  it("throws the knight AWAY from the jester at the spring speed", () => {
    // Knight to the +x side: it must be launched further +x, never through the
    // monster. The sign here is the difference between a spring and a grab.
    const p = standingKnightAt(2, 0);
    const z = fakeZombie("jester", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, 1, 0, 0.3);
    expect(p.momSpeed).toBeGreaterThanOrEqual(JESTER_SPRING_KICK - 1e-6);
    expect(p.momX, "launched toward the jester instead of away from it").toBeGreaterThan(0.9);
    expect(Math.abs(p.momZ)).toBeLessThan(0.1);
  });

  it("ticks the bounce combo, so a refused swing still feeds the ride", () => {
    const p = standingKnightAt(0, 3);
    const z = fakeZombie("jester", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, 0, 1, 0.3);
    expect(p.bounceCombo).toBe(1);
    expect(p.bounceComboT).toBeGreaterThan(0);
    expect(p.momZ, "launched along -z, back through the jester").toBeGreaterThan(0.9);
  });

  it("grants i-frames, so being thrown does not feed you to the plate in the air", () => {
    const p = standingKnightAt(1, 0);
    p.iframes = 0;
    const z = fakeZombie("jester", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, 1, 0, 0.3);
    expect(p.iframes).toBeGreaterThan(0.2);
  });
});

describe("a swing carried at momentum", () => {
  it("lands, and does NOT throw the knight", () => {
    const p = standingKnightAt(1, 0);
    // Well past the bar (MOMENTUM_T_FLOOR is PLAYER_SPEED), so the gate opens.
    p.momSpeed = PLAYER_SPEED * 4;
    p.momX = -1;
    p.momZ = 0;
    const z = fakeZombie("jester", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, -1, 0, 0.3);
    expect(z.hp, "a momentum blow was still refused").toBeLessThan(100);
    // The spring is compressed past its travel: it has nothing left to throw
    // with, so the knight's heading is untouched by this hit.
    expect(p.momX).toBe(-1);
    expect(p.bounceCombo).toBe(0);
  });
});

describe("the spring is the JESTER's, not every monster's", () => {
  it("a plain zombie neither refuses the blow nor throws the knight", () => {
    const p = standingKnightAt(1, 0);
    const z = fakeZombie("zombie", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, 1, 0, 0.3);
    expect(z.hp).toBeLessThan(100);
    expect(p.momSpeed).toBe(0);
    expect(p.bounceCombo).toBe(0);
  });

  it("a goblin takes damage from a standing poke, and does not spring you", () => {
    const p = standingKnightAt(1, 0);
    const z = fakeZombie("goblin", 0, 0);
    state.zombies = [z];
    damageZombie(z, 5, 1, 0, 0.3);
    expect(z.hp, "goblin takes standard melee damage").toBe(95);
    expect(p.momSpeed, "the goblin acquired the jester's spring").toBe(0);
  });
});
