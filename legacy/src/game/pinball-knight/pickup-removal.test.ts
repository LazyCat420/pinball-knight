import { describe, it, expect, beforeEach, vi } from "vitest";

// The weapon-EXCHANGE case below puts a weapon back on the floor, which builds a
// real sprite — a canvas the node test environment does not have. Only the
// factory is stubbed; everything else in the module is the real thing, and the
// stub still returns a mesh so "was it parented to the scene" stays assertable.
vi.mock("./engine/render/sprite", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createStaticSprite: () => ({ mesh: { tag: "dropped", position: { set: () => {} } }, dispose: () => {} }),
}));

import { checkPickups, resetPickupSweep } from "./economy/pickups";
import { state } from "./state";
import type { GroundItem } from "./state";
import { CARD_IDS } from "./cards";
import { FIXED_STEP } from "./constants";

/**
 * THE BUG THIS FILE EXISTS FOR
 *
 * "I pick up a card and it's still on the map."
 *
 * It was not a rendering leak — every kind's sprite is unparented and disposed
 * through `removeGroundItem`, and a headless soak confirmed no orphan sprite
 * ever survives a real pickup. The card was simply never picked up: the run
 * stash was capped at 10, nothing drains it mid-run, and past the cap
 * `pickUpCard` REFUSED and left the card lying there — drawn exactly like one
 * you could still take. At depth 5 that was every card on the floor, and the
 * only tell was one line in a busy corner rail.
 *
 * So there are two properties to hold, and this file pins both:
 *
 *   1. A card is ALWAYS taken, however many are already stashed. (§the cap)
 *   2. Whatever kind is taken, its sprite LEAVES THE SCENE. (§the floor)
 *
 * §2 is the one that was never actually asserted anywhere. It passed the whole
 * time, which is exactly why it is worth a test — the reported symptom was
 * "still rendered", and nothing in the suite could have told the two causes
 * apart.
 */

/** A scene stub that records what is parented to it, so "left the scene" is a
 *  fact this test can read rather than an effect it has to trust. */
function fakeScene(): { children: unknown[]; add(o: unknown): void; remove(o: unknown): void } {
  const children: unknown[] = [];
  return {
    children,
    add(o) {
      children.push(o);
    },
    remove(o) {
      const i = children.indexOf(o);
      if (i >= 0) children.splice(i, 1);
    },
  };
}

let scene: ReturnType<typeof fakeScene>;
let disposed: string[];

/** A ground item whose sprite is really in the scene, and which records its own
 *  disposal — a mesh removed but never disposed still leaks GPU memory. */
function fakeItem(kind: GroundItem["kind"], id: string, x: number, z: number): GroundItem {
  const mesh = { tag: `${kind}:${id}` };
  scene.add(mesh);
  return {
    kind,
    id,
    x,
    z,
    bobPhase: 0,
    sprite: { mesh, dispose: () => disposed.push(`${kind}:${id}`) } as unknown as GroundItem["sprite"],
  };
}

function stubWorld(): void {
  scene = fakeScene();
  disposed = [];
  state.player = {
    x: 0,
    z: 0,
    magnetAuraT: 0,
    hp: 5,
    maxHp: 10,
    material: null,
    materialT: 0,
    fuseMaterial: null,
    fuseT: 0,
    sprite: { mesh: {} },
  } as unknown as typeof state.player;
  state.groundItems = [];
  state.scene = scene as unknown as typeof state.scene;
  state.vfx = null;
  state.container = null;
  state.cardStash = [];
  state.floorHaul = [];
  state.seenCards = new Set();
  state.belt = [null, null, null, null];
  state.gear = {};
  state.reagents = {};
  state.weaponSlots = [null, null];
  state.activeSlot = 0;
  state.level = 1;
  resetPickupSweep();
}

/** Move the knight to (x,z) and run one 60Hz pickup step. */
function step(x: number, z: number): void {
  state.player!.x = x;
  state.player!.z = z;
  checkPickups(FIXED_STEP);
}

/** Walk from where the knight stands onto (x,z) in small steps, so the swept
 *  grab fires the way it does in a run rather than by teleport. */
function walkOnto(x: number, z: number): void {
  const from = { x: state.player!.x, z: state.player!.z };
  for (let t = 0.25; t <= 1.0001; t += 0.25) step(from.x + (x - from.x) * t, from.z + (z - from.z) * t);
}

describe("the stash cap no longer strands cards on the floor", () => {
  beforeEach(stubWorld);

  it("takes card after card with both hands empty — the floor always clears", () => {
    // Well past the old STASH_MAX of 10. The 11th used to be the last one the
    // knight could take for the rest of the run.
    for (let n = 0; n < 40; n++) {
      state.groundItems = [fakeItem("card", CARD_IDS[n % CARD_IDS.length], 0, 1.2)];
      state.player!.x = 0;
      state.player!.z = 0;
      resetPickupSweep();
      step(0, 0);
      walkOnto(0, 1.2);
      expect(state.groundItems, `card #${n + 1} was left on the floor`).toHaveLength(0);
    }
    expect(state.cardStash).toHaveLength(40);
    // …and none of the 40 sprites is still parented to the scene.
    expect(scene.children).toHaveLength(0);
    expect(disposed).toHaveLength(40);
  });

  it("a card taken while the stash is already deep still leaves the scene", () => {
    state.cardStash = CARD_IDS.slice(0, 5).concat(CARD_IDS.slice(0, 5)); // 10 = the old cap
    state.groundItems = [fakeItem("card", CARD_IDS[0], 0, 1.2)];
    walkOnto(0, 1.2);
    expect(state.groundItems).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    expect(disposed).toEqual([`card:${CARD_IDS[0]}`]);
  });
});

describe("every walk-over kind takes its sprite with it", () => {
  beforeEach(stubWorld);

  // The kinds `checkPickups` grabs on contact. Coins and reagents are excluded
  // deliberately — they are absorbed when their magnet FLIGHT arrives, not on
  // proximity, so they are not walk-over pickups and a contact test would say
  // nothing about them.
  const KINDS: Array<[GroundItem["kind"], string]> = [
    ["card", CARD_IDS[0]],
    ["potion", "health"],
    ["gear", "armor"],
    ["weapon", "bow"],
    ["material", "stone"],
  ];

  for (const [kind, id] of KINDS) {
    it(`${kind}: removed from the list, unparented from the scene, and disposed`, () => {
      state.groundItems = [fakeItem(kind, id, 0, 1.2)];
      expect(scene.children).toHaveLength(1);

      walkOnto(0, 1.2);

      expect(state.groundItems, `${kind} stayed in the ground-item list`).toHaveLength(0);
      // THE REPORTED SYMPTOM. A kind that took the pickup but left the quad
      // parented would still be lying on the map for the player to see.
      expect(scene.children, `${kind} sprite is still in the scene`).toHaveLength(0);
      expect(disposed, `${kind} sprite was unparented but never disposed`).toEqual([`${kind}:${id}`]);
    });
  }

  it("a weapon EXCHANGE puts the old weapon down without leaving the new one's sprite up", () => {
    // Both hands full, so picking up drops the outgoing weapon where the new
    // one lay — the one branch that adds a sprite on the same step it removes
    // one, and the easiest place for a stale quad to hide.
    state.weaponSlots = [
      { id: "sword", durability: 10, rarity: "common", cards: [], bonusSlots: 0, upgrade: 0 },
      { id: "axe", durability: 10, rarity: "common", cards: [], bonusSlots: 0, upgrade: 0 },
    ] as unknown as typeof state.weaponSlots;
    state.groundItems = [fakeItem("weapon", "bow", 0, 1.2)];

    walkOnto(0, 1.2);

    // The bow is in hand and its floor sprite is gone; the sword it displaced is
    // the ONE item now on the floor, and it owns the one sprite in the scene.
    expect(state.weaponSlots[0]!.id).toBe("bow");
    expect(state.groundItems.map((i) => i.id)).toEqual(["sword"]);
    expect(disposed).toEqual(["weapon:bow"]);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(state.groundItems[0].sprite.mesh);
  });
});
