"""
Resample and palette snap.

The resample's job is to COMMIT continuous art to a grid without inventing
colours, so the load-bearing cases are: an exact integer reduction must be
lossless, and a two-colour block must not average into a third colour that is in
neither half.

The palette module's job is to hold no palette. That is asserted directly.
"""

from __future__ import annotations

import numpy as np
import pytest

from spriteforge import palette as P
from spriteforge.resample import resample_cell

RED = (200, 40, 40)
CREAM = (240, 230, 200)


def solid(w: int, h: int, rgb: tuple[int, int, int], a: int = 255) -> np.ndarray:
    img = np.zeros((h, w, 4), np.uint8)
    img[..., :3] = rgb
    img[..., 3] = a
    return img


def half_and_half(w: int, h: int) -> np.ndarray:
    """Left half RED, right half CREAM — the block that must not become mauve."""
    img = solid(w, h, RED)
    img[:, w // 2 :, :3] = CREAM
    return img


class TestResample:
    @pytest.mark.parametrize("strategy", ["box", "dominant", "kcentroid", "nearest"])
    def test_a_flat_cell_survives_every_strategy(self, strategy: str) -> None:
        out = resample_cell(solid(64, 64, RED), 16, 16, strategy)
        assert (out[..., :3] == RED).all(), f"{strategy} invented a colour on flat input"
        assert (out[..., 3] == 255).all()

    @pytest.mark.parametrize("strategy", ["box", "dominant", "kcentroid"])
    def test_an_exact_integer_reduction_is_lossless(self, strategy: str) -> None:
        # 64 -> 16 is exactly 4:1, so every destination texel covers one flat 4x4
        # block. Anything but the source colour is the filter inventing.
        src = np.zeros((64, 64, 4), np.uint8)
        src[..., 3] = 255
        for by in range(16):
            for bx in range(16):
                src[by * 4 : by * 4 + 4, bx * 4 : bx * 4 + 4, :3] = (bx * 15, by * 15, 90)
        out = resample_cell(src, 16, 16, strategy)
        for by in range(16):
            for bx in range(16):
                assert tuple(out[by, bx, :3]) == (bx * 15, by * 15, 90), strategy

    def test_kcentroid_PICKS_A_SIDE_where_box_averages(self) -> None:
        # The whole reason k-centroid is the default: a red/cream texel should
        # come out red or cream, not the mauve in between that the snap then has
        # to guess at.
        blk = half_and_half(8, 8)
        box = resample_cell(blk, 1, 1, "box")[0, 0, :3]
        kc = resample_cell(blk, 1, 1, "kcentroid")[0, 0, :3]
        assert tuple(kc) in (RED, CREAM), f"k-centroid averaged to {tuple(kc)}"
        assert tuple(box) not in (RED, CREAM), "fixture: box did not average, so nothing is proven"

    def test_alpha_is_the_area_average_whatever_the_strategy(self) -> None:
        img = solid(8, 8, RED, a=255)
        img[:, 4:, 3] = 0  # half transparent
        for s in ("box", "dominant", "kcentroid"):
            assert resample_cell(img, 1, 1, s)[0, 0, 3] == pytest.approx(128, abs=2), s

    def test_a_fully_transparent_cell_stays_transparent(self) -> None:
        out = resample_cell(solid(8, 8, RED, a=0), 2, 2, "kcentroid")
        assert (out[..., 3] == 0).all()


class TestPaletteHoldsNothing:
    def test_the_module_exposes_no_palette_constant(self) -> None:
        # The failure that deleted the predecessor: it carried its own copy of a
        # palette and reported confident nonsense once the real one moved.
        suspects = [
            n
            for n in dir(P)
            if n.isupper() and isinstance(getattr(P, n), (list, tuple, np.ndarray)) and n != "LUMA"
        ]
        assert suspects == [], f"spriteforge.palette is holding a palette: {suspects}"

    def test_snap_requires_one_to_be_passed(self) -> None:
        with pytest.raises(TypeError):
            P.snap(solid(4, 4, RED))  # type: ignore[call-arg]


class TestSnap:
    PAL = ["#000000", "#c82828", "#f0e6c8", "#ffffff"]

    def test_accepts_hex_strings_ints_and_triples(self) -> None:
        a = P.as_array(["#c82828"])
        b = P.as_array([0xC82828])
        c = P.as_array([(200, 40, 40)])
        assert a.tolist() == b.tolist() == [[200, 40, 40]]
        assert c.tolist() == [[200, 40, 40]]

    def test_every_opaque_pixel_lands_ON_the_palette(self) -> None:
        out = P.snap(half_and_half(8, 8), self.PAL)
        pal = {tuple(c) for c in P.as_array(self.PAL)}
        assert {tuple(c) for c in out[..., :3].reshape(-1, 3)} <= pal

    def test_alpha_is_binarised(self) -> None:
        img = solid(4, 4, RED, a=200)
        img[0, 0, 3] = 100  # below the cutoff
        out = P.snap(img, self.PAL)
        assert set(np.unique(out[..., 3]).tolist()) <= {0, 255}
        assert out[0, 0, 3] == 0

    def test_lab_and_luma_agree_on_easy_colours(self) -> None:
        # They diverge by ~2.4% on real art; on unambiguous input they must agree,
        # or one of them is simply wrong.
        img = solid(4, 4, (0, 0, 0))
        assert (P.snap(img, self.PAL, "luma") == P.snap(img, self.PAL, "lab")).all()


class TestEviction:
    PAL = [f"#{v:02x}{v:02x}{v:02x}" for v in range(0, 256, 8)]  # 32 greys

    def build(self) -> np.ndarray:
        img = np.zeros((1, 32, 4), np.uint8)
        img[..., 3] = 255
        # 32 distinct entries with wildly different coverage: entry i gets i+1 px.
        img[0, :, :3] = P.as_array(self.PAL)
        return np.repeat(img, 40, axis=0)

    def test_it_reaches_the_budget_by_construction(self) -> None:
        out, info = P.evict_to(P.snap(self.build(), self.PAL), self.PAL, 8)
        assert info["entries"] <= 8
        assert len({tuple(c) for c in out[..., :3].reshape(-1, 3)}) <= 8

    def test_a_budget_that_already_fits_changes_nothing(self) -> None:
        src = P.snap(self.build(), self.PAL)
        out, info = P.evict_to(src, self.PAL, 64)
        assert info["evicted"] == 0 and info["moved_share"] == 0.0
        assert (out == src).all()

    def test_it_reports_how_much_it_MOVED(self) -> None:
        # An eviction nobody saw is how a creature quietly loses its costume.
        _, info = P.evict_to(P.snap(self.build(), self.PAL), self.PAL, 4)
        assert info["evicted"] > 0
        assert 0.0 < info["moved_share"] <= 1.0


def test_an_empty_palette_is_refused_at_the_boundary() -> None:
    # A caller whose extraction pattern matched nothing gets an empty list. Without
    # this guard the failure surfaces frames later as a numpy broadcast error that
    # says nothing about the real mistake — and since the palette always comes from
    # outside, the boundary is exactly where it has to be caught.
    for empty in ([], (), np.zeros((0, 3), np.uint8)):
        with pytest.raises(ValueError, match="empty palette"):
            P.as_array(empty)
