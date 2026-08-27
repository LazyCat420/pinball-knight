/**
 * Orbiting blades — the Blade Storm ring made visible.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`, then rebuilt
 * in 2026-08 when the ring read as "three half circles spinning" in play.
 */
import * as THREE from "three";
import { CAMERA_YAW, CAMERA_TILT } from "../../constants";

/**
 * ORBITING BLADES — Blade Storm, made visible.
 *
 * Every other pool here fires an EVENT that then decays. A buff that lasts five
 * seconds is a STATE, so this pool is keep-alive instead: `refresh()` places the
 * blades for this frame and re-arms a short hold; `update()` hides them once the
 * caller stops refreshing (i.e. the buff lapsed) — no teardown call to forget,
 * and a dropped frame just leaves the ring up a beat longer.
 *
 * ── WHY THIS IS NOT THE SLASH CRESCENT ANY MORE ──────────────────────────────
 *
 * It used to be: `BladeRing` was handed `slashTexture()` and drew three of them
 * orbiting. That texture is a 223-degree arc (`slash-pool.ts` — `ctx.arc(...,
 * -PI*0.62, PI*0.62)`) and it is a MOTION SMEAR: it depicts a swing that has
 * already happened, and the melee pool shows it for 0.14 s and throws it away.
 *
 * Orbiting a smear turns it into a solid body. Three 223-degree arcs spinning
 * rigidly at 7.5 rad/s is what "half circles spinning" looks like, and no amount
 * of tuning the spin rate fixes it, because the shape is asserting that each
 * blade is itself an arc.
 *
 * A blade in motion is TWO things, and the crescent was trying to be both at
 * once:
 *
 *   · the BLADE — small, bright, hard-edged, at one point on the circle;
 *   · the PATH  — a tapered arc BEHIND it, fading out the further back it goes.
 *
 * Splitting them is the whole fix. The path is drawn analytically rather than
 * from a point buffer: these blades orbit a known circle, so their trail IS a
 * ring arc and can be one static geometry rotated into place. `TrailRibbon`
 * would also work and is the general tool, but it is a single continuous
 * polyline over a ring buffer — pushing several blades through one would join
 * blade 1's head to blade 2's tail, and giving each blade its own costs six ring
 * buffers of 448 points to express an arc that three numbers describe exactly.
 *
 * The taper is VERTEX COLOUR, not opacity, for the reason `trail-ribbon.ts`
 * documents: under additive blending, fading a vertex toward black IS fading it
 * out, and that gives a per-vertex falloff a single material opacity cannot.
 */
const BLADE_MAX = 6;
const BLADE_HOLD = 0.12; // seconds a placed blade survives without a refresh

/** How far back the trail sweeps, radians. ~63 degrees. */
const TRAIL_ARC = 1.1;
/** Segments along the trail. 20 is smooth at the radius these orbit at. */
const TRAIL_SEGMENTS = 20;
/** Trail half-thickness as a fraction of orbit radius. */
const TRAIL_HALF_WIDTH = 0.055;
/**
 * Exponent on the head->tail brightness ramp. >1 keeps the bright part close to
 * the blade, so the trail reads as "it just came from there" rather than as a
 * uniform painted arc — which is the failure mode of the crescent it replaces.
 */
const TRAIL_FALLOFF = 2.2;

/** Seconds the ring takes to fly out to radius on cast, and to retract at the end. */
export const BLADE_SPINUP = 0.22;

/**
 * A unit-radius ring arc lying in the XZ plane, head at theta = 0, sweeping
 * BACKWARD to -TRAIL_ARC, with vertex colour ramping bright -> black along it.
 *
 * Built once and shared by every blade: each blade instance is the same arc
 * rotated about Y, so the geometry cost is one strip regardless of blade count.
 */
export function trailGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s <= TRAIL_SEGMENTS; s++) {
    const t = s / TRAIL_SEGMENTS; // 0 at the head, 1 at the tail
    const a = -t * TRAIL_ARC;
    // The trail also NARROWS toward the tail. A constant-width arc reads as a
    // painted band; a tapered one reads as a wake.
    const halfW = TRAIL_HALF_WIDTH * (1 - t * 0.75);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pos.push(ca * (1 - halfW), 0, sa * (1 - halfW));
    pos.push(ca * (1 + halfW), 0, sa * (1 + halfW));
    // Fade toward black = fade out, under additive blending.
    const b = Math.pow(1 - t, TRAIL_FALLOFF);
    col.push(b, b, b, b, b, b);
    if (s < TRAIL_SEGMENTS) {
      const k = s * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * The blade itself: a small tapered steel shard, point leading.
 *
 * Deliberately NOT an arc. It is drawn along +x so the same tangent roll the
 * old crescent used still aims it, and it is short enough that the eye reads it
 * as an object at a position rather than as a shape occupying an angle.
 */
export function shardTexture(): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(s / 2, s / 2);
  // Body: a lens/leaf shape, widest a third of the way back from the tip.
  const tip = s * 0.44;
  const tail = -s * 0.40;
  const halfW = s * 0.085;
  ctx.beginPath();
  ctx.moveTo(tip, 0);
  ctx.quadraticCurveTo(s * 0.05, -halfW, tail, 0);
  ctx.quadraticCurveTo(s * 0.05, halfW, tip, 0);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  // Hot core along the spine, so it does not flatten into a grey sliver once
  // the palette snap in the pixel pass gets hold of it.
  const grd = ctx.createLinearGradient(tail, 0, tip, 0);
  grd.addColorStop(0, "rgba(255,255,255,0)");
  grd.addColorStop(0.65, "rgba(255,255,255,0.95)");
  grd.addColorStop(1, "rgba(255,255,255,1)");
  ctx.strokeStyle = grd;
  ctx.lineWidth = s * 0.055;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tail * 0.8, 0);
  ctx.lineTo(tip * 0.96, 0);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BladeRing {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private trails: THREE.Mesh[] = [];
  private geo: THREE.PlaneGeometry;
  private trailGeo: THREE.BufferGeometry;
  private tex: THREE.Texture;
  private hold = 0;
  /** Seconds this ring has been continuously alive — drives spin-up and shimmer. */
  private alive = 0;
  /** Counts DOWN through the retract once refreshes stop. */
  private retract = 0;
  /**
   * Opacity each blade and trail held on the frame the buff lapsed.
   *
   * The retract fades FROM these rather than from a constant. Fading from a
   * fixed 0.95 makes the blade JUMP at the moment it starts dying: the shimmer
   * sine bottoms out at 0.56, so a buff that lapses on a trough gets brighter
   * on its way out. Caught by the retract test, which compared the two.
   */
  private fadeFrom = new Float32Array(BLADE_MAX * 2);

  /**
   * The shard texture is INJECTED, not built here, and that is deliberate:
   * `shardTexture()` needs `document`, so a pool that builds its own cannot be
   * constructed in a headless test. The first cut of this rewrite did build its
   * own and every behavioural test below died on `document is not defined` —
   * which is how the DI the old constructor already had turned out to be load
   * bearing rather than incidental. `fx/system.ts` passes the real one.
   */
  constructor(tex: THREE.Texture) {
    this.group = new THREE.Group();
    this.tex = tex;
    this.geo = new THREE.PlaneGeometry(0.62, 0.62);
    this.trailGeo = trailGeometry();
    for (let i = 0; i < BLADE_MAX; i++) {
      const trailMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0.85,
      });
      const t = new THREE.Mesh(this.trailGeo, trailMat);
      t.visible = false;
      t.renderOrder = 11; // under the shard, over the floor
      this.trails.push(t);
      this.group.add(t);

      const mat = new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0.95,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.rotation.order = "YXZ";
      m.visible = false;
      m.renderOrder = 12;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  refresh(x: number, y: number, z: number, angle: number, count: number, radius: number, color: number): void {
    this.hold = BLADE_HOLD;
    this.retract = 0;
    const n = Math.min(count, BLADE_MAX);
    // SPIN-UP: the ring flies out from the knight rather than popping in at full
    // radius. Eased out (fast launch, settling edge) to match `RingPool`'s
    // expansion, which is the house idiom for "something just happened here".
    const su = Math.min(1, this.alive / BLADE_SPINUP);
    const grow = 1 - (1 - su) * (1 - su);
    const r = radius * grow;

    for (let i = 0; i < BLADE_MAX; i++) {
      const m = this.meshes[i];
      const tr = this.trails[i];
      if (i >= n) {
        m.visible = false;
        tr.visible = false;
        continue;
      }
      const a = angle + (i / n) * Math.PI * 2;
      // SHIMMER, COHERENTLY. This used to be `0.7 + Math.random() * 0.3` re-rolled
      // every frame on a five-second object — 300 uncorrelated samples per blade,
      // which the eye reads as buzzing, not shimmer. A phase-offset sine gives
      // each blade its own steady glint at a rate slow enough to perceive.
      const glint = 0.78 + 0.22 * Math.sin(this.alive * 11 + i * 2.399);
      // A small vertical bob, likewise phase-offset, so the ring is not a rigid
      // disc. Kept under a tenth of a tile: the ring must still read as flat.
      const bob = Math.sin(this.alive * 6 + i * 1.7) * 0.06;

      m.position.set(x + Math.cos(a) * r, y + bob, z + Math.sin(a) * r);
      // Lean the shard along the orbit tangent (screen-space roll), then
      // billboard it to the fixed iso camera like every other flat FX quad.
      m.rotation.z = -a - Math.PI / 2;
      m.rotation.y = CAMERA_YAW;
      m.rotation.x = -CAMERA_TILT;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = glint * grow;
      m.scale.setScalar(0.85 + 0.15 * grow);
      m.visible = true;

      // The trail lies FLAT in the orbit plane and is rotated so its head sits
      // under the blade. Three.js Y-rotation is counter-clockwise looking down
      // +Y while our orbit angle runs clockwise in XZ, hence the negation.
      tr.position.set(x, y + bob - 0.02, z);
      tr.rotation.set(0, -a, 0);
      tr.scale.setScalar(r);
      const tmat = tr.material as THREE.MeshBasicMaterial;
      tmat.color.setHex(color);
      tmat.opacity = 0.8 * grow;
      tr.visible = r > 0.01;
    }
  }

  update(dt: number): void {
    if (this.hold > 0) {
      this.alive += dt;
      this.hold -= dt;
      if (this.hold > 0) return;
      // Refreshes stopped: begin the retract rather than blinking out. The ring
      // keeps its last placement and shrinks into the knight.
      this.retract = BLADE_SPINUP;
      for (let i = 0; i < BLADE_MAX; i++) {
        this.fadeFrom[i * 2] = (this.meshes[i].material as THREE.MeshBasicMaterial).opacity;
        this.fadeFrom[i * 2 + 1] = (this.trails[i].material as THREE.MeshBasicMaterial).opacity;
      }
      return;
    }
    if (this.retract <= 0) return;
    this.retract -= dt;
    const k = Math.max(0, this.retract / BLADE_SPINUP);
    for (let i = 0; i < BLADE_MAX; i++) {
      const m = this.meshes[i];
      const tr = this.trails[i];
      if (!m.visible && !tr.visible) continue;
      (m.material as THREE.MeshBasicMaterial).opacity = this.fadeFrom[i * 2] * k;
      (tr.material as THREE.MeshBasicMaterial).opacity = this.fadeFrom[i * 2 + 1] * k;
      tr.scale.setScalar(tr.scale.x * (0.86 + 0.14 * k));
      if (this.retract <= 0) {
        m.visible = false;
        tr.visible = false;
      }
    }
    if (this.retract <= 0) this.alive = 0;
  }

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.meshes[0];
  }

  dispose(): void {
    this.geo.dispose();
    this.trailGeo.dispose();
    this.tex.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
    for (const t of this.trails) (t.material as THREE.Material).dispose();
  }
}
