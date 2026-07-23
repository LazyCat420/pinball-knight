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
 *   • oil   (Slick Field ability) — a spilled pool: foes on it lose steering
 *     (zombie oiledT), the rolling ball picks up p.oilT glide, and any FIRE
 *     floorFx that overlaps it IGNITES the whole pool into a long burn.
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
  OIL_ZOMBIE_T,
  OIL_MARBLE_T,
  OIL_IGNITE_LIFE,
} from "../constants";
import { PALETTE_HEX } from "../render/palette";
import { damageZombie, hitPlayerRanged } from "./combat";

const FLOOR_Y = 0.03; // just above the floor plane

// Shared GPU assets per kind (a unit disc scaled per-instance), torn down on teardown.
let _discGeo: THREE.CircleGeometry | null = null;
const _mats: Partial<Record<FloorFxKind, THREE.MeshBasicMaterial>> = {};
const _texs: Partial<Record<FloorFxKind, THREE.CanvasTexture>> = {};

const KIND_COLOR: Record<FloorFxKind, number> = {
  slick: PALETTE_HEX[30], // arcane mid (wet blue)
  fire: PALETTE_HEX[16], // flame
  "shard-field": PALETTE_HEX[31], // prismatic cool
  oil: PALETTE_HEX[29], // arcane dark — a deep blue-black sheen
};

function discGeo(): THREE.CircleGeometry {
  _discGeo ??= new THREE.CircleGeometry(1, 20); // unit radius, scaled per fx
  return _discGeo;
}

/**
 * Painted looks for the two kinds that must READ from across the room. A flat
 * tinted disc worked for water but made fire look like an orange coaster and
 * oil vanish into dark stone — these canvases give each a real identity:
 *   fire — white-hot core → orange → deep-red ragged edge (additive, blooms)
 *   oil  — near-black pool with a bright iridescent RIM + thin sheen arcs
 */
function paintKindTexture(kind: "fire" | "oil"): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null; // headless tests — flat tint
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const cx = s / 2;
  if (kind === "fire") {
    // Ragged blob edge: overlapping mid-orange circles around the rim…
    ctx.fillStyle = "#d97b29";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = s * (0.3 + Math.random() * 0.08);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r * 0.55, cx + Math.sin(a) * r * 0.55, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    // …then the hot radial core stacked on top.
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.5);
    g.addColorStop(0, "#fff3c8");
    g.addColorStop(0.25, "#ffd98a");
    g.addColorStop(0.55, "#f0a63c");
    g.addColorStop(0.85, "rgba(122,59,18,0.6)");
    g.addColorStop(1, "rgba(122,59,18,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  } else {
    // Oil: a dark pool whose RIM catches the light, plus thin sheen arcs.
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.5);
    g.addColorStop(0, "rgba(6,8,16,0.95)");
    g.addColorStop(0.72, "rgba(15,20,40,0.95)");
    g.addColorStop(0.9, "#2e6d8f");
    g.addColorStop(0.97, "#6fd0e8");
    g.addColorStop(1, "rgba(111,208,232,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cx, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      // Iridescent swirls — alternating petrol blue/purple partial arcs.
      ctx.strokeStyle = i % 2 ? "rgba(111,208,232,0.5)" : "rgba(138,95,208,0.5)";
      const r = s * (0.12 + i * 0.07);
      const a0 = Math.random() * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cx, r, a0, a0 + Math.PI * (0.6 + Math.random() * 0.8));
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function matFor(kind: FloorFxKind): THREE.MeshBasicMaterial {
  if (!_mats[kind]) {
    const tex = kind === "fire" || kind === "oil" ? (_texs[kind] ??= paintKindTexture(kind) ?? undefined) : undefined;
    _mats[kind] = tex
      ? new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          // Fire ADDS light (bloom feeds on the white core); oil sits on the scene.
          blending: kind === "fire" ? THREE.AdditiveBlending : THREE.NormalBlending,
        })
      : new THREE.MeshBasicMaterial({
          color: KIND_COLOR[kind],
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        });
  }
  return _mats[kind]!;
}

export function disposeFloorFxAssets(): void {
  _discGeo?.dispose();
  _discGeo = null;
  for (const k of Object.keys(_mats) as FloorFxKind[]) {
    _mats[k]?.dispose();
    delete _mats[k];
  }
  for (const k of Object.keys(_texs) as FloorFxKind[]) {
    _texs[k]?.dispose();
    delete _texs[k];
  }
}

/** Drop a floor scar of `kind` at (x,z). No-op if floor-fx are toggled off.
 *  `hostile` marks an ENEMY hazard — it burns the player, not the horde. */
export function spawnFloorFx(kind: FloorFxKind, x: number, z: number, radius: number, life: number, hostile = false): void {
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
    hostile,
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

    // ── Life animation ── a snappy grow-in pop (slight overshoot), a gentle
    // breathing pulse while live, and a shrink+fade over the back third. The
    // slick slowly spins so the puddle reads liquid instead of stamped.
    const age = fx.maxLife - fx.life;
    const frac = fx.life / fx.maxLife;
    const grow = age < 0.18 ? 0.35 + (age / 0.18) * 0.75 : 1.1 - Math.min(0.1, (age - 0.18) * 0.5);
    // Fire FLICKERS (fast, deep pulse); liquids breathe slowly.
    const pulse = fx.kind === "fire"
      ? 1 + Math.sin(age * 13 + fx.x * 3.1 + fx.z * 1.7) * 0.12
      : 1 + Math.sin(age * 5 + fx.x * 3.1 + fx.z * 1.7) * 0.05;
    const fade = Math.min(1, frac * 3); // back third: shrink with the fade
    fx.mesh.scale.setScalar(fx.radius * grow * pulse * (0.6 + 0.4 * fade));
    if (fx.kind === "slick") fx.mesh.rotation.z += dt * 0.6;
    else if (fx.kind === "oil") fx.mesh.rotation.z += dt * 0.2; // heavier liquid, lazier swirl
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = (fx.kind === "oil" ? 0.75 : fx.kind === "fire" ? 0.85 : 0.45) * fade;

    // ── Ambient emission ── FIRE actually burns: a steady per-frame stream of
    // rising embers plus the odd upward spark burst, scaled by pool size so a
    // big ignited slick roars while a trail tile crackles. Liquids shimmer.
    if (state.vfx) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * fx.radius * 0.8;
      const ex = fx.x + Math.cos(a) * r;
      const ez = fx.z + Math.sin(a) * r;
      if (fx.kind === "fire") {
        const density = Math.min(3, 0.8 + fx.radius); // embers/frame odds, by size
        if (Math.random() < dt * 60 * 0.35 * density) state.vfx.ember(ex, 0.1, ez);
        if (Math.random() < dt * 60 * 0.12 * density) state.vfx.ember(fx.x, 0.35, fx.z); // inner tongue, higher
        if (Math.random() < dt * 2.2) state.vfx.sparks(ex, 0.15, ez, 0, 0.6, 2); // crackle pop
      } else if (ticked) {
        if (fx.kind === "slick" && Math.random() < 0.6) state.vfx.mote(ex, 0.08, ez);
        else if (fx.kind === "oil") {
          state.vfx.mote(ex, 0.08, ez); // iridescent glints, every tick
          if (Math.random() < 0.3) state.vfx.burst(ex, 0.12, ez, 0x6fd0e8, 2, 0.7);
        }
      }
    }

    // ── Enemy overlap ── (skipped for hostile enemy hazards — those hunt YOU)
    for (const zmb of fx.hostile ? [] : state.zombies) {
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
      } else if (fx.kind === "oil") {
        // Greased: steering barely bites while oiledT holds (zombie.ts blends
        // the heading), refreshed for as long as the foe stays in the pool.
        zmb.oiledT = OIL_ZOMBIE_T;
        if (ticked && Math.random() < 0.35) state.vfx?.mote(zmb.x, 0.15, zmb.z);
      }
    }

    // ── The ball glides on oil ── the existing oil-flask state (no friction,
    // dead steering) is exactly the "faster and slicker" ride, topped up for
    // every frame the rolling knight stays on the pool.
    if (fx.kind === "oil" && p && p.momSpeed > 0) {
      const dx = p.x - fx.x;
      const dz = p.z - fx.z;
      const rr = fx.radius + PLAYER_R;
      if (dx * dx + dz * dz <= rr * rr) {
        p.oilT = Math.max(p.oilT, OIL_MARBLE_T);
        if (ticked) state.vfx?.mote(p.x, 0.1, p.z);
      }
    }

    // ── Player harm ── a HOSTILE fire (enemy hazard) always burns you; your OWN
    // fire only bites under the self-harm toggle.
    if (fx.kind === "fire" && ticked && (fx.hostile || state.dbgMaterialSelfHarm) && p && p.hp > 0 && p.iframes <= 0) {
      const dx = p.x - fx.x;
      const dz = p.z - fx.z;
      const rr = fx.radius + PLAYER_R;
      if (dx * dx + dz * dz <= rr * rr) hitPlayerRanged(MATERIAL_SELF_HARM_DMG, fx.x, fx.z);
    }
  }

  // ── IGNITION ── any fire touching an oil pool lights the WHOLE pool: the
  // oil despawns and a fire of the same footprint takes its place for a long
  // burn. This is the Flipper-Charge-over-your-own-slick combo. Done as its
  // own pass so despawn/spawn never fights the main loop's index walk.
  for (let i = state.floorFx.length - 1; i >= 0; i--) {
    const oil = state.floorFx[i];
    if (oil.kind !== "oil") continue;
    let lit = false;
    for (const f of state.floorFx) {
      if (f.kind !== "fire") continue;
      const dx = f.x - oil.x;
      const dz = f.z - oil.z;
      const rr = f.radius + oil.radius;
      if (dx * dx + dz * dz <= rr * rr) {
        lit = true;
        break;
      }
    }
    if (!lit) continue;
    const { x, z, radius } = oil;
    despawn(i);
    spawnFloorFx("fire", x, z, radius, OIL_IGNITE_LIFE);
    state.vfx?.burst(x, 0.3, z, PALETTE_HEX[16], 24, 4); // whoosh — the pool catches
    state.shakeT = Math.max(state.shakeT, 0.15);
  }
}
