/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from 'canvas';
import {
  createBlasterFrank, BLASTER_FRANK_CLIPS, BLASTER_FRANK_DEATH_HALF_WIDTH, BLASTER_FRANK_FRAMES, BLASTER_FRANK_SHOTS, type BlasterFrankPose,
} from './blaster-frank-3d';
import { IMPORTED_FACINGS } from '../boot/manifest-inventory';

/** World-space bounds of everything visible under `obj` — PRECISE (vertex-transformed), so a rotated limb is not overestimated. */
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
    box.expandByObject(m, true);
  });
  return box;
}

const world = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };

describe('published blaster_frank sheets', () => {
  it('registers all three facings', () => {
    expect([...IMPORTED_FACINGS.blaster_frank].sort()).toEqual(['E', 'N', 'S']);
  });

  for (const dir of ['S', 'N', 'E']) {
    it(`blaster_frank ${dir} has a matching PNG and every clip the rig authors`, () => {
      const base = new URL(`../../../../public/sprites/blaster_frank-${dir}`, import.meta.url);
      const manifest = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
      const png = readFileSync(new URL(base + '.png'));

      expect(manifest.source).toEqual([png.readUInt32BE(16), png.readUInt32BE(20)]);
      expect(manifest.hash).toBe(createHash('sha256').update(png).digest('hex').slice(0, 12));
      expect(manifest.name).toBe('blaster_frank');
      expect(manifest.dir).toBe(dir);
      expect(manifest.rows.map((r: { clip: string }) => r.clip)).toEqual([...BLASTER_FRANK_CLIPS]);

      for (const row of manifest.rows as { clip: BlasterFrankPose; cells: number[][] }[]) {
        expect(row.cells).toHaveLength(BLASTER_FRANK_FRAMES[row.clip]);
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

  it('bakes the standing man near the Fry Sentinel\'s height on screen, with the idle filling its rect', async () => {
    // One shared registration rect per sheet: whatever the volley and the
    // fall draw outside the idle's box shrinks the standing man. Same
    // arithmetic as tools/sprite-forge/manifest.ts artScale, applied to the
    // idle frame's OWN ink. Frank is short by design, so the bar is 0.9×.
    const standingArtHeight = async (name: string) => {
      const base = new URL(`../../../../public/sprites/${name}-S`, import.meta.url);
      const m = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
      const img = await loadImage(readFileSync(new URL(base + '.png')));
      const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      const [x0, y0, x1, y1] = m.rows.find((r: { clip: string }) => r.clip === 'idle').cells[0];
      const k = Math.min(110 / (y1 - y0 + 1), (128 * 0.92) / (x1 - x0 + 1));
      let top = Infinity, bottom = -Infinity;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (px[(y * img.width + x) * 4 + 3] > 24) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
      return { art: (bottom - top + 1) * k, fill: (bottom - top + 1) / (y1 - y0 + 1) };
    };
    const frank = await standingArtHeight('blaster_frank'), fries = await standingArtHeight('fries');
    expect(frank.art).toBeGreaterThanOrEqual(fries.art * 0.9);
    expect(frank.fill).toBeGreaterThan(0.72);
  });
});

describe('blaster frank rig', () => {
  it('stands on the floor on two legs, taller than wide, spectacles and gun on the +z side', () => {
    const rig = createBlasterFrank();
    try {
      rig.pose('idle', 0);
      const b = bounds(rig.root);
      expect(b.min.y).toBeGreaterThan(-0.12);
      expect(b.min.y).toBeLessThan(0.08);
      expect(b.max.y - b.min.y).toBeGreaterThan(b.max.x - b.min.x);
      expect(b.max.y).toBeGreaterThan(2.5);
      expect(rig.legs).toHaveLength(2);
      for (const leg of rig.legs) expect(bounds(leg).min.y).toBeLessThan(0.08);
      // Eyes and lenses sit on the front of the head, proud of the skull.
      for (const e of [...rig.eyes, ...rig.lenses]) {
        const p = world(e);
        expect(p.z).toBeGreaterThan(0.3);
        expect(p.y).toBeGreaterThan(2.1);
      }
      // The revolver is in the right hand, held low and forward, muzzle toward +z.
      const muzzle = world(rig.muzzle), hand = world(rig.rightArm.hand);
      expect(muzzle.z).toBeGreaterThan(hand.z + 0.15);
      expect(muzzle.y).toBeLessThan(1.6);
      expect(rig.flash.visible).toBe(false);
      expect(rig.smoke.visible).toBe(false);
      expect(rig.stars.visible).toBe(false);
      expect(rig.mouth.visible).toBe(false);
      for (const s of rig.spirals) expect(s.visible).toBe(false);
      for (const x of rig.xeyes) expect(x.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('keeps every idle frame inside the bake frustum', () => {
    const rig = createBlasterFrank();
    try {
      for (const t of [0, 0.25, 0.5, 0.75]) {
        rig.pose('idle', t);
        const b = bounds(rig.root);
        expect(Math.max(-b.min.x, b.max.x)).toBeLessThan(2.1);
        expect(b.max.y).toBeLessThan(3.4);
      }
    } finally {
      rig.dispose();
    }
  });

  it('waddles with the legs and arms swinging in opposition, the body bobbing, coat tails flapping', () => {
    const rig = createBlasterFrank();
    try {
      rig.pose('walk', 0.25);
      const [l, r] = rig.legs.map((leg) => leg.rotation.x);
      expect(Math.sign(l)).not.toBe(Math.sign(r));
      expect(Math.abs(l)).toBeGreaterThan(0.6);
      const [al, ar] = rig.arms.map((arm) => arm.rotation.x);
      expect(al).toBeLessThan(ar - 0.5);
      for (const tail of rig.tails) expect(tail.rotation.x).toBeLessThan(-0.4);
      expect(rig.mouth.visible).toBe(true);

      const up = rig.body.position.y;
      rig.pose('walk', 0);
      expect(up).toBeGreaterThan(rig.body.position.y);
      rig.pose('walk', 0.75);
      expect(Math.sign(rig.legs[0].rotation.x)).toBe(-Math.sign(l));
      expect(rig.arms[0].rotation.x).toBeGreaterThan(rig.arms[1].rotation.x + 0.5);
    } finally {
      rig.dispose();
    }
  });

  it('attacks by raising the revolver straight up and firing three flashing shots into the ceiling', () => {
    const rig = createBlasterFrank();
    try {
      // Raised: the muzzle is above the head, no flash before the first shot.
      rig.pose('attack', 0.27);
      const head = world(rig.head), muzzle = world(rig.muzzle), hand = world(rig.rightArm.hand);
      expect(muzzle.y).toBeGreaterThan(head.y + 0.3);
      expect(muzzle.y).toBeGreaterThan(hand.y + 0.25);
      expect(Math.abs(muzzle.x - hand.x)).toBeLessThan(0.25);
      expect(rig.flash.visible).toBe(false);
      expect(rig.mouth.visible).toBe(true);
      expect(rig.smirk.visible).toBe(false);

      // Each shot window flashes; the gaps between them do not.
      for (const [a, b] of BLASTER_FRANK_SHOTS) {
        rig.pose('attack', a + 0.01);
        expect(rig.flash.visible).toBe(true);
        expect(world(rig.flash).y).toBeGreaterThan(head.y + 0.3);
        rig.pose('attack', b + 0.01);
        expect(rig.flash.visible).toBe(false);
      }
      // Recoil rocks him back on a shot.
      rig.pose('attack', BLASTER_FRANK_SHOTS[1][0] + 0.01);
      expect(rig.body.rotation.x).toBeLessThan(-0.15);
      expect(rig.smoke.visible).toBe(true);
      expect(rig.puffs.some((p) => p.visible)).toBe(true);
      // The flash stays close over the head: it is charged to every frame's rect.
      const b = bounds(rig.root);
      expect(b.max.y).toBeLessThan(3.6);
      expect(Math.max(-b.min.x, b.max.x)).toBeLessThan(2.1);

      rig.pose('attack', 1);
      expect(rig.flash.visible).toBe(false);
      expect(world(rig.muzzle).y).toBeLessThan(1.7);
    } finally {
      rig.dispose();
    }
  });

  it('dies dizzy, drops the gun, keels over onto his back with X eyes and stars', () => {
    const rig = createBlasterFrank();
    try {
      rig.pose('idle', 0);
      const standing = bounds(rig.root);

      rig.pose('death', 0.25);
      for (const s of rig.spirals) expect(s.visible).toBe(true);
      expect(rig.gun.parent).toBe(rig.root);

      rig.pose('death', 1);
      expect(Math.abs(rig.body.rotation.z)).toBeGreaterThan(1.2);
      expect(world(rig.head).x).toBeLessThan(-0.8);
      for (const x of rig.xeyes) expect(x.visible).toBe(true);
      for (const e of rig.eyes) expect(e.visible).toBe(false);
      expect(rig.stars.visible).toBe(true);
      const gun = world(rig.gun);
      expect(gun.y).toBeLessThan(0.25);
      expect(rig.smoke.visible).toBe(true);
      const flat = bounds(rig.root);
      // On his back he is as tall as his belly is wide, plus the shoulder on top.
      expect(flat.max.y).toBeLessThan(standing.max.y * 0.68);

      // Every pose after the death must get its eyes and gun back.
      rig.pose('idle', 0);
      for (const e of rig.eyes) expect(e.visible).toBe(true);
      for (const x of rig.xeyes) expect(x.visible).toBe(false);
      expect(rig.gun.parent).toBe(rig.gunAim);
      expect(rig.stars.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('keeps every death frame above the floor and inside the registration half-width, at every bake yaw', () => {
    const rig = createBlasterFrank();
    try {
      for (const yaw of [0, Math.PI * 0.34, Math.PI]) {
        rig.root.rotation.y = yaw; rig.setFacing(yaw);
        for (let i = 0; i <= 8; i++) {
          rig.pose('death', i / 8);
          const b = bounds(rig.root);
          expect(b.min.y, `yaw ${yaw.toFixed(2)} t=${i}/8 floor`).toBeGreaterThan(-0.12);
          expect(Math.max(-b.min.x, b.max.x), `yaw ${yaw.toFixed(2)} t=${i}/8 width`).toBeLessThan(BLASTER_FRANK_DEATH_HALF_WIDTH + 0.15);
        }
      }
    } finally {
      rig.dispose();
    }
  });

  it('cheats the face toward the camera for the E bake and leaves the back alone', () => {
    const rig = createBlasterFrank();
    try {
      const yawE = Math.PI * 0.34;
      rig.root.rotation.y = yawE;
      rig.setFacing(yawE);
      rig.pose('idle', 0);
      const cheated = rig.eyes.map((e) => world(e).z);
      rig.setFacing(0);
      rig.pose('idle', 0);
      const plain = rig.eyes.map((e) => world(e).z);
      expect(Math.min(...cheated)).toBeGreaterThan(Math.min(...plain) + 0.03);
      // Still ON the head: the cheat slides the features round the sphere, never off it.
      for (const e of rig.eyes) { const p = world(e); const h = world(rig.head); expect(p.distanceTo(h)).toBeLessThan(0.5); }

      rig.root.rotation.y = Math.PI;
      rig.setFacing(Math.PI);
      rig.pose('idle', 0);
      expect(rig.face.rotation.y).toBe(0);
      rig.setFacing(yawE); rig.pose('walk', 0.3);
      expect(rig.face.rotation.y).toBeCloseTo(-yawE * 0.35);
    } finally {
      rig.dispose();
    }
  });
});
