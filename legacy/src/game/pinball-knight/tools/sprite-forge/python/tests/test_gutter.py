"""
The gutter gate's first validation was WRONG, and these tests exist in the shape
they do because of it.

That validation measured the CLEAN sheet's cell rects against the DIRTY sheet's
pixels and reported 45.6%. At import time those rects do not exist — a bridging
wall makes the slicer return four cells and no gutter to measure. So the
load-bearing case here is `test_it_fires_on_a_bridge_the_slicer_MERGED`: the
defect must be caught from what the pipeline actually holds, not from an oracle
it will never have.
"""

from __future__ import annotations

import numpy as np
import pytest

from spriteforge.gutter import FAIL_PCT, gutter_report
from spriteforge.slice import slice_sheet_detail

W, H = 800, 220
INK = 255
PITCH = 150


def row_of(n: int, *, bridge: tuple[int, str] | None = None) -> np.ndarray:
    """`n` figures at a fixed pitch, optionally bridged at one seam.

    `bridge` is `(seam_index, "beam" | "wall")` — a beam crosses the whole gap,
    a wall fills only part of it and sits against one figure.
    """
    a = np.zeros((H, W), np.uint8)
    for i in range(n):
        x = 30 + i * PITCH
        a[40:180, x : x + 100] = INK  # 100 wide, 50 gap
    if bridge:
        seam, kind = bridge
        g0 = 30 + seam * PITCH + 100
        if kind == "beam":
            a[100:120, g0 : g0 + 50] = INK  # crosses the full gap
        else:
            a[40:180, g0 : g0 + 22] = INK  # hugs the left figure
    return a


def report(a: np.ndarray, clips: list[str] | None = None, **kw):
    d = slice_sheet_detail(a)
    return d, gutter_report(d.mask, d.rows, clips, **kw)


class TestClean:
    def test_a_clean_row_has_empty_seams(self) -> None:
        _, r = report(row_of(5))
        assert r.failures == []
        assert all(s.pct == 0 for row in r.rows for s in row.seams)
        assert "clean" in r.verdict

    def test_pitch_is_the_median_of_cell_origin_deltas(self) -> None:
        _, r = report(row_of(5))
        assert r.pitch == PITCH

    def test_expected_count_matches_what_was_found(self) -> None:
        _, r = report(row_of(5))
        assert r.rows[0].expected == 5 and r.rows[0].found == 5

    def test_a_single_cell_row_has_no_seams_and_does_not_fail(self) -> None:
        a = np.zeros((H, W), np.uint8)
        a[40:180, 30:130] = INK
        _, r = report(a)
        assert r.failures == []


class TestFires:
    def test_it_fires_on_a_bridge_the_slicer_MERGED(self) -> None:
        # THE case. The beam welds two cells, so the gutter that would have held
        # it does not exist in the returned rects — the seam has to come from the
        # nominal pitch instead.
        d, r = report(row_of(5, bridge=(2, "beam")), ["walk"])
        assert len(d.rows[0].cells) == 4, "fixture: the bridge did not actually merge two cells"
        assert r.rows[0].expected == 5, "the pitch failed to survive the merge"
        assert r.failures, "a bridged seam was not caught"
        assert "seam 2" in r.failures[0]
        assert "MERGED" in r.failures[0], "the merge itself should be named"

    def test_the_pitch_survives_the_merge_that_poisons_it(self) -> None:
        # A merged pair contributes one huge delta. The MEDIAN must ignore it, or
        # the seams land nowhere near the frames.
        _, clean = report(row_of(5))
        _, dirty = report(row_of(5, bridge=(2, "beam")))
        assert dirty.pitch == clean.pitch

    def test_ANTI_VACUITY_the_same_sheet_without_the_bridge_is_silent(self) -> None:
        # Proves the bridge is what moved the number, not the fixture's geometry.
        _, clean = report(row_of(5))
        _, dirty = report(row_of(5, bridge=(2, "beam")))
        assert clean.failures == [] and dirty.failures != []

    def test_allow_silences_one_seam_and_only_that_seam(self) -> None:
        a = row_of(6, bridge=(2, "beam"))
        g0 = 30 + 4 * PITCH + 100
        a[100:120, g0 : g0 + 50] = INK  # a second bridge, at seam 4
        _, r = report(a, allow=[(0, 2)])
        assert r.failures, "allowing one seam silenced the other"
        assert all("seam 2" not in f for f in r.failures)


class TestKnownLimit:
    """Characterisation, not a bug. Pinned so nobody claims coverage it lacks."""

    def test_a_wall_ABSORBED_into_a_cell_is_NOT_caught(self) -> None:
        # The real wall sat beside a frog rather than between two, and the slicer
        # absorbed it into that frog's cell — walk[3] came back (847, 1049) where
        # the clean frog is (847, 984). Every gutter then measures a genuine 0%.
        #
        # This gate covers the BRIDGING class. The absorbed class needs the
        # generation rule and the contact sheet, which is what caught it.
        d, r = report(row_of(5, bridge=(2, "wall")))
        assert len(d.rows[0].cells) == 5, "fixture: the wall bridged instead of being absorbed"
        widest = max(c[2] - c[0] + 1 for c in d.rows[0].cells)
        assert widest > 110, "fixture: the wall was not absorbed into a cell"
        assert r.failures == [], "if this now fires, the gate grew coverage — update the docstring"

    def test_the_probe_slides_to_the_EMPTIEST_window(self) -> None:
        # Why the absorbed case escapes, stated as behaviour: a partly-filled gap
        # still has an empty slice, and sliding to it is what removed a 23% false
        # positive on clean art. The trade is deliberate.
        a = row_of(5)
        g0 = 30 + 1 * PITCH + 100
        a[40:180, g0 : g0 + 20] = INK  # fills part of a gap, leaving 30px clear
        _, r = report(a)
        assert r.rows[0].seams[1].pct == 0.0


def test_threshold_is_an_absolute_floor_not_a_split() -> None:
    # The clean population is exactly 0.00%, so there is nothing to split the
    # difference with; 3% absorbs fringe and a stray fragment.
    assert FAIL_PCT == pytest.approx(0.03)
    _, r = report(row_of(5))
    assert max((s.pct for row in r.rows for s in row.seams), default=0) == 0.0

