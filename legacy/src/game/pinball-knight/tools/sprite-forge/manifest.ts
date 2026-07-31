/**
 * THE HANDOFF between the forge and the game.
 *
 * The forge does the work that is deterministic and expensive — keying the
 * background, finding the cells — and writes the result next to a MATTED copy
 * of the sheet. The game does the work that depends on the player's settings:
 * scaling each cell into the painters' art box and crushing it to whatever
 * atlas grid the live camera rung implies.
 *
 * ── WHY THE GAME IS NOT HANDED FINISHED FRAMES ──────────────────────────────
 *
 * Because there is no such thing as a finished frame here. `SPRITE_PIXEL_GRID`
 * is `PPU * 9/8` and `CAMERA_ZOOMS` runs {close 80, normal 72, wide 64, wider
 * 56, widest 48}, so the atlas cell is 90, 81, 72, 63 or 54 texels depending on
 * a setting resolved from localStorage at module load. A baked 63px atlas is
 * wrong at four of the five, and rescaling pixel art by 63/90 destroys it.
 *
 * So the shipped artifact is the SOURCE at full resolution, and the crush
 * happens at runtime — which is exactly what a painter does. An imported frame
 * enters through the same door as a painted one (`FramePaint`), so palette
 * locking, `withRecoil`, cross-facing dedupe and atlas packing all apply to it
 * without knowing it came from an image.
 */
import type { Cell } from "./slice";

/** A row of the source sheet, and the clip it plays as. */
export interface ManifestRow {
  /** A `ClipName` when the sidecar named one, else `row0`, `row1`, … */
  clip: string;
  cells: Cell[];
}

export interface SheetManifest {
  /** Creature id — matches the `SheetKey` it reskins. */
  name: string;
  /** The facing this sheet authors. Only `S`, `N` and `E` are ever authored. */
  dir: "S" | "N" | "E";
  /** Path under `public/`, e.g. `/sprites/jester-S.png`. Already matted. */
  image: string;
  /** Source pixel dimensions, so a mismatched re-export is caught on load. */
  source: [number, number];
  rows: ManifestRow[];
}

/** The painters' cel box. Mirrors `ART_PX` — see `constants/render.ts`. */
export const ART_BOX = 128;
/** Feet line and horizontal centre inside that box. Mirrors `figure.ts`. */
export const ART_GROUND = 118;
/** The box an imported figure may fill. Mirrors `register.ts`. */
export const ART_FIT_W = 108;
export const ART_FIT_H = 110;

/**
 * ONE uniform scale for the whole sheet, in ART UNITS.
 *
 * Deliberately not per-cell: scaling every frame to its own extent makes the
 * flipbook pulse, because a crouched pose would inflate to a standing one's
 * height. The sheet's most extreme frame sets the scale and every other frame
 * pays for it — which is why an extended spring or a projectile still attached
 * to the actor costs the whole creature size.
 */
export function artScale(cells: readonly Cell[]): number {
  const maxW = Math.max(...cells.map(([x0, , x1]) => x1 - x0 + 1));
  const maxH = Math.max(...cells.map(([, y0, , y1]) => y1 - y0 + 1));
  return Math.min(ART_FIT_W / maxW, ART_FIT_H / maxH);
}

/**
 * Where one cell lands in the art box: centred on its own ink, feet on GROUND.
 *
 * ⚠️ REGISTRATION IS BY BOUNDING BOX. Correct for a grounded pose, wrong in two
 * ways the art has to avoid: debris below the feet lifts the character off the
 * floor, and an asymmetric effect — a disc leaving to the right — moves the
 * bbox centre so the BODY shifts the other way. Both read as the sprite popping
 * between frames.
 */
export function cellPlacement(cell: Cell, k: number): {
  sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number;
} {
  const [x0, y0, x1, y1] = cell;
  const sw = x1 - x0 + 1;
  const sh = y1 - y0 + 1;
  return {
    sx: x0, sy: y0, sw, sh,
    dx: (ART_BOX - sw * k) / 2, dy: ART_GROUND - sh * k, dw: sw * k, dh: sh * k,
  };
}
