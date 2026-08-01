/**
 * Module state singleton — same pattern as mouse-game/state.ts.
 */
import { view } from "./engine/view-state";
import { setChainDepthSource } from "./engine/juice";
import { freshRail, type RailState } from "./entities/rail";
import type { ZombieType } from "./zombie-types";
import type * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { PixelPass } from "./engine/render/pixel-pass";
import type { VfxSystem } from "./fx/system";
import type { AimIndicator } from "./render/aim-indicator";
import type { ActorSprite, SpriteSheet } from "./engine/render/sprite";
import type { Animator, Facing } from "./engine/render/animator";
import type { Grid, TilePos } from "./maze/generator";
import type { Fog } from "./fog";
import type { ArcCorner } from "./engine/collision";
import type { MazeHandle } from "./maze/build";
import type { Doorway } from "./maze/doorways";
import type { InputHandle } from "./engine/input";
import type { WeaponState, WeaponId, GearState, ProjectileKind, ItemRarity } from "./items";
import { QUANTIZE_DEFAULT, DITHER_DEFAULT, SCANLINE_DEFAULT, OUTLINE_DEFAULT, PLAYER_MAX_HP, MANA_MAX } from "./constants";
import type { AbilityId } from "./abilities";
import type { RicochetFlavor } from "./entities/ricochet-form";

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

/**
 * MARBLE MATERIAL — a second "ball" axis (see entities/marble.ts). Not a potion:
 * it changes what the pinball is MADE OF (physics, on-bounce emission, slam
 * shoot-out, floor scarring). Held one at a time; a fresh pickup opens a brief
 * fusion window where the previous material co-fires before it expires.
 */
export type MarbleMaterial = "diamond" | "water" | "stone" | "storm" | "shadow" | "lava";

export interface Player extends Actor {
  hp: number;
  facing: Facing;
  /** -1 when not attacking, else seconds since the swing started. */
  attackT: number;
  /** True once this swing's active window has connected — one swing, one hit roll. */
  didHit: boolean;
  /** Did the CURRENT swing actually land on something? Gates the combo chain:
   *  whiffing drops you back to step 1 (COMBO_REQUIRES_HIT). */
  comboLanded: boolean;
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
  /** Seconds of oil-slick grease left (no friction, dead steering). */
  oilT: number;
  /** Seconds of web-slow left (webspinner hit; any part touch clears it). */
  webbedT: number;
  /** Seconds left on Curve Shot (projectiles bend around corners). */
  curveT: number;
  /** Seconds left on Magnet Boots (repel crawlers; strips LAUNCH not drag). */
  magBootsT: number;
  /** Seconds left on Multi-Ball (two echo knights trail you and ram). 0 = inactive. */
  multiBallT: number;

  // ── Marble material (see MarbleMaterial / entities/marble.ts) ──
  /** Active marble material, or null. Physics/emission read this. */
  material: MarbleMaterial | null;
  /** Seconds left on the active material. 0 = inactive (material cleared). */
  materialT: number;
  /** During a fusion window: the PREVIOUS material still co-firing its emitters. */
  fuseMaterial: MarbleMaterial | null;
  /** Fusion-window countdown; while > 0 both material + fuseMaterial emit. */
  fuseT: number;
  /** Throttle so on-bounce emission fires at most every MATERIAL_EMIT_COOLDOWN. */
  materialEmitT: number;

  // ── SQUASH & STRETCH (materialSquash) — the fluid materials deform on impact.
  /** Seconds left in the current squash; 0 = the ball is round. */
  squashT: number;
  /** Peak amplitude of this squash, 0..1 (material × impact speed). */
  squashAmp: number;
  /** The impact normal in SCREEN space, unit. The sprite is a camera-facing
   *  billboard, so the world normal is meaningless to it — what decides whether
   *  the ball flattens sideways or vertically is where the wall was ON SCREEN. */
  squashHx: number;
  squashHy: number;
  /** 🌑 Shadow lifesteal cooldown. Without it a ram through a packed corridor
   *  is a full heal, and the glass form becomes the safest in the game. */
  vampCdT: number;
  /** 🌑 How long the player has been inside masonry with phasing NOT active.
   *  Past SHADOW_PHASE_GRACE the eject fires — a run that ends sealed inside a
   *  wall is unrecoverable, so this net is not optional. */
  phaseStuckT: number;

  // ── RICOCHET FORM (entities/ricochet-form.ts) — ⚡ bolt / ✨ laser.
  /** Seconds left of uncontrolled ricochet. >0 means this form OWNS the player:
   *  updatePlayer returns early, input is ignored entirely. */
  ricochetT: number;
  /** Which flavour is running. Only meaningful while ricochetT > 0. */
  ricochetFlavor: RicochetFlavor;
  /** Cadence timer between pass-through damage ticks. */
  ricochetTickT: number;

  // ── Craft-only brews (Alchemist; see recipes.ts / applyPotion) ──
  /** Seconds left on Regen Salve (heals over time). 0 = inactive. */
  regenT: number;
  /** Countdown between Regen Salve heal ticks. */
  regenTickT: number;
  /** Seconds left on Venom Coat (your hits POISON). 0 = inactive. */
  venomCoatT: number;
  /** Seconds left on Stoneskin (incoming damage halved). 0 = inactive. */
  stoneT: number;
  /** Seconds left on Static Charge (hits arc to a nearby foe). 0 = inactive. */
  staticT: number;
  /** Cooldown before a Storm-card thunderbolt may fire again. 0 = ready. */
  boltCdT: number;
  /** Seconds left on Greed Draught (double kill gold). 0 = inactive. */
  greedT: number;

  // ── Active-skill economy (Diablo HUD) ──
  /** Spendable mana pool for the Q/E abilities (0..MANA_MAX). Separate from ultCharge. */
  mana: number;
  /** Seconds left on Magnet Aura (ground items drift to you). 0 = inactive. */
  magnetAuraT: number;
  /** Seconds the Flipper Charge fire trail keeps burning behind the ride. */
  fireTrailT: number;
  /** Seconds left on Blade Storm (orbiting blades bite nearby foes). 0 = inactive. */
  bladeStormT: number;
  /** Cadence timer between Blade Storm damage ticks. */
  bladeStormTickT: number;

  // ── Trapdoor hatch drop ──
  // The beat BEFORE the ride: the hatch swings wide, the knight is pulled onto
  // it and falls through. Owns the player (like the ride) so the door animation
  // is something you watch happen to you, not something you run out of.
  /** -1 when not dropping, else seconds into the hatch drop. */
  dropT: number;
  /** Hatch centre the drop pulls toward and falls through. */
  dropX: number;
  dropZ: number;

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
  /** GROOVE BUMP: seconds left in the little airborne hop over a rut. 0 = grounded. */
  grooveHopT: number;
  /** Total duration of the current groove hop (so the arc can be normalised). */
  grooveHopDur: number;
  /** Re-arm timer so a dense trail can't fire a hop every frame. */
  grooveHopCdT: number;
  /** DEFLECTOR GRAB-THROW: seconds left the knight is caught by a deflector,
   *  pinned + winding up before the launch. 0 = not grabbed. */
  grabT: number;
  /** Grab pin point (deflector centre) and the throw the wind-up releases into. */
  grabX: number;
  grabZ: number;
  throwDirX: number;
  throwDirZ: number;
  throwSpeed: number;
  /** Bounce COMBO: climbs per wall hit (Sonic combo), resets after PINBALL_COMBO_WINDOW. */
  bounceCombo: number;
  /** Seconds since the last bounce — resets bounceCombo when it lapses. */
  bounceComboT: number;
  /**
   * BANKED RAIL ride (entities/rail.ts) — which inside curve is being held,
   * how long for, and how long since the hold lapsed. This is the only state
   * in the game allowed to carry speed past PINBALL_MAX_SPEED.
   */
  rail: RailState;

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

export type ZombieMode = "idle" | "chase" | "windup" | "dead" | "charge" | "slam";

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
 *  - rotortail: AIRBORNE BOMBARDIER — circles at altitude and hurls a slow,
 *             heavy timber. Fragile, and a solid hit stalls its rotor.
 *  - stiltneck: SIEGE BOMBARDIER — slings a lit bomb from the pannier on its
 *             back. The only hostile shot with a FUSE and a BLAST, and the only
 *             one that hurts the horde too.
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
  | "sporeling"
  | "jester"
  | "croaker"
  | "rotortail"
  | "stiltneck"
  | "magnet"
  | "webspinner"
  // ── Expansion roster (see CONTENT_EXPANSION_PLAN.md) ──
  | "hound" // CHARGER — telegraphs a locked-line dash, self-stuns if it whiffs
  | "bloater" // EXPLODER — bursts into a fire puddle on death / on reaching you
  | "necromancer" // SUMMONER — hangs back, raises weak adds on a timer
  | "warden" // SHIELDER — grants a damage-absorb shield to nearby foes
  | "wisp" // EVASIVE — short-blinks away when hit, hard to pin
  | "sapper" // ANTI-MATERIAL — drains your active marble on hit
  | "crystalback" // REFLECTOR — ramming it at speed shatters shards into YOU
  | "mimic"; // AMBUSHER — dormant + item-like until you're close, then lunges

export interface Zombie extends Actor {
  /** Co-op network id — assigned by makeZombie in creation order, which is
   * seed-deterministic at startLevel so every pool member agrees on the horde. */
  nid?: string;
  /** Which enemy family — drives stats (speed/hp/damage) and which sheet. */
  kind: EnemyKind;
  hp: number;
  /** Full HP, for drawing a boss health bar (only set on the overlord). */
  maxHp?: number;
  /** True for the stairs-guarding mini-boss: health bar + reward on death. */
  boss?: boolean;
  /**
   * Collision radius override, when this actor's sprite was scaled away from
   * its kind's default. Absent = use the STATS table (the normal case).
   *
   * Set for the Reaper King, whose mesh is scaled 2.17x: without it the
   * collider stayed at the brute's 0.42 while the visible body was ~0.91 wide,
   * so the king walked half-buried into 1-tile corridors. Anything that scales
   * a sprite mesh must set this too, or it will drift the same way.
   */
  bodyR?: number;
  /**
   * Behavioural SUB-TYPE, only meaningful for `kind: "zombie"` (zombie-types.ts).
   * Runner/lurcher/hulk/midget/crawler/flailer/hobbler are multiplier bundles
   * over the zombie baseline rather than EnemyKinds, because EnemyKind feeds six
   * exhaustive Record tables and eight near-identical rows in each is not a
   * design.
   *
   * DERIVED from the shared spawn hash on every peer — never transmitted — so
   * co-op stays in agreement about which zombie is a hulk. Absent = shambler.
   */
  ztype?: ZombieType;
  /**
   * Per-actor gait phase for the HOBBLER's limp, seeded from `nid` so two
   * hobblers never limp in lockstep and every peer computes the same wobble.
   */
  gaitPhase?: number;
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
  /** OIL slick (Slick Field): while > 0 steering barely bites — the foe's
   *  heading blends toward its intent so slowly it slides past corners. */
  oiledT?: number;
  /** OIL slick: the greased heading the foe is actually travelling on. */
  oilHX?: number;
  oilHZ?: number;
  /** WATER slick: seconds an enemy keeps sliding (loses traction; drifts). */
  slipT?: number;
  /** WATER slick: unit drift direction while slipping. */
  slipVX?: number;
  slipVZ?: number;
  /** SHADOW decoy: seconds this foe is lured toward a shadow clone (not you). */
  lureT?: number;
  /** SHADOW decoy: the clone position the foe walks toward while lured. */
  lureX?: number;
  lureZ?: number;
  // ── Expansion-roster behavior state ──
  /** CHARGER: locked dash direction + timer while in mode "charge". */
  chargeT?: number;
  chargeDirX?: number;
  chargeDirZ?: number;
  /** CROAKER hop: seconds of airtime left (>0 = airborne), and the locked
   *  heading. Separate from chargeT because a hop and a charge differ in the
   *  one way that matters — a charge ENDS on a wall, a hop bounces off it. */
  hopT?: number;
  hopDirX?: number;
  hopDirZ?: number;
  /** Ricochets left in the current hop (CROAKER_HOP_BOUNCES at launch). */
  hopBounces?: number;
  /** Cooldown before the next hop may be gathered. */
  hopCd?: number;
  /** WARDEN shield: absorb-HP remaining (a Warden aura tops this up). */
  shieldHp?: number;
  /** BRUTE / enrage: true once it crossed its low-HP rage threshold. */
  enraged?: boolean;
  /** NECROMANCER / WARDEN cadence between summons / shield pulses. */
  castT?: number;
  /** MIMIC: dormant + disguised until the player steps close. */
  dormant?: boolean;
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
  /**
   * MOVEMENT scratch (entities/movement.ts). These four are the ONLY state a
   * steering policy owns, and they are deliberately generic: `moveT` is a
   * strafer's dart cadence, an orbiter's spiral clock and a leaper's recovery
   * timer, because a per-policy field on every actor would put six dead numbers
   * on every zombie in a 175-actor horde.
   *
   * `movePhase` is the per-actor asymmetry (which way a flanker peels, which way
   * an orbiter rings), derived from `nid` at spawn — NOT Math.random, so two
   * co-op peers watching the same horde see the same arcs.
   */
  movePhase?: number;
  moveCommit?: number;
  moveT?: number;
  moveDirX?: number;
  moveDirZ?: number;
  /**
   * STAGGER (entities/stagger.ts) — Doom's pain chance, paid with a PoE entropy
   * accumulator instead of dice. `painEntropy` banks chance × 100 per impact and
   * fires when it crosses 100; `staggerT` is the frozen window it buys.
   * `dodgeEntropy` is the same machinery for the `dodges-ranged` sub-type
   * exception, kept as a SEPARATE counter so a sub-type that both staggers and
   * dodges cannot have one stream starve the other.
   *
   * Counters, not rolls, so a co-op peer and a replay agree by construction.
   */
  painEntropy?: number;
  staggerT?: number;
  dodgeEntropy?: number;
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
  /** MERCHANT only: current unit heading (it flees when you close in). */
  vx?: number;
  vz?: number;
  /** MERCHANT only: true once its shop has been opened this floor. */
  shopped?: boolean;
  /**
   * MERCHANT only: seconds left committed to the current heading after being
   * blocked. Without this the flee vector is recomputed every tick, which
   * overwrites the wall-bounce and makes the cart ride the wall forever.
   */
  dwellT?: number;
  /** MERCHANT only: countdown to the next cart-bell ring, so it's findable. */
  bellT?: number;
}

// ── Pinball parts (the maze/pinball-machine hybrid) ──────────────
export type PinballPartKind =
  | "bumper"
  | "spring"
  | "ramp"
  | "booster"
  // The booster family — a corner that accelerates you round a turn, a curved
  // lane that carries you along an authored arc, and a kicker that hops you
  // clean over a wall band. See maze/decorate.ts PartSpotKind.
  | "boostcorner"
  | "boostcurve"
  | "jumppad"
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
  // A GRAVE PIT — torn open where a player left the pool. Unlike "pit" (climb
  // out, lose a heart) this one kills outright: it is the scar a detonating
  // knight leaves, and it is spawned at RUNTIME, not dealt at level-gen.
  | "gravepit"
  | "electric"
  | "firevent"
  | "magstrip"
  | "rollover"
  // Light-puzzle brazier: roll over it to light it; all lit opens the vault.
  | "lamp";

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
  /**
   * LIT SHOT: true while the knight's momentum ray points at this part — the
   * "shoot here now" light a real table has. Recomputed every frame by
   * render/pinball-parts.updatePinballParts; never persisted.
   */
  aimed?: boolean;
  /** ORBIT (D2): circuit id + this corner's clockwise order in the ring. */
  orbit?: number;
  orbitSeq?: number;
  /** ROLLOVER LANE (D3): lane-array id + which lane across the array. */
  lane?: number;
  laneSeq?: number;
  /**
   * BOOSTER JAM guard: consecutive re-fires that caught the ball in the same
   * spot, and where/when that streak was last seen. A pad aimed into a sharp
   * corner catches the rebound and re-launches it forever; the pocket-rattle
   * damp can't break that because this pad's speed FLOOR undoes the damping.
   * Counting the re-fires lets the pad notice it is the one doing the trapping.
   */
  jamN?: number;
  jamX?: number;
  jamZ?: number;
  jamT?: number;
  /** The part's mesh group in the scene (built by render/pinball-parts). */
  mesh: THREE.Object3D;
}

/**
 * Live flight state for a dropped coin (`kind === "coin"`). While this exists
 * the coin OWNS its sprite's world Y for its whole life — the shared ground-item
 * bob in the render loop skips any item carrying one, so there is exactly one
 * writer for a coin's height.
 */
export interface CoinFlight {
  phase: "burst" | "rest" | "magnet";
  /** Height above the floor, world units. */
  y: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since the coin was minted — arms the magnet (see COIN_ARM_TIME). */
  age: number;
  /** Seconds into the magnet flight; absorb fires at COIN_MAGNET_TIME. */
  magT: number;
  /** Where the magnet flight began, so the arc is a clean parametric lerp. */
  fromX: number;
  fromY: number;
  fromZ: number;
}

/**
 * One card in the FLOOR HAUL — what was picked up, the line saying where it
 * went (socketed into which weapon / stashed n-of-10), and whether the run had
 * seen that card before. Revealed as one screen when the floor ends; see
 * card-reader.ts.
 */
export interface HaulEntry {
  id: string;
  note: string;
  /** First copy of this card this run. */
  fresh?: boolean;
}

export interface GroundItem {
  /** Co-op network id — set on items every pool member should agree on (floor
   * loot + authority drops). Coins are personal juice and never carry one. */
  nid?: string;
  kind: "weapon" | "gear" | "potion" | "card" | "coin" | "reagent" | "material";
  id: string; // WeaponId | GearSlot | PotionId | CardId | "coin" | ReagentId | MarbleMaterial
  x: number;
  z: number;
  sprite: { mesh: THREE.Mesh; dispose(): void };
  bobPhase: number;
  /** Carried durability for weapons dropped in an exchange. Undefined = fresh. */
  durability?: number;
  /** Rolled ITEM RARITY (weapons/gear) — decides how many cards it can socket.
   *  Undefined = common. Carried on the ground item so a dropped-and-regrabbed
   *  weapon keeps the rarity it was found with. */
  rarity?: ItemRarity;
  /** Socketed cards riding along on a dropped weapon, so an exchange does not
   *  silently strip them. */
  cards?: string[];
  /** Weaponsmith upgrade level carried across a drop/pickup. */
  upgrade?: number;
  /** Set on a just-dropped weapon: not grabbable until the player steps away. */
  blockedUntilAway?: boolean;
  /** Gold a coin drop is worth (kind === "coin"). */
  value?: number;
  /**
   * Set on items lying in a CORPSE PILE: the pool id of the knight who died
   * (or "" for a solo/offline death). Monster loot is shared with the floor,
   * but a corpse belongs to whoever dropped it — see corpse-run.canLoot. The
   * pile still renders for everyone; only the pickup is gated.
   */
  corpseOwner?: string;
  /** Which stored pile this item came from, so an emptied pile can be cleared. */
  corpseId?: string;
  /** Burst/rest/magnet flight state (kind === "coin"). See CoinFlight. */
  coin?: CoinFlight;
  /** Seconds left before this item may print its refusal note again. */
  noteCd?: number;
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
  /** PIERCE card: extra foes this shot passes through before dying. */
  pierced?: number;
  mesh: THREE.Mesh;
  dispose(): void;
}

/** Persistent floor scar left by a marble material (see entities/floor-fx.ts).
 *  Ticks status/damage to overlapping enemies (and the player under self-harm). */
export type FloorFxKind = "slick" | "fire" | "shard-field" | "oil" | "groove" | "frost" | "tar" | "rod" | "molten";
export interface FloorFx {
  kind: FloorFxKind;
  x: number;
  z: number;
  /** True for an ENEMY-created hazard: it burns the PLAYER (ungated) and spares
   *  enemies, the mirror of the player's own material scars. */
  hostile?: boolean;
  /** Effect radius, world units. */
  radius: number;
  /** Seconds left before it fades. */
  life: number;
  maxLife: number;
  /** Countdown between damage/status ticks. */
  tick: number;
  /**
   * GROOVE only — the unit heading the ball was travelling when it cut this
   * rut. A groove is a DIRECTIONAL feature: crossing one broadside kicks the
   * ball up and deflects it, while running along it drops you in and rails
   * you. Without a stored heading a rut is just a circle and can only ever
   * pull toward its centre. Undefined for every other kind.
   */
  dirX?: number;
  dirZ?: number;
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
  /**
   * True while any open screen PAUSES the world.
   *
   * This one boolean replaces eight `HTMLDivElement | null` fields
   * (`gameOverEl`, `shopEl`, `tavernEl`, `cardReaderEl`, `menuEl`,
   * `fpsOverlayEl`, `bossBarEl`, `plungerMeterEl`). Modality used to be stored
   * in the DOM: `isSimPaused()` asked whether four particular nodes existed, so
   * the most consequential boolean in the game — the one `simulate()` early-
   * returns on — lived in the document tree. A screen that forgot to null its
   * element froze the world forever; one that nulled it early let monsters move
   * under an open menu.
   *
   * Maintained SOLELY by `gui/stack.ts` (`syncPause`); nothing else may write
   * it. It also gates keyboard capture — see the note there on why "a screen is
   * open" and "the UI owns the keyboard" must not be the same question.
   */
  uiPauses: false,
  /** Last frame's bounce combo, so a rise fires the flash exactly once per step. */
  prevBounceCombo: 0,
  /** Set by anything that changes a HUD number; core repaints once per frame at most. */
  hudDirty: true,

  // ── Three ──
  //
  // renderer/scene/camera are OWNED BY THE ENGINE (engine/view-state.ts) and
  // reached here through accessors. The engine writes them; the game reads
  // them through `state` exactly as it always has, so no call site changed.
  //
  // These are deliberately not plain fields holding copies: two copies of a
  // camera reference drift the moment one side re-creates it on a resize, and
  // the stale side then renders to a dead target.
  get renderer(): WebGPURenderer | null {
    return view.renderer;
  },
  set renderer(v: WebGPURenderer | null) {
    view.renderer = v;
  },
  get scene(): THREE.Scene | null {
    return view.scene;
  },
  set scene(v: THREE.Scene | null) {
    view.scene = v;
  },
  get camera(): THREE.OrthographicCamera | null {
    return view.camera;
  },
  set camera(v: THREE.OrthographicCamera | null) {
    view.camera = v;
  },
  pixelPass: null as PixelPass | null,
  vfx: null as VfxSystem | null,
  /** Pinball heading/steer arrows — only visible while rolling. */
  aimIndicator: null as AimIndicator | null,

  // Run state
  level: 1,
  kills: 0,
  /** Gold earned THIS run — banked into the shared wallet as it's earned. */
  goldRun: 0,
  gameOver: false,
  /** Seed for the whole run; each level derives its own stream from it. */
  runSeed: 0,

  // ── Run-scoped leaderboard ledger ──
  // Distinct from the per-floor ledger below, which startLevel() wipes. These
  // survive a descent and are only reset when a NEW RUN begins, because that is
  // what a leaderboard row describes.
  /** Deepest floor REACHED this run (1-based). */
  runDeepestFloor: 1,
  /** Best bounce combo across the whole run — levelBestCombo resets per floor. */
  runBestCombo: 0,
  /** performance.now() at run start; the run's duration is measured from it. */
  runStartMs: 0,
  /** Wall-clock seconds spent sim-paused this run (menus, card reader, shop,
   * tavern). Subtracted from the leaderboard duration so reading a card or
   * browsing the menu doesn't count against the run's pace. */
  pausedRunS: 0,
  /** True once this run's score has been posted, so death can't double-submit. */
  runScoreSubmitted: false,
  // ── Run-scoped SHOT ledger ──
  // The machine's whole shot layer — orbits, lane banks, jackpots and named
  // combos — used to pay gold and nothing else, so a run that played the table
  // beautifully scored identically to one that walked it. These are the run
  // totals the leaderboard now reads (see run-score.ts).
  /** Named combos completed this run (each name pays once per FLOOR). */
  runNamedShots: 0,
  /** Orbit laps completed this run. */
  runOrbitLaps: 0,
  /** Jackpots fired this run. */
  runJackpots: 0,
  /** Best per-floor FLOW (0..1 average momentum) reached this run. */
  runBestFlow: 0,
  /** Floors cleared this run without taking a single hit. */
  runFlawlessFloors: 0,

  // ── Per-floor score ledger (reset by startLevel; graded by descend) ──
  /** Seconds spent on the current floor — also the Death Dealer's fuse. */
  levelT: 0,
  /** state.kills as this floor started — the diff is this floor's carnage. */
  levelStartKills: 0,
  /** Horde size this floor spawned with (the carnage denominator). */
  levelHordeSize: 0,
  /** Best pinball bounce combo reached this floor (the style axis). */
  levelBestCombo: 0,
  // ── FLOW: the grade's pace axis (see gradeFloor in core.ts) ──
  // Pace used to be raw wall-clock, which graded a brisk WALK exactly like a
  // beautifully carried line — the one thing the game is actually about was
  // the one thing the grade could not see. Flow is the time-weighted average
  // of `momentumT(momSpeed)` over the floor: integral / elapsed.
  /** ∫ momentumT(speed) dt over this floor. */
  levelFlowSum: 0,
  /** Seconds of that integral (sim time, so pauses don't dilute it). */
  levelFlowT: 0,
  /** Hits taken this floor — 0 at the stairs earns the flawless heart. */
  levelHitsTaken: 0,
  /** Jackpots fired this floor. */
  jackpots: 0,
  /** True once this floor's Death Dealer has spawned (one per floor). */
  reaperOut: false,
  /** True once the pre-spawn warning toast has shown. */
  reaperWarned: false,
  /** Boss floor: the stairs won't descend until the guardian boss is slain. Set
   * by boss.ts spawnBoss, cleared when the boss dies (portal opens). */
  exitLocked: false,

  // ── Wave A/E/F floor state (targets, NPCs, frenzy, world freeze) ──
  /** This floor's target-bullseye objective: total placed / broken so far. */
  targetsTotal: 0,
  targetsHit: 0,
  /** Pinball-PART hits inside the current live bounce combo (frenzy meter). */
  partComboHits: 0,
  /** True once this combo already paid its FRENZY bonus. */
  frenzyPaid: false,
  /** Tempo zone the live bounce combo currently sits in (Part 2 signals fire
   *  on upward crossings). Reset implicitly when the combo lapses to launch. */
  comboZone: "launch" as import("./entities/combo-curve").ComboZone,
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
  /** One-shot teach: shown the first time you bounce off a crack too slowly. */
  crackHintShown: false,
  /** One-shot teach: shown the first time the stairs beacon comes into view. */
  stairsHintShown: false,

  // ── D2 ORBITS: a lap round a room's four banked rails is a LOOP SHOT ──
  /** Circuit id currently being railed, or -1. */
  orbitActive: -1,
  /** Corner seq of the last rail hit on the active circuit. */
  orbitLast: -1,
  /** How many corners of the active lap are done (4 = a full lap). */
  orbitCount: 0,
  /** Seconds left to keep the lap alive; a lapse abandons it. */
  orbitT: 0,
  /** Laps completed this floor — each one pays more (the ladder). */
  orbitLaps: 0,

  // ── D3 ROLLOVER LANES: light every lane in a bank; dodge rotates them ──
  /** lit[arrayId] = array of booleans, one per lane across that bank. */
  laneLit: {} as Record<number, boolean[]>,
  /** Banks completed this floor. */
  lanesCleared: 0,

  // ── D4 THE PLUNGER: the floor opens PARKED in a launch chute you pull ──
  /** True while the knight is parked awaiting the player's plunger launch. */
  plungerArmed: false,
  /** True once the player has grabbed the plunger (held the dodge key ≥1 frame). */
  plungerCharging: false,
  /** 0..1 pull amount → launch speed on release. */
  plungerPower: 0,
  /** Screen-space aim offset (radians), steered ←/→, clamped ±PLUNGER_AIM_MAX. */
  plungerAim: 0,
  /** Base launch direction (unit WORLD vector), down the lane toward the parts. */
  plungerBaseX: 0,
  plungerBaseZ: 0,
  /** Live launch direction (base + steer), set each frame while armed — the
   *  visible plunger rig reads this to orient and the launch fires along it. */
  plungerDirX: 0,
  plungerDirZ: 1,
  /** Skill-shot target to arm the instant the ball is fired, or null. */
  plungerSkill: null as { i: number; j: number } | null,

  // ── D4 SKILL SHOT: the plunger launch that opens every floor ──
  /** True from the floor's plunger launch until the skill window lapses. */
  skillArmed: false,
  /** Seconds left to land the skill shot. */
  skillT: 0,
  /** The part the skill shot must hit (tile coords), or null. */
  skillTarget: null as { i: number; j: number } | null,

  // ── D5 NAMED SHOTS: the last few shot IDENTITIES inside the live combo ──
  /** Shot kinds hit in order this combo (e.g. ["ramp","orbit","bank"]). */
  shotChain: [] as string[],
  /** Named combos already paid this floor — each pays once, so it stays special. */
  namedPaid: {} as Record<string, boolean>,
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
  /** One mythic per run, same shape as the legendary latch. */
  mythicDropped: false,
  /** RUN-scoped alchemy pouch — reagent id → count, gathered from kills, spent
   * brewing at the Tavern Alchemist (recipes.ts). Wiped on death like the rest
   * of the run (only wallet gold + legacy perks survive). */
  reagents: {} as Record<string, number>,
  /** Empty Flask catalyst count — the RO "Empty Bottle" every brew consumes. */
  flasks: 0,
  /**
   * RUN-scoped kill tally per EnemyKind, plus a `zombie:<ztype>` key per zombie
   * SUB-TYPE. Feeds the BESTIARY (bestiary.ts): an entry reveals what a monster
   * drops only once you have actually fought it, so the screen teaches through
   * play instead of handing over a wiki. Reset alongside `reagents`.
   */
  killsByKind: {} as Record<string, number>,
  /** Elixir of Life's run-scoped max-hearts bonus (feeds playerMaxHp). */
  bonusMaxHp: 0,
  /** CardIds already read this run. Kept for the haul screen's NEW badge. */
  seenCards: new Set<string>(),
  /**
   * THE FLOOR HAUL — every card picked up since the last tavern visit, in the
   * order it was found, with the line saying where it went (socketed / stashed).
   *
   * Cards no longer interrupt the fight to be read: the pickup fires a corner
   * toast, appends here, and the whole haul is revealed as one screen when the
   * floor is cleared and the tavern opens (core.descend → showCardHaul).
   * Consumed and emptied there.
   */
  floorHaul: [] as HaulEntry[],

  // The level
  grid: null as Grid | null,
  /**
   * WALL EROSION (entities/wall-erosion.ts) — tile "i,j" → partial damage 0..1.
   * A tile in here is still SOLID and still collides; it is simply part-melted.
   * At 1 the entry is dropped and smashWallAt opens the wall for real. Cleared
   * on every descent: a new floor is new masonry.
   */
  wallErosion: new Map<string, number>(),
  /**
   * Which tiles of this floor have been seen. MUST be re-allocated per floor —
   * levelConfig() changes the grid dimensions every level, so a fog buffer
   * carried across a descent would be both wrongly sized and a spoiler.
   */
  fog: null as Fog | null,
  stairs: null as TilePos | null,
  /** The player's spawn point this floor (world coords) — where a pit spits you back. */
  levelStart: { x: 0, z: 0 },
  maze: null as MazeHandle | null,
  /**
   * This floor's authored openings between sections (maze/doorways.ts).
   *
   * Kept so `__dungeonDoorways()` can point at one in the RUNNING game. That is
   * not developer convenience: two of the last three generator defects shipped
   * because they were verified against the generator's own numbers rather than
   * against the floor a player stands on, and the boss-at-the-spawn one took a
   * user to catch. `__dungeonBoss()` exists for the same reason.
   */
  doorways: [] as Doorway[],
  /**
   * This floor's archetype rooms (speedway / bumper / arena / vault).
   *
   * `decorateMaze` returns these on its LevelPlan, but the plan used to be a
   * local const in `startLevel` and only `maze` survived — so `plan.rooms` was
   * computed, used to furnish the floor, then discarded, and the floor map had
   * no way to label a room. Stashed here so `map-render` can.
   *
   * Typed structurally rather than importing `PlannedRoom` from `maze/decorate`
   * to keep `state.ts` free of a dependency on the generator.
   */
  levelRooms: [] as Array<{ i0: number; j0: number; w: number; h: number; kind: string }>,
  groundItems: [] as GroundItem[],

  /**
   * LIGHT PUZZLE (per floor): a sealed loot vault plus scattered braziers. Roll
   * the pinball knight over every brazier to light them all; the last one opens
   * the vault (spawns loot at the chest). `null` on floors that don't roll one.
   * Built in startLevel, reset in resetState + disposeLevel.
   */
  lampPuzzle: null as null | {
    total: number;
    lit: number;
    unlocked: boolean;
    vault: { i: number; j: number; x: number; z: number };
    loot: string[];
    chest: THREE.Object3D | null;
    openT: number; // seconds since the vault opened (drives the reveal anim)
  },
  /** Non-interactive set dressing (bones, skulls, rubble). */
  props: [] as Array<{ sprite: { mesh: THREE.Mesh; dispose(): void } }>,

  // Actors
  player: null as Player | null,
  zombies: [] as Zombie[],
  projectiles: [] as Projectile[],
  /** Persistent floor scars from marble materials (slick/fire/shard-field). */
  floorFx: [] as FloorFx[],
  /** The level's pinball components (bumpers/springs/ramps/deflectors). */
  pinballParts: [] as PinballPart[],
  /** Auto-derived banked corners (curved walls) — every qualifying maze corner
   * sweeps momentum leg→leg like a return lane. See collision.computeArcCorners. */
  arcCorners: [] as ArcCorner[],
  /** Knight atlases keyed on weapon+gear look (render/knight-look.lookKey),
   * built lazily and LRU-capped WITH texture dispose — see render/knight-sheets. */
  playerSheets: new Map<string, SpriteSheet>(),
  /** Which (weapon, look) key the player sprite currently shows. */
  playerArtKey: null as string | null,
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

  sporelingSheet: null as SpriteSheet | null,
  jesterSheet: null as SpriteSheet | null,
  croakerSheet: null as SpriteSheet | null,
  rotortailSheet: null as SpriteSheet | null,
  stiltneckSheet: null as SpriteSheet | null,
  houndSheet: null as SpriteSheet | null,
  /** Baked TINTED atlases for the expansion roster (spawn/factory.ts
   * makeExpansion): borrowed sheet × tint, re-snapped to the palette so the
   * monster is palette-exact instead of a GPU multiply the quantizer mangles.
   * Keyed by EnemyKind; reset with the rest of the sheets in dispose.ts. */
  expansionSheets: {} as Partial<Record<EnemyKind, SpriteSheet>>,

  // AI
  flowField: null as Int32Array | null,
  flowTimer: 0,

  // Camera follow + screen shake — engine-owned, see the note on `renderer`.
  get camX(): number {
    return view.camX;
  },
  set camX(v: number) {
    view.camX = v;
  },
  get camZ(): number {
    return view.camZ;
  },
  set camZ(v: number) {
    view.camZ = v;
  },
  get shakeT(): number {
    return view.shakeT;
  },
  set shakeT(v: number) {
    view.shakeT = v;
  },

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
  /** Hit-freeze: while > 0 the fixed-step sim is paused (VFX/render keep going).
   *  Engine-owned (the juice governor writes it) — see the note on `renderer`. */
  get hitstopT(): number {
    return view.hitstopT;
  },
  set hitstopT(v: number) {
    view.hitstopT = v;
  },
  /** Full-screen white flash left (katana finisher) — decays in REAL time in the
   *  render loop, so it plays through its own hitstop. Drives pixelPass.setFlash. */
  flashT: 0,

  // ── Active-skill economy + HUD mode ──
  /** Which HUD is mounted: "diablo" is the iso strategy panel, "wolf" the rampage combat bar. */
  hudMode: "diablo" as "diablo" | "wolf",
  /** The two equipped skills — [Q, E]. */
  abilitySlots: ["flippercharge", "arcanepulse"] as [AbilityId | null, AbilityId | null],

  // ── Character progression (run-scoped; legacy perks persist in legacy.ts) ──
  /** XP into the current level. */
  charXp: 0,
  /** Character level (1-based). Not the floor — that's `level` above. */
  charLevel: 1,
  /** Unspent skill points (one per level-up). */
  skillPoints: 0,
  /** Ranks taken per skill node (skills.ts SKILLS). */
  skillRanks: {} as Record<string, number>,
  /** Abilities available to the Q/E slots — defaults + tree unlocks. There are
   *  exactly TWO slots, so the two defaults fill them; every other ability is
   *  earned in the arcana branch (including Slick Field, which shipped free by
   *  accident — see skills.ts `unlockslick`). */
  unlockedAbilities: ["flippercharge", "arcanepulse"] as AbilityId[],
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

  // ── Marble-material R&D toggles (backtick panel; all default ON) ──
  /** Master switch: material physics/emission active at all. */
  dbgMaterialEnabled: true,
  /** Emit projectiles/shockwaves/slick on wall bounces. */
  dbgMaterialOnBounce: true,
  /** Fire the material slam emitter from pounceSlam(). */
  dbgMaterialSlam: true,
  /** Spawn persistent floor scars (slick/fire). */
  dbgMaterialFloorFx: true,
  /** Player takes damage standing on their own hazard floor tiles. */
  dbgMaterialSelfHarm: false,
  /** Material × terrain reactions (water→steam, stone plows, diamond discharge). */
  dbgMaterialTerrain: true,
  /** R&D: drop all three materials near the floor-1 spawn. */
  dbgMaterialFloor1Spawn: true,

  /**
   * R&D: every kill drops a card (forces the COMMON gate in rollCardDrop).
   *
   * OFF by default, and it must stay off — the live rate is COMMON_DROP_CHANCE
   * (1%). This exists because the card path (pickup → socket → floor haul →
   * tavern) is otherwise only reachable by grinding a 1-in-100 roll, and the
   * bug this shipped alongside — cards refused by a full stash and left lying
   * on the floor — took a real player at depth 5 to find precisely because no
   * harness could get enough cards to hit it.
   */
  dbgCardDropAlways: false,

  // Listeners
  input: null as InputHandle | null,
  onKeyDown: null as ((e: KeyboardEvent) => void) | null,
  onResize: null as (() => void) | null,

  /** Skill points invested into a single ability (0..ABILITY_RANK_MAX). Run-scoped,
   *  like skillRanks — the tree and the abilities spend from the same wallet. */
  abilityRanks: {} as Record<AbilityId, number>,
};

/** What's in the active hand right now. An empty slot fights as fists. */
export function activeWeapon(): WeaponState {
  return state.weaponSlots[state.activeSlot] ?? { id: "fists", durability: Infinity };
}

/**
 * THE CHUTE IS COVER — nothing on the floor can SEE the knight until the ball
 * is in play.
 *
 * A floor opens PARKED in the plunger chute (`updatePlunger`, entities/player.ts)
 * and stays there for as long as the player takes to pull it — which, if they
 * are reading the HUD or picking an aim line, is a long time. Every acquisition
 * check in the game measures against the knight's CURRENT position, so while
 * parked the whole horde within the (floor-relative, and therefore large — see
 * `aggroTiles`) aggro radius woke up and walked to the chute. Launch into a
 * reception committee, every floor, with no way to decline it: the knight has
 * i-frames in the chute but no movement, so you cannot even leave.
 *
 * The fix is a perception gate rather than a movement gate. Enemies are not
 * frozen — they simply have no target to acquire, so they hold whatever state
 * they were in, and the instant the plunger fires the normal radius check runs
 * and the floor wakes around wherever the ball actually went.
 *
 * Read by every path that ACQUIRES: the grunt aggro gate and the mimic's wake
 * (entities/zombie.ts) and the Reaper King's leash (boss.ts). Deliberately NOT
 * read by retaliation (entities/combat.ts) — being hit always wakes a monster,
 * and that path cannot fire from the chute anyway.
 *
 * Co-op note: this reads the LOCAL knight's parked flag, which matches the rest
 * of the model — `state.flowField` is one BFS seeded from the local player, so
 * the horde has only ever hunted this client's knight.
 */
export function playerIsVisibleToEnemies(): boolean {
  return !state.plungerArmed;
}

export function freshPlayerFields(): Omit<Player, keyof Actor | "silhouette"> {
  return {
    hp: PLAYER_MAX_HP,
    facing: "S",
    attackT: -1,
    didHit: false,
    comboLanded: false,
    cooldown: 0,
    iframes: 0,
    flashT: 0,
    rageT: 0,
    hasteT: 0,
    shieldT: 0,
    ironT: 0,
    turboT: 0,
    springT: 0,
    oilT: 0,
    webbedT: 0,
    curveT: 0,
    magBootsT: 0,
    multiBallT: 0,
    material: null,
    materialT: 0,
    fuseMaterial: null,
    fuseT: 0,
    materialEmitT: 0,
    squashT: 0,
    squashAmp: 0,
    squashHx: 0,
    squashHy: 0,
    vampCdT: 0,
    phaseStuckT: 0,
    ricochetT: 0,
    ricochetFlavor: "bolt",
    ricochetTickT: 0,
    regenT: 0,
    regenTickT: 0,
    venomCoatT: 0,
    stoneT: 0,
    staticT: 0,
    boltCdT: 0,
    greedT: 0,
    mana: MANA_MAX,
    magnetAuraT: 0,
    fireTrailT: 0,
    bladeStormT: 0,
    bladeStormTickT: 0,
    dropT: -1,
    dropX: 0,
    dropZ: 0,
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
    grooveHopT: 0,
    grooveHopDur: 0,
    grooveHopCdT: 0,
    grabT: 0,
    grabX: 0,
    grabZ: 0,
    throwDirX: 0,
    throwDirZ: 0,
    throwSpeed: 0,
    bounceCombo: 0,
    rail: freshRail(),
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
  state.uiPauses = false;
  state.prevBounceCombo = 0;
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
  state.levelFlowSum = 0;
  state.levelFlowT = 0;
  state.levelHitsTaken = 0;
  state.jackpots = 0;
  state.runNamedShots = 0;
  state.runOrbitLaps = 0;
  state.runJackpots = 0;
  state.runBestFlow = 0;
  state.runFlawlessFloors = 0;
  state.reaperOut = false;
  state.exitLocked = false;
  state.reaperWarned = false;
  state.targetsTotal = 0;
  state.targetsHit = 0;
  state.partComboHits = 0;
  state.frenzyPaid = false;
  state.comboZone = "launch";
  state.bumperTotal = 0;
  state.bumpersLit = 0;
  state.jackpotT = 0;
  state.lampPuzzle = null;
  state.freezeT = 0;
  state.hudMode = "diablo";
  state.abilitySlots = ["flippercharge", "arcanepulse"];
  state.charXp = 0;
  state.charLevel = 1;
  state.skillPoints = 0;
  state.skillRanks = {};
  state.unlockedAbilities = ["flippercharge", "arcanepulse"];
  state.abilityCd = {} as Record<AbilityId, number>;
  state.slowT = 0;
  state.flashT = 0;
  state.belt = [null, null, null, null];
  state.bonusRoomNext = false;
  state.npcs = [];
  state.magicianT = 0;
  state.witchSpawned = false;
  state.frogTrail = [];
  state.frogTrailT = 0;
  state.weaponSlots = [freshWeapon("sword"), null];
  state.activeSlot = 0;
  state.gear = {};
  state.cardStash = [];
  state.legendaryDropped = false;
  state.mythicDropped = false;
  state.seenCards = new Set();
  state.floorHaul = [];
  state.reagents = {};
  state.flasks = 0;
  state.killsByKind = {};
  state.bonusMaxHp = 0;
  state.pausedRunS = 0;
  state.grid = null;
  state.fog = null;
  state.stairs = null;
  state.maze = null;
  state.groundItems = [];
  state.props = [];
  state.player = null;
  state.zombies = [];
  state.projectiles = [];
  state.floorFx = [];
  state.pinballParts = [];
  state.arcCorners = [];
  state.playerSheets = new Map();
  state.playerArtKey = null;
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
  state.aimIndicator = null;
  state.accumulator = 0;
  state.animFrameId = null;
  state.lastTime = 0;
  state.elapsed = 0;
  state.input = null;
  state.onKeyDown = null;
  state.onResize = null;
  state.abilityRanks = {} as Record<AbilityId, number>;
}

/**
 * Tell the engine's juice governor how deep the current impact chain is.
 *
 * Registered HERE rather than in GameEngine.installEngine because the reading
 * is a property of this module: `bounceCombo` is per-PLAYER ride bookkeeping on
 * `state`, reset when the chain lapses. Wiring it at state's module load means
 * the governor damps correctly for anything that touches state — including
 * unit tests, which exercise the governor without booting the game.
 */
setChainDepthSource(() => state.player?.bounceCombo ?? 0);
