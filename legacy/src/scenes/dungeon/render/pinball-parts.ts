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
import { GLOVE_PERIOD, GLOVE_ACTIVE, GLOVE_LANE_LEN } from "../constants";

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
  const gp = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.52), std(C_STEEL_DK, 0x000000, 0));
  pad.position.y = 0.025;
  gp.add(pad);
  const chevMats: THREE.MeshStandardMaterial[] = [];
  for (let k = 0; k < 2; k++) {
    const m = std(C_ARCANE, C_ARCANE, 0.6);
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.24, 3), m);
    chev.rotation.z = -Math.PI / 2; // point +x (rotated to dir by the group)
    chev.position.set(-0.15 + k * 0.3, 0.06, 0);
    chevMats.push(m);
    gp.add(chev);
  }
  gp.rotation.y = yawFor(dirX, dirZ);
  gp.userData.chevMats = chevMats;
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
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.05, 14), std(C_STEEL_DK));
  pad.position.y = 0.025;
  gp.add(pad);
  // Three chevrons on a rotor — the renderer spins it so the pad visibly whirls.
  const rotor = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 3), std(C_ARCANE, C_ARCANE, 0.7));
    chev.rotation.z = -Math.PI / 2;
    const a = (k / 3) * Math.PI * 2;
    chev.position.set(Math.cos(a) * 0.24, 0.06, Math.sin(a) * 0.24);
    chev.rotation.y = -a + Math.PI / 2;
    rotor.add(chev);
  }
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
      // Gloves fire on their own clock — desynced per part so a gauntlet
      // corridor punches in a wave, not a single broadside.
      fireT: s.kind === "glove" ? 0.6 + Math.random() * 2.2 : undefined,
      punchSpent: s.kind === "glove" ? true : undefined,
      done: s.kind === "target" ? false : undefined,
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
      // chevrons pulse in sequence — the "go this way" crawl
      const mats = part.mesh.userData.chevMats as THREE.MeshStandardMaterial[] | undefined;
      const phase = (part.mesh.userData.phase as number) ?? 0;
      if (mats) {
        mats.forEach((m, k) => {
          m.emissiveIntensity = 0.45 + 0.55 * Math.max(0, Math.sin(animT * 4 + phase - k * 0.9));
        });
      }
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
    } else {
      // deflector: gold edge flashes on a hit
      const edge = part.mesh.userData.edge as THREE.MeshStandardMaterial | undefined;
      if (edge) edge.emissiveIntensity = 0.5 + (part.hitT >= 0 && part.hitT < 0.25 ? 1.4 * (1 - part.hitT / 0.25) : 0);
    }

    if (part.hitT > (part.kind === "trapdoor" ? 2 : 0.6)) part.hitT = -1; // animation done
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
