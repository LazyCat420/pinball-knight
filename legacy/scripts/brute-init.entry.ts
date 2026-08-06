/**
 * Render the PAINTED brute's own frames into per-clip rows, on the magenta key.
 *
 * This is the init the forge measurement asked for. `docs/POSE_IS_THE_LATENT.md`
 * proved the sampler takes pose AND silhouette from the latent and will invent
 * neither — so the init has to arrive already carrying both. The painter is
 * exactly that source: correct brute proportions, and poses an animator wrote,
 * for free and at any resolution (it draws in art space, so a bigger grid is a
 * cleaner upscale rather than a blur).
 *
 * Out: one PNG per clip, cells laid left to right, figures on one baseline
 * because every cell is the painter's own square buffer.
 */
import { createCanvas } from "canvas";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { installSpriteTestDom, paintBuffer } from "../src/game/pinball-knight/testkit/atlas-census";
import { makeBrutePaints } from "../src/game/pinball-knight/render/cel-painter";
import type { Dir } from "../src/game/pinball-knight/engine/render/paint-types";

const OUT = process.env.BRUTE_OUT!;
const GRID = Number(process.env.BRUTE_GRID ?? 256);
const DIR = (process.env.BRUTE_DIR ?? "E") as Dir;

const undo = installSpriteTestDom();
mkdirSync(OUT, { recursive: true });

const paints = makeBrutePaints();
const clips = paints[DIR] as Record<string, unknown>;
const px = GRID * 2;
const manifest: Array<{ clip: string; cells: number; file: string }> = [];

for (const [clip, frames] of Object.entries(clips)) {
  const list = frames as Array<(ctx: CanvasRenderingContext2D) => void>;
  if (!Array.isArray(list) || list.length === 0) continue;
  const row = createCanvas(px * list.length, px);
  const rctx = row.getContext("2d");
  rctx.imageSmoothingEnabled = false;
  // The key prep/prep-sheet.mjs looks for. Filled first so the transparent
  // margin around each figure becomes chroma rather than black.
  rctx.fillStyle = "#ff00ff";
  rctx.fillRect(0, 0, row.width, row.height);

  list.forEach((f, i) => {
    const data = paintBuffer(f, GRID);
    // putImageData would STAMP the frame's transparent pixels over the key.
    // Going through a scratch canvas and drawImage composites alpha instead.
    const cell = createCanvas(px, px);
    (cell.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(data, 0, 0);
    rctx.drawImage(cell as unknown as HTMLCanvasElement, i * px, 0);
  });

  const file = join(OUT, `${clip}.png`);
  writeFileSync(file, row.toBuffer("image/png"));
  manifest.push({ clip, cells: list.length, file });
  console.log(`${clip.padEnd(6)} ${list.length} cells  ${row.width}x${row.height}  -> ${file}`);
}

writeFileSync(join(OUT, "clips.json"), JSON.stringify(manifest, null, 1));
undo();
