/**
 * 🗡️ Maze Game (the dungeon) — lifecycle + the game loop.
 *
 * Simulation runs on a FIXED 60Hz timestep (accumulator pattern): movement,
 * attack windows and AI feel identical on a 144Hz monitor and a struggling
 * laptop. Rendering happens once per RAF regardless.
 *
 * Visibility contract (playtest feedback: "walls cover the player"):
 *  - chest-high walls + a 50° camera keep wall faces under a tile of coverage
 *  - the wall rows just south of the knight cut away to ankle height
 *  - a GreaterDepth silhouette pass draws the knight through anything that
 *    still manages to occlude him
 *
 * Follows the same lifecycle contract as every other game here (see
 * mouse-game/core.ts): fullscreen overlay, its own renderer, setInputOwner on
 * the way in, clearInputOwner + full dispose on the way out.
 */
import * as THREE from "three";
import { setInputOwner, clearInputOwner } from "../../utils/input-manager";
import { state, resetState, freshPlayerFields, type Zombie, type GroundItem } from "./state";
import { createPixelPass } from "./render/pixel-pass";
import { buildSpriteSheet, createActorSprite, createStaticSprite, createOcclusionSilhouette } from "./render/sprite";
import { Animator } from "./render/animator";
import { PLAYER_FRAMES, ZOMBIE_FRAMES, ITEM_FRAMES } from "./render/sprite-data";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera } from "./camera";
import { createHUD, updateHUD, showToast, showGameOver, showControlsHint, showPickupNote } from "./ui";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, mulberry32, tileCenter, worldToTile, at, T_STAIRS } from "./maze/generator";
import { decorateMaze } from "./maze/decorate";
import { buildMaze } from "./maze/build";
import { bfsDistances } from "./entities/ai";
import { updatePlayer } from "./entities/player";
import { updateZombies } from "./entities/zombie";
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
  PPU,
  WALL_H,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { WEAPONS, GEAR, freshWeapon, type WeaponId, type GearSlot } from "./items";
import { sfxStairs, sfxGameOver, sfxPickup } from "./audio";

export function isDungeonGameActive(): boolean {
  return state.active;
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
  // No antialiasing: it would smear the pixel edges we're working so hard to
  // keep hard. Everything else about colour/tonemapping is set by createPixelPass.
  state.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  state.renderer.setClearColor(PALETTE_HEX[0]);
  state.container.appendChild(state.renderer.domElement);

  state.pixelPass = createPixelPass(state.renderer, {
    quantize: state.quantize,
    dither: state.dither,
    scanline: state.scanline,
  });

  // ── Scene ──
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(PALETTE_HEX[0]);

  // Cold slate fill. This is the colour the dungeon IS — torches are only
  // accents on top of it. The intensity looks absurdly high and has to be:
  // Lambert multiplies light by an already-dark albedo, and the quantizer
  // snaps the bottomed-out result to black (Phase 0 lesson #2).
  const ambient = new THREE.AmbientLight(0x6b7d99, 4.0);
  state.scene.add(ambient);

  // A little vertical shape, so wall tops separate from wall faces.
  const hemi = new THREE.HemisphereLight(0x8fa3bd, 0x1e2430, 1.2);
  state.scene.add(hemi);

  // ── Camera ──
  state.camera = createDungeonCamera();
  aimCamera(state.camera, 0, 0.5, 0);

  // ── Sprite sheets (built once, shared by every actor of a kind) ──
  state.playerSheet = buildSpriteSheet(PLAYER_FRAMES);
  state.zombieSheet = buildSpriteSheet(ZOMBIE_FRAMES);

  // ── HUD + input ──
  state.hudEl = createHUD(state.container);
  state.input = createInput(state.container);
  showControlsHint(state.container);

  state.onKeyDown = handleKey;
  window.addEventListener("keydown", state.onKeyDown);

  state.onResize = () => state.pixelPass?.resize();
  window.addEventListener("resize", state.onResize);

  // ── Level 1 ──
  state.weapon = freshWeapon("sword");
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

  // One deterministic stream per (run, level): a refresh mid-run rerolls the
  // run, but a single level is internally consistent and replayable.
  const rng = mulberry32((state.runSeed ^ (level * 0x9e3779b9)) >>> 0);
  const grid = generateMaze(cfg.cellsW, cfg.cellsH, rng);
  const plan = decorateMaze(grid, rng, cfg.zombies, cfg.torches);

  state.grid = grid;
  state.stairs = plan.stairs;
  state.maze = buildMaze(state.scene, grid, plan);

  // ── Player ──
  const startPos = tileCenter(grid, plan.start.i, plan.start.j);
  if (!state.player) {
    const sprite = createActorSprite(state.playerSheet!, false);
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
    };
    syncActorMesh(z);
    return z;
  });

  // ── Loot on the floor ──
  state.groundItems = plan.items.map((it, k): GroundItem => {
    const sprite = createStaticSprite(ITEM_FRAMES[it.id]);
    const pos = tileCenter(grid, it.i, it.j);
    sprite.mesh.position.set(pos.x, 0, pos.z);
    state.scene!.add(sprite.mesh);
    return { kind: it.kind, id: it.id, x: pos.x, z: pos.z, sprite, bobPhase: k * 1.7 };
  });

  state.flowField = null;
  state.flowTimer = 0;
  snapCameraTo(startPos.x, startPos.z);
  state.hudDirty = true;

  showToast(`DEPTH ${level}`, level === 1 ? "kill everything · find the stairs" : "");
}

function handleKey(e: KeyboardEvent): void {
  if (!state.active) return;

  switch (e.key.toLowerCase()) {
    case "escape":
      exitDungeonGame();
      return;

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
      state.weapon = freshWeapon("sword");
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

/** Walk-over pickups: weapons swap into the hand, gear fills its slot. */
function checkPickups(): void {
  const p = state.player;
  if (!p) return;
  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    const it = state.groundItems[k];
    if (Math.hypot(it.x - p.x, it.z - p.z) > PICKUP_RANGE) continue;

    if (it.kind === "weapon") {
      state.weapon = freshWeapon(it.id as WeaponId);
      const w = WEAPONS[state.weapon.id];
      showPickupNote(`${w.icon} ${w.label.toUpperCase()} — dmg ${w.damage}`);
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
  state.accumulator += frame;
  while (state.accumulator >= FIXED_STEP) {
    state.accumulator -= FIXED_STEP;
    simulate(FIXED_STEP);
  }

  const p = state.player;
  const g = state.grid;

  // ── Presentation (per rendered frame) ──
  if (p) p.anim.update(frame);
  for (const z of state.zombies) z.anim.update(frame);

  // Loot bobs gently, snapped to the pixel grid so it doesn't shimmer.
  for (const it of state.groundItems) {
    const y = 0.06 + Math.sin(state.elapsed * 2.6 + it.bobPhase) * 0.05;
    it.sprite.mesh.position.y = Math.round(y * PPU) / PPU;
  }

  if (p && g && state.maze) {
    // Cut away the wall rows south of the knight.
    const pt = worldToTile(g, p.x, p.z);
    state.maze.cutaway(pt.i, pt.j);

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
    });
  }

  if (p && state.camera) updateFollowCamera(state.camera, p.x, p.z, frame);

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
  clearInputOwner();

  console.log(`🗡️ Maze Game: exited at depth ${state.level} (${state.kills} kills, ${state.goldRun} gold)`);
  resetState();
  onExit?.();
}
