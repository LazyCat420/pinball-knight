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
 *
 * ## The unit is the SCENE, not the file
 *
 * It was the file until the dungeon was decomposed: `core.ts` creates the handle
 * and `sim/loop.ts` polls it, which is correct — creation belongs to boot and
 * polling belongs to the frame — and the old per-file rule called it a bug.
 *
 * Widening it to the scene directory is not a loosening to make a red test go
 * green: the property being asserted was always "whoever OWNS a handle polls
 * it", and after the split the owner is a directory rather than a single file.
 * A scene that creates a handle and polls it nowhere still fails, which is the
 * regression this was written for.
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

/**
 * The scene a file belongs to: the directory under `game/` or `scenes/` that
 * owns it. Falls back to the file itself so a stray top-level module is still
 * held to the rule rather than silently exempted.
 */
function sceneOf(file: string): string {
  const rel = file.slice(SRC.length + 1);
  const m = /^((?:game|scenes)\/[^/]+)\//.exec(rel);
  return m ? m[1] : rel;
}

describe("gamepad polling", () => {
  const files = walk(SRC);

  it("finds the sources (guards against the walker matching nothing)", () => {
    // A walker that silently matches nothing turns the rule below into a no-op
    // that passes forever.
    expect(files.length).toBeGreaterThan(200);
  });

  it("every scene that creates an InputHandle also polls it", () => {
    const creates = new Set<string>();
    const polls = new Set<string>();
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // `createInput(` is the sole constructor of an InputHandle. Its own module
      // DEFINES both it and `poll`, so it counts as neither a creator nor a
      // poller — counting it as a poller would satisfy every scene in the same
      // directory tree vacuously, which is how this rule would quietly die.
      const isEngineInput = /export function createInput\s*\(/.test(src);
      if (isEngineInput) continue;
      // The poll may be on any handle name (`input?.poll()`, `state.input?.poll()`).
      if (/\.poll\s*\(\s*\)/.test(src)) polls.add(sceneOf(file));
      if (/\bcreateInput\s*\(/.test(src)) creates.add(sceneOf(file));
    }
    expect(creates.size, "no scene creates an input handle — the pattern changed").toBeGreaterThan(0);
    const offenders = [...creates].filter((s) => !polls.has(s)).sort();
    expect(offenders, "these scenes create an input handle but never poll the pad").toEqual([]);
  });
});

// NB: there is deliberately no "polls before it reads the axis" test here.
// Source-text order is not call order — `axis()` appears in the dungeon's core
// long before the frame loop's `poll()`, in an unrelated function — so a
// position compare over the file reports a failure that isn't real. Ordering is
// a property of the frame loop, and pinning it honestly needs the loop driven,
// not the source scanned.
