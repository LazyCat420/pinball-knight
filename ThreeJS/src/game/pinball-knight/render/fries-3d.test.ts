/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFries, FRIES_CLIPS, FRIES_FRAMES, type FriesPose } from './fries-3d';
import { IMPORTED_FACINGS } from '../boot/manifest-inventory';

/** World-space bounds of everything visible under `obj`. */
function bounds(obj: THREE.Object3D) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let p: THREE.Object3D | null = m; while (p) { if (!p.visible) return; p = p.parent; }
    box.expandByObject(m);
  });
  return box;
}

describe('published fries sheets', () => {
  it('registers all three facings', () => {
    expect([...IMPORTED_FACINGS.fries].sort()).toEqual(['E', 'N', 'S']);
  });
  for (const dir of ['S', 'N', 'E']) it(`fries ${dir} has a matching PNG and every clip the rig authors`, () => {
    const base = new URL(`../../../../public/sprites/fries-${dir}`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
    const png = readFileSync(new URL(base + '.png'));
    expect(manifest.source).toEqual([png.readUInt32BE(16), png.readUInt32BE(20)]);
    expect(manifest.hash).toBe(createHash('sha256').update(png).digest('hex').slice(0, 12));
    expect(manifest.name).toBe('fries'); expect(manifest.dir).toBe(dir);
    expect(manifest.rows.map((r: { clip: string }) => r.clip)).toEqual([...FRIES_CLIPS]);
    for (const row of manifest.rows as { clip: FriesPose; cells: number[][] }[]) expect(row.cells).toHaveLength(FRIES_FRAMES[row.clip]);
    const cells: number[][] = manifest.rows.flatMap((r: { cells: number[][] }) => r.cells);
    for (const [x0, y0, x1, y1] of cells) { expect(x0).toBeGreaterThanOrEqual(0); expect(y0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThan(manifest.source[0]); expect(y1).toBeLessThan(manifest.source[1]); expect(x1).toBeGreaterThan(x0); expect(y1).toBeGreaterThan(y0); }
    expect(new Set(cells.map(([x0, y0, x1, y1]) => `${x1 - x0},${y1 - y0}`)).size).toBe(1);
  });
});

describe('fry sentinel rig', () => {
  it('stands on the floor, taller than wide, with the face on the +z side', () => {
    const rig = createFries();
    try {
      rig.pose('idle', 0);
      const b = bounds(rig.root);
      expect(b.min.y).toBeGreaterThan(-0.15); expect(b.min.y).toBeLessThan(0.1);
      expect(b.max.y - b.min.y).toBeGreaterThan(b.max.x - b.min.x);
      const eye = rig.eyes[0].getWorldPosition(new THREE.Vector3());
      expect(eye.z).toBeGreaterThan(0.4);
      expect(rig.darts.visible).toBe(false); expect(rig.spill.visible).toBe(false);
    } finally { rig.dispose(); }
  });
  it('walks with the legs swinging in opposition and the body bobbing', () => {
    const rig = createFries();
    try {
      rig.pose('walk', 0.25);
      const [l, r] = rig.legs.map((leg) => leg.rotation.x);
      expect(Math.sign(l)).not.toBe(Math.sign(r));
      expect(Math.abs(l)).toBeGreaterThan(0.4);
      const up = rig.body.position.y;
      rig.pose('walk', 0); expect(up).toBeGreaterThan(rig.body.position.y);
    } finally { rig.dispose(); }
  });
  it('attacks by leaning in, winking, and firing darts forward from the head', () => {
    const rig = createFries();
    try {
      rig.pose('attack', 0.4);
      expect(rig.body.rotation.x).toBeGreaterThan(0.15);
      expect(rig.eyes[1].scale.y).toBeLessThan(rig.eyes[0].scale.y);
      expect(rig.darts.visible).toBe(true);
      const flying = rig.darts.children.filter((d) => d.visible);
      expect(flying.length).toBeGreaterThan(0);
      for (const d of flying) { expect(d.position.z).toBeGreaterThan(0.3); expect(d.position.y).toBeGreaterThan(2); }
      rig.pose('attack', 1); expect(rig.darts.visible).toBe(false);
    } finally { rig.dispose(); }
  });
  it('dies by crumpling flat, turning the smile down, and spilling its fries onto the floor', () => {
    const rig = createFries();
    try {
      rig.pose('idle', 0); const standing = bounds(rig.root);
      rig.pose('death', 1);
      expect(rig.box.scale.y).toBeLessThan(standing.max.y * 0.3);
      expect(rig.smile.rotation.z).toBeCloseTo(0);
      expect(rig.spill.visible).toBe(true);
      for (const f of rig.fries) { expect(f.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.5); }
      const flat = bounds(rig.root);
      expect(flat.max.y).toBeLessThan(standing.max.y * 0.5);
      expect(flat.max.x - flat.min.x).toBeGreaterThan(standing.max.x - standing.min.x);
    } finally { rig.dispose(); }
  });
});
