
import { createCanvas, loadImage } from "canvas";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { installSpriteTestDom, SHIPPED_GRID, bufferFor, paintAtlas } from "../src/game/pinball-knight/testkit/atlas-census";
import { censusCell, paletteRgb, declaredSet } from "../src/game/pinball-knight/render/atlas-census";
import { withRecoil } from "../src/game/pinball-knight/render/cel-painter";
import { makeJesterPaints } from "../src/game/pinball-knight/render/monsters/jester";
import { importedPaints } from "../src/game/pinball-knight/render/imported-paints";
import { matte } from "../src/game/pinball-knight/tools/sprite-forge/matte";
import { sliceSheet, equalCells } from "../src/game/pinball-knight/tools/sprite-forge/slice";
import { commitToGrid } from "../src/game/pinball-knight/tools/sprite-forge/commit";
import { detectPixelGrid } from "../src/game/pinball-knight/tools/sprite-forge/grid";

const GRID = 63, Z = 4, OUT = process.env.AB_OUT!, SHEET = process.env.AB_SHEET!;
const undo = installSpriteTestDom();
const pal = paletteRgb();
mkdirSync(OUT, { recursive: true });

const toCanvas = (img: any): any => { const c = createCanvas(img.width, img.height);
  c.getContext("2d").putImageData(img, 0, 0); return c; };
const rawOf = (cv: any): any => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
  return { width: cv.width, height: cv.height, data: d.data }; };

function statsFor(imgs: any[], declared: Set<number>): any {
  const s = imgs.map((im: any) => censusCell(im.data, GRID, pal));
  const mean = (f: (x: any) => number): number => s.reduce((a: number, x: any) => a + f(x), 0) / s.length;
  const union = new Set();
  for (const x of s) for (let i = 0; i < x.counts.length; i++) if (x.counts[i]) union.add(i);
  const invented = [...union].filter((i: number) => declared && !declared.has(i)).length;
  // ON-SCREEN SIZE, which is what actually decided this comparison and which no
  // census column reports. The live sheet renders 36x35 with 815 opaque texels;
  // the committed regen renders 17x38 with 422. A faithful sprite at half the
  // ink loses to an approximate one at full ink, every time.
  let bw = 0, bh = 0, fill = 0;
  for (const im of imgs) {
    let x0 = GRID, y0 = GRID, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++)
      if (im.data[(y * GRID + x) * 4 + 3] > 127) { n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    bw = Math.max(bw, x1 - x0 + 1); bh = Math.max(bh, y1 - y0 + 1); fill += n;
  }
  return { inkW: bw, inkH: bh, opaqueMean: Math.round(fill / imgs.length),
           entries: +mean((x) => x.entries).toFixed(2), isolated: +mean((x) => x.isolatedPct).toFixed(1),
           runLen: +mean((x) => x.runLen).toFixed(2), unionEntries: union.size, invented,
           unmatched: s.reduce((a, x) => a + x.unmatched, 0) };
}

// ── A: the painter, the oracle ──────────────────────────────────────────────
const painted = withRecoil(makeJesterPaints());
const CLIPS = ["idle", "walk"];
const paintedImgs = [];
for (const c of CLIPS) for (const f of (painted.S[c] ?? []).slice(0, 4)) paintedImgs.push(paintAtlas(f, GRID));

// declared set for the painter, off its pre-crush buffer
const PX = bufferFor(GRID);
const declared = new Set();
{
  const { paintInArtSpace } = await import("../src/game/pinball-knight/engine/render/sprite");
  for (const c of CLIPS) for (const f of (painted.S[c] ?? []).slice(0, 4)) {
    const b = createCanvas(PX, PX); const bx = b.getContext("2d");
    paintInArtSpace(bx, f, PX);
    for (const i of declaredSet(bx.getImageData(0, 0, PX, PX).data, pal)) declared.add(i);
  }
}

// ── the import path, shared by every generated arm ──────────────────────────
async function importArm(label: string, _snap: any, sourceCanvas: any, fitGrid?: number, cellCounts?: number[]): Promise<any> {
  const raw = rawOf(sourceCanvas);
  let data = raw.data;
  const clear = (() => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] === 0) n++;
    return n / (data.length / 4); })();
  if (clear < 0.05) {
    const r = matte(data, raw.width, raw.height);
    if (r.report.failures.length) throw new Error(label + ": matte " + r.report.failures.join("/"));
    data = r.data;
  }
  const rows = sliceSheet(data, raw.width, raw.height);
  // The RAW generated sheet auto-slices to [7/19] -- its figures touch and its
  // silhouettes are ragged -- so the caller passes the true per-row counts, the
  // same `cells` override the inbox sidecar carries. Without it half the frames
  // come back as slivers and every number below describes those slivers.
  if (cellCounts) {
    if (rows.length !== cellCounts.length) throw new Error(label + ": sliced " + rows.length + " rows, expected " + cellCounts.length);
    rows.forEach((r: any, i: number) => { r.cells = equalCells(r, cellCounts[i]); });
  }
  const named = rows.map((_: any, i: number) => (i === 0 ? "idle" : "walk"));
  const mrows = rows.map((r: any, i: number) => ({ clip: named[i], cells: r.cells }));
  const c = commitToGrid({ width: raw.width, height: raw.height, data }, mrows, pal,
    { ...(fitGrid ? { fitGrid } : {}) });
  const g = detectPixelGrid(c.image, c.rows.flatMap((r) => r.cells));

  const cv = toCanvas(Object.assign(createCanvas(c.image.width, c.image.height).getContext("2d")
    .createImageData(c.image.width, c.image.height), { data: c.image.data }));
  const cc = createCanvas(c.image.width, c.image.height);
  const ci = cc.getContext("2d").createImageData(c.image.width, c.image.height);
  ci.data.set(c.image.data); cc.getContext("2d").putImageData(ci, 0, 0);
  writeFileSync(join(OUT, `sheet-${label}.png`), cc.toBuffer("image/png"));

  const manifest = { name: "jester", dir: "S", image: "", source: [c.image.width, c.image.height],
    ...(g.gridded ? { grid: g.factor } : {}), rows: c.rows };
  // ── dE(source -> committed): the colour decision, isolated from geometry.
  // The census cannot see this (all three snap modes score within 0.4 entries
  // of each other) because it counts INDICES, not how far each one moved.
  const dE = (() => {
    const lab = (r: number, g: number, b: number): number[] => { const f=(v: number): number =>{const c=v/255;return c>0.04045?((c+0.055)/1.055)**2.4:c/12.92;};
      const R=f(r),G=f(g),B=f(b);
      const X=(0.4124*R+0.3576*G+0.1805*B)/0.95047, Y=0.2126*R+0.7152*G+0.0722*B, Z=(0.0193*R+0.1192*G+0.9505*B)/1.08883;
      const k=(v: number): number =>v>0.008856?Math.cbrt(v):7.787*v+16/116; const fx=k(X),fy=k(Y),fz=k(Z);
      return [116*fy-16,500*(fx-fy),200*(fy-fz)]; };
    let sum=0,n=0;
    for (let ri=0; ri<c.rows.length; ri++) for (let ci=0; ci<c.rows[ri].cells.length; ci++) {
      const src = mrows[ri].cells[ci], dst = c.rows[ri].cells[ci];
      const sw = src[2]-src[0]+1, sh = src[3]-src[1]+1;
      const tw = (dst[2]-dst[0]+1)/c.report.factor, th = (dst[3]-dst[1]+1)/c.report.factor;
      for (let ty=0; ty<th; ty++) for (let tx=0; tx<tw; tx++) {
        const di = ((dst[1]+ty*c.report.factor)*c.image.width + dst[0]+tx*c.report.factor)*4;
        if (c.image.data[di+3] === 0) continue;
        const sx = src[0] + Math.floor((tx+0.5)/tw*sw), sy = src[1] + Math.floor((ty+0.5)/th*sh);
        const si = (sy*raw.width + sx)*4;
        if (data[si+3] <= 127) continue;
        const a = lab(data[si],data[si+1],data[si+2]), b2 = lab(c.image.data[di],c.image.data[di+1],c.image.data[di+2]);
        sum += Math.hypot(a[0]-b2[0], a[1]-b2[1], a[2]-b2[2]); n++;
      }
    }
    return n ? +(sum/n).toFixed(2) : null;
  })();

  const paints = importedPaints([{ manifest, image: cc }]);
  const imgs = [];
  for (const cl of CLIPS) for (const f of (paints?.S?.[cl] ?? []).slice(0, 4)) imgs.push(paintAtlas(f, GRID));
  return { label, imgs, grid: g.verdict, report: c.report, dE, stats: statsFor(imgs, declared) };
}

// ── B: a PERFECT source — the painter's own atlas, ×8, in-palette ───────────
function perfectSheet() {
  const F = 8, PADT = 2, cols = paintedImgs.length;
  const W = (cols * (GRID + PADT) + PADT) * F, H = (GRID + 2 * PADT) * F;
  const cv = createCanvas(W, H); const cx = cv.getContext("2d");
  cx.clearRect(0, 0, W, H); cx.imageSmoothingEnabled = false;
  paintedImgs.forEach((im: any, i: number) => {
    cx.drawImage(toCanvas(im), (PADT + i * (GRID + PADT)) * F, PADT * F, GRID * F, GRID * F);
  });
  return cv;
}

const arms: any[] = [];

// ── LIVE: what the game actually renders TODAY. ─────────────────────────────
//
// The baseline every other arm has to beat, and the first version of this
// harness omitted it -- comparing the painter, the painter round-tripped, and a
// REGENERATED sheet, none of which is on screen. What ships is
// public/sprites/jester-S.png loaded through its OWN manifest, which carries no
// `grid` field, so importedPaints takes the fitted-resample path. No commit, no
// re-slice: the shipped artifact, verbatim.
{
  const mf = JSON.parse(readFileSync("public/sprites/jester-S.json", "utf8"));
  const im = await loadImage("public/sprites/jester-S.png");
  const cv = createCanvas(im.width, im.height);
  cv.getContext("2d").drawImage(im, 0, 0);
  const paints = importedPaints([{ manifest: mf, image: cv as any }]);
  const imgs: any[] = [];
  for (const cl of CLIPS) for (const f of ((paints as any)?.S?.[cl] ?? []).slice(0, 4)) imgs.push(paintAtlas(f, GRID));
  arms.push({ label: "LIVE-ships-today", imgs,
    grid: mf.grid ? ("grid x" + mf.grid) : "no lattice -> fitted resample",
    report: null, dE: null, stats: statsFor(imgs, declared) });
}

arms.push({ label: "A-painted", imgs: paintedImgs, grid: "(painter — no sheet)", report: null,
            stats: statsFor(paintedImgs, declared) });
// The control must not RESIZE. Measure the painter's own ink height and pick
// the fitGrid that reproduces it, or arm B compares a 62-texel figure against a
// 46-texel one and reports the pipeline as catastrophically lossy when the only
// thing that happened was the commit's sizing policy.
const inkH = (() => { let lo = GRID, hi = -1;
  for (const im of paintedImgs) for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++)
    if (im.data[(y * GRID + x) * 4 + 3] > 127) { if (y < lo) lo = y; if (y > hi) hi = y; }
  return hi - lo + 1; })();
const fitB = Math.ceil((inkH * 128) / 110);
console.log("[control] painter ink height " + inkH + " texels -> fitGrid " + fitB + " so the commit preserves it");
arms.push(await importArm("B-perfect-source", "luma", perfectSheet(), fitB));
const gen = await loadImage(SHEET);
const genCv = createCanvas(gen.width, gen.height);
genCv.getContext("2d").drawImage(gen, 0, 0);
arms.push(await importArm("C-gen-committed", "luma", genCv, 0, [8, 8]));

// ── contact strip ───────────────────────────────────────────────────────────
const COLS = Math.max(...arms.map((a: any) => a.imgs.length));
const LABEL = 150, PAD = 6, CELL = GRID * Z, rowH = CELL + PAD + 16;
const cv = createCanvas(LABEL + COLS * (CELL + PAD) + PAD, arms.length * rowH + PAD);
const ctx = cv.getContext("2d");
ctx.fillStyle = "#0b0d12"; ctx.fillRect(0, 0, cv.width, cv.height);
ctx.imageSmoothingEnabled = false;
arms.forEach((a: any, r: number) => {
  const y = PAD + r * rowH;
  ctx.fillStyle = "#c9bfa4"; ctx.font = "13px monospace"; ctx.fillText(a.label, 6, y + 16);
  ctx.fillStyle = "#8a8272"; ctx.font = "10px monospace";
  ctx.fillText(`e ${a.stats.entries}  inv ${a.stats.invented}`, 6, y + 32);
  ctx.fillText(`iso ${a.stats.isolated}%`, 6, y + 46);
  ctx.fillText(`run ${a.stats.runLen}`, 6, y + 60);
  a.imgs.forEach((im: any, c: number) => ctx.drawImage(toCanvas(im), LABEL + c * (CELL + PAD), y, CELL, CELL));
});
writeFileSync(join(OUT, "strip.png"), cv.toBuffer("image/png"));

// ── the decisive diff: does a PERFECT source survive the pipeline? ──────────
//
// ⚠️ ALIGN ON THE INK BBOX FIRST. Painters register by feet-on-GROUND and
// centre-on-CX; imports register by BOUNDING BOX (see register.ts). So the two
// land a texel or two apart and a raw per-texel diff reports ~92% differing for
// a pure translation, which says nothing about colour. Aligning separates
// "the pipeline moved it" from "the pipeline changed it" -- and both are
// reported, because a shift is a real defect, just a different one.
const bbox = (im: any): number[] => { let x0=1e9,y0=1e9,x1=-1,y1=-1;
  for (let y=0;y<GRID;y++) for (let x=0;x<GRID;x++) if (im.data[(y*GRID+x)*4+3]>127) {
    if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  return [x0,y0,x1,y1]; };
const A = arms[0].imgs, B = arms[1].imgs;
let diff = 0, tot = 0, shifts = [];
for (let i = 0; i < Math.min(A.length, B.length); i++) {
  const [ax0,ay0,ax1,ay1] = bbox(A[i]), [bx0,by0,bx1,by1] = bbox(B[i]);
  const dx = bx0-ax0, dy = by0-ay0;
  shifts.push(dx + "," + dy);
  const w = Math.min(ax1-ax0, bx1-bx0) + 1, h = Math.min(ay1-ay0, by1-by0) + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const pa = ((ay0+y)*GRID + ax0+x)*4, pb = ((by0+y)*GRID + bx0+x)*4;
    const oa = A[i].data[pa+3] > 127, ob = B[i].data[pb+3] > 127;
    if (!oa && !ob) continue;
    tot++;
    if (oa!==ob || A[i].data[pa]!==B[i].data[pb] || A[i].data[pa+1]!==B[i].data[pb+1] || A[i].data[pa+2]!==B[i].data[pb+2]) diff++;
  }
}
const roundTrip = { alignedDifferingTexels: diff, ofOpaque: tot,
  pct: +(diff / Math.max(tot,1) * 100).toFixed(2), bboxShifts: [...new Set(shifts)].join(" ") };

const summary = { grid: GRID, roundTrip, arms: arms.map((a: any) => ({ label: a.label, grid: a.grid,
  report: a.report ? { entries: a.report.entries, evicted: a.report.evicted,
  evictedShare: +(a.report.evictedShare*100).toFixed(2), texel: a.report.texelW + "x" + a.report.texelH } : null,
  dE: a.dE ?? null, ...a.stats })) };
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("\\nwrote", join(OUT, "strip.png"));
undo();