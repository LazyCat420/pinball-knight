"""
SLICING — a matted sheet into ragged rows of cells.

Returns ROWS rather than a flat list because real sheets are ragged: one observed
sheet runs 4 / 6 / 4 / 2 / 3 across its five clips, with a row that does not start
at column 1. Flattening first makes "which frame belongs to which clip"
unrecoverable.

⚠️ THIS FINDS CELLS BY ALPHA. It assumes matting already happened. Handed a sheet
on an opaque background it returns ONE cell, which is what the caller's guard is
for.

── WHAT A RULED LINE IS, AND THE TWO WAYS THAT WAS GOT WRONG ───────────────

Real sheets are drawn with cell borders. They are opaque, so a naive alpha-slice
sees the whole sheet as ONE region and returns a single cell.

FILL ALONE IS NOT THE TEST, and believing it was cost this module its reputation
twice:

  · A RULE IS ALSO THIN. A figure's own solid core is a column of opaque pixels
    spanning the whole band, so a height-only test erases it. On an unruled sheet
    176 of 176 opaque columns were stripped and the sheet sliced to NOTHING.

  · A RULE IS ALSO CONTIGUOUS. Total ink counts a row of separate figures the
    same as a line drawn through them, so a sheet of BROAD creatures busts the
    threshold on the strength of the creatures alone. Measured on a frog sheet —
    five wide frogs per row — the widest scanlines reach 73% total ink and were
    erased as borders, so the idle cells came back 57px tall against a ~150px
    frog and every frame shipped as a headless dome. Longest CONTIGUOUS run
    separates them by construction:

        a ruled border   ~100% contiguous
        the frog row       15% contiguous   (73% total ink)
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Transparent columns/rows narrower than this do not separate two cells.
MIN_GAP = 6
#: A run of opaque pixels smaller than this is a smudge, not a pose.
MIN_CELL = 12
#: A row or column this CONTIGUOUSLY full of opaque pixels is a ruled grid line.
RULE_FILL = 0.7
#: A vertical rule may be at most this share of the band's HEIGHT in width.
#:
#: Scale-free on purpose. An absolute "3px" is a guess about the source
#: resolution and breaks the first time a sheet arrives upscaled 4x with 8px
#: borders. Against the band, a ruled border is 1-3px of a ~120px cell (1-2.5%)
#: and a figure's core is 44px (37%) — a 15x margin either side.
RULE_MAX_W = 0.1
#: ...but never below this, so a short band cannot make the cap sub-pixel.
RULE_MIN_W = 3
#: Bands shorter than this share of the median band are CAPTIONS.
#:
#: Sheets label their rows ("IDLE", "SPRING ATTACK"). The lettering sits between
#: rows, slices as its own short band, and would import as a pose. A caption is an
#: order of magnitude shorter than a figure.
#:
#: ⚠️ This only catches captions in their OWN band. One in a LEFT GUTTER shares
#: the row's band, so its height is the row's height and this never sees it.
CAPTION_RATIO = 0.25

#: x0, y0, x1, y1 — inclusive.
Cell = tuple[int, int, int, int]


@dataclass
class SheetRow:
    cells: list[Cell]


@dataclass
class SliceDetail:
    rows: list[SheetRow]
    #: `1` where the sheet has art, at sheet coordinates.
    #:
    #: The slicer's OWN view: alpha keyed, sheet rules stripped, outer frame
    #: stripped, per-band cell borders stripped. The gutter check must measure
    #: THIS and not raw alpha, or a ruled sheet fails on its own borders — a 2px
    #: rule inside a 15px probe reads 13%.
    mask: np.ndarray


def bands(profile: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous true runs, merging gaps under MIN_GAP and dropping tiny runs."""
    out: list[tuple[int, int]] = []
    start = -1
    gap = 0
    for i, v in enumerate(profile):
        if v:
            if start < 0:
                start = i
            gap = 0
        elif start >= 0:
            gap += 1
            if gap > MIN_GAP:
                if i - gap - start >= MIN_CELL:
                    out.append((start, i - gap))
                start = -1
    if start >= 0 and len(profile) - start >= MIN_CELL:
        out.append((start, len(profile) - 1))
    return out


def _longest_run(row: np.ndarray) -> int:
    """Longest contiguous run of 1s. A rule is a LINE, not scattered ink."""
    if not row.any():
        return 0
    # Run-length via the positions where the value changes.
    idx = np.flatnonzero(np.diff(np.concatenate(([0], row, [0]))))
    return int((idx[1::2] - idx[0::2]).max())


def slice_sheet_detail(alpha: np.ndarray) -> SliceDetail:
    """Slice a matted sheet. `alpha` is the HxW alpha channel."""
    h, w = alpha.shape
    solid = (alpha > 8).astype(np.uint8)

    # ── Sheet-wide horizontal rules, measured as ONE CONTIGUOUS RUN.
    for y in range(h):
        if _longest_run(solid[y]) >= w * RULE_FILL:
            solid[y] = 0

    # ── The OUTER frame's sides, and only those.
    #
    # A frame around the whole sheet puts ink in every row, so the row profile
    # never breaks and the entire sheet reads as ONE band. Safe here and
    # catastrophic per-band because of the threshold: an outer frame spans ~100%
    # of the sheet height where a CELL border in a 5-row sheet spans about 18%.
    frame_cap = max(RULE_MIN_W, h * 0.01)
    full_h = solid.sum(axis=0) >= h * 0.98
    x = 0
    while x < w:
        if not full_h[x]:
            x += 1
            continue
        end = x
        while end + 1 < w and full_h[end + 1]:
            end += 1
        if end - x + 1 <= frame_cap:
            solid[:, x : end + 1] = 0
        x = end + 1

    # ⚠️ CELL BORDERS ARE STRIPPED PER-BAND, NOT SHEET-WIDE. A cell border is only
    # as tall as ITS ROW, so against the full sheet height a 5-row sheet's border
    # fills about 18% — nowhere near any sensible threshold — and survives, then
    # bridges neighbouring cells so the row slices as ONE frame.
    row_profile = solid.any(axis=1)
    raw = bands(row_profile)
    if not raw:
        return SliceDetail(rows=[], mask=np.zeros((h, w), np.uint8))
    heights = sorted(b - a + 1 for a, b in raw)
    median = heights[len(heights) // 2]
    keep = [(a, b) for a, b in raw if b - a + 1 >= median * CAPTION_RATIO]

    mask = np.zeros((h, w), np.uint8)
    out: list[SheetRow] = []
    for y0, y1 in keep:
        band = solid[y0 : y1 + 1].copy()
        band_h = band.shape[0]

        # Fill is measured against THIS ROW's extent, not the sheet's. A ragged
        # sheet's short rows never reach 70% of the sheet width, so their borders
        # used to survive and weld the row into one cell.
        cols = np.flatnonzero(band.any(axis=0))
        if cols.size == 0:
            continue
        row_w = int(cols[-1] - cols[0] + 1)

        ruled = False
        for y in range(band_h):
            if _longest_run(band[y]) < row_w * RULE_FILL:
                continue
            band[y] = 0
            ruled = True

        # ── A CELL BORDER IS A RECTANGLE: no vertical rules without horizontal
        # ones. On an UNRULED sheet any column the vertical test flags is art by
        # construction — it flagged all of it, 176 of 176, and sliced to nothing.
        if ruled:
            # A vertical rule is SPANNING *AND* NARROW, and opaque at BOTH band
            # edges: a border runs the full height of its cell where art is inset.
            cap_w = max(RULE_MIN_W, band_h * RULE_MAX_W)
            tall = (band.sum(axis=0) >= band_h * RULE_FILL) & (band[0] == 1) & (band[-1] == 1)
            x = 0
            while x < w:
                if not tall[x]:
                    x += 1
                    continue
                end = x
                while end + 1 < w and tall[end + 1]:
                    end += 1
                # Cleared as RUNS, not columns: two neighbouring cells' borders
                # touch and read as one 2px rule, which is still a rule.
                if end - x + 1 <= cap_w:
                    band[:, x : end + 1] = 0
                x = end + 1

        mask[y0 : y1 + 1] |= band

        col_profile = band.any(axis=0)
        cells: list[tuple[int, int, int, int, int]] = []
        for cx0, cx1 in bands(col_profile):
            # Tighten vertically to this cell's own ink — the band is the union
            # across the row, and a crouched pose is shorter than its neighbours.
            sub = band[:, cx0 : cx1 + 1]
            ys = np.flatnonzero(sub.any(axis=1))
            if ys.size == 0:
                continue
            cells.append((cx0, y0 + int(ys[0]), cx1, y0 + int(ys[-1]), int(sub.sum())))

        if not cells:
            continue
        # Reject FRAGMENTS by WIDTH against the row's median cell.
        #
        # Mass is the wrong test and was tried first: a leftover ruled border is
        # long, so it carries real mass (a 2x260 edge is 520 px) and survived a 2%
        # threshold, then crushed to 8 texels and tripped the empty-cell guard.
        # Width is the discriminator, and it stays correct for a small pose, which
        # a mass test does not: a death sprawl is legitimately light.
        widths = sorted(c[2] - c[0] + 1 for c in cells)
        median_w = widths[len(widths) // 2]
        real = [(c[0], c[1], c[2], c[3]) for c in cells if c[2] - c[0] + 1 >= median_w * 0.25 and c[4] > 0]
        if real:
            out.append(SheetRow(cells=real))

    return SliceDetail(rows=out, mask=mask)


def slice_sheet(alpha: np.ndarray) -> list[SheetRow]:
    """`slice_sheet_detail`, rows only."""
    return slice_sheet_detail(alpha).rows


def equal_cells(row: SheetRow, n: int) -> list[Cell]:
    """Re-cut a row into exactly `n` equal columns across its own opaque extent.

    ⚠️ NOT THE NORMAL PATH, and it costs something. It divides the INK EXTENT,
    not the cell extent, so a row whose first pose is inset or whose last stops
    short drifts: measured on a frog sheet the true pitch was 266px and equal
    division gave 255, putting the fifth frame 47px off its figure. It also gives
    every cell the BAND's height rather than its own ink, which shrinks the figure.

    Kept for the sheet that still fools the alpha pass: two poses genuinely
    touching with no gap read as one cell, and no threshold recovers that from
    pixels alone.
    """
    x0 = min(c[0] for c in row.cells)
    x1 = max(c[2] for c in row.cells)
    y0 = min(c[1] for c in row.cells)
    y1 = max(c[3] for c in row.cells)
    step = (x1 - x0 + 1) / n
    return [(round(x0 + i * step), y0, round(x0 + (i + 1) * step) - 1, y1) for i in range(n)]
