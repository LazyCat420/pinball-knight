/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createMilkshake, MILKSHAKE_CLIPS, MILKSHAKE_FRAMES, type MilkshakePose } from './milkshake-3d';
import { IMPORTED_FACINGS } from '../boot/manifest-inventory';

/** World-space bounds of everything visible under `obj`. */
function bounds(obj: THREE.Object3D) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let p: THREE.Object3D | null = m;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    box.expandByObject(m);
  });
  return box;
}

describe('published milkshake sheets', () => {
  it('registers all three facings', () => {
    expect([...IMPORTED_FACINGS.milkshake].sort()).toEqual(['E', 'N', 'S']);
  });

  for (const dir of ['S', 'N', 'E']) {
    it(`milkshake ${dir} has a matching PNG and every clip the rig authors`, () => {
      const base = new URL(`../../../../public/sprites/milkshake-${dir}`, import.meta.url);
      const manifest = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
      const png = readFileSync(new URL(base + '.png'));

      expect(manifest.source).toEqual([png.readUInt32BE(16), png.readUInt32BE(20)]);
      expect(manifest.hash).toBe(createHash('sha256').update(png).digest('hex').slice(0, 12));
      expect(manifest.name).toBe('milkshake');
      expect(manifest.dir).toBe(dir);
      expect(manifest.rows.map((r: { clip: string }) => r.clip)).toEqual([...MILKSHAKE_CLIPS]);

      for (const row of manifest.rows as { clip: MilkshakePose; cells: number[][] }[]) {
        expect(row.cells).toHaveLength(MILKSHAKE_FRAMES[row.clip]);
      }

      const cells: number[][] = manifest.rows.flatMap((r: { cells: number[][] }) => r.cells);
      for (const [x0, y0, x1, y1] of cells) {
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThan(manifest.source[0]);
        expect(y1).toBeLessThan(manifest.source[1]);
        expect(x1).toBeGreaterThan(x0);
        expect(y1).toBeGreaterThan(y0);
      }
      expect(new Set(cells.map(([x0, y0, x1, y1]) => `${x1 - x0},${y1 - y0}`)).size).toBe(1);
    });
  }
});

describe('toxic shake rig', () => {
  it('stands on the floor, taller than wide, with the face on the +z side', () => {
    const rig = createMilkshake();
    try {
      rig.pose('idle', 0);
      const b = bounds(rig.root);
      expect(b.min.y).toBeGreaterThan(-0.15);
      expect(b.min.y).toBeLessThan(0.25);
      expect(b.max.y - b.min.y).toBeGreaterThan(b.max.x - b.min.x);

      const eye = rig.eyes[0].getWorldPosition(new THREE.Vector3());
      expect(eye.z).toBeGreaterThan(0.4);

      expect(rig.spray.visible).toBe(false);
      expect(rig.puddle.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('waddles with arms swinging in opposition and body bobbing', () => {
    const rig = createMilkshake();
    try {
      rig.pose('walk', 0.25);
      const [l, r] = rig.arms.map((arm) => arm.rotation.x);
      expect(Math.sign(l)).not.toBe(Math.sign(r));
      expect(Math.abs(l)).toBeGreaterThan(0.3);
      expect(rig.body.rotation.z).not.toBe(0);

      const up = rig.body.position.y;
      rig.pose('walk', 0);
      expect(up).toBeGreaterThan(rig.body.position.y);
    } finally {
      rig.dispose();
    }
  });

  it('attacks by lunging forward, thrusting yellow gloves, and spraying toxic droplets', () => {
    const rig = createMilkshake();
    try {
      rig.pose('attack', 0.5);
      expect(rig.body.rotation.x).toBeGreaterThan(0.1);
      expect(rig.arms[0].rotation.x).toBeLessThan(-0.5);
      expect(rig.arms[1].rotation.x).toBeLessThan(-0.5);
      expect(rig.spray.visible).toBe(true);

      const flying = rig.spray.children.filter((d) => d.visible);
      expect(flying.length).toBeGreaterThan(0);
      for (const d of flying) {
        expect(d.position.z).toBeGreaterThan(0.3);
        expect(d.position.y).toBeGreaterThan(1.5);
      }

      rig.pose('attack', 1);
      expect(rig.spray.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('dies by collapsing flat, limp yellow gloves, and spilling a toxic green puddle', () => {
    const rig = createMilkshake();
    try {
      rig.pose('idle', 0);
      const standing = bounds(rig.root);

      rig.pose('death', 1);
      expect(rig.cup.scale.y).toBeLessThan(standing.max.y * 0.35);
      expect(rig.puddle.visible).toBe(true);

      const flat = bounds(rig.root);
      expect(flat.max.y).toBeLessThan(standing.max.y * 0.5);
      expect(flat.max.x - flat.min.x).toBeGreaterThan(standing.max.x - standing.min.x);
    } finally {
      rig.dispose();
    }
  });
});
