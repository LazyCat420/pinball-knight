/**
 * The extracted modules must not import `core.ts`, and `core.ts` must not grow back.
 *
 * ## Why this exists
 *
 * `core.ts` was decomposed once already: 4068 → 2140 lines across eight steps
 * (see `docs/core-decomposition-plan.md`). It then grew back to **2753** — the
 * plunger, the ARPG packs, the boss antechamber and co-op seed adoption all
 * landed straight back into the file, because nothing in this repo stops them.
 * There is no max-lines lint, no madge, no `import/no-cycle`.
 *
 * That regrowth is the whole argument for this file. An end state that is not
 * enforced is not an end state; it is a comment. So the two properties that the
 * decomposition depends on are asserted here, against the source:
 *
 *  1. **No extracted module imports `core`.** `core.ts` calls *down* into
 *     everything and handlers call *back* through injected deps
 *     (`setDebugActionDeps`, `set*Handler`, `DevHookDeps`). One `import { … }
 *     from "../core"` added in a hurry compiles, passes every other test, and
 *     quietly reintroduces the cycle the injection pattern exists to prevent.
 *  2. **`core.ts` stays under a ceiling that only ever goes down.** This is a
 *     RATCHET, not a quality metric — a line count says nothing about whether
 *     code is good. Its only job is to make the +613 regrowth impossible to
 *     repeat silently. Lower `CORE_MAX_LINES` in the same commit as each
 *     extraction; never raise it. If you genuinely need to add to `core.ts`,
 *     take something else out first.
 *
 * Modelled on `engine/purity.test.ts`, including its anti-vacuity guard — a
 * source-scanning rule whose walker silently matches nothing passes forever
 * while protecting nothing, which is the classic way this kind of test dies.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const GAME_DIR = join(__dirname);
const CORE = resolve(GAME_DIR, "core.ts");

/**
 * The directories holding code extracted OUT of `core.ts`. These are the ones
 * that could plausibly want to reach back up. Add new extraction targets here
 * as they are created — `sim/`, `input/` and `run/` are listed before they are
 * fully populated so the rule is armed the moment the first file lands.
 */
const EXTRACTED_DIRS = ["boot", "dev", "spawn", "economy", "run", "sim", "input"];

/**
 * The ceiling. **Only ever lower this.**
 *
 * History, so the direction of travel is legible:
 *   2764  Wave 0 — installed. Added 11 lines on purpose (the floor-seed import
 *         and the `captureFloorCensus()` call) to buy the instruments the later
 *         waves are gated on.
 *   1038  Wave 4 — buildLevel (717 lines) split at the line where the floor
 *         stops being locals and becomes state.grid. Ten values cross that
 *         boundary; everything else is consumed before it.
 *   1671  Wave 3 — run/{deps,descend,death}.ts, input/keymap.ts, spawn/reaper.ts.
 *         Only THREE symbols cross back into core (startLevel, armFloorLoading,
 *         exitDungeonGame); they are pushed in via setRunDeps rather than
 *         imported, which is what keeps the graph acyclic.
 *   2254  Wave 2 — boot/renderer.ts, boot/scene.ts and boot/wiring.ts. The
 *         wiring is TWO functions because the callback bus was never one block:
 *         the dev half runs before the HUD is built and the gameplay half after.
 *   2445  Wave 1 — FixedStepLoop adopted; biomes, seed-param, warmup, grade and
 *         grave-hole moved out; and 166 dead import names deleted, 153 of which
 *         had been dangling since the previous decomposition. Nothing had ever
 *         reported them: `tsc` does not run `noUnusedLocals` here and eslint is
 *         not configured for v9.
 */
const CORE_MAX_LINES = 1038;

/**
 * Line count, measured the way `wc -l` measures it.
 *
 * `split("\n").length` is one HIGHER on any file ending in a newline (which is
 * every file here), so a ceiling set from `wc -l` fails by exactly one and the
 * number in this file silently stops meaning what a human checking it means.
 */
function lineCount(path: string): number {
  const src = readFileSync(path, "utf8");
  let n = 0;
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Every module specifier imported by a file, including `import type`. */
function importsOf(src: string): string[] {
  const specs: string[] = [];
  // Covers `from "x"` (static + re-export) and dynamic/type-position import("x").
  const re = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

describe("core boundary", () => {
  const dirs = EXTRACTED_DIRS.map((d) => join(GAME_DIR, d)).filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const files = dirs.flatMap(tsFiles);

  it("finds the extracted sources (guards against the walker matching nothing)", () => {
    // Without this, a renamed directory would make the rule below vacuously
    // pass and the boundary would rot unobserved.
    expect(dirs.length).toBeGreaterThanOrEqual(5);
    expect(files.length).toBeGreaterThan(10);
  });

  it("never imports core.ts", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (!spec.startsWith(".")) continue; // a package, not our tree
        // Resolve against the importing file so this catches `../core`,
        // `../../core`, and any future nesting — not just one path shape.
        const target = resolve(dirname(file), spec);
        if (target === CORE || target === `${CORE.slice(0, -3)}`) {
          violations.push(`${relative(GAME_DIR, file)} → ${spec}`);
        }
      }
    }
    // If you are here: the fix is to pass the value in (a `*Deps` object or a
    // `set*Handler`, as dev/ and spawn/ already do), NOT to import core.
    expect(violations).toEqual([]);
  });
});

describe("core.ts size ratchet", () => {
  it("does not grow back", () => {
    const lines = lineCount(CORE);
    // A failure here is not "the file is too big" — it is "something that was
    // extracted came back, or new work chose core.ts as its home". Put it in
    // the module that owns the concern instead.
    expect(lines).toBeLessThanOrEqual(CORE_MAX_LINES);
  });

  it("has a ceiling that is actually close to the real size (the ratchet is tight)", () => {
    // A ceiling left far above the file is the same as no ceiling. This fails
    // when an extraction lands without lowering CORE_MAX_LINES, which is the
    // moment the ratchet would otherwise start drifting into decoration.
    const lines = lineCount(CORE);
    expect(CORE_MAX_LINES - lines).toBeLessThanOrEqual(100);
  });
});
