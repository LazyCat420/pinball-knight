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
  // The rail bar runs along (d1 - d2) and sits nudged INTO the closed corner
  // (opposite the two open legs), like the banked wall of a pinball lane.
  const ax = d1x - d2x;
  const az = d1z - d2z;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 0.12), std(C_STEEL_DK));
  bar.position.y = 0.21;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 0.13), std(C_GOLD, C_GOLD, 0.6));
  edge.position.y = 0.44;
  const rail = new THREE.Group();
  rail.add(bar, edge);
  rail.rotation.y = yawFor(ax, az);
  const off = 0.24;
  rail.position.set(-(d1x + d2x) * off, 0, -(d1z + d2z) * off);
  gp.add(rail);
  gp.userData.edge = edge.material;
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
  for (const part of state.pinballParts) {
    part.cooldownT = Math.max(0, part.cooldownT - dt);
    if (part.hitT >= 0) part.hitT += dt;

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
    } else {
      // deflector: gold edge flashes on a hit
      const edge = part.mesh.userData.edge as THREE.MeshStandardMaterial | undefined;
      if (edge) edge.emissiveIntensity = 0.5 + (part.hitT >= 0 && part.hitT < 0.25 ? 1.4 * (1 - part.hitT / 0.25) : 0);
    }

    if (part.hitT > 0.6) part.hitT = -1; // animation done
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
