/**
 * Rune sigils — a summoning glyph struck onto the floor.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";

const SIGIL_COUNT = 8;

function sigilTexture(): THREE.CanvasTexture {
  const s = 256;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const c = s / 2;
  ctx.translate(c, c);
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "butt";
  // Two concentric rims — the frame every summoning circle hangs off.
  for (const [r, w, a] of [[0.94, 3, 1], [0.86, 1.5, 0.7], [0.52, 2, 0.85], [0.44, 1, 0.5]] as const) {
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, c * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Radial tick marks around the rim — long every 4th, the "graduated dial" read.
  ctx.globalAlpha = 0.9;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const long = k % 4 === 0;
    ctx.lineWidth = long ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * c * 0.86, Math.sin(a) * c * 0.86);
    ctx.lineTo(Math.cos(a) * c * (long ? 0.66 : 0.76), Math.sin(a) * c * (long ? 0.66 : 0.76));
    ctx.stroke();
  }
  // Inner star polygon {8/3} — angular, non-circular, so the eye reads a GLYPH.
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= 8; k++) {
    const a = ((k * 3) / 8) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * c * 0.52;
    const y = Math.sin(a) * c * 0.52;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Rune blocks sitting in the band between the rims.
  ctx.globalAlpha = 0.95;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 16;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(c * 0.69, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillRect(-5, -7, 10, 2.5);
    ctx.fillRect(-5, 0, 6, 2.5);
    ctx.fillRect(-2, 5, 7, 2.5);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SigilPool {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
  private r0: number[] = [];
  private spin: number[] = [];
  private geo: THREE.PlaneGeometry;
  private tex: THREE.CanvasTexture;
  private cursor = 0;

  constructor() {
    this.group = new THREE.Group();
    this.tex = sigilTexture();
    this.geo = new THREE.PlaneGeometry(2, 2); // unit-radius quad, scaled per spawn
    for (let i = 0; i < SIGIL_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.rotation.x = -Math.PI / 2; // flat on the floor
      m.visible = false;
      m.renderOrder = 10; // under the rings and bolts
      this.meshes.push(m);
      this.life.push(0);
      this.maxLife.push(0);
      this.r0.push(1);
      this.spin.push(0);
      this.group.add(m);
    }
  }

  spawn(x: number, z: number, color: number, radius: number, life: number, spin: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SIGIL_COUNT;
    const m = this.meshes[i];
    m.position.set(x, 0.05, z);
    m.rotation.z = Math.random() * Math.PI * 2; // never the same glyph orientation
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.r0[i] = radius;
    this.spin[i] = spin;
  }

  update(dt: number): void {
    for (let i = 0; i < SIGIL_COUNT; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      // Punch in over the first 18% (overshoot → settle), then drift wider as
      // it burns off: struck, not faded up.
      const k = t < 0.18 ? t / 0.18 : 1;
      const scale = this.r0[i] * (k < 1 ? 0.55 + 0.55 * k : 1.0 + (t - 0.18) * 0.28);
      m.scale.set(scale, scale, scale);
      m.rotation.z += this.spin[i] * dt;
      (m.material as THREE.MeshBasicMaterial).opacity = k < 1 ? k : Math.pow(1 - (t - 0.18) / 0.82, 0.7);
    }
  }

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.meshes[0];
  }

  dispose(): void {
    this.geo.dispose();
    this.tex.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}
