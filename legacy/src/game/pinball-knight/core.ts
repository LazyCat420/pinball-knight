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
import { state, resetState, type EnemyKind } from "./state";
import { createPixelPass } from "./engine/render/pixel-pass";
import { createVfx } from "./render/vfx";
import { createAimIndicator } from "./render/aim-indicator";
import { createPinballParts, updatePinballParts, updatePlungerRig } from "./render/pinball-parts";
import { updateArcKickers } from "./render/arc-kickers";
import { updateArcLanes } from "./render/arc-lanes";
import { tickJuice, resetJuice } from "./engine/juice";
import { railCap } from "./entities/rail";
import { createTouchControls, isTouchDevice, type TouchControls } from "./engine/touch-controls";
import { updateShots } from "./shots";
import { createActorSprite, createStaticSprite, createOcclusionSilhouette } from "./engine/render/sprite";
import { reaperSheet } from "./render/reaper-sheet";
import { installEngine, FixedStepLoop } from "./GameEngine";
import { BIOMES } from "./boot/biomes";
import { readSeedParam } from "./boot/seed-param";
import { warmFloorPipelines } from "./boot/warmup";
import { installRenderer, isRendererReady } from "./boot/renderer";
import { installScene } from "./boot/scene";
import { installDevWiring, installGameplayWiring } from "./boot/wiring";
import { setRunDeps } from "./run/deps";
import { descend, descendInto, dropBossReward, adoptPoolSeedWhenItArrives } from "./run/descend";
import { onPlayerDeath } from "./run/death";
import { spawnReaper } from "./spawn/reaper";
import { authorFloor } from "./spawn/floor-authoring";
import { populateFloor } from "./spawn/floor-populate";
import { meterBlocksShown, setMeterBlocksShown } from "./hud-meter";
import { handleKey } from "./input/keymap";
import { floorFlow, gradeFloor } from "./run/grade";
import { tearGraveHole } from "./run/grave-hole";
import { Animator } from "./engine/render/animator";
import { ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { variantIndicesFor, type ZombieType } from "./zombie-types";
import { updateFollowCamera, worldToScreenPx } from "./engine/camera";
import { showToast, showControlsHint, showPickupNote, createFpsOverlay, spawnFloatingCombo, createBossBar, updateBossBar, createPlungerMeter, updatePlungerMeter } from "./ui";
import { dismissCardReader } from "./card-reader";
import { getSettings } from "./settings-save";
import { clearPickupToasts } from "./pickup-toast";
import { applySettingsLive } from "./menu";
import { lookFromGear, lookKey } from "./render/knight-look";
import { awardDebugXp as debugGrantXp, playerMaxHp } from "./skill-runtime";
import { mountHUDs, renderHUD, refreshHUD } from "./hud";
import { rippleGlobe } from "./hud-diablo";
import { faceOnHeal } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { worldToTile, at, T_STAIRS } from "./maze/generator";
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
import { buildMaze } from "./maze/build";
import { hordeFlowField } from "./engine/flow-field";
import { updatePlayer } from "./entities/player";
import { updateZombies } from "./entities/zombie";
import { updateProjectiles } from "./entities/projectiles";
import { updateFloorFx, updateGrooveHop } from "./entities/floor-fx";
import { updateMaterial, applyMaterial, isMaterial } from "./entities/marble";
import { simulateHazards } from "./entities/hazards";
import { updateNpcs, rollMagicianClock } from "./entities/npc";
import { tickCombatTimers } from "./entities/combat";
import { createDebugPanel } from "./debug-panel";
import { createInput } from "./engine/input";
import { updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import { tickAbilities } from "./abilities";
import { updateMultiBall } from "./entities/multiball";
import {
  FLOW_INTERVAL,
  TIMECRAWL_FACTOR,
  FOG_RADIUS,
  REAPER_AFTER,
  REAPER_WARNING,
  BOSS_EVERY,
  FIXED_STEP,
  MAX_FRAME,
  PPU,
  WALL_H,
  FLAME_FPS,
  FLAME_FRAMES,
  MOTE_RATE,
  FINISHER_FLASH_T,
  FINISHER_FLASH_MAX,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { WEAPONS, POTIONS, freshWeapon, REGEN_HEAL_PER_TICK, REGEN_TICK_INTERVAL, type WeaponId, type PotionId } from "./items";
import { REAGENTS, rollReagentDrops, type ReagentId } from "./reagents";
import { cardBase } from "./cards";
import { enterTavern, isTavernSceneOpen, closeTavern } from "../../scenes/tavern";
import { openFloorLoading, type FloorLoading } from "./floor-loading";
import { updateBoss, disposeBoss, bossEngaged } from "./boss";
import { updateSecretDoors, disposeSecretDoors } from "./secrets";
import { nearSealed } from "./maze/track-socket";
import { updateCoop, endCoop, isReplica } from "./coop";
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
import { followPlayer, tickShadowThrottle, clearLights } from "./boot/lighting";
import { applyWeaponArt, stopSheetBackfill } from "./boot/sheets";
import { beginRunLedger } from "./run/ledger";
import { nearestOpenTile } from "./maze/nearest-open-tile";
import { drainPendingMinis, drainPendingSummons } from "./spawn/factory";
import { nextItemNid, resetItemNid } from "./economy/ground-items";
import { sweepCoins, updateCoins } from "./economy/coins";
import { dropCardMaybe, dropReagentsMaybe, spawnMaterialDrop } from "./economy/loot";
import { checkPickups } from "./economy/pickups";
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
  state.fpsOverlayEl = createFpsOverlay(state.container);
  state.bossBarEl = createBossBar(state.container);
  state.plungerMeterEl = createPlungerMeter(state.container);
  state.input = createInput(state.container);
  // ON-SCREEN PAD for phones/tablets. Built only where it is wanted — a mouse
  // user must never get thumb buttons over their game — but `?touch=1` forces
  // it on for testing the layout from a desktop browser.
  const forceTouch = typeof location !== "undefined" && /[?&]touch=1/.test(location.search);
  if (state.container && (forceTouch || isTouchDevice())) {
    touchControls = createTouchControls(state.container, state.input.pad);
  }
  showControlsHint(state.container);

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
  // Decide the floor — spawn/floor-authoring.ts. Everything up to here is
  // local; the commit below is where it becomes the world.
  const f = authorFloor(level);
  const { cfg, biome, rng, arch, modifier, bonusRoom, track, grid, plan, lampPuzzlePlan } = f;

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

  // Fill it: player, horde, plunger, boss gate, loot, dressing, packs.
  populateFloor(f);
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
  return !!(state.shopEl || state.tavernEl || state.cardReaderEl || state.menuEl) || isTavernSceneOpen();
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
    if (blocks !== meterBlocksShown()) {
      setMeterBlocksShown(blocks);
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
  const boss = state.zombies.find((z) => z.boss && z.mode !== "dead");
  const seen = boss && (bossEngaged() || boss.hp < (boss.maxHp ?? boss.hp));
  updateBossBar(state.bossBarEl, seen ? boss.hp : null, seen ? boss.maxHp ?? null : null);
  updatePlungerMeter(state.plungerMeterEl);

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
