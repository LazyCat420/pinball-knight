/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSlime, deform, restShape, SLIME_CLIPS, SLIME_FRAMES, type SlimePose } from './slime-3d';
import { IMPORTED_FACINGS } from '../boot/manifest-inventory';

/** Extent of the posed dome: measured from the deformed lattice, what the bake draws. */
function extent(rig: ReturnType<typeof createSlime>) {
  const pos = rig.dome.geometry.attributes.position as THREE.BufferAttribute;
  const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
  return { box, height: box.max.y - box.min.y, width: box.max.x - box.min.x, depth: box.max.z - box.min.z };
}

describe('published slime sheets', () => {
  it('registers all three facings', () => {
    expect([...IMPORTED_FACINGS.slime].sort()).toEqual(['E', 'N', 'S']);
  });
  for (const dir of ['S', 'N', 'E']) it(`slime ${dir} has a matching PNG and every clip the rig authors`, () => {
    const base = new URL(`../../../../public/sprites/slime-${dir}`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
    const png = readFileSync(new URL(base + '.png'));
    expect(manifest.source).toEqual([png.readUInt32BE(16), png.readUInt32BE(20)]);
    expect(manifest.hash).toBe(createHash('sha256').update(png).digest('hex').slice(0, 12));
    expect(manifest.name).toBe('slime'); expect(manifest.dir).toBe(dir);
    expect(manifest.rows.map((r: { clip: string }) => r.clip)).toEqual([...SLIME_CLIPS]);
    for (const row of manifest.rows as { clip: SlimePose; cells: number[][] }[]) expect(row.cells).toHaveLength(SLIME_FRAMES[row.clip]);
    const cells: number[][] = manifest.rows.flatMap((r: { cells: number[][] }) => r.cells);
    for (const [x0, y0, x1, y1] of cells) { expect(x0).toBeGreaterThanOrEqual(0); expect(y0).toBeGreaterThanOrEqual(0); expect(x1).toBeLessThan(manifest.source[0]); expect(y1).toBeLessThan(manifest.source[1]); expect(x1).toBeGreaterThan(x0); expect(y1).toBeGreaterThan(y0); }
    // One registration rectangle for the whole sheet: a puddle must not be inflated back to a dome.
    expect(new Set(cells.map(([x0, y0, x1, y1]) => `${x1 - x0},${y1 - y0}`)).size).toBe(1);
  });
});

describe('slime rig', () => {
  it('rests as a dome on the floor, wider than it is tall', () => {
    const rig = createSlime();
    try {
      rig.apply(restShape());
      const { box, height, width } = extent(rig);
      expect(box.min.y).toBeCloseTo(0, 1);
      expect(width).toBeGreaterThan(height);
      expect(height).toBeGreaterThan(0.9);
    } finally { rig.dispose(); }
  });
  it('walks by gathering tall, leaping forward off the floor, then splatting flat', () => {
    const rig = createSlime();
    try {
      rig.pose('walk', 0.15); const gather = extent(rig);
      rig.pose('walk', 0.42); const leap = extent(rig);
      rig.pose('walk', 0.7); const splat = extent(rig);
      rig.apply(restShape()); const rest = extent(rig);
      expect(gather.height).toBeGreaterThan(rest.height);
      expect(leap.box.min.y).toBeGreaterThan(0.2);
      // The comma leans into +z, the direction of travel.
      expect(leap.box.max.z).toBeGreaterThan(rest.box.max.z + 0.4);
      expect(splat.height).toBeLessThan(rest.height * 0.75);
      expect(splat.width).toBeGreaterThan(rest.width);
    } finally { rig.dispose(); }
  });
  it('attacks by coiling forward, rearing up taller than it is wide, then splashing droplets', () => {
    const rig = createSlime();
    try {
      rig.apply(restShape()); const rest = extent(rig);
      rig.pose('attack', 0.2); const coil = extent(rig);
      expect(coil.box.max.z).toBeGreaterThan(rest.box.max.z + 0.3);
      expect(rig.drops.visible).toBe(false);
      rig.pose('attack', 0.45); const crest = extent(rig);
      expect(crest.height).toBeGreaterThan(rest.height * 1.4);
      expect(crest.height).toBeGreaterThan(crest.width);
      rig.pose('attack', 0.7); const splash = extent(rig);
      expect(splash.height).toBeLessThan(rest.height * 0.7);
      expect(rig.drops.visible).toBe(true);
    } finally { rig.dispose(); }
  });
  it('dies by bulging at the crown, popping, and melting into a puddle that stays a puddle', () => {
    const rig = createSlime();
    try {
      rig.apply(restShape()); const rest = extent(rig);
      rig.pose('death', 0.25); const bulge = extent(rig);
      expect(bulge.height).toBeGreaterThan(rest.height * 1.1);
      rig.pose('death', 0.5); expect(rig.drops.visible).toBe(true);
      rig.pose('death', 1); const puddle = extent(rig);
      expect(puddle.height).toBeLessThan(rest.height * 0.25);
      expect(puddle.width).toBeGreaterThan(rest.width * 1.3);
      expect(rig.bubbles.every(b => !b.visible)).toBe(true);
      expect(rig.drops.visible).toBe(false);
    } finally { rig.dispose(); }
  });
  it('keeps every posed vertex on or above the floor', () => {
    const rig = createSlime();
    try {
      for (const clip of SLIME_CLIPS) for (let i = 0; i <= 10; i++) {
        rig.pose(clip, i / 10);
        expect(extent(rig).box.min.y).toBeGreaterThanOrEqual(-0.002);
      }
    } finally { rig.dispose(); }
  });
  it('deform is pure and identity at rest', () => {
    const v = new THREE.Vector3(0.3, 0.5, -0.4);
    const out = deform(v, restShape());
    expect(out.toArray().map(n => +n.toFixed(6))).toEqual([0.3, 0.5, -0.4]);
    expect(v.toArray()).toEqual([0.3, 0.5, -0.4]);
  });
});
