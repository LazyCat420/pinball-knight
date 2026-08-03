# pixel-trace

Measured against sprite-forge, with pictures: [docs/COMPARISON.md](docs/COMPARISON.md).

A third way to make pixel art for this game, alongside:

- **Painters** (`render/monsters/*.ts`) — procedural canvas code. The default
  for anything animated; see the "monsters are painters" project note.
- **sprite-forge** (`tools/sprite-forge/`) — whole reference sheets, matted,
  sliced into rows, resampled and registered as imported art.

Neither fits a one-off icon or a quick sketch you want to hand-edit pixel by
pixel. `pixel-trace` produces (or lets you hand-author) a small JSON grid of
characters, each mapped to a hex colour — editable by hand, importable
directly (`resolveJsonModule` is on), with nothing at runtime falling back to
a source image.

```
node tools/pixel-trace/trace.mjs grids
node tools/pixel-trace/trace.mjs trace sheet.png --grid square32 --colours 12
node tools/pixel-trace/trace.mjs trace sheet.png --grid tall32 --palette coldcrypt
node tools/pixel-trace/trace.mjs trace-set some-dir/ --grid square32
node tools/pixel-trace/trace.mjs render cell.json --scale 12
```

or via npm: `npm run pixels -- trace sheet.png --grid square32`.

## Grids

`square16` (16x16), `square32` (32x32), `tall32` (32x64), `square64` (64x64),
`tall64` (64x128).

**Pick the grid by the FIGURE's aspect; pick its size by render size.**
Measured (docs/CLEANUP.md): a wide frog gains zero texels from a tall grid
(520 on both square32 and tall32 — padding eats the extra rows), and a tall
stiltneck on `tall32` is texel-for-texel identical to `square64` (862 = 862)
at half the storage. Wrong-aspect grids only buy padding.

## Noise cleanup — on by default

Traced AI art arrives with a fringe: the source's anti-aliased blend pixels
each land on a different palette entry, one-off colours ringing the
silhouette and region boundaries (measured 653 of 3422 texels on the
stiltneck). Two passes run after quantisation (`--no-despeckle` skips both):

1. **Tiny-island removal** — detached opaque components of ≤2 texels drop.
2. **Near-duplicate snap** — a texel whose colour no neighbour shares adopts
   its chromatically nearest neighbouring colour, but only when that colour
   is CLOSE (luma-weighted). The distance gate is the accent protection: a
   white eye-glint on black has no near neighbour and survives; mauve fringe
   beside brown is the quantiser guessing twice at one edge, and dies.
   Not a plurality filter — fringe lives on boundaries where there is no
   majority to defer to (a mode filter measured 17/653 caught; this: ~67%).

One pass, never iterated: iterating consensus erodes dither and outlines.
What it leaves is for the hand-edit the format exists for.

## Chroma backgrounds — ask the generator for magenta

`--chroma magenta` (or any `#rrggbb`, `--chroma-tol N`, default 60) keys every
pixel near that colour ANYWHERE — replacing the border flood matte. That is
the point of generating on chroma: the flood matte must leave an enclosed
white pocket opaque (it can't tell a keyed hole from a white glove), but the
art never contains magenta, so a global key clears the pocket between a
figure's legs safely — and interior semi-transparent junk that blends toward
the field gets keyed too.

Measured on the stiltneck (flattened onto each field, scored against its
alpha-channel ground truth): from white, 454 silhouette errors; from
magenta, 16. Generate sheets on flat magenta `#ff00ff` when you can.

## Defringe — why big grids looked dirtier than small ones

The matte stops at the anti-aliased edge, leaving a 1-2px ring of
background-blended pixels around the silhouette. The ring is fixed-width in
SOURCE pixels, so grid size decides its fate: at a ~6.5px texel footprint
(32-grid) k-centroid outvotes it; at ~2-3px (64-grid) it wins whole texels
and prints as a pale halo. Bigger grids don't add noise — they RESOLVE
contamination that was always there. Despeckle rightly spares it (halo
texels arrive in connected runs, far from the figure's colours).

`defringe` re-reads the ring as what it really is — partial coverage: for
pixels within `--defringe-band` (default 2, 3 under chroma) of transparency,
alpha = (distance-to-background / `--defringe-range`)², so half-blends fail
the alpha floor instead of scraping past it.

**On by default only under `--chroma`** — against magenta every art colour,
including a silver fish, is 200+ away, so a blend is unambiguous. Against
white it is strictly opt-in (`--defringe "#fdfbfc"` names the field), because
PALE ART IS INDISTINGUISHABLE FROM HALO there: measured at band 3 /
range 220, the fish's silver body hollowed out and its sneakers shredded.
Use the opt-in only for figures dark against their field.

## Getting more detail out of a trace

Measured on five real monster frames (see `docs/DETAIL.md`), in order of
effect:

1. **The k-centroid resample — now the default.** The old box average blends
   each texel's source pixels, so a red-and-cream edge averages to mauve and
   the palette snap has to guess. `--resample kcentroid` (ported from
   sprite-forge's `resample.ts`, the AI-art community standard) 2-means-splits
   each texel and takes the dominant cluster — edges arrive at the snap still
   being edges. The frog's red eyes and yellow spots only survive this arm.
   `--resample box` keeps the old behaviour for A/B.
2. **Content crop — now the default.** Margin is where the detail budget dies;
   the bbox is padded (never stretched) to the grid's aspect, so this also
   retires most ASPECT_STRETCH cases. `--no-crop` restores whole-image mapping.
3. **A bigger grid.** 32→64 is 4× the texel budget and reads dramatically
   closer to the source. Use it when the asset will render large.
4. **More colours** (`--colours`), if median-cut; coldcrypt is fixed at 32.

What no flag can fix: a source that separates on HUE at one value (the
beaver's brown-on-brown) stays muddy at 32 — k-centroid picks sides only
where the block is separable. Same lesson as the harlequin diamonds:
author sources that separate on VALUE.

## Making art from scratch

An `AuthoredCell` (see `authored-cell.ts`) is just:

```json
{
  "id": "torch",
  "grid": "square16",
  "ink": { "a": "#d97b29", "b": "#f0a63c" },
  "rows": ["................", "......aa........", "..."]
}
```

Write one by hand, or start from `trace` on a reference image and edit the
`rows`/`ink` afterwards — that's what the row-of-characters format is for.
`render` presses it onto a magnified PNG so you can look at it before it goes
anywhere near the game.

## The background is keyed out by DEFAULT

Generated art has no alpha channel — it arrives on an opaque white or cream
field — so `trace` flood-fills the background to transparent from the border
before it downsamples, the same way `sprite-forge/matte.ts` does.

This default is load-bearing. Without it the background is not dropped, it is
quantised INTO the art, and the cell comes out a solid rectangle. Traced
without a matte, `samples/fisherman.source.png` gave **0 of 1024 texels
transparent** and still looked correct in a preview drawn on white — it only
read as broken once pressed onto a dark backdrop. That is why `render` draws
a checkerboard unless you ask for something else.

Pass `--no-matte` for art that already has a real alpha channel (it is a
no-op there anyway, so you rarely need to), and `--matte-tol N` to widen or
tighten the colour match. An interior region the same colour as the
background — a white shirt — is preserved, because only pixels reachable
from the border are keyed.

## Look at it on more than one backdrop

    render cell.json --backdrop checker   # default — transparency is visible
    render cell.json --backdrop dark      # Cold Crypt stone, the real world
    render cell.json --backdrop none      # raw alpha

## `--palette coldcrypt`

Snaps to this game's real 32-colour dungeon palette (luma-weighted, same
metric `sprite-forge/pixelize.mjs` uses) instead of a freeform median-cut
palette, so traced art matches the world it's dropped into with no second
quantisation pass. Omit it for general-purpose pixel art with its own
palette.
