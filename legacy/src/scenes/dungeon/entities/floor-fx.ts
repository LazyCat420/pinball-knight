/**
 * Floor FX — persistent scars a marble material leaves on the ground.
 *
 * The one net-new subsystem for the material set: a list of ground discs that
 * outlive the bounce/slam that spawned them and tick status/damage to any enemy
 * standing on them (and, under the self-harm toggle, the player). Modeled on the
 * hazards.ts overlap loop + the projectiles.ts spawn/update/despawn lifecycle,
 * rendered as flat translucent circles so they read through the pixel/bloom pass.
 *
 *   • slick (Water) — enemies lose their footing and skid (see zombie slipT);
 *     no damage. The floor becomes a slapstick trap.
 *   • fire  (Lava, deferred) — a burning puddle that ticks BURN DoT; wired now
 *     so the R&D toggles have something to exercise.
 *   • shard-field — reserved (Diamond ground glitter); currently visual-only.
 */
import * as THREE from "three";
import { state, type FloorFx, type FloorFxKind } from "../state";
import {
  FLOORFX_TICK,
  WATER_SLIP_TIME,
  WATER_SLIP_SPEED,
  FIRE_PUDDLE_DMG,
  CARD_BURN_TICK,
  ZOMBIE_R,
  PLAYER_R,
  MATERIAL_SELF_HARM_DMG,
} from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { damageZombie, hitPlayerRanged } from "./combat";

const FLOOR_Y = 0.03; // just above the floor plane

// Shared GPU assets per kind (a unit disc scaled per-instance), torn down on teardown.
let _discGeo: THREE.CircleGeometry | null = null;
const _mats: Partial<Record<FloorFxKind, THREE.MeshBasicMaterial>> = {};

const KIND_COLOR: Record<FloorFxKind, number> = {
  slick: PALETTE_HEX[30], // arcane mid (wet blue)
  fire: PALETTE_HEX[16], // flame
  "shard-field": PALETTE_HEX[31], // prismatic cool
};

function discGeo(): THREE.CircleGeometry {
  _discGeo ??= new THREE.CircleGeometry(1, 20); // unit radius, scaled per fx
  return _discGeo;
}
function matFor(kind: FloorFxKind): THREE.MeshBasicMaterial {
  _mats[kind] ??= new THREE.MeshBasicMaterial({
    color: KIND_COLOR[kind],
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  return _mats[kind]!;
}

export function disposeFloorFxAssets(): void {
  _discGeo?.dispose();
  _discGeo = null;
  for (const k of Object.keys(_mats) as FloorFxKind[]) {
    _mats[k]?.dispose();
    delete _mats[k];
  }
}

/** Drop a floor scar of `kind` at (x,z). No-op if floor-fx are toggled off. */
export function spawnFloorFx(kind: FloorFxKind, x: number, z: number, radius: number, life: number): void {
  if (!state.scene || !state.dbgMaterialFloorFx) return;
  // Its own material instance so opacity can fade independently of siblings.
  const mesh = new THREE.Mesh(discGeo(), matFor(kind).clone());
  mesh.rotation.x = -Math.PI / 2; // lay flat on the floor
  mesh.position.set(x, FLOOR_Y, z);
  mesh.scale.setScalar(radius);
  state.scene.add(mesh);
  state.floorFx.push({
    kind,
    x,
    z,
    radius,
    life,
    maxLife: life,
    tick: 0,
    mesh,
    dispose: () => (mesh.material as THREE.Material).dispose(),
  });
}

function despawn(index: number): void {
  const fx = state.floorFx[index];
  state.scene?.remove(fx.mesh);
  fx.dispose();
  state.floorFx.splice(index, 1);
}

export function clearFloorFx(): void {
  for (let i = state.floorFx.length - 1; i >= 0; i--) despawn(i);
}

export function updateFloorFx(dt: number): void {
  const p = state.player;
  for (let i = state.floorFx.length - 1; i >= 0; i--) {
    const fx = state.floorFx[i];
    fx.life -= dt;
    if (fx.life <= 0) {
      despawn(i);
      continue;
    }
    fx.tick = Math.max(0, fx.tick - dt);
    const ticked = fx.tick <= 0;
    if (ticked) fx.tick = fx.kind === "fire" ? CARD_BURN_TICK : FLOORFX_TICK;

    // Fade out over the back third of its life.
    const frac = fx.life / fx.maxLife;
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * Math.min(1, frac * 3);

    // ── Enemy overlap ──
    for (const zmb of state.zombies) {
      if (zmb.mode === "dead") continue;
      const dx = zmb.x - fx.x;
      const dz = zmb.z - fx.z;
      const rr = fx.radius + ZOMBIE_R;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (fx.kind === "slick") {
        // Skid outward from the puddle centre (fresh drift each time it settles).
        if (!zmb.slipT || zmb.slipT <= 0) {
          const d = Math.hypot(dx, dz) || 1;
          zmb.slipT = WATER_SLIP_TIME;
          zmb.slipVX = (dx / d) * WATER_SLIP_SPEED;
          zmb.slipVZ = (dz / d) * WATER_SLIP_SPEED;
        }
      } else if (fx.kind === "fire" && ticked && zmb.burnT <= 0) {
        zmb.burnT = CARD_BURN_TICK;
        damageZombie(zmb, FIRE_PUDDLE_DMG, 0, 0, 0);
        state.vfx?.sparks(zmb.x, 0.4, zmb.z, 0, 1, 3);
      }
    }

    // ── Self-harm (toggle): the player burns on their own fire, too ──
    if (fx.kind === "fire" && ticked && state.dbgMaterialSelfHarm && p && p.hp > 0 && p.iframes <= 0) {
      const dx = p.x - fx.x;
      const dz = p.z - fx.z;
      const rr = fx.radius + PLAYER_R;
      if (dx * dx + dz * dz <= rr * rr) hitPlayerRanged(MATERIAL_SELF_HARM_DMG, fx.x, fx.z);
    }
  }
}
