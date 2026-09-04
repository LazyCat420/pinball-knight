/**
 * WHO IS ALLOWED TO ADVANCE AN ANIMATOR — the whole tree, not three folders.
 *
 * `presentation/animation-system.ts` opens with an invariant in capitals:
 * "No gameplay, AI, network, entity, combat, or test-integration module may
 * call `Animator.update()`. Only `AnimationPresentationSystem.update(renderDt)`
 * may do so in production." That sentence has been FALSE since the day it was
 * written, and the guard that was supposed to hold it could not see the
 * counter-examples for two independent reasons:
 *
 *   1. `single-clock-orchestrator.test.ts` scans `entities/`, `spawn/`, `sim/`,
 *      `coop.ts` and `boss.ts`. It never looks in `render/` or `src/scenes/`.
 *   2. It matches the literal string `.anim.update(`. The remote-party views
 *      call `.animator.update(` — a different property name on the same class.
 *
 * Four live call sites escaped on both counts at once.
 *
 * ── WHY THIS GUARD DOES NOT SIMPLY BAN THEM ──
 * Two of the four are CORRECT, and migrating them would ship the exact bug this
 * suite exists to prevent. `sim/loop.ts` returns early while the tavern scene
 * owns the screen, so the dungeon's presentation clock does not tick at all in
 * the tavern; anything registered with it there would FREEZE. The tavern is a
 * second scene with a second clock, and pretending otherwise is how an
 * invariant becomes a lie that reads as a fix.
 *
 * So the rule this file enforces is the one the code can actually hold: a
 * direct tick must NAME ITS CLOCK, on the line above, with
 *
 *     // SINGLE-CLOCK EXEMPT: <which clock drives this, and why not the system>
 *
 * An exemption is a resolved case, not a hidden one. A NEW direct tick — the
 * drift this is here to catch — has no marker and fails.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `.anim.update(`, `.animator.update(`, `?.` variants, and — the one the first
 * draft of this file missed — a BARE local: the tavern holds its animator in a
 * `const animator`, so `animator.update(dt)` has no leading dot at all. Any
 * identifier ENDING in anim/animator, property or local. `\b` keeps
 * `animationPresentation.update(` (the clock itself) out: it ends in
 * "Presentation", not "anim".
 */
const TICK = /\b\w*[Aa]nim(?:ator)?\??\.update\??\(/;
const MARKER = "SINGLE-CLOCK EXEMPT:";

/** The one module that is ALLOWED to tick without a marker — it is the clock. */
const CLOCK_OWNER = "game/pinball-knight/presentation/animation-system.ts";

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      walk(full, out);
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("the animation clock has ONE owner, and every exception names itself", () => {
  const srcRoot = path.resolve(__dirname, "../../..");

  const hits = (() => {
    const found: Array<{ rel: string; line: number; text: string; marked: boolean }> = [];
    for (const file of walk(srcRoot, [])) {
      const lines = fs.readFileSync(file, "utf-8").split("\n");
      lines.forEach((line, i) => {
        if (!TICK.test(line)) return;
        const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
        // The marker must be part of the COMMENT BLOCK attached to this call:
        // walk upward while the lines are comments or blank, and stop at the
        // first line of code. A fixed line window is the wrong rule in both
        // directions — too small and a real explanation (which is a paragraph,
        // not a sentence) falls outside it; too large and one marker silently
        // adopts an unrelated tick further down.
        let marked = false;
        for (let j = i - 1; j >= 0; j--) {
          const t = lines[j].trim();
          if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
            if (t.includes(MARKER)) {
              marked = true;
              break;
            }
            continue;
          }
          break;
        }
        found.push({ rel, line: i + 1, text: line.trim(), marked });
      });
    }
    return found;
  })();

  it("finds the call sites at all — the old guard's blind spots are covered", () => {
    // A scan that matches nothing passes for the wrong reason. This is the
    // positive control: `render/` and `src/scenes/` are in range, and the
    // `.animator.` spelling is matched.
    const files = new Set(hits.map((h) => h.rel));
    expect(files.has("game/pinball-knight/render/remote-party.ts")).toBe(true);
    expect(files.has("scenes/tavern/player.ts")).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it("lets no direct tick through without naming its clock", () => {
    const unmarked = hits
      .filter((h) => h.rel !== CLOCK_OWNER && !h.marked)
      .map((h) => `${h.rel}:${h.line}: ${h.text}`);
    expect(
      unmarked,
      "Every animator tick outside the presentation system must carry a " +
        `"// ${MARKER} <which clock>" comment within five lines above it. ` +
        "If the actor is in state.zombies or the dungeon scene, the answer is " +
        "that it should be registered with animationPresentation instead.",
    ).toEqual([]);
  });

  it("does not let the marker be sprayed over the clock owner itself", () => {
    const owner = hits.filter((h) => h.rel === CLOCK_OWNER);
    expect(owner.every((h) => !h.marked)).toBe(true);
  });
});
