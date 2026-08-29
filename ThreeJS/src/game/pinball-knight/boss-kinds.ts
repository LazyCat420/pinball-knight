/**
 * THE BOSS ROSTER — one guardian per biome, as parameters over shared attacks.
 *
 * Until 2026-08-28 there was exactly one boss and every floor was gated on him:
 * floor 1 and floor 17 were the same fight, and `BOSS_EVERY` only doubled his
 * HP and changed the toast. Two attacks, no phases.
 *
 * ── WHY A TABLE AND NOT FOUR MODULES ───────────────────────────────────────
 *
 * From `docs/game-dev-rules/game-research/enter-the-gungeon.md` §5.2, on a game
 * with 30-odd bosses: *"Harder variants of a boss reuse the script with
 * tightened parameters (Old King vs Bullet King) — difficulty as parameter
 * changes on shared patterns, not new code."* So the ATTACKS are a small set of
 * primitives in `boss.ts`, and a boss is a row here that picks two of them,
 * names its numbers, and says what changes at the phase flip. Adding a fifth
 * boss is a row, not a module.
 *
 * ── THE ONE CONSTRAINT THAT SHAPES EVERY MOVESET ───────────────────────────
 *
 * `ARPG_FEATURE_PLAN` ruled out the obvious expansion and was right to:
 * *"Bullet-hell boss patterns. Occluding isometric walls make dense projectile
 * patterns unreadable. `boss.ts` should get TELEGRAPH QUALITY, not projectile
 * count."* Every attack below therefore has a wind-up you can read and a
 * counter-play, and no boss fires more than one thing at a time. The King's
 * skull barrage used to have no telegraph at all — it fired off a bare 2.6 s
 * timer — and that is fixed here rather than copied into three more bosses.
 *
 * ── PHASES ─────────────────────────────────────────────────────────────────
 *
 * HP-threshold, and they *"add a pattern layer or swap the movement mode
 * rather than reskinning"* (same source). One flip per boss: enough that the
 * fight has a second half, few enough that each is legible.
 *
 * No THREE and no `state` here on purpose — this is data the spawner, the HUD
 * and the tests all read.
 */
import type { SheetKey } from "./boot/sheets";

export type BossKind = "reaper_king" | "broodmother" | "overlord" | "archivist";

/** A ring of satellites wheeling around the boss — cosmetic, and the ammo. */
export interface OrbitSpec {
  count: number;
  radius: number;
  /** rad/s */
  speed: number;
  color: number;
}

/** An aimed projectile on a cadence. `windup` is the tell. */
export interface BarrageSpec {
  interval: number;
  /** Seconds the boss visibly charges before the shot leaves. */
  windup: number;
  speed: number;
  damage: number;
  maxDist: number;
  color: number;
  /** Slows the knight on hit, for the seconds given. 0 = no slow. */
  slowFor?: number;
}

/** A telegraphed ground AoE at the target's feet. */
export interface SlamSpec {
  interval: number;
  telegraph: number;
  radius: number;
  damage: number;
  /** Knockback fed into the pinball momentum channel. */
  launch: number;
  color: number;
  /** Phase 2 can add a second, wider impact a beat after the first. */
  echo?: { delay: number; radius: number; damage: number };
}

/** A telegraphed locked-line dash — the hound's grammar at boss scale. */
export interface ChargeSpec {
  interval: number;
  /** The line is drawn and committed for this long before he moves. */
  telegraph: number;
  speed: number;
  damage: number;
  /** How far the dash travels before it ends. */
  distance: number;
  launch: number;
  color: number;
}

/** Adds. The "kill the caster first" beat. */
export interface SummonSpec {
  interval: number;
  telegraph: number;
  count: number;
  /** Cap on adds alive at once, so a kited boss cannot flood the floor. */
  maxAlive: number;
  color: number;
}

/** An expanding ring centred on the boss — a "get out of the middle" beat. */
export interface NovaSpec {
  interval: number;
  telegraph: number;
  radius: number;
  damage: number;
  /** Seconds the ring takes to sweep out to `radius`. */
  sweep: number;
  color: number;
}

export interface BossMoves {
  orbit?: OrbitSpec;
  barrage?: BarrageSpec;
  slam?: SlamSpec;
  charge?: ChargeSpec;
  summon?: SummonSpec;
  nova?: NovaSpec;
}

export interface BossSpec {
  kind: BossKind;
  /** The biome this one guards (`maze/prefabs.ts` THEMES `name`). */
  biome: string;
  /** Toast headline and the line under it. */
  title: string;
  tagline: string;
  /** Short label for the HUD bar. */
  label: string;
  /** Which atlas he wears, and how it is dressed. */
  art: { sheetKey: SheetKey; tint: number | null; scale: number };
  /** Multiplier on the floor's base boss HP. */
  hpMult: number;
  /** Multiplier on the floor's boss speed. */
  speedMult: number;
  moves: BossMoves;
  phase2: {
    /** Fraction of max HP at which the flip happens. */
    at: number;
    title: string;
    /** Overrides merged over `moves`. Same shape, so a phase is parameters. */
    moves: BossMoves;
    /** Multiplier on movement speed for the second half. */
    speedMult?: number;
  };
}

/**
 * ⚠️ EVERY NUMBER HERE FITS INSIDE THE ARENA THAT ALREADY EXISTS.
 *
 * `maze/floor-rules.ts` BOSS_ARENA_R is derived from the King's slam radius,
 * his collider and his leash, and `maze/track-floor.ts` carves halls to match —
 * a derivation `maze/floor-rules.test.ts` pins, because the hall and the fight
 * must not drift apart. Growing a boss past the King would silently demand
 * bigger halls on every floor and move the generator's relaxation rate.
 *
 * So the arena is the BUDGET and the roster fits inside it: no scale exceeds
 * the King's 2.17, and no attack reaches further than the hall is wide.
 * `boss-roster.test.ts` asserts both against boss.ts's own constants.
 *
 * ⚠️ BOSS SCALES ARE ALL NON-INTEGER and that is deliberate, unlike the
 * `KIND_SKIN` rows registry-drift check H polices. A boss is the one actor the
 * texel-identity rule does not serve: he is meant to read as OVERSIZED against
 * the horde he stands in, the size difference IS the tell, and nobody reads a
 * boss's coat for even pixel rows while he is winding up a slam. The King has
 * shipped at 2.17 since the beginning.
 */
export const BOSSES: Record<BossKind, BossSpec> = {
  // ══ THE COLD CRYPT — bumpers, lanes, a flipper or two ══════════════════
  //
  // The original, unchanged in shape: a ring of skulls, one flung at you on a
  // cadence, and a telegraphed ground-pound. What IS changed is that the
  // barrage now winds up. It never did, which made the one attack you could
  // not dodge also the one that fired most often.
  reaper_king: {
    kind: "reaper_king",
    biome: "crypt",
    title: "☠ THE REAPER KING ☠",
    tagline: "slay it — only then does the portal open",
    label: "REAPER KING",
    art: { sheetKey: "reaper", tint: null, scale: 2.17 },
    hpMult: 1,
    speedMult: 1,
    moves: {
      orbit: { count: 5, radius: 1.5, speed: 1.1, color: 0xe8e2d0 },
      barrage: { interval: 2.6, windup: 0.45, speed: 9, damage: 1, maxDist: 16, color: 0xd8c8a8 },
      slam: { interval: 4.2, telegraph: 1.1, radius: 2.6, damage: 2, launch: 16, color: 0xff3050 },
    },
    phase2: {
      at: 0.5,
      title: "☠ THE KING SHEDS HIS CROWN",
      // A pattern LAYER, not a reskin: the slam gains a second, wider ring a
      // beat after the first, so the safe spot you rolled to stops being safe.
      moves: {
        barrage: { interval: 1.7, windup: 0.35, speed: 11, damage: 1, maxDist: 16, color: 0xd8c8a8 },
        slam: {
          interval: 3.4,
          telegraph: 0.9,
          radius: 2.6,
          damage: 2,
          launch: 16,
          color: 0xff3050,
          // 3.0 is a BUDGET, not a taste: BOSS_ARENA_R is derived from the widest
          // thing you must walk out of, and 4.0 would have demanded 8-tile halls on
          // every floor. See boss.ts SLAM_RADIUS.
          echo: { delay: 0.5, radius: 3.0, damage: 1 },
        },
      },
    },
  },

  // ══ THE ROTTING WARREN — everything is slick and nothing brakes ════════
  //
  // The warren's horde is spider/slime/webspinner, so its guardian is the
  // thing that made them. She does not chase well and does not need to: she
  // spits web that takes your momentum away — the one currency this game is
  // actually about — and fills the room with children while you scrape it off.
  broodmother: {
    kind: "broodmother",
    biome: "warren",
    title: "🕷 THE BROODMOTHER 🕷",
    tagline: "the warren is her nest — cut it out",
    label: "BROODMOTHER",
    art: { sheetKey: "spider", tint: 0x7fdc6a, scale: 2.15 },
    hpMult: 0.9,
    speedMult: 0.75,
    moves: {
      barrage: { interval: 2.2, windup: 0.5, speed: 10, damage: 1, maxDist: 14, color: 0xd8f0c0, slowFor: 1.6 },
      summon: { interval: 7.5, telegraph: 1.0, count: 3, maxAlive: 9, color: 0x7fdc6a },
    },
    phase2: {
      at: 0.5,
      title: "🕷 THE NEST ANSWERS",
      // Movement mode swap: she stops holding the middle and starts kiting,
      // which is what makes the brood matter — you cannot ignore them and
      // still reach her.
      speedMult: 1.35,
      moves: {
        summon: { interval: 4.5, telegraph: 0.7, count: 4, maxAlive: 14, color: 0x7fdc6a },
      },
    },
  },

  // ══ THE BLOODWORKS — the punch factory ═════════════════════════════════
  //
  // WEARS THE ATLAS NOBODY HAS EVER SEEN. `makeBossPaints` — a scaled brute
  // with its own death clip — has been painted, palette-tested and unspawned
  // this whole time, while the King wore the reaper's coat. It is his now.
  //
  // The Bloodworks deals in gloves and slingshots, so its guardian is pure
  // momentum: he commits to a line and you get out of it. No projectiles at
  // all — the biome's own furniture is the ranged threat.
  overlord: {
    kind: "overlord",
    biome: "bloodworks",
    title: "🩸 THE OVERLORD 🩸",
    tagline: "it does not throw. it arrives.",
    label: "OVERLORD",
    art: { sheetKey: "boss", tint: 0xd0402a, scale: 2.17 },
    hpMult: 1.25,
    speedMult: 0.9,
    moves: {
      charge: { interval: 5.0, telegraph: 1.0, speed: 15, damage: 2, distance: 11, launch: 18, color: 0xff5a2a },
      slam: { interval: 6.0, telegraph: 1.2, radius: 3.0, damage: 2, launch: 14, color: 0xff5a2a },
    },
    phase2: {
      at: 0.45,
      title: "🩸 THE OVERLORD ENRAGES",
      speedMult: 1.25,
      moves: {
        charge: { interval: 3.2, telegraph: 0.65, speed: 19, damage: 2, distance: 13, launch: 18, color: 0xff2a10 },
      },
    },
  },

  // ══ THE ARCANE DEEP — teleports, mirrors, trick lanes ══════════════════
  //
  // The parlor floors' guardian fights like the floor does: he denies the
  // ground rather than aiming at you. The nova is the whole encounter — a
  // ring that sweeps outward from where he stands, so the answer is distance,
  // and the barrage exists to punish you for taking it.
  archivist: {
    kind: "archivist",
    biome: "arcane",
    title: "🔮 THE ARCHIVIST 🔮",
    tagline: "it reads the room faster than you cross it",
    label: "ARCHIVIST",
    art: { sheetKey: "ghost", tint: 0xb070ff, scale: 2.05 },
    hpMult: 0.85,
    speedMult: 1.1,
    moves: {
      nova: { interval: 5.5, telegraph: 1.15, radius: 5.0, damage: 2, sweep: 0.45, color: 0xb070ff },
      barrage: { interval: 3.0, windup: 0.55, speed: 12, damage: 1, maxDist: 18, color: 0xd8a0ff },
    },
    phase2: {
      at: 0.5,
      title: "🔮 THE ARCHIVIST UNBINDS",
      moves: {
        // Adds the layer he was missing: the ring now comes with an escort, so
        // "stand outside the nova" stops being a free answer.
        nova: { interval: 4.0, telegraph: 0.85, radius: 6.0, damage: 2, sweep: 0.35, color: 0xd8a0ff },
        orbit: { count: 4, radius: 1.7, speed: 1.8, color: 0xd8a0ff },
      },
    },
  },
};

export const BOSS_KINDS: BossKind[] = Object.keys(BOSSES) as BossKind[];

/**
 * Which boss guards a floor, from the floor's own theme.
 *
 * The themes are already permuted per run (`maze/prefabs.ts` themeIndexFor), so
 * two runs meet the four bosses in a different order without this needing a
 * shuffle of its own — and the boss you fight is always the one whose horde you
 * just cut through, which is the point of keying it to the biome at all.
 *
 * Falls back to the King: a biome added without a guardian should still gate
 * its exit, not ship a floor whose stairs never unlock.
 */
export function bossForBiome(biome: string): BossSpec {
  return BOSS_KINDS.map((k) => BOSSES[k]).find((b) => b.biome === biome) ?? BOSSES.reaper_king;
}

/** The moveset in force at a given HP fraction — phase 2 merged over phase 1. */
export function movesAt(spec: BossSpec, hpFrac: number): BossMoves {
  if (hpFrac > spec.phase2.at) return spec.moves;
  return { ...spec.moves, ...spec.phase2.moves };
}
