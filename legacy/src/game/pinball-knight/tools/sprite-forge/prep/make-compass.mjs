#!/usr/bin/env node
// ─── make-compass — the direction-calibration sheets ────────────────
//
// Three tiny sheets (compass-{S,N,E}) whose ONLY job is to make a facing
// mistake impossible to miss. Each figure is:
//
//   · a fat arrow pointing the facing's SCREEN direction (S=down, N=up,
//     E=right) in that facing's own colour,
//   · the facing letter — letters are chiral, so a mirrored draw is
//     instantly visible,
//   · a red block on the figure's LEFT and a white block on its RIGHT —
//     the flip detector that works even when the letter is too small,
//   · a walk row that bobs, so "is it animating" is answerable too.
//
// Workflow (the "known-good sheet first" tactic): publish these through
// the REAL pipeline (`npm run sprites`), then in the game console
// `__lab.playAs("compass")` and walk all four directions. Stick-down must
// show the down arrow, stick-right the right arrow, and stick-LEFT the
// right-arrow sheet MIRRORED (left arrow + mirrored E) — W is derived,
// never authored. Anything else is a mapping bug, and now it names its
// own direction. See ../docs/FACING_STANDARD.md.
//
// Output is written into inbox/ (tracked) so the fixtures cannot rot in
// a scratch dir. compass.test.ts READS the published result; it never
// regenerates it — a test file must not publish tracked art.
// ─────────────────────────────────────────────────────────────────────
import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INBOX = join(HERE, "..", "inbox");

const CELL = 240;
const IDLE = 2;
const WALK = 4;

/** Facing → arrow colour + unit direction in SCREEN space. */
export const COMPASS = {
  S: { colour: "#3cb44b", dx: 0, dy: 1 },
  N: { colour: "#4363d8", dx: 0, dy: -1 },
  E: { colour: "#f58231", dx: 1, dy: 0 },
};
export const LEFT_MARK = "#e6194b";
export const RIGHT_MARK = "#ffffff";

function drawFigure(ctx, x0, y0, dir, bob) {
  const { colour, dx, dy } = COMPASS[dir];
  const cx = x0 + CELL / 2;
  const cy = y0 + CELL / 2 + bob;
  // Body: a neutral slab so the figure has mass and a ground contact.
  ctx.fillStyle = "#666a72";
  ctx.fillRect(cx - 46, cy - 70, 92, 150);
  // Arrow: shaft + head pointing the facing's screen direction. fillRect only
  // extends down-right, so a negative direction offsets its origin by the
  // shaft length — the first draft's N shaft pointed down and the compass
  // test caught its own fixture.
  ctx.fillStyle = colour;
  const L = 62;
  const shaftW = 20 + Math.abs(dx) * L;
  const shaftH = 20 + Math.abs(dy) * L;
  const shaftX = dx >= 0 ? cx - 10 + dx * 8 : cx + 2 - shaftW;
  const shaftY = dy >= 0 ? cy - 10 + dy * 8 : cy + 2 - shaftH;
  ctx.fillRect(shaftX, shaftY, shaftW, shaftH);
  const hx = cx + dx * (L + 26);
  const hy = cy + dy * (L + 26);
  ctx.beginPath();
  ctx.moveTo(hx + dx * 26, hy + dy * 26);
  ctx.lineTo(hx - dy * 30 - dx * 6, hy - dx * 30 - dy * 6);
  ctx.lineTo(hx + dy * 30 - dx * 6, hy + dx * 30 - dy * 6);
  ctx.closePath();
  ctx.fill();
  // The letter, big enough to survive the crush.
  ctx.fillStyle = "#111318";
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(dir, cx, cy - 44);
  // Flip detector: red = the figure's LEFT edge, white = its RIGHT.
  ctx.fillStyle = LEFT_MARK;
  ctx.fillRect(cx - 46, cy + 44, 24, 36);
  ctx.fillStyle = RIGHT_MARK;
  ctx.fillRect(cx + 22, cy + 44, 24, 36);
}

/**
 * Kill the antialiasing `fillText` smears: every pixel snaps to the nearest
 * ink colour (or transparent) so the sheet is real pixel art to the gate.
 * See the fillText-AA lesson — soft edges become isolated-colour noise at
 * the crush and the census grades the sheet dirty.
 */
function binarize(ctx, w, h) {
  const inks = ["#666a72", "#111318", LEFT_MARK, RIGHT_MARK, ...Object.values(COMPASS).map((c) => c.colour)]
    .map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    d[i + 3] = 255;
    let best = 0;
    let bd = Infinity;
    for (const [r, g, b] of inks) {
      const dist = (d[i] - r) ** 2 + (d[i + 1] - g) ** 2 + (d[i + 2] - b) ** 2;
      if (dist < bd) { bd = dist; best = [r, g, b]; }
    }
    [d[i], d[i + 1], d[i + 2]] = best;
  }
  ctx.putImageData(img, 0, 0);
}

for (const dir of Object.keys(COMPASS)) {
  const cols = Math.max(IDLE, WALK);
  const w = cols * CELL;
  const h = 2 * CELL;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  for (let i = 0; i < IDLE; i++) drawFigure(ctx, i * CELL, 0, dir, i % 2 ? 4 : 0);
  for (let i = 0; i < WALK; i++) drawFigure(ctx, i * CELL, CELL, dir, [0, 8, 0, -8][i]);
  binarize(ctx, w, h);
  writeFileSync(join(INBOX, `compass-${dir}.png`), c.toBuffer("image/png"));
  writeFileSync(
    join(INBOX, `compass-${dir}.json`),
    JSON.stringify({ rows: ["idle", "walk"], cells: [IDLE, WALK] }, null, 1) + "\n",
  );
  console.log(`compass-${dir}: ${w}x${h}, idle ${IDLE} + walk ${WALK}`);
}
console.log(`\nNow publish:  npm run sprites\nThen in-game: __lab.playAs("compass") and walk all four ways.`);
