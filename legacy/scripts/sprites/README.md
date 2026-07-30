# Sprite inbox

Drop sprite sheets here, run one command, get scored game-ready frames.

    cp mysheet.png scripts/sprites/inbox/ratking-E.png
    npm run sprites

Output lands in `work/<name>/`: one PNG per frame at the atlas grid, plus
`preview.png` (nearest-upscaled, so it shows atlas truth rather than a
flattering smooth preview).

No network, no API key, no Python. It shares the game's real palette, real
crush and real census, so what it reports is what will ship.

## Naming

    ratking-E.png    creature "ratking", facing E (true side profile)
    ratking-S.png    facing S (toward camera).  N = away.
    ratking.png      facing E, the default

W is never authored — the engine draws it as E with a negative texture repeat.

## The sidecar — write one, it takes ten seconds

    scripts/sprites/inbox/ratking-E.json
    { "rows": ["idle", "attack", "walk", "stumble", "death"],
      "cells": [4, 6, 4, 2, 3] }

`rows` names each row's clip. `cells` says how many frames are in each row.

**`cells` is not optional in practice on a ruled sheet.** Auto-slicing finds
the rows reliably and the cells unreliably: measured on a sheet with ruled cell
borders and ragged rows, it returned 5/12/5/2/1 where the truth was 4/6/4/2/3.
It splits on border remnants, splits again inside a figure wherever a pose
leaves a transparent column (between the legs, either side of a spring), and
merges neighbours whose art touches. Those pull in opposite directions, so no
gap threshold fixes all three. Given the count, cells divide exactly, because
real sheets are laid out on a regular pitch.

Run it once without a sidecar: it reports the rows it found and prints the
sidecar for you to fill in.

## Known limits

- **Ruled borders leave thin remnants** at cell edges on some frames. They are
  a few texels and they do land in the census. The fix is to use the detected
  border lines AS the grid instead of stripping them; not done yet.
- **Sheets are judged, not adopted.** Frames are written and scored; nothing in
  the game loads them yet — monsters are still painter functions. Wiring an
  image-backed painter is the next step.
- The verdict compares against the painted roster (entries 20.1 / isolated
  22.5% / runLen 1.82). Imported art is inherently a little noisier: a painter
  re-rasterises vectors at the target size, an image can only be resampled.
