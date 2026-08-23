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
import { PALETTE_HEX } from "../render/palette";
import { CAMERA_YAW, CAMERA_TILT } from "../constants";
import { DamageTextPool, type DamageTextKind } from "../engine/render/damage-text";
import { profBegin, profCount, profEnd } from "../engine/profiler";
import { SMOKE, STEAM, makeSmokePool, makeSteamPool } from "./puffs";
import { linColor } from "./color";
import { C_BLOOD_G, C_BLOOD_R, C_DUST, C_EMBER, C_SPARK, C_SPARK2, rnd } from "./pools/shared";
import { ParticlePool } from "./pools/particle-pool";
import { slashTexture, type SlashOpts } from "./pools/slash-pool";
import { type RingOpts } from "./pools/ring-pool";
import { TRAIL_CAPACITY, TRAIL_PUSH_RATE, type TrailStyleName } from "./pools/trail-ribbon";
import { SlashPool } from "./pools/slash-pool";
import { BoltPool } from "./pools/bolt-pool";
import { TrailRibbon } from "./pools/trail-ribbon";
import { LaserMarkField } from "./pools/laser-mark-field";
import { RingPool } from "./pools/ring-pool";
import { SigilPool } from "./pools/sigil-pool";
import { BladeRing } from "./pools/blade-ring";



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
   * SMOKE — a dirty rising volume that occludes. Burning oil, a dying fire, a
   * wall crumbling.
   *
   * Puffs ERODE rather than fade: their alpha is a hard threshold on a noise
   * field that rises with age, so they break into holes and shreds. A fading
   * alpha would visibly POP between the palette's four greys instead of
   * dissipating — see `fx/puffs.ts`.
   */
  smoke(x: number, y: number, z: number, count?: number, spread?: number): void;
  /**
   * STEAM — the pale, additive, faster-rising cousin. Water hitting something
   * hot: the lava marble, a fire the player has just quenched, a slick boiling off
   * a burning pool.
   *
   * Additive so the core blooms, which is the one cue that separates it from
   * smoke at a glance.
   */
  steam(x: number, y: number, z: number, count?: number, speed?: number): void;
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
  trail(x: number, y: number, z: number, color: number, life?: number, style?: TrailStyleName): void;
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
  /**
   * Live puff counts + whether the pools are parented, for `__fx.puffs()`.
   *
   * Added while debugging invisible smoke. A screenshot cannot distinguish "never
   * spawned", "spawned but not in the scene", and "in the scene but fully
   * transparent" — and guessing between those three is how an afternoon goes.
   */
  puffDebug(): { smoke: number; steam: number; smokeParented: boolean; steamParented: boolean };
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
  // Smoke and steam are their own pools rather than a colour parameter on the
  // two above: their alpha ERODES instead of fading, and they RISE instead of
  // falling. See fx/puffs.ts.
  const smokePool = makeSmokePool();
  const steamPool = makeSteamPool();
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
  // Both puff meshes are visible with frustumCulled = false, exactly like the
  // particle pools, so `compileAsync` walks them during the descent prewarm and
  // they do NOT need adding to `warmupReveal`'s reveal list (which would also
  // break the exact-count assertion in load-warmup.test.ts).
  scene.add(smokePool.points);
  scene.add(steamPool.points);
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
    smoke(x, y, z, count = 5, spread = 0.5) {
      for (let i = 0; i < count; i++) {
        smokePool.spawn(
          x + rnd(-spread, spread), y, z + rnd(-spread, spread),
          rnd(-0.35, 0.35), rnd(0.1, 0.4), rnd(-0.35, 0.35),
          SMOKE.colors[Math.floor(Math.random() * SMOKE.colors.length)]!,
          rnd(SMOKE.size[0], SMOKE.size[1]),
          rnd(SMOKE.life[0], SMOKE.life[1]),
          SMOKE.rise, SMOKE.drag,
        );
      }
    },
    steam(x, y, z, count = 8, speed = 2) {
      for (let i = 0; i < count; i++) {
        // A shallow outward fan as well as a rise: steam off a hot surface
        // billows sideways before it climbs, which is what distinguishes it from
        // smoke rising off a fire in a still room.
        const a = Math.random() * Math.PI * 2;
        steamPool.spawn(
          x, y, z,
          Math.cos(a) * rnd(0.2, 1) * speed * 0.4, rnd(0.4, 1.1) * speed * 0.5, Math.sin(a) * rnd(0.2, 1) * speed * 0.4,
          STEAM.colors[Math.floor(Math.random() * STEAM.colors.length)]!,
          rnd(STEAM.size[0], STEAM.size[1]),
          rnd(STEAM.life[0], STEAM.life[1]),
          STEAM.rise, STEAM.drag,
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
    trail(x, y, z, color, life, style) {
      trail.push(x, y, z, color, life, style);
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
    puffDebug() {
      return {
        smoke: smokePool.liveCount(),
        steam: steamPool.liveCount(),
        smokeParented: smokePool.points.parent !== null,
        steamParented: steamPool.points.parent !== null,
      };
    },
    update(dt) {
      // These four are bucketed apart from the rest because they are exactly
      // what a compute-shader port would replace: fixed-size ring buffers
      // simulated in a CPU loop, then re-uploaded as dirty attributes.
      // docs/webgpu-plan.md's decision gate is written against this number, and
      // until now there was no way to read it — the old `vfx.update` span in
      // sim/loop.ts covered all twelve pools plus tickElements.
      profBegin("vfx.pools");
      additive.update(dt);
      alpha.update(dt);
      smokePool.update(dt);
      steamPool.update(dt);
      profEnd("vfx.pools");
      // Counted, not timed: a 0.2ms reading means nothing without knowing
      // whether anything was alive. `live` is set by the update() above at no
      // cost, so this is a read of four numbers.
      profCount("live particles", additive.live + alpha.live + smokePool.live + steamPool.live);
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
      scene.remove(smokePool.points);
      scene.remove(steamPool.points);
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
      smokePool.dispose();
      steamPool.dispose();
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

/**
 * ── THE PUBLIC FACE ─────────────────────────────────────────────────────────
 *
 * `vfx.ts` was one file, so everything it declared was importable from it. The
 * split into `fx/pools/` must not turn that into a scavenger hunt across eight
 * modules, so the names other code already imports are re-exported here.
 *
 * New code inside `fx/` should import from the specific pool; everything outside
 * `fx/` should keep importing from here.
 */
export { TrailRibbon } from "./pools/trail-ribbon";
export { LaserMarkField } from "./pools/laser-mark-field";
export { TRAIL_CAPACITY, TRAIL_PUSH_RATE } from "./pools/trail-ribbon";
export type { TrailStyle, TrailStyleName } from "./pools/trail-ribbon";
export type { SlashOpts } from "./pools/slash-pool";
export type { RingOpts } from "./pools/ring-pool";
