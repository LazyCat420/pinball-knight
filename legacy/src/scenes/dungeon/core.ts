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
import { state, resetState, freshPlayerFields, activeWeapon, type Zombie, type GroundItem, type EnemyKind, type MarbleMaterial } from "./state";
import { createPixelPass } from "./render/pixel-pass";
import { createVfx } from "./render/vfx";
import { createAimIndicator } from "./render/aim-indicator";
import { createPinballParts, updatePinballParts, updatePlungerRig, spawnPinballPart } from "./render/pinball-parts";
import { updateArcKickers } from "./render/arc-kickers";
import { updateArcLanes } from "./render/arc-lanes";
import { tickJuice, resetJuice } from "./entities/juice";
import { railCap } from "./entities/rail";
import { PINBALL_MAX_SPEED } from "./constants";
import { createTouchControls, isTouchDevice, type TouchControls } from "./touch-controls";
import { updateShots, rotateLanes } from "./shots";
import { loadAtlasSheet } from "./render/atlas-loader";
import { buildSpriteSheet, createActorSprite, createStaticSprite, createOcclusionSilhouette, reaperSheet, type SpriteSheet } from "./render/sprite";
import { Animator } from "./render/animator";
import { makeKnightPaints, makeZombiePaints, makeSpiderPaints, makeBrutePaints, makeSpitterPaints, makeGhostPaints, makeBatPaints, makeSlimePaints, makeBossPaints, makeGoblinPaints, makePinPaints, makeGolemPaints, makeChomperPaints, makeMagnetPaints, makeWebspinnerPaints, ZOMBIE_VARIANTS, ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { ZOMBIE_TYPES, ZOMBIE_TYPE_IDS, pickZombieType, typeHp, variantIndicesFor, type ZombieType } from "./zombie-types";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera, worldToScreenPx } from "./camera";
import { showToast, showGameOver, showControlsHint, showPickupNote, createFpsOverlay, setFpsOverlay, spawnFloatingCombo, createBossBar, updateBossBar, createPlungerMeter, updatePlungerMeter, openShopOverlay, refreshShopOverlay, type ShopEntry } from "./ui";
import { presentCardPickup, advanceCardReader, dismissCardReader } from "./card-reader";
import { openGameMenu, closeGameMenu, cycleMenuTab, menuTabByIndex, applySettingsLive } from "./menu";
import { renderKnightPortrait } from "./render/knight-portrait";
import { lookFromGear, lookKey } from "./render/knight-look";
import { getKnightSheet, setHandmadeOverride } from "./render/knight-sheets";
import { awardFloorXp, awardDebugXp as debugGrantXp, setLevelUpHandler, invalidateSkillAgg, playerMaxHp, skillAgg, syncAbilitySlots } from "./skill-runtime";
import { hasStartCardPerk } from "./legacy";
import { mountHUDs, renderHUD, refreshHUD } from "./hud";
import { rippleGlobe } from "./hud-diablo";
import { faceOnHeal, faceOnSpecial } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, tileCenter, worldToTile, at, isWalkable, type Grid, type TilePos, T_STAIRS } from "./maze/generator";
import { computeArcCorners } from "./collision";
import { decorateMaze, widenMainArtery, pickEndpoints, type PrefabAnchor } from "./maze/decorate";
import { authorLampPuzzle, lampCountFor } from "./maze/lamp-puzzle";
import { installLampPuzzle, updateLampPuzzle } from "./lamp-puzzle";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor, themeIndexFor } from "./maze/prefabs";
import { archetypeFor, windinessFor } from "./maze/archetypes";
import { resolveSpawnPoints, type SpawnLayout } from "./debug-spawn";
import { rollModifier } from "./maze/modifiers";
import { buildMaze } from "./maze/build";
import { bfsDistances, bfsDistancesOwned } from "./entities/ai";
import { updatePlayer, resetPlayerMotion, debugCurSpeed, debugWallNormal } from "./entities/player";
import { updateZombies, setSummonHandler } from "./entities/zombie";
import { updateProjectiles, golemShards } from "./entities/projectiles";
import { updateFloorFx, clearFloorFx, spawnFloorFx, updateGrooveHop } from "./entities/floor-fx";
import { updateMaterial, applyMaterial, isMaterial, MATERIALS, MATERIAL_LIST } from "./entities/marble";
import { simulateHazards } from "./entities/hazards";
import { updateNpcs, disposeNpcs, spawnFrog, spawnMerchant, setMerchantCaughtHandler, rollMagicianClock } from "./entities/npc";
import { syncActorMesh, setBossDefeatedHandler, setSlimeSplitHandler, setGolemShatterHandler, setBloaterBurstHandler, setCardRollHandler, setCoinDropHandler, setReagentDropHandler, resetCombatJuice, tickCombatTimers, damageZombie, setCoopCombatBridge, hitPlayerRanged } from "./entities/combat";
import { createDebugPanel } from "./debug-panel";
import { createInput } from "./input";
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
import { CARDS, STASH_MAX, rollCardDrop, socketCard, cardsOfRarity, type CardId } from "./cards";
import { enterTavern, isTavernSceneOpen, closeTavern } from "../tavern";
import { spawnBoss, updateBoss, disposeBoss } from "./boss";
import { initCoop, updateCoop, endCoop, isReplica, setCoopFloor, coopSeed, setCoopHooks, coopItemTaken, coopForwardDamage, coopBroadcastKill, coopAnnounceDeath, isCoop, enemyAuthorityIsMe } from "./coop";
import { stopPresence, onPeerArrive, myId, peers, poolStatus, startPresence } from "../../net/presence";
import { createFog, revealAround, exploredCount, exploredFraction } from "./fog";
import { toggleFloorMap, closeFloorMap, isFloorMapOpen } from "./map-overlay";
import { sfxStairs, sfxGameOver, sfxPickup, sfxCoin, sfxFreeze, sfxBumper, sfxLevelStart, sfxModifier, sfxBossReveal, sfxHeavy } from "./audio";
import { scoreRun, runDetail, type RunStats } from "./run-score";
import { saveLeaderboardScore } from "../../services/score-service";
import { loadBestDepth, saveBestDepth } from "./best-depth";
import { addPile, saveResumeFloor, loadResumeFloor, pilesOnFloor, floorsWithPiles, clearPile, canLoot, type CorpseItem } from "./corpse-run";
import { getPlayerName } from "../../services/player-name";
import { runPinballIntro } from "./intro";
import { frenzyIntensity } from "./entities/combo-curve";
import { profBegin, profEnd, profCount, profFrame, installProfilerHooks } from "./profiler";
import { installBotHooks } from "./playtest-bot";

/**
 * Presentation-only lights, module-scoped (not on `state`) — rebuilt on every
 * launch. `sun` casts the shadows and follows the camera; `lamp` is the hero's
 * personal readability light; ambient/hemi are kept so startLevel can re-tint
 * them per depth (the FF dungeon trick: deeper floors shift palette).
 */
let sun: THREE.DirectionalLight | null = null;
let lamp: THREE.PointLight | null = null;
// Parity counter for the 30 Hz shadow-map throttle (see the render loop).
let shadowFrameCounter = 0;
let ambient: THREE.AmbientLight | null = null;
/** The on-screen touch pad, when this device gets one (see createTouchControls). */
let touchControls: TouchControls | null = null;
let debugPanelDispose: (() => void) | null = null;
let hemi: THREE.HemisphereLight | null = null;

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
function playerSheetFor(id: WeaponId): SpriteSheet {
  return getKnightSheet(id, lookFromGear(state.gear), "dungeon");
}

/** Make the sprite match the active hand AND the worn gear. Runs every frame;
 * cheap no-op when the composite key hasn't changed. Because gear is part of
 * the key, a helmet pickup, an armory purchase, or a cuirass shattering
 * mid-fight all re-dress the knight with no extra hooks. */
function applyWeaponArt(): void {
  const id = activeWeapon().id;
  const key = lookKey(id, lookFromGear(state.gear));
  if (key === state.playerArtKey || !state.player) return;
  state.player.sprite.setSheet(playerSheetFor(id));
  state.player.silhouette?.syncMap();
  state.playerArtKey = key;
  // ── SKILL CARDS (cards.ts grantsAbility) ──
  // A card-granted ability lives on the weapon in HAND, so the hand changing can
  // invalidate a Q/E binding. Hooked HERE deliberately: this function is already
  // the one funnel every hand change passes through (pickup, swap, break, retry),
  // and the alternative — patching all five call sites — is a bug waiting for the
  // sixth one to be added. The key check above means this only fires on an actual
  // change, not every frame.
  if (syncAbilitySlots()) state.hudDirty = true;
}

/** The paperdoll painter handed to the menu — the live mirror of the knight. */
function paintMenuPortrait(canvas: HTMLCanvasElement): void {
  renderKnightPortrait(canvas, activeWeapon().id, lookFromGear(state.gear));
}

export function launchDungeonGame(onExit?: () => void): void {
  if (state.active) return;
  state.active = true;
  state.onExitCallback = onExit ?? null;
  state.runSeed = (Math.random() * 0x7fffffff) | 0;
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
  state.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  state.renderer.setClearColor(PALETTE_HEX[0]);
  // One shadow-casting directional light needs the shadow map on. PCFSoft gives
  // a slightly feathered edge that survives the palette quantizer as a soft
  // band rather than a hard jagged step.
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFShadowMap;
  // The full shadow depth pass re-rendered every frame is a heavy fixed cost;
  // the loop flags needsUpdate on alternate frames instead (30 Hz shadows —
  // invisible under the pixel quantizer, halves the shadow pass).
  state.renderer.shadowMap.autoUpdate = false;
  state.renderer.shadowMap.needsUpdate = true;
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
  ambient = new THREE.AmbientLight(BIOMES[0].amb, AMBIENT_INTENSITY);
  state.scene.add(ambient);

  // A little vertical shape, so wall tops separate from wall faces.
  hemi = new THREE.HemisphereLight(BIOMES[0].sky, BIOMES[0].ground, HEMI_INTENSITY);
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

  // ── Pinball aim indicator ──
  // Ground decal showing heading vs steer while rolling; hidden otherwise, so
  // it costs nothing visually outside ball form.
  state.aimIndicator = createAimIndicator();
  state.scene.add(state.aimIndicator.group);

  // ── Camera ──
  state.camera = createDungeonCamera();
  aimCamera(state.camera, 0, 0.5, 0);

  // ── Sprite sheets (the knight's is per-weapon) ──
  // A small pool of cosmetic zombie variants (ripped rags, gore, stumps, tone)
  // so a horde doesn't read as clones. Each spawn picks one by seed. Built once
  // per session — a handful of atlases is cheap.
  state.zombieVariantSheets = ZOMBIE_VARIANTS.map((v) => buildSpriteSheet(makeZombiePaints(v)));
  state.zombieSheet = state.zombieVariantSheets[0]; // legacy single-sheet handle
  state.spiderSheet = buildSpriteSheet(makeSpiderPaints());
  state.bruteSheet = buildSpriteSheet(makeBrutePaints());
  state.spitterSheet = buildSpriteSheet(makeSpitterPaints());
  state.ghostSheet = buildSpriteSheet(makeGhostPaints());
  state.batSheet = buildSpriteSheet(makeBatPaints());
  state.slimeSheet = buildSpriteSheet(makeSlimePaints());
  state.bossSheet = buildSpriteSheet(makeBossPaints());
  // Wave-B bespoke monster atlases (were tinted reskins).
  state.goblinSheet = buildSpriteSheet(makeGoblinPaints());
  state.pinSheet = buildSpriteSheet(makePinPaints());
  state.golemSheet = buildSpriteSheet(makeGolemPaints());
  state.chomperSheet = buildSpriteSheet(makeChomperPaints());
  state.magnetSheet = buildSpriteSheet(makeMagnetPaints());
  state.webspinnerSheet = buildSpriteSheet(makeWebspinnerPaints());

  // Dev-only atlas preview hooks for headless art QA:
  //   `__dungeonAtlas(which)` → data URL of that actor's full sprite strip
  //   `__dungeonClips(which)` → the clip table ("S:idle"→[0,1], …) so a harness
  //                             can slice + label individual named frames.
  // `which` ∈ spider|brute|spitter|ghost|boss|knight|zombie.
  if (typeof window !== "undefined") {
    const sheetFor = (which: string): SpriteSheet | null =>
      which === "spider" ? state.spiderSheet :
      which === "brute" ? state.bruteSheet :
      which === "spitter" ? state.spitterSheet :
      which === "ghost" ? state.ghostSheet :
      which === "bat" ? state.batSheet :
      which === "slime" ? state.slimeSheet :
      which === "boss" ? state.bossSheet :
      which === "goblin" ? state.goblinSheet :
      which === "pin" ? state.pinSheet :
      which === "golem" ? state.golemSheet :
      which === "chomper" ? state.chomperSheet :
      which === "magnet" ? state.magnetSheet :
      which === "webspinner" ? state.webspinnerSheet :
      which === "knight" ? (state.playerArtKey ? state.playerSheets.get(state.playerArtKey) : null) ?? null :
      state.zombieVariantSheets[0] ?? null;
    (window as unknown as { __dungeonAtlas?: (which: string) => string | null }).__dungeonAtlas = (which: string) => {
      const img = sheetFor(which)?.texture.image as HTMLCanvasElement | undefined;
      return img ? img.toDataURL("image/png") : null;
    };
    (window as unknown as { __dungeonClips?: (which: string) => Record<string, number[]> | null }).__dungeonClips = (which: string) => {
      const sheet = sheetFor(which);
      return sheet ? Object.fromEntries(sheet.clips) : null;
    };
    // Dev telemetry for headless behaviour QA.
    (window as unknown as { __dungeonStats?: () => unknown }).__dungeonStats = () => ({
      projectiles: state.projectiles.length,
      hostileGlobs: state.projectiles.filter((pr) => pr.hostile).length,
      // x/z included so a harness can assert MOVEMENT (freeze stops the horde,
      // the magnet drags you in) — kind/hp alone cannot answer those.
      enemies: state.zombies.map((z) => ({ kind: z.kind, mode: z.mode, aggro: z.aggro, hp: z.hp, boss: !!z.boss, maxHp: z.maxHp, x: z.x, z: z.z })),
      playerHp: state.player?.hp,
      floorFx: state.floorFx.map((f) => f.kind),
    });
    // Dev: force a weapon into the active slot (QA the bow/gun/etc. without hunting
    // for a pickup). `__dungeonGive('bow')`.
    // Dev: bind any ability to a Q/E slot (QA a skill without the tree grind).
    // `__dungeonAbility(1, 'slickfield')`.
    (window as unknown as { __dungeonAbility?: (slot: number, id: string) => boolean }).__dungeonAbility = (slot: number, id: string) => {
      if (!(id in ABILITIES) || (slot !== 0 && slot !== 1)) return false;
      const aid = id as AbilityId;
      if (!state.unlockedAbilities.includes(aid)) state.unlockedAbilities.push(aid);
      state.abilitySlots[slot] = aid;
      state.hudDirty = true;
      return true;
    };
    (window as unknown as { __dungeonGive?: (id: string) => boolean }).__dungeonGive = (id: string) => {
      if (!(id in WEAPONS)) return false;
      state.weaponSlots[state.activeSlot] = freshWeapon(id as WeaponId);
      return true;
    };
    // Dev: die on demand. The corpse/resume loop is otherwise only reachable by
    // actually losing a fight, which a harness cannot do reliably — and "did my
    // kit drop where I fell" is exactly the thing that needs testing unattended.
    (window as unknown as { __dungeonDie?: () => unknown }).__dungeonDie = () => {
      onPlayerDeath();
      return { floor: state.level, piles: pilesOnFloor(state.level).length, resume: loadResumeFloor() };
    };
    // Dev: who is in the pool, where, and are we the floor authority. The only
    // way a harness can assert that per-floor scene isolation actually holds —
    // "8 players don't collide" is otherwise untestable without eyeballing two
    // browsers side by side.
    (window as unknown as { __dungeonPool?: () => unknown }).__dungeonPool = () => ({
      level: state.level,
      seed: state.runSeed,
      poolSeed: coopSeed(),
      connected: isCoop(),
      authority: enemyAuthorityIsMe(),
      me: myId(),
      peers: peers().map((p) => ({ name: p.name, scene: p.scene })),
      sameFloor: peers().filter((p) => p.scene === `dungeon:${state.level}`).length,
    });
    // Dev: read the corpse ledger without touching localStorage from the page.
    (window as unknown as { __dungeonCorpses?: (floor?: number) => unknown }).__dungeonCorpses = (floor?: number) => ({
      floors: floorsWithPiles(),
      piles: pilesOnFloor(floor ?? state.level),
      resume: loadResumeFloor(),
      onFloor: state.groundItems.filter((g) => g.corpseId).length,
    });
    // Dev: the floor map's exploration state — the only way a harness can see
    // whether fog is actually being revealed (the minimap is a canvas).
    (window as unknown as { __dungeonFog?: () => unknown }).__dungeonFog = () => {
      const g = state.grid;
      const f = state.fog;
      if (!g || !f) return null;
      return {
        w: f.w,
        h: f.h,
        rev: f.rev,
        seen: exploredCount(f),
        pct: Math.round(exploredFraction(f, g) * 100),
        mapOpen: isFloorMapOpen(),
      };
    };
    // Dev: the state VERIFY_CHECKLIST.md asserts on.
    //
    // Almost everything in that checklist is a canvas, a shader or a transient
    // DOM tile, so a harness driving the debug panel can click a control and
    // have no way to tell whether it did anything. This is the read-back.
    (window as unknown as { __dungeonProbe?: () => unknown }).__dungeonProbe = () => {
      const p = state.player;
      return {
        // §0 debug toggles
        godMode: state.godMode,
        infMana: state.infMana,
        noCooldown: state.noCooldown,
        // §2/§3 buffs — the timers the buff strip renders from
        buffs: p
          ? {
              rage: p.rageT,
              haste: p.hasteT,
              shield: p.shieldT,
              iron: p.ironT,
              turbo: p.turboT,
              spring: p.springT,
              curve: p.curveT,
              magBoots: p.magBootsT,
              multiBall: p.multiBallT,
              magnetAura: p.magnetAuraT,
              bladeStorm: p.bladeStormT,
              webbed: p.webbedT,
              oil: p.oilT,
              material: p.material,
              materialT: p.materialT,
              fuseMaterial: p.fuseMaterial,
            }
          : null,
        freezeT: state.freezeT ?? 0,
        potionIds: POTION_IDS.slice(),
        // §1 vitals
        hp: p?.hp ?? 0,
        mana: p?.mana ?? 0,
        // §4 rampage / HUD swap
        hudMode: state.hudMode,
        fpsActive: state.fpsActive,
        // The FPS camera ANGLE. Rampage is the one mode whose whole control
        // story is "where am I looking", and nothing else reads that back: a
        // harness can only infer it from where forward movement travels, which
        // is wrong — forward slides along walls, so two runs differ in heading
        // even when the camera never turned. That inference produced a false
        // PASS for a broken right-stick turn, which is why the angle is exposed
        // directly rather than derived.
        fpsYaw: state.fpsYaw,
        fpsPitch: state.fpsPitch,
        ultCharge: state.ultCharge,
        // §5 world.
        // `enemies` counts CORPSES too — Kill All damages every zombie to death
        // and they linger in the array playing their death FX, which is exactly
        // what distinguishes it from Clear (instant wipe, no FX). A harness
        // asserting "Kill All emptied the array" would be asserting the wrong
        // thing, so expose the live count separately.
        enemies: state.zombies.length,
        enemiesAlive: state.zombies.filter((z) => z.mode !== "dead").length,
        // Descending opens the TAVERN first; `level` only advances once you use
        // its descend plunger. Without this a harness reads "level stuck" and
        // calls a working hub a bug.
        tavernOpen: isTavernSceneOpen(),
        parts: state.pinballParts.length,
        level: state.level,
        gameOver: state.gameOver,
        weapon: state.weaponSlots[state.activeSlot]?.id ?? null,
      };
    };
    // Dev: socket a card straight into the active weapon. `__dungeonSocket('ember')`.
    // Card drops are random and socketing is several clicks deep in the tavern,
    // so without this there is no way for a harness to reach any state where a
    // weapon actually HAS cards — which is what the armory vice displays.
    (window as unknown as { __dungeonSocket?: (id: string) => boolean }).__dungeonSocket = (id: string) => {
      const w = state.weaponSlots[state.activeSlot];
      if (!w || !(id in CARDS)) return false;
      w.cards = [...(w.cards ?? []), id];
      return true;
    };
    // Dev: apply a potion directly (QA the Wave-F kit — freeze/turbo/curveshot/…
    // without hunting for a flask). `__dungeonPotion('freeze')`.
    (window as unknown as { __dungeonPotion?: (id: string) => boolean }).__dungeonPotion = (id: string) => {
      if (!(id in POTIONS)) return false;
      applyPotion(id as PotionId);
      return true;
    };
    // Dev: snapshot the live projectiles' velocities so a headless test can
    // confirm the arrow flew toward the aim point, not the movement facing.
    (window as unknown as { __dungeonProjectiles?: () => Array<{ kind: string; vx: number; vz: number }> }).__dungeonProjectiles = () =>
      state.projectiles.map((pr) => ({ kind: pr.kind, vx: pr.vx, vz: pr.vz }));
    // Dev: player movement/combat telemetry (sprint, roll, i-frames, position)
    // so a headless test can confirm sprint drains, a dodge rolls + grants
    // i-frames, and the roll covers ground.
    // Dev: the level's pinball parts (kind/position/direction) so a headless
    // test can navigate to a bumper/spring and verify the physics fire.
    (window as unknown as { __dungeonParts?: () => unknown }).__dungeonParts = () =>
      state.pinballParts.map((pt) => ({ kind: pt.kind, i: pt.i, j: pt.j, x: pt.x, z: pt.z, dirX: pt.dirX, dirZ: pt.dirZ, cooldownT: pt.cooldownT }));
    // Dev: NPC positions/kinds (merchant chase + shop QA).
    (window as unknown as { __dungeonNpcs?: () => unknown }).__dungeonNpcs = () =>
      state.npcs.map((n) => ({ kind: n.kind, x: n.x, z: n.z, phase: n.phase, shopped: !!n.shopped }));
    // Dev: the shot-identity layer (orbits/lanes/skill/named combos) — the
    // only way a headless harness can see whether a lap or a bank registered.
    (window as unknown as { __dungeonShots?: () => unknown }).__dungeonShots = () => ({
      orbitActive: state.orbitActive,
      orbitCount: state.orbitCount,
      orbitLaps: state.orbitLaps,
      laneLit: state.laneLit,
      lanesCleared: state.lanesCleared,
      skillArmed: state.skillArmed,
      skillT: Math.round(state.skillT * 10) / 10,
      shotChain: state.shotChain,
      namedPaid: Object.keys(state.namedPaid),
    });
    // Dev: light one lane of every bank, then rotate — proves the lane change
    // actually moves the lit lanes rather than being a no-op key.
    (window as unknown as { __dungeonLaneTest?: () => boolean }).__dungeonLaneTest = () => {
      const banks = new Set(state.pinballParts.filter((q) => q.lane !== undefined).map((q) => q.lane as number));
      if (banks.size === 0) return false;
      for (const id of banks) state.laneLit[id] = [true, false, false];
      const before = JSON.stringify(state.laneLit);
      rotateLanes();
      return JSON.stringify(state.laneLit) !== before;
    };
    // Dev: open the between-floor TAVERN without clearing a floor first — it's
    // where the holo cards live, and QA'ing them shouldn't need a full run.
    (window as unknown as { __dungeonTavern?: () => boolean }).__dungeonTavern = () => {
      if (!state.container || state.tavernEl || isTavernSceneOpen()) return false;
      enterTavern(state.container, {
        stats: { grade: "A", floor: state.level, kills: state.kills, bestCombo: state.levelBestCombo },
        onDescend: () => startLevel(state.level + 1),
        onAbandon: () => exitDungeonGame(),
      });
      return true;
    };
    // Dev: jump straight to a depth. The merchant, the magician and the reaper
    // all gate on level, so a harness that can't change floors can't test them.
    (window as unknown as { __dungeonLevel?: (n: number) => boolean }).__dungeonLevel = (n: number) => {
      if (state.gameOver || !Number.isFinite(n) || n < 1) return false;
      startLevel(Math.floor(n));
      return true;
    };
    // Dev: summon the Magician NOW (his visit clock is 45s ± 12 — far too long
    // to wait on to QA the room shuffle). He still bows before the trick.
    (window as unknown as { __dungeonMagician?: () => boolean }).__dungeonMagician = () => {
      if (state.npcs.some((n) => n.kind === "magician")) return false;
      state.magicianT = 0;
      state.level = Math.max(state.level, MAGICIAN_FROM_LEVEL);
      return true;
    };
    // Dev: force the merchant's shop open, and buy row i (shop-flow QA).
    (window as unknown as { __dungeonShop?: (buy?: number) => unknown }).__dungeonShop = (buy?: number) => {
      if (buy === undefined) openShop();
      else if (state.shopEl) (state.shopEl.querySelectorAll("[data-shop-row]")[buy] as HTMLElement | undefined)?.click();
      return { open: !!state.shopEl };
    };
    // Dev: the still-intact secret bands + the floor ledger (secret/reaper/grade QA).
    // ── Dev SPAWN CONSOLE ── the scriptable counterpart to the ` panel's enemy
    // chips. The chips are DOM clicks, which are unreliable to drive from a
    // harness (a silently-missed toggle cost this project two QA cycles), and
    // they place exactly one monster next to the knight — useless for the
    // questions worth asking, which almost all need a CROWD at a KNOWN RANGE.
    //
    //   __dungeonSpawn({kind:"zombie", count:8, ring:3})   ring at 3 tiles
    //   __dungeonSpawn({kind:"brute", count:1, at:{x,z}})  exact spot
    //   __dungeonSpawn({kind:"ghost", count:4, ring:2, hp:1, aggro:false})
    //   __dungeonSpawn({kind:"zombie", ztype:"hulk", count:1})  a SUB-TYPE
    //
    // Returns what was ACTUALLY placed (`spawned` can be < `requested` in a
    // tight room), so a test never asserts against a horde it did not get.
    (window as unknown as { __dungeonSpawn?: (spec: DebugSpawnSpec) => unknown }).__dungeonSpawn = (spec: DebugSpawnSpec) =>
      debugSpawn({ ...spec, count: spec?.count ?? 1 });
    // Dev: FRAME PROFILER — answers "why does it lag" with numbers.
    //   __dungeonProfile()      profile ~240 frames, print a table, auto-stop
    //   __dungeonProfileStop()  stop early
    // Play normally while it runs (bounce off walls to catch the jitter case).
    installProfilerHooks();
    // Dev: PLAYTEST BOT — drives the fake pad so a soak test needs no hands.
    //   __dungeonBot({ mode:"bounce", seconds:120, profile:true })
    //   __dungeonBotStop()
    // Reports stuck episodes, deaths, peak combo and any thrown errors.
    installBotHooks();
    // Dev: ONE OF EACH zombie sub-type in a ring — the silhouette check.
    //   __zombieTypes()          ring at 3 tiles, posed, not aggroed
    //   __zombieTypes(4)         wider ring
    // Returns each sub-type with where it landed and its resolved stats, so a
    // headless harness asserts against what was PLACED rather than what it hoped
    // for (a tight room can reject a hulk — see resolveZombieType).
    (window as unknown as { __zombieTypes?: (ring?: number) => unknown }).__zombieTypes = (ring = 3) => {
      const out: Array<{ ztype: string; x: number; z: number; hp: number; bodyR: number; scale: number }> = [];
      ZOMBIE_TYPE_IDS.forEach((t, i) => {
        const r = debugSpawn({
          kind: "zombie",
          ztype: t,
          count: 1,
          ring,
          // Fan them around the ring rather than stacking on one bearing.
          phase: (i / ZOMBIE_TYPE_IDS.length) * Math.PI * 2,
          aggro: false,
        });
        const zz = state.zombies[state.zombies.length - 1];
        if (r.spawned > 0 && zz) {
          out.push({
            ztype: zz.ztype ?? "shambler",
            x: +zz.x.toFixed(2),
            z: +zz.z.toFixed(2),
            hp: zz.hp,
            bodyR: zz.bodyR ?? ZOMBIE_R,
            scale: +zz.sprite.mesh.scale.x.toFixed(2),
          });
        }
      });
      return { placed: out.length, requested: ZOMBIE_TYPE_IDS.length, types: out };
    };
    // Dev: the live input picture — which keys are down, what the touch overlay
    // and the pad are reporting, and whether the poller is seeing a controller
    // at all. Controllers and touch have no other read-back headlessly.
    (window as unknown as { __dungeonInput?: () => unknown }).__dungeonInput = () => state.input?.debug() ?? null;
    // Dev: a FAKE CONTROLLER, because a headless harness has no pad and hand-
    // rolled `getGamepads` stubs get this wrong in a way that looks exactly like
    // a broken poller. A button already down on the pad's FIRST poll is treated
    // as held-at-connect and deliberately never fires (see gamepad.ts `prev:
    // null`) — so a stub that reports a press immediately, and holds it, can
    // never produce a tap no matter how many frames run. That cost a QA cycle.
    //
    // This hook always installs the pad AT REST and only presses when asked, so
    // the edge is real:
    //   __dungeonPad.connect()          plug in a resting pad
    //   __dungeonPad.tap(4)             press + release button 4 (LB → q)
    //   __dungeonPad.hold(4) / .release(4)
    //   __dungeonPad.stick(x, y)        left stick; .aim(x, y) for the right
    //   __dungeonPad.disconnect()
    // Buttons are the standard-mapping indices exported as BTN in gamepad.ts.
    // A tap needs TWO polls to be seen (press frame, release frame), so let at
    // least two animation frames pass before asserting.
    (window as unknown as { __dungeonPad?: unknown }).__dungeonPad = (() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
      const axes = [0, 0, 0, 0];
      const fake = { axes, buttons, connected: true, id: "debug fake pad (standard)", index: 0, mapping: "standard", timestamp: 0 };
      let plugged = false;
      const real = navigator.getGamepads?.bind(navigator);
      // Merge rather than replace: a real pad plugged in alongside must keep
      // working, and the poller already merges every connected pad.
      navigator.getGamepads = () => {
        const live = real ? Array.from(real()) : [];
        return (plugged ? [...live, fake] : live) as ReturnType<Navigator["getGamepads"]>;
      };
      const press = (i: number, v: boolean) => {
        if (i >= 0 && i < buttons.length) buttons[i] = { pressed: v };
      };
      return {
        connect() {
          for (let i = 0; i < buttons.length; i++) buttons[i] = { pressed: false };
          axes.fill(0);
          plugged = true;
          return "pad connected at rest";
        },
        disconnect() {
          plugged = false;
          return "pad disconnected";
        },
        hold: (i: number) => (press(i, true), `hold ${i}`),
        release: (i: number) => (press(i, false), `release ${i}`),
        /** Press and auto-release after `frames` polls, so the edge is clean. */
        tap(i: number, frames = 2) {
          press(i, true);
          let n = 0;
          const step = () => (++n >= frames ? press(i, false) : requestAnimationFrame(step));
          requestAnimationFrame(step);
          return `tap ${i}`;
        },
        stick: (x: number, y: number) => ((axes[0] = x), (axes[1] = y), `stick ${x},${y}`),
        aim: (x: number, y: number) => ((axes[2] = x), (axes[3] = y), `aim ${x},${y}`),
        state: () => ({ plugged, axes: [...axes], down: buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0) }),
      };
    })();
    // Dev: wipe the floor of enemies (and corpses). Returns how many went.
    (window as unknown as { __dungeonClear?: () => number }).__dungeonClear = () => {
      const n = state.zombies.length;
      debugClearEnemies();
      return n;
    };
    // Dev: the god-mode toggles, WITHOUT going through the panel's DOM. These
    // three are the difference between a QA script that works and one that
    // silently screenshots an ability that never fired for want of mana.
    // Call with no argument to read them back.
    (window as unknown as { __dungeonDebug?: (f?: Record<string, boolean>) => unknown }).__dungeonDebug = (f?: Record<string, boolean>) => {
      if (f) {
        if (f.god !== undefined) state.godMode = f.god;
        if (f.mana !== undefined) state.infMana = f.mana;
        if (f.noCd !== undefined) state.noCooldown = f.noCd;
        state.hudDirty = true;
      }
      return { god: state.godMode, mana: state.infMana, noCd: state.noCooldown };
    };
    // Dev: the BOOSTER rubber on the curved walls — world mid-point of each
    // band plus its live cooldown/flash, so a harness can warp beside one, fire
    // the ball into it and assert the kick actually fired (there is no other
    // read-back: the bands are geometry on a merged wall mesh).
    (window as unknown as { __dungeonKickers?: () => unknown }).__dungeonKickers = () =>
      (state.maze?.arcKickers ?? []).map((k) => ({ x: k.x, z: k.z, cooldownT: k.band.cooldownT, hitT: k.band.hitT }));
    // Dev: the BOOSTER LANES, same read-back plus the one thing a lane has that
    // rubber doesn't — `cw`, the direction it throws. A harness must enter WITH
    // the grain or the lane correctly ignores it, so a test that doesn't know
    // the direction is a test that fails for the wrong reason.
    // Dev: live BANKED RAIL state — the only read-back for a held ride. A rail
    // is invisible to __dungeonLanes (which reports authored geometry, not what
    // the knight is doing), so without this a harness cannot tell "riding" from
    // "touching a wall that happens to be curved".
    (window as unknown as { __dungeonRail?: () => unknown }).__dungeonRail = () => {
      const p = state.player;
      if (!p) return null;
      return {
        riding: p.rail.featureIdx >= 0,
        featureIdx: p.rail.featureIdx,
        rideT: +p.rail.rideT.toFixed(3),
        slipT: +p.rail.slipT.toFixed(3),
        speed: +p.momSpeed.toFixed(2),
        // The headline number: how far past the normal ceiling the ride has
        // pushed. 0 means the rail is not paying yet.
        overspeed: +Math.max(0, p.momSpeed - PINBALL_MAX_SPEED).toFixed(2),
        cap: PINBALL_MAX_SPEED,
        railCap: +railCap().toFixed(2),
      };
    };
    (window as unknown as { __dungeonLanes?: () => unknown }).__dungeonLanes = () =>
      (state.maze?.arcLanes ?? []).map((l) => ({
        x: l.x,
        z: l.z,
        cw: l.band.cw,
        a0: l.band.a0,
        span: l.band.span,
        cooldownT: l.band.cooldownT,
        hitT: l.band.hitT,
      }));
    // Dev: detonate a departing knight at (x,z) WITHOUT a second real client.
    // A pool departure needs two browsers and a disconnect timed by hand, which
    // is not a thing a harness can stage — so this calls the same function the
    // network path calls. Returns the tile the hole actually landed on (it
    // snaps, and refuses to stack), or null if the spot was unusable.
    (window as unknown as { __dungeonHole?: (x: number, z: number, n?: string) => unknown }).__dungeonHole = (x: number, z: number, n = "A KNIGHT") => {
      const before = state.pinballParts.length;
      tearGraveHole(x, z, n);
      const made = state.pinballParts.length > before ? state.pinballParts[state.pinballParts.length - 1] : null;
      return made ? { i: made.i, j: made.j, x: made.x, z: made.z } : null;
    };
    /** Dev: every grave pit on the floor — a harness cannot see parts otherwise. */
    (window as unknown as { __dungeonHoles?: () => unknown }).__dungeonHoles = () =>
      state.pinballParts.filter((p) => p.kind === "gravepit").map((p) => ({ i: p.i, j: p.j, x: p.x, z: p.z }));
    (window as unknown as { __dungeonSecrets?: () => unknown }).__dungeonSecrets = () =>
      state.maze?.secrets.map((s) => ({ i: s.i, j: s.j, x: s.x, z: s.z })) ?? [];
    (window as unknown as { __dungeonFloor?: () => unknown }).__dungeonFloor = () => ({
      levelT: state.levelT,
      // Where the floor began — a harness asserts NOTHING sends you back here.
      startX: state.levelStart.x,
      startZ: state.levelStart.z,
      hordeSize: state.levelHordeSize,
      killsThisFloor: state.kills - state.levelStartKills,
      bestCombo: state.levelBestCombo,
      reaperOut: state.reaperOut,
      // Wave A/E/F floor state, exposed for the headless harness.
      targets: `${state.targetsHit}/${state.targetsTotal}`,
      freezeT: state.freezeT,
      npcs: state.npcs.map((n) => n.kind),
      partKinds: Array.from(new Set(state.pinballParts.map((pt) => pt.kind))),
      shopOpen: !!state.shopEl,
      magicianT: state.magicianT,
      // Loop diagnostics (accumulator health for the harness).
      accumulator: state.accumulator,
      hitstopT: state.hitstopT,
      elapsed: state.elapsed,
      level: state.level,
    });
    // Dev: hurl the player into a pinball ride (headless secret-wall/physics
    // tests — spooling a real sprint with synthetic key events is flaky).
    (window as unknown as { __dungeonLaunch?: (dirX: number, dirZ: number, speed: number) => boolean }).__dungeonLaunch = (dirX: number, dirZ: number, speed: number) => {
      const p = state.player;
      const len = Math.hypot(dirX, dirZ);
      if (!p || len < 1e-4) return false;
      p.momX = dirX / len;
      p.momZ = dirZ / len;
      p.momSpeed = speed;
      return true;
    };
    // Dev: teleport the player (headless part-physics tests — a maze walk to a
    // specific bumper is unreliable to script with keys alone).
    (window as unknown as { __dungeonWarp?: (x: number, z: number) => boolean }).__dungeonWarp = (x: number, z: number) => {
      const p = state.player;
      if (!p) return false;
      p.x = x;
      p.z = z;
      p.momSpeed = 0;
      syncActorMesh(p);
      return true;
    };
    (window as unknown as { __dungeonPlayer?: () => unknown }).__dungeonPlayer = () => {
      const p = state.player;
      if (!p) return null;
      const ax = state.input?.axis() ?? { x: 0, z: 0 };
      return { plungerArmed: state.plungerArmed, plungerCharging: state.plungerCharging, x: p.x, z: p.z, hp: p.hp, rollT: p.rollT, iframes: p.iframes, clip: p.anim.getClip(), facing: p.facing, ax, sprint: state.input?.sprintHeld?.() ?? false, active: state.active, gameOver: state.gameOver, curSpeed: debugCurSpeed(), attackT: p.attackT, comboStep: p.comboStep, chargeT: p.chargeT, moving: !!p.move, kills: state.kills, sprintCharge: p.sprintCharge, wallMoveT: p.wallMoveT, wallMoveKind: p.wallMoveKind, wallNormal: debugWallNormal(), overcharge: p.overcharge, momSpeed: p.momSpeed, bounceCombo: p.bounceCombo, grabT: p.grabT, rideT: p.rideT, dropT: p.dropT, oilT: p.oilT, webbedT: p.webbedT, ironT: p.ironT, turboT: p.turboT, springT: p.springT, curveT: p.curveT, magBootsT: p.magBootsT };
    };
  }

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
      const paint = ITEM_PAINTS[id];
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
  setSlimeSplitHandler((x, z, speed) => pendingMinis.push({ x, z, speed }));
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
  setSummonHandler((x, z) => pendingSummons.push({ x, z }));
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
    const target = floor && floor > 0 ? floor : 1;
    startLevel(target); // startLevel adopts the shared pool seed (coopSeed) if connected
    initCoop(); // spin up dungeon-scene pool presence (no-op solo/offline)
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

/** Base HP per enemy family. */
const HP_BY_KIND: Record<EnemyKind, number> = {
  zombie: ZOMBIE_HP,
  spider: SPIDER_HP,
  brute: BRUTE_HP,
  spitter: SPITTER_HP,
  ghost: GHOST_HP,
  bat: BAT_HP,
  slime: SLIME_HP,
  reaper: REAPER_HP, // nominal — combat.ts makes it immune anyway
  goblin: GOBLIN_HP,
  pin: PIN_HP,
  golem: GOLEM_HP,
  chomper: CHOMPER_HP,
  magnet: MAGNET_HP,
  webspinner: WEBSPIN_HP,
  hound: HOUND_HP,
  bloater: BLOATER_HP,
  necromancer: NECRO_HP,
  warden: WARDEN_HP,
  wisp: WISP_HP,
  sapper: SAPPER_HP,
  crystalback: CRYSTAL_HP,
  mimic: MIMIC_HP,
};

/** Expansion-roster reused-sheet map: which existing atlas + tint + scale each
 *  new kind borrows (art is placeholder; behavior in zombie.ts carries identity). */
const EXPANSION_SKIN: Partial<Record<EnemyKind, { sheet: () => SpriteSheet | null; tint: number; scale: number }>> = {
  hound: { sheet: () => state.spiderSheet, tint: 0xc23a2a, scale: 1.05 }, // red hunting hound
  bloater: { sheet: () => state.slimeSheet, tint: 0xb6c24a, scale: 1.3 }, // bloated sickly gas-bag
  necromancer: { sheet: () => state.spitterSheet, tint: 0x8a5cd0, scale: 1.05 }, // purple caster
  warden: { sheet: () => state.bruteSheet, tint: 0x4f8fdb, scale: 1.05 }, // blue guardian
  wisp: { sheet: () => state.ghostSheet, tint: 0x6fe8e8, scale: 0.9 }, // cyan will-o-wisp
  sapper: { sheet: () => state.magnetSheet, tint: 0xf0e05a, scale: 0.95 }, // yellow charge-thief
  crystalback: { sheet: () => state.golemSheet, tint: 0x8fdfff, scale: 1.12 }, // crystalline golem
  mimic: { sheet: () => state.golemSheet, tint: 0xd9a441, scale: 0.8 }, // gold treasure-crate
};

/** Spawn an expansion enemy from its reused sheet + tint; null if art missing. */
function makeExpansion(kind: EnemyKind, x: number, z: number, speed: number): Zombie | null {
  const skin = EXPANSION_SKIN[kind];
  const sheet = skin?.sheet();
  if (!skin || !sheet) return null;
  const z2 = makeZombie(sheet, x, z, speed, { kind });
  z2.sprite.mesh.scale.multiplyScalar(skin.scale);
  z2.baseTint = skin.tint;
  z2.sprite.setTint(skin.tint);
  return z2;
}

/**
 * The Wave-B roster now has BESPOKE atlases (was tinted reskins). Each maps to
 * its own sheet + a display scale; no resting tint (the art carries identity).
 * `RESKIN` keeps its name so the debug ring + spawn table read unchanged.
 */
const RESKIN: Partial<Record<EnemyKind, { sheet: () => SpriteSheet | null; scale: number }>> = {
  goblin: { sheet: () => state.goblinSheet, scale: 1.0 },
  pin: { sheet: () => state.pinSheet, scale: 0.85 },
  golem: { sheet: () => state.golemSheet, scale: 1.12 },
  chomper: { sheet: () => state.chomperSheet, scale: 1.1 },
  magnet: { sheet: () => state.magnetSheet, scale: 0.95 },
  webspinner: { sheet: () => state.webspinnerSheet, scale: 1.05 },
};

/** Spawn a bespoke Wave-B enemy; returns null if its atlas isn't built. */
function makeReskin(kind: EnemyKind, x: number, z: number, speed: number): Zombie | null {
  const skin = RESKIN[kind];
  const sheet = skin?.sheet();
  if (!skin || !sheet) return null;
  const z2 = makeZombie(sheet, x, z, speed, { kind });
  z2.sprite.mesh.scale.multiplyScalar(skin.scale);
  return z2;
}

/**
 * Slime minis spawned by a split, DEFERRED to the end of the sim step —
 * killZombie fires inside loops over state.zombies, and minis born mid-swing
 * would be clipped by the very blow that split their parent.
 */
const pendingMinis: Array<{ x: number; z: number; speed: number }> = [];

function drainPendingMinis(): void {
  if (!pendingMinis.length) return;
  for (const spec of pendingMinis) {
    if (!state.slimeSheet) break;
    // Two minis scatter to either side of the corpse.
    for (const side of [-1, 1]) {
      const mini = makeZombie(state.slimeSheet, spec.x + side * 0.35, spec.z + (Math.random() - 0.5) * 0.3, spec.speed * SLIME_MINI_SPEED_MULT, {
        kind: "slime",
        hp: SLIME_MINI_HP,
      });
      mini.mini = true;
      mini.aggro = true; // it just watched you kill its parent
      mini.sprite.mesh.scale.multiplyScalar(SLIME_MINI_SCALE);
      state.zombies.push(mini);
    }
  }
  pendingMinis.length = 0;
}

/** Necromancer summons, deferred past the horde loop (spawning mid-iteration
 *  would corrupt the array being walked, same as slime split). */
const pendingSummons: Array<{ x: number; z: number }> = [];

function drainPendingSummons(): void {
  if (!pendingSummons.length) return;
  const speed = levelConfig(state.level).zombieSpeed;
  const sheet = state.zombieVariantSheets[0] ?? state.zombieSheet;
  for (const spec of pendingSummons) {
    if (!sheet) break;
    const add = makeZombie(sheet, spec.x + (Math.random() - 0.5) * 0.6, spec.z + (Math.random() - 0.5) * 0.6, speed, { kind: "zombie" });
    add.aggro = true; // raised to serve — already hunting
    state.zombies.push(add);
  }
  pendingSummons.length = 0;
}

/**
 * Spawn one enemy from a prebuilt sheet at a world point. Shared by the level
 * horde, the debug spawner, and the giant-spider spawns — every enemy runs the
 * same pathing/combat in updateZombies, differing only by `kind` + stats.
 */
/** Co-op network-id sequence — reset per floor. Creation order at startLevel is
 * seed-deterministic, so every pool member hands out the SAME nids and replicas
 * adopt the authority's snapshot without respawning a thing. Runtime spawns
 * (reaper, splits) only happen on the authority, whose counter keeps going. */
let zombieNidSeq = 0;
/** Ghost adoption saw an authority nid — keep our counter past it so a later
 * authority handover can't mint a colliding id. */
export function bumpZombieNid(nid: string): void {
  const n = Number(nid.replace(/^z/, ""));
  if (Number.isFinite(n) && n >= zombieNidSeq) zombieNidSeq = n + 1;
}

function makeZombie(
  sheet: SpriteSheet,
  x: number,
  z: number,
  speed: number,
  opts: { kind?: EnemyKind; hp?: number; boss?: boolean; maxHp?: number; ztype?: ZombieType } = {},
): Zombie {
  const kind = opts.kind ?? "zombie";
  const sprite = createActorSprite(sheet, false);
  // A ghost is SPECTRAL: knock its material translucent + disable the hard alpha
  // cutout so the see-through drape reads (it also renders after opaque actors).
  // The reaper shares the treatment, a shade more solid — it's a PRESENCE.
  if (kind === "ghost" || kind === "reaper") {
    const mat = sprite.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = kind === "reaper" ? 0.82 : 0.62;
    mat.alphaTest = 0.02;
    mat.depthWrite = false;
    sprite.mesh.renderOrder = 11;
  }
  state.scene!.add(sprite.mesh);
  const anim = new Animator(sprite);
  anim.setFacing("S");
  anim.play("idle");
  const nid = "z" + zombieNidSeq++;
  const z2: Zombie = {
    nid,
    sprite,
    anim,
    x,
    z,
    kind,
    hp: opts.hp ?? HP_BY_KIND[kind],
    maxHp: opts.maxHp,
    boss: opts.boss,
    mode: "idle",
    speed,
    windupT: 0,
    cooldown: 0,
    flashT: 0,
    aggro: false,
    burnT: 0,
    bobT: 0,
  };
  // ── ZOMBIE SUB-TYPE (zombie-types.ts) ──
  // Applied at the single construction site so the stat bundle and the collider
  // can never disagree. An explicit `opts.hp` still wins: a boss or a scripted
  // spawn sets HP deliberately and must not be re-scaled underneath it.
  const t = opts.ztype;
  if (t && t !== "shambler") {
    const d = ZOMBIE_TYPES[t];
    z2.ztype = t;
    z2.speed = speed * d.speedMult;
    if (opts.hp == null) z2.hp = typeHp(HP_BY_KIND[kind], t);
    if (opts.maxHp != null) z2.maxHp = typeHp(opts.maxHp, t);
    if (d.scale !== 1) {
      sprite.mesh.scale.multiplyScalar(d.scale);
      // NOT optional. state.ts's `bodyR` comment records the Reaper King walking
      // half-buried into corridors because a scaled mesh kept an unscaled
      // collider; zombie-types.test.ts asserts bodyRMult moves with scale.
      z2.bodyR = ZOMBIE_R * d.bodyRMult;
    }
    // Limp phase off the nid — deterministic across peers, distinct per actor,
    // so a pair of hobblers never limps in lockstep.
    if (d.gait === "limp") z2.gaitPhase = (Number(nid.replace(/^z/, "")) || 0) * 1.7;
    // A crawler has no legs: tip the billboard onto its belly. Rotation ONLY —
    // syncActorMesh re-pins y to 0 every frame, so a height offset set here
    // would be silently erased on the next update (which is why the ghost's
    // hover has to live in syncGhostMesh instead of on the actor).
    if (d.gait === "crawl") sprite.mesh.rotation.z = CRAWLER_PITCH;
  }
  syncActorMesh(z2);
  return z2;
}

/**
 * Pick + spawn one horde member for a spawn tile, given its hash. The special
 * families each own a residue class of the hash and only appear from their
 * FROM_LEVEL, so shallow floors are pure zombies and deeper floors mix in
 * spiders → brutes → spitters. Priority order matters (a spawn can only be one
 * thing): tank/ranged specials are checked before falling back to a zombie.
 */
/**
 * Spawn ONE enemy of an explicit kind, honouring its depth gate and sheet
 * availability — returns null if it's not unlocked yet or its art is missing,
 * so a themed pick can cleanly fall through to the base cascade. Only the
 * biome-favourable families are mapped; anything else returns null.
 */
function spawnKind(kind: EnemyKind, x: number, z: number, baseSpeed: number, level: number): Zombie | null {
  switch (kind) {
    case "brute":
      return level >= BRUTE_FROM_LEVEL && state.bruteSheet ? makeZombie(state.bruteSheet, x, z, baseSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" }) : null;
    case "spitter":
      return level >= SPITTER_FROM_LEVEL && state.spitterSheet ? makeZombie(state.spitterSheet, x, z, baseSpeed * SPITTER_SPEED_FACTOR, { kind: "spitter" }) : null;
    case "spider":
      return level >= SPIDER_FROM_LEVEL && state.spiderSheet ? makeZombie(state.spiderSheet, x, z, baseSpeed * SPIDER_SPEED_FACTOR, { kind: "spider" }) : null;
    case "ghost":
      return level >= GHOST_FROM_LEVEL && state.ghostSheet ? makeZombie(state.ghostSheet, x, z, baseSpeed * GHOST_SPEED_FACTOR, { kind: "ghost" }) : null;
    case "bat":
      return level >= BAT_FROM_LEVEL && state.batSheet ? makeZombie(state.batSheet, x, z, baseSpeed * BAT_SPEED_FACTOR, { kind: "bat" }) : null;
    case "slime":
      return level >= SLIME_FROM_LEVEL && state.slimeSheet ? makeZombie(state.slimeSheet, x, z, baseSpeed * SLIME_SPEED_FACTOR, { kind: "slime" }) : null;
    case "goblin":
      return level >= GOBLIN_FROM_LEVEL ? makeReskin("goblin", x, z, baseSpeed * GOBLIN_SPEED_FACTOR) : null;
    case "chomper":
      return level >= CHOMPER_FROM_LEVEL ? makeReskin("chomper", x, z, 0) : null;
    case "golem":
      return level >= GOLEM_FROM_LEVEL ? makeReskin("golem", x, z, 0) : null;
    case "magnet":
      return level >= MAGNET_FROM_LEVEL ? makeReskin("magnet", x, z, baseSpeed * MAGNET_SPEED_FACTOR) : null;
    case "webspinner":
      return level >= WEBSPIN_FROM_LEVEL ? makeReskin("webspinner", x, z, baseSpeed * WEBSPIN_SPEED_FACTOR) : null;
    case "hound":
      return level >= HOUND_FROM_LEVEL ? makeExpansion("hound", x, z, baseSpeed * HOUND_SPEED_FACTOR) : null;
    case "bloater":
      return level >= BLOATER_FROM_LEVEL ? makeExpansion("bloater", x, z, baseSpeed * BLOATER_SPEED_FACTOR) : null;
    case "necromancer":
      return level >= NECRO_FROM_LEVEL ? makeExpansion("necromancer", x, z, baseSpeed * NECRO_SPEED_FACTOR) : null;
    case "warden":
      return level >= WARDEN_FROM_LEVEL ? makeExpansion("warden", x, z, baseSpeed * WARDEN_SPEED_FACTOR) : null;
    case "wisp":
      return level >= WISP_FROM_LEVEL ? makeExpansion("wisp", x, z, baseSpeed * WISP_SPEED_FACTOR) : null;
    case "sapper":
      return level >= SAPPER_FROM_LEVEL ? makeExpansion("sapper", x, z, baseSpeed * SAPPER_SPEED_FACTOR) : null;
    case "crystalback":
      return level >= CRYSTAL_FROM_LEVEL ? makeExpansion("crystalback", x, z, 0) : null;
    case "mimic": {
      if (level < MIMIC_FROM_LEVEL) return null;
      const m = makeExpansion("mimic", x, z, baseSpeed * MIMIC_SPEED_FACTOR);
      if (m) { m.dormant = true; m.aggro = false; }
      return m;
    }
    default:
      return null; // zombie/pin/reaper aren't horde-rollable via theme bias
  }
}

/** Weighted-pick a themed kind from the hash, or null if the biome sets none. */
function themedHordePick(hash: number, x: number, z: number, baseSpeed: number, level: number): Zombie | null {
  const theme = themeFor(level, state.runSeed);
  if (!theme.enemies || hash % 100 >= THEME_HORDE_BIAS) return null;
  const kinds = Object.keys(theme.enemies) as EnemyKind[];
  let total = 0;
  for (const k of kinds) total += theme.enemies[k]!;
  if (total <= 0) return null;
  let r = (hash >>> 8) % total;
  for (const k of kinds) {
    r -= theme.enemies[k]!;
    if (r < 0) return spawnKind(k, x, z, baseSpeed, level);
  }
  return null;
}

function spawnHordeMember(hash: number, x: number, z: number, baseSpeed: number, level: number): Zombie {
  const themed = themedHordePick(hash, x, z, baseSpeed, level);
  if (themed) return themed;
  if (level >= BRUTE_FROM_LEVEL && hash % BRUTE_RATIO === 0 && state.bruteSheet) {
    return makeZombie(state.bruteSheet, x, z, baseSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" });
  }
  if (level >= SPITTER_FROM_LEVEL && hash % SPITTER_RATIO === 1 && state.spitterSheet) {
    return makeZombie(state.spitterSheet, x, z, baseSpeed * SPITTER_SPEED_FACTOR, { kind: "spitter" });
  }
  if (level >= SPIDER_FROM_LEVEL && hash % SPIDER_RATIO === 2 && state.spiderSheet) {
    return makeZombie(state.spiderSheet, x, z, baseSpeed * SPIDER_SPEED_FACTOR, { kind: "spider" });
  }
  if (level >= GHOST_FROM_LEVEL && hash % GHOST_RATIO === 3 && state.ghostSheet) {
    return makeZombie(state.ghostSheet, x, z, baseSpeed * GHOST_SPEED_FACTOR, { kind: "ghost" });
  }
  if (level >= BAT_FROM_LEVEL && hash % BAT_RATIO === 3 && state.batSheet) {
    return makeZombie(state.batSheet, x, z, baseSpeed * BAT_SPEED_FACTOR, { kind: "bat" });
  }
  if (level >= SLIME_FROM_LEVEL && hash % SLIME_RATIO === 4 && state.slimeSheet) {
    return makeZombie(state.slimeSheet, x, z, baseSpeed * SLIME_SPEED_FACTOR, { kind: "slime" });
  }
  // ── The Wave-B pinball roster (reskins; see RESKIN) ──
  if (level >= GOBLIN_FROM_LEVEL && hash % GOBLIN_RATIO === 1) {
    const zb = makeReskin("goblin", x, z, baseSpeed * GOBLIN_SPEED_FACTOR);
    if (zb) return zb;
  }
  if (level >= CHOMPER_FROM_LEVEL && hash % CHOMPER_RATIO === 5) {
    const zb = makeReskin("chomper", x, z, 0); // rooted — it IS the chokepoint
    if (zb) return zb;
  }
  if (level >= GOLEM_FROM_LEVEL && hash % GOLEM_RATIO === 5) {
    const zb = makeReskin("golem", x, z, 0);
    if (zb) return zb;
  }
  if (level >= MAGNET_FROM_LEVEL && hash % MAGNET_RATIO === 6) {
    const zb = makeReskin("magnet", x, z, baseSpeed * MAGNET_SPEED_FACTOR);
    if (zb) return zb;
  }
  if (level >= WEBSPIN_FROM_LEVEL && hash % WEBSPIN_RATIO === 2) {
    const zb = makeReskin("webspinner", x, z, baseSpeed * WEBSPIN_SPEED_FACTOR);
    if (zb) return zb;
  }
  // ── Baseline zombie — but WHICH zombie (zombie-types.ts) ──
  // The sub-type comes off the SAME hash the family cascade above used (re-mixed
  // inside pickZombieType so the two rolls do not correlate), never Math.random:
  // co-op peers each build the horde locally from the shared pool seed, so a
  // random draw here would disagree about who is a hulk.
  const ztype = resolveZombieType(pickZombieType(hash, level), x, z);
  const variantSheets = state.zombieVariantSheets;
  // The silhouette must agree with the stat story: a crawler wearing two good
  // legs is a lie the player notices immediately.
  const allowed = variantIndicesFor(ztype, ZOMBIE_VARIANTS);
  const vi = allowed[hash % allowed.length];
  const sheet = variantSheets[vi] ?? variantSheets[0] ?? state.zombieSheet!;
  return makeZombie(sheet, x, z, baseSpeed, { ztype });
}

/**
 * Veto a sub-type whose BODY does not fit where it is being spawned.
 *
 * A hulk's collider is ~1.5x a zombie's — wider than a 1-tile corridor tolerates
 * — so spawning one in a dead end wedges it in rock. That is the Reaper King bug
 * (see `Zombie.bodyR` in state.ts) in a new costume, and the cheapest honest fix
 * is to not place it there: fall through to a LURCHER, which keeps the "big slow
 * bruiser" beat with a body that fits.
 */
function resolveZombieType(t: ZombieType, x: number, z: number): ZombieType {
  if (t !== "hulk") return t;
  const g = state.grid;
  if (!g) return t;
  const c = worldToTile(g, x, z);
  let open = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (isWalkable(g, c.i + di, c.j + dj)) open++;
  }
  return open >= HULK_MIN_OPEN_NEIGHBOURS ? "hulk" : "lurcher";
}

/**
 * Drop a BOWLING PIN CREW: PIN_CREW_SIZE pins racked in triangle formation
 * around a centre tile (offsets in world units, clamped to walkable tiles by
 * nearestOpenTile fallback). They don't fight — they score.
 */
function spawnPinCrew(g: Grid, centre: TilePos): void {
  const rack: Array<[number, number]> = [
    [0, 0],
    [0.55, -0.35],
    [0.55, 0.35],
    [1.1, -0.7],
    [1.1, 0],
    [1.1, 0.7],
  ];
  const c = tileCenter(g, centre.i, centre.j);
  for (let k = 0; k < Math.min(PIN_CREW_SIZE, rack.length); k++) {
    const px = c.x + rack[k][0];
    const pz = c.z + rack[k][1];
    const t = worldToTile(g, px, pz);
    const spot = isWalkable(g, t.i, t.j) ? { x: px, z: pz } : (() => {
      const open = nearestOpenTile(g, centre.i, centre.j, k + 1);
      return open ? tileCenter(g, open.i, open.j) : c;
    })();
    const pin = makeReskin("pin", spot.x, spot.z, 0);
    if (pin) state.zombies.push(pin);
  }
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
  zombieNidSeq = 0; // per-floor network ids — deterministic across the pool
  itemNidSeq = 0;
  // Run-scoped, so it must be updated here rather than in the per-floor reset
  // below. `saveBestDepth` no-ops unless this genuinely beats the record.
  if (level > state.runDeepestFloor) state.runDeepestFloor = level;
  saveBestDepth(level);
  const cfg = levelConfig(level);

  // Depth grading: each biome down shifts the fill palette a family over.
  const biome = biomeFor(level);
  ambient?.color.setHex(biome.amb);
  if (hemi) {
    hemi.color.setHex(biome.sky);
    hemi.groundColor.setHex(biome.ground);
  }

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
  const grid = thickenWalls(raw);
  // Widen the main start→stairs artery into a 3-wide "launch highway" so the
  // floor plays as a machine and not a uniform 2-wide box maze. Reachability-
  // preserving (only carves wall→floor); runs BEFORE decorate so every stage —
  // topology/parts/arc-corners/render — sees the widened grid.
  // START + STAIRS are chosen ONCE here and shared by both the artery widener
  // and decorateMaze. Both used to derive them independently with the same
  // "top-left tile → farthest tile" rule, which put the exit in the
  // bottom-right corner of every floor; see pickEndpoints.
  const endpoints = pickEndpoints(grid, rng);
  if (endpoints) widenMainArtery(grid, endpoints);
  const rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
  // Prefab anchors ride the same ×2 into the thickened grid — the landmark's
  // first, so its set-piece furniture wins any tile the regular stamps also want.
  const anchors: PrefabAnchor[] = [...landmark.anchors, ...stamped.anchors].map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
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
    const skillPart = state.pinballParts
      .filter((q) => q.kind === "target" || q.kind === "bumper" || q.kind === "rollover")
      .map((q) => ({ q, d: Math.hypot(q.x - startPos.x, q.z - startPos.z) }))
      .filter((e) => e.d > 4 && e.d < PLUNGER_SKILL_RANGE)
      .sort((a, b) => a.d - b.d)[0]?.q;
    if (p) {
      // Base launch line: toward the skill part if there is one, else straight
      // down the widened artery toward the stairs.
      let dx = 0;
      let dz = 1;
      if (skillPart) {
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
        state.groundItems.push({ nid: "d" + itemNidSeq++, kind: "potion", id, x: c.x + dx, z: c.z, sprite, bobPhase: Math.random() * 6 });
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

  // ── Card reader is open: Space/Enter/Escape advance, everything else is
  // swallowed (including the map — the world is frozen for READING). ──
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

/** Dev-only: warp the player a couple of tiles from the level exit. */
function debugTeleportToStairs(): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p || !state.stairs) return;
  const c = tileCenter(g, state.stairs.i, state.stairs.j);
  p.x = c.x;
  p.z = c.z - 2; // stand a bit short of it so the beacon is in view
  syncActorMesh(p);
  snapCameraTo(p.x, p.z);
}

/**
 * The n-th nearest walkable tile to (ci,cj) by a small BFS ring scan — used by
 * the debug spawner so test enemies always land on real floor, never inside a
 * wall band. Returns null if nothing walkable is close.
 */
/**
 * The `n`-th walkable tile found scanning outward in ring shells from (ci, cj).
 *
 * NOTE the semantics: `n` is an ORDINAL, not a distance. Asking for n = 6 does
 * NOT get you a tile 6 tiles out — it gets the 6th walkable tile found, which
 * in an open area is still inside the r = 1 ring. Pass `minRing` when you
 * actually mean "no closer than this".
 */
function nearestOpenTile(g: Grid, ci: number, cj: number, n: number, minRing = 1): TilePos | null {
  const found: TilePos[] = [];
  for (let r = Math.max(1, minRing); r <= Math.max(6, minRing + 5) && found.length < n; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // ring shell only
        const i = ci + di;
        const j = cj + dj;
        if (isWalkable(g, i, j)) found.push({ i, j });
        if (found.length >= n) break;
      }
    }
  }
  return found[n - 1] ?? found[found.length - 1] ?? null;
}

/**
 * Dev-only: drop one zombie of each cosmetic variant plus a giant spider in a
 * ring around the player, so the horde's variety and the spider read at a
 * glance without hunting the maze. Bound to the hidden `p` key.
 */
function debugSpawnRing(): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || !state.scene) return;
  const sheets = [...state.zombieVariantSheets];
  const specs: Array<{ sheet: SpriteSheet; kind: EnemyKind }> = sheets.map((sheet) => ({ sheet, kind: "zombie" as EnemyKind }));
  if (state.spiderSheet) specs.push({ sheet: state.spiderSheet, kind: "spider" });
  if (state.bruteSheet) specs.push({ sheet: state.bruteSheet, kind: "brute" });
  if (state.spitterSheet) specs.push({ sheet: state.spitterSheet, kind: "spitter" });
  if (state.ghostSheet) specs.push({ sheet: state.ghostSheet, kind: "ghost" });
  if (state.batSheet) specs.push({ sheet: state.batSheet, kind: "bat" });
  if (state.slimeSheet) specs.push({ sheet: state.slimeSheet, kind: "slime" });
  // The Wave-B reskins, so the whole roster is inspectable in one ring.
  for (const kind of ["goblin", "pin", "golem", "chomper", "magnet", "webspinner"] as EnemyKind[]) {
    const skin = RESKIN[kind];
    const sheet = skin?.sheet();
    if (sheet) specs.push({ sheet, kind });
  }
  // Place each enemy on the nearest WALKABLE tile stepping outward from the
  // player (blind fixed offsets would bury them in a wall, and a spitter's glob
  // would then die on that wall before reaching you). Speed 0 poses them for
  // art QA; aggro=true so a spitter actually spits + a brute winds up.
  const pt = worldToTile(g, p.x, p.z);
  specs.forEach((spec, i) => {
    const spot = nearestOpenTile(g, pt.i, pt.j, i + 1) ?? pt;
    const c = tileCenter(g, spot.i, spot.j);
    const zz = makeZombie(spec.sheet, c.x, c.z, 0, { kind: spec.kind });
    const skin = RESKIN[spec.kind];
    if (skin) zz.sprite.mesh.scale.multiplyScalar(skin.scale);
    zz.aggro = true;
    zz.anim.setFacing("S");
    zz.anim.play("walk", { force: true });
    state.zombies.push(zz);
  });
  // Also scatter every potion in a tight ring right around the player, so a
  // small wiggle picks them all up (pickup + effect QA) and the art is visible.
  ["health", "rage", "haste", "shield", "gold", "ballform", "freeze", "multiball", "curveshot", "magnetboots"].forEach((id, i, arr) => {
    if (!state.scene) return;
    const sprite = createStaticSprite(ITEM_PAINTS[id]);
    const a = (i / arr.length) * Math.PI * 2;
    const px = p.x + Math.cos(a) * 0.6;
    const pz = p.z + Math.sin(a) * 0.6;
    sprite.mesh.position.set(px, 0, pz);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ kind: "potion", id, x: px, z: pz, sprite, bobPhase: i * 1.3 });
  });
}

// ── Debug-panel action helpers (used by the ` god-mode console) ──

/**
 * Build ONE enemy of any kind at a world position, bypassing the level gates.
 * The single place that knows which construction path a kind takes (plain
 * zombie sheet / reskin / spawnKind), so every debug spawn route shares it.
 */
function makeDebugEnemy(kind: EnemyKind, x: number, z: number, ztype?: ZombieType): Zombie | null {
  const speed = levelConfig(state.level).zombieSpeed;
  if (kind === "zombie") {
    // A sub-typed debug spawn must wear the matching SILHOUETTE, or the headless
    // art check is looking at a shambler with a hulk's stats and passes for the
    // wrong reason.
    const allowed = ztype ? variantIndicesFor(ztype, ZOMBIE_VARIANTS) : [0];
    const sheet = state.zombieVariantSheets[allowed[0]] ?? state.zombieVariantSheets[0] ?? state.zombieSheet;
    return sheet ? makeZombie(sheet, x, z, speed, { kind: "zombie", ztype }) : null;
  }
  if (RESKIN[kind]) return makeReskin(kind, x, z, speed);
  return spawnKind(kind, x, z, speed, 99); // level 99 clears every FROM_LEVEL gate
}

/** What a scripted spawn can ask for beyond "one of these, next to me". */
export interface DebugSpawnSpec extends SpawnLayout {
  kind: EnemyKind;
  /** Override starting HP — for damage maths you can actually assert on. */
  hp?: number;
  /** Default true. `false` leaves them idle, which is what you want when the
   *  thing under test is aggro/pathing itself rather than a fight. */
  aggro?: boolean;
  /** Centre the layout here instead of on the knight (world coords). */
  at?: { x: number; z: number };
  /**
   * Zombie SUB-TYPE to force (zombie-types.ts). Ignored for other kinds. Lets a
   * harness put one of each on screen for the silhouette check:
   *   __dungeonSpawn({kind:"zombie", ztype:"hulk", count:1})
   */
  ztype?: ZombieType;
}

/** What actually got placed — a harness asserts against this, not a guess. */
export interface DebugSpawnResult {
  spawned: number;
  requested: number;
  kind: string;
  points: Array<{ x: number; z: number }>;
}

/**
 * Spawn a GROUP of enemies in a known shape (see debug-spawn.ts) — the scripted
 * counterpart to the panel's one-click chips.
 *
 * Returns what was actually placed, including a `spawned < requested` when the
 * room was too tight, so a headless test never asserts against a horde it did
 * not get.
 */
function debugSpawn(spec: DebugSpawnSpec): DebugSpawnResult {
  const p = state.player;
  const g = state.grid;
  const requested = Math.max(0, Math.floor(spec.count));
  const empty: DebugSpawnResult = { spawned: 0, requested, kind: spec.kind, points: [] };
  if (!p || !g) return empty;
  // The Reaper is a floor-wide singleton with its own summon ritual, not a
  // thing you can place N of.
  if (spec.kind === "reaper") {
    if (!state.reaperOut) spawnReaper();
    return { ...empty, spawned: state.reaperOut ? 1 : 0 };
  }
  const cx = spec.at?.x ?? p.x;
  const cz = spec.at?.z ?? p.z;
  const points = resolveSpawnPoints(g, cx, cz, spec);
  const placed: Array<{ x: number; z: number }> = [];
  for (const pt of points) {
    const zz = makeDebugEnemy(spec.kind, pt.x, pt.z, spec.ztype);
    if (!zz) continue;
    zz.aggro = spec.aggro ?? true;
    const hp = spec.hp;
    if (hp !== undefined) {
      zz.hp = hp;
      zz.maxHp = Math.max(zz.maxHp ?? hp, hp); // maxHp is optional on Zombie
    }
    state.zombies.push(zz);
    placed.push({ x: pt.x, z: pt.z });
  }
  return { spawned: placed.length, requested, kind: spec.kind, points: placed };
}

/** Spawn one enemy of any kind next to the player, bypassing the level gates. */
function debugSpawnEnemy(kind: EnemyKind, count = 1): void {
  debugSpawn({ kind, count, ring: count > 1 ? 2 : 0 });
}

/** Kill every living enemy through the normal death path (FX + score fire). */
function debugKillAll(): void {
  for (const z of [...state.zombies]) {
    if (z.mode !== "dead") damageZombie(z, 9999, 0, 0, 0, true); // force: bypass the momentum gates
  }
  // Kill All can now actually kill the Death Dealer (it is immune to everything
  // else by design), so the one-per-floor latch has to be released or the Reaper
  // button silently does nothing for the rest of the floor. debugClearEnemies
  // already did this; forcing the gates made Kill All need it too.
  state.reaperOut = false;
}

/** Yank every enemy (and corpse) off the floor instantly — no FX, no score. */
function debugClearEnemies(): void {
  for (const z of state.zombies) state.scene?.remove(z.sprite.mesh);
  state.zombies.length = 0;
  state.reaperOut = false; // let the reaper be re-summoned after a clear
}

/**
 * The overlord's reward: a chunk of bonus gold banked instantly, plus a health
 * potion + a gold idol dropped on the floor where it died (so clearing the
 * milestone visibly pays out). Registered with combat via setBossDefeatedHandler.
 */
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
    state.groundItems.push({ nid: "d" + itemNidSeq++, kind: "potion", id: d.id, x: px, z: pz, sprite, bobPhase: Math.random() * 6 });
  }
  state.hudDirty = true;
}

/**
 * Begin a NEW run's leaderboard ledger.
 *
 * Separate from `startLevel`, which runs on every descent and wipes the
 * per-floor ledger. These fields must survive a descent — they describe the
 * whole run, which is what a leaderboard row is.
 */
function beginRunLedger(): void {
  state.runDeepestFloor = 1;
  state.runBestCombo = 0;
  state.runStartMs = performance.now();
  state.pausedRunS = 0;
  state.runScoreSubmitted = false;
  beginRunProgression();
}

/**
 * A NEW RUN's character progression: the tree resets with the run (roguelite),
 * the memoized aggregate re-reads any legacy perks bought since, and the Pack
 * Rat perk seeds the stash. Piggybacks on beginRunLedger because "what counts
 * as a new run" must have exactly one definition (launch AND retry hit it).
 */
function beginRunProgression(): void {
  state.charXp = 0;
  state.charLevel = 1;
  state.skillPoints = 0;
  state.skillRanks = {};
  state.unlockedAbilities = ["flippercharge", "arcanepulse"];
  state.seenCards = new Set();
  // The alchemy pouch is run-scoped — a new run starts you empty-handed (only
  // wallet gold + legacy perks carry over). See reagents.ts / recipes.ts.
  state.reagents = {};
  state.flasks = 0;
  state.bonusMaxHp = 0;
  invalidateSkillAgg();
  if (hasStartCardPerk()) {
    const bag = cardsOfRarity("common");
    state.cardStash.push(bag[Math.floor(Math.random() * bag.length)]);
  }
  if (state.player) state.player.hp = playerMaxHp();
}

/** Gather the run-scoped ledger into the shape `run-score.ts` grades. */
function currentRunStats(): RunStats {
  return {
    deepestFloor: state.runDeepestFloor,
    bestCombo: state.runBestCombo,
    kills: state.kills,
    gold: state.goldRun,
    durationS: state.runStartMs > 0 ? Math.max(0, (performance.now() - state.runStartMs) / 1000 - state.pausedRunS) : 0,
  };
}

/**
 * Post the finished run to the leaderboard.
 *
 * Guarded by `runScoreSubmitted` because death and the "leave" path can both
 * reach here for the same run, and a duplicated row is worse than a missing one.
 *
 * Deliberately awaited and its result inspected: `saveLeaderboardScore` returns
 * `Promise<boolean>` and a 4xx does NOT reject the underlying fetch, so a
 * fire-and-forget call reports a rejected score as a save. That exact bug hid
 * raccoon-tornado's failures for months — do not "simplify" this back.
 */
async function submitRunScore(): Promise<void> {
  if (state.runScoreSubmitted) return;
  state.runScoreSubmitted = true;

  const stats = currentRunStats();
  const score = scoreRun(stats);
  const name = getPlayerName();

  const ok = await saveLeaderboardScore(
    score,
    name,
    0, // maxAltitude — not meaningful here; the schema is shared across games
    0, // distance — ditto
    stats.deepestFloor, // tunnelDepth is the closest existing column to "how deep"
    "pinball-knight",
    runDetail(stats),
  );
  if (!ok) console.warn("[dungeon] leaderboard rejected the run score");
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
    // `|| ` not `?? ` — loadResumeFloor returns 0 (not nullish) when unset.
    // initCoop must run here too: the death teardown dropped the dungeon-scene
    // presence subscriptions, and without re-installing them you descend into a
    // floor where no pool-mate is ever drawn.
    onDescend: (floor?: number) => {
      const target = floor || loadResumeFloor() || 1;
      startLevel(target);
      initCoop();
      adoptPoolSeedWhenItArrives(target);
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
  if (state.container) {
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
  } else {
    startLevel(nextLevel);
    showPickupNote(gold > 0 ? `FLOOR GRADE ${grade} · +${gold}g bonus` : `FLOOR GRADE ${grade}`);
  }
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
    rarity: w.rarity,
    cards: w.cards,
    upgrade: w.upgrade,
    blockedUntilAway: true,
  });
}

/**
 * A weapon comes off the floor: into an empty slot if there is one, otherwise
 * it EXCHANGES with the active hand (the old weapon drops where the new one
 * lay). Either way the new weapon ends up in the active hand — picking a
 * thing up and not holding it would feel like a misclick.
 */
/** A kill rolled the dice — maybe spawn a modifier card on the floor. */
function dropCardMaybe(x: number, z: number, boss: boolean, kind: EnemyKind = "zombie", dropMult = 1, subType?: ZombieType): void {
  if (!state.scene) return;
  // `kind` + `subType` drive the AFFINITY pick (cards.ts): a card off a Ghost
  // should be a Ghost's card, and one off a HULK should be the Hulk card rather
  // than any old zombie chip. `dropMult` is the sub-type's loot weight.
  const id = rollCardDrop({ boss, floor: state.level, legendaryAllowed: !state.legendaryDropped, mythicAllowed: !state.mythicDropped, kind, subType, dropMult });
  if (!id) return;
  if (CARDS[id].rarity === "legendary") state.legendaryDropped = true;
  if (CARDS[id].rarity === "mythic") state.mythicDropped = true;
  const sprite = createStaticSprite(ITEM_PAINTS[id]);
  sprite.mesh.position.set(x, 0, z);
  state.scene.add(sprite.mesh);
  state.groundItems.push({ nid: "d" + itemNidSeq++, kind: "card", id, x, z, sprite, bobPhase: Math.random() * 6 });
}

/**
 * THE ONE PLACE a coin's value reaches the wallet. Absorb, cull and sweep all
 * funnel through here, which is what makes "never lose and never duplicate
 * gold" checkable rather than hopeful.
 */
function creditGold(v: number): void {
  if (v <= 0) return;
  // Coin Magnet ranks / the Lucky Coin legacy perk scale COIN value here, the
  // one funnel every physical coin credit passes through.
  const scaled = Math.round(v * skillAgg().goldMult);
  state.goldRun += scaled;
  addGold(scaled, "dungeon-game");
  state.hudDirty = true;
}

/** Runtime-drop network-id sequence (cards/potions/materials the authority
 * rolls mid-floor). Reset per floor beside zombieNidSeq. */
let itemNidSeq = 0;

/** Pull a ground item out of the world: unparent, free its GPU resources, drop
 * it from the list. Everything that removes an item goes through this — which
 * makes it the one funnel for co-op TAKE broadcasts: picking up a shared (nid'd)
 * item tells the floor so it vanishes on every screen. */
function removeGroundItem(k: number): void {
  const it = state.groundItems[k];
  if (!it) return;
  coopItemTaken(it); // no-op for coins/personal drops (no nid) or offline
  state.scene?.remove(it.sprite.mesh);
  it.sprite.dispose();
  state.groundItems.splice(k, 1);
  // A corpse pile is only DONE when its last item is off the floor. Clearing it
  // on the first pickup would strand the rest on a refresh; clearing it here
  // means an interrupted recovery (you grabbed the sword, then died again)
  // leaves the remainder recoverable, which is the whole promise.
  if (it.corpseId && !state.groundItems.some((g) => g.corpseId === it.corpseId)) {
    clearPile(it.corpseId);
  }
}

/**
 * How many physical coins a drop of `total` gold mints. One coin reads as a
 * bug; a handful reads as loot. Capped so a boss windfall is a satisfying
 * fistful and not a coin fountain.
 */
export function coinCountFor(total: number): number {
  return Math.max(1, Math.min(Math.floor(total), COIN_MAX_PER_DROP));
}

/**
 * Split `total` gold across `n` coins with ZERO drift: each coin gets the floor
 * share and the first `remainder` coins get one extra unit, so the values sum to
 * exactly `total` for every input. (Rounding `total / n` per coin — the obvious
 * version — either invents gold or eats it, and both are unacceptable when the
 * split sits between the kill and the wallet.)
 */
export function splitCoinValue(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0));
}

/**
 * Too many coins on the floor is a frame-rate problem, so the excess is
 * FORCE-CREDITED (oldest first) rather than left lying around or binned. The
 * player still gets every unit — they just don't get to watch it fly.
 */
function enforceCoinCap(): void {
  let live = 0;
  for (const it of state.groundItems) if (it.kind === "coin") live++;
  for (let k = 0; k < state.groundItems.length && live > COIN_LIVE_CAP; k++) {
    if (state.groundItems[k].kind !== "coin") continue;
    creditGold(state.groundItems[k].value ?? 0);
    removeGroundItem(k);
    k--;
    live--;
  }
}

/**
 * The floor is about to be torn down (descend, death, exit): every coin still
 * lying on it is CREDITED, not binned. Gold earned by killing a thing is the
 * player's whether or not they walked back over the drop — and disposeLevel
 * would otherwise silently delete it.
 */
export function sweepCoins(): void {
  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    if (state.groundItems[k].kind !== "coin") continue;
    creditGold(state.groundItems[k].value ?? 0);
    removeGroundItem(k);
  }
}

/**
 * A kill DROPS coins: the payout splits into a small burst of physical tokens
 * that pop out of the corpse, land, and get magnet-collected. Falls back to an
 * instant credit only when there's no scene (headless harness).
 */
function spawnCoin(x: number, z: number, value: number): void {
  const total = Math.floor(value);
  if (total <= 0) return;
  if (!state.scene) {
    creditGold(total);
    return;
  }
  const n = coinCountFor(total);
  const parts = splitCoinValue(total, n);
  for (let i = 0; i < n; i++) {
    // Fan the coins evenly around the corpse (plus jitter) so a burst spreads
    // instead of clumping — an even ring reads as "it burst out of the thing".
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.9;
    const spd = COIN_BURST_SPREAD * (0.45 + Math.random() * 0.75);
    const isStack = parts[i] >= COIN_STACK_VALUE;
    const paint = isStack ? ITEM_PAINTS.coinStack : ITEM_PAINTS.coin;
    const sprite = createStaticSprite(paint);
    // Shrink the dropped token to a Diablo-style pile — see COIN_DROP_SCALE.
    sprite.mesh.scale.multiplyScalar(isStack ? COIN_STACK_DROP_SCALE : COIN_DROP_SCALE);
    sprite.mesh.position.set(x, COIN_SPAWN_Y, z);
    state.scene.add(sprite.mesh);
    state.groundItems.push({
      kind: "coin",
      id: "coin",
      value: parts[i],
      x,
      z,
      sprite,
      bobPhase: Math.random() * Math.PI * 2,
      coin: {
        phase: "burst",
        y: COIN_SPAWN_Y,
        vx: Math.cos(ang) * spd,
        vy: COIN_BURST_VY * (0.85 + Math.random() * 0.3),
        vz: Math.sin(ang) * spd,
        age: 0,
        magT: 0,
        fromX: x,
        fromY: COIN_REST_Y,
        fromZ: z,
      },
    });
  }
  state.vfx?.sparks(x, COIN_SPAWN_Y, z, 0, 0, 5);
  enforceCoinCap();
}

/** Credit a reagent straight into the run pouch (headless fallback + arrival). */
function creditReagent(id: ReagentId): void {
  state.reagents[id] = (state.reagents[id] ?? 0) + 1;
  state.hudDirty = true;
}

/**
 * Roll a kill's themed reagent drops (reagents.ts) and scatter them as motes.
 * Each mote rides the SAME burst→rest→magnet flight as a coin (updateCoins keys
 * off `it.coin`, not the kind), so it fans out of the corpse and homes to the
 * knight — but it's absorbed into the alchemy pouch, not the purse.
 */
function dropReagentsMaybe(x: number, z: number, kind: EnemyKind, boss: boolean, dropMult = 1): void {
  const ids = rollReagentDrops(kind, { boss, dropMult });
  for (let i = 0; i < ids.length; i++) spawnReagentMote(x, z, ids[i], i, ids.length);
}

function spawnReagentMote(x: number, z: number, id: ReagentId, i: number, n: number): void {
  if (!state.scene) {
    creditReagent(id); // headless harness: no scene, just bank it
    return;
  }
  const sprite = createStaticSprite(ITEM_PAINTS[id]);
  sprite.mesh.scale.multiplyScalar(COIN_DROP_SCALE * 1.15); // a touch bigger than a coin
  sprite.mesh.position.set(x, COIN_SPAWN_Y, z);
  state.scene.add(sprite.mesh);
  const ang = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.9;
  const spd = COIN_BURST_SPREAD * (0.4 + Math.random() * 0.7);
  state.groundItems.push({
    kind: "reagent",
    id,
    x,
    z,
    sprite,
    bobPhase: Math.random() * Math.PI * 2,
    coin: {
      phase: "burst",
      y: COIN_SPAWN_Y,
      vx: Math.cos(ang) * spd,
      vy: COIN_BURST_VY * (0.85 + Math.random() * 0.3),
      vz: Math.sin(ang) * spd,
      age: 0,
      magT: 0,
      fromX: x,
      fromY: COIN_REST_Y,
      fromZ: z,
    },
  });
}

/** Drop a marble material on the floor (elite/vault reward; grabbed on contact). */
function spawnMaterialDrop(x: number, z: number, m: MarbleMaterial): void {
  if (!state.scene) return;
  const sprite = createStaticSprite(ITEM_PAINTS[m]);
  sprite.mesh.position.set(x, 0, z);
  state.scene.add(sprite.mesh);
  state.groundItems.push({ nid: "d" + itemNidSeq++, kind: "material", id: m, x, z, sprite, bobPhase: Math.random() * 6 });
}

/**
 * Coin physics — burst, rest, magnet.
 *
 * THE OLD BUG, because it is a bug class worth naming: the magnet was
 * `it.x += (p.x - it.x) * 0.22`, applied once per RENDERED FRAME. That is
 * exponential approach with the *frame* as its time unit, and it fails twice.
 * (1) It's far too fast to see: closing 2.6 → 0.45 units takes
 * log(0.45 / 2.6) / log(1 - 0.22) ≈ 7.1 frames — 118ms — so the coin existed
 * but nothing about it registered, which is exactly the "it's just the numbers"
 * complaint. (2) It's frame-rate dependent: the same coin took 118ms at 60Hz
 * and 49ms at 144Hz, because a per-frame fraction is not a speed, it's a speed
 * multiplied by whatever the display happens to refresh at.
 *
 * The fix is to stop smoothing and start INTEGRATING against `dt`. The burst is
 * ordinary projectile motion; the magnet is parametrized on ELAPSED TIME
 * (u = magT / COIN_MAGNET_TIME), so the flight lasts COIN_MAGNET_TIME seconds
 * at any refresh rate, exactly, and the arc is trivially shapeable. (Where you
 * genuinely do want exponential smoothing, the frame-rate-correct form is
 * `1 - Math.pow(1 - rate, dt * 60)` — but a fixed-duration flight is the better
 * fit for something the player is meant to watch land.)
 */
function updateCoins(dt: number): void {
  const p = state.player;
  // Magnet Aura widens the coin's OWN capture range rather than dragging the
  // coin itself (abilities.ts skips coins) — two systems writing one position in
  // the same frame is how you get jitter and double-speed pickups.
  const range = COIN_MAGNET_RANGE * (p && p.magnetAuraT > 0 ? COIN_AURA_RANGE_MULT : 1);

  for (const it of state.groundItems) {
    const c = it.coin;
    if (!c) continue;
    c.age += dt;

    if (c.phase === "burst") {
      c.vy -= COIN_GRAVITY * dt;
      c.y += c.vy * dt;
      it.x += c.vx * dt;
      it.z += c.vz * dt;
      // Bleed the outward scatter so coins land in a tight ring around the
      // corpse instead of skating off across the room.
      const drag = Math.max(0, 1 - COIN_BURST_DRAG * dt);
      c.vx *= drag;
      c.vz *= drag;
      if (c.y <= COIN_REST_Y) {
        c.y = COIN_REST_Y;
        if (-c.vy > COIN_SETTLE_VY) {
          c.vy = -c.vy * COIN_BOUNCE; // one or two diminishing bounces, then still
        } else {
          c.phase = "rest";
          c.vx = c.vy = c.vz = 0;
        }
      }
    } else if (c.phase === "rest") {
      // Deliberately the SAME bob the other ground items use, so a coin on the
      // floor reads as part of the same loot system as a potion or a card.
      c.y = COIN_REST_Y + Math.sin(state.elapsed * 2.6 + it.bobPhase) * 0.05;
      if (p && c.age >= COIN_ARM_TIME && Math.hypot(it.x - p.x, it.z - p.z) < range) {
        c.phase = "magnet";
        c.magT = 0;
        c.fromX = it.x;
        c.fromY = c.y;
        c.fromZ = it.z;
      }
    } else if (p) {
      // MAGNET: ease-IN toward the LIVE player position (so it keeps homing if
      // they run) along an arc that RISES to chest height. u² starts slow and
      // accelerates hard into the body — that acceleration is what reads as
      // magnetic; a linear slide reads as being dragged on a string.
      c.magT += dt;
      const u = Math.min(1, c.magT / COIN_MAGNET_TIME);
      const e = u * u;
      it.x = c.fromX + (p.x - c.fromX) * e;
      it.z = c.fromZ + (p.z - c.fromZ) * e;
      c.y = c.fromY + (COIN_CHEST_Y - c.fromY) * e + Math.sin(Math.PI * u) * COIN_MAGNET_ARC;
    }

    // Snap to the pixel grid like the rest of the loot so it doesn't shimmer.
    it.sprite.mesh.position.set(it.x, Math.round(c.y * PPU) / PPU, it.z);
  }
}

/**
 * Test seam for the coin systems. These are internal to the level loop and need
 * neither WebGL nor a scene to be meaningful — the invariants worth pinning
 * (gold never drifts across a split, the flight lasts the same wall-clock time
 * at any refresh rate, a culled coin is still paid) are all pure enough to
 * drive headlessly. Not referenced by the game itself.
 */
export const __coinInternals = { updateCoins, checkPickups, enforceCoinCap, creditGold };

/** Walk over a card: socket into the active weapon if it fits + has room, else
 * stash it for the Tavern. Returns false (leave it) only if the stash is full. */
function pickUpCard(it: GroundItem): boolean {
  const id = it.id as CardId;
  const def = CARDS[id];
  if (!def) return true;
  const active = state.weaponSlots[state.activeSlot];
  if (active && socketCard(active, id)) {
    // Reader for first-of-kind / epic+ (pauses the world); popup for repeats.
    presentCardPickup(id, `SOCKETED INTO ${WEAPONS[active.id].icon} ${WEAPONS[active.id].label.toUpperCase()}`);
    faceOnSpecial();
    showPickupNote(`${def.icon} ${def.label.toUpperCase()} SOCKETED — ${def.description}`);
    return true;
  }
  if (state.cardStash.length < STASH_MAX) {
    state.cardStash.push(id);
    presentCardPickup(id, `STASHED FOR THE TAVERN — ${state.cardStash.length}/${STASH_MAX}`);
    showPickupNote(`${def.icon} ${def.label.toUpperCase()} — stashed for the Tavern`);
    return true;
  }
  showPickupNote(`🃏 stash full — visit the Tavern`);
  return false;
}

function pickUpWeapon(it: GroundItem): void {
  const id = it.id as WeaponId;
  // Carry the rolled RARITY, sockets and upgrade level across the pickup — a
  // weapon that forgot its rarity would silently lose card slots, and one that
  // forgot its cards would eat them on every exchange.
  const incoming: WeaponState = {
    id,
    durability: it.durability ?? WEAPONS[id].maxDurability,
    rarity: it.rarity ?? "common",
    cards: it.cards ?? [],
    bonusSlots: 0,
    upgrade: it.upgrade ?? 0,
  };

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
function checkPickups(dt: number): void {
  const p = state.player;
  if (!p) return;
  updateCoins(dt);

  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    const it = state.groundItems[k];
    const dist = Math.hypot(it.x - p.x, it.z - p.z);

    // A weapon you just put down: inert until you actually leave the spot.
    if (it.blockedUntilAway) {
      if (dist > DROP_CLEAR_RANGE) it.blockedUntilAway = false;
      continue;
    }
    // SOMEONE ELSE'S CORPSE. Visible, walkable-over, not takeable. Checked
    // before any pickup branch so no item kind can leak past it. The nudge only
    // fires within pickup range, or standing near a friend's grave would spam.
    if (it.corpseOwner !== undefined && !canLoot({ id: it.corpseId ?? "", floor: state.level, x: it.x, z: it.z, owner: it.corpseOwner, items: [] }, myId())) {
      if (dist < PICKUP_RANGE) showPickupNote(`⚰️ another knight's kit — not yours to take`);
      continue;
    }
    // A coin is absorbed when its magnet flight ARRIVES, not on proximity: the
    // flight IS the animation, and cutting it short by walking into the coin
    // would put us straight back to a number appearing out of nowhere.
    if (it.kind === "coin") {
      const c = it.coin;
      if (c && c.magT < COIN_MAGNET_TIME) continue; // still bursting / resting / flying
      creditGold(it.value ?? GOLD_PER_KILL);
      state.vfx?.sparks(it.x, COIN_CHEST_Y, it.z, 0, 0, 7); // absorb flash at the chest
      sfxCoin();
      removeGroundItem(k);
      continue;
    }
    // A reagent mote is banked when its magnet flight ARRIVES, same as a coin —
    // the flight is the pickup animation, so proximity alone doesn't grab it.
    if (it.kind === "reagent") {
      const c = it.coin;
      if (c && c.magT < COIN_MAGNET_TIME) continue;
      const rid = it.id as ReagentId;
      creditReagent(rid);
      const def = REAGENTS[rid];
      state.vfx?.sparks(it.x, COIN_CHEST_Y, it.z, 0, 0, 6);
      sfxPickup();
      showPickupNote(`${def.icon} ${def.label.toUpperCase()} — ${state.reagents[rid]} in pouch`);
      removeGroundItem(k);
      continue;
    }
    if (dist > PICKUP_RANGE) continue;

    if (it.kind === "weapon") {
      pickUpWeapon(it);
    } else if (it.kind === "potion") {
      // Diablo model: potions are STOWED on the belt for manual use (Shift+1–4),
      // not drunk on contact. If the belt is full, drink it now so it's not lost.
      const pid = it.id as PotionId;
      if (addToBelt(pid)) {
        showPickupNote(`${POTIONS[pid].icon} ${POTIONS[pid].label.toUpperCase()} — ${POTIONS[pid].description} · belt: press 1-4 to drink`);
      } else {
        applyPotion(pid);
      }
    } else if (it.kind === "card") {
      if (!pickUpCard(it)) continue; // stash full — leave the card on the floor
    } else if (it.kind === "material") {
      // Marble materials apply on contact (held one at a time; a 2nd opens a
      // fusion window). Not brewable, not belted — the ball IS the material.
      const m = it.id as MarbleMaterial;
      applyMaterial(m);
      showPickupNote(`${MATERIALS[m].icon} ${MATERIALS[m].label.toUpperCase()} MARBLE — ACTIVE NOW, the ball IS the material`);
    } else {
      const slot = it.id as GearSlot;
      const def = GEAR[slot];
      state.gear = { ...state.gear, [slot]: def.absorb > 0 ? def.absorb : 1 };
      // Say what it DOES: boots grant speed and soak nothing, so "equipped"
      // alone made them look like a no-op item.
      const gearNote = def.absorb > 0 ? `soaks ${def.absorb} damage` : `+${Math.round((BOOTS_SPEED_FACTOR - 1) * 100)}% move speed`;
      showPickupNote(`${def.icon} ${def.label.toUpperCase()} — ${gearNote}`);
    }
    sfxPickup();
    state.hudDirty = true;
    removeGroundItem(k);
  }
}

/**
 * The Rolling Cart Merchant's wares. Prices are flat (gold is plentiful in a
 * good run); everything routes through applyPotion / freshWeapon on buy.
 */
const SHOP_STOCK: ShopEntry[] = [
  // Potion rows take their blurb from POTIONS[].description — one source of truth.
  { id: "health", label: "Health", icon: "❤️", price: 12, detail: POTIONS.health.description },
  { id: "shield", label: "Shield", icon: "🛡️", price: 18, detail: `${POTIONS.shield.duration}s ${POTIONS.shield.description}` },
  { id: "ballform", label: "Ball Form", icon: "🪩", price: 24, detail: `${POTIONS.ballform.duration}s ${POTIONS.ballform.description}` },
  { id: "multiball", label: "Multi-Ball", icon: "🔮", price: 26, detail: `${POTIONS.multiball.duration}s ${POTIONS.multiball.description}` },
  { id: "curveshot", label: "Curve Shot", icon: "🌀", price: 20, detail: `${POTIONS.curveshot.duration}s ${POTIONS.curveshot.description}` },
  { id: "magnetboots", label: "Magnet Boots", icon: "🧲", price: 24, detail: `${POTIONS.magnetboots.duration}s ${POTIONS.magnetboots.description}` },
  // Weapons are gone from the cart (2026-07-20): they drop in the maze and the
  // tavern forges them — the rolling cart's identity is the mid-floor top-up
  // of TEMPORARY power, which is also what keeps it distinct from the tree.
];

/** Open the merchant's shop overlay and PAUSE the sim while it's up. */
function openShop(): void {
  if (state.shopEl || !state.container) return;
  const buy = (i: number): void => {
    const entry = SHOP_STOCK[i];
    if (!entry || getBalance() < entry.price) return;
    if (!spendGold(entry.price)) return;
    state.goldRun = Math.max(0, state.goldRun - entry.price); // keep the run tally honest
    // Belt first, like a floor pickup; drink immediately only if the belt's full.
    const pid = entry.id as PotionId;
    if (addToBelt(pid)) showPickupNote(`${POTIONS[pid].icon} ${POTIONS[pid].label.toUpperCase()} — belted`);
    else applyPotion(pid);
    state.hudDirty = true;
    refreshShopOverlay(state.shopEl, getBalance());
  };
  state.shopEl = openShopOverlay(state.container, SHOP_STOCK, getBalance(), buy, closeShop);
}

/** Close the shop overlay and resume the sim. */
function closeShop(): void {
  state.shopEl?.remove();
  state.shopEl = null;
}

/**
 * Stow a potion on the quick-use belt. Stacks onto a matching slot, else takes
 * the first empty one. Returns false if the belt is full (caller drinks it).
 */
function addToBelt(id: PotionId): boolean {
  for (const s of state.belt) {
    if (s && s.id === id) {
      s.count++;
      state.hudDirty = true;
      return true;
    }
  }
  for (let i = 0; i < state.belt.length; i++) {
    if (!state.belt[i]) {
      state.belt[i] = { id, icon: POTIONS[id].icon, count: 1 };
      state.hudDirty = true;
      return true;
    }
  }
  return false;
}

/**
 * Use the belt slot at index i (Shift+1..4): drink one, apply its effect, and
 * splash the matching globe + set the face reaction. Empty slots do nothing.
 */
function useBeltSlot(i: number): void {
  const slot = state.belt[i];
  if (!slot) return;
  const id = slot.id as PotionId;
  applyPotion(id); // effect + all feedback (face/globe/note) live in applyPotion
  slot.count--;
  if (slot.count <= 0) state.belt[i] = null;
  state.hudDirty = true;
}

/**
 * Drink a potion: heal potions restore hearts instantly (capped at
 * max); buff potions (re)start their timer. A quick tint pulse + toast sells it.
 */
function applyPotion(id: PotionId): void {
  const p = state.player;
  if (!p) return;
  const def = POTIONS[id];
  if (def.heal > 0) {
    p.hp = Math.min(playerMaxHp(), p.hp + def.heal);
    state.vfx?.blood(p.x, 0.6, p.z, "red", 6); // a little red sparkle for the heal
  }
  if (def.gold && def.gold > 0) {
    // Greed idol: instant gold windfall, banked into the shared wallet.
    state.goldRun += def.gold;
    addGold(def.gold, "dungeon-game");
    state.vfx?.sparks(p.x, 0.7, p.z, 0, 0, 8);
  }
  if (def.duration > 0) {
    if (id === "rage") p.rageT = def.duration;
    if (id === "haste") p.hasteT = def.duration;
    if (id === "shield") p.shieldT = def.duration;
    if (id === "ballform") {
      // The consolidated pinball buff drives all three ball systems at once:
      // ram damage (iron), frictionless steering (turbo), springy walls.
      p.ironT = p.turboT = p.springT = def.duration;
      state.shakeT = Math.max(state.shakeT, 0.25);
      sfxBumper();
    }
    if (id === "freeze") {
      state.freezeT = def.duration;
      sfxFreeze();
    }
    if (id === "multiball") {
      // The echoes own their own countdown + teardown (entities/multiball.ts).
      p.multiBallT = def.duration;
      spawnMultiBall();
      sfxBumper();
    }
    if (id === "curveshot") p.curveT = def.duration;
    if (id === "magnetboots") p.magBootsT = def.duration;
    // ── Craft-only brews ──
    if (id === "regen") {
      p.regenT = def.duration;
      p.regenTickT = REGEN_TICK_INTERVAL;
    }
    if (id === "venomcoat") p.venomCoatT = def.duration;
    if (id === "stoneskin") p.stoneT = def.duration;
    if (id === "static") p.staticT = def.duration;
    if (id === "greed") p.greedT = def.duration;
  }
  // Elixir of Life: instant full heal AND a permanent-for-the-run max-hearts
  // bump (the only potion that raises the ceiling). Heal AFTER the bump so it
  // tops off at the new maximum.
  if (id === "elixir") {
    state.bonusMaxHp += ELIXIR_MAXHP_BONUS;
    p.hp = playerMaxHp();
    state.vfx?.sparks(p.x, 0.9, p.z, 0, 0, 18);
  }
  p.sprite.setTint(def.color);
  p.flashT = 0.18; // brief pulse, cleared by updateFlash
  // Consistent pickup feedback for EVERY potion (single source of truth):
  // heals get a relieved grin + red splash, everything else a wide grin + a
  // blue splash; the persistent buff strip then carries the running timer.
  if (def.heal > 0 || id === "elixir") {
    faceOnHeal();
    rippleGlobe("life");
  } else {
    faceOnSpecial();
    if (def.duration > 0 || def.gold) rippleGlobe("mana");
  }
  showPickupNote(`${def.icon} ${def.label.toUpperCase()} — ${def.description}${def.gold ? ` +${def.gold}g` : ""}`);
  state.hudDirty = true;
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
  if (p && sun) {
    sun.target.position.set(p.x, 0, p.z);
    sun.position.set(p.x - DIR_HEIGHT * 0.55, DIR_HEIGHT, p.z - DIR_HEIGHT * 0.55);
  }
  if (p && lamp) lamp.position.set(p.x, 1.3, p.z);

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
  if (state.scene && renderCam && state.pixelPass) {
    // Shadow throttle: autoUpdate is off (see renderer setup); render the
    // shadow depth pass on alternate frames only.
    shadowFrameCounter++;
    if (state.renderer && shadowFrameCounter % 2 === 0) {
      state.renderer.shadowMap.needsUpdate = true;
    }
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
  dismissCardReader(); // also drops any queued cards — module state, not on `state`
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
  sun = null; // the lights themselves are freed with the scene by disposeAll
  lamp = null;
  ambient = null;
  hemi = null;
  clearInputOwner();

  resetState();
  onExit?.();
}
