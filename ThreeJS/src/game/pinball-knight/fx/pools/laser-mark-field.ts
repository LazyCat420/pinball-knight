/**
 * Laser marks — crossed sparks stamped along a path.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";
import { linColor } from "../color";

/**
 * LASER MARKS — the chain of crossed sparks a ricochet form stamps along its
 * path. The other half of the "you are a laser" read, and the half the ribbon
 * alone could not give.
 *
 * WHY THIS EXISTS. The ribbon draws the path as one continuous stroke. At laser
 * speed on open floor the path between two walls IS a straight line, so the
 * ribbon rendered it faithfully as a long line lying across the room — which is
 * exactly what a laser beam looks like, and exactly the complaint: a beam
 * sliding sideways instead of a bolt of light darting about.
 *
 * The fix is two-part and this is the visible half. The form now kinks its
 * heading in mid-air (see entities/ricochet-form.ts), and every kink, every
 * wall bounce and every fixed step of distance stamps a CROSS here. What you
 * see is a dot travelling with a short tail, punching out a rapid chain of
 * laser crosses along a zigzag — discrete marks, not a drawn line.
 *
 * SHAPE. Each mark is two crossed segments in the plane spanned by the ball's
 * TRAVEL DIRECTION and WORLD UP. That plane choice is deliberate: a cross laid
 * flat on the ground foreshortens to a smear under the fixed iso camera, while
 * one arm on the ground plane plus one vertical arm always projects to a legible
 * cross on screen no matter which way the ball is going. A per-mark roll spins
 * the pair so the chain alternates between + and × instead of stencilling one
 * glyph over and over.
 *
 * COST. One `LineSegments` for the whole field — a ring buffer of stamps sharing
 * a single geometry, drawn in ONE call however many are live, with the fade
 * carried by vertex colour (additive: fading toward black IS fading out).
 */
const MARK_CAP = 48; // stamps held; the oldest is overwritten, never queued
const MARK_LIFE = 0.3; // seconds a stamp survives — how long the chain is
const MARK_VERTS = MARK_CAP * 4; // 2 segments × 2 endpoints per stamp
/**
 * Brightness steps a mark walks down as it ages, as MULTIPLES OF THE TINT — see
 * the colour block in `update` for why flat multiples and not a smooth fade.
 * The first is above 1 on purpose: it blows the head of the chain out so the
 * bloom pass has something to catch. Measured on a real adapter, not chosen —
 * at a flat 1 the whole chain drew as grey scratches on the floor.
 */
const MARK_STEPS = [3, 1.4, 0.7, 0.3];

export class LaserMarkField {
  readonly group: THREE.Group;
  private seg: THREE.LineSegments;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  /** Ring buffer of stamps: position, ground-plane arm, roll, size, age, tint. */
  private px = new Float32Array(MARK_CAP);
  private py = new Float32Array(MARK_CAP);
  private pz = new Float32Array(MARK_CAP);
  private ax = new Float32Array(MARK_CAP);
  private az = new Float32Array(MARK_CAP);
  private roll = new Float32Array(MARK_CAP);
  private size = new Float32Array(MARK_CAP);
  private age = new Float32Array(MARK_CAP);
  private cr = new Float32Array(MARK_CAP);
  private cg = new Float32Array(MARK_CAP);
  private cb = new Float32Array(MARK_CAP);
  private live = new Uint8Array(MARK_CAP);
  private cursor = 0;

  constructor() {
    this.group = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MARK_VERTS * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MARK_VERTS * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("color", this.colAttr);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      opacity: 1,
    });
    this.seg = new THREE.LineSegments(geo, mat);
    this.seg.visible = false;
    this.seg.renderOrder = 14; // over the ribbon it punctuates
    this.seg.frustumCulled = false; // the chain moves; skip the cull test
    this.group.add(this.seg);
  }

  /** Stamp one cross at a path point, its long arm along (dirx, dirz). */
  spawn(x: number, y: number, z: number, dirx: number, dirz: number, color: number, size: number): void {
    const d = Math.hypot(dirx, dirz) || 1;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MARK_CAP;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.ax[i] = dirx / d;
    this.az[i] = dirz / d;
    this.roll[i] = Math.random() * Math.PI; // + or ×, and everything between
    this.size[i] = size * (0.72 + Math.random() * 0.56);
    this.age[i] = 0;
    const [r, g, b] = linColor(color);
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
    this.live[i] = 1;
  }

  /** Drop every mark immediately (entering a new form). */
  clear(): void {
    this.live.fill(0);
    this.cursor = 0;
    this.seg.visible = false;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < MARK_CAP; i++) {
      if (!this.live[i]) continue;
      this.age[i] += dt;
      if (this.age[i] >= MARK_LIFE) {
        this.live[i] = 0;
        continue;
      }
      const t = 1 - this.age[i] / MARK_LIFE; // 1 at the stamp, 0 at death
      // HOLD, then go — `sqrt` rather than the `t*t` this started as. A squared
      // fade leaves a long dim tail, and a dim additive line is the worst thing
      // this field can draw: too faint to read as light, but still bright enough
      // for the pass's luma-edge outline to trace it, so the chain ends in a
      // scribble of dark scratches. Holding the marks bright and then dropping
      // them keeps every visible mark a mark.
      // The per-frame flicker on top makes the chain sputter like a discharge.
      const f = Math.sqrt(t) * (0.7 + Math.random() * 0.45);
      const s = this.size[i] * (0.55 + t * 0.45); // marks shrink as they die
      const c = Math.cos(this.roll[i]);
      const si = Math.sin(this.roll[i]);
      // Arm A: the ground-plane travel direction rolled toward vertical.
      // Arm B: its perpendicular in the same (travel, up) plane.
      const a1x = this.ax[i] * c;
      const a1y = si;
      const a1z = this.az[i] * c;
      const a2x = -this.ax[i] * si;
      const a2y = c;
      const a2z = -this.az[i] * si;
      const x = this.px[i];
      const y = this.py[i];
      const z = this.pz[i];
      // Segment 1 — the long arm, on the path.
      this.posAttr.setXYZ(n, x - a1x * s, y - a1y * s, z - a1z * s);
      this.posAttr.setXYZ(n + 1, x + a1x * s, y + a1y * s, z + a1z * s);
      // Segment 2 — the shorter cross arm, so the mark has a reading axis.
      const s2 = s * 0.68;
      this.posAttr.setXYZ(n + 2, x - a2x * s2, y - a2y * s2, z - a2z * s2);
      this.posAttr.setXYZ(n + 3, x + a2x * s2, y + a2y * s2, z + a2z * s2);
      // COLOUR — a FLAT RAMP down the tint, not a continuous fade to black.
      //
      // Two things forced this, both measured on a real adapter rather than
      // reasoned about:
      //
      //  1. The first version handed the line the tint's own linear value and
      //     the crosses drew as thin grey scratches. An additive line is only
      //     as bright as the number you give it, and MARK_STEPS[0]'s gain past
      //     1 is what makes the head a blown-out source the bloom can catch.
      //  2. A CONTINUOUS fade walks the colour through every luma between the
      //     tint and black — and the screen-space snap is luma-weighted over a
      //     palette with no magenta, so the mid-fade values land on STEEL and
      //     the tail turns grey. Flat multiples of the tint keep the hue fixed
      //     and step the brightness, which is both how this game draws falloff
      //     everywhere else and what keeps the chain on the blood ramp.
      const step = MARK_STEPS[Math.min(MARK_STEPS.length - 1, ((1 - t) * MARK_STEPS.length) | 0)];
      const r = Math.min(1, this.cr[i] * step) * f;
      const g = Math.min(1, this.cg[i] * step) * f;
      const b = Math.min(1, this.cb[i] * step) * f;
      for (let k = 0; k < 4; k++) this.colAttr.setXYZ(n + k, r, g, b);
      n += 4;
    }
    if (n === 0) {
      this.seg.visible = false;
      return;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.seg.geometry.setDrawRange(0, n);
    this.seg.visible = true;
  }

  /** See `warmupReveal` — the field is one object, so it stands in for itself. */
  warmupTarget(): THREE.Object3D {
    return this.seg;
  }

  dispose(): void {
    this.seg.geometry.dispose();
    (this.seg.material as THREE.Material).dispose();
  }
}

/**
 * Shockwave ring — a flat expanding annulus on the floor. Additive, bloom-fed,
 * with a sin(π·t) opacity bell so it peaks mid-expansion and dissolves at the
 * rim. Expansion is ease-out (fast launch, decelerating edge) — a pressure wave.
 *
 * TWO band widths, because one shape can't do both jobs: the FAT band reads as
 * a soft field boundary (the auras), while a shockwave needs a THIN, sharp line
 * — a fat hoop scaled to a 3.4-tile radius stops reading as a wave front and
 * starts reading as "a big circle drawn on the floor", which is exactly the
 * complaint the Arcane Pulse rework had to answer.
 */
// A cast is 3-4 rings, and the sustained auras (Magnet, Time Crawl) drip one
// every few tenths of a second on top of whatever else is live.
