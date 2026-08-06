/**
 * IMPORTED ART, entering through the painters' door.
 *
 * A `FramePaint` is `(ctx: CanvasRenderingContext2D) => void` drawing in the
 * 128-unit art box. A painter fills that box with vectors; this fills it with
 * one `drawImage` from a matted sheet. Everything downstream — the palette
 * crush, the 20-entry lock, `withRecoil`'s stagger frames, cross-facing dedupe,
 * atlas packing, the animator — cannot tell the difference and does not need to.
 *
 * That equivalence is the whole design. The alternative, a parallel renderer
 * fed by pre-baked atlases, would have to re-implement all of it AND would be
 * wrong at four of the five camera rungs (see `manifest.ts`).
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * It does not invent facings. A sheet authors one direction; the other two
 * reuse it, and the report says so. Generating a plausible N from an S is the
 * kind of thing that looks like a feature until a player walks away from the
 * camera and the creature is still staring at them.
 */
import { ART_BOX, aliveScale, cellPlacement, cellScale, fitsArtBox, oneToOneScale, type SheetManifest } from "../tools/sprite-forge/manifest";
import { blockReduce } from "../tools/sprite-forge/grid";
import { resampleCell, upscaleExact, type ResampleStrategy } from "../tools/sprite-forge/resample";
import { SPRITE_PIXEL_GRID } from "../constants";
import type { ActorPaints, ClipName, Dir, FramePaint } from "../engine/render/paint-types";

/** A decoded sheet plus the rects that cut it up. */
export interface ImportedSheet {
  manifest: SheetManifest;
  image: CanvasImageSource;
}

/**
 * Fetch a manifest and its matted sheet.
 *
 * Resolves to `null` on ANY failure — missing file, bad JSON, a decode error,
 * or a sheet whose dimensions no longer match what the forge measured. The
 * caller falls back to the procedural painter, because a monster that renders
 * as its hand-painted self is a far better outcome than one that throws during
 * atlas construction and takes the floor down with it.
 */
export async function loadImportedSheet(name: string, dir: Dir): Promise<ImportedSheet | null> {
  try {
    let res = await fetch(`/sprites/${name}-${dir}.json`);
    if (!res.ok) {
      res = await fetch(`./sprites/${name}-${dir}.json`);
    }
    if (!res.ok) return null;
    const manifest = (await res.json()) as SheetManifest;
    const image = await decode(versioned(manifest));
    if (!image) return null;
    // A re-export at a different size would silently shift every cell rect.
    const [w, h] = manifest.source;
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;
    if (Math.abs(imgW - w) > 2 || Math.abs(imgH - h) > 2) {
      console.warn(
        `[dungeon] ${name}-${dir}: sheet is ${imgW}x${imgH} but the manifest ` +
          `measured ${w}x${h}. Re-run \`npm run sprites\`. Falling back to the painter.`,
      );
      return null;
    }
    return { manifest, image };
  } catch {
    return null;
  }
}

/**
 * THE IMAGE URL, VERSIONED BY ITS OWN MANIFEST — so a cached PNG can never
 * outlive the sidecar that describes it.
 *
 * ── THE BUG THIS EXISTS FOR, MEASURED IN PRODUCTION ─────────────────────────
 *
 * The two halves of a sheet are served with OPPOSITE caching policies:
 *
 *     /sprites/x-S.json   no-cache, no-store, must-revalidate
 *     /sprites/x-S.png    public, max-age=86400, stale-while-revalidate=604800
 *
 * So after a sheet is republished at a new size, a returning browser holds a
 * FRESH manifest and a STALE image — for a day by max-age, and for a further
 * week under stale-while-revalidate. The size check below then does exactly
 * what it was written to do, and the character silently reverts to the painter.
 * Observed live on `mario-S`: manifest 197x352, cached PNG 116x304.
 *
 * The check is right; it was just the only line of defence, and it can only
 * detect the mismatch after it has already happened. Putting a version in the
 * URL means the stale entry is never consulted: the manifest is uncacheable, so
 * whatever it names is by definition current, and a republished PNG is a
 * different URL rather than the same one with different bytes.
 *
 * `hash` when the publisher wrote one (it covers a re-export at the SAME size,
 * which the dimensions cannot see), falling back to the dimensions so every
 * sheet published before this — jester, beaver, frog, fish_feet, zombie,
 * stiltneck, pinball_knight — is protected without being re-exported first.
 */
export function versioned(m: SheetManifest): string {
  const tag = m.hash ?? `${m.source[0]}x${m.source[1]}`;
  return `${m.image}${m.image.includes("?") ? "&" : "?"}v=${tag}`;
}

function decode(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * The strategy imported cells resample with. `kcentroid` won the three-way
 * measured in `resample.ts`'s header; `scripts/sandbox.mjs cel` renders all
 * three side by side if that ever needs re-litigating.
 *
 * `bilinear` is not a strategy anyone should ship — it is the pre-fix
 * one-hop `drawImage` path, kept ONLY so the sandbox can render "what the
 * game used to do" next to the alternatives without re-implementing it (a
 * harness that restates the code it compares against only tests itself).
 */
export type ImportFilter = ResampleStrategy | "bilinear";

const STRATEGY: ImportFilter = "kcentroid";

/**
 * One cell as a `FramePaint`.
 *
 * ── WHY NOT ONE `drawImage` ────────────────────────────────────────────────
 * This used to hand the browser the whole scale in a single smoothed blit.
 * At the 2.5-3× downscales a sheet arrives at, bilinear samples a 2×2
 * neighbourhood and SKIPS most of the source — the mush the census measured
 * as isolated 46%. The cell is now resampled ONCE per destination size by
 * `resampleCell` (premultiplied area coverage + per-texel k-centroid) and
 * cached; what `drawImage` gets afterwards is a ~1:1 blit.
 *
 * The blit stays in ART UNITS under the CURRENT transform rather than
 * resetting to identity, because `withRecoil`'s stagger frames run this paint
 * under a rotation — an identity blit would draw the recoil axis-aligned. The
 * sub-pixel translation that leaves is the only browser resample left, and the
 * crush's own box filter absorbs it.
 *
 * The cel buffer's size comes from `ctx.canvas.width`: `paintInArtSpace` maps
 * the whole `ART_BOX` onto the whole buffer, so the buffer edge IS the art
 * box edge at device scale. Reading the transform instead would double-count
 * the stagger rotation.
 */
function cellPaint(
  image: CanvasImageSource,
  cell: readonly number[],
  k: number,
  cels: Map<string, HTMLCanvasElement>,
  gridN: number,
  filter: ImportFilter,
  atlasGrid: number,
  mirror: boolean,
): FramePaint {
  const p = cellPlacement(cell as [number, number, number, number], k);
  if (filter === "bilinear") {
    // The pre-fix path, verbatim — one smoothed drawImage. Sandbox-only.
    return (ctx) => {
      if (!mirror) {
        ctx.drawImage(image, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
        return;
      }
      ctx.save();
      ctx.translate(ART_BOX, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(image, p.sx, p.sy, p.sw, p.sh, ART_BOX - p.dx - p.dw, p.dy, p.dw, p.dh);
      ctx.restore();
    };
  }
  return (ctx) => {
    const unit = ctx.canvas.width / ART_BOX;
    const dw = Math.max(1, Math.round(p.dw * unit));
    const dh = Math.max(1, Math.round(p.dh * unit));
    const key = `${p.sx},${p.sy},${dw}x${dh}:${gridN > 1 ? `block${gridN}` : filter}${mirror ? ":m" : ""}`;
    let cel = cels.get(key);
    if (!cel) {
      const built = buildCel(image, p, dw, dh, filter, gridN);
      cel = mirror ? flipCel(built) : built;
      cels.set(key, cel);
    }
    // ⚠️ ALIGN THE ORIGIN TO THE CRUSH'S OWN STRIDE — the runtime twin of
    // `register.ts`'s snap, and it was missing here. `cellPlacement` puts the
    // feet at `ART_GROUND` (118), which in device space is `2.765625 × PPU`:
    // a FRACTIONAL row at four of the five camera rungs (.875 of a pixel at
    // the default), and centring can land X on an ODD device pixel while the
    // crush averages 2×2 windows anchored at 0. Either way every authored
    // pixel straddles a window boundary and the box filter smears it across
    // two texels — measured as the imported knight arriving soft while the
    // forge's own preview of the same sheet was crisp. Snapping costs at most
    // half a texel of position, which the eye cannot see, and buys back the
    // texel identity the whole import path exists for. The snap is in ART
    // units derived from device space, so it composes with `withRecoil`'s
    // rotated stagger transform (where alignment is moot but harmless).
    const stride = ctx.canvas.width / atlasGrid;
    let dx = p.dx;
    let dy = p.dy;
    if (Number.isInteger(stride) && stride >= 1) {
      dx = (Math.round((p.dx * unit) / stride) * stride) / unit;
      dy = (Math.round((p.dy * unit) / stride) * stride) / unit;
    }
    ctx.drawImage(cel, dx, dy, dw / unit, dh / unit);
  };
}

/**
 * A horizontally mirrored copy of a cel, flipped ONCE at build time.
 *
 * The cel is cached, so paying the flip here instead of a per-frame transform
 * keeps the paint itself a plain blit — and keeps the snap-to-stride logic in
 * `cellPaint` working on ordinary positive coordinates.
 */
function flipCel(cel: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = cel.width;
  out.height = cel.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("[dungeon] no 2D context for the mirrored cel");
  ctx.translate(cel.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(cel, 0, 0);
  return out;
}

/** Cut the source cell 1:1, resample it properly, hand back a device-px cel. */
function buildCel(
  image: CanvasImageSource,
  p: { sx: number; sy: number; sw: number; sh: number },
  dw: number,
  dh: number,
  strategy: ResampleStrategy,
  gridN: number,
): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.width = p.sw;
  src.height = p.sh;
  // willReadFrequently: this canvas exists to be read straight back — without
  // the hint the readback is a GPU stall (see crushableContext in the engine).
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("[dungeon] no 2D context for the import cel");
  sctx.drawImage(image, p.sx, p.sy, p.sw, p.sh, 0, 0, p.sw, p.sh);
  const pixels = sctx.getImageData(0, 0, p.sw, p.sh);
  // EXACT when the lattice is real and the destination is a whole multiple of
  // its reduction: each N×N block collapses to the one authored pixel it
  // already was, then replicates up to the cel's supersample resolution by
  // whole blocks, and the crush's box filter collapses those exactly back.
  //
  // ⚠️ `dw` is in SUPERSAMPLE device px — the cel buffer is `SPRITE_PX`, which
  // is 2 × the atlas grid — so the texel count is `dw / up`, not `dw`. The old
  // check compared `p.sw / gridN` (texels) against `dw` (2 × texels) and could
  // never be true: every committed sheet silently took the k-centroid resample
  // it was committed to avoid, and the "1:1 import" was a 4:1 kcentroid plus a
  // 2:1 box. `blockReduce` floors, so a cell whose extent is not a whole
  // number of blocks stays on the resample path rather than cropping art off
  // the edge of a creature.
  const tw = Math.round(p.sw / gridN);
  const th = Math.round(p.sh / gridN);
  const up = gridN > 1 && tw > 0 && th > 0 && dw % tw === 0 && dw / tw === dh / th ? dw / tw : 0;
  const reducible = up >= 1 && p.sw === tw * gridN && p.sh === th * gridN;
  const out = reducible
    ? upscaleExact(blockReduce(pixels, gridN, p.sx % gridN, p.sy % gridN), up)
    : resampleCell(pixels, dw, dh, strategy);
  const cel = document.createElement("canvas");
  cel.width = dw;
  cel.height = dh;
  const cctx = cel.getContext("2d");
  if (!cctx) throw new Error("[dungeon] no 2D context for the import cel");
  // Through createImageData rather than an ImageData constructor: node has no
  // ImageData global, and this path runs under the node test harness too.
  const img = cctx.createImageData(dw, dh);
  img.data.set(out.data);
  cctx.putImageData(img, 0, 0);
  return cel;
}

/**
 * Clip name → frames, for one authored facing.
 *
 * Rows whose clip is not a real `ClipName` (`row0`, or a sidecar typo like
 * `hurt` where the engine says `stumble`) are dropped with a warning rather
 * than packed under a name nothing plays. A silently unused clip is how you end
 * up with an actor that has no stagger and no error to explain it.
 */
function clipsFor(
  sheet: ImportedSheet,
  known: ReadonlySet<string>,
  filter: ImportFilter,
  atlasGrid: number,
): Partial<Record<ClipName, FramePaint[]>> {
  const all = sheet.manifest.rows.flatMap((r) => r.cells);
  if (!all.length) return {};
  // ── THE SCALE: DERIVED WHEN THE SHEET HAS A LATTICE, FITTED WHEN IT DOES NOT ──
  //
  // A gridded sheet gets `oneToOneScale`, which puts exactly one authored pixel
  // on one atlas texel — the whole point of the gate. It is only honoured if the
  // figure still FITS the cel at that scale, because shrinking it to fit would
  // silently give the 1:1 property back, and a sheet authored at the wrong size
  // has to be re-authored rather than quietly resampled.
  //
  // Everything else keeps the old behaviour: the LIVING clips set the scale and
  // a death sprawl only clamps its own frames (artScale-over-everything let the
  // jester's flat sprawl shrink the walking jester to 58% of its box).
  const alive = sheet.manifest.rows.filter((r) => r.clip !== "death").flatMap((r) => r.cells);
  const gridN = sheet.manifest.grid ?? 1;
  const oneToOne = gridN > 1 ? oneToOneScale(gridN, atlasGrid) : 0;
  const exact = oneToOne > 0 && fitsArtBox(alive.length ? alive : sheet.manifest.rows.flatMap((r) => r.cells), oneToOne);
  if (oneToOne > 0 && !exact) {
    console.warn(
      `[dungeon] ${sheet.manifest.name}: has a ×${gridN} pixel grid but is too large to import 1:1 at ` +
        `atlas ${atlasGrid} — falling back to a fitted resample. Re-author the sheet smaller to keep 1:1.`,
    );
  }
  const baseK = exact ? oneToOne : aliveScale(sheet.manifest.rows);
  // Apply the manifest's scale multiplier only on the resampled path —
  // gridded 1:1 sheets must not be rescaled or the pixel-perfect guarantee breaks.
  const k = exact ? baseK : baseK * (sheet.manifest.scale ?? 1.0);
  // Resampled-cel cache, shared across the sheet: three facings reuse the same
  // FramePaints by reference, but distinct camera-rung buffers (tests drive
  // several) land distinct entries, keyed by destination size.
  const cels = new Map<string, HTMLCanvasElement>();
  const out: Partial<Record<ClipName, FramePaint[]>> = {};
  for (const row of sheet.manifest.rows) {
    if (!known.has(row.clip)) {
      console.warn(`[dungeon] ${sheet.manifest.name}: row "${row.clip}" is not a ClipName — dropped.`);
      continue;
    }
    // APPENDED, not assigned. A long clip is routinely authored as two rows of
    // four rather than one row of eight — the sheet is only so wide. Assigning
    // made the second row silently REPLACE the first, so an eight-frame attack
    // imported as its back half and half the sheet was packed but unreachable.
    const frames = row.cells.map((c) =>
      cellPaint(
        sheet.image, c, exact ? k : cellScale(c, k), cels, exact ? gridN : 0, filter, atlasGrid,
        sheet.manifest.mirror === true,
      ),
    );
    out[row.clip as ClipName] = [...(out[row.clip as ClipName] ?? []), ...frames];
  }
  return out;
}

/**
 * The clips an imported sheet is allowed to name.
 *
 * Typed against `ClipName` so a name the animator cannot play is a compile
 * error here rather than a silently missing animation at runtime.
 */
const PLAYABLE: ReadonlySet<ClipName> = new Set<ClipName>([
  "idle", "walk", "run", "attack", "death", "crouch", "wait", "wake", "stumble", "roll", "ball",
]);

/**
 * Imported sheets → `ActorPaints`, or `null` if there is nothing playable.
 *
 * `idle` is required: it is what `withRecoil` derives the stagger and wake
 * frames from, and what the animator falls back to for any clip an actor does
 * not author. A sheet without one is not a monster, it is a pile of frames.
 */
export function importedPaints(
  sheets: readonly ImportedSheet[],
  filter: ImportFilter = STRATEGY,
  atlasGrid: number = SPRITE_PIXEL_GRID,
): ActorPaints | null {
  const byDir = new Map<Dir, Partial<Record<ClipName, FramePaint[]>>>();
  for (const s of sheets) {
    const clips = clipsFor(s, PLAYABLE as ReadonlySet<string>, filter, atlasGrid);
    if (Object.keys(clips).length) byDir.set(s.manifest.dir, clips);
  }
  if (!byDir.size) return null;

  // A sheet authors one facing; the others reuse it BY REFERENCE, which also
  // means the atlas packs them once instead of three times (startSpriteSheet
  // dedupes on FramePaint identity).
  //
  // The fallback is the first facing that HAS an idle, not simply S. Facings
  // are authored at different times and a sheet is allowed to be partial: when
  // stiltneck's S held only walk/attack/stumble/death and its E held the idle,
  // picking S blindly returned null here and the creature's whole import — both
  // sheets — was dropped for a clip one of them authored.
  const ORDER: Dir[] = ["S", "E", "N"];
  const fallback = ORDER.map((d) => byDir.get(d)).find((c) => c?.idle?.length);
  if (!fallback) return null;
  // MERGED per facing rather than chosen: a facing that authors some clips
  // keeps them and borrows the rest. Replacing wholesale is how the player's
  // ride clips came back empty (see render/knight-sheets.ts) — the animator
  // bails on an empty clip, so a partial facing froze instead of degrading.
  const pick = (d: Dir): Partial<Record<ClipName, FramePaint[]>> => {
    const own = byDir.get(d);
    return own ? { ...fallback, ...own } : fallback;
  };
  return { S: pick("S"), N: pick("N"), E: pick("E") };
}

/**
 * The union of every loaded sheet's own palette, or `undefined` if none declared one.
 *
 * UNION, because a creature's three facings are three sheets committed
 * INDEPENDENTLY and each clustered its own colours — the S sheet's armour grey
 * and the N sheet's armour grey are two different bytes. They all land in one
 * atlas, so the snap has to be offered all of them; anything less and a facing
 * gets re-quantised onto another facing's palette, which is the same "the
 * creature changes colour when he turns" defect the scale vote produced on the
 * size axis.
 *
 * Deduped on the packed RGB so three facings that agree cost one entry.
 */
export function sheetPalette(sheets: readonly ImportedSheet[]): number[][] | undefined {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const s of sheets) {
    for (const hex of s.manifest.palette ?? []) {
      const h = hex.replace("#", "");
      const rgb = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      if (rgb.some((v) => Number.isNaN(v))) continue;
      const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rgb);
    }
  }
  return out.length ? out : undefined;
}

/** Which facings a creature actually authored — for the boot log. */
export function authoredDirs(sheets: readonly ImportedSheet[]): Dir[] {
  return sheets.map((s) => s.manifest.dir);
}
