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
The atlas cell is 90/81/72/63/54 texels depending on the camera rung, so a
baked atlas would be wrong at four of the five and rescaling pixel art by
63/90 destroys it. `public/sprites/<name>-S.png` + `-S.json`; the crush happens
at runtime exactly as it does for a painter.

`__lab.imported(false)` then RELOAD switches back to the painters (reload, not
live, because an atlas is palette-locked over the whole sheet).

## Known limits

- The inbox verdict compares against the painted roster AVERAGE (entries 20.1 /
  isolated 22.5% / runLen 1.82), which is not the right comparison for a reskin
  — both of these painters are busier than the average. `ab.test.ts` is the
  honest one: same creature, same crush, same rung, imported vs its own
  painter. It writes `work/ab.txt` and `work/ab-<name>.png`.
- **On that comparison the result is SPLIT, and the difference is the art.**

      jester      IMPORTED  isolated 46.0%  runLen 1.25
                  PAINTED   isolated 38.1%  runLen 1.42   ← painter wins
      rotortail   IMPORTED  isolated 26.9%  runLen 1.58
                  PAINTED   isolated 35.2%  runLen 1.43   ← import wins

  Harlequin diamonds are two hues at ONE VALUE and dissolve under a
  luma-weighted snap; the beaver is one brown separated by value and survives.
  Author sheets that separate on VALUE, not hue.
- Imported art is inherently a little noisier at the floor: a painter
  re-rasterises vectors at the target size, an image can only be resampled.
