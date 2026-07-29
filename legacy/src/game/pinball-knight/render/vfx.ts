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
import { attribute, float, mul, vec4 } from "three/tsl";
import { PALETTE_HEX } from "./palette";
import { CAMERA_YAW, CAMERA_TILT, PPU } from "../constants";
import { DamageTextPool, type DamageTextKind } from "../engine/render/damage-text";

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
// aSize is calibrated in RENDER-TARGET PIXELS — that is what `gl_PointSize =
// aSize` meant, and every spawn call in this file still passes those numbers.
// The quad is scaled in WORLD units, and the ortho camera maps 1 world unit to
// PPU pixels, so pixels → world is a divide by PPU. (0.05 here — a leftover
// from the spike — made every ember 3.2x too big; overlapping torch streams
// rendered as giant translucent slabs.)
const PARTICLE_SCALE = 1 / PPU;

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
    //
    // positionNode is the sprite's CENTER, nothing else. SpriteNodeMaterial
    // supplies the quad corners itself (`alignedPosition = positionGeometry.xy`
    // scaled by scaleNode, added in view space) — its own doc comment says
    // `material.positionNode = instancedBufferAttribute(...)`. Adding
    // positionLocal here leaks the ±0.5 corner into the centre in UNSCALED
    // world units, which rendered every particle as a ~1-world-unit slab no
    // matter what aSize said.
    this.mat.positionNode = attribute<"vec3">("aOffset", "vec3");
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
 * Ring-buffer capacity. MEASURED, not guessed: the forms push one point per
 * physics substep — 3 per frame at 60Hz, so 180/s. At 64 the buffer wrapped in
 * 0.36s, which is SHORTER than TRAIL_LIFE, so points always died by being
 * overwritten and the age check never ran. TRAIL_LIFE was decorative and the
 * trail was quietly capacity-bound at a length nobody chose.
 *
 * 96 puts the binding constraint back on time (180 × 0.45 = 81 points), so the
 * tuning knob below is the one that actually controls the trail's length.
 */
const TRAIL_POINTS = 96;
const TRAIL_LIFE = 0.45; // DEFAULT seconds a point survives — the trail's LENGTH
const TRAIL_OFFSET = 0.09; // perpendicular offset of the flanking strands

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
  push(x: number, y: number, z: number, color: number, life: number = TRAIL_LIFE): void {
    this.color.setHex(color);
    this.px[this.head] = x;
    this.py[this.head] = y;
    this.pz[this.head] = z;
    this.age[this.head] = 0;
    this.life[this.head] = life;
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
        // Perpendicular to the local path direction, on the ground plane.
        const j = live[Math.min(k + 1, live.length - 1)];
        const h = live[Math.max(k - 1, 0)];
        const dx = this.px[j] - this.px[h];
        const dz = this.pz[j] - this.pz[h];
        const d = Math.hypot(dx, dz) || 1;
        const ox = (-dz / d) * TRAIL_OFFSET * side;
        const oz = (dx / d) * TRAIL_OFFSET * side;
        pos.setXYZ(n, this.px[i] + ox, this.py[i], this.pz[i] + oz);
        // Fade toward BLACK along the tail — under additive blending that is
        // the fade. `t` is 1 at the head (newest) and 0 at the tail.
        const t = 1 - this.age[i] / this.life[i];
        const f = t * t * (s === 0 ? 1 : 0.55);
        if (s === 0) {
          // The core burns out to white at the head so the beam has a hot line
          // through it rather than being one flat colour.
          col.setXYZ(n, Math.min(1, this.color.r + t * 0.6) * f, Math.min(1, this.color.g + t * 0.6) * f, Math.min(1, this.color.b + t * 0.6) * f);
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

  /** See `warmupReveal` — slot 0 stands in for the pool at prewarm time. */
  warmupTarget(): THREE.Object3D {
    return this.meshes[0];
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
   * Append a point to the TRAIL RIBBON — the glowing streak a ricochet form
   * drags behind it. A KEEP-ALIVE call like `blades`: push a point per physics
   * substep while the form runs, stop pushing and the tail fades out by itself.
   *
   * This is what carries the form's DIRECTION. Its sprite is a camera-facing
   * billboard and cannot point anywhere, so the path has to be drawn, not
   * implied by the art.
   *
   * `life` sets how long THIS point survives, i.e. how long a tail the form
   * drags — the bolt wants a long ribbon, the laser a short stub behind a dot.
   */
  trail(x: number, y: number, z: number, color: number, life?: number): void;
  /**
   * Stamp a LASER MARK — one crossed spark at a path point, its long arm along
   * (dirx, dirz). Call it at the kinks, the bounces and a fixed step of
   * distance, and the marks left behind read as a rapid zigzag chain of laser
   * crosses rather than one long drawn beam. See `LaserMarkField`.
   */
  laserMark(x: number, y: number, z: number, dirx: number, dirz: number, color: number, size?: number): void;
  /** Drop the trail AND its marks instantly — entering a form must not inherit
   *  the last one's tail. */
  trailClear(): void;
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
  /**
   * Make one representative of every pooled effect briefly compilable, and
   * return the closure that puts them back.
   *
   * WHY. `Renderer.compileAsync` walks `_projectObject`, which returns on
   * `object.visible === false` (three: common/Renderer.js) and frustum-tests
   * meshes. Every pool here builds its slots INVISIBLE, so the descent-screen
   * prewarm — which does reach these groups, they are scene children — skipped
   * all of them, and the first slash / bolt / ring / blade / sigil / damage
   * number of a run compiled cold in the middle of a fight.
   *
   * Position is deliberately untouched: `frustumCulled = false` skips the
   * frustum test outright, so where the proxy sits is irrelevant, and not
   * moving pool slots keeps this free of side effects on live effects.
   *
   * Pipelines are cached by material CONTENT, so one slot warms all of them.
   */
  warmupReveal(): () => void;
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
  const trail = new TrailRibbon();
  const marks = new LaserMarkField();
  const rings = new RingPool();
  const bladeRing = new BladeRing(slashTexture());
  const sigils = new SigilPool();
  const dmgText = new DamageTextPool();
  const ghosts: Ghost[] = [];
  // The dash afterimage builds its material at spawn time (see `ghost` below),
  // so the prewarm can never have seen one — the first dash of a run paid the
  // compile. This hidden stand-in carries the SAME descriptor (map present,
  // alphaTest, transparent, DoubleSide, depthWrite off) on a 1×1 dummy
  // texture; the pipeline key is content-based, so warming it warms every real
  // ghost regardless of which actor sheet they end up sampling.
  const ghostProtoTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  ghostProtoTex.needsUpdate = true;
  const ghostProto = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: ghostProtoTex,
      transparent: true,
      opacity: 0.4,
      alphaTest: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ghostProto.visible = false;
  scene.add(additive.points);
  scene.add(alpha.points);
  scene.add(slashes.group);
  scene.add(bolts.group);
  scene.add(trail.group);
  scene.add(marks.group);
  scene.add(rings.group);
  scene.add(bladeRing.group);
  scene.add(sigils.group);
  scene.add(dmgText.group);
  scene.add(ghostProto);

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
    trail(x, y, z, color, life) {
      trail.push(x, y, z, color, life);
    },
    laserMark(x, y, z, dirx, dirz, color, size = 0.42) {
      marks.spawn(x, y, z, dirx, dirz, color, size);
    },
    trailClear() {
      trail.clear();
      marks.clear();
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
    warmupReveal() {
      const targets: THREE.Object3D[] = [
        slashes.warmupTarget(),
        bolts.warmupTarget(),
        trail.warmupTarget(),
        marks.warmupTarget(),
        rings.warmupTarget(),
        bladeRing.warmupTarget(),
        sigils.warmupTarget(),
        dmgText.warmupTarget(),
        ghostProto,
      ];
      // Save the REAL prior flags rather than assuming they were all
      // (false, true): BoltPool ships frustumCulled already off, and a restore
      // that hardcodes the default would silently re-enable culling on it.
      const saved = targets.map((o) => ({ o, visible: o.visible, frustumCulled: o.frustumCulled }));
      for (const o of targets) {
        o.visible = true;
        o.frustumCulled = false;
      }
      return () => {
        for (const s of saved) {
          s.o.visible = s.visible;
          s.o.frustumCulled = s.frustumCulled;
        }
      };
    },
    update(dt) {
      additive.update(dt);
      alpha.update(dt);
      slashes.update(dt);
      bolts.update(dt);
      trail.update(dt);
      marks.update(dt);
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
      scene.remove(trail.group);
      scene.remove(marks.group);
      scene.remove(rings.group);
      scene.remove(bladeRing.group);
      scene.remove(sigils.group);
      scene.remove(dmgText.group);
      scene.remove(ghostProto);
      ghostProto.geometry.dispose();
      (ghostProto.material as THREE.Material).dispose();
      ghostProtoTex.dispose();
      trail.dispose();
      marks.dispose();
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
