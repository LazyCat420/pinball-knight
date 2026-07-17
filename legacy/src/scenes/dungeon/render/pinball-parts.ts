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
import { tileCenter, type Grid } from "../maze/generator";
import { PALETTE_HEX } from "./palette";
import { GLOVE_PERIOD, GLOVE_ACTIVE, GLOVE_LANE_LEN, FLIPPER_SWING, ELEC_ON, ELEC_OFF, VENT_PERIOD, VENT_WARN, VENT_ACTIVE } from "../constants";

const C_STEEL_DK = PALETTE_HEX[19];
const C_STEEL = PALETTE_HEX[20];
const C_ARCANE = PALETTE_HEX[31]; // 0x6fd0e8 — the machine's glow colour
const C_GOLD = PALETTE_HEX[16]; // flame/gold accents

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

function buildTrapdoor(): THREE.Group {
  const gp = new THREE.Group();
  // A wooden hatch flush with the floor: two planks, iron banding, a pull
  // ring. The punch anim flips it open on a hinge.
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

/** Build every part mesh for a level plan and register them on state. */
export function createPinballParts(spots: PinballPartSpot[], g: Grid, scene: THREE.Scene): void {
  for (const s of spots) {
    const { x, z } = tileCenter(g, s.i, s.j);
    const dirX = s.dirI;
    const dirZ = s.dirJ;
    const dir2X = s.dir2I;
    const dir2Z = s.dir2J;
    let mesh: THREE.Group;
    if (s.kind === "bumper") mesh = buildBumper();
    else if (s.kind === "spring") mesh = buildSpring(dirX, dirZ);
    else if (s.kind === "ramp") mesh = buildRamp(dirX, dirZ);
    else if (s.kind === "glove") mesh = buildGlove(dirX, dirZ);
    else if (s.kind === "oil") mesh = buildOil();
    else if (s.kind === "spinpad") mesh = buildSpinPad();
    else if (s.kind === "slingshot") mesh = buildSlingshot(dirX, dirZ);
    else if (s.kind === "target") mesh = buildTarget(dirX, dirZ);
    else if (s.kind === "trapdoor") mesh = buildTrapdoor();
    else if (s.kind === "flipper") mesh = buildFlipper(dirX, dirZ);
    else if (s.kind === "mirror") mesh = buildMirror(dirX, dirZ);
    else if (s.kind === "pit") mesh = buildPit();
    else if (s.kind === "electric") mesh = buildElectric();
    else if (s.kind === "firevent") mesh = buildFireVent(dirX, dirZ);
    else if (s.kind === "magstrip") mesh = buildMagStrip();
    else mesh = buildDeflector(dirX, dirZ, dir2X, dir2Z);
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
      // Electric plates share a clock but stagger phase so a room pulses as a wave.
      phase: s.kind === "electric" ? Math.random() * (ELEC_ON + ELEC_OFF) : undefined,
      mesh,
    };
    state.pinballParts.push(part);
  }
}

/** Global idle-animation clock (safe to reset per level). */
let animT = 0;

/**
 * Tick cooldowns + drive idle/hit animations. The ONE place part timers mutate
 * per frame; player.ts only consumes ready parts and stamps cooldownT/hitT=0.
 */
export function updatePinballParts(dt: number): void {
  animT += dt;
  const frozen = state.freezeT > 0;
  for (const part of state.pinballParts) {
    part.cooldownT = Math.max(0, part.cooldownT - dt);
    if (part.hitT >= 0) part.hitT += dt;

    // GLOVE clock: count down to the punch, throw it (hitT drives both the
    // piston anim and the live damage window read by entities/hazards.ts),
    // rewind with jitter. The freeze-ray stops the clock mid-swing.
    if (part.kind === "glove" && !frozen) {
      part.fireT = (part.fireT ?? GLOVE_PERIOD) - dt;
      if (part.fireT <= 0) {
        part.fireT = GLOVE_PERIOD * (0.8 + Math.random() * 0.5);
        part.hitT = 0;
        part.punchSpent = false;
      }
    }
    // FIRE VENT clock: same cadence, its own period; hitT drives the plume +
    // the burn window read by hazards.ts. Frozen = no jet.
    if (part.kind === "firevent" && !frozen) {
      part.fireT = (part.fireT ?? VENT_PERIOD) - dt;
      if (part.fireT <= 0) {
        part.fireT = VENT_PERIOD * (0.8 + Math.random() * 0.5);
        part.hitT = 0;
        part.punchSpent = false;
      }
    }

    if (part.kind === "bumper") {
      // hit: a fast radial pop (out 60ms, settle 140ms); idle: dome breathes
      let s = 1;
      if (part.hitT >= 0 && part.hitT < 0.2) {
        const t = part.hitT / 0.2;
        s = 1 + 0.35 * Math.sin(Math.min(1, t * 1.6) * Math.PI);
      }
      part.mesh.scale.set(s, 1, s);
      const dome = part.mesh.userData.dome as THREE.MeshStandardMaterial | undefined;
      if (dome) dome.emissiveIntensity = 0.7 + 0.3 * Math.sin(animT * 3 + part.i) + (part.hitT >= 0 && part.hitT < 0.2 ? 1.2 : 0);
    } else if (part.kind === "spring") {
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
    } else if (part.kind === "ramp") {
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
    } else if (part.kind === "glove") {
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
    } else if (part.kind === "spinpad") {
      const rotor = part.mesh.userData.rotor as THREE.Group | undefined;
      if (rotor) rotor.rotation.y = frozen ? rotor.rotation.y : animT * 3.4 + part.i;
    } else if (part.kind === "slingshot") {
      // the band twangs on a hit
      const band = part.mesh.userData.band as THREE.Mesh | undefined;
      if (band) {
        const k = part.hitT >= 0 && part.hitT < 0.3 ? Math.sin((part.hitT / 0.3) * Math.PI * 3) * 0.25 : 0;
        band.position.x = k;
      }
    } else if (part.kind === "target") {
      const mats = part.mesh.userData.ringMats as THREE.MeshStandardMaterial[] | undefined;
      const rings = part.mesh.userData.rings as THREE.Group | undefined;
      if (part.done) {
        // broken: rings tip over, glow dies
        if (rings) rings.rotation.z = Math.min(Math.PI / 2.2, rings.rotation.z + dt * 6);
        if (mats) mats.forEach((m) => (m.emissiveIntensity = 0.02));
      } else if (mats) {
        mats[2].emissiveIntensity = 0.7 + 0.5 * Math.sin(animT * 4 + part.j); // the eye winks
      }
    } else if (part.kind === "trapdoor") {
      // hit: the hatch flips open on its hinge, then creaks shut
      const door = part.mesh.userData.door as THREE.Group | undefined;
      if (door) {
        let open = 0;
        if (part.hitT >= 0) {
          const t = part.hitT;
          open = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 1.2) / 0.6);
        }
        door.rotation.z = Math.min(1, Math.max(0, open)) * 1.4;
      }
    } else if (part.kind === "oil") {
      const sheen = part.mesh.userData.sheen as THREE.MeshStandardMaterial | undefined;
      if (sheen) sheen.emissiveIntensity = 0.16 + 0.1 * Math.sin(animT * 1.7 + part.i * 2);
    } else if (part.kind === "flipper") {
      // the paddle SNAPS up on a hit, then eases back down
      const paddle = part.mesh.userData.paddle as THREE.Group | undefined;
      if (paddle) {
        let up = 0;
        if (part.hitT >= 0) {
          const t = part.hitT;
          up = t < FLIPPER_SWING ? Math.min(1, t / 0.06) : Math.max(0, 1 - (t - FLIPPER_SWING) / 0.3);
        }
        paddle.rotation.z = up * 0.9;
      }
    } else if (part.kind === "mirror") {
      const glint = part.mesh.userData.glint as THREE.MeshStandardMaterial | undefined;
      if (glint) glint.emissiveIntensity = 0.4 + 0.25 * Math.sin(animT * 2 + part.i) + (part.hitT >= 0 && part.hitT < 0.2 ? 1.2 : 0);
    } else if (part.kind === "electric") {
      // pulse: dark for ELEC_OFF, glow for ELEC_ON — per-plate phase offset
      const live = ((animT + (part.phase ?? 0)) % (ELEC_ON + ELEC_OFF)) < ELEC_ON;
      const warn = !live && ((animT + (part.phase ?? 0)) % (ELEC_ON + ELEC_OFF)) > ELEC_OFF - 0.3; // about to fire
      const plate = part.mesh.userData.plateMat as THREE.MeshStandardMaterial | undefined;
      const node = part.mesh.userData.nodeMat as THREE.MeshStandardMaterial | undefined;
      const glow = frozen ? 0 : live ? 1.6 + 0.4 * Math.sin(animT * 30) : warn ? 0.5 : 0.05;
      if (plate) plate.emissiveIntensity = glow;
      if (node) node.emissiveIntensity = glow + 0.2;
    } else if (part.kind === "firevent") {
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
    } else if (part.kind === "magstrip") {
      const field = part.mesh.userData.fieldMat as THREE.MeshStandardMaterial | undefined;
      if (field) field.emissiveIntensity = frozen ? 0.1 : 0.45 + 0.4 * Math.sin(animT * 8 + part.i);
    } else if (part.kind !== "pit") {
      // deflector: gold edge flashes on a hit
      const edge = part.mesh.userData.edge as THREE.MeshStandardMaterial | undefined;
      if (edge) edge.emissiveIntensity = 0.5 + (part.hitT >= 0 && part.hitT < 0.25 ? 1.4 * (1 - part.hitT / 0.25) : 0);
    }

    if (part.hitT > (part.kind === "trapdoor" ? 2 : part.kind === "firevent" ? VENT_WARN + VENT_ACTIVE + 0.1 : 0.6)) part.hitT = -1;
  }
}

/** Remove + dispose every part mesh (per-level teardown). */
export function disposePinballParts(scene: THREE.Scene | null): void {
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
