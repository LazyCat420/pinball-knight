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

`square16` (16x16), `square32` (32x32), `tall32` (32x64), `square64` (64x64).

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
