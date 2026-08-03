"""
The matte's whole claim is that background is a REGION, not a colour.

That claim only means something if a background-coloured pixel the fill cannot
REACH survives. So the load-bearing case here is a white glove on a white field:
a colour key deletes it, a flood fill keeps it. Everything else is the guard
rails around that.
"""

from __future__ import annotations

import numpy as np
import pytest

from spriteforge.matte import (
    AUTO_KEY_AREA,
    DEFAULT_TOLERANCE,
    estimate_background,
    matte,
    rgb_hex,
)

W = H = 400
BG = (253, 253, 253)
INK = (20, 20, 24)


#: A "glove": a small background-coloured pocket sealed inside the art.
#:
#: Sized against AUTO_KEY_AREA the way a real one is. On a 1.57M px sheet the
#: 0.2% threshold is 3,147 px and a real glove measured 120 px — so the fixture
#: keeps the same relationship rather than the same absolute size, or the pocket
#: auto-keys and the test measures the wrong thing.
GLOVE = (192, 208)  # 16x16 = 256 px, against a 320 px threshold


def sheet(*, two_tone: bool = False) -> np.ndarray:
    """A white field with one outlined blob that has a small WHITE hole in it."""
    img = np.zeros((H, W, 4), np.uint8)
    img[..., :3] = BG
    img[..., 3] = 255
    if two_tone:
        # The checkerboard real sheets arrive with: one alternates 252/243.
        img[::2, ::2, :3] = (243, 243, 243)
    img[100:300, 100:300, :3] = INK
    a, b = GLOVE
    img[a:b, a:b, :3] = BG  # unreachable from the border
    return img


class TestEstimate:
    def test_finds_the_field_colour(self) -> None:
        bg, conf, _ = estimate_background(sheet())
        assert bg == BG
        assert conf == pytest.approx(1.0)

    def test_a_two_tone_checkerboard_is_still_confident(self) -> None:
        # Counting the modal bucket says "no dominant colour" for a background
        # that is perfectly keyable. Real sheets measured 44% and 53% by mode and
        # 84%/100% within a tolerance of 8 — confidence must follow TOLERANCE.
        _, conf, _ = estimate_background(sheet(two_tone=True))
        assert conf > 0.95

    def test_suggests_a_tolerance_that_would_work(self) -> None:
        img = sheet()
        # A field that needs more headroom than the caller allowed.
        img[:, :, :3] = np.where(
            (np.arange(W)[None, :, None] % 7 == 0), np.array([200, 200, 200], np.uint8), img[:, :, :3]
        )
        _, _, suggested = estimate_background(img, tol=1)
        assert suggested > 1


class TestFloodFill:
    def test_an_enclosed_white_hole_SURVIVES(self) -> None:
        # The reason this is a fill and not a colour key. A global key at any
        # tolerance deletes this; connectivity protects it at every tolerance.
        out, rep = matte(sheet())
        assert out[200, 200, 3] == 255, "the enclosed 'glove' was keyed — this is a colour key, not a fill"
        assert out[2, 2, 3] == 0, "the border field was not keyed"
        assert rep.failures == []
        assert len(rep.enclosed) == 1

    def test_it_survives_a_generous_tolerance_too(self) -> None:
        # Connectivity is the guard, not distance — so raising tolerance must not
        # start eating enclosed art.
        out, _ = matte(sheet(), tolerance=DEFAULT_TOLERANCE * 2)
        assert out[200, 200, 3] == 255

    def test_key_enclosed_opens_a_named_pocket(self) -> None:
        out, rep = matte(sheet(), key_enclosed=[(200, 200)])
        assert out[200, 200, 3] == 0
        assert rep.enclosed == []

    def test_a_big_pocket_is_auto_keyed_but_keep_enclosed_holds_it(self) -> None:
        # A ruled sheet seals every cell; those interiors are background and must
        # go. But the author gets the last word.
        img = sheet()
        auto = matte(img, auto_key_area=0.0005)[1]
        assert len(auto.auto_keyed) == 1 and auto.enclosed == []
        held = matte(img, auto_key_area=0.0005, keep_enclosed=[(200, 200)])[1]
        assert held.auto_keyed == [] and len(held.enclosed) == 1


class TestRefusals:
    def test_refuses_when_almost_nothing_was_removed(self) -> None:
        img = np.zeros((H, W, 4), np.uint8)
        img[..., :3] = INK  # no background at all
        img[..., 3] = 255
        _, rep = matte(img)
        assert any("was removed" in f for f in rep.failures)

    def test_refuses_when_the_tolerance_eats_the_art(self) -> None:
        _, rep = matte(sheet(), tolerance=400)
        assert any("eating the art" in f for f in rep.failures)

    def test_refuses_a_gradient_it_cannot_key(self) -> None:
        img = np.zeros((H, W, 4), np.uint8)
        img[..., 3] = 255
        img[..., :3] = np.linspace(0, 255, W, dtype=np.uint8)[None, :, None]
        _, rep = matte(img)
        assert any("cannot be keyed" in f for f in rep.failures)

    def test_an_explicit_bg_suppresses_the_confidence_refusal(self) -> None:
        # The caller has overridden the guess, so second-guessing them is noise.
        img = np.zeros((H, W, 4), np.uint8)
        img[..., 3] = 255
        img[..., :3] = np.linspace(0, 255, W, dtype=np.uint8)[None, :, None]
        _, rep = matte(img, bg=(0, 0, 0), tolerance=200)
        assert not any("cannot be keyed" in f for f in rep.failures)


def test_input_is_not_modified() -> None:
    img = sheet()
    before = img.copy()
    matte(img)
    assert np.array_equal(img, before), "matte mutated its input; the UI re-runs against one source"


def test_rgb_hex() -> None:
    assert rgb_hex((253, 253, 253)) == "#fdfdfd"
    assert rgb_hex((0, 0, 0)) == "#000000"
