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
import { WebGPURenderer } from "three/webgpu";
import { selectBackend } from "../../render/backend";
import { setInputOwner, clearInputOwner } from "../../utils/input-manager";
import { state, resetState, freshPlayerFields, activeWeapon, type Zombie, type GroundItem, type EnemyKind } from "./state";
import { createPixelPass } from "./engine/render/pixel-pass";
import { createVfx } from "./render/vfx";
import { createAimIndicator } from "./render/aim-indicator";
import { createPinballParts, updatePinballParts, updatePlungerRig } from "./render/pinball-parts";
import { updateArcKickers } from "./render/arc-kickers";
import { updateArcLanes } from "./render/arc-lanes";
import { tickJuice, resetJuice } from "./engine/juice";
import { railCap } from "./entities/rail";
import { installTouchControls, isTouchDevice, type TouchControls } from "./gui/touch";
import { updateShots } from "./shots";
import { createActorSprite, createStaticSprite, createOcclusionSilhouette } from "./engine/render/sprite";
import { reaperSheet } from "./render/reaper-sheet";
import { installEngine, FixedStepLoop } from "./GameEngine";
import { BIOMES, biomeFor as biomeForSeed } from "./boot/biomes";
import { readSeedParam } from "./boot/seed-param";
import { warmFloorPipelines } from "./boot/warmup";
import { installRenderer, isRendererReady } from "./boot/renderer";
import { installScene } from "./boot/scene";
import { installDevWiring, installGameplayWiring } from "./boot/wiring";
import { setRunDeps } from "./run/deps";
import { descend, descendInto, dropBossReward, adoptPoolSeedWhenItArrives } from "./run/descend";
import { onPlayerDeath, spawnCorpsePiles } from "./run/death";
import { spawnReaper } from "./spawn/reaper";
import { handleKey } from "./input/keymap";
import { floorFlow, gradeFloor } from "./run/grade";
import { tearGraveHole } from "./run/grave-hole";
import { Animator } from "./engine/render/animator";
import { ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { variantIndicesFor, type ZombieType } from "./zombie-types";
import { snapCameraTo, updateFollowCamera, worldToScreenPx } from "./engine/camera";
import { showToast, showPickupNote, spawnFloatingCombo } from "./ui";
import { dismissCardReader } from "./card-reader";
import { getSettings } from "./settings-save";
import { clearPickupToasts } from "./pickup-toast";
import { applySettingsLive } from "./gui/apply-settings";
import { lookFromGear, lookKey } from "./render/knight-look";
import { awardDebugXp as debugGrantXp, playerMaxHp } from "./skill-runtime";
import { mountHUDs, renderHUD, refreshHUD } from "./hud";
import { rippleGlobe } from "./gui/globe-ripple";
import { faceOnHeal } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, tileCenter, worldToTile, at, isWalkable, type Grid, type TilePos, T_STAIRS } from "./maze/generator";
import { floorRng } from "./maze/floor-seed";
import { computeArcCorners } from "./engine/collision";
import { decorateMaze, widenMainArtery, pickEndpoints, type PrefabAnchor } from "./maze/decorate";
import { paintSurfaces, paintBands } from "./maze/surface-paint";
import { buildTrackFloor } from "./maze/track-floor";
import { walkableCount } from "./maze/floor-metrics";
import { authorLampPuzzle, lampCountFor } from "./maze/lamp-puzzle";
import { installLampPuzzle, updateLampPuzzle } from "./lamp-puzzle";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor, themeIndexFor } from "./maze/prefabs";
import { archetypeFor, windinessFor } from "./maze/archetypes";
import { resolveSpawnPoints, type DebugSpawnSpec, type DebugSpawnResult } from "./debug-spawn";
import { rollModifier } from "./maze/modifiers";
import { buildMaze, setMazeBiome } from "./maze/build";
import { hordeFlowField } from "./engine/flow-field";
import { updatePlayer, resetPlayerMotion } from "./entities/player";
import { updateZombies } from "./entities/zombie";
import { updateProjectiles } from "./entities/projectiles";
import { updateFloorFx, updateGrooveHop } from "./entities/floor-fx";
import { updateMaterial, applyMaterial, isMaterial, MATERIAL_LIST } from "./entities/marble";
import { simulateHazards } from "./entities/hazards";
import { updateNpcs, spawnFrog, spawnMerchant, rollMagicianClock } from "./entities/npc";
import { syncActorMesh, tickCombatTimers } from "./entities/combat";
import { createDebugPanel } from "./debug-panel";
import { createInput } from "./engine/input";
import { updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import { tickAbilities } from "./abilities";
import { updateMultiBall } from "./entities/multiball";
import {
  levelConfig,
  FLOW_INTERVAL,
  TIMECRAWL_FACTOR,
  BRUTE_SPEED_FACTOR,
  PIN_FROM_LEVEL,
  TARGETS_PER_FLOOR,
  TRAPDOORS_PER_FLOOR,
  VAULT_RAMPS_PER_FLOOR,
  FOG_RADIUS,
  PLUNGER_SKILL_RANGE,
  MERCHANT_SPAWN_MIN_RING,
  HAZARDS_BASE,
  HAZARDS_PER_LEVEL,
  HAZARDS_MAX,
  MERCHANT_FROM_LEVEL,
  PARTS_BASE,
  TRACK_FIRST,
  SURFACE_BANDS,
  PARTS_PER_LEVEL,
  PARTS_MAX,
  ROOM_MIN_CELLS,
  ROOM_MAX_CELLS,
  REAPER_AFTER,
  REAPER_WARNING,
  BOSS_EVERY,
  KING_HP_BASE,
  KING_HP_PER_FLOOR,
  BOSS_SPEED_FACTOR,
  FIXED_STEP,
  MAX_FRAME,
  PPU,
  WALL_H,
  FLAME_FPS,
  FLAME_FRAMES,
  MOTE_RATE,
  FINISHER_FLASH_T,
  FINISHER_FLASH_MAX,
  floorBudgets,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { WEAPONS, POTIONS, freshWeapon, REGEN_HEAL_PER_TICK, REGEN_TICK_INTERVAL, type WeaponId, type PotionId } from "./items";
import { REAGENTS, rollReagentDrops, type ReagentId } from "./reagents";
import { cardBase } from "./cards";
import { enterTavern, isTavernSceneOpen, closeTavern } from "../../scenes/tavern";
import { openFloorLoading, type FloorLoading } from "./floor-loading";
import { spawnBoss, updateBoss, disposeBoss, bossEngaged } from "./boss";
import { updateSecretDoors, disposeSecretDoors, stampSecretBands, pruneSealedBands } from "./secrets";
import { nearSealed } from "./maze/track-socket";
import { updateCoop, endCoop, isReplica, setCoopFloor, coopSeed } from "./coop";
import { stopPresence, peers, startPresence } from "../../net/presence";
import { resolveDescendFloor } from "../../net/rally";
import { applyDelveCatchUp } from "./delve";
import { createFog, revealAround } from "./fog";
import { closeFloorMap } from "./map-overlay";
import { sfxLevelStart, sfxModifier, sfxBossReveal } from "./audio";
import { saveBestDepth } from "./best-depth";
import { loadResumeFloor } from "./corpse-run";
import { getPlayerName } from "../../services/player-name";
import { runPinballIntro } from "./intro";
import { frenzyIntensity, momentumT } from "./entities/combo-curve";
import { profBegin, profEnd, profCount, profFrame } from "./engine/profiler";
import { installDevHooks } from "./dev/window-hooks";
import { captureFloorCensus } from "./dev/floor-census";
import { debugTeleportToStairs, debugSpawnRing, debugSpawnEnemy, debugKillAll, debugClearEnemies } from "./dev/debug-actions";
import { tintLights, followPlayer, tickShadowThrottle, clearLights } from "./boot/lighting";
import { playerSheetFor, applyWeaponArt, sheetFor, stopSheetBackfill } from "./boot/sheets";
import { beginRunLedger } from "./run/ledger";
import { nearestOpenTile } from "./maze/nearest-open-tile";
import { makeZombie, spawnHordeMember, spawnPinCrew, drainPendingMinis, drainPendingSummons, resetZombieNid } from "./spawn/factory";
import { nextItemNid, resetItemNid } from "./economy/ground-items";
import { sweepCoins, updateCoins } from "./economy/coins";
import { dropCardMaybe, dropReagentsMaybe, spawnMaterialDrop } from "./economy/loot";
import { checkPickups, resetPickupSweep } from "./economy/pickups";
import { applyPotion } from "./economy/shop";

/**
 * The 60Hz clock. One instance for the whole session; `reset()` is called from
 * `exitDungeonGame` only, mirroring the single place `resetState()` zeroes
 * `state.accumulator`. Note the level change deliberately does NOT reset it —
 * `startLevel` re-bases `lastTime` but has never dropped banked time, and this
 * extraction is not the place to change that.
 */
const simLoop = new FixedStepLoop({ fixedStep: FIXED_STEP, maxFrame: MAX_FRAME });

/** The on-screen touch pad, when this device gets one (see createTouchControls). */
let touchControls: TouchControls | null = null;
let debugPanelDispose: (() => void) | null = null;

/** Last sprint-spool+overcharge fill (in 20ths) the HUD painted — repaint only when it changes. */
let meterBlocksShown = -1;

export function isDungeonGameActive(): boolean {
  return state.active;
}

export function launchDungeonGame(onExit?: () => void): void {
  if (state.active) return;
  state.active = true;
  // Push this game's tuning, palette and chain-depth reading into the engine.
  // MUST run before anything builds a camera, sprite or the pixel pass — those
  // resolve config at construction, so a late install leaves the first objects
  // built against the engine's neutral defaults (greyscale, default metrics).
  installEngine();
  state.onExitCallback = onExit ?? null;
  // `?seed=<int>` pins the run. runSeed drives the maze, the biome theme and
  // every spawn, so a fixed seed is what makes two screenshots comparable —
  // without it each run builds a different floor and a visual diff is noise.
  // Used by the renderer-migration baselines; harmless in normal play.
  state.runSeed = readSeedParam() ?? (Math.random() * 0x7fffffff) | 0;
  setInputOwner("dungeon-game");
  // Persisted player settings (menu → Settings) land on state BEFORE the pixel
  // pass is built, so createPixelPass below reads the saved look directly.
  applySettingsLive();

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

  // Renderer + pixel pass, and the async-init gate — boot/renderer.ts.
  installRenderer();

  // Scene, fog, lights, VFX, aim decal, camera, monster atlases — boot/scene.ts.
  installScene();

  // Dev/QA hooks + the level-up fanfare — boot/wiring.ts.
  // The lifecycle actions run/ and input/ call back into. Wired BEFORE the dev
  // hooks, which expose several of them to the harness.
  setRunDeps({ startLevel, armFloorLoading, exitDungeonGame });
  const wiringDeps = { spawnReaper, dropBossReward, startLevel, descend, onPlayerDeath, exitDungeonGame };
  installDevWiring(wiringDeps);

  // ── HUD + input ──
  // Dual HUD: the Diablo panel (iso) + the Wolfenstein bar (rampage). mountHUDs
  // builds both and mounts the shared face.
  mountHUDs(state.container);
  state.input = createInput(state.container);
  // ON-SCREEN PAD for phones/tablets. Built only where it is wanted — a mouse
  // user must never get thumb buttons over their game — but `?touch=1` forces
  // it on for testing the layout from a desktop browser.
  const forceTouch = typeof location !== "undefined" && /[?&]touch=1/.test(location.search);
  if (state.container && (forceTouch || isTouchDevice())) {
    touchControls = installTouchControls(state.input.pad, () => state.pixelPass?.sizing() ?? null);
  }

  state.onKeyDown = handleKey;
  window.addEventListener("keydown", state.onKeyDown);

  // Debug/god-mode console (press ` to toggle). State toggles live on `state`;
  // the one-shot actions route through core's private helpers here.
  debugPanelDispose = createDebugPanel(state.container, {
    heal: () => {
      if (!state.player) return;
      state.player.hp = playerMaxHp();
      faceOnHeal();
      rippleGlobe("life");
      state.hudDirty = true;
    },
    addGold: (n) => {
      state.goldRun += n;
      addGold(n, "dungeon-game");
      state.hudDirty = true;
    },
    grantXp: (n) => {
      debugGrantXp(n);
    },
    grantSkillPoints: (n) => {
      state.skillPoints += n;
      state.hudDirty = true;
    },
    fillRampage: () => {
      state.ultCharge = 1;
      state.hudDirty = true;
    },
    killAll: debugKillAll,
    clearEnemies: debugClearEnemies,
    nextFloor: () => {
      if (!state.gameOver) descend();
    },
    // Straight to a floor, up or down — `descend()` is the real game flow
    // (banks coins, grades the floor, opens the tavern) and only ever goes
    // deeper, which made it the wrong verb for a debug floor control.
    gotoFloor: (n: number) => {
      if (state.gameOver || !Number.isFinite(n) || n < 1) return;
      startLevel(Math.floor(n));
    },
    nextBoss: () => {
      if (state.gameOver) return;
      const next = (Math.floor(state.level / BOSS_EVERY) + 1) * BOSS_EVERY;
      startLevel(next);
    },
    spawnReaper: () => {
      if (!state.gameOver && !state.reaperOut) spawnReaper();
    },
    teleportStairs: debugTeleportToStairs,
    spawnRing: debugSpawnRing,
    giveWeapon: (id) => {
      if (!(id in WEAPONS)) return;
      state.weaponSlots[state.activeSlot] = freshWeapon(id as WeaponId);
      state.hudDirty = true;
    },
    applyPotion: (id) => {
      if (id in POTIONS) applyPotion(id as PotionId);
    },
    applyMaterial: (id) => {
      if (isMaterial(id)) applyMaterial(id);
    },
    spawnEnemy: (kind, count) => debugSpawnEnemy(kind as EnemyKind, count),
  });

  // The gameplay callback bus — boot/wiring.ts.
  installGameplayWiring(wiringDeps);

  state.onResize = () => state.pixelPass?.resize();
  window.addEventListener("resize", state.onResize);

  // ── Level 1 ──
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  beginRunLedger();

  // ── Start in the TAVERN lobby ──
  // Multiplayer entry point: you land in the walkable tavern, see whoever else
  // is on the site in real time, and ready up at the plunger gate to drop into
  // the run — solo, or together as a formed party. Descending consumes the
  // session baton (no-op for a solo/offline run), seeds the shared floor, and
  // only THEN starts the dungeon loop on floor 1. (The title intro is no longer
  // the entry — the lobby is; `runPinballIntro` remains available for reuse.)
  // ── Open the pool socket NOW, not when the tavern opens ──
  // Presence used to be started only by the tavern lobby (initTavernPool), which
  // made the CONNECTION owned by a screen rather than the session. Any path that
  // reaches a floor without lingering in the lobby — `?autostart=1`, the playtest
  // bot, __dungeonStartRun — therefore generated its maze before `welcome` had
  // delivered the shared seed, and two such clients got DIFFERENT mazes for the
  // same floor number. Measured: client B booted with poolSeed:null while client
  // A already had one.
  //
  // startPresence is idempotent (it early-returns once installed), so the tavern
  // calling it again is harmless.
  startPresence(getPlayerName());

  // `floor` comes from the tavern: your resume floor (the plunger) or a peer's
  // depth (the join board). Absent = a fresh crawl from the top.
  //
  // ⚠️ WAITS FOR THE POOL SEED. The socket can be OPEN while `welcome` — the
  // message that carries the shared world seed — is still in flight. Generating
  // the floor in that window bakes in a LOCAL random seed, so two players who
  // descend at the same moment get different mazes for the same floor number and
  // walk through each other's walls for the rest of the session. Observed live:
  // a second client booted with `connected: true` but `seed: null`.
  //
  // The wait is bounded and short — a solo/offline player must never be held at
  // a black screen because a backend they aren't using didn't answer.
  const beginRun = (floor?: number): void => {
    if (!state.active) return;
    // Resolved twice (here for the caption, again inside descendInto) because
    // the screen has to name the depth before the build starts. Cheap and pure.
    armFloorLoading(resolveDescendFloor(peers(), loadResumeFloor(), floor), () => {
      if (!state.active) return;
      const target = descendInto(floor);
      state.lastTime = performance.now();
      state.animFrameId = requestAnimationFrame(loop);
      // The seed may still be in flight — re-seed this floor if it disagrees.
      adoptPoolSeedWhenItArrives(target);
    });
  };
  // Dev: skip the lobby and drop straight into floor 1.
  //
  // WHY A HOOK AND NOT A CLICK. The lobby gate is a walk-to-the-plunger
  // interaction in a 3D scene; driving it from a harness means pathing a player
  // to a world position before the run can even start, and a missed approach
  // looks exactly like a broken test. `?autostart=1` (or __dungeonStartRun())
  // is the deterministic entry the playtest bot uses.
  (window as unknown as { __dungeonStartRun?: () => string }).__dungeonStartRun = () => {
    if (state.player) return "run already started";
    closeTavern();
    beginRun();
    return "run started";
  };
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autostart") === "1") {
    // One frame later: enterTavern below has to finish building the lobby
    // before we tear it down, or its teardown runs against a half-built scene.
    requestAnimationFrame(() => {
      closeTavern();
      beginRun();
    });
  }
  enterTavern(state.container, {
    stats: { grade: "-", floor: 0, kills: 0, bestCombo: 0 },
    onDescend: beginRun,
    onAbandon: () => exitDungeonGame(),
    lobby: true, // the entry hall IS the multiplayer lobby
  });
}


/**
 * ── ENTERING A FLOOR ───────────────────────────────────────────────────────
 *
 * `startLevel` is the wrapper every caller already used; `buildLevel` below is
 * the original synchronous build, unchanged. The split exists because the wait
 * on a descent is NOT where it looks like it is.
 *
 * Measured on real hardware (NVIDIA Ampere, WebGPU backend):
 *
 *     buildLevel .................  544 ms
 *     first frame after it ....... 5103 ms   ← the freeze
 *
 * WebGPU compiles a render pipeline per distinct material, lazily, the first
 * time that material is drawn — so a floor's worth of shaders all landed on
 * frame one, with the main thread blocked and nothing on screen. Generating the
 * maze was never the problem, which is why simply putting a progress bar over
 * the generator would have covered a tenth of the wait.
 *
 * So the compile is done DELIBERATELY, in batches, behind the descent screen
 * (`warmFloorPipelines`), and the renderer is held off until it finishes —
 * otherwise the first rendered frame would trigger exactly the compile storm we
 * are trying to schedule. This is the standard loading-screen prewarm: Unity's
 * ShaderVariantCollection.WarmUp and Unreal's PSO precaching do the same thing.
 *
 * `buildLevel` stays SYNCHRONOUS on purpose. Every caller — descendInto, the
 * co-op regroup, the seed-adoption rebuild, __dungeonLevel — relies on the
 * floor existing the moment the call returns; deferring it would run their next
 * lines against the floor being torn down.
 */
function startLevel(level: number): void {
  // A descent that pre-armed the screen (beginRun, the tavern's onDescend) has
  // one up already and it has had a frame to paint. Anything else — a co-op
  // regroup, a seed disagreement, a dev hook — raises it here, accepting that
  // it cannot paint until the synchronous build below lets go of the thread.
  if (!floorLoad && state.container) {
    floorLoad = openFloorLoading(state.container, level);
    renderHeldForLoad = true;
  }
  buildLevel(level);
  const load = floorLoad;
  if (!load) return;
  load.phase("RAISING THE WALLS", 0.3);
  void warmFloorPipelines(load).finally(() => {
    load.close();
    if (floorLoad === load) floorLoad = null;
    renderHeldForLoad = false;
    // The loop has been idle for several seconds; without this the next frame
    // would carry a multi-second delta into the fixed-step accumulator.
    state.lastTime = performance.now();
  });
}

/** The live descent screen, or null when the game is not entering a floor. */
let floorLoad: FloorLoading | null = null;
/** While true the loop simulates and renders nothing — see startLevel. */
let renderHeldForLoad = false;

/**
 * Raise the descent screen and give it a frame to paint BEFORE `then` blocks
 * the thread building the floor. Used by the player-facing entries; without it
 * the overlay is created and then immediately starved of a paint for the whole
 * of `buildLevel`, so the descent still opens on a frozen black screen.
 */
function armFloorLoading(level: number, then: () => void): void {
  if (!state.container) {
    then();
    return;
  }
  floorLoad = openFloorLoading(state.container, level);
  renderHeldForLoad = true;
  // Two frames: one for the browser to lay the overlay out, one for its own
  // canvas loop to draw the first labyrinth frame.
  requestAnimationFrame(() => requestAnimationFrame(then));
}

function buildLevel(level: number): void {
  if (!state.scene) return;

  // Bank any coins still on the old floor BEFORE it's torn down — disposeLevel
  // deletes ground items outright, and a coin deleted before absorb is gold the
  // player earned and never received.
  sweepCoins();
  disposeLevel(); // tears down the previous maze + horde + loot, keeps the player
  disposeBoss(); // drop any Reaper King skulls/telegraph/portal from the old floor
  disposeSecretDoors(); // a half-spun door must not survive into the next floor
  resetJuice(); // a new floor never inherits the previous one's shake/freeze chain

  state.level = level;
  // ── Co-op: adopt the SHARED POOL SEED so every player generates the identical
  // floor/enemy/boss layout. Set before the maze RNG below. No-op solo/offline. ──
  const cs = coopSeed();
  if (cs !== null) state.runSeed = cs >>> 0;
  setCoopFloor(level); // pool presence now filters to this floor
  resetZombieNid(); // per-floor network ids — deterministic across the pool
  resetItemNid();
  resetPickupSweep(); // the knight is about to be teleported to the new spawn
  // Run-scoped, so it must be updated here rather than in the per-floor reset
  // below. `saveBestDepth` no-ops unless this genuinely beats the record.
  if (level > state.runDeepestFloor) state.runDeepestFloor = level;
  saveBestDepth(level);
  const cfg = levelConfig(level);

  // Depth grading: each biome down shifts the fill palette a family over.
  const biome = biomeForSeed(level, state.runSeed);
  tintLights(biome);
  // ...and the STONE changes family with it, not just the light on it. A grade
  // cannot move a quantized palette entry onto a different one, so the masonry
  // painters remap their own three stone tones per biome (maze/build.ts
  // BIOME_STONE). Must run before buildMaze — the textures bake it in.
  setMazeBiome(themeIndexFor(level, state.runSeed));

  // One deterministic stream per (run, level): a refresh mid-run rerolls the
  // run, but a single level is internally consistent and replayable.
  // The mix lives in maze/floor-seed.ts because every peer and a dozen tests
  // must derive it identically — see that file's header.
  const rng = floorRng(state.runSeed, level);
  // FLOOR ARCHETYPE: the macro layout — Warrens / Spine / Great Hall / Cavern /
  // Ring Keep. On the shipping branch it is `arch.track` (a TrackProfile) that
  // does the work; `arch.seeds` shapes the LEGACY grid and nothing else.
  // Cycles every 5 while the biome cycles every 4, so the pair takes 20 floors
  // to repeat.
  const arch = archetypeFor(level);
  // MODIFIER: rolled from this floor's own seed (not a cycle), so two runs at
  // the same depth differ. Scales budgets only — see maze/modifiers.ts.
  const modifier = rollModifier(level, rng);
  // WINDINESS is the archetype's texture knob now, rolled inside its own range
  // rather than read off a flat depth cycle — two Caverns twenty floors apart
  // used to share a corridor character exactly. cfg.windiness stays as the
  // level-1 anchor and the fallback for callers that don't know the archetype.
  const windiness = windinessFor(level, arch, rng);
  // A grade-S/A descent unlocked a BONUS room on this floor (Wave F glue).
  const bonusRoom = state.bonusRoomNext;
  state.bonusRoomNext = false;
  // The floor's THEME. Not a prefab-only concept, whatever its module name
  // suggests: `theme.deal` orders the part kinds decorateMaze reaches for and
  // `theme.enemies` biases the horde (spawn/factory.ts), and both of those ship
  // on every floor. Only the prefab POOLS — `theme.pool` / `theme.landmarks` —
  // are legacy-branch-only. Consumes no rng: it is a hash of (level, runSeed).
  const theme = themeFor(level, state.runSeed);
  // ── TRACK-FIRST base grid ────────────────────────────────────────────────
  //
  // The floor's main artery used to be DERIVED from the random maze: carve a
  // maze, trace a path through it, widen that path. So the "track" inherited
  // every wiggle and dead-end the maze happened to produce — curves landed
  // where a gap existed rather than where the ball goes (the ramp fragments
  // pointing nowhere), and there was nowhere to put a real curve at all
  // (artery-banks censused 22,713 open tiles: 81.8% have an open radius of
  // ZERO; radius-4 fillets fitted 4 times across 40 floors).
  //
  // Now the circuit is GROWN FIRST — slime-mould flow reinforcement, so it is
  // naturally loopy and different every level — and the maze grows into what's
  // left, tying in at on-ramps. Corner radius becomes an input we allocate
  // rather than an output we scavenge. See maze/track-floor.ts.
  //
  // It generates at FINAL tile resolution, so it replaces `thickenWalls` too;
  // the fallback path below still thickens, which is why `grid` is assigned
  // from one branch or the other rather than being a single expression.
  //
  // THE ARCHETYPE REACHES THE LIVE FLOOR HERE, and until this line it did not.
  // `arch.seeds` shapes the legacy grid, and on a track floor that grid is
  // never built — so the five archetypes were shaping a floor nobody saw while
  // the descent card below announced them by name (a blind census over 6 seeds
  // × 10 depths could not tell them apart on any statistic). `arch.track` is
  // the profile that makes the name true: node layout, loop floor, lane width,
  // plaza, and how much maze surrounds the circuit. Windiness rides along as
  // the surrounding maze's growing-tree bias — the same knob it always was, now
  // on the branch that ships. Clamped: at 1.0 the surround is a pure
  // backtracker with no junctions at all, and at 0 it is all junctions and no
  // corridor.
  const track = TRACK_FIRST
    ? buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
        profile: arch.track,
        density: Math.max(0.35, Math.min(0.85, windiness)),
      })
    : null;
  let grid: Grid;
  let endpoints: { start: TilePos; stairs: TilePos } | null;
  // Room rects and prefab anchors are authored in HALF-SCALE cell coords and
  // scaled ×2 onto the thickened grid — a shape only the legacy branch has. A
  // track floor is generated at final resolution from its own geometry and
  // ships neither; decorateMaze's own sparse-region fill covers it. They
  // default EMPTY so the track branch cannot accidentally point decoration at
  // furniture that was never carved.
  let rooms: Array<{ i0: number; j0: number; w: number; h: number }> = [];
  let anchors: PrefabAnchor[] = [];
  if (track) {
    grid = track.grid;
    // Exposed to the running game via `__dungeonDoorways()` — see state.doorways.
    state.doorways = track.doorways;
    // Both endpoints sit ON the circuit and a lap apart, so the route between
    // them RIDES the track instead of treating it as scenery between errands.
    endpoints = { start: track.start, stairs: track.stairs };
  } else {
    // ── THE LEGACY FALLBACK, BUILT ONLY WHEN IT IS ACTUALLY USED ───────────
    //
    // All of this — the growing-tree maze, its rooms, the landmark set piece,
    // the focus zones, the prefab stamps and the half-scale secret cracks —
    // used to run UNCONDITIONALLY, above the `buildTrackFloor` call, and then
    // be thrown away by `track ? [] : …` a few lines further down. Measured
    // over 400 floors across 5 archetypes × 10 depths: `buildTrackFloor`
    // returned null 0 times, so the entire block was discarded on 100% of
    // floors while five test files exercised it and read as coverage.
    //
    // It is NOT deleted, because it is a genuine fallback: `buildTrackFloor`
    // returns null when the flow network degenerates to no edges or no legs,
    // and a floor that fails to generate is worse than a plain maze. It is
    // moved HERE so the code says which of the two it is. The measured cost of
    // running it eagerly was small (1.8 ms against 109 ms of track growth, 1.6%
    // of generation) — the reason to move it is that a pass computed on every
    // floor and used on none is indistinguishable from a pass that ships.
    //
    // Corridors, then ROOMS carved over them (bumper chamber / speedway /
    // arena / vault), then a few CRACKED secret walls — all on the raw grid,
    // all before thickening, so the wall-band structure survives. Thick walls
    // are what make the Diablo low-rim/tall-back trick work — see
    // thickenWalls. Decoration runs on the thickened grid, with room rects
    // scaled to match.
    const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
      seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
      solidSeeds: arch.solid,
      braidGradient: arch.braidGradient,
    });
    const rawRooms = carveRooms(raw, rng, cfg.rooms + (bonusRoom ? 1 : 0), ROOM_MIN_CELLS, ROOM_MAX_CELLS);
    // PREFAB STAMPS (Wave C): themed room/hallway shapes drawn from a seeded
    // shuffle bag — Slalom, Gauntlet, Oilworks, the Magician's Parlor… Carved
    // before the secret cracks so the cracks see the final wall set.
    //
    // The floor's ONE set piece goes down FIRST, with priority and a wide
    // mortar: the Tilt Table, the Pachinko Drop, the Observatory… Regular
    // stamps then fill in around it, clustered on this floor's hot zones so the
    // level has loud rooms and quiet halls instead of an even sprinkle.
    const landmark = stampLandmark(raw, rng, theme);
    const focus = pickFocusCells(raw, rng);
    // More open-chamber prefabs per floor (Slice 2, open playfield) — the theme
    // pools are mostly open tables/halls, so this adds bounce-able area.
    const prefabCount = Math.min(3 + Math.floor((level - 1) / 2), 6);
    const stamped = stampPrefabs(raw, rng, prefabCount, theme, landmark.claimed, focus);
    crackSecretWalls(raw, rng, cfg.secrets);
    grid = thickenWalls(raw);
    // Widen the main start→stairs artery into a 3-wide "launch highway" so the
    // floor plays as a machine and not a uniform 2-wide box maze. Reachability-
    // preserving (only carves wall→floor); runs BEFORE decorate so every stage —
    // topology/parts/arc-corners/render — sees the widened grid.
    // START + STAIRS are chosen ONCE here and shared by both the artery widener
    // and decorateMaze. Both used to derive them independently with the same
    // "top-left tile → farthest tile" rule, which put the exit in the
    // bottom-right corner of every floor; see pickEndpoints.
    state.doorways = []; // the legacy maze has no section plan
    endpoints = pickEndpoints(grid, rng);
    if (endpoints) widenMainArtery(grid, endpoints);
    rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
    // Prefab anchors ride the same ×2 into the thickened grid — the landmark's
    // first, so its set-piece furniture wins any tile the regular stamps also want.
    anchors = [...landmark.anchors, ...stamped.anchors].map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
  }
  // ── SECRET BANDS, on the grid the player will actually stand on ──────────
  //
  // `crackSecretWalls` above ran on `raw` — the HALF-SCALE grid, on the
  // understanding that `thickenWalls` doubles each mark into the 2×2 band the
  // rest of the game assumes. A track floor does neither: it generates at final
  // resolution and DISCARDS `raw`. So on the shipping path every one of those
  // 4-10 bands was thrown away, and the only cracks a player ever met were the
  // incidental ones `openLaunchTargets` leaves while repairing launcher runways
  // — measured, 3 bands across 25 consecutive floors.
  //
  // The smash-through payoff, its loot, the speed witch and the revolving door
  // were all unreachable on roughly nine floors in ten because of it.
  //
  // Stamped HERE, between geometry and decoration, deliberately: the walls are
  // final (so a band is never cracked into a curve that a later pass reshapes)
  // and `decorateMaze` has not yet run its secrets scan, so the bands are picked
  // up by the existing plumbing with nothing else to change.
  if (track) {
    stampSecretBands(grid, rng, cfg.secrets, {
      // The plunger lane commits you by design; a secret door in its side wall
      // is the same defect as any other hole in it (track-launch.test.ts).
      avoid: (i, j) => nearSealed(grid, track.mask, i, j),
    });
  }
  // Pinball-machine density grows with depth AND rides the floor's actual area
  // — the 4× floors change scaled zombies/torches/rooms but left this an
  // absolute cap, spreading 26 parts over ~26k late-game tiles (the "sparse"
  // read). The area term keeps parts-per-tile roughly constant as floors grow;
  // decorateMaze's sparse-region fill then guarantees no quadrant ships empty.
  // ── THE GRID IS FINAL HERE, SO THE BUDGETS RIDE THE REAL AREA ───────────
  //
  // Every wall-moving pass has run (buildTrackFloor owns them all on the track
  // branch, widenMainArtery on the legacy one) and decorateMaze writes only the
  // stairs tile, so this count is the floor's actual walkable area. Until now
  // the budgets rode `cfg.floorTiles`, an estimate measured at **3.2x too big**
  // over 64 live floors — which is why the zombie and torch caps bound on every
  // floor from level 1 and their depth ramps were dead code.
  //
  // Deterministic and rng-free: the grid is a pure function of (runSeed, level),
  // so two co-op peers count the same number without exchanging anything.
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;
  // The floor modifier scales the budgets (and only the budgets — it can't
  // reach connectivity). Every product is floored at a sane minimum so a harsh
  // roll can't produce a pitch-dark or furniture-free floor.
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(budget.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(budget.torches * modifier.torchMult)),
    Math.max(4, Math.round(partBudget * modifier.partMult)),
    rooms,
    {
      anchors,
      // A modifier biases WHICH furniture the corridor pass reaches for first.
      deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
      targets: TARGETS_PER_FLOOR,
      trapdoors: Math.round(TRAPDOORS_PER_FLOOR * modifier.trapdoorMult),
      vaultRamps: VAULT_RAMPS_PER_FLOOR, // ramps aimed ACROSS a band, so the hop jumps the maze
      hazards: Math.round(Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX) * modifier.hazardMult),
      forceVault: bonusRoom, // a grade-unlocked bonus floor guarantees a vault
      launchBreaks: cfg.launchBreaks, // A1 — smashable walls at launch-runway ends, scaled by depth
      bonusItems: modifier.bonusItems,
      endpoints: endpoints ?? undefined,
      // On a TRACK floor the geometry is generated, not authored, so a vault or
      // spine part facing a wall carries no intent worth preserving — re-aim it
      // or demote it to a bumper. The legacy generator keeps the exemption (its
      // set-pieces really are authored, and its spine boosters carry a
      // down-flow contract the re-aim would break).
      strictLaunchers: !!track,
      // The plunger lane, when the track layer managed to fit one. decorate
      // keeps every other kind of content out of it and lays its boosters.
      chute: track?.chute ?? null,
      // The island is geometry the maze layer built; decorate only flanks it.
      orbit: track?.orbit ?? null,
      // WALL GEOMETRY IS FINISHED. On a track floor every curved-wall family —
      // the circuit's fillets, the arc sweeps, the orbit island and the artery
      // banks — is authored by `buildTrackFloor` before decorate is called, so
      // decorate places content into finished geometry instead of building more
      // of it. The legacy branch passes nothing and keeps its own bank pass.
      wallsAuthored: !!track,
      floor: level, // ITEM RARITY is depth-biased — see rollItemRarity
    },
  );

  // A band whose corridor decorate then walled off is a smash that opens a
  // pocket — reverted to plain stone rather than shipped as a lie. Both tile
  // types are solid, so nothing about reachability moves. See pruneSealedBands.
  pruneSealedBands(grid, plan.secrets);

  // ── LIGHT PUZZLE: scatter braziers + seal a loot vault (maze/lamp-puzzle).
  // Author it here (before parts are built) so the lamp spots ride the SAME
  // createPinballParts pass. `occupied` = everything already placed, so a
  // brazier/vault never lands on a spawn, item, part, torch or the endpoints. ──
  const puzzleOccupied = new Set<string>();
  const markOcc = (t: { i: number; j: number } | null | undefined): void => {
    if (t) puzzleOccupied.add(`${t.i},${t.j}`);
  };
  markOcc(plan.start);
  markOcc(plan.stairs);
  plan.parts.forEach(markOcc);
  plan.spawns.forEach(markOcc);
  plan.items.forEach(markOcc);
  plan.props.forEach(markOcc);
  plan.torches.forEach(markOcc);
  const lampPuzzlePlan = authorLampPuzzle(grid, plan.start, (i, j) => puzzleOccupied.has(`${i},${j}`), rng, lampCountFor(level));
  if (lampPuzzlePlan) plan.parts.push(...lampPuzzlePlan.lamps);

  // ── SURFACES ── what the floor is MADE of (engine/surfaces.ts). Runs on the
  // FINAL grid — after topology, shapes, cracks, prefabs and the lamp puzzle —
  // because it only rewrites materials and must see the walls that survived.
  //
  // Seeded off (runSeed, level) but through its OWN derived stream inside
  // paintSurfaces, NOT off `rng`: taking draws from the shared stream here
  // would shift every later call and reroll the layout of every existing
  // floor. This is the standing rule for new generation behaviour
  // (ROUTE_MATH_PLAN Part 8) and it is why floors are bit-identical today.
  const surfaceSeed = (state.runSeed ^ (level * 0x85ebca6b)) >>> 0;
  // The arrival tile and the exit stay baseline: mud underfoot on spawn reads
  // as broken controls, and terrain that steals the stairs is just a tax.
  const surfaceSafe = [tileCenter(grid, plan.start.i, plan.start.j), tileCenter(grid, plan.stairs.i, plan.stairs.j)];
  paintSurfaces(grid, surfaceSeed, {
    mix: modifier.surfaceMix,
    coverage: modifier.surfaceCoverage,
    safeSpots: surfaceSafe,
  });
  // ── THE SECOND AUTHOR ── the modifier above is WEATHER: it rolls on 45% of
  // floors from level 3 and paints uniformly at random, which left the surface
  // matrix — the one mechanic this game has that nothing else does — unable to
  // hear anything a floor's SHAPE had to say. `paintBands` lets the archetype
  // state what its launch district, machine core and drain lane are made of,
  // zoned on the same distance-from-spawn bands `decorateMaze` has picked room
  // archetypes from since Slice 9, so the material and the furniture describe
  // one floor instead of two.
  //
  // SECOND, deliberately: the modifier is the announced once-in-a-while event
  // and the zoning is the floor's permanent character, so the zoning is what
  // shows through on top. Its own derived stream again, and it writes only
  // `Grid.surfaces` — flipping SURFACE_BANDS leaves every floor's GEOMETRY
  // byte-for-byte identical, which floor-pipeline.test.ts asserts both ways.
  if (SURFACE_BANDS && arch.track.bands) {
    paintBands(grid, surfaceSeed, plan.start, arch.track.bands, surfaceSafe);
  }

  state.grid = grid;
  // Fresh fog every floor — the grid's dimensions change with depth, and
  // carrying exploration across a descent would be a spoiler.
  state.fog = createFog(grid);
  state.stairs = plan.stairs;
  // Keep the archetype rooms — everything else on `plan` is consumed while
  // building the floor, but the map wants to label these and they were being
  // dropped with the local.
  state.levelRooms = plan.rooms.map((r) => ({ i0: r.i0, j0: r.j0, w: r.w, h: r.h, kind: r.kind }));
  // Curved walls: bank every qualifying maze corner, minus tiles a pinball
  // part already owns (a deflector there banks on its own — no double-dip).
  const partTiles = new Set(plan.parts.map((q) => `${q.i},${q.j}`));
  state.arcCorners = computeArcCorners(grid).filter((a) => {
    const t = worldToTile(grid, a.cx, a.cz);
    return !partTiles.has(`${t.i},${t.j}`);
  });
  state.maze = buildMaze(state.scene, grid, plan, state.arcCorners);
  createPinballParts(plan.parts, grid, state.scene);
  // The braziers are now built; raise the sealed vault chest they open.
  if (lampPuzzlePlan) installLampPuzzle(lampPuzzlePlan, grid, state.scene);

  // ── Player ──
  const startPos = tileCenter(grid, plan.start.i, plan.start.j);
  state.levelStart = { x: startPos.x, z: startPos.z }; // where a pit spits you back
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
    state.player.hp = playerMaxHp(); // legacy hearts land at creation
    state.playerArtKey = lookKey(weaponId, lookFromGear(state.gear));
  } else {
    state.player.x = startPos.x;
    state.player.z = startPos.z;
    state.player.attackT = -1;
  }
  state.player.anim.setFacing("S");
  state.player.anim.play("idle", { force: true });
  syncActorMesh(state.player);
  // Clear movement smoothing + HUD meter cache so a new/re-entered level
  // doesn't inherit sprint momentum or a stale meter block count.
  resetPlayerMotion();
  meterBlocksShown = -1;

  // ── Horde: a shambling baseline mixed with the special families as depth
  // grows — spiders (fast), brutes (tanks) and spitters (ranged). Each spawn
  // deterministically rolls a kind by hash so a run+level is reproducible. ──
  state.zombies = plan.spawns.map((s, si): Zombie => {
    const hash = ((s.i * 73856093) ^ (s.j * 19349663) ^ (level * 83492791) ^ si) >>> 0;
    const pos = tileCenter(grid, s.i, s.j);
    return spawnHordeMember(hash, pos.x, pos.z, cfg.zombieSpeed, level);
  });

  // ── D4 THE PLUNGER: every floor OPENS parked in a launch chute you PULL ──
  // A real pinball machine starts by drawing the plunger back and firing the
  // ball into play. The knight is parked; the player holds the dodge key to pull
  // back (power builds), ←/→ steer the launch line ±30°, release fires. We only
  // ARM it here (base aim + skill target); the pull/release + launch live in the
  // player update (updatePlunger). Aim the base line at the nearest scoring part
  // so a full pull straight down the lane lands a SKILL SHOT.
  {
    const p = state.player;
    // On a chute floor the skill target must be REACHABLE BY THE LAUNCH — the
    // launch line is the chute's axis and steering is capped at
    // PLUNGER_AIM_MAX, so a target off to the side is a skill shot you cannot
    // take however well you pull. Require it to sit ahead down the lane
    // (a generous cone, since the target lives out in the playfield past the
    // mouth); with no chute the old nearest-part rule stands unchanged.
    const chuteDir = track?.chute ?? null;
    const skillPart = state.pinballParts
      .filter((q) => q.kind === "target" || q.kind === "bumper" || q.kind === "rollover")
      .map((q) => ({ q, d: Math.hypot(q.x - startPos.x, q.z - startPos.z) }))
      .filter((e) => e.d > 4 && e.d < PLUNGER_SKILL_RANGE)
      .filter((e) => {
        if (!chuteDir) return true;
        const ax = (e.q.x - startPos.x) / e.d;
        const az = (e.q.z - startPos.z) / e.d;
        return ax * chuteDir.dirI + az * chuteDir.dirJ > 0.8;
      })
      .sort((a, b) => a.d - b.d)[0]?.q;
    if (p) {
      // Base launch line, in priority order:
      //
      //  1. STRAIGHT DOWN THE CHUTE, when the floor has one. This is the whole
      //     point of the lane — the plunger fires along the hallway, and ←/→
      //     steer only within PLUNGER_AIM_MAX of it. Aiming at a scoring part
      //     instead (which is what shipped) would point the launch diagonally
      //     into the chute's own wall, since the chute is sealed by design.
      //  2. Else the nearest scoring part, so a full pull still lands a skill
      //     shot on a floor where no chute fitted.
      //  3. Else straight at the stairs.
      let dx = 0;
      let dz = 1;
      const chute = track?.chute ?? null;
      if (chute) {
        // Tile deltas ARE world deltas here — both axes map straight through
        // tileCenter — so the chute's cardinal is already the launch vector.
        dx = chute.dirI;
        dz = chute.dirJ;
      } else if (skillPart) {
        dx = skillPart.x - p.x;
        dz = skillPart.z - p.z;
      } else if (state.stairs) {
        const c = tileCenter(grid, state.stairs.i, state.stairs.j);
        dx = c.x - p.x;
        dz = c.z - p.z;
      }
      const dl = Math.hypot(dx, dz) || 1;
      state.plungerBaseX = dx / dl;
      state.plungerBaseZ = dz / dl;
      state.plungerSkill = skillPart ? { i: skillPart.i, j: skillPart.j } : null;
      state.plungerArmed = true;
      state.plungerCharging = false;
      state.plungerPower = 0;
      state.plungerAim = 0;
      p.momSpeed = 0;
    }
  }

  // ── EVERY floor's exit is boss-gated: the REAPER KING guards the stairs ──
  // (Live QA ask: "a boss at the end to get to the next level, even solo".)
  // The king (boss.ts) is a killable reaper-art brute with an orbiting skull
  // ring + a telegraphed tentacle slam; while it lives `state.exitLocked` holds
  // the stairs shut, and its death blooms the exit PORTAL. HP scales with the
  // floor; every BOSS_EVERY-th floor is a MEGA king at double HP. Only spawns
  // for the floor authority — a replica renders the streamed king.
  if (state.stairs && state.scene && state.player && !isReplica()) {
    const mega = level % BOSS_EVERY === 0;
    const bhp = Math.round((KING_HP_BASE + KING_HP_PER_FLOOR * (level - 1)) * (mega ? 2 : 1));
    const spot = nearestOpenTile(grid, state.stairs.i, state.stairs.j, 2) ?? state.stairs;
    const speed = cfg.zombieSpeed * BOSS_SPEED_FACTOR;
    spawnBoss(grid, spot, bhp, (x, z, hp) => {
      const b = makeZombie(reaperSheet(), x, z, speed, { kind: "brute", hp, boss: true, maxHp: hp });
      state.zombies.push(b);
      return b;
    });
  }

  // ── Loot on the floor ──
  state.groundItems = plan.items.map((it, k): GroundItem => {
    const sprite = createStaticSprite(ITEM_PAINTS[it.id]);
    const pos = tileCenter(grid, it.i, it.j);
    sprite.mesh.position.set(pos.x, 0, pos.z);
    state.scene!.add(sprite.mesh);
    return { nid: "L" + k, kind: it.kind, id: it.id, x: pos.x, z: pos.z, sprite, bobPhase: k * 1.7, rarity: it.rarity };
  });

  // ── R&D: seed the three marble materials near the floor-1 spawn so the whole
  // system is always testable without hunting a vault (toggle in the ` panel). ──
  if (level === 1 && state.dbgMaterialFloor1Spawn && state.scene && state.player) {
    const pt = worldToTile(grid, state.player.x, state.player.z);
    MATERIAL_LIST.forEach((m, i) => {
      // minRing staggers each marble into its own distance shell (4/7/10 tiles
      // out) — nearestOpenTile's `n` is an ORDINAL, so without minRing all
      // three land in the ring right on top of the spawn.
      const spot = nearestOpenTile(grid, pt.i, pt.j, 1 + i, 4 + i * 3) ?? pt;
      const c = tileCenter(grid, spot.i, spot.j);
      const sprite = createStaticSprite(ITEM_PAINTS[m]);
      sprite.mesh.position.set(c.x, 0, c.z);
      state.scene!.add(sprite.mesh);
      state.groundItems.push({ kind: "material", id: m, x: c.x, z: c.z, sprite, bobPhase: i * 2 });
    });
  }

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

  // ── CORPSE PILES ── everything you dropped here on a previous death.
  spawnCorpsePiles(grid, level);

  // ── BOWLING PIN CREWS ── racked around far spawn tiles from PIN_FROM_LEVEL.
  if (level >= PIN_FROM_LEVEL && plan.spawns.length > 0) {
    const crews = 1 + (level >= 5 ? 1 : 0);
    for (let c = 0; c < crews; c++) {
      const centre = plan.spawns[Math.floor(rng() * plan.spawns.length)];
      spawnPinCrew(grid, centre);
    }
  }

  // ── BOSS ANTECHAMBER ── from depth 3 (non-boss floors), the stairs are a
  // real set piece: a carom ARENA (bumpers ringed round the exit) guarded by a
  // brute pack, with a guaranteed prize so clearing it pays. The run's last leg
  // is always a fight-or-flight, and the bumpers make it a PINBALL fight.
  // ⚠️ IT USED TO SKIP `level % BOSS_EVERY === 0` — i.e. EVERY MEGA-BOSS FLOOR.
  //
  // Floor 5 is the first of them, and live QA reported its boss fight as "a
  // jumbled mess". It was the one floor in five that got a DOUBLE-HP king
  // (core.ts doubles his health on exactly this cadence) in bare corridor with
  // no bumper ring, no brute guard and no prize — the set piece was withheld
  // from precisely the floors built around a set-piece fight. The likely
  // original reasoning is that the king IS the set piece there, but the two do
  // not compete: the ring is what makes the arena read as an arena, and the
  // king now has a hall to fight in (maze/track-floor.ts carveBossChamber).
  // `state.bruteSheet` used to be part of this condition. It could never be
  // false when every atlas was built up front — but with lazy atlases it would
  // have deleted the whole exit arena on any floor the backfill hadn't reached
  // the brute yet. The sheet is fetched below, where it is used.
  if (level >= 3 && state.stairs && state.scene) {
    const s = state.stairs;
    // A ring of bumpers around the exit — carom off them mid-brawl.
    //
    // ── IT ASKS THE MAZE FOR SPACE INSTEAD OF STAMPING FIXED OFFSETS ──
    //
    // The offsets were hard-coded at radius 2 and filtered by `isWalkable`, so a
    // tight exit silently shipped two bumpers instead of six and the "arena"
    // read as a couple of stray props. Now it walks outward: take the first
    // radius that can seat most of the ring, so a King's Hall gets a full wide
    // circle and a cramped legacy floor still gets the best ring it can hold.
    const ringSpots: Array<{ i: number; j: number }> = [];
    for (const r of [3, 2, 4]) {
      const offs: Array<readonly [number, number]> = [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [r - 1, r - 1],
        [-(r - 1), -(r - 1)],
        [r - 1, -(r - 1)],
        [-(r - 1), r - 1],
      ];
      const fit = offs.filter(([di, dj]) => isWalkable(grid, s.i + di, s.j + dj)).map(([di, dj]) => ({ i: s.i + di, j: s.j + dj }));
      if (fit.length >= 6 || (r === 4 && fit.length > ringSpots.length)) {
        ringSpots.length = 0;
        ringSpots.push(...fit);
        if (fit.length >= 6) break;
      } else if (fit.length > ringSpots.length) {
        ringSpots.length = 0;
        ringSpots.push(...fit);
      }
    }
    createPinballParts(
      ringSpots.map((r) => ({ i: r.i, j: r.j, kind: "bumper" as const, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 })),
      grid,
      state.scene,
    );
    // The brute guard — scales a touch with depth.
    const guards = 2 + Math.floor((level - 3) / 3);
    for (let n = 1; n <= guards; n++) {
      const spot = nearestOpenTile(grid, s.i, s.j, n + 1);
      if (!spot) break;
      const c = tileCenter(grid, spot.i, spot.j);
      state.zombies.push(makeZombie(sheetFor("brute"), c.x, c.z, cfg.zombieSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" }));
    }
    // A guaranteed prize on the exit's doorstep (gold idol + a heal).
    const prizeSpot = nearestOpenTile(grid, s.i, s.j, 1);
    if (prizeSpot) {
      for (const [id, dx] of [["gold", -0.4], ["health", 0.4]] as const) {
        const sprite = createStaticSprite(ITEM_PAINTS[id]);
        const c = tileCenter(grid, prizeSpot.i, prizeSpot.j);
        sprite.mesh.position.set(c.x + dx, 0, c.z);
        state.scene.add(sprite.mesh);
        state.groundItems.push({ nid: nextItemNid(), kind: "potion", id, x: c.x + dx, z: c.z, sprite, bobPhase: Math.random() * 6 });
      }
    }
  }

  // ── The ORACLE FROG's dead-end perch ──
  if (plan.frog) spawnFrog(plan.frog.i, plan.frog.j);

  // ── The ROLLING CART MERCHANT — one per floor from its depth, parked a
  // few tiles out from the start so you spot it early and give chase. ──
  if (level >= MERCHANT_FROM_LEVEL) {
    // Genuinely out in the floor, not on the doorstep: spawning it a tile away
    // put it inside MERCHANT_FLEE_RANGE at t=0, so it bolted before you ever
    // saw it. Its bell (updateMerchant) is what leads you to it now.
    const spot = nearestOpenTile(grid, plan.start.i, plan.start.j, 3, MERCHANT_SPAWN_MIN_RING) ?? plan.start;
    spawnMerchant(spot.i, spot.j);
  }

  // ── Per-floor score ledger + the Death Dealer's fuse ──
  state.levelT = 0;
  state.levelStartKills = state.kills;
  // ── ARPG PACKS along the fast lanes ──
  // The spine (the connected booster route down the artery) is where the run
  // moves at pinball speed — exactly where an ARPG wants its monster packs, so
  // ripping through at speed means ripping THROUGH something. 2-3 enemies
  // cluster near ~half the spine stations, capped relative to the base horde.
  // Seed-deterministic (floor rng) so every co-op client builds the same packs.
  {
    const spineParts = plan.parts.filter((pt) => pt.spine);
    const packCap = Math.min(38, Math.ceil(state.zombies.length * 0.6));
    let packAdded = 0;
    for (const pt of spineParts) {
      if (packAdded >= packCap) break;
      if (rng() > 0.65) continue;
      const packSize = 2 + Math.floor(rng() * 2);
      for (let n = 0; n < packSize && packAdded < packCap; n++) {
        const spot = nearestOpenTile(grid, pt.i, pt.j, 1 + Math.floor(rng() * 5), 2);
        if (!spot) continue;
        const c = tileCenter(grid, spot.i, spot.j);
        state.zombies.push(spawnHordeMember((rng() * 0xffffffff) | 0, c.x, c.z, cfg.zombieSpeed, level));
        packAdded++;
      }
    }
    // Plaza packs: the polish pass stamped bumper diamonds into big empty
    // rooms and reported their centres — garrison each one (3-4 enemies), so
    // a plaza is a bounce-pattern ARENA, never dead space.
    for (const pz of plan.plazas) {
      const packSize = 3 + Math.floor(rng() * 2);
      for (let n = 0; n < packSize; n++) {
        const spot = nearestOpenTile(grid, pz.i, pz.j, 1 + Math.floor(rng() * 5), 1);
        if (!spot) continue;
        const c = tileCenter(grid, spot.i, spot.j);
        state.zombies.push(spawnHordeMember((rng() * 0xffffffff) | 0, c.x, c.z, cfg.zombieSpeed, level));
      }
    }
  }

  state.levelHordeSize = state.zombies.length;
  state.levelBestCombo = 0;
  state.levelFlowSum = 0;
  state.levelFlowT = 0;
  state.levelHitsTaken = 0;
  state.jackpots = 0;
  state.reaperOut = false;
  state.reaperWarned = false;
  // Wave A/E/F floor state: the target objective, the frenzy meter, the
  // Magician's visit clock, the once-per-floor witch.
  state.targetsTotal = plan.parts.filter((pt) => pt.kind === "target" && pt.bank === undefined).length;
  state.targetsHit = 0;
  state.partComboHits = 0;
  state.frenzyPaid = false;
  state.freezeT = 0;
  state.magicianT = rollMagicianClock();
  state.witchSpawned = false;
  state.frogTrail = [];
  // D2-D5 per-floor table state: laps, lane banks, the skill shot and the
  // named-combo ledger all belong to ONE floor.
  state.orbitActive = -1;
  state.orbitLast = -1;
  state.orbitCount = 0;
  state.orbitT = 0;
  state.orbitLaps = 0;
  state.laneLit = {};
  state.lanesCleared = 0;
  state.skillArmed = false;
  state.skillT = 0;
  state.skillTarget = null;
  state.shotChain = [];
  state.namedPaid = {};
  state.crackHintShown = false;
  state.stairsHintShown = false;

  // Announce the depth AND the biome — descending reads as entering a new place.
  // A boss floor gets an ominous warning instead of the usual flavour line.
  const cycle = Math.floor((level - 1) / BIOMES.length) + 1;
  const suffix = cycle > 1 ? ` · deeper (${cycle})` : "";
  // The archetype names the SHAPE the player is about to walk into, so a Great
  // Hall or a Cavern reads as intentional rather than as the maze glitching.
  const shape = arch.id === "warrens" ? "" : ` · ${arch.label}`;
  // Biome flavour keeps the chapter feel; the archetype line is appended only
  // when the floor's shape is actually unusual, so level 1 reads as it always did.
  const flavour = arch.id === "warrens" ? biome.flavour : `${biome.flavour} · ${arch.flavour}`;
  const sub = level % BOSS_EVERY === 0 ? "☠ a MEGA REAPER KING guards the stairs ☠" : `${flavour}${suffix}`;
  showToast(`DEPTH ${level} — ${biome.name.toUpperCase()}${shape.toUpperCase()}`, sub);
  // Arrival sting. Paired with the toast rather than the geometry build so the
  // sound and the card land together.
  sfxLevelStart();
  if (level % BOSS_EVERY === 0) sfxBossReveal();
  // A modifier MUST be announced — an unannounced one reads as a bug, not a twist.
  if (modifier.id !== "none") {
    showPickupNote(`⚠ ${modifier.label.toUpperCase()} — ${modifier.flavour}`);
    sfxModifier();
  }
  if (bonusRoom) showPickupNote("🏆 BONUS VAULT unlocked on this floor");

  // Fingerprint what this build authored, BEFORE the player gets a frame to
  // disturb it. This is the gate for decomposing buildLevel: its ~20 phases
  // share one RNG stream, so reordering any two draws silently produces a
  // different floor that renders fine and breaks no test. See
  // dev/floor-census.ts and scripts/floor-census.mjs.
  captureFloorCensus();
}

















/**
 * The floor's FLOW: the time-weighted average of the momentum ramp over the
 * floor, in 0..1. Exported shape for the HUD and the descent card.
 */
/**
 * True while ANY modal surface owns the screen: the merchant shop, the DOM
 * tavern, the walkable tavern scene, the card reader, or the in-game menu.
 * This is THE pause contract — `simulate` early-returns on it, and `loop`
 * books the elapsed wall-clock into `state.pausedRunS` so the leaderboard's
 * run duration doesn't count time spent reading.
 */
export function isSimPaused(): boolean {
  return state.uiPauses || isTavernSceneOpen();
}

/** One 60Hz simulation step. */
function simulate(dt: number): void {
  const p = state.player;
  const g = state.grid;
  // The Gamepad API is PULL-ONLY — it never fires an event for stick movement —
  // so a pad has to be sampled every step, ahead of everything that reads the
  // input. Cheap and a no-op when nothing is plugged in.
  state.input?.poll();
  if (state.gameOver || !p || !g || !state.input) return;
  // Shop, tavern (both forms), card reader and menu all pause the world.
  if (isSimPaused()) return;

  // ── The floor clock: feeds the grade's pace axis and the Death Dealer. ──
  state.levelT += dt;
  // FLOW — the grade's pace axis. Integrate the momentum ramp over sim time, so
  // "pace" measures the speed you actually CARRIED rather than the stopwatch.
  // A brisk walk integrates to ~0; a floor ridden at terminal speed to ~1.
  state.levelFlowSum += momentumT(p.momSpeed) * dt;
  state.levelFlowT += dt;
  if (p.bounceCombo > state.levelBestCombo) state.levelBestCombo = p.bounceCombo;
  // Run-scoped twin of the line above — levelBestCombo is wiped every descent,
  // so without this the leaderboard would only ever see the FINAL floor's combo.
  if (p.bounceCombo > state.runBestCombo) state.runBestCombo = p.bounceCombo;
  if (!state.reaperWarned && state.levelT >= REAPER_AFTER - REAPER_WARNING) {
    state.reaperWarned = true;
    showToast("A COLD WIND RISES", "something is coming — find the stairs");
  }
  if (!state.reaperOut && state.levelT >= REAPER_AFTER) {
    spawnReaper();
  }

  // ── Flow field — one BFS serves the whole horde, every FLOW_INTERVAL ──
  state.flowTimer -= dt;
  if (state.flowTimer <= 0) {
    state.flowTimer = FLOW_INTERVAL;
    const pt = worldToTile(g, p.x, p.z);
    state.flowField = hordeFlowField(g, pt.i, pt.j); // snapped seed; RETAINED across frames
  }

  // ── Buff timers tick down; HUD refreshes each whole second so the
  // countdown reads live, plus once more when a buff ends. ──
  for (const key of ["rageT", "hasteT", "shieldT", "ironT", "turboT", "springT", "curveT", "magBootsT", "venomCoatT", "stoneT", "staticT", "greedT", "regenT"] as const) {
    const before = p[key];
    if (before <= 0) continue;
    p[key] = Math.max(0, before - dt);
    if (Math.ceil(p[key]) !== Math.ceil(before) || p[key] === 0) state.hudDirty = true;
  }
  // Storm-card thunderbolt cooldown — silent (no HUD), just gates re-fire.
  if (p.boltCdT > 0) p.boltCdT = Math.max(0, p.boltCdT - dt);
  // Regen Salve: heal a heart every REGEN_TICK_INTERVAL seconds while it runs.
  if (p.regenT > 0) {
    p.regenTickT -= dt;
    if (p.regenTickT <= 0) {
      p.regenTickT = REGEN_TICK_INTERVAL;
      if (p.hp < playerMaxHp()) {
        p.hp = Math.min(playerMaxHp(), p.hp + REGEN_HEAL_PER_TICK);
        state.vfx?.blood(p.x, 0.6, p.z, "red", 4);
        state.hudDirty = true;
      }
    }
  }
  // Active skills: mana regen, cooldowns, magnet pull + blade-storm ticks.
  tickAbilities(dt);
  // World freeze (freeze-ray potion) ticks here; zombies/gloves read it.
  if (state.freezeT > 0) {
    state.freezeT = Math.max(0, state.freezeT - dt);
    if (state.freezeT === 0) state.hudDirty = true;
  }
  // The sprint spool + pinball overcharge rails change continuously; repaint the
  // HUD only when their combined 20-block fill actually changes (same
  // block-boundary trick as the buffs above), so a smooth ramp doesn't rebuild
  // the HUD innerHTML every frame.
  {
    // + bounceCombo so the combo counter repaints on every bounce.
    const blocks = Math.round((p.sprintCharge + p.overcharge) * 20) + p.bounceCombo * 100;
    if (blocks !== meterBlocksShown) {
      meterBlocksShown = blocks;
      state.hudDirty = true;
    }
  }

  // In RAMPAGE the FPS controller owns the player (look + move + hitscan) in
  // place of the iso player update; the horde and pickups still tick so the
  // world stays alive around you.
  if (state.fpsActive) {
    updateFps(dt, state.input);
  } else {
    updatePlayer(dt, state.input);
    // Paint the fog from wherever the knight ended up this step.
    if (state.fog && state.grid && state.player) {
      const ft = worldToTile(state.grid, state.player.x, state.player.z);
      revealAround(state.fog, state.grid, ft.i, ft.j, FOG_RADIUS);
    }
  }
  // TIME CRAWL: the ability scales the horde's dt so enemies move + wind up in
  // slow-mo while the player runs at full speed. Everything else keeps real dt.
  // Co-op replica: the floor authority simulates the horde; ours are snapshot-
  // driven ghosts advanced inside updateCoop. Everything else still ticks.
  if (!isReplica()) updateZombies(state.slowT > 0 ? dt * TIMECRAWL_FACTOR : dt);
  updateProjectiles(dt);
  updateFloorFx(dt); // marble scars (slick/fire) tick status/damage to overlappers
  updateGrooveHop(dt); // the little airborne arc when the ball clears a rut's lip
  updateMaterial(dt); // marble material + fusion timers
  simulateHazards(dt); // boxing-glove punches (player launch + lane damage)
  updateNpcs(dt); // the Magician's clock, witch/frog touches, ember trails
  updateMultiBall(dt); // 🔮 echo knights: trail the player, ram what they touch
  tickCombatTimers(dt); // the bowling STRIKE window
  drainPendingMinis(); // slime splits deferred past all combat resolution
  drainPendingSummons(); // necromancer adds, same deferral
  if (!isReplica()) updateBoss(dt); // ☠ Reaper King: skulls, slam, portal-on-death
  // Secret bands smashed this run are still swinging — spin them out. Runs on
  // replicas too: the door is pure spectacle, and a replica that smashed a wall
  // locally should see it turn like anyone else.
  updateSecretDoors(dt);
  updateCoop(dt); // co-op: broadcast our pose + advance party knights
  checkPickups(dt);

  // ── Stairs? ──
  // On a boss floor the exit is SEALED until the Reaper King dies (state.exitLocked,
  // set by boss.ts). Once slain, the portal blooms over the stairs and stepping
  // onto them descends as normal.
  const pt = worldToTile(g, p.x, p.z);
  if (at(g, pt.i, pt.j) === T_STAIRS && !state.exitLocked) {
    descend();
  } else if (p.hp <= 0) {
    onPlayerDeath();
  }
}

function loop(now: number): void {
  if (!state.active) return;
  state.animFrameId = requestAnimationFrame(loop);
  // ── Held during a descent ── the descent screen owns the display while the
  // floor's pipelines compile (see startLevel). Rendering here would trigger
  // the lazy compile storm the warm-up exists to schedule, and simulating would
  // run the world for the several seconds the player cannot see or act.
  if (renderHeldForLoad) return;
  profBegin("FRAME (total)");

  // Clamped BOTH ways: MAX_FRAME is tab-out protection, and the 0 floor guards
  // against a first RAF timestamp that lags performance.now() (headless/pre-
  // render quirk) — one negative delta would otherwise poison the accumulator
  // and freeze the whole simulation for that long.
  const frame = Math.min(Math.max(0, (now - state.lastTime) / 1000), MAX_FRAME);
  state.lastTime = now;
  state.elapsed += frame;

  // Book paused wall-clock so the run's leaderboard duration excludes it.
  if (isSimPaused()) state.pausedRunS += frame;

  // ── Fixed-timestep simulation ──
  // Hit-freeze: while hitstopT is running the sim is paused so the impact reads
  // as a crunch. VFX and rendering (below) keep running through the freeze. We
  // clamp the accumulator so no time is banked — the world doesn't fast-forward
  // to catch up the instant the freeze ends.
  // Juice clocks run in REAL time, deliberately outside the fixed-step block
  // below: they measure the gap between crunches as the PLAYER feels it, and
  // sim time does not advance during a hitstop — clocking them inside would
  // freeze the limiter exactly when it is needed.
  tickJuice(frame);

  profBegin("sim (fixed steps)");
  // The accumulator lives in FixedStepLoop (GameEngine.ts), which was extracted
  // and unit-tested but — until now — never constructed: this block hand-rolled
  // the identical arithmetic beside it. Passing the ALREADY-CLAMPED `frame` is
  // deliberate; the clamp is idempotent, and computing it here keeps `tickJuice`
  // above running on the same value it always did.
  const stepped = simLoop.step(frame, state.hitstopT, simulate);
  state.hitstopT = stepped.hitstopT;
  // Mirror the private accumulator back onto state. NOT bookkeeping: the
  // headless harness reads `state.accumulator` as its loop-health diagnostic
  // (dev/window-hooks.ts). Without this line it would read a frozen 0 forever
  // while every test stayed green.
  state.accumulator = simLoop.accumulator;
  const simSteps = stepped.simSteps;
  profEnd("sim (fixed steps)");
  // A frame that runs 2+ fixed steps is CATCHING UP from a slow previous frame.
  // A rising count here means the lag is self-reinforcing (slow frame → more
  // sim work → slower frame), which reads as a stutter that will not settle.
  profCount("sim steps/frame", simSteps);

  // ── The tavern owns the screen ──
  // It runs its own renderer and covers the dungeon completely, so everything
  // below here is drawing a fully-hidden frame at full cost. Three renderers
  // were competing (dungeon pixel pass, tavern pixel pass, casino canvas) and
  // the panel canvas was getting ~4fps as a result. The rAF stays alive so the
  // loop resumes the moment the player descends.
  if (isTavernSceneOpen()) {
    // Close the open span; this frame drew nothing, so it must not be sampled
    // as a fast one (that would flatter the average).
    profEnd("FRAME (total)");
    return;
  }

  const p = state.player;
  const g = state.grid;

  // The held art follows the active hand — pickup, swap, break, retry all
  // funnel through this one check.
  applyWeaponArt();

  // ── Presentation (per rendered frame) ──
  // VFX use REAL frame time so particles keep flying through a hit-freeze.
  profBegin("vfx.update");
  state.vfx?.update(frame);
  profEnd("vfx.update");
  updatePinballParts(frame); // part cooldowns + pop/boing/chevron animations
  if (state.maze) updateArcKickers(state.maze.arcKickers, frame, state.elapsed); // curved-wall booster rubber
  if (state.maze) updateArcLanes(state.maze.arcLanes, frame, state.elapsed); // curved-wall booster lanes
  updateLampPuzzle(frame); // brazier glow + vault chest reveal
  updatePlungerRig(); // the visible launcher, shown only while parked to launch
  updateShots(frame); // orbit-lap + skill-shot windows, named-combo chain decay
  if (p) p.anim.update(frame);
  for (const z of state.zombies) z.anim.update(frame);

  // Loot bobs, snapped to the pixel grid so it doesn't shimmer. Coins are
  // skipped: they own their own Y across burst/rest/magnet (updateCoins), and
  // two writers on one position is a fight, not a bob.
  //
  // Playtest feedback said loot was easy to walk past, so it now ADVERTISES:
  // the bob is taller (0.05 → 0.09), and each item throws a small golden GLINT
  // once per ~2.4s cycle, staggered by its own bobPhase so a loot pile
  // twinkles rather than strobing in unison. The glint is a tinted burst —
  // its white-hot cores cross the bloom threshold, so it genuinely sparkles.
  for (const it of state.groundItems) {
    if (it.coin) continue;
    const y = 0.06 + Math.sin(state.elapsed * 2.6 + it.bobPhase) * 0.09;
    it.sprite.mesh.position.y = Math.round(y * PPU) / PPU;
    const cycle = (state.elapsed + it.bobPhase) % 2.4;
    if (cycle < frame) state.vfx?.burst(it.x, 0.4, it.z, 0xf0dc9a, 3, 1.4);
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
    // ── The stairs beacon LIVES ── a slow breathing pulse + a twist so the
    // beam reads as energy over the wall rims, and rising arcane sparks climb
    // it when you're near enough to see them. A static translucent cylinder
    // read as "unexplained prop" (players walked past the exit).
    const sb = state.maze.stairsBeam;
    sb.mat.opacity = 0.22 + 0.1 * (0.5 + 0.5 * Math.sin(state.elapsed * 2.1));
    sb.mesh.rotation.y = state.elapsed * 0.5;
    const sdx = sb.x - p.x;
    const sdz = sb.z - p.z;
    const sd2 = sdx * sdx + sdz * sdz;
    if (sd2 < 20 * 20 && Math.random() < 2.4 * frame) {
      const a = Math.random() * Math.PI * 2;
      state.vfx?.burst(sb.x + Math.cos(a) * 0.25, 0.2 + Math.random() * 2.2, sb.z + Math.sin(a) * 0.25, 0x6fd0e8, 1, 0.3);
    }
    // First time the way down comes into view each floor, say what it is —
    // the beacon's base (pit + pylons) hides behind wall rims, so the beam
    // alone reads as a mystery instead of an exit (same lesson as the
    // cracked-wall hint: nothing in the game teaches it otherwise).
    if (!state.stairsHintShown && sd2 < 8 * 8) {
      state.stairsHintShown = true;
      showPickupNote("⬇ THE BLUE BEACON — the stairs down; step into its base");
    }
  }

  if (p && g && state.maze) {
    // Park the pooled torch lights on the nearest torches. Sorting a handful
    // of anchors per frame is nothing; 20 live point lights would not be.
    //
    // MEASURED, NOT ASSUMED: this map+sort allocates a fresh array of objects
    // every frame and sorts ALL anchors to use only the first few. That is a
    // textbook GC-churn shape, so it is instrumented — if the sample says it is
    // cheap, leave it alone.
    profBegin("torch light sort");
    profCount("torch anchors", state.maze.torchAnchors.length);
    const anchors = state.maze.torchAnchors
      .map((a) => ({ a, d: (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z) }))
      .sort((u, v) => u.d - v.d);
    profEnd("torch light sort");
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

  // Camera: the iso follow-cam normally; the first-person cam during rampage.
  // (updateFps already re-aims the FPS camera each sim step; re-aim once more
  // here so mouse-look stays smooth between fixed steps.)
  if (state.fpsActive) {
    aimFpsCamera();
    billboardEnemiesToFps(); // keep enemy planes facing the FPS camera each frame
  } else if (p && state.camera) {
    updateFollowCamera(state.camera, p.x, p.z, frame);
  }

  // Keep the key light's small shadow frustum centred on the player: the light
  // rakes in from the world's north-west (opposite the south-east camera) so
  // wall shadows fall toward the viewer, into the corridors, not away.
  if (p) followPlayer(p.x, p.z);

  if (state.hudDirty) {
    state.hudDirty = false;
    // The DOM rebuild path. Guarded per-element in hud-diablo, but a bounce
    // still lands here every time the combo ticks.
    profBegin("refreshHUD (DOM)");
    refreshHUD();
    profEnd("refreshHUD (DOM)");
  }
  // Per-frame HUD animation: liquid globes, cooldown rings, the face's blink/
  // wince timers. Cheap even when a panel is slid off-screen.
  renderHUD(frame);

  // Score glue: spawn a Ragnarok-style floating ×N at the knight on every fresh
  // bounce-combo STEP, wherever the increment came from (wall, part, arc, ram) —
  // a rising count is the signal. It resets to 0 on lapse, arming the next spray.
  const combo = p?.bounceCombo ?? 0;
  if (combo > state.prevBounceCombo && combo >= 2 && p) {
    const sc = worldToScreenPx(p.x, p.z);
    if (sc) spawnFloatingCombo(combo, sc.x, sc.y);
  }
  state.prevBounceCombo = combo;

  // Frenzy screen FX (combo Part 2): vignette pull + chromatic aberration ramp
  // in with the deep combo and PULSE so the edge-of-control read breathes.
  // Driven per rendered frame (presentation only); eases back to 0 as the combo
  // lapses. sin() on real elapsed time is fine here — it never touches the sim.
  const fBase = frenzyIntensity(combo);
  const fPulse = fBase > 0 ? fBase * (0.78 + 0.22 * Math.sin(state.elapsed * 7)) : 0;
  state.pixelPass?.setFrenzyFx(fPulse);

  // Katana-finisher screen flash: decays on REAL frame time (not sim dt) so it
  // plays through the very hitstop the finisher causes — freeze + white-out
  // land on the same beat. Quadratic falloff: a hard pop, a fast fade.
  if (state.flashT > 0) {
    state.flashT = Math.max(0, state.flashT - frame);
    const k = state.flashT / FINISHER_FLASH_T;
    state.pixelPass?.setFlash(FINISHER_FLASH_MAX * k * k);
  }

  // Boss bar: while the overlord is alive AND HAS NOTICED YOU.
  //
  // It used to appear the instant the floor built, so every descent opened with
  // "☠ THE REAPER KING ☠" pinned to the top of the screen — which reads as "the
  // boss is right here" even though a census of 78 floors puts his spawn tile a
  // minimum of 56 BFS steps away. Gating on engagement (boss.ts, THE LEASH)
  // makes the announcement mean what it says. `bossEngaged` answers for
  // replicas too, off the streamed BossAux.

  const renderCam = state.fpsActive && state.fpsCamera ? state.fpsCamera : state.camera;
  // rendererReady: skip frames until the async backend init resolves. Simulation
  // above has already run, so a couple of dropped frames at launch cost nothing.
  if (state.scene && renderCam && state.pixelPass && isRendererReady()) {
    // Shadow throttle: per-light autoUpdate is off (see renderer setup); render
    // the shadow depth pass on alternate frames only.
    if (state.renderer) tickShadowThrottle();
    // GPU submission, not GPU completion: WebGL is async, so this measures the
    // CPU cost of building + submitting the passes. A small number here with a
    // large FRAME total means the cost is CPU-side, above this line.
    profBegin("pixelPass.render");
    state.pixelPass.render(state.scene, renderCam);
    profEnd("pixelPass.render");
    if (state.renderer) {
      profCount("draw calls", state.renderer.info.render.calls);
      // THE warm-up gate. `memory.programs` counts distinct COMPILED shader
      // programs (three: common/Info.js createProgram). It should be flat from
      // the moment the descent screen closes — every rise during play is a
      // material family the prewarm never saw, compiled mid-combat, which is a
      // hitch the player felt. Watch its `max`, not its average.
      profCount("gpu programs", state.renderer.info.memory.programs);
      // Textures are here to settle whether the per-actor texture clone in
      // render/sprite.ts really uploads one per zombie: ~135 at a full horde
      // confirms it, ~20 refutes it. Nobody should cost that fix before this
      // number has been read on real hardware.
      profCount("gpu textures", state.renderer.info.memory.textures);
    }
  }
  profEnd("FRAME (total)");
  profFrame();
}

export function exitDungeonGame(): void {
  closeFloorMap();
  dismissCardReader(); // drops the haul screen AND its pending continuation
  clearPickupToasts(); // the corner rail lives on the container, its timers don't
  if (!state.active) return;

  const onExit = state.onExitCallback;

  // Leaving mid-run: bank whatever is still rolling around on the floor before
  // disposeAll deletes it. Every exit from a level now passes through a sweep
  // (startLevel, onPlayerDeath, here), which is what makes "a coin is credited
  // exactly once, and never zero times" true for the whole lifecycle.
  sweepCoins();

  endCoop(); // drop dungeon party knights
  stopPresence(); // full game exit → leave the pool + close the socket
  disposeBoss(); // free any live Reaper King meshes
  disposeSecretDoors();
  // The idle atlas backfill (boot/sheets.ts) can still have callbacks queued.
  // Left running, the next one paints a sheet onto a state disposeAll has
  // already torn down — an atlas nothing will ever dispose.
  stopSheetBackfill();

  if (state.animFrameId !== null) cancelAnimationFrame(state.animFrameId);
  if (state.onKeyDown) window.removeEventListener("keydown", state.onKeyDown);
  if (state.onResize) window.removeEventListener("resize", state.onResize);
  debugPanelDispose?.();
  debugPanelDispose = null;
  state.input?.dispose();
  touchControls?.dispose();
  touchControls = null;

  disposeAll();
  clearLights(); // the lights themselves are freed with the scene by disposeAll
  clearInputOwner();

  resetState();
  // resetState() zeroes state.accumulator; the loop owns the real one, so it
  // has to be zeroed in the same breath or the next run's first frame writes
  // the dead run's banked time straight back over it.
  simLoop.reset();
  onExit?.();
}
