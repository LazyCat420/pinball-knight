# Sprite forge

**Everything that makes a sprite for this game lives under this directory.** If
you are adding a tool that turns art into frames, it goes here — not in
`scripts/`, not in a sibling `tools/` folder, and not in another repo. That rule
exists because it was broken: on 2026-08-03 the system was spread across
`tools/pixel-trace/`, three loose `.mjs` files, a raw sheet drop in the `sun`
workspace root outside any repo, and a Python port living in a fork of somebody
else's project. Consolidating it is what this README now describes.

Drop sprite sheets in `inbox/`, run one command, get scored game-ready frames.

    cp mysheet.png src/game/pinball-knight/tools/sprite-forge/inbox/ratking-E.png
    npm run sprites

Output lands in `work/<name>/` (gitignored): one PNG per frame at the atlas
grid, `preview.png` (nearest-upscaled, so it shows atlas truth rather than a
flattering smooth preview), and `work/report.txt` — vitest swallows console
output, so the report is written to disk.

No network and no API key. The TypeScript import path needs no Python either —
`python/` is a separate, optional port (below). It shares the game's real
palette, real crush and real census, so what it reports is what will ship.

## The folder

    inbox/          sheets waiting to be imported, + their `-S.json` sidecars
    sources/        the ORIGINAL generated art, per creature per drop. Tracked.
    samples/        fixtures the docs and comparisons refer to
    work/           gitignored scratch, rewritten every run — never the only copy
    docs/           plans and write-ups for specific imports

    *.ts            the import pipeline itself (matte → slice → resample →
                    register), plus its vitest suites. `npm run sprites`.
    prep/           what runs BEFORE the inbox: turning a raw generator grid into
                    a sheet the inbox will accept. `prep-sheet.mjs` (magenta
                    chroma, generic), `prep-knight.mjs` (green chroma, banners,
                    two facings), `pixelize.mjs` (superseded by pixel-trace;
                    still the palette other tools quote).
    pixel-trace/    the third pipeline — an image or a sketch to a hand-editable
                    JSON grid of characters→hex, for one-off icons.
                    `npm run pixels`.
    python/         a port of gate/matte/slice/resample as an installable
                    package, for using the pipeline outside the game. Holds no
                    palette. Pinned to the TypeScript by `test_parity.py`.
    oracle.mjs      regenerates those pins FROM the TypeScript. The only
                    sanctioned way to move them.

### Which pipeline

Three of them, and none replaces the others:

| you have | use | why |
|---|---|---|
| a whole generated sheet of an animated creature | **sprite-forge** (`npm run sprites`) | scores it against the painted roster and slices it to clips |
| a raw generator grid that the inbox rejects | **prep/** first, then the inbox | chroma keying, banner/digit removal, scale + baseline normalisation |
| one static icon, or a from-scratch sketch | **pixel-trace** (`npm run pixels`) | emits an editable grid, not an opaque PNG |
| anything animated, authored by us | **painters** (`render/monsters/*.ts`) | procedural canvas code, still the default |

### The Python port

    cd python && pip install -e ".[dev]" && pytest

It was written on 08-01 inside `spritefusion-pixel-snapper`, a fork of somebody
else's Rust tool, with the stated goal of moving sprite-forge OUT of the game.
That direction is reversed and the copy out there is deleted (snapper `737f836`)
— this is the only one. Out there nothing ever ran its parity suite, which is
how the pins went two days stale and two tests skipped silently; see above.

It answers "is this sheet usable, where are its frames, what is wrong with it"
without the game — useful when preparing art somewhere the repo is not. It
deliberately does **not** score: a census comparing imported art to a PAINTED
roster needs this game's real crush and real palette, and a second copy of those
would go stale. The split is: the port makes the sheet, the game judges it.

Its parity suite pins factor, confidence, purity, the matte report and all 56
cell rects against the TypeScript. Those pins are stale the moment a sheet is
regenerated — jester and beaver were regenerated on 08-02 and the pins sat wrong
until 08-03, in another repo where nobody ran them. When they go red:

    node src/game/pinball-knight/tools/sprite-forge/oracle.mjs
    cd python && pytest

Read the diff before committing it. A factor or a cell rect moving when you only
meant to redraw art is the finding, not the noise. Never re-pin from what pytest
reports as "actual" — that is the port grading its own homework.

## The stages

| file | job |
|---|---|
| `matte.ts` | opaque background → alpha, by flood fill from the border |
| `slice.ts` | matted sheet → rows of cells |
| `resample.ts` | cell → its atlas footprint, k-centroid per texel (see below) |
| `register.ts` | cell → the painters' contract, then the real crush |
| `labels.ts` | row → clip name |
| `inbox.test.ts` | the node edge: finds files, decodes, writes output |
| `fixtures.ts` | synthetic sheets for the tests |

## Scale and the resample — the two fixes that made imports readable

**The LIVING clips set the scale.** It used to be the whole sheet's most
extreme frame — and the jester's flat death sprawl (385px wide against a 227px
standing height) shrank the walking jester to 36 texels where its painter uses
~62. Now `idle/walk/attack/stumble` vote and a `death` cell that overflows is
clamped alone (`aliveScale`/`cellScale` in `manifest.ts`). Jester +43% on
screen; the sprawl reads as foreshortening.

**The downscale is k-centroid, not the browser's bilinear.** One smoothed
`drawImage` at a 3× downscale samples 2×2 and skips most of the source; the
crush's palette snap then turns the mush into confetti. `resample.ts` computes
each destination texel from its full coverage: 2-means cluster, dominant
centroid — the AI-art-community standard (Astropulse's pixeldetector lineage).
The classic pipelines are the argument: MUGEN and Rivals of Aether art commits
to a pixel grid and a palette ONCE and is never fractionally resampled after.
Generated sheets arrive gridless; this is where they commit.

Alternatives stay testable: `scripts/sandbox.mjs` renders painted / bilinear
(the old path) / nearest (what a LibreSprite / Pixelorama batch resize feeds
the crush — verified against the real LibreSprite CLI, whose `--scale` is a
smooth resize in the box/bilinear family) / box / dominant / kcentroid side by
side with a census per arm. The census CANNOT crown a winner alone: box scores
lowest because a noise metric rewards blur. Look at the strip.

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

- **A background the matte can find.** Diffusion models have no alpha channel,
  so every generated sheet arrives on an opaque white or cream field — which
  used to slice into a single cell. `matte.ts` keys it now, flood-filling from
  the border, so an opaque sheet is no longer a hard stop. What it will NOT
  key is an ENCLOSED pocket of the background colour, deliberately: a spring's
  inside should be keyed and a white glove must not be, and no threshold tells
  them apart. The report counts the pockets it left (both shipped sheets have
  hundreds) — read that number and look at `preview.png` before trusting a
  sheet.
- **One body scale across every frame**, and feet on a consistent line. Frames
  are registered by bounding box, so debris below the feet lifts the character
  and an off-centre effect shifts the body the other way.
- **No labels in a left gutter.** Captions under a row are detected and dropped;
  a label beside a row shares that row's band, defeats the caption test, clears
  the fragment filter, and imports as a frame.

## Sheets are ADOPTED now, not just judged

Two of them reach the screen. `boot/sheets.ts` maps `jester → jester-S` and
`rotortail → beaver-S` in `IMPORTED_ART`; the frames enter as `FramePaint`s —
the same door the painters use — so the crush, the 20-entry palette lock,
`withRecoil` and the animator apply without knowing the art came from an image.

**What ships is the MATTED SOURCE plus its cell rects, not baked frames.**
The atlas cell is 120/108/96/84/72 texels depending on the camera rung, so a
baked atlas would be wrong at four of the five and rescaling pixel art by
84/120 destroys it. `public/sprites/<name>-S.png` + `-S.json`; the crush happens
at runtime exactly as it does for a painter.

`__lab.imported(false)` then RELOAD switches back to the painters (reload, not
live, because an atlas is palette-locked over the whole sheet).

## Known limits

- The inbox verdict compares against the painted roster AVERAGE (entries 20.1 /
  isolated 22.5% / runLen 1.82), which is not the right comparison for a reskin
  — both of these painters are busier than the average. `ab.test.ts` is the
  honest one: same creature, same crush, same rung, imported vs its own
  painter. It writes `work/ab.txt` and `work/ab-<name>.png`.
- **The isolated% metric is confounded by SIZE.** The 2026-07-31 scale +
  resample fixes made the strips unambiguously cleaner while isolated% went
  UP (jester 46.0→50.0, rotortail 26.9→31.5): a 43%-bigger, crisper figure has
  more edge texels and more deliberate single-texel detail, and the census was
  calibrated on painter-scale sprites. Judge fidelity from
  `scripts/sandbox.mjs`'s strip, not from this number moving a few points.
- Harlequin diamonds are two hues at ONE VALUE and dissolve under a
  luma-weighted snap; the beaver is one brown separated by value and survives.
  Author sheets that separate on VALUE, not hue.
- The matte leaves ENCLOSED background-coloured pockets opaque by design (515
  on beaver, 2826 on jester) — white specks INSIDE a silhouette are that, not
  crush noise.
- Imported art is inherently a little noisier at the floor: a painter
  re-rasterises vectors at the target size, an image can only be resampled.
