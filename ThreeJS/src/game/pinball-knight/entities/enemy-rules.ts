/**
 * THE PER-KIND RULES — what each family does, in the one place both the game
 * and the bestiary read.
 *
 * Two tables live here, and they live together for one reason: every rule in
 * this file is enforced somewhere in `combat.ts`/`zombie.ts` AND printed
 * somewhere in `bestiary.ts`, and a rule the game enforces but the screen
 * describes differently is worse than an undocumented rule. A player who is
 * taught the wrong thing stops trusting the whole screen.
 *
 * The module is deliberately three-, DOM- and `state`-free (types only), which
 * is what lets `bestiary.ts` — whose whole contract is "every row is DERIVED
 * from the tables that already own the data" — read them without dragging the
 * update loop into the menu.
 */
import type { EnemyKind } from "../state";
import type { MovementKind } from "./movement";
import { SECRET_BREAK_SPEED, CARD_PINBALL_SPEED, MOMENTUM_T_FLOOR, GOBLIN_GATE_SOFT, GOLEM_GATE_SOFT, CRYSTAL_GATE_SOFT, JESTER_GATE_SOFT } from "../constants";

/**
 * WHICH WAY EACH FAMILY WALKS (entities/movement.ts).
 *
 * One column, one lookup, and the only thing that decides a family's steering:
 * there is no branch anywhere in `updateZombies` that reads `z.kind` to choose
 * a heading. A zombie SUB-TYPE may override its family's entry
 * (`ZombieTypeDef.movement`), which is what makes a Crawler ambush and a
 * Flailer leap without either becoming a new `EnemyKind`.
 *
 * Exhaustive by `EnemyKind` on purpose — the same discipline `ENEMY_DROPS`,
 * `KIND_INFO` and `PAIN_BY_KIND` keep. A new monster is a compile error here
 * rather than a monster that silently inherits `chase`.
 *
 * Note that movement is independent of `EnemyStats.ranged`: `ranged` says what
 * a wind-up RELEASES, this says where the feet go. The necromancer proves they
 * are different axes — it releases a summon, not a projectile, and holds range
 * exactly like a spitter.
 */
export const MOVEMENT_BY_KIND: Record<EnemyKind, MovementKind> = {
  zombie: "chase",
  spider: "flanker",
  brute: "chase",
  spitter: "kite",
  ghost: "phase",
  bat: "orbiter",
  slime: "chase",
  reaper: "phase",
  goblin: "chase",
  pin: "inert",
  golem: "rooted",
  chomper: "rooted",
  sporeling: "chase",
  jester: "kite",
  croaker: "kite",
  // Shares the bat's policy and nothing else: the bat orbits to be a melee
  // nuisance you cannot line a swing up on, this orbits so its firing solution
  // keeps changing while it hauls a log overhead. One is a fly, one is artillery.
  rotortail: "orbiter",
  // A fourth kiter, and the one the policy was actually written for: it wants a
  // firing band and it walks slowly enough that holding one is a real decision
  // rather than a formality. The spitter kites to stay alive; this kites because
  // its shot needs GROUND between the two of you to land on.
  stiltneck: "kite",
  fish_feet: "chase",
  magnet: "chase",
  webspinner: "kite",
  hound: "leaper",
  bloater: "chase",
  necromancer: "kite",
  warden: "chase",
  wisp: "strafer",
  sapper: "ambusher",
  crystalback: "chase",
  mimic: "chase",
  platypus: "chase",
  espresso: "chase",
  jade_buddha: "chase",
  burger: "kite",
};

/** One family's momentum rule: where the old binary bar was, and how soft the
 *  curve through it is (see `momentumGate` in combo-curve.ts). */
export interface MomentumGate {
  /**
   * At or below this speed the blow is a CLINK and lands for nothing.
   *
   * Separate from `bar` because the two are different questions. `bar` is where
   * the curve has its knee; `minSpeed` is the rule the enemy TEACHES, and for
   * the goblin that rule was always "a standing poke does nothing" — not "you
   * must exceed walking speed". Folding the two together made goblins nearly
   * immortal below 4.2 u/s, which a headless soak found as the bot being
   * ping-ponged in a corner by something it could not kill.
   */
  minSpeed: number;
  /** The speed the old switch flipped at — still the landmark, no longer a wall. */
  bar: number;
  /** Fraction of the effect delivered AT the bar. 0 would restore the wall. */
  soft: number;
  /** What the bestiary prints. Written as a RULE the player can act on. */
  text: string;
  /**
   * Whether `damageZombie` scales the blow by this gate.
   *
   * Not every row does. `chomper` and `crystalback` are in this table because
   * they teach a momentum rule the bestiary must print, but neither has its
   * DAMAGE gated — the chomper's momentum scales knockback and the
   * crystalback's scales the shard spray back at you. So the check in combat.ts
   * needs to know which rows it owns, and it used to know by naming
   * `goblin`/`golem` inline. That literal list was one edit away from drifting
   * out of step with the table the bestiary prints from, which is the exact
   * failure this table was created to prevent — so the table says it now.
   */
  gatesDamage?: boolean;
}

/**
 * THE MOMENTUM GATES (DECLONE §6.2), as data.
 *
 * These four rules were the game's clearest teaching about speed and the player
 * could only ever learn them by dying to them: nothing on any screen said a
 * golem needs smash-speed or that ramming a crystalback costs you shards. The
 * bestiary prints these verbatim once you have killed one, which is what turns
 * "why did my sword bounce off" into a rule.
 */
export const MOMENTUM_GATES: Partial<Record<EnemyKind, MomentumGate>> = {
  goblin: {
    minSpeed: 0,
    bar: MOMENTUM_T_FLOOR,
    soft: GOBLIN_GATE_SOFT,
    text: "Rubber: takes standard damage from melee. Strikes carried on momentum deal massive bonus damage and launch it across the room.",
  },
  jester: {
    minSpeed: 0,
    bar: MOMENTUM_T_FLOOR,
    soft: JESTER_GATE_SOFT,
    gatesDamage: true,
    text: "Spring-loaded: a standing swing is caught by the coil and THROWN BACK at you. Arrive with momentum and you compress it past its travel — then it lands, and lands harder the faster you came.",
  },
  golem: {
    minSpeed: 0,
    bar: SECRET_BREAK_SPEED,
    soft: GOLEM_GATE_SOFT,
    gatesDamage: true,
    text: `Masonry: below smash-speed (${SECRET_BREAK_SPEED} u/s) you only chip it — about a quarter of your damage. Above it, every extra unit of speed still pays.`,
  },
  chomper: {
    minSpeed: 0,
    bar: MOMENTUM_T_FLOOR,
    soft: 0,
    text: "Rooted in the chokepoint. Knockback scales with your speed to ×3 at terminal — a hard arrival SHOVES it off the road.",
  },
  crystalback: {
    minSpeed: 0,
    bar: CARD_PINBALL_SPEED,
    soft: CRYSTAL_GATE_SOFT,
    text: "A reflector that taxes momentum: ramming it sprays shards back INTO you, and the spray scales with how fast you hit it. A graze throws one; a full ram throws the lot.",
  },
};
