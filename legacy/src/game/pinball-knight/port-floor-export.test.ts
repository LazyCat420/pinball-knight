/**
 * AUTHORED-FLOOR EXPORT — the oracle's finished floors, as data the port loads.
 *
 * Sibling of `port-maze-fixtures.test.ts`, and a different job. That one pins
 * the generator's SHAPE at each of twenty-three pass boundaries so the Rust
 * port can be debugged pass by pass. This one exports the finished article —
 * grid AND `LevelPlan` — so the Rust game can RENDER a real floor before the
 * content half of the generator is ported at all.
 *
 * ── WHY THIS EXISTS (docs/src/status/build-out.md) ─────────────────────────
 * `buildTrackFloor` authors a floor's shape; everything a player looks at is
 * authored afterwards by `decorateMaze` — torches, items, props, the pinball
 * parts, the rooms, the secrets. Nine of the twenty-three shape passes are
 * ported and none of the content is, so the port's dungeon is a grey skeleton
 * and no amount of further generator work changes that.
 *
 * `LevelPlan` is pure data: tile positions and kinds. So the TS game can be the
 * DATA SOURCE and not merely the oracle — export the floor, render it in Rust,
 * and the dungeon has its content in days rather than weeks. Porting
 * `decorateMaze` afterwards then gets a gate for free: generate in Rust and
 * diff against this JSON for the same seed, instead of building a second
 * bespoke digest harness.
 *
 * ── ONE CODE PATH, BY CONSTRUCTION ─────────────────────────────────────────
 * This calls `authorFloor(level)` — the function the running game calls — and
 * not a re-derivation of its forty lines of budget and `extras` glue. That glue
 * is where a hand-copied exporter would drift, and a drifted export is worse
 * than none: it would look like a floor and be a floor the game never builds.
 * The only thing set up around it is `state.runSeed`, which is exactly what
 * `core.ts` does before calling it.
 *
 * It runs headless: `authorFloor` reaches localStorage (best-depth) and the
 * biome lighting, and both are try/caught or pure. Node prints one
 * `localStorage is not available` warning and carries on.
 *
 *   - Run normally: recomputes and asserts the committed exports still match,
 *     so drift on the TS side is caught the same way the pass digests catch it.
 *   - RUN_EXPORT=1: (re)writes them.
 *
 * ⚠️ AN EXPORT IS NOT A PIN OF THE PORT. These files describe what the ORACLE
 * builds. When Rust generates its own content (build-out Stage 5) the same
 * files become its target — but until then a passing run here says the TS game
 * still makes the floor it made yesterday, and nothing about Rust at all.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { state } from "./state";
import { authorFloor } from "./spawn/floor-authoring";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `legacy/src/game/pinball-knight` → the Rust workspace's assets. */
const OUT_DIR = join(HERE, "..", "..", "..", "..", "assets", "floors");

/**
 * The floors the port ships with.
 *
 * SMALL ON PURPOSE. Every entry is a committed JSON file of a few hundred KB,
 * and the point is a handful of real floors to build a renderer against — not a
 * corpus. The parity corpus lives in `maze-pass-digests.json` and stays there.
 * L1/L3/L5 covers three of the five archetypes and both grid-size regimes the
 * renderer has to survive.
 */
const CORPUS: ReadonlyArray<{ level: number; runSeed: number }> = [
  { level: 1, runSeed: 1 },
  { level: 3, runSeed: 1 },
  { level: 5, runSeed: 1 },
];

/** What one exported floor looks like on disk. Version it — the Rust loader
 *  refuses a schema it does not know rather than reading fields blind. */
const SCHEMA = 1;

function exportFloor(level: number, runSeed: number): unknown {
  // Exactly what `core.ts:178` does before authoring a floor. `authorFloor`
  // reads `state.runSeed` and mixes it with the level (maze/floor-seed.ts).
  state.runSeed = runSeed;
  const f = authorFloor(level);
  const g = f.grid;
  const p = f.plan;
  return {
    schema: SCHEMA,
    producer: "legacy/src/game/pinball-knight/port-floor-export.test.ts",
    level,
    runSeed,
    biome: f.biome,
    archetype: f.arch.id,
    modifier: f.modifier?.id ?? null,
    grid: {
      w: g.w,
      h: g.h,
      // Plain arrays, not base64: these files are read by a Rust serde loader
      // and by humans diffing a regression, and a few hundred KB of integers is
      // worth being able to read one.
      t: Array.from(g.t),
      shapes: Array.from(g.shapes),
      // Arc features are OPTIONAL on a Grid and only a track floor has them.
      // Exported as-is so the renderer's curved-wall bucket has something to
      // draw the day it is wired; `null` is a floor with no arcs, not a bug.
      arcs: g.arcs ? g.arcs.map((a) => ({ ...a })) : null,
      arcIdx: g.arcIdx ? Array.from(g.arcIdx) : null,
    },
    plan: {
      start: p.start,
      stairs: p.stairs,
      spawns: p.spawns,
      torches: p.torches,
      items: p.items,
      props: p.props,
      parts: p.parts,
      rooms: p.rooms,
      secrets: p.secrets,
      plazas: p.plazas,
      frog: p.frog,
      circuits: p.circuits,
    },
  };
}

/** The fields a human reads first when an export changes under them. */
function summary(v: {
  grid: { w: number; h: number };
  plan: Record<string, unknown>;
}): Record<string, number> {
  const n = (k: string): number => {
    const arr = v.plan[k];
    return Array.isArray(arr) ? arr.length : 0;
  };
  return {
    w: v.grid.w,
    h: v.grid.h,
    spawns: n("spawns"),
    torches: n("torches"),
    items: n("items"),
    props: n("props"),
    parts: n("parts"),
    rooms: n("rooms"),
    secrets: n("secrets"),
    circuits: n("circuits"),
  };
}

describe("authored floor export", () => {
  for (const { level, runSeed } of CORPUS) {
    it(`L${level} seed ${runSeed} exports a floor with content on it`, () => {
      const built = exportFloor(level, runSeed) as ReturnType<typeof exportFloor> & {
        grid: { w: number; h: number };
        plan: Record<string, unknown>;
      };
      const file = join(OUT_DIR, `L${level}-s${runSeed}.json`);

      // A floor with no content would export cleanly and render as the skeleton
      // this whole exercise exists to replace, so assert the payload is
      // POPULATED before it is written. These are floors, not fixtures — the
      // bound is "some", not an exact count that would churn on every balance
      // tweak in the oracle.
      const s = summary(built);
      expect(s.w).toBeGreaterThan(10);
      expect(s.h).toBeGreaterThan(10);
      for (const k of ["torches", "parts", "props", "spawns"] as const) {
        expect(s[k], `${k} on L${level}`).toBeGreaterThan(0);
      }

      if (process.env.RUN_EXPORT === "1") {
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(file, `${JSON.stringify(built)}\n`);
        console.log(`exported ${file}`, s);
        return;
      }
      if (!existsSync(file)) {
        throw new Error(`${file} missing — run RUN_EXPORT=1 to write it`);
      }
      const pinned = JSON.parse(readFileSync(file, "utf8"));
      // ⚠️ BOTH SIDES GO THROUGH JSON, and the first version of this line did
      // not. Comparing the LIVE object against a parsed file fails on things
      // that are not differences: a key whose value is `undefined` is present
      // in the object and absent from the file, `-0` comes back as `0`, and a
      // typed array is an object on one side and an array on the other. Two
      // consecutive exports were byte-identical while this assertion failed on
      // all three floors — which reads as a non-deterministic generator, and it
      // is not one. Serialise both, then compare.
      expect(JSON.parse(JSON.stringify(built))).toEqual(pinned);
    });
  }
});
