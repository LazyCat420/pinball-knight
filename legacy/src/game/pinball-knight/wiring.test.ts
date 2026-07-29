/**
 * Every injection point must actually be wired.
 *
 * ## The failure this catches
 *
 * The dependency graph here is kept acyclic by INJECTION: modules that need a
 * core-owned action take it through a setter (`setCoinDropHandler`,
 * `setDebugActionDeps`, `setCoopHooks`) instead of importing back up. It is a
 * good pattern with one nasty property — **an injected dep that is never wired
 * fails silently.** The handler is simply `null`, the call site skips it, and
 * the game keeps running with a coin that never drops or a summon that never
 * arrives. Nothing throws. No test goes red. The previous decomposition learned
 * this the hard way and recorded it: "an injected dep that is never wired fails
 * *silently*, so each one was verified live, not assumed."
 *
 * Adding the handler and forgetting the `set…()` call is a two-line mistake
 * that produces a subtly broken game. So the wiring is asserted here instead of
 * remembered.
 *
 * ## The rule
 *
 * A function exported as `set<Something><Handler|Hooks|Deps|Bridge|Source>` is
 * an injection point BY NAMING CONVENTION, and must be called from at least one
 * non-test module other than the one that defines it.
 *
 * The convention is the interface. If you add an injection point, name it that
 * way and this test starts guarding it for free; if you name it something else,
 * you have opted out and nothing will notice when it rots. That is why the
 * discovery is by pattern and not a hand-maintained list — a list is a thing
 * you forget to add to, which is the same class of mistake.
 *
 * Value setters (`setTile`, `setHUDMode`, `setMazeBiome`, …) are deliberately
 * NOT matched: they take data, not behaviour, and a missing call to one is a
 * visible bug rather than a silent hole.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GAME_DIR = join(__dirname);

/**
 * `setEnginePalette` is the one injection point that does not follow the naming
 * convention. It is exempt because it cannot rot unnoticed the same way: it is
 * wired by `installEngine()` alongside `configureEngine()`, and when it is
 * missing the engine falls back to a neutral GREYSCALE palette — a failure you
 * cannot miss on the first frame, which is the opposite of silent.
 */
const EXEMPT = new Set(["setEnginePalette"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("injection wiring", () => {
  const files = tsFiles(GAME_DIR);
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  /** name → the file that declares it. */
  const injectors = new Map<string, string>();
  for (const [file, src] of sources) {
    const re = /^export function (set\w*(?:Handler|Hooks|Deps|Bridge|Source))\s*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) if (!EXEMPT.has(m[1])) injectors.set(m[1], file);
  }

  it("finds the injection points (guards against the walker matching nothing)", () => {
    // A pattern that silently stops matching turns every assertion below into a
    // no-op that passes forever — the classic way a rule like this dies.
    expect(files.length).toBeGreaterThan(100);
    expect(injectors.size).toBeGreaterThanOrEqual(12);
  });

  it("wires every injection point from somewhere other than its own module", () => {
    const unwired: string[] = [];
    for (const [name, declaredIn] of injectors) {
      const called = [...sources].some(
        ([file, src]) => file !== declaredIn && new RegExp(`\\b${name}\\s*\\(`).test(src),
      );
      if (!called) unwired.push(`${name} (declared in ${relative(GAME_DIR, declaredIn)})`);
    }
    // If you are here: you added an injection point and never called it. The
    // handler is null at runtime and the behaviour it feeds silently does not
    // happen. Wire it where the rest are wired.
    expect(unwired).toEqual([]);
  });
});
