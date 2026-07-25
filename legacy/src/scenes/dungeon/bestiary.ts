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
  /** True for a SKILL CARD — it grants an active ability, not just stats. */
  grantsAbility: boolean;
}

/** A zombie sub-type row (the `zombie` entry only). */
export interface BestiarySubType {
  id: ZombieType;
  label: string;
  /** Resolved HP off ZOMBIE_HP, so the row shows the real number. */
  hp: number;
  /** Human-readable stat deltas vs. the shambler baseline, e.g. "1.75× speed". */
  notes: string[];
  kills: number;
  seen: boolean;
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
}

/** Cards sourced to a kind, ordered common → mythic so the row reads as a ladder. */
const RARITY_ORDER: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

function cardsFor(kind: EnemyKind): BestiaryCard[] {
  return CARD_IDS.filter((id) => CARDS[id].source === kind)
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
        grantsAbility: !!c.modifier.grantsAbility,
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
  return out;
}

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
