/**
 * CONTACT-BLOB POOL — every actor's ground shadow in ONE draw call.
 *
 * The soft dark ellipse under each actor is the most duplicated object in the
 * scene: identical geometry, identical material, identical orientation, ~175
 * of them at the horde cap. The only thing that differs per actor is WHERE it
 * is and whether it is visible — which is exactly what an InstancedMesh
 * expresses.
 *
 * ── Why blobs instance cleanly and sprites do not ─────────────────────────
 *
 * A sprite carries per-actor TEXTURE state (which animation frame, flipped or
 * not), and that lives on the texture object, so sharing one texture across
 * instances would animate the whole horde in lockstep. A blob carries no
 * texture state at all. It is the same picture every time. So it needs nothing
 * but a per-instance matrix, and instancing it is unconditional.
 *
 * ── The orientation trick, preserved ──────────────────────────────────────
 *
 * The camera never rotates, so "lie flat on the floor" is a CONSTANT
 * quaternion. The old per-actor blob was parented to the billboarded sprite
 * and counter-rotated by its inverse. Instances have no parent to counteract,
 * so they take the flat rotation directly — simpler, and it removes the
 * per-actor quaternion maths the old path did on every elevation change.
 *
 * ── Ownership ─────────────────────────────────────────────────────────────
 *
 * The pool owns slots, not actors. An actor takes a slot on creation and
 * releases it on dispose; a released slot is parked far below the floor rather
 * than compacted, because compaction would renumber every live slot and every
 * actor's handle with it. Slots are recycled from a free list, so a floor that
 * spawns and kills thousands of zombies does not grow the buffer.
 */
import * as THREE from "three";
import { engineConfig } from "../config";

/** Where a released slot is parked: far under the floor, never in frustum. */
const PARKED_Y = -1000;

/** Grow the instance buffer in chunks rather than one at a time. */
const GROW_BY = 64;

export interface BlobPool {
  mesh: THREE.InstancedMesh;
  /** Claim a slot. Returns its index — the actor's handle. */
  claim(): number;
  /** Position a slot's blob on the floor. */
  place(slot: number, x: number, y: number, z: number): void;
  /** Show/hide one slot without releasing it (ramp hops hide the shadow). */
  setVisible(slot: number, v: boolean): void;
  /** Release a slot back to the free list. */
  release(slot: number): void;
  dispose(): void;
}

/**
 * Build the pool. `texture` is the shared radial-gradient blob image; it is
 * passed in rather than made here so sprite.ts stays the single owner of that
 * canvas.
 */
export function createBlobPool(scene: THREE.Scene, texture: THREE.Texture, initial = 128): BlobPool {
  const geo = new THREE.PlaneGeometry(engineConfig.sprite.units * 0.62, engineConfig.sprite.units * 0.62);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    fog: true,
  });

  let capacity = initial;
  let mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.renderOrder = 6; // above the floor, below the actors (10)
  // An InstancedMesh's bounding volume covers every instance including parked
  // ones, so leaving it to three.js would produce a box stretching to y=-1000
  // and the pool would never be culled anyway. Disable it explicitly: the
  // blobs follow actors that are on screen, and the cost of drawing the whole
  // pool is one draw call regardless.
  mesh.frustumCulled = false;
  scene.add(mesh);

  /** The flat-on-the-floor rotation. Constant — the camera never rotates. */
  const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const ONE = new THREE.Vector3(1, 1, 1);
  const ZERO = new THREE.Vector3(0, 0, 0);
  const tmp = new THREE.Matrix4();
  const pos = new THREE.Vector3();

  let used = 0;
  const free: number[] = [];
  /** Last placed position per slot, so setVisible can restore it. */
  const at: Array<{ x: number; y: number; z: number }> = [];

  function park(slot: number): void {
    tmp.compose(new THREE.Vector3(0, PARKED_Y, 0), FLAT, ZERO);
    mesh.setMatrixAt(slot, tmp);
    mesh.instanceMatrix.needsUpdate = true;
  }

  function grow(): void {
    const next = capacity + GROW_BY;
    const bigger = new THREE.InstancedMesh(geo, mat, next);
    bigger.renderOrder = mesh.renderOrder;
    bigger.frustumCulled = false;
    // Carry every existing instance across, or every live actor's shadow would
    // jump to the origin the moment the pool grew.
    for (let i = 0; i < capacity; i++) {
      mesh.getMatrixAt(i, tmp);
      bigger.setMatrixAt(i, tmp);
    }
    for (let i = capacity; i < next; i++) {
      tmp.compose(new THREE.Vector3(0, PARKED_Y, 0), FLAT, ZERO);
      bigger.setMatrixAt(i, tmp);
    }
    bigger.instanceMatrix.needsUpdate = true;
    scene.remove(mesh);
    mesh.dispose();
    mesh = bigger;
    scene.add(mesh);
    capacity = next;
  }

  // Start every slot parked, so an unclaimed slot never draws at the origin.
  for (let i = 0; i < capacity; i++) park(i);

  return {
    get mesh() {
      return mesh;
    },
    claim(): number {
      const slot = free.length ? free.pop()! : used++;
      if (slot >= capacity) grow();
      at[slot] = { x: 0, y: PARKED_Y, z: 0 };
      return slot;
    },
    place(slot: number, x: number, y: number, z: number): void {
      at[slot] = { x, y, z };
      pos.set(x, y, z);
      tmp.compose(pos, FLAT, ONE);
      mesh.setMatrixAt(slot, tmp);
      mesh.instanceMatrix.needsUpdate = true;
    },
    setVisible(slot: number, v: boolean): void {
      if (v) {
        const p = at[slot];
        pos.set(p.x, p.y, p.z);
        tmp.compose(pos, FLAT, ONE);
      } else {
        // Scale to zero rather than parking: the slot keeps its remembered
        // position so showing it again needs no bookkeeping from the caller.
        tmp.compose(pos.set(0, PARKED_Y, 0), FLAT, ZERO);
      }
      mesh.setMatrixAt(slot, tmp);
      mesh.instanceMatrix.needsUpdate = true;
    },
    release(slot: number): void {
      park(slot);
      free.push(slot);
    },
    dispose(): void {
      scene.remove(mesh);
      mesh.dispose();
      geo.dispose();
      mat.dispose();
      free.length = 0;
      at.length = 0;
      used = 0;
    },
  };
}
