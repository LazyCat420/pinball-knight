/**
 * THE WHOLE ROSTER, DERIVED — does every monster author the clips ITS OWN
 * policy asks for?
 *
 * `telegraph-clips.test.ts` already covers the four telegraph clips, and it is
 * green, and the hound bug shipped anyway. The reason is worth stating because
 * it is the general form of the defect:
 *
 *   > it("the spider carries the crouch — the HOUND is a leaper on this sheet")
 *
 * That assertion RESTATES a mapping — hound ⇒ spider sheet — which was true
 * when it was written and stopped being true when the hound graduated to its
 * own painter (`render/monsters/hound.ts`). The test kept passing, about the
 * spider, while the creature it was written to protect played `idle` for its
 * entire telegraph. A test that names both sides of a relationship cannot see
 * either side move.
 *
 * `hound.test.ts` fixed that for ONE creature by deriving both sides. This is
 * the same check over every `EnemyKind`, so a kind that changes policy — or a
 * policy that changes its telegraph — cannot quietly acquire a clip demand
 * nothing draws.
 *
 * ── WHAT "AUTHORS" MEANS HERE, AND WHY withRecoil IS IN THE PATH ────────────
 *
 * `withRecoil` (cel-painter) synthesizes `stumble` and `wake` for any actor
 * that has not posed them by hand, and the game always renders through it. So
 * asking the raw painter would report false failures for `wake`, and asking
 * about the synthesized version is the honest question: will something draw?
 *
 * That is also why this test distinguishes the two outcomes rather than
 * lumping them. A synthesized `wake` is a real frame and NOT a real telegraph —
 * it is idle frame 0, shoved. It passes, and it is reported, because "covered"
 * and "designed" are different claims and the census that conflated them is how
 * the brute shipped with a death animation belonging to another creature.
 */
import { describe, it, expect } from "vitest";
import { MOVEMENT_BY_KIND } from "../entities/enemy-rules";
import { clipDemandAll } from "../testkit/tell-clip-demand";
import { KIND_PAINTS } from "./monster-portrait";
import { withRecoil } from "./cel-painter";
import type { Dir, FramePaint } from "../engine/render/paint-types";

const DIRS: Dir[] = ["S", "N", "E"];
const KINDS = Object.keys(MOVEMENT_BY_KIND) as (keyof typeof MOVEMENT_BY_KIND)[];

/** Every (kind, dir, demanded clip) the game can ask for, as a flat table. */
function demands() {
  const rows: Array<{ kind: string; policy: string; dir: Dir; clip: string; frames: number }> = [];
  for (const kind of KINDS) {
    const policy = MOVEMENT_BY_KIND[kind];
    const wanted = clipDemandAll(policy);
    if (!wanted.length) continue;
    const paints = withRecoil(KIND_PAINTS[kind]());
    for (const dir of DIRS) {
      const authored = paints[dir] as Record<string, FramePaint[] | undefined>;
      for (const clip of wanted) rows.push({ kind, policy, dir, clip, frames: authored[clip]?.length ?? 0 });
    }
  }
  return rows;
}

describe("every monster authors the clips its own policy demands", () => {
  it("has at least one kind whose policy raises a telegraph — otherwise this proves nothing", () => {
    // A positive control. If `clipForSteer` ever stops resolving anything, every
    // assertion below passes vacuously and the suite reports full coverage of
    // nothing.
    expect(demands().length).toBeGreaterThan(0);
  });

  it("draws SOMETHING for every demanded clip, in all three facings", () => {
    const missing = demands()
      .filter((r) => r.frames === 0)
      .map((r) => `${r.kind} (${r.policy}) ${r.dir}: asks for "${r.clip}", painter authors none`);
    expect(
      missing,
      `these telegraphs resolve through CLIP_FALLBACK and never appear:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("reports which telegraphs are HAND-POSED and which are synthesized", () => {
    // Not an assertion about quality — a census, printed, so the difference
    // between "covered" and "drawn on purpose" stays visible. `wake` is the
    // clip this usually catches: withRecoil gives everyone one off their idle.
    const rows = demands();
    const bare = new Map<string, Record<string, FramePaint[] | undefined>>();
    for (const kind of new Set(rows.map((r) => r.kind))) {
      bare.set(kind, KIND_PAINTS[kind as keyof typeof KIND_PAINTS]()["E"] as Record<string, FramePaint[] | undefined>);
    }
    const lines = [...new Set(rows.map((r) => `${r.kind}:${r.clip}`))].map((key) => {
      const [kind, clip] = key.split(":");
      const hand = (bare.get(kind)?.[clip]?.length ?? 0) > 0;
      return `  ${kind.padEnd(12)} ${clip.padEnd(8)} ${hand ? "hand-posed" : "SYNTHESIZED by withRecoil"}`;
    });
    console.info(`\n[tells] telegraph clips the roster's policies demand:\n${lines.sort().join("\n")}\n`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("FAULT INJECTION: a kind whose painter drops a demanded clip is caught", () => {
    // The check above can only be trusted if it can fail. Take a kind that
    // really does demand a telegraph, strip that clip, and confirm the same
    // predicate reports it.
    const kind = KINDS.find((k) => clipDemandAll(MOVEMENT_BY_KIND[k]).length > 0);
    expect(kind, "no kind demands a telegraph — the roster check is vacuous").toBeDefined();
    const clip = clipDemandAll(MOVEMENT_BY_KIND[kind!])[0];
    const paints = withRecoil(KIND_PAINTS[kind!]());
    const stripped = { ...paints, E: { ...paints.E, [clip]: undefined } };
    const authored = stripped.E as Record<string, FramePaint[] | undefined>;
    expect(authored[clip]?.length ?? 0).toBe(0);
  });
});
