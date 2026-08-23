/**
 * The shared particle substrate — sparks, blood, embers, motes, dust, bursts.
 *
 * Extracted from the 1700-line `vfx.ts` when it moved into `fx/`. Behaviour is
 * unchanged — only the file boundary is new, and the shared constants it used to
 * hold privately now live in `./shared.ts` so eight modules cannot drift apart.
 */
import * as THREE from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import { attribute, float, mul, vec4 } from "three/tsl";
import { PARTICLE_SCALE } from "./shared";


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

export class ParticlePool {
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
  /**
   * Particles still alive after the last `update()`. Free — the update loop
   * already visits every slot, so this is a counter on a walk that happens
   * anyway, not a second scan. The profiler needs it to tell "the pool cost
   * 0.2ms" apart from "the pool cost 0.2ms with nothing in it".
   */
  live = 0;

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
    // Colour is spawn-only, so its upload is flagged HERE rather than in
    // update(). Flagging it per frame there re-uploaded the whole 500-slot
    // colour buffer every frame to send bytes that had not changed.
    this.col.needsUpdate = true;
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
    let live = 0;
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
      live++;
    }
    this.live = live;
    if (any) {
      // Only the attributes this loop actually writes. `col` is spawn-only and
      // flags itself there.
      this.pos.needsUpdate = true;
      this.size.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
