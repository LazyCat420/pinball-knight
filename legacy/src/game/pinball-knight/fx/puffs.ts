/**
 * SMOKE and STEAM — soft volumes that ERODE rather than fade.
 *
 * ── WHY A THIRD POOL AND NOT A FloorFxKind ───────────────────────────────────
 * A `FloorFxKind` is a ground disc that ticks status to whatever overlaps it.
 * Smoke rises and does nothing. Adding it there would put a no-op through the
 * overlap loop and, worse, spend a slot in the `FLOOR_FX_MAX` budget that fire
 * and the groove trail are already competing for.
 *
 * And not a single billboard either: dissipation needs many independent puffs
 * drifting apart, which is a particle problem.
 *
 * ── EROSION IS THE WHOLE DESIGN ──────────────────────────────────────────────
 * The obvious way to dissipate smoke is to fade its alpha. Under a 32-colour
 * palette snap that does NOT read as fading — a greying blob crosses from one
 * grey entry to the next and visibly POPS, two or three times, and then vanishes.
 * There are four usable greys; a smooth fade has nowhere to go.
 *
 * So alpha is a hard `step()` against a per-particle noise field, with the
 * threshold RISING over the puff's life. The blob eats itself from the edges
 * inward, breaking into holes and shreds. That reads as smoke dissipating, and it
 * reads correctly at four greys because the transition is in COVERAGE rather than
 * in brightness. Same reasoning as the fire silhouette being thresholded from its
 * noise instead of from a radial falloff.
 *
 * ── SMOKE vs STEAM ───────────────────────────────────────────────────────────
 * Steam is additive and pale, so its core crosses the pass's bloom threshold and
 * halos; smoke is normal-blended and dark, so it occludes. That single difference
 * is what makes them tell apart at a glance, and it is why they are two instances
 * of one class rather than one pool with a colour parameter.
 */
import * as THREE from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import { attribute, float, length, mix, mul, mx_fractal_noise_float, positionGeometry, saturate, step, vec3, vec4 } from "three/tsl";
import { PPU } from "../constants";
import { palLin } from "./color";

/** `aSize` is calibrated in render-target pixels, as the old gl_PointSize was. */
const PARTICLE_SCALE = 1 / PPU;

/**
 * Smoke: stone LIGHT → stone highlight → steel mid.
 *
 * Pale, not dark — and that is a correction, not a style preference. The first
 * version reached for "dirty greys" (stone dark 2, stone mid 3, steel dark 19)
 * because that is what smoke is. Those are the exact entries the Cold Crypt's
 * FLOOR AND WALLS are painted from, so the smoke was the colour of the thing it
 * was drifting in front of and rendered effectively invisible — a whole-frame
 * diff measured it changing 1.16% of channels while being impossible to find by
 * eye.
 *
 * Pale is also the physically honest choice here: smoke in a dark room is only
 * visible because it SCATTERS the light hitting it, and the only light down here
 * is torchlight. Dark smoke would be correct against a bright sky and is exactly
 * wrong against dark stone.
 */
const SMOKE_COLORS = [palLin(4), palLin(5), palLin(20)];
/** Steam: steel light → steel highlight → arcane light. Paler still, and it GLOWS. */
const STEAM_COLORS = [palLin(21), palLin(22), palLin(31)];

interface PuffData {
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  rise: Float32Array;
  drag: Float32Array;
  size0: Float32Array;
}

export class PuffPool {
  readonly points: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: SpriteNodeMaterial;
  private pos: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private alpha: THREE.InstancedBufferAttribute;
  /** 0 → 1 over the puff's life. Drives the erosion threshold in the shader. */
  private age: THREE.InstancedBufferAttribute;
  /** Per-puff noise offset, so no two erode into the same shape. */
  private seed: THREE.InstancedBufferAttribute;
  private d: PuffData;
  private cursor = 0;
  private readonly n: number;

  constructor(count: number, blending: THREE.Blending) {
    this.n = count;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.age = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    for (const a of [this.pos, this.col, this.size, this.alpha, this.age, this.seed]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    this.geo.setAttribute("aOffset", this.pos);
    this.geo.setAttribute("aColor", this.col);
    this.geo.setAttribute("aSize", this.size);
    this.geo.setAttribute("aAlpha", this.alpha);
    this.geo.setAttribute("aAge", this.age);
    this.geo.setAttribute("aSeed", this.seed);

    this.mat = new SpriteNodeMaterial({ transparent: true, blending, depthTest: true, depthWrite: false });

    /**
     * Wired EXACTLY like `ParticlePool`, and the reason is worth repeating here
     * rather than assuming the next reader finds it: `positionNode` is the
     * sprite's CENTRE and nothing else. `SpriteNodeMaterial` supplies the quad
     * corners itself, so adding `positionLocal` leaks the ±0.5 corner into the
     * centre in UNSCALED WORLD UNITS and every particle renders as a
     * ~1-world-unit slab regardless of `aSize`.
     */
    this.mat.positionNode = attribute<"vec3">("aOffset", "vec3");
    this.mat.scaleNode = mul(attribute<"float">("aSize", "float"), float(PARTICLE_SCALE));

    // ── THE EROSION ──────────────────────────────────────────────────────────
    /**
     * The quad-local coordinate comes from `positionGeometry`, NOT from `uv()`.
     *
     * That is not a style choice. `uv()` on a `SpriteNodeMaterial` produced alpha
     * 0 everywhere and the puffs rendered as nothing at all — no error, no
     * warning, and a whole-frame diff that looked healthy until it was compared
     * against a no-op control and turned out to be measuring torch flicker.
     *
     * `positionGeometry` is what `SpriteNodeMaterial` itself builds its quad from
     * (`alignedPosition = positionGeometry.xy`), so it is guaranteed to be present
     * and centred: a `PlaneGeometry(1,1)`'s corners are ±0.5, which makes
     * `length(xy)` the radius directly with no re-centring.
     */
    const pl = positionGeometry.xy;
    const age = attribute<"float">("aAge", "float");
    const seed = attribute<"float">("aSeed", "float");
    // Radial coverage: 1 at the centre, 0 at the rim. This is the MASK the noise
    // eats into, not the alpha itself.
    const fall = saturate(length(pl).mul(2.0).oneMinus());
    // Per-puff noise, offset by the seed so no two erode into the same shape.
    const n = mx_fractal_noise_float(vec3(pl.mul(6.0), seed.mul(31.0)), 3, 2.0, 0.5).mul(0.5).add(0.5);
    // The cut RISES with age: at birth almost everything survives; by the end
    // only the densest core does. The transition is in COVERAGE, not brightness,
    // which is exactly why it survives four greys where a fade would pop.
    const cut = mix(float(0.16), float(0.94), age);
    const puffAlpha = step(cut, fall.mul(n)).mul(attribute<"float">("aAlpha", "float"));

    this.mat.colorNode = vec4(attribute<"vec3">("aColor", "vec3"), puffAlpha);

    this.points = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.points.frustumCulled = false;

    this.d = {
      vx: new Float32Array(count),
      vy: new Float32Array(count),
      vz: new Float32Array(count),
      life: new Float32Array(count),
      maxLife: new Float32Array(count),
      rise: new Float32Array(count),
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
    rise: number,
    drag: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos.setXYZ(i, x, y, z);
    this.col.setXYZ(i, color[0]!, color[1]!, color[2]!);
    this.size.setX(i, size);
    this.alpha.setX(i, 1);
    this.age.setX(i, 0);
    this.seed.setX(i, Math.random() * 100);
    const d = this.d;
    d.vx[i] = vx;
    d.vy[i] = vy;
    d.vz[i] = vz;
    d.life[i] = life;
    d.maxLife[i] = life;
    d.rise[i] = rise;
    d.drag[i] = drag;
    d.size0[i] = size;
  }

  update(dt: number): void {
    const d = this.d;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (d.life[i]! <= 0) continue;
      any = true;
      d.life[i]! -= dt;
      if (d.life[i]! <= 0) {
        this.alpha.setX(i, 0);
        this.size.setX(i, 0);
        continue;
      }
      const k = Math.max(0, 1 - d.drag[i]! * dt);
      // RISE, not gravity: these are lighter than air. Kept as its own field
      // rather than a negative gravity so the sign cannot be misread at a glance.
      d.vy[i]! += d.rise[i]! * dt;
      d.vx[i]! *= k;
      d.vz[i]! *= k;
      this.pos.setXYZ(
        i,
        this.pos.getX(i) + d.vx[i]! * dt,
        this.pos.getY(i) + d.vy[i]! * dt,
        this.pos.getZ(i) + d.vz[i]! * dt,
      );
      const t = d.life[i]! / d.maxLife[i]!; // 1 → 0
      this.age.setX(i, 1 - t);
      // Alpha stays FULL for most of the life — the erosion does the dissipating.
      // A simultaneous fade would put the pop back that the erosion exists to
      // avoid; this only takes the last 25% off so a puff does not vanish mid-shape.
      this.alpha.setX(i, Math.min(1, t * 4));
      // Smoke EXPANDS as it rises, unlike sparks which shrink as they die.
      this.size.setX(i, d.size0[i]! * (1 + 1.6 * (1 - t)));
    }
    if (any) {
      this.pos.needsUpdate = true;
      this.col.needsUpdate = true;
      this.size.needsUpdate = true;
      this.alpha.needsUpdate = true;
      this.age.needsUpdate = true;
      this.seed.needsUpdate = true;
    }
  }

  /** Live puff count — for tests and the debug panel. */
  liveCount(): number {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (this.d.life[i]! > 0) n++;
    return n;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** The two flavours, and their physics. */
/**
 * Sizes are in RENDER-TARGET pixels (the old `gl_PointSize` units), scaled by
 * 1/PPU into world space — so the number is roughly the puff's diameter on screen.
 *
 * MUCH larger than a spark or an ember, and that was calibrated rather than
 * guessed. A spark is a point of light and reads fine at 3-5px. A puff's alpha is
 * a `step()` against noise, so it needs enough texels for the HOLES to be legible:
 * at ~20px the erosion leaves scattered single pixels that read as dither noise
 * and disappear into the floor entirely. The first version shipped at 16-26 and
 * was invisible — a whole-frame diff put it BELOW the ambient torch flicker, and
 * only a deliberately absurd 200px test proved the pipeline worked at all.
 */
export const SMOKE = { colors: SMOKE_COLORS, rise: 0.42, drag: 1.6, life: [1.4, 2.6] as const, size: [44, 74] as const };
export const STEAM = { colors: STEAM_COLORS, rise: 0.95, drag: 2.4, life: [0.6, 1.2] as const, size: [34, 58] as const };

export function makeSmokePool(count = 160): PuffPool {
  return new PuffPool(count, THREE.NormalBlending);
}

export function makeSteamPool(count = 120): PuffPool {
  // Additive so the pale core crosses the bloom threshold and halos — the single
  // cue that separates steam from smoke at a glance.
  return new PuffPool(count, THREE.AdditiveBlending);
}
