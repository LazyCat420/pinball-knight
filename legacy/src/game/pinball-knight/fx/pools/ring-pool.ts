/**
 * Shockwave rings — flat expanding bands on the floor.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";

const RING_COUNT = 16;
const RING_INNER = 0.78; // fat unit-ring inner radius → a soft field band
const RING_INNER_THIN = 0.955; // sharp unit-ring inner radius → a wave-front line

/** Per-spawn ring styling. */
export interface RingOpts {
  /** Hold the ring hidden this long before it starts (chaser rings). */
  delay?: number;
  /** COLLAPSE inward (a pull) instead of expanding (a push). */
  inward?: boolean;
  /** Draw the sharp wave-front line instead of the fat field band. */
  thin?: boolean;
  /** Peak opacity multiplier (default 1) — how loud this ring is allowed to be. */
  opacity?: number;
}

export class RingPool {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
  private maxR: number[] = [];
  private delay: number[] = [];
  /** true = the ring COLLAPSES inward (a pull) instead of expanding (a push). */
  private inward: boolean[] = [];
  private peak: number[] = [];
  private fat: THREE.RingGeometry;
  private thin: THREE.RingGeometry;
  private cursor = 0;

  constructor() {
    this.group = new THREE.Group();
    this.fat = new THREE.RingGeometry(RING_INNER, 1, 40);
    this.thin = new THREE.RingGeometry(RING_INNER_THIN, 1, 64);
    for (let i = 0; i < RING_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0,
      });
      const m = new THREE.Mesh(this.fat, mat);
      m.rotation.x = -Math.PI / 2; // lay flat on the floor
      m.visible = false;
      m.renderOrder = 11;
      this.meshes.push(m);
      this.life.push(0);
      this.maxLife.push(0);
      this.maxR.push(1);
      this.delay.push(0);
      this.inward.push(false);
      this.peak.push(1);
      this.group.add(m);
    }
  }

  spawn(x: number, z: number, color: number, maxRadius: number, duration: number, opts: RingOpts = {}): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % RING_COUNT;
    const m = this.meshes[i];
    m.position.set(x, 0.06, z);
    m.geometry = opts.thin ? this.thin : this.fat;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = false; // stays hidden through the delay
    this.life[i] = duration;
    this.maxLife[i] = duration;
    this.maxR[i] = maxRadius;
    this.delay[i] = opts.delay ?? 0;
    this.inward[i] = opts.inward ?? false;
    this.peak[i] = opts.opacity ?? 1;
  }

  update(dt: number): void {
    for (let i = 0; i < RING_COUNT; i++) {
      if (this.life[i] <= 0) continue;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      // Outward: ease-out expansion (a pressure wave — fast launch, slow edge).
      // Inward: ease-IN collapse, so a pull ACCELERATES into the centre, which
      // is what makes it read as suction rather than a wave played backwards.
      const r = this.inward[i] ? this.maxR[i] * (1 - t * t) : this.maxR[i] * (1 - (1 - t) * (1 - t));
      m.scale.setScalar(Math.max(0.05, r));
      (m.material as THREE.MeshBasicMaterial).opacity = Math.sin(t * Math.PI) * this.peak[i];
      m.visible = true;
    }
  }

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.meshes[0];
  }

  dispose(): void {
    this.fat.dispose();
    this.thin.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}

/**
 * RUNE SIGIL — a summoning glyph that snaps into existence under a cast, spins,
 * and burns away.
 *
 * This is the piece that makes a spell read as MAGIC rather than as geometry.
 * A shockwave ring alone is a circle; a circle with runes, radial ticks and a
 * counter-rotating inner wheel is a spell being cast. Painted once to a canvas
 * (the slash/floor-fx pattern) and tinted per spawn, so it costs one texture.
 *
 * The sigil punches in fast (over-scaled, then settling), holds while the wave
 * travels, and fades as it over-expands — never a static decal.
 */
// Headroom for overlap: a pulse strikes two at once, the magnet re-strikes one
// per beat while its aura runs, and a cast flourish can land on top of both.
