/**
 * BEFORE / AFTER for the locomotion vote, both imported creatures, real crush.
 * "before" reproduces the old rule (everything but death votes) by feeding a
 * manifest whose transient clips are renamed to locomotion names, so they vote
 * again — the scale maths is identical to what shipped.
 */
import { createCanvas, loadImage } from "canvas";
import { writeFileSync, readFileSync } from "node:fs";
import { installSpriteTestDom, paintAtlas } from "../src/game/pinball-knight/testkit/atlas-census";
import { censusCell, paletteRgb } from "../src/game/pinball-knight/render/atlas-census";
import { importedPaints } from "../src/game/pinball-knight/render/imported-paints";

const GRID = 63, Z = 5;
const undo = installSpriteTestDom();
const pal = paletteRgb();
const LOCO = new Set(["idle", "walk", "run"]);

async function sheet(name: string) {
  const mf = JSON.parse(readFileSync(`public/sprites/${name}-S.json`, "utf8"));
  const img = await loadImage(`public/sprites/${name}-S.png`);
  const cv = createCanvas(img.width, img.height);
  cv.getContext("2d").drawImage(img, 0, 0);
  return { mf, cv };
}

function arm(mf: any, cv: any) {
  const p = importedPaints([{ manifest: mf, image: cv }]);
  const S: any = (p as any)?.S ?? {};
  const imgs: any[] = [];
  // IDLE ONLY. The "before" arm renames transients to walk so they vote again,
  // which means S.walk holds attack frames too — comparing it would measure a
  // different pose, not a different scale. idle exists untouched in both arms.
  for (const f of (S.idle ?? []).slice(0, 6)) imgs.push(paintAtlas(f, GRID));
  let h = 0, ink = 0;
  for (const im of imgs) {
    let y0 = GRID, y1 = -1, n = 0;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++)
      if (im.data[(y * GRID + x) * 4 + 3] > 127) { n++; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    h = Math.max(h, y1 - y0 + 1); ink += n;
  }
  const st = imgs.map((im) => censusCell(im.data, GRID, pal));
  return { imgs, h, ink: Math.round(ink / imgs.length),
           entries: +(st.reduce((a, s) => a + s.entries, 0) / st.length).toFixed(1) };
}

const rows: { label: string; a: any; b: any }[] = [];
for (const name of ["jester", "beaver"]) {
  const { mf, cv } = await sheet(name);
  // OLD rule: let every non-death clip vote again by naming them all "walk".
  const old = { ...mf, rows: mf.rows.map((r: any) => (r.clip === "death" ? r : { ...r, clip: LOCO.has(r.clip) ? r.clip : "walk" })) };
  rows.push({ label: name, a: arm(old, cv), b: arm(mf, cv) });
}

console.log(`${"creature".padEnd(10)}${"before".padStart(22)}${"after".padStart(22)}${"gain".padStart(10)}`);
for (const r of rows)
  console.log(`${r.label.padEnd(10)}${`${r.a.h}tex ${r.a.ink}ink`.padStart(22)}${`${r.b.h}tex ${r.b.ink}ink`.padStart(22)}` +
              `${`+${((r.b.ink / r.a.ink - 1) * 100).toFixed(0)}% ink`.padStart(10)}`);

const COLS = 6, CELL = GRID * Z, PAD = 6, LBL = 150;
const H = rows.length * 2 * (CELL + PAD + 16) + PAD;
const out = createCanvas(LBL + COLS * (CELL + PAD) + PAD, H);
const ctx = out.getContext("2d");
ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, out.width, out.height);
ctx.imageSmoothingEnabled = false;
let y = PAD;
for (const r of rows) {
  for (const [tag, a] of [["BEFORE", r.a], ["AFTER", r.b]] as const) {
    ctx.fillStyle = tag === "AFTER" ? "#8fc46b" : "#8a8272"; ctx.font = "13px monospace";
    ctx.fillText(`${r.label} ${tag}`, 6, y + 16);
    ctx.fillStyle = "#8a8272"; ctx.font = "11px monospace";
    ctx.fillText(`${a.h} texels`, 6, y + 34);
    ctx.fillText(`${a.ink} opaque`, 6, y + 50);
    a.imgs.slice(0, COLS).forEach((im: any, c: number) => {
      const t = createCanvas(GRID, GRID);
      t.getContext("2d").putImageData(im, 0, 0);
      ctx.drawImage(t, LBL + c * (CELL + PAD), y, CELL, CELL);
    });
    y += CELL + PAD + 16;
  }
}
writeFileSync(process.env.OUT || "scratchpad/loco.png", out.toBuffer("image/png"));
console.log("wrote " + (process.env.OUT || "scratchpad/loco.png"));
undo();
