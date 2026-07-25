/**
 * MENU CLICK DISPATCH — the resolution step, as opposed to the pure tables.
 *
 * skills.test.ts was fully green while the skill tree was unclickable in the
 * real game, which is the whole reason this file exists: the fault was never in
 * canLearn/aggregateSkills, it was in how a delegated click turned a DOM node
 * into the arguments those functions get called with.
 *
 * The original bug: skill nodes render `data-act="skill:whetstone"` with NO
 * data-idx, while holoCard renders `data-idx=""` — an empty string, not an
 * absent attribute. The dispatcher used `t.dataset.idx ?? suffix`, and `??`
 * only falls through on undefined/null, so an EMPTY index shadowed the suffix.
 * `spendSkillPoint("")` then looked up SKILLS[""] → undefined → "unknown
 * skill", a silent no-op that still triggered a full re-render. Every node's
 * open/locked class recomputed on each dead click, which is exactly the
 * reported "selects multiple, then deselects all, then I can't pick anything".
 */
import { describe, expect, it } from "vitest";
import { resolveAct } from "./menu";
import { SKILLS, SKILL_IDS, canLearn } from "./skills";

/**
 * THE ACTUAL REPORTED BUG — "click a skill, it selects multiple, then
 * deselects all, then I can't pick anything".
 *
 * canLearn() gated affordability and reachability through one boolean, so at
 * 1 point EIGHT nodes rendered `.open` (green) at once, and spending that
 * point flipped all eight to `.locked` (dimmed, cursor:not-allowed) in the same
 * repaint. Nothing was ever "selected" — that was the affordance highlight
 * moving as one block. These pin the states apart.
 */
describe("skill node visual state (the reported bug)", () => {
  // The exact board from the user's screenshot: one rank in each opener.
  const ranks: Record<string, number> = { whetstone: 1, greasedgreaves: 1, ballbearings: 1, coinmagnet: 1, manawell: 1 };
  const openAt = (points: number) => SKILL_IDS.filter((id) => canLearn(id, ranks, points).ok);
  const reachableAt = (points: number) => SKILL_IDS.filter((id) => canLearn(id, ranks, points).reachable);

  it("REGRESSION: spending the last point must not dim every reachable node", () => {
    // Before the fix: 8 reachable nodes at 1pt, 0 at 0pt — the all-on/all-off
    // flicker the report describes.
    expect(openAt(1).length).toBeGreaterThan(1);
    expect(openAt(0)).toHaveLength(0);
    // After the fix, reachability is INDEPENDENT of the wallet, so the tree
    // keeps its shape across a spend instead of going uniformly dark.
    expect(reachableAt(0)).toEqual(reachableAt(1));
    expect(reachableAt(0).length).toBeGreaterThan(1);
  });

  it("separates the points gate from the prerequisite gate", () => {
    // Reachable but unaffordable — must NOT be styled as hard-locked.
    const broke = canLearn("ironheart", ranks, 0);
    expect(broke.ok).toBe(false);
    expect(broke.gate).toBe("points");
    expect(broke.reachable).toBe(true);

    // Genuinely gated on a missing prerequisite, at any balance.
    const gated = canLearn("juggernaut", ranks, 99);
    expect(gated.ok).toBe(false);
    expect(gated.gate).toBe("prereq");
    expect(gated.reachable).toBe(false);
  });

  it("still reports maxed and still lets an affordable node be learned", () => {
    expect(canLearn("wreckingball", { ...ranks, wreckingball: 1 }, 9).gate).toBe("maxed");
    const ok = canLearn("ironheart", ranks, 1);
    expect(ok.ok).toBe(true);
    expect(ok.gate).toBe("ok");
    expect(ok.reachable).toBe(true);
  });

  it("a node you cannot afford is never also reported as learnable", () => {
    for (const id of SKILL_IDS) {
      const g = canLearn(id, ranks, 0);
      expect(g.ok, `${id} must not be learnable with 0 points`).toBe(false);
    }
  });
});

describe("resolveAct", () => {
  it("reads a skill id from the act suffix when there is no data-idx", () => {
    const { id, idx } = resolveAct("whetstone", {});
    expect(id).toBe("whetstone");
    // The skill path has no positional index; it must not come out as NaN,
    // which is what the old `parseInt(suffix)` produced.
    expect(idx).toBe(-1);
    expect(Number.isNaN(idx)).toBe(false);
  });

  it("REGRESSION: an empty data-idx does not shadow the act suffix", () => {
    // holoCard emits data-idx="" on every card it renders into the same sheet.
    // Under the old `ds.idx ?? suffix` this resolved to "" and killed the id.
    const { id } = resolveAct("whetstone", { idx: "" });
    expect(id).toBe("whetstone");
    expect(SKILLS[id], "resolved id must be a real skill node").toBeTruthy();
  });

  it("resolves every skill node in the table, not just the first", () => {
    for (const key of Object.keys(SKILLS)) {
      expect(resolveAct(key, { idx: "" }).id).toBe(key);
      expect(SKILLS[resolveAct(key, { idx: "" }).id]).toBeTruthy();
    }
  });

  it("keeps the numeric index numeric for the card handlers", () => {
    expect(resolveAct(undefined, { idx: "3" }).idx).toBe(3);
    expect(resolveAct(undefined, { idx: "0" }).idx).toBe(0);
    // "pick" carries its id positionally and has no suffix.
    expect(resolveAct(undefined, { idx: "3" }).id).toBe("3");
  });

  it("treats absent and empty as the same missing value", () => {
    expect(resolveAct(undefined, {}).idx).toBe(-1);
    expect(resolveAct(undefined, { idx: "" }).idx).toBe(-1);
    expect(resolveAct(undefined, {}).id).toBe("");
    expect(resolveAct(undefined, { idx: "" }).id).toBe("");
  });

  it("resolves the weapon index independently of both", () => {
    const { id, idx, wIdx } = resolveAct("unsocket", { idx: "2", w: "1" });
    expect(id).toBe("unsocket");
    expect(idx).toBe(2);
    expect(wIdx).toBe(1);
    expect(resolveAct(undefined, { idx: "2" }).wIdx).toBe(-1);
  });

  it("covers the other suffix-routed handlers that shared the broken path", () => {
    // perk:, abq:, abe: and tab: all read the same field the skill tree did.
    for (const suffix of ["oldscar", "magnetaura", "timecrawl", "skills"]) {
      expect(resolveAct(suffix, { idx: "" }).id).toBe(suffix);
    }
  });
});
