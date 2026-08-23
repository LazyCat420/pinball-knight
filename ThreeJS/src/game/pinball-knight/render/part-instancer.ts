/**
 * ONE InstancedMesh PER (KIND, SLOT) — not a Group of meshes per part.
 *
 * ── THE NUMBER THIS EXISTS FOR ─────────────────────────────────────────────
 * `__dungeonDraws()` on three floors (2026-08-07, `main` @ e118e85, real
 * adapter, 1080p): boosters are 66 / 30 / 36 camera draws, #1 on every floor by
 * 2-3x, and on seed 42 with ZERO culled. A booster is 6 meshes — a plate, two
 * side strips, three chevrons — so a floor's worth is one draw per slot instead
 * of six per part. See `docs/webgpu-next-plan.md` §B0 for the full table and
 * for the two kinds the same census REMOVED from this plan.
 *
 * ── WHY NOT `mergeStaticGroup` ─────────────────────────────────────────────
 * Because it was tried and returns 2.4%. Five of a booster's six meshes carry
 * `stdOwn` materials the animator pokes individually; **a mesh that animates
 * cannot be merged, and the animation is exactly why parts cost 130 draws.**
 * Instancing is the shape that survives an animated part: the thing that varies
 * per part becomes a per-instance attribute rather than a per-part material.
 *
 * ── THE LAYOUT IS READ FROM A PROTOTYPE, NEVER RESTATED ────────────────────
 * The obvious implementation hard-codes the booster's offsets (`-0.26 + k*0.26`,
 * the ±(W-0.06)/2 strips) into the instancer. That is a second copy of the
 * layout, and the builder is free to move underneath it — the same trap as a
 * declared content height beside the real one. So this module BUILDS one part
 * with the ordinary builder and reads the child transforms off it. There is one
 * source for where a chevron sits, and it is `buildBooster`.
 *
 * ── AND THE PROTOTYPE IS CHECKED, NOT ASSUMED ──────────────────────────────
 * Reading one prototype is only sound if a part's children sit in the same
 * LOCAL place whatever direction the part faces (the builders put the facing on
 * the group's yaw, not on the children). `assertDirectionInvariant` builds a
 * second prototype facing elsewhere and refuses the kind if any child moved.
 * Without that check a kind whose builder folds direction into its children
 * would render every instance with the first prototype's geometry, silently.
 *
 * ── WHAT AN ANIMATOR SEES ──────────────────────────────────────────────────
 * Nothing new. `PART_ANIMATORS` writes `emissiveIntensity` on the materials it
 * finds in `mesh.userData`; an instanced part puts `EmissiveSink` objects there
 * instead, which write into the instance attribute. One animator body serves
 * both paths, because two write paths for one animation is how they drift.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, color } from "three/tsl";
import type { PinballPartKind } from "../state";

/**
 * What a part animator is allowed to do to an accent: set its intensity.
 *
 * `THREE.MeshStandardMaterial` satisfies this structurally, so the non-instanced
 * path needs no adapter and the animators need no branch.
 */
export interface EmissiveSink {
  emissiveIntensity: number;
}

/**
 * Kinds that render through this module.
 *
 * ⚠️ AN ALLOWLIST, AND IT IS RANKED BY MEASUREMENT — not by which builders
 * happen to fit the shape. `bumper` fits perfectly and is deliberately absent:
 * it is 6-18 drawn against 69-84 CULLED, so instancing it would trade ~12 draws
 * for ~85 instances the frustum currently discards for free. `ramp`,
 * `boostcorner` and `boostcurve` are absent for the opposite reason — they cost
 * 0-7 draws across three floors. Re-run `__dungeonDraws()` before adding one.
 */
export const INSTANCED_KINDS: ReadonlySet<PinballPartKind> = new Set<PinballPartKind>(["booster"]);

/** One InstancedMesh: every part's copies of one child slot of one kind. */
interface SlotFamily {
  mesh: THREE.InstancedMesh;
  /** Child local transforms, in build order — `perPart` of them. */
  locals: THREE.Matrix4[];
  /** userData key the animator finds these materials under, or null if static. */
  role: string | null;
  /** Per-instance emissive intensity, or null for a static slot. */
  emissive: THREE.InstancedBufferAttribute | null;
  dirty: boolean;
  /** Geometry/material this family OWNS and must dispose (shared ones are not here). */
  owned: (THREE.BufferGeometry | THREE.Material)[];
}

const _partMat = new THREE.Matrix4();
const _childMat = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, "YXZ");

/**
 * The instanced renderer for one kind on one floor.
 *
 * Built with the part COUNT up front, because an InstancedMesh's capacity is
 * fixed at construction and a floor's plan is known before any part is placed.
 */
export class PartInstancer {
  readonly kind: PinballPartKind;
  readonly meshes: THREE.InstancedMesh[];
  private readonly families: SlotFamily[];
  private readonly count: number;

  /** Use `createPartInstancer` — it is the only thing that can build the families. */
  constructor(kind: PinballPartKind, families: SlotFamily[], count: number) {
    this.kind = kind;
    this.families = families;
    this.count = count;
    this.meshes = families.map((f) => f.mesh);
  }

  /**
   * Place part `index` at (x, z) facing (dirX, dirZ) — every slot at once.
   *
   * `yaw` is passed in rather than recomputed so this module never owns a
   * second copy of `yawFor`.
   */
  place(index: number, x: number, z: number, yaw: number): void {
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    _partMat.compose(_pos.set(x, 0, z), _quat, _one);
    for (const fam of this.families) {
      for (let k = 0; k < fam.locals.length; k++) {
        _childMat.multiplyMatrices(_partMat, fam.locals[k]);
        fam.mesh.setMatrixAt(index * fam.locals.length + k, _childMat);
      }
    }
  }

  /**
   * The `userData` an instanced part carries, so `PART_ANIMATORS` finds sinks
   * exactly where it finds materials on a Group-built part.
   */
  userDataFor(index: number, phase: number): Record<string, unknown> {
    const ud: Record<string, unknown> = { phase, instanced: true };
    for (const fam of this.families) {
      if (!fam.role || !fam.emissive) continue;
      const attr = fam.emissive;
      const per = fam.locals.length;
      const sinks: EmissiveSink[] = [];
      for (let k = 0; k < per; k++) {
        const slot = index * per + k;
        sinks.push({
          get emissiveIntensity(): number {
            return attr.getX(slot);
          },
          set emissiveIntensity(v: number) {
            attr.setX(slot, v);
            fam.dirty = true;
          },
        });
      }
      ud[fam.role] = sinks;
    }
    return ud;
  }

  /** Upload whatever the animators wrote this frame. One flag per attribute. */
  flush(): void {
    for (const fam of this.families) {
      if (!fam.dirty) continue;
      if (fam.emissive) fam.emissive.needsUpdate = true;
      fam.dirty = false;
    }
  }

  /**
   * Finalise after every part is placed.
   *
   * ⚠️ THE MATRICES MUST BE SET BEFORE THE FIRST FRUSTUM TEST. three's
   * `Frustum.intersectsObject` computes an InstancedMesh's bounding sphere from
   * its instance matrices on first use and CACHES it — an InstancedMesh whose
   * matrices are still identity at that moment gets a sphere at the origin and
   * is culled everywhere on the floor, with nothing logged. Calling it here,
   * once, from a known-populated state is what makes that impossible.
   */
  finalise(): void {
    for (const fam of this.families) {
      fam.mesh.instanceMatrix.needsUpdate = true;
      fam.mesh.computeBoundingSphere();
    }
  }

  dispose(scene: THREE.Scene | null): void {
    for (const fam of this.families) {
      scene?.remove(fam.mesh);
      fam.mesh.dispose();
      for (const o of fam.owned) o.dispose();
    }
  }
}

/** A material the animators write to, found by the key it lives under. */
function rolesOf(proto: THREE.Object3D): Map<THREE.Material, { role: string; index: number }> {
  const out = new Map<THREE.Material, { role: string; index: number }>();
  for (const [role, value] of Object.entries(proto.userData)) {
    const list = Array.isArray(value) ? value : [value];
    list.forEach((m, index) => {
      if (m && (m as THREE.Material).isMaterial) out.set(m as THREE.Material, { role, index });
    });
  }
  return out;
}

/**
 * ⚠️ A KIND WHOSE ANIMATOR MOVES A CHILD CANNOT BE INSTANCED HERE.
 *
 * Instance matrices are written once at level load; a `lipMesh.scale.y` or a
 * `coil.scale.y` in the animator would simply stop happening, and the part
 * would render correctly-but-inert — the worst failure to notice. The tell is
 * an Object3D parked in `userData` for the animator to reach, so that is what
 * this refuses on. It is a heuristic, which is why `INSTANCED_KINDS` is an
 * explicit allowlist and this is the second gate rather than the only one.
 */
function animatesGeometry(proto: THREE.Object3D): boolean {
  return Object.values(proto.userData).some((v) => !!v && (v as THREE.Object3D).isObject3D === true);
}

/** Every child's local matrix, in traversal order. */
function childLocals(proto: THREE.Object3D): { mesh: THREE.Mesh; local: THREE.Matrix4 }[] {
  const out: { mesh: THREE.Mesh; local: THREE.Matrix4 }[] = [];
  for (const child of proto.children) {
    const m = child as THREE.Mesh;
    if (!m.isMesh) continue;
    m.updateMatrix();
    out.push({ mesh: m, local: m.matrix.clone() });
  }
  return out;
}

/**
 * The direction-invariance check described in the header.
 *
 * Returns false — and the kind falls back to the Group path — if two
 * prototypes built facing different ways disagree about where their children
 * sit locally, or about how many children there are.
 */
function directionInvariant(a: THREE.Object3D, b: THREE.Object3D): boolean {
  const la = childLocals(a);
  const lb = childLocals(b);
  if (la.length !== lb.length) return false;
  for (let i = 0; i < la.length; i++) {
    if (!la[i].local.equals(lb[i].local)) return false;
    if (!sameShape(la[i].mesh.geometry, lb[i].mesh.geometry)) return false;
  }
  return true;
}

/**
 * Same shape, by identity or by vertices.
 *
 * Identity is the fast path and the one every shipped builder takes — they all
 * draw from the `geoCache`, so two prototypes of a kind hold the SAME buffer.
 * It is not sufficient on its own: a builder that allocates its geometry per
 * call would fail an identity test while being perfectly instanceable, so the
 * slow path compares the vertices that would actually be drawn.
 */
function sameShape(a: THREE.BufferGeometry, b: THREE.BufferGeometry): boolean {
  if (a === b) return true;
  const pa = a.getAttribute("position");
  const pb = b.getAttribute("position");
  if (!pa || !pb || pa.count !== pb.count || pa.itemSize !== pb.itemSize) return false;
  for (let i = 0; i < pa.array.length; i++) {
    if (Math.abs((pa.array as ArrayLike<number>)[i] - (pb.array as ArrayLike<number>)[i]) > 1e-6) return false;
  }
  return true;
}

/** The node material that turns a per-instance float back into the accent glow. */
function emissiveNodeMaterial(src: THREE.MeshStandardMaterial): THREE.Material {
  // `NodeMaterial.setupLighting` destructures `emissiveNode` off `this` for any
  // node material, but @types/three declares it only on some — the same upstream
  // gap `src/room/mushrooms.ts` documents.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mat = new MeshStandardNodeMaterial({
    color: src.color.getHex(),
    roughness: src.roughness,
    metalness: src.metalness,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as MeshStandardNodeMaterial & { emissiveNode: any };
  // three's `materialEmissive` is `emissive * emissiveIntensity`, and an
  // `emissiveNode` REPLACES that product outright — it does not multiply into
  // it. So the attribute carries exactly what `emissiveIntensity` used to, and
  // the emissive colour is folded in here.
  //
  // ⚠️ `colorNode` is deliberately left alone. A material given a `fragmentNode`
  // skips `setupDiffuseColor`, writes an unassigned albedo into the scene MRT
  // and renders as a silhouette-shaped HOLE with no error anywhere — see
  // `render/mrt-coverage.test.ts`. A stock-configured node material writes its
  // albedo the way every other part does.
  mat.emissiveNode = color(src.emissive.getHex()).mul(attribute("aEmissive", "float"));
  return mat;
}

/**
 * Build the instancer for `kind`, or null if the kind cannot be instanced.
 *
 * Null is a normal answer, not a failure: the caller falls back to building a
 * Group per part, which is what every other kind does.
 */
export function createPartInstancer(
  kind: PinballPartKind,
  count: number,
  build: () => THREE.Group,
  buildOther: () => THREE.Group,
  release: (root: THREE.Object3D) => void,
): PartInstancer | null {
  if (count <= 0) return null;
  const proto = build();
  const probe = buildOther();
  try {
    if (animatesGeometry(proto) || !directionInvariant(proto, probe)) return null;

    const roles = rolesOf(proto);
    const children = childLocals(proto);
    if (children.length === 0) return null;

    // Children group into families by (geometry, role) — the plate is its own
    // family, the two strips share one, the three chevrons share one. Same
    // geometry in two different roles must NOT merge, which is why the role is
    // in the key.
    const order: string[] = [];
    const byKey = new Map<string, { geo: THREE.BufferGeometry; src: THREE.MeshStandardMaterial; role: string | null; slots: { at: number; local: THREE.Matrix4 }[] }>();
    children.forEach(({ mesh, local }, nth) => {
      const src = mesh.material as THREE.MeshStandardMaterial;
      const found = roles.get(src);
      const role = found?.role ?? null;
      const key = `${mesh.geometry.uuid}|${role ?? "static"}`;
      let fam = byKey.get(key);
      if (!fam) {
        fam = { geo: mesh.geometry, src, role, slots: [] };
        byKey.set(key, fam);
        order.push(key);
      }
      // ⚠️ ORDERED BY THE ANIMATOR'S INDEX, not by child order. The animator
      // says `chevMats[k].emissiveIntensity = wave(k)`, so instance k of the
      // chevron family must be the child that owns `chevMats[k]`. Today the two
      // orders happen to coincide, because `buildBooster` pushes each material
      // as it adds its mesh — a coincidence, and one a builder is free to break
      // by adding a mesh between two accents. Sorting by `found.index` makes the
      // correspondence the thing that is stated rather than the thing observed.
      fam.slots.push({ at: found?.index ?? nth, local });
    });
    for (const fam of byKey.values()) fam.slots.sort((p, q) => p.at - q.at);

    const families: SlotFamily[] = order.map((key, n) => {
      const f = byKey.get(key)!;
      const per = f.slots.length;
      const owned: (THREE.BufferGeometry | THREE.Material)[] = [];

      let geometry = f.geo;
      let material: THREE.Material = f.src;
      let emissive: THREE.InstancedBufferAttribute | null = null;

      if (f.role) {
        // An animated slot needs somewhere to put the per-instance intensity,
        // and the shared geometry cache hands the SAME buffer to every caller —
        // attaching an attribute to it would follow the shape into every other
        // part that uses a 0.16x0.34 cone. So clone, and give the clone its own
        // userData: `BufferGeometry.copy` assigns the source's userData BY
        // REFERENCE, so clearing `shared` on the clone would clear it on the
        // original and hand the next floor a disposed buffer.
        geometry = f.geo.clone();
        geometry.userData = {};
        emissive = new THREE.InstancedBufferAttribute(new Float32Array(count * per), 1);
        emissive.setUsage(THREE.DynamicDrawUsage);
        emissive.array.fill(f.src.emissiveIntensity);
        geometry.setAttribute("aEmissive", emissive);
        material = emissiveNodeMaterial(f.src);
        owned.push(geometry, material);
      }

      const mesh = new THREE.InstancedMesh(geometry, material, count * per);
      mesh.name = `part:${kind}:${f.role ?? `slot${n}`}`;
      mesh.castShadow = false;
      return { mesh, locals: f.slots.map((s) => s.local), role: f.role, emissive, dirty: false, owned };
    });

    return new PartInstancer(kind, families, count);
  } finally {
    // The prototypes were built to be read, not drawn. `release` disposes what
    // they own and spares anything flagged `userData.shared` — the same rule
    // `disposePinballParts` follows, passed in so this module does not own a
    // second copy of it.
    release(proto);
    release(probe);
  }
}
