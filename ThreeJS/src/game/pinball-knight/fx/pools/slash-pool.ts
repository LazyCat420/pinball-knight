/**
 * Melee slash crescents — the arc a swing draws.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";
import { CAMERA_YAW, CAMERA_TILT } from "../../constants";

/**
 * Slash arc — a short-lived crescent quad that sweeps in the swing direction.
 * Billboarded to the fixed iso camera (like the actor sprites) and rolled in
 * screen space to point along the facing.
 */
const SLASH_COUNT = 10; // combo steps stack cuts (X-cut + finisher volley overlap)
/** Screen-plane roll (rotation.z, applied first under YXZ) per facing. */
const SLASH_ROLL: Record<string, number> = {
  E: 0,
  W: Math.PI,
  S: -Math.PI / 2,
  N: Math.PI / 2,
};

export function slashTexture(): THREE.CanvasTexture {
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  // A tapered crescent opening to the right (+x): two arcs, bright core.
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    ctx.lineWidth = [10, 5, 2][pass];
    ctx.globalAlpha = [0.35, 0.7, 1][pass];
    ctx.arc(-s * 0.18, 0, s * 0.42, -Math.PI * 0.62, Math.PI * 0.62);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Per-spawn slash styling — how the combo steps stop looking identical. */
export interface SlashOpts {
  /** Extra screen-plane roll (radians) on top of the facing's base roll. */
  roll?: number;
  /** Size multiplier (1 = the classic crescent). */
  scale?: number;
  /** Flip the crescent across the swing line — an UP-swing vs a down-swing. */
  mirror?: boolean;
  /** Seconds visible (default 0.14; finisher cuts hang a touch longer). */
  life?: number;
}

export class SlashPool {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
  private scale0: number[] = [];
  private mirror: boolean[] = [];
  private tex: THREE.CanvasTexture;
  private geo: THREE.PlaneGeometry;
  private cursor = 0;

  constructor() {
    this.group = new THREE.Group();
    this.tex = slashTexture();
    this.geo = new THREE.PlaneGeometry(1.4, 1.4);
    for (let i = 0; i < SLASH_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.rotation.order = "YXZ";
      m.visible = false;
      m.renderOrder = 12;
      this.meshes.push(m);
      this.life.push(0);
      this.maxLife.push(0);
      this.scale0.push(1);
      this.mirror.push(false);
      this.group.add(m);
    }
  }

  spawn(x: number, y: number, z: number, facing: string, color: number, opts: SlashOpts = {}): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SLASH_COUNT;
    const m = this.meshes[i];
    m.position.set(x, y, z);
    m.rotation.z = (SLASH_ROLL[facing] ?? 0) + (opts.roll ?? 0);
    m.rotation.y = CAMERA_YAW;
    m.rotation.x = -CAMERA_TILT;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
    this.life[i] = opts.life ?? 0.14;
    this.maxLife[i] = this.life[i];
    this.scale0[i] = opts.scale ?? 1;
    this.mirror[i] = opts.mirror ?? false;
  }

  update(dt: number): void {
    for (let i = 0; i < SLASH_COUNT; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const t = this.life[i] / this.maxLife[i]; // 1 → 0
      const scale = (1.4 - 0.5 * t) * this.scale0[i]; // grows as it fades
      m.scale.set(scale, this.mirror[i] ? -scale : scale, scale);
      (m.material as THREE.MeshBasicMaterial).opacity = t;
    }
  }

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.meshes[0];
  }

  dispose(): void {
    this.tex.dispose();
    this.geo.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}

/**
 * Thunderbolt — a jagged additive polyline that whips down the strike line for
 * the Storm cards (see combat.fireBolt). Each bolt is drawn as two overlaid
 * STRANDS: a tight near-white core and a wider electric-blue glow, both
 * bloom-fed so the line reads as crackling lightning rather than a drawn edge.
 * The path is re-jittered per spawn (clean at both ends via a sine taper) and
 * the opacity flickers as it fades over BOLT_LIFE — cheap, no textures.
 */
// Pool size — 2 strands per bolt, and the Arcane Pulse nova forks a whole ring
// of them at once (8 radials × 2 strands), so the pool has to hold a full nova
// plus the per-victim bolts that follow the wave front.
