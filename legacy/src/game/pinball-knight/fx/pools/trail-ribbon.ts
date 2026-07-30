/**
 * The ricochet trail — a glowing ribbon along a path.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";

/**
 * TRAIL RIBBON — the streak a ricochet form drags behind it.
 *
 * Built for the ⚡ bolt / ✨ laser forms (entities/ricochet-form.ts), where the
 * ball crosses the room several times a second. Two problems it solves at once:
 *
 *  1. **Direction.** The form's sprite is a camera-facing billboard, so its art
 *     cannot point anywhere — a beam painted horizontally stays horizontal no
 *     matter which way the ball is travelling, which is exactly how it looked.
 *     The trail is drawn from the ball's ACTUAL path, so it is always right, and
 *     that lets the sprite itself be a small orientation-free core.
 *  2. **Cost.** The obvious build — one short segment per substep out of
 *     BoltPool — burns a draw call per segment and would need a pool three
 *     times the size. This is ONE ring buffer of points drawn as three strands:
 *     3 draw calls for the whole trail, however long it is.
 *
 * Thickness is faked by offsetting two flanking strands perpendicular to the
 * path: WebGL does not honour `linewidth` above 1, so a "wide" line has to be
 * more than one line. The tail fade is VERTEX COLOUR rather than opacity —
 * under additive blending, fading a vertex toward black IS fading it out, and
 * that gives a per-point falloff a single material opacity cannot.
 *
 * KEEP-ALIVE, like `blades`: push points while the form runs, stop pushing and
 * it fades out on its own.
 */
/**
 * Ring-buffer capacity. MEASURED, not guessed, and it has now been wrong twice
 * in the same way.
 *
 * The forms push one point per physics substep — 3 per frame at 60Hz, so 180/s.
 * At 64 the buffer wrapped in 0.36s, SHORTER than TRAIL_LIFE, so points always
 * died by being overwritten and the age check never ran: the life knob was
 * decorative and the trail was capacity-bound at a length nobody chose. 96 put
 * the constraint back on time for a 0.45s ribbon (180 × 0.45 = 81).
 *
 * The ✨ laser's ghost lattice (2026-07-29) needs the WHOLE CAST on screen at
 * once — 180/s × LASER_TRAIL_LIFE — so 96 would have re-created the exact same
 * silent cap. `TRAIL_PUSH_RATE` states the rate the arithmetic depends on, and
 * `trail-capacity.test.ts` asserts capacity ≥ rate × the longest life any
 * flavour asks for, so the next person to lengthen a tail finds out from a test
 * instead of from a tail that stops growing.
 */
export const TRAIL_PUSH_RATE = 180; // points/sec: 3 substeps × 60Hz
/** Exported so the capacity ≥ rate × life relationship can be a test, not a comment. */
export const TRAIL_CAPACITY = 448; // ≥ 180 × 1.9s, the longest tail any flavour asks for

const TRAIL_POINTS = TRAIL_CAPACITY;
const TRAIL_LIFE = 0.45; // DEFAULT seconds a point survives — the trail's LENGTH

/**
 * ── THE TWO THINGS THIS RIBBON DRAWS ──
 *
 * One object, two visual languages, and they differ in THREE knobs — which is
 * why this is a named table and not three loose numbers. A per-point exponent
 * alone was tried first and the laser came out as a long thin thread: correct
 * shape, still reading as a scratch rather than a beam.
 *
 * `taper` — the ⚡ bolt. A streak being DRAGGED: brightest at the ball, gone a
 * moment later, thin, with dim flanks so it feathers out.
 *
 * `beam` — the ✨ laser's spy-movie grid. The tail is not a tail; it is the
 * beams it has already laid, and every one has to stay readable until it dies:
 *   · `fade` is fractional so brightness HOLDS instead of tapering. Under the
 *     bolt's t², a point at half its life is already at a quarter brightness —
 *     on an additive line over a dark floor that is indistinguishable from gone,
 *     so a long life would buy nothing. At t^0.35, half-life still reads 78%.
 *   · `width` is nearly double. A beam you are meant to look AT has to be more
 *     than the 1px line WebGL will draw.
 *   · `edge` lifts the flanking strands close to the core so the beam is SOLID
 *     across its width. At the bolt's 0.55 the edges snap to a dimmer palette
 *     entry than the middle, which on a long straight run reads as a fringed,
 *     noisy line rather than a clean one.
 *
 * Brightness is then QUANTIZED to four flat steps, and that is load-bearing:
 * this line composites BEFORE the ordered dither and the palette snap, so a
 * smooth ramp along a beam lands each pixel on whichever of two entries is
 * nearer and mottles. Flat multiples give bands that each snap to themselves —
 * the additive-line lesson, applied to the fade instead of the fill.
 */
export interface TrailStyle {
  /** Exponent on the remaining-life fraction. <1 holds, >1 tapers. */
  fade: number;
  /** Perpendicular offset of the flanking strands, world units. */
  width: number;
  /** Flank brightness relative to the core. */
  edge: number;
  /**
   * Lowest brightness a LIVE point is drawn at, 0..1.
   *
   * ── WHY A BEAM NEEDS A FLOOR AND A STREAK DOES NOT ──
   * Additive blending does not guarantee a brighter PIXEL once the palette snap
   * has run. A dim red line added onto the crypt's blue-grey floor produces a
   * muddy mid-tone, and the luma-weighted nearest match for that mud is
   * sometimes an entry DARKER than the floor it was drawn over. Measured on a
   * real adapter: the tail bands of the first beam grid came out as brown and
   * near-black scribbles — the effect read as ink, not light.
   *
   * A streak never hits this because it lives 0.45s and spends it near full
   * brightness. A held lattice spends most of its life in the lower bands, so
   * those bands have to stay hot enough to land on the palette's warm/hot
   * entries. The fade then happens BETWEEN 1 and this floor, and the point
   * still disappears when it dies — the falloff is shorter, not absent.
   */
  floor: number;
  /**
   * Whitening of the CORE strand.
   *
   * `"age"` — brightest at the head and fading with it, which is what a dragged
   * streak wants: the hot part is where the ball is.
   *
   * A NUMBER — constant along the whole path. A beam grid wants this: the core
   * of every leg has to stay near-white so the composite lands on steel
   * highlight rather than in the mud, which is also how the form's own cel is
   * built (core 22, body 13, glow 12 — see ricochetFrame).
   */
  coreWhite: "age" | number;
}
export const TRAIL_STYLES: Record<"taper" | "beam", TrailStyle> = {
  /** The bolt, unchanged: these are exactly the constants it shipped with. */
  taper: { fade: 2, width: 0.09, edge: 0.55, floor: 0, coreWhite: "age" },
  /**
   * The laser grid. Every number here was read off a WebGPU capture, zoomed 3x,
   * because each wrong guess failed differently and none of them failed loudly:
   *
   *   width 0.09, floor 0, coreWhite "age" → thin BROWN SCRIBBLES. The dim bands
   *     added onto the crypt floor snapped darker than the floor (see `floor`).
   *   width 0.17, coreWhite 0.75          → white PLANKS. A core whitened past
   *     the tint clips all three channels, so the beam loses its colour and
   *     three parallel strands read as a solid board rather than a beam.
   *   width 0.13, floor 0.5, coreWhite 0.3 → a pink beam with a lit core, legs
   *     crossing the room, older legs still readable. Kept.
   */
  beam: { fade: 0.35, width: 0.13, edge: 0.85, floor: 0.5, coreWhite: 0.3 },
};
export type TrailStyleName = keyof typeof TRAIL_STYLES;
const TRAIL_FADE_STEPS = 4;

export class TrailRibbon {
  readonly group: THREE.Group;
  private strands: THREE.Line[] = [];
  private posAttrs: THREE.BufferAttribute[] = [];
  private colAttrs: THREE.BufferAttribute[] = [];
  /** Ring buffer of path points + their age. */
  private px = new Float32Array(TRAIL_POINTS);
  private py = new Float32Array(TRAIL_POINTS);
  private pz = new Float32Array(TRAIL_POINTS);
  private age = new Float32Array(TRAIL_POINTS);
  /**
   * Per-point lifetime. The forms want different tail LENGTHS out of one
   * ribbon: the bolt drags a long ribbon, the laser a short stub behind a dot.
   * Storing it per point rather than per class keeps `update`'s
   * oldest-dies-first walk valid, because `clear()` on entry means every live
   * point in the buffer always belongs to ONE cast and so shares one life.
   */
  private life = new Float32Array(TRAIL_POINTS);
  /**
   * Per-point STYLE, for the same reason `life` is per point: one ribbon serves
   * a dragged streak and a held lattice, and everything about how they read —
   * falloff, width, edge — differs. Stored as the style's own object so a
   * future third language is a table entry, not another parallel array.
   */
  private style: TrailStyle[] = new Array(TRAIL_POINTS).fill(TRAIL_STYLES.taper);
  private alive = 0;
  private head = 0;
  private color = new THREE.Color(0xffffff);

  constructor() {
    this.group = new THREE.Group();
    for (let s = 0; s < 3; s++) {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3);
      const col = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      col.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", pos);
      geo.setAttribute("color", col);
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        opacity: 1,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.renderOrder = 13;
      line.frustumCulled = false; // the path moves; skip the cull test
      this.strands.push(line);
      this.posAttrs.push(pos);
      this.colAttrs.push(col);
      this.group.add(line);
    }
  }

  /** Append one path point. Call per SUBSTEP so bounces keep their corners. */
  push(x: number, y: number, z: number, color: number, life: number = TRAIL_LIFE, style: TrailStyleName = "taper"): void {
    this.color.setHex(color);
    this.px[this.head] = x;
    this.py[this.head] = y;
    this.pz[this.head] = z;
    this.age[this.head] = 0;
    this.life[this.head] = life;
    this.style[this.head] = TRAIL_STYLES[style] ?? TRAIL_STYLES.taper;
    this.head = (this.head + 1) % TRAIL_POINTS;
    if (this.alive < TRAIL_POINTS) this.alive++;
  }

  /** Drop every point immediately (entering a new form). */
  clear(): void {
    this.alive = 0;
    this.head = 0;
    for (const l of this.strands) l.visible = false;
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    // Walk oldest → newest so the strip is drawn in path order; anything past
    // its life is simply not emitted, which shortens the tail from the back.
    let n = 0;
    const start = (this.head - this.alive + TRAIL_POINTS) % TRAIL_POINTS;
    const live: number[] = [];
    for (let k = 0; k < this.alive; k++) {
      const i = (start + k) % TRAIL_POINTS;
      this.age[i] += dt;
      if (this.age[i] < this.life[i]) live.push(i);
    }
    // Points die from the OLDEST end only, so the survivors are always the
    // newest `live.length` — i.e. the range [head − live.length, head).
    // `head` is the WRITE cursor and must NOT move here: rewinding it to
    // `start + live.length` would put the cursor back inside the live range and
    // the next pushes would overwrite the trail's own tail.
    this.alive = live.length;
    if (live.length < 2) {
      for (const l of this.strands) l.visible = false;
      return;
    }

    for (let s = 0; s < 3; s++) {
      const pos = this.posAttrs[s];
      const col = this.colAttrs[s];
      // Strand 0 is the core (no offset, near-white); 1 and 2 flank it to fake
      // a thickness WebGL will not give us through linewidth.
      const side = s === 0 ? 0 : s === 1 ? 1 : -1;
      n = 0;
      for (let k = 0; k < live.length; k++) {
        const i = live[k];
        const sty = this.style[i];
        // Perpendicular to the local path direction, on the ground plane.
        const j = live[Math.min(k + 1, live.length - 1)];
        const h = live[Math.max(k - 1, 0)];
        const dx = this.px[j] - this.px[h];
        const dz = this.pz[j] - this.pz[h];
        const d = Math.hypot(dx, dz) || 1;
        const ox = (-dz / d) * sty.width * side;
        const oz = (dx / d) * sty.width * side;
        pos.setXYZ(n, this.px[i] + ox, this.py[i], this.pz[i] + oz);
        // Fade toward BLACK along the tail — under additive blending that is
        // the fade. `t` is 1 at the head (newest) and 0 at the tail.
        const t = 1 - this.age[i] / this.life[i];
        // Quantized so a long beam reads as flat brightness BANDS rather than a
        // smooth ramp the dither and the palette snap turn into mottle.
        const shaped = Math.pow(t, sty.fade);
        const stepped = Math.ceil(shaped * TRAIL_FADE_STEPS) / TRAIL_FADE_STEPS;
        // The bands span [floor, 1] rather than [0, 1] — see TrailStyle.floor.
        const band = sty.floor + (1 - sty.floor) * stepped;
        const f = band * (s === 0 ? 1 : sty.edge);
        if (s === 0) {
          // The core runs hotter than the flanks so the beam has a lit line
          // through it rather than being one flat colour.
          const w = sty.coreWhite === "age" ? t * 0.6 : sty.coreWhite;
          col.setXYZ(n, Math.min(1, this.color.r + w) * f, Math.min(1, this.color.g + w) * f, Math.min(1, this.color.b + w) * f);
        } else {
          col.setXYZ(n, this.color.r * f, this.color.g * f, this.color.b * f);
        }
        n++;
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      this.strands[s].geometry.setDrawRange(0, n);
      this.strands[s].visible = n >= 2;
    }
  }

  /** See `warmupReveal` — strand 0 stands in for the ribbon at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.strands[0];
  }

  dispose(): void {
    for (const l of this.strands) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}
