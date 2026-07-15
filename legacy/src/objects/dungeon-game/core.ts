/**
 * 🗡️ Maze Game (the dungeon) — lifecycle + the game loop.
 *
 * Simulation runs on a FIXED 60Hz timestep (accumulator pattern): movement,
 * attack windows and AI feel identical on a 144Hz monitor and a struggling
 * laptop. Rendering happens once per RAF regardless.
 *
 * Visibility contract (playtest rounds: "walls cover the player", then "too
 * flat, want the Diablo side view"):
 *  - wall height is STRUCTURAL (Diablo trick, see constants.ts): corridor
 *    south rims are knee-high, back walls full height — a 38° side-view
 *    camera with zero possible occlusion
 *  - a GreaterDepth silhouette pass draws the knight through anything that
 *    still manages to occlude him
 *
 * Weapons: two slots (Tab / 1 / 2 to swap). Walking over a weapon fills an
 * empty slot; with both hands full it EXCHANGES with the active hand — the
 * old weapon drops right there, durability intact, and can't be re-grabbed
 * until you step away. The knight's held art is per-weapon: each weapon has
 * its own sprite sheet (built lazily, cached) and a swap is a texture switch.
 *
 * Follows the same lifecycle contract as every other game here (see
 * mouse-game/core.ts): fullscreen overlay, its own renderer, setInputOwner on
 * the way in, clearInputOwner + full dispose on the way out.
 */
import * as THREE from "three";
import { setInputOwner, clearInputOwner } from "../../utils/input-manager";
import { state, resetState, freshPlayerFields, activeWeapon, type Zombie, type GroundItem } from "./state";
import { createPixelPass } from "./render/pixel-pass";
import { createVfx } from "./render/vfx";
import { loadAtlasSheet } from "./render/atlas-loader";
import { buildSpriteSheet, createActorSprite, createStaticSprite, createOcclusionSilhouette, type SpriteSheet } from "./render/sprite";
import { Animator } from "./render/animator";
import { makeKnightPaints, ZOMBIE_PAINTS, ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera } from "./camera";
import { createHUD, updateHUD, showToast, showGameOver, showControlsHint, showPickupNote } from "./ui";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, mulberry32, tileCenter, worldToTile, at, T_STAIRS } from "./maze/generator";
import { decorateMaze } from "./maze/decorate";
import { buildMaze } from "./maze/build";
import { bfsDistances } from "./entities/ai";
import { updatePlayer } from "./entities/player";
import { updateZombies } from "./entities/zombie";
import { updateProjectiles } from "./entities/projectiles";
import { syncActorMesh } from "./entities/combat";
import { createInput } from "./input";
import {
  levelConfig,
  FLOW_INTERVAL,
  GOLD_PER_DESCENT,
  ZOMBIE_HP,
  FIXED_STEP,
  MAX_FRAME,
  PICKUP_RANGE,
  DROP_CLEAR_RANGE,
  PPU,
  WALL_H,
  AMBIENT_INTENSITY,
  HEMI_INTENSITY,
  DIR_INTENSITY,
  DIR_HEIGHT,
  SHADOW_MAP_SIZE,
  SHADOW_AREA,
  SHADOW_OPACITY,
  FOG_NEAR,
  FOG_FAR,
  BLOOM_DEFAULT,
  AO_DEFAULT,
  PLAYER_LAMP_INTENSITY,
  PLAYER_LAMP_RANGE,
  FLAME_FPS,
  FLAME_FRAMES,
  MOTE_RATE,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { WEAPONS, GEAR, freshWeapon, type WeaponId, type WeaponState, type GearSlot } from "./items";
import { sfxStairs, sfxGameOver, sfxPickup } from "./audio";

/**
 * Presentation-only lights, module-scoped (not on `state`) — rebuilt on every
 * launch. `sun` casts the shadows and follows the camera; `lamp` is the hero's
 * personal readability light; ambient/hemi are kept so startLevel can re-tint
 * them per depth (the FF dungeon trick: deeper floors shift palette).
 */
let sun: THREE.DirectionalLight | null = null;
let lamp: THREE.PointLight | null = null;
let ambient: THREE.AmbientLight | null = null;
let hemi: THREE.HemisphereLight | null = null;

/** Per-depth colour grading, cycling: cold slate → rot green → blood → arcane. */
const DEPTH_TINTS = [
  { amb: 0x6b7d99, sky: 0x8fa3bd, ground: 0x1e2430 },
  { amb: 0x6d8a78, sky: 0x8fbda6, ground: 0x1e2a22 },
  { amb: 0x8a6f74, sky: 0xbd949a, ground: 0x2a1e20 },
  { amb: 0x6f74a0, sky: 0x97a0e0, ground: 0x1e2233 },
];

export function isDungeonGameActive(): boolean {
  return state.active;
}

/** The knight's atlas for a given held weapon — built once, cached for the session. */
function playerSheetFor(id: WeaponId): SpriteSheet {
  let sheet = state.playerSheets.get(id);
  if (!sheet) {
    sheet = buildSpriteSheet(makeKnightPaints(id));
    state.playerSheets.set(id, sheet);
  }
  return sheet;
}

/** Make the sprite match the active hand. Cheap no-op when nothing changed. */
function applyWeaponArt(): void {
  const id = activeWeapon().id;
  if (id === state.playerArtWeapon || !state.player) return;
  state.player.sprite.setSheet(playerSheetFor(id));
  state.player.silhouette?.syncMap();
  state.playerArtWeapon = id;
}

export function launchDungeonGame(onExit?: () => void): void {
  if (state.active) return;
  state.active = true;
  state.onExitCallback = onExit ?? null;
  state.runSeed = (Math.random() * 0x7fffffff) | 0;
  setInputOwner("dungeon-game");

  // ── Overlay ──
  state.container = document.createElement("div");
  state.container.id = "dungeon-game-overlay";
  state.container.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    background: #0b0d12;
    overflow: hidden;
  `;
  // The room below has a window-level click handler — don't let clicks reach it.
  state.container.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(state.container);

  // ── Renderer ──
  // No MSAA: the quantize pass flattens colour anyway, and the depth-edge
  // outline wants clean depth values. Colour/tonemapping is set by createPixelPass.
  state.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  state.renderer.setClearColor(PALETTE_HEX[0]);
  // One shadow-casting directional light needs the shadow map on. PCFSoft gives
  // a slightly feathered edge that survives the palette quantizer as a soft
  // band rather than a hard jagged step.
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFShadowMap;
  state.container.appendChild(state.renderer.domElement);

  state.pixelPass = createPixelPass(state.renderer, {
    quantize: state.quantize,
    dither: state.dither,
    scanline: state.scanline,
    outline: state.outline,
    bloom: BLOOM_DEFAULT,
    ao: AO_DEFAULT,
  });

  // ── Scene ──
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(PALETTE_HEX[0]);
  // Far (upper) corridors fade into the void — see FOG_NEAR/FOG_FAR.
  state.scene.fog = new THREE.Fog(PALETTE_HEX[0], FOG_NEAR, FOG_FAR);

  // Cold slate fill. This is the colour the dungeon IS — torches and the key
  // light are accents on top of it. With real normal maps and a directional
  // key doing the shaping, ambient's job is the READABILITY floor: it can't
  // bottom out to pure black or the quantizer snaps stone to void.
  // (Colours are re-tinted per depth in startLevel.)
  ambient = new THREE.AmbientLight(DEPTH_TINTS[0].amb, AMBIENT_INTENSITY);
  state.scene.add(ambient);

  // A little vertical shape, so wall tops separate from wall faces.
  hemi = new THREE.HemisphereLight(DEPTH_TINTS[0].sky, DEPTH_TINTS[0].ground, HEMI_INTENSITY);
  state.scene.add(hemi);

  // The hero's personal lamp — the Castlevania readability rule: whatever
  // else is dark, the player and the tiles around them always read.
  lamp = new THREE.PointLight(0xd9cba8, PLAYER_LAMP_INTENSITY, PLAYER_LAMP_RANGE, 2);
  state.scene.add(lamp);

  // The cold key light — a high, raking directional that casts the wall
  // shadows into the corridors. Its ortho shadow frustum is small and follows
  // the camera target each frame (see loop), so a 2k map stays crisp over the
  // whole visible area instead of being stretched across the entire maze.
  sun = new THREE.DirectionalLight(0xa7c0e0, DIR_INTENSITY);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = DIR_HEIGHT * 2.5;
  sun.shadow.camera.left = -SHADOW_AREA;
  sun.shadow.camera.right = SHADOW_AREA;
  sun.shadow.camera.top = SHADOW_AREA;
  sun.shadow.camera.bottom = -SHADOW_AREA;
  sun.shadow.bias = -0.0009; // kill the shadow-acne the coursed normal maps would otherwise show
  sun.shadow.normalBias = 0.04;
  // Soften the shadow so it snaps to a stone step, not pure void.
  sun.shadow.intensity = 1 - SHADOW_OPACITY;
  state.scene.add(sun);
  state.scene.add(sun.target); // target is moved in the loop; must be in the graph

  // ── VFX (sparks / blood / embers / dust / slashes) ──
  // Lives for the whole session (not per level); drawn into the scene so it
  // gets pixelated, quantized and bloomed with everything else.
  state.vfx = createVfx(state.scene);

  // ── Camera ──
  state.camera = createDungeonCamera();
  aimCamera(state.camera, 0, 0.5, 0);

  // ── Sprite sheets (zombies share one; the knight's is per-weapon) ──
  state.zombieSheet = buildSpriteSheet(ZOMBIE_PAINTS);

  // Hand-made pixel art overrides the procedural painters the moment it
  // exists: drop sprite-forge output at public/dungeon/sprites/knight-<id>.*
  // and the knight upgrades on next launch. Missing art = silent fallback.
  void loadAtlasSheet("knight-sword").then((sheet) => {
    if (!sheet || !state.active) return;
    state.playerSheets.set("sword", sheet);
    if (state.playerArtWeapon === "sword" && state.player) {
      state.player.sprite.setSheet(sheet);
      state.player.silhouette?.syncMap();
    }
  });

  // ── HUD + input ──
  state.hudEl = createHUD(state.container);
  state.input = createInput(state.container);
  showControlsHint(state.container);

  state.onKeyDown = handleKey;
  window.addEventListener("keydown", state.onKeyDown);

  state.onResize = () => state.pixelPass?.resize();
  window.addEventListener("resize", state.onResize);

  // ── Level 1 ──
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  startLevel(1);

  console.log("🗡️ Maze Game: descending (run seed", state.runSeed, ")");

  state.lastTime = performance.now();
  state.animFrameId = requestAnimationFrame(loop);
}

/** Build (or rebuild) a depth: maze, decoration, geometry, actors, loot. */
function startLevel(level: number): void {
  if (!state.scene) return;

  disposeLevel(); // tears down the previous maze + horde + loot, keeps the player

  state.level = level;
  const cfg = levelConfig(level);

  // Depth grading: each floor down shifts the fill palette a family over.
  const tint = DEPTH_TINTS[(level - 1) % DEPTH_TINTS.length];
  ambient?.color.setHex(tint.amb);
  if (hemi) {
    hemi.color.setHex(tint.sky);
    hemi.groundColor.setHex(tint.ground);
  }

  // One deterministic stream per (run, level): a refresh mid-run rerolls the
  // run, but a single level is internally consistent and replayable.
  const rng = mulberry32((state.runSeed ^ (level * 0x9e3779b9)) >>> 0);
  // Thick walls are what make the Diablo low-rim/tall-back trick work — see
  // thickenWalls. Decoration runs on the thickened grid.
  const grid = thickenWalls(generateMaze(cfg.cellsW, cfg.cellsH, rng));
  const plan = decorateMaze(grid, rng, cfg.zombies, cfg.torches);

  state.grid = grid;
  state.stairs = plan.stairs;
  state.maze = buildMaze(state.scene, grid, plan);

  // ── Player ──
  const startPos = tileCenter(grid, plan.start.i, plan.start.j);
  if (!state.player) {
    const weaponId = activeWeapon().id;
    const sprite = createActorSprite(playerSheetFor(weaponId), false);
    state.scene.add(sprite.mesh);
    const anim = new Animator(sprite);
    state.player = {
      sprite,
      anim,
      x: startPos.x,
      z: startPos.z,
      silhouette: createOcclusionSilhouette(sprite),
      ...freshPlayerFields(),
    };
    state.playerArtWeapon = weaponId;
  } else {
    state.player.x = startPos.x;
    state.player.z = startPos.z;
    state.player.attackT = -1;
  }
  state.player.anim.setFacing("S");
  state.player.anim.play("idle", { force: true });
  syncActorMesh(state.player);

  // ── Horde ──
  state.zombies = plan.spawns.map((s): Zombie => {
    const sprite = createActorSprite(state.zombieSheet!, false);
    const pos = tileCenter(grid, s.i, s.j);
    state.scene!.add(sprite.mesh);
    const anim = new Animator(sprite);
    anim.setFacing("S");
    anim.play("idle");
    const z: Zombie = {
      sprite,
      anim,
      x: pos.x,
      z: pos.z,
      hp: ZOMBIE_HP,
      mode: "idle",
      speed: cfg.zombieSpeed,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: false,
      burnT: 0,
    };
    syncActorMesh(z);
    return z;
  });

  // ── Loot on the floor ──
  state.groundItems = plan.items.map((it, k): GroundItem => {
    const sprite = createStaticSprite(ITEM_PAINTS[it.id]);
    const pos = tileCenter(grid, it.i, it.j);
    sprite.mesh.position.set(pos.x, 0, pos.z);
    state.scene!.add(sprite.mesh);
    return { kind: it.kind, id: it.id, x: pos.x, z: pos.z, sprite, bobPhase: k * 1.7 };
  });

  // ── Set dressing ──
  state.props = plan.props.map((pr) => {
    const sprite = createStaticSprite(PROP_PAINTS[pr.kind]);
    const pos = tileCenter(grid, pr.i, pr.j);
    sprite.mesh.position.set(pos.x, 0, pos.z);
    state.scene!.add(sprite.mesh);
    return { sprite };
  });

  state.flowField = null;
  state.flowTimer = 0;
  snapCameraTo(startPos.x, startPos.z);
  state.hudDirty = true;

  showToast(`DEPTH ${level}`, level === 1 ? "kill everything · find the stairs" : "");
}

/** Tab / 1 / 2 — switch hands. Switching to an empty slot is allowed (fists). */
function selectSlot(slot: number): void {
  if (slot === state.activeSlot || state.gameOver) return;
  state.activeSlot = slot;
  const w = WEAPONS[activeWeapon().id];
  showPickupNote(`${w.icon} ${w.label.toUpperCase()} in hand`);
  state.hudDirty = true;
}

function handleKey(e: KeyboardEvent): void {
  if (!state.active) return;

  switch (e.key.toLowerCase()) {
    case "escape":
      exitDungeonGame();
      return;

    // ── Weapon slots ──
    case "tab":
      e.preventDefault(); // don't let focus walk out of the game
      selectSlot(1 - state.activeSlot);
      break;
    case "1":
      selectSlot(0);
      break;
    case "2":
      selectSlot(1);
      break;

    // ── Hidden style-debug toggles (kept from the Phase 0 sandbox) ──
    case "q":
      state.quantize = !state.quantize;
      state.pixelPass?.setQuantize(state.quantize);
      break;
    case "f":
      state.dither = !state.dither;
      state.pixelPass?.setDither(state.dither);
      break;
    case "k":
      state.scanline = !state.scanline;
      state.pixelPass?.setScanline(state.scanline);
      break;
    case "o":
      state.outline = !state.outline;
      state.pixelPass?.setOutline(state.outline);
      break;
  }
}

function onPlayerDeath(): void {
  if (state.gameOver) return;
  state.gameOver = true;
  sfxGameOver();
  state.player?.sprite.setTint(0x6b7688); // drained
  state.gameOverEl = showGameOver({
    onRetry: () => {
      state.gameOverEl?.remove();
      state.gameOverEl = null;
      state.gameOver = false;
      state.kills = 0;
      state.goldRun = 0;
      state.weaponSlots = [freshWeapon("sword"), null];
      state.activeSlot = 0;
      state.gear = {};
      if (state.player) {
        Object.assign(state.player, freshPlayerFields());
        state.player.sprite.setTint(null);
      }
      startLevel(1); // roguelite: gold is banked, the run restarts
    },
    onLeave: () => exitDungeonGame(),
  });
}

function descend(): void {
  state.goldRun += GOLD_PER_DESCENT;
  addGold(GOLD_PER_DESCENT, "dungeon-game");
  sfxStairs();
  startLevel(state.level + 1);
}

/** Drop a carried weapon on the floor, durability intact, un-grabbable until you step away. */
function dropWeapon(w: WeaponState, x: number, z: number): void {
  if (!state.scene) return;
  const sprite = createStaticSprite(ITEM_PAINTS[w.id]);
  sprite.mesh.position.set(x, 0, z);
  state.scene.add(sprite.mesh);
  state.groundItems.push({
    kind: "weapon",
    id: w.id,
    x,
    z,
    sprite,
    bobPhase: Math.random() * Math.PI * 2,
    durability: w.durability,
    blockedUntilAway: true,
  });
}

/**
 * A weapon comes off the floor: into an empty slot if there is one, otherwise
 * it EXCHANGES with the active hand (the old weapon drops where the new one
 * lay). Either way the new weapon ends up in the active hand — picking a
 * thing up and not holding it would feel like a misclick.
 */
function pickUpWeapon(it: GroundItem): void {
  const id = it.id as WeaponId;
  const incoming: WeaponState = { id, durability: it.durability ?? WEAPONS[id].maxDurability };

  const empty = state.weaponSlots.findIndex((s) => s === null);
  if (empty >= 0) {
    state.weaponSlots[empty] = incoming;
    state.activeSlot = empty;
  } else {
    const outgoing = state.weaponSlots[state.activeSlot]!;
    state.weaponSlots[state.activeSlot] = incoming;
    dropWeapon(outgoing, it.x, it.z);
  }

  const w = WEAPONS[id];
  const detail = w.kind === "ranged" ? `ammo ${incoming.durability}` : `dmg ${w.damage}`;
  showPickupNote(`${w.icon} ${w.label.toUpperCase()} — ${detail} · TAB swaps`);
}

/** Walk-over pickups: weapons fill/exchange the hand slots, gear fills its slot. */
function checkPickups(): void {
  const p = state.player;
  if (!p) return;
  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    const it = state.groundItems[k];
    const dist = Math.hypot(it.x - p.x, it.z - p.z);

    // A weapon you just put down: inert until you actually leave the spot.
    if (it.blockedUntilAway) {
      if (dist > DROP_CLEAR_RANGE) it.blockedUntilAway = false;
      continue;
    }
    if (dist > PICKUP_RANGE) continue;

    if (it.kind === "weapon") {
      pickUpWeapon(it);
    } else {
      const slot = it.id as GearSlot;
      const def = GEAR[slot];
      state.gear = { ...state.gear, [slot]: def.absorb > 0 ? def.absorb : 1 };
      showPickupNote(`${def.icon} ${def.label.toUpperCase()} equipped`);
    }
    sfxPickup();
    state.hudDirty = true;

    state.scene?.remove(it.sprite.mesh);
    it.sprite.dispose();
    state.groundItems.splice(k, 1);
  }
}

/** One 60Hz simulation step. */
function simulate(dt: number): void {
  const p = state.player;
  const g = state.grid;
  if (state.gameOver || !p || !g || !state.input) return;

  // ── Flow field — one BFS serves the whole horde, every FLOW_INTERVAL ──
  state.flowTimer -= dt;
  if (state.flowTimer <= 0) {
    state.flowTimer = FLOW_INTERVAL;
    const pt = worldToTile(g, p.x, p.z);
    state.flowField = bfsDistances(g, pt.i, pt.j);
  }

  updatePlayer(dt, state.input);
  updateZombies(dt);
  updateProjectiles(dt);
  checkPickups();

  // ── Stairs? ──
  const pt = worldToTile(g, p.x, p.z);
  if (at(g, pt.i, pt.j) === T_STAIRS) {
    descend();
  } else if (p.hp <= 0) {
    onPlayerDeath();
  }
}

function loop(now: number): void {
  if (!state.active) return;
  state.animFrameId = requestAnimationFrame(loop);

  const frame = Math.min((now - state.lastTime) / 1000, MAX_FRAME); // tab-out protection
  state.lastTime = now;
  state.elapsed += frame;

  // ── Fixed-timestep simulation ──
  // Hit-freeze: while hitstopT is running the sim is paused so the impact reads
  // as a crunch. VFX and rendering (below) keep running through the freeze. We
  // clamp the accumulator so no time is banked — the world doesn't fast-forward
  // to catch up the instant the freeze ends.
  state.accumulator += frame;
  if (state.hitstopT > 0) {
    state.hitstopT = Math.max(0, state.hitstopT - frame);
    state.accumulator = Math.min(state.accumulator, FIXED_STEP);
  } else {
    while (state.accumulator >= FIXED_STEP) {
      state.accumulator -= FIXED_STEP;
      simulate(FIXED_STEP);
    }
  }

  const p = state.player;
  const g = state.grid;

  // The held art follows the active hand — pickup, swap, break, retry all
  // funnel through this one check.
  applyWeaponArt();

  // ── Presentation (per rendered frame) ──
  // VFX use REAL frame time so particles keep flying through a hit-freeze.
  state.vfx?.update(frame);
  if (p) p.anim.update(frame);
  for (const z of state.zombies) z.anim.update(frame);

  // Loot bobs gently, snapped to the pixel grid so it doesn't shimmer.
  for (const it of state.groundItems) {
    const y = 0.06 + Math.sin(state.elapsed * 2.6 + it.bobPhase) * 0.05;
    it.sprite.mesh.position.y = Math.round(y * PPU) / PPU;
  }

  if (p && state.maze) {
    // Flip-book flames — every torch, lit or not, licks at FLAME_FPS with its
    // own phase so a corridor of torches never synchronizes.
    for (const f of state.maze.flames) {
      const idx = Math.floor(state.elapsed * FLAME_FPS + f.phase * FLAME_FRAMES) % FLAME_FRAMES;
      f.tex.offset.x = idx / FLAME_FRAMES;
    }
    // Ambient dust motes drifting through the air near the player.
    if (Math.random() < MOTE_RATE * frame) {
      state.vfx?.mote(p.x + (Math.random() - 0.5) * 7, 0.15 + Math.random() * 0.9, p.z + (Math.random() - 0.5) * 5);
    }
  }

  if (p && g && state.maze) {
    // Park the pooled torch lights on the nearest torches. Sorting a handful
    // of anchors per frame is nothing; 20 live point lights would not be.
    const anchors = state.maze.torchAnchors
      .map((a) => ({ a, d: (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z) }))
      .sort((u, v) => u.d - v.d);
    state.maze.lightPool.forEach((light, i) => {
      const anchor = anchors[i]?.a;
      if (anchor) light.position.set(anchor.x, WALL_H * 0.62 + 0.3, anchor.z);
      // Torch flicker: two out-of-phase sines — random flicker reads as a
      // broken lightbulb, layered sines read as a flame.
      const t = state.elapsed * 6 + i * 2.1;
      light.intensity = 6 + Math.sin(t) * 0.7 + Math.sin(t * 2.7) * 0.4;
      // Rising embers off the nearby lit torches (~7/sec each) — bright, so the
      // bloom pass gives them a warm halo. Only the closest few are lit anyway.
      if (anchor && Math.random() < 7 * frame) {
        state.vfx?.ember(anchor.x, WALL_H * 0.62 + 0.34, anchor.z);
      }
    });
  }

  if (p && state.camera) updateFollowCamera(state.camera, p.x, p.z, frame);

  // Keep the key light's small shadow frustum centred on the player: the light
  // rakes in from the world's north-west (opposite the south-east camera) so
  // wall shadows fall toward the viewer, into the corridors, not away.
  if (p && sun) {
    sun.target.position.set(p.x, 0, p.z);
    sun.position.set(p.x - DIR_HEIGHT * 0.55, DIR_HEIGHT, p.z - DIR_HEIGHT * 0.55);
  }
  if (p && lamp) lamp.position.set(p.x, 1.3, p.z);

  if (state.hudDirty && state.hudEl) {
    state.hudDirty = false;
    updateHUD(state.hudEl);
  }

  if (state.scene && state.camera && state.pixelPass) {
    state.pixelPass.render(state.scene, state.camera);
  }
}

export function exitDungeonGame(): void {
  if (!state.active) return;

  const onExit = state.onExitCallback;

  if (state.animFrameId !== null) cancelAnimationFrame(state.animFrameId);
  if (state.onKeyDown) window.removeEventListener("keydown", state.onKeyDown);
  if (state.onResize) window.removeEventListener("resize", state.onResize);
  state.input?.dispose();

  disposeAll();
  sun = null; // the lights themselves are freed with the scene by disposeAll
  lamp = null;
  ambient = null;
  hemi = null;
  clearInputOwner();

  console.log(`🗡️ Maze Game: exited at depth ${state.level} (${state.kills} kills, ${state.goldRun} gold)`);
  resetState();
  onExit?.();
}
