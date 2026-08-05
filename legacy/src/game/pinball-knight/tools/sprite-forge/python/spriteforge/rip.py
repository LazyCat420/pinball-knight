"""Rip a LABELLED reference sheet into clean, individually-matted frames.

    python3 -m spriteforge.rip sheet.png --out .rip/mario
    python3 -m spriteforge.rip sheet.png --out .rip/mario --contact

The rest of this package handles sheets WE authored: one creature, rows that
mean clips, a flat key background. A ripped reference sheet is a different
animal — dozens of separate animations, each sitting on its own coloured tile,
with the animation's name printed above it in the sheet's background colour.

Why bother: a hand-authored reference sheet has the one thing generation cannot
currently produce — poses that are genuinely, deliberately different from each
other. Every attempt at generating a four-key walk has come back with keys 97-99%
identical, because four poses sharing one denoising pass regress toward each
other. An animator's sheet has no such problem. So it is both a playable base
AND a library of init images: to generate a new character's walk, hand the model
THIS character's walk frame and ask for a different creature in that pose.

── HOW A SHEET LIKE THIS IS BUILT ──────────────────────────────────────────

    ┌─ sheet background (one flat colour, usually the darkest) ──────────┐
    │  Label Text  (drawn in a light colour, ON the background)          │
    │  ┌────────┐┌────────┐┌────────┐   ← tiles: one flat colour each,   │
    │  │ sprite ││ sprite ││ sprite │      one per FRAME, butted together │
    │  └────────┘└────────┘└────────┘                                     │
    └────────────────────────────────────────────────────────────────────┘

So: everything that is not the sheet background is either a TILE (contains a lot
of the tile colour) or a LABEL (contains none). That single distinction is the
whole segmentation, and it does not care how the sheet is laid out.

Nothing here is specific to one sheet: the background and tile colours are
MEASURED, not hardcoded, so a sheet using grey tiles on white works the same.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


# A tile's colour must cover at least this share of its own box, or the region
# is a label / logo / credits block rather than a frame. Sprites are big, so
# this is deliberately low — a frame whose sprite fills most of the tile is
# still a frame.
MIN_TILE_SHARE = 0.15
# Regions smaller than this in either axis are punctuation, not frames.
MIN_CELL_PX = 8
# Labels get their OWN, much smaller floor. A row's caption is a line of text
# five or six pixels tall; applying the frame floor to it silently threw away
# every label on the sheet — which is the one thing that says what a row IS.
MIN_LABEL_PX = 3
# Colour distance below which two RGB triplets count as the same flat colour.
# Reference sheets are indexed-colour and exact; the slack is for PNG round
# trips and the odd anti-aliased pixel.
TOL = 12


@dataclass
class Cell:
    """One frame's tile, in sheet coordinates."""

    x0: int
    y0: int
    x1: int
    y1: int
    row: int
    col: int

    @property
    def box(self) -> tuple[int, int, int, int]:
        return (self.x0, self.y0, self.x1 + 1, self.y1 + 1)


@dataclass
class Band:
    """A captioned section: the caption line(s) and the tile rows they govern.

    ── WHY THIS IS NOT "ONE ROW = ONE ANIMATION" ───────────────────────────────
    Measured on the Paper Mario sheet, both of the obvious rules are wrong:

      · A ROW is not a move. The first captioned section spans TWO tile rows
        (44 frames under one caption line), while the section below it spans one.
        The row count per section varies 1-2 across the sheet.
      · A GAP is not a move boundary. 403 of the 408 within-row gaps measure
        exactly 1px — animations are BUTTED against each other, not spaced. A
        gap-splitter finds five boundaries on a sheet with roughly 120 moves.

    What actually delimits a move is its CAPTION, left-aligned above its first
    tile. So the geometry this class captures — which caption lines govern which
    tile rows — is measurable, and the split of a band into named moves is left
    to a hand-authored table. That division is deliberate: an automatic split was
    tried and rejected. Caption left-edges align with SOME tile left-edge for
    134 of 430 cells, because a caption is many glyph boxes and only its first
    glyph means anything — so the rule fires three times too often, and every
    false fire silently puts frames in the wrong move.
    """

    index: int
    caption_y0: int
    caption_y1: int
    rows: list[int]
    cells: list[int]

    @property
    def y0(self) -> int:
        return self.caption_y0


def _rgb(a: np.ndarray) -> np.ndarray:
    return a[:, :, :3].astype(np.int16)


def _near(a: np.ndarray, colour: tuple[int, int, int], tol: int = TOL) -> np.ndarray:
    """Boolean mask of pixels within `tol` of `colour`, per channel sum."""
    d = np.abs(_rgb(a) - np.array(colour, dtype=np.int16)).sum(axis=2)
    return d <= tol


def modal_colour(a: np.ndarray, mask: np.ndarray | None = None) -> tuple[int, int, int]:
    """The most common exact RGB triplet, optionally within a mask."""
    rgb = a[:, :, :3]
    px = rgb[mask] if mask is not None else rgb.reshape(-1, 3)
    if not len(px):
        return (0, 0, 0)
    counts = Counter(map(tuple, px.reshape(-1, 3)))
    return tuple(int(v) for v in counts.most_common(1)[0][0])  # type: ignore[return-value]


def sheet_background(a: np.ndarray) -> tuple[int, int, int]:
    """The sheet's own background, measured from its border.

    The border is used rather than the whole image because on a densely packed
    sheet the TILE colour can easily out-number the background — and picking the
    tile colour as "background" inverts the entire segmentation.
    """
    h, w = a.shape[:2]
    edge = np.zeros((h, w), dtype=bool)
    edge[0, :] = edge[-1, :] = True
    edge[:, 0] = edge[:, -1] = True
    return modal_colour(a, edge)


def find_cells(a: np.ndarray, bg: tuple[int, int, int]) -> tuple[list[Cell], tuple[int, int, int], list[tuple[int, int, int, int]]]:
    """Segment the sheet into frame tiles, and report the label regions too.

    Returns `(cells, tile_colour, labels)`. Labels are returned rather than
    discarded so the caller can crop them — they are how a human maps a row to a
    clip name, and throwing them away is what would force an OCR dependency.
    """
    not_bg = ~_near(a, bg)
    lab, n = ndimage.label(not_bg)
    if n == 0:
        return [], bg, []

    # The tile colour is the most common colour across everything that is not
    # background. On a sheet of framed sprites that is overwhelmingly the tile.
    tile = modal_colour(a, not_bg)
    is_tile = _near(a, tile)

    boxes = ndimage.find_objects(lab)
    cells: list[Cell] = []
    labels: list[tuple[int, int, int, int]] = []
    for i, sl in enumerate(boxes, start=1):
        if sl is None:
            continue
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        if h < MIN_LABEL_PX or w < MIN_LABEL_PX:
            continue
        region = lab[sl] == i
        share = float((is_tile[sl] & region).sum()) / float(region.sum() or 1)
        box = (xs.start, ys.start, xs.stop - 1, ys.stop - 1)
        # The share test decides WHAT a region is; the size test decides whether
        # it is big enough to matter — and the two thresholds are different,
        # because a caption is legitimately thinner than any frame.
        if share >= MIN_TILE_SHARE:
            if h >= MIN_CELL_PX and w >= MIN_CELL_PX:
                cells.append(Cell(*box, row=-1, col=-1))
        else:
            labels.append(box)

    _assign_rows(cells)
    return cells, tile, labels


def _assign_rows(cells: list[Cell]) -> None:
    """Group cells into visual rows by vertical overlap, then order left→right.

    Overlap rather than "same y0": tiles in one band are frequently a few pixels
    taller or shorter than their neighbours, and equality would split a row into
    several.
    """
    if not cells:
        return
    cells.sort(key=lambda c: (c.y0, c.x0))
    row = 0
    band_lo, band_hi = cells[0].y0, cells[0].y1
    for c in cells:
        overlap = min(band_hi, c.y1) - max(band_lo, c.y0)
        if overlap < (c.y1 - c.y0) * 0.4:
            row += 1
            band_lo, band_hi = c.y0, c.y1
        else:
            band_lo, band_hi = min(band_lo, c.y0), max(band_hi, c.y1)
        c.row = row
    by_row: dict[int, list[Cell]] = {}
    for c in cells:
        by_row.setdefault(c.row, []).append(c)
    for r in by_row.values():
        r.sort(key=lambda c: c.x0)
        for i, c in enumerate(r):
            c.col = i


def text_lines(labels: list[tuple[int, int, int, int]]) -> list[tuple[int, int, list[tuple[int, int, int, int]]]]:
    """Glyph boxes → caption LINES, by vertical overlap.

    Segmentation returns one box per glyph or per touching glyph-cluster — 665 of
    them on the Paper Mario sheet, for roughly 120 captions. Merging them into
    words would need a gap threshold, and the measured gap histogram has no
    valley to put one in (0-8px is letter spacing, and the tail runs continuously
    past 17). So this groups by LINE only, which needs no threshold, and leaves
    the word/caption split to the human reading the review sheet.
    """
    lines: list[dict] = []
    for l in sorted(labels, key=lambda b: (b[1], b[0])):
        lx0, ly0, lx1, ly1 = l
        for ln in lines:
            overlap = min(ln["y1"], ly1) - max(ln["y0"], ly0)
            if overlap >= 0.5 * min(ln["y1"] - ln["y0"], ly1 - ly0):
                ln["y0"], ln["y1"] = min(ln["y0"], ly0), max(ln["y1"], ly1)
                ln["items"].append(l)
                break
        else:
            lines.append({"y0": ly0, "y1": ly1, "items": [l]})
    lines.sort(key=lambda ln: ln["y0"])
    return [(ln["y0"], ln["y1"], ln["items"]) for ln in lines]


def find_bands(cells: list[Cell], labels: list[tuple[int, int, int, int]]) -> list[Band]:
    """Interleave caption lines with tile rows top-to-bottom into captioned bands.

    Two caption lines with NO tile row between them are one multi-line caption
    ("Take/ Place Item", "Crouch Burned"), not two sections — so they join the
    same band rather than opening a new one. Measured on the real sheet this
    resolves 32 text lines and 22 tile rows into 19 bands.
    """
    rows: dict[int, list[Cell]] = {}
    for c in cells:
        rows.setdefault(c.row, []).append(c)
    row_tops = [(r, min(c.y0 for c in v)) for r, v in sorted(rows.items())]

    events: list[tuple[int, int, object]] = []
    for y0, y1, items in text_lines(labels):
        events.append((y0, 0, ("line", y0, y1)))
    for r, top in row_tops:
        events.append((top, 1, ("row", r, 0)))
    events.sort(key=lambda e: (e[0], e[1]))

    bands: list[Band] = []
    for _, _, ev in events:
        kind = ev[0]
        if kind == "line":
            _, y0, y1 = ev
            # Open a band only if the previous one already claimed a tile row;
            # otherwise this is the next line of the SAME caption.
            if bands and not bands[-1].rows:
                bands[-1].caption_y0 = min(bands[-1].caption_y0, int(y0))
                bands[-1].caption_y1 = max(bands[-1].caption_y1, int(y1))
            else:
                bands.append(Band(index=len(bands), caption_y0=int(y0), caption_y1=int(y1), rows=[], cells=[]))
        else:
            _, r, _ = ev
            if not bands:  # a sheet whose first row has no caption above it
                bands.append(Band(index=0, caption_y0=-1, caption_y1=-1, rows=[], cells=[]))
            bands[-1].rows.append(int(r))
    return bands


def assign_band_cells(bands: list[Band], cells: list[Cell]) -> None:
    """Fill each band's `cells` with indices into `cells`, IN READING ORDER.

    ⚠️ ORDER BY `col`, NEVER BY POSITION IN THE LIST. `find_cells` leaves its
    list sorted by (y0, x0), and tiles in one visual row do NOT share a y0 — a
    move whose tiles are a few pixels taller than its neighbours' sorts into a
    separate y0 group. Reading in list order therefore walks the real sheet's
    first row as 0,1,13,14,15,2,3,4… and a band's cell order IS its frame order,
    so the scramble ships as a jumbled walk cycle rather than as an error.
    """
    by_row: dict[int, list[tuple[int, int]]] = {}
    for i, c in enumerate(cells):
        by_row.setdefault(c.row, []).append((c.col, i))
    for v in by_row.values():
        v.sort()
    for b in bands:
        b.cells = [i for r in b.rows for _, i in by_row.get(r, [])]


def cut_cell(a: np.ndarray, cell: Cell, tile: tuple[int, int, int], bg: tuple[int, int, int]) -> Image.Image | None:
    """One tile → a trimmed RGBA sprite with the tile colour keyed out.

    BOTH the tile colour and the sheet background are keyed. A sprite that
    overhangs its tile — Mario's hammer regularly does — sits on sheet
    background for those pixels, and keying only the tile would leave a slab of
    blue hanging off the frame.
    """
    x0, y0, x1, y1 = cell.box
    sub = a[y0:y1, x0:x1]
    keep = ~(_near(sub, tile) | _near(sub, bg))
    if not keep.any():
        return None

    ys, xs = np.nonzero(keep)
    ty0, ty1, tx0, tx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    out = np.zeros((ty1 - ty0, tx1 - tx0, 4), dtype=np.uint8)
    out[:, :, :3] = sub[ty0:ty1, tx0:tx1, :3]
    out[:, :, 3] = keep[ty0:ty1, tx0:tx1].astype(np.uint8) * 255
    return Image.fromarray(out, "RGBA")


def contact_sheet(
    frames: list[tuple[str, Image.Image]], cols: int = 12, pad: int = 6, scale: int = 2
) -> Image.Image:
    """A numbered index of every ripped frame, for mapping rows to clips by eye.

    This exists so the naming step needs no OCR. The sheet's own labels are
    words like "Spin Jump" and "Hammer Charge" that no engine clip is called;
    somebody has to decide that "Hurt" is the game's `stumble`, and they can only
    decide it by looking.
    """
    if not frames:
        return Image.new("RGBA", (1, 1))
    cw = max(im.width for _, im in frames) * scale + pad * 2
    ch = max(im.height for _, im in frames) * scale + pad * 2 + 10
    rows = (len(frames) + cols - 1) // cols
    out = Image.new("RGBA", (cw * cols, ch * rows), (24, 24, 32, 255))
    from PIL import ImageDraw

    d = ImageDraw.Draw(out)
    for i, (name, im) in enumerate(frames):
        r, c = divmod(i, cols)
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        ox = c * cw + (cw - big.width) // 2
        oy = r * ch + (ch - 10 - big.height) // 2
        out.alpha_composite(big, (ox, max(oy, 0)))
        d.text((c * cw + 3, r * ch + ch - 11), name, fill=(180, 180, 200, 255))
    return out


def band_review(img: Image.Image, band: Band, cells: list[Cell], scale: int = 3) -> Image.Image:
    """One band, cropped from the SOURCE at its own scale, with cells numbered.

    Cropping the source rather than compositing the cut frames is the whole
    point: it keeps the caption and the tiles in their original x-alignment, so
    which caption sits above which frames is a thing you can SEE. A montage of
    the cut frames would destroy exactly the information the naming step needs.
    """
    from PIL import ImageDraw

    mine = [cells[i] for i in band.cells]
    if not mine:
        return Image.new("RGBA", (1, 1))
    y0 = band.caption_y0 if band.caption_y0 >= 0 else min(c.y0 for c in mine)
    y0 = max(y0 - 2, 0)
    y1 = min(max(c.y1 for c in mine) + 3, img.height)
    crop = img.crop((0, y0, img.width, y1))
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST)
    d = ImageDraw.Draw(crop)
    for i in band.cells:
        c = cells[i]
        box = [c.x0 * scale, (c.y0 - y0) * scale, (c.x1 + 1) * scale - 1, (c.y1 - y0 + 1) * scale - 1]
        d.rectangle(box, outline=(255, 0, 255, 255))
        d.text((box[0] + 2, box[1] + 1), str(i), fill=(255, 255, 0, 255))
    return crop


def rip(path: Path, out: Path, want_contact: bool = False) -> dict:
    img = Image.open(path).convert("RGBA")
    a = np.array(img)
    bg = sheet_background(a)
    cells, tile, labels = find_cells(a, bg)

    out.mkdir(parents=True, exist_ok=True)
    (out / "cells").mkdir(exist_ok=True)

    frames: list[tuple[str, Image.Image]] = []
    index: list[dict] = []
    kept: list[Cell] = []
    for c in cells:
        im = cut_cell(a, c, tile, bg)
        if im is None:
            continue
        name = f"r{c.row:02d}_c{c.col:02d}"
        im.save(out / "cells" / f"{name}.png")
        frames.append((name, im))
        index.append({**asdict(c), "file": f"cells/{name}.png", "w": im.width, "h": im.height})
        kept.append(c)

    # Bands are built from the KEPT cells: an empty tile produced no frame, and a
    # band that indexed it would hand the naming step a number with no picture.
    bands = find_bands(kept, labels)
    assign_band_cells(bands, kept)

    meta = {
        "source": str(path),
        "size": [img.width, img.height],
        "background": list(bg),
        "tile": list(tile),
        "rows": (max((c.row for c in cells), default=-1) + 1),
        "frames": len(index),
        "labels": [{"x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3]} for b in labels],
        "bands": [asdict(b) for b in bands],
        "cells": index,
    }
    (out / "index.json").write_text(json.dumps(meta, indent=1) + "\n")

    if want_contact and frames:
        contact_sheet(frames).save(out / "contact.png")

    # The review sheets are what the naming table is written FROM, so they are
    # not behind --contact: a rip you cannot name is a rip you cannot use.
    if bands:
        (out / "bands").mkdir(exist_ok=True)
        for b in bands:
            if b.cells:
                band_review(img, b, kept).save(out / "bands" / f"band_{b.index:02d}.png")

    # Crop the labels too — they are the only record of what each band is called,
    # and reading them back off the source means keeping the source around.
    if labels:
        (out / "labels").mkdir(exist_ok=True)
        for i, (lx0, ly0, lx1, ly1) in enumerate(labels):
            img.crop((lx0, ly0, lx1 + 1, ly1 + 1)).save(out / "labels" / f"label_{i:03d}.png")

    return meta


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--contact", action="store_true", help="write a numbered contact sheet")
    a = ap.parse_args(argv)

    meta = rip(a.sheet, a.out, a.contact)
    print(
        f"{a.sheet.name}: {meta['size'][0]}x{meta['size'][1]}\n"
        f"  background {tuple(meta['background'])}  tile {tuple(meta['tile'])}\n"
        f"  {meta['frames']} frames in {meta['rows']} rows, {len(meta['labels'])} labels\n"
        f"  {len(meta['bands'])} captioned bands → bands/band_NN.png, name them in a moves table\n"
        f"  → {a.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
