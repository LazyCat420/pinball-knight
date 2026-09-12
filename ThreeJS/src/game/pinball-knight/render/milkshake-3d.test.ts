/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from 'canvas';
import { createMilkshake, MILKSHAKE_CLIPS, MILKSHAKE_DEATH_HALF_WIDTH, MILKSHAKE_FRAMES, type MilkshakePose } from './milkshake-3d';
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

  it('bakes the standing monster at least as tall on screen as the Fry Sentinel, its fast-food sibling', async () => {
    // The first bake hovered with no legs and let the death spread wide and
    // low, so the ONE shared registration rect was much bigger than the
    // standing cup and the living monster drew at 69 art units against the
    // fries' 89. Same arithmetic as tools/sprite-forge/manifest.ts artScale
    // (k = min(ART_FIT_H / cellH, 0.92 * ART_BOX / cellW)) applied to the
    // idle frame's OWN ink, which is what the player sees standing there.
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
    const shake = await standingArtHeight('milkshake'), fries = await standingArtHeight('fries');
    expect(shake.art).toBeGreaterThanOrEqual(fries.art * 0.97);
    // And the rect is not padded by transients: the idle fills most of it.
    expect(shake.fill).toBeGreaterThan(0.78);
  });
});

describe('toxic shake rig', () => {
  it('stands on the floor on two legs, taller than wide, with the face on the +z side and ON the cup', () => {
    const rig = createMilkshake();
    try {
      rig.pose('idle', 0);
      const b = bounds(rig.root);
      expect(b.min.y).toBeGreaterThan(-0.12);
      expect(b.min.y).toBeLessThan(0.08);
      expect(b.max.y - b.min.y).toBeGreaterThan(b.max.x - b.min.x);
      expect(b.max.y).toBeGreaterThan(2.8);
      expect(rig.legs).toHaveLength(2);
      for (const leg of rig.legs) expect(bounds(leg).min.y).toBeLessThan(0.08);

      // Eyes sit proud of the cup's surface, not buried in it: further from the
      // axis than the cup's own radius where they sit.
      for (const eye of rig.eyes) {
        const p = world(eye);
        expect(p.z).toBeGreaterThan(0.5);
        expect(Math.hypot(p.x, p.z)).toBeGreaterThan(0.7);
      }
      expect(world(rig.smirk).y).toBeGreaterThan(world(rig.cup).y - 0.2);
      expect(rig.spray.visible).toBe(false);
      expect(rig.puddle.visible).toBe(false);
      expect(rig.gush.visible).toBe(false);
      expect(rig.mouth.visible).toBe(false);
      for (const x of rig.xeyes) expect(x.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('keeps the whole idle inside the bake frustum and the straw tip forward of the lid', () => {
    const rig = createMilkshake();
    try {
      for (const t of [0, 0.25, 0.5, 0.75]) {
        rig.pose('idle', t);
        const b = bounds(rig.root);
        expect(Math.max(-b.min.x, b.max.x)).toBeLessThan(2.1);
        expect(b.max.y).toBeLessThan(3.6);
      }
      const tip = world(rig.strawTip);
      expect(tip.y).toBeGreaterThan(2.7);
      expect(tip.z).toBeGreaterThan(0.2);
    } finally {
      rig.dispose();
    }
  });

  it('struts with the legs and the gloves swinging in opposition and the body bobbing', () => {
    const rig = createMilkshake();
    try {
      rig.pose('walk', 0.25);
      const [l, r] = rig.legs.map((leg) => leg.rotation.x);
      expect(Math.sign(l)).not.toBe(Math.sign(r));
      expect(Math.abs(l)).toBeGreaterThan(0.5);
      // Gloves counter-swing about their trailing rest pose: left back, right forward here.
      const [al, ar] = rig.arms.map((arm) => arm.rotation.x);
      expect(al).toBeLessThan(ar - 1.0);
      expect(rig.hull.rotation.z).not.toBe(0);

      const up = rig.body.position.y;
      rig.pose('walk', 0);
      expect(up).toBeGreaterThan(rig.body.position.y);
      // The walk is a real gait, not the idle with a tilt: the legs cover the stride.
      rig.pose('walk', 0.75);
      expect(Math.sign(rig.legs[0].rotation.x)).toBe(-Math.sign(l));
      expect(rig.arms[0].rotation.x).toBeGreaterThan(rig.arms[1].rotation.x + 1.0);
    } finally {
      rig.dispose();
    }
  });

  it('attacks by rearing back with a gaping mouth, then lunging and hosing shake TOWARD the player', () => {
    const rig = createMilkshake();
    try {
      // Windup: leans back, cup swells, no spray yet.
      rig.pose('attack', 0.12);
      expect(rig.hull.rotation.x).toBeLessThan(-0.1);
      expect(rig.cup.scale.x).toBeGreaterThan(1.05);
      expect(rig.spray.visible).toBe(false);

      // Lunge: leans in, gloves thrust forward, mouth open, spray flying +z and descending.
      rig.pose('attack', 0.55);
      expect(rig.hull.rotation.x).toBeGreaterThan(0.15);
      expect(rig.arms[0].rotation.x).toBeLessThan(-0.8);
      expect(rig.arms[1].rotation.x).toBeLessThan(-0.8);
      expect(rig.mouth.visible).toBe(true);
      expect(rig.smirk.visible).toBe(false);
      expect(rig.spray.visible).toBe(true);
      const flying = rig.spray.children.filter((d) => d.visible);
      expect(flying.length).toBeGreaterThan(4);
      for (const d of flying) {
        expect(d.position.z).toBeGreaterThan(0.4);
        expect(d.position.y).toBeGreaterThan(0.6);
      }
      // Both streams: some droplets start high (the straw), some at mouth height.
      const ys = flying.map((d) => d.position.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.6);
      // The leading droplet has travelled toward the player, not straight up.
      const lead = flying.reduce((a, d) => (d.position.z > a.position.z ? d : a));
      expect(lead.position.z).toBeGreaterThan(1.2);
      expect(lead.position.y).toBeLessThan(3.0);
      // The whole volley stays inside the bake frustum.
      const b = bounds(rig.root);
      expect(Math.max(-b.min.x, b.max.x)).toBeLessThan(2.1);

      rig.pose('attack', 1);
      expect(rig.spray.visible).toBe(false);
      expect(rig.mouth.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('dies by blowing its lid, toppling onto its side into a puddle, with X eyes — and stays on the floor', () => {
    const rig = createMilkshake();
    try {
      rig.pose('idle', 0);
      const standing = bounds(rig.root);
      const lidUp = world(rig.top).y;

      // Mid-fall: the lid is airborne and off the cup, shake is gushing.
      rig.pose('death', 0.5);
      expect(rig.gush.visible).toBe(true);
      expect(Math.abs(world(rig.top).x)).toBeGreaterThan(0.2);
      expect(rig.puddle.visible).toBe(true);

      // Down: the cup lies on its side (rolled past 60°), crumpled but still a cup, X eyes, lid on the floor.
      rig.pose('death', 1);
      expect(Math.abs(rig.hull.rotation.z)).toBeGreaterThan(1.0);
      expect(rig.cup.scale.y).toBeLessThan(0.8);
      expect(rig.cup.scale.y).toBeGreaterThan(0.5);
      expect(world(rig.top).y).toBeLessThan(lidUp * 0.3);
      for (const x of rig.xeyes) expect(x.visible).toBe(true);
      for (const e of rig.eyes) expect(e.visible).toBe(false);
      expect(rig.mouth.visible).toBe(true);
      expect(rig.smirk.visible).toBe(false);
      expect(rig.gush.visible).toBe(false);

      const flat = bounds(rig.root);
      // A cup on its side is as tall as it is wide; what matters is that it is DOWN.
      expect(flat.max.y).toBeLessThan(standing.max.y * 0.6);
      expect(flat.max.x - flat.min.x).toBeGreaterThan(standing.max.x - standing.min.x);

      // Every pose after the death must get its eyes back: the bake runs one
      // facing's death straight into the next facing's idle, and E once baked
      // eyeless because reset() restored everything about the eyes but `visible`.
      rig.pose('idle', 0);
      for (const e of rig.eyes) expect(e.visible).toBe(true);
      for (const x of rig.xeyes) expect(x.visible).toBe(false);
    } finally {
      rig.dispose();
    }
  });

  it('keeps every death frame above the floor and inside the registration half-width', () => {
    // The first bake sank the mouth and brows through the floor as it flattened,
    // leaving stray ink under the puddle, and its puddle ran to the cell edge —
    // which the shared registration rect then charged to every living frame.
    const rig = createMilkshake();
    try {
      // Every bake yaw: the E bake turns model z into screen x, so the puddle's depth counts too.
      for (const yaw of [0, Math.PI * 0.34, Math.PI]) {
        rig.root.rotation.y = yaw; rig.setFacing(yaw);
        for (let i = 0; i <= 8; i++) {
          rig.pose('death', i / 8);
          const b = bounds(rig.root);
          expect(b.min.y, `yaw ${yaw.toFixed(2)} t=${i}/8 floor`).toBeGreaterThan(-0.12);
          expect(Math.max(-b.min.x, b.max.x), `yaw ${yaw.toFixed(2)} t=${i}/8 width`).toBeLessThan(MILKSHAKE_DEATH_HALF_WIDTH + 0.15);
        }
      }
    } finally {
      rig.dispose();
    }
  });

  it('cheats the face toward the camera for the E bake and leaves the back alone', () => {
    const rig = createMilkshake();
    try {
      const yawE = Math.PI * 0.34;
      rig.root.rotation.y = yawE;
      rig.setFacing(yawE);
      rig.pose('idle', 0);
      // With the cheat, the eyes end up nearer the camera's +z axis than the root yaw alone would put them.
      const cheated = rig.eyes.map((e) => world(e).z);
      rig.setFacing(0);
      rig.pose('idle', 0);
      const plain = rig.eyes.map((e) => world(e).z);
      expect(Math.min(...cheated)).toBeGreaterThan(Math.min(...plain) + 0.1);
      // Still ON the cup: the cheat slides the features round the surface, never off it.
      for (const e of rig.eyes) { const p = world(e); expect(Math.hypot(p.x, p.z)).toBeLessThan(0.95); }

      rig.root.rotation.y = Math.PI;
      rig.setFacing(Math.PI);
      rig.pose('idle', 0);
      expect(rig.face.rotation.y).toBe(0);
      // Pose() must not lose the cheat between frames: it is applied in reset().
      rig.setFacing(yawE); rig.pose('walk', 0.3);
      expect(rig.face.rotation.y).toBeCloseTo(-yawE * 0.7);
    } finally {
      rig.dispose();
    }
  });
});
