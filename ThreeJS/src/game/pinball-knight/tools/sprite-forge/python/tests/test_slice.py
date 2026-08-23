"""
The slicer's failures were never "it found the wrong number of cells" in the
abstract — they were two specific wrong theories about what a ruled line is, and
each one destroyed art in a different way. Both arms are pinned here.

Layout fixtures are built rather than loaded so the cases can be made adversarial
on purpose: touching figures, an indented row, a caption, a broad-creature row.
"""

from __future__ import annotations

import numpy as np
import pytest

from spriteforge.slice import (
    CAPTION_RATIO,
    MIN_GAP,
    bands,
    equal_cells,
    slice_sheet,
    slice_sheet_detail,
)

W, H = 400, 260
INK = 255

# ⚠️ EVERY THRESHOLD IN slice.py IS A RATIO, so an undersized fixture distorts
# them and the test measures the fixture instead of the code. Three separate
# cases here were written wrong before this note existed:
#
#   · a 60px pocket in a 120px sheet is 1936px against a 29px auto-key threshold,
#     where a real glove is 120px against 3,147px
#   · 4 rules at 2px each removes 8 of 260 rows, dropping a "full-height" column
#     to 96.9% and under the 98% frame gate; on a real 1122px sheet that same
#     furniture costs 1%
#
# Real borders are 1px (see the reference fixtures), so that is what is drawn.


def blank() -> np.ndarray:
    return np.zeros((H, W), np.uint8)


def figures(alpha: np.ndarray, row_y: tuple[int, int], xs: list[tuple[int, int]]) -> None:
    y0, y1 = row_y
    for x0, x1 in xs:
        alpha[y0:y1, x0:x1] = INK


def two_rows(gap: int = 20) -> np.ndarray:
    a = blank()
    figures(a, (20, 100), [(20, 80), (100, 160), (180, 240), (260, 320)])
    figures(a, (100 + gap, 220), [(20, 80), (100, 160), (180, 240)])
    return a


class TestBands:
    def test_merges_gaps_under_min_gap(self) -> None:
        p = np.zeros(60, bool)
        p[10:20] = True
        p[20 + MIN_GAP - 1 : 40] = True  # separated by less than MIN_GAP
        assert len(bands(p)) == 1

    def test_splits_on_a_real_gap(self) -> None:
        p = np.zeros(60, bool)
        p[0:20] = True
        p[20 + MIN_GAP + 2 : 55] = True
        assert len(bands(p)) == 2


class TestSlicing:
    def test_ragged_rows_with_no_hints(self) -> None:
        rows = slice_sheet(two_rows())
        assert [len(r.cells) for r in rows] == [4, 3]

    def test_an_indented_row_keeps_its_count(self) -> None:
        a = blank()
        figures(a, (20, 100), [(20, 80), (100, 160), (180, 240), (260, 320)])
        figures(a, (120, 220), [(140, 200), (220, 280)])  # starts far right
        assert [len(r.cells) for r in slice_sheet(a)] == [4, 2]

    def test_a_caption_band_is_not_a_row(self) -> None:
        a = two_rows()
        a[232:240, 40:120] = INK  # short lettering band under the rows
        rows = slice_sheet(a)
        assert [len(r.cells) for r in rows] == [4, 3], "the caption imported as a row"

    def test_cells_tighten_to_their_own_ink(self) -> None:
        # The band is the union across the row; a crouched pose is shorter.
        a = blank()
        figures(a, (20, 100), [(20, 80)])
        figures(a, (60, 100), [(100, 160)])  # half height
        rows = slice_sheet(a)
        (c0, c1) = rows[0].cells[0], rows[0].cells[1]
        assert c0[1] == 20 and c1[1] == 60, "a short pose was given the band's height"


class TestRuledLines:
    """A rule is SPANNING, NARROW, and CONTIGUOUS. Each was learned the hard way."""

    def test_a_ruled_sheet_still_slices(self) -> None:
        # A real ruled sheet is a TABLE: verticals run the sheet's full height and
        # horizontals its full width. That is what makes the row profile never
        # break — a ruled 5-row sheet with an outer frame once sliced to a single
        # row of 3 — and it is why the frame pass strips near-full-height columns
        # before the row profile is taken.
        a = two_rows()
        for y in (18, 100, 118, 222):
            a[y, :] = INK
        for x in (18, 98, 178, 258, 338):
            a[:, x] = INK
        assert [len(r.cells) for r in slice_sheet(a)] == [4, 3]

    def test_a_figure_core_is_not_a_vertical_rule(self) -> None:
        # A figure's solid core spans its whole band. A height-only test erased
        # 176 of 176 columns and sliced an unruled sheet to NOTHING.
        rows = slice_sheet(two_rows())
        assert sum(len(r.cells) for r in rows) == 7

    def test_a_row_of_BROAD_creatures_is_not_a_ruled_line(self) -> None:
        # Five wide figures reach 73% TOTAL ink on their widest scanlines, over the
        # 70% threshold, so those rows were erased as borders and the cells came
        # back a third of their true height. Contiguity separates them: a rule is
        # ~100% contiguous, five figures are ~15%.
        a = blank()
        figures(a, (40, 200), [(b * 78, b * 78 + 68) for b in range(5)])
        rows = slice_sheet(a)
        assert len(rows) == 1 and len(rows[0].cells) == 5
        x0, y0, x1, y1 = rows[0].cells[0]
        assert y1 - y0 + 1 >= 150, "the widest scanlines were erased as a rule"

    def test_ANTI_VACUITY_a_real_full_width_rule_is_still_stripped(self) -> None:
        # If the rule test were simply disabled, this row would weld into one cell.
        a = blank()
        figures(a, (40, 200), [(b * 78, b * 78 + 68) for b in range(5)])
        a[118, :] = INK
        assert len(slice_sheet(a)[0].cells) == 5


class TestMask:
    def test_the_mask_excludes_stripped_rules(self) -> None:
        # The gutter check measures THIS, so a border left in it would read as ink
        # sitting between two frames.
        a = two_rows()
        a[118, :] = INK
        d = slice_sheet_detail(a)
        assert d.mask[118, 200] == 0, "a stripped rule survived into the mask"
        assert d.mask[60, 40] == 1, "art is missing from the mask"


def test_equal_cells_divides_the_ink_extent() -> None:
    rows = slice_sheet(two_rows())
    cells = equal_cells(rows[0], 4)
    assert len(cells) == 4
    assert cells[0][0] == min(c[0] for c in rows[0].cells)
    assert cells[-1][2] == max(c[2] for c in rows[0].cells)


def test_an_opaque_sheet_collapses_to_one_cell() -> None:
    # The caller's guard depends on this being detectable rather than plausible.
    a = np.full((H, W), INK, np.uint8)
    rows = slice_sheet(a)
    assert sum(len(r.cells) for r in rows) <= 1
