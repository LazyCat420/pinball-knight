/**
 * BESTIARY — "which monster drops what", derived rather than authored.
 *
 * This is the screen that turns "a card dropped" into "I need to farm Wisps". It
 * is what makes CardDef.source worth having: without somewhere to READ the
 * monster→card mapping, affinity drops are an invisible statistic.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: every row is DERIVED from the tables that
 * already own the data — `ENEMY_DROPS` (reagents.ts), `CardDef.source`
 * (cards.ts), `ZOMBIE_TYPES` (zombie-types.ts). Nothing here is hand-written
 * loot. A hand-written drop list is a second source of truth, and it drifts the
 * first time someone retunes a table and forgets this file exists.
 *
 * REVEAL: an entry only tells you what it drops once you have actually fought
 * the thing (state.killsByKind, tallied in combat.killZombie). An unfought
 * monster shows its silhouette and `???`, so the screen teaches through play
 * instead of handing over a wiki on floor 1.
 *
 * DOM- and three-free: this builds plain data, `menu.ts` draws it.
 */
import { CARDS, CARD_IDS, RARITY_HEX, type CardId, type CardRarity } from "./cards";
import { MOMENTUM_GATES, MOVEMENT_BY_KIND } from "./entities/enemy-rules";
import { PAIN_BY_KIND } from "./entities/stagger";
import { BESTIARY_MILESTONES, BESTIARY_AFFINITY_STEP, BESTIARY_AFFINITY_MAX } from "./constants";
import { ENEMY_DROPS, REAGENTS, type ReagentId } from "./reagents";
import { ZOMBIE_TYPES, ZOMBIE_TYPE_IDS, typeHp, type ZombieType } from "./zombie-types";
import { ZOMBIE_HP } from "./constants";
import type { EnemyKind } from "./state";

/**
 * Display name + icon per monster family. EXHAUSTIVE by EnemyKind on purpose —
 * the same discipline as ENEMY_DROPS and the combat bite table, so adding a
 * monster is a compile error here rather than a blank row in the bestiary.
 */
export const KIND_INFO: Record<EnemyKind, { label: string; icon: string; blurb: string }> = {
  zombie: { label: "Zombie", icon: "🧟", blurb: "slow, dumb, numerous — and it comes in eight shapes" },
  spider: { label: "Spider", icon: "🕷️", blurb: "fast and fragile; spins the silk everything else needs" },
  brute: { label: "Brute", icon: "🦍", blurb: "thick hide, heavy swing, enrages when hurt" },
  spitter: { label: "Spitter", icon: "🤮", blurb: "kites you and lobs acid from range" },
  ghost: { label: "Ghost", icon: "👻", blurb: "drifts through walls; untouchable until it strikes" },
  bat: { label: "Bat", icon: "🦇", blurb: "wobbles in on a drunken line — hard to swat" },
  slime: { label: "Slime", icon: "🟢", blurb: "splits into two fast minis when killed" },
  sporeling: { label: "Sporeling", icon: "🍄", blurb: "a walking fruiting body; it bursts a spore cloud when it dies" },
  jester: { label: "Jester", icon: "🤡", blurb: "fires the plate off its head — and the plate ricochets" },
  croaker: { label: "Croaker", icon: "🐸", blurb: "twin eye-beams; hops knee-high walls and bounces its leap off the rest" },
  rotortail: { label: "Rotortail", icon: "🪵", blurb: "circles overhead and drops timber; a solid hit stalls its rotor" },
  stiltneck: { label: "Stiltneck", icon: "💣", blurb: "slings a lit bomb from nine tiles out — the blast catches its own horde too" },
  fish_feet: { label: "Fish Feet", icon: "👟", blurb: "a smoking fish walking on white Converse sneakers that delivers heavy kick strikes" },
  reaper: { label: "Death Dealer", icon: "☠️", blurb: "cannot be hurt. It only ever gets faster" },
  goblin: { label: "Goblin", icon: "👺", blurb: "kicks you off your line; shrugs off a standing poke" },
  pin: { label: "Bowling Pin", icon: "🎳", blurb: "does not fight. It scores — and it chains" },
  golem: { label: "Brick Golem", icon: "🗿", blurb: "rooted furniture with teeth; needs smash-speed" },
  chomper: { label: "Chomper", icon: "🪤", blurb: "rooted jaws holding a chokepoint" },
  magnet: { label: "Magnet Crawler", icon: "🧲", blurb: "drags your momentum off its line" },
  webspinner: { label: "Webspinner", icon: "🕸️", blurb: "webs you at range and slows the ride" },
  hound: { label: "Hound", icon: "🐺", blurb: "locks a dash and charges the gap" },
  bloater: { label: "Bloater", icon: "🫧", blurb: "bursts into a burning puddle — don't melee it close" },
  necromancer: { label: "Necromancer", icon: "🕯️", blurb: "raises adds faster than you can clear them" },
  warden: { label: "Warden", icon: "🛡️", blurb: "shields everything around it in a pulse" },
  wisp: { label: "Wisp", icon: "✨", blurb: "blinks out of your swing and crackles back" },
  sapper: { label: "Sapper", icon: "🧨", blurb: "closes and detonates" },
  crystalback: { label: "Crystalback", icon: "🔷", blurb: "rooted; shatters into flask glass" },
  mimic: { label: "Mimic", icon: "🎁", blurb: "dormant until you're close enough to regret it" },
};

export const KIND_IDS: EnemyKind[] = Object.keys(KIND_INFO) as EnemyKind[];

/** One reagent this monster is made of, with its independent drop chance. */
export interface BestiaryDrop {
  id: ReagentId;
  label: string;
  icon: string;
  color: string;
  /** 0..1 — the per-kill chance from ENEMY_DROPS. */
  chance: number;
}

/** One card whose essence this monster is (CardDef.source). */
export interface BestiaryCard {
  id: CardId;
  label: string;
  icon: string;
  rarity: CardRarity;
  /** Rarity accent, so the row can be tinted without re-deriving it. */
  hex: string;
  description: string;
  /** Which zombie SUB-TYPE this card belongs to, when it is sub-typed. */
  subType?: ZombieType;
}

/** A zombie sub-type row (the `zombie` entry only). */
export interface BestiarySubType {
  id: ZombieType;
  label: string;
  /** The card this sub-type is the essence of (empty if it has none yet). */
  cards: BestiaryCard[];
  /** Resolved HP off ZOMBIE_HP, so the row shows the real number. */
  hp: number;
  /** Human-readable stat deltas vs. the shambler baseline, e.g. "1.75× speed". */
  notes: string[];
  kills: number;
  seen: boolean;
}

/**
 * How a movement policy reads to a player. Descriptions, not implementation —
 * "circles you at range" is what someone can act on; "tangential steering with
 * a radial correction" is not.
 */
const MOVEMENT_TEXT: Record<string, string> = {
  chase: "",
  kite: "Holds its firing distance — it backs off when you close and shoots from the gap.",
  rooted: "Rooted. It will not chase you; it holds ground and punishes anything that walks past.",
  phase: "Ignores the maze. It drifts straight at you THROUGH walls — you cannot break line of sight on it.",
  inert: "Does not fight. It scores.",
  flanker: "Comes at you OFF-AXIS — round the side of whatever you are facing, closing the angle only at the last moment.",
  strafer: "Circles at range and darts in on a cadence. The tint goes hot in the beat before it commits.",
  ambusher: "Does not move at all until it can see you AND you are close. Then it springs, once, and never hides again.",
  orbiter: "Rings you at radius, and the ring tightens every second. It gets closer without ever coming straight at you.",
  leaper: "Crouches — a dead stop, glowing — then pounces along a CURVED line. The crouch is your window, and the arc is aimed where you were going.",
  packhunter: "Will not engage you alone. It shadows you at the edge of the light until it has company, then the whole group commits at once.",
};

/** How hard it is to stagger, in words. The Doom dial, made legible. */
function painText(kind: EnemyKind): string {
  const p = PAIN_BY_KIND[kind];
  if (p <= 0) return "Cannot be staggered by anything.";
  if (p >= 0.65) return "Easily rocked — a fast ricochet chain can hold it in place.";
  if (p >= 0.4) return "Staggers under a solid impact, but not under a poke.";
  if (p >= 0.2) return "Hard to stagger. Only a real arrival interrupts it.";
  return "Almost unstaggerable — it keeps coming through anything short of terminal speed.";
}

/**
 * The rules for one family, in the order a player needs them: how it moves,
 * what momentum does to it, and how hard it is to interrupt.
 */
function mechanicsFor(kind: EnemyKind): string[] {
  const out: string[] = [];
  const mv = MOVEMENT_TEXT[MOVEMENT_BY_KIND[kind]];
  if (mv) out.push(mv);
  const gate = MOMENTUM_GATES[kind];
  if (gate) out.push(gate.text);
  out.push(painText(kind));
  return out;
}

/**
 * What a family's kill count has bought.
 *
 * The bestiary was a read-only screen: it told you a Wisp drops flask glass and
 * then gave you no reason to go and fight Wisps that you did not already have.
 * Milestones make the tally itself a currency — each tier tightens that
 * family's card AFFINITY, so farming a monster measurably improves your odds of
 * ITS card rather than being flavour text about drops you were getting anyway.
 *
 * ⚠️ THE DOCUMENTED TRAP: `rollCardDrop` draws affinity INSIDE the pick
 * (cards.ts:327, pinned by test). Any bias MUST be applied at exactly that
 * point in the RNG stream or the whole drop table's rates move silently. This
 * function is therefore a pure REPORT — it computes the multiplier and hands it
 * over; it deliberately does not reach into the roll.
 */
export function familyMilestone(kills: number): BestiaryMilestone {
  let tier = 0;
  for (const m of BESTIARY_MILESTONES) if (kills >= m) tier++;
  const next = tier < BESTIARY_MILESTONES.length ? BESTIARY_MILESTONES[tier] : null;
  return {
    tier,
    next,
    toNext: next === null ? null : next - kills,
    affinity: familyAffinity(kills),
  };
}

/**
 * The card-affinity multiplier a family's kill count has earned, ≥ 1.
 *
 * Exported for the drop roll to consume AT the affinity draw (see the trap
 * above). Capped, because an uncapped farm bonus turns one family into the only
 * family worth killing — which is the opposite of what a bestiary is for.
 */
export function familyAffinity(kills: number): number {
  let tier = 0;
  for (const m of BESTIARY_MILESTONES) if (kills >= m) tier++;
  return Math.min(BESTIARY_AFFINITY_MAX, 1 + tier * BESTIARY_AFFINITY_STEP);
}

/** What a family's kill count has earned. */
export interface BestiaryMilestone {
  /** How many tiers of BESTIARY_MILESTONES are cleared (0..n). */
  tier: number;
  /** Kills still needed for the next tier, or null at the top. */
  toNext: number | null;
  /** The next threshold, or null at the top. */
  next: number | null;
  /** Card-affinity bonus this family's drops now carry, as a multiplier. */
  affinity: number;
}

export interface BestiaryEntry {
  kind: EnemyKind;
  label: string;
  icon: string;
  blurb: string;
  kills: number;
  /** Has the player ever killed one? Gates the drop columns. */
  seen: boolean;
  drops: BestiaryDrop[];
  cards: BestiaryCard[];
  /** Populated for `zombie` only — its eight behavioural sub-types. */
  subTypes: BestiarySubType[];
  /**
   * The RULES this family plays by, in words, derived from the same tables the
   * game enforces them from (entities/enemy-rules.ts, entities/stagger.ts).
   *
   * These existed only as behaviour before: nothing on any screen said a golem
   * needs smash-speed or that ramming a crystalback sprays shards back into
   * you, so the game's clearest teaching about momentum could only be learned
   * by dying to it. Revealed with the rest of the row, on the first kill.
   */
  mechanics: string[];
  /** Kill-count progression + what it has bought. */
  milestone: BestiaryMilestone;
  /**
   * How many of this family you have killed BY RAMMING, and the deepest bounce
   * combo you were carrying when one died.
   *
   * Both are the pinball layer keeping score of itself against the ARPG layer,
   * which DECLONE §0 named as the split this whole plan exists to close: the
   * bestiary counted kills and had no idea whether you earned them with a sword
   * or at 20 u/s.
   */
  ramKills: number;
  bestCombo: number;
}

/** Cards sourced to a kind, ordered common → mythic so the row reads as a ladder. */
const RARITY_ORDER: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

function cardsFor(kind: EnemyKind, subType?: ZombieType): BestiaryCard[] {
  // A sub-typed card belongs on its SUB-TYPE row, not the family row — that is
  // the whole point of "farm Hulks for the Hulk card". Asking for the family
  // (no subType) returns only the un-sub-typed cards.
  return CARD_IDS.filter((id) => CARDS[id].source === kind && CARDS[id].subType === subType)
    .sort((a, b) => RARITY_ORDER.indexOf(CARDS[a].rarity) - RARITY_ORDER.indexOf(CARDS[b].rarity))
    .map((id) => {
      const c = CARDS[id];
      return {
        id,
        label: c.label,
        icon: c.icon,
        rarity: c.rarity,
        hex: RARITY_HEX[c.rarity],
        description: c.description,
        subType: c.subType,
      };
    });
}

function dropsFor(kind: EnemyKind): BestiaryDrop[] {
  return (ENEMY_DROPS[kind] ?? []).map((e) => {
    const r = REAGENTS[e.id];
    return { id: e.id, label: r.label, icon: r.icon, color: r.color, chance: e.chance };
  });
}

/**
 * The stat story of a sub-type in words, relative to the shambler. Only
 * DIFFERENCES are listed — a row of "1.0×" everywhere teaches nothing.
 */
function subTypeNotes(t: ZombieType): string[] {
  const d = ZOMBIE_TYPES[t];
  const out: string[] = [];
  const pct = (m: number): string => `${m > 1 ? "+" : "−"}${Math.round(Math.abs(m - 1) * 100)}%`;
  if (d.speedMult !== 1) out.push(`${pct(d.speedMult)} speed`);
  if (d.hpMult !== 1) out.push(`${pct(d.hpMult)} health`);
  if (d.scale > 1) out.push("larger body");
  if (d.scale < 1) out.push("smaller body");
  if (d.reachMult !== 1) out.push(`${pct(d.reachMult)} reach`);
  if (d.windupMult < 1) out.push("faster attack");
  if (d.windupMult > 1) out.push("slower attack");
  if (d.gait === "limp") out.push("limps — lurches and drags");
  if (d.gait === "crawl") out.push("legless — drags itself prone");
  if (d.knockback) out.push("knocks you off your line");
  // The two Wave-5 columns. A sub-type's movement and its ONE exception are the
  // things that decide how you fight it, so they read as rules rather than as
  // percentages — and they are derived from the same table the game enforces.
  if (d.movement) out.push(SUBTYPE_MOVEMENT_NOTE[d.movement] ?? d.movement);
  if (d.exception) out.push(EXCEPTION_NOTE[d.exception]);
  if (d.painMult !== undefined && d.painMult !== 1) {
    out.push(d.painMult > 1 ? "easily staggered" : "hard to stagger");
  }
  return out;
}

/** A sub-type's steering, in one short clause (the family rows carry the prose). */
const SUBTYPE_MOVEMENT_NOTE: Record<string, string> = {
  flanker: "approaches off-axis",
  strafer: "circles and darts",
  ambusher: "lies still until you are close",
  orbiter: "rings you at radius",
  leaper: "telegraphed pounce, on an arc",
  packhunter: "will not engage without company",
};

/**
 * The three shared exceptions, as the ANSWER rather than the rule — a bestiary
 * that says "immune to bounce damage" has told you what fails; one that says
 * "bring steel" has told you what to do.
 */
const EXCEPTION_NOTE: Record<string, string> = {
  "bounce-immune": "RAMMING IT DOES NO DAMAGE — bring steel",
  "speed-only": "can be worn to 1 hp at a walk; the killing blow needs the ride",
  "dodges-ranged": "sidesteps about half of all arrows — close the distance",
};

function subTypesFor(kind: EnemyKind, kills: Record<string, number>): BestiarySubType[] {
  if (kind !== "zombie") return [];
  // The SHAMBLER is the baseline: `makeZombie` only stamps a `ztype` when it is
  // NOT the shambler, so there is no `zombie:shambler` key to read. Its count is
  // therefore the family total MINUS every tagged sub-type — otherwise the row
  // renders "Shambler 3 hp x0" next to sub-types showing x6, which reads as a
  // broken tally on the one kind the player has definitely been killing.
  const tagged = ZOMBIE_TYPE_IDS.reduce((sum, t) => sum + (kills[`zombie:${t}`] ?? 0), 0);
  const shamblers = Math.max(0, (kills.zombie ?? 0) - tagged);
  return ZOMBIE_TYPE_IDS.map((t) => {
    const n = t === "shambler" ? shamblers : kills[`zombie:${t}`] ?? 0;
    return {
      id: t,
      label: ZOMBIE_TYPES[t].label,
      cards: cardsFor("zombie", t),
      hp: typeHp(ZOMBIE_HP, t),
      notes: subTypeNotes(t),
      kills: n,
      seen: n > 0,
    };
  });
}

/**
 * Build the whole bestiary from the live tables + the run's kill tally.
 *
 * `kills` is injected (rather than read off `state` here) so the derivation is
 * pure and unit-testable — the caller passes `state.killsByKind`.
 */
export function buildBestiary(kills: Record<string, number> = {}): BestiaryEntry[] {
  return KIND_IDS.map((kind) => {
    const n = kills[kind] ?? 0;
    const info = KIND_INFO[kind];
    return {
      kind,
      label: info.label,
      icon: info.icon,
      blurb: info.blurb,
      kills: n,
      seen: n > 0,
      drops: dropsFor(kind),
      cards: cardsFor(kind),
      subTypes: subTypesFor(kind, kills),
      mechanics: mechanicsFor(kind),
      milestone: familyMilestone(n),
      // Namespaced into the same tally record — see `tallyKill` in combat.ts
      // for why there is no second state field.
      ramKills: kills[`${kind}#ram`] ?? 0,
      bestCombo: kills[`${kind}#combo`] ?? 0,
    };
  });
}

/**
 * How much of the bestiary the player has actually uncovered — the completion
 * line at the top of the tab, and the reason to go fight something new.
 */
export function bestiaryProgress(kills: Record<string, number> = {}): { seen: number; total: number } {
  return {
    seen: KIND_IDS.filter((k) => (kills[k] ?? 0) > 0).length,
    total: KIND_IDS.length,
  };
}
