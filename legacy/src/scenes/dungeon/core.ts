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
import { loadAtlasSheet } from "./render/atlas-loader";
import { buildSpriteSheet, createActorSprite, createStaticSprite, createOcclusionSilhouette, type SpriteSheet } from "./render/sprite";
import { Animator } from "./render/animator";
import { makeKnightPaints, makeZombiePaints, makeSpiderPaints, makeBrutePaints, makeSpitterPaints, makeBossPaints, ZOMBIE_VARIANTS, ITEM_PAINTS, PROP_PAINTS } from "./render/cel-painter";
import { createDungeonCamera, aimCamera, snapCameraTo, updateFollowCamera } from "./camera";
import { createHUD, updateHUD, showToast, showGameOver, showControlsHint, showPickupNote, createFpsOverlay, setFpsOverlay, createBossBar, updateBossBar } from "./ui";
import { PALETTE_HEX } from "./render/palette";
import { disposeAll, disposeLevel } from "./dispose";
import { generateMaze, thickenWalls, mulberry32, tileCenter, worldToTile, at, isWalkable, type Grid, type TilePos, T_STAIRS } from "./maze/generator";
import { decorateMaze } from "./maze/decorate";
import { buildMaze } from "./maze/build";
import { bfsDistances } from "./entities/ai";
import { updatePlayer, resetPlayerMotion, debugCurSpeed, debugWallNormal } from "./entities/player";
import { updateZombies } from "./entities/zombie";
import { updateProjectiles } from "./entities/projectiles";
import { syncActorMesh, setBossDefeatedHandler } from "./entities/combat";
import { createInput } from "./input";
import { canRampage, enterRampage, updateFps, aimFpsCamera, billboardEnemiesToFps } from "./fps";
import {
  levelConfig,
  FLOW_INTERVAL,
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
  SPITTER_HP,
  SPITTER_SPEED_FACTOR,
  SPITTER_RATIO,
  SPITTER_FROM_LEVEL,
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
  STAMINA_MAX,
} from "./constants";
import { addGold } from "../../utils/gold-wallet";
import { WEAPONS, GEAR, POTIONS, freshWeapon, type WeaponId, type WeaponState, type GearSlot, type PotionId } from "./items";
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

/** Last stamina fill (in 20ths) the HUD painted — repaint only when it changes. */
let staminaBlocksShown = -1;

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
  state.bossSheet = buildSpriteSheet(makeBossPaints());

  // Dev-only atlas preview hooks for headless art QA:
  //   `__dungeonAtlas(which)` → data URL of that actor's full sprite strip
  //   `__dungeonClips(which)` → the clip table ("S:idle"→[0,1], …) so a harness
  //                             can slice + label individual named frames.
  // `which` ∈ spider|brute|spitter|boss|knight|zombie.
  if (typeof window !== "undefined") {
    const sheetFor = (which: string): SpriteSheet | null =>
      which === "spider" ? state.spiderSheet :
      which === "brute" ? state.bruteSheet :
      which === "spitter" ? state.spitterSheet :
      which === "boss" ? state.bossSheet :
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
    // Dev: snapshot the live projectiles' velocities so a headless test can
    // confirm the arrow flew toward the aim point, not the movement facing.
    (window as unknown as { __dungeonProjectiles?: () => Array<{ kind: string; vx: number; vz: number }> }).__dungeonProjectiles = () =>
      state.projectiles.map((pr) => ({ kind: pr.kind, vx: pr.vx, vz: pr.vz }));
    // Dev: player movement/combat telemetry (stamina, roll, i-frames, position)
    // so a headless test can confirm sprint drains, a dodge rolls + grants
    // i-frames, and the roll covers ground.
    (window as unknown as { __dungeonPlayer?: () => unknown }).__dungeonPlayer = () => {
      const p = state.player;
      if (!p) return null;
      const ax = state.input?.axis() ?? { x: 0, z: 0 };
      return { x: p.x, z: p.z, hp: p.hp, stamina: p.stamina, rollT: p.rollT, iframes: p.iframes, clip: p.anim.getClip(), facing: p.facing, ax, sprint: state.input?.sprintHeld?.() ?? false, active: state.active, gameOver: state.gameOver, curSpeed: debugCurSpeed(), attackT: p.attackT, comboStep: p.comboStep, chargeT: p.chargeT, moving: !!p.move, kills: state.kills, sprintCharge: p.sprintCharge, wallMoveT: p.wallMoveT, wallMoveKind: p.wallMoveKind, wallNormal: debugWallNormal(), overcharge: p.overcharge, momSpeed: p.momSpeed };
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
  state.hudEl = createHUD(state.container);
  state.fpsOverlayEl = createFpsOverlay(state.container);
  state.bossBarEl = createBossBar(state.container);
  state.input = createInput(state.container);
  showControlsHint(state.container);

  state.onKeyDown = handleKey;
  window.addEventListener("keydown", state.onKeyDown);

  // A slain overlord drops its reward here (kept out of combat.ts to avoid a
  // circular import).
  setBossDefeatedHandler(dropBossReward);

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
};

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
function spawnHordeMember(hash: number, x: number, z: number, baseSpeed: number, level: number): Zombie {
  if (level >= BRUTE_FROM_LEVEL && hash % BRUTE_RATIO === 0 && state.bruteSheet) {
    return makeZombie(state.bruteSheet, x, z, baseSpeed * BRUTE_SPEED_FACTOR, { kind: "brute" });
  }
  if (level >= SPITTER_FROM_LEVEL && hash % SPITTER_RATIO === 1 && state.spitterSheet) {
    return makeZombie(state.spitterSheet, x, z, baseSpeed * SPITTER_SPEED_FACTOR, { kind: "spitter" });
  }
  if (level >= SPIDER_FROM_LEVEL && hash % SPIDER_RATIO === 2 && state.spiderSheet) {
    return makeZombie(state.spiderSheet, x, z, baseSpeed * SPIDER_SPEED_FACTOR, { kind: "spider" });
  }
  const variantSheets = state.zombieVariantSheets;
  const sheet = variantSheets[hash % variantSheets.length] ?? state.zombieSheet!;
  return makeZombie(sheet, x, z, baseSpeed);
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
  // Thick walls are what make the Diablo low-rim/tall-back trick work — see
  // thickenWalls. Decoration runs on the thickened grid.
  const grid = thickenWalls(generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid));
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
  // Clear movement smoothing + HUD stamina cache so a new/re-entered level
  // doesn't inherit sprint momentum or a stale stamina-bar block count.
  resetPlayerMotion();
  staminaBlocksShown = -1;

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

  // Announce the depth AND the biome — descending reads as entering a new place.
  // A boss floor gets an ominous warning instead of the usual flavour line.
  const cycle = Math.floor((level - 1) / BIOMES.length) + 1;
  const suffix = cycle > 1 ? ` · deeper (${cycle})` : "";
  const sub = level % BOSS_EVERY === 0 ? "☠ an OVERLORD guards the stairs ☠" : `${biome.flavour}${suffix}`;
  showToast(`DEPTH ${level} — ${biome.name.toUpperCase()}`, sub);
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

    // ── RAMPAGE: the FPS ultimate (only when the meter is full) ──
    case "r":
      if (canRampage()) enterRampage();
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

    // ── Hidden dev spawner: ring every enemy look around the player (art QA) ──
    case "p":
      debugSpawnRing();
      break;
    // ── Hidden dev: instantly fill the rampage meter (FPS-mode QA) ──
    case "u":
      state.ultCharge = 1;
      state.hudDirty = true;
      break;
    // ── Hidden dev: teleport next to the stairs (descent + beacon QA) ──
    case "t":
      debugTeleportToStairs();
      break;
    // ── Hidden dev: force-descend to the next level (biome + progression QA) ──
    case "n":
      if (!state.gameOver) descend();
      break;
    // ── Hidden dev: jump to the next BOSS level (mini-boss QA) ──
    case "b":
      if (!state.gameOver) {
        const next = (Math.floor(state.level / BOSS_EVERY) + 1) * BOSS_EVERY;
        startLevel(next);
      }
      break;
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
  // Place each enemy on the nearest WALKABLE tile stepping outward from the
  // player (blind fixed offsets would bury them in a wall, and a spitter's glob
  // would then die on that wall before reaching you). Speed 0 poses them for
  // art QA; aggro=true so a spitter actually spits + a brute winds up.
  const pt = worldToTile(g, p.x, p.z);
  specs.forEach((spec, i) => {
    const spot = nearestOpenTile(g, pt.i, pt.j, i + 1) ?? pt;
    const c = tileCenter(g, spot.i, spot.j);
    const zz = makeZombie(spec.sheet, c.x, c.z, 0, { kind: spec.kind });
    zz.aggro = true;
    zz.anim.setFacing("S");
    zz.anim.play("walk", { force: true });
    state.zombies.push(zz);
  });
  // Also scatter every potion in a tight ring right around the player, so a
  // small wiggle picks them all up (pickup + effect QA) and the art is visible.
  ["health", "rage", "haste", "shield", "gold"].forEach((id, i) => {
    if (!state.scene) return;
    const sprite = createStaticSprite(ITEM_PAINTS[id]);
    const a = (i / 5) * Math.PI * 2;
    const px = p.x + Math.cos(a) * 0.6;
    const pz = p.z + Math.sin(a) * 0.6;
    sprite.mesh.position.set(px, 0, pz);
    state.scene.add(sprite.mesh);
    state.groundItems.push({ kind: "potion", id, x: px, z: pz, sprite, bobPhase: i * 1.3 });
  });
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
    } else if (it.kind === "potion") {
      applyPotion(it.id as PotionId);
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
 * Drink a potion on pickup: heal potions restore hearts instantly (capped at
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
  }
  p.sprite.setTint(def.color);
  p.flashT = 0.18; // brief pulse, cleared by updateFlash
  showPickupNote(`${def.icon} ${def.label.toUpperCase()}${def.gold ? ` +${def.gold}g` : ""}`);
  state.hudDirty = true;
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

  // ── Buff timers (rage / haste) tick down; HUD refreshes each whole second
  // so the countdown reads live, plus once more when a buff ends. ──
  for (const key of ["rageT", "hasteT", "shieldT"] as const) {
    const before = p[key];
    if (before <= 0) continue;
    p[key] = Math.max(0, before - dt);
    if (Math.ceil(p[key]) !== Math.ceil(before) || p[key] === 0) state.hudDirty = true;
  }
  // Stamina drains/refills continuously; repaint the HUD only when the bar's
  // 20-block fill actually changes (same block-boundary trick as the buffs
  // above), so a smooth drain doesn't rebuild the HUD innerHTML every frame.
  {
    const blocks = Math.round((p.stamina / STAMINA_MAX) * 20);
    if (blocks !== staminaBlocksShown) {
      staminaBlocksShown = blocks;
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

  if (state.hudDirty && state.hudEl) {
    state.hudDirty = false;
    updateHUD(state.hudEl);
  }

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
