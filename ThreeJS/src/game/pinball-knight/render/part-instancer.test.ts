/**
 * THE INSTANCED BOOSTER MUST BE THE SAME BOOSTER.
 *
 * `part-instancer.ts` replaces six meshes per booster with three InstancedMeshes
 * per floor. Every way that can go wrong is silent on a headless box and subtle
 * on a real one: a chevron half a tile off, a wave running backwards, a whole
 * floor's boosters culled because a bounding sphere was computed from identity
 * matrices. None of it throws.
 *
 * So this file does not test that the instancer RUNS. It tests that it agrees,
 * transform for transform and index for index, with the Group the builder makes
 * — because the Group is the thing that shipped and the thing players have
 * seen. `buildBooster` is the reference implementation, and this is the diff.
 *
 * What it CANNOT see: whether the node material draws. A `MeshStandardNodeMaterial`
 * is compiled by the renderer, and there is no renderer here. `npm run
 * playtest:gpu` is the gate for that half — see `render/mrt-coverage.test.ts`,
 * which learned the same lesson about the albedo attachment the hard way.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { PART_BUILDERS } from "./pinball-parts";
import { createPartInstancer, INSTANCED_KINDS, type EmissiveSink } from "./part-instancer";
import type { PinballPartKind } from "../state";

const FACING = { dirX: 1, dirZ: 0, dir2X: 0, dir2Z: 1 };
const OTHER = { dirX: 0, dirZ: 1, dir2X: 1, dir2Z: 0 };

/** The same release rule `pinball-parts.disposePinballParts` uses. */
function release(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat && !mat.userData.shared) mat.dispose();
  });
}

function makeInstancer(kind: PinballPartKind, count: number) {
  return createPartInstancer(
    kind,
    count,
    () => PART_BUILDERS[kind](FACING),
    () => PART_BUILDERS[kind](OTHER),
    release,
  );
}

/** yawFor, restated only because the test must place the reference Group itself. */
const yawFor = (dx: number, dz: number): number => Math.atan2(-dz, dx);

/**
 * Match a builder child's geometry to an instanced family's by SHAPE, not uuid.
 *
 * An animated family clones the shared geometry so it can carry the per-instance
 * attribute, and `clone()` mints a new uuid — so identity would pair the plate
 * (whose geometry is shared and uncloned) and nothing else. three's primitives
 * copy `.parameters` through `copy()`, which is the shape the clone kept.
 */
const shapeOf = (g: THREE.BufferGeometry): string =>
  `${g.type}|${JSON.stringify((g as unknown as { parameters?: unknown }).parameters ?? g.attributes.position.count)}`;

describe("the booster instancer agrees with the builder", () => {
  it("covers every mesh of every part, and in three draws instead of six per part", () => {
    const N = 7;
    const inst = makeInstancer("booster", N)!;
    expect(inst).not.toBeNull();

    const proto = PART_BUILDERS.booster(FACING);
    const childCount = proto.children.filter((c) => (c as THREE.Mesh).isMesh).length;
    release(proto);

    // Three families — plate, strips, chevrons — and between them exactly as
    // many instances as the Group path had meshes.
    expect(inst.meshes.length).toBe(3);
    expect(inst.meshes.reduce((n, m) => n + m.count, 0)).toBe(N * childCount);
    expect(childCount).toBe(6); // a booster is 6 meshes; a static count of the
    // source says 3, because the strips and chevrons are built in `for` loops.
  });

  it("places every instance exactly where the Group's child would have been", () => {
    const N = 3;
    const inst = makeInstancer("booster", N)!;
    const spots = [
      { x: 4, z: -2, dx: 1, dz: 0 },
      { x: -9.5, z: 13.25, dx: 0, dz: -1 },
      { x: 0, z: 0, dx: -1, dz: 0 },
    ];
    spots.forEach((s, i) => inst.place(i, s.x, s.z, yawFor(s.dx, s.dz)));

    // The reference: what the shipped path builds for the same spot.
    const want = new Map<string, THREE.Matrix4[]>();
    spots.forEach((s) => {
      const g = PART_BUILDERS.booster({ dirX: s.dx, dirZ: s.dz, dir2X: 0, dir2Z: 1 });
      g.position.set(s.x, 0, s.z);
      g.updateMatrixWorld(true);
      for (const c of g.children) {
        const m = c as THREE.Mesh;
        if (!m.isMesh) continue;
        const key = shapeOf(m.geometry);
        (want.get(key) ?? want.set(key, []).get(key)!).push(m.matrixWorld.clone());
      }
      release(g);
    });

    // Every instance matrix must equal one of the reference world matrices for
    // the same geometry — and all of them must be used up.
    const seen = new THREE.Matrix4();
    let matched = 0;
    for (const mesh of inst.meshes) {
      const pool = want.get(shapeOf(mesh.geometry)) ?? [];
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, seen);
        const at = pool.findIndex((w) => w.elements.every((e, n) => Math.abs(e - seen.elements[n]) < 1e-6));
        expect(at, `instance ${k} of ${mesh.name} sits where no builder child does`).toBeGreaterThanOrEqual(0);
        pool.splice(at, 1);
        matched++;
      }
    }
    expect(matched).toBe(N * 6);
    for (const [geo, left] of want) expect(left.length, `unmatched builder children for ${geo}`).toBe(0);
  });

  it("hands the animator sinks under the same userData keys, in the same order", () => {
    const inst = makeInstancer("booster", 2)!;
    const proto = PART_BUILDERS.booster(FACING);
    const ud = inst.userDataFor(0, 1.23);

    // Same keys the builder puts the animated materials under. The animator
    // reads `userData.chevMats[k]` and must not know which path built the part.
    expect(Object.keys(ud)).toEqual(expect.arrayContaining(["chevMats", "stripMats", "phase"]));
    expect((ud.chevMats as EmissiveSink[]).length).toBe((proto.userData.chevMats as unknown[]).length);
    expect((ud.stripMats as EmissiveSink[]).length).toBe((proto.userData.stripMats as unknown[]).length);
    expect(ud.phase).toBe(1.23);
    release(proto);
  });

  it("writes each part's intensities into its own instance slots and nobody else's", () => {
    const inst = makeInstancer("booster", 3)!;
    const a = inst.userDataFor(0, 0).chevMats as EmissiveSink[];
    const b = inst.userDataFor(1, 0).chevMats as EmissiveSink[];

    a.forEach((s, k) => (s.emissiveIntensity = 10 + k));
    b.forEach((s, k) => (s.emissiveIntensity = 20 + k));

    // Read back through the sinks: a write to part 1 must not appear on part 0.
    expect(a.map((s) => s.emissiveIntensity)).toEqual([10, 11, 12]);
    expect(b.map((s) => s.emissiveIntensity)).toEqual([20, 21, 22]);

    // And in the buffer the GPU sees, contiguously, part after part.
    const chev = inst.meshes.find((m) => m.name.endsWith("chevMats"))!;
    const attr = chev.geometry.getAttribute("aEmissive");
    expect([...(attr.array as Float32Array).slice(0, 6)]).toEqual([10, 11, 12, 20, 21, 22]);
  });

  it("uploads once per frame, and not at all on a frame nothing wrote", () => {
    const inst = makeInstancer("booster", 2)!;
    const chev = inst.meshes.find((m) => m.name.endsWith("chevMats"))!;
    const attr = chev.geometry.getAttribute("aEmissive") as THREE.BufferAttribute;

    const v0 = attr.version;
    inst.flush();
    expect(attr.version, "a frame with no animator writes must not re-upload").toBe(v0);

    (inst.userDataFor(0, 0).chevMats as EmissiveSink[])[0].emissiveIntensity = 5;
    inst.flush();
    expect(attr.version).toBe(v0 + 1);
    inst.flush();
    expect(attr.version, "flush must not re-upload what it already uploaded").toBe(v0 + 1);
  });

  it("computes a bounding sphere that actually contains the parts", () => {
    // The trap this guards: three computes an InstancedMesh's bounding sphere
    // from its instance matrices ON FIRST FRUSTUM TEST and caches it. Test it
    // before the matrices are written and every booster on the floor is culled,
    // everywhere, with nothing logged.
    const inst = makeInstancer("booster", 2)!;
    inst.place(0, 30, 30, 0);
    inst.place(1, -30, -30, 0);
    inst.finalise();
    for (const mesh of inst.meshes) {
      expect(mesh.boundingSphere, mesh.name).not.toBeNull();
      expect(mesh.boundingSphere!.radius, mesh.name).toBeGreaterThan(40);
    }
  });
});

describe("the instancer refuses what it cannot draw", () => {
  it("refuses a kind whose animator moves a child, and `ramp` is a live example", () => {
    // `buildRamp` parks `lipMesh` in userData because its animator writes
    // `lipMesh.scale.y`. Instance matrices are written once at load, so that
    // motion would silently stop — the part would look right and be inert.
    const proto = PART_BUILDERS.ramp(FACING);
    expect(proto.userData.lipMesh, "if this is gone the guard below proves nothing").toBeTruthy();
    release(proto);
    expect(makeInstancer("ramp", 4)).toBeNull();
  });

  it("refuses a count of zero rather than describing an empty draw", () => {
    expect(makeInstancer("booster", 0)).toBeNull();
  });

  it("refuses a kind whose children move with its facing", () => {
    // No shipped builder does this, so the guard is fed a synthetic one — a
    // check that cannot be made to fail is not a check.
    const direction = (o: { dirX: number; dirZ: number }): THREE.Group => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      m.position.x = o.dirX; // facing folded into the CHILD, not the group yaw
      g.add(m);
      return g;
    };
    const bad = createPartInstancer("booster", 3, () => direction(FACING), () => direction(OTHER), release);
    expect(bad).toBeNull();

    // ...and the same builder with the facing on the group DOES instance, so
    // the refusal above is about direction and not about the synthetic shape.
    const good = createPartInstancer("booster", 3, () => direction(FACING), () => direction(FACING), release);
    expect(good).not.toBeNull();
  });
});

describe("the allowlist is a measurement, not a shape test", () => {
  it("holds only booster — bumper and the boost family were struck by the census", () => {
    // 2026-08-07, three floors: bumper is 6-18 drawn against 69-84 CULLED, so
    // instancing it trades ~12 draws for ~85 instances the frustum discards for
    // free. ramp/boostcorner/boostcurve cost 0-7 draws. Adding a kind here
    // means re-running `__dungeonDraws()`, not eyeballing its builder.
    expect([...INSTANCED_KINDS]).toEqual(["booster"]);
  });
});
