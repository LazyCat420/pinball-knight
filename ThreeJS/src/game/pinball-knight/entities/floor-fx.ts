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
  SLICK_BOIL_RATE,
  FIRE_QUENCH_RATE,
  PINBALL_MAX_SPEED,
  GROOVE_MIN_SPEED,
  GROOVE_SPACING,
  GROOVE_RADIUS,
  GROOVE_LIFE,
  GROOVE_TRIP_TIME,
  GROOVE_TRIP_SPEED,
  GROOVE_RAIL_PULL,
  GROOVE_RAIL_MAX_SPEED,
  GROOVE_ALIGN_RIDE,
  GROOVE_ALIGN_CROSS,
  GROOVE_HOP_HEIGHT,
  GROOVE_HOP_TIME,
  GROOVE_HOP_SPEED_KEEP,
  GROOVE_HOP_MIN_SPEED,
  GROOVE_DEFLECT,
  GROOVE_HOP_COOLDOWN,
  MELT_MIN_SPEED,
  MELT_SPACING,
  MELT_RADIUS,
  MELT_LIFE,
  FLOOR_FX_MAX,
  CARD_CHILL_TIME,
  TAR_DRAG,
  LIGHTNING_ROD_RANGE,
  LIGHTNING_ROD_DAMAGE,
  LIGHTNING_ROD_TICK,
  WATER_WAKE_MIN_SPEED,
  WATER_WAKE_SPACING,
  WATER_WAKE_RADIUS,
  WATER_WAKE_LIFE,
  WATER_MARBLE_GLIDE_T,
  STONE_WAKE_MIN_SPEED,
  STONE_WAKE_SPACING,
  STONE_WAKE_RADIUS,
  STONE_WAKE_LIFE,
  STORM_WAKE_MIN_SPEED,
  STORM_WAKE_SPACING,
  STORM_WAKE_RADIUS,
  STORM_WAKE_LIFE,
  SHADOW_WAKE_MIN_SPEED,
  SHADOW_WAKE_SPACING,
  SHADOW_WAKE_RADIUS,
  SHADOW_WAKE_LIFE,
  DIAMOND_WAKE_MIN_SPEED,
  DIAMOND_WAKE_SPACING,
  DIAMOND_WAKE_RADIUS,
  DIAMOND_WAKE_LIFE,
  MAGNET_PULSE_SPACING,
  MAGNET_PULSE_RADIUS,
  MAGNET_PULSE_LIFE,
} from "../constants";
import { sfxSplash } from "../sfx";
import { ambience, type AmbienceId } from "../sfx/ambience";
import { PALETTE_HEX } from "../render/palette";
import { skillAgg } from "../skill-runtime";
import { damageZombie, hitPlayerRanged } from "./combat";
import {
  attachElement,
  clearElements,
  elementAlpha,
  hasElementShader,
  makeElementMaterial,
  releaseElement,
  setElementAge,
  setElementIntensity,
  setElementOpacity,
} from "../fx/floor/decals";
import type { ElementMaterial } from "../fx/elements/element";

const FLOOR_Y = 0.03; // just above the floor plane

// Shared GPU assets per kind (a unit disc scaled per-instance), torn down on teardown.
let _discGeo: THREE.CircleGeometry | null = null;
const _mats: Partial<Record<FloorFxKind, THREE.MeshBasicMaterial>> = {};
const _texs: Partial<Record<FloorFxKind, THREE.CanvasTexture>> = {};

/** Every kind, for the prewarm sweep. Derived from KIND_COLOR below so a new
 *  kind cannot be added without this list picking it up. */
export const FLOOR_FX_KINDS = (): FloorFxKind[] => Object.keys(KIND_COLOR) as FloorFxKind[];

const KIND_COLOR: Record<FloorFxKind, number> = {
  slick: PALETTE_HEX[30], // arcane mid (wet blue)
  fire: PALETTE_HEX[16], // flame
  "shard-field": PALETTE_HEX[31], // prismatic cool
  oil: PALETTE_HEX[29], // arcane dark — a deep blue-black sheen
  groove: PALETTE_HEX[2], // stone dark — a cut in the floor, not a substance
  frost: PALETTE_HEX[31], // prismatic cool — ice
  tar: PALETTE_HEX[26], // leather shadow — a matte brown-black, NOT oil's petrol sheen
  rod: PALETTE_HEX[31], // prismatic cool — the arc's own colour
  molten: PALETTE_HEX[26], // leather shadow — the CHAR, not the glow. See below.
};

function discGeo(): THREE.CircleGeometry {
  _discGeo ??= new THREE.CircleGeometry(1, 20); // unit radius, scaled per fx
  return _discGeo;
}

/** Kinds whose look is PAINTED rather than a flat tint. A flat tinted disc
 *  worked for water but made fire look like an orange coaster and oil vanish
 *  into dark stone; every kind that has to be identified at a glance from
 *  across a room gets its own canvas. */
const PAINTED: FloorFxKind[] = ["fire", "oil", "groove", "frost", "tar", "rod"];
/** Kinds that ADD light (they feed the bloom) rather than sitting on the scene. */
const ADDITIVE: FloorFxKind[] = ["fire", "frost", "rod"];

/**
 * Painted looks. Each canvas exists to answer one question at a glance: what is
 * this, and does it help or hurt?
 *   fire  — white-hot core → orange → deep-red ragged edge (additive, blooms)
 *   oil   — near-black pool with a bright iridescent RIM + thin sheen arcs
 *   frost — a white core under radiating CRYSTAL SPOKES; angular where every
 *           liquid here is round, because "ice" is a shape before it is a colour
 *   tar   — matte and DEAD: no rim light, no sheen, no glow. Oil's opposite has
 *           to look like oil's opposite or the pair teaches nothing
 *   rod   — a bright stake: a hot pinpoint core inside a thin charged ring
 */
function paintKindTexture(kind: FloorFxKind): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null; // headless tests — flat tint
  const s = 128;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const cx = s / 2;
  if (kind === "groove") {
    // A CUT, not a stain. What reads as "gouged out of stone" is the pairing of
    // a dark trench with a BRIGHT CHIPPED LIP on the light side — the lip is
    // freshly exposed rock catching the torchlight, and without it a dark oval
    // just looks like a shadow lying on the floor.
    // A trail is drawn as many OVERLAPPING stamps, so each one must be soft and
    // partly transparent — a hard opaque disc turns the trail into a string of
    // beads (which is exactly what the first cut looked like). Falloff starts
    // immediately and the core never reaches full black.
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.5);
    g.addColorStop(0, "rgba(10,12,18,0.62)"); // deepest part of the trench
    g.addColorStop(0.35, "rgba(18,22,30,0.44)");
    g.addColorStop(0.68, "rgba(35,40,50,0.2)");
    g.addColorStop(1, "rgba(43,48,59,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cx, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Exposed-rock lip on the light side. A STROKED arc chained into a
    // scalloped caterpillar edge across overlapping stamps; a soft additive
    // blob instead accumulates into one smooth highlight running the length of
    // the rut, which is what sells "carved" rather than "shadow".
    ctx.globalCompositeOperation = "lighter";
    const lip = ctx.createRadialGradient(cx, cx - s * 0.1, 0, cx, cx - s * 0.1, s * 0.34);
    lip.addColorStop(0, "rgba(154,164,180,0.10)");
    lip.addColorStop(1, "rgba(154,164,180,0)");
    ctx.fillStyle = lip;
    ctx.beginPath();
    ctx.arc(cx, cx - s * 0.1, s * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  } else if (kind === "frost") {
    // Crystalline: a pale core, then straight SPOKES out to the rim. Additive,
    // so it glows cold against stone the way fire glows hot.
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.5);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.4, "rgba(191,232,255,0.6)");
    g.addColorStop(0.8, "rgba(111,208,232,0.28)");
    g.addColorStop(1, "rgba(111,208,232,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cx, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(238,241,245,0.75)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cx);
      ctx.lineTo(cx + Math.cos(a) * s * 0.46, cx + Math.sin(a) * s * 0.46);
      ctx.stroke();
      // Barbs, so a spoke reads as a frost crystal rather than a wheel spoke.
      for (const t of [0.4, 0.68]) {
        const bx = cx + Math.cos(a) * s * 0.46 * t;
        const bz = cx + Math.sin(a) * s * 0.46 * t;
        for (const off of [0.5, -0.5]) {
          ctx.beginPath();
          ctx.moveTo(bx, bz);
          ctx.lineTo(bx + Math.cos(a + off) * s * 0.1, bz + Math.sin(a + off) * s * 0.1);
          ctx.stroke();
        }
      }
    }
  } else if (kind === "tar") {
    // Deliberately the dullest thing on the floor. Oil says "look at me and
    // then slide"; tar says "there is nothing here and you will stop".
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.5);
    g.addColorStop(0, "rgba(12,10,9,0.98)");
    g.addColorStop(0.78, "rgba(26,20,16,0.95)");
    g.addColorStop(0.94, "rgba(42,28,20,0.7)");
    g.addColorStop(1, "rgba(42,28,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cx, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // A couple of sunken bubbles — the only motion tar is allowed.
    ctx.fillStyle = "rgba(58,40,28,0.55)";
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      const r = s * (0.12 + i * 0.05);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "rod") {
    const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, s * 0.5);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, "#bfe8ff");
    g.addColorStop(0.5, "rgba(111,208,232,0.35)");
    g.addColorStop(1, "rgba(111,208,232,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(191,232,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cx, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === "fire") {
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
    const tex = PAINTED.includes(kind) ? (_texs[kind] ??= paintKindTexture(kind) ?? undefined) : undefined;
    _mats[kind] = tex
      ? new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          // Fire, frost and the rod ADD light (bloom feeds on their white
          // cores); oil and tar sit on the scene.
          blending: ADDITIVE.includes(kind) ? THREE.AdditiveBlending : THREE.NormalBlending,
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

/**
 * Hidden stand-ins, one per kind, that exist ONLY so the descent-screen prewarm
 * has something to compile.
 *
 * Two reasons the prewarm could not see these materials before: `matFor` is
 * LAZY, so on a fresh floor none of the five exist yet; and every real decal is
 * created mid-play, long after the warm-up ran. So the first oil slick, the
 * first fire puddle and the first groove of a run each compiled a pipeline in
 * the middle of a fight.
 *
 * The proxies hold the SHARED base material — which is what `spawnFloorFx`
 * clones — so warming the base warms every clone (pipelines are keyed by
 * material content, and a clone matches its source).
 */
const _warmProxies: THREE.Mesh[] = [];
/** The shader materials the proxies wear, held so teardown can dispose them.
 *  They are NOT registered for the visual tick — a hidden proxy has no clock to
 *  advance, and registering them would keep them alive past `clearElements`. */
const _warmElements: ElementMaterial[] = [];

/**
 * Force all five kinds' materials into existence, reveal one proxy each, and
 * return the closure that hides them again. Called by `warmFloorPipelines`.
 */
export function warmFloorFxReveal(scene: THREE.Scene): () => void {
  if (!_warmProxies.length) {
    for (const kind of FLOOR_FX_KINDS()) {
      // Shader kinds warm a REAL element material, not the painted one they
      // replaced. Pipelines are keyed by material CONTENT, so one proxy graph
      // warms every structurally-identical instance the run will ever spawn —
      // which is the whole reason a per-instance material costs one pipeline.
      // Warming `matFor()` here instead would compile a shader nothing draws and
      // leave the first fire of a run to compile in the middle of a fight.
      const el = hasElementShader(kind) ? makeElementMaterial(kind) : null;
      const m = new THREE.Mesh(discGeo(), el ? el.material : matFor(kind)); // shared material, NOT a clone
      if (el) _warmElements.push(el);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      _warmProxies.push(m);
    }
  }
  // Re-add every time: the proxies live across floors, but nothing guarantees
  // the scene they were parented to is the one being warmed now. add() on an
  // existing child is a no-op reparent.
  for (const m of _warmProxies) {
    scene.add(m);
    m.visible = true;
    m.frustumCulled = false;
  }
  return () => {
    for (const m of _warmProxies) m.visible = false;
  };
}

export function disposeFloorFxAssets(): void {
  for (const m of _warmProxies) m.removeFromParent();
  _warmProxies.length = 0; // geometry + materials are the shared ones, disposed below
  // The proxies' shader materials are NOT in `_mats`, so the sweep below cannot
  // reach them — they need their own line or they leak one graph per kind per
  // teardown.
  for (const el of _warmElements) el.dispose();
  _warmElements.length = 0;
  clearElements();
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
  // Evict oldest-first BEFORE pushing, so the array never exceeds the budget
  // even for a frame. despawn() is reused rather than splicing here so scene
  // removal and material disposal stay in exactly one place — a bare splice
  // would leak a mesh and a material per stamp, ~50/s under the ball.
  while (state.floorFx.length >= FLOOR_FX_MAX) despawn(0);
  // Its own material instance so opacity can fade independently of siblings.
  // Shader-backed kinds build a fresh node graph rather than cloning: a
  // NodeMaterial clone SHARES its uniform nodes, which would fuse every decal's
  // fade and phase together. See fx/elements/element.ts.
  const el = makeElementMaterial(kind);
  const mesh = new THREE.Mesh(discGeo(), el ? el.material : matFor(kind).clone());
  if (el) attachElement(mesh, el);
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
    // Both paths dispose exactly one material per decal, so the eviction
    // contract (asserted in load-warmup.test.ts) is unchanged by the shaders.
    dispose: el ? () => releaseElement(mesh) : () => (mesh.material as THREE.Material).dispose(),
  });
}

// ── THE GROOVE — the steel ball's trail ───────────────────────────────────────

/** Where the last groove stamp landed, so the trail spaces evenly regardless
 *  of framerate (a per-frame stamp would carpet the floor at 144fps). */
let lastGrooveX = 0;
let lastGrooveZ = 0;
let hasGroove = false;

/**
 * Gouge the floor under a heavy ball. Called every frame while rolling; stamps
 * only once per GROOVE_SPACING travelled, so the rut is a continuous furrow at
 * any framerate.
 *
 * Deliberately NOT a decal: each stamp is a real floor-fx entry, which is what
 * gives it persistence, overlap detection and disposal for free — and what lets
 * `grooveInteract` below make it something you can actually use.
 */
export function carveGroove(x: number, z: number, speed: number, dirX = 0, dirZ = 0): void {
  if (speed < GROOVE_MIN_SPEED) return;
  if (hasGroove && Math.hypot(x - lastGrooveX, z - lastGrooveZ) < GROOVE_SPACING) return;
  hasGroove = true;
  lastGrooveX = x;
  lastGrooveZ = z;
  // Faster = deeper bite, so a screaming line scars harder than a cruise.
  const bite = Math.min(1, speed / PINBALL_MAX_SPEED);
  spawnFloorFx("groove", x, z, GROOVE_RADIUS * (0.8 + bite * 0.5), GROOVE_LIFE);
  // Stamp the cut's own LINE onto it. A groove is a directional feature — this
  // is what lets the ball tell "crossing it" from "riding it" later.
  const cut = state.floorFx[state.floorFx.length - 1];
  if (cut && cut.kind === "groove") {
    const l = Math.hypot(dirX, dirZ);
    cut.dirX = l > 1e-6 ? dirX / l : 1;
    cut.dirZ = l > 1e-6 ? dirZ / l : 0;
  }
  // Stone chips fly on the cut — the sound-free tell that the floor just lost.
  if (state.vfx && Math.random() < 0.3) state.vfx.sparks(x, 0.06, z, 0, 0.4, 2);
}

// ── THE MELT — the lava ball's trail ─────────────────────────────────────────

/** Same job as the groove's cursor: stamp by DISTANCE travelled, never by
 *  frame, or the wake is twice as dense at 120fps as at 60. */
let lastMeltX = 0;
let lastMeltZ = 0;
let hasMelt = false;

/**
 * Melt the floor under a lava ball. Called every frame while it rolls; stamps
 * once per MELT_SPACING travelled, so the wake is one continuous molten line at
 * any framerate.
 *
 * COSMETIC BY CONSTRUCTION — `spawnFloorFx` with a kind nothing in the overlap
 * loop reads. It leaves no status, no damage and no physics, unlike its sibling
 * the groove (which trips foes and rails the ball). Lava's teeth are its fire
 * puddles; this is the picture of the machine getting hot, and giving the
 * picture a hitbox would have doubled the material's floor control for free.
 */
export function meltFloor(x: number, z: number, speed: number, dirX = 0, dirZ = 0): void {
  if (speed < MELT_MIN_SPEED) return;
  if (hasMelt && Math.hypot(x - lastMeltX, z - lastMeltZ) < MELT_SPACING) return;
  hasMelt = true;
  lastMeltX = x;
  lastMeltZ = z;
  // Faster = a wider bite of floor gone. The same `bite` shape as the groove,
  // so the two trails scale together and one cannot quietly outgrow the other.
  const bite = Math.min(1, speed / PINBALL_MAX_SPEED);
  spawnFloorFx("molten", x, z, MELT_RADIUS * (0.78 + bite * 0.44), MELT_LIFE);
  // The scar remembers which way the ball went, so the shader could elongate
  // along it later; carried now because the stamp is the only place that knows.
  const scar = state.floorFx[state.floorFx.length - 1];
  if (scar && scar.kind === "molten") {
    const l = Math.hypot(dirX, dirZ);
    scar.dirX = l > 1e-6 ? dirX / l : 1;
    scar.dirZ = l > 1e-6 ? dirZ / l : 0;
  }
  // Smoke off the fresh melt — RARE, and small. This is a per-STAMP roll and
  // the trail lays ~70 stamps a second, so the intuitive "only sometimes" 0.22
  // was 15 plumes/s: measured on a screenshot, the wake was a bank of grey
  // blobs with the molten scar completely hidden underneath it. At 0.05 it is
  // one puff every three tiles, which reads as venting rather than as weather.
  if (state.vfx && Math.random() < 0.05) state.vfx.smoke(x, 0.12, z, 1, 0.28);
}

// ── MARBLE BALL WAKES (Water, Stone, Storm, Shadow, Diamond, Magnet) ─────────

let lastWaterX = 0, lastWaterZ = 0, hasWaterWake = false;
/** 💧 Water Ball Wake: leaves slippery puddles that monsters and the ball glide on. */
export function waterWakeFloor(x: number, z: number, speed: number, _dirX = 0, _dirZ = 0): void {
  if (speed < WATER_WAKE_MIN_SPEED) return;
  if (hasWaterWake && Math.hypot(x - lastWaterX, z - lastWaterZ) < WATER_WAKE_SPACING) return;
  hasWaterWake = true;
  lastWaterX = x;
  lastWaterZ = z;
  const bite = Math.min(1, speed / PINBALL_MAX_SPEED);
  spawnFloorFx("slick", x, z, WATER_WAKE_RADIUS * (0.8 + bite * 0.4), WATER_WAKE_LIFE);
  if (state.vfx && Math.random() < 0.25) {
    state.vfx.burst(x, 0.08, z, PALETTE_HEX[30], 3, 1.2);
  }
  if (Math.random() < 0.08) sfxSplash();
}

let lastStoneX = 0, lastStoneZ = 0, hasStoneWake = false;
/** 🪨 Stone Ball Wake: heavily ruts the floor with grooves and kicks up dust. */
export function stoneRumbleFloor(x: number, z: number, speed: number, dirX = 0, dirZ = 0): void {
  if (speed < STONE_WAKE_MIN_SPEED) return;
  if (hasStoneWake && Math.hypot(x - lastStoneX, z - lastStoneZ) < STONE_WAKE_SPACING) return;
  hasStoneWake = true;
  lastStoneX = x;
  lastStoneZ = z;
  const bite = Math.min(1, speed / PINBALL_MAX_SPEED);
  spawnFloorFx("groove", x, z, STONE_WAKE_RADIUS * (0.8 + bite * 0.4), STONE_WAKE_LIFE);
  const scar = state.floorFx[state.floorFx.length - 1];
  if (scar && scar.kind === "groove") {
    const l = Math.hypot(dirX, dirZ);
    scar.dirX = l > 1e-6 ? dirX / l : 1;
    scar.dirZ = l > 1e-6 ? dirZ / l : 0;
  }
  if (state.vfx && Math.random() < 0.2) {
    state.vfx.dust(x, 0.06, z);
  }
}

let lastStormX = 0, lastStormZ = 0, hasStormWake = false;
/** ⚡ Storm Ball Wake: crackles with static sparks and electric motes along the floor. */
export function stormCrackleFloor(x: number, z: number, speed: number, dirX = 0, dirZ = 0): void {
  if (speed < STORM_WAKE_MIN_SPEED) return;
  if (hasStormWake && Math.hypot(x - lastStormX, z - lastStormZ) < STORM_WAKE_SPACING) return;
  hasStormWake = true;
  lastStormX = x;
  lastStormZ = z;
  if (state.vfx) {
    state.vfx.sparks(x, 0.15, z, dirX, dirZ, 3);
    if (Math.random() < 0.3) {
      state.vfx.mote(x + (Math.random() - 0.5) * 0.3, 0.2, z + (Math.random() - 0.5) * 0.3);
    }
  }
}

let lastShadowX = 0, lastShadowZ = 0, hasShadowWake = false;
/** 🌑 Shadow Ball Wake: leaves shadowy void motes and abyssal mist. */
export function shadowMistFloor(x: number, z: number, speed: number, _dirX = 0, _dirZ = 0): void {
  if (speed < SHADOW_WAKE_MIN_SPEED) return;
  if (hasShadowWake && Math.hypot(x - lastShadowX, z - lastShadowZ) < SHADOW_WAKE_SPACING) return;
  hasShadowWake = true;
  lastShadowX = x;
  lastShadowZ = z;
  if (state.vfx) {
    state.vfx.mote(x, 0.12, z);
    if (Math.random() < 0.2) state.vfx.burst(x, 0.15, z, 0x3a2050, 3, 0.8);
  }
}

let lastDiamondX = 0, lastDiamondZ = 0, hasDiamondWake = false;
/** 💎 Diamond Ball Wake: leaves glittering diamond shards and prismatic glints. */
export function diamondGlintFloor(x: number, z: number, speed: number, _dirX = 0, _dirZ = 0): void {
  if (speed < DIAMOND_WAKE_MIN_SPEED) return;
  if (hasDiamondWake && Math.hypot(x - lastDiamondX, z - lastDiamondZ) < DIAMOND_WAKE_SPACING) return;
  hasDiamondWake = true;
  lastDiamondX = x;
  lastDiamondZ = z;
  spawnFloorFx("shard-field", x, z, DIAMOND_WAKE_RADIUS, DIAMOND_WAKE_LIFE);
  if (state.vfx && Math.random() < 0.3) {
    state.vfx.burst(x, 0.18, z, PALETTE_HEX[31], 2, 1.2);
  }
}

let lastMagnetX = 0, lastMagnetZ = 0, hasMagnetWake = false;
/** 🧲 Magnet Ball Wake: induction pulses and alternating polarized magnetic sparks. */
export function magnetPulseFloor(x: number, z: number, speed: number, dirX = 0, dirZ = 0): void {
  if (speed < 3.8) return;
  if (hasMagnetWake && Math.hypot(x - lastMagnetX, z - lastMagnetZ) < MAGNET_PULSE_SPACING) return;
  hasMagnetWake = true;
  lastMagnetX = x;
  lastMagnetZ = z;
  if (state.vfx) {
    state.vfx.sparks(x, 0.14, z, -dirZ, dirX, 2);
    if (Math.random() < 0.35) {
      const tint = Math.random() < 0.5 ? 0x4f8fdb : 0xe05a6f;
      state.vfx.burst(x, 0.15, z, tint, 3, 1.0);
    }
  }
}

/**
 * What a rut DOES once it exists — the whole reason this isn't a decal.
 *
 *  • Enemies that stumble into it TRIP (the water-slick channel at a fraction
 *    of its drift: you catch a foot in a groove, you don't skate along it).
 *  • A rolling ball that finds a cut gets RAILED along it — your own trail
 *    becomes track. Gated on speed: a screaming ball jumps the cut, a cruising
 *    one drops in. This is the interactive half the player asked for.
 */
function grooveInteract(fx: FloorFx, _dt: number, ticked: boolean): void {
  const rr = fx.radius + ZOMBIE_R;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - fx.x;
    const dz = zmb.z - fx.z;
    if (dx * dx + dz * dz > rr * rr) continue;
    if (!zmb.slipT || zmb.slipT <= 0) {
      const d = Math.hypot(dx, dz) || 1;
      zmb.slipT = GROOVE_TRIP_TIME;
      zmb.slipVX = (dx / d) * GROOVE_TRIP_SPEED;
      zmb.slipVZ = (dz / d) * GROOVE_TRIP_SPEED;
      if (ticked) state.vfx?.dust(zmb.x, 0.1, zmb.z);
    }
  }

  // ── The ball meets the cut ──
  const p = state.player;
  if (!p || p.momSpeed <= 0) return;
  const px = p.x - fx.x;
  const pz = p.z - fx.z;
  const pr = fx.radius + PLAYER_R;
  if (px * px + pz * pz > pr * pr) return;

  // How aligned is travel with the cut's own line? This one number decides
  // which of the three behaviours the rut applies.
  const gx = fx.dirX ?? 1;
  const gz = fx.dirZ ?? 0;
  const along = p.momX * gx + p.momZ * gz; // both unit → this IS cos(angle)
  const absAlong = Math.abs(along);

  if (absAlong < GROOVE_ALIGN_CROSS) {
    // BROADSIDE — the near lip kicks the ball off the floor. It keeps its
    // heading (a lip launches you onward, it doesn't turn you) but pays a
    // little speed to the impact, and it's airborne long enough to clear the
    // trough. The cooldown stops a dense trail buzzing the ball in place.
    if (p.momSpeed >= GROOVE_HOP_MIN_SPEED && p.grooveHopT <= 0 && p.grooveHopCdT <= 0) {
      p.grooveHopT = GROOVE_HOP_TIME;
      p.grooveHopDur = GROOVE_HOP_TIME;
      p.grooveHopCdT = GROOVE_HOP_COOLDOWN;
      p.momSpeed *= GROOVE_HOP_SPEED_KEEP;
      state.vfx?.dust(p.x, 0.06, p.z);
      state.vfx?.sparks(p.x, 0.1, p.z, 0, 0.5, 3);
    }
    return;
  }

  if (absAlong >= GROOVE_ALIGN_RIDE) {
    // RIDING IT — you're in the trough. Rail toward the centre-line so the cut
    // holds you, but only under the speed cap: a screaming ball rides straight
    // over the top of its own rut.
    if (p.momSpeed > GROOVE_RAIL_MAX_SPEED) return;
    const d = Math.hypot(px, pz) || 1;
    const pull = GROOVE_RAIL_PULL * _dt * (1 - d / pr);
    p.momX -= (px / d) * pull;
    p.momZ -= (pz / d) * pull;
  } else {
    // GLANCING — you clipped the edge at a shallow angle. The trough wall
    // DEFLECTS the heading toward the cut's line (signed, so a ball running
    // against the groove's direction is turned to the near end, not spun
    // round). This is the "swoop off it" case.
    const sign = along >= 0 ? 1 : -1;
    const k = GROOVE_DEFLECT * _dt;
    p.momX += gx * sign * k;
    p.momZ += gz * sign * k;
    if (ticked) state.vfx?.mote(p.x, 0.1, p.z);
  }
  const ml = Math.hypot(p.momX, p.momZ) || 1;
  p.momX /= ml;
  p.momZ /= ml;
}

/**
 * Advance the groove hop — the little airborne arc over a rut's lip.
 *
 * Deliberately NOT the ramp-hop system: that one OWNS the player (it lerps
 * position along a stored trajectory and blocks all other movement). A groove
 * bump must leave the ride fully in control — the ball keeps steering,
 * bouncing and colliding exactly as it would on the ground. So this only
 * lifts the SPRITE and pins the contact shadow, which is all "airborne" needs
 * to read in an isometric view.
 */
export function updateGrooveHop(dt: number): void {
  const p = state.player;
  if (!p) return;
  if (p.grooveHopCdT > 0) p.grooveHopCdT = Math.max(0, p.grooveHopCdT - dt);
  if (p.grooveHopT <= 0) return;
  p.grooveHopT = Math.max(0, p.grooveHopT - dt);
  const u = p.grooveHopDur > 0 ? 1 - p.grooveHopT / p.grooveHopDur : 1;
  const h = Math.sin(Math.PI * Math.min(1, u)) * GROOVE_HOP_HEIGHT;
  p.sprite.mesh.position.y = h;
  p.sprite.setElevation(h);
  if (p.grooveHopT <= 0) {
    p.sprite.mesh.position.y = 0;
    p.sprite.setElevation(0);
    state.vfx?.dust(p.x, 0.05, p.z); // the landing puff
  }
}

/**
 * The rod earths itself through the NEAREST live foe in range.
 *
 * Nearest rather than a random pick, and one target rather than a splash, on
 * purpose: the arc has to be something the player can predict and position
 * around, and a rod that sprayed would just be a second Arcane Pulse on a
 * timer. Deterministic — no RNG on a path the horde observes, which is what
 * lets a co-op peer run the same rod and get the same corpses.
 */
function rodZap(fx: FloorFx): void {
  let best: (typeof state.zombies)[number] | null = null;
  let bestD = LIGHTNING_ROD_RANGE * LIGHTNING_ROD_RANGE;
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - fx.x;
    const dz = zmb.z - fx.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestD) continue;
    bestD = d2;
    best = zmb;
  }
  if (!best) return;
  const dx = best.x - fx.x;
  const dz = best.z - fx.z;
  const d = Math.hypot(dx, dz) || 1;
  damageZombie(best, LIGHTNING_ROD_DAMAGE, dx / d, dz / d, 2);
  state.vfx?.bolt(fx.x, 0.55, fx.z, dx / d, dz / d, d);
  state.vfx?.sparks(best.x, 0.6, best.z, dx / d, dz / d, 5);
}

function despawn(index: number): void {
  const fx = state.floorFx[index];
  state.scene?.remove(fx.mesh);
  fx.dispose();
  state.floorFx.splice(index, 1);
}

export function clearFloorFx(): void {
  hasGroove = false; // a new floor starts unscarred — no seam from the last one
  hasMelt = false; // …and unmelted.
  hasWaterWake = false;
  hasStoneWake = false;
  hasStormWake = false;
  hasShadowWake = false;
  hasDiamondWake = false;
  hasMagnetWake = false;
  // of the next floor whenever the player happens to arrive near where the last
  // one ended, which reads as "the trail sometimes doesn't start".
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
    if (ticked) fx.tick = fx.kind === "fire" ? CARD_BURN_TICK : fx.kind === "rod" ? LIGHTNING_ROD_TICK : FLOORFX_TICK;

    // ── Life animation ── a snappy grow-in pop (slight overshoot), a gentle
    // breathing pulse while live, and a shrink+fade over the back third. The
    // slick slowly spins so the puddle reads liquid instead of stamped.
    const age = fx.maxLife - fx.life;
    const frac = fx.life / fx.maxLife;

    // ── GROOVE: a cut in stone, so it does NONE of the liquid animation. It
    // is stamped at full size instantly (the ball carved it as it passed), sits
    // perfectly still, and only slowly dulls as grit settles into it. A rut
    // that pulsed or span would read as a puddle.
    if (fx.kind === "groove") {
      fx.mesh.scale.setScalar(fx.radius);
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * Math.min(1, frac * 4);
      grooveInteract(fx, dt, ticked);
      continue;
    }

    // ── MOLTEN: a burn scar, so it does none of the liquid animation either —
    // but for the opposite reason to the groove. A rut is INERT and holds still
    // because nothing about it is alive; a melt holds its SIZE (the floor that
    // went is gone, it cannot shrink back) while everything about it changes
    // TEMPERATURE. That is `uAge` in the shader, and it is deliberately not
    // `uOpacity`: cooling and fading are different, and fading the scar out as
    // it cools would leave a spotless floor behind a ball that just melted it.
    if (fx.kind === "molten") {
      fx.mesh.scale.setScalar(fx.radius);
      setElementAge(fx.mesh, age);
      // Held near full for most of the life, then dropped over the last fifth —
      // by which point the shader has already cooled it to char, so what
      // disappears is a black mark, not a glowing one.
      setElementOpacity(fx.mesh, elementAlpha("molten", 0.88) * Math.min(1, frac * 5));
      // The hot end of the wake breathes heat: a fresh scar is still outgassing.
      // Gated hard on age so the tail of a long trail is silent — a line of 170
      // decals all emitting is a fog bank, which is the failure mode the smoke
      // in `meltFloor` is already rationed against.
      if (state.vfx && age < 0.7 && Math.random() < dt * 2.5) {
        state.vfx.ember(fx.x + (Math.random() - 0.5) * fx.radius, 0.08, fx.z + (Math.random() - 0.5) * fx.radius);
      }
      continue;
    }

    // ── LIGHTNING ROD: a planted stake, not a puddle. It does not breathe, it
    // HUMS — a tight fast pulse — and on every tick it earths itself through
    // the nearest live foe. The one deferred kind that deals damage rather
    // than applying a status, which is why a rank-2 Arcane Pulse changes how a
    // room is fought instead of just how hard it is hit.
    if (fx.kind === "rod") {
      // The 11Hz hum used to be a scale pulse on the quad. It is now inside the
      // rod shader, where it can drive the ring and the core independently
      // instead of resizing the whole stake — so the CPU only holds the radius.
      if (hasElementShader("rod")) {
        fx.mesh.scale.setScalar(fx.radius);
        setElementOpacity(fx.mesh, elementAlpha("rod", 0.9) * Math.min(1, frac * 4));
      } else {
        fx.mesh.scale.setScalar(fx.radius * (1 + Math.sin(age * 11) * 0.14));
        (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.min(1, frac * 4);
      }
      if (state.vfx && Math.random() < dt * 6) state.vfx.sparks(fx.x, 0.5, fx.z, 0, 0.8, 2);
      if (ticked) rodZap(fx);
      continue;
    }
    const grow = age < 0.18 ? 0.35 + (age / 0.18) * 0.75 : 1.1 - Math.min(0.1, (age - 0.18) * 0.5);
    const shader = hasElementShader(fx.kind);
    // The scale pulse was a STAND-IN for motion the surface did not have: the
    // same shape, resized. A shader decal genuinely changes shape, so it keeps
    // only `grow` — the spawn pop, which is a gameplay tell — and the flicker
    // moves into the noise field where it belongs. Painted kinds keep the pulse.
    const pulse = shader
      ? 1
      : fx.kind === "fire"
        ? 1 + Math.sin(age * 13 + fx.x * 3.1 + fx.z * 1.7) * 0.12
        : 1 + Math.sin(age * 5 + fx.x * 3.1 + fx.z * 1.7) * 0.05;
    const fade = Math.min(1, frac * 3); // back third: shrink with the fade
    fx.mesh.scale.setScalar(fx.radius * grow * pulse * (0.6 + 0.4 * fade));
    // Spinning the quad was the other stand-in for motion. A shader surface that
    // ALSO spins reads as a record player — the ripples travel one way while the
    // whole disc rotates another — so every shader-backed kind stops turning and
    // gets its movement from its own field instead. Oil swirls in its warp, frost
    // grows from `uAge` rather than rotating, and tar was always meant to look
    // like it had already stopped.
    if (!shader) {
      if (fx.kind === "slick") fx.mesh.rotation.z += dt * 0.6;
      else if (fx.kind === "oil") fx.mesh.rotation.z += dt * 0.2; // heavier liquid, lazier swirl
      else if (fx.kind === "frost") fx.mesh.rotation.z += dt * 0.09; // a crystal creeping
    }
    const alpha = elementAlpha(fx.kind, fx.kind === "oil" ? 0.75 : fx.kind === "tar" ? 0.95 : fx.kind === "frost" ? 0.7 : 0.45);
    if (shader) {
      // A node material's alpha comes from its graph, so `material.opacity` is a
      // silent no-op here — it would fade nothing and the decal would sit at
      // full strength until it despawned.
      setElementOpacity(fx.mesh, alpha * fade);
      setElementAge(fx.mesh, age);
      // A pool that has been burning a while is hotter than one just lit.
      if (fx.kind === "fire") setElementIntensity(fx.mesh, 0.8 + 0.4 * Math.min(1, age * 2));
    } else {
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * fade;
    }

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
        // A DYING fire smokes. Past the two-thirds mark the embers thin out and
        // smoke takes over, so a pool that is about to go out looks like it —
        // which is information (that tile is about to stop hurting the horde)
        // delivered without a HUD element.
        if (frac < 0.35 && Math.random() < dt * 3.0 * density) {
          state.vfx.smoke(ex, 0.2, ez, 1, fx.radius * 0.4);
        }
      } else if (fx.kind === "frost") {
        // Cold vapour rolling off the rune — the ONLY reason a frost tile reads
        // as active rather than as a decal someone painted on the floor.
        if (Math.random() < dt * 60 * 0.12) state.vfx.mote(ex, 0.05 + Math.random() * 0.3, ez);
        if (ticked && Math.random() < 0.4) state.vfx.burst(fx.x, 0.1, fx.z, 0xbfe8ff, 2, 0.6);
      } else if (ticked) {
        if (fx.kind === "slick" && Math.random() < 0.6) state.vfx.mote(ex, 0.08, ez);
        else if (fx.kind === "oil") {
          state.vfx.mote(ex, 0.08, ez); // iridescent glints, every tick
          if (Math.random() < 0.3) state.vfx.burst(ex, 0.12, ez, 0x6fd0e8, 2, 0.7);
        } else if (fx.kind === "tar" && Math.random() < 0.25) {
          state.vfx.dust(ex, 0.05, ez); // a bubble surfacing and dying. No glints.
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
      } else if (fx.kind === "frost") {
        // FROST RUNE — chilled while standing on it, and refreshed every frame
        // it stays, so the rune is terrain rather than a one-shot debuff. Uses
        // the card system's own chill channel: one slow, one meaning.
        zmb.chillT = CARD_CHILL_TIME;
        if (ticked && Math.random() < 0.4) state.vfx?.mote(zmb.x, 0.4, zmb.z);
      } else if (fx.kind === "tar") {
        // TAR PIT — the same chill, plus the thing that makes it tar rather
        // than more ice: it CANCELS a skid. A foe that slipped, tripped or was
        // launched into the pit stops dead in it instead of sliding through,
        // which is what turns the pool into a place bodies collect.
        zmb.chillT = CARD_CHILL_TIME;
        zmb.slipT = 0;
        if (ticked && Math.random() < 0.4) state.vfx?.dust(zmb.x, 0.1, zmb.z);
      }
    }

    // ── The ball glides on oil, ice, and water slick ── the existing oil-flask state (no
    // friction, dead steering) is exactly the "faster and slicker" ride, topped
    // up for every frame the rolling knight stays on the pool. Frost and water slick get the
    // same channel: water lets the ball hydroplane at high speed.
    if ((fx.kind === "oil" || fx.kind === "frost" || fx.kind === "slick") && p && p.momSpeed > 0) {
      const dx = p.x - fx.x;
      const dz = p.z - fx.z;
      const rr = fx.radius + PLAYER_R;
      if (dx * dx + dz * dz <= rr * rr) {
        const glideT = fx.kind === "slick" ? WATER_MARBLE_GLIDE_T : OIL_MARBLE_T;
        p.oilT = Math.max(p.oilT, glideT);
        if (ticked) state.vfx?.mote(p.x, 0.1, p.z);
      }
    }

    // ── Tar drags the ball down ── oil's exact inverse, applied to the player
    // too. A trap that only ever helps you is a buff with a texture; this one
    // eats YOUR momentum as readily as the horde's, so dropping a tar core in
    // your own lane is a real cost and the doughnut shape a rank-2 Slick Field
    // lays down is something to steer around rather than through.
    if (fx.kind === "tar" && p && p.momSpeed > 0) {
      const dx = p.x - fx.x;
      const dz = p.z - fx.z;
      const rr = fx.radius + PLAYER_R;
      if (dx * dx + dz * dz <= rr * rr) {
        p.momSpeed *= Math.exp(-TAR_DRAG * dt);
        if (ticked) state.vfx?.dust(p.x, 0.08, p.z);
      }
    }

    // ── Player harm ── a HOSTILE fire (enemy hazard) always burns you; your OWN
    // fire only bites under the self-harm toggle — or under the CINDER WAKE
    // keystone, whose whole drawback is exactly this: the trail that makes you
    // lethal is a trail you can drive back into. That is not a toggle the
    // player forgot to turn off, it is the price of the node.
    if (fx.kind === "fire" && ticked && (fx.hostile || state.dbgMaterialSelfHarm || skillAgg().cinderWake) && p && p.hp > 0 && p.iframes <= 0) {
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
    state.vfx?.smoke(x, 0.35, z, 9, radius * 0.6); // burning oil is filthy
    state.shakeT = Math.max(state.shakeT, 0.15);
  }

  /**
   * ── QUENCH ── a water slick lying on a fire BOILS OFF, and both pay for it.
   *
   * The mirror of the ignition pass above, and new: the ignition rule only ever
   * handled oil × fire, so dropping a slick onto a burning pool did precisely
   * nothing. That was a hole in a set of interactions the player is otherwise
   * taught to reason about — oil feeds fire, so water ought to fight it.
   *
   * Both sides lose life rather than either despawning outright. A slick that
   * deleted a fire would make water a hard counter and flatten the decision; a
   * fire that ignored water would make the slick pointless. Trading life means
   * SIZE decides the outcome, which is something the player can influence.
   *
   * Its own pass, for the same reason as the ignition: mutating lifetimes while
   * the main loop is walking its index is how an off-by-one despawn happens.
   */
  for (const s of state.floorFx) {
    if (s.kind !== "slick") continue;
    for (const f of state.floorFx) {
      if (f.kind !== "fire") continue;
      const dx = f.x - s.x;
      const dz = f.z - s.z;
      const rr = f.radius + s.radius;
      if (dx * dx + dz * dz > rr * rr) continue;
      // `- 1` because the main loop has already taken one dt off each this frame;
      // these are the EXTRA drain, so the constants read as multipliers.
      s.life -= dt * (SLICK_BOIL_RATE - 1);
      f.life -= dt * (FIRE_QUENCH_RATE - 1);
      if (Math.random() < dt * 14) {
        state.vfx?.steam((s.x + f.x) / 2, 0.18, (s.z + f.z) / 2, 3, 1.8);
      }
      break; // one fire is enough to boil this slick; don't stack the drain
    }
  }

  pollAmbience();
}

/**
 * Which puddles hum, and as what. Anything absent is silent by design — see
 * `sfx/ambience.ts` for why `steam`, `frost`, `tar` and `rod` are not beds.
 */
const AMBIENCE_BED: Partial<Record<FloorFxKind, AmbienceId>> = {
  fire: "fire",
  slick: "water",
  oil: "water",
};

/**
 * How far from a puddle's EDGE it can still be heard, in world units.
 *
 * Measured against the arena rather than chosen: the camera shows ~14 units
 * across at the default rung, so 6 makes a pool audible about when it comes on
 * screen and inaudible from the far side of a room. Falloff is squared, so most
 * of the level is spent in the last couple of units — walking INTO a fire is
 * heard as arriving, not as a fader being pushed.
 */
const AMBIENCE_RANGE = 6;

/**
 * Refresh the sustained beds for this frame.
 *
 * A POLL, not a start/stop: every live puddle adds its share and the total is
 * handed over once per kind. Nothing here has to know about floor descent,
 * death, the pause menu or a hidden tab — when this stops being called the
 * voices fade themselves out on the audio clock. See `sfx/ambience.ts`.
 */
function pollAmbience(): void {
  const p = state.player;
  if (!p) return;
  let fire = 0;
  let water = 0;
  for (const fx of state.floorFx) {
    const bed = AMBIENCE_BED[fx.kind];
    if (!bed) continue;
    const dx = p.x - fx.x;
    const dz = p.z - fx.z;
    const edge = Math.max(0, Math.sqrt(dx * dx + dz * dz) - fx.radius);
    if (edge >= AMBIENCE_RANGE) continue;
    const near = 1 - edge / AMBIENCE_RANGE;
    if (bed === "fire") fire += near * near;
    else water += near * near;
  }
  ambience("fire", fire);
  ambience("water", water);
}
