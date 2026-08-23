"""
The gate has to be able to FAIL, and it has to fail on the right thing.

A detector that says "gridded" for everything would sail through a suite that
only ever feeds it good input, and the real sheets -- which have no grid at all --
would have been declared 1:1 capable. So every case below runs both arms:
synthetic xN pixel art must be detected AT N, and synthetic continuous art must
be REJECTED.

The last test is the one that matters for a PORT: the numbers this produces on
the three real sheets must match the TypeScript pipeline it was extracted from.
A port that merely runs is not a port.
"""

from __future__ import annotations

import numpy as np
import pytest

from spriteforge.grid import (
    GRID_CONFIDENCE,
    block_reduce,
    cell_purity,
    detect_pixel_grid,
)

W = 96
BOX = (0, 0, W - 1, W - 1)


def gridded(n: int) -> np.ndarray:
    """Pixel art authored at W/n logical pixels and upscaled xn -- hard blocks."""
    L = W // n
    img = np.zeros((W, W, 4), np.uint8)
    for py in range(L):
        for px in range(L):
            v = ((px * 37 + py * 91) % 6) * 42
            img[py * n : (py + 1) * n, px * n : (px + 1) * n] = (v, (v * 3) % 255, (v * 7) % 255, 255)
    return img


def continuous() -> np.ndarray:
    """A smooth gradient plus noise -- what a generator actually produces."""
    rng = np.random.default_rng(7)
    x = np.arange(W)[None, :].repeat(W, 0)
    g = (x / W) * 200 + rng.random((W, W)) * 55
    img = np.zeros((W, W, 4), np.uint8)
    img[..., 0] = g
    img[..., 1] = 255 - g
    img[..., 2] = (g * 2) % 255
    img[..., 3] = 255
    return img


class TestDetection:
    @pytest.mark.parametrize("n", [4, 6, 8])
    def test_finds_the_lattice_at_n(self, n: int) -> None:
        r = detect_pixel_grid(gridded(n), [BOX])
        assert r.gridded, r.verdict
        # The LARGEST passing factor, not a divisor of it: a x8 sheet is also
        # perfectly aligned to 2 and 4, and reducing by 4 would leave the art at
        # twice its authored resolution.
        assert r.factor == n, r.verdict
        assert r.confidence >= GRID_CONFIDENCE

    def test_rejects_continuous_art(self) -> None:
        r = detect_pixel_grid(continuous(), [BOX])
        assert not r.gridded, r.verdict
        assert r.factor == 1
        assert "NOT PIXEL ART" in r.verdict

    def test_no_candidate_scores_well_on_a_gradient(self) -> None:
        # Anti-vacuity for the case above: assert the whole score curve is low,
        # so a future threshold change cannot quietly let this through.
        r = detect_pixel_grid(continuous(), [BOX])
        assert max(c for _, c in r.scores) < GRID_CONFIDENCE


class TestCellPurity:
    @pytest.mark.parametrize("n", [4, 6, 8])
    def test_is_one_on_true_pixel_art(self, n: int) -> None:
        r = detect_pixel_grid(gridded(n), [BOX])
        assert r.purity_factor == n
        assert r.cell_purity > 0.99, r.cell_purity

    def test_collapses_on_continuous_art(self) -> None:
        r = detect_pixel_grid(continuous(), [BOX])
        assert r.cell_purity < 0.3, r.cell_purity
        assert "Cell purity" in r.verdict

    def test_separates_the_two_by_a_wide_margin(self) -> None:
        # Without this the thresholds above could both pass on a metric that is
        # simply small everywhere, or large everywhere.
        good = detect_pixel_grid(gridded(8), [BOX]).cell_purity
        bad = detect_pixel_grid(continuous(), [BOX]).cell_purity
        assert good - bad > 0.6


class TestBlockReduce:
    def test_is_exact_on_true_pixel_art(self) -> None:
        n = 6
        src = gridded(n)
        out = block_reduce(src, n)
        assert out.shape[:2] == (W // n, W // n)
        for y in range(out.shape[0]):
            for x in range(out.shape[1]):
                assert tuple(out[y, x]) == tuple(src[y * n, x * n])

    def test_keeps_the_intended_colour_despite_a_stray(self) -> None:
        # Majority, not average: an average would invent a colour in neither the
        # block's fill nor its stray, and the palette snap would then guess.
        n = 4
        src = gridded(n)
        fill = tuple(src[0, 0])
        src[1, 1] = (255, 255, 255, 255)
        assert tuple(block_reduce(src, n)[0, 0]) == fill


def test_purity_ignores_partial_blocks() -> None:
    # A block straddling the silhouette is mostly background and would score as
    # pure for the wrong reason.
    img = gridded(8)
    img[:, : W // 2, 3] = 0  # key the left half
    assert cell_purity(img, 8, [BOX]) > 0.99
