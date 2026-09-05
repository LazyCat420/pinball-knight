/**
 * `__lab.walls` — look at the wall look, switch it, and prove the shipped one
 * did not move.
 *
 *   __lab.walls()          what this floor is built from: look, run counts,
 *                          what ENDS the runs, and how many draw buckets
 *   __lab.walls("runs")    switch look + rebuild this floor now
 *   __lab.walls("legacy")  back to the shipped look
 *   __lab.walls.digest()   a hash of every wall instance on this floor
 *
 * The digest is the load-bearing one. The whole switch is only safe if the
 * legacy path is BYTE-IDENTICAL to what shipped before the runs existed, and
 * "I refactored carefully" is not evidence. It folds every wall InstancedMesh's
 * instance matrices, tints and tile keys into one string, so a legacy floor
 * built after the change can be compared against the same floor built before
 * it (dev/fixtures/wall-digest.json).
 */
import * as THREE from "three";
import { state } from "../state";
import { wallLook, setWallLook } from "./wall-look";
import type { WallLook } from "../maze/wall-runs";

/** FNV-1a 32, the same fold dev/floor-census.ts uses. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Round hard: a matrix element that differs in the 12th decimal is the same wall. */
const q = (v: number): string => (Math.abs(v) < 1e-6 ? "0" : v.toFixed(4));

export interface WallDigest {
  look: WallLook;
  /** Instanced wall meshes (one per bucket) and their instance counts. */
  buckets: Array<{ count: number; map: string }>;
  instances: number;
  wallAt: number;
  digest: string;
}

/**
 * Hash every wall instance the maze is currently drawing.
 *
 * Buckets are sorted by their own content hash, not by scene order: the run
 * look emits a different NUMBER of meshes than legacy does, and a digest that
 * depended on emission order would report a difference for every look even
 * when the same stone is in the same place.
 */
export function wallDigest(): WallDigest | null {
  const maze = state.maze;
  if (!maze) return null;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const buckets: Array<{ count: number; map: string; body: string }> = [];
  let instances = 0;
  maze.group.traverse((obj) => {
    const mesh = obj as THREE.InstancedMesh;
    if (!(mesh as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // A wall box carries a cap material on its ±Y slots; that is what separates
    // it from pilasters, banners, clutter and the arc rubber.
    const maps = mats.map((mat) => ((mat as THREE.MeshStandardMaterial).map?.name ?? "")).join("|");
    if (!maps.includes("cap")) return;
    const rows: string[] = [];
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      const e = m.elements;
      let row = `${q(e[12])},${q(e[13])},${q(e[14])},${q(e[0])},${q(e[5])},${q(e[10])}`;
      if (mesh.instanceColor) {
        c.fromBufferAttribute(mesh.instanceColor, k);
        row += `,${c.getHexString()}`;
      }
      rows.push(row);
    }
    instances += mesh.count;
    buckets.push({ count: mesh.count, map: maps, body: fnv(rows.sort().join(";")) });
  });
  buckets.sort((a, b) => (a.body < b.body ? -1 : a.body > b.body ? 1 : 0));
  const keys = [...maze.wallAt.keys()].sort().join(";");
  return {
    look: wallLook(),
    buckets: buckets.map(({ count, map }) => ({ count, map })),
    instances,
    wallAt: maze.wallAt.size,
    digest: fnv(buckets.map((b) => `${b.count}:${b.map}:${b.body}`).join("|") + "#" + fnv(keys)),
  };
}

export interface WallLabDeps {
  /** Rebuild the current floor so a look change is visible without a reload. */
  rebuild: () => void;
  /** The floor the player is on, for the printout. */
  level: () => number;
}

export function makeWallLab(deps: WallLabDeps) {
  const report = (): unknown => {
    const maze = state.maze;
    const look = wallLook();
    if (!maze) {
      console.log(`[walls] look "${look}" — no maze built yet`);
      return { look };
    }
    const d = wallDigest();
    const plan = maze.wallRuns;
    const lines = [
      `── WALLS ── floor ${deps.level()}  look "${look}"`,
      `  draw buckets  ${d?.buckets.length ?? 0}   instances ${d?.instances ?? 0}   wallAt ${d?.wallAt ?? 0}`,
      `  digest        ${d?.digest ?? "-"}`,
    ];
    if (!plan) {
      lines.push('  (the shipped look does not compile runs — __lab.walls("runs") to see them)');
    } else {
      const s = plan.stats;
      lines.push(
        `  boxes ${s.boxes}  faces top/S/E ${s.faces.top}/${s.faces.south}/${s.faces.east}`,
        `  runs ${s.runs}  mean ${(s.boxes / Math.max(1, s.runs)).toFixed(2)} tiles` +
          `  ends ${s.ends} bodies ${s.bodies} corners ${s.corners} tees ${s.tees} solos ${s.solos}`,
        `  holes ${s.bridgeable}  vetoed shapes ${s.rejected}`,
        `  lengths  ${Object.entries(s.byLen)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([k, v]) => `${k}:${v}`)
          .join(" ")}`,
        `  ends by  ${Object.entries(s.byEnd)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}:${v}`)
          .join(" ")}`,
      );
    }
    lines.push('  __lab.walls("runs" | "tiles" | "legacy") to switch and rebuild');
    console.log(lines.join("\n"));
    return { look, stats: plan?.stats ?? null, digest: d?.digest ?? null };
  };

  return Object.assign(
    (look?: WallLook): unknown => {
      if (look === undefined) return report();
      setWallLook(look);
      console.log(`[walls] look → "${look}", rebuilding floor ${deps.level()}`);
      deps.rebuild();
      return report();
    },
    {
      digest: (): WallDigest | null => wallDigest(),
      stats: () => state.maze?.wallRuns?.stats ?? null,
    },
  );
}
