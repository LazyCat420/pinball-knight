"""
PARITY WITH THE TYPESCRIPT ALONGSIDE IT.

A port that merely runs is not a port. These pin the Python against numbers the
TypeScript produces on the sheets that actually ship, so a rewrite that quietly
changes behaviour fails here rather than in someone's game.

The package now lives inside the game repo (`tools/sprite-forge/python/`), so
the reference sheets resolve by relative path and the suite runs with no setup.
`SPRITEFORGE_REF_SHEETS` still overrides, for using the package standalone.

RE-PINNING. Every number below came from the TypeScript, never from this port —
`sprite-forge/oracle.mjs` prints them. When a sheet is regenerated these go
stale and fail; the fix is to re-run the oracle and paste, NOT to paste what
Python said. A pin the port writes itself proves nothing.

Last re-pinned 2026-08-03, after jester and beaver were regenerated on 08-02 and
left the original 08-01 pins measuring sheets that no longer existed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from spriteforge.grid import detect_pixel_grid
from spriteforge.matte import matte, rgb_hex
from spriteforge.gutter import gutter_report
from spriteforge.slice import slice_sheet_detail

#: tests/ → python/ → sprite-forge/ → tools/ → pinball-knight/ → game/ → src/ → repo
_REPO = Path(__file__).resolve().parents[7]

REF = Path(os.environ.get("SPRITEFORGE_REF_SHEETS", _REPO / "public" / "sprites"))

# (best factor, its confidence %, cell purity %) as the TypeScript reports them.
#
# `flat_share` is deliberately NOT pinned: the port measures it over OPAQUE pairs
# only, where the TS counts every pair. See `_flat_share` — the TS number depends
# on an in-memory buffer keeping RGB under alpha=0, which a PNG round trip
# destroys, and the divergence fixes a latent gate bug rather than causing one.
#
# That divergence now reaches the VERDICT STRING, which an earlier version of
# this file claimed could never drift. On jester and beaver the TS reads 62%/66%
# flat neighbours and says "NO BLOCK GRID, but … NATIVE"; the port reads 7%/1%
# over opaque pixels and says "NOT PIXEL ART". Both refuse the sheet, which is
# the decision anyone acts on — so `gridded` is pinned and the wording is not.
EXPECTED = {
    "jester": (3, 1.365, 19.781),
    "beaver": (13, 0.278, 1.599),
    "frog": (4, 2.060, 7.898),
}


def _load(name: str) -> tuple[np.ndarray, list[tuple[int, int, int, int]]]:
    manifest = json.loads((REF / f"{name}-S.json").read_text())
    img = np.asarray(Image.open(REF / f"{name}-S.png").convert("RGBA"))
    boxes = [tuple(c) for row in manifest["rows"] for c in row["cells"]]
    return img, boxes


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_matches_the_typescript_gate(name: str) -> None:
    if not (REF / f"{name}-S.png").exists():
        pytest.skip(f"reference sheets not present at {REF}")
    want_factor, want_conf, want_purity = EXPECTED[name]
    img, boxes = _load(name)
    r = detect_pixel_grid(img, boxes)

    top = max(r.scores, key=lambda s: s[1])
    assert top[0] == want_factor, f"{name}: best factor drifted"
    assert top[1] * 100 == pytest.approx(want_conf, abs=0.15), f"{name}: confidence drifted"
    assert r.cell_purity * 100 == pytest.approx(want_purity, abs=0.1), f"{name}: cell purity drifted"

    # The decision, as opposed to the wording of it.
    assert not r.gridded


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_flatness_measures_art_not_empty_space(name: str) -> None:
    """The divergence, pinned so it cannot silently revert.

    Counting transparent pairs put the jester at 34% where its ART is 1.7%, and
    `NATIVE_FLAT_SHARE` is a 0.55 gate — a sparse sheet could have crossed it on
    empty space alone.
    """
    if not (REF / f"{name}-S.png").exists():
        pytest.skip(f"reference sheets not present at {REF}")
    img, boxes = _load(name)
    r = detect_pixel_grid(img, boxes)
    assert r.flat_share < 0.10, f"{name}: flatness is counting the empty field again"


#: The raw frog sheet, before matting — the case the matte exists for. This is
#: the committed inbox source, one directory up, so it cannot go missing the way
#: its predecessor did (a /tmp scratch path, deleted, skipping silently ever
#: since).
RAW_FROG = Path(
    os.environ.get("SPRITEFORGE_RAW_FROG", Path(__file__).resolve().parents[2] / "inbox" / "frog-S.png")
)


def test_matte_matches_the_typescript() -> None:
    """TS reports: bg #fdfdfd (100% of the border) — keyed 74.2%, 1241 pockets."""
    if not RAW_FROG.exists():
        pytest.skip(f"raw sheet not present at {RAW_FROG}")
    img = np.asarray(Image.open(RAW_FROG).convert("RGBA"))
    _, rep = matte(img)
    assert rgb_hex(rep.bg) == "#fdfdfd"
    assert rep.bg_confidence * 100 == pytest.approx(100, abs=0.5)
    assert rep.keyed_pct * 100 == pytest.approx(74.2, abs=0.1)
    assert len(rep.enclosed) == 1241
    assert rep.failures == []


#: What the TypeScript slicer itself returns, written by `sprite-forge/oracle.mjs`.
#:
#: NOT the shipped `public/sprites/<name>-S.json`, which this used to compare
#: against and which is a different quantity: jester and beaver carry a `cells`
#: override in their sidecar, so their manifest holds `equal_cells` rects — each
#: band re-divided into N equal parts — where the slicer returns the bands it
#: actually found. The two coincide only on a sheet with no override (frog), and
#: the old assertion passed for years on that coincidence.
ORACLE = json.loads((Path(__file__).with_name("typescript-oracle.json")).read_text())


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_slicer_reproduces_every_cell_rect(name: str) -> None:
    """Not just the same SHAPE — the same rects, to the pixel.

    Cell counts can match while every rect is a few pixels off, which then moves
    every downstream number. All 56 rects across the three sheets are identical.
    """
    if not (REF / f"{name}-S.png").exists():
        pytest.skip(f"reference sheets not present at {REF}")
    img = np.asarray(Image.open(REF / f"{name}-S.png").convert("RGBA"))
    rows = slice_sheet_detail(img[..., 3]).rows
    assert [len(r.cells) for r in rows] == ORACLE[name]["shape"]

    want = [tuple(c) for c in ORACLE[name]["cells"]]
    got = [c for r in rows for c in r.cells]
    assert got == want, f"{name}: cell rects drifted from the TypeScript"


#: Row order as the inbox sidecars declare it — `<name>-S.json` next to the sheet.
CLIPS = {
    "jester": ["idle", "walk", "attack", "stumble", "death"],
    "beaver": ["idle", "walk", "attack", "death"],
    "frog": ["idle", "walk", "attack", "death"],
}


@pytest.mark.parametrize("name", sorted(CLIPS))
def test_shipped_sheets_have_clean_gutters(name: str) -> None:
    """The floor the gate's threshold is set against: exactly zero, on real art."""
    if not (REF / f"{name}-S.png").exists():
        pytest.skip(f"reference sheets not present at {REF}")
    img = np.asarray(Image.open(REF / f"{name}-S.png").convert("RGBA"))
    d = slice_sheet_detail(img[..., 3])
    r = gutter_report(d.mask, d.rows, CLIPS[name])
    assert r.failures == [], r.failures
    worst = max((s.pct for row in r.rows for s in row.seams), default=0.0)
    assert worst == 0.0, f"{name}: worst clean seam is {worst:.3%}, not 0"


def test_it_catches_a_bridge_across_a_seam() -> None:
    """The positive control: a clean sheet is only evidence once a dirty one fails.

    The original fixture was the pre-fix frog, whose attack row carried a laser
    beam across a gap and merged two frames — the defect the gutter check was
    built for. That sheet is gone: it lived only in a scratch directory, the
    repaired frog replaced it in `inbox/`, and no commit of `public/sprites/`
    holds the raw pre-matte version. Recovering it was tried and failed.

    So the bridge is PAINTED here instead, onto the real frog, at a seam the
    slicer itself locates. That makes this a weaker witness than the sheet it
    replaces — it proves the detector fires on an occupied gap, not that it
    would have caught that specific beam. `test_shipped_sheets_have_clean_gutters`
    is the other half; neither is worth much alone.
    """
    if not RAW_FROG.exists():
        pytest.skip(f"raw sheet not present at {RAW_FROG}")
    img = np.asarray(Image.open(RAW_FROG).convert("RGBA"))
    matted, _ = matte(img)

    clean = slice_sheet_detail(matted[..., 3])
    assert [len(x.cells) for x in clean.rows] == [5, 5, 5, 5], "the frog changed; re-derive the seam"

    # Bridge the gap between attack frames 1 and 2. Cells are [x0, y0, x1, y1].
    attack = clean.rows[CLIPS["frog"].index("attack")]
    left, right = attack.cells[1], attack.cells[2]
    x0, x1 = left[2] + 1, right[0]
    assert x1 > x0, "those two attack frames already touch; nothing to bridge"
    y = (left[1] + left[3]) // 2
    matted[y - 3 : y + 3, x0:x1] = (255, 255, 255, 255)

    d = slice_sheet_detail(matted[..., 3])
    r = gutter_report(d.mask, d.rows, CLIPS["frog"])
    assert r.failures, "a solid bar across a seam was not caught"
    assert any("attack" in f for f in r.failures), r.failures
