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
import { ART_BOX, artScale, cellPlacement, type SheetManifest } from "../tools/sprite-forge/manifest";
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
    const res = await fetch(`/sprites/${name}-${dir}.json`);
    if (!res.ok) return null;
    const manifest = (await res.json()) as SheetManifest;
    const image = await decode(manifest.image);
    if (!image) return null;
    // A re-export at a different size would silently shift every cell rect.
    const [w, h] = manifest.source;
    if (image.width !== w || image.height !== h) {
      console.warn(
        `[dungeon] ${name}-${dir}: sheet is ${image.width}x${image.height} but the manifest ` +
          `measured ${w}x${h}. Re-run \`npm run sprites\`. Falling back to the painter.`,
      );
      return null;
    }
    return { manifest, image };
  } catch {
    return null;
  }
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
 * One cell as a `FramePaint`.
 *
 * `imageSmoothingEnabled` is left ON, matching what `paintInArtSpace` sets and
 * what the forge's own preview path does. It is not a fidelity choice — the
 * crush that follows is a hard palette snap at a lower resolution, so this blit
 * is a downscale into a supersampled buffer, exactly like a painter's curves.
 * Turning it off here would alias the source before the crush ever sees it.
 */
function cellPaint(image: CanvasImageSource, cell: readonly number[], k: number): FramePaint {
  const p = cellPlacement(cell as [number, number, number, number], k);
  return (ctx) => {
    ctx.drawImage(image, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
  };
}

/**
 * Clip name → frames, for one authored facing.
 *
 * Rows whose clip is not a real `ClipName` (`row0`, or a sidecar typo like
 * `hurt` where the engine says `stumble`) are dropped with a warning rather
 * than packed under a name nothing plays. A silently unused clip is how you end
 * up with an actor that has no stagger and no error to explain it.
 */
function clipsFor(sheet: ImportedSheet, known: ReadonlySet<string>): Partial<Record<ClipName, FramePaint[]>> {
  const all = sheet.manifest.rows.flatMap((r) => r.cells);
  if (!all.length) return {};
  const k = artScale(all);
  const out: Partial<Record<ClipName, FramePaint[]>> = {};
  for (const row of sheet.manifest.rows) {
    if (!known.has(row.clip)) {
      console.warn(`[dungeon] ${sheet.manifest.name}: row "${row.clip}" is not a ClipName — dropped.`);
      continue;
    }
    out[row.clip as ClipName] = row.cells.map((c) => cellPaint(sheet.image, c, k));
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
  "idle", "walk", "run", "attack", "death", "crouch", "wait", "wake", "stumble",
]);

/**
 * Imported sheets → `ActorPaints`, or `null` if there is nothing playable.
 *
 * `idle` is required: it is what `withRecoil` derives the stagger and wake
 * frames from, and what the animator falls back to for any clip an actor does
 * not author. A sheet without one is not a monster, it is a pile of frames.
 */
export function importedPaints(sheets: readonly ImportedSheet[]): ActorPaints | null {
  const byDir = new Map<Dir, Partial<Record<ClipName, FramePaint[]>>>();
  for (const s of sheets) {
    const clips = clipsFor(s, PLAYABLE as ReadonlySet<string>);
    if (Object.keys(clips).length) byDir.set(s.manifest.dir, clips);
  }
  if (!byDir.size) return null;

  // A sheet authors one facing; the others reuse it BY REFERENCE, which also
  // means the atlas packs them once instead of three times (startSpriteSheet
  // dedupes on FramePaint identity).
  const fallback = byDir.get("S") ?? byDir.get("E") ?? byDir.get("N");
  if (!fallback?.idle?.length) return null;
  const pick = (d: Dir): Partial<Record<ClipName, FramePaint[]>> => byDir.get(d) ?? fallback;
  return { S: pick("S"), N: pick("N"), E: pick("E") };
}

/** Which facings a creature actually authored — for the boot log. */
export function authoredDirs(sheets: readonly ImportedSheet[]): Dir[] {
  return sheets.map((s) => s.manifest.dir);
}
