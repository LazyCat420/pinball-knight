/**
 * THE SLIME, AS A 3D RIG — the source of the published `slime-{S,N,E}` sheets.
 *
 * Built the way the Clockwork Knight was (render/clockwork-knight.ts): a hand
 * authored Three.js model with a `pose(clip, t)` function, rendered by
 * scripts/slime-bake.html into the gameplay atlases, published by
 * scripts/bake-slime.mjs. The pixel sheet it replaces (the 4x4 green blob in
 * docs/art/slime/sprite-sheet.png) is the SHAPE SPEC: every clip below is a
 * reading of one row of it —
 *
 *   row 1  idle    a settled dome with three trapped bubbles, breathing
 *   row 2  walk    gather tall → comma-shaped leap forward → flat splat → settle
 *   row 3  attack  curl back into a C → rear up as a cresting wave → splash → reform
 *   row 4  death   shiver → a bubble bulges out of the crown and pops → melt → puddle
 *
 * A slime has no skeleton, so this is not a hierarchy of pivots: it is ONE
 * dome whose vertices are recomputed per pose by `deform()`. Squash, lean,
 * curl, crest and melt are all closed-form displacements of the rest lattice,
 * which keeps the volume reading like gel rather than a scaled sphere.
 *
 * Model space: the dome sits on y=0, radius 1 at the base, ~1.05 tall. +z is
 * TOWARD THE CAMERA for the S facing (the bake yaws the root for N and E), so
 * "forward" — the way the slime travels — is +z here.
 */
import * as THREE from 'three';

export const SLIME_SHEET = 'slime';
export type SlimePose = 'idle' | 'walk' | 'attack' | 'death';
export const SLIME_CLIPS: readonly SlimePose[] = ['idle', 'walk', 'attack', 'death'];
/**
 * Frames per clip in the baked sheet, chosen against engine/config.ts anim
 * rates. `death` is 5 at 6 fps: the roster's death clips all FINISH inside
 * 0.96 s (sandbox-all-monsters-death-trace.test.ts simulates exactly that and
 * asserts isFinished), and the corpse holds the last frame — the puddle.
 */
export const SLIME_FRAMES: Record<SlimePose, number> = { idle: 6, walk: 8, attack: 12, death: 5 };
export const SLIME_LOOPS: Record<SlimePose, boolean> = { idle: true, walk: true, attack: false, death: false };

/** The sprite sheet's greens, read off docs/art/slime/sprite-sheet.png. */
export const SLIME_PALETTE = {
  ink: '#0b4d1a', dark: '#158a2c', base: '#22b53c', light: '#4ade5f', bright: '#9cf5a4', bubble: '#c9ffd0',
};

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
/** A one-hump pulse over [a, b] — 0 outside, 1 at the middle. */
const hump = (t: number, a: number, b: number) => { const u = (t - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI); };

/** Everything `deform()` reads. All zero = the rest dome. */
export interface SlimeShape {
  /** -1 gathered tall .. +1 squashed flat. Volume-preserving. */
  squash: number;
  /** Top of the dome shears toward +z (forward). The walk's comma. */
  lean: number;
  /** Top of the dome curls forward over itself toward +z. The attack's C. */
  curl: number;
  /** Rear up into a tall wave with the crest hooking forward. */
  crest: number;
  /** Lose height into a spreading puddle. 1 = the death's final frame. */
  melt: number;
  /** Whole-body lift off the floor, model units. */
  lift: number;
  /** Small random-phase jelly wobble, 0..1. */
  wobble: number;
  /** A bubble swelling out of the crown, 0..1 (death). */
  bulge: number;
  /** Radial spray of droplets, 0..1 (attack splash, death pop). */
  spray: number;
  /** Where the spray leaves from, model y. */
  sprayY: number;
  /** Bubbles inside the gel rise with this phase. */
  bubblePhase: number;
}

export function restShape(): SlimeShape {
  return { squash: 0, lean: 0, curl: 0, crest: 0, melt: 0, lift: 0, wobble: 0, bulge: 0, spray: 0, sprayY: 0.6, bubblePhase: 0 };
}

/**
 * The rest lattice: a dome built from a sphere whose lower hemisphere is
 * flattened onto the floor with a rounded skirt, so the base reads as a
 * blob resting under its own weight rather than a half-sphere on a table.
 */
function domeLattice(widthSegs = 48, heightSegs = 32): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, widthSegs, heightSegs);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Above the equator the sphere stands; below it, the skirt flares out a
    // little and the underside is pressed nearly flat.
    if (y >= 0) {
      pos.setXYZ(i, x, y * 1.05, z);
    } else {
      const flare = 1 + 0.08 * Math.sin(-y * Math.PI);
      pos.setXYZ(i, x * flare, y * 0.18, z * flare);
    }
  }
  // Lift so the flattened underside sits on y=0.
  geo.translate(0, 0.18, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * One vertex of the rest lattice → its posed position. Pure: the bake, the
 * tests and the live preview all call this, so what the tests measure is what
 * the sheet shows.
 */
export function deform(v: THREE.Vector3, s: SlimeShape, out = new THREE.Vector3()): THREE.Vector3 {
  const h = clamp01(v.y / 1.23); // 0 floor .. 1 crown
  // Squash and stretch keep the volume: the flat frame spreads, the tall one narrows.
  const sy = 1 - 0.55 * s.squash;
  const sxz = 1 / Math.sqrt(Math.max(0.2, sy));
  let x = v.x * sxz, y = v.y * sy, z = v.z * sxz;
  // The walk's leap: the top of the body leads, the base trails, a comma
  // leaning into the direction of travel.
  z += s.lean * (0.9 * h * h + 0.15 * h);
  y += s.lean * 0.25 * h * (1 - h) * 4 * 0.35;
  // The attack wind-up: the crown folds back over the base, a C seen from
  // the side. Beyond the shear the top also drops, so the fold reads as a
  // curl and not a tilt.
  if (s.curl > 0) {
    // Stand the body up a little, then bend the column forward around a
    // pivot at the front of the base: the crown swings over to +z and down,
    // so the C opens forward the way the sheet draws it.
    y *= 1 + 0.55 * s.curl;
    const a = s.curl * h * 2.6;
    const pz = 0.75 - z, py = y;
    z = 0.75 - (pz * Math.cos(a) - py * Math.sin(a) * 0.55);
    y = py * Math.cos(a) * 0.9 + pz * Math.sin(a) * 0.5;
    y = Math.max(y, 0.02);
  }
  // The cresting wave: the whole body rises, narrows at the neck, and the
  // crown hooks forward over the floor like a breaker.
  if (s.crest > 0) {
    const c = s.crest;
    y *= 1 + 0.75 * c * (0.35 + 0.65 * h);
    const neck = 1 - 0.28 * c * Math.sin(h * Math.PI);
    x *= neck;
    z = z * neck + c * (1.1 * h * h * h) - c * 0.25 * h;
  }
  // Melting: height goes, footprint grows, the crown dimples in.
  if (s.melt > 0) {
    const m = s.melt;
    y *= 1 - 0.9 * m;
    const spread = 1 + 0.55 * m;
    x *= spread; z *= spread;
    y -= m * 0.05 * h * h;
  }
  // Jelly wobble: a low-order ripple around the body.
  if (s.wobble > 0) {
    const ang = Math.atan2(z, x);
    const r = 1 + s.wobble * 0.05 * Math.sin(ang * 3 + s.bubblePhase * 6) * Math.sin(h * Math.PI);
    x *= r; z *= r;
  }
  // The death bulge: a bubble forcing its way out of the crown, off centre.
  if (s.bulge > 0) {
    // A bubble swelling out of the crown, front-right of centre: vertices
    // near the bubble's seat are pushed out along the radial from the gel's
    // centre, so the bump is round rather than a peak.
    const d = Math.hypot(x - 0.38, y - 0.92, z - 0.42);
    const k = Math.exp(-d * d * 9);
    const rx = x, ry = y - 0.3, rz = z, rl = Math.hypot(rx, ry, rz) || 1;
    x += s.bulge * 0.55 * k * rx / rl; y += s.bulge * 0.55 * k * ry / rl; z += s.bulge * 0.55 * k * rz / rl;
  }
  y += s.lift;
  return out.set(x, Math.max(y, -0.001), z);
}

export function createSlime() {
  const root = new THREE.Group(); root.name = 'Slime';
  const body = new THREE.Group(); body.name = 'Gel body'; root.add(body);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ramp = new THREE.DataTexture(new Uint8Array([40, 120, 210, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  function toon(color: string, extra: Partial<THREE.MeshToonMaterialParameters> = {}) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra }); materials.add(m); return m;
  }
  const gel = toon(SLIME_PALETTE.base);
  const glossMat = new THREE.MeshBasicMaterial({ color: SLIME_PALETTE.bright }); materials.add(glossMat);
  const bubbleMat = new THREE.MeshBasicMaterial({ color: SLIME_PALETTE.light }); materials.add(bubbleMat);
  const bubbleRim = new THREE.MeshBasicMaterial({ color: SLIME_PALETTE.bubble, side: THREE.BackSide }); materials.add(bubbleRim);
  const dropMat = toon(SLIME_PALETTE.base);
  const outline = new THREE.MeshBasicMaterial({ color: SLIME_PALETTE.ink, side: THREE.BackSide }); materials.add(outline);

  // The dome and its ink: two copies of the same lattice, the outline pushed
  // out along the posed normals each frame (a scaled copy would not stay a
  // constant line width once the body is flattened into a puddle).
  const rest = domeLattice(); geometries.add(rest);
  const restPos = rest.attributes.position as THREE.BufferAttribute;
  const skin = rest.clone(); geometries.add(skin);
  const ink = rest.clone(); geometries.add(ink);
  const dome = new THREE.Mesh(skin, gel); dome.name = 'Dome'; body.add(dome);
  const inkMesh = new THREE.Mesh(ink, outline); inkMesh.name = 'Dome ink'; body.add(inkMesh);
  const INK = 0.065;

  // The gloss: the sprite's big highlight on the upper left, which is what
  // makes the flat green read as wet.
  const sphere = new THREE.SphereGeometry(1, 20, 14); geometries.add(sphere);
  const gloss = new THREE.Mesh(sphere, glossMat); gloss.name = 'Gloss'; body.add(gloss);
  gloss.scale.set(0.32, 0.13, 0.2);
  // Three trapped bubbles, as in every frame of the sheet. Each is a lighter
  // disc with a pale rim, sitting just under the skin so it survives the crush.
  const bubbles: THREE.Mesh[] = [];
  const BUBBLE_AT: [number, number, number, number][] = [
    [-0.32, 0.62, 0.86, 0.11],
    [0.38, 0.72, 0.82, 0.085],
    [0.1, 0.34, 0.97, 0.07],
  ];
  for (const [x, y, z, r] of BUBBLE_AT) {
    const b = new THREE.Mesh(sphere, bubbleMat); b.position.set(x, y, z); b.scale.setScalar(r); body.add(b);
    const rim = new THREE.Mesh(sphere, bubbleRim); rim.scale.setScalar(1.25); b.add(rim);
    bubbles.push(b);
  }
  // Droplets for the splash and the pop.
  const drops = new THREE.Group(); drops.name = 'Droplets'; root.add(drops);
  const DROPS = 9;
  for (let i = 0; i < DROPS; i++) {
    const d = new THREE.Mesh(sphere, dropMat); d.scale.setScalar(0.09);
    const edge = new THREE.Mesh(sphere, outline); edge.scale.setScalar(1.45); d.add(edge);
    drops.add(d);
  }

  const v = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
  const shape = restShape();
  const skinPos = skin.attributes.position as THREE.BufferAttribute;
  const inkPos = ink.attributes.position as THREE.BufferAttribute;

  /** Re-lay the lattice for `shape`. Also moves gloss and bubbles with the skin. */
  function apply(s: SlimeShape) {
    Object.assign(shape, s);
    for (let i = 0; i < restPos.count; i++) {
      v.fromBufferAttribute(restPos, i);
      deform(v, shape, p);
      skinPos.setXYZ(i, p.x, p.y, p.z);
    }
    skinPos.needsUpdate = true;
    skin.computeVertexNormals();
    const sn = skin.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < restPos.count; i++) {
      n.fromBufferAttribute(sn, i);
      inkPos.setXYZ(i, skinPos.getX(i) + n.x * INK, skinPos.getY(i) + n.y * INK, skinPos.getZ(i) + n.z * INK);
    }
    inkPos.needsUpdate = true;
    ink.computeVertexNormals();
    skin.computeBoundingSphere(); ink.computeBoundingSphere();
    // Gloss rides the upper-left of whatever the dome has become.
    deform(v.set(-0.42, 0.84, 0.62), shape, p); gloss.position.copy(p).addScaledVector(n.set(-0.45, 0.7, 0.55).normalize(), 0.02);
    gloss.visible = shape.melt < 0.95;
    gloss.scale.set(0.32 * (1 - 0.5 * shape.melt), 0.13 * (1 - 0.6 * shape.melt), 0.2);
    // Bubbles drift up through the gel and wrap back to the base.
    bubbles.forEach((b, i) => {
      const [x, y, z, r] = BUBBLE_AT[i];
      const rise = ((shape.bubblePhase + i * 0.37) % 1);
      const by = 0.12 + ((y - 0.12 + rise * 0.55) % 0.85);
      deform(v.set(x, by, z), shape, p);
      b.position.copy(p).multiplyScalar(0.94);
      b.scale.setScalar(r * (1 - 0.5 * shape.melt));
      b.visible = shape.melt < 0.85;
    });
    // Droplets: a fan thrown up and out from `sprayY`, falling as spray → 1.
    drops.visible = shape.spray > 0;
    drops.children.forEach((d, i) => {
      const a = (i / DROPS) * Math.PI * 2 + 0.4, t = shape.spray;
      const rr = 0.55 + 0.9 * t + (i % 3) * 0.12;
      const up = 0.35 + (i % 2) * 0.25;
      d.position.set(Math.cos(a) * rr, shape.sprayY + up * Math.sin(t * Math.PI) * 2.2 - t * t * 0.4, Math.sin(a) * rr * 0.6 + 0.3);
      d.position.y = Math.max(d.position.y, 0.08);
      d.scale.setScalar((0.06 + 0.05 * ((i * 7) % 3)) * (1 - 0.4 * t) * Math.min(1, (1 - t) * 6));
    });
  }

  /** Pose the slime at `t` (0..1) through `clip`. */
  function pose(clip: SlimePose, t: number) {
    const s = restShape();
    s.bubblePhase = t;
    if (clip === 'idle') {
      // A settled dome breathing: rise gathered, settle spread, bubbles climbing.
      const ph = t * Math.PI * 2;
      s.squash = 0.18 * Math.sin(ph) + 0.06 * Math.sin(ph * 2);
      s.wobble = 0.35;
    } else if (clip === 'walk') {
      // The scoot, read off row 2: gather → leap as a comma → splat → settle.
      const gather = hump(t, 0, 0.3), leap = hump(t, 0.22, 0.62), splat = hump(t, 0.55, 0.85), settle = hump(t, 0.8, 1.0);
      s.squash = -0.85 * gather + 0.95 * splat + 0.35 * settle;
      s.lean = 1.15 * leap;
      s.lift = 0.55 * leap;
      s.wobble = 0.25 * settle;
    } else if (clip === 'attack') {
      // Row 3: curl back into a C, rear up as a wave, crash into a splash, reform.
      const wind = ease(t / 0.28) * (1 - ease((t - 0.3) / 0.12));
      const rear = ease((t - 0.3) / 0.16) * (1 - ease((t - 0.52) / 0.1));
      const splash = ease((t - 0.55) / 0.08) * (1 - ease((t - 0.82) / 0.18));
      s.curl = 0.95 * wind;
      s.squash = 0.25 * wind + 1.0 * splash - 0.35 * rear;
      s.crest = 1.0 * rear;
      s.lean = 0.35 * rear;
      s.spray = t < 0.55 ? 0 : clamp01((t - 0.55) / 0.35);
      s.sprayY = 0.4;
      s.wobble = ease((t - 0.85) / 0.15) * 0.6;
    } else {
      // Row 4: shiver, a bubble swells out of the crown and bursts, then the
      // body loses its shape and ends as a puddle.
      const shiver = 1 - ease((t - 0.2) / 0.12);
      s.wobble = 1.0 * shiver;
      s.squash = 0.15 * Math.sin(t * 40) * shiver;
      s.bulge = hump(t, 0.05, 0.45) * 1.1;
      s.spray = t >= 0.4 && t < 0.65 ? (t - 0.4) / 0.25 : 0;
      s.sprayY = 1.1;
      s.melt = ease((t - 0.45) / 0.5);
      s.squash += 0.6 * ease((t - 0.42) / 0.3);
    }
    apply(s);
  }

  function dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); ramp.dispose(); root.removeFromParent(); }
  pose('idle', 0);
  return { root, body, dome, drops, bubbles, shape, pose, apply, dispose };
}
