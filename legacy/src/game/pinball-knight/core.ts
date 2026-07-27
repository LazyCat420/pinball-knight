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
import { state, resetState, freshPlayerFields, activeWeapon, type Zombie, type GroundItem, type EnemyKind, type MarbleMaterial } from "./state";
import { createPixelPass } from "./engine/render/pixel-pass";
import { createVfx } from "./render/vfx";
import { createAimIndicator } from "./render/aim-indicator";
import { createPinballParts, updatePinballParts, updatePlungerRig, spawnPinballPart } from "./render/pinball-parts";
import { updateArcKickers } from "./render/arc-kickers";
import { updateArcLanes } from "./render/arc-lanes";
import { tickJuice, resetJuice } from "./engine/juice";
import { railCap } from "./entities/rail";
import { createTouchControls, isTouchDevice, type TouchControls } from "./engine/touch-controls";
import { updateShots, rotateLanes } from "./shots";
import { loadAtlasSheet } from "./engine/render/atlas-loader";
import { createActorSprite, createStaticSprite, createOcclusionSilhouette, type SpriteSheet } from "./engine/render/sprite";
import { reaperSheet } from "./render/reaper-sheet";
import { installEngine } from "./GameEngine";
import { Animator } from "./engine/render/animator";
import { ZOMBIE_VARIANTS, ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { variantIndicesFor, type ZombieType } from "./zombie-types";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera, worldToScreenPx } from "./engine/camera";
import { showToast, showGameOver, showControlsHint, showPickupNote, createFpsOverlay, setFpsOverlay, spawnFloatingCombo, createBossBar, updateBossBar, createPlungerMeter, updatePlungerMeter, openShopOverlay, refreshShopOverlay, type ShopEntry } from "./ui";
import { advanceCardReader, dismissCardReader, showCardHaul } from "./card-reader";
import { getSettings } from "./settings-save";
import { clearPickupToasts } from "./pickup-toast";
import { openGameMenu, closeGameMenu, cycleMenuTab, menuTabByIndex, applySettingsLive } from "./menu";
import { lookFromGear, lookKey } from "./render/knight-look";
import { setHandmadeOverride } from "./render/knight-sheets";
import { awardFloorXp, awardDebugXp as debugGrantXp, setLevelUpHandler, invalidateSkillAgg, playerMaxHp, skillAgg } from "./skill-runtime";
import { mountHUDs, renderHUD, refreshHUD } from "./hud";
import { rippleGlobe } from "./hud-diablo";
import { faceOnHeal, faceOnSpecial } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, tileCenter, worldToTile, at, isWalkable, type Grid, type TilePos, T_STAIRS } from "./maze/generator";
import { computeArcCorners } from "./engine/collision";
import { decorateMaze, widenMainArtery, pickEndpoints, type PrefabAnchor } from "./maze/decorate";
import { paintSurfaces } from "./maze/surface-paint";
import { buildTrackFloor } from "./maze/track-floor";
import { authorLampPuzzle, lampCountFor } from "./maze/lamp-puzzle";
import { installLampPuzzle, updateLampPuzzle } from "./lamp-puzzle";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor, themeIndexFor } from "./maze/prefabs";
import { archetypeFor, windinessFor } from "./maze/archetypes";
import { resolveSpawnPoints, type DebugSpawnSpec, type DebugSpawnResult } from "./debug-spawn";
import { rollModifier } from "./maze/modifiers";
import { buildMaze } from "./maze/build";
import { bfsDistances, bfsDistancesOwned } from "./engine/flow-field";
import { updatePlayer, resetPlayerMotion, debugCurSpeed, debugWallNormal } from "./entities/player";
import { updateZombies, setSummonHandler } from "./entities/zombie";
import { updateProjectiles, golemShards } from "./entities/projectiles";
import { updateFloorFx, clearFloorFx, spawnFloorFx, updateGrooveHop } from "./entities/floor-fx";
import { updateMaterial, applyMaterial, isMaterial, MATERIALS, MATERIAL_LIST } from "./entities/marble";
import { simulateHazards } from "./entities/hazards";
import { updateNpcs, disposeNpcs, spawnFrog, spawnMerchant, setMerchantCaughtHandler, rollMagicianClock } from "./entities/npc";
import { syncActorMesh, setBossDefeatedHandler, setSlimeSplitHandler, setGolemShatterHandler, setBloaterBurstHandler, setCardRollHandler, setCoinDropHandler, setReagentDropHandler, resetCombatJuice, tickCombatTimers, damageZombie, setCoopCombatBridge, hitPlayerRanged } from "./entities/combat";
import { createDebugPanel } from "./debug-panel";
import { createInput } from "./engine/input";
import { canRampage, enterRampage, updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import { castAbility, tickAbilities, ABILITIES, type AbilityId } from "./abilities";
import { spawnMultiBall, updateMultiBall } from "./entities/multiball";
import {
  levelConfig,
  FLOW_INTERVAL,
  TIMECRAWL_FACTOR,
  GOLD_PER_DESCENT,
  PLAYER_MAX_HP,
  ZOMBIE_HP,
  ZOMBIE_R,
  CRAWLER_PITCH,
  HULK_MIN_OPEN_NEIGHBOURS,
  SPIDER_HP,
  SPIDER_SPEED_FACTOR,
  SPIDER_RATIO,
  SPIDER_FROM_LEVEL,
  BRUTE_HP,
  BRUTE_SPEED_FACTOR,
  BRUTE_RATIO,
  BRUTE_FROM_LEVEL,
  THEME_HORDE_BIAS,
  SPITTER_HP,
  SPITTER_SPEED_FACTOR,
  SPITTER_RATIO,
  SPITTER_FROM_LEVEL,
  GHOST_HP,
  GHOST_SPEED_FACTOR,
  GHOST_RATIO,
  GHOST_FROM_LEVEL,
  BAT_HP,
  BAT_SPEED_FACTOR,
  BAT_RATIO,
  BAT_FROM_LEVEL,
  SLIME_HP,
  SLIME_SPEED_FACTOR,
  SLIME_RATIO,
  SLIME_FROM_LEVEL,
  SLIME_MINI_HP,
  SLIME_MINI_SPEED_MULT,
  SLIME_MINI_SCALE,
  GOBLIN_HP,
  GOBLIN_SPEED_FACTOR,
  GOBLIN_RATIO,
  GOBLIN_FROM_LEVEL,
  PIN_HP,
  PIN_CREW_SIZE,
  PIN_FROM_LEVEL,
  GOLEM_HP,
  GOLEM_RATIO,
  GOLEM_FROM_LEVEL,
  CHOMPER_HP,
  CHOMPER_RATIO,
  CHOMPER_FROM_LEVEL,
  MAGNET_HP,
  MAGNET_SPEED_FACTOR,
  MAGNET_RATIO,
  MAGNET_FROM_LEVEL,
  WEBSPIN_HP,
  WEBSPIN_SPEED_FACTOR,
  WEBSPIN_RATIO,
  WEBSPIN_FROM_LEVEL,
  TARGETS_PER_FLOOR,
  TRAPDOORS_PER_FLOOR,
  VAULT_RAMPS_PER_FLOOR,
  FOG_RADIUS,
  PLUNGER_SKILL_RANGE,
  BOOTS_SPEED_FACTOR,
  MAGICIAN_FROM_LEVEL,
  MERCHANT_SPAWN_MIN_RING,
  HAZARDS_BASE,
  HAZARDS_PER_LEVEL,
  HAZARDS_MAX,
  MERCHANT_FROM_LEVEL,
  BONUS_ROOM_GRADES,
  PARTS_BASE,
  TRACK_FIRST,
  PARTS_PER_LEVEL,
  PARTS_MAX,
  ROOM_MIN_CELLS,
  ROOM_MAX_CELLS,
  REAPER_AFTER,
  REAPER_WARNING,
  REAPER_HP,
  REAPER_SPEED_BASE,
  REAPER_SCALE,
  REAPER_TINT,
  GRADE_TIME_FAST,
  GRADE_TIME_OK,
  GRADE_KILLS_FULL,
  GRADE_KILLS_OK,
  GRADE_COMBO_FULL,
  GRADE_COMBO_OK,
  GRADE_GOLD,
  BOSS_EVERY,
  KING_HP_BASE,
  KING_HP_PER_FLOOR,
  BOSS_BASE_HP,
  BOSS_HP_PER_TIER,
  BOSS_SPEED_FACTOR,
  BOSS_GOLD,
  FIXED_STEP,
  MAX_FRAME,
  PICKUP_RANGE,
  COIN_MAGNET_RANGE,
  COIN_AURA_RANGE_MULT,
  COIN_MAGNET_TIME,
  COIN_CHEST_Y,
  COIN_MAGNET_ARC,
  COIN_BURST_VY,
  COIN_GRAVITY,
  COIN_BOUNCE,
  COIN_BURST_SPREAD,
  COIN_BURST_DRAG,
  COIN_SETTLE_VY,
  COIN_ARM_TIME,
  COIN_REST_Y,
  COIN_SPAWN_Y,
  COIN_MAX_PER_DROP,
  COIN_LIVE_CAP,
  COIN_STACK_VALUE,
  COIN_DROP_SCALE,
  COIN_STACK_DROP_SCALE,
  GOLD_PER_KILL,
  GRAVEPIT_BLAST_RADIUS,
  GRAVEPIT_BLAST_LIFE,
  GRAVEPIT_BLAST_DAMAGE,
  DROP_CLEAR_RANGE,
  PPU,
  WALL_H,
  FOG_NEAR,
  FOG_FAR,
  BLOOM_DEFAULT,
  AO_DEFAULT,
  FLAME_FPS,
  FLAME_FRAMES,
  MOTE_RATE,
  HOUND_HP, HOUND_SPEED_FACTOR, HOUND_FROM_LEVEL,
  BLOATER_HP, BLOATER_SPEED_FACTOR, BLOATER_FROM_LEVEL,
  NECRO_HP, NECRO_SPEED_FACTOR, NECRO_FROM_LEVEL,
  WARDEN_HP, WARDEN_SPEED_FACTOR, WARDEN_FROM_LEVEL,
  WISP_HP, WISP_SPEED_FACTOR, WISP_FROM_LEVEL,
  SAPPER_HP, SAPPER_SPEED_FACTOR, SAPPER_FROM_LEVEL,
  CRYSTAL_HP, CRYSTAL_FROM_LEVEL,
  MIMIC_HP, MIMIC_SPEED_FACTOR, MIMIC_FROM_LEVEL,
  BLOATER_BURST_RADIUS, FIRE_PUDDLE_LIFE,
  FINISHER_FLASH_T, FINISHER_FLASH_MAX,
} from "./constants";
import { addGold, getBalance, spendGold } from "../../utils/gold-wallet";
import { WEAPONS, GEAR, POTIONS, POTION_IDS, freshWeapon, REGEN_HEAL_PER_TICK, REGEN_TICK_INTERVAL, ELIXIR_MAXHP_BONUS, type WeaponId, type WeaponState, type GearSlot, type PotionId } from "./items";
import { REAGENTS, rollReagentDrops, type ReagentId } from "./reagents";
import { cardBase } from "./cards";
import { enterTavern, isTavernSceneOpen, closeTavern } from "../../scenes/tavern";
import { spawnBoss, updateBoss, disposeBoss } from "./boss";
import { initCoop, updateCoop, endCoop, isReplica, setCoopFloor, coopSeed, setCoopHooks, coopItemTaken, coopForwardDamage, coopBroadcastKill, coopAnnounceDeath, isCoop, enemyAuthorityIsMe } from "./coop";
import { stopPresence, onPeerArrive, myId, peers, poolStatus, startPresence } from "../../net/presence";
import { resolveDescendFloor, regroupTarget } from "../../net/rally";
import { applyDelveCatchUp } from "./delve";
import { createFog, revealAround, exploredCount, exploredFraction } from "./fog";
import { toggleFloorMap, closeFloorMap, isFloorMapOpen } from "./map-overlay";
import { sfxStairs, sfxGameOver, sfxPickup, sfxCoin, sfxFreeze, sfxBumper, sfxLevelStart, sfxModifier, sfxBossReveal, sfxHeavy } from "./audio";
import { loadBestDepth, saveBestDepth } from "./best-depth";
import { addPile, saveResumeFloor, loadResumeFloor, pilesOnFloor, floorsWithPiles, clearPile, canLoot, type CorpseItem } from "./corpse-run";
import { getPlayerName } from "../../services/player-name";
import { runPinballIntro } from "./intro";
import { frenzyIntensity } from "./entities/combo-curve";
import { profBegin, profEnd, profCount, profFrame } from "./engine/profiler";
import { installDevHooks } from "./dev/window-hooks";
import { debugTeleportToStairs, debugSpawnRing, debugSpawn, debugSpawnEnemy, debugKillAll, debugClearEnemies, setDebugActionDeps } from "./dev/debug-actions";
import { buildLights, tintLights, followPlayer, tickShadowThrottle, clearLights } from "./boot/lighting";
import { playerSheetFor, applyWeaponArt, paintMenuPortrait, buildMonsterSheets } from "./boot/sheets";
import { beginRunLedger, submitRunScore } from "./run/ledger";
import { nearestOpenTile } from "./maze/nearest-open-tile";
import { makeZombie, spawnKind, spawnHordeMember, spawnPinCrew, drainPendingMinis, drainPendingSummons, bumpZombieNid, makeReskin, queueMini, queueSummon, resetZombieNid, RESKIN } from "./spawn/factory";
import { removeGroundItem, nextItemNid, resetItemNid } from "./economy/ground-items";
import { creditGold, spawnCoin, sweepCoins, updateCoins } from "./economy/coins";
import { dropWeapon, dropCardMaybe, dropReagentsMaybe, spawnMaterialDrop } from "./economy/loot";
import { checkPickups, resetPickupSweep } from "./economy/pickups";
import { openShop, closeShop, applyPotion, useBeltSlot } from "./economy/shop";

/** False until WebGPURenderer.init() resolves — render() throws before that. */
let rendererReady = false;
/** The on-screen touch pad, when this device gets one (see createTouchControls). */
let touchControls: TouchControls | null = null;
let debugPanelDispose: (() => void) | null = null;

/** Last sprint-spool+overcharge fill (in 20ths) the HUD painted — repaint only when it changes. */
let meterBlocksShown = -1;

/**
 * Named depth BIOMES — descending should feel like passing through distinct
 * places, not the same maze re-tinted. Each biome carries a name + a one-line
 * flavour (shown on descent) and its own colour grade. They cycle every 4
 * floors, getting a fresh "chapter" feel as you go deeper.
 */
interface Biome {
  name: string;
  flavour: string;
  amb: number;
  sky: number;
  ground: number;
}
const BIOMES: Biome[] = [
  { name: "The Cold Crypt", flavour: "damp stone · the dead stir", amb: 0x6b7d99, sky: 0x8fa3bd, ground: 0x1e2430 },
  { name: "The Rotting Warren", flavour: "moss and marrow · things breed here", amb: 0x6d8a78, sky: 0x8fbda6, ground: 0x1e2a22 },
  { name: "The Bloodworks", flavour: "the walls weep red · tread carefully", amb: 0x8a6f74, sky: 0xbd949a, ground: 0x2a1e20 },
  { name: "The Arcane Deep", flavour: "cold light · something old is awake", amb: 0x6f74a0, sky: 0x97a0e0, ground: 0x1e2233 },
];

/**
 * The biome for a given depth. Indexed through `themeIndexFor` — NOT a plain
 * modulo — because BIOMES and THEMES are paired one-to-one by index, so a
 * floor's colour grade matches the furniture pool it was dealt. The per-run
 * shuffle lives in that one function; both sides must read it or they drift.
 */
function biomeFor(level: number): Biome {
  return BIOMES[themeIndexFor(level, state.runSeed)];
}

export function isDungeonGameActive(): boolean {
  return state.active;
}

/** The knight's atlas for the held weapon DRESSED IN the current gear — the
 * shared LRU cache in render/knight-sheets does the building. */

/**
 * `?seed=<int>` — pin the run seed so a floor regenerates identically.
 * Returns null when absent or unparseable, so the caller falls back to random.
 */
function readSeedParam(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  // Match the random path's range: a non-negative 31-bit int.
  return Math.abs(n) % 0x7fffffff;
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

  // ── Renderer ──
  // No MSAA: the quantize pass flattens colour anyway, and the depth-edge
  // outline wants clean depth values. Colour/tonemapping is set by createPixelPass.
  // WebGPURenderer drives BOTH backends; ?gpu=webgl forces the WebGL2 one.
  // init() is awaited by the caller (launchDungeonGame) before the first frame.
  state.renderer = new WebGPURenderer({ antialias: false, alpha: false, forceWebGL: selectBackend().forceWebGL });
  // Backend creation is ASYNC, and Renderer.render() THROWS if it runs first
  // ("called before the backend is initialized"). launchDungeonGame stays sync
  // because neither caller awaits it (main.ts:328, mouse-room.ts:3053) — making
  // it async would silently reorder their teardown. So the loop skips frames
  // until this resolves; see the rendererReady gate in the render block.
  rendererReady = false;
  void state.renderer.init().then(() => {
    rendererReady = true;
  });
  state.renderer.setClearColor(PALETTE_HEX[0]);
  // One shadow-casting directional light needs the shadow map on. PCFSoft gives
  // a slightly feathered edge that survives the palette quantizer as a soft
  // band rather than a hard jagged step.
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFShadowMap;
  // The full shadow depth pass re-rendered every frame is a heavy fixed cost;
  // the loop re-flags the light on alternate frames instead (30 Hz shadows —
  // invisible under the pixel quantizer, halves the shadow pass).
  //
  // THIS THROTTLE IS PER-LIGHT, NOT PER-RENDERER. WebGPURenderer.shadowMap is
  // only { enabled, transmitted, type } — it has no autoUpdate/needsUpdate, so
  // the old renderer-level flags would have gone SILENTLY dead here and shadows
  // would quietly re-render every frame. three's WebGPU path gates on the light
  // instead (nodes/lighting/ShadowNode.js: `shadow.needsUpdate || shadow.autoUpdate`),
  // which setShadowsThrottled() below drives. See throttleShadows() in the loop.
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

  // The lighting rig (ambient/hemi/lamp/key + shadow config) — boot/lighting.ts.
  buildLights(BIOMES[0]);

  // ── VFX (sparks / blood / embers / dust / slashes) ──
  // Lives for the whole session (not per level); drawn into the scene so it
  // gets pixelated, quantized and bloomed with everything else.
  state.vfx = createVfx(state.scene);

  // ── Pinball aim indicator ──
  // Ground decal showing heading vs steer while rolling; hidden otherwise, so
  // it costs nothing visually outside ball form.
  state.aimIndicator = createAimIndicator();
  state.scene.add(state.aimIndicator.group);

  // ── Camera ──
  state.camera = createDungeonCamera();
  aimCamera(state.camera, 0, 0.5, 0);

  // ── Sprite sheets ── boot/sheets.ts builds every monster atlas.
  buildMonsterSheets();

  // Dev / QA `window.__dungeon*` hooks — see dev/window-hooks.ts. Everything a
  // headless harness drives (spawning, god-mode, pad injection, art QA) lives
  // there; the core-owned actions it needs are passed in, so the dependency
  // only ever points core → dev.
  // The debug VERBS (dev/debug-actions.ts) need one core-owned action; wire it
  // before installDevHooks, which exposes those verbs to the harness.
  setDebugActionDeps({ spawnReaper });
  installDevHooks({
    startLevel, descend, onPlayerDeath, openShop, applyPotion,
    debugSpawn, debugClearEnemies, exitDungeonGame, tearGraveHole,
  });

  // Hand-made pixel art overrides the procedural painters the moment it
  // exists: drop sprite-forge output at public/dungeon/sprites/knight-<id>.*
  // and the knight upgrades on next launch. Missing art = silent fallback.
  void loadAtlasSheet("knight-sword").then((sheet) => {
    if (!sheet || !state.active) return;
    // Hand-made art isn't gear-aware, so it overrides EVERY sword look.
    setHandmadeOverride("sword", sheet);
    if (activeWeapon().id === "sword" && state.player) {
      state.player.sprite.setSheet(sheet);
      state.player.silhouette?.syncMap();
    }
  });

  // Level-up fanfare: toast + modifier sting; the tree lives in the menu (I).
  setLevelUpHandler((level, points) => {
    showToast(`LEVEL ${level}`, `+1 skill point · ${points} unspent — press I`);
    sfxModifier();
  });

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

  // A slain overlord drops its reward here (kept out of combat.ts to avoid a
  // circular import).
  setBossDefeatedHandler(dropBossReward);

  // ── Co-op wiring ── the hooks coop.ts drives the shared world through, and
  // the bridge combat.ts forwards replica damage over. All injected here so
  // neither module imports core (no cycles).
  setCoopHooks({
    spawnGhost: (nid, kind, x, z, boss) => {
      // Snapshot said an enemy exists that we don't have — build a rendering
      // body for it. Sheet by kind, zombie-sheet fallback for exotic kinds.
      const sheet =
        kind === "reaper" || boss
          ? reaperSheet()
          : {
              zombie: state.zombieSheet,
              spider: state.spiderSheet,
              brute: state.bruteSheet,
              spitter: state.spitterSheet,
              ghost: state.ghostSheet,
              bat: state.batSheet,
              slime: state.slimeSheet,
              goblin: state.goblinSheet,
              pin: state.pinSheet,
              golem: state.golemSheet,
              chomper: state.chomperSheet,
              magnet: state.magnetSheet,
              webspinner: state.webspinnerSheet,
            }[kind as string] ?? state.zombieSheet;
      if (!sheet) return null;
      const z2 = makeZombie(sheet, x, z, 0, { kind, boss });
      z2.nid = nid; // adopt the authority's id (makeZombie minted a local one)
      bumpZombieNid(nid);
      // The Death Dealer's warning toast fires in spawnReaper — authority-only.
      // Without this, the replica player meets an immune scythe ghost with NO
      // explanation and reads it as a broken boss (exactly what live QA did).
      if (kind === "reaper") {
        showToast("☠ THE DEATH DEALER ☠", "it cannot be slain — take the stairs");
        state.shakeT = Math.max(state.shakeT, 0.3);
      }
      if (boss) {
        // The Reaper King's ghost looms like the real thing.
        z2.baseTint = REAPER_TINT;
        z2.sprite.setTint(REAPER_TINT);
        z2.sprite.mesh.scale.multiplyScalar(1.55);
      }
      state.zombies.push(z2);
      return z2;
    },
    spawnGhostItem: (nid, kind, id, x, z) => {
      // A CARD arrives over the wire as an instance id ("spidersilk#4s") and
      // ITEM_PAINTS is keyed by card KIND, so the raw id misses. cardBase is a
      // no-op on every other kind's id.
      const paint = ITEM_PAINTS[id] ?? ITEM_PAINTS[cardBase(id)];
      if (!paint || !state.scene) return null;
      const sprite = createStaticSprite(paint);
      sprite.mesh.position.set(x, 0, z);
      state.scene.add(sprite.mesh);
      const it: GroundItem = { nid, kind, id, x, z, sprite, bobPhase: Math.random() * 6 };
      state.groundItems.push(it);
      return it;
    },
    removeZombie: (z) => {
      state.scene?.remove(z.sprite.mesh);
      z.sprite.dispose();
    },
    removeItem: (it) => {
      state.scene?.remove(it.sprite.mesh);
      it.sprite.dispose();
    },
    onRemoteKill: (x, z, kind, boss) => {
      // The authority killed something on our floor: gibs + SHARED kill gold
      // (co-op pays every knight — gold is per-client, not split).
      if (kind === "ghost") state.vfx?.sparks(x, 0.6, z, 0, 0, 22);
      else state.vfx?.blood(x, 0.6, z, "green", 20);
      spawnCoin(x, z, boss ? BOSS_GOLD : GOLD_PER_KILL);
      if (boss) state.shakeT = Math.max(state.shakeT, 0.4);
    },
    applyDamage: (z, dmg, dx, dz, push) => {
      // A replica's hit, already gated by THEIR momentum — apply it raw
      // (force), except the untouchable Death Dealer.
      if (z.kind === "reaper") return;
      damageZombie(z, dmg, dx, dz, push, true);
    },
    hurtPlayer: (dmg, srcX, srcZ) => hitPlayerRanged(dmg, srcX, srcZ),
    tearHole: (x, z, name) => tearGraveHole(x, z, name),
  });
  setCoopCombatBridge({ isReplica, forward: coopForwardDamage, onKill: coopBroadcastKill });
  // A new knight joining the pool is announced wherever you are standing. Keyed
  // "dungeon" so re-entering replaces the hook rather than stacking one per
  // descend; presence drops it on stopPresence.
  onPeerArrive("dungeon", (p) => {
    showToast("🛡️ A KNIGHT HAS ARRIVED", `${p.name} joined the pool`);
  });
  // A slain big slime queues two minis, spawned after combat resolution.
  setSlimeSplitHandler(queueMini);
  setCardRollHandler(dropCardMaybe);
  // Every kill drops magnet-collected coins on the floor.
  setCoinDropHandler(spawnCoin);
  // …and a chance at themed alchemy reagents (RO-style loot).
  setReagentDropHandler(dropReagentsMaybe);
  // A shattered brick golem sprays ricochet shards.
  setGolemShatterHandler((x, z) => {
    golemShards(x, z);
    // Elite reward: a shattered brick golem sometimes yields a marble — biased
    // toward STONE (beat stone with stone), else a random material.
    if (Math.random() < 0.5) {
      const m: MarbleMaterial = Math.random() < 0.6 ? "stone" : MATERIAL_LIST[Math.floor(Math.random() * MATERIAL_LIST.length)];
      spawnMaterialDrop(x, z, m);
    }
  });
  // A BLOATER bursts into a burning puddle on death.
  setBloaterBurstHandler((x, z) => spawnFloorFx("fire", x, z, BLOATER_BURST_RADIUS, FIRE_PUDDLE_LIFE, true));
  // A NECROMANCER raises an add — deferred past the horde loop (like slime split).
  setSummonHandler(queueSummon);
  // Catching the rolling merchant opens its shop.
  setMerchantCaughtHandler(openShop);
  resetCombatJuice();

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
    const target = descendInto(floor);
    state.lastTime = performance.now();
    state.animFrameId = requestAnimationFrame(loop);
    // The seed may still be in flight — re-seed this floor if it disagrees.
    adoptPoolSeedWhenItArrives(target);
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


/** Build (or rebuild) a depth: maze, decoration, geometry, actors, loot. */
function startLevel(level: number): void {
  if (!state.scene) return;

  // Bank any coins still on the old floor BEFORE it's torn down — disposeLevel
  // deletes ground items outright, and a coin deleted before absorb is gold the
  // player earned and never received.
  sweepCoins();
  disposeLevel(); // tears down the previous maze + horde + loot, keeps the player
  disposeBoss(); // drop any Reaper King skulls/telegraph/portal from the old floor
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
  const biome = biomeFor(level);
  tintLights(biome);

  // One deterministic stream per (run, level): a refresh mid-run rerolls the
  // run, but a single level is internally consistent and replayable.
  const rng = mulberry32((state.runSeed ^ (level * 0x9e3779b9)) >>> 0);
  // Corridors, then ROOMS carved over them (bumper chamber / speedway / arena /
  // vault), then a few CRACKED secret walls — all on the raw grid, all before
  // thickening, so the wall-band structure survives. Thick walls are what make
  // the Diablo low-rim/tall-back trick work — see thickenWalls. Decoration
  // runs on the thickened grid, with room rects scaled to match.
  // FLOOR ARCHETYPE: the macro layout — Warrens / Spine / Great Hall / Cavern /
  // Ring Keep. It pre-carves a SHAPE the maze then grows around, so descending
  // changes a floor's structure and not just its palette. Cycles every 5 while
  // the biome cycles every 4, so the pair takes 20 floors to repeat.
  const arch = archetypeFor(level);
  // MODIFIER: rolled from this floor's own seed (not a cycle), so two runs at
  // the same depth differ. Scales budgets only — see maze/modifiers.ts.
  const modifier = rollModifier(level, rng);
  // WINDINESS is the archetype's texture knob now, rolled inside its own range
  // rather than read off a flat depth cycle — two Caverns twenty floors apart
  // used to share a corridor character exactly. cfg.windiness stays as the
  // level-1 anchor and the fallback for callers that don't know the archetype.
  const windiness = windinessFor(level, arch, rng);
  const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
    seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
    solidSeeds: arch.solid,
    braidGradient: arch.braidGradient,
  });
  // A grade-S/A descent unlocked a BONUS room on this floor (Wave F glue).
  const bonusRoom = state.bonusRoomNext;
  state.bonusRoomNext = false;
  const rawRooms = carveRooms(raw, rng, cfg.rooms + (bonusRoom ? 1 : 0), ROOM_MIN_CELLS, ROOM_MAX_CELLS);
  // PREFAB STAMPS (Wave C): themed room/hallway shapes drawn from a seeded
  // shuffle bag — Slalom, Gauntlet, Oilworks, the Magician's Parlor… Carved
  // before the secret cracks so the cracks see the final wall set.
  const theme = themeFor(level, state.runSeed);
  // The floor's ONE set piece goes down FIRST, with priority and a wide mortar:
  // the Tilt Table, the Pachinko Drop, the Observatory… Regular stamps then
  // fill in around it, clustered on this floor's hot zones so the level has
  // loud rooms and quiet halls instead of an even sprinkle everywhere.
  const landmark = stampLandmark(raw, rng, theme);
  const focus = pickFocusCells(raw, rng);
  // More open-chamber prefabs per floor (Slice 2, open playfield) — the theme
  // pools are mostly open tables/halls, so this adds bounce-able area.
  const prefabCount = Math.min(3 + Math.floor((level - 1) / 2), 6);
  const stamped = stampPrefabs(raw, rng, prefabCount, theme, landmark.claimed, focus);
  crackSecretWalls(raw, rng, cfg.secrets);
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
  // `arch.seeds` shapes `raw`, and on a track floor `raw` is discarded — so the
  // five archetypes were shaping a grid nobody used while the descent card
  // below announced them by name (a blind census over 6 seeds × 10 depths could
  // not tell them apart on any statistic). `arch.track` is the profile that
  // makes the name true: node layout, loop floor, lane width, plaza, and how
  // much maze surrounds the circuit. Windiness rides along as the surrounding
  // maze's growing-tree bias — the same knob it always was, now on the branch
  // that ships. Clamped: at 1.0 the surround is a pure backtracker with no
  // junctions at all, and at 0 it is all junctions and no corridor.
  const track = TRACK_FIRST
    ? buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
        profile: arch.track,
        density: Math.max(0.35, Math.min(0.85, windiness)),
      })
    : null;
  let grid: Grid;
  let endpoints: { start: TilePos; stairs: TilePos } | null;
  if (track) {
    grid = track.grid;
    // Both endpoints sit ON the circuit and a lap apart, so the route between
    // them RIDES the track instead of treating it as scenery between errands.
    endpoints = { start: track.start, stairs: track.stairs };
  } else {
    grid = thickenWalls(raw);
    // Widen the main start→stairs artery into a 3-wide "launch highway" so the
    // floor plays as a machine and not a uniform 2-wide box maze. Reachability-
    // preserving (only carves wall→floor); runs BEFORE decorate so every stage —
    // topology/parts/arc-corners/render — sees the widened grid.
    // START + STAIRS are chosen ONCE here and shared by both the artery widener
    // and decorateMaze. Both used to derive them independently with the same
    // "top-left tile → farthest tile" rule, which put the exit in the
    // bottom-right corner of every floor; see pickEndpoints.
    endpoints = pickEndpoints(grid, rng);
    if (endpoints) widenMainArtery(grid, endpoints);
  }
  // Room rects and prefab anchors are authored in HALF-SCALE cell coords and
  // scaled ×2 to land on the thickened grid. The track floor is generated at
  // final resolution from its own geometry and never saw those stamps, so it
  // ships no room rects — decorateMaze's own sparse-region fill covers it.
  const rooms = track ? [] : rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
  // Prefab anchors ride the same ×2 into the thickened grid — the landmark's
  // first, so its set-piece furniture wins any tile the regular stamps also want.
  // Skipped on a track floor for the same reason as `rooms`: those stamps were
  // carved into `raw`, which the track floor does not use, so their anchors
  // would point at furniture that isn't there.
  const anchors: PrefabAnchor[] = track
    ? []
    : [...landmark.anchors, ...stamped.anchors].map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
  // Pinball-machine density grows with depth AND rides the floor's actual area
  // — the 4× floors change scaled zombies/torches/rooms but left this an
  // absolute cap, spreading 26 parts over ~26k late-game tiles (the "sparse"
  // read). The area term keeps parts-per-tile roughly constant as floors grow;
  // decorateMaze's sparse-region fill then guarantees no quadrant ships empty.
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + Math.floor(cfg.floorTiles / 2000);
  // The floor modifier scales the budgets (and only the budgets — it can't
  // reach connectivity). Every product is floored at a sane minimum so a harsh
  // roll can't produce a pitch-dark or furniture-free floor.
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(cfg.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(cfg.torches * modifier.torchMult)),
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
  paintSurfaces(grid, (state.runSeed ^ (level * 0x85ebca6b)) >>> 0, {
    mix: modifier.surfaceMix,
    coverage: modifier.surfaceCoverage,
    // The arrival tile and the exit stay baseline: mud underfoot on spawn reads
    // as broken controls, and terrain that steals the stairs is just a tax.
    safeSpots: [tileCenter(grid, plan.start.i, plan.start.j), tileCenter(grid, plan.stairs.i, plan.stairs.j)],
  });

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
  if (level >= 3 && level % BOSS_EVERY !== 0 && state.bruteSheet && state.stairs && state.scene) {
    const s = state.stairs;
    // A ring of bumpers two tiles out from the exit — carom off them mid-brawl.
    const ringSpots: Array<{ i: number; j: number }> = [];
    for (const [di, dj] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]] as const) {
      if (isWalkable(grid, s.i + di, s.j + dj)) ringSpots.push({ i: s.i + di, j: s.j + dj });
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
      state.zombies.push(makeZombie(state.bruteSheet, c.x, c.z, cfg.zombieSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" }));
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
}

/** Tab / 1 / 2 — switch hands. Switching to an empty slot is allowed (fists). */
function selectSlot(slot: number): void {
  if (slot === state.activeSlot || state.gameOver) return;
  state.activeSlot = slot;
  // Cancel any in-flight swing/charge on the swap. A ranged fire animation left
  // running when you switch to a melee weapon would otherwise strand the attack
  // timeline (melee path expects p.move) and freeze the knight in the fire
  // frame — the "gun back to sword breaks the animation" bug. Reset to a clean
  // idle so the new weapon starts fresh.
  const p = state.player;
  if (p) {
    p.attackT = -1;
    p.move = null;
    p.chargeT = -1;
    p.comboStep = 0;
    p.comboWindowT = 0;
    p.anim.setRate(1);
    p.anim.play("idle", { force: true });
  }
  const w = WEAPONS[activeWeapon().id];
  showPickupNote(`${w.icon} ${w.label.toUpperCase()} in hand`);
  state.hudDirty = true;
}

function handleKey(e: KeyboardEvent): void {
  if (!state.active) return;
  // The walkable tavern owns the keyboard while it is up. Without this the
  // dungeon still fires abilities underneath it — `e` is Q/E ability here and
  // the interact key there.
  if (isTavernSceneOpen()) return;

  // ── The floor-haul screen is up: Space/Enter/Escape continue to the tavern,
  // everything else is swallowed (including the map — the floor is over). ──
  if (state.cardReaderEl) {
    if (e.key === " " || e.key === "Enter" || e.key === "Escape") advanceCardReader();
    e.preventDefault();
    return;
  }

  // ── Game menu is open: Esc/I close, Tab/arrows cycle tabs, 1-5 jump. ──
  if (state.menuEl) {
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "i") closeGameMenu();
    else if (k === "tab" || k === "arrowright") cycleMenuTab(1);
    else if (k === "arrowleft") cycleMenuTab(-1);
    else if (/^[1-5]$/.test(k)) menuTabByIndex(Number(k) - 1);
    e.preventDefault();
    return;
  }
  // M — the floor map. Free inside the dungeon now that the site map yields the
  // key for the run (see map/map-overlay.setMapSuppressed).
  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    if (state.container) toggleFloorMap(state.container);
    return;
  }

  // ── Shop is open: number keys buy, Escape/enter leaves; nothing else. ──
  if (state.shopEl) {
    if (e.key === "Escape") {
      closeShop();
    } else if (/^[1-9]$/.test(e.key)) {
      const rows = state.shopEl.querySelectorAll("[data-shop-row]");
      (rows[Number(e.key) - 1] as HTMLElement | undefined)?.click();
    }
    e.preventDefault();
    return;
  }

  switch (e.key.toLowerCase()) {
    // Esc/I open the menu (leaving the run is the menu's confirmed ABANDON
    // button now — a reflexive Esc must not vaporize a good run).
    case "escape":
    case "i":
      e.preventDefault();
      closeFloorMap(); // the menu freezes the world; a stale map under it lies
      if (state.container) {
        openGameMenu(state.container, { onAbandon: exitDungeonGame, paintPortrait: paintMenuPortrait });
      }
      return;

    // ── Weapon slots (plain 1/2) · quick-use belt (Shift+1..4) ──
    case "tab":
      e.preventDefault(); // don't let focus walk out of the game
      selectSlot(1 - state.activeSlot);
      break;
    // ── Quick-use belt potions (plain 1..4) ──
    case "1": useBeltSlot(0); break;
    case "2": useBeltSlot(1); break;
    case "3": useBeltSlot(2); break;
    case "4": useBeltSlot(3); break;

    // ── RAMPAGE: the FPS ultimate (only when the meter is full) ──
    case "r":
      if (canRampage()) enterRampage();
      break;

    // ── Q/E active skills (Diablo HUD). In rampage Q/E steer the FPS camera. ──
    case "q":
      if (!state.fpsActive) castAbility(0);
      break;
    case "e":
      if (!state.fpsActive) castAbility(1);
      break;

    // Everything else (spawn, descend, boss, reaper, FX toggles, fill-rampage,
    // teleport) lives in the ` debug panel now — no more scattered letter keys.
  }
}

function dropBossReward(x: number, z: number): void {
  // The windfall drops as a FISTFUL of coins (spawnCoin caps the count and
  // self-credits when headless) — the milestone should be something you watch
  // fly into you, not a number that appears. Deliberately ahead of the scene
  // guard: the gold must land even in a headless harness.
  spawnCoin(x, z, BOSS_GOLD);
  if (!state.scene) return;
  showToast("OVERLORD SLAIN", `+${BOSS_GOLD} gold · the way down is clear`);
  const drops: Array<{ id: string; dx: number; dz: number }> = [
    { id: "health", dx: -0.5, dz: 0 },
    { id: "gold", dx: 0.5, dz: 0 },
  ];
  for (const d of drops) {
    const sprite = createStaticSprite(ITEM_PAINTS[d.id]);
    const px = x + d.dx;
    const pz = z + d.dz;
    sprite.mesh.position.set(px, 0, pz);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ nid: nextItemNid(), kind: "potion", id: d.id, x: px, z: pz, sprite, bobPhase: Math.random() * 6 });
  }
  state.hudDirty = true;
}


/**
 * How long we keep WATCHING for the shared seed after a floor has been built.
 *
 * MEASURED, not guessed: with two clients connecting at once under software
 * rendering, the second one's handshake completed at ~2.0s (the first's at
 * ~1.6s). A 1.2s budget expired while that client was still `connecting`, so it
 * kept a private floor — the bug this reconciliation exists to fix. 5s leaves
 * real headroom on a slow link.
 *
 * Nothing is blocked while this runs (see adoptPoolSeedWhenItArrives), so a
 * generous window costs an offline player only a handful of cheap frame checks.
 */
const POOL_SEED_WAIT_MS = 5000;

/**
 * How long after landing we keep watching for a pool-mate who descended in the
 * same breath (see regroupWithPoolWhenTheyLand).
 *
 * Sized off the SAME measurement as POOL_SEED_WAIT_MS — a second client's
 * handshake can take ~2s, and until it lands neither knight is in the other's
 * roster. Past this window a player is playing the floor, and moving them is
 * worse than letting them regroup through the join board.
 */
const REGROUP_WINDOW_MS = 6000;

/**
 * Resolve once the pool seed is known — or once the wait times out.
 *
 * ⚠️ It is NOT enough to check `isCoop()` and bail when it's false. At the
 * moment a run begins the socket is often still OPENING: `isCoop()` reads false,
 * an early return fires, and the floor is generated from a local seed a
 * heartbeat before `welcome` would have supplied the shared one. That is the
 * exact race this function exists to close, so it waits for the seed itself and
 * lets the TIMEOUT — not a connection probe — decide when to give up.
 *
 * Returns immediately only when the seed is already in hand. On timeout it
 * resolves anyway rather than rejecting: an offline player, or one whose backend
 * is slow, must get a private floor rather than a hang.
 */
/**
 * Adopt the shared seed if it shows up AFTER the floor was already built, and
 * rebuild that floor so it matches everyone else's.
 *
 * ⚠️ WHY NOT BLOCK THE DESCENT INSTEAD. The obvious version — await the seed,
 * then generate — was built first and was WRONG: it holds the whole game behind
 * a network round-trip, and under software rendering the polling chain that
 * implemented it got starved and never resolved at all, so the run simply never
 * started (the harness saw hooks present but `active` forever undefined).
 * Blocking a boot on a backend that may not answer is a bad trade regardless of
 * how the wait is written.
 *
 * So the descent is never delayed. The floor is generated at once from a local
 * seed; if `welcome` lands later and disagrees, we rebuild the CURRENT floor
 * against the shared seed. A solo player never pays anything, and a pool player
 * gets a one-off regeneration in the first moments instead of a hang.
 *
 * Only ever fires while still on the floor the run started on: rebuilding under
 * someone who has already descended would teleport them into a fresh maze.
 */
/**
 * 🪜 THE ONE WAY DOWN from the tavern — used by the plunger, the join board and
 * the retry-after-death path alike.
 *
 * Descending is no longer personal. `resolveDescendFloor` sends you to the floor
 * the POOL is on, because the alternative (everyone to their own resume depth)
 * is what made two players who entered one after the other play two separate
 * games: the server relays world/act to same-scene peers only, so two floors are
 * two worlds and every co-op feature — shared enemies, shared loot, scaled boss
 * — silently never fired. An explicit join-board pick still wins; your own
 * resume floor is the fallback when the pool is all still in the tavern.
 *
 * Arriving deep with a level-1 knight is made survivable by `applyDelveCatchUp`,
 * not by keeping the pool apart.
 *
 * Returns the floor actually entered.
 */
function descendInto(explicit?: number): number {
  const target = resolveDescendFloor(peers(), loadResumeFloor(), explicit);
  startLevel(target); // startLevel adopts the shared pool seed (coopSeed) if connected
  initCoop(); // spin up dungeon-scene pool presence (no-op offline)
  grantDelveBoon(target);
  regroupWithPoolWhenTheyLand(target);
  return target;
}

/** Scale a knight who DROPPED to this depth up to what the depth expects, and
 *  say so. No-op on floor 1 and for anyone who walked down honestly. */
function grantDelveBoon(target: number): void {
  const boon = applyDelveCatchUp(target);
  if (!boon) return;
  const p = state.player;
  if (p && boon.hearts > 0) p.hp = Math.min(playerMaxHp(), p.hp + boon.hearts);
  const bits = [
    boon.levels > 0 ? `+${boon.levels} LVL` : "",
    boon.hearts > 0 ? `+${boon.hearts} ❤` : "",
    boon.upgrade > 0 ? `+${boon.upgrade} BLADE` : "",
  ].filter(Boolean);
  showToast(`⚗️ DELVER'S BOON · FLOOR ${target}`, bits.join("  ·  ") || "kitted for the depth");
}

/**
 * Converge with the pool when two knights descended in the same breath.
 *
 * Both resolved their target against a roster that did not know about the other
 * yet, so they can land on different floors — the exact "we entered one after
 * the other and got separate games" failure, just compressed into one second.
 * A moment later both rosters agree and `regroupTarget` (which counts the
 * caller's OWN floor) returns the same answer on both machines, so exactly one
 * of them moves.
 *
 * Same shape and the same reasoning as `adoptPoolSeedWhenItArrives`: never block
 * the descent on the network, generate at once, reconcile if the pool disagrees,
 * and only ever while the player is still standing on the floor they arrived on
 * — regrouping someone mid-fight would be worse than being apart.
 */
function regroupWithPoolWhenTheyLand(startedOnLevel: number): void {
  const started = performance.now();
  const tick = (): void => {
    if (!state.active || !isCoop()) return;
    if (state.level !== startedOnLevel) return; // they moved on — leave them alone
    const target = regroupTarget(peers(), state.level);
    if (target !== null) {
      showToast("🧲 REGROUPING", `the pool is on floor ${target}`);
      startLevel(target);
      grantDelveBoon(target);
      // Re-arm the seed watcher: the one the descent started gives up the
      // moment `state.level` changes, and a floor rebuilt while `welcome` is
      // still in flight would keep a private maze on the floor we just moved to.
      adoptPoolSeedWhenItArrives(target);
      return;
    }
    if (performance.now() - started > REGROUP_WINDOW_MS) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function adoptPoolSeedWhenItArrives(startedOnLevel: number): void {
  if (coopSeed() !== null) return; // already shared — nothing to reconcile
  const started = performance.now();
  const tick = (): void => {
    if (!state.active) return;
    const seed = coopSeed();
    if (seed !== null) {
      // Someone else's world is authoritative. Rebuild only if we actually
      // disagree, and only if the player hasn't moved on to another floor.
      if ((seed >>> 0) !== state.runSeed && state.level === startedOnLevel) {
        startLevel(startedOnLevel);
      }
      return;
    }
    if (poolStatus() === "closed" || performance.now() - started > POOL_SEED_WAIT_MS) return;
    // requestAnimationFrame, NOT setTimeout: under software rendering the timer
    // queue is starved hard enough that a 30ms chain stalls outright, while RAF
    // is tied to the frames the game is already producing.
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Lay out every corpse pile stored for this floor as ground items.
 *
 * ⚠️ THE POSITION IS NOT TRUSTWORTHY. Floors are regenerated from the run seed
 * every time you enter them, so the tile you died on may now be solid wall (or
 * off-grid entirely, if the maze came out smaller). A pile inside a wall is gear
 * the player can see and never reach — the exact failure this feature exists to
 * prevent. So the saved spot is a HINT: `nearestOpenTile` walks out to the
 * closest standable tile, the same fix `tearGraveHole` uses for departed peers.
 *
 * Items fan out around that tile so a ten-item pile reads as a scatter of loot
 * rather than one sprite with nine hidden underneath it.
 */
function spawnCorpsePiles(grid: Grid, level: number): void {
  if (!state.scene) return;
  const me = myId();
  for (const pile of pilesOnFloor(level)) {
    let t = worldToTile(grid, pile.x, pile.z);
    if (!isWalkable(grid, t.i, t.j)) {
      const open = nearestOpenTile(grid, t.i, t.j, 1);
      if (!open) continue; // this floor has nowhere to put it — try again next visit
      t = open;
    }
    const centre = tileCenter(grid, t.i, t.j);
    pile.items.forEach((item, n) => {
      const paint = ITEM_PAINTS[item.id];
      if (!paint) return; // an id from an older build — skip the sprite, keep the save
      const sprite = createStaticSprite(paint);
      // Fan out on a small ring; index 0 sits dead centre on the death spot.
      const ang = (n / Math.max(1, pile.items.length)) * Math.PI * 2;
      const r = n === 0 ? 0 : 0.34;
      const x = centre.x + Math.cos(ang) * r;
      const z = centre.z + Math.sin(ang) * r;
      sprite.mesh.position.set(x, 0, z);
      state.scene!.add(sprite.mesh);
      state.groundItems.push({
        kind: item.kind,
        id: item.id,
        x,
        z,
        sprite,
        bobPhase: Math.random() * Math.PI * 2,
        durability: item.durability,
        rarity: item.rarity,
        cards: item.cards,
        upgrade: item.upgrade,
        // OWNER-ONLY. Monster loot stays shared with the pool; a corpse is not
        // loot, it's the player's own run sitting on the floor. Checked at the
        // pickup funnel so the pile still RENDERS for everyone.
        corpseOwner: pile.owner,
        corpseId: pile.id,
      });
    });
    if (canLoot(pile, me)) {
      showToast("⚰️ YOUR KIT IS HERE", `${pile.items.length} item${pile.items.length === 1 ? "" : "s"} from a previous death`);
    }
  }
}

/**
 * Serialize everything the knight is carrying into a corpse pile.
 *
 * Weapons and cards carry their full identity (durability, rarity, sockets,
 * upgrade level) because losing a +3 legendary and recovering a plain one would
 * be worse than losing it outright. Gear is a bare slot→durability map in this
 * codebase (see items.GearState), so that is all there is to carry.
 *
 * The starting sword is deliberately INCLUDED. It is worth little, but a pile
 * that silently omits part of what you were holding teaches players not to
 * trust the mechanic, and that distrust costs more than the sword.
 */
function collectCorpseItems(): CorpseItem[] {
  const items: CorpseItem[] = [];
  for (const w of state.weaponSlots) {
    if (!w || w.id === "fists") continue;
    items.push({ kind: "weapon", id: w.id, durability: w.durability, rarity: w.rarity, cards: w.cards, upgrade: w.upgrade });
  }
  for (const [slot, dur] of Object.entries(state.gear)) {
    if (typeof dur !== "number" || dur <= 0) continue;
    items.push({ kind: "gear", id: slot, durability: dur });
  }
  for (const id of state.cardStash) items.push({ kind: "card", id });
  return items;
}

function onPlayerDeath(): void {
  if (state.gameOver) return;
  state.gameOver = true;
  coopAnnounceDeath(); // final pose w/ mode:"death" — peers stop colliding with the body
  // Bank the loose change before the run is scored — the run tally on the death
  // screen should include coins that were still mid-flight when you died.
  sweepCoins();
  // Fire-and-forget at the call site is fine ONLY because submitRunScore itself
  // awaits and logs; the death screen must not wait on the network to appear.
  void submitRunScore();
  sfxGameOver();
  state.player?.sprite.setTint(0x6b7688); // drained

  // ── Drop the kit where you fell ──
  // Recorded BEFORE the inventory is cleared below, and persisted immediately:
  // a player who closes the tab on the death screen must still find their pile
  // when they come back, or the promise only holds for players who are polite
  // about how they quit.
  const dropped = collectCorpseItems();
  const p = state.player;
  addPile(state.level, p?.x ?? 0, p?.z ?? 0, myId() ?? "", dropped);
  // The floor you DIED on — not the deepest you reached. That difference is the
  // feature: the tavern sends you back to where your stuff is.
  saveResumeFloor(state.level);

  state.gameOverEl = showGameOver({
    droppedCount: dropped.length,
    // Death now returns you to the TAVERN with an empty pack, rather than
    // restarting at floor 1. The kit is not gone — it is on the floor above,
    // and the tavern's plunger offers the trip back.
    onRetry: () => {
      state.gameOverEl?.remove();
      state.gameOverEl = null;
      state.gameOver = false;
      returnToTavern();
    },
    onLeave: () => exitDungeonGame(),
  });
}

/**
 * Wake up in the tavern after a death: the run's carried kit is now lying on the
 * floor you died on, so the knight is reset to bare hands and sent to the hub.
 *
 * Wallet gold and legacy perks survive (they always have). What is new is that
 * losing the run no longer loses the gear — `state.cardStash` and the weapon and
 * gear slots are cleared here only because `collectCorpseItems` has already
 * written them to a pile.
 */
function returnToTavern(): void {
  state.kills = 0;
  state.goldRun = 0;
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  state.cardStash = [];
  // The cards found on the floor you died on are lying on your corpse now, not
  // in your hand — there is no haul to reveal on the way to the tavern.
  state.floorHaul = [];
  resetCombatJuice();
  if (state.player) {
    Object.assign(state.player, freshPlayerFields());
    state.player.sprite.setTint(null);
    state.player.hp = playerMaxHp(); // after fresh fields
  }
  beginRunLedger(); // the next descent is a NEW run for the board
  state.hudDirty = true;

  const deathFloor = state.level;
  if (!state.container) {
    startLevel(1);
    return;
  }
  // A death drops you into the hub in LOBBY mode, exactly like first entry: it
  // is where the pool gathers, and someone who just died is precisely the player
  // who wants to see whether anyone is on a floor worth joining.
  enterTavern(state.container, {
    stats: { grade: "-", floor: deathFloor, kills: 0, bestCombo: 0 },
    // Same single entry as first boot: rally onto the pool's floor, catch the
    // knight up to that depth, then reconcile the seed. `descendInto` also
    // re-runs initCoop — the death teardown dropped the dungeon-scene presence
    // subscriptions, and without re-installing them you descend into a floor
    // where no pool-mate is ever drawn.
    onDescend: (floor?: number) => {
      adoptPoolSeedWhenItArrives(descendInto(floor));
    },
    onAbandon: () => exitDungeonGame(),
    lobby: true,
  });
}

/**
 * A knight left the pool: detonate their body and tear a LETHAL hole where they
 * stood. Runs on every client — the floor authority calls it directly and
 * broadcasts, replicas call it from the mirrored `hole` act (coop.ts) — so the
 * hole exists once, in the same place, in everyone's world.
 *
 * The position is SNAPPED to a tile centre. Two reasons, and both matter:
 * the departing peer's last-known pose is whatever 15Hz `move` frame arrived
 * before they dropped, so it can sit fractionally inside a wall; and snapping
 * makes the hole land somewhere a player can actually be, rather than half
 * under a wall band where it would be an invisible instant-death trap.
 */
function tearGraveHole(x: number, z: number, name: string): void {
  const g = state.grid;
  if (!g || !state.scene) return;
  let t = worldToTile(g, x, z);
  if (!isWalkable(g, t.i, t.j)) {
    // They died against (or inside) geometry — put the hole on the nearest tile
    // a knight could stand on instead. n=1 is the ORDINAL of the first walkable
    // tile found, not a distance (see nearestOpenTile).
    const open = nearestOpenTile(g, t.i, t.j, 1);
    if (!open) return; // nowhere sane to put it — better no hole than a bad one
    t = open;
  }
  // Never stack a second hole on a tile that already has one: a departing pool
  // can re-use the same doorway, and two colliders on one spot is just waste.
  if (state.pinballParts.some((p) => p.kind === "gravepit" && p.i === t.i && p.j === t.j)) return;
  const c = tileCenter(g, t.i, t.j);

  // ── The detonation ──
  state.vfx?.burst(c.x, 0.5, c.z, PALETTE_HEX[12], 34, 5.5);
  state.vfx?.ring(c.x, c.z, PALETTE_HEX[11], GRAVEPIT_BLAST_RADIUS, GRAVEPIT_BLAST_LIFE);
  state.vfx?.blood(c.x, 0.6, c.z, "red", 26);
  state.shakeT = Math.max(state.shakeT, 0.55);
  state.hitstopT = Math.max(state.hitstopT, 0.06);
  sfxHeavy();
  // The blast damages ENEMIES only. A player standing next to the departure
  // point could not have seen it coming, and killing them for someone else's
  // disconnect is punishment without agency — the HOLE is the lasting threat.
  for (const zmb of state.zombies) {
    if (zmb.mode === "dead") continue;
    const dx = zmb.x - c.x;
    const dz = zmb.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > GRAVEPIT_BLAST_RADIUS) continue;
    const inv = d > 1e-3 ? 1 / d : 0;
    damageZombie(zmb, GRAVEPIT_BLAST_DAMAGE, dx * inv, dz * inv, 1.1, true);
  }

  // ── The scar ──
  spawnPinballPart("gravepit", c.x, c.z, g, state.scene);
  showToast("💀 A KNIGHT HAS FALLEN", `${name} left the pool — mind the hole`);
}

function descend(): void {
  // BANK ANY COINS STILL ON THE FLOOR before the tavern opens.
  //
  // Every other sweep site is a teardown (startLevel, death, exit), and the
  // tavern is not one — `startLevel` only runs when you LEAVE it, via
  // `onDescend` below. So without this, gold you killed for but never walked
  // over is missing from the purse in the one place gold is spendable: you
  // clear a floor, leave ~30g of coins lying in the maze, and the shop and the
  // gambler both read a balance that doesn't include it. `maxStake()` shrinks
  // too, so you can't even bet what you should be able to. It lands one floor
  // late, after you've already spent.
  //
  // A straight regression from making coins physical — before that, a kill was
  // banked the instant it happened.
  sweepCoins();

  // Grade the floor being left BEFORE startLevel resets the ledger.
  const { grade, gold } = gradeFloor();
  awardFloorXp(state.level, grade); // character XP, scaled by the grade
  state.goldRun += GOLD_PER_DESCENT + gold;
  addGold(GOLD_PER_DESCENT + gold, "dungeon-game");
  // A great floor unlocks a BONUS vault room on the next one (Wave F glue).
  state.bonusRoomNext = BONUS_ROOM_GRADES.includes(grade);
  sfxStairs();
  const nextLevel = state.level + 1;
  const kills = state.kills;
  const bestCombo = state.levelBestCombo;
  const floorCleared = state.level;

  // ── Between-floor TAVERN hub ── spend the run's gold + cards, then descend.
  const toTavern = (): void => {
    if (!state.container) {
      startLevel(nextLevel);
      showPickupNote(gold > 0 ? `FLOOR GRADE ${grade} · +${gold}g bonus` : `FLOOR GRADE ${grade}`);
      return;
    }
    enterTavern(state.container, {
      stats: { grade, floor: floorCleared, kills, bestCombo },
      onDescend: () => {
        startLevel(nextLevel);
        showPickupNote(gold > 0 ? `FLOOR GRADE ${grade} · +${gold}g bonus` : `FLOOR GRADE ${grade}`);
      },
      // The tavern's game menu (Esc/I) carries the same confirmed ABANDON as
      // the dungeon's; the tavern closes itself first, then this ends the run.
      onAbandon: () => exitDungeonGame(),
    });
  };

  // ── THE FLOOR HAUL ──
  // Every card found on this floor, read as one screen on the way out. This is
  // the ONLY place card faces are shown at size: mid-fight they are a corner
  // toast, because a modal in the middle of a bounce chain is an interruption
  // the player never asked for.
  //
  // The haul takes the same `cardReaderEl` pause the tavern takes, so `descend`
  // cannot re-fire from the stairs underneath it, and `toTavern` runs on its
  // dismissal. Emptied here whether or not it is shown — a haul carried into
  // the next floor would be revealed twice.
  const haul = state.floorHaul;
  state.floorHaul = [];
  if (getSettings().haulReveal) showCardHaul(haul, floorCleared, toTavern);
  else toTavern();
}


/**
 * Spawn the DEATH DEALER: an unkillable blood-red reaper that enters a dozen
 * tiles out from the player (through the walls — it doesn't care) and drifts
 * straight at them, accelerating forever. One per floor; the stairs erase it.
 */
function spawnReaper(): void {
  const p = state.player;
  if (!p || isReplica()) return; // replica floors get the authority's reaper via snapshot
  state.reaperOut = true;
  const a = Math.random() * Math.PI * 2;
  // Bespoke hooded-and-scythed art (was the ghost sheet dyed with REAPER_TINT).
  const reaper = makeZombie(reaperSheet(), p.x + Math.cos(a) * 12, p.z + Math.sin(a) * 12, REAPER_SPEED_BASE, {
    kind: "reaper",
    hp: REAPER_HP,
  });
  reaper.aggro = true;
  // The sheet is already painted blood-dark, so the tint is now only a faint
  // wash — enough that telegraph/flash clears restore the reaper's colour
  // rather than white, without washing the new art flat.
  reaper.baseTint = REAPER_TINT;
  reaper.sprite.setTint(REAPER_TINT);
  reaper.sprite.mesh.scale.multiplyScalar(REAPER_SCALE);
  state.zombies.push(reaper);
  showToast("☠ THE DEATH DEALER ☠", "it cannot be slain — take the stairs");
  state.shakeT = Math.max(state.shakeT, 0.3);
}

/**
 * Grade the floor being left: pace (time), carnage (share of the horde
 * killed) and style (best bounce combo), two marks each → S/A/B/C/D and a
 * gold bonus. The "play it again, but cooler" hook.
 */
function gradeFloor(): { grade: string; gold: number } {
  const kills = state.kills - state.levelStartKills;
  const share = kills / Math.max(1, state.levelHordeSize);
  let pts = 0;
  pts += state.levelT <= GRADE_TIME_FAST ? 2 : state.levelT <= GRADE_TIME_OK ? 1 : 0;
  pts += share >= GRADE_KILLS_FULL ? 2 : share >= GRADE_KILLS_OK ? 1 : 0;
  pts += state.levelBestCombo >= GRADE_COMBO_FULL ? 2 : state.levelBestCombo >= GRADE_COMBO_OK ? 1 : 0;
  const grade = pts >= 6 ? "S" : pts >= 5 ? "A" : pts >= 3 ? "B" : pts >= 2 ? "C" : "D";
  return { grade, gold: GRADE_GOLD[grade] ?? 0 };
}

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
    state.flowField = bfsDistancesOwned(g, pt.i, pt.j); // RETAINED on state across frames
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

  state.accumulator += frame;
  profBegin("sim (fixed steps)");
  let simSteps = 0;
  if (state.hitstopT > 0) {
    state.hitstopT = Math.max(0, state.hitstopT - frame);
    state.accumulator = Math.min(state.accumulator, FIXED_STEP);
  } else {
    while (state.accumulator >= FIXED_STEP) {
      state.accumulator -= FIXED_STEP;
      simulate(FIXED_STEP);
      simSteps++;
    }
  }
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

  // Boss bar: show it while the overlord is alive, hide once it's dead/gone.
  const boss = state.zombies.find((z) => z.boss && z.mode !== "dead");
  updateBossBar(state.bossBarEl, boss ? boss.hp : null, boss ? boss.maxHp ?? null : null);
  updatePlungerMeter(state.plungerMeterEl);

  const renderCam = state.fpsActive && state.fpsCamera ? state.fpsCamera : state.camera;
  // rendererReady: skip frames until the async backend init resolves. Simulation
  // above has already run, so a couple of dropped frames at launch cost nothing.
  if (state.scene && renderCam && state.pixelPass && rendererReady) {
    // Shadow throttle: per-light autoUpdate is off (see renderer setup); render
    // the shadow depth pass on alternate frames only.
    if (state.renderer) tickShadowThrottle();
    // GPU submission, not GPU completion: WebGL is async, so this measures the
    // CPU cost of building + submitting the passes. A small number here with a
    // large FRAME total means the cost is CPU-side, above this line.
    profBegin("pixelPass.render");
    state.pixelPass.render(state.scene, renderCam);
    profEnd("pixelPass.render");
    if (state.renderer) profCount("draw calls", state.renderer.info.render.calls);
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
  onExit?.();
}
