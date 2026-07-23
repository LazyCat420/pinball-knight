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
import { createPinballParts, updatePinballParts, updatePlungerRig } from "./render/pinball-parts";
import { updateShots, rotateLanes } from "./shots";
import { loadAtlasSheet } from "./render/atlas-loader";
import { buildSpriteSheet, createActorSprite, createStaticSprite, createOcclusionSilhouette, reaperSheet, type SpriteSheet } from "./render/sprite";
import { Animator } from "./render/animator";
import { makeKnightPaints, makeZombiePaints, makeSpiderPaints, makeBrutePaints, makeSpitterPaints, makeGhostPaints, makeBatPaints, makeSlimePaints, makeBossPaints, makeGoblinPaints, makePinPaints, makeGolemPaints, makeChomperPaints, makeMagnetPaints, makeWebspinnerPaints, ZOMBIE_VARIANTS, ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera, worldToScreenPx } from "./camera";
import { showToast, showGameOver, showControlsHint, showPickupNote, createFpsOverlay, setFpsOverlay, createComboFlash, spawnFloatingCombo, createBossBar, updateBossBar, createPlungerMeter, updatePlungerMeter, openShopOverlay, refreshShopOverlay, type ShopEntry } from "./ui";
import { presentCardPickup, advanceCardReader, dismissCardReader } from "./card-reader";
import { openGameMenu, closeGameMenu, cycleMenuTab, menuTabByIndex, applySettingsLive } from "./menu";
import { renderKnightPortrait } from "./render/knight-portrait";
import { lookFromGear, lookKey } from "./render/knight-look";
import { getKnightSheet, setHandmadeOverride } from "./render/knight-sheets";
import { awardFloorXp, awardDebugXp as debugGrantXp, setLevelUpHandler, invalidateSkillAgg, playerMaxHp, skillAgg } from "./skill-runtime";
import { hasStartCardPerk } from "./legacy";
import { mountHUDs, renderHUD, refreshHUD } from "./hud";
import { rippleGlobe } from "./hud-diablo";
import { faceOnHeal, faceOnSpecial } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, tileCenter, worldToTile, at, isWalkable, type Grid, type TilePos, T_STAIRS } from "./maze/generator";
import { computeArcCorners } from "./collision";
import { decorateMaze, widenMainArtery, pickEndpoints, type PrefabAnchor } from "./maze/decorate";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor } from "./maze/prefabs";
import { archetypeFor } from "./maze/archetypes";
import { rollModifier } from "./maze/modifiers";
import { buildMaze } from "./maze/build";
import { bfsDistances } from "./entities/ai";
import { updatePlayer, resetPlayerMotion, debugCurSpeed, debugWallNormal } from "./entities/player";
import { updateZombies, setSummonHandler } from "./entities/zombie";
import { updateProjectiles, golemShards } from "./entities/projectiles";
import { updateFloorFx, clearFloorFx, spawnFloorFx } from "./entities/floor-fx";
import { updateMaterial, applyMaterial, isMaterial, MATERIALS, MATERIAL_LIST } from "./entities/marble";
import { simulateHazards } from "./entities/hazards";
import { updateNpcs, disposeNpcs, spawnFrog, spawnMerchant, setMerchantCaughtHandler, rollMagicianClock } from "./entities/npc";
import { syncActorMesh, setBossDefeatedHandler, setSlimeSplitHandler, setGolemShatterHandler, setBloaterBurstHandler, setCardRollHandler, setCoinDropHandler, setReagentDropHandler, resetCombatJuice, tickCombatTimers, damageZombie, setCoopCombatBridge, hitPlayerRanged } from "./entities/combat";
import { createDebugPanel } from "./debug-panel";
import { createInput } from "./input";
import { canRampage, enterRampage, updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import { castAbility, tickAbilities } from "./abilities";
import { spawnMultiBall, updateMultiBall } from "./entities/multiball";
import {
  levelConfig,
  FLOW_INTERVAL,
  TIMECRAWL_FACTOR,
  GOLD_PER_DESCENT,
  PLAYER_MAX_HP,
  ZOMBIE_HP,
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
} from "./constants";
import { addGold, getBalance, spendGold } from "../../utils/gold-wallet";
import { WEAPONS, GEAR, POTIONS, POTION_IDS, freshWeapon, REGEN_HEAL_PER_TICK, REGEN_TICK_INTERVAL, ELIXIR_MAXHP_BONUS, type WeaponId, type WeaponState, type GearSlot, type PotionId } from "./items";
import { REAGENTS, rollReagentDrops, type ReagentId } from "./reagents";
import { CARDS, STASH_MAX, rollCardDrop, socketCard, cardsOfRarity, type CardId } from "./cards";
import { enterTavern, isTavernSceneOpen } from "../tavern";
import { spawnBoss, updateBoss, disposeBoss } from "./boss";
import { initCoop, updateCoop, endCoop, isReplica, setCoopFloor, coopSeed, setCoopHooks, coopItemTaken, coopForwardDamage, coopBroadcastKill } from "./coop";
import { stopPresence } from "../../net/presence";
import { createFog, revealAround, exploredCount, exploredFraction } from "./fog";
import { toggleFloorMap, closeFloorMap, isFloorMapOpen } from "./map-overlay";
import { sfxStairs, sfxGameOver, sfxPickup, sfxCoin, sfxFreeze, sfxBumper, sfxLevelStart, sfxModifier, sfxBossReveal } from "./audio";
import { scoreRun, runDetail, type RunStats } from "./run-score";
import { saveLeaderboardScore } from "../../services/score-service";
import { loadBestDepth, saveBestDepth } from "./best-depth";
import { getPlayerName } from "../../services/player-name";
import { runPinballIntro } from "./intro";
import { frenzyIntensity } from "./entities/combo-curve";

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

/** The biome for a given depth (cycles every BIOMES.length floors). */
function biomeFor(level: number): Biome {
  return BIOMES[(level - 1) % BIOMES.length];
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
      enemies: state.zombies.map((z) => ({ kind: z.kind, mode: z.mode, aggro: z.aggro, hp: z.hp, boss: !!z.boss, maxHp: z.maxHp })),
      playerHp: state.player?.hp,
    });
    // Dev: force a weapon into the active slot (QA the bow/gun/etc. without hunting
    // for a pickup). `__dungeonGive('bow')`.
    (window as unknown as { __dungeonGive?: (id: string) => boolean }).__dungeonGive = (id: string) => {
      if (!(id in WEAPONS)) return false;
      state.weaponSlots[state.activeSlot] = freshWeapon(id as WeaponId);
      return true;
    };
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
      return { x: p.x, z: p.z, hp: p.hp, rollT: p.rollT, iframes: p.iframes, clip: p.anim.getClip(), facing: p.facing, ax, sprint: state.input?.sprintHeld?.() ?? false, active: state.active, gameOver: state.gameOver, curSpeed: debugCurSpeed(), attackT: p.attackT, comboStep: p.comboStep, chargeT: p.chargeT, moving: !!p.move, kills: state.kills, sprintCharge: p.sprintCharge, wallMoveT: p.wallMoveT, wallMoveKind: p.wallMoveKind, wallNormal: debugWallNormal(), overcharge: p.overcharge, momSpeed: p.momSpeed, bounceCombo: p.bounceCombo, grabT: p.grabT, rideT: p.rideT, dropT: p.dropT, oilT: p.oilT, webbedT: p.webbedT, ironT: p.ironT, turboT: p.turboT, springT: p.springT, curveT: p.curveT, magBootsT: p.magBootsT };
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
  // builds both, mounts the shared face, and sets state.hudEl to the wolf bar.
  mountHUDs(state.container);
  state.fpsOverlayEl = createFpsOverlay(state.container);
  state.comboFlashEl = createComboFlash(state.container);
  state.bossBarEl = createBossBar(state.container);
  state.plungerMeterEl = createPlungerMeter(state.container);
  state.input = createInput(state.container);
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
    spawnEnemy: (kind) => debugSpawnEnemy(kind as EnemyKind),
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
  });
  setCoopCombatBridge({ isReplica, forward: coopForwardDamage, onKill: coopBroadcastKill });
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
  const beginRun = (): void => {
    if (!state.active) return;
    startLevel(1); // startLevel adopts the shared pool seed (coopSeed) if connected
    initCoop(); // spin up dungeon-scene pool presence (no-op solo/offline)
    console.log("🗡️ Maze Game: descending (run seed", state.runSeed, ")");
    state.lastTime = performance.now();
    state.animFrameId = requestAnimationFrame(loop);
  };
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
  opts: { kind?: EnemyKind; hp?: number; boss?: boolean; maxHp?: number } = {},
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
  const z2: Zombie = {
    nid: "z" + zombieNidSeq++,
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
  const theme = themeFor(level);
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
  const variantSheets = state.zombieVariantSheets;
  const sheet = variantSheets[hash % variantSheets.length] ?? state.zombieSheet!;
  return makeZombie(sheet, x, z, baseSpeed);
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
  const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, cfg.windiness, {
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
  const theme = themeFor(level);
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
    },
  );

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

  // ── BOSS FLOOR: the REAPER KING guards the exit every BOSS_EVERY floors ──
  // Replaces the old stairs-guarding OVERLORD brute. The king (boss.ts) is a
  // killable reaper-art brute with an orbiting skull ring + a telegraphed
  // tentacle slam; while it lives `state.exitLocked` holds the stairs shut, and
  // its death blooms the exit PORTAL. Scales its HP by tier via the injected
  // spawner. Only spawns for the host — a replica renders the streamed king.
  if (level % BOSS_EVERY === 0 && state.stairs && state.scene && state.player && !isReplica()) {
    const tier = level / BOSS_EVERY; // 1 at L5, 2 at L10, …
    const bhp = BOSS_BASE_HP + BOSS_HP_PER_TIER * (tier - 1) * 3; // king is meatier than the old overlord
    const spot = nearestOpenTile(grid, state.stairs.i, state.stairs.j, 2) ?? state.stairs;
    const speed = cfg.zombieSpeed * BOSS_SPEED_FACTOR;
    spawnBoss(grid, spot, (x, z, hp) => {
      const b = makeZombie(reaperSheet(), x, z, speed, { kind: "brute", hp: hp || bhp, boss: true, maxHp: hp || bhp });
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
    return { nid: "L" + k, kind: it.kind, id: it.id, x: pos.x, z: pos.z, sprite, bobPhase: k * 1.7 };
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
  const sub = level % BOSS_EVERY === 0 ? "☠ an OVERLORD guards the stairs ☠" : `${flavour}${suffix}`;
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

/** Spawn one enemy of any kind next to the player, bypassing the level gates. */
function debugSpawnEnemy(kind: EnemyKind): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return;
  const pt = worldToTile(g, p.x, p.z);
  const spot = nearestOpenTile(g, pt.i, pt.j, 2) ?? pt;
  const c = tileCenter(g, spot.i, spot.j);
  const speed = levelConfig(state.level).zombieSpeed;
  let zz: Zombie | null;
  if (kind === "zombie") {
    const sheet = state.zombieVariantSheets[0] ?? state.zombieSheet;
    zz = sheet ? makeZombie(sheet, c.x, c.z, speed, { kind: "zombie" }) : null;
  } else if (kind === "reaper") {
    if (!state.reaperOut) spawnReaper();
    return;
  } else if (RESKIN[kind]) {
    zz = makeReskin(kind, c.x, c.z, speed);
  } else {
    zz = spawnKind(kind, c.x, c.z, speed, 99); // level 99 clears every FROM_LEVEL gate
  }
  if (zz) {
    zz.aggro = true;
    state.zombies.push(zz);
  }
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

function onPlayerDeath(): void {
  if (state.gameOver) return;
  state.gameOver = true;
  // Bank the loose change before the run is scored — the run tally on the death
  // screen should include coins that were still mid-flight when you died.
  sweepCoins();
  // Fire-and-forget at the call site is fine ONLY because submitRunScore itself
  // awaits and logs; the death screen must not wait on the network to appear.
  void submitRunScore();
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
      resetCombatJuice();
      if (state.player) {
        Object.assign(state.player, freshPlayerFields());
        state.player.sprite.setTint(null);
      }
      beginRunLedger(); // a retry is a NEW run for the board, not a continuation
      if (state.player) state.player.hp = playerMaxHp(); // after fresh fields
      state.hudDirty = true;
      startLevel(1); // roguelite: gold is banked, the run restarts
    },
    onLeave: () => exitDungeonGame(),
  });
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
function dropCardMaybe(x: number, z: number, boss: boolean): void {
  if (!state.scene) return;
  const id = rollCardDrop({ boss, floor: state.level, legendaryAllowed: !state.legendaryDropped });
  if (!id) return;
  if (CARDS[id].rarity === "legendary") state.legendaryDropped = true;
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
function dropReagentsMaybe(x: number, z: number, kind: EnemyKind, boss: boolean): void {
  const ids = rollReagentDrops(kind, { boss });
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
        showPickupNote(`${POTIONS[pid].icon} ${POTIONS[pid].label.toUpperCase()} — ${POTIONS[pid].description} · belt`);
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
      showPickupNote(`${MATERIALS[m].icon} ${MATERIALS[m].label.toUpperCase()} MARBLE`);
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
    state.flowField = bfsDistances(g, pt.i, pt.j);
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

  // ── The tavern owns the screen ──
  // It runs its own renderer and covers the dungeon completely, so everything
  // below here is drawing a fully-hidden frame at full cost. Three renderers
  // were competing (dungeon pixel pass, tavern pixel pass, casino canvas) and
  // the panel canvas was getting ~4fps as a result. The rAF stays alive so the
  // loop resumes the moment the player descends.
  if (isTavernSceneOpen()) return;

  const p = state.player;
  const g = state.grid;

  // The held art follows the active hand — pickup, swap, break, retry all
  // funnel through this one check.
  applyWeaponArt();

  // ── Presentation (per rendered frame) ──
  // VFX use REAL frame time so particles keep flying through a hit-freeze.
  state.vfx?.update(frame);
  updatePinballParts(frame); // part cooldowns + pop/boing/chevron animations
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
    refreshHUD();
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
    state.pixelPass.render(state.scene, renderCam);
  }
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
