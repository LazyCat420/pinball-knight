/**
 * Thunderbolts — jagged line strands.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";

const BOLT_LINES = 40;
const BOLT_POINTS = 16; // vertices per jagged strand
const BOLT_LIFE = 0.22; // seconds a bolt stays visible
const BOLT_CORE_HEX = 0xdff3ff; // tight strand — near white
const BOLT_GLOW_HEX = 0x5eb0ff; // wide strand — electric blue

export class BoltPool {
  readonly group: THREE.Group;
  private lines: THREE.Line[] = [];
  private attrs: THREE.BufferAttribute[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
  private cursor = 0;

  constructor() {
    this.group = new THREE.Group();
    for (let i = 0; i < BOLT_LINES; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", pos);
      const mat = new THREE.LineBasicMaterial({
        color: BOLT_GLOW_HEX,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.renderOrder = 13; // above slashes
      line.frustumCulled = false; // endpoints move; skip the cull test
      this.lines.push(line);
      this.attrs.push(pos);
      this.life.push(0);
      this.maxLife.push(0);
      this.group.add(line);
    }
  }

  spawn(x: number, y: number, z: number, dirx: number, dirz: number, length: number): void {
    const d = Math.hypot(dirx, dirz) || 1;
    const nx = dirx / d;
    const nz = dirz / d;
    const px = -nz; // ground-plane perpendicular
    const pz = nx;
    for (let s = 0; s < 2; s++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % BOLT_LINES;
      const attr = this.attrs[i];
      const amp = s === 0 ? 0.26 : 0.55; // core tight, glow wider
      for (let k = 0; k < BOLT_POINTS; k++) {
        const t = k / (BOLT_POINTS - 1);
        const taper = Math.sin(t * Math.PI); // 0 at both ends → clean anchor points
        const j = (Math.random() * 2 - 1) * amp * taper;
        const yj = (Math.random() * 2 - 1) * 0.16 * taper;
        attr.setXYZ(k, x + nx * length * t + px * j, y + yj, z + nz * length * t + pz * j);
      }
      attr.needsUpdate = true;
      const line = this.lines[i];
      (line.material as THREE.LineBasicMaterial).color.setHex(s === 0 ? BOLT_CORE_HEX : BOLT_GLOW_HEX);
      (line.material as THREE.LineBasicMaterial).opacity = 1;
      line.visible = true;
      this.life[i] = BOLT_LIFE;
      this.maxLife[i] = BOLT_LIFE;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < BOLT_LINES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const line = this.lines[i];
      if (this.life[i] <= 0) {
        line.visible = false;
        continue;
      }
      const t = this.life[i] / this.maxLife[i]; // 1 → 0
      // Flicker: fade the bolt out while jittering brightness so it crackles.
      (line.material as THREE.LineBasicMaterial).opacity = t * (0.55 + Math.random() * 0.45);
    }
  }

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.lines[0];
  }

  dispose(): void {
    for (const l of this.lines) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}
