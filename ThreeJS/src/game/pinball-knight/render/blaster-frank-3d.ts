/**
 * BLASTER FRANK, AS A 3D RIG — the source of the published
 * `blaster_frank-{S,N,E}` sheets.
 *
 * Built like the Fry Sentinel (render/fries-3d.ts) and the Toxic Shake
 * (render/milkshake-3d.ts): a hand-authored Three.js model with
 * `pose(clip, t)`, rendered by scripts/blaster-frank-bake.html into the
 * gameplay atlases and published by scripts/bake-blaster-frank.mjs. The
 * pixel sheet it replaces (docs/art/blaster-frank/sprite-sheet.png) is the
 * SHAPE SPEC, one row per clip:
 *
 *   row 1  idle    stout, chest heaving, spectacles, snub-nose revolver twitching at the hip
 *   row 2  walk    a frantic waddle — stubby legs pump, coat tails flap, arms and gun swing
 *   row 3  attack  raises the revolver straight up and empties it into the ceiling: three
 *                  muzzle flashes, recoil, smoke, a yelling grimace ("so anyway, I started blastin'")
 *   row 4  death   dizzy spirals in the glasses, drops the smoking gun, keels over backwards
 *                  and lands on his back, X eyes and stars
 *
 * The creature is a short, rotund, balding man: bald skin dome with grey
 * side tufts, thick round spectacles, moustache, a tan trenchcoat hanging
 * open over a green shirt and a belly, brown trousers, big dark shoes, and
 * a chrome snub-nosed revolver in the right hand. Every face feature sits ON
 * the head sphere (`onHead`) so a yawed bake keeps them on the surface, and
 * `setFacing` slides the face round toward the camera for the E bake.
 *
 * Sizing rule (learned on the Toxic Shake): the bake registers every frame
 * with ONE shared rect, so anything the attack or death draws outside the
 * idle's box shrinks the standing man. The raised gun's flash stays close
 * over the head and the fall stays inside ±BLASTER_FRANK_DEATH_HALF_WIDTH.
 *
 * Model space: feet on y=0, ~2.7 units tall. +z is TOWARD THE CAMERA for the
 * S facing; the bake yaws the root for N and E.
 */
import * as THREE from 'three';

export const BLASTER_FRANK_SHEET = 'blaster_frank';
export type BlasterFrankPose = 'idle' | 'walk' | 'attack' | 'death';
export const BLASTER_FRANK_CLIPS: readonly BlasterFrankPose[] = ['idle', 'walk', 'attack', 'death'];

/**
 * Frames per clip, against engine/config.ts anim rates (idle 3, walk 8,
 * attack 12, death 6 fps). `death` is 5 so it FINISHES inside the 0.96 s that
 * sandbox-all-monsters-death-trace.test.ts simulates.
 */
export const BLASTER_FRANK_FRAMES: Record<BlasterFrankPose, number> = { idle: 6, walk: 8, attack: 12, death: 5 };
export const BLASTER_FRANK_LOOPS: Record<BlasterFrankPose, boolean> = { idle: true, walk: true, attack: false, death: false };

/** Colours read off docs/art/blaster-frank/sprite-sheet.png. */
export const BLASTER_FRANK_PALETTE = {
  ink: '#1b1512',
  skin: '#f1c39a',
  skinDark: '#d39c70',
  coat: '#cbb387',
  coatDark: '#a38c5f',
  shirt: '#2f7d3e',
  shirtDark: '#1f5a2c',
  pants: '#5b3d25',
  shoe: '#2a1c14',
  hair: '#8f8f8f',
  hairDark: '#5a5a5a',
  steel: '#b9c1c9',
  steelDark: '#6a727d',
  grip: '#4a2b1b',
  lens: '#d6ecff',
  flash: '#ffe14d',
  flashHot: '#ff8c1a',
  smoke: '#a0a0a0',
  star: '#ffd23f',
  white: '#ffffff',
};

/** The death must stay inside this half-width so the shared registration rect stays tight. */
export const BLASTER_FRANK_DEATH_HALF_WIDTH = 1.45;

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
const hump = (t: number, a: number, b: number) => { const u = (t - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI); };

// ── PROPORTIONS ──
const HIP_Y = 0.78, LEG_LEN = 0.62;
const BELLY_Y = 1.36;
const SHOULDER_Y = 1.78, SHOULDER_X = 0.6;
const HEAD_Y = 2.28, HEAD_R = 0.42;
/** How far the face slides round toward the camera per radian of bake yaw; see `setFacing`. */
const FACE_CHEAT = 0.35;
/** The three shots of the volley: [start, end) in clip time. */
export const BLASTER_FRANK_SHOTS: readonly [number, number][] = [[0.3, 0.4], [0.47, 0.57], [0.64, 0.74]];

export function createBlasterFrank() {
  const root = new THREE.Group(); root.name = 'Blaster Frank';
  const body = new THREE.Group(); body.name = 'Body'; root.add(body);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  const ramp = new THREE.DataTexture(new Uint8Array([60, 130, 215, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  function toon(color: string) { const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); materials.add(m); return m; }
  function flat(color: string, side: THREE.Side = THREE.FrontSide, opacity = 1) {
    const m = new THREE.MeshBasicMaterial({ color, side, transparent: opacity < 1, opacity }); materials.add(m); return m;
  }

  const P = BLASTER_FRANK_PALETTE;
  const skinMat = toon(P.skin), skinDarkMat = toon(P.skinDark);
  const coatMat = toon(P.coat), coatDarkMat = toon(P.coatDark);
  const shirtMat = toon(P.shirt), shirtDarkMat = toon(P.shirtDark);
  const pantsMat = toon(P.pants), shoeMat = toon(P.shoe);
  const hairMat = toon(P.hair), hairDarkMat = toon(P.hairDark);
  const steelMat = toon(P.steel), steelDarkMat = toon(P.steelDark), gripMat = toon(P.grip);
  const lensMat = flat(P.lens, THREE.FrontSide, 0.45);
  const flashMat = flat(P.flash), flashHotMat = flat(P.flashHot), smokeMat = flat(P.smoke, THREE.FrontSide, 0.8), starMat = flat(P.star);
  const whiteMat = flat(P.white), inkMat = flat(P.ink);
  const outline = flat(P.ink, THREE.BackSide);

  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const sphere = new THREE.SphereGeometry(1, 18, 14); geometries.add(sphere);
  const INK = 1.06;

  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], inkShell = true) {
    const m = new THREE.Mesh(geo, material); m.position.set(position[0], position[1], position[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m);
    if (inkShell) { const edge = new THREE.Mesh(geo, outline); edge.scale.setScalar(INK); m.add(edge); }
    return m;
  }

  // ── LEGS: stubby trouser cylinders with big shoes, pivoting at the hips. ──
  const legGeo = new THREE.CylinderGeometry(0.15, 0.17, LEG_LEN, 12); geometries.add(legGeo);
  const shoeGeo = new THREE.BoxGeometry(0.3, 0.16, 0.5); geometries.add(shoeGeo);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'Left leg' : 'Right leg';
    pivot.position.set(side * 0.24, HIP_Y, 0); body.add(pivot);
    mesh(pivot, legGeo, pantsMat, [0, -LEG_LEN / 2, 0]);
    const shoe = mesh(pivot, shoeGeo, shoeMat, [0, -LEG_LEN - 0.02, 0.1]); shoe.name = 'Shoe';
    legs.push(pivot);
  }

  // ── TORSO: the belly in a green shirt, a belt, and the trenchcoat hanging open round it. ──
  const torso = new THREE.Group(); torso.name = 'Torso'; torso.position.y = HIP_Y; body.add(torso);
  const belly = mesh(torso, sphere, shirtMat, [0, BELLY_Y - HIP_Y, 0.06], [0.6, 0.56, 0.5]); belly.name = 'Belly';
  const beltGeo = new THREE.CylinderGeometry(0.56, 0.5, 0.12, 20); geometries.add(beltGeo);
  mesh(torso, beltGeo, shoeMat, [0, 0.16, 0.02]);
  const buckle = mesh(torso, cube, steelMat, [0, 0.16, 0.5], [0.12, 0.09, 0.05], true); buckle.name = 'Buckle';
  // The coat: a tan shell sat back so the belly shows through the open front, lapels, and two tails.
  const coat = mesh(torso, sphere, coatMat, [0, BELLY_Y - HIP_Y + 0.02, -0.12], [0.7, 0.64, 0.5]); coat.name = 'Coat';
  const lapelGeo = new THREE.BoxGeometry(0.22, 0.62, 0.06); geometries.add(lapelGeo);
  for (const side of [-1, 1]) {
    const l = mesh(torso, lapelGeo, coatMat, [side * 0.36, 0.72, 0.42]); l.rotation.z = side * 0.28; l.rotation.y = side * -0.35;
    mesh(l, cube, coatDarkMat, [side * -0.05, 0.22, 0.02], [0.14, 0.18, 0.04], false);
  }
  const collar = mesh(torso, cube, shirtDarkMat, [0, 1.0, 0.3], [0.5, 0.1, 0.18], true); collar.name = 'Collar';
  const tailGeo = new THREE.BoxGeometry(0.34, 0.55, 0.08); geometries.add(tailGeo);
  const tails: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'Left tail' : 'Right tail';
    pivot.position.set(side * 0.24, 0.3, -0.42); torso.add(pivot);
    mesh(pivot, tailGeo, coatMat, [0, -0.28, 0]);
    tails.push(pivot);
  }

  // ── ARMS: coat sleeves with skin hands; the right hand holds the revolver. ──
  const sleeveGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.62, 12); geometries.add(sleeveGeo);
  function makeArm(name: string, side: number) {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0.02); body.add(pivot);
    mesh(pivot, sphere, coatMat, [0, 0, 0], [0.17, 0.17, 0.17]);
    const sleeve = mesh(pivot, sleeveGeo, coatMat, [side * 0.03, -0.34, 0]); sleeve.rotation.z = side * -0.08;
    mesh(sleeve, sphere, coatDarkMat, [0, -0.3, 0], [0.16, 0.06, 0.16], false);
    const hand = mesh(sleeve, sphere, skinMat, [0, -0.4, 0.02], [0.13, 0.12, 0.13]); hand.name = 'Hand';
    return { pivot, sleeve, hand };
  }
  const leftArm = makeArm('Left arm', -1);
  const rightArm = makeArm('Right arm', 1);
  const arms = [leftArm.pivot, rightArm.pivot];

  // The snub-nosed revolver: frame, cylinder, a stubby barrel, a wooden grip.
  // `gun` is built barrel-along-local -y (down the arm) and `gunAim` is the
  // pivot that swings it forward (rest) or leaves it along the raised arm
  // (attack). It hangs off the UNSCALED sleeve at the hand's position: a
  // child of the 0.13-scaled hand mesh inherits that scale, and the first
  // bake drew the revolver at 13% — invisible, muzzle in the palm.
  const gunAim = new THREE.Group(); gunAim.name = 'Gun aim'; gunAim.position.set(0.02, -0.42, 0.1); rightArm.sleeve.add(gunAim);
  const gun = new THREE.Group(); gun.name = 'Revolver'; gunAim.add(gun);
  // Rx(-π/2) turns the barrel's local -y into +z: forward, a touch downward.
  const GUN_AT_REST_X = -Math.PI / 2 + 0.25, GUN_REST_YAW = 0.7;
  mesh(gun, cube, steelMat, [0, -0.14, 0.03], [0.13, 0.36, 0.15]);
  const drumGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.17, 10); geometries.add(drumGeo);
  const drum = mesh(gun, drumGeo, steelDarkMat, [0, -0.12, 0.03], [1, 1, 1]); drum.rotation.z = Math.PI / 2;
  const barrelGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.26, 10); geometries.add(barrelGeo);
  mesh(gun, barrelGeo, steelMat, [0, -0.44, 0.03]);
  mesh(gun, cube, gripMat, [0, 0.09, -0.11], [0.11, 0.22, 0.14]);
  const muzzle = new THREE.Group(); muzzle.name = 'Muzzle'; muzzle.position.set(0, -0.6, 0.03); gun.add(muzzle);
  // Muzzle flash: a spiky yellow star with a hot core, hidden until the volley.
  const flash = new THREE.Group(); flash.name = 'Muzzle flash'; muzzle.add(flash); flash.visible = false;
  for (let i = 0; i < 5; i++) { const s = mesh(flash, cube, i % 2 ? flashHotMat : flashMat, [0, 0, 0], [0.08, 0.32, 0.06], false); s.rotation.z = (i / 5) * Math.PI; }
  mesh(flash, sphere, flashHotMat, [0, 0, 0], [0.12, 0.12, 0.12], false);
  // Smoke puffs after each shot, in root space so they rise regardless of the arm.
  const smoke = new THREE.Group(); smoke.name = 'Smoke'; root.add(smoke); smoke.visible = false;
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) { const p = mesh(smoke, sphere, smokeMat, [0, 0, 0], [0.1, 0.1, 0.1], false); p.visible = false; puffs.push(p); }

  // ── HEAD: bald dome, grey tufts, ears; every face feature ON the sphere. ──
  const head = new THREE.Group(); head.name = 'Head'; head.position.set(0, HEAD_Y, 0.04); body.add(head);
  const skull = mesh(head, sphere, skinMat, [0, 0, 0], [HEAD_R, HEAD_R * 1.02, HEAD_R * 0.96]); skull.name = 'Skull';
  const neckGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.22, 12); geometries.add(neckGeo);
  mesh(head, neckGeo, skinDarkMat, [0, -HEAD_R + 0.04, -0.02]);
  for (const side of [-1, 1]) {
    const tuft = mesh(head, sphere, hairMat, [side * 0.36, 0.04, -0.1], [0.15, 0.24, 0.3]); tuft.name = 'Tuft';
    mesh(tuft, sphere, hairDarkMat, [side * 0.2, -0.3, -0.2], [0.6, 0.5, 0.6], false);
    mesh(head, sphere, skinDarkMat, [side * 0.4, -0.02, 0.06], [0.07, 0.1, 0.06]);
  }
  mesh(head, sphere, hairMat, [0, 0.02, -0.36], [0.3, 0.18, 0.12]);
  const face = new THREE.Group(); face.name = 'Face'; head.add(face);
  /** Sit `obj` on the head sphere at `yaw` radians round from +z and `pitch` radians up from level. */
  function onHead(obj: THREE.Object3D, yaw: number, pitch: number, lift = 0.01) {
    const r = HEAD_R + lift;
    obj.position.set(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r);
    obj.rotation.set(-pitch, yaw, 0);
  }
  const EYE_YAW = 0.36, EYE_PITCH = 0.12;
  const eyes: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [], lenses: THREE.Mesh[] = [], brows: THREE.Mesh[] = [];
  const spirals: THREE.Group[] = [], xeyes: THREE.Group[] = [];
  const rimGeo = new THREE.TorusGeometry(0.13, 0.022, 8, 20); geometries.add(rimGeo);
  for (const side of [-1, 1]) {
    const e = mesh(face, sphere, whiteMat, [0, 0, 0], [0.1, 0.1, 0.05]); onHead(e, side * EYE_YAW, EYE_PITCH, 0.0); eyes.push(e);
    const p = mesh(e, sphere, inkMat, [side * 0.1, 0, 0.7], [0.45, 0.45, 0.5], false); pupils.push(p);
    const lens = mesh(face, sphere, lensMat, [0, 0, 0], [0.125, 0.125, 0.02], false); onHead(lens, side * EYE_YAW, EYE_PITCH, 0.07); lenses.push(lens);
    const rim = mesh(face, rimGeo, inkMat, [0, 0, 0], [1, 1, 1], false); onHead(rim, side * EYE_YAW, EYE_PITCH, 0.08);
    const b = mesh(face, cube, hairDarkMat, [0, 0, 0], [0.2, 0.05, 0.04], false); onHead(b, side * EYE_YAW, EYE_PITCH + 0.36, 0.04); b.rotation.z += side * -0.2; brows.push(b);
    // Dizzy spirals and X's for the death, hidden until then.
    const sp = new THREE.Group(); onHead(sp, side * EYE_YAW, EYE_PITCH, 0.1); face.add(sp); sp.visible = false;
    for (let k = 0; k < 3; k++) { const ring = mesh(sp, rimGeo, inkMat, [0, 0, 0], [0.75 - k * 0.24, 0.75 - k * 0.24, 1], false); ring.rotation.z = k * 0.9; }
    spirals.push(sp);
    const x = new THREE.Group(); onHead(x, side * EYE_YAW, EYE_PITCH, 0.1); face.add(x); x.visible = false;
    for (const rz of [Math.PI / 4, -Math.PI / 4]) { const bar = mesh(x, cube, inkMat, [0, 0, 0], [0.2, 0.05, 0.03], false); bar.rotation.z = rz; }
    xeyes.push(x);
  }
  const bridge = mesh(face, cube, inkMat, [0, 0, 0], [0.16, 0.03, 0.03], false); onHead(bridge, 0, EYE_PITCH + 0.02, 0.1);
  const nose = mesh(face, sphere, skinDarkMat, [0, 0, 0], [0.09, 0.08, 0.09]); onHead(nose, 0, -0.06, 0.02);
  const mustache = new THREE.Group(); onHead(mustache, 0, -0.26, 0.04); face.add(mustache);
  for (const side of [-1, 1]) { const m = mesh(mustache, sphere, hairDarkMat, [side * 0.1, 0, 0], [0.13, 0.05, 0.05], true); m.rotation.z = side * 0.25; }
  const smirkGeo = new THREE.TorusGeometry(0.12, 0.022, 8, 16, Math.PI * 0.8); geometries.add(smirkGeo);
  const smirk = mesh(face, smirkGeo, inkMat, [0, 0, 0], [1, 0.6, 1], false); smirk.name = 'Smirk';
  onHead(smirk, 0.05, -0.44, 0.03); smirk.rotation.z += Math.PI + 0.1;
  const mouth = mesh(face, sphere, inkMat, [0, 0, 0], [0.13, 0.1, 0.06]); mouth.name = 'Mouth'; onHead(mouth, 0, -0.46, 0.03); mouth.visible = false;
  mesh(mouth, sphere, flashHotMat, [0, -0.35, 0.3], [0.5, 0.35, 0.5], false);

  // ── DEATH: stars round the head, and the gun on the floor. ──
  const stars = new THREE.Group(); stars.name = 'Stars'; root.add(stars); stars.visible = false;
  const starMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const s = mesh(stars, cube, starMat, [0, 0, 0], [0.12, 0.12, 0.06], true); s.rotation.z = Math.PI / 4; starMeshes.push(s); }

  /** Face cheat for the side bake; see `setFacing`. */
  let faceYaw = 0;

  function reset() {
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
    torso.position.set(0, HIP_Y, 0); torso.rotation.set(0, 0, 0);
    belly.scale.set(0.6, 0.56, 0.5);
    head.position.set(0, HEAD_Y, 0.04); head.rotation.set(0, 0, 0);
    face.rotation.set(0, faceYaw, 0);
    legs.forEach((l, i) => { l.rotation.set(0, 0, 0); l.position.set((i === 0 ? -1 : 1) * 0.24, HIP_Y, 0); });
    tails.forEach((t) => { t.rotation.set(-0.15, 0, 0); });
    leftArm.pivot.rotation.set(0.1, 0, 0.18); rightArm.pivot.rotation.set(-0.55, 0, -0.1);
    for (const arm of [leftArm, rightArm]) arm.pivot.position.set(arm === leftArm ? -SHOULDER_X : SHOULDER_X, SHOULDER_Y, 0.02);
    // Held forward and a little OUT to the side, so the S bake sees the revolver's profile rather than its muzzle.
    gunAim.rotation.set(GUN_AT_REST_X, -GUN_REST_YAW, 0);
    // The revolver rides the hand; the death re-parents it to the floor by position.
    if (gun.parent !== gunAim) gunAim.add(gun);
    gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); gun.visible = true;
    flash.visible = false; flash.scale.setScalar(1);
    smoke.visible = false; puffs.forEach((p) => { p.visible = false; });
    eyes.forEach((e, i) => { onHead(e, (i === 0 ? -1 : 1) * EYE_YAW, EYE_PITCH, 0.0); e.scale.set(0.1, 0.1, 0.05); e.visible = true; });
    pupils.forEach((p, i) => p.position.set((i === 0 ? -1 : 1) * 0.1, 0, 0.7));
    brows.forEach((b, i) => { onHead(b, (i === 0 ? -1 : 1) * EYE_YAW, EYE_PITCH + 0.36, 0.04); b.rotation.z += (i === 0 ? -1 : 1) * -0.2; });
    spirals.forEach((s) => { s.visible = false; }); xeyes.forEach((x) => { x.visible = false; });
    smirk.visible = true; mouth.visible = false; mouth.scale.set(0.13, 0.1, 0.06);
    stars.visible = false;
  }

  /**
   * Cheat the face toward the camera for a yawed bake, the way cartoon rigs
   * slide a face round a head. Milder than the Toxic Shake's cup: a
   * three-quarter human head reads on its own, but the far spectacle rim
   * would otherwise vanish behind the nose. The back (N) gets no cheat.
   */
  function setFacing(yaw: number) {
    const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    faceYaw = Math.abs(wrapped) < Math.PI * 0.6 ? -wrapped * FACE_CHEAT : 0;
    face.rotation.y = faceYaw;
  }

  /** Where the flash is in the volley at `t`: 0 = none, else 1 at the shot's start fading to 0. */
  function shotAt(t: number) {
    for (const [a, b] of BLASTER_FRANK_SHOTS) if (t >= a && t < b) return 1 - (t - a) / (b - a);
    return 0;
  }

  /** Pose Frank at `t` (0..1) through `clip`. */
  function pose(clip: BlasterFrankPose, t: number) {
    reset();
    if (clip === 'idle') {
      const ph = t * Math.PI * 2;
      // Chest heaving, a weight shift, the gun hand twitching at double time.
      body.position.y = 0.02 * Math.sin(ph);
      belly.scale.set(0.6 + 0.02 * Math.sin(ph), 0.56 + 0.015 * Math.sin(ph), 0.5 + 0.02 * Math.sin(ph));
      torso.rotation.z = 0.025 * Math.sin(ph);
      head.rotation.z = 0.05 * Math.sin(ph + 0.8); head.rotation.y = 0.08 * Math.sin(ph * 0.5);
      legs[0].rotation.x = 0.04 * Math.sin(ph); legs[1].rotation.x = -0.04 * Math.sin(ph);
      leftArm.pivot.rotation.x = 0.1 + 0.06 * Math.sin(ph); leftArm.pivot.rotation.z = 0.18 + 0.05 * Math.sin(ph + 1);
      rightArm.pivot.rotation.x = -0.55 + 0.08 * Math.sin(ph * 2 + 0.5); rightArm.pivot.rotation.z = -0.1 - 0.06 * Math.sin(ph * 2);
      gunAim.rotation.z = 0.12 * Math.sin(ph * 2 + 1.2);
      tails.forEach((tl, i) => { tl.rotation.x = -0.15 + 0.05 * Math.sin(ph + i); });
      brows.forEach((b, i) => { b.rotation.z += (i === 0 ? -1 : 1) * 0.05 * Math.sin(ph * 2); });
    } else if (clip === 'walk') {
      // A frantic waddle: stubby legs pump, the belly bounces, arms and gun
      // swing, coat tails flap out behind, head down, mouth open and yelling.
      const ph = t * Math.PI * 2;
      const stride = 0.85;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(ph + i * Math.PI) * stride; });
      body.position.y = Math.abs(Math.sin(ph)) * 0.09;
      body.rotation.x = 0.16; body.rotation.z = 0.08 * Math.sin(ph);
      torso.rotation.y = 0.12 * Math.sin(ph);
      head.rotation.x = 0.12; head.position.y = HEAD_Y - 0.04 + 0.03 * Math.abs(Math.sin(ph * 2));
      leftArm.pivot.rotation.x = 0.1 - Math.sin(ph) * 0.7; rightArm.pivot.rotation.x = -0.55 + Math.sin(ph) * 0.5;
      leftArm.pivot.rotation.z = 0.25; rightArm.pivot.rotation.z = -0.2;
      tails.forEach((tl, i) => { tl.rotation.x = -0.55 - 0.3 * Math.abs(Math.sin(ph + i * 0.5)); tl.rotation.z = (i === 0 ? 1 : -1) * 0.15; });
      smirk.visible = false; mouth.visible = true; mouth.scale.set(0.12, 0.11, 0.06);
      brows.forEach((b, i) => { b.rotation.z += (i === 0 ? -1 : 1) * 0.25; });
    } else if (clip === 'attack') {
      // Up goes the revolver, then three shots into the ceiling: flash,
      // recoil, smoke, a yelling grimace; then it comes back down.
      const raise = ease(t / 0.25) * (1 - ease((t - 0.8) / 0.2));
      const shot = shotAt(t);
      // ~40° short of straight up (the pixel sheet's own angle): the muzzle
      // and flash then sit just over the head instead of a full arm's length
      // above it, which the shared rect would charge to every standing frame
      // (measured straight up: 72 art units standing against the fries' 89).
      rightArm.pivot.rotation.x = -0.55 + (-Math.PI + 0.55 + 0.7) * raise + 0.4 * shot;
      rightArm.pivot.rotation.z = -0.1 - 0.15 * raise;
      gunAim.rotation.x = GUN_AT_REST_X * (1 - raise); gunAim.rotation.y = -GUN_REST_YAW * (1 - raise);
      leftArm.pivot.rotation.x = 0.1 + 0.35 * raise; leftArm.pivot.rotation.z = 0.18 + 0.4 * raise;
      body.rotation.x = -0.12 * raise - 0.12 * shot;
      body.position.z = -0.08 * shot;
      torso.rotation.z = -0.06 * raise;
      head.rotation.x = -0.22 * raise - 0.1 * shot; head.rotation.z = 0.08 * raise;
      legs.forEach((l, i) => { l.rotation.x = (i === 0 ? 0.3 : -0.25) * raise; });
      tails.forEach((tl) => { tl.rotation.x = -0.15 - 0.35 * shot; });
      const yell = raise;
      smirk.visible = yell < 0.4; mouth.visible = yell >= 0.4; mouth.scale.set(0.12 + 0.08 * yell, 0.08 + 0.13 * yell, 0.06);
      brows.forEach((b, i) => { b.position.y += 0.05 * yell; b.rotation.z += (i === 0 ? 1 : -1) * 0.25 * yell; });
      eyes.forEach((e) => { e.scale.set(0.1 + 0.02 * yell, 0.1 + 0.03 * yell, 0.05); });
      flash.visible = shot > 0; flash.scale.setScalar(0.6 + 0.7 * shot);
      // Smoke: two puffs per shot, released at the shot and drifting up and back.
      const anyShot = t >= BLASTER_FRANK_SHOTS[0][0] && t < 0.95;
      smoke.visible = anyShot;
      if (anyShot) {
        const m = muzzle.getWorldPosition(new THREE.Vector3()); root.worldToLocal(m);
        puffs.forEach((p, i) => {
          const [a] = BLASTER_FRANK_SHOTS[i >> 1];
          const u = clamp01((t - a) / 0.35);
          p.visible = t >= a && u < 1;
          // Drifts back and out more than up: smoke over the muzzle is the
          // tallest thing in the volley and the rect pays for every unit of it.
          p.position.set(m.x + (i % 2 ? 0.14 : -0.12) + 0.22 * u * (i % 2 ? 1 : -1), m.y + 0.05 + 0.18 * u, m.z - 0.3 * u);
          p.scale.setScalar(0.06 + 0.1 * u);
        });
      }
    } else {
      // Dizzy first (spirals, a wobble, the gun slipping from the hand), then
      // he keels over backwards and lands flat on his back, X eyes and stars.
      const dizzy = ease(t / 0.3);
      const fall = ease((t - 0.3) / 0.5);
      const down = ease((t - 0.7) / 0.3);
      // Spirals replace the pupils while he reels; X's once he is down.
      eyes.forEach((e) => { e.visible = down < 0.5; });
      spirals.forEach((s) => { s.visible = dizzy > 0.3 && down < 0.5; });
      xeyes.forEach((x) => { x.visible = down >= 0.5; });
      smirk.visible = false; mouth.visible = true; mouth.scale.set(0.11, 0.09 + 0.05 * dizzy, 0.06);
      head.rotation.z = 0.3 * Math.sin(dizzy * Math.PI * 2) * (1 - fall); head.rotation.y = 0.25 * Math.sin(dizzy * Math.PI * 3) * (1 - fall);
      // The fall: the whole body rotates about the feet onto its back, head
      // to the LEFT (-x), slid right and lifted so the coat rests on the floor
      // and the head stays inside the rect; a small tilt turns the face at
      // the camera. Along x on purpose: the E bake sees that foreshortened
      // (cos 61°), where a fall along -z stretched him across the cell.
      body.rotation.z = 1.42 * fall;
      body.rotation.x = -0.25 * fall;
      body.position.set(1.28 * Math.sqrt(fall), 0.72 * fall, 0.05 * fall);
      legs.forEach((l, i) => { l.rotation.x = (i === 0 ? -0.5 : -0.95) * fall * (1 - 0.4 * down); l.rotation.z = (i === 0 ? 0.15 : -0.1) * fall; });
      // Arms flail while dizzy, then flop forward along the floor; the
      // sliver toward local +x is UP once he is over, so nothing dips.
      leftArm.pivot.rotation.x = 0.1 - 1.4 * dizzy * (1 - fall) - 1.4 * fall; leftArm.pivot.rotation.z = 0.18 + 1.2 * dizzy * (1 - fall) + 0.35 * fall;
      // The high (right) arm lies across the chest rather than reaching up.
      rightArm.pivot.rotation.x = -0.55 - 1.2 * dizzy * (1 - fall) - 1.2 * fall; rightArm.pivot.rotation.z = -0.1 - 1.1 * dizzy * (1 - fall) - 0.3 * fall;
      tails.forEach((tl) => { tl.rotation.x = -0.15 + 0.9 * fall; });
      head.rotation.x = -0.3 * fall;
      // The gun leaves the hand at the dizzy peak and lands in front of him, smoking.
      if (t > 0.2) {
        const drop = ease((t - 0.2) / 0.45);
        root.add(gun);
        gun.position.set(0.55 - 0.3 * drop, 0.07 + 0.9 * Math.sin(drop * Math.PI) * (1 - drop * 0.4), 0.55 + 0.45 * drop);
        gun.rotation.set(Math.PI / 2 - 0.15, 0.4 + 0.5 * drop, 0.5 + 2.2 * drop);
        smoke.visible = drop > 0.6;
        puffs.forEach((p, i) => {
          const u = clamp01((drop - 0.6 - i * 0.06) / 0.5);
          p.visible = i < 3 && u > 0 && u < 1;
          p.position.set(0.3 + 0.08 * i, 0.2 + 0.5 * u, 1.0 - 0.1 * u); p.scale.setScalar(0.06 + 0.08 * u);
        });
      }
      // Stars circle over the head once he is down, kept inside the rect.
      stars.visible = down > 0.1;
      const hp = head.getWorldPosition(new THREE.Vector3()); root.worldToLocal(hp);
      starMeshes.forEach((s, i) => {
        const a = down * 4 + (i / 3) * Math.PI * 2;
        s.position.set(hp.x + 0.12 + Math.cos(a) * 0.28, hp.y + 0.45 + 0.08 * Math.sin(a * 2), hp.z + 0.2 + Math.sin(a) * 0.25);
        s.rotation.z = Math.PI / 4 + a;
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
    root, body, torso, belly, coat, tails, head, face, eyes, pupils, lenses, brows, spirals, xeyes, smirk, mouth,
    leftArm, rightArm, arms, legs, gun, gunAim, muzzle, flash, smoke, puffs, stars, pose, reset, setFacing, shotAt, dispose,
  };
}
