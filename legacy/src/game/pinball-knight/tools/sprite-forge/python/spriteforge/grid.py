"""
THE GATE — does this sheet actually have pixels?

Everything downstream assumes a source image can be reduced to a target grid
without inventing anything. That is only true if the art is REAL pixel art: a
lattice of N x N blocks, each one flat, so an N->1 block reduce is exact rather
than a guess. Generated "pixel art" usually is not. It LOOKS blocky and is
actually continuous -- irregular blob edges with anti-aliased seams -- and every
resample after that is damage no filter can undo.

Measured on three real generated sheets, none of which passes:

    jester   best x5  at 0.4%   flat 11%   cell purity 5.9%
    beaver   best x10 at 0.3%   flat 17%   cell purity 2.2%
    frog     best x4  at 2.1%   flat 14%   cell purity 7.9%

── HOW IT DECIDES ──────────────────────────────────────────────────────────

A xN upscale has one property nothing else has: every colour change sits on a
lattice line, i.e. at some x where `x % N == phase`. So for each candidate N take
the BEST phase and ask what share of changes land on it:

    score(N)      = max over phase of (changes at that phase) / (all changes)
    confidence(N) = (score - 1/N) / (1 - 1/N)

Chance alone gives 1/N, so the normalisation is what makes the numbers
comparable ACROSS N -- a raw score of 0.5 is superb at N=16 and worthless at N=2.

Both axes are measured and the WEAKER one reported, because a sheet gridded
horizontally and smeared vertically is not reducible either. Ties go to the
LARGEST N: a x8 upscale also scores perfectly at N=2 and N=4, and the largest
passing factor is the true block size.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Largest block size worth testing. Past this a "block" is a shape, not a pixel.
MAX_FACTOR = 16

#: Confidence a sheet must clear to be called gridded.
#:
#: 0.90, not 0.99: a real xN sheet saved as PNG through a generator picks up a few
#: stray pixels at silhouette edges, and demanding perfection would reject art
#: that block-reduces cleanly. Below 0.90 the lattice is not carrying the image.
GRID_CONFIDENCE = 0.90

#: A colour change big enough to be an edge rather than a gradient step.
EDGE = 40

#: Flat-neighbour share above which un-gridded art is NATIVE pixel art, not
#: continuous.
#:
#: Edge DENSITY cannot separate native pixel art from noise -- the first version of
#: this detector called a noise fixture "native pixel art" for exactly that reason.
#: FLATNESS can: pixel art is regions of byte-identical pixels bounded by hard
#: edges, and no gradient or noise produces those runs. Calibrated on real input
#: rather than picked:
#:
#:     synthetic x6 pixel art      0.842
#:     the shipped jester sheet    0.324
#:     noisy gradient              0.009
#:     smooth gradient             0.000
#:
#: 0.55 sits in the empty band between the real sheet and true pixel art.
NATIVE_FLAT_SHARE = 0.55

#: x0, y0, x1, y1 — inclusive, as the slicer emits them.
Box = tuple[int, int, int, int]


@dataclass
class GridReport:
    #: The block size in source pixels. 1 = native-resolution pixel art.
    factor: int
    confidence: float
    #: (factor, confidence) for every candidate, for the report and for tests.
    scores: list[tuple[int, float]]
    #: Share of neighbouring pixels that are byte-identical.
    flat_share: float
    #: Share of an NxN block that is its own plurality colour, 0..1.
    cell_purity: float
    #: The factor `cell_purity` was measured at — the winner, or the best failure.
    purity_factor: int
    #: True when the art can be block-reduced exactly.
    gridded: bool
    verdict: str


def _change_positions(img: np.ndarray, axis: int, box: Box) -> np.ndarray:
    """Absolute coordinates where a big colour change happens, along one axis.

    The ABSOLUTE position matters, not the position within the box: the lattice
    belongs to the SHEET, so every cell must agree about its phase.
    """
    x0, y0, x1, y1 = box
    sub = img[y0 : y1 + 1, x0 : x1 + 1].astype(np.int32)
    if sub.size == 0:
        return np.empty(0, dtype=np.int64)
    if axis == 0:
        d = np.abs(np.diff(sub, axis=1)).sum(axis=2)
        _, xs = np.nonzero(d > EDGE)
        return xs.astype(np.int64) + x0 + 1
    d = np.abs(np.diff(sub, axis=0)).sum(axis=2)
    ys, _ = np.nonzero(d > EDGE)
    return ys.astype(np.int64) + y0 + 1


def _confidence_for(positions: np.ndarray, n: int) -> float:
    """Best-phase share for one candidate factor, normalised against chance."""
    if n == 1:
        return 1.0  # every integer is on the 1-lattice; native art is trivially gridded
    if positions.size == 0:
        return 0.0
    bins = np.bincount(positions % n, minlength=n)
    best = bins.max() / positions.size
    return float((best - 1 / n) / (1 - 1 / n))


def _flat_share(img: np.ndarray, boxes: list[Box]) -> float:
    """Share of horizontally-adjacent OPAQUE pixel pairs that are byte-identical.

    ⚠️ OPAQUE PAIRS ONLY, and the TypeScript this was ported from counted every
    pair. That divergence is deliberate and it fixes a latent gate bug.

    A matted sheet is mostly empty. Whether two transparent pixels compare equal
    depends on something nobody chose: the TS ran on an in-memory buffer where
    matting zeroes ALPHA but leaves RGB, so transparent pixels differed and were
    not counted flat. Round-trip the same buffer through PNG and the encoder
    zeroes RGB under alpha, every transparent pair becomes byte-identical, and
    the number triples. Measured on the shipped jester's first cell:

        all pairs, in-memory buffer (what the TS saw)     11%
        all pairs, after a PNG round trip                 34%
        ...of those "flat" pairs, BOTH TRANSPARENT        94%
        opaque pairs only                                  2%

    That matters because `NATIVE_FLAT_SHARE` is a GATE. A sparse sheet could
    cross 0.55 on empty space alone and be declared native-resolution pixel art
    it is not. A standalone tool is handed PNGs, so it would have hit this.

    The metric means "regions of byte-identical pixels IN THE ART". Empty space
    is not art. The calibration fixtures are fully opaque, so their numbers
    (synthetic x6 = 0.842, gradients ~0) are unaffected.
    """
    has_alpha = img.shape[2] == 4
    same = 0
    total = 0
    for x0, y0, x1, y1 in boxes:
        sub = img[y0 : y1 + 1, x0 : x1 + 1]
        if sub.shape[1] < 2:
            continue
        eq = np.all(sub[:, 1:] == sub[:, :-1], axis=2)
        if has_alpha:
            opaque = (sub[:, 1:, 3] > 127) & (sub[:, :-1, 3] > 127)
            same += int((eq & opaque).sum())
            total += int(opaque.sum())
        else:
            same += int(eq.sum())
            total += int(eq.size)
    return same / total if total else 0.0


def cell_purity(img: np.ndarray, n: int, boxes: list[Box]) -> float:
    """Share of an n x n block that IS its own plurality colour.

    Borrowed from Sprite Fusion's Pixel Snapper, which cuts an image on detected
    gradient peaks and takes the plurality colour per cell. Its estimator is
    drift-tolerant where the phase test is not, so it was worth checking whether
    it recovers a grid the phase test throws away. It does not -- but the check
    produced a better metric than the one it replaced.

    Purity measures the property that actually matters: whether a block can
    collapse to one colour without losing anything. It also reads without
    explanation, where a normalised phase confidence does not.

    NOTE what its sibling metric does NOT do. Peak-spacing REGULARITY reads 0.79
    on the shipped jester -- which looks like a healthy grid -- and that sheet's
    blocks are 6.8% pure. A tool gating on regularity alone snaps such art to a
    5px lattice and emits mush, confidently and silently. Regularity is
    deliberately not used here.
    """
    if n < 2:
        return 1.0
    has_alpha = img.shape[2] == 4
    scores: list[float] = []
    for x0, y0, x1, y1 in boxes:
        for y in range(y0, y1 - n + 2, n):
            for x in range(x0, x1 - n + 2, n):
                blk = img[y : y + n, x : x + n]
                if blk.shape[0] != n or blk.shape[1] != n:
                    continue
                # Only fully-opaque blocks: one straddling the silhouette is
                # mostly background and would score as pure for the wrong reason.
                if has_alpha and not bool(np.all(blk[..., 3] > 127)):
                    continue
                flat = blk[..., :3].reshape(-1, 3).astype(np.int64)
                keys = (flat[:, 0] << 16) | (flat[:, 1] << 8) | flat[:, 2]
                _, counts = np.unique(keys, return_counts=True)
                scores.append(float(counts.max()) / keys.size)
    return float(np.mean(scores)) if scores else 0.0


def detect_pixel_grid(img: np.ndarray, boxes: list[Box]) -> GridReport:
    """Measure the source's intrinsic pixel size over the given cell boxes.

    `boxes` are the sliced cells rather than the whole sheet: the background is
    flat, contributes no colour changes, and would only dilute the sample.
    """
    if boxes:
        xs = np.concatenate([_change_positions(img, 0, b) for b in boxes])
        ys = np.concatenate([_change_positions(img, 1, b) for b in boxes])
    else:
        xs = ys = np.empty(0, dtype=np.int64)

    # The WEAKER axis decides. Gridded one way and smeared the other is not
    # reducible, and reporting the stronger axis would flatter exactly the sheets
    # most likely to be mis-authored.
    scores = [(n, min(_confidence_for(xs, n), _confidence_for(ys, n))) for n in range(2, MAX_FACTOR + 1)]

    # Largest passing factor wins -- a x8 sheet also scores 1.0 at 4 and 2.
    passing = [s for s in scores if s[1] >= GRID_CONFIDENCE]
    best = passing[-1] if passing else None
    factor = best[0] if best else 1
    confidence = best[1] if best else 0.0

    flat = _flat_share(img, boxes)
    top = max(scores, key=lambda s: s[1])
    claimed = factor if best else top[0]
    purity = cell_purity(img, claimed, boxes)

    if best:
        verdict = (
            f"PIXEL GRID x{factor} (confidence {confidence * 100:.1f}%) — "
            f"block-reduce is EXACT; this sheet can import 1:1."
        )
    elif flat >= NATIVE_FLAT_SHARE:
        verdict = (
            f"NO BLOCK GRID, but {flat * 100:.0f}% of neighbouring pixels are identical — "
            f"this reads as NATIVE-RESOLUTION pixel art. It imports 1:1 only if the cell "
            f"height already equals the target texel height; otherwise re-author it at an "
            f"integer multiple."
        )
    else:
        verdict = (
            f"NOT PIXEL ART — no lattice (best x{top[0]} at {top[1] * 100:.1f}%, "
            f"need {GRID_CONFIDENCE * 100:.0f}%) and only {flat * 100:.0f}% flat neighbours. "
            f"Continuous/anti-aliased art: it will be RESAMPLED, not reduced, and CANNOT "
            f"import 1:1. Re-generate with hard edges, no anti-aliasing, at an integer "
            f"multiple of the target size."
        )

    verdict += f" Cell purity at x{claimed}: {purity * 100:.1f}%"
    verdict += (
        "."
        if best
        else f" — a real lattice is ~100%, so the blocks are {'mush' if purity < 0.5 else 'close but not flat'}."
    )

    return GridReport(
        factor=factor,
        confidence=confidence,
        scores=scores,
        flat_share=flat,
        cell_purity=purity,
        purity_factor=claimed,
        gridded=best is not None,
        verdict=verdict,
    )


def block_reduce(img: np.ndarray, n: int, ox: int = 0, oy: int = 0) -> np.ndarray:
    """Exact N->1 block reduce. Only valid when `detect_pixel_grid` said so.

    Each output pixel is the MAJORITY colour of its block, not the average: on
    true pixel art the block is already flat so majority returns it unchanged
    (that is what "exact" means), while on a block with a stray edge pixel
    majority keeps the intended colour where an average would invent a new one.

    `ox`/`oy` are the lattice PHASE -- the offset of the first whole block, so a
    sheet whose art does not start at (0,0) still reduces correctly.
    """
    h, w, c = img.shape
    ow = max(1, (w - ox) // n)
    oh = max(1, (h - oy) // n)
    out = np.zeros((oh, ow, c), dtype=img.dtype)
    for y in range(oh):
        for x in range(ow):
            blk = img[oy + y * n : oy + (y + 1) * n, ox + x * n : ox + (x + 1) * n]
            flat = blk.reshape(-1, c).astype(np.int64)
            keys = (flat[:, 0] << 24) | (flat[:, 1] << 16) | (flat[:, 2] << 8)
            if c == 4:
                keys |= flat[:, 3]
            vals, counts = np.unique(keys, return_counts=True)
            k = int(vals[counts.argmax()])
            out[y, x, 0] = (k >> 24) & 0xFF
            out[y, x, 1] = (k >> 16) & 0xFF
            out[y, x, 2] = (k >> 8) & 0xFF
            if c == 4:
                out[y, x, 3] = k & 0xFF
    return out
