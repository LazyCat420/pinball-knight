/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from 'canvas';
import {
  createPinballBoss, PINBALL_BOSS_CLIPS, PINBALL_BOSS_DEATH_HALF_WIDTH, PINBALL_BOSS_FRAMES, PINBALL_BOSS_LOOPS, type PinballBossPose,
} from './pinball-boss-3d';
import { IMPORTED_FACINGS } from '../boot/manifest-inventory';

/** World-space bounds of everything visible under `obj` — PRECISE (vertex-transformed). */
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

describe('published pinball_boss sheets', () => {
  it('registers all three facings', () => {
    expect([...IMPORTED_FACINGS.pinball_boss].sort()).toEqual(['E', 'N', 'S']);
  });

  for (const dir of ['S', 'N', 'E']) {
    it(`pinball_boss ${dir} has a matching PNG and every clip the rig authors`, () => {
      const base = new URL(`../../../../public/sprites/pinball_boss-${dir}`, import.meta.url);
      const manifest = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
      const png = readFileSync(new URL(base + '.png'));

      expect(manifest.source).toEqual([png.readUInt32BE(16), png.readUInt32BE(20)]);
      expect(manifest.hash).toBe(createHash('sha256').update(png).digest('hex').slice(0, 12));
      expect(manifest.name).toBe('pinball_boss');
      expect(manifest.dir).toBe(dir);
      expect(manifest.rows.map((r: { clip: string }) => r.clip)).toEqual([...PINBALL_BOSS_CLIPS]);

      for (const row of manifest.rows as { clip: PinballBossPose; cells: number[][] }[]) {
        expect(row.cells).toHaveLength(PINBALL_BOSS_FRAMES[row.clip]);
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

  it('bakes the attack as a seamless loop: twelve DISTINCT frames, none a copy of another', async () => {
    // The pixel sheet's attack row was four identical front-facing frames
    // with lightning drawn over them — no spin. A 360° turn in 30° steps has
    // no two frames alike, and the loop closes because frame 12 would be frame 0.
    const base = new URL('../../../../public/sprites/pinball_boss-S', import.meta.url);
    const m = JSON.parse(readFileSync(new URL(base + '.json'), 'utf8'));
    const img = await loadImage(readFileSync(new URL(base + '.png')));
    const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const row = m.rows.find((r: { clip: string }) => r.clip === 'attack');
    const sig = row.cells.map(([x0, y0, x1, y1]: number[]) => {
      let h = 0;
      for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) h = (h * 31 + (px[(y * img.width + x) * 4 + 3] > 24 ? px[(y * img.width + x) * 4] >> 4 : 0)) >>> 0;
      return h;
    });
    expect(PINBALL_BOSS_LOOPS.attack).toBe(true);
    expect(new Set(sig).size).toBe(sig.length);
  });

  it('bakes the standing ball at least as tall on screen as the Fry Sentinel, with the idle filling its rect', async () => {
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
    const boss = await standingArtHeight('pinball_boss'), fries = await standingArtHeight('fries');
    expect(boss.art).toBeGreaterThanOrEqual(fries.art * 0.95);
    expect(boss.fill).toBeGreaterThan(0.8);
  });
});

describe('tilt titan rig', () => {
  it('is a ball resting on the floor, as wide as it is tall, with the face on the +z side', () => {
    const rig = createPinballBoss();
    try {
      rig.pose('idle', 0);
      const b = bounds(rig.root);
      expect(b.min.y).toBeGreaterThan(-0.12);
      expect(b.min.y).toBeLessThan(0.08);
      expect(b.max.y).toBeGreaterThan(1.9);
      expect(Math.abs((b.max.y - b.min.y) - (b.max.x - b.min.x))).toBeLessThan(0.35);
      for (const e of rig.eyes) { const p = world(e); expect(p.z).toBeGreaterThan(0.8); expect(p.y).toBeGreaterThan(1.1); }
      expect(world(rig.mouth).z).toBeGreaterThan(0.8);
      expect(world(rig.mouth).y).toBeLessThan(world(rig.eyes[0]).y);
      expect(rig.teeth.length).toBeGreaterThan(8);
      expect(rig.floorSparks.visible).toBe(false);
      expect(rig.debris.visible).toBe(false);
      expect(rig.flash.visible).toBe(false);
      for (const c of rig.cracks) expect(c.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('rolls: the riveted seam turns a full revolution per walk cycle while the ball bobs', () => {
    const rig = createPinballBoss();
    try {
      rig.pose('walk', 0);
      const r0 = world(rig.rivets[0]);
      rig.pose('walk', 0.25);
      const r1 = world(rig.rivets[0]);
      expect(r0.distanceTo(r1)).toBeGreaterThan(1.0);
      expect(rig.seam.rotation.x).toBeCloseTo(Math.PI / 2);
      rig.pose('walk', 1);
      expect(world(rig.rivets[0]).distanceTo(r0)).toBeLessThan(0.05);
      expect(rig.dust.visible).toBe(true);
      expect(rig.floorSparks.visible).toBe(true);
    } finally {
      rig.dispose();
    }
  });

  it('revs: the attack turns the whole ball 360° about its axis across the clip, sparks grinding', () => {
    const rig = createPinballBoss();
    try {
      rig.pose('attack', 0);
      const front = world(rig.mouth);
      expect(front.z).toBeGreaterThan(0.8);
      rig.pose('attack', 0.5);
      expect(rig.ball.rotation.y).toBeCloseTo(Math.PI);
      const back = world(rig.mouth);
      expect(back.z).toBeLessThan(-0.8);
      rig.pose('attack', 0.25);
      expect(Math.abs(world(rig.mouth).x)).toBeGreaterThan(0.8);
      expect(rig.floorSparks.visible).toBe(true);
      expect(rig.sparkBits.filter((s) => s.visible).length).toBeGreaterThanOrEqual(8);
      // Every frame of the spin stays inside the ball's own rect: it is the frame the boss loops on.
      for (let i = 0; i < 12; i++) {
        rig.pose('attack', i / 12);
        const b = bounds(rig.root);
        expect(b.max.y).toBeLessThan(2.25);
        expect(Math.max(-b.min.x, b.max.x)).toBeLessThan(1.5);
      }
    } finally {
      rig.dispose();
    }
  });

  it('dies by cracking, glowing through, and detonating into shards that settle on the floor', () => {
    const rig = createPinballBoss();
    try {
      rig.pose('death', 0.25);
      expect(rig.ball.visible).toBe(true);
      expect(rig.cracks.filter((c) => c.visible).length).toBeGreaterThan(3);
      rig.pose('idle', 0);
      const coldEye = rig.eyes[0].material, coldCrack = rig.cracks[0].material;
      rig.pose('death', 0.5);
      // The core shows THROUGH: eyes, mouth and cracks turn to the core's glow while the hull swells.
      expect(rig.eyes[0].material).not.toBe(coldEye);
      expect(rig.cracks[0].material).not.toBe(coldCrack);
      expect(rig.mouth.material).toBe(rig.eyes[0].material);
      expect(rig.hull.scale.x).toBeGreaterThan(1.05);
      rig.pose('death', 0.75);
      expect(rig.ball.visible).toBe(false);
      expect(rig.debris.visible).toBe(true);
      expect(rig.flash.visible).toBe(true);
      rig.pose('death', 1);
      expect(rig.flash.visible).toBe(false);
      expect(rig.smoke.visible).toBe(true);
      for (const s of [...rig.shards, ...rig.bearings]) expect(world(s).y).toBeLessThan(0.45);
      const scatter = bounds(rig.debris);
      expect(scatter.max.x - scatter.min.x).toBeGreaterThan(1.6);
      // Every pose after the death gets its ball back.
      rig.pose('idle', 0);
      expect(rig.ball.visible).toBe(true);
      expect(rig.debris.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('keeps every death frame above the floor, inside the registration half-width and no taller than the ball, at every bake yaw', () => {
    const rig = createPinballBoss();
    try {
      for (const yaw of [0, Math.PI * 0.34, Math.PI]) {
        rig.root.rotation.y = yaw; rig.setFacing(yaw);
        for (let i = 0; i <= 8; i++) {
          rig.pose('death', i / 8);
          const b = bounds(rig.root);
          expect(b.min.y, `yaw ${yaw.toFixed(2)} t=${i}/8 floor`).toBeGreaterThan(-0.12);
          expect(Math.max(-b.min.x, b.max.x), `yaw ${yaw.toFixed(2)} t=${i}/8 width`).toBeLessThan(PINBALL_BOSS_DEATH_HALF_WIDTH + 0.15);
          expect(b.max.y, `yaw ${yaw.toFixed(2)} t=${i}/8 height`).toBeLessThan(2.35);
        }
      }
    } finally {
      rig.dispose();
    }
  });

  it('cheats the face toward the camera for the E bake and leaves the back alone', () => {
    const rig = createPinballBoss();
    try {
      const yawE = Math.PI * 0.34;
      rig.root.rotation.y = yawE;
      rig.setFacing(yawE);
      rig.pose('idle', 0);
      const cheated = rig.eyes.map((e) => world(e).z);
      rig.setFacing(0);
      rig.pose('idle', 0);
      const plain = rig.eyes.map((e) => world(e).z);
      expect(Math.min(...cheated)).toBeGreaterThan(Math.min(...plain) + 0.05);
      for (const e of rig.eyes) { const p = world(e); expect(p.distanceTo(world(rig.ball))).toBeLessThan(1.1); }

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
