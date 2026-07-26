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
// SpriteNodeMaterial lives in three/webgpu, not three — it is a node material.
import { SpriteNodeMaterial } from "three/webgpu";
import { add, attribute, float, mul, positionLocal, vec4 } from "three/tsl";
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

/**
 * PARTICLES ARE QUADS, NOT `THREE.Points` — and that is forced, not stylistic.
 *
 * The old GLSL set `gl_PointSize = aSize`. There is no equivalent on the WebGPU
 * path: `PointsNodeMaterial.setupVertex()` reads
 *
 *   if ( builder.object.isPoints ) return super.setupVertex( builder );
 *   else return this.setupVertexSprite( builder );
 *
 * so ANY `THREE.Points` object skips sprite/quad expansion and every particle
 * rasterises as a single pixel. Measured: 64 particles → exactly 64 lit pixels,
 * and `sizeAttenuation` / `sizeNode` / `SpriteNodeMaterial` make no difference,
 * because the branch is on the OBJECT, not the material.
 *
 * An `InstancedMesh` of unit quads takes the sprite path, where `scaleNode`
 * applies. Two properties of this port matter:
 *
 *  - POSITION RIDES AN INSTANCED ATTRIBUTE (`aOffset`), not `instanceMatrix`.
 *    That keeps `spawn()`/`update()` writing flat Float32Arrays exactly as they
 *    always have — no per-particle Matrix4 composition on the CPU every frame.
 *  - The quad is UNIT-SIZED and scaled in WORLD units, so the edges stay hard.
 *    Verified by pixel readback: 0 partially-transparent pixels, i.e. no
 *    anti-aliased rim. That is the same hard-square look the old fragment
 *    shader gave, which the palette quantiser depends on.
 */
const PARTICLE_SCALE = 0.05;

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
  /** Kept named `points` — the whole VfxSystem adds/removes this by that name. */
  readonly points: THREE.InstancedMesh;
  private geo: THREE.InstancedBufferGeometry | THREE.BufferGeometry;
  private mat: SpriteNodeMaterial;
  private pos: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private alpha: THREE.InstancedBufferAttribute;
  private d: PoolData;
  private cursor = 0;
  private readonly n: number;

  constructor(count: number, blending: THREE.Blending) {
    this.n = count;
    // A unit quad, instanced per particle. PlaneGeometry(1,1) is centred, so
    // the offset attribute below places the particle's CENTRE — same semantics
    // the old `position` attribute had for a point sprite.
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    this.size.setUsage(THREE.DynamicDrawUsage);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    // NOT "position" — that name belongs to the quad's own 4 vertices. The
    // per-particle centre is a separate instanced attribute added to it.
    this.geo.setAttribute("aOffset", this.pos);
    this.geo.setAttribute("aColor", this.col);
    this.geo.setAttribute("aSize", this.size);
    this.geo.setAttribute("aAlpha", this.alpha);

    this.mat = new SpriteNodeMaterial({
      transparent: true,
      blending,
      depthTest: true,
      depthWrite: false,
    });
    // Billboarded quad + per-instance offset, scale and colour. `aAlpha` going
    // to 0 is what retires a particle (the pool sets size 0 too), which
    // reproduces the old `if (vAlpha <= 0.001) discard;`.
    this.mat.positionNode = add(positionLocal, attribute<"vec3">("aOffset", "vec3"));
    this.mat.scaleNode = mul(attribute<"float">("aSize", "float"), float(PARTICLE_SCALE));
    this.mat.colorNode = vec4(attribute<"vec3">("aColor", "vec3"), attribute<"float">("aAlpha", "float"));

    this.points = new THREE.InstancedMesh(this.geo, this.mat, count);
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
const SLASH_COUNT = 10; // combo steps stack cuts (X-cut + finisher volley overlap)
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

class SlashPool {
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
const BOLT_LINES = 40;
const BOLT_POINTS = 16; // vertices per jagged strand
const BOLT_LIFE = 0.22; // seconds a bolt stays visible
const BOLT_CORE_HEX = 0xdff3ff; // tight strand — near white
const BOLT_GLOW_HEX = 0x5eb0ff; // wide strand — electric blue

class BoltPool {
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

  dispose(): void {
    for (const l of this.lines) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
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

class RingPool {
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

class SigilPool {
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

  dispose(): void {
    this.geo.dispose();
    this.tex.dispose();
    for (const m of this.meshes) (m.material as THREE.Material).dispose();
  }
}

/**
 * ORBITING BLADES — Blade Storm, made visible.
 *
 * Every other pool here fires an EVENT that then decays. A buff that lasts five
 * seconds is a STATE, so this pool is keep-alive instead: `refresh()` places the
 * blades for this frame and re-arms a short hold; `update()` hides them once the
 * caller stops refreshing (i.e. the buff lapsed) — no teardown call to forget,
 * and a dropped frame just leaves the ring up a beat longer.
 *
 * The blades are the SLASH crescent texture on billboards, rolled in screen
 * space so each one leans along its own tangent — the same trick the melee
 * slash uses to aim a flat quad in an iso view.
 */
const BLADE_MAX = 6;
const BLADE_HOLD = 0.12; // seconds a placed blade survives without a refresh

class BladeRing {
  readonly group: THREE.Group;
  private meshes: THREE.Mesh[] = [];
  private geo: THREE.PlaneGeometry;
  private hold = 0;

  constructor(tex: THREE.CanvasTexture) {
    this.group = new THREE.Group();
    this.geo = new THREE.PlaneGeometry(0.85, 0.85);
    for (let i = 0; i < BLADE_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        opacity: 0.85,
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
    const n = Math.min(count, BLADE_MAX);
    for (let i = 0; i < BLADE_MAX; i++) {
      const m = this.meshes[i];
      if (i >= n) {
        m.visible = false;
        continue;
      }
      const a = angle + (i / n) * Math.PI * 2;
      m.position.set(x + Math.cos(a) * radius, y, z + Math.sin(a) * radius);
      // Lean the crescent along the orbit tangent (screen-space roll), then
      // billboard it to the fixed iso camera like every other flat FX quad.
      m.rotation.z = -a - Math.PI / 2;
      m.rotation.y = CAMERA_YAW;
      m.rotation.x = -CAMERA_TILT;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      // A touch of per-blade flicker so the ring shimmers instead of reading as
      // a rigid decal spinning at a constant brightness.
      mat.opacity = 0.7 + Math.random() * 0.3;
      m.scale.setScalar(0.9 + Math.random() * 0.2);
      m.visible = true;
    }
  }

  update(dt: number): void {
    if (this.hold <= 0) return;
    this.hold -= dt;
    if (this.hold > 0) return;
    for (const m of this.meshes) m.visible = false;
  }

  dispose(): void {
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
  /**
   * A TINTED radial burst — additive glow particles flying outward from a
   * point. The magic/material cousin of sparks(): the caller picks the colour,
   * and a fraction of white-hot cores pushes it over the bloom threshold so the
   * burst glows. Use for transformations, elemental pops, material emissions.
   */
  burst(x: number, y: number, z: number, color: number, count?: number, speed?: number): void;
  /** A melee slash crescent in the facing direction. `opts` restyles it per
   *  combo step (roll/scale/mirror/life) — see SlashOpts. */
  slash(x: number, y: number, z: number, facing: string, color: number, opts?: SlashOpts): void;
  /** A jagged thunderbolt running `length` blocks along (dirx,dirz) from (x,y,z). */
  bolt(x: number, y: number, z: number, dirx: number, dirz: number, length: number): void;
  /**
   * A flat shockwave ring expanding along the floor to `maxRadius` over
   * `duration` seconds (opacity bells with sin(π·t)). `delay` holds it hidden
   * first — the Arcane Pulse purple chaser rides 70ms behind the white core.
   */
  ring(x: number, z: number, color: number, maxRadius: number, duration: number, opts?: RingOpts): void;
  /**
   * A RUNE SIGIL struck onto the floor at (x,z): a summoning glyph that punches
   * in, counter-rotates at `spin` rad/s and burns away over `life`. What turns
   * "an expanding circle" into "a spell being cast".
   */
  sigil(x: number, z: number, color: number, radius: number, life: number, spin: number): void;
  /**
   * ORBITING BLADES — the Blade Storm ring made visible. A KEEP-ALIVE call:
   * drive it every frame while the buff is up (position + the ring's current
   * phase angle) and stop calling it to put the blades away. Unlike every other
   * primitive here it is a sustained state, not an event, because the effect it
   * draws is a sustained state.
   */
  blades(x: number, y: number, z: number, angle: number, count: number, radius: number, color: number): void;
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
  const bolts = new BoltPool();
  const rings = new RingPool();
  const bladeRing = new BladeRing(slashTexture());
  const sigils = new SigilPool();
  const dmgText = new DamageTextPool();
  const ghosts: Ghost[] = [];
  scene.add(additive.points);
  scene.add(alpha.points);
  scene.add(slashes.group);
  scene.add(bolts.group);
  scene.add(rings.group);
  scene.add(bladeRing.group);
  scene.add(sigils.group);
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
    burst(x, y, z, color, count = 14, speed = 4) {
      const tint = linColor(color);
      for (let i = 0; i < count; i++) {
        // An even radial fan with jitter, a gentle upward pop, quick settle.
        const a = (i / count) * Math.PI * 2 + rnd(-0.35, 0.35);
        const sp = speed * rnd(0.45, 1.15);
        additive.spawn(
          x, y, z,
          Math.cos(a) * sp, rnd(0.8, 2.8), Math.sin(a) * sp,
          Math.random() < 0.35 ? C_SPARK : tint, // white-hot cores → bloom
          rnd(3, 6), rnd(0.25, 0.55), 7, 2.5,
        );
      }
    },
    slash(x, y, z, facing, color, opts) {
      slashes.spawn(x, y, z, facing, color, opts);
    },
    bolt(x, y, z, dirx, dirz, length) {
      bolts.spawn(x, y, z, dirx, dirz, length);
    },
    ring(x, z, color, maxRadius, duration, opts) {
      rings.spawn(x, z, color, maxRadius, duration, opts);
    },
    sigil(x, z, color, radius, life, spin) {
      sigils.spawn(x, z, color, radius, life, spin);
    },
    blades(x, y, z, angle, count, radius, color) {
      bladeRing.refresh(x, y, z, angle, count, radius, color);
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
      bolts.update(dt);
      rings.update(dt);
      bladeRing.update(dt);
      sigils.update(dt);
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
      scene.remove(bolts.group);
      scene.remove(rings.group);
      scene.remove(bladeRing.group);
      scene.remove(sigils.group);
      scene.remove(dmgText.group);
      additive.dispose();
      alpha.dispose();
      slashes.dispose();
      bolts.dispose();
      rings.dispose();
      bladeRing.dispose();
      sigils.dispose();
      dmgText.dispose();
      for (const g of ghosts) {
        scene.remove(g.mesh);
        g.mat.dispose();
      }
      ghosts.length = 0;
    },
  };
}
