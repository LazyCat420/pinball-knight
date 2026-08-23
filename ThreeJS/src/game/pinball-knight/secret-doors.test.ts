/**
 * REVOLVING SECRET DOORS — the smashed band swings out instead of blinking away.
 *
 * Asked for directly: "for the doors we sometimes go thru that are like secret
 * doors please keep those but add an animation of the doors spinning like the
 * spinning rotating glass doors you see in those office buildings."
 *
 * The animation is cosmetic, but two things about it are not, and both are
 * pinned here because both would ship looking fine and be wrong:
 *
 *  · the band must ROTATE ABOUT ITSELF. `build.ts` positions each of the four
 *    tile meshes at its own world centre inside a group parked at the origin,
 *    so rotating that group unmodified swings the band around the middle of the
 *    MAP — a wall that flies across the level;
 *  · the crack material is SHARED across every secret band on the floor
 *    (build.ts caches it), so fading the original fades every other secret wall
 *    at the same time. The door must fade a clone.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { updateSecretDoors, disposeSecretDoors, smashSecretAt } from "./secrets";
import { state } from "./state";
import { T_CRACKED, T_FLOOR, at, setTile, type Grid } from "./maze/generator";

const W = 12;

function grid(): Grid {
  const g: Grid = { w: W, h: W, t: new Uint8Array(W * W).fill(1), shapes: new Uint8Array(W * W) };
  for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) setTile(g, 5 + di, 5 + dj, T_CRACKED);
  return g;
}

/** A band group shaped exactly like build.ts makes one: children at their own
 *  world centres, group at the origin. */
function band(shared: THREE.MeshStandardMaterial): THREE.Group {
  const gp = new THREE.Group();
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    m.position.set(-1 + dx, 0.5, -1 + dz); // world-ish coords, not local
    gp.add(m);
  }
  return gp;
}

beforeEach(() => {
  disposeSecretDoors();
  // NO SCENE, deliberately. `smashSecretAt` drops loot through
  // `createStaticSprite`, which builds a canvas texture and needs a DOM this
  // project's tests do not have (there is no jsdom here). That whole block is
  // guarded by `if (!state.scene) return`, so leaving it null exercises the
  // door path and skips the loot path — which is the half under test.
  state.scene = null;
  state.grid = grid();
  state.vfx = null;
  state.shakeT = 0;
  state.hitstopT = 0;
  state.groundItems = [];
  state.witchSpawned = true; // keep the witch out of this test
  state.flowTimer = 99;
  state.player = null;
});

function installBand(shared: THREE.MeshStandardMaterial): THREE.Group {
  const gp = band(shared);
  // A plain parent stands in for the maze group; the door only ever asks its
  // parent to remove it, so a Scene is not required.
  const group = new THREE.Group();
  group.add(gp);
  state.maze = {
    group,
    secrets: [{ i: 5, j: 5, x: -1, z: -1, mesh: gp }],
  } as unknown as typeof state.maze;
  return gp;
}

describe("revolving secret doors", () => {
  it("smashing opens the grid immediately — the spin never gates the player", () => {
    const shared = new THREE.MeshStandardMaterial();
    installBand(shared);
    expect(smashSecretAt(5, 5)).toBe(true);
    // All four tiles walkable on the same frame the door starts turning.
    for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      expect(at(state.grid!, 5 + di, 5 + dj), `tile ${di},${dj} still solid`).toBe(T_FLOOR);
    }
  });

  it("the band turns about ITS OWN centre, not the map origin", () => {
    const shared = new THREE.MeshStandardMaterial();
    const gp = installBand(shared);
    gp.updateMatrixWorld(true);
    const worldBefore = new THREE.Vector3();
    gp.children[0].getWorldPosition(worldBefore);
    smashSecretAt(5, 5);
    // Re-anchored onto the band centre…
    expect(gp.position.x).toBeCloseTo(-1, 6);
    expect(gp.position.z).toBeCloseTo(-1, 6);
    // …and the geometry did NOT move while that happened. This is the assertion
    // that actually catches the bug: a bounds check on the children passes
    // whether or not they were rebased (they start within a tile of the origin
    // either way). What cannot be faked is the WORLD position — if the group
    // moved to the band centre and the children were not offset back, every
    // tile jumps by the centre vector.
    gp.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    gp.children[0].getWorldPosition(world);
    expect(world.x, "the band teleported when it was re-anchored").toBeCloseTo(worldBefore.x, 5);
    expect(world.z, "the band teleported when it was re-anchored").toBeCloseTo(worldBefore.z, 5);
    const before = gp.rotation.y;
    updateSecretDoors(0.2);
    expect(gp.rotation.y, "it did not turn").toBeGreaterThan(before);
  });

  it("fades a CLONE — the other secret walls on the floor keep their material", () => {
    const shared = new THREE.MeshStandardMaterial();
    const gp = installBand(shared);
    smashSecretAt(5, 5);
    updateSecretDoors(0.8); // deep into the fade window
    expect(shared.opacity, "the shared crack material was faded — every other secret wall dimmed too").toBe(1);
    const first = gp.children[0] as THREE.Mesh;
    const mat = (Array.isArray(first.material) ? first.material[0] : first.material) as THREE.MeshStandardMaterial;
    expect(mat).not.toBe(shared);
    expect(mat.opacity).toBeLessThan(1);
  });

  it("removes itself when the sweep finishes, and leaves nothing behind", () => {
    const shared = new THREE.MeshStandardMaterial();
    const gp = installBand(shared);
    smashSecretAt(5, 5);
    for (let i = 0; i < 40; i++) updateSecretDoors(0.05); // 2s, well past REVOLVE_TIME
    expect(gp.parent, "the door never left the scene").toBeNull();
  });

  it("teardown drops a door still turning — it must not survive the floor", () => {
    const shared = new THREE.MeshStandardMaterial();
    const gp = installBand(shared);
    smashSecretAt(5, 5);
    updateSecretDoors(0.1); // mid-spin
    expect(gp.parent).not.toBeNull();
    disposeSecretDoors();
    expect(gp.parent, "a half-spun door carried into the next floor").toBeNull();
  });
});
