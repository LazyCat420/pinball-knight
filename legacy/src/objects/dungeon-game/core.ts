/**
 * 🗡️ Maze Game (the dungeon) — lifecycle + the game loop.
 *
 * Phases 1-3 of the blueprint: WASD movement with grid collision, a
 * procedurally generated maze per level (stairs at max BFS distance), and a
 * zombie horde on a shared flow field with real combat, HUD, death and retry.
 * The Phase 0 pixel pipeline (320×180 target, palette quantize, dither) is
 * untouched underneath — the look was signed off in the style sandbox.
 *
 * Follows the same lifecycle contract as every other game here (see
 * mouse-game/core.ts): fullscreen overlay, its own renderer, setInputOwner on
 * the way in, clearInputOwner + full dispose on the way out.
 */
import * as THREE from "three";
import { setInputOwner, clearInputOwner } from "../../utils/input-manager";
import { state, resetState, freshPlayerFields, type Zombie } from "./state";
import { createPixelPass } from "./render/pixel-pass";
import { buildSpriteSheet, createActorSprite } from "./render/sprite";
import { Animator } from "./render/animator";
import { PLAYER_FRAMES, ZOMBIE_FRAMES } from "./render/sprite-data";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera } from "./camera";
import { createHUD, updateHUD, showToast, showGameOver, showControlsHint } from "./ui";
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
import { levelConfig, FLOW_INTERVAL, GOLD_PER_DESCENT, ZOMBIE_HP } from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { sfxStairs, sfxGameOver } from "./audio";

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
  startLevel(1);

  console.log("🗡️ Maze Game: descending (run seed", state.runSeed, ")");

  state.lastTime = performance.now();
  state.animFrameId = requestAnimationFrame(loop);
}

/** Build (or rebuild) a depth: maze, decoration, geometry, actors. */
function startLevel(level: number): void {
  if (!state.scene) return;

  disposeLevel(); // tears down the previous maze + horde, keeps the player

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
  state.torchLights = state.maze.torchLights;

  // ── Player ──
  const startPos = tileCenter(grid, plan.start.i, plan.start.j);
  if (!state.player) {
    const sprite = createActorSprite(state.playerSheet!, false);
    state.scene.add(sprite.mesh);
    const anim = new Animator(sprite);
    state.player = { sprite, anim, x: startPos.x, z: startPos.z, ...freshPlayerFields() };
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

function loop(now: number): void {
  if (!state.active) return;
  state.animFrameId = requestAnimationFrame(loop);

  const dt = Math.min((now - state.lastTime) / 1000, 0.1); // clamp — a tab-out shouldn't skip 40 frames
  state.lastTime = now;
  state.elapsed += dt;

  const p = state.player;
  const g = state.grid;

  if (!state.gameOver && p && g && state.input) {
    // ── Flow field — one BFS serves the whole horde, every FLOW_INTERVAL ──
    state.flowTimer -= dt;
    if (state.flowTimer <= 0) {
      state.flowTimer = FLOW_INTERVAL;
      const pt = worldToTile(g, p.x, p.z);
      state.flowField = bfsDistances(g, pt.i, pt.j);
    }

    updatePlayer(dt, state.input);
    updateZombies(dt);

    // ── Stairs? ──
    const pt = worldToTile(g, p.x, p.z);
    if (at(g, pt.i, pt.j) === T_STAIRS) {
      descend();
    } else if (p.hp <= 0) {
      onPlayerDeath();
    }
  }

  // Animations tick even when dead / game over — death clips play out.
  if (p) p.anim.update(dt);
  for (const z of state.zombies) z.anim.update(dt);

  // Torch flicker. Two out-of-phase sines rather than random noise: random
  // flicker reads as a broken lightbulb, layered sines read as a flame.
  state.torchLights.forEach((light, i) => {
    const t = state.elapsed * 6 + i * 2.1;
    light.intensity = 6 + Math.sin(t) * 0.7 + Math.sin(t * 2.7) * 0.4;
  });

  if (p && state.camera) updateFollowCamera(state.camera, p.x, p.z, dt);

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
