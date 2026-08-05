"""The ripper, proven on a sheet built to have the failures real sheets have.

Written before the real reference sheet was on disk, deliberately: a segmenter
tested only against the one file it was written for is a segmenter tuned to that
file. The fixture below reproduces the four things that actually break this kind
of rip — a tile colour more common than the background, labels that are not
frames, a sprite overhanging its tile, and rows whose tiles are not the same
height.
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from spriteforge.rip import (
    sheet_background,
    find_cells,
    cut_cell,
    MIN_TILE_SHARE,
)

BG = (0, 0, 170)      # sheet background — a dark blue, as these sheets tend to be
TILE = (0, 170, 0)    # per-frame tile — green
INK = (230, 40, 40)   # the "sprite"
TEXT = (255, 255, 255)


def build(
    rows: tuple[int, ...] = (3, 4),
    tile_w: int = 20,
    tile_h: int = 24,
    label: bool = True,
    overhang: bool = False,
    ragged: bool = False,
) -> np.ndarray:
    """A miniature reference sheet: labelled bands of tiles on a flat field."""
    w = 8 + max(rows) * (tile_w + 2) + 8
    h = 8 + len(rows) * (tile_h + 14) + 8
    a = np.zeros((h, w, 4), dtype=np.uint8)
    a[:, :, :3] = BG
    a[:, :, 3] = 255

    y = 8
    for ri, n in enumerate(rows):
        if label:
            # A word of "text": a thin scatter, containing NO tile colour.
            a[y : y + 5, 8 : 8 + 26, :3] = TEXT
        ty = y + (6 if label else 0)
        x = 8
        for ci in range(n):
            th = tile_h - (3 if (ragged and ci % 2) else 0)
            a[ty : ty + th, x : x + tile_w, :3] = TILE
            # the sprite: a blob inset in the tile
            a[ty + 6 : ty + th - 4, x + 5 : x + tile_w - 5, :3] = INK
            if overhang and ri == 0 and ci == 0:
                # a limb poking out of the tile, onto sheet background
                a[ty + 8 : ty + 12, max(x - 4, 0) : x, :3] = INK
            x += tile_w + 2
        y = ty + tile_h + 8
    return a


def test_background_is_measured_from_the_border_not_the_bulk():
    # A densely packed sheet has MORE tile pixels than background pixels. Taking
    # the modal colour of the whole image would elect the tile as "background"
    # and inverts the entire segmentation.
    a = build(rows=(9, 9, 9), tile_w=30, tile_h=30)
    assert sheet_background(a) == BG


def test_finds_every_tile_and_groups_them_into_rows():
    a = build(rows=(3, 4))
    cells, tile, _ = find_cells(a, BG)
    assert tile == TILE
    assert len(cells) == 7
    assert sorted(c.row for c in cells) == [0, 0, 0, 1, 1, 1, 1]
    # left-to-right within a row
    row0 = sorted((c for c in cells if c.row == 0), key=lambda c: c.col)
    assert [c.col for c in row0] == [0, 1, 2]
    assert row0[0].x0 < row0[1].x0 < row0[2].x0


def test_labels_are_reported_not_counted_as_frames():
    # A label contains no tile colour, so it must fall out on the share test —
    # and it must be RETURNED, because it is the only record of what the row is
    # called and dropping it forces an OCR dependency later.
    a = build(rows=(3,), label=True)
    cells, _, labels = find_cells(a, BG)
    assert len(cells) == 3
    assert len(labels) == 1


def test_a_ragged_band_is_still_one_row():
    # Tiles in a band are routinely a few pixels apart in height. Grouping by
    # equality of y0 would split one animation into two rows.
    a = build(rows=(4,), ragged=True)
    cells, _, _ = find_cells(a, BG)
    assert len({c.row for c in cells}) == 1


def test_cut_keys_out_both_the_tile_and_the_sheet_background():
    a = build(rows=(2,))
    cells, tile, _ = find_cells(a, BG)
    im = cut_cell(a, cells[0], tile, BG)
    assert im is not None
    arr = np.array(im)
    opaque = arr[:, :, 3] > 0
    # every surviving pixel is sprite ink — no tile, no background
    assert opaque.any()
    kept = arr[opaque][:, :3]
    assert {tuple(int(v) for v in p) for p in kept} == {INK}


def test_an_overhanging_limb_does_not_drag_a_slab_of_background_with_it():
    # A hammer or a cape that leaves its tile sits on SHEET background for those
    # pixels. Keying only the tile colour leaves a rectangle of blue attached.
    a = build(rows=(2,), overhang=True)
    cells, tile, _ = find_cells(a, BG)
    im = cut_cell(a, cells[0], tile, BG)
    arr = np.array(im)
    kept = {tuple(int(v) for v in p) for p in arr[arr[:, :, 3] > 0][:, :3]}
    assert BG not in kept
    assert TILE not in kept


def test_an_empty_tile_returns_nothing_rather_than_a_blank_frame():
    a = build(rows=(1,))
    cells, tile, _ = find_cells(a, BG)
    # blank the sprite out, leaving a bare tile
    x0, y0, x1, y1 = cells[0].box
    a[y0:y1, x0:x1, :3] = TILE
    assert cut_cell(a, cells[0], tile, BG) is None


@pytest.mark.parametrize("share", [0.0, MIN_TILE_SHARE / 2])
def test_regions_with_too_little_tile_colour_are_not_frames(share: float):
    # The credits box and the palette swatches at the bottom of a real sheet are
    # exactly this: big non-background regions that are not animation frames.
    a = build(rows=(2,))
    a[2:7, 2:60, :3] = TEXT
    cells, _, labels = find_cells(a, BG)
    assert all(c.y0 > 7 for c in cells)
    assert labels
