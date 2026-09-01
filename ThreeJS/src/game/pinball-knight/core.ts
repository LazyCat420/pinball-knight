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
import { createVfx } from "./fx/system";
import { createAimIndicator } from "./render/aim-indicator";
import { createPinballParts } from "./render/pinball-parts";
import { updateArcKickers } from "./render/arc-kickers";
import { updateArcLanes } from "./render/arc-lanes";
import { resetJuice } from "./engine/juice";
import { railCap } from "./entities/rail";
import { installTouchControls, isTouchDevice, type TouchControls } from "./gui/touch";
import { updateShots } from "./shots";
import { resetTilt } from "./entities/nudge";
import { createActorSprite, createStaticSprite, createOcclusionSilhouette } from "./engine/render/sprite";
import { reaperSheet } from "./render/reaper-sheet";
import { installEngine } from "./GameEngine";
import { BIOMES } from "./boot/biomes";
import { readSeedParam } from "./boot/seed-param";
import { warmFloorPipelines } from "./boot/warmup";
import { installRenderer, presentUiFrame } from "./boot/renderer";
import { installScene } from "./boot/scene";
import { installDevWiring, installGameplayWiring } from "./boot/wiring";
import { setRunDeps } from "./run/deps";
import { descend, descendInto, dropBossReward, adoptPoolSeedWhenItArrives } from "./run/descend";
import { unlockDepth } from "./unlocked-depths";
import { onPlayerDeath } from "./run/death";
import { spawnReaper } from "./spawn/reaper";
import { authorFloor } from "./spawn/floor-authoring";
import { populateFloor } from "./spawn/floor-populate";
import { loop, resetSimClock } from "./sim/loop";
import { isSimPaused } from "./sim/paused";
import { armFloorLoading, currentFloorLoad, holdForFloorLoad, releaseFloorLoad } from "./run/floor-hold";
import { handleKey } from "./input/keymap";
import { floorFlow, gradeFloor } from "./run/grade";
import { tearGraveHole } from "./run/grave-hole";
import { Animator } from "./engine/render/animator";
import { ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { variantIndicesFor, type ZombieType } from "./zombie-types";
import { updateFollowCamera, worldToScreenPx } from "./engine/camera";
import { showToast, showPickupNote } from "./ui";
import { dismissCardReader } from "./card-reader";
import { getSettings } from "./settings-save";
import { clearPickupToasts } from "./pickup-toast";
import { applySettingsLive } from "./gui/apply-settings";
import { lookFromGear, lookKey } from "./render/knight-look";
import { awardDebugXp as debugGrantXp, playerMaxHp } from "./skill-runtime";
import { mountHUDs } from "./hud";
import { rippleGlobe } from "./gui/globe-ripple";
import { faceOnHeal } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { worldToTile, at } from "./maze/generator";
import { floorRng } from "./maze/floor-seed";
import { computeArcCorners } from "./engine/collision";
import { decorateMaze, widenMainArtery, pickEndpoints, type PrefabAnchor } from "./maze/decorate";
import { paintSurfaces, paintBands } from "./maze/surface-paint";
import { buildTrackFloor } from "./maze/track-floor";
import { walkableCount } from "./maze/floor-metrics";
import { authorLampPuzzle, lampCountFor } from "./maze/lamp-puzzle";
import { installLampPuzzle } from "./lamp-puzzle";
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
import { applyMaterial, isMaterial } from "./entities/marble";
import { simulateHazards } from "./entities/hazards";
import { rollMagicianClock } from "./entities/npc";
import { tickCombatTimers } from "./entities/combat";
import { createDebugPanel, disposeDebugPanel } from "./debug-panel";
import { createInput } from "./engine/input";
import { updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import { tickAbilities } from "./abilities";
import { updateMultiBall } from "./entities/multiball";
import {
  BOSS_EVERY,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { WEAPONS, POTIONS, freshWeapon, type WeaponId, type PotionId } from "./items";
import { REAGENTS, rollReagentDrops, type ReagentId } from "./reagents";
import { cardBase } from "./cards";
import { closeTavern } from "../../scenes/tavern";
import { openLobby } from "./run/lobby";
import { openFloorLoading } from "./floor-loading";
import { disposeBoss } from "./boss";
import { disposeSecretDoors } from "./secrets";
import { nearSealed } from "./maze/track-socket";
import { endCoop } from "./coop";
import { stopPresence, peers, startPresence } from "../../net/presence";
import { resolveDescendFloor } from "../../net/rally";
import { applyDelveCatchUp } from "./delve";
import { createFog } from "./fog";
import { closeFloorMap } from "./map-overlay";
import { sfxLevelStart, sfxModifier, sfxBossReveal } from "./sfx";
import { saveBestDepth } from "./best-depth";
import { loadResumeFloor } from "./corpse-run";
import { getPlayerName } from "../../services/player-name";
import { runPinballIntro } from "./intro";
import { frenzyIntensity, momentumT } from "./entities/combo-curve";
import { profBegin, profEnd, profCount, profFrame } from "./engine/profiler";
import { installDevHooks } from "./dev/window-hooks";
import { captureFloorCensus } from "./dev/floor-census";
import { debugTeleportToStairs, debugSpawnRing, debugSpawnEnemy, debugKillAll, debugClearEnemies } from "./dev/debug-actions";
import { clearLights } from "./boot/lighting";
import { stopSheetBackfill } from "./boot/sheets";
import { beginRunLedger } from "./run/ledger";
import { nearestOpenTile } from "./maze/nearest-open-tile";
import { drainPendingMinis, drainPendingSummons } from "./spawn/factory";
import { nextItemNid, resetItemNid } from "./economy/ground-items";
import { sweepCoins } from "./economy/coins";
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

/** The on-screen touch pad, when this device gets one (see createTouchControls). */
let touchControls: TouchControls | null = null;
/** The ` toggle. NOT a dispose — its old name said so and teardown CALLED it,
 *  which pushed the debug screen while the run was being torn down. */
let toggleDebugPanel: (() => void) | null = null;


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
  toggleDebugPanel = createDebugPanel(state.container, {
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
  // the entry — `runPinballIntro` has NO CALLER; its docblock opens by saying so.)
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
  // Title sequence, then the lobby and its character prompt — run/lobby.ts.
  // `!` — narrowing is lost in the callback.
  runPinballIntro(() => openLobby(state.container!, { onDescend: beginRun, onAbandon: () => exitDungeonGame() }));
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
  // one up already and it has been presented. Anything else — a co-op regroup,
  // a seed disagreement, a dev hook — raises it here and pushes ONE frame
  // itself. There is no rAF to wait for from inside a synchronous call, but GPU
  // submission is async: the compositor picks the frame up while `buildLevel`
  // blocks the thread, which is exactly the window it is needed for.
  if (!currentFloorLoad() && state.container) {
    holdForFloorLoad(openFloorLoading(state.container, level));
    presentUiFrame();
  }
  buildLevel(level);
  const load = currentFloorLoad();
  if (!load) return;
  load.phase("RAISING THE WALLS", 0.3);
  void warmFloorPipelines(load).finally(() => {
    load.close();
    releaseFloorLoad(load);
    // The loop has been idle for several seconds; without this the next frame
    // would carry a multi-second delta into the fixed-step accumulator.
    state.lastTime = performance.now();
    if (state.animFrameId === null && state.active) {
      state.animFrameId = requestAnimationFrame(loop);
    }
  });
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
  unlockDepth(level);
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
  resetTilt(); // the tilt meter is FLOOR-scoped, like the frenzy meter above it
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















/** One 60Hz simulation step. */


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
  disposeDebugPanel();
  toggleDebugPanel = null;
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
  resetSimClock();
  onExit?.();
}
