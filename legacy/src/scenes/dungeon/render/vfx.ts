/**
 * VFX — the "juice" layer. Impact sparks, blood/gib bursts, torch embers,
 * footstep dust and melee slash arcs.
 *
 * Everything here is drawn INTO the scene (not as a DOM/HUD overlay), so it
 * rides the same pipeline as the world: it gets pixelated, palette-quantized
 * and — crucially — bloomed. Bright additive sparks and embers bleed a warm
 * halo for free, which is most of what sells the "modern pixel" look.
 *
 * COLOUR: the scene render target is LINEAR (see pixel-pass.ts), so particle
 * colours are stored LINEAR here (sRGB palette → linear via toLinear) to match
 * the rest of the scene before the shader's linear→sRGB + quantize.
 *
 * Two particle pools with different blend modes share one implementation:
 *   - additive: sparks, embers, arcane — glow that adds to what's behind it
 *   - alpha:    blood, dust — opaque-ish matter that sits on the scene
 * Both are fixed-size ring buffers; a spent particle just goes to size 0.
 */
import * as THREE from "three";
import { PALETTE_HEX } from "./palette";
import { CAMERA_YAW, CAMERA_TILT } from "../constants";
import { DamageTextPool, type DamageTextKind } from "./damage-text";

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** sRGB palette hex → linear [r,g,b] for the linear scene buffer. */
function linColor(hex: number): [number, number, number] {
  return [
    toLinear(((hex >> 16) & 0xff) / 255),
    toLinear(((hex >> 8) & 0xff) / 255),
    toLinear((hex & 0xff) / 255),
  ];
}

// Handy linear palette picks.
const C_SPARK = linColor(0xfff3c8); // flame core — near white, blooms hard
const C_SPARK2 = linColor(0xffd98a); // flame light
const C_EMBER = linColor(0xf0a63c); // flame
const C_BLOOD_G = [linColor(0x5f8a4f), linColor(0x3d5c3a), linColor(0x8fc46b)]; // rot green
const C_BLOOD_R = [linColor(0xa83244), linColor(0x6b1f2a), linColor(0xd95763)]; // blood red
const C_DUST = linColor(0x6b7688); // stone light

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize;
}
`;

// Square particles — the pixel look wants hard little squares, not soft dots.
const PARTICLE_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
varying vec3 vColor;
void main() {
  if (vAlpha <= 0.001) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

interface PoolData {
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  gravity: Float32Array;
  drag: Float32Array;
  size0: Float32Array;
}

class ParticlePool {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private alpha: THREE.BufferAttribute;
  private d: PoolData;
  private cursor = 0;
  private readonly n: number;

  constructor(count: number, blending: THREE.Blending) {
    this.n = count;
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.alpha = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    this.size.setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.pos);
    this.geo.setAttribute("aColor", this.col);
    this.geo.setAttribute("aSize", this.size);
    this.geo.setAttribute("aAlpha", this.alpha);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      blending,
      depthTest: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;

    this.d = {
      vx: new Float32Array(count),
      vy: new Float32Array(count),
      vz: new Float32Array(count),
      life: new Float32Array(count),
      maxLife: new Float32Array(count),
      gravity: new Float32Array(count),
      drag: new Float32Array(count),
      size0: new Float32Array(count),
    };
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: readonly number[],
    size: number,
    life: number,
    gravity: number,
    drag: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos.setXYZ(i, x, y, z);
    this.col.setXYZ(i, color[0], color[1], color[2]);
    this.size.setX(i, size);
    this.alpha.setX(i, 1);
    const d = this.d;
    d.vx[i] = vx;
    d.vy[i] = vy;
    d.vz[i] = vz;
    d.life[i] = life;
    d.maxLife[i] = life;
    d.gravity[i] = gravity;
    d.drag[i] = drag;
    d.size0[i] = size;
  }

  update(dt: number): void {
    const d = this.d;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (d.life[i] <= 0) continue;
      any = true;
      d.life[i] -= dt;
      if (d.life[i] <= 0) {
        this.alpha.setX(i, 0);
        this.size.setX(i, 0);
        continue;
      }
      const k = Math.max(0, 1 - d.drag[i] * dt);
      d.vy[i] -= d.gravity[i] * dt;
      d.vx[i] *= k;
      d.vz[i] *= k;
      this.pos.setXYZ(
        i,
        this.pos.getX(i) + d.vx[i] * dt,
        this.pos.getY(i) + d.vy[i] * dt,
        this.pos.getZ(i) + d.vz[i] * dt,
      );
      const t = d.life[i] / d.maxLife[i]; // 1 → 0
      this.alpha.setX(i, t);
      this.size.setX(i, d.size0[i] * (0.35 + 0.65 * t)); // shrink as it dies
    }
    if (any) {
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
      this.size.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Slash arc — a short-lived crescent quad that sweeps in the swing direction.
 * Billboarded to the fixed iso camera (like the actor sprites) and rolled in
 * screen space to point along the facing.
 */
const SLASH_COUNT = 6;
/** Screen-plane roll (rotation.z, applied first under YXZ) per facing. */
const SLASH_ROLL: Record<string, number> = {
  E: 0,
  W: Math.PI,
  S: -Math.PI / 2,
  N: Math.PI / 2,
};

function slashTexture(): THREE.CanvasTexture {
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

class SlashPool {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
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
      this.group.add(m);
    }
  }

  spawn(x: number, y: number, z: number, facing: string, color: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SLASH_COUNT;
    const m = this.meshes[i];
    m.position.set(x, y, z);
    m.rotation.z = SLASH_ROLL[facing] ?? 0;
    m.rotation.y = CAMERA_YAW;
    m.rotation.x = -CAMERA_TILT;
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    m.visible = true;
    this.life[i] = 0.14;
    this.maxLife[i] = 0.14;
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
      const scale = 1.4 - 0.5 * t; // grows as it fades
      m.scale.setScalar(scale);
      (m.material as THREE.MeshBasicMaterial).opacity = t;
    }
  }

  dispose(): void {
    this.tex.dispose();
    this.geo.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}

export interface VfxSystem {
  /** Bright sparks flying off an impact point. */
  sparks(x: number, y: number, z: number, dirx: number, dirz: number, count?: number): void;
  /** A wet burst of gore in a palette colour family (green for rot, red for blood). */
  blood(x: number, y: number, z: number, kind: "green" | "red", count?: number): void;
  /** A single rising ember (emit a few per second from torches). */
  ember(x: number, y: number, z: number): void;
  /** A dim drifting dust mote — ambient atmosphere, not an event. */
  mote(x: number, y: number, z: number): void;
  /** A puff of floor dust (footsteps, landings). */
  dust(x: number, y: number, z: number): void;
  /** A melee slash crescent in the facing direction. */
  slash(x: number, y: number, z: number, facing: string, color: number): void;
  /**
   * A fading AFTERIMAGE of an actor's billboard — the speed-aura ghost. Clones
   * the source mesh's transform and SHARES its geometry + texture (zero GPU
   * re-uploads; the ghost mirrors the actor's live frame, which reads fine for
   * a trail), with its own tinted, fading material. `tint` multiplies the art.
   */
  ghost(src: THREE.Mesh, tint: number, life?: number, opacity?: number): void;
  /**
   * A floating damage number rising from the point of impact. `kind` picks the
   * read: "out"/"crit" for damage dealt, "in" for damage taken. See
   * render/damage-text.ts.
   */
  damage(x: number, y: number, z: number, amount: number, kind: DamageTextKind): void;
  update(dt: number): void;
  dispose(): void;
}

/** Max live afterimage ghosts — enough for a rich trail, bounded for the GPU. */
const GHOST_CAP = 14;

interface Ghost {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  o0: number;
}

export function createVfx(scene: THREE.Scene): VfxSystem {
  const additive = new ParticlePool(500, THREE.AdditiveBlending);
  const alpha = new ParticlePool(400, THREE.NormalBlending);
  const slashes = new SlashPool();
  const dmgText = new DamageTextPool();
  const ghosts: Ghost[] = [];
  scene.add(additive.points);
  scene.add(alpha.points);
  scene.add(slashes.group);
  scene.add(dmgText.group);

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  return {
    sparks(x, y, z, dirx, dirz, count = 10) {
      const d = Math.hypot(dirx, dirz) || 1;
      const nx = dirx / d;
      const nz = dirz / d;
      for (let i = 0; i < count; i++) {
        // Mostly along the hit direction, with spread and an upward pop.
        const spread = rnd(-0.7, 0.7);
        const sp = rnd(2.5, 6.5);
        const vx = (nx * Math.cos(spread) - nz * Math.sin(spread)) * sp;
        const vz = (nx * Math.sin(spread) + nz * Math.cos(spread)) * sp;
        additive.spawn(
          x, y, z,
          vx, rnd(1.5, 4.5), vz,
          Math.random() < 0.5 ? C_SPARK : C_SPARK2,
          rnd(3, 6), rnd(0.18, 0.4), 14, 3,
        );
      }
    },
    blood(x, y, z, kind, count = 12) {
      const pal = kind === "green" ? C_BLOOD_G : C_BLOOD_R;
      for (let i = 0; i < count; i++) {
        alpha.spawn(
          x, y, z,
          rnd(-3.5, 3.5), rnd(2, 6), rnd(-3.5, 3.5),
          pal[(Math.random() * pal.length) | 0],
          rnd(3, 7), rnd(0.35, 0.75), 16, 1.5,
        );
      }
    },
    ember(x, y, z) {
      additive.spawn(
        x + rnd(-0.08, 0.08), y, z + rnd(-0.08, 0.08),
        rnd(-0.25, 0.25), rnd(0.6, 1.3), rnd(-0.25, 0.25),
        C_EMBER, rnd(2, 4), rnd(0.6, 1.2), -0.6, 0.6, // negative gravity → floats UP
      );
    },
    mote(x, y, z) {
      // barely-there, near-weightless, long-lived — atmosphere, not an event
      additive.spawn(
        x, y, z,
        rnd(-0.12, 0.12), rnd(-0.05, 0.08), rnd(-0.12, 0.12),
        C_DUST, rnd(1.5, 2.5), rnd(1.6, 3.2), -0.01, 0.2,
      );
    },
    dust(x, y, z) {
      for (let i = 0; i < 4; i++) {
        alpha.spawn(
          x, y, z,
          rnd(-1, 1), rnd(0.3, 1), rnd(-1, 1),
          C_DUST, rnd(3, 5), rnd(0.25, 0.5), 3, 2,
        );
      }
    },
    slash(x, y, z, facing, color) {
      slashes.spawn(x, y, z, facing, color);
    },
    ghost(src, tint, life = 0.32, opacity = 0.4) {
      if (ghosts.length >= GHOST_CAP) return; // aura, not a smoke machine
      const srcMat = src.material as THREE.MeshBasicMaterial;
      const mat = new THREE.MeshBasicMaterial({
        map: srcMat.map, // SHARED texture — offset updates keep the ghost on the live frame
        transparent: true,
        opacity,
        alphaTest: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: tint,
      });
      const mesh = new THREE.Mesh(src.geometry, mat); // shared geometry — never disposed here
      mesh.position.copy(src.position);
      mesh.quaternion.copy(src.quaternion);
      mesh.scale.copy(src.scale);
      mesh.renderOrder = 9; // just under the live actor
      scene.add(mesh);
      ghosts.push({ mesh, mat, t: 0, life, o0: opacity });
    },
    damage(x, y, z, amount, kind) {
      dmgText.spawn(x, y, z, amount, kind);
    },
    update(dt) {
      additive.update(dt);
      alpha.update(dt);
      slashes.update(dt);
      dmgText.update(dt);
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i];
        g.t += dt;
        if (g.t >= g.life) {
          scene.remove(g.mesh);
          g.mat.dispose(); // material only — geometry/texture belong to the actor
          ghosts.splice(i, 1);
        } else {
          g.mat.opacity = g.o0 * (1 - g.t / g.life);
        }
      }
    },
    dispose() {
      scene.remove(additive.points);
      scene.remove(alpha.points);
      scene.remove(slashes.group);
      scene.remove(dmgText.group);
      additive.dispose();
      alpha.dispose();
      slashes.dispose();
      dmgText.dispose();
      for (const g of ghosts) {
        scene.remove(g.mesh);
        g.mat.dispose();
      }
      ghosts.length = 0;
    },
  };
}
