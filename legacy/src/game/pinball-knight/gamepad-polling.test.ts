/**
 * Every scene that OWNS an InputHandle must POLL it.
 *
 * The regression this exists for: the tavern called `createInput(canvas)` and
 * read `input.axis()` every frame, but never called `input.poll()`. The Gamepad
 * API is PULL-only — it fires no events for stick movement, so the poller is the
 * only thing that ever writes `gp.moveX/moveZ`. Without that call the pad's
 * contribution was permanently zero and `axis()` saw the keyboard alone: a
 * controller did nothing in the tavern while working fine in the dungeon, which
 * polls in its own loop. Reported as "the controller doesn't work in the tavern,
 * it only works in the map in game".
 *
 * A missing method call is invisible to the type checker and to every behavioural
 * test (the scene still runs, it just ignores the pad), and the tavern frame loop
 * needs a live three.js scene to drive — so this asserts it STATICALLY over the
 * source instead. Any new scene that creates an input handle is covered the day
 * it is written, which a hand-written per-scene test would not be.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("gamepad polling", () => {
  it("every scene that creates an InputHandle also polls it", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, "utf8");
      // `createInput(` is the sole constructor of an InputHandle. Its own module
      // defines the function rather than calling it, so skip the definition site.
      if (!/\bcreateInput\s*\(/.test(src)) continue;
      if (/export function createInput\s*\(/.test(src)) continue;
      // The poll may be on any handle name (`input?.poll()`, `state.input?.poll()`).
      if (!/\.poll\s*\(\s*\)/.test(src)) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders, "these scenes create an input handle but never poll the pad").toEqual([]);
  });
});

// NB: there is deliberately no "polls before it reads the axis" test here.
// Source-text order is not call order — `axis()` appears in the dungeon's core
// long before the frame loop's `poll()`, in an unrelated function — so a
// position compare over the file reports a failure that isn't real. Ordering is
// a property of the frame loop, and pinning it honestly needs the loop driven,
// not the source scanned.
