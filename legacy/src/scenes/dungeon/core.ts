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
import { state, resetState, freshPlayerFields, activeWeapon, type Zombie, type GroundItem, type EnemyKind } from "./state";
import { createPixelPass } from "./render/pixel-pass";
import { createVfx } from "./render/vfx";
import { createPinballParts, updatePinballParts } from "./render/pinball-parts";
import { loadAtlasSheet } from "./render/atlas-loader";
import { buildSpriteSheet, createActorSprite, createStaticSprite, createOcclusionSilhouette, type SpriteSheet } from "./render/sprite";
import { Animator } from "./render/animator";
import { makeKnightPaints, makeZombiePaints, makeSpiderPaints, makeBrutePaints, makeSpitterPaints, makeGhostPaints, makeBatPaints, makeSlimePaints, makeBossPaints, makeGoblinPaints, makePinPaints, makeGolemPaints, makeChomperPaints, makeMagnetPaints, makeWebspinnerPaints, ZOMBIE_VARIANTS, ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera } from "./camera";
import { showToast, showGameOver, showControlsHint, showPickupNote, createFpsOverlay, setFpsOverlay, createComboFlash, flashBounceCombo, createBossBar, updateBossBar, openShopOverlay, refreshShopOverlay, type ShopEntry } from "./ui";
import { mountHUDs, renderHUD, refreshHUD } from "./hud";
import { rippleGlobe } from "./hud-diablo";
import { faceOnHeal, faceOnSpecial } from "./hud-face";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, tileCenter, worldToTile, at, isWalkable, type Grid, type TilePos, T_STAIRS } from "./maze/generator";
import { computeArcCorners } from "./collision";
import { decorateMaze, type PrefabAnchor } from "./maze/decorate";
import { stampPrefabs, themeFor } from "./maze/prefabs";
import { buildMaze } from "./maze/build";
import { bfsDistances } from "./entities/ai";
import { updatePlayer, resetPlayerMotion, updateMultiball, debugCurSpeed, debugWallNormal } from "./entities/player";
import { updateZombies } from "./entities/zombie";
import { updateProjectiles, golemShards } from "./entities/projectiles";
import { simulateHazards } from "./entities/hazards";
import { updateNpcs, disposeNpcs, spawnFrog, spawnMerchant, setMerchantCaughtHandler, rollMagicianClock } from "./entities/npc";
import { syncActorMesh, setBossDefeatedHandler, setSlimeSplitHandler, setGolemShatterHandler, resetCombatJuice, tickCombatTimers, damageZombie } from "./entities/combat";
import { createDebugPanel } from "./debug-panel";
import { createInput } from "./input";
import { canRampage, enterRampage, updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import { castAbility, tickAbilities } from "./abilities";
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
import { addGold, getBalance, spendGold } from "../../utils/gold-wallet";
import { WEAPONS, GEAR, POTIONS, freshWeapon, type WeaponId, type WeaponState, type GearSlot, type PotionId } from "./items";
import { sfxStairs, sfxGameOver, sfxPickup, sfxFreeze, sfxBumper } from "./audio";

/**
 * Presentation-only lights, module-scoped (not on `state`) — rebuilt on every
 * launch. `sun` casts the shadows and follows the camera; `lamp` is the hero's
 * personal readability light; ambient/hemi are kept so startLevel can re-tint
 * them per depth (the FF dungeon trick: deeper floors shift palette).
 */
let sun: THREE.DirectionalLight | null = null;
let lamp: THREE.PointLight | null = null;
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
      which === "knight" ? state.playerSheets.get("sword") ?? null :
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
    // Dev: apply a potion directly (QA the Wave-F kit — freeze/turbo/multiball/…
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
      state.npcs.map((n) => ({ kind: n.kind, x: n.x, z: n.z, shopped: !!n.shopped }));
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
      return { x: p.x, z: p.z, hp: p.hp, rollT: p.rollT, iframes: p.iframes, clip: p.anim.getClip(), facing: p.facing, ax, sprint: state.input?.sprintHeld?.() ?? false, active: state.active, gameOver: state.gameOver, curSpeed: debugCurSpeed(), attackT: p.attackT, comboStep: p.comboStep, chargeT: p.chargeT, moving: !!p.move, kills: state.kills, sprintCharge: p.sprintCharge, wallMoveT: p.wallMoveT, wallMoveKind: p.wallMoveKind, wallNormal: debugWallNormal(), overcharge: p.overcharge, momSpeed: p.momSpeed, bounceCombo: p.bounceCombo, rideT: p.rideT, oilT: p.oilT, webbedT: p.webbedT, ironT: p.ironT, turboT: p.turboT, springT: p.springT, multiT: p.multiT, multiBalls: state.multiMeshes?.length ?? 0, curveT: p.curveT, magBootsT: p.magBootsT };
    };
  }

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
  // Dual HUD: the Diablo panel (iso) + the Wolfenstein bar (rampage). mountHUDs
  // builds both, mounts the shared face, and sets state.hudEl to the wolf bar.
  mountHUDs(state.container);
  state.fpsOverlayEl = createFpsOverlay(state.container);
  state.comboFlashEl = createComboFlash(state.container);
  state.bossBarEl = createBossBar(state.container);
  state.input = createInput(state.container);
  showControlsHint(state.container);

  state.onKeyDown = handleKey;
  window.addEventListener("keydown", state.onKeyDown);

  // Debug/god-mode console (press ` to toggle). State toggles live on `state`;
  // the one-shot actions route through core's private helpers here.
  debugPanelDispose = createDebugPanel(state.container, {
    heal: () => {
      if (!state.player) return;
      state.player.hp = PLAYER_MAX_HP;
      faceOnHeal();
      rippleGlobe("life");
      state.hudDirty = true;
    },
    addGold: (n) => {
      state.goldRun += n;
      addGold(n, "dungeon-game");
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
    spawnEnemy: (kind) => debugSpawnEnemy(kind as EnemyKind),
  });

  // A slain overlord drops its reward here (kept out of combat.ts to avoid a
  // circular import).
  setBossDefeatedHandler(dropBossReward);
  // A slain big slime queues two minis, spawned after combat resolution.
  setSlimeSplitHandler((x, z, speed) => pendingMinis.push({ x, z, speed }));
  // A shattered brick golem sprays ricochet shards.
  setGolemShatterHandler((x, z) => golemShards(x, z));
  // Catching the rolling merchant opens its shop.
  setMerchantCaughtHandler(openShop);
  resetCombatJuice();

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
};

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

/**
 * Spawn one enemy from a prebuilt sheet at a world point. Shared by the level
 * horde, the debug spawner, and the giant-spider spawns — every enemy runs the
 * same pathing/combat in updateZombies, differing only by `kind` + stats.
 */
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

  disposeLevel(); // tears down the previous maze + horde + loot, keeps the player

  state.level = level;
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
  const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid, cfg.windiness);
  // A grade-S/A descent unlocked a BONUS room on this floor (Wave F glue).
  const bonusRoom = state.bonusRoomNext;
  state.bonusRoomNext = false;
  const rawRooms = carveRooms(raw, rng, cfg.rooms + (bonusRoom ? 1 : 0), ROOM_MIN_CELLS, ROOM_MAX_CELLS);
  // PREFAB STAMPS (Wave C): themed room/hallway shapes drawn from a seeded
  // shuffle bag — Slalom, Gauntlet, Oilworks, the Magician's Parlor… Carved
  // before the secret cracks so the cracks see the final wall set.
  const theme = themeFor(level);
  const prefabCount = Math.min(2 + Math.floor((level - 1) / 2), 4);
  const stamped = stampPrefabs(raw, rng, prefabCount, theme);
  crackSecretWalls(raw, rng, cfg.secrets);
  const grid = thickenWalls(raw);
  const rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
  // Prefab anchors ride the same ×2 into the thickened grid.
  const anchors: PrefabAnchor[] = stamped.anchors.map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
  // Pinball-machine density grows with depth: deeper floors are busier tables.
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX);
  const plan = decorateMaze(grid, rng, cfg.zombies, cfg.torches, partBudget, rooms, {
    anchors,
    deal: theme.deal,
    targets: TARGETS_PER_FLOOR,
    trapdoors: TRAPDOORS_PER_FLOOR,
    hazards: Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX),
    forceVault: bonusRoom, // a grade-unlocked bonus floor guarantees a vault
  });

  state.grid = grid;
  state.stairs = plan.stairs;
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
    state.playerArtWeapon = weaponId;
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

  // ── Mini-boss: an OVERLORD guards the stairs every BOSS_EVERY floors ──
  if (level % BOSS_EVERY === 0 && state.bossSheet && state.stairs) {
    const tier = level / BOSS_EVERY; // 1 at L5, 2 at L10, …
    const bhp = BOSS_BASE_HP + BOSS_HP_PER_TIER * (tier - 1);
    // Plant it a couple of tiles off the stairs so it's between you and the exit.
    const spot = nearestOpenTile(grid, state.stairs.i, state.stairs.j, 2) ?? state.stairs;
    const c = tileCenter(grid, spot.i, spot.j);
    const boss = makeZombie(state.bossSheet, c.x, c.z, cfg.zombieSpeed * BOSS_SPEED_FACTOR, {
      kind: "brute",
      hp: bhp,
      boss: true,
      maxHp: bhp,
    });
    state.zombies.push(boss);
  }

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
        state.groundItems.push({ kind: "potion", id, x: c.x + dx, z: c.z, sprite, bobPhase: Math.random() * 6 });
      }
    }
  }

  // ── The ORACLE FROG's dead-end perch ──
  if (plan.frog) spawnFrog(plan.frog.i, plan.frog.j);

  // ── The ROLLING CART MERCHANT — one per floor from its depth, parked a
  // few tiles out from the start so you spot it early and give chase. ──
  if (level >= MERCHANT_FROM_LEVEL) {
    const spot = nearestOpenTile(grid, plan.start.i, plan.start.j, 6) ?? plan.start;
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
  state.targetsTotal = plan.parts.filter((pt) => pt.kind === "target").length;
  state.targetsHit = 0;
  state.partComboHits = 0;
  state.frenzyPaid = false;
  state.freezeT = 0;
  state.magicianT = rollMagicianClock();
  state.witchSpawned = false;
  state.frogTrail = [];

  // Announce the depth AND the biome — descending reads as entering a new place.
  // A boss floor gets an ominous warning instead of the usual flavour line.
  const cycle = Math.floor((level - 1) / BIOMES.length) + 1;
  const suffix = cycle > 1 ? ` · deeper (${cycle})` : "";
  const sub = level % BOSS_EVERY === 0 ? "☠ an OVERLORD guards the stairs ☠" : `${biome.flavour}${suffix}`;
  showToast(`DEPTH ${level} — ${biome.name.toUpperCase()}`, sub);
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
    case "escape":
      exitDungeonGame();
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
function nearestOpenTile(g: Grid, ci: number, cj: number, n: number): TilePos | null {
  const found: TilePos[] = [];
  for (let r = 1; r <= 6 && found.length < n; r++) {
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
    if (z.mode !== "dead") damageZombie(z, 9999, 0, 0, 0);
  }
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
  if (!state.scene) return;
  state.goldRun += BOSS_GOLD;
  addGold(BOSS_GOLD, "dungeon-game");
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
    state.groundItems.push({ kind: "potion", id: d.id, x: px, z: pz, sprite, bobPhase: Math.random() * 6 });
  }
  state.hudDirty = true;
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
      clearMultiballs();
      resetCombatJuice();
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
  // Grade the floor being left BEFORE startLevel resets the ledger.
  const { grade, gold } = gradeFloor();
  state.goldRun += GOLD_PER_DESCENT + gold;
  addGold(GOLD_PER_DESCENT + gold, "dungeon-game");
  // A great floor unlocks a BONUS vault room on the next one (Wave F glue).
  state.bonusRoomNext = BONUS_ROOM_GRADES.includes(grade);
  sfxStairs();
  startLevel(state.level + 1);
  // The pickup-note channel, so it doesn't fight the new depth's toast.
  showPickupNote(gold > 0 ? `FLOOR GRADE ${grade} · +${gold}g bonus` : `FLOOR GRADE ${grade}`);
}

/** Tear down the Multi-Ball ghost knights (buff expiry / retry / exit). */
function clearMultiballs(): void {
  if (!state.multiMeshes) return;
  for (const mesh of state.multiMeshes) {
    state.scene?.remove(mesh);
    (mesh.material as THREE.Material).dispose(); // geometry+texture are the player's, shared
  }
  state.multiMeshes = null;
}

/**
 * Summon the Multi-Ball ghost knights: two tinted clones of the player's
 * billboard sharing its geometry + atlas (zero GPU uploads — same trick as
 * the vfx afterimages), positioned each step by player.updateMultiball.
 */
function summonMultiballs(): void {
  const p = state.player;
  if (!p || !state.scene) return;
  clearMultiballs();
  const src = p.sprite.mesh;
  const meshes: THREE.Mesh[] = [];
  for (let k = 0; k < 2; k++) {
    const srcMat = src.material as THREE.MeshBasicMaterial;
    const mat = srcMat.clone();
    mat.color.setHex(0xb06fe8); // arcane violet
    mat.opacity = 0.55;
    mat.transparent = true;
    mat.depthWrite = false;
    const mesh = new THREE.Mesh(src.geometry, mat);
    mesh.quaternion.copy(src.quaternion);
    mesh.scale.copy(src.scale);
    mesh.renderOrder = 9;
    state.scene.add(mesh);
    meshes.push(mesh);
  }
  state.multiMeshes = meshes;
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
    } else if (it.kind === "potion") {
      // Diablo model: potions are STOWED on the belt for manual use (Shift+1–4),
      // not drunk on contact. If the belt is full, drink it now so it's not lost.
      const pid = it.id as PotionId;
      if (addToBelt(pid)) {
        showPickupNote(`${POTIONS[pid].icon} ${POTIONS[pid].label.toUpperCase()} — belt`);
      } else {
        applyPotion(pid);
      }
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

/**
 * The Rolling Cart Merchant's wares. Prices are flat (gold is plentiful in a
 * good run); everything routes through applyPotion / freshWeapon on buy.
 */
const SHOP_STOCK: ShopEntry[] = [
  { id: "health", label: "Health", icon: "❤️", price: 12, detail: "+3 hearts" },
  { id: "shield", label: "Shield", icon: "🛡️", price: 18, detail: "6s invuln" },
  { id: "ballform", label: "Ball Form", icon: "🪩", price: 24, detail: "14s pinball mode" },
  { id: "curveshot", label: "Curve Shot", icon: "🌀", price: 20, detail: "12s bending shots" },
  { id: "magnetboots", label: "Magnet Boots", icon: "🧲", price: 24, detail: "18s repel/launch" },
  { id: "multiball", label: "Multi-Ball", icon: "🔮", price: 26, detail: "12s ghost knights" },
  { id: "mace", label: "Mace", icon: "🔨", price: 28, detail: "heavy melee" },
  { id: "gun", label: "Gun", icon: "🔫", price: 30, detail: "30 ammo" },
];

/** Open the merchant's shop overlay and PAUSE the sim while it's up. */
function openShop(): void {
  if (state.shopEl || !state.container) return;
  const buy = (i: number): void => {
    const entry = SHOP_STOCK[i];
    if (!entry || getBalance() < entry.price) return;
    if (!spendGold(entry.price)) return;
    state.goldRun = Math.max(0, state.goldRun - entry.price); // keep the run tally honest
    if (entry.id in WEAPONS) {
      state.weaponSlots[state.activeSlot] = freshWeapon(entry.id as WeaponId);
      showPickupNote(`${entry.icon} ${entry.label.toUpperCase()} — bought`);
    } else {
      applyPotion(entry.id as PotionId);
    }
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
    p.hp = Math.min(PLAYER_MAX_HP, p.hp + def.heal);
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
      p.multiT = def.duration;
      summonMultiballs();
    }
    if (id === "curveshot") p.curveT = def.duration;
    if (id === "magnetboots") p.magBootsT = def.duration;
  }
  p.sprite.setTint(def.color);
  p.flashT = 0.18; // brief pulse, cleared by updateFlash
  // Consistent pickup feedback for EVERY potion (single source of truth):
  // heals get a relieved grin + red splash, everything else a wide grin + a
  // blue splash; the persistent buff strip then carries the running timer.
  if (def.heal > 0) {
    faceOnHeal();
    rippleGlobe("life");
  } else {
    faceOnSpecial();
    if (def.duration > 0 || def.gold) rippleGlobe("mana");
  }
  showPickupNote(`${def.icon} ${def.label.toUpperCase()}${def.gold ? ` +${def.gold}g` : ""}`);
  state.hudDirty = true;
}

/**
 * Spawn the DEATH DEALER: an unkillable blood-red reaper that enters a dozen
 * tiles out from the player (through the walls — it doesn't care) and drifts
 * straight at them, accelerating forever. One per floor; the stairs erase it.
 */
function spawnReaper(): void {
  const p = state.player;
  if (!p || !state.ghostSheet) return;
  state.reaperOut = true;
  const a = Math.random() * Math.PI * 2;
  const reaper = makeZombie(state.ghostSheet, p.x + Math.cos(a) * 12, p.z + Math.sin(a) * 12, REAPER_SPEED_BASE, {
    kind: "reaper",
    hp: REAPER_HP,
  });
  reaper.aggro = true;
  reaper.baseTint = REAPER_TINT; // telegraph/flash clears restore blood-red, not white
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

/** One 60Hz simulation step. */
function simulate(dt: number): void {
  const p = state.player;
  const g = state.grid;
  if (state.gameOver || !p || !g || !state.input) return;
  if (state.shopEl) return; // the shop pauses the world while you browse

  // ── The floor clock: feeds the grade's pace axis and the Death Dealer. ──
  state.levelT += dt;
  if (p.bounceCombo > state.levelBestCombo) state.levelBestCombo = p.bounceCombo;
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
  for (const key of ["rageT", "hasteT", "shieldT", "ironT", "turboT", "springT", "multiT", "curveT", "magBootsT"] as const) {
    const before = p[key];
    if (before <= 0) continue;
    p[key] = Math.max(0, before - dt);
    if (Math.ceil(p[key]) !== Math.ceil(before) || p[key] === 0) state.hudDirty = true;
  }
  // Active skills: mana regen, cooldowns, magnet pull + blade-storm ticks.
  tickAbilities(dt);
  // Multi-Ball expiry: the ghost knights dissolve with the buff.
  if (p.multiT <= 0 && state.multiMeshes) clearMultiballs();
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
  }
  // TIME CRAWL: the ability scales the horde's dt so enemies move + wind up in
  // slow-mo while the player runs at full speed. Everything else keeps real dt.
  updateZombies(state.slowT > 0 ? dt * TIMECRAWL_FACTOR : dt);
  updateProjectiles(dt);
  simulateHazards(dt); // boxing-glove punches (player launch + lane damage)
  updateNpcs(dt); // the Magician's clock, witch/frog touches, ember trails
  updateMultiball(dt); // ghost knights flank + ram while the buff runs
  tickCombatTimers(dt); // the bowling STRIKE window
  drainPendingMinis(); // slime splits deferred past all combat resolution
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

  // Clamped BOTH ways: MAX_FRAME is tab-out protection, and the 0 floor guards
  // against a first RAF timestamp that lags performance.now() (headless/pre-
  // render quirk) — one negative delta would otherwise poison the accumulator
  // and freeze the whole simulation for that long.
  const frame = Math.min(Math.max(0, (now - state.lastTime) / 1000), MAX_FRAME);
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
  updatePinballParts(frame); // part cooldowns + pop/boing/chevron animations
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

  // Score glue: pop the centred ×N flash on every fresh bounce-combo STEP,
  // wherever the increment came from (wall, part, arc, ram) — a rising count
  // is the signal. It resets to 0 on lapse, which just arms the next flash.
  const combo = p?.bounceCombo ?? 0;
  if (combo > state.prevBounceCombo && combo >= 2) flashBounceCombo(state.comboFlashEl, combo);
  state.prevBounceCombo = combo;

  // Boss bar: show it while the overlord is alive, hide once it's dead/gone.
  const boss = state.zombies.find((z) => z.boss && z.mode !== "dead");
  updateBossBar(state.bossBarEl, boss ? boss.hp : null, boss ? boss.maxHp ?? null : null);

  const renderCam = state.fpsActive && state.fpsCamera ? state.fpsCamera : state.camera;
  if (state.scene && renderCam && state.pixelPass) {
    state.pixelPass.render(state.scene, renderCam);
  }
}

export function exitDungeonGame(): void {
  if (!state.active) return;

  const onExit = state.onExitCallback;

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
