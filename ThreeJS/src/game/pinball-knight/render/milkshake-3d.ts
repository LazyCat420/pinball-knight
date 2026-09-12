/**
 * TOXIC SHAKE (MILKSHAKE MONSTER), AS A 3D RIG — the source of the published
 * `milkshake-{S,N,E}` sheets.
 *
 * Built like the Fry Sentinel (render/fries-3d.ts), Clockwork Knight
 * (render/clockwork-knight.ts), and the slime (render/slime-3d.ts): a
 * hand-authored Three.js model with `pose(clip, t)`, rendered by
 * scripts/milkshake-bake.html into the gameplay atlases and published by
 * scripts/bake-milkshake.mjs. The pixel sheet it replaces
 * (docs/art/milkshake/sprite-sheet.png) is the SHAPE SPEC, one row per clip:
 *
 *   row 1  idle    stands on its skinny legs, shake bubbles under the lid, straw sways, gloves twitch
 *   row 2  walk    a cocky strut — legs stride, cup rocks, gloves counter-swing, straw whips
 *   row 3  attack  rears back and gargles (cup swells, mouth gapes), then lunges and hoses a
 *                  cone of toxic shake at the player from the straw AND the mouth
 *   row 4  death   the lid blows off, the cup buckles and topples onto its side, shake gushes
 *                  out into a spreading puddle, X eyes, gloves and legs flop limp
 *
 * ── THE SECOND PASS (2026-09-12) ─────────────────────────────────────────────
 * The first bake read as a plain paper cup: it hovered with no legs (so `walk`
 * was `idle` with a tilt), the eyes sat INSIDE the cylinder's surface, the
 * mouth was drawn on top of the red stripe, the gloves were stubs glued to
 * that stripe, the straw was a matchstick, the spray drifted UP off the lid,
 * and the death flattened the cup into a plate. Measured with the shared
 * registration rect, the living monster drew at 69 art units tall against the
 * Fry Sentinel's 89, because the hover and the wide puddle stretched the rect
 * both ways. This pass grounds it on legs, mounts every face feature ON the
 * cup's surface (`onCup`), moves the stripe below the mouth, gives the gloves
 * cuffs and fingers, keeps the death inside ±1.45 units so the rect stays
 * tight, and cheats the face toward the camera for the E bake (`setFacing`).
 *
 * Model space: feet on y=0, ~3 units tall to the straw tip. +z is TOWARD THE
 * CAMERA for the S facing; the bake yaws the root for N and E.
 */
import * as THREE from 'three';

export const MILKSHAKE_SHEET = 'milkshake';
export type MilkshakePose = 'idle' | 'walk' | 'attack' | 'death';
export const MILKSHAKE_CLIPS: readonly MilkshakePose[] = ['idle', 'walk', 'attack', 'death'];

/**
 * Frames per clip, against engine/config.ts anim rates (idle 3, walk 8,
 * attack 12, death 6 fps). `death` is 5 so it FINISHES inside the 0.96 s that
 * sandbox-all-monsters-death-trace.test.ts simulates.
 */
export const MILKSHAKE_FRAMES: Record<MilkshakePose, number> = { idle: 6, walk: 8, attack: 12, death: 5 };
export const MILKSHAKE_LOOPS: Record<MilkshakePose, boolean> = { idle: true, walk: true, attack: false, death: false };

/** Colours read off docs/art/milkshake/sprite-sheet.png and the fast-food palette. */
export const MILKSHAKE_PALETTE = {
  ink: '#18181b',
  cup: '#f8f7f2',
  cupDark: '#c9cbc4',
  cupStripe: '#d9203f',
  lid: '#eceef0',
  lidDark: '#9aa1ab',
  strawRed: '#e0243c',
  strawWhite: '#ffffff',
  gloveYellow: '#f7c81c',
  gloveDark: '#c5930c',
  gloveCuff: '#e6ad0f',
  leg: '#e8e6df',
  shoe: '#2f2f3a',
  toxicGreen: '#7fcf1a',
  toxicGlow: '#b6f04a',
  toxicDark: '#4b8a0b',
  tongue: '#c2185b',
  mouth: '#3b0a12',
  white: '#ffffff',
};

/** The death must stay inside this half-width so the shared registration rect stays tight. */
export const MILKSHAKE_DEATH_HALF_WIDTH = 1.45;

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
const hump = (t: number, a: number, b: number) => { const u = (t - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI); };

// ── PROPORTIONS ──
const LEG_LEN = 0.52;
const CUP_Y = 0.6, CUP_H = 1.62, R_TOP = 0.8, R_BOT = 0.56;
const TOP_Y = CUP_Y + CUP_H;
/** Cup radius at a model-space height: the cylinder tapers. */
const cupRadiusAt = (y: number) => R_BOT + ((y - CUP_Y) / CUP_H) * (R_TOP - R_BOT);
const FACE_Y = 1.74, MOUTH_Y = 1.36, BROW_Y = 1.98, STRIPE_Y = 1.02;
/**
 * Shoulders sit BEHIND the cup's centre line and the gloves hang trailing a
 * little (`ARM_REST_X`), so in the E bake the near glove is occluded by the
 * cup instead of hanging over the face.
 */
const ARM_Z = -0.1;
/** How far the face slides round toward the camera per radian of bake yaw; see `setFacing`. */
const FACE_CHEAT = 0.7;
const ARM_REST_X = 0.3;

export function createMilkshake() {
  const root = new THREE.Group(); root.name = 'Toxic Shake';
  const body = new THREE.Group(); body.name = 'Body'; root.add(body);
  // `hull` is everything that topples together in the death (cup, face, arms,
  // legs); `top` (lid + straw) is a sibling so it can blow off on its own arc.
  const hull = new THREE.Group(); hull.name = 'Hull'; body.add(hull);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  const ramp = new THREE.DataTexture(new Uint8Array([60, 130, 215, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  function toon(color: string) { const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); materials.add(m); return m; }
  function flat(color: string, side: THREE.Side = THREE.FrontSide) { const m = new THREE.MeshBasicMaterial({ color, side }); materials.add(m); return m; }

  const P = MILKSHAKE_PALETTE;
  const cupMat = toon(P.cup), cupDarkMat = toon(P.cupDark), stripeMat = toon(P.cupStripe);
  const lidMat = toon(P.lid), lidDarkMat = toon(P.lidDark);
  const strawRedMat = toon(P.strawRed), strawWhiteMat = flat(P.strawWhite);
  const gloveMat = toon(P.gloveYellow), gloveDarkMat = toon(P.gloveDark), gloveCuffMat = toon(P.gloveCuff);
  const legMat = toon(P.leg), shoeMat = toon(P.shoe);
  const toxicMat = toon(P.toxicGreen), toxicGlowMat = flat(P.toxicGlow), toxicDarkMat = toon(P.toxicDark);
  const tongueMat = toon(P.tongue), mouthMat = flat(P.mouth);
  const whiteMat = flat(P.white), inkMat = flat(P.ink);
  const outline = flat(P.ink, THREE.BackSide);

  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const sphere = new THREE.SphereGeometry(1, 16, 12); geometries.add(sphere);
  const INK = 1.06;

  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], inkShell = true) {
    const m = new THREE.Mesh(geo, material); m.position.set(position[0], position[1], position[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m);
    if (inkShell) { const edge = new THREE.Mesh(geo, outline); edge.scale.setScalar(INK); m.add(edge); }
    return m;
  }
  /** Sit `obj` flush on the cup's surface at height `y`, `angle` radians round from +z. */
  function onCup(obj: THREE.Object3D, angle: number, y: number, lift = 0.02) {
    const r = cupRadiusAt(y) + lift;
    obj.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
    obj.rotation.set(0, angle, 0);
  }

  // ── LEGS: skinny, with shoes, pivoting at the cup's base. ──
  const legGeo = new THREE.CylinderGeometry(0.075, 0.09, LEG_LEN, 10); geometries.add(legGeo);
  const shoeGeo = new THREE.BoxGeometry(0.28, 0.14, 0.44); geometries.add(shoeGeo);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'Left leg' : 'Right leg';
    pivot.position.set(side * 0.27, CUP_Y + 0.04, 0.02); hull.add(pivot);
    mesh(pivot, legGeo, legMat, [0, -LEG_LEN / 2, 0]);
    const shoe = mesh(pivot, shoeGeo, shoeMat, [0, -LEG_LEN + 0.03, 0.1]); shoe.name = 'Shoe';
    legs.push(pivot);
  }

  // ── THE CUP: a tapered cylinder, flared at the rim, with a dark inner lip. ──
  const cupGeo = new THREE.CylinderGeometry(R_TOP, R_BOT, CUP_H, 28); geometries.add(cupGeo);
  const cup = mesh(hull, cupGeo, cupMat, [0, CUP_Y + CUP_H / 2, 0]); cup.name = 'Cup';
  const baseGeo = new THREE.CylinderGeometry(R_BOT + 0.02, R_BOT + 0.02, 0.07, 28); geometries.add(baseGeo);
  mesh(cup, baseGeo, cupDarkMat, [0, -CUP_H / 2 + 0.03, 0], [1, 1, 1], false);
  // The fast-food stripe, BELOW the mouth so the face reads on clean white.
  const stripeR = cupRadiusAt(STRIPE_Y);
  const stripeGeo = new THREE.CylinderGeometry(stripeR + 0.015, stripeR - 0.01, 0.2, 28); geometries.add(stripeGeo);
  const stripe = mesh(cup, stripeGeo, stripeMat, [0, STRIPE_Y - (CUP_Y + CUP_H / 2), 0], [1, 1, 1], false); stripe.name = 'Stripe';
  // The dark inside of the cup, seen once the lid has blown off.
  const innerGeo = new THREE.CylinderGeometry(R_TOP - 0.05, R_TOP - 0.05, 0.16, 28); geometries.add(innerGeo);
  const inside = mesh(cup, innerGeo, toxicDarkMat, [0, CUP_H / 2 - 0.05, 0], [1, 1, 1], false); inside.name = 'Inside';

  // ── THE LID: rim, disc, and the toxic shake doming up under the clear top. ──
  const top = new THREE.Group(); top.name = 'Lid'; top.position.y = TOP_Y; body.add(top);
  const rimGeo = new THREE.CylinderGeometry(R_TOP + 0.06, R_TOP + 0.02, 0.1, 28); geometries.add(rimGeo);
  mesh(top, rimGeo, lidDarkMat, [0, -0.02, 0]);
  const lidGeo = new THREE.CylinderGeometry(R_TOP + 0.04, R_TOP + 0.06, 0.07, 28); geometries.add(lidGeo);
  const lid = mesh(top, lidGeo, lidMat, [0, 0.06, 0]); lid.name = 'Lid disc';
  const domeGeo = new THREE.SphereGeometry(R_TOP - 0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); geometries.add(domeGeo);
  const dome = mesh(top, domeGeo, toxicMat, [0, 0.09, 0], [1, 0.42, 1]); dome.name = 'Toxic dome';
  // Bubbles that rise through the dome in the idle.
  const bubbles: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const b = mesh(top, sphere, toxicGlowMat, [0, 0.2, 0], [0.07, 0.07, 0.07], false); b.visible = false; bubbles.push(b); }

  // ── THE STRAW: fat barber-striped riser, a corrugated elbow, a nozzle bent toward the player. ──
  const straw = new THREE.Group(); straw.name = 'Straw'; top.add(straw);
  const STRAW_AT: [number, number, number] = [-0.16, 0.1, 0.12];
  straw.position.set(...STRAW_AT);
  const STRAW_R = 0.095, SEG = 0.12;
  const segGeo = new THREE.CylinderGeometry(STRAW_R, STRAW_R, SEG, 12); geometries.add(segGeo);
  for (let i = 0; i < 4; i++) mesh(straw, segGeo, i % 2 ? strawWhiteMat : strawRedMat, [0, SEG * (i + 0.5), 0], [1, 1, 1], i % 2 === 0);
  const elbow = new THREE.Group(); elbow.name = 'Straw elbow'; elbow.position.y = SEG * 4; straw.add(elbow);
  const ringGeo = new THREE.TorusGeometry(STRAW_R, 0.03, 8, 16); geometries.add(ringGeo);
  for (let r = 0; r < 3; r++) { const ring = mesh(elbow, ringGeo, strawRedMat, [0, r * 0.05, 0], [1, 1, 1], false); ring.rotation.x = Math.PI / 2; }
  const nozzle = new THREE.Group(); nozzle.name = 'Straw nozzle'; nozzle.position.y = 0.12; elbow.add(nozzle);
  const NOZZLE_REST: [number, number, number] = [0.62, 0, -0.28];
  nozzle.rotation.set(...NOZZLE_REST);
  for (let i = 0; i < 4; i++) mesh(nozzle, segGeo, i % 2 ? strawRedMat : strawWhiteMat, [0, SEG * (i + 0.5), 0], [1, 1, 1], i % 2 === 1);
  const strawTip = new THREE.Group(); strawTip.name = 'Straw tip'; strawTip.position.y = SEG * 4; nozzle.add(strawTip);
  const tipRingGeo = new THREE.TorusGeometry(STRAW_R, 0.022, 6, 16); geometries.add(tipRingGeo);
  const tipRing = mesh(strawTip, tipRingGeo, strawRedMat, [0, 0, 0], [1, 1, 1], false); tipRing.rotation.x = Math.PI / 2;

  // ── THE FACE, every feature sat ON the cup's surface (the first bake buried the eyes inside it). ──
  const face = new THREE.Group(); face.name = 'Face'; hull.add(face);
  const eyes: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [], brows: THREE.Mesh[] = [], xeyes: THREE.Group[] = [];
  const EYE_ANGLE = 0.3;
  for (const side of [-1, 1]) {
    const e = mesh(face, sphere, whiteMat, [0, 0, 0], [0.19, 0.24, 0.08]); onCup(e, side * EYE_ANGLE, FACE_Y, 0.03); eyes.push(e);
    const p = mesh(e, sphere, inkMat, [side * 0.1, -0.02, 0.6], [0.5, 0.42, 0.5], false); pupils.push(p);
    const b = mesh(face, cube, inkMat, [0, 0, 0], [0.34, 0.075, 0.04], false); onCup(b, side * EYE_ANGLE, BROW_Y, 0.04); b.rotation.z = side * -0.28; brows.push(b);
    // X eyes for the death: two crossed ink bars, hidden until then.
    const x = new THREE.Group(); onCup(x, side * EYE_ANGLE, FACE_Y, 0.06); face.add(x); x.visible = false;
    for (const rz of [Math.PI / 4, -Math.PI / 4]) { const bar = mesh(x, cube, inkMat, [0, 0, 0], [0.3, 0.07, 0.03], false); bar.rotation.z = rz; }
    xeyes.push(x);
  }
  // The mouth: a wide smirk at rest, a dark gaping cavity with a tongue when it gargles/sprays.
  const smirkGeo = new THREE.TorusGeometry(0.3, 0.045, 8, 20, Math.PI * 0.9); geometries.add(smirkGeo);
  const smirk = mesh(face, smirkGeo, inkMat, [0, 0, 0], [1, 0.6, 1], false); smirk.name = 'Smirk';
  onCup(smirk, 0.04, MOUTH_Y, 0.03); smirk.rotation.z = Math.PI + 0.12;
  const mouth = new THREE.Group(); mouth.name = 'Mouth'; face.add(mouth); onCup(mouth, 0, MOUTH_Y - 0.02, 0.05); mouth.visible = false;
  mesh(mouth, sphere, mouthMat, [0, 0, 0], [0.3, 0.22, 0.08]);
  mesh(mouth, sphere, tongueMat, [0, -0.08, 0.03], [0.16, 0.08, 0.06], false);

  // ── THE GLOVES: elbow-length yellow rubber, a flared cuff, a mitt with fingers and a thumb. ──
  const sleeveGeo = new THREE.CylinderGeometry(0.085, 0.11, 0.5, 12); geometries.add(sleeveGeo);
  const cuffGeo = new THREE.CylinderGeometry(0.16, 0.12, 0.12, 12); geometries.add(cuffGeo);
  const handGeo = new THREE.BoxGeometry(0.26, 0.28, 0.16); geometries.add(handGeo);
  const fingerGeo = new THREE.BoxGeometry(0.07, 0.14, 0.1); geometries.add(fingerGeo);
  function makeGloveArm(name: string, side: number) {
    const pivot = new THREE.Group(); pivot.name = name; hull.add(pivot);
    pivot.position.set(side * (cupRadiusAt(1.9) + 0.04), 1.9, ARM_Z);
    const stub = mesh(pivot, sphere, cupMat, [0, 0, 0], [0.11, 0.11, 0.11]); stub.name = 'Shoulder';
    const sleeve = mesh(pivot, sleeveGeo, gloveMat, [side * 0.05, -0.28, 0]); sleeve.rotation.z = side * -0.12;
    mesh(sleeve, cuffGeo, gloveCuffMat, [0, 0.2, 0]);
    const hand = mesh(sleeve, handGeo, gloveMat, [0, -0.36, 0.02]); hand.name = 'Mitt';
    for (let i = 0; i < 3; i++) mesh(hand, fingerGeo, gloveMat, [(i - 1) * 0.085, -0.18, 0.01], [1, 1, 1], true);
    const thumb = mesh(hand, fingerGeo, gloveDarkMat, [side * -0.15, -0.02, 0.03], [0.9, 0.8, 0.9]); thumb.rotation.z = side * 0.7;
    return { pivot, sleeve, hand, thumb };
  }
  const leftArm = makeGloveArm('Left arm', -1);
  const rightArm = makeGloveArm('Right arm', 1);
  const arms = [leftArm.pivot, rightArm.pivot];

  // ── TOXIC SPRAY: a cone of globules hosed toward the player from the straw and the mouth. ──
  const spray = new THREE.Group(); spray.name = 'Toxic spray'; root.add(spray);
  const SPRAY_COUNT = 14;
  const dropGeo = new THREE.SphereGeometry(1, 10, 8); geometries.add(dropGeo);
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const mat = i % 3 === 0 ? toxicGlowMat : i % 3 === 1 ? toxicMat : toxicDarkMat;
    const d = mesh(spray, dropGeo, mat, [0, 0, 0], [0.12, 0.12, 0.12], i % 3 !== 0); d.visible = false;
  }

  // ── THE DEATH: shake gushing from the open cup, and the puddle it spreads into. ──
  const gush = new THREE.Group(); gush.name = 'Gush'; root.add(gush);
  const GUSH = 9;
  for (let i = 0; i < GUSH; i++) { const g = mesh(gush, dropGeo, i % 2 ? toxicMat : toxicGlowMat, [0, 0, 0], [0.1, 0.1, 0.1], false); g.visible = false; }
  const puddle = new THREE.Group(); puddle.name = 'Spilled puddle'; root.add(puddle);
  const puddleGeo = new THREE.CylinderGeometry(1, 1, 0.03, 28); geometries.add(puddleGeo);
  const mainPuddle = mesh(puddle, puddleGeo, toxicMat, [0.55, 0.015, 0.35], [1, 1, 1], false); mainPuddle.name = 'Main puddle';
  const PUDDLE_SPLATS = 8;
  const splats: THREE.Mesh[] = [];
  for (let i = 0; i < PUDDLE_SPLATS; i++) {
    const s = mesh(puddle, puddleGeo, i % 2 ? toxicGlowMat : toxicDarkMat, [0, 0.02, 0], [0.12, 1, 0.12], false); s.visible = false; splats.push(s);
  }

  /** Face cheat for the side bake; see `setFacing`. */
  let faceYaw = 0;

  function reset() {
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
    hull.position.set(0, 0, 0); hull.rotation.set(0, 0, 0);
    cup.scale.set(1, 1, 1); cup.position.set(0, CUP_Y + CUP_H / 2, 0); cup.rotation.set(0, 0, 0);
    top.position.set(0, TOP_Y, 0); top.rotation.set(0, 0, 0); top.scale.set(1, 1, 1);
    dome.scale.set(1, 0.42, 1); dome.position.y = 0.09;
    bubbles.forEach((b) => { b.visible = false; });
    straw.rotation.set(0, 0, 0); straw.position.set(...STRAW_AT);
    nozzle.rotation.set(...NOZZLE_REST);
    face.position.set(0, 0, 0); face.scale.set(1, 1, 1); face.rotation.set(0, faceYaw, 0);
    // `visible` too: the death hides the eyes for the X's, and the bake runs
    // S's death straight into N's and E's idle — E baked eyeless once.
    eyes.forEach((e, i) => { onCup(e, (i === 0 ? -1 : 1) * EYE_ANGLE, FACE_Y, 0.03); e.scale.set(0.19, 0.24, 0.08); e.visible = true; });
    pupils.forEach((p, i) => p.position.set((i === 0 ? -1 : 1) * 0.1, -0.02, 0.6));
    brows.forEach((b, i) => { onCup(b, (i === 0 ? -1 : 1) * EYE_ANGLE, BROW_Y, 0.04); b.rotation.z = (i === 0 ? 1 : -1) * -0.28; });
    xeyes.forEach((x) => { x.visible = false; });
    onCup(smirk, 0.04, MOUTH_Y, 0.03); smirk.rotation.z = Math.PI + 0.12; smirk.scale.set(1, 0.6, 1); smirk.visible = true;
    onCup(mouth, 0, MOUTH_Y - 0.02, 0.05); mouth.visible = false; mouth.scale.setScalar(1);
    for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
      arm.pivot.rotation.set(ARM_REST_X, 0, side * 0.1); arm.pivot.position.set(side * (cupRadiusAt(1.9) + 0.04), 1.9, ARM_Z);
    }
    legs.forEach((l, i) => { l.rotation.set(0, 0, 0); l.position.set((i === 0 ? -1 : 1) * 0.27, CUP_Y + 0.04, 0.02); });
    spray.visible = false; spray.children.forEach((c) => { c.visible = false; });
    gush.visible = false; gush.children.forEach((c) => { c.visible = false; });
    puddle.visible = false; splats.forEach((s) => { s.visible = false; });
  }

  /**
   * Cheat the face toward the camera for a yawed bake. At the E facing's
   * three-quarter yaw the eyes would otherwise sit at the cup's silhouette
   * edge, half hidden; classic cartoon rigs slide the face round the head
   * instead. The back (N) gets no cheat — it IS the back of the cup.
   */
  function setFacing(yaw: number) {
    const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    faceYaw = Math.abs(wrapped) < Math.PI * 0.6 ? -wrapped * FACE_CHEAT : 0;
    face.rotation.y = faceYaw;
  }

  /** Pose the Toxic Shake at `t` (0..1) through `clip`. */
  function pose(clip: MilkshakePose, t: number) {
    reset();
    if (clip === 'idle') {
      const ph = t * Math.PI * 2;
      // A breathing bob with the lid riding a beat behind, a knee shift, twitchy gloves.
      body.position.y = 0.03 * Math.sin(ph);
      top.position.y = TOP_Y + 0.02 * Math.sin(ph - 0.6);
      hull.rotation.z = 0.02 * Math.sin(ph);
      straw.rotation.z = 0.08 * Math.sin(ph + 0.5); straw.rotation.x = 0.05 * Math.cos(ph);
      legs[0].rotation.x = 0.04 * Math.sin(ph); legs[1].rotation.x = -0.04 * Math.sin(ph);
      leftArm.pivot.rotation.z = 0.1 + 0.08 * Math.sin(ph); rightArm.pivot.rotation.z = -0.1 - 0.08 * Math.sin(ph + 1);
      leftArm.pivot.rotation.x = ARM_REST_X + 0.1 * Math.sin(ph); rightArm.pivot.rotation.x = ARM_REST_X - 0.1 * Math.sin(ph + 0.7);
      brows.forEach((b, i) => { b.rotation.z += (i === 0 ? 1 : -1) * 0.06 * Math.sin(ph); });
      // Shake bubbling under the lid: three bubbles rising through the dome in turn.
      bubbles.forEach((b, i) => {
        const u = (t + i / 3) % 1;
        b.visible = u < 0.7; const a = i * 2.1;
        b.position.set(Math.cos(a) * 0.28, 0.1 + 0.22 * u, Math.sin(a) * 0.22); b.scale.setScalar(0.05 + 0.05 * u);
      });
    } else if (clip === 'walk') {
      // A cocky strut: legs stride, the cup rocks and leans in, gloves counter-swing, the straw whips.
      const ph = t * Math.PI * 2;
      const stride = 0.72;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * Math.PI) * stride; });
      body.position.y = Math.abs(Math.sin(ph)) * 0.1;
      hull.rotation.x = 0.07; hull.rotation.z = 0.09 * Math.sin(ph);
      top.rotation.x = 0.07; top.rotation.z = 0.09 * Math.sin(ph); top.position.y = TOP_Y + 0.02 * Math.sin(ph * 2 - 0.8);
      leftArm.pivot.rotation.x = ARM_REST_X - Math.sin(ph) * 0.7; rightArm.pivot.rotation.x = ARM_REST_X + Math.sin(ph) * 0.7;
      leftArm.pivot.rotation.z = 0.2 + 0.1 * Math.abs(Math.sin(ph)); rightArm.pivot.rotation.z = -0.2 - 0.1 * Math.abs(Math.sin(ph));
      straw.rotation.z = -0.14 * Math.sin(ph); straw.rotation.x = -0.1 * Math.cos(ph);
      brows.forEach((b, i) => { b.rotation.z += (i === 0 ? 1 : -1) * -0.1; });
    } else if (clip === 'attack') {
      // Rear back and gargle (the cup swells, the mouth gapes), then lunge and
      // hose a cone of toxic shake at the player from the straw AND the mouth.
      const windup = ease(t / 0.22) * (1 - ease((t - 0.2) / 0.1));
      const lunge = ease((t - 0.24) / 0.12) * (1 - ease((t - 0.82) / 0.18));
      const firing = t >= 0.3 && t < 0.86;
      const fire = firing ? (t - 0.3) / 0.56 : 0;
      hull.rotation.x = -0.22 * windup + 0.3 * lunge;
      top.rotation.x = hull.rotation.x;
      body.position.z = -0.1 * windup + 0.22 * lunge;
      body.position.y = 0.06 * windup;
      // The gargle: squash the cup, bulge the dome, the lid lifts a crack.
      const swell = windup * (1 - lunge) + 0.35 * hump(t, 0.3, 0.86);
      cup.scale.set(1 + 0.12 * swell, 1 - 0.07 * swell, 1 + 0.12 * swell);
      cup.position.y = CUP_Y + (CUP_H * cup.scale.y) / 2;
      top.position.y = TOP_Y - CUP_H * 0.07 * swell + 0.06 * windup;
      dome.scale.set(1 + 0.15 * swell, 0.42 + 0.2 * swell, 1 + 0.15 * swell);
      // The straw rides the bulge rather than sinking into it.
      straw.position.y = STRAW_AT[1] + 0.22 * swell;
      // Face: brows knot, the smirk gives way to a gaping mouth, eyes narrow at the target.
      const gape = Math.max(windup, lunge, fire > 0 ? 1 : 0);
      smirk.visible = gape < 0.35; mouth.visible = gape >= 0.35; mouth.scale.set(1 + 0.3 * gape, 0.7 + 0.8 * gape, 1);
      brows.forEach((b, i) => { b.rotation.z = (i === 0 ? 1 : -1) * (-0.28 + 0.75 * gape); b.position.y -= 0.06 * gape; });
      eyes.forEach((e) => { e.scale.y = 0.24 * (1 - 0.25 * lunge); });
      // Straw levels at the player; the yellow gloves come up and thrust forward.
      straw.rotation.x = -0.25 * windup + 0.2 * lunge;
      nozzle.rotation.x = NOZZLE_REST[0] + 0.35 * lunge;
      for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
        arm.pivot.rotation.x = 0.5 * windup - 1.35 * lunge;
        arm.pivot.rotation.z = side * (0.1 + 0.55 * windup - 0.15 * lunge);
        arm.pivot.rotation.y = side * -0.35 * lunge;
      }
      legs.forEach((l, i) => { l.rotation.x = (i === 0 ? -0.3 : 0.3) * lunge; });
      // The spray: two streams (straw and mouth) fanning out toward +z, arcing down toward the player.
      spray.visible = firing;
      if (firing) {
        spray.children.forEach((d, i) => {
          const fromStraw = i % 2 === 0;
          const u = clamp01(fire * 1.6 - i * 0.055);
          const lane = ((i >> 1) - (SPRAY_COUNT / 2 - 1) / 2) / (SPRAY_COUNT / 2);
          const ox = fromStraw ? -0.16 : 0, oy = fromStraw ? 2.95 : MOUTH_Y + 0.1, oz = fromStraw ? 0.5 : 0.75;
          // Travel is capped at ~1.5 units: the E bake turns +z into screen x,
          // and a longer volley would set the shared rect's width for every frame.
          d.position.set(ox + lane * (0.3 + 1.3 * u), oy + 0.35 * u - 1.1 * u * u, oz + 1.5 * u);
          d.visible = u > 0 && u < 0.92;
          d.scale.setScalar((0.08 + 0.1 * Math.sin(u * Math.PI)) * (fromStraw ? 1 : 1.25) * clamp01((0.92 - u) / 0.2));
        });
      }
    } else {
      // The lid blows off, the cup buckles and topples onto its side, shake
      // gushes out into a spreading puddle; X eyes, gloves and legs flop limp.
      // Everything stays above the floor and inside ±MILKSHAKE_DEATH_HALF_WIDTH.
      const buckle = ease(t / 0.3);
      const topple = ease((t - 0.2) / 0.6);
      const crumple = ease((t - 0.35) / 0.65);
      // The lid: pops a hand's height (no higher than the straw tip, so the
      // shared rect does not grow), tumbles right and BACK, and comes to rest
      // propped behind the fallen cup's mouth, tilted up at the camera so it
      // peeks out past the rim with the straw standing off it. In front it
      // hid the face; on its edge it dipped through the floor; flat it is a
      // sliver from the dungeon's 10° camera. The cup falls mouth-RIGHT (+x)
      // because +x is AWAY from the camera in the E bake, which keeps the lid
      // behind the cup from that angle as well.
      const fly = ease(t / 0.75);
      top.position.set(0.45 * fly, TOP_Y + 0.35 * Math.sin(fly * Math.PI) - (TOP_Y - 0.62) * fly, -0.55 * fly);
      top.rotation.set(0.9 * fly, 0, -0.3 * fly);
      top.scale.setScalar(1 - 0.1 * fly);
      dome.scale.y = 0.42 * (1 - 0.6 * fly);
      bubbles.forEach((b) => { b.visible = false; });
      // The cup buckles, then goes over onto its side — mouth to the right,
      // feet to the left — and crumples. `hull` rolls about its feet, so it
      // is slid left and lifted to keep the rim on the floor, not through it.
      const roll = -Math.PI * 0.46 * topple;
      hull.rotation.z = -0.12 * buckle + roll;
      hull.rotation.x = 0.08 * buckle;
      // The slide leads the roll (sqrt), or the rim swings out past the rect half-way over.
      hull.position.set(-1.12 * Math.sqrt(topple), 0.9 * topple, 0.1 * topple);
      cup.scale.set(1 + 0.02 * crumple, 1 - 0.32 * crumple, 1 - 0.3 * crumple);
      cup.position.y = CUP_Y + (CUP_H * cup.scale.y) / 2 + 0.03;
      cup.rotation.y = -0.2 * crumple;
      // The crumple shortens the cup about its middle; slide the face down with
      // the rim or the eyes end up floating past the mouth, over the lid.
      face.position.y = -CUP_H * (1 - cup.scale.y) * 0.75;
      // Face: a shocked gape, then X eyes once it is down.
      smirk.visible = false; mouth.visible = true; mouth.scale.set(1.1, 1 + 0.4 * buckle, 1);
      const out = topple > 0.75;
      eyes.forEach((e) => { e.visible = !out; e.scale.y = 0.24 * (1 - 0.3 * buckle); });
      xeyes.forEach((x) => { x.visible = out; });
      brows.forEach((b, i) => { b.rotation.z = (i === 0 ? -1 : 1) * 0.5 * buckle; });
      // Gloves flail FORWARD (toward the camera) and end up reaching out along
      // the floor. Driven by the topple, not the crumple: the low shoulder
      // is on the floor once the hull is over, so a glove still hanging
      // "down" at that point would swing through it.
      for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
        // The roll turns local -x into UP: the low (right) glove swings that
        // way to clear the floor; the high (left) one droops the other way,
        // over the cup, rather than reaching for the ceiling.
        arm.pivot.rotation.z = side * 0.1 * (1 - topple) + (side > 0 ? -0.6 : 0.25) * topple;
        arm.pivot.rotation.x = 0.35 * buckle * (1 - topple) - 1.75 * topple;
      }
      legs.forEach((l, i) => { l.rotation.x = (i === 0 ? 0.9 : 0.35) * topple; l.rotation.z = (i === 0 ? 0.25 : -0.35) * crumple; });
      // The gush: shake pouring out of the cup's open mouth (now at the right), up, over and down.
      const gushT = ease((t - 0.15) / 0.7);
      gush.visible = gushT > 0 && t < 0.95;
      gush.children.forEach((g, i) => {
        const u = clamp01(gushT * 1.5 - i * 0.07);
        const a = (i / GUSH) * 1.4 - 0.7;
        g.position.set(0.5 + 0.8 * u + 0.2 * Math.sin(a), 0.95 + 0.5 * Math.sin(u * Math.PI) - 0.85 * u, 0.3 + 0.5 * u * Math.cos(a));
        g.visible = u > 0 && u < 1;
        g.scale.setScalar(0.07 + 0.09 * (1 - u));
      });
      // The puddle spreads from the mouth end; splats fan out but stay inside the rect.
      const puddleT = ease((t - 0.3) / 0.7);
      puddle.visible = puddleT > 0;
      mainPuddle.position.set(0.55, 0.015, 0.35);
      mainPuddle.scale.set(0.2 + 0.7 * puddleT, 1, 0.15 + 0.75 * puddleT);
      splats.forEach((s, i) => {
        const a = (i / PUDDLE_SPLATS) * Math.PI * 2 + 0.4;
        const rr = (0.85 + (i % 3) * 0.12) * puddleT;
        s.position.set(0.55 + Math.cos(a) * rr * 0.75, 0.02, 0.35 + Math.sin(a) * rr * 0.55);
        s.visible = puddleT > 0.35;
        const k = 0.1 + 0.08 * (i % 3) * clamp01((puddleT - 0.35) / 0.65);
        s.scale.set(k, 1, k);
      });
    }
  }

  function dispose() {
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    ramp.dispose();
    root.removeFromParent();
  }

  pose('idle', 0);
  return {
    root, body, hull, cup, top, lid, dome, straw, elbow, nozzle, strawTip, face, eyes, pupils, brows, xeyes, smirk, mouth,
    leftArm, rightArm, arms, legs, spray, gush, puddle, pose, reset, setFacing, dispose,
  };
}
