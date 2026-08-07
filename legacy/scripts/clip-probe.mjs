#!/usr/bin/env node
/**
 * WHAT WILL A LIVE MONSTER ACTUALLY DRAW WHEN THE GAME ASKS FOR A CLIP?
 *
 * A screenshot proves a creature is on screen. It cannot prove that the frames
 * it cycles belong to the clip the game asked for — and that gap is exactly
 * where this wave's bugs lived: an `attack` row packed into the atlas and never
 * played, a `death` that resolved to an empty index list and froze the sprite
 * mid-stride. Both look like "the sprite is fine" in a still.
 *
 * So this reads the ATLAS the running game built, on the real GPU, and replays
 * the animator's own resolution rule over it:
 *
 *   · what `play(clip)` RESOLVES to for this creature (the CLIP_FALLBACK hop)
 *   · how many frame indices that resolution actually has
 *
 * `attack → attack 4f` is the fix working. `death → death 0f` is the freeze
 * this wave removed; `death → death Nf` is the painter's death arriving through
 * the per-clip merge in boot/sheets.ts.
 *
 *   node scripts/clip-probe.mjs --kind brute
 *   node scripts/clip-probe.mjs --kind croaker --clips idle,walk,attack,death
 *   node scripts/clip-probe.mjs --all          # the whole roster, one line each
 *
 * Reuses the CDP browser sprite-shot.mjs starts — same reason, same handshake:
 * WSL2 has no GPU path to WebGPU and SwiftShader renders a different game.
 *
 * ⚠️ THE FALLBACK TABLE IS READ OUT OF animator.ts, NOT RESTATED HERE.
 *
 * It was a copy for one revision, and the copy immediately did what copies do:
 * `run: "walk"` was added to the real table, the probe kept reporting 63 frozen
 * pairs from its own stale duplicate, and the fix looked like it had failed. A
 * harness that restates the logic it checks can only ever confirm itself. Same
 * trick published.test.ts uses on IMPORTED_ART, for the same reason.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ANIMATOR = join(HERE, "..", "src", "game", "pinball-knight", "engine", "render", "animator.ts");

/** `CLIP_FALLBACK` from the engine itself — the one source of truth. */
function clipFallback() {
  const src = readFileSync(ANIMATOR, "utf8");
  const block = /const CLIP_FALLBACK[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error("[probe] could not find CLIP_FALLBACK in animator.ts — did it move?");
  // Strip block comments before matching, or a clip named inside a docblock
  // (this table's comments name plenty) is read as an entry.
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  const out = Object.fromEntries([...body.matchAll(/(\w+)\s*:\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
  if (!Object.keys(out).length) throw new Error("[probe] CLIP_FALLBACK parsed as empty");
  return out;
}

const { values: a } = parseArgs({
  options: {
    kind: { type: "string", default: "brute" },
    all: { type: "boolean", default: false },
    url: { type: "string", default: "http://localhost:5174/dungeon" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9345" },
    clips: { type: "string", default: "idle,walk,run,attack,death,stumble" },
    json: { type: "boolean", default: false },
  },
});

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${a["cdp-port"]}`);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("/dungeon")) ?? (await ctx.newPage());

// ⚠️ ALWAYS LOAD THE PAGE FRESH, AND WITH THE CACHE OFF.
//
// This probe reads the atlas the game ALREADY BUILT — monster sheets are
// rasterised once at boot and cached on `state`. Reusing a page that is
// already sitting in the dungeon therefore reports the atlas from whenever
// that page loaded, and Next's HMR does not re-run `buildMonsterSheets`.
//
// Measured: reverting the fix under test and re-probing an open page returned
// byte-identical output. A probe that reports the same thing with the fix and
// without it is not a probe, and this one nearly shipped as one. The CDP
// Chrome's profile also persists across runs and will happily serve the
// previous bundle, which is the same trap prep-knight's notes record.
await ctx.route?.("**/*", (r) => r.continue()).catch(() => {});
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await page.goto(`${a.url}?gpu=webgpu&seed=777&no-intro=1&t=${process.hrtime.bigint()}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => typeof window.__dungeonClips === "function", null, { timeout: 60_000 });
// The imported sheets land asynchronously (applyImportedArt is not awaited at
// boot by design), and they REBUILD the atlas when they do. Probing before
// that lands reports the painter and calls it the import.
await page.waitForFunction(
  (k) => {
    const m = window.__dungeonClips(k);
    return m && Object.keys(m).length > 0;
  },
  a.all ? "brute" : a.kind,
  { timeout: 60_000 },
);
await page.waitForTimeout(2500);

const CLIPS = a.clips.split(",");
const kinds = a.all
  ? await page.evaluate(() => window.__lab.kinds())
  : [a.kind];

const report = await page.evaluate(
  ({ kinds, clips, FALLBACK }) => {
    const DIRS = ["S", "N", "E"];
    return kinds.map((kind) => {
      const map = window.__dungeonClips(kind);
      if (!map) return { kind, missing: true };
      const rows = clips.map((clip) => {
        const byDir = {};
        for (const dir of DIRS) {
          const own = map[`${dir}:${clip}`] ?? [];
          const played = own.length ? clip : (FALLBACK[clip] ?? clip);
          byDir[dir] = { played, frames: (map[`${dir}:${played}`] ?? []).length, authored: own.length > 0 };
        }
        return { clip, byDir };
      });
      return { kind, rows };
    });
  },
  { kinds, clips: CLIPS, FALLBACK: clipFallback() },
);

if (a.json) {
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(0);
}

let frozen = 0;
let fellBack = 0;
for (const r of report) {
  if (r.missing) { console.log(`\n  ${r.kind}: no atlas`); continue; }
  console.log(`\nCLIP RESOLUTION — ${r.kind}, live, WebGPU`);
  console.log(`  ${"clip".padEnd(9)}${["S", "N", "E"].map((d) => d.padEnd(18)).join("")}`);
  for (const row of r.rows) {
    const cells = ["S", "N", "E"].map((d) => {
      const v = row.byDir[d];
      if (v.frames === 0) { frozen++; return "FROZEN (0f)".padEnd(18); }
      if (!v.authored) { fellBack++; return `→${v.played} ${v.frames}f`.padEnd(18); }
      return `${v.frames}f`.padEnd(18);
    });
    console.log(`  ${row.clip.padEnd(9)}${cells.join("")}`);
  }
}
console.log(
  frozen
    ? `\n✗ ${frozen} (clip, facing) pair(s) resolve to ZERO frames — apply() bails and the sprite freezes.\n`
    : `\n✓ no clip resolves to zero frames — nothing can freeze. ${fellBack} pair(s) fall back by design.\n`,
);
await browser.close();
process.exit(frozen ? 1 : 0);
