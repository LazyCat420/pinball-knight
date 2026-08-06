"""The pose library's one correctness property: EVERY POSE FACES SCREEN-RIGHT.

`dir` is a promise about the screen — E means seen walking right — and a ripped
sheet's pixels routinely face the other way and say so with `mirror`. The game
honours that flag at cel-build time, so the art ON DISK is not the standard.

Handing those pixels to a generator would teach every character built from this
library to face left, and the flag would then have to be carried, remembered and
re-declared per character. Normalising once, here, is what makes "generated
characters face the right way" a property of the library rather than a thing
somebody has to remember.
"""

from __future__ import annotations

import json

import numpy as np
from PIL import Image

from spriteforge.poses import build, row_image


def _asym(w: int = 12, h: int = 16) -> Image.Image:
    """A frame that is obviously handed: ink only in the LEFT half."""
    a = np.zeros((h, w, 4), dtype=np.uint8)
    a[2 : h - 2, 1 : w // 2, :3] = (220, 40, 40)
    a[2 : h - 2, 1 : w // 2, 3] = 255
    return Image.fromarray(a, "RGBA")


def _ink_side(im: Image.Image) -> str:
    """Which half of the image holds the ink."""
    a = np.array(im)
    opaque = a[:, :, 3] > 0
    # The row is drawn on opaque white, so "ink" is anything that is not white.
    ink = opaque & ~np.all(a[:, :, :3] > 240, axis=2)
    xs = np.nonzero(ink)[1]
    return "left" if xs.mean() < im.width / 2 else "right"


def test_a_mirrored_sheet_is_flipped_on_the_way_out():
    frame = _asym()
    assert _ink_side(row_image([frame], mirror=False)) == "left"
    # THE POINT: the source faces one way, the library the other.
    assert _ink_side(row_image([frame], mirror=True)) == "right"


def test_an_unmirrored_sheet_is_left_exactly_as_drawn():
    # The negative control. Without it the test above would pass for a function
    # that flipped unconditionally, which would break every sheet that already
    # obeys the standard.
    frame = _asym()
    before = np.array(frame)
    after = np.array(row_image([frame], mirror=False))
    assert after.shape[1] > before.shape[1]  # padded onto the row
    assert _ink_side(row_image([frame], mirror=False)) == "left"


def test_the_row_is_white_backed_and_shares_one_baseline():
    # Both are quoted requirements of the keyframes prompt this row is handed
    # back to: "plain white background", "feet on one shared baseline". A
    # transparent row composited by an uploader lands on black as often as white.
    tall, short = _asym(h=20), _asym(h=12)
    row = row_image([tall, short], mirror=False)
    a = np.array(row)
    assert a[0, 0, 3] == 255 and tuple(a[0, 0, :3]) == (255, 255, 255)

    def bottom(x0: int, x1: int) -> int:
        ink = (a[:, x0:x1, 3] > 0) & ~np.all(a[:, x0:x1, :3] > 240, axis=2)
        return int(np.nonzero(ink)[0].max())

    # Same floor for a tall frame and a short one.
    assert bottom(0, row.width // 2) == bottom(row.width // 2, row.width)


def test_the_manifest_states_the_standard_it_normalised_to(tmp_path):
    # A consumer that assumes the wrong facing generates a mirrored character,
    # so the library says which way it faces rather than leaving it to be
    # inferred from the pixels.
    rip = tmp_path / "rip"
    (rip / "cells").mkdir(parents=True)
    _asym().save(rip / "cells" / "r00_c00.png")
    (rip / "index.json").write_text(json.dumps({
        "source": "fake.png",
        "bands": [{"index": 0, "caption_y0": 0, "caption_y1": 1, "rows": [0], "cells": [0]}],
        "cells": [{"row": 0, "col": 0, "file": "cells/r00_c00.png", "x0": 0, "y0": 0, "x1": 11, "y1": 15, "w": 12, "h": 16}],
    }))
    table = tmp_path / "m.json"
    table.write_text(json.dumps({
        "name": "t", "facings": {"S": 0}, "mirror": True,
        "clips": [{"clip": "idle", "band": 0, "cols": [0]}],
    }))

    m = build(rip, table, tmp_path / "out")
    assert m["normalisedFrom"]["mirror"] is True
    assert "screen-right" in m["facingStandard"]
    assert m["poses"][0]["clip"] == "idle"
