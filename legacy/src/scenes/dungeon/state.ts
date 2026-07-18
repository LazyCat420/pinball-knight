/**
 * Module state singleton — same pattern as mouse-game/state.ts.
 */
import type * as THREE from "three";
import type { PixelPass } from "./render/pixel-pass";
import type { VfxSystem } from "./render/vfx";
import type { ActorSprite, SpriteSheet } from "./render/sprite";
import type { Animator, Facing } from "./render/animator";
import type { Grid, TilePos } from "./maze/generator";
import type { ArcCorner } from "./collision";
import type { MazeHandle } from "./maze/build";
import type { InputHandle } from "./input";
import type { WeaponState, WeaponId, GearState, ProjectileKind } from "./items";
import { QUANTIZE_DEFAULT, DITHER_DEFAULT, SCANLINE_DEFAULT, OUTLINE_DEFAULT, PLAYER_MAX_HP, MANA_MAX } from "./constants";
import type { AbilityId } from "./abilities";

/** One quick-use belt slot: a stack of an identical usable (potion). */
export interface BeltSlot {
  /** PotionId of the stored usable. */
  id: string;
  /** Emoji shown on the belt tile. */
  icon: string;
  /** How many are stacked here. */
  count: number;
}
import { freshWeapon } from "./items";

export interface Actor {
  sprite: ActorSprite;
  anim: Animator;
  x: number;
  z: number;
}

export interface Player extends Actor {
  hp: number;
  facing: Facing;
  /** -1 when not attacking, else seconds since the swing started. */
  attackT: number;
  /** True once this swing's active window has connected — one swing, one hit roll. */
  didHit: boolean;
  cooldown: number;
  iframes: number;
  flashT: number;
  /** Seconds left on the rage buff (2× damage). 0 = inactive. */
  rageT: number;
  /** Seconds left on the haste buff (faster move + swing). 0 = inactive. */
  hasteT: number;
  /** Seconds left on the shield buff (invulnerable). 0 = inactive. */
  shieldT: number;
  /** Seconds left on Iron Core (ram damage ×3, ram at any momentum). */
  ironT: number;
  /** Seconds left on Turbo Charge (no momentum friction, extra steer). */
  turboT: number;
  /** Seconds left on Spring Legs (flat walls bounce >1). */
  springT: number;
  /** Seconds left on Multi-Ball (two ghost knights ram alongside). */
  multiT: number;
  /** Seconds of oil-slick grease left (no friction, dead steering). */
  oilT: number;
  /** Seconds of web-slow left (webspinner hit; any part touch clears it). */
  webbedT: number;
  /** Seconds left on Curve Shot (projectiles bend around corners). */
  curveT: number;
  /** Seconds left on Magnet Boots (repel crawlers; strips LAUNCH not drag). */
  magBootsT: number;

  // ── Active-skill economy (Diablo HUD) ──
  /** Spendable mana pool for the Q/E abilities (0..MANA_MAX). Separate from ultCharge. */
  mana: number;
  /** Seconds left on Magnet Aura (ground items drift to you). 0 = inactive. */
  magnetAuraT: number;
  /** Seconds left on Blade Storm (orbiting blades bite nearby foes). 0 = inactive. */
  bladeStormT: number;
  /** Cadence timer between Blade Storm damage ticks. */
  bladeStormTickT: number;

  // ── Trapdoor coaster ride ──
  /** -1 when not riding, else seconds into the current rail ride. */
  rideT: number;
  /** Total ride duration (seconds). */
  rideDur: number;
  /** Catmull-Rom waypoints of the ride, ground coords. Empty when not riding. */
  ridePts: Array<{ x: number; z: number }>;

  // ── A2 Ramp hop (a short airborne arc off a ramp — flies OVER wall bands) ──
  /** -1 when grounded, else seconds into the current ramp hop. */
  hopT: number;
  /** Total hop duration (seconds). */
  hopDur: number;
  /** Launch origin + landing target (ground coords), lerped straight across the arc. */
  hopStartX: number;
  hopStartZ: number;
  hopLandX: number;
  hopLandZ: number;
  /** Unit WORLD heading of the hop (carried to momentum on landing). */
  hopDirX: number;
  hopDirZ: number;
  /** Speed handed to the pinball system when the arc sets down. */
  hopSpeed: number;

  // ── Dodge-roll ──
  /** -1 when not rolling, else seconds into the current roll (incl. recovery). */
  rollT: number;
  /** WORLD direction locked in at the start of the roll (input is ignored mid-roll). */
  rollDirX: number;
  rollDirZ: number;

  // ── Sprint charge (the 3-second spool-up; gates the wall-ride) ──
  /**
   * 0..1 sprint charge. Fills over SPRINT_RAMP_TIME while holding Shift + moving,
   * bleeds back over SPRINT_DECAY_TIME when you stop. Lerps top speed from walk
   * (1×) toward SPRINT_SPEED_MULT; past SPRINT_RIDE_THRESHOLD the wall-ride unlocks.
   */
  sprintCharge: number;
  /**
   * 0..1 PINBALL overcharge — builds only while sprinting at FULL sprintCharge
   * (over OVERCHARGE_TIME). >0 arms bouncing wall physics; 1 = BALL form.
   */
  overcharge: number;
  /** Pinball momentum: unit WORLD direction + speed. momSpeed 0 = not rolling. */
  momX: number;
  momZ: number;
  momSpeed: number;
  /** Cooldown between ball-form ram hits on zombies. */
  ramT: number;
  /** Bounce COMBO: climbs per wall hit (Sonic combo), resets after PINBALL_COMBO_WINDOW. */
  bounceCombo: number;
  /** Seconds since the last bounce — resets bounceCombo when it lapses. */
  bounceComboT: number;

  // ── Wall moves (Mortal-Kombat-style specials off a wall) ──
  /**
   * -1 when no launch move is airborne, else seconds into the current
   * wall-kick / pounce arc (a scripted committed-direction launch, like the roll
   * body but its own move so it can carry a strike and different i-frames).
   */
  wallMoveT: number;
  /** Total duration of the active launch (WALLKICK_DURATION or POUNCE_DURATION). */
  wallMoveDur: number;
  /** i-frame window (front of the launch) for the active wall move. */
  wallMoveIfr: number;
  /** Distance the active launch covers, eased fast→slow. */
  wallMoveDist: number;
  /** WORLD launch direction, locked at kick-off. */
  wallMoveDirX: number;
  wallMoveDirZ: number;
  /** "pounce" fires a radial AoE on landing; "kick" chains a lunging strike; null = none. */
  wallMoveKind: "kick" | "pounce" | null;

  // ── Melee combo/heavy state ──
  /** Which move the current/next swing is: 0 = light-1, 1 = light-2, 2 = finisher. */
  comboStep: number;
  /** Seconds left in the window to chain the next combo step; 0 = closed. */
  comboWindowT: number;
  /** Seconds a heavy has been charging (trigger held); -1 = not charging. */
  chargeT: number;
  /** Buffered attack request (seconds left to honour it); 0 = none. */
  attackBufferT: number;
  /** The MoveTiming the current swing is running; null when idle. */
  move: import("./constants").MoveTiming | null;

  /** Draws only where a wall covers the knight — you can never lose him. */
  silhouette: { mesh: THREE.Mesh; syncMap(): void; dispose(): void } | null;
}

export type ZombieMode = "idle" | "chase" | "windup" | "dead";

/**
 * Enemy family — same AI/combat pipeline; stats, art and behaviour flags differ
 * by kind:
 *  - zombie:  the baseline shambler (5 cosmetic variants).
 *  - spider:  fast, fragile, skittering.
 *  - brute:   big, slow, high-HP; a heavy bite with hard knockback.
 *  - spitter: hangs back and lobs an acid glob (ranged) instead of biting.
 *  - ghost:   a floating white sheet-ghost that PHASES THROUGH WALLS, drifting
 *             in a straight line at you (ignores the maze) — can't be kited by
 *             geometry. Fragile, translucent, silent.
 *  - bat:     a fast erratic flyer — weaves a sine wobble across its flight
 *             line, hard to line up, dies in one hit.
 *  - slime:   slow multiplying blob — splits into two fast minis on death.
 *  - reaper:  the DEATH DEALER — spawns after REAPER_AFTER seconds on a floor,
 *             phases through walls (ghost movement), accelerates forever and
 *             is IMMUNE to all damage. The floor timer with a scythe.
 *  - goblin:  BUMPER GOBLIN — bounces the player away on contact like a pop
 *             bumper; only momentum hits can hurt it.
 *  - pin:     BOWLING PIN — 1 HP, doesn't chase; slides when hit and chains
 *             into its crew (spawned in triangle formation).
 *  - golem:   BRICK GOLEM — a stationary wall with a slam; only breaks to a
 *             SECRET_BREAK_SPEED momentum hit, shatters into ricochet shards.
 *  - chomper: CHOMPER PLANT — stationary corridor gate, fast nasty snap; a
 *             momentum hit shoves it aside.
 *  - magnet:  MAGNET CRAWLER — drags the player toward it; wall contact or
 *             real momentum snaps the tether.
 *  - webspinner: ranged web shot — no damage, hard slow; any pinball part
 *             touch shakes the web off.
 */
export type EnemyKind =
  | "zombie"
  | "spider"
  | "brute"
  | "spitter"
  | "ghost"
  | "bat"
  | "slime"
  | "reaper"
  | "goblin"
  | "pin"
  | "golem"
  | "chomper"
  | "magnet"
  | "webspinner";

export interface Zombie extends Actor {
  /** Which enemy family — drives stats (speed/hp/damage) and which sheet. */
  kind: EnemyKind;
  hp: number;
  /** Full HP, for drawing a boss health bar (only set on the overlord). */
  maxHp?: number;
  /** True for the stairs-guarding mini-boss: health bar + reward on death. */
  boss?: boolean;
  mode: ZombieMode;
  speed: number;
  windupT: number;
  cooldown: number;
  flashT: number;
  /** Zombies never de-aggro — a horde that gives up isn't a horde. */
  aggro: boolean;
  /** Flame-puff immunity window — the cone burns in ticks, not per-puff. */
  burnT: number;
  /** CARD status (cards.ts): CHILL slows movement while > 0. */
  chillT?: number;
  /** CARD status: BURN damage-over-time timer + per-tick damage. */
  dotT?: number;
  dotDmg?: number;
  dotTickT?: number;
  /** Ghost/bat hover-bob + wobble phase accumulator (seconds); unused by grounded kinds. */
  bobT?: number;
  /** True for a slime spawned by a split — minis never split again. */
  mini?: boolean;
  /**
   * Resting tint for reskinned kinds (reaper red, golem stone, magnet blue…).
   * Everywhere a telegraph/flash clears its tint, it restores THIS, not null.
   */
  baseTint?: number | null;
  /** PIN only: live slide velocity from a knockback (chains into the crew). */
  slideVX?: number;
  slideVZ?: number;
  /** GHOST only: seconds left materialized (vulnerable). Immune while ≤ 0. */
  vulnT?: number;
}

/**
 * A friendly (or at least non-hostile) NPC on the floor — the Magician, the
 * Speed Witch, the Oracle Frog. Static-sprite actors with a tiny state machine
 * ticked by core.updateNpcs; never in the combat pipeline.
 */
export interface Npc {
  kind: "magician" | "witch" | "frog" | "merchant";
  x: number;
  z: number;
  sprite: { mesh: THREE.Mesh; dispose(): void };
  bobPhase: number;
  /** Seconds since spawn — drives the magician's bow → trick → vanish arc. */
  t: number;
  /** Frog: re-consultation cooldown. Witch: unused. Magician: unused. */
  cooldownT: number;
  /** Magician: which phase of the visit ("enter" | "trick" | "gone"). */
  phase?: string;
  /** MERCHANT only: current slide velocity (it flees when you close in). */
  vx?: number;
  vz?: number;
  /** MERCHANT only: true once its shop has been opened this floor. */
  shopped?: boolean;
}

// ── Pinball parts (the maze/pinball-machine hybrid) ──────────────
export type PinballPartKind =
  | "bumper"
  | "spring"
  | "ramp"
  | "booster"
  | "deflector"
  | "glove"
  | "oil"
  | "spinpad"
  | "slingshot"
  | "target"
  | "trapdoor"
  // Wave-G parts
  | "flipper"
  | "mirror"
  // Wave-H floor hazards (placed + animated like parts; no launch)
  | "pit"
  | "electric"
  | "firevent"
  | "magstrip";

export interface PinballPart {
  kind: PinballPartKind;
  /** Tile coords (from the LevelPlan) + world-centre position. */
  i: number;
  j: number;
  x: number;
  z: number;
  /** Unit direction: springs launch along it, ramps boost along it; a
   * deflector's two open corner legs are (dirX,dirZ) and (dir2X,dir2Z). */
  dirX: number;
  dirZ: number;
  dir2X: number;
  dir2Z: number;
  /** Re-trigger lockout so standing on a part doesn't machine-gun it. */
  cooldownT: number;
  /** Seconds since last hit, drives the pop/squash animation (-1 = never hit). */
  hitT: number;
  /** GLOVE / FIRE VENT: countdown to the next fire (self-firing on its clock). */
  fireT?: number;
  /** GLOVE / FIRE VENT: true once this fire's lane damage has been dealt. */
  punchSpent?: boolean;
  /** TARGET only: true once broken — a dead target never re-arms. */
  done?: boolean;
  /** BUMPER only: pops so far; at BUMPER_LIT_HITS it lights (Slice 5). */
  hits?: number;
  /** TARGET BANK (Slice 6): which drop-target bank this belongs to + its order
   * in it (0-based) + whether it's lit. Banked targets light in seq order and
   * don't count toward the break-them-all objective. */
  bank?: number;
  seq?: number;
  lit?: boolean;
  /** ELECTRIC only: per-plate phase offset (s) so a room pulses as a wave. */
  phase?: number;
  /** The part's mesh group in the scene (built by render/pinball-parts). */
  mesh: THREE.Object3D;
}

export interface GroundItem {
  kind: "weapon" | "gear" | "potion" | "card" | "coin";
  id: string; // WeaponId | GearSlot | PotionId | CardId | "coin"
  x: number;
  z: number;
  sprite: { mesh: THREE.Mesh; dispose(): void };
  bobPhase: number;
  /** Carried durability for weapons dropped in an exchange. Undefined = fresh. */
  durability?: number;
  /** Set on a just-dropped weapon: not grabbable until the player steps away. */
  blockedUntilAway?: boolean;
  /** Gold a coin drop is worth (kind === "coin"). */
  value?: number;
}

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Seconds left before it just expires (range / speed). */
  life: number;
  maxLife: number;
  damage: number;
  /** True for enemy projectiles (the spitter's glob) — these hit the PLAYER, not zombies. */
  hostile?: boolean;
  /** CURVE SHOT: a constant lateral acceleration (u/s²) bending the flight. */
  curveX?: number;
  curveZ?: number;
  mesh: THREE.Mesh;
  dispose(): void;
}

/** How many weapons the knight can carry. */
export const WEAPON_SLOTS = 2;

export const state = {
  active: false,
  onExitCallback: null as (() => void) | null,

  // DOM
  container: null as HTMLDivElement | null,
  hudEl: null as HTMLDivElement | null,
  gameOverEl: null as HTMLDivElement | null,
  /** The merchant's shop overlay while it's open (null = closed; sim pauses). */
  shopEl: null as HTMLDivElement | null,
  /** The between-floor TAVERN hub overlay while it's open (null = closed; sim
   * pauses, exactly like the shop). See tavern.ts. */
  tavernEl: null as HTMLDivElement | null,
  /** The first-person rampage overlay (crosshair + gun + red vignette). */
  fpsOverlayEl: null as HTMLDivElement | null,
  /** The centred ×N bounce-combo flash (pinball score glue). */
  comboFlashEl: null as HTMLDivElement | null,
  /** Last frame's bounce combo, so a rise fires the flash exactly once per step. */
  prevBounceCombo: 0,
  /** The overlord boss health bar (top-centre, shown only when a boss lives). */
  bossBarEl: null as HTMLDivElement | null,
  /** Set by anything that changes a HUD number; core repaints once per frame at most. */
  hudDirty: true,

  // Three
  renderer: null as THREE.WebGLRenderer | null,
  scene: null as THREE.Scene | null,
  camera: null as THREE.OrthographicCamera | null,
  pixelPass: null as PixelPass | null,
  vfx: null as VfxSystem | null,

  // Run state
  level: 1,
  kills: 0,
  /** Gold earned THIS run — banked into the shared wallet as it's earned. */
  goldRun: 0,
  gameOver: false,
  /** Seed for the whole run; each level derives its own stream from it. */
  runSeed: 0,

  // ── Per-floor score ledger (reset by startLevel; graded by descend) ──
  /** Seconds spent on the current floor — also the Death Dealer's fuse. */
  levelT: 0,
  /** state.kills as this floor started — the diff is this floor's carnage. */
  levelStartKills: 0,
  /** Horde size this floor spawned with (the carnage denominator). */
  levelHordeSize: 0,
  /** Best pinball bounce combo reached this floor (the style axis). */
  levelBestCombo: 0,
  /** True once this floor's Death Dealer has spawned (one per floor). */
  reaperOut: false,
  /** True once the pre-spawn warning toast has shown. */
  reaperWarned: false,

  // ── Wave A/E/F floor state (targets, NPCs, frenzy, world freeze) ──
  /** This floor's target-bullseye objective: total placed / broken so far. */
  targetsTotal: 0,
  targetsHit: 0,
  /** Pinball-PART hits inside the current live bounce combo (frenzy meter). */
  partComboHits: 0,
  /** True once this combo already paid its MULTIBALL FRENZY bonus. */
  frenzyPaid: false,
  /** Slice 5 — jackpot: bumpers on this floor, how many are lit, jackpot flash. */
  bumperTotal: 0,
  bumpersLit: 0,
  jackpotT: 0,
  /** Seconds the world is frozen (freeze-ray potion) — enemies + gloves halt. */
  freezeT: 0,
  /** Grade S/A on descent arms one extra vault room on the next floor. */
  bonusRoomNext: false,
  /** The floor's friendly NPCs (magician / witch / frog). */
  npcs: [] as Npc[],
  /** Countdown to the Magician's next visit (per floor). */
  magicianT: 0,
  /** True once this floor's smashed-secret witch has appeared (one per floor). */
  witchSpawned: false,
  /** Multi-Ball ghost-knight meshes while the buff runs (else null). */
  multiMeshes: null as THREE.Mesh[] | null,
  /** Shared ram cooldown for the multi-ball ghosts. */
  multiRamT: 0,
  /** Queued oracle-frog trail tiles, consumed a mote at a time by the loop. */
  frogTrail: [] as Array<{ x: number; z: number }>,
  frogTrailT: 0,

  // Loadout — two weapon slots; an empty active slot fights as fists.
  weaponSlots: [freshWeapon("sword"), null] as Array<WeaponState | null>,
  activeSlot: 0,
  gear: {} as GearState,
  /** RUN-persistent card stash — cards picked up but not yet socketed. Survives
   * floor rebuilds (kept by disposeLevel); reset only on a full new run. Max 10. */
  cardStash: [] as string[],
  /** Per-run cap: at most one legendary card drops from the dungeon per run. */
  legendaryDropped: false,

  // The level
  grid: null as Grid | null,
  stairs: null as TilePos | null,
  /** The player's spawn point this floor (world coords) — where a pit spits you back. */
  levelStart: { x: 0, z: 0 },
  maze: null as MazeHandle | null,
  groundItems: [] as GroundItem[],
  /** Non-interactive set dressing (bones, skulls, rubble). */
  props: [] as Array<{ sprite: { mesh: THREE.Mesh; dispose(): void } }>,

  // Actors
  player: null as Player | null,
  zombies: [] as Zombie[],
  projectiles: [] as Projectile[],
  /** The level's pinball components (bumpers/springs/ramps/deflectors). */
  pinballParts: [] as PinballPart[],
  /** Auto-derived banked corners (curved walls) — every qualifying maze corner
   * sweeps momentum leg→leg like a return lane. See collision.computeArcCorners. */
  arcCorners: [] as ArcCorner[],
  /** One knight atlas per weapon, built lazily — a swap is a texture switch. */
  playerSheets: new Map<WeaponId, SpriteSheet>(),
  /** Which weapon's art the player sprite currently shows. */
  playerArtWeapon: null as WeaponId | null,
  zombieSheet: null as SpriteSheet | null,
  /** A small pool of cosmetic zombie-variant sheets; each spawn picks one by seed. */
  zombieVariantSheets: [] as SpriteSheet[],
  /** The giant-spider atlas — one look, built once per session. */
  spiderSheet: null as SpriteSheet | null,
  /** The brute (tank) atlas. */
  bruteSheet: null as SpriteSheet | null,
  /** The spitter (ranged) atlas. */
  spitterSheet: null as SpriteSheet | null,
  /** The floating sheet-ghost atlas. */
  ghostSheet: null as SpriteSheet | null,
  /** The bat (fast flyer) atlas. */
  batSheet: null as SpriteSheet | null,
  /** The slime (splits on death) atlas. */
  slimeSheet: null as SpriteSheet | null,
  /** The overlord (mini-boss) atlas. */
  bossSheet: null as SpriteSheet | null,
  /** Wave-B bespoke atlases (were tinted reskins). */
  goblinSheet: null as SpriteSheet | null,
  pinSheet: null as SpriteSheet | null,
  golemSheet: null as SpriteSheet | null,
  chomperSheet: null as SpriteSheet | null,
  magnetSheet: null as SpriteSheet | null,
  webspinnerSheet: null as SpriteSheet | null,

  // AI
  flowField: null as Int32Array | null,
  flowTimer: 0,

  // Camera follow + screen shake
  camX: 0,
  camZ: 0,
  shakeT: 0,

  // ── RAMPAGE: the FPS "ultimate" ──
  // Charges from kills; when full the player can drop into a first-person
  // Doom/Wolfenstein view for a limited time and blast through the maze.
  /** 0..1 charge on the ultimate meter. */
  ultCharge: 0,
  /** True while the first-person rampage is active. */
  fpsActive: false,
  /** Seconds left in the current rampage. */
  fpsTimer: 0,
  /** Look yaw (radians) — where the FPS camera points on the ground plane. */
  fpsYaw: 0,
  /** Look pitch (radians), clamped — slight up/down freedom. */
  fpsPitch: 0,
  /** The perspective camera used only in rampage; built lazily. */
  fpsCamera: null as THREE.PerspectiveCamera | null,
  /** Shot cadence cooldown while in rampage. */
  fpsShotCd: 0,
  /** Muzzle-flash timer for the FPS gun overlay. */
  fpsFlashT: 0,
  /** Recoil: a transient upward pitch punch (radians) that decays each frame. */
  fpsKick: 0,
  /** Current kill-streak count during a rampage (resets if you go too long without a kill). */
  fpsStreak: 0,
  /** Seconds since the last rampage kill — the streak window. */
  fpsStreakT: 0,
  /** Hit-freeze: while > 0 the fixed-step sim is paused (VFX/render keep going). */
  hitstopT: 0,

  // ── Active-skill economy + HUD mode ──
  /** Which HUD is mounted: "diablo" is the iso strategy panel, "wolf" the rampage combat bar. */
  hudMode: "diablo" as "diablo" | "wolf",
  /** The two equipped skills — [Q, E]. */
  abilitySlots: ["flippercharge", "arcanepulse"] as [AbilityId | null, AbilityId | null],
  /** Per-ability cooldown remaining (seconds). */
  abilityCd: {} as Record<AbilityId, number>,
  /** Time Crawl: while > 0 the horde's dt is scaled down (slow-mo enemies). */
  slowT: 0,
  /** Diablo quick-use belt — 4 slots, keys Shift+1..4. Filled by potion pickups. */
  belt: [null, null, null, null] as Array<BeltSlot | null>,

  // Fixed-timestep accumulator
  accumulator: 0,

  // Loop
  animFrameId: null as number | null,
  lastTime: 0,
  elapsed: 0,

  // Style toggles (hidden debug keys Q/F/K/O)
  quantize: QUANTIZE_DEFAULT,
  dither: DITHER_DEFAULT,
  scanline: SCANLINE_DEFAULT,
  outline: OUTLINE_DEFAULT,

  // ── Debug/god-mode toggles (backtick panel, off by default) ──
  /** God mode: the knight takes no damage (hitPlayer/hitPlayerRanged short-circuit). */
  godMode: false,
  /** Infinite mana: the Q/E pool is topped up every frame. */
  infMana: false,
  /** No cooldowns: ability cooldowns are zeroed every frame. */
  noCooldown: false,

  // Listeners
  input: null as InputHandle | null,
  onKeyDown: null as ((e: KeyboardEvent) => void) | null,
  onResize: null as (() => void) | null,
};

/** What's in the active hand right now. An empty slot fights as fists. */
export function activeWeapon(): WeaponState {
  return state.weaponSlots[state.activeSlot] ?? { id: "fists", durability: Infinity };
}

export function freshPlayerFields(): Omit<Player, keyof Actor | "silhouette"> {
  return {
    hp: PLAYER_MAX_HP,
    facing: "S",
    attackT: -1,
    didHit: false,
    cooldown: 0,
    iframes: 0,
    flashT: 0,
    rageT: 0,
    hasteT: 0,
    shieldT: 0,
    ironT: 0,
    turboT: 0,
    springT: 0,
    multiT: 0,
    oilT: 0,
    webbedT: 0,
    curveT: 0,
    magBootsT: 0,
    mana: MANA_MAX,
    magnetAuraT: 0,
    bladeStormT: 0,
    bladeStormTickT: 0,
    rideT: -1,
    rideDur: 0,
    ridePts: [],
    hopT: -1,
    hopDur: 0,
    hopStartX: 0,
    hopStartZ: 0,
    hopLandX: 0,
    hopLandZ: 0,
    hopDirX: 0,
    hopDirZ: 0,
    hopSpeed: 0,
    rollT: -1,
    rollDirX: 0,
    rollDirZ: 0,
    sprintCharge: 0,
    overcharge: 0,
    momX: 0,
    momZ: 0,
    momSpeed: 0,
    ramT: 0,
    bounceCombo: 0,
    bounceComboT: 0,
    wallMoveT: -1,
    wallMoveDur: 0,
    wallMoveIfr: 0,
    wallMoveDist: 0,
    wallMoveDirX: 0,
    wallMoveDirZ: 0,
    wallMoveKind: null,
    comboStep: 0,
    comboWindowT: 0,
    chargeT: -1,
    attackBufferT: 0,
    move: null,
  };
}

export function resetState(): void {
  state.active = false;
  state.onExitCallback = null;
  state.container = null;
  state.hudEl = null;
  state.gameOverEl = null;
  state.shopEl = null;
  state.tavernEl?.remove();
  state.tavernEl = null;
  state.fpsOverlayEl = null;
  state.comboFlashEl = null;
  state.prevBounceCombo = 0;
  state.bossBarEl = null;
  state.hudDirty = true;
  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.pixelPass = null;
  state.level = 1;
  state.kills = 0;
  state.goldRun = 0;
  state.gameOver = false;
  state.runSeed = 0;
  state.levelT = 0;
  state.levelStartKills = 0;
  state.levelHordeSize = 0;
  state.levelBestCombo = 0;
  state.reaperOut = false;
  state.reaperWarned = false;
  state.targetsTotal = 0;
  state.targetsHit = 0;
  state.partComboHits = 0;
  state.frenzyPaid = false;
  state.bumperTotal = 0;
  state.bumpersLit = 0;
  state.jackpotT = 0;
  state.freezeT = 0;
  state.hudMode = "diablo";
  state.abilitySlots = ["flippercharge", "arcanepulse"];
  state.abilityCd = {} as Record<AbilityId, number>;
  state.slowT = 0;
  state.belt = [null, null, null, null];
  state.bonusRoomNext = false;
  state.npcs = [];
  state.magicianT = 0;
  state.witchSpawned = false;
  state.multiMeshes = null;
  state.multiRamT = 0;
  state.frogTrail = [];
  state.frogTrailT = 0;
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  state.cardStash = [];
  state.legendaryDropped = false;
  state.grid = null;
  state.stairs = null;
  state.maze = null;
  state.groundItems = [];
  state.props = [];
  state.player = null;
  state.zombies = [];
  state.projectiles = [];
  state.pinballParts = [];
  state.arcCorners = [];
  state.playerSheets = new Map();
  state.playerArtWeapon = null;
  state.zombieSheet = null;
  state.zombieVariantSheets = [];
  state.spiderSheet = null;
  state.bruteSheet = null;
  state.spitterSheet = null;
  state.ghostSheet = null;
  state.batSheet = null;
  state.slimeSheet = null;
  state.bossSheet = null;
  state.goblinSheet = null;
  state.pinSheet = null;
  state.golemSheet = null;
  state.chomperSheet = null;
  state.magnetSheet = null;
  state.webspinnerSheet = null;
  state.flowField = null;
  state.flowTimer = 0;
  state.camX = 0;
  state.camZ = 0;
  state.shakeT = 0;
  state.ultCharge = 0;
  state.fpsActive = false;
  state.fpsTimer = 0;
  state.fpsYaw = 0;
  state.fpsPitch = 0;
  state.fpsCamera = null;
  state.fpsShotCd = 0;
  state.fpsFlashT = 0;
  state.fpsKick = 0;
  state.fpsStreak = 0;
  state.fpsStreakT = 0;
  state.hitstopT = 0;
  state.vfx = null;
  state.accumulator = 0;
  state.animFrameId = null;
  state.lastTime = 0;
  state.elapsed = 0;
  state.input = null;
  state.onKeyDown = null;
  state.onResize = null;
}
