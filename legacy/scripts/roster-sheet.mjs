#!/usr/bin/env node
/**
 * THE ROSTER CONTACT SHEET — every monster at atlas truth, with its census.
 *
 * `foe-sheet.mjs` shows ONE family in a browser. This shows ALL of them, in
 * node, in about a second — which is what makes it usable as a before/after
 * for a wave that touches several painters at once.
 *
 * Every cell is the REAL path (`paintAtlas` → `paintInArtSpace` → `crushToGrid`
 * from the testkit), nearest-upscaled so the atlas texels are the thing on
 * screen rather than a flattering smooth preview. The numbers under each row
 * are the same census `noise.test.ts` gates on.
 *
 *   node scripts/roster-sheet.mjs
 *   node scripts/roster-sheet.mjs --grid 90 --zoom 4 --out scratchpad/after.png
 *
 * ⚠️ READ THE ENTRIES COLUMN, NOT JUST isolated%. The atlas lock evicts down to
 * 20 entries (boot/sheets.ts LOCK), so a painter declaring 32 is asking for
 * twelve colours the shipped sheet will not have — and isolated% is confounded
 * by SIZE (a small sprite is mostly perimeter, so it scores worse for being
 * small rather than for being noisy). Rank by `entries` and `invented`; use
 * isolated% only to compare a sprite against ITSELF across a change.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const grid = Number(arg("grid", "63"));
const zoom = Number(arg("zoom", "3"));
const out = arg("out", `scratchpad/roster-${grid}.png`);

/**
 * The entry is written to a temp .ts and bundled, rather than being a .mjs that
 * imports the testkit directly: the testkit is TypeScript and reaches into the
 * engine, so node cannot load it without a build step. esbuild is already a
 * devDependency for the card harnesses.
 */
const ENTRY = `
import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { installSpriteTestDom, rosterSubjects, censusSubject, censusFrames, paintAtlas } from "../src/game/pinball-knight/testkit/atlas-census";

const GRID = ${grid}, Z = ${zoom}, OUT = ${JSON.stringify(out)};
const undo = installSpriteTestDom();
const subjects = rosterSubjects();

// One row per monster: its census frames (idle + two stride extremes).
const COLS = 3, PAD = 6, LABEL = 128, CELL = GRID * Z;
const rowH = CELL + PAD;
const cv = createCanvas(LABEL + COLS * (CELL + PAD) + PAD, subjects.length * rowH + PAD);
const ctx = cv.getContext("2d");
ctx.fillStyle = "#0b0d12";
ctx.fillRect(0, 0, cv.width, cv.height);
ctx.imageSmoothingEnabled = false;

subjects.forEach((s, r) => {
  const y = PAD + r * rowH;
  const st = censusSubject(s, GRID);
  ctx.fillStyle = "#c9bfa4";
  ctx.font = "12px monospace";
  ctx.fillText(s.key, 6, y + 16);
  ctx.fillStyle = st.entries > 20 ? "#d95763" : "#8a8272";
  ctx.font = "10px monospace";
  ctx.fillText(\`e \${st.entries}  inv \${st.inventedIdx.length}\`, 6, y + 32);
  ctx.fillStyle = "#8a8272";
  ctx.fillText(\`iso \${st.isolatedPct.toFixed(1)}%\`, 6, y + 46);
  ctx.fillText(\`run \${st.runLen.toFixed(2)}\`, 6, y + 60);

  censusFrames(s.paints).slice(0, COLS).forEach((f, c) => {
    const img = paintAtlas(f, GRID);
    const cell = createCanvas(GRID, GRID);
    cell.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(cell, LABEL + c * (CELL + PAD), y, CELL, CELL);
  });
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, cv.toBuffer("image/png"));
console.log("wrote", OUT, \`(\${subjects.length} monsters, grid \${GRID})\`);
undo();
`;

const tmpTs = join("scripts", ".roster-sheet.entry.ts");
const tmpJs = join("scripts", ".roster-sheet.bundle.cjs");
try {
  mkdirSync(dirname(tmpTs), { recursive: true });
  writeFileSync(tmpTs, ENTRY);
  execFileSync(
    "npx",
    ["esbuild", tmpTs, "--bundle", "--platform=node", "--format=cjs", "--external:canvas", `--outfile=${tmpJs}`, "--log-level=error"],
    { stdio: "inherit" },
  );
  execFileSync("node", [tmpJs], { stdio: "inherit" });
} finally {
  rmSync(tmpTs, { force: true });
  rmSync(tmpJs, { force: true });
}
