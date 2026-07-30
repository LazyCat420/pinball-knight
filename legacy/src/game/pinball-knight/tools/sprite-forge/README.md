# Sprite forge

Drop sprite sheets in `inbox/`, run one command, get scored game-ready frames.

    cp mysheet.png src/game/pinball-knight/tools/sprite-forge/inbox/ratking-E.png
    npm run sprites

Output lands in `work/<name>/` (gitignored): one PNG per frame at the atlas
grid, `preview.png` (nearest-upscaled, so it shows atlas truth rather than a
flattering smooth preview), and `work/report.txt` — vitest swallows console
output, so the report is written to disk.

No network, no API key, no Python. It shares the game's real palette, real
crush and real census, so what it reports is what will ship.

## The stages

| file | job |
|---|---|
| `matte.ts` | opaque background → alpha, by flood fill from the border |
| `slice.ts` | matted sheet → rows of cells |
| `register.ts` | cell → the painters' contract, then the real crush |
| `labels.ts` | row → clip name |
| `inbox.test.ts` | the node edge: finds files, decodes, writes output |
| `fixtures.ts` | synthetic sheets for the tests |

Everything except `inbox.test.ts` is pure — pixels in, pixels out, no
filesystem and no node-canvas — so a browser tool can drive the same code.

## Naming

    ratking-E.png    creature "ratking", facing E (true side profile)
    ratking-S.png    facing S (toward camera).  N = away.
    ratking.png      facing E, the default

W is never authored — the engine draws it as E with a negative texture repeat.

## The sidecar — one line, and usually only one

    tools/sprite-forge/inbox/ratking-E.json
    { "rows": ["idle", "attack", "walk", "stumble", "death"] }

`rows` names each row's clip, in reading order. Those names have to be clips the
animator packs — note that **stagger is `stumble`, not `hurt`**, which is what
every reference sheet prints above that row.

Run it once without a sidecar: it reports the rows it found and prints the
sidecar for you to fill in.

`cells` (a per-row frame count) is an OVERRIDE and you should not normally need
it. It used to be mandatory on a ruled sheet, because slicing returned
5/12/5/2/1 where the truth was 4/6/4/2/3 — but that was two defects in the
slicer, not a property of sheets. Fixed. All six layouts in `slice.test.ts`
(ruled, unruled, shared borders, gutters, indented rows, touching figures) now
slice to the true counts with no override. Reach for `cells` only when two poses
genuinely touch with no gap between them, which no threshold can recover.

## What a sheet must be

- **Transparent background.** This is the one hard requirement and the one an
  AI generator will not meet: diffusion models have no alpha channel, so every
  generated sheet arrives on an opaque white or cream field and slices into a
  single cell. Key it out first.
- **One body scale across every frame**, and feet on a consistent line. Frames
  are registered by bounding box, so debris below the feet lifts the character
  and an off-centre effect shifts the body the other way.
- **No labels in a left gutter.** Captions under a row are detected and dropped;
  a label beside a row shares that row's band, defeats the caption test, clears
  the fragment filter, and imports as a frame.

## Known limits

- **Sheets are judged, not adopted.** Frames are written and scored; nothing in
  the game loads them yet — monsters are still painter functions. Wiring an
  image-backed painter is the next step.
- The verdict compares against the painted roster (entries 20.1 / isolated
  22.5% / runLen 1.82). Imported art is inherently a little noisier: a painter
  re-rasterises vectors at the target size, an image can only be resampled.
