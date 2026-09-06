/**
 * PINBALL PART MESHES — the machine's furniture, built from primitive geometry
 * in palette colours (the quantize pass snaps them into the scene's look) with
 * EMISSIVE accents so every part reads instantly in the iso view and blooms:
 *
 *   bumper    → squat steel drum with a glowing arcane dome + gold rim ring.
 *               Idle: the dome breathes. Hit: a fast radial POP (scale punch).
 *   spring    → steel plate + coil with a gold chevron aimed along its launch.
 *               Hit: squash-then-overshoot along Y (the boing).
 *   ramp      → flat dash pad with two glowing chevrons along its direction.
 *               Idle: chevrons pulse in sequence (the "go this way" crawl).
 *   deflector → a banked 45° rail bar across the corner with a glowing edge.
 *               Hit: edge flash.
 *
 * One module owns part cooldown/animation ticking (updatePinballParts) so the
 * physics code in player.ts only ever CONSUMES ready parts and stamps
 * cooldownT/hitT.
 */
import * as THREE from "three";
import { state, type PinballPart, type PinballPartKind } from "../state";
import type { PinballPartSpot } from "../maze/decorate";
import { tileCenter, worldToTile, type Grid } from "../maze/generator";
import { PALETTE_HEX } from "./palette";
import { createPartInstancer, INSTANCED_KINDS, type PartInstancer, type EmissiveSink } from "./part-instancer";
import { createFireMaterial } from "../fx/elements/fire";
import type { ElementMaterial } from "../fx/elements/element";
import { GLOVE_PERIOD, GLOVE_ACTIVE, GLOVE_LANE_LEN, FLIPPER_SWING, FLIPPER_REST, FLIPPER_ARC, SWINGARM_LEN, swingArmPhase, FLYWHEEL_SPIN_RATE, ELEC_ON, ELEC_OFF, VENT_PERIOD, VENT_WARN, VENT_ACTIVE, BUMPER_LIT_HITS, TRAPDOOR_OPEN, TRAPDOOR_DROP, SHOT_LIGHT_MIN_SPEED, SHOT_LIGHT_RANGE, SHOT_LIGHT_COS, PART_ANIM_RANGE_SQ, spinPadPhase, TELL_TINT_FREEZE, FREEZE_TELL_INTERVAL, FREEZE_TELL_PARTS, SEESAW_TILT_ANGLE, CANNON_SWEEP_RATE } from "../constants";

const C_STEEL_DK = PALETTE_HEX[19];
const C_STEEL = PALETTE_HEX[20];
const C_ARCANE = PALETTE_HEX[31]; // 0x6fd0e8 — the machine's glow colour
const C_GOLD = PALETTE_HEX[16]; // flame/gold accents
const C_SHOT = PALETTE_HEX[21]; // the LIT-SHOT flare — the brightest thing on the table

/** Yaw that rotates the +x axis onto the world direction (dx, dz). */
function yawFor(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/**
 * ── SHARED MATERIALS + GEOMETRY ────────────────────────────────────────────
 *
 * A floor places ~150 parts drawn from ~20 kinds, and every builder used to
 * allocate its own materials and its own geometry. A census of a live floor
 * found 1707 material instances of only 504 distinct LOOKS, and 1668 geometry
 * instances of only 100 distinct SHAPES — 70% and 94% pure duplication.
 *
 * That is not merely wasteful, it is the load stall. WebGPU compiles one
 * render pipeline per distinct material, lazily, the first time it is drawn —
 * so the first frame of a floor spent FIVE SECONDS compiling ~1400 pipelines
 * that were mostly copies of each other, and the steady state cost 1326 draw
 * calls a frame because no two identical parts could share a batch. Neither
 * cost is in `startLevel`, which is why the maze "generating" was never the
 * thing to optimise: `startLevel` measures 544ms, and the frame after it
 * measured 5103ms.
 *
 * So both are memoised by value. `std` and the `*Geo` helpers hand back ONE
 * GPU object per distinct look/shape, shared by every part that asks.
 *
 * ⚠️ A SHARED OBJECT IS NEVER MUTATED AND NEVER DISPOSED.
 *
 *   - If a part's ANIMATOR writes to its material — the emissive pulses in
 *     PART_ANIMATORS, most of them offset per part by `part.i` or a random
 *     `phase` — that part must OWN it: build it with `stdOwn`. Sharing one
 *     would make every bumper on the floor breathe in lockstep with the last
 *     writer winning. Every material that reaches `userData` is animated, and
 *     every one of those is built with `stdOwn` below.
 *   - `disposePinballParts` skips anything flagged `userData.shared`, since
 *     disposing it would pull the geometry out from under the NEXT floor.
 *     Same discipline as the texture cache in maze/build.ts.
 */
const matCache = new Map<string, THREE.MeshStandardMaterial>();
const geoCache = new Map<string, THREE.BufferGeometry>();

/** A material this part OWNS, because its animator writes to it. Never cached. */
function stdOwn(color: number, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness: 0.6, metalness: 0.2 });
}

/** The one shared material for this exact look. NEVER mutate it — see stdOwn. */
function std(color: number, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive}|${emissiveIntensity}`;
  let m = matCache.get(key);
  if (!m) {
    m = stdOwn(color, emissive, emissiveIntensity);
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/** The one shared geometry for this exact shape. NEVER mutate it in place. */
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key) as T | undefined;
  if (hit) return hit;
  const g = make();
  g.userData.shared = true;
  geoCache.set(key, g);
  return g;
}

// Primitive shorthands that key the cache off the constructor arguments, so
// two calls with identical numbers get the identical buffer. Two INLINE uses of
// ExtrudeGeometry stay out of this cache on purpose: both `.translate()` the
// result, and a shared geometry translated once per part would walk away from
// the origin. `flipperGeo` below is cached because it does not — it is built at
// the origin and oriented by rotating the MESH, which is per-instance state.
const boxGeo = (...a: ConstructorParameters<typeof THREE.BoxGeometry>): THREE.BoxGeometry =>
  geo(`box|${a.join()}`, () => new THREE.BoxGeometry(...a));
const cylGeo = (...a: ConstructorParameters<typeof THREE.CylinderGeometry>): THREE.CylinderGeometry =>
  geo(`cyl|${a.join()}`, () => new THREE.CylinderGeometry(...a));
const torusGeo = (...a: ConstructorParameters<typeof THREE.TorusGeometry>): THREE.TorusGeometry =>
  geo(`torus|${a.join()}`, () => new THREE.TorusGeometry(...a));
const coneGeo = (...a: ConstructorParameters<typeof THREE.ConeGeometry>): THREE.ConeGeometry =>
  geo(`cone|${a.join()}`, () => new THREE.ConeGeometry(...a));
const sphereGeo = (...a: ConstructorParameters<typeof THREE.SphereGeometry>): THREE.SphereGeometry =>
  geo(`sphere|${a.join()}`, () => new THREE.SphereGeometry(...a));
const ringGeo = (...a: ConstructorParameters<typeof THREE.RingGeometry>): THREE.RingGeometry =>
  geo(`ring|${a.join()}`, () => new THREE.RingGeometry(...a));

function buildBumper(): THREE.Group {
  const gp = new THREE.Group();
  const base = new THREE.Mesh(cylGeo(0.34, 0.38, 0.16, 12), std(C_STEEL_DK));
  base.position.y = 0.08;
  const ring = new THREE.Mesh(torusGeo(0.3, 0.045, 8, 16), std(C_GOLD, C_GOLD, 0.5));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  const dome = new THREE.Mesh(sphereGeo(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdOwn(C_ARCANE, C_ARCANE, 0.9));
  dome.position.y = 0.16;
  gp.add(base, ring, dome);
  gp.userData.dome = dome.material;
  return gp;
}

function buildSpring(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  const plate = new THREE.Mesh(boxGeo(0.56, 0.06, 0.56), std(C_STEEL_DK));
  plate.position.y = 0.03;
  // coil — three stacked thin discs reads as a spring after the quantize
  const coil = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const loop = new THREE.Mesh(torusGeo(0.16, 0.035, 6, 12), std(C_STEEL));
    loop.rotation.x = Math.PI / 2;
    loop.position.y = 0.1 + k * 0.07;
    coil.add(loop);
  }
  const top = new THREE.Mesh(cylGeo(0.2, 0.2, 0.05, 10), std(C_STEEL, C_ARCANE, 0.25));
  top.position.y = 0.33;
  coil.add(top);
  // chevron arrow on the plate aimed along the launch direction
  const chev = new THREE.Mesh(coneGeo(0.12, 0.26, 3), std(C_GOLD, C_GOLD, 0.8));
  chev.rotation.z = -Math.PI / 2; // cone points +x
  chev.rotation.y = 0;
  chev.position.set(0.3, 0.07, 0);
  const arrow = new THREE.Group();
  arrow.add(chev);
  arrow.rotation.y = yawFor(dirX, dirZ);
  gp.add(plate, coil, arrow);
  gp.userData.coil = coil;
  return gp;
}

function buildRamp(dirX: number, dirZ: number): THREE.Group {
  // A real INCLINED launch ramp (not a flat sticker): a wedge rising toward the
  // launch direction, flanked by guide rails, with three big glowing arrows
  // climbing the slope and a gold kicker lip at the top. Reads as "ride me →"
  // at a glance in iso. Local +x is the launch direction (group is yawed).
  const gp = new THREE.Group();
  const LEN = 0.86;
  const H = 0.34;
  const W = 0.56;
  const slope = Math.atan2(H, LEN); // incline angle
  const slopeY = (x: number): number => (H * (x + LEN / 2)) / LEN; // surface height at local x

  // ── Wedge body (triangular prism) ──
  const shape = new THREE.Shape();
  shape.moveTo(-LEN / 2, 0);
  shape.lineTo(LEN / 2, 0);
  shape.lineTo(LEN / 2, H);
  shape.closePath();
  const wedgeGeo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  wedgeGeo.translate(0, 0, -W / 2); // centre on z
  gp.add(new THREE.Mesh(wedgeGeo, std(C_STEEL_DK)));

  // ── Guide rails down each side (steel bars with a gold-lit top edge) ──
  for (const zside of [-1, 1]) {
    const rail = new THREE.Mesh(boxGeo(LEN * 1.02, 0.12, 0.06), std(C_STEEL, C_GOLD, 0.28));
    rail.position.set(0, H / 2 + 0.05, (zside * W) / 2);
    rail.rotation.z = slope; // lie along the rising slope
    gp.add(rail);
  }

  // ── Three big arrows climbing the slope (the "GO this way" crawl) ──
  const chevMats: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const m = stdOwn(C_ARCANE, C_ARCANE, 0.8);
    const chev = new THREE.Mesh(coneGeo(0.17, 0.32, 3), m);
    chev.rotation.z = -Math.PI / 2 + slope; // point up-slope, flush with the incline
    const x = -0.24 + k * 0.24;
    chev.position.set(x, slopeY(x) + 0.06, 0);
    chevMats.push(m);
    gp.add(chev);
  }

  // ── Gold kicker lip at the top (the launch edge) ──
  const lipMat = stdOwn(C_GOLD, C_GOLD, 0.7);
  const lip = new THREE.Mesh(boxGeo(0.1, 0.14, W + 0.06), lipMat);
  lip.position.set(LEN / 2 - 0.02, H + 0.02, 0);
  gp.add(lip);

  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.chevMats = chevMats;
  gp.userData.lipMat = lipMat;
  gp.userData.lipMesh = lip;
  gp.userData.phase = Math.random() * Math.PI * 2;
  return gp;
}

function buildBooster(dirX: number, dirZ: number): THREE.Group {
  // A Sonic-style SPEED BOOSTER pad — a low neon "moving walkway" tile, meant to
  // sit in a CHAIN so a row reads as one accelerating lane. Local +x is the
  // launch direction. Two glowing side strips channel the eye down the lane and
  // three big chevrons SCROLL along it (updatePinballParts) so it always says
  // "step on → get flung this way". Flatter than a ramp on purpose: it's a lane
  // surface, not a launch wedge.
  const gp = new THREE.Group();
  const LEN = 0.9;
  const W = 0.56;
  // ── Dark base plate (slightly recessed rim) ──
  const plate = new THREE.Mesh(boxGeo(LEN, 0.05, W), std(0x1a1f2b));
  plate.position.y = 0.025;
  gp.add(plate);
  // ── Two neon side strips running down the lane ──
  const stripMats: THREE.MeshStandardMaterial[] = [];
  for (const zside of [-1, 1]) {
    const m = stdOwn(C_ARCANE, C_ARCANE, 0.8);
    const strip = new THREE.Mesh(boxGeo(LEN, 0.06, 0.06), m);
    strip.position.set(0, 0.06, (zside * (W - 0.06)) / 2);
    stripMats.push(m);
    gp.add(strip);
  }
  // ── Three big forward chevrons (the scrolling "GO →" crawl) ──
  const chevMats: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const m = stdOwn(C_GOLD, C_GOLD, 0.9);
    const chev = new THREE.Mesh(coneGeo(0.16, 0.34, 3), m);
    chev.rotation.z = -Math.PI / 2; // point +x, flat on the pad
    chev.position.set(-0.26 + k * 0.26, 0.075, 0);
    chevMats.push(m);
    gp.add(chev);
  }
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.chevMats = chevMats;
  gp.userData.stripMats = stripMats;
  gp.userData.phase = Math.random() * Math.PI * 2;
  return gp;
}

/**
 * CORNER BOOSTER — a quarter-circle of chevrons sweeping from the entry leg to
 * the exit leg, on a banked deck, with a kicker lip on the way out.
 *
 * The silhouette is the point. A player has to be able to tell at a glance that
 * this corner will THROW him and which way, from an isometric camera, at speed.
 * So: the chevrons curve (a straight pad's don't), they are gold like every
 * other accelerating surface in the game, and the deck banks up on the outside
 * of the turn the way a real banked corner does — the same visual grammar as
 * the arc-swept walls this part usually sits inside.
 *
 * `d1` is the leg the ball ARRIVES on (pointing back the way it came) and `d2`
 * the leg it leaves along, matching the deflector so the two are interchangeable
 * in the level plan.
 */
function buildBoostCorner(d1x: number, d1z: number, d2x: number, d2z: number): THREE.Group {
  const gp = new THREE.Group();
  const R = 0.52; // sweep radius — sits inside a one-tile footprint
  // ── Banked deck: a quarter annulus, tilted up on the outside edge ──
  const deck = new THREE.Mesh(ringGeo(R - 0.3, R + 0.16, 14, 1, 0, Math.PI / 2), std(0x1a1f2b));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.03;
  gp.add(deck);
  // ── Outer guide rail, following the same arc: the wall you lean on ──
  const rail = new THREE.Mesh(torusGeo(R + 0.14, 0.055, 8, 14, Math.PI / 2), std(C_STEEL_DK, C_ARCANE, 0.3));
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = 0.13;
  gp.add(rail);
  // ── Chevrons ALONG the arc, each yawed to the local tangent ──
  const chevMats: THREE.MeshStandardMaterial[] = [];
  const N = 4;
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5) / N) * (Math.PI / 2);
    const m = stdOwn(C_GOLD, C_GOLD, 0.9);
    const chev = new THREE.Mesh(coneGeo(0.14, 0.3, 3), m);
    // Cone points +y by default: lay it flat pointing +x, then yaw to the
    // tangent of the arc at this angle (tangent of (cos a, sin a) is
    // (−sin a, cos a) — travelling counter-clockwise, which is the direction
    // the group's own yaw below is chosen to make correct).
    chev.rotation.z = -Math.PI / 2;
    chev.position.set(Math.cos(a) * R, 0.09, Math.sin(a) * R);
    chev.rotation.y = -a - Math.PI / 2;
    chevMats.push(m);
    gp.add(chev);
  }
  // ── Kicker lip on the exit, so the "you leave THIS way" reads even static ──
  const lipMat = stdOwn(C_SHOT, C_SHOT, 0.8);
  const lip = new THREE.Mesh(boxGeo(0.1, 0.16, 0.5), lipMat);
  lip.position.set(0, 0.1, R);
  lip.rotation.y = Math.PI / 2;
  gp.add(lip);
  // The arc runs +x → +z in local space, i.e. it enters travelling +x and exits
  // travelling +z. Yaw so local +z lines up with the real exit leg. Using the
  // EXIT rather than the bisector is what keeps the lip on the right side; a
  // bisector yaw looks correct for the deck and puts the kicker in the wall.
  gp.rotation.y = yawFor(d2x, d2z) - Math.PI / 2;
  gp.userData.chevMats = chevMats;
  gp.userData.lipMat = lipMat;
  gp.userData.phase = Math.random() * Math.PI * 2;
  void d1x;
  void d1z; // entry leg is physics-only (see the boostcorner handler)
  return gp;
}

/**
 * CURVED BOOSTER — a short banked lane segment whose chevrons run along an
 * arbitrary tangent rather than a cardinal.
 *
 * Flatter and longer than the corner booster: this one is a piece of a
 * continuous curve, so several in a row have to read as ONE lane. That means no
 * end caps and no kicker lip — anything that terminates the shape visually
 * would chop the curve into beads.
 */
function buildBoostCurve(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  const LEN = 0.94;
  const W = 0.5;
  const plate = new THREE.Mesh(boxGeo(LEN, 0.04, W), std(0x1a1f2b));
  plate.position.y = 0.02;
  gp.add(plate);
  // One banked rail on the OUTSIDE only — a curve leans, a straight doesn't.
  const stripMats: THREE.MeshStandardMaterial[] = [];
  const bank = stdOwn(C_ARCANE, C_ARCANE, 0.7);
  const rail = new THREE.Mesh(boxGeo(LEN, 0.1, 0.05), bank);
  rail.position.set(0, 0.08, W / 2);
  rail.rotation.x = -0.35; // the lean
  stripMats.push(bank);
  gp.add(rail);
  const chevMats: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const m = stdOwn(C_GOLD, C_GOLD, 0.85);
    const chev = new THREE.Mesh(coneGeo(0.13, 0.3, 3), m);
    chev.rotation.z = -Math.PI / 2;
    // Fan the chevrons slightly across the pad so the run reads as bending
    // rather than as three parallel arrows that happen to be rotated.
    chev.rotation.y = (k - 1) * 0.16;
    chev.position.set(-0.28 + k * 0.28, 0.06, (k - 1) * 0.04);
    chevMats.push(m);
    gp.add(chev);
  }
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.chevMats = chevMats;
  gp.userData.stripMats = stripMats;
  gp.userData.phase = Math.random() * Math.PI * 2;
  return gp;
}

/**
 * JUMP PAD — a short steep kicker with a raised takeoff lip and a launch-angle
 * gantry, so the shot that flies over a wall LOOKS like it flies.
 *
 * Deliberately not a longer ramp. The ramp is a dash panel that happens to hop;
 * this is the hop, and the read the player needs is "up and over", so the
 * geometry is vertical where the ramp's is horizontal: a stubby steep wedge, an
 * overhead arch framing the flight line, and chevrons that climb rather than
 * scroll.
 */
function buildJumpPad(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  const LEN = 0.62;
  const H = 0.42; // steeper than a ramp's 0.34 over a longer 0.86
  const W = 0.54;
  const shape = new THREE.Shape();
  shape.moveTo(-LEN / 2, 0);
  shape.lineTo(LEN / 2, 0);
  shape.lineTo(LEN / 2, H);
  shape.closePath();
  const wedgeGeo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  wedgeGeo.translate(0, 0, -W / 2);
  gp.add(new THREE.Mesh(wedgeGeo, std(C_STEEL_DK)));
  // ── Takeoff lip: thick, bright, and proud of the wedge ──
  const lipMat = stdOwn(C_SHOT, C_SHOT, 0.9);
  const lip = new THREE.Mesh(boxGeo(0.12, 0.1, W + 0.1), lipMat);
  lip.position.set(LEN / 2, H + 0.05, 0);
  gp.add(lip);
  // ── The gantry: two posts and a cross-beam over the takeoff, framing the
  // flight line. This is the part that says "over", not "along". ──
  for (const zside of [-1, 1]) {
    const post = new THREE.Mesh(boxGeo(0.07, 0.5, 0.07), std(C_STEEL));
    post.position.set(LEN / 2 - 0.02, 0.25, (zside * (W + 0.16)) / 2);
    gp.add(post);
  }
  const beam = new THREE.Mesh(boxGeo(0.07, 0.07, W + 0.23), std(C_STEEL, C_GOLD, 0.35));
  beam.position.set(LEN / 2 - 0.02, 0.5, 0);
  gp.add(beam);
  // ── Chevrons CLIMBING the wedge, pointing up-slope ──
  const chevMats: THREE.MeshStandardMaterial[] = [];
  const slope = Math.atan2(H, LEN);
  for (let k = 0; k < 3; k++) {
    const m = stdOwn(C_SHOT, C_SHOT, 0.85);
    const chev = new THREE.Mesh(coneGeo(0.15, 0.3, 3), m);
    chev.rotation.z = -Math.PI / 2 + slope;
    const x = -0.18 + k * 0.18;
    chev.position.set(x, (H * (x + LEN / 2)) / LEN + 0.07, 0);
    chevMats.push(m);
    gp.add(chev);
  }
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.chevMats = chevMats;
  gp.userData.lipMat = lipMat;
  gp.userData.phase = Math.random() * Math.PI * 2;
  return gp;
}

/**
 * SEESAW — a pivoting timber plank mounted on an iron fulcrum that spans
 * a wall band. One side rests on the floor while the other is hoisted in
 * the air. Stepping onto the low side tilts the plank, vaulting the knight
 * across to the far corridor.
 */
function buildSeeSaw(dirX: number, dirZ: number, span = 2): THREE.Group {
  const gp = new THREE.Group();
  const fulcrumX = span / 2;
  const fulcrumY = 0.32;
  const plankLen = span + 0.6;
  const plankW = 0.54;
  const plankH = 0.08;

  // 1. Fulcrum Stand (Stationary at local X = fulcrumX, Y = 0)
  const standGroup = new THREE.Group();
  standGroup.position.set(fulcrumX, 0, 0);

  // Triangular iron brackets on either side
  const bracketMat = std(C_STEEL_DK);
  for (const zside of [-1, 1]) {
    const post = new THREE.Mesh(boxGeo(0.18, fulcrumY * 2, 0.08), bracketMat);
    post.position.set(0, fulcrumY / 2, zside * (plankW / 2 + 0.06));
    standGroup.add(post);
  }

  // Cross axle pin through pivot
  const axle = new THREE.Mesh(cylGeo(0.045, 0.045, plankW + 0.22, 8), std(C_STEEL, C_GOLD, 0.4));
  axle.rotation.x = Math.PI / 2;
  axle.position.set(0, fulcrumY, 0);
  standGroup.add(axle);

  // Ground anchor plate
  const basePlate = new THREE.Mesh(boxGeo(0.44, 0.04, plankW + 0.22), std(C_STEEL_DK));
  basePlate.position.set(0, 0.02, 0);
  standGroup.add(basePlate);
  gp.add(standGroup);

  // 2. Pivoting Plank Group (centered at fulcrum)
  const plankPivot = new THREE.Group();
  plankPivot.position.set(fulcrumX, fulcrumY, 0);

  // Sturdy weathered oak timber deck
  const timberMat = std(0x543d2b); // aged oak
  const deck = new THREE.Mesh(boxGeo(plankLen, plankH, plankW), timberMat);
  plankPivot.add(deck);

  // Iron side trims / reinforced guide rails
  for (const zside of [-1, 1]) {
    const rail = new THREE.Mesh(boxGeo(plankLen, plankH + 0.04, 0.04), std(C_STEEL));
    rail.position.set(0, 0.02, zside * (plankW / 2 - 0.02));
    plankPivot.add(rail);
  }

  // Steel cleats / traction ridges along the deck
  const cleatCount = Math.max(3, Math.floor(plankLen / 0.35));
  for (let k = 0; k <= cleatCount; k++) {
    const cx = -plankLen / 2 + 0.2 + k * ((plankLen - 0.4) / cleatCount);
    const cleat = new THREE.Mesh(boxGeo(0.04, 0.02, plankW - 0.08), std(C_STEEL_DK));
    cleat.position.set(cx, plankH / 2 + 0.01, 0);
    plankPivot.add(cleat);
  }

  // Glowing Arcane Runes / Chevrons along center line
  const runeMats: THREE.MeshStandardMaterial[] = [];
  for (let k = -1; k <= 1; k++) {
    const rMat = stdOwn(C_ARCANE, C_ARCANE, 0.6);
    const chev = new THREE.Mesh(coneGeo(0.1, 0.18, 3), rMat);
    chev.rotation.z = -Math.PI / 2;
    chev.position.set(k * (plankLen * 0.24), plankH / 2 + 0.02, 0);
    runeMats.push(rMat);
    plankPivot.add(chev);
  }

  // Default tilt: Side A down (-SEESAW_TILT_ANGLE)
  plankPivot.rotation.z = -SEESAW_TILT_ANGLE;
  gp.add(plankPivot);

  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.plankPivot = plankPivot;
  gp.userData.pivot = plankPivot;
  gp.userData.runeMats = runeMats;
  gp.userData.chevs = runeMats;
  gp.userData.phase = Math.random() * Math.PI * 2;
  return gp;
}

function buildCatapult(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();

  // 1. Timber chassis
  const chassisMat = std(0x4a321f); // dark timber
  const steelMat = std(C_STEEL_DK);
  const baseFrame = new THREE.Mesh(boxGeo(0.85, 0.08, 0.72), chassisMat);
  baseFrame.position.y = 0.04;
  gp.add(baseFrame);

  // Corner brackets
  for (const cx of [-0.38, 0.38]) {
    for (const cz of [-0.32, 0.32]) {
      const b = new THREE.Mesh(boxGeo(0.08, 0.1, 0.08), steelMat);
      b.position.set(cx, 0.05, cz);
      gp.add(b);
    }
  }

  // 2. Vertical A-frame uprights
  const uprightH = 0.52;
  const axleY = 0.42;
  for (const cz of [-0.3, 0.3]) {
    const post = new THREE.Mesh(boxGeo(0.12, uprightH, 0.08), chassisMat);
    post.position.set(0, uprightH / 2, cz);
    gp.add(post);
  }

  // Steel axle pin
  const axle = new THREE.Mesh(cylGeo(0.04, 0.04, 0.72, 8), std(C_STEEL, C_GOLD, 0.3));
  axle.rotation.x = Math.PI / 2;
  axle.position.set(0, axleY, 0);
  gp.add(axle);

  // 3. Pivoting Throwing Arm Group
  const armGroup = new THREE.Group();
  armGroup.position.set(0, axleY, 0);

  // Arm beam (pivoting around axle)
  const armLen = 0.85;
  const armBeam = new THREE.Mesh(boxGeo(armLen, 0.07, 0.07), std(0x6b4423));
  armBeam.position.set(-armLen * 0.25, 0, 0);
  armGroup.add(armBeam);

  // Counterweight stone block at short end (+x)
  const weight = new THREE.Mesh(boxGeo(0.22, 0.22, 0.28), std(0x282830));
  weight.position.set(armLen * 0.22, -0.06, 0);
  armGroup.add(weight);

  // Launch Cradle / Bucket at long end (-x)
  const basketGlow = stdOwn(C_ARCANE, C_ARCANE, 0.8);
  const bucket = new THREE.Mesh(cylGeo(0.22, 0.14, 0.14, 8), std(C_GOLD, C_GOLD, 0.4));
  bucket.position.set(-armLen * 0.65, 0.08, 0);
  const runeDisc = new THREE.Mesh(cylGeo(0.18, 0.18, 0.02, 8), basketGlow);
  runeDisc.position.set(-armLen * 0.65, 0.14, 0);
  armGroup.add(bucket, runeDisc);

  gp.add(armGroup);
  gp.rotation.y = yawFor(dirX, dirZ);

  gp.userData.arm = armGroup;
  gp.userData.basketGlow = basketGlow;
  return gp;
}

function buildCannon(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();

  // 1. Azimuth Turntable / Base
  const baseMat = std(0x3e352b); // aged bronze stone
  const basePlate = new THREE.Mesh(cylGeo(0.48, 0.52, 0.1, 12), baseMat);
  basePlate.position.y = 0.05;
  gp.add(basePlate);

  // Brass rune gear ring
  const gearRing = new THREE.Mesh(torusGeo(0.44, 0.03, 6, 16), std(C_GOLD, C_GOLD, 0.4));
  gearRing.rotation.x = Math.PI / 2;
  gearRing.position.y = 0.11;
  gp.add(gearRing);

  // 2. Swiveling Barrel Group
  const barrelGroup = new THREE.Group();
  barrelGroup.name = "barrel";
  barrelGroup.position.set(0, 0.18, 0);

  // Trunnion carriage sides
  for (const cz of [-0.22, 0.22]) {
    const cheek = new THREE.Mesh(boxGeo(0.3, 0.22, 0.08), std(C_STEEL_DK));
    cheek.position.set(0, 0.08, cz);
    barrelGroup.add(cheek);
  }

  // Heavy Mortar Barrel
  const barrelMat = std(0x1a1c22); // dark gunmetal
  const barrel = new THREE.Mesh(cylGeo(0.18, 0.24, 0.62, 10), barrelMat);
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.12, 0.14, 0);

  // Flared Muzzle Ring
  const muzzle = new THREE.Mesh(cylGeo(0.22, 0.19, 0.1, 10), std(C_STEEL));
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0.44, 0.14, 0);

  // Reinforcement bands
  for (const bx of [0.0, 0.24]) {
    const band = new THREE.Mesh(torusGeo(0.21, 0.025, 6, 12), std(C_GOLD, C_GOLD, 0.5));
    band.rotation.y = Math.PI / 2;
    band.position.set(bx, 0.14, 0);
    barrelGroup.add(band);
  }

  // Ethereal aiming tracer beam
  const tracerMat = stdOwn(0xff8822, 0xffaa33, 0.9);
  const tracer = new THREE.Mesh(boxGeo(0.8, 0.02, 0.04), tracerMat);
  tracer.position.set(0.95, 0.14, 0);
  barrelGroup.add(barrel, muzzle, tracer);

  gp.add(barrelGroup);
  gp.rotation.y = yawFor(dirX, dirZ);

  gp.userData.barrel = barrelGroup;
  gp.userData.tracer = tracerMat;
  return gp;
}

function buildDeflector(d1x: number, d1z: number, d2x: number, d2z: number): THREE.Group {
  const gp = new THREE.Group();
  // A genuinely CURVED banked rail (Wave D: "curved walls like a pinball
  // machine") — a quarter-torus sweeping from one open leg to the other,
  // backed by a quarter-cylinder wall wedge in the closed corner. The sweep
  // starts on the +x axis; yaw the group so its ends line up with the legs.
  const rail = new THREE.Mesh(torusGeo(0.62, 0.07, 8, 14, Math.PI / 2), std(C_STEEL_DK));
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = 0.3;
  const edge = new THREE.Mesh(torusGeo(0.62, 0.035, 6, 14, Math.PI / 2), stdOwn(C_GOLD, C_GOLD, 0.6));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.44;
  const wedge = new THREE.Mesh(cylGeo(0.5, 0.56, 0.4, 10, 1, false, 0, Math.PI / 2), std(C_STEEL_DK));
  wedge.position.y = 0.2;
  const curve = new THREE.Group();
  curve.add(rail, edge, wedge);
  // The torus arc spans +x → +z in its local frame (after the X flip); rotate
  // so the arc's midpoint faces the closed corner, i.e. away from the two
  // open legs. Midpoint of the arc sits along the bisector of (d1 + d2).
  const bx = -(d1x + d2x);
  const bz = -(d1z + d2z);
  curve.rotation.y = yawFor(bx, bz) - Math.PI / 4;
  const off = 0.28;
  curve.position.set(bx * off * 0.5, 0, bz * off * 0.5);
  gp.add(curve);
  gp.userData.edge = edge.material;
  return gp;
}

function buildGlove(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // Wall plate on the mount side (opposite the punch direction).
  const plate = new THREE.Mesh(boxGeo(0.1, 0.5, 0.5), std(C_STEEL_DK));
  plate.position.set(-0.42, 0.35, 0);
  // Piston arm + the red glove, extended along +x by the punch anim.
  const arm = new THREE.Mesh(cylGeo(0.05, 0.05, 0.36, 8), std(C_STEEL));
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.2, 0.35, 0);
  const fist = new THREE.Mesh(sphereGeo(0.19, 10, 8), stdOwn(0xa83244, 0xa83244, 0.35));
  fist.scale.set(1.15, 0.95, 0.95);
  fist.position.set(0.02, 0.35, 0);
  const cuff = new THREE.Mesh(cylGeo(0.11, 0.13, 0.1, 8), std(C_GOLD, C_GOLD, 0.4));
  cuff.rotation.z = Math.PI / 2;
  cuff.position.set(-0.14, 0.35, 0);
  const piston = new THREE.Group();
  piston.add(arm, fist, cuff);
  gp.add(plate, piston);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.piston = piston;
  gp.userData.fist = fist.material;
  return gp;
}

function buildOil(): THREE.Group {
  const gp = new THREE.Group();
  // An irregular black slick — three overlapping flat discs with an oily
  // violet sheen that catches the bloom. Flat enough to walk over visually.
  const mat = std(0x14161c, 0x3a2a55, 0.22);
  mat.roughness = 0.15; // wet
  for (const [ox, oz, r] of [[0, 0, 0.42], [0.28, 0.14, 0.26], [-0.26, -0.12, 0.22]] as const) {
    const blob = new THREE.Mesh(cylGeo(r, r, 0.02, 12), mat);
    blob.position.set(ox, 0.012, oz);
    gp.add(blob);
  }
  gp.userData.sheen = mat;
  return gp;
}

function buildSpinPad(): THREE.Group {
  const gp = new THREE.Group();
  const pad = new THREE.Mesh(cylGeo(0.42, 0.46, 0.08, 14), std(C_STEEL_DK));
  pad.position.y = 0.04;
  gp.add(pad);
  // A raised turbine rotor — three angled blades around a glowing gold hub cone,
  // so the whirl reads with real height (was low flat chevrons on the floor).
  const rotor = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Mesh(boxGeo(0.42, 0.05, 0.13), std(C_ARCANE, C_ARCANE, 0.7));
    const a = (k / 3) * Math.PI * 2;
    blade.position.set(Math.cos(a) * 0.19, 0.17, Math.sin(a) * 0.19);
    blade.rotation.y = -a;
    rotor.add(blade);
  }
  const hub = new THREE.Mesh(coneGeo(0.12, 0.26, 8), std(C_GOLD, C_GOLD, 0.7));
  hub.position.y = 0.22;
  rotor.add(hub);
  gp.add(rotor);
  gp.userData.rotor = rotor;
  return gp;
}

function buildSlingshot(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // Two gold posts flanking the lane (the lane runs along the part's dir),
  // with an elastic band stretched between them.
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(cylGeo(0.06, 0.08, 0.5, 8), std(C_GOLD, C_GOLD, 0.4));
    post.position.set(0, 0.25, side * 0.4);
    gp.add(post);
  }
  const band = new THREE.Mesh(boxGeo(0.05, 0.08, 0.8), std(C_ARCANE, C_ARCANE, 0.55));
  band.position.y = 0.3;
  gp.add(band);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.band = band;
  return gp;
}

function buildTarget(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // A bullseye on a short pole, mounted toward its wall (dir points AT the
  // wall) and facing back out into the corridor.
  const pole = new THREE.Mesh(cylGeo(0.04, 0.05, 0.55, 8), std(C_STEEL_DK));
  pole.position.set(0.3, 0.28, 0);
  const rings = new THREE.Group();
  const ringSpecs: Array<[number, number, number]> = [
    [0.26, 0xd95763, 0.5], // outer red
    [0.17, 0xeef1f5, 0.25], // white
    [0.09, 0xd95763, 0.9], // the eye — hot, blooms
  ];
  const ringMats: THREE.MeshStandardMaterial[] = [];
  ringSpecs.forEach(([r, colr, glow], k) => {
    const m = stdOwn(colr, colr, glow);
    const disc = new THREE.Mesh(cylGeo(r, r, 0.04 + k * 0.012, 14), m);
    disc.rotation.z = Math.PI / 2;
    disc.position.set(0.24, 0.62, 0);
    ringMats.push(m);
    rings.add(disc);
  });
  gp.add(pole, rings);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.rings = rings;
  gp.userData.ringMats = ringMats;
  return gp;
}

function buildLamp(): THREE.Group {
  // A floor BRAZIER for the light puzzle: a stubby iron bowl on a base with a
  // flame bead. Unlit = cold arcane + dark bowl; lit = a bright gold flame
  // (swapped by the animator off part.lit). Radial, so no dir needed.
  const gp = new THREE.Group();
  const base = new THREE.Mesh(cylGeo(0.16, 0.22, 0.14, 10), std(C_STEEL_DK));
  base.position.y = 0.07;
  const bowlMat = stdOwn(C_STEEL_DK, C_ARCANE, 0.3);
  const bowl = new THREE.Mesh(cylGeo(0.22, 0.14, 0.16, 12), bowlMat);
  bowl.position.y = 0.22;
  const flameMat = stdOwn(C_ARCANE, C_ARCANE, 0.9);
  const flame = new THREE.Mesh(sphereGeo(0.15, 10, 8), flameMat);
  flame.position.y = 0.36;
  gp.add(base, bowl, flame);
  gp.userData.flameMat = flameMat;
  gp.userData.bowlMat = bowlMat;
  gp.userData.flame = flame;
  return gp;
}

function buildRollover(dirX: number, dirZ: number): THREE.Group {
  // D3 — a ROLLOVER LANE: a shallow wire arch you roll THROUGH, with a lamp
  // bead on top. The bead is the whole point — it's the per-lane light that
  // tells you which lanes you still need, and which way the lane change moved
  // them. Local +x is the travel direction.
  const gp = new THREE.Group();
  const railMat = std(C_STEEL, C_ARCANE, 0.2);
  for (const zside of [-1, 1]) {
    const post = new THREE.Mesh(cylGeo(0.035, 0.045, 0.3, 6), railMat);
    post.position.set(0, 0.15, zside * 0.22);
    gp.add(post);
  }
  const arch = new THREE.Mesh(torusGeo(0.22, 0.035, 6, 12, Math.PI), railMat);
  arch.rotation.y = Math.PI / 2;
  arch.position.y = 0.3;
  gp.add(arch);
  // The lamp bead — unlit arcane, lit gold (set each frame from state.laneLit).
  const lampMat = stdOwn(C_STEEL_DK, C_ARCANE, 0.5);
  const lamp = new THREE.Mesh(sphereGeo(0.09, 10, 8), lampMat);
  lamp.position.y = 0.53;
  gp.add(lamp);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.lamp = lampMat;
  return gp;
}

function buildTrapdoor(): THREE.Group {
  const gp = new THREE.Group();
  // A wooden hatch flush with the floor: two planks, iron banding, a pull
  // ring. The punch anim flips it open on a hinge.
  // The SHAFT beneath it — sunk so it's invisible until the door swings wide,
  // then it's the black hole the knight visibly falls into.
  const shaft = new THREE.Mesh(boxGeo(0.74, 1.6, 0.74), std(PALETTE_HEX[0], 0x000000, 0));
  shaft.position.y = -0.81;
  gp.add(shaft);
  const door = new THREE.Group();
  for (const side of [-1, 1]) {
    const plank = new THREE.Mesh(boxGeo(0.72, 0.05, 0.34), std(0x6b4a2e));
    plank.position.set(0, 0.025, side * 0.18);
    door.add(plank);
  }
  const band = new THREE.Mesh(boxGeo(0.76, 0.06, 0.08), std(C_STEEL_DK));
  band.position.y = 0.03;
  const ring = new THREE.Mesh(torusGeo(0.07, 0.02, 6, 10), std(C_STEEL, C_ARCANE, 0.25));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0.25, 0.06, 0);
  door.add(band, ring);
  door.position.x = -0.36; // hinge on one edge
  const hinged = new THREE.Group();
  hinged.position.x = 0.36;
  hinged.add(door);
  gp.add(hinged);
  gp.userData.door = hinged;
  return gp;
}

// ── Wave-G parts + Wave-H hazards ───────────────────────────────

/**
 * THE FLIPPER OUTLINE — the silhouette from an actual pinball machine.
 *
 * A flipper bat is not a rectangle. It is TWO CIRCLES joined by their external
 * tangents: a fat pivot end (`r0`) and a narrow tip (`r1`) a bat-length `L`
 * apart. That is the whole shape, and it is the taper plus the two round ends
 * that make it read as a flipper — a box has neither, which is why the old
 * `boxGeo(0.9, 0.12, 0.24)` bat read as a plank with a gold cap.
 *
 *   phi = asin((r0 - r1) / L)   how far the tangent tilts off the centre line
 *   a   = PI/2 + phi            the angle, on BOTH circles, where it touches
 *
 * Traced in the XY plane and extruded along +Z, then laid flat by rotating the
 * MESH (see `buildFlipper`) — never the geometry, which is shared.
 */
function flipperShape(r0: number, r1: number, L: number): THREE.Shape {
  const a = Math.PI / 2 + Math.asin((r0 - r1) / L);
  const s = new THREE.Shape();
  s.moveTo(r0 * Math.cos(a), r0 * Math.sin(a)); // upper tangent, at the pivot
  s.lineTo(L + r1 * Math.cos(a), r1 * Math.sin(a)); // ...running out to the tip
  s.absarc(L, 0, r1, a, -a, true); // round the tip, over the front
  s.lineTo(r0 * Math.cos(-a), r0 * Math.sin(-a)); // lower tangent, back to the pivot
  s.absarc(0, 0, r0, -a, a - Math.PI * 2, true); // round the butt, behind the pivot
  return s;
}

/**
 * A flipper body, cached like the primitive shorthands above. Inflating the
 * outline by `e` is just `r0 + e, r1 + e` at the same `L` — the offset of a
 * tangent hull is the same hull with fatter circles — which is how the rubber
 * sleeve is built from the same function as the bat it wraps.
 */
const flipperGeo = (r0: number, r1: number, L: number, depth: number): THREE.ExtrudeGeometry =>
  geo(
    `flipper|${r0},${r1},${L},${depth}`,
    () =>
      new THREE.ExtrudeGeometry(flipperShape(r0, r1, L), {
        depth,
        curveSegments: 6, // low-poly on purpose: the quantize pass eats the rest
        bevelEnabled: true,
        bevelThickness: 0.018,
        bevelSize: 0.014,
        bevelSegments: 1,
      }),
  );

const FLIP_R0 = 0.135; // pivot-end radius
const FLIP_R1 = 0.06; // tip radius
const FLIP_LEN = 0.72; // pivot centre → tip centre
const FLIP_RUBBER = 0.035; // how far the sleeve stands proud of the bat

function buildFlipper(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // A pivoting paddle: the tapered steel bat, a gold rubber sleeve around it,
  // and the pivot post through the fat end. The paddle group's ORIGIN is the
  // pivot, so the swing is a plain rotation about it.
  const paddle = new THREE.Group();

  const bat = new THREE.Mesh(flipperGeo(FLIP_R0, FLIP_R1, FLIP_LEN, 0.15), std(C_STEEL, C_ARCANE, 0.2));
  bat.rotation.x = -Math.PI / 2; // shape's XY → the floor plane; extrusion → +Y
  bat.position.y = 0.02;

  // The sleeve: the same outline inflated, short, and sitting inside the bat's
  // height so it shows as a band around the sides — the striking surface, and
  // the part the animator flares. It OWNS its material (stdOwn) for that.
  const sleeve = new THREE.Mesh(
    flipperGeo(FLIP_R0 + FLIP_RUBBER, FLIP_R1 + FLIP_RUBBER, FLIP_LEN, 0.07),
    stdOwn(C_GOLD, C_GOLD, 0.7),
  );
  sleeve.rotation.x = -Math.PI / 2;
  sleeve.position.y = 0.055;

  paddle.add(bat, sleeve);

  const hub = new THREE.Mesh(cylGeo(0.075, 0.085, 0.22, 10), std(C_STEEL_DK));
  hub.position.y = 0.11; // the post stands proud of the bat it hinges
  gp.add(hub, paddle);
  gp.rotation.y = yawFor(dirX, dirZ);
  paddle.rotation.y = FLIPPER_REST; // cocked back until it fires
  gp.userData.paddle = paddle;
  gp.userData.edgeMat = sleeve.material as THREE.MeshStandardMaterial;
  return gp;
}

/**
 * SWINGARM — a bar with a hand on the end, and a hub it spins about.
 *
 * The whole arm is one child group rotated about Y by the animator; the hub
 * stays put. The HAND is deliberately the loudest thing on it (gold, emissive,
 * bigger than the bar is thick) because the hand is the only part that
 * connects — a player has to be able to see WHICH END will hit them, and from
 * the iso view a uniform bar reads as a wall sweeping the room.
 */
function buildSwingArm(): THREE.Group {
  const gp = new THREE.Group();
  const post = new THREE.Mesh(cylGeo(0.16, 0.19, 0.34, 10), std(C_STEEL_DK));
  post.position.y = 0.17;

  const arm = new THREE.Group();
  const bar = new THREE.Mesh(boxGeo(SWINGARM_LEN, 0.09, 0.14), std(C_STEEL, C_ARCANE, 0.25));
  bar.position.set(SWINGARM_LEN / 2, 0.3, 0);
  // The hand: a fist-sized block with a stubby thumb, so it reads as a HAND
  // from above rather than as a lump on a stick.
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(boxGeo(0.3, 0.2, 0.34), stdOwn(C_GOLD, C_GOLD, 0.75));
  const thumb = new THREE.Mesh(boxGeo(0.16, 0.14, 0.12), stdOwn(C_GOLD, C_GOLD, 0.55));
  thumb.position.set(0.05, 0.02, 0.2);
  hand.add(palm, thumb);
  hand.position.set(SWINGARM_LEN, 0.3, 0);
  arm.add(bar, hand);
  gp.add(post, arm);
  gp.userData.arm = arm;
  gp.userData.handMat = palm.material as THREE.MeshStandardMaterial;
  return gp;
}

/**
 * FLYWHEEL — two counter-rotating wheels with a shooting gap between them.
 *
 * Both wheels sit ACROSS the launch direction with the gap on the part's axis,
 * so the silhouette says "go through here" from above. Each wheel owns its own
 * material because the animator spins them opposite ways and flares them on a
 * shot; sharing one would put every flywheel on the floor in lockstep.
 */
function buildFlywheel(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  const rig = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(cylGeo(0.34, 0.34, 0.13, 12), stdOwn(C_STEEL, C_ARCANE, 0.4));
    // Lying in the floor plane, spinning about Y — the axis a top-down player
    // reads as "these are gripping something passing between them".
    w.position.set(0, 0.34, side * 0.42);
    wheels.push(w);
    // Tread blocks, so a spinning wheel actually LOOKS like it is spinning.
    // Without them a smooth cylinder rotating about its own axis of symmetry is
    // visually identical to a stationary one, and the part reads as dead.
    for (let k = 0; k < 4; k++) {
      const t = new THREE.Mesh(boxGeo(0.1, 0.16, 0.08), stdOwn(C_GOLD, C_GOLD, 0.5));
      const a = (k / 4) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
      t.rotation.y = -a;
      w.add(t);
    }
    const mount = new THREE.Mesh(cylGeo(0.09, 0.11, 0.34, 8), std(C_STEEL_DK));
    mount.position.set(0, 0.17, side * 0.42);
    rig.add(w, mount);
  }
  rig.rotation.y = yawFor(dirX, dirZ);
  gp.add(rig);
  gp.userData.wheels = wheels;
  return gp;
}

/**
 * MAGPOST — a pachinko post. Three looks, one behaviour.
 *
 * "Different types of posts" varies the CAP only: a dome, a ring and a spike
 * over the same slim shaft. The collision radius is identical for all three on
 * purpose — a field where some posts are secretly bigger than others is a
 * field the player cannot read, and the whole appeal of a peg cascade is that
 * you can see the geometry and still not predict it.
 */
function buildMagPost(variant: number): THREE.Group {
  const gp = new THREE.Group();
  const shaft = new THREE.Mesh(cylGeo(0.1, 0.12, 0.42, 8), std(C_STEEL_DK));
  shaft.position.y = 0.21;
  gp.add(shaft);
  const v = ((variant % 3) + 3) % 3;
  if (v === 0) {
    const dome = new THREE.Mesh(sphereGeo(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), stdOwn(C_ARCANE, C_ARCANE, 0.7));
    dome.position.y = 0.42;
    gp.add(dome);
    gp.userData.cap = dome.material;
  } else if (v === 1) {
    const ring = new THREE.Mesh(torusGeo(0.14, 0.045, 6, 12), stdOwn(C_GOLD, C_GOLD, 0.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.44;
    gp.add(ring);
    gp.userData.cap = ring.material;
  } else {
    const spike = new THREE.Mesh(coneGeo(0.13, 0.24, 6), stdOwn(C_SHOT, C_SHOT, 0.55));
    spike.position.y = 0.53;
    gp.add(spike);
    gp.userData.cap = spike.material;
  }
  return gp;
}

function buildMirror(mx: number, mz: number): THREE.Group {
  const gp = new THREE.Group();
  // A slim reflective slab standing along its surface line, glinting edge.
  const slab = new THREE.Mesh(boxGeo(1.0, 0.5, 0.08), std(C_STEEL, C_ARCANE, 0.35));
  slab.position.y = 0.28;
  const glint = new THREE.Mesh(boxGeo(1.0, 0.5, 0.02), stdOwn(0xeef1f5, 0xeef1f5, 0.5));
  glint.position.set(0, 0.28, 0.05);
  const rail = new THREE.Group();
  rail.add(slab, glint);
  rail.rotation.y = yawFor(mx, mz);
  gp.add(rail);
  gp.userData.glint = glint.material;
  return gp;
}

function buildPit(): THREE.Group {
  const gp = new THREE.Group();
  // A dark recessed hole with a jagged rim — reads as "do not fall in".
  const hole = new THREE.Mesh(cylGeo(0.42, 0.3, 0.5, 16), std(PALETTE_HEX[0], 0x000000, 0));
  hole.position.y = -0.24; // sunk below the floor
  const rim = new THREE.Mesh(torusGeo(0.44, 0.06, 8, 18), std(C_STEEL_DK));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.01;
  gp.add(hole, rim);
  return gp;
}

/**
 * A GRAVE PIT — the hole a departing knight's detonation tears in the floor.
 *
 * Deliberately louder than `buildPit`. A normal pit costs a heart; this one
 * KILLS, it appears mid-run with no warning where a player was standing a
 * moment ago, and a player who reads it as the familiar pit dies for free. So
 * it is wider (0.62 vs 0.42), it gets a ring of blown-out debris shards that
 * the plain pit has no equivalent of, and its rim is BLOOD-lit rather than
 * steel — the palette's danger channel, matching the damage numbers and the
 * boss bar rather than the machine parts.
 */
function buildGravePit(): THREE.Group {
  const gp = new THREE.Group();
  // The void. Deeper and wider than a pit, with near-black walls so it reads as
  // bottomless rather than as a bowl you could climb out of.
  const hole = new THREE.Mesh(cylGeo(0.62, 0.34, 0.9, 20), std(PALETTE_HEX[0], 0x000000, 0));
  hole.position.y = -0.42;
  // A torn, blood-lit rim: two rings at different radii so the edge reads as
  // ragged masonry rather than a machined lip.
  const rimMat = stdOwn(PALETTE_HEX[11], PALETTE_HEX[12], 0.35);
  const rim = new THREE.Mesh(torusGeo(0.64, 0.075, 8, 22), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.015;
  gp.userData.rimMat = rimMat; // the animator pulses this — see PART_ANIMATORS
  const rim2 = new THREE.Mesh(torusGeo(0.72, 0.035, 6, 20), std(PALETTE_HEX[10], PALETTE_HEX[11], 0.2));
  rim2.rotation.x = Math.PI / 2;
  rim2.position.y = -0.02;
  gp.add(hole, rim, rim2);
  // Blown-out debris: shards flung clear of the rim, irregular by construction
  // (a deterministic ring would read as decoration, not damage).
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + (k % 3) * 0.21;
    const rr = 0.78 + (k % 4) * 0.075;
    const shard = new THREE.Mesh(boxGeo(0.13 + (k % 3) * 0.04, 0.07, 0.1), std(PALETTE_HEX[2], PALETTE_HEX[10], 0.08));
    shard.position.set(Math.cos(a) * rr, 0.035, Math.sin(a) * rr);
    shard.rotation.set((k % 2) * 0.3, a + 0.4, (k % 3) * 0.22);
    gp.add(shard);
  }
  return gp;
}

function buildElectric(): THREE.Group {
  const gp = new THREE.Group();
  // A floor plate with four TALL prong pylons + a central emitter rod, so the
  // hazard has vertical presence and reads even when the plate is dark (was a
  // near-flat plate with stubby nodes).
  const plate = new THREE.Mesh(boxGeo(0.8, 0.04, 0.8), stdOwn(C_STEEL_DK, C_ARCANE, 0));
  plate.position.y = 0.02;
  gp.add(plate);
  const nodeMat = stdOwn(C_ARCANE, 0x9fe8ff, 0.2);
  for (const [nx, nz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]] as const) {
    const node = new THREE.Mesh(cylGeo(0.05, 0.07, 0.3, 8), nodeMat);
    node.position.set(nx, 0.17, nz);
    const tip = new THREE.Mesh(sphereGeo(0.06, 8, 6), nodeMat);
    tip.position.set(nx, 0.32, nz);
    gp.add(node, tip);
  }
  const core = new THREE.Mesh(cylGeo(0.035, 0.035, 0.42, 6), nodeMat);
  core.position.set(0, 0.23, 0);
  gp.add(core);
  gp.userData.plateMat = plate.material;
  gp.userData.nodeMat = nodeMat;
  return gp;
}

function buildFireVent(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // A wall nozzle (mount side is -dir) with a stubby barrel aimed down the lane.
  const mount = new THREE.Mesh(boxGeo(0.12, 0.4, 0.4), std(C_STEEL_DK));
  mount.position.set(-0.3, 0.28, 0);
  const barrel = new THREE.Mesh(cylGeo(0.1, 0.13, 0.3, 10), std(C_STEEL));
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(-0.1, 0.28, 0);
  /**
   * The flame plume keeps its CONE and gets the fire shader as its material.
   *
   * A cone rather than a camera-facing billboard because this jet has a DIRECTION
   * — it fires down a lane, and which lane is gameplay information the player
   * reads before stepping into it. A billboard cannot point along an arbitrary
   * lane and face the camera at the same time, so the geometry stays 3D.
   *
   * The shader's "billboard" orientation advects along -v in UV space, which on a
   * cone runs ALONG THE AXIS — so the flame travels out from the nozzle, which is
   * exactly what a jet does. The emissive-standard material it replaces could only
   * pulse its brightness.
   */
  const plumeFx = createFireMaterial({
    orientation: "billboard",
    worldSeed: true,
    cutoff: 0.14,
    scale: 1.7,
  });
  const plume = new THREE.Mesh(coneGeo(0.22, 1.0, 10), plumeFx.material);
  plume.rotation.z = -Math.PI / 2;
  plume.position.set(0.6, 0.28, 0);
  plume.scale.setScalar(0.001);
  gp.add(mount, barrel, plume);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.plume = plume;
  gp.userData.plumeFx = plumeFx;
  return gp;
}

function buildMagStrip(): THREE.Group {
  const gp = new THREE.Group();
  // A charged SLOW-field: a dark band with two tall humming coil pylons at the
  // ends and inward braking chevrons, so it reads "cross here and you get
  // dragged to a crawl" at a glance (was a near-flat floor stripe).
  const band = new THREE.Mesh(boxGeo(0.9, 0.04, 0.6), std(0x241d2e));
  band.position.y = 0.02;
  gp.add(band);
  const fieldMat = stdOwn(0x2e6d8f, 0x39b0d8, 0.5);
  for (const cx of [-0.4, 0.4]) {
    const post = new THREE.Mesh(cylGeo(0.08, 0.1, 0.44, 8), std(C_STEEL_DK));
    post.position.set(cx, 0.22, 0);
    gp.add(post);
    for (let k = 0; k < 3; k++) {
      const coil = new THREE.Mesh(torusGeo(0.13, 0.025, 6, 12), fieldMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(cx, 0.12 + k * 0.12, 0);
      gp.add(coil);
    }
    const cap = new THREE.Mesh(sphereGeo(0.09, 8, 6), fieldMat);
    cap.position.set(cx, 0.46, 0);
    gp.add(cap);
  }
  // braking chevrons on the band, pointing INWARD (the "you'll be slowed" read)
  for (const [cx, sgn] of [[-0.2, 1], [0.2, -1]] as const) {
    const chev = new THREE.Mesh(coneGeo(0.1, 0.18, 3), fieldMat);
    chev.rotation.z = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
    chev.position.set(cx, 0.06, 0);
    gp.add(chev);
  }
  gp.userData.fieldMat = fieldMat;
  return gp;
}

function buildMaw(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  const base = new THREE.Mesh(boxGeo(0.7, 0.2, 0.7), std(C_STEEL_DK, C_STEEL_DK, 0.1));
  base.position.y = 0.1;
  const throatMat = stdOwn(0x3a0910, 0xeb564b, 0.6);
  const throat = new THREE.Mesh(cylGeo(0.25, 0.15, 0.18, 10), throatMat);
  throat.position.set(0.1, 0.15, 0);

  const jaw = new THREE.Group();
  const jawHead = new THREE.Mesh(boxGeo(0.45, 0.2, 0.5), std(C_STEEL, 0xeb564b, 0.3));
  jawHead.position.set(0.15, 0.35, 0);
  const teeth = new THREE.Mesh(coneGeo(0.06, 0.12, 4), std(C_GOLD, C_GOLD, 0.5));
  teeth.rotation.z = Math.PI;
  teeth.position.set(0.28, 0.24, 0);
  jaw.add(jawHead, teeth);

  gp.add(base, throat, jaw);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.jaw = jaw;
  gp.userData.throatMat = throatMat;
  return gp;
}

/** The placement heading(s) a builder needs, unpacked from the level plan spot. */
export interface PartBuildCtx {
  /** Primary direction (launch / facing / surface line). */
  dirX: number;
  dirZ: number;
  /** Second leg — only the deflector's corner bank uses it. */
  dir2X: number;
  dir2Z: number;
  /**
   * Cosmetic variant index — only the magpost uses it, to pick one of three
   * caps. OPTIONAL so the three non-placement call sites (the instancer's two
   * orientation probes and the dev art-QA spawn) need not invent one; a post
   * built without it still gets a look, just always the same one.
   */
  variant?: number;
  /** Tile span across the wall band (seesaw only). */
  span?: number;
}

type PartBuilder = (c: PartBuildCtx) => THREE.Group;

/**
 * Per-kind MESH construction. EXHAUSTIVE by construction, exactly like
 * PART_HANDLERS in entities/pinball-collide.ts: adding a `PinballPartKind`
 * without adding it here is a type error.
 *
 * This replaced a 17-branch `if (s.kind === …)` chain whose final `else` was a
 * CATCH-ALL that built a deflector. A new kind therefore didn't fail loudly —
 * it silently rendered as a banked corner rail, or (once the chain grew a
 * branch for every kind the game actually placed) the catch-all only ever ran
 * for `deflector` and the next kind added would have inherited its mesh.
 * There is no no-op entry here on purpose: every part kind is visible furniture,
 * so "renders nothing" is never the right answer.
 */
export const PART_BUILDERS: Record<PinballPartKind, PartBuilder> = {
  bumper: () => buildBumper(),
  spring: ({ dirX, dirZ }) => buildSpring(dirX, dirZ),
  ramp: ({ dirX, dirZ }) => buildRamp(dirX, dirZ),
  booster: ({ dirX, dirZ }) => buildBooster(dirX, dirZ),
  boostcorner: ({ dirX, dirZ, dir2X, dir2Z }) => buildBoostCorner(dirX, dirZ, dir2X, dir2Z),
  boostcurve: ({ dirX, dirZ }) => buildBoostCurve(dirX, dirZ),
  jumppad: ({ dirX, dirZ }) => buildJumpPad(dirX, dirZ),
  deflector: ({ dirX, dirZ, dir2X, dir2Z }) => buildDeflector(dirX, dirZ, dir2X, dir2Z),
  glove: ({ dirX, dirZ }) => buildGlove(dirX, dirZ),
  oil: () => buildOil(),
  spinpad: () => buildSpinPad(),
  slingshot: ({ dirX, dirZ }) => buildSlingshot(dirX, dirZ),
  target: ({ dirX, dirZ }) => buildTarget(dirX, dirZ),
  trapdoor: () => buildTrapdoor(),
  flipper: ({ dirX, dirZ }) => buildFlipper(dirX, dirZ),
  swingarm: () => buildSwingArm(),
  flywheel: ({ dirX, dirZ }) => buildFlywheel(dirX, dirZ),
  magpost: ({ variant }) => buildMagPost(variant ?? 0),
  mirror: ({ dirX, dirZ }) => buildMirror(dirX, dirZ),
  pit: () => buildPit(),
  gravepit: () => buildGravePit(),
  electric: () => buildElectric(),
  firevent: ({ dirX, dirZ }) => buildFireVent(dirX, dirZ),
  magstrip: () => buildMagStrip(),
  rollover: ({ dirX, dirZ }) => buildRollover(dirX, dirZ),
  lamp: () => buildLamp(),
  maw: ({ dirX, dirZ }) => buildMaw(dirX, dirZ),
  seesaw: ({ dirX, dirZ, span }) => buildSeeSaw(dirX, dirZ, span),
  catapult: ({ dirX, dirZ }) => buildCatapult(dirX, dirZ),
  cannon: ({ dirX, dirZ }) => buildCannon(dirX, dirZ),
};

/**
 * Live instancers, one per instanced kind on this floor. Empty for a floor whose
 * plan has none, which is the normal case for every kind but `booster`.
 */
const instancers = new Map<PinballPartKind, PartInstancer>();

/**
 * Stand-in for `part.mesh` on an instanced part.
 *
 * It is NOT added to the scene — the InstancedMeshes are what draw. It exists
 * because `PinballPart.mesh` is the animators' handle on a part's `userData`,
 * and because `disposePinballParts` removes and releases it (both no-ops on an
 * empty Object3D). Nothing outside this file reads a part's mesh; checked at
 * e118e85, when the only `.mesh` hits elsewhere in the game were `sprite.mesh`.
 */
function instancedHandle(x: number, z: number, userData: Record<string, unknown>): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, 0, z);
  o.userData = userData;
  return o;
}

/** Build every part mesh for a level plan and register them on state. */
export function createPinballParts(spots: PinballPartSpot[], g: Grid, scene: THREE.Scene): void {
  // An InstancedMesh's capacity is fixed at construction, so the kind counts
  // have to be known before the first part is placed.
  const perKind = new Map<PinballPartKind, number>();
  for (const s of spots) {
    if (INSTANCED_KINDS.has(s.kind as PinballPartKind)) {
      perKind.set(s.kind as PinballPartKind, (perKind.get(s.kind as PinballPartKind) ?? 0) + 1);
    }
  }
  for (const [kind, count] of perKind) {
    const inst = createPartInstancer(
      kind,
      count,
      () => PART_BUILDERS[kind]({ dirX: 1, dirZ: 0, dir2X: 0, dir2Z: 1 }),
      () => PART_BUILDERS[kind]({ dirX: 0, dirZ: 1, dir2X: 1, dir2Z: 0 }),
      releaseOwned,
    );
    // null is a normal answer — the kind falls back to a Group per part below.
    if (!inst) continue;
    for (const m of inst.meshes) scene.add(m);
    instancers.set(kind, inst);
  }
  const placed = new Map<PinballPartKind, number>();

  for (const s of spots) {
    const { x, z } = tileCenter(g, s.i, s.j);
    const dirX = s.dirI;
    const dirZ = s.dirJ;
    const dir2X = s.dir2I;
    const dir2Z = s.dir2J;
    const inst = instancers.get(s.kind as PinballPartKind);
    let mesh: THREE.Object3D;
    if (inst) {
      const index = placed.get(s.kind as PinballPartKind) ?? 0;
      placed.set(s.kind as PinballPartKind, index + 1);
      inst.place(index, x, z, yawFor(dirX, dirZ));
      mesh = instancedHandle(x, z, inst.userDataFor(index, Math.random() * Math.PI * 2));
    } else {
      mesh = PART_BUILDERS[s.kind]({ dirX, dirZ, dir2X, dir2Z, variant: s.variant, span: s.span });
      mesh.position.set(x, 0, z);
      // NAMED, and not for debugging alone. A part is a Group of 3-13 meshes and
      // nothing else in the scene says so, which means a draw-call census can
      // only file its children under their geometry type — `?ConeGeometry+...`
      // for a bumper cap, indistinguishable from a stalactite. The name makes the
      // scene self-describing to `dev/draw-census.ts`, and it is the key
      // `mergeStaticGroup`'s `skipNames` needs to spare the children that animate.
      mesh.name = `part:${s.kind}`;
      scene.add(mesh);
    }
    const part: PinballPart = {
      kind: s.kind as PinballPartKind,
      i: s.i,
      j: s.j,
      x,
      z,
      dirX,
      dirZ,
      dir2X,
      dir2Z,
      cooldownT: 0,
      hitT: -1,
      // Seesaw attributes
      span: s.span,
      tilt: s.tilt ?? (s.kind === "seesaw" ? -1 : undefined),
      destI: s.destI,
      destJ: s.destJ,
      angle: s.kind === "cannon" ? Math.atan2(s.dirJ, s.dirI) : undefined,
      baseAngle: s.kind === "cannon" ? Math.atan2(s.dirJ, s.dirI) : undefined,
      sweepDir: s.kind === "cannon" ? 1 : undefined,
      // Gloves + fire vents fire on their own clock — desynced per part so a
      // gauntlet corridor punches in a wave, not a single broadside.
      fireT: s.kind === "glove" ? 0.6 + Math.random() * 2.2 : s.kind === "firevent" ? 0.6 + Math.random() * 2.4 : undefined,
      punchSpent: s.kind === "glove" || s.kind === "firevent" ? true : undefined,
      done: s.kind === "target" ? false : undefined,
      hits: s.kind === "bumper" ? 0 : undefined,
      bank: s.bank,
      seq: s.seq,
      lit: s.bank !== undefined ? false : undefined,
      // Electric plates share a clock but stagger phase so a room pulses as a
      // wave. A SWINGARM's phase is its authored seed instead — it comes from
      // the level plan rather than from Math.random, because the physics reads
      // it too and a floor has to replay identically from its seed.
      phase: s.kind === "electric" ? Math.random() * (ELEC_ON + ELEC_OFF) : s.kind === "swingarm" ? (s.phase ?? 0) : undefined,
      spin: s.kind === "swingarm" ? (s.spin ?? 1) : undefined,
      variant: s.kind === "magpost" ? (s.variant ?? 0) : undefined,
      field: s.field,
      orbit: s.orbit,
      orbitSeq: s.orbitSeq,
      lane: s.lane,
      laneSeq: s.laneSeq,
      // THE MACHINE THIS PART BELONGS TO. This assignment is the whole seam:
      // `maze/assembly-place.partsOf` stamps an `AssemblyRef` onto every spot
      // it lands, and for as long as this line was missing that ref got as far
      // as the level plan and no further. `asm` was read by exactly two modules
      // — `dev/pattern-census.ts` and `dev/floor-svg.ts` — both offline tools,
      // so an authored, checked, placed machine arrived in the running game as
      // an anonymous scatter of parts and nothing could reward completing one.
      // See machines.ts, which is the consumer this was always for.
      asm: s.asm,
      mesh,
    };
    state.pinballParts.push(part);
  }
  // Slice 5 — jackpot bookkeeping: how many bumpers this floor has to light.
  state.bumperTotal = state.pinballParts.filter((p) => p.kind === "bumper").length;
  state.bumpersLit = 0;
}

/**
 * Spawn ONE part at runtime, mid-floor, at a world position.
 *
 * `createPinballParts` above builds a whole level plan at load; this is for
 * hazards that appear during play (today: the grave pit a departing knight
 * leaves). Kept separate deliberately — the plan builder finishes by recomputing
 * `state.bumperTotal`/`bumpersLit`, and re-running that on an incremental add
 * would reset the floor's jackpot progress. This function must never touch
 * those counters, which is also why it refuses to spawn a bumper.
 *
 * Returns the part, or null if the grid/scene isn't ready.
 *
 * ⚠️ ALWAYS THE GROUP PATH, even for a kind in `INSTANCED_KINDS`. An
 * InstancedMesh's capacity is fixed when the floor is built, so there is no
 * slot for a part that did not exist then. A runtime-spawned booster would
 * simply render as its own six meshes, which is correct and costs six draws —
 * and today the only runtime spawn is a grave pit, which is not instanced.
 */
export function spawnPinballPart(kind: PinballPartKind, x: number, z: number, g: Grid, scene: THREE.Scene): PinballPart | null {
  if (kind === "bumper") return null; // would desync the jackpot counters — see above
  const mesh = PART_BUILDERS[kind]({ dirX: 0, dirZ: 1, dir2X: 1, dir2Z: 0 });
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const t = worldToTile(g, x, z);
  const part: PinballPart = {
    kind,
    i: t.i,
    j: t.j,
    x,
    z,
    dirX: 0,
    dirZ: 1,
    dir2X: 1,
    dir2Z: 0,
    cooldownT: 0,
    hitT: -1,
    mesh,
  };
  state.pinballParts.push(part);
  return part;
}

/** Global idle-animation clock (safe to reset per level). */
let animT = 0;

/** Per-frame context every animator shares. `animT` is read from module scope. */
interface PartAnimCtx {
  dt: number;
  /** state.freezeT > 0 — the freeze ray stops self-clocked parts mid-swing. */
  frozen: boolean;
}

type PartAnimator = (part: PinballPart, c: PartAnimCtx) => void;

/**
 * Parts with no idle/hit animation at all. Spelled out rather than omitted (the
 * `selfFiring` convention from entities/pinball-collide.ts): an explicit no-op
 * PROVES the kind was considered, where an absent entry would just be the old
 * silent miss wearing a table's clothes.
 */
const inert: PartAnimator = () => {};

/**
 * How long a hit animation lives before hitT is retired. Was a nested ternary
 * (`trapdoor ? … : firevent ? … : 0.6`); a table so a new kind with a long
 * animation can't silently inherit the 0.6 s default and get cut off.
 */
export const PART_HIT_LIFETIME: Record<PinballPartKind, number> = {
  bumper: 0.6,
  spring: 0.6,
  ramp: 0.6,
  booster: 0.6,
  boostcorner: 0.6,
  boostcurve: 0.6,
  // The jump pad's flash has to outlast the AIRTIME, or the pad goes dark while
  // the knight is still over the wall it threw him across and the shot reads as
  // two unrelated events. RAMP_HOP at RAMP_HOP_SPEED over RAMP_HOP_MAX tiles is
  // ~0.3 s; 0.9 covers it with the landing.
  jumppad: 0.9,
  deflector: 0.6,
  glove: 0.6,
  oil: 0.6,
  spinpad: 0.6,
  slingshot: 0.6,
  target: 0.6,
  trapdoor: TRAPDOOR_DROP + 1.6,
  flipper: 0.6,
  swingarm: 0.6,
  flywheel: 0.6,
  // A post is glanced off many times in one cascade; a long flash would smear
  // the whole field into one lit blur instead of showing the path taken.
  magpost: 0.25,
  mirror: 0.6,
  pit: 0.6,
  gravepit: 0.6,
  electric: 0.6,
  firevent: VENT_WARN + VENT_ACTIVE + 0.1,
  magstrip: 0.6,
  rollover: 0.6,
  lamp: 0.6,
  maw: 0.8,
  seesaw: 0.6,
  catapult: 0.8,
  cannon: 0.5,
};

/**
 * Per-kind idle/hit ANIMATION. EXHAUSTIVE by construction, the same shape as
 * PART_HANDLERS in entities/pinball-collide.ts.
 *
 * This replaced a 16-branch `else if` chain that ended `else if (part.kind !==
 * "pit")` — i.e. deflector reached its animation by being the only kind left
 * over, and `pit` by being explicitly excluded from the leftovers. A newly
 * added kind would have landed in that final branch and been animated as a
 * DEFLECTOR (reading userData.edge, which its mesh doesn't have, so: nothing).
 * Now a missing kind is a compile error.
 *
 * The glove and fire-vent SELF-CLOCKS used to be two `if (part.kind === …)`
 * guards ahead of the chain. They are folded into those two entries and run
 * first inside them, which is the same order as before: clock stamps hitT = 0,
 * then this frame's animation reads it, then the hitT lifetime check retires it.
 */
export const PART_ANIMATORS: Record<PinballPartKind, PartAnimator> = {
  bumper: (part) => {
    // hit: a fast radial pop (out 60ms, settle 140ms); idle: dome breathes
    let s = 1;
    if (part.hitT >= 0 && part.hitT < 0.2) {
      const t = part.hitT / 0.2;
      s = 1 + 0.35 * Math.sin(Math.min(1, t * 1.6) * Math.PI);
    }
    part.mesh.scale.set(s, 1, s);
    const dome = part.mesh.userData.dome as THREE.MeshStandardMaterial | undefined;
    // Slice 5 — a LIT bumper (or the whole floor during a jackpot) burns GOLD
    // and brighter; an unlit one keeps the cool arcane breathe.
    const lit = (part.hits ?? 0) >= BUMPER_LIT_HITS || state.jackpotT > 0;
    if (dome) {
      // An AIMED bumper flares white-hot on top of whatever it already was —
      // the shot you're lined up on should be the brightest thing on screen.
      dome.emissive.setHex(part.aimed ? C_SHOT : lit ? C_GOLD : C_ARCANE);
      const base = (lit ? 1.5 : 0.7) + (part.aimed ? 1.4 : 0);
      const rate = part.aimed ? 11 : lit ? 6 : 3;
      dome.emissiveIntensity = base + 0.3 * Math.sin(animT * rate + part.i) + (part.hitT >= 0 && part.hitT < 0.2 ? 1.2 : 0);
    }
  },

  spring: (part) => {
    // hit: squash then overshoot along Y — the boing
    const coil = part.mesh.userData.coil as THREE.Group | undefined;
    if (coil) {
      let sy = 1;
      if (part.hitT >= 0 && part.hitT < 0.3) {
        const t = part.hitT / 0.3;
        sy = t < 0.3 ? 1 - 0.6 * (t / 0.3) : 0.4 + 0.9 * Math.min(1, (t - 0.3) / 0.5) - 0.3 * Math.sin(((t - 0.3) / 0.7) * Math.PI);
        sy = Math.max(0.3, sy);
      }
      coil.scale.y = sy;
    }
  },

  ramp: (part) => {
    // A wave sweeps UP the three arrows (a clear directional "GO" crawl); on
    // trigger the whole ramp flashes bright and the kicker lip pops.
    const mats = part.mesh.userData.chevMats as EmissiveSink[] | undefined;
    const lipMat = part.mesh.userData.lipMat as EmissiveSink | undefined;
    const lipMesh = part.mesh.userData.lipMesh as THREE.Mesh | undefined;
    const phase = (part.mesh.userData.phase as number) ?? 0;
    const flash = part.hitT >= 0 && part.hitT < 0.3 ? 1 - part.hitT / 0.3 : 0;
    if (mats) {
      mats.forEach((m, k) => {
        const wave = Math.max(0, Math.sin(animT * 6 + phase - k * ((Math.PI * 2) / 3)));
        m.emissiveIntensity = 0.3 + 0.9 * wave + flash * 2.6;
      });
    }
    if (lipMat) lipMat.emissiveIntensity = 0.6 + 0.2 * Math.sin(animT * 4 + phase) + flash * 2.6;
    if (lipMesh) lipMesh.scale.y = 1 + flash * 0.7; // spring compress→release
  },

  booster: (part) => {
    // A fast forward wave chases down the three chevrons (a clear directional
    // "GO →"); the side strips pulse together; a trigger flashes the whole pad.
    const chevs = part.mesh.userData.chevMats as EmissiveSink[] | undefined;
    const strips = part.mesh.userData.stripMats as EmissiveSink[] | undefined;
    const phase = (part.mesh.userData.phase as number) ?? 0;
    const flash = part.hitT >= 0 && part.hitT < 0.25 ? 1 - part.hitT / 0.25 : 0;
    if (chevs) {
      chevs.forEach((m, k) => {
        const wave = Math.max(0, Math.sin(animT * 9 + phase - k * ((Math.PI * 2) / 3)));
        m.emissiveIntensity = 0.35 + 1.0 * wave + flash * 2.4;
      });
    }
    if (strips) strips.forEach((m) => (m.emissiveIntensity = 0.55 + 0.35 * Math.sin(animT * 5 + phase) + flash * 2.0));
  },

  boostcorner: (part) => {
    // The wave chases AROUND the turn, so the four chevrons light entry-to-exit
    // in order — the animation is what tells you which way the corner goes when
    // the mesh is half-occluded by the wall it's tucked against. The exit lip
    // flares on a hit, a beat after the last chevron, so a good line reads as a
    // punch rather than a glow.
    const chevs = part.mesh.userData.chevMats as EmissiveSink[] | undefined;
    const lip = part.mesh.userData.lipMat as EmissiveSink | undefined;
    const phase = (part.mesh.userData.phase as number) ?? 0;
    const flash = part.hitT >= 0 && part.hitT < 0.3 ? 1 - part.hitT / 0.3 : 0;
    if (chevs) {
      chevs.forEach((m, k) => {
        const wave = Math.max(0, Math.sin(animT * 8 + phase - k * ((Math.PI * 2) / chevs.length)));
        m.emissiveIntensity = 0.3 + 0.95 * wave + flash * 2.2;
      });
    }
    if (lip) lip.emissiveIntensity = 0.35 + 0.25 * Math.sin(animT * 4 + phase) + flash * 2.4;
  },

  boostcurve: (part) => {
    // Same forward crawl as the straight pad but SLOWER and softer: several of
    // these sit end to end in one curve, and three fast independent waves side
    // by side strobe rather than flow. The lean rail glows steady to draw the
    // line of the curve itself.
    const chevs = part.mesh.userData.chevMats as EmissiveSink[] | undefined;
    const strips = part.mesh.userData.stripMats as EmissiveSink[] | undefined;
    const phase = (part.mesh.userData.phase as number) ?? 0;
    const flash = part.hitT >= 0 && part.hitT < 0.25 ? 1 - part.hitT / 0.25 : 0;
    if (chevs) {
      chevs.forEach((m, k) => {
        const wave = Math.max(0, Math.sin(animT * 6 + phase - k * ((Math.PI * 2) / 3)));
        m.emissiveIntensity = 0.35 + 0.7 * wave + flash * 2.2;
      });
    }
    if (strips) strips.forEach((m) => (m.emissiveIntensity = 0.7 + flash * 1.6));
  },

  jumppad: (part) => {
    // Chevrons climb, then the takeoff lip STROBES — an anticipation beat that
    // says "this one goes up". On a hit the lip goes white-hot for the whole
    // airtime (see PART_HIT_LIFETIME.jumppad) so the pad is still visibly the
    // source of the flight while the knight is over the wall.
    const chevs = part.mesh.userData.chevMats as EmissiveSink[] | undefined;
    const lip = part.mesh.userData.lipMat as EmissiveSink | undefined;
    const phase = (part.mesh.userData.phase as number) ?? 0;
    const flash = part.hitT >= 0 && part.hitT < 0.5 ? 1 - part.hitT / 0.5 : 0;
    if (chevs) {
      chevs.forEach((m, k) => {
        const wave = Math.max(0, Math.sin(animT * 7 + phase - k * ((Math.PI * 2) / 3)));
        m.emissiveIntensity = 0.3 + 0.9 * wave + flash * 2.6;
      });
    }
    if (lip) lip.emissiveIntensity = 0.4 + 0.3 * Math.abs(Math.sin(animT * 3 + phase)) + flash * 3;
  },

  deflector: (part) => {
    // deflector: gold edge flashes on a hit
    const edge = part.mesh.userData.edge as THREE.MeshStandardMaterial | undefined;
    if (edge) edge.emissiveIntensity = 0.5 + (part.hitT >= 0 && part.hitT < 0.25 ? 1.4 * (1 - part.hitT / 0.25) : 0);
  },

  glove: (part, { dt, frozen }) => {
    // GLOVE clock: count down to the punch, throw it (hitT drives both the
    // piston anim and the live damage window read by entities/hazards.ts),
    // rewind with jitter. The freeze-ray stops the clock mid-swing.
    if (!frozen) {
      part.fireT = (part.fireT ?? GLOVE_PERIOD) - dt;
      if (part.fireT <= 0) {
        part.fireT = GLOVE_PERIOD * (0.8 + Math.random() * 0.5);
        part.hitT = 0;
        part.punchSpent = false;
      }
    }
    // punch: the piston SNAPS out over the active window, eases back after
    const piston = part.mesh.userData.piston as THREE.Group | undefined;
    if (piston) {
      let ext = 0;
      if (part.hitT >= 0) {
        const t = part.hitT;
        ext = t < GLOVE_ACTIVE ? Math.min(1, t / 0.05) : Math.max(0, 1 - (t - GLOVE_ACTIVE) / 0.25);
      }
      piston.position.x = ext * (GLOVE_LANE_LEN * 0.75);
    }
    const fist = part.mesh.userData.fist as THREE.MeshStandardMaterial | undefined;
    if (fist) fist.emissiveIntensity = 0.3 + (part.hitT >= 0 && part.hitT < GLOVE_ACTIVE ? 0.8 : 0);
  },

  oil: (part) => {
    const sheen = part.mesh.userData.sheen as THREE.MeshStandardMaterial | undefined;
    if (sheen) sheen.emissiveIntensity = 0.16 + 0.1 * Math.sin(animT * 1.7 + part.i * 2);
  },

  spinpad: (part) => {
    // Reads the SAME phase function the collision handler does, off the same
    // sim clock — the rotor you see IS the deflection you get. Deliberately not
    // gated on `frozen` any more: the pad's angle is now a readout the player
    // aims with, and a spinner that looks stopped while it is still turning
    // would be lying about the shot.
    const rotor = part.mesh.userData.rotor as THREE.Group | undefined;
    if (rotor) rotor.rotation.y = spinPadPhase(state.elapsed, part.i);
  },

  slingshot: (part) => {
    // the band twangs on a hit
    const band = part.mesh.userData.band as THREE.Mesh | undefined;
    if (band) {
      const k = part.hitT >= 0 && part.hitT < 0.3 ? Math.sin((part.hitT / 0.3) * Math.PI * 3) * 0.25 : 0;
      band.position.x = k;
    }
  },

  target: (part, { dt }) => {
    const mats = part.mesh.userData.ringMats as THREE.MeshStandardMaterial[] | undefined;
    const rings = part.mesh.userData.rings as THREE.Group | undefined;
    if (part.done) {
      // broken: rings tip over, glow dies
      if (rings) rings.rotation.z = Math.min(Math.PI / 2.2, rings.rotation.z + dt * 6);
      if (mats) mats.forEach((m) => (m.emissiveIntensity = 0.02));
    } else if (part.bank !== undefined && mats) {
      // Slice 6 — banked drop-target: GREEN steady-bright once lit, else a
      // dim red "armed" wink so the 1-2-3 progress reads at a glance.
      mats[2].emissive.setHex(part.lit ? 0x6fe89a : 0xd95763);
      mats[2].emissiveIntensity = part.lit ? 1.7 : 0.5 + 0.35 * Math.sin(animT * 4 + part.j);
    } else if (mats) {
      mats[2].emissiveIntensity = 0.7 + 0.5 * Math.sin(animT * 4 + part.j); // the eye winks
    }
  },

  trapdoor: (part) => {
    // The hatch BANGS open on its hinge, hangs there while the knight drops
    // through (entities/player.startDrop owns that beat — the swing is timed
    // to TRAPDOOR_OPEN so the floor is gone exactly when he falls), then
    // creaks shut on an empty hole.
    const door = part.mesh.userData.door as THREE.Group | undefined;
    if (door) {
      let open = 0;
      if (part.hitT >= 0) {
        const t = part.hitT;
        if (t < TRAPDOOR_OPEN) {
          // Slam: eased out hard, then a small overswing that settles back —
          // a door thrown open, not a door lerped open.
          const u = t / TRAPDOOR_OPEN;
          open = 1 - (1 - u) * (1 - u) * (1 - u);
        } else if (t < TRAPDOOR_DROP + 0.9) {
          open = 1 + 0.06 * Math.sin((t - TRAPDOOR_OPEN) * 14) * Math.max(0, 1 - (t - TRAPDOOR_OPEN) * 2.5);
        } else {
          open = Math.max(0, 1 - (t - (TRAPDOOR_DROP + 0.9)) / 0.6); // creaks shut
        }
      }
      door.rotation.z = Math.min(1.08, Math.max(0, open)) * 1.4;
    }
  },

  flipper: (part) => {
    // The paddle SNAPS through its arc, then eases back to rest.
    //
    // It sweeps about Y — ACROSS the floor, the way a flipper does — and not
    // about Z, which is what this used to do: rotating the bat about its own
    // long axis' perpendicular tipped it UP like a drawbridge, a motion no
    // pinball table has and one the iso camera reads as the part falling over.
    // The arc carries it THROUGH the launch direction (rest is negative, the
    // top of the swing positive) so the follow-through is visible.
    //
    // The clock is `swingT` when the BUTTON drove this paddle and `hitT` when
    // something merely ran into it. Both exist: a commanded swing has to be
    // visible from the moment it is pressed, before anything has touched the
    // part, and `hitT` alone cannot show that — it is stamped by contact.
    // `held` parks the paddle at the top for as long as the button is down,
    // which is what a cradle looks like.
    const paddle = part.mesh.userData.paddle as THREE.Group | undefined;
    let up = 0;
    if (paddle) {
      if (part.held) {
        up = 1;
      } else {
        const t = part.swingT ?? part.hitT;
        if (t !== undefined && t >= 0) {
          up = t < FLIPPER_SWING ? Math.min(1, t / 0.06) : Math.max(0, 1 - (t - FLIPPER_SWING) / 0.3);
        }
      }
      paddle.rotation.y = FLIPPER_REST + up * FLIPPER_ARC;
    }
    // Slice 7 telegraph: the gold striking edge breathes so the flipper reads
    // "live/ready", and flares bright the instant it swings.
    const edge = part.mesh.userData.edgeMat as THREE.MeshStandardMaterial | undefined;
    if (edge) edge.emissiveIntensity = 0.55 + 0.35 * Math.sin(animT * 4 + part.i) + up * 1.8;
  },

  swingarm: (part) => {
    // ⚠️ THE ARM IS DRAWN FROM `swingArmPhase`, THE SAME FUNCTION THE COLLISION
    // READS. Not from an animator-local accumulator, and not from `animT`.
    //
    // The hand is the only part of this that connects, so the mesh's angle and
    // the hit test's angle ARE the same fact. Two clocks that agree today drift
    // the first time one of them is paused, reset or frame-gated — and the
    // failure is a part that hits you on empty air, which reads as a physics
    // bug and is actually a rendering one. `updatePinballParts` skips distant
    // parts' animators, so an accumulator here would additionally stop while
    // you walked away and the arm would teleport on your return.
    const arm = part.mesh.userData.arm as THREE.Group | undefined;
    if (arm) arm.rotation.y = -swingArmPhase(state.elapsed, part.spin ?? 1, part.phase ?? 0);
    const hand = part.mesh.userData.handMat as THREE.MeshStandardMaterial | undefined;
    if (hand) hand.emissiveIntensity = 0.75 + (part.hitT >= 0 && part.hitT < 0.25 ? 1.6 : 0);
  },

  flywheel: (part) => {
    // Counter-rotating, which is the whole read: two wheels turning the same
    // way would look like a conveyor, and a conveyor does not say "shoot".
    const wheels = part.mesh.userData.wheels as THREE.Mesh[] | undefined;
    if (wheels) {
      const a = state.elapsed * FLYWHEEL_SPIN_RATE + part.i;
      wheels.forEach((w, k) => {
        w.rotation.y = k === 0 ? a : -a;
        const m = w.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = 0.4 + (part.hitT >= 0 && part.hitT < 0.3 ? 1.5 : 0);
      });
    }
  },

  magpost: (part) => {
    // A post lights only when you actually clip it, and briefly. That flicker
    // IS the feedback a cascade gives: the lit posts behind you are the path
    // you just took through the field.
    const cap = part.mesh.userData.cap as THREE.MeshStandardMaterial | undefined;
    if (cap) cap.emissiveIntensity = 0.55 + (part.hitT >= 0 && part.hitT < 0.18 ? 1.8 : 0);
  },

  mirror: (part) => {
    const glint = part.mesh.userData.glint as THREE.MeshStandardMaterial | undefined;
    if (glint) glint.emissiveIntensity = 0.4 + 0.25 * Math.sin(animT * 2 + part.i) + (part.hitT >= 0 && part.hitT < 0.2 ? 1.2 : 0);
  },

  // A hole in the floor: no idle shimmer, no hit animation. The rim mesh is
  // static and the fall is the player's, not the part's.
  pit: inert,

  // A GRAVE PIT breathes, unlike a plain pit. It appeared mid-run where a
  // player just died, so it has to catch the eye of someone who has already
  // learned to ignore the static floor furniture — a slow blood pulse on the
  // rim does that without animating anything the player could mistake for a
  // safe, cycling hazard (electric/firevent both telegraph a safe phase; this
  // one is never safe).
  gravepit: (part) => {
    const mat = part.mesh.userData.rimMat as THREE.MeshStandardMaterial | undefined;
    if (mat) mat.emissiveIntensity = 0.35 + 0.22 * Math.sin(animT * 2.2 + part.i);
  },

  electric: (part, { frozen }) => {
    // pulse: dark for ELEC_OFF, glow for ELEC_ON — per-plate phase offset
    const live = ((animT + (part.phase ?? 0)) % (ELEC_ON + ELEC_OFF)) < ELEC_ON;
    const warn = !live && ((animT + (part.phase ?? 0)) % (ELEC_ON + ELEC_OFF)) > ELEC_OFF - 0.3; // about to fire
    const plate = part.mesh.userData.plateMat as THREE.MeshStandardMaterial | undefined;
    const node = part.mesh.userData.nodeMat as THREE.MeshStandardMaterial | undefined;
    const glow = frozen ? 0 : live ? 1.6 + 0.4 * Math.sin(animT * 30) : warn ? 0.5 : 0.05;
    if (plate) plate.emissiveIntensity = glow;
    if (node) node.emissiveIntensity = glow + 0.2;
  },

  firevent: (part, { dt, frozen }) => {
    // FIRE VENT clock: same cadence as the glove, its own period; hitT drives
    // the plume + the burn window read by hazards.ts. Frozen = no jet.
    if (!frozen) {
      part.fireT = (part.fireT ?? VENT_PERIOD) - dt;
      if (part.fireT <= 0) {
        part.fireT = VENT_PERIOD * (0.8 + Math.random() * 0.5);
        part.hitT = 0;
        part.punchSpent = false;
      }
    }
    // the plume roars during the active window, sputters just before
    const plume = part.mesh.userData.plume as THREE.Mesh | undefined;
    const fx = part.mesh.userData.plumeFx as ElementMaterial | undefined;
    let scale = 0.001;
    if (part.hitT >= 0) {
      const t = part.hitT;
      if (t < VENT_WARN) scale = 0.15 + 0.1 * Math.sin(t * 40); // sputter tell
      else if (t < VENT_WARN + VENT_ACTIVE) scale = 1 + 0.15 * Math.sin(t * 25); // roar
    }
    // The scale animation STAYS. It is the tell — the sputter warns and the roar
    // commits — and a player has to be able to read it from across a room, which
    // is a silhouette job, not a brightness job. What the shader replaces is the
    // emissive pulse that used to stand in for the flame itself.
    if (plume) plume.scale.setScalar(scale);
    if (fx) {
      fx.uTime.value += dt;
      // Sputtering is a guttering flame, roaring is a jet. Feeding the same scale
      // into intensity means the two read differently in COLOUR as well as size:
      // the sputter sits in the low bands (ember/dark) and only the roar reaches
      // the white core.
      fx.uIntensity.value = scale > 0.5 ? 1.15 : 0.55;
    }
  },

  magstrip: (part, { frozen }) => {
    const field = part.mesh.userData.fieldMat as THREE.MeshStandardMaterial | undefined;
    if (field) field.emissiveIntensity = frozen ? 0.1 : 0.45 + 0.4 * Math.sin(animT * 8 + part.i);
  },

  rollover: (part) => {
    // Lamp: gold + steady when this lane is lit, cool and breathing when not.
    const lamp = part.mesh.userData.lamp as THREE.MeshStandardMaterial | undefined;
    if (lamp) {
      const lit = part.lane !== undefined && part.laneSeq !== undefined && !!state.laneLit[part.lane]?.[part.laneSeq];
      lamp.emissive.setHex(part.aimed ? C_SHOT : lit ? C_GOLD : C_ARCANE);
      lamp.emissiveIntensity = (lit ? 1.6 : 0.5) + (part.aimed ? 1.2 : 0) + 0.25 * Math.sin(animT * (lit ? 5 : 2.5) + part.i);
    }
  },

  lamp: (part) => {
    // A brazier: a cold arcane flicker while unlit; a bright leaping GOLD flame
    // once lit (part.lit set by the puzzle). Bowl warms to match.
    const flameMat = part.mesh.userData.flameMat as THREE.MeshStandardMaterial | undefined;
    const bowlMat = part.mesh.userData.bowlMat as THREE.MeshStandardMaterial | undefined;
    const flame = part.mesh.userData.flame as THREE.Object3D | undefined;
    const lit = !!part.lit;
    if (flameMat) {
      flameMat.emissive.setHex(part.aimed && !lit ? C_SHOT : lit ? C_GOLD : C_ARCANE);
      flameMat.emissiveIntensity = (lit ? 2.0 : 0.55) + (part.aimed && !lit ? 1.3 : 0) + 0.35 * Math.sin(animT * (lit ? 9 : 3) + part.i);
    }
    if (bowlMat) bowlMat.emissive.setHex(lit ? C_GOLD : C_ARCANE);
    if (flame) {
      const leap = lit ? 1 + 0.18 * Math.sin(animT * 11 + part.i) : 1;
      flame.scale.set(1, leap, 1);
      flame.position.y = 0.36 + (lit ? 0.04 * Math.sin(animT * 9) : 0);
    }
  },

  maw: (part) => {
    const jaw = part.mesh.userData.jaw as THREE.Group | undefined;
    const throatMat = part.mesh.userData.throatMat as THREE.MeshStandardMaterial | undefined;
    if (jaw) {
      if (part.hitT >= 0 && part.hitT < 0.4) {
        const t = part.hitT / 0.4;
        jaw.position.y = t < 0.3 ? -0.15 * (1 - t / 0.3) : 0;
      } else {
        jaw.position.y = 0.03 * Math.sin(animT * 2 + part.i);
      }
    }
    if (throatMat) {
      throatMat.emissiveIntensity = 0.6 + 0.3 * Math.sin(animT * 3 + part.j);
    }
  },

  seesaw: (part, { dt }) => {
    const pivot = part.mesh.userData.pivot as THREE.Group | undefined;
    const chevs = part.mesh.userData.chevs as EmissiveSink[] | undefined;
    const targetTilt = (part.tilt ?? -1) * SEESAW_TILT_ANGLE;
    if (pivot) {
      // Smoothly tilt toward the target resting angle
      pivot.rotation.z += (targetTilt - pivot.rotation.z) * Math.min(1, dt * 10);
    }
    const flash = part.hitT >= 0 && part.hitT < 0.3 ? 1 - part.hitT / 0.3 : 0;
    if (chevs) {
      chevs.forEach((m, k) => {
        const wave = Math.max(0, Math.sin(animT * 6 - k * (Math.PI / 2)));
        m.emissiveIntensity = 0.4 + 0.8 * wave + flash * 2.5;
      });
    }
  },

  catapult: (part) => {
    const arm = part.mesh.userData.arm as THREE.Group | undefined;
    const basketGlow = part.mesh.userData.basketGlow as THREE.MeshStandardMaterial | undefined;
    if (arm) {
      if (part.hitT >= 0 && part.hitT < 0.6) {
        const t = part.hitT / 0.6;
        arm.rotation.z = -Math.sin(t * Math.PI) * 0.95;
      } else {
        arm.rotation.z = 0;
      }
    }
    if (basketGlow) {
      const pulse = 0.5 + 0.5 * Math.sin(animT * 4 + part.i);
      const flash = part.hitT >= 0 && part.hitT < 0.4 ? 2.5 * (1 - part.hitT / 0.4) : 0;
      basketGlow.emissiveIntensity = pulse + flash;
    }
  },

  cannon: (part) => {
    const barrel = part.mesh.userData.barrel as THREE.Group | undefined;
    const tracer = part.mesh.userData.tracer as THREE.MeshStandardMaterial | undefined;
    const sweepRange = 0.95;
    if (part.angle === undefined) part.angle = part.baseAngle ?? 0;
    part.angle = (part.baseAngle ?? 0) + Math.sin(animT * CANNON_SWEEP_RATE + (part.i % 5)) * sweepRange;
    if (barrel) {
      barrel.rotation.y = -part.angle;
      if (part.hitT >= 0 && part.hitT < 0.4) {
        const t = part.hitT / 0.4;
        barrel.position.x = -Math.sin(t * Math.PI) * 0.2;
      } else {
        barrel.position.x = 0;
      }
    }
    if (tracer) {
      tracer.emissiveIntensity = 0.8 + 0.6 * Math.sin(animT * 8);
    }
  },
};

/** Countdown to the next frost glint while the freeze-ray holds the table. */
let frostTellT = 0;

/**
 * Tick cooldowns + drive idle/hit animations. The ONE place part timers mutate
 * per frame; player.ts only consumes ready parts and stamps cooldownT/hitT=0.
 */
export function updatePinballParts(dt: number): void {
  animT += dt;
  if (state.jackpotT > 0) state.jackpotT = Math.max(0, state.jackpotT - dt); // Slice 5 flash window
  const frozen = state.freezeT > 0;
  // ❄️ FREEZE TELL: without this the freeze-ray reads as "the table hung" —
  // parts halt mid-swing with no visible cause. Sparse frost glints over
  // random halted parts say HELD for the whole duration, and stopping the
  // moment freezeT runs out is itself the ending cue.
  if (frozen && state.vfx && state.pinballParts.length > 0) {
    frostTellT -= dt;
    if (frostTellT <= 0) {
      frostTellT = FREEZE_TELL_INTERVAL;
      for (let n = 0; n < FREEZE_TELL_PARTS; n++) {
        const part = state.pinballParts[(Math.random() * state.pinballParts.length) | 0];
        state.vfx.burst(part.x + (Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.45, part.z + (Math.random() - 0.5) * 0.5, TELL_TINT_FREEZE, 1, 0.35);
      }
    }
  }
  // ── LIT SHOT: while you're travelling under momentum, whatever you're
  // actually aimed at lights up. A real table tells you where the shot IS —
  // this floor had a light vocabulary (bumper gold, bank green/red) but no
  // "shoot HERE now", so the machine never pointed anywhere. Recomputed per
  // frame from the momentum ray; costs one dot product per part.
  const pl = state.player;
  const aiming = !!pl && pl.momSpeed >= SHOT_LIGHT_MIN_SPEED;
  for (const part of state.pinballParts) {
    // TIMERS ALWAYS TICK, for every part on the floor, however distant.
    // These are GAME STATE, not animation: a bumper's cooldown decides whether
    // it fires when you arrive, so freezing it off-screen would mean a part's
    // readiness depended on whether you had been looking at it. That is the
    // classic distance-culling bug and it would be maddening to debug.
    part.cooldownT = Math.max(0, part.cooldownT - dt);
    if (part.hitT >= 0) part.hitT += dt;
    if (part.hitT > PART_HIT_LIFETIME[part.kind]) part.hitT = -1;
    // BOOSTER JAM window (same reasoning as the cooldown above — game state, so
    // it ticks everywhere). When it lapses the pad's jam streak is stale: the
    // ball left and came back later, which is a fresh visit, not a rattle.
    if (part.jamT !== undefined && part.jamT > 0) {
      part.jamT = Math.max(0, part.jamT - dt);
      if (part.jamT === 0) part.jamN = 0;
    }

    // Everything BELOW here is purely visual, so it is gated on being near
    // enough to see. The animator walks meshes and writes material uniforms —
    // by far the expensive half — and a part the camera cannot show has
    // nothing to animate. The camera sees VIEW_W x VIEW_H tiles, so a radius
    // generous enough to cover the corners still skips most of a big floor.
    const vdx = pl ? part.x - pl.x : 0;
    const vdz = pl ? part.z - pl.z : 0;
    const near = !pl || vdx * vdx + vdz * vdz <= PART_ANIM_RANGE_SQ;
    if (!near) {
      // Off-screen parts must not keep a stale "aimed" glow: if one lights up
      // and you leave, it would still be lit when you came back.
      part.aimed = false;
      continue;
    }

    part.aimed = false;
    if (aiming && pl) {
      const dist = Math.hypot(vdx, vdz);
      if (dist > 0.6 && dist <= SHOT_LIGHT_RANGE) {
        // Inside the forward cone — tighter the further away, so the light
        // resolves onto ONE part as you close rather than washing a whole room.
        part.aimed = (pl.momX * vdx + pl.momZ * vdz) / dist >= SHOT_LIGHT_COS;
      }
    }

    // Self-clocks (glove, fire vent) live at the top of their own animator, so
    // they still stamp hitT before this frame's animation reads it.
    PART_ANIMATORS[part.kind](part, { dt, frozen });
  }
  // ONE upload per instance attribute per frame, after every animator has had
  // its say. Flagging inside the sink setters instead would re-flag the same
  // buffer five times a part; flagging unconditionally would re-upload a
  // floor's worth of boosters on a frame where the player is nowhere near one
  // (the range gate above skips their animators entirely, so nothing changed).
  for (const inst of instancers.values()) inst.flush();
}

/** Remove + dispose every part mesh (per-level teardown). */
// ── THE PLUNGER RIG — the visible launcher, "the thing that hits the marble".
// Shown only while a floor is parked awaiting launch (state.plungerArmed): a
// chute that hugs the knight plus a gold striker head that draws back with the
// charge and would whack the knight into play on release. Local +X is the
// launch direction; the rig yaws to the live launch line and rides the player. ──
let plungerRig: THREE.Group | null = null;

/** Plunger materials draw ON TOP (depthTest off) so the rig is never buried by
 *  the wall the spawn sits against — it reads as a launcher in the back frame. */
function plungerMat(color: number, emissive = 0, ei = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.5, metalness: 0 });
  m.depthTest = false;
  m.depthWrite = false;
  return m;
}

function buildPlungerRig(): THREE.Group {
  const g = new THREE.Group();
  // COMPACT (no long rails — those buried into the wall behind the spawn): a
  // short spring behind the knight + a bright gold plunger head, all emissive
  // and drawn over the walls so you can always see it. Local +X = launch.
  const striker = new THREE.Group();
  striker.name = "striker";
  const head = new THREE.Mesh(cylGeo(0.24, 0.26, 0.42, 12), plungerMat(0x3a2c0a, C_GOLD, 0.9));
  head.rotation.z = Math.PI / 2; // lay the disc along the launch axis
  head.position.set(0.1, 0.4, 0);
  // A stubby spring coil (stacked rings) behind the head.
  for (let k = 0; k < 3; k++) {
    const ring = new THREE.Mesh(torusGeo(0.16, 0.05, 6, 12), plungerMat(0x2a2214, C_GOLD, 0.5));
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.12 - k * 0.16, 0.4, 0);
    striker.add(ring);
  }
  striker.add(head);
  striker.position.set(-0.55, 0, 0);
  g.add(striker);
  // Draw the whole rig last, over the walls.
  g.traverse((o) => {
    (o as THREE.Mesh).renderOrder = 30;
  });
  return g;
}

/** Show/position the plunger rig each frame; a no-op unless a floor is parked. */
export function updatePlungerRig(): void {
  const p = state.player;
  const armed = state.plungerArmed && !!p && !!state.scene;
  if (!plungerRig) {
    if (!armed) return;
    plungerRig = buildPlungerRig();
    state.scene!.add(plungerRig);
  }
  plungerRig.visible = !!armed;
  if (!armed || !p) return;
  plungerRig.position.set(p.x, 0, p.z);
  // local +X → world launch dir: rotation.y θ maps +X to (cosθ, 0, -sinθ).
  plungerRig.rotation.y = Math.atan2(-state.plungerDirZ, state.plungerDirX);
  const striker = plungerRig.getObjectByName("striker");
  if (striker) striker.position.x = -(0.55 + state.plungerPower * 0.5); // short draw-back so it stays clear of walls
}

/**
 * Release one part's GPU objects — but ONLY the ones it owns.
 *
 * Everything from `std`/`*Geo` is flagged `userData.shared` and belongs to the
 * module cache, not to this part: it is the same buffer the next floor's parts
 * will draw with. Disposing it here is not a leak fix, it is a use-after-free —
 * the floor rebuilds, hands out the cached geometry, and draws nothing. This is
 * the same rule the texture cache in maze/build.ts states ("never dispose it").
 */
function releaseOwned(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(mat) ? mat : [mat]) {
      if (mm && !mm.userData.shared) mm.dispose();
    }
  });
}

function disposePlungerRig(scene: THREE.Scene | null): void {
  if (!plungerRig) return;
  scene?.remove(plungerRig);
  releaseOwned(plungerRig);
  plungerRig = null;
}

export function disposePinballParts(scene: THREE.Scene | null): void {
  disposePlungerRig(scene); // rebuilt with the current scene on the next armed floor
  for (const part of state.pinballParts) {
    scene?.remove(part.mesh);
    releaseOwned(part.mesh);
  }
  // Instanced kinds own a cloned geometry and a node material per animated slot
  // — everything else they draw with came from the shared caches and must
  // survive into the next floor. `PartInstancer.dispose` knows which is which.
  for (const inst of instancers.values()) inst.dispose(scene);
  instancers.clear();
  state.pinballParts = [];
}
