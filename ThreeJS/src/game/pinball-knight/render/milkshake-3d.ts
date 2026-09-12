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
 *   row 1  idle    the white cup hovers, straw sways, yellow gloves twitch, gentle bob
 *   row 2  walk    waddles forward with side-to-side tilt, opposing glove swings, vertical bob
 *   row 3  attack  leans back, thrusts yellow gloved hands forward, sprays toxic lime globules
 *   row 4  death   cup collapses flat, yellow gloves flop limp, toxic milkshake puddle spreads
 *
 * The creature is a tapered white cup with a bold fast-food stripe band, a
 * plastic lid with bubbling toxic lime green shake inside, a bent pink-and-white
 * striped drinking straw, elbow-length yellow rubber dishwashing gloves on
 * shoulder pivots, and a cartoon face with cynical eyebrows and smirk on the
 * front face (+z side).
 *
 * Model space: base near y=0, ~2.8 units tall to straw tip. +z is TOWARD THE
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

/** Colours read off docs/art/milkshake/sprite-sheet.png and fast-food palette. */
export const MILKSHAKE_PALETTE = {
  ink: '#18181b',
  cup: '#f8fafc',
  cupDark: '#cbd5e1',
  cupStripe: '#e11d48',
  lid: '#e2e8f0',
  lidDark: '#94a3b8',
  strawPink: '#f43f5e',
  strawRed: '#be123c',
  strawWhite: '#ffffff',
  gloveYellow: '#facc15',
  gloveDark: '#ca8a04',
  gloveCuff: '#eab308',
  toxicGreen: '#84cc16',
  toxicGlow: '#a3e635',
  toxicDark: '#4d7c0f',
  white: '#ffffff',
};

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);

export function createMilkshake() {
  const root = new THREE.Group(); root.name = 'Toxic Shake';
  const body = new THREE.Group(); body.name = 'Cup Body'; root.add(body);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  const ramp = new THREE.DataTexture(new Uint8Array([60, 130, 215, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;

  function toon(color: string) { const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); materials.add(m); return m; }
  function flat(color: string, side: THREE.Side = THREE.FrontSide) { const m = new THREE.MeshBasicMaterial({ color, side }); materials.add(m); return m; }

  const cupMat = toon(MILKSHAKE_PALETTE.cup);
  const cupDarkMat = toon(MILKSHAKE_PALETTE.cupDark);
  const stripeMat = toon(MILKSHAKE_PALETTE.cupStripe);
  const lidMat = toon(MILKSHAKE_PALETTE.lid);
  const lidDarkMat = toon(MILKSHAKE_PALETTE.lidDark);
  const strawPinkMat = toon(MILKSHAKE_PALETTE.strawPink);
  const strawRedMat = toon(MILKSHAKE_PALETTE.strawRed);
  const strawWhiteMat = flat(MILKSHAKE_PALETTE.strawWhite);
  const gloveMat = toon(MILKSHAKE_PALETTE.gloveYellow);
  const gloveDarkMat = toon(MILKSHAKE_PALETTE.gloveDark);
  const gloveCuffMat = toon(MILKSHAKE_PALETTE.gloveCuff);
  const toxicMat = toon(MILKSHAKE_PALETTE.toxicGreen);
  const toxicGlowMat = flat(MILKSHAKE_PALETTE.toxicGlow);
  const toxicDarkMat = toon(MILKSHAKE_PALETTE.toxicDark);
  const whiteMat = flat(MILKSHAKE_PALETTE.white);
  const inkMat = flat(MILKSHAKE_PALETTE.ink);
  const outline = flat(MILKSHAKE_PALETTE.ink, THREE.BackSide);

  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const sphere = new THREE.SphereGeometry(1, 16, 12); geometries.add(sphere);
  const INK = 1.06;

  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], inkShell = true) {
    const m = new THREE.Mesh(geo, material); m.position.set(position[0], position[1], position[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m);
    if (inkShell) { const edge = new THREE.Mesh(geo, outline); edge.scale.setScalar(INK); m.add(edge); }
    return m;
  }

  // ── THE CUP: Tapered cylinder, wider at the top rim. ──
  const CUP_H = 1.55, CUP_Y = 0.15;
  const cupGeo = new THREE.CylinderGeometry(0.72, 0.52, CUP_H, 24); geometries.add(cupGeo);
  const cup = mesh(body, cupGeo, cupMat, [0, CUP_Y + CUP_H / 2, 0], [1, 1, 1]);
  cup.name = 'Cup cylinder';

  // Decorative stripe band around cup midsection
  const stripeGeo = new THREE.CylinderGeometry(0.65, 0.61, 0.18, 24); geometries.add(stripeGeo);
  const stripe = mesh(cup, stripeGeo, stripeMat, [0, 0, 0], [1.02, 1, 1.02], false);
  stripe.name = 'Fast-food stripe';

  // Bottom base disc
  const baseGeo = new THREE.CylinderGeometry(0.53, 0.53, 0.05, 24); geometries.add(baseGeo);
  mesh(cup, baseGeo, cupDarkMat, [0, -CUP_H / 2 + 0.02, 0], [1, 1, 1], false);

  // ── THE RIM & LID ──
  const TOP_Y = CUP_Y + CUP_H;
  const top = new THREE.Group(); top.name = 'Lid group'; top.position.y = TOP_Y; body.add(top);

  // Cup top rim lip
  const rimGeo = new THREE.CylinderGeometry(0.76, 0.74, 0.08, 24); geometries.add(rimGeo);
  mesh(top, rimGeo, cupDarkMat, [0, -0.04, 0], [1, 1, 1], true);

  // Plastic lid disc
  const lidGeo = new THREE.CylinderGeometry(0.78, 0.78, 0.06, 24); geometries.add(lidGeo);
  mesh(top, lidGeo, lidMat, [0, 0.01, 0], [1, 1, 1], true);

  // Inner translucent dome showing toxic green shake inside
  const domeGeo = new THREE.SphereGeometry(0.52, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2); geometries.add(domeGeo);
  const dome = mesh(top, domeGeo, toxicMat, [0, 0.03, 0], [1, 0.6, 1], false);
  dome.name = 'Toxic dome';

  // ── THE BENT STRAW: Corrugated pink/red/white bend straw ──
  const straw = new THREE.Group(); straw.name = 'Straw'; top.add(straw);
  straw.position.set(0.04, 0.04, 0.02);

  const strawSegGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.14, 12); geometries.add(strawSegGeo);
  // Base riser (3 alternating striped segments)
  const base1 = mesh(straw, strawSegGeo, strawPinkMat, [0, 0.07, 0], [1, 1, 1]);
  const base2 = mesh(straw, strawSegGeo, strawWhiteMat, [0, 0.20, 0], [1, 1, 1]);
  const base3 = mesh(straw, strawSegGeo, strawRedMat, [0, 0.33, 0], [1, 1, 1]);

  // Corrugated flexible elbow joint
  const elbow = new THREE.Group(); elbow.name = 'Straw elbow'; elbow.position.set(0, 0.40, 0); straw.add(elbow);
  const ringGeo = new THREE.TorusGeometry(0.068, 0.02, 8, 16); geometries.add(ringGeo);
  for (let r = 0; r < 3; r++) {
    const ring = mesh(elbow, ringGeo, strawPinkMat, [0, r * 0.04, 0], [1, 1, 1], false);
    ring.rotation.x = Math.PI / 2;
  }

  // Straw nozzle tip (bent forward and slightly angled)
  const nozzle = new THREE.Group(); nozzle.name = 'Straw nozzle'; elbow.add(nozzle);
  nozzle.position.set(0, 0.10, 0);
  nozzle.rotation.x = 0.55; // bent forward
  nozzle.rotation.z = -0.15; // characteristic slight Master Shake cocked straw angle

  const tip1 = mesh(nozzle, strawSegGeo, strawPinkMat, [0, 0.07, 0], [1, 1, 1]);
  const tip2 = mesh(nozzle, strawSegGeo, strawWhiteMat, [0, 0.20, 0], [1, 1, 1]);
  const tip3 = mesh(nozzle, strawSegGeo, strawRedMat, [0, 0.33, 0], [1, 1, 1]);

  // Straw opening rim
  const strawRimGeo = new THREE.TorusGeometry(0.065, 0.015, 6, 16); geometries.add(strawRimGeo);
  const strawRim = mesh(nozzle, strawRimGeo, strawPinkMat, [0, 0.40, 0], [1, 1, 1], false);
  strawRim.rotation.x = Math.PI / 2;

  // ── THE FACE: Expressive cartoon eyes, cynical brows, smirking mouth on +z side ──
  const face = new THREE.Group(); face.name = 'Face'; body.add(face);
  const FACE_Z = 0.62;
  const eyes: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [], brows: THREE.Mesh[] = [];

  for (const side of [-1, 1]) {
    // Sclera (oval cartoon eyes)
    const e = mesh(face, sphere, whiteMat, [side * 0.22, 1.14, FACE_Z], [0.15, 0.18, 0.06]);
    eyes.push(e);
    // Dark ink pupils
    const p = mesh(e, sphere, inkMat, [side * 0.06, 0.01, 0.55], [0.45, 0.45, 0.5], false);
    pupils.push(p);
    // Cynical / impatient angled eyebrows
    const b = mesh(face, cube, inkMat, [side * 0.22, 1.34, FACE_Z + 0.04], [0.28, 0.05, 0.03], false);
    b.rotation.z = side * -0.22; // iconic arched cynical brow
    brows.push(b);
  }

  // Smirking mouth arc
  const smirkGeo = new THREE.TorusGeometry(0.24, 0.038, 8, 20, Math.PI * 0.85); geometries.add(smirkGeo);
  const smirk = mesh(face, smirkGeo, inkMat, [0.03, 0.88, FACE_Z - 0.02], [1, 0.7, 1], false);
  smirk.name = 'Smirk'; smirk.rotation.z = Math.PI + 0.15; // slightly lopsided smirk

  // ── ARMS & HANDS: Yellow rubber dishwashing gloves on shoulder pivots ──
  function makeGloveArm(name: string, side: number) {
    const pivot = new THREE.Group(); pivot.name = name;
    pivot.position.set(side * 0.72, 1.15, 0.02);
    body.add(pivot);

    // Sleeve
    const sleeveGeo = new THREE.CylinderGeometry(0.08, 0.10, 0.44, 12); geometries.add(sleeveGeo);
    const sleeve = mesh(pivot, sleeveGeo, gloveMat, [side * 0.06, -0.22, 0], [1, 1, 1]);
    sleeve.rotation.z = side * -0.15;

    // Flared glove cuff
    const cuffGeo = new THREE.CylinderGeometry(0.13, 0.10, 0.10, 12); geometries.add(cuffGeo);
    mesh(sleeve, cuffGeo, gloveCuffMat, [0, 0.16, 0], [1, 1, 1], true);

    // Yellow rubber mitt hand
    const handGeo = new THREE.BoxGeometry(0.18, 0.22, 0.12); geometries.add(handGeo);
    const hand = mesh(sleeve, handGeo, gloveMat, [0, -0.26, 0.02], [1, 1, 1]);

    // Articulated yellow thumb
    const thumbGeo = new THREE.BoxGeometry(0.07, 0.12, 0.07); geometries.add(thumbGeo);
    const thumb = mesh(hand, thumbGeo, gloveDarkMat, [side * -0.09, 0.02, 0.04], [1, 1, 1], false);
    thumb.rotation.z = side * 0.45;

    return { pivot, sleeve, hand, thumb };
  }

  const leftArm = makeGloveArm('Left arm', -1);
  const rightArm = makeGloveArm('Right arm', 1);
  const arms = [leftArm.pivot, rightArm.pivot];

  // ── TOXIC SPRAY PROJECTILES (Attack) ──
  const spray = new THREE.Group(); spray.name = 'Toxic spray'; root.add(spray);
  const SPRAY_COUNT = 7;
  const sprayGeo = new THREE.SphereGeometry(0.13, 10, 8); geometries.add(sprayGeo);
  const spraySmallGeo = new THREE.SphereGeometry(0.08, 8, 6); geometries.add(spraySmallGeo);

  for (let i = 0; i < SPRAY_COUNT; i++) {
    const geo = i % 2 === 0 ? sprayGeo : spraySmallGeo;
    const mat = i % 3 === 0 ? toxicGlowMat : (i % 2 === 0 ? toxicMat : toxicDarkMat);
    const d = mesh(spray, geo, mat, [0, 0, 0], [1, 1, 1], false);
    d.visible = false;
  }

  // ── SPILLED PUDDLE & COLLAPSED CUP (Death) ──
  const puddle = new THREE.Group(); puddle.name = 'Spilled puddle'; root.add(puddle);
  const puddleDiscGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.02, 24); geometries.add(puddleDiscGeo);
  const mainPuddle = mesh(puddle, puddleDiscGeo, toxicMat, [0, 0.01, 0.2], [1, 1, 1], false);
  mainPuddle.name = 'Main puddle';

  const PUDDLE_SPLATS = 10;
  for (let i = 0; i < PUDDLE_SPLATS; i++) {
    const r = 0.15 + (i % 3) * 0.08;
    const splatGeo = new THREE.CylinderGeometry(r, r, 0.02, 12); geometries.add(splatGeo);
    const s = mesh(puddle, splatGeo, i % 2 === 0 ? toxicGlowMat : toxicDarkMat, [0, 0.015, 0], [1, 1, 1], false);
    s.visible = false;
  }

  function reset() {
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
    cup.scale.set(1, 1, 1); cup.position.set(0, CUP_Y + CUP_H / 2, 0); cup.rotation.set(0, 0, 0);
    top.position.set(0, TOP_Y, 0); top.rotation.set(0, 0, 0); top.scale.set(1, 1, 1);
    straw.rotation.set(0, 0, 0); straw.position.set(0.04, 0.04, 0.02);
    nozzle.rotation.set(0.55, 0, -0.15);
    face.position.set(0, 0, 0); face.scale.set(1, 1, 1); face.rotation.set(0, 0, 0);
    eyes.forEach((e) => e.scale.set(0.15, 0.18, 0.06));
    pupils.forEach((p, i) => p.position.set((i === 0 ? -1 : 1) * 0.06, 0.01, 0.55));
    brows.forEach((b, i) => { b.position.y = 1.34; b.rotation.z = (i === 0 ? 1 : -1) * 0.22; });
    smirk.rotation.set(0, 0, Math.PI + 0.15); smirk.position.set(0.03, 0.88, FACE_Z - 0.02); smirk.scale.set(1, 0.7, 1);
    leftArm.pivot.rotation.set(0, 0, 0.15); leftArm.pivot.position.set(-0.72, 1.15, 0.02);
    rightArm.pivot.rotation.set(0, 0, -0.15); rightArm.pivot.position.set(0.72, 1.15, 0.02);
    spray.visible = false; spray.children.forEach((c) => { c.visible = false; });
    puddle.visible = false; puddle.children.forEach((c) => { c.visible = false; });
  }

  /** Pose the milkshake monster at `t` (0..1) through `clip`. */
  function pose(clip: MilkshakePose, t: number) {
    reset();

    if (clip === 'idle') {
      const ph = t * Math.PI * 2;
      // Gentle vertical hover bob
      body.position.y = 0.05 * Math.sin(ph);
      // Subtle rhythmic side tilt
      body.rotation.z = 0.03 * Math.sin(ph);
      // Straw gentle sway
      straw.rotation.z = 0.05 * Math.sin(ph + 0.5);
      straw.rotation.x = 0.03 * Math.cos(ph);
      // Yellow gloved hands idle hover with subtle twitch
      leftArm.pivot.rotation.z = 0.15 + 0.06 * Math.sin(ph);
      rightArm.pivot.rotation.z = -0.15 - 0.06 * Math.sin(ph);
      leftArm.pivot.rotation.x = 0.08 * Math.sin(ph);
      rightArm.pivot.rotation.x = -0.08 * Math.sin(ph);
    } else if (clip === 'walk') {
      const ph = t * Math.PI * 2;
      // Waddling gliding cadence
      body.rotation.x = 0.07;
      body.rotation.z = 0.12 * Math.sin(ph);
      body.position.y = Math.abs(Math.sin(ph)) * 0.08;
      // Arms counter-swing energetically
      const armSwing = 0.65;
      leftArm.pivot.rotation.x = Math.sin(ph) * armSwing;
      rightArm.pivot.rotation.x = -Math.sin(ph) * armSwing;
      leftArm.pivot.rotation.z = 0.15 + Math.abs(Math.sin(ph)) * 0.15;
      rightArm.pivot.rotation.z = -0.15 - Math.abs(Math.sin(ph)) * 0.15;
      // Straw bobs with waddle
      straw.rotation.z = -0.08 * Math.sin(ph);
    } else if (clip === 'attack') {
      // Windup lean-back, then aggressive thrust forward spraying toxic globules
      const windup = ease(t / 0.22) * (1 - ease((t - 0.2) / 0.08));
      const firePhase = clamp01((t - 0.25) / 0.18);
      const thrust = ease(firePhase) * (1 - ease((t - 0.8) / 0.18));

      // Windup: leans back, eyebrows contract angrily; Thrust: lunges forward
      body.rotation.x = -0.16 * windup + 0.26 * thrust;
      body.position.z = -0.08 * windup + 0.16 * thrust;
      straw.rotation.x = -0.2 * windup + 0.35 * thrust;
      nozzle.rotation.x = 0.55 + 0.25 * thrust;

      brows[0].position.y = 1.34 - 0.04 * (windup + thrust);
      brows[1].position.y = 1.34 - 0.04 * (windup + thrust);
      brows[0].rotation.z = 0.35 * (windup + thrust);
      brows[1].rotation.z = -0.35 * (windup + thrust);

      // Yellow gloved hands thrust forward in blasting gesture
      leftArm.pivot.rotation.x = 0.2 * windup - 1.1 * thrust;
      rightArm.pivot.rotation.x = 0.2 * windup - 1.1 * thrust;
      leftArm.pivot.rotation.z = 0.15 + 0.35 * thrust;
      rightArm.pivot.rotation.z = -0.15 - 0.35 * thrust;

      // Toxic globules spraying out of straw tip
      const activeSpray = t >= 0.25 && t < 0.9;
      spray.visible = activeSpray;
      if (activeSpray) {
        const u = (t - 0.25) / 0.65;
        spray.children.forEach((d, i) => {
          const lead = clamp01(u * 1.5 - i * 0.08);
          const spreadX = (i - (SPRAY_COUNT - 1) / 2) * 0.16;
          const trajZ = 0.35 + lead * 1.8;
          const trajY = 2.4 - lead * 0.35 + Math.sin(lead * Math.PI) * 0.25;
          d.position.set(spreadX * (0.6 + lead), trajY, trajZ);
          d.visible = lead > 0 && lead < 1;
          d.scale.setScalar((1 - 0.2 * lead) * (0.8 + 0.4 * Math.sin(lead * Math.PI)));
        });
      }
    } else {
      // Row 4: Death collapse flat into a toxic milkshake puddle
      const buckle = ease(t / 0.3);
      const crumple = ease((t - 0.25) / 0.75);
      const flatten = 1 - 0.76 * crumple;

      // Cup compresses flat down to floor and tilts sideways
      cup.scale.set(1 + 0.35 * crumple, flatten, 1 + 0.25 * crumple);
      cup.position.y = (CUP_Y + CUP_H / 2) * flatten + 0.02;
      cup.rotation.z = 0.35 * crumple;
      cup.rotation.x = -0.12 * buckle;

      const dropY = (CUP_Y + CUP_H) * (1 - flatten);
      top.position.y = TOP_Y - dropY;
      top.rotation.z = cup.rotation.z;
      top.scale.set(1 + 0.25 * crumple, flatten, 1 + 0.25 * crumple);

      // Straw collapses flat
      straw.rotation.z = (Math.PI / 2 - 0.2) * crumple;
      straw.rotation.x = 0.2 * buckle;

      // Face squashes and flips to shocked open mouth
      face.position.y = -dropY * 0.8;
      face.scale.y = Math.max(0.3, flatten);
      face.position.z = 0.08 * crumple;
      smirk.rotation.z = 0.2; // turns down
      eyes.forEach((e) => { e.scale.y = 0.18 * (1 - 0.65 * crumple); });
      brows.forEach((b, i) => { b.rotation.z = (i === 0 ? -1 : 1) * 0.5 * buckle; });

      // Yellow dishwashing gloves flop limp onto the ground
      leftArm.pivot.position.y = 1.15 - dropY * 0.9;
      rightArm.pivot.position.y = 1.15 - dropY * 0.9;
      leftArm.pivot.rotation.z = 0.15 + 1.2 * crumple;
      rightArm.pivot.rotation.z = -0.15 - 1.2 * crumple;
      leftArm.pivot.rotation.x = -0.3 * crumple;
      rightArm.pivot.rotation.x = -0.3 * crumple;

      // Spilled bubbling toxic milkshake puddle expands across floor
      const puddleT = ease((t - 0.15) / 0.65);
      puddle.visible = t > 0.15;
      mainPuddle.visible = true;
      mainPuddle.scale.set(puddleT * 1.2, 1, puddleT * 0.9);

      puddle.children.forEach((c, i) => {
        if (c === mainPuddle) return;
        const angle = (i / PUDDLE_SPLATS) * Math.PI * 2 + 0.4;
        const dist = 1.1 + 0.7 * puddleT + (i % 3) * 0.15;
        c.position.set(Math.cos(angle) * dist, 0.015, Math.sin(angle) * dist * 0.75 + 0.15);
        c.visible = puddleT > 0.3;
        c.scale.setScalar(clamp01((puddleT - 0.3) / 0.7));
      });

      body.position.y = 0;
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
    root, body, cup, top, straw, elbow, nozzle, face, eyes, pupils, brows, smirk,
    leftArm, rightArm, arms, spray, puddle, pose, reset, dispose,
  };
}
