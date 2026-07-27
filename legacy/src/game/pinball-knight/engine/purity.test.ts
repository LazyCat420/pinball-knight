/**
 * The engine must not import the game.
 *
 * This is the whole point of the extraction, and it is exactly the kind of
 * property that rots silently: one `import { state } from "../state"` added in
 * a hurry compiles, passes every other test, ships — and quietly re-couples the
 * engine to Pinball Knight's content. Nothing else would catch it.
 *
 * So the rule is asserted directly against the source. If you are here because
 * this test failed, the fix is almost never to add an exception: it is to pass
 * the value in (see `GameEngine.installEngine` and `engine/config.ts`) or to
 * move the generic part of what you needed down into `engine/`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ENGINE_DIR = join(__dirname);

/**
 * Escapes the engine is allowed to make: shared leaf utilities that live
 * OUTSIDE the game entirely (src/utils, src/pixel) and are not Pinball Knight
 * content. Everything else reachable via `../` is game content.
 */
const ALLOWED_ESCAPES = [/^\.\.\/(\.\.\/)+utils\//, /^\.\.\/(\.\.\/)+pixel\//];

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

describe("engine purity", () => {
  const files = tsFiles(ENGINE_DIR);

  it("finds the engine sources (guards against the walker silently matching nothing)", () => {
    // Without this, a broken path would make every assertion below vacuously
    // pass — the classic way a rule like this stops protecting anything.
    expect(files.length).toBeGreaterThan(10);
  });

  it("never imports game content", () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (!spec.startsWith(".")) continue; // a package, not our tree
        if (ALLOWED_ESCAPES.some((re) => re.test(spec))) continue;
        // Resolve against the importing file: `../config` from engine/render/
        // stays INSIDE the engine and is fine. What matters is whether the
        // target lands outside engine/, not how many `..` the specifier has.
        const target = resolve(dirname(file), spec);
        const rel = relative(ENGINE_DIR, target);
        if (rel.startsWith("..")) {
          violations.push(`${relative(ENGINE_DIR, file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("never mentions the game's state singleton or tuning table", () => {
    // A belt-and-braces check on the two modules that caused the coupling in
    // the first place, in case someone reaches them by a path shape the
    // specifier check above does not anticipate.
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (/(^|\/)(state|constants)$/.test(spec)) {
          violations.push(`${relative(ENGINE_DIR, file)} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
