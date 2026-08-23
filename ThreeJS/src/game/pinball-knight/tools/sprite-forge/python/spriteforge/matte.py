"""
MATTING — an opaque generated sheet into real alpha.

The stage the pipeline was missing. Every sheet an image generator produces
arrives on an opaque white or cream field, because diffusion models have no alpha
channel to write. Slicing finds cells by alpha, so without this the sheet sees
one connected region and returns a single cell -- it never gets as far as being
wrong, it just gets rejected.

── WHY A FLOOD FILL AND NOT A COLOUR KEY ───────────────────────────────────

The obvious implementation is "make every pixel near the background colour
transparent". It is also the one that destroys the art, and generated monsters
are the worst case for it: a clown's RUFF, GLOVES, FACE and trouser stripes are
all white or near-white on a cream field, and a frog's belly is pale. A global
key punches holes through every one of them.

Background is not a colour, it is a REGION: the part of the sheet reachable from
the edge without crossing the art. So the fill starts at the border and stops at
the first outline it meets. Interior whites are unreachable and survive
untouched, with no tolerance tuning at all.

Verified on a real frog sheet: the fill removed only the two-tone near-white
checkerboard (254/243/253/244/242) and kept every outline pixel.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

Rgb = tuple[int, int, int]

#: How far from the background colour a pixel can be and still be keyed.
#:
#: GENEROUS ON PURPOSE, and safe because the guard against eating art is
#: CONNECTIVITY, not colour distance. A pixel is only keyed if the fill can walk
#: to it from the sheet edge, so art enclosed by an outline is protected at any
#: tolerance -- a clown's gloves sit 2.0 from the background and survive 40
#: untouched. Only art that is BOTH background-coloured AND unenclosed is at risk.
#:
#: Measured on a real sheet whose furniture is a grey outer frame at distance
#: 26.2: it welds into one cell at every tolerance up to 24 and slices correctly
#: at 36 and above, while the keyed share moves only 75.7% -> 78.8%. What the
#: extra tolerance removes is furniture, not art.
DEFAULT_TOLERANCE = 40

#: Enclosed pockets at least this share of the sheet are keyed automatically.
#:
#: ⚠️ A RULED SHEET SEALS EVERY CELL. The border fill stops at the frame, so each
#: cell interior is a pocket the fill can never reach -- on a reference layout
#: that is 19 boxes of ~8,000 px, and leaving them opaque means the sheet is not
#: matted at all. Size separates them from art with room to spare: a cell
#: interior measured 8,066 px against a glove's 120 px, a 67x gap, and this sits
#: ~7x from one and ~9x from the other.
AUTO_KEY_AREA = 0.002

#: The fill must reach at least this much of the border band.
#:
#: Not a loose sanity check. Measured at tolerance 12 on a real sheet: 88.8% of
#: the border was reachable and the missing 11% survived as an opaque SPECKLE
#: MESH threaded through the background, welding every cell together so the sheet
#: still sliced to one. Anything under ~0.9 fails that way.
MIN_BG_CONFIDENCE = 0.9
MIN_KEYED = 0.05
MAX_KEYED = 0.95

#: Luma weights, matching the palette snap so "near the background" and "near a
#: palette entry" cannot disagree.
_LUMA = np.array([0.3, 0.59, 0.11])


def colour_dist(a: np.ndarray, bg: Rgb) -> np.ndarray:
    """Luma-weighted distance from every pixel in `a` (…x3) to one colour."""
    d = (a.astype(np.float64) - np.asarray(bg, float)) * _LUMA
    return np.sqrt((d * d).sum(axis=-1))


def rgb_hex(bg: Rgb) -> str:
    return "#" + "".join(f"{int(v):02x}" for v in bg)


@dataclass
class EnclosedRegion:
    """A pocket of background colour the border fill could not reach."""

    #: A pixel inside it — the stable id, and what a recipe stores.
    seed: tuple[int, int]
    area: int
    bounds: tuple[int, int, int, int]


@dataclass
class MatteReport:
    bg: Rgb
    #: Share of the border ring within tolerance. Low means a busy border.
    bg_confidence: float
    #: Share of the sheet the fill removed.
    keyed_pct: float
    #: Pockets left opaque, for a human to rule on.
    enclosed: list[EnclosedRegion] = field(default_factory=list)
    #: Pockets keyed on size alone — a ruled cell's inside, or a hole through art.
    auto_keyed: list[EnclosedRegion] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    #: Non-empty means the result must not be used.
    failures: list[str] = field(default_factory=list)


def _border_band(w: int, h: int) -> np.ndarray:
    depth = max(2, min(12, round(min(w, h) * 0.01)))
    band = np.zeros((h, w), bool)
    band[:depth, :] = band[-depth:, :] = True
    band[:, :depth] = band[:, -depth:] = True
    return band


def estimate_background(
    img: np.ndarray, tol: int = DEFAULT_TOLERANCE
) -> tuple[Rgb, float, int]:
    """Guess the background colour from the border ring.

    Returns `(bg, confidence, suggested_tolerance)`.

    ⚠️ CONFIDENCE IS MEASURED BY TOLERANCE, NOT BY EXACT COLOUR. Counting the
    modal bucket's share says "no dominant colour" for a background that is
    perfectly keyable: real sheets arrive with a faint transparency CHECKERBOARD
    baked into the pixels — one alternates rgb(252)/rgb(243), another
    rgb(253)/rgb(246) — so the mode is 44% and 53% and a mode gate rejects them.
    Within a tolerance of 8 the same bands are 84% and 100% uniform. The quantity
    that matters is the one the fill actually uses.
    """
    h, w = img.shape[:2]
    band = _border_band(w, h)
    opaque = img[..., 3] > 0 if img.shape[2] == 4 else np.ones((h, w), bool)
    sel = band & opaque
    if not sel.any():
        return (0, 0, 0), 0.0, tol

    px = img[sel][:, :3].astype(np.int64)
    # Quantised to 5 bits per channel so a gently dithered field votes as ONE
    # colour instead of scattering across a hundred near-identical keys.
    keys = ((px[:, 0] >> 3) << 10) | ((px[:, 1] >> 3) << 5) | (px[:, 2] >> 3)
    vals, counts = np.unique(keys, return_counts=True)
    win = vals[counts.argmax()]
    # Average the winning bucket's MEMBERS, not the bucket centre — the centre is
    # up to 4 units off per channel, a real error to hand a tolerance test.
    members = px[keys == win]
    bg: Rgb = tuple(int(round(v)) for v in members.mean(axis=0))  # type: ignore[assignment]

    dist = colour_dist(px, bg)
    total = px.shape[0]

    def share(t: float) -> float:
        return float((dist <= t).sum()) / total

    # The smallest tolerance that would cover the band, so a failure can say what
    # to change instead of only that something is wrong.
    ladder = [4, 8, 12, 16, 24, 32, 48, 64]
    suggested = next((t for t in ladder if share(t) >= 0.95), ladder[-1])
    return bg, share(tol), suggested


def matte(
    img: np.ndarray,
    *,
    bg: Rgb | None = None,
    tolerance: int = DEFAULT_TOLERANCE,
    erode: int = 0,
    key_enclosed: list[tuple[int, int]] | None = None,
    keep_enclosed: list[tuple[int, int]] | None = None,
    auto_key_area: float = AUTO_KEY_AREA,
) -> tuple[np.ndarray, MatteReport]:
    """Key the background out of a sheet. Returns a NEW array; input untouched."""
    h, w = img.shape[:2]
    if img.shape[2] == 3:
        img = np.dstack([img, np.full((h, w), 255, np.uint8)])
    est_bg, confidence, suggested = estimate_background(img, tolerance)
    use_bg: Rgb = bg if bg is not None else est_bg

    opaque = img[..., 3] > 0
    near = opaque & (colour_dist(img[..., :3], use_bg) <= tolerance)

    # The fill, as connected components: label the background-ish mask, then any
    # component touching an edge IS the background. Equivalent to a border flood
    # fill and it cannot blow a call stack on a multi-megapixel sheet.
    lbl, n = ndimage.label(near)
    edge_labels = set(np.unique(np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])).tolist())
    edge_labels.discard(0)
    keyed = np.isin(lbl, list(edge_labels)) if edge_labels else np.zeros((h, w), bool)

    # ── Pockets of background colour the fill could not reach.
    #
    # NEVER keyed automatically beyond the size threshold. The inside of a spring
    # coil is background; a white glove is not; and both are "a
    # background-coloured region enclosed by outline". Guessing deletes the glove.
    want = {(y, x) for x, y in (key_enclosed or [])}
    hold = {(y, x) for x, y in (keep_enclosed or [])}
    auto_area = auto_key_area * w * h
    enclosed: list[EnclosedRegion] = []
    auto_keyed: list[EnclosedRegion] = []
    for lab in range(1, n + 1):
        if lab in edge_labels:
            continue
        ys, xs = np.nonzero(lbl == lab)
        if ys.size == 0:
            continue
        info = EnclosedRegion(
            seed=(int(xs[0]), int(ys[0])),
            area=int(ys.size),
            bounds=(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
        )
        members = set(zip(ys.tolist(), xs.tolist()))
        held = bool(members & hold)
        hit = bool(members & want)
        auto = (not held) and ys.size >= auto_area
        if hit or auto:
            keyed[ys, xs] = True
            if auto:
                auto_keyed.append(info)
            continue
        enclosed.append(info)

    # ── Fringe.
    #
    # A generator's edges are antialiased, so between the field and the outline
    # sits a ramp of background-tinted pixels. They survive the tolerance test,
    # then snap to whatever palette entry is nearest and ring the sprite in a
    # colour nobody authored. Erode rings of BACKGROUND-LEANING pixels — not
    # every edge pixel — to remove the ramp without shaving the outline.
    if erode:
        loose = colour_dist(img[..., :3], use_bg) <= tolerance * 3
        for _ in range(erode):
            touching = ndimage.binary_dilation(keyed) & ~keyed
            keyed |= touching & loose

    out = img.copy()
    out[keyed, 3] = 0
    keyed_pct = float(keyed.sum()) / (w * h)

    warnings: list[str] = []
    failures: list[str] = []
    if confidence < MIN_BG_CONFIDENCE and bg is None:
        hint = (
            f"Try tolerance={suggested} — that covers 95% of it."
            if suggested > tolerance
            else "Set a background colour explicitly, or re-export the sheet flat."
        )
        failures.append(
            f"only {confidence * 100:.0f}% of the border is within tolerance {tolerance} of "
            f"{rgb_hex(use_bg)} — a gradient or vignette cannot be keyed. {hint}"
        )
    if keyed_pct < MIN_KEYED:
        failures.append(
            f"only {keyed_pct * 100:.1f}% of the sheet was removed — the background is not "
            f"{rgb_hex(use_bg)}, or it is already transparent."
        )
    if keyed_pct > MAX_KEYED:
        failures.append(
            f"{keyed_pct * 100:.1f}% of the sheet was removed — the tolerance is eating the art."
        )
    if enclosed:
        warnings.append(
            f"{len(enclosed)} enclosed background-coloured pocket(s) left opaque. Inspect them: "
            f"a spring's inside should be keyed, a white glove must not be."
        )
    if auto_keyed:
        warnings.append(
            f"{len(auto_keyed)} pocket(s) keyed on size alone (>= {auto_key_area * 100:.2f}% of the "
            f"sheet) — a ruled sheet seals every cell, and those interiors are background. "
            f"Pass keep_enclosed with a seed to hold one open."
        )

    return out, MatteReport(
        bg=use_bg,
        bg_confidence=confidence,
        keyed_pct=keyed_pct,
        enclosed=enclosed,
        auto_keyed=auto_keyed,
        warnings=warnings,
        failures=failures,
    )
