/**
 * WHERE THE DRAW CALLS COME FROM — attribution, not a total.
 *
 * `renderer.info.render.drawCalls` says 460. It does not say 460 of WHAT, and
 * every optimisation decision needs the second number: this repo has already
 * shipped one plan built on "instance the torches, that's ~100 draw calls"
 * without checking whether the torches were ever visible at once. They are not.
 * The camera sees roughly 20 of ~4000 tiles (`boot/warmup.ts`), so a per-floor
 * OBJECT count is an upper bound that can overstate the saving by 5x.
 *
 * ── WHY THIS REIMPLEMENTS THE CULL RATHER THAN COUNTING OBJECTS ─────────────
 * three decides what to draw in `Renderer._projectObject`, and two of its rules
 * are what separate "meshes in the scene" from "draw calls issued":
 *
 *   1. `visible === false` skips the WHOLE SUBTREE. `Object3D.traverse` does
 *      not — it walks children of an invisible parent — so a plain traverse
 *      counts every pooled effect that is parked hidden. That is the single
 *      biggest overcount, and it is why this walks manually.
 *   2. A mesh outside the frustum is skipped unless `frustumCulled === false`.
 *
 * ── AND WHY THE SHADOW PASS IS COUNTED SEPARATELY ──────────────────────────
 * `drawCalls` is the whole frame, and a `castShadow` mesh is submitted AGAIN
 * for the shadow map — against the LIGHT's frustum, not the camera's, so a
 * mesh the camera cannot see can still cost a draw. This reports the camera
 * pass exactly and the shadow pass as an upper bound (`castShadow && visible`),
 * which is the honest split: an instancing change removes both, a culling
 * change removes only one.
 */
import * as THREE from "three";
import { state } from "../state";

export interface DrawRow {
  label: string;
  /** Meshes of this kind that survive the visible+frustum test — one draw each. */
  draws: number;
  /** Of those, how many are InstancedMesh (one draw covering many copies). */
  instanced: number;
  /** Copies those InstancedMeshes carry — the draws they already save. */
  instances: number;
  /** Visible meshes that also cast a shadow, i.e. submitted a second time. */
  shadow: number;
  /** Present in the scene but culled this frame. The instancing UPSIDE. */
  culled: number;
}

/**
 * Label a mesh by what BUILT it, not by what it is.
 *
 * `name` is set on very little, so the useful key is the nearest named
 * ancestor — pinball parts are added as named Groups, the maze as one group.
 * Falling back to the geometry+material type keeps unnamed one-offs from all
 * collapsing into a single "other" bucket that says nothing.
 */
function labelOf(o: THREE.Object3D): string {
  if (o.name) return o.name;
  for (let p = o.parent; p; p = p.parent) {
    if (p.name) return `${p.name}/*`;
  }
  const m = o as THREE.Mesh;
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return `?${m.geometry?.type ?? "?"}+${mat?.type ?? "?"}`;
}

/**
 * Count what THIS frame would submit, from the live camera.
 *
 * Read it right after a rendered frame: it uses the camera's current matrices,
 * which the render loop has already updated.
 */
export function drawCensus(): { rows: DrawRow[]; totals: DrawRow } | null {
  const scene = state.scene;
  const camera = state.camera;
  if (!scene || !camera) return null;

  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );

  const by = new Map<string, DrawRow>();
  const row = (label: string): DrawRow => {
    let r = by.get(label);
    if (!r) {
      r = { label, draws: 0, instanced: 0, instances: 0, shadow: 0, culled: 0 };
      by.set(label, r);
    }
    return r;
  };

  // Manual walk — see rule 1 in the header. `traverse` would count the pools.
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const m = o as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (m.isMesh) {
      const r = row(labelOf(o));
      const drawn = m.frustumCulled === false || frustum.intersectsObject(m);
      if (drawn) {
        r.draws++;
        if (m.isInstancedMesh) {
          r.instanced++;
          r.instances += m.count ?? 0;
        }
        if (m.castShadow) r.shadow++;
      } else {
        r.culled++;
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);

  const rows = [...by.values()].sort((a, b) => b.draws - a.draws);
  const totals = rows.reduce(
    (t, r) => ({
      label: "TOTAL",
      draws: t.draws + r.draws,
      instanced: t.instanced + r.instanced,
      instances: t.instances + r.instances,
      shadow: t.shadow + r.shadow,
      culled: t.culled + r.culled,
    }),
    { label: "TOTAL", draws: 0, instanced: 0, instances: 0, shadow: 0, culled: 0 },
  );
  return { rows, totals };
}
