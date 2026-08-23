/**
 * EVERY HARDCODED COLOUR THAT CLAIMS TO BE A PALETTE ENTRY MUST BE ONE.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT THE TEST THE PLAN ASKED FOR ───────────
 *
 * `MAZE_COLOUR_PLAN.md` carried this as backlog item 2: "surface wash textures
 * hardcode off-palette `rgba()` — each has a comment naming a palette index that
 * the literal does not match". Checked before rewriting anything: **all eleven
 * of them match.** The claim was wrong, and acting on it would have been a
 * rewrite of working code justified by a stale note.
 *
 * The hazard behind the claim is real, though, and it is DRIFT: the literals are
 * decimal `rgba()` strings because canvas2D wants them, so nothing connects them
 * to `PALETTE_HEX`. Edit an entry and they silently desync — and since the pass
 * now snaps the ALBEDO, an off-palette wash is resolved with no lighting left to
 * blur where it lands.
 *
 * So the fix is not to rewrite them. It is to make the drift impossible to ship
 * quietly, which costs one test instead of one refactor.
 *
 * ── THE SCAN CAN FAIL ────────────────────────────────────────────────────────
 * A regex that matches nothing passes on a broken repo as happily as on a
 * healthy one. The first case below pins the count, so deleting the washes or
 * reformatting the comments trips this file rather than silently disarming it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PALETTE_HEX } from "./palette";

const BUILD = readFileSync(join(__dirname, "..", "maze", "build.ts"), "utf8");

/** `rgba(r, g, b, a)"  // <words> <index>` — a literal that names its entry. */
const ANNOTATED = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)"[;,]?\s*\/\/\s*[a-zA-Z \/]*?(\d+)\s*$/gm;

interface Literal {
  line: number;
  rgb: number;
  claimed: number;
}

function annotatedLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  for (const m of src.matchAll(ANNOTATED)) {
    out.push({
      line: src.slice(0, m.index).split("\n").length,
      rgb: (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]),
      claimed: Number(m[4]),
    });
  }
  return out;
}

const LITERALS = annotatedLiterals(BUILD);

describe("hardcoded palette literals in maze/build.ts", () => {
  it("SELF-TEST: the scan still finds the surface-wash literals", () => {
    // 11 at the time of writing (ice x3, sand x4, steel x3, flowstone x1).
    // If this drops the regex has stopped matching and the assertion below is
    // vacuous; if it rises, new literals appeared and are now covered.
    expect(LITERALS.length).toBeGreaterThanOrEqual(11);
  });

  it("every literal equals the palette entry its comment names", () => {
    const wrong = LITERALS.filter((l) => PALETTE_HEX[l.claimed] !== l.rgb).map(
      (l) =>
        `build.ts:${l.line} claims entry ${l.claimed} (#${(PALETTE_HEX[l.claimed] ?? 0)
          .toString(16)
          .padStart(6, "0")}) but is #${l.rgb.toString(16).padStart(6, "0")}`,
    );
    expect(wrong).toEqual([]);
  });

  it("every claimed index is inside the palette", () => {
    expect(LITERALS.filter((l) => PALETTE_HEX[l.claimed] === undefined)).toEqual([]);
  });
});

describe("the biome remap reaches the masonry props", () => {
  /**
   * `css(i)` applies BIOME_STONE for entries 2/3/4; `PALETTE_HEX[i]` does not.
   * Anything made of the floor's ROCK has to go through `css`, or it stays cold
   * grey on a rot-green, blood-red or arcane-blue floor. Two materials were
   * doing exactly that until 2026-07-30 (pilasters/architecture, and the stairs).
   *
   * Structural rather than rendered, because the suite cannot see a frame — and
   * because the failure is silent: the prop renders, it is just the wrong rock.
   */
  it("no material takes a remappable stone entry straight from PALETTE_HEX", () => {
    const offenders: string[] = [];
    const lines = BUILD.split("\n");
    lines.forEach((line, i) => {
      if (!/Material\(/.test(line)) return;
      const m = /color:\s*PALETTE_HEX\[([0-9]+)\]/.exec(line);
      if (m && [2, 3, 4].includes(Number(m[1]))) offenders.push(`build.ts:${i + 1} ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it("SELF-TEST: the scan sees the materials it is scanning", () => {
    // The check above is a negative assertion, so it passes if the regex never
    // matches anything. Prove the file really does declare materials this way —
    // `voidMat` legitimately keeps PALETTE_HEX[0] (void is never remapped).
    expect(/color:\s*PALETTE_HEX\[0\]/.test(BUILD)).toBe(true);
    expect((BUILD.match(/Material\(/g) ?? []).length).toBeGreaterThan(10);
  });
});
