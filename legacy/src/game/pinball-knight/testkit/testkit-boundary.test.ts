/**
 * The testkit must never reach the client bundle.
 *
 * `testkit/atlas-census.ts` imports `canvas` — a devDependency that does not
 * exist in the browser and would fail the build if it were ever pulled in by a
 * production import. Nothing in the type system says so, and nothing in Next's
 * config would catch it (`ignoreBuildErrors` is on), so it is a scan — the same
 * shape `gui/no-dom.test.ts` uses for the same class of property.
 *
 * `withCrushOptions` gets the same treatment for a different reason: it is a
 * MEASUREMENT seam. One production call site and the shipped crush silently
 * depends on a variant nobody reviewed as art.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const TESTKIT = __dirname;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Strip comments so a path named in prose is not mistaken for an import. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("testkit boundary", () => {
  const all = tsFiles(ROOT);
  // `testkit/` is the fence, not something inside it — it is allowed to import
  // node-canvas; that is its entire job.
  const production = all.filter((f) => !f.endsWith(".test.ts") && !f.startsWith(TESTKIT));

  it("scans a plausible number of files", () => {
    // Anti-vacuity: a walker that silently returns [] passes every test below.
    expect(all.length).toBeGreaterThan(100);
    expect(production.length).toBeGreaterThan(80);
  });

  it("no production module imports the testkit or node-canvas", () => {
    const bad: string[] = [];
    for (const f of production) {
      const src = stripComments(readFileSync(f, "utf8"));
      if (/from\s+["'][^"']*testkit\//.test(src) || /from\s+["']canvas["']/.test(src)) {
        bad.push(f.slice(ROOT.length + 1));
      }
    }
    expect(bad, `production code must not import the testkit or node-canvas:\n${bad.join("\n")}`).toEqual([]);
  });

  it("the testkit is actually used by tests — otherwise this file guards nothing", () => {
    const users = all.filter(
      (f) => f.endsWith(".test.ts") && /from\s+["'][^"']*testkit\//.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(users.length).toBeGreaterThan(0);
  });

  it("withCrushOptions is a measurement seam, not a setting", () => {
    const bad: string[] = [];
    for (const f of production) {
      if (f.endsWith(join("engine", "render", "sprite.ts"))) continue; // where it is defined
      if (/withCrushOptions\s*\(/.test(stripComments(readFileSync(f, "utf8")))) bad.push(f.slice(ROOT.length + 1));
    }
    expect(bad, `withCrushOptions may only be called from tests and scripts:\n${bad.join("\n")}`).toEqual([]);
  });
});
