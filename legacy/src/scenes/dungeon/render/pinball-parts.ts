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
import { GLOVE_PERIOD, GLOVE_ACTIVE, GLOVE_LANE_LEN, FLIPPER_SWING, ELEC_ON, ELEC_OFF, VENT_PERIOD, VENT_WARN, VENT_ACTIVE, BUMPER_LIT_HITS, TRAPDOOR_OPEN, TRAPDOOR_DROP, SHOT_LIGHT_MIN_SPEED, SHOT_LIGHT_RANGE, SHOT_LIGHT_COS, PART_ANIM_RANGE_SQ } from "../constants";

const C_STEEL_DK = PALETTE_HEX[19];
const C_STEEL = PALETTE_HEX[20];
const C_ARCANE = PALETTE_HEX[31]; // 0x6fd0e8 — the machine's glow colour
const C_GOLD = PALETTE_HEX[16]; // flame/gold accents
const C_SHOT = PALETTE_HEX[21]; // the LIT-SHOT flare — the brightest thing on the table

/** Yaw that rotates the +x axis onto the world direction (dx, dz). */
function yawFor(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

function std(color: number, emissive = 0, emissiveIntensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness: 0.6, metalness: 0.2 });
}

function buildBumper(): THREE.Group {
  const gp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.16, 12), std(C_STEEL_DK));
  base.position.y = 0.08;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 16), std(C_GOLD, C_GOLD, 0.5));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.17;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(C_ARCANE, C_ARCANE, 0.9));
  dome.position.y = 0.16;
  gp.add(base, ring, dome);
  gp.userData.dome = dome.material;
  return gp;
}

function buildSpring(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.56), std(C_STEEL_DK));
  plate.position.y = 0.03;
  // coil — three stacked thin discs reads as a spring after the quantize
  const coil = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), std(C_STEEL));
    loop.rotation.x = Math.PI / 2;
    loop.position.y = 0.1 + k * 0.07;
    coil.add(loop);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), std(C_STEEL, C_ARCANE, 0.25));
  top.position.y = 0.33;
  coil.add(top);
  // chevron arrow on the plate aimed along the launch direction
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 3), std(C_GOLD, C_GOLD, 0.8));
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
    const rail = new THREE.Mesh(new THREE.BoxGeometry(LEN * 1.02, 0.12, 0.06), std(C_STEEL, C_GOLD, 0.28));
    rail.position.set(0, H / 2 + 0.05, (zside * W) / 2);
    rail.rotation.z = slope; // lie along the rising slope
    gp.add(rail);
  }

  // ── Three big arrows climbing the slope (the "GO this way" crawl) ──
  const chevMats: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const m = std(C_ARCANE, C_ARCANE, 0.8);
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 3), m);
    chev.rotation.z = -Math.PI / 2 + slope; // point up-slope, flush with the incline
    const x = -0.24 + k * 0.24;
    chev.position.set(x, slopeY(x) + 0.06, 0);
    chevMats.push(m);
    gp.add(chev);
  }

  // ── Gold kicker lip at the top (the launch edge) ──
  const lipMat = std(C_GOLD, C_GOLD, 0.7);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, W + 0.06), lipMat);
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
  const plate = new THREE.Mesh(new THREE.BoxGeometry(LEN, 0.05, W), std(0x1a1f2b));
  plate.position.y = 0.025;
  gp.add(plate);
  // ── Two neon side strips running down the lane ──
  const stripMats: THREE.MeshStandardMaterial[] = [];
  for (const zside of [-1, 1]) {
    const m = std(C_ARCANE, C_ARCANE, 0.8);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(LEN, 0.06, 0.06), m);
    strip.position.set(0, 0.06, (zside * (W - 0.06)) / 2);
    stripMats.push(m);
    gp.add(strip);
  }
  // ── Three big forward chevrons (the scrolling "GO →" crawl) ──
  const chevMats: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const m = std(C_GOLD, C_GOLD, 0.9);
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 3), m);
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

function buildDeflector(d1x: number, d1z: number, d2x: number, d2z: number): THREE.Group {
  const gp = new THREE.Group();
  // A genuinely CURVED banked rail (Wave D: "curved walls like a pinball
  // machine") — a quarter-torus sweeping from one open leg to the other,
  // backed by a quarter-cylinder wall wedge in the closed corner. The sweep
  // starts on the +x axis; yaw the group so its ends line up with the legs.
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 14, Math.PI / 2), std(C_STEEL_DK));
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = 0.3;
  const edge = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 14, Math.PI / 2), std(C_GOLD, C_GOLD, 0.6));
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.44;
  const wedge = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.4, 10, 1, false, 0, Math.PI / 2), std(C_STEEL_DK));
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
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.5), std(C_STEEL_DK));
  plate.position.set(-0.42, 0.35, 0);
  // Piston arm + the red glove, extended along +x by the punch anim.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), std(C_STEEL));
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.2, 0.35, 0);
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), std(0xa83244, 0xa83244, 0.35));
  fist.scale.set(1.15, 0.95, 0.95);
  fist.position.set(0.02, 0.35, 0);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 8), std(C_GOLD, C_GOLD, 0.4));
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
    const blob = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 12), mat);
    blob.position.set(ox, 0.012, oz);
    gp.add(blob);
  }
  gp.userData.sheen = mat;
  return gp;
}

function buildSpinPad(): THREE.Group {
  const gp = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 14), std(C_STEEL_DK));
  pad.position.y = 0.04;
  gp.add(pad);
  // A raised turbine rotor — three angled blades around a glowing gold hub cone,
  // so the whirl reads with real height (was low flat chevrons on the floor).
  const rotor = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.13), std(C_ARCANE, C_ARCANE, 0.7));
    const a = (k / 3) * Math.PI * 2;
    blade.position.set(Math.cos(a) * 0.19, 0.17, Math.sin(a) * 0.19);
    blade.rotation.y = -a;
    rotor.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 8), std(C_GOLD, C_GOLD, 0.7));
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
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8), std(C_GOLD, C_GOLD, 0.4));
    post.position.set(0, 0.25, side * 0.4);
    gp.add(post);
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.8), std(C_ARCANE, C_ARCANE, 0.55));
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
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 8), std(C_STEEL_DK));
  pole.position.set(0.3, 0.28, 0);
  const rings = new THREE.Group();
  const ringSpecs: Array<[number, number, number]> = [
    [0.26, 0xd95763, 0.5], // outer red
    [0.17, 0xeef1f5, 0.25], // white
    [0.09, 0xd95763, 0.9], // the eye — hot, blooms
  ];
  const ringMats: THREE.MeshStandardMaterial[] = [];
  ringSpecs.forEach(([r, colr, glow], k) => {
    const m = std(colr, colr, glow);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04 + k * 0.012, 14), m);
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
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.14, 10), std(C_STEEL_DK));
  base.position.y = 0.07;
  const bowlMat = std(C_STEEL_DK, C_ARCANE, 0.3);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.16, 12), bowlMat);
  bowl.position.y = 0.22;
  const flameMat = std(C_ARCANE, C_ARCANE, 0.9);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), flameMat);
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
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 6), railMat);
    post.position.set(0, 0.15, zside * 0.22);
    gp.add(post);
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 6, 12, Math.PI), railMat);
  arch.rotation.y = Math.PI / 2;
  arch.position.y = 0.3;
  gp.add(arch);
  // The lamp bead — unlit arcane, lit gold (set each frame from state.laneLit).
  const lampMat = std(C_STEEL_DK, C_ARCANE, 0.5);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), lampMat);
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
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.74, 1.6, 0.74), std(PALETTE_HEX[0], 0x000000, 0));
  shaft.position.y = -0.81;
  gp.add(shaft);
  const door = new THREE.Group();
  for (const side of [-1, 1]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.34), std(0x6b4a2e));
    plank.position.set(0, 0.025, side * 0.18);
    door.add(plank);
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.06, 0.08), std(C_STEEL_DK));
  band.position.y = 0.03;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 10), std(C_STEEL, C_ARCANE, 0.25));
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

function buildFlipper(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // A pivoting paddle: a wide steel bat with a gold striking edge + a hub.
  const paddle = new THREE.Group();
  const bat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.24), std(C_STEEL, C_ARCANE, 0.2));
  bat.position.x = 0.35;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.26), std(C_GOLD, C_GOLD, 0.7));
  edge.position.x = 0.78;
  paddle.add(bat, edge);
  paddle.position.y = 0.12;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.14, 12), std(C_STEEL_DK));
  hub.position.y = 0.07;
  gp.add(hub, paddle);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.paddle = paddle;
  gp.userData.edgeMat = edge.material as THREE.MeshStandardMaterial;
  return gp;
}

function buildMirror(mx: number, mz: number): THREE.Group {
  const gp = new THREE.Group();
  // A slim reflective slab standing along its surface line, glinting edge.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.08), std(C_STEEL, C_ARCANE, 0.35));
  slab.position.y = 0.28;
  const glint = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.02), std(0xeef1f5, 0xeef1f5, 0.5));
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
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.5, 16), std(PALETTE_HEX[0], 0x000000, 0));
  hole.position.y = -0.24; // sunk below the floor
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 8, 18), std(C_STEEL_DK));
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
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.34, 0.9, 20), std(PALETTE_HEX[0], 0x000000, 0));
  hole.position.y = -0.42;
  // A torn, blood-lit rim: two rings at different radii so the edge reads as
  // ragged masonry rather than a machined lip.
  const rimMat = std(PALETTE_HEX[11], PALETTE_HEX[12], 0.35);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.075, 8, 22), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.015;
  gp.userData.rimMat = rimMat; // the animator pulses this — see PART_ANIMATORS
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.035, 6, 20), std(PALETTE_HEX[10], PALETTE_HEX[11], 0.2));
  rim2.rotation.x = Math.PI / 2;
  rim2.position.y = -0.02;
  gp.add(hole, rim, rim2);
  // Blown-out debris: shards flung clear of the rim, irregular by construction
  // (a deterministic ring would read as decoration, not damage).
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + (k % 3) * 0.21;
    const rr = 0.78 + (k % 4) * 0.075;
    const shard = new THREE.Mesh(new THREE.BoxGeometry(0.13 + (k % 3) * 0.04, 0.07, 0.1), std(PALETTE_HEX[2], PALETTE_HEX[10], 0.08));
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
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.8), std(C_STEEL_DK, C_ARCANE, 0));
  plate.position.y = 0.02;
  gp.add(plate);
  const nodeMat = std(C_ARCANE, 0x9fe8ff, 0.2);
  for (const [nx, nz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]] as const) {
    const node = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8), nodeMat);
    node.position.set(nx, 0.17, nz);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), nodeMat);
    tip.position.set(nx, 0.32, nz);
    gp.add(node, tip);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), nodeMat);
  core.position.set(0, 0.23, 0);
  gp.add(core);
  gp.userData.plateMat = plate.material;
  gp.userData.nodeMat = nodeMat;
  return gp;
}

function buildFireVent(dirX: number, dirZ: number): THREE.Group {
  const gp = new THREE.Group();
  // A wall nozzle (mount side is -dir) with a stubby barrel aimed down the lane.
  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.4), std(C_STEEL_DK));
  mount.position.set(-0.3, 0.28, 0);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 10), std(C_STEEL));
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(-0.1, 0.28, 0);
  // the flame plume, scaled by the anim when it roars
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.0, 10), std(0xf0a63c, 0xf0a63c, 0.9));
  plume.rotation.z = -Math.PI / 2;
  plume.position.set(0.6, 0.28, 0);
  plume.scale.setScalar(0.001);
  gp.add(mount, barrel, plume);
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.plume = plume;
  gp.userData.plumeMat = plume.material;
  return gp;
}

function buildMagStrip(): THREE.Group {
  const gp = new THREE.Group();
  // A charged SLOW-field: a dark band with two tall humming coil pylons at the
  // ends and inward braking chevrons, so it reads "cross here and you get
  // dragged to a crawl" at a glance (was a near-flat floor stripe).
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.6), std(0x241d2e));
  band.position.y = 0.02;
  gp.add(band);
  const fieldMat = std(0x2e6d8f, 0x39b0d8, 0.5);
  for (const cx of [-0.4, 0.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.44, 8), std(C_STEEL_DK));
    post.position.set(cx, 0.22, 0);
    gp.add(post);
    for (let k = 0; k < 3; k++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 12), fieldMat);
      coil.rotation.x = Math.PI / 2;
      coil.position.set(cx, 0.12 + k * 0.12, 0);
      gp.add(coil);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), fieldMat);
    cap.position.set(cx, 0.46, 0);
    gp.add(cap);
  }
  // braking chevrons on the band, pointing INWARD (the "you'll be slowed" read)
  for (const [cx, sgn] of [[-0.2, 1], [0.2, -1]] as const) {
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 3), fieldMat);
    chev.rotation.z = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
    chev.position.set(cx, 0.06, 0);
    gp.add(chev);
  }
  gp.userData.fieldMat = fieldMat;
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
  deflector: ({ dirX, dirZ, dir2X, dir2Z }) => buildDeflector(dirX, dirZ, dir2X, dir2Z),
  glove: ({ dirX, dirZ }) => buildGlove(dirX, dirZ),
  oil: () => buildOil(),
  spinpad: () => buildSpinPad(),
  slingshot: ({ dirX, dirZ }) => buildSlingshot(dirX, dirZ),
  target: ({ dirX, dirZ }) => buildTarget(dirX, dirZ),
  trapdoor: () => buildTrapdoor(),
  flipper: ({ dirX, dirZ }) => buildFlipper(dirX, dirZ),
  mirror: ({ dirX, dirZ }) => buildMirror(dirX, dirZ),
  pit: () => buildPit(),
  gravepit: () => buildGravePit(),
  electric: () => buildElectric(),
  firevent: ({ dirX, dirZ }) => buildFireVent(dirX, dirZ),
  magstrip: () => buildMagStrip(),
  rollover: ({ dirX, dirZ }) => buildRollover(dirX, dirZ),
  lamp: () => buildLamp(),
};

/** Build every part mesh for a level plan and register them on state. */
export function createPinballParts(spots: PinballPartSpot[], g: Grid, scene: THREE.Scene): void {
  for (const s of spots) {
    const { x, z } = tileCenter(g, s.i, s.j);
    const dirX = s.dirI;
    const dirZ = s.dirJ;
    const dir2X = s.dir2I;
    const dir2Z = s.dir2J;
    const mesh = PART_BUILDERS[s.kind]({ dirX, dirZ, dir2X, dir2Z });
    mesh.position.set(x, 0, z);
    scene.add(mesh);
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
      // Gloves + fire vents fire on their own clock — desynced per part so a
      // gauntlet corridor punches in a wave, not a single broadside.
      fireT: s.kind === "glove" ? 0.6 + Math.random() * 2.2 : s.kind === "firevent" ? 0.6 + Math.random() * 2.4 : undefined,
      punchSpent: s.kind === "glove" || s.kind === "firevent" ? true : undefined,
      done: s.kind === "target" ? false : undefined,
      hits: s.kind === "bumper" ? 0 : undefined,
      bank: s.bank,
      seq: s.seq,
      lit: s.bank !== undefined ? false : undefined,
      // Electric plates share a clock but stagger phase so a room pulses as a wave.
      phase: s.kind === "electric" ? Math.random() * (ELEC_ON + ELEC_OFF) : undefined,
      orbit: s.orbit,
      orbitSeq: s.orbitSeq,
      lane: s.lane,
      laneSeq: s.laneSeq,
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
  deflector: 0.6,
  glove: 0.6,
  oil: 0.6,
  spinpad: 0.6,
  slingshot: 0.6,
  target: 0.6,
  trapdoor: TRAPDOOR_DROP + 1.6,
  flipper: 0.6,
  mirror: 0.6,
  pit: 0.6,
  gravepit: 0.6,
  electric: 0.6,
  firevent: VENT_WARN + VENT_ACTIVE + 0.1,
  magstrip: 0.6,
  rollover: 0.6,
  lamp: 0.6,
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
    const mats = part.mesh.userData.chevMats as THREE.MeshStandardMaterial[] | undefined;
    const lipMat = part.mesh.userData.lipMat as THREE.MeshStandardMaterial | undefined;
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
    const chevs = part.mesh.userData.chevMats as THREE.MeshStandardMaterial[] | undefined;
    const strips = part.mesh.userData.stripMats as THREE.MeshStandardMaterial[] | undefined;
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

  spinpad: (part, { frozen }) => {
    const rotor = part.mesh.userData.rotor as THREE.Group | undefined;
    if (rotor) rotor.rotation.y = frozen ? rotor.rotation.y : animT * 3.4 + part.i;
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
    // the paddle SNAPS up on a hit, then eases back down
    const paddle = part.mesh.userData.paddle as THREE.Group | undefined;
    let up = 0;
    if (paddle) {
      if (part.hitT >= 0) {
        const t = part.hitT;
        up = t < FLIPPER_SWING ? Math.min(1, t / 0.06) : Math.max(0, 1 - (t - FLIPPER_SWING) / 0.3);
      }
      paddle.rotation.z = up * 0.9;
    }
    // Slice 7 telegraph: the gold striking edge breathes so the flipper reads
    // "live/ready", and flares bright the instant it swings.
    const edge = part.mesh.userData.edgeMat as THREE.MeshStandardMaterial | undefined;
    if (edge) edge.emissiveIntensity = 0.55 + 0.35 * Math.sin(animT * 4 + part.i) + up * 1.8;
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
    const mat = part.mesh.userData.plumeMat as THREE.MeshStandardMaterial | undefined;
    let scale = 0.001;
    if (part.hitT >= 0) {
      const t = part.hitT;
      if (t < VENT_WARN) scale = 0.15 + 0.1 * Math.sin(t * 40); // sputter tell
      else if (t < VENT_WARN + VENT_ACTIVE) scale = 1 + 0.15 * Math.sin(t * 25); // roar
    }
    if (plume) plume.scale.setScalar(scale);
    if (mat) mat.emissiveIntensity = scale > 0.5 ? 1 : 0.3;
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
};

/**
 * Tick cooldowns + drive idle/hit animations. The ONE place part timers mutate
 * per frame; player.ts only consumes ready parts and stamps cooldownT/hitT=0.
 */
export function updatePinballParts(dt: number): void {
  animT += dt;
  if (state.jackpotT > 0) state.jackpotT = Math.max(0, state.jackpotT - dt); // Slice 5 flash window
  const frozen = state.freezeT > 0;
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
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.42, 12), plungerMat(0x3a2c0a, C_GOLD, 0.9));
  head.rotation.z = Math.PI / 2; // lay the disc along the launch axis
  head.position.set(0.1, 0.4, 0);
  // A stubby spring coil (stacked rings) behind the head.
  for (let k = 0; k < 3; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), plungerMat(0x2a2214, C_GOLD, 0.5));
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

function disposePlungerRig(scene: THREE.Scene | null): void {
  if (!plungerRig) return;
  scene?.remove(plungerRig);
  plungerRig.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    (m.material as THREE.Material | undefined)?.dispose?.();
  });
  plungerRig = null;
}

export function disposePinballParts(scene: THREE.Scene | null): void {
  disposePlungerRig(scene); // rebuilt with the current scene on the next armed floor
  for (const part of state.pinballParts) {
    scene?.remove(part.mesh);
    part.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat?.dispose();
    });
  }
  state.pinballParts = [];
}
