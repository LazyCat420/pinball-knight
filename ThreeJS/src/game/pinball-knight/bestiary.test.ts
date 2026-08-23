/**
 * BESTIARY — the derivation, and the two rules that keep it honest:
 * it must cover every monster, and it must never become a second source of
 * truth for loot (every drop it reports has to trace back to ENEMY_DROPS /
 * CardDef.source).
 */
import { describe, it, expect } from "vitest";
import { buildBestiary, bestiaryProgress, familyMilestone, familyAffinity, KIND_IDS, KIND_INFO } from "./bestiary";
import { MOMENTUM_GATES, MOVEMENT_BY_KIND } from "./entities/enemy-rules";
import { PAIN_BY_KIND } from "./entities/stagger";
import { BESTIARY_MILESTONES, BESTIARY_AFFINITY_MAX } from "./constants";
import { CARDS, CARD_IDS, rollCardDrop } from "./cards";
import { ENEMY_DROPS } from "./reagents";
import { ZOMBIE_TYPE_IDS } from "./zombie-types";

describe("bestiary coverage", () => {
  it("has an entry for every EnemyKind the drop table knows", () => {
    // ENEMY_DROPS is exhaustive by EnemyKind, so it's the authority on the roster.
    expect(KIND_IDS.sort()).toEqual(Object.keys(ENEMY_DROPS).sort());
  });

  it("labels and blurbs every monster", () => {
    for (const k of KIND_IDS) {
      expect(KIND_INFO[k].label.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].icon.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].blurb.length).toBeGreaterThan(0);
    }
  });

  it("builds one row per monster", () => {
    expect(buildBestiary({})).toHaveLength(KIND_IDS.length);
  });
});

describe("bestiary derivation (no second source of truth)", () => {
  it("reports exactly the reagents ENEMY_DROPS declares", () => {
    for (const e of buildBestiary({})) {
      const expected = (ENEMY_DROPS[e.kind] ?? []).map((d) => d.id).sort();
      expect(e.drops.map((d) => d.id).sort()).toEqual(expected);
      // …and the chances must be the table's, not re-typed numbers.
      for (const d of e.drops) {
        const src = ENEMY_DROPS[e.kind].find((x) => x.id === d.id)!;
        expect(d.chance).toBe(src.chance);
      }
    }
  });

  it("files every source-bearing card under its own monster", () => {
    const byKind = new Map(buildBestiary({}).map((e) => [e.kind, e]));
    for (const id of CARD_IDS) {
      const src = CARDS[id].source;
      if (!src) continue;
      const entry = byKind.get(src)!;
      // A SUB-TYPED card lives on its sub-type row, not the family row — that is
      // what makes "farm Hulks for the Hulk card" a real goal rather than "kill
      // any zombie". Everything else files under the family.
      const sub = CARDS[id].subType;
      const where = sub
        ? entry.subTypes.find((s) => s.id === sub)!.cards
        : entry.cards;
      expect(where.map((c) => c.id), `${id} missing from ${src}${sub ? ":" + sub : ""}`).toContain(id);
    }
  });

  it("never files a sourceless card under a monster", () => {
    for (const e of buildBestiary({})) {
      for (const c of e.cards) expect(CARDS[c.id].source).toBe(e.kind);
    }
  });

  it("orders a monster's cards common → mythic", () => {
    const order = ["common", "rare", "epic", "legendary", "mythic"];
    for (const e of buildBestiary({})) {
      const idx = e.cards.map((c) => order.indexOf(c.rarity));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it("files a sub-typed card on its SUB-TYPE row, not the family row", () => {
    // "Farm Hulks for the Hulk card" only reads if the Hulk card is ON the Hulk
    // row. A sub-typed card leaking onto the Zombie row would say "kill any
    // zombie", which is not the goal the drop table actually implements.
    const zombie = buildBestiary({}).find((e) => e.kind === "zombie")!;
    expect(zombie.cards.every((c) => !CARDS[c.id].subType)).toBe(true);
    const hulk = zombie.subTypes.find((s) => s.id === "hulk")!;
    expect(hulk.cards.map((c) => c.id)).toContain("hulkknuckle");
    // …and it must not also appear under a different sub-type.
    const midget = zombie.subTypes.find((s) => s.id === "midget")!;
    expect(midget.cards.map((c) => c.id)).not.toContain("hulkknuckle");
  });
});

describe("bestiary reveal gating", () => {
  it("marks an unfought monster unseen", () => {
    for (const e of buildBestiary({})) {
      expect(e.seen).toBe(false);
      expect(e.kills).toBe(0);
    }
  });

  it("reveals a monster once it has been killed", () => {
    const e = buildBestiary({ ghost: 3 }).find((x) => x.kind === "ghost")!;
    expect(e.seen).toBe(true);
    expect(e.kills).toBe(3);
    // Its neighbours stay hidden — reveal is per-monster, not global.
    expect(buildBestiary({ ghost: 3 }).find((x) => x.kind === "wisp")!.seen).toBe(false);
  });

  it("tracks progress across the whole roster", () => {
    expect(bestiaryProgress({})).toEqual({ seen: 0, total: KIND_IDS.length });
    const p = bestiaryProgress({ ghost: 1, bat: 4, slime: 2 });
    expect(p.seen).toBe(3);
    expect(p.total).toBe(KIND_IDS.length);
  });
});

describe("zombie sub-type rows", () => {
  const zombieEntry = (kills: Record<string, number> = {}) =>
    buildBestiary(kills).find((e) => e.kind === "zombie")!;

  it("lists every sub-type under the zombie, and nowhere else", () => {
    expect(zombieEntry().subTypes.map((s) => s.id).sort()).toEqual([...ZOMBIE_TYPE_IDS].sort());
    for (const e of buildBestiary({})) {
      if (e.kind !== "zombie") expect(e.subTypes).toHaveLength(0);
    }
  });

  it("resolves each sub-type's real HP off the ZOMBIE_HP baseline", () => {
    const rows = new Map(zombieEntry().subTypes.map((s) => [s.id, s]));
    expect(rows.get("shambler")!.hp).toBe(3);
    expect(rows.get("hulk")!.hp).toBe(9);
    expect(rows.get("runner")!.hp).toBe(2);
  });

  it("describes only what DIFFERS from the baseline", () => {
    const rows = new Map(zombieEntry().subTypes.map((s) => [s.id, s]));
    // The shambler IS the baseline, so it has nothing to say.
    expect(rows.get("shambler")!.notes).toEqual([]);
    // …and everything else must say something, or the row teaches nothing.
    for (const t of ZOMBIE_TYPE_IDS) {
      if (t === "shambler") continue;
      expect(rows.get(t)!.notes.length, `${t} has no notes`).toBeGreaterThan(0);
    }
    expect(rows.get("crawler")!.notes.join(" ")).toContain("legless");
    expect(rows.get("hobbler")!.notes.join(" ")).toContain("limps");
    expect(rows.get("hulk")!.notes.join(" ")).toContain("knocks you");
  });

  it("reveals a sub-type only once that specific one has been killed", () => {
    const rows = new Map(zombieEntry({ zombie: 5, "zombie:hulk": 1 }).subTypes.map((s) => [s.id, s]));
    expect(rows.get("hulk")!.seen).toBe(true);
    expect(rows.get("hulk")!.kills).toBe(1);
    expect(rows.get("crawler")!.seen).toBe(false);
  });

  it("counts the shambler as met after any plain zombie kill", () => {
    // The shambler is the baseline and carries no `ztype` on the actor, so it has
    // no `zombie:shambler` tally to read — it is the family total minus the
    // tagged sub-types.
    expect(zombieEntry({ zombie: 1 }).subTypes.find((s) => s.id === "shambler")!.seen).toBe(true);
    expect(zombieEntry({}).subTypes.find((s) => s.id === "shambler")!.seen).toBe(false);
  });

  /**
   * REGRESSION (found in live QA, 2026-07-25): the bestiary rendered
   * "Shambler 3 hp x0" beside sub-types showing x6, because `kills` was read
   * from the non-existent `zombie:shambler` key while `seen` fell back to the
   * family total. A visible zero on the one kind you have definitely been
   * killing reads as a broken tally.
   */
  it("derives the shambler COUNT as the family total minus tagged sub-types", () => {
    const rows = new Map(
      zombieEntry({ zombie: 46, "zombie:runner": 6, "zombie:hulk": 6, "zombie:crawler": 5 })
        .subTypes.map((s) => [s.id, s]),
    );
    expect(rows.get("shambler")!.kills).toBe(46 - 17);
    expect(rows.get("shambler")!.seen).toBe(true);
    expect(rows.get("runner")!.kills).toBe(6);
  });

  it("never reports a negative shambler count", () => {
    // Sub-type keys can outnumber the family total if a tally is ever seeded
    // out of order; clamp rather than render "x-3".
    const s = zombieEntry({ zombie: 1, "zombie:hulk": 5 }).subTypes.find((r) => r.id === "shambler")!;
    expect(s.kills).toBe(0);
    expect(s.seen).toBe(false);
  });
});

/**
 * WAVE-5: the bestiary stops being read-only (DECLONE §6.5).
 *
 * It told you a Wisp drops flask glass and gave you no reason to go and fight
 * Wisps you did not already have. Two things change that: the RULES each family
 * plays by are printed (they existed only as behaviour — the game's clearest
 * teaching about momentum could only be learned by dying to it), and the kill
 * tally BUYS something.
 */
describe("mechanics text — derived, never authored twice", () => {
  it("gives every monster at least one rule the player can act on", () => {
    for (const e of buildBestiary({})) {
      expect(e.mechanics.length, `${e.kind} has no mechanics text`).toBeGreaterThan(0);
      for (const m of e.mechanics) expect(m.length).toBeGreaterThan(10);
    }
  });

  it("prints the momentum gate for EXACTLY the families that have one", () => {
    // Derived from MOMENTUM_GATES, which is the table combat.ts enforces from.
    // A gate the code applies and the screen omits is a rule the player can
    // only learn by dying, which is what this whole section exists to fix.
    const gated = Object.keys(MOMENTUM_GATES);
    for (const e of buildBestiary({})) {
      const printsGate = e.mechanics.some((m) => m === MOMENTUM_GATES[e.kind]?.text);
      expect(printsGate, `${e.kind}`).toBe(gated.includes(e.kind));
    }
  });

  it("describes how it MOVES for every family that isn't a plain chaser", () => {
    for (const e of buildBestiary({})) {
      if (MOVEMENT_BY_KIND[e.kind] === "chase") continue;
      expect(e.mechanics.length, `${e.kind} moves oddly but says nothing`).toBeGreaterThanOrEqual(2);
    }
  });

  it("says how hard each thing is to stagger, and agrees with PAIN_BY_KIND", () => {
    const golem = buildBestiary({}).find((e) => e.kind === "golem")!;
    const zomb = buildBestiary({}).find((e) => e.kind === "zombie")!;
    expect(golem.mechanics.join(" ")).toMatch(/unstaggerable|Hard to stagger/i);
    expect(zomb.mechanics.join(" ")).toMatch(/rocked/i);
    expect(PAIN_BY_KIND.golem).toBeLessThan(PAIN_BY_KIND.zombie);
  });

  it("surfaces every sub-type's exception as an ANSWER, not a symptom", () => {
    // "immune to bounce damage" tells you what failed; "bring steel" tells you
    // what to do. A bestiary that only does the former is a patch note.
    const zomb = buildBestiary({ zombie: 40, "zombie:lurcher": 5, "zombie:hulk": 5, "zombie:runner": 5 })!
      .find((e) => e.kind === "zombie")!;
    const notes = (id: string): string => zomb.subTypes.find((s) => s.id === id)!.notes.join(" · ");
    expect(notes("lurcher")).toMatch(/bring steel/i);
    expect(notes("hulk")).toMatch(/needs the ride/i);
    expect(notes("runner")).toMatch(/arrows/i);
  });
});

describe("milestones — the tally buys something", () => {
  it("starts at tier 0 with no bonus and a visible next step", () => {
    const m = familyMilestone(0);
    expect(m.tier).toBe(0);
    expect(m.affinity).toBe(1);
    expect(m.next).toBe(BESTIARY_MILESTONES[0]);
    expect(m.toNext).toBe(BESTIARY_MILESTONES[0]);
  });

  it("climbs one tier per threshold and reports the gap honestly", () => {
    for (let i = 0; i < BESTIARY_MILESTONES.length; i++) {
      const at = familyMilestone(BESTIARY_MILESTONES[i]);
      expect(at.tier).toBe(i + 1);
      const justBefore = familyMilestone(BESTIARY_MILESTONES[i] - 1);
      expect(justBefore.tier).toBe(i);
      expect(justBefore.toNext).toBe(1);
    }
  });

  it("tops out — an uncapped farm bonus makes one family the only one worth killing", () => {
    expect(familyAffinity(1e9)).toBeLessThanOrEqual(BESTIARY_AFFINITY_MAX);
    expect(familyAffinity(1e9)).toBe(familyAffinity(BESTIARY_MILESTONES[BESTIARY_MILESTONES.length - 1]));
    expect(familyMilestone(1e9).next).toBeNull();
    expect(familyMilestone(1e9).toNext).toBeNull();
  });

  it("is monotone and never drops below 1×", () => {
    let prev = 0;
    for (let k = 0; k <= 400; k += 3) {
      const a = familyAffinity(k);
      expect(a).toBeGreaterThanOrEqual(Math.max(1, prev));
      prev = a;
    }
  });

  it("rides on the EXISTING kill tally — no parallel record to forget to reset", () => {
    const e = buildBestiary({ wisp: BESTIARY_MILESTONES[1] }).find((x) => x.kind === "wisp")!;
    expect(e.kills).toBe(BESTIARY_MILESTONES[1]);
    expect(e.milestone.tier).toBe(2);
    expect(e.milestone.affinity).toBeGreaterThan(1);
  });
});

describe("⚠️ THE DOCUMENTED DROP-RATE TRAP", () => {
  /**
   * `rollCardDrop` draws affinity INSIDE the pick (cards.ts:675-690), i.e. only
   * once a drop has already been decided by the gates above it. Drawing it any
   * earlier — or drawing anything else earlier — shifts the random stream the
   * GATES see and silently moves the drop RATE, which is the one failure this
   * design exists to avoid.
   *
   * So the milestone bias is deliberately shipped as a pure REPORT.
   * `familyAffinity` computes the multiplier and hands it over; nothing in this
   * module reaches into the roll. Wiring it is a one-line change at each of the
   * two `rand() < AFFINITY_CHANCE` comparisons in `pick` — multiply
   * AFFINITY_CHANCE by the bias THERE, drawing no extra numbers — and these
   * cases are the guard rail for whoever does it.
   */
  it("building the bestiary consumes no randomness at all", () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error("buildBestiary touched the RNG — the drop stream is not its to move");
    };
    try {
      buildBestiary({ zombie: 200, wisp: 90 });
      familyMilestone(200);
      familyAffinity(200);
    } finally {
      Math.random = real;
    }
  });

  it("leaves the drop RATE exactly where it was, at every kill count", () => {
    // The regression in one assertion: the same seeded stream must produce the
    // same sequence of drops whether or not the player has farmed the family.
    const seq = (): Array<string | null> => {
      let i = 0;
      const xs = [0.02, 0.4, 0.9, 0.11, 0.63, 0.27, 0.81, 0.05, 0.55, 0.34];
      const rand = (): number => xs[i++ % xs.length];
      return Array.from({ length: 40 }, () => rollCardDrop({ floor: 3, kind: "wisp" }, rand));
    };
    const before = seq();
    // Farming a family must not change the stream — it changes what the pick
    // WOULD prefer, and only at the affinity comparison.
    familyAffinity(500);
    expect(seq()).toEqual(before);
  });

  it("hands the bias over as a plain number a caller can apply at the draw", () => {
    const a = familyAffinity(BESTIARY_MILESTONES[0]);
    expect(a).toBeGreaterThan(1);
    expect(Number.isFinite(a)).toBe(true);
  });
});

describe("the pinball layer keeps score in the bestiary too", () => {
  it("counts RAM kills and the best chain separately from the plain tally", () => {
    const e = buildBestiary({ brute: 12, "brute#ram": 5, "brute#combo": 31 }).find((x) => x.kind === "brute")!;
    expect(e.kills).toBe(12);
    expect(e.ramKills).toBe(5);
    expect(e.bestCombo).toBe(31);
  });

  it("defaults to zero rather than undefined for anything never rammed", () => {
    const e = buildBestiary({ brute: 3 }).find((x) => x.kind === "brute")!;
    expect(e.ramKills).toBe(0);
    expect(e.bestCombo).toBe(0);
  });

  it("the namespaced keys never leak into the sub-type tally", () => {
    // subTypesFor derives the shambler count as "family total minus tagged
    // sub-types". A "#"-namespaced key counted as a sub-type would make that
    // arithmetic negative — which is why the separator differs from ":".
    const e = buildBestiary({ zombie: 10, "zombie:hulk": 2, "zombie#ram": 7, "zombie#combo": 44 })
      .find((x) => x.kind === "zombie")!;
    const shambler = e.subTypes.find((s) => s.id === "shambler")!;
    expect(shambler.kills).toBe(8);
    expect(e.ramKills).toBe(7);
  });
});
