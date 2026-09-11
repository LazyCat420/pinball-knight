/**
 * THE FRY SENTINEL, AS A 3D RIG — the source of the published `fries-{S,N,E}`
 * sheets.
 *
 * Built like the Clockwork Knight (render/clockwork-knight.ts) and the slime
 * (render/slime-3d.ts): a hand-authored Three.js model with `pose(clip, t)`,
 * rendered by scripts/fries-bake.html into the gameplay atlases and published
 * by scripts/bake-fries.mjs. The pixel sheet it replaces
 * (docs/art/fries/sprite-sheet.png) is the SHAPE SPEC, one row per clip:
 *
 *   row 1  idle    the carton stands, fries sway, arms hang, gentle bob
 *   row 2  walk    crinkle-fry legs stride, arms counter-swing, body bobs
 *   row 3  attack  leans in, winks, and fires crinkle-cut fry darts from its head
 *   row 4  death   the carton buckles, fries spill, it crumples flat with a sad face
 *
 * The creature is a red carton (a tapered box, wider at the rim) with a
 * cartoon face on the front, a bundle of crinkle-cut fries standing in it,
 * crinkle-fry arms and legs, and a mystic-eye amulet on a chain. A crinkle fry
 * is a zig-zag stack of short boxes, which is what reads at sprite size.
 *
 * Model space: feet on y=0, ~3 units tall with the fries. +z is TOWARD THE
 * CAMERA for the S facing (the face is on the +z side); the bake yaws the root
 * for N and E, so "forward" is +z here.
 */
import * as THREE from 'three';

export const FRIES_SHEET = 'fries';
export type FriesPose = 'idle' | 'walk' | 'attack' | 'death';
export const FRIES_CLIPS: readonly FriesPose[] = ['idle', 'walk', 'attack', 'death'];
/**
 * Frames per clip, against engine/config.ts anim rates (idle 3, walk 8,
 * attack 12, death 6 fps). `death` is 5 so it FINISHES inside the 0.96 s that
 * sandbox-all-monsters-death-trace.test.ts simulates.
 */
export const FRIES_FRAMES: Record<FriesPose, number> = { idle: 6, walk: 8, attack: 12, death: 5 };
export const FRIES_LOOPS: Record<FriesPose, boolean> = { idle: true, walk: true, attack: false, death: false };

/** Colours read off docs/art/fries/sprite-sheet.png. */
export const FRIES_PALETTE = {
  ink: '#3a1208', cartonDark: '#8f1f14', carton: '#c8342a', cartonLight: '#e0574a',
  fryDark: '#b9932c', fry: '#e3c64c', fryLight: '#f4e389', white: '#f6f1e6', gold: '#d9a83a', amulet: '#2b6f72',
};

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
const hump = (t: number, a: number, b: number) => { const u = (t - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI); };

export function createFries() {
  const root = new THREE.Group(); root.name = 'Fry Sentinel';
  const body = new THREE.Group(); body.name = 'Carton'; root.add(body);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ramp = new THREE.DataTexture(new Uint8Array([60, 130, 215, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  function toon(color: string) { const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); materials.add(m); return m; }
  function flat(color: string, side: THREE.Side = THREE.FrontSide) { const m = new THREE.MeshBasicMaterial({ color, side }); materials.add(m); return m; }
  const carton = toon(FRIES_PALETTE.carton), cartonDark = toon(FRIES_PALETTE.cartonDark);
  const fry = toon(FRIES_PALETTE.fry), fryDark = toon(FRIES_PALETTE.fryDark);
  const white = flat(FRIES_PALETTE.white), ink = flat(FRIES_PALETTE.ink), gold = toon(FRIES_PALETTE.gold), amuletMat = toon(FRIES_PALETTE.amulet);
  const outline = flat(FRIES_PALETTE.ink, THREE.BackSide);
  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const sphere = new THREE.SphereGeometry(1, 16, 12); geometries.add(sphere);
  const INK = 1.06;

  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], inkShell = true) {
    const m = new THREE.Mesh(geo, material); m.position.set(position[0], position[1], position[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m);
    if (inkShell) { const edge = new THREE.Mesh(geo, outline); edge.scale.setScalar(INK); m.add(edge); }
    return m;
  }

  // ── THE CARTON: a box that flares toward the rim, a darker inner lip. ──
  const cartonGeo = new THREE.BoxGeometry(1, 1, 1, 1, 4, 1); geometries.add(cartonGeo);
  {
    const pos = cartonGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const f = 1 + 0.22 * (pos.getY(i) + 0.5); pos.setX(i, pos.getX(i) * f); pos.setZ(i, pos.getZ(i) * f); }
    cartonGeo.computeVertexNormals();
  }
  const CARTON_H = 1.55, CARTON_Y = 0.55;
  const box = mesh(body, cartonGeo, carton, [0, CARTON_Y + CARTON_H / 2, 0], [1.25, CARTON_H, 1.0]);
  box.name = 'Carton box';
  // Everything that rides the carton's RIM lives in `top`, positioned at the
  // rim height, so the crumple can lower it with the box without scaling it.
  const TOP_Y = CARTON_Y + CARTON_H;
  const top = new THREE.Group(); top.name = 'Rim'; top.position.y = TOP_Y; body.add(top);
  mesh(top, cube, cartonDark, [0, -0.03, 0], [1.58, 0.1, 1.26], true);
  const lip = mesh(top, cube, cartonDark, [0, -0.02, 0], [1.4, 0.03, 1.05], false); lip.name = 'Lip';

  // ── THE FACE, on the +z side of the carton. ──
  const face = new THREE.Group(); face.name = 'Face'; body.add(face);
  const FACE_Z = 1.0 / 2 + 0.03;
  const eyes: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [], brows: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const e = mesh(face, sphere, white, [side * 0.27, 1.62, FACE_Z * (1 + 0.22 * 0.7)], [0.17, 0.2, 0.06]); eyes.push(e);
    const p = mesh(face, sphere, ink, [side * 0.05, 0.02, 0.6], [0.45, 0.45, 0.6], false); e.add(p); pupils.push(p);
    const b = mesh(face, cube, ink, [side * 0.27, 1.86, FACE_Z * 1.16], [0.3, 0.05, 0.03], false); b.rotation.z = side * -0.15; brows.push(b);
  }
  const smileGeo = new THREE.TorusGeometry(0.34, 0.045, 8, 24, Math.PI); geometries.add(smileGeo);
  const smile = mesh(face, smileGeo, ink, [0.03, 1.3, FACE_Z * 1.12], [1, 0.7, 1], false); smile.name = 'Smile'; smile.rotation.z = Math.PI;

  // ── THE AMULET: a chain round the rim and a gold disc with a mystic eye. ──
  const chainGeo = new THREE.TorusGeometry(0.64, 0.035, 6, 32); geometries.add(chainGeo);
  const chain = mesh(body, chainGeo, gold, [0, 1.25, 0.0], [1.15, 0.9, 1], false); chain.rotation.x = Math.PI / 2 - 0.18; chain.name = 'Chain';
  const discGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.05, 20); geometries.add(discGeo);
  const amulet = mesh(body, discGeo, gold, [-0.2, 0.95, FACE_Z * 1.1 + 0.03], [1, 1, 1]); amulet.rotation.x = Math.PI / 2; amulet.name = 'Amulet';
  mesh(amulet, sphere, amuletMat, [0, 0.035, 0], [0.1, 0.02, 0.07], false);
  mesh(amulet, sphere, ink, [0, 0.05, 0], [0.045, 0.01, 0.045], false);

  // ── CRINKLE FRIES: a zig-zag stack of short boxes, base at the group origin, +y up. ──
  function crinkle(parent: THREE.Object3D, length: number, thick: number, segs: number, material: THREE.Material, amp = 0.35) {
    const g = new THREE.Group(); parent.add(g);
    const h = length / segs;
    for (let i = 0; i < segs; i++) {
      const x = (i % 2 ? amp : -amp) * thick;
      mesh(g, cube, material, [x, h * (i + 0.5), 0], [thick * 1.5, h * 1.08, thick]);
    }
    return g;
  }
  // The bundle standing in the carton.
  const bundle = new THREE.Group(); bundle.name = 'Fry bundle'; top.add(bundle);
  const BUNDLE_AT: [number, number, number, number, number][] = [
    [-0.48, 0.05, 1.0, -0.24, 0.05], [-0.22, -0.2, 1.25, -0.08, -0.1], [0.05, 0.15, 1.3, 0.03, 0.12], [0.3, -0.15, 1.15, 0.12, -0.06],
    [0.5, 0.08, 0.95, 0.26, 0.04], [-0.3, 0.26, 0.85, -0.16, 0.24], [0.18, 0.28, 0.9, 0.08, 0.26],
  ];
  const fries: THREE.Group[] = [];
  for (const [x, z, len, tiltZ, tiltX] of BUNDLE_AT) {
    const f = crinkle(bundle, len, 0.24, 4, fry, 0.32); f.position.set(x, -0.25, z); f.rotation.set(tiltX, 0, tiltZ);
    f.userData.rest = { x, z, len, tiltZ, tiltX }; fries.push(f);
  }
  // Arms and legs: crinkle fries hanging from pivots, pointing DOWN (rotated π about x).
  function limb(name: string, x: number, y: number, z: number, len: number, thick: number, segs: number) {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(x, y, z); body.add(pivot);
    const f = crinkle(pivot, len, thick, segs, fry, 0.3); f.rotation.x = Math.PI;
    return pivot;
  }
  const arms = [limb('Left arm', -0.9, 1.6, 0.12, 0.85, 0.17, 4), limb('Right arm', 0.9, 1.6, 0.12, 0.85, 0.17, 4)];
  const legs = [limb('Left leg', -0.32, CARTON_Y + 0.02, 0.05, 0.6, 0.19, 3), limb('Right leg', 0.32, CARTON_Y + 0.02, 0.05, 0.6, 0.19, 3)];
  // Feet: a small flattened fry tip pointing forward.
  for (const l of legs) mesh(l, cube, fryDark, [0, -0.6, 0.12], [0.28, 0.12, 0.42]);

  // ── DARTS: crinkle-cut fries fired from the head, and the spilled fries of the death. ──
  const darts = new THREE.Group(); darts.name = 'Fry darts'; root.add(darts);
  const DARTS = 7;
  for (let i = 0; i < DARTS; i++) { const d = crinkle(darts, 0.62, 0.16, 3, i % 2 ? fry : fryDark); d.position.set(0, 0, 0); }
  const spill = new THREE.Group(); spill.name = 'Spilled fries'; root.add(spill);
  const SPILL = 10;
  for (let i = 0; i < SPILL; i++) { const d = crinkle(spill, 0.5 + (i % 3) * 0.15, 0.18, 3, i % 3 ? fry : fryDark); d.position.set(0, 0, 0); }

  function reset() {
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
    box.scale.set(1.25, CARTON_H, 1.0); box.position.y = CARTON_Y + CARTON_H / 2; box.rotation.set(0, 0, 0);
    face.position.set(0, 0, 0); face.scale.set(1, 1, 1);
    eyes.forEach((e) => e.scale.set(0.17, 0.2, 0.06));
    pupils.forEach((p) => p.position.set(p.position.x < 0 ? -0.05 : 0.05, 0.02, 0.6));
    brows.forEach((b, i) => { b.position.y = 1.86; b.rotation.z = (i === 0 ? 1 : -1) * -0.15; });
    smile.rotation.set(0, 0, Math.PI); smile.position.set(0.03, 1.3, FACE_Z * 1.12); smile.scale.set(1, 0.7, 1);
    top.position.set(0, TOP_Y, 0); top.rotation.set(0, 0, 0);
    fries.forEach((f) => { const r = f.userData.rest; f.position.set(r.x, -0.25, r.z); f.rotation.set(r.tiltX, 0, r.tiltZ); f.scale.setScalar(1); f.visible = true; });
    arms.forEach((a, i) => { a.rotation.set(0, 0, (i === 0 ? 1 : -1) * 0.12); a.position.y = 1.6; });
    legs.forEach((l) => { l.position.y = CARTON_Y + 0.02; });
    legs.forEach((l) => l.rotation.set(0, 0, 0));
    darts.visible = false; spill.visible = false;
    chain.visible = true; amulet.visible = true; chain.position.y = 1.25; chain.scale.set(1.15, 0.9, 1); amulet.position.y = 0.95;
  }

  /** Pose the sentinel at `t` (0..1) through `clip`. */
  function pose(clip: FriesPose, t: number) {
    reset();
    if (clip === 'idle') {
      const ph = t * Math.PI * 2;
      body.position.y = 0.03 * Math.sin(ph);
      box.scale.y = CARTON_H * (1 + 0.015 * Math.sin(ph)); box.position.y = CARTON_Y + box.scale.y / 2;
      fries.forEach((f, i) => { f.rotation.z += 0.05 * Math.sin(ph + i * 0.9); });
      arms.forEach((a, i) => { a.rotation.x = 0.08 * Math.sin(ph + i * Math.PI); });
    } else if (clip === 'walk') {
      const ph = t * Math.PI * 2;
      const stride = 0.75;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * Math.PI) * stride; });
      arms.forEach((a, i) => { a.rotation.x = -Math.sin(ph + i * Math.PI) * 0.55; });
      body.position.y = Math.abs(Math.sin(ph)) * 0.09;
      body.rotation.x = 0.06;
      fries.forEach((f, i) => { f.rotation.z += 0.08 * Math.sin(ph * 2 + i); });
    } else if (clip === 'attack') {
      // Lean in, squint one eye, and the bundle bows forward as darts leave the head.
      const lean = ease(t / 0.2) * (1 - ease((t - 0.8) / 0.2));
      const wink = ease((t - 0.1) / 0.1) * (1 - ease((t - 0.85) / 0.15));
      body.rotation.x = 0.28 * lean;
      body.position.z = 0.12 * lean;
      eyes[1].scale.y = 0.2 * (1 - 0.8 * wink);
      brows[1].position.y = 1.86 - 0.08 * wink; brows[1].rotation.z = 0.35 * wink;
      brows[0].rotation.z = -0.15 - 0.2 * wink;
      fries.forEach((f, i) => { f.rotation.x += 0.35 * lean * (1 + 0.2 * (i % 2)); });
      arms.forEach((a, i) => { a.rotation.x = -0.6 * lean; a.rotation.z = (i === 0 ? 1 : -1) * (0.12 + 0.35 * lean); });
      legs.forEach((l, i) => { l.rotation.x = (i === 0 ? 0.25 : -0.25) * lean; });
      const fire = t >= 0.2 && t < 0.85 ? (t - 0.2) / 0.65 : 0;
      darts.visible = fire > 0;
      darts.children.forEach((d, i) => {
        const u = clamp01(fire * 1.4 - i * 0.07);
        const spread = (i - (DARTS - 1) / 2) * 0.22;
        d.position.set(spread * (0.4 + u), 2.6 + 0.4 * u - 0.2 * u * u + Math.abs(spread) * 0.1, 0.3 + 1.6 * u);
        d.rotation.set(Math.PI / 2 - 0.3 + 0.6 * u, 0, spread * 0.6);
        d.visible = u > 0 && u < 1;
        d.scale.setScalar(1 - 0.25 * u);
      });
    } else {
      // Row 4: the carton buckles, tips, spills its fries and crumples flat
      // with a sad face; the spilled fries stay scattered around it.
      const buckle = ease(t / 0.35), crumple = ease((t - 0.3) / 0.7);
      const flatten = 1 - 0.78 * crumple;
      box.scale.set(1.25 * (1 + 0.3 * crumple), CARTON_H * flatten, 1.0 * (1 + 0.15 * crumple));
      box.position.y = CARTON_Y * (1 - crumple) + (CARTON_H * flatten) / 2 + 0.04;
      box.rotation.z = 0.18 * buckle * (1 - crumple) + 0.05 * crumple;
      box.rotation.x = -0.12 * buckle;
      const drop = (CARTON_Y + CARTON_H / 2) - box.position.y;
      top.position.y = TOP_Y - drop - (CARTON_H * (1 - flatten)) / 2; top.rotation.z = box.rotation.z;
      face.position.y = -drop; face.scale.y = Math.max(0.35, flatten);
      face.position.z = 0.1 * crumple;
      smile.rotation.z = 0; smile.position.y = 1.22; smile.scale.set(0.9, 0.55, 1);
      eyes.forEach((e) => { e.scale.y = 0.2 * (1 - 0.7 * ease((t - 0.2) / 0.3)); });
      brows.forEach((b, i) => { b.rotation.z = (i === 0 ? -1 : 1) * 0.45 * buckle; b.position.y = 1.83; });
      const spillT = ease((t - 0.15) / 0.5);
      fries.forEach((f, i) => {
        const a = (i / fries.length) * Math.PI * 2 + 0.7;
        const r = f.userData.rest;
        // In `top` space: the floor is at -top.position.y.
        f.position.set(r.x + Math.cos(a) * 1.1 * spillT, -0.25 * (1 - spillT) + (-top.position.y + 0.1) * spillT, r.z + Math.sin(a) * 0.8 * spillT + 0.25 * spillT);
        f.rotation.set(r.tiltX + (Math.PI / 2 - 0.1) * spillT * (i % 2 ? 1 : -1) * 0.9, a * spillT, r.tiltZ + (i % 3 - 1) * 0.5 * spillT);
      });
      spill.visible = t > 0.25;
      spill.children.forEach((d, i) => {
        const a = (i / SPILL) * Math.PI * 2 + 0.3, u = ease((t - 0.25) / 0.45);
        const rr = 1.15 + 0.9 * u + (i % 3) * 0.18;
        d.position.set(Math.cos(a) * rr, 0.07 + 0.5 * Math.sin(u * Math.PI) * (1 - u), Math.sin(a) * rr * 0.7 + 0.25);
        d.rotation.set(Math.PI / 2 * (0.8 + 0.2 * (i % 2)), a + u * 2, 0.3 * (i % 3 - 1));
        d.visible = u > 0;
      });
      arms.forEach((a, i) => { a.rotation.z = (i === 0 ? 1 : -1) * (0.12 + 1.3 * crumple); a.rotation.x = 0.3 * buckle; a.position.y = 1.6 - drop * 0.9; });
      legs.forEach((l, i) => { l.rotation.z = (i === 0 ? 1 : -1) * 0.9 * crumple; l.rotation.x = -0.35 * crumple; l.position.y = CARTON_Y + 0.02 - CARTON_Y * crumple * 0.7; });
      chain.position.y = 1.25 - drop * 0.6; chain.scale.y = 0.9 * Math.max(0.2, 1 - crumple); chain.visible = crumple < 0.6;
      amulet.position.y = 0.95 - drop * 0.5;
      body.position.y = 0;
    }
  }

  function dispose() { geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); ramp.dispose(); root.removeFromParent(); }
  pose('idle', 0);
  return { root, body, box, top, face, eyes, smile, fries, arms, legs, darts, spill, pose, reset, dispose };
}
