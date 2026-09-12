/**
 * TILT TITAN (THE PINBALL BOSS), AS A 3D RIG — the source of the published
 * `pinball_boss-{S,N,E}` sheets.
 *
 * Built like the Fry Sentinel (render/fries-3d.ts), the Toxic Shake
 * (render/milkshake-3d.ts) and Blaster Frank (render/blaster-frank-3d.ts):
 * a hand-authored Three.js model with `pose(clip, t)`, rendered by
 * scripts/pinball-boss-bake.html into the gameplay atlases and published by
 * scripts/bake-pinball-boss.mjs. The pixel sheet it replaces
 * (docs/art/pinball-boss/sprite-sheet.png) is the SHAPE SPEC, one row per clip:
 *
 *   row 1  idle    the chrome ball hangs heavy, highlight sweeping, visor eyes pulsing, sparks
 *   row 2  walk    rolls forward — the riveted seam turns, dust behind, sparks at the contact
 *   row 3  attack  tornado precession; roll = curved corkscrew; ball = multi-axis tumble, sparks grinding
 *                  off the floor, eyes blazing. LOOPS, so it reads as a turbine while the
 *                  boss revs and charges (boss-moves.ts plays it with { loop: true })
 *   row 4  death   cracks spider across the hull, the core glows through, it detonates into
 *                  chrome shards, ball bearings and a bumper spring that settle on the floor
 *
 * The creature is a giant chrome sphere with a face: round glowing crimson
 * eyes under brow ridges, a wide dark grin full of jagged steel teeth,
 * a riveted equatorial seam. Every face feature sits ON the sphere
 * (`onBall`), and `setFacing` slides the face round toward the camera for
 * the E bake. The spin is the WHOLE ball turning, so it is the same from
 * every facing.
 *
 * The first pixel sheet's attack row was four static front-facing frames
 * with lightning drawn over them (plan/PLAN-PINBALL-BOSS-SPIN-SPRITES.md):
 * a spinning ball needs sequential rotation frames, which is what this
 * rig's attack is.
 *
 * Sizing (learned on the Toxic Shake): one shared registration rect per
 * sheet, so the detonation stays inside ±PINBALL_BOSS_DEATH_HALF_WIDTH and
 * no higher than the ball. The game draws the boss at 2.2× (boss-kinds.ts).
 *
 * Model space: the ball rests on y=0, radius 1 (2 units tall). +z is TOWARD
 * THE CAMERA for the S facing; the bake yaws the root for N and E.
 */
import * as THREE from 'three';

export const PINBALL_BOSS_SHEET = 'pinball_boss';
export type PinballBossPose = 'idle' | 'walk' | 'attack' | 'roll' | 'ball' | 'death';
export const PINBALL_BOSS_CLIPS: readonly PinballBossPose[] = ['idle', 'walk', 'attack', 'roll', 'ball', 'death'];

/**
 * Frames per clip, against engine/config.ts anim rates (idle 3, walk 8,
 * attack 12, death 6 fps). The three power-up paths use 32 samples each;
 * imported-sheet beats preserve a one-second loop before rev acceleration.
 * `death` is 5 so it FINISHES inside the 0.96 s that
 * sandbox-all-monsters-death-trace.test.ts simulates.
 */
export const PINBALL_BOSS_FRAMES: Record<PinballBossPose, number> = { idle: 6, walk: 8, attack: 32, roll: 32, ball: 32, death: 5 };
export const PINBALL_BOSS_LOOPS: Record<PinballBossPose, boolean> = { idle: true, walk: true, attack: true, roll: true, ball: true, death: false };

/** Colours read off docs/art/pinball-boss/sprite-sheet.png. */
export const PINBALL_BOSS_PALETTE = {
  ink: '#141820',
  steel: '#aebbcb',
  steelDark: '#5c6b80',
  steelDeep: '#2f3946',
  chromeHi: '#eef4fb',
  eye: '#e8202a',
  eyeCore: '#ffb3a8',
  mouth: '#0d1016',
  teeth: '#e6ebf2',
  sparkCyan: '#7fe9ff',
  sparkYellow: '#ffe24a',
  core: '#ff8a1f',
  coreHot: '#fff0a8',
  smoke: '#8a919c',
  dust: '#b9a98a',
  spring: '#c9a24a',
  white: '#ffffff',
};

/** The detonation must stay inside this half-width so the shared registration rect stays tight. */
export const PINBALL_BOSS_DEATH_HALF_WIDTH = 1.45;

const ease = (v: number) => { const t = THREE.MathUtils.clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
/** A deterministic 0..1 per index, so the debris scatters the same in every bake. */
const hash01 = (i: number, salt = 0) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };

const R = 1.0;
const FACE_CHEAT = 0.35;

export function createPinballBoss() {
  const root = new THREE.Group(); root.name = 'Tilt Titan';
  const body = new THREE.Group(); body.name = 'Body'; body.position.y = R; root.add(body);
  // `ball` carries the hull and the face; it is what spins in the attack.
  const ball = new THREE.Group(); ball.name = 'Ball'; body.add(ball);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  const ramp = new THREE.DataTexture(new Uint8Array([60, 130, 215, 255]), 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  function toon(color: string) { const m = new THREE.MeshToonMaterial({ color, gradientMap: ramp }); materials.add(m); return m; }
  function flat(color: string, side: THREE.Side = THREE.FrontSide, opacity = 1) {
    const m = new THREE.MeshBasicMaterial({ color, side, transparent: opacity < 1, opacity }); materials.add(m); return m;
  }

  const P = PINBALL_BOSS_PALETTE;
  const steelMat = toon(P.steel), steelDarkMat = toon(P.steelDark), steelDeepMat = toon(P.steelDeep);
  const chromeHiMat = flat(P.chromeHi, THREE.FrontSide, 0.85);
  const eyeMat = flat(P.eye), eyeCoreMat = flat(P.eyeCore), mouthMat = flat(P.mouth), teethMat = toon(P.teeth);
  const sparkCyanMat = flat(P.sparkCyan), sparkYellowMat = flat(P.sparkYellow);
  const coreMat = flat(P.core), coreHotMat = flat(P.coreHot), smokeMat = flat(P.smoke, THREE.FrontSide, 0.8), dustMat = flat(P.dust, THREE.FrontSide, 0.7);
  const springMat = toon(P.spring);
  const inkMat = flat(P.ink);
  const outline = flat(P.ink, THREE.BackSide);

  const cube = new THREE.BoxGeometry(1, 1, 1); geometries.add(cube);
  const sphere = new THREE.SphereGeometry(1, 28, 20); geometries.add(sphere);
  const INK = 1.04;

  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, position: number[], scale = [1, 1, 1], inkShell = true) {
    const m = new THREE.Mesh(geo, material); m.position.set(position[0], position[1], position[2]); m.scale.set(scale[0], scale[1], scale[2]); parent.add(m);
    if (inkShell) { const edge = new THREE.Mesh(geo, outline); edge.scale.setScalar(INK); m.add(edge); }
    return m;
  }
  /** Sit `obj` on the ball's surface at `yaw` radians round from +z and `pitch` radians up from level, facing outward. */
  function onBall(obj: THREE.Object3D, yaw: number, pitch: number, lift = 0.01) {
    const r = R + lift;
    obj.position.set(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, Math.cos(yaw) * Math.cos(pitch) * r);
    obj.rotation.set(-pitch, yaw, 0);
  }

  // ── THE HULL: a chrome sphere, a darker underside, a sweeping highlight, a riveted seam. ──
  const hull = mesh(ball, sphere, steelMat, [0, 0, 0], [R, R, R]); hull.name = 'Hull';
  const under = mesh(ball, sphere, steelDarkMat, [0, -0.32, 0], [0.86, 0.72, 0.86], false); under.name = 'Underside';
  const highlight = mesh(ball, sphere, chromeHiMat, [0, 0, 0], [0.34, 0.16, 0.06], false); highlight.name = 'Highlight';
  onBall(highlight, -0.55, 0.95, 0.02);
  // Two riveted great circles flanking the face (one through the front bisected
  // it like a scar); both turn about x with the roll.
  const seamGeo = new THREE.TorusGeometry(R + 0.005, 0.03, 8, 64); geometries.add(seamGeo);
  const seam = new THREE.Group(); seam.name = 'Seam'; ball.add(seam);
  const rivets: THREE.Mesh[] = [];
  for (const yaw of [-0.75, 0.75]) {
    const ring = new THREE.Group(); ring.rotation.y = yaw; seam.add(ring);
    const r = mesh(ring, seamGeo, steelDeepMat, [0, 0, 0], [1, 1, 1], false); r.rotation.y = Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const rv = mesh(ring, sphere, steelDeepMat, [0, Math.sin(a) * (R + 0.01), Math.cos(a) * (R + 0.01)], [0.055, 0.055, 0.055], false); rivets.push(rv);
    }
  }

  // ── THE FACE: round predatory eyes under brow ridges, and a wide jagged grin. ──
  const face = new THREE.Group(); face.name = 'Face'; ball.add(face);
  const EYE_YAW = 0.4, EYE_PITCH = 0.3;
  const EYE_SCALE: [number, number, number] = [0.20, 0.20, 0.09];
  const eyes: THREE.Mesh[] = [], brows: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const e = mesh(face, sphere, eyeMat, [0, 0, 0], [...EYE_SCALE], true); onBall(e, side * EYE_YAW, EYE_PITCH, 0.09);  eyes.push(e);
    mesh(e, sphere, inkMat, [side * -0.12, -0.05, 0.9], [0.40, 0.40, 0.22], false);
    mesh(e, sphere, eyeCoreMat, [-0.28, 0.30, 0.9], [0.18, 0.18, 0.18], false);
    const b = mesh(face, cube, steelDeepMat, [0, 0, 0], [0.6, 0.11, 0.1], true); onBall(b, side * EYE_YAW, EYE_PITCH + 0.22, 0.0); b.rotation.z += side * 0.38; brows.push(b);
  }
  const MOUTH_SCALE: [number, number, number] = [1, 1, 1];
  // A spherical patch wraps the grin around the hull. A flattened sphere
  // protrudes at the corners, clipping the floor when the whole ball tumbles.
  const mouthGeo = new THREE.CircleGeometry(1, 48); geometries.add(mouthGeo);
  const mouthVertices = mouthGeo.getAttribute('position');
  for (let i = 0; i < mouthVertices.count; i++) {
    const x = mouthVertices.getX(i) * 0.82, y = mouthVertices.getY(i) * 0.30;
    mouthVertices.setXYZ(i, x, y, Math.sqrt(1 - x * x - y * y) - 1);
  }
  mouthGeo.computeVertexNormals();
  const mouth = mesh(face, mouthGeo, mouthMat, [0, 0, 0], [...MOUTH_SCALE], false);
  mouth.name = 'Mouth'; onBall(mouth, 0, -0.3, 0.035);
  // Flat triangular shark blades sit proud of the dark mouth and hull.
  // The old cones were embedded in the sphere and vanished in the sprite bake.
  const toothShape = new THREE.Shape();
  toothShape.moveTo(-0.095, 0.065); toothShape.lineTo(0.095, 0.065);
  toothShape.lineTo(0, -0.23); toothShape.closePath();
  const toothGeo = new THREE.ExtrudeGeometry(toothShape, { depth: 0.055, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, steps: 1 });
  geometries.add(toothGeo);
  const teeth: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const yaw = (i - 4) * 0.17;
    const top = mesh(face, toothGeo, teethMat, [0, 0, 0], [1, i % 2 ? 0.87 : 1.1, 1], false);
    onBall(top, yaw, -0.12 - 0.045 * Math.abs(i - 4), 0.065); teeth.push(top);
    if (i < 8) {
      const bot = mesh(face, toothGeo, teethMat, [0, 0, 0], [0.86, 0.72, 1], false);
      onBall(bot, yaw + 0.085, -0.49 + 0.025 * Math.abs(i - 3.5), 0.065);
      bot.rotation.z = Math.PI; teeth.push(bot);
    }
  }

  // ── SPARKS: electric arcs that flicker on the hull, and grinding sparks at the floor. ──
  const arcs: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = mesh(ball, cube, i % 2 ? sparkCyanMat : sparkYellowMat, [0, 0, 0], [0.05, 0.3, 0.03], false);
    onBall(a, 0.9 + i * 1.4, 0.35 - (i % 3) * 0.4, 0.05); a.rotation.z += 0.6 * (i % 2 ? 1 : -1); a.visible = false; arcs.push(a);
  }
  const floorSparks = new THREE.Group(); floorSparks.name = 'Floor sparks'; root.add(floorSparks); floorSparks.visible = false;
  const sparkBits: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) { const s = mesh(floorSparks, cube, i % 3 ? sparkYellowMat : sparkCyanMat, [0, 0, 0], [0.05, 0.16, 0.04], false); sparkBits.push(s); }
  const dust = new THREE.Group(); dust.name = 'Dust'; root.add(dust); dust.visible = false;
  const dustPuffs: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) { const d = mesh(dust, sphere, dustMat, [0, 0, 0], [0.1, 0.1, 0.1], false); dustPuffs.push(d); }

  // ── DEATH: cracks on the hull, the core glowing through, then shards, bearings, a spring, a flash and smoke. ──
  const cracks: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const c = mesh(ball, cube, inkMat, [0, 0, 0], [0.04, 0.5, 0.03], false);
    onBall(c, -1.2 + hash01(i) * 2.4, -0.6 + hash01(i, 1) * 1.6, 0.03); c.rotation.z += (hash01(i, 2) - 0.5) * 2.4; c.visible = false; cracks.push(c);
  }
  // The core is what shows THROUGH the cracks (they turn orange) and, briefly, a
  // glow at the mouth; it never outgrows the hull — a first bake let a sphere
  // of it swell past the hull and two death frames were a plain orange ball.
  const core = mesh(body, sphere, coreMat, [0, 0, 0], [0.3, 0.3, 0.3], false); core.name = 'Core'; core.visible = false;
  const flash = new THREE.Group(); flash.name = 'Flash'; body.add(flash); flash.visible = false;
  for (let i = 0; i < 8; i++) { const sp = mesh(flash, cube, i % 2 ? coreMat : coreHotMat, [0, 0, 0], [0.12, 1.0, 0.08], false); sp.rotation.z = (i / 8) * Math.PI; }
  const flashCore = mesh(flash, sphere, coreHotMat, [0, 0, 0], [0.5, 0.5, 0.5], false);
  const debris = new THREE.Group(); debris.name = 'Debris'; root.add(debris); debris.visible = false;
  const shards: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const s = mesh(debris, cube, i % 3 === 0 ? steelDarkMat : steelMat, [0, 0, 0], [0.18 + 0.22 * hash01(i, 3), 0.08, 0.16 + 0.2 * hash01(i, 4)]); shards.push(s);
  }
  const bearings: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) { const b = mesh(debris, sphere, steelMat, [0, 0, 0], [0.09, 0.09, 0.09]); bearings.push(b); }
  const spring = new THREE.Group(); spring.name = 'Spring'; debris.add(spring);
  const coilGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 16); geometries.add(coilGeo);
  for (let i = 0; i < 4; i++) { const c = mesh(spring, coilGeo, springMat, [0, i * 0.07, 0], [1, 1, 1], false); c.rotation.x = Math.PI / 2; }
  const smoke = new THREE.Group(); smoke.name = 'Smoke'; root.add(smoke); smoke.visible = false;
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) { const p = mesh(smoke, sphere, smokeMat, [0, 0, 0], [0.1, 0.1, 0.1], false); puffs.push(p); }

  /** Face cheat for the side bake; see `setFacing`. */
  let faceYaw = 0;

  function reset() {
    body.position.set(0, R, 0); body.rotation.set(0, 0, 0); body.scale.set(1, 1, 1);
    ball.rotation.set(0, 0, 0); ball.scale.set(1, 1, 1); ball.visible = true;
    hull.scale.set(R, R, R);
    seam.rotation.set(0, 0, 0);
    face.rotation.set(0, faceYaw, 0);
    onBall(highlight, -0.55, 0.95, 0.02);
    eyes.forEach((e, i) => { const side = i === 0 ? -1 : 1; onBall(e, side * EYE_YAW, EYE_PITCH, 0.09);  e.scale.set(...EYE_SCALE); e.material = eyeMat; });
    mouth.scale.set(...MOUTH_SCALE); mouth.material = mouthMat;
    arcs.forEach((a) => { a.visible = false; });
    floorSparks.visible = false; dust.visible = false;
    cracks.forEach((c) => { c.visible = false; });
    core.visible = false; flash.visible = false; debris.visible = false; smoke.visible = false;
  }

  /**
   * Cheat the face toward the camera for a yawed bake, the way cartoon rigs
   * slide a face round a head; a three-quarter view of a sphere would put
   * the far eye on its silhouette. The back (N) gets no cheat.
   */
  function setFacing(yaw: number) {
    const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    faceYaw = Math.abs(wrapped) < Math.PI * 0.6 ? -wrapped * FACE_CHEAT : 0;
    face.rotation.y = faceYaw;
  }

  /** Grinding sparks fanning out from the floor contact, `n` of them, phase `ph`. */
  function grind(n: number, ph: number, spread: number, height: number) {
    floorSparks.visible = true;
    sparkBits.forEach((s, i) => {
      s.visible = i < n;
      const a = (i / n) * Math.PI * 2 + ph;
      const u = 0.5 + 0.5 * Math.sin(ph * 3 + i * 1.7);
      s.position.set(Math.cos(a) * (0.55 + spread * u), 0.06 + height * u, 0.25 + Math.sin(a) * (0.35 + 0.3 * u));
      s.rotation.z = a + 0.5; s.scale.set(0.05, 0.12 + 0.12 * u, 0.04);
    });
  }

  /** Pose the Titan at `t` (0..1) through `clip`. */
  function pose(clip: PinballBossPose, t: number) {
    reset();
    if (clip === 'idle') {
      // Heavy float, the highlight sweeping over the crown, visor eyes pulsing, an arc or two.
      const ph = t * Math.PI * 2;
      body.position.y = R + 0.04 * Math.sin(ph);
      ball.rotation.z = 0.03 * Math.sin(ph + 1);
      onBall(highlight, -0.55 + 0.25 * Math.sin(ph), 0.95 - 0.06 * Math.cos(ph), 0.02);
      const pulse = 0.5 + 0.5 * Math.sin(ph * 2);
      eyes.forEach((e) => { e.scale.set(EYE_SCALE[0] + 0.025 * pulse, EYE_SCALE[1] + 0.025 * pulse, EYE_SCALE[2]); });
      arcs.forEach((a, i) => { a.visible = Math.sin(ph * 2 + i * 1.9) > 0.55; });
    } else if (clip === 'walk') {
      // Rolling: the riveted seam turns a full revolution per cycle, the ball
      // leans in and bobs, dust kicks up behind, sparks at the front contact.
      // The face rides the roll (cartoon logic, as the pixel sheet draws it).
      const ph = t * Math.PI * 2;
      seam.rotation.x = ph;
      ball.rotation.x = 0.16 + 0.03 * Math.sin(ph * 2);
      body.position.y = R + 0.03 * Math.abs(Math.sin(ph * 2));
      body.position.z = 0.05;
      onBall(highlight, -0.55, 0.9, 0.02);
      dust.visible = true;
      dustPuffs.forEach((d, i) => {
        const u = ((t + i / 4) % 1);
        d.position.set(-0.5 + 0.4 * (i % 2) - 0.2 * u, 0.06 + 0.28 * u, -0.7 - 0.5 * u);
        d.scale.setScalar(0.06 + 0.16 * u); d.visible = u < 0.85;
      });
      grind(6, ph, 0.25, 0.25);
      arcs.forEach((a, i) => { a.visible = i === (Math.floor(t * 8) % 4); });
    } else if (clip === 'attack' || clip === 'roll' || clip === 'ball') {
      // Closed quaternion curves: precession + nutation + spin. Integer
      // frequencies close both orientation and velocity across every loop.
      // attack = tornado, roll = curved corkscrew, ball = chaotic tumble.
      const ph = t * Math.PI * 2;
      const orientation = new THREE.Euler();
      if (clip === 'attack') {
        orientation.set(0.34 * Math.sin(ph), ph, 0.26 * Math.sin(ph * 2), 'YXZ');
      } else if (clip === 'roll') {
        orientation.set(ph, -ph, 0.55 * Math.sin(ph), 'ZYX');
      } else {
        orientation.set(ph, 0.65 * Math.sin(ph * 2), -ph + 0.25 * Math.sin(ph), 'YZX');
      }
      ball.quaternion.setFromEuler(orientation);
      // Small curved orbit stays within the visible boss footprint; the
      // charge lane and collision center remain accurate and stationary.
      body.position.x = 0.025 * Math.sin(ph);
      body.position.z = 0.04 * Math.sin(ph * 2);
      body.position.y = R + 0.008 * (1 - Math.cos(ph * 2));
      eyes.forEach(e => e.scale.set(0.23, 0.23, EYE_SCALE[2]));
      arcs.forEach((a, i) => { a.visible = i % 2 === Math.floor(t * 32) % 2; });
      grind(10, ph, 0.45, 0.55);
    } else {
      // Cracks spider across the hull as the core glows through, the hull
      // bulges, then it detonates: shards, bearings and the bumper spring fly
      // out on arcs and settle on the floor under a puff of smoke.
      const crack = ease(t / 0.45);
      const swell = ease((t - 0.2) / 0.35);
      const boom = ease((t - 0.55) / 0.3);
      const settle = ease((t - 0.6) / 0.4);
      const intact = t < 0.6;
      ball.visible = intact;
      if (intact) {
        cracks.forEach((c, i) => { c.visible = crack > 0.08 + i * 0.05; c.scale.set(0.04 + 0.04 * swell, 0.2 + 0.45 * crack, 0.03); c.material = swell > 0.3 ? coreMat : inkMat; });
        hull.scale.set(R * (1 + 0.1 * swell), R * (1 - 0.1 * swell), R * (1 + 0.06 * swell));
        ball.rotation.z = 0.12 * Math.sin(t * 40) * crack;
        eyes.forEach((e) => { e.material = swell > 0.3 ? coreMat : eyeMat; e.scale.set(EYE_SCALE[0] + 0.1 * swell, EYE_SCALE[1] + 0.08 * swell, EYE_SCALE[2]); });
        mouth.material = swell > 0.3 ? coreMat : mouthMat;
        core.visible = false;
        arcs.forEach((a, i) => { a.visible = crack > 0.3 && i % 2 === Math.floor(t * 20) % 2; });
      }
      flash.visible = t >= 0.6 && t < 0.9;
      flash.scale.setScalar(0.5 + 0.7 * Math.sin(clamp01((t - 0.6) / 0.3) * Math.PI));
      flash.rotation.z = t * 5;
      flashCore.scale.setScalar(0.5 * (1 - clamp01((t - 0.6) / 0.3)));
      debris.visible = boom > 0;
      if (boom > 0) {
        const fling = (o: THREE.Object3D, i: number, salt: number, reach: number, lift: number) => {
          const a = hash01(i, salt) * Math.PI * 2;
          const r = (0.55 + 0.45 * hash01(i, salt + 1)) * reach;
          const u = clamp01(settle * (1.05 + 0.35 * hash01(i, salt + 2)));
          // Tumbling in flight, flat on landing (a tilted shard's corner would dip through the floor).
          const tumble = Math.sin(u * Math.PI);
          o.position.set(Math.cos(a) * r * u, R * (1 - u) + lift * tumble + 0.07, 0.15 + Math.sin(a) * r * 0.6 * u);
          o.rotation.set(hash01(i, salt + 3) * 3 * tumble, a + u * 2, hash01(i, salt + 4) * 2 * tumble);
        };
        shards.forEach((s, i) => fling(s, i, 10, 1.3, 0.9));
        bearings.forEach((b, i) => fling(b, i, 20, 1.25, 0.6));
        fling(spring, 3, 30, 1.0, 1.0); spring.rotation.set(Math.PI / 2 - 0.3, 0, 0.4); spring.position.y += 0.1;
      }
      smoke.visible = t >= 0.7;
      puffs.forEach((p, i) => {
        const u = clamp01((t - 0.7 - i * 0.04) / 0.35);
        p.visible = u > 0;
        p.position.set(-0.3 + 0.15 * i, 0.25 + 0.9 * u, 0.2 + 0.1 * i); p.scale.setScalar(0.12 + 0.22 * u);
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
    root, body, ball, hull, seam, rivets, face, eyes, brows, mouth, teeth, arcs, floorSparks, sparkBits, dust,
    cracks, core, flash, debris, shards, bearings, spring, smoke, puffs, pose, reset, setFacing, dispose,
  };
}
