"""
CELL RESAMPLING — the hop that decides whether imported art survives.

The naive version hands the whole cell to one smoothed `drawImage`. At the scales
a sheet actually arrives at (a 227px figure onto ~90px, 2.5-3x down) a bilinear
filter samples a 2x2 neighbourhood per output pixel and SKIPS most of the source
— undersampling, which reads as mush — and mixes RGB across the alpha edge, which
reads as a dark fringe. The palette snap downstream then turns that mush into
confetti: an imported creature measured 46% isolated pixels against 38.1% for the
same creature hand-painted.

This is the lesson the classic pipelines encode. MUGEN sprites are hand-pixeled
at their final resolution on a shared indexed palette; Rivals of Aether sprites
are authored at native size and resized only by whole numbers. Art COMMITS to a
pixel grid once, and every fractional resample after that is damage. Generated
sheets arrive without a grid, so this is where they commit.

── THE STRATEGIES, AND WHY THERE IS MORE THAN ONE ──────────────────────────

    box        Premultiplied separable area average. Correct, never invents, but
               averages a soft gradient into in-between colours the snap then has
               to guess at.

    dominant   Box average UNLESS one quantized colour owns >= half the texel's
               opaque coverage, in which case that colour wins outright at its
               true weighted mean. Flat regions the artist intended stay flat.

    kcentroid  The community standard for AI art downscaling (Astropulse's
               pixeldetector lineage): split the covered block into two clusters
               by weighted k-means and take the dominant centroid. Where
               `dominant` needs one colour to hold a majority, this only needs the
               block to be SEPARABLE — a noisy red-and-cream texel picks its red
               side instead of averaging to mauve. THE DEFAULT.

    nearest    Point-sample the texel centre. What a pixel-art editor's batch
               resize does, and correct for art that IS on a grid already. The
               WRONG tool for soft generated art, where it lands on whichever
               noise pixel the centre happens to hit. Present as the
               editor-pipeline arm of a comparison, not as a candidate.

⚠️ NEAREST IS NOT "COMMITTING" ON CONTINUOUS ART. It is a common suggestion and it
is backwards here: point-sampling one of many source pixels keeps that pixel's
noise, where k-centroid asks what the block is actually made of.

Alpha is ALWAYS the premultiplied box average regardless of strategy — the crush
downstream applies a hard alpha cutout, and that is the right place for the
decision. Strategies only decide COLOUR.
"""

from __future__ import annotations

from typing import Literal

import numpy as np

Strategy = Literal["box", "dominant", "kcentroid", "nearest"]

#: A texel's share of opaque coverage one colour must own to win outright.
DOMINANT_SHARE = 0.5
#: k-means passes per texel. Blocks are <= ~5x5 source pixels; the centroids stop
#: moving in 2-3 passes and 4 is a ceiling, not a target.
KMEANS_PASSES = 4
#: Bin width for `dominant`. 4 bits per channel is coarse on purpose: generation
#: noise spans +-8, and a bin split by noise hands the vote to whichever half is
#: luckier.
_BIN_SHIFT = 4


def _cover(src_len: int, dst_len: int) -> list[tuple[int, int, np.ndarray]]:
    """Per destination index: source span and the coverage weight of each source."""
    k = src_len / dst_len
    out = []
    for i in range(dst_len):
        a, b = i * k, (i + 1) * k
        lo, hi = int(np.floor(a)), int(np.ceil(b))
        idx = np.arange(lo, min(hi, src_len))
        wts = np.minimum(b, idx + 1) - np.maximum(a, idx)
        out.append((lo, min(hi, src_len), np.clip(wts, 0, None)))
    return out


def resample_cell(src: np.ndarray, dw: int, dh: int, strategy: Strategy = "kcentroid") -> np.ndarray:
    """Resample an RGBA cell to exactly `dw` x `dh`."""
    sh, sw = src.shape[:2]
    out = np.zeros((dh, dw, 4), np.uint8)

    if strategy == "nearest":
        ys = np.minimum(sh - 1, ((np.arange(dh) + 0.5) * sh / dh).astype(int))
        xs = np.minimum(sw - 1, ((np.arange(dw) + 0.5) * sw / dw).astype(int))
        return src[np.ix_(ys, xs)].astype(np.uint8)

    rows = _cover(sh, dh)
    cols = _cover(sw, dw)
    a = src[..., 3].astype(np.float64) / 255.0
    rgb = src[..., :3].astype(np.float64)

    for oy, (y0, y1, wy) in enumerate(rows):
        for ox, (x0, x1, wx) in enumerate(cols):
            w2 = np.outer(wy, wx)
            blk_a = a[y0:y1, x0:x1]
            blk = rgb[y0:y1, x0:x1]
            aw = blk_a * w2
            sum_w = w2.sum()
            sum_a = aw.sum()
            out[oy, ox, 3] = round((sum_a / sum_w if sum_w else 0.0) * 255)
            if sum_a <= 0:
                continue  # fully transparent texel — colour is moot

            # box colour: the fallback every strategy can land on
            col = (blk * aw[..., None]).sum(axis=(0, 1)) / sum_a

            if strategy == "dominant":
                keys = (
                    (blk[..., 0].astype(int) >> _BIN_SHIFT) << 8
                    | (blk[..., 1].astype(int) >> _BIN_SHIFT) << 4
                    | (blk[..., 2].astype(int) >> _BIN_SHIFT)
                )
                flat_k, flat_w, flat_c = keys.ravel(), aw.ravel(), blk.reshape(-1, 3)
                keep = flat_w > 0
                if keep.any():
                    uk = np.unique(flat_k[keep])
                    best_w, best_c = 0.0, None
                    for k in uk:
                        m = keep & (flat_k == k)
                        wsum = flat_w[m].sum()
                        if wsum > best_w:
                            best_w = wsum
                            best_c = (flat_c[m] * flat_w[m, None]).sum(axis=0) / wsum
                    if best_c is not None and best_w >= DOMINANT_SHARE * sum_a:
                        col = best_c
            elif strategy == "kcentroid":
                c = _k_centroid(blk.reshape(-1, 3), aw.ravel())
                if c is not None:
                    col = c
            out[oy, ox, :3] = np.round(col)
    return out


def _k_centroid(px: np.ndarray, wts: np.ndarray) -> np.ndarray | None:
    """Dominant centroid of a 2-means split over one texel's covered pixels.

    Seeds are the min- and max-luma pixels — the cheap version of farthest-pair
    init, and enough for blocks this small. Returns None when the block cannot
    split (one colour, or one pixel), which tells the caller the box average was
    already right.
    """
    keep = wts > 0
    px, wts = px[keep], wts[keep]
    if px.shape[0] < 2:
        return None
    luma = px @ np.array([0.3, 0.59, 0.11])
    lo, hi = int(luma.argmin()), int(luma.argmax())
    if luma[hi] - luma[lo] < 1:
        return None

    c0, c1 = px[lo].copy(), px[hi].copy()
    w0 = w1 = 0.0
    for _ in range(KMEANS_PASSES):
        d0 = ((px - c0) ** 2).sum(1)
        d1 = ((px - c1) ** 2).sum(1)
        m = d0 <= d1
        a0, a1 = wts[m].sum(), wts[~m].sum()
        if a0 <= 0 or a1 <= 0:
            return None  # degenerate split — box was right
        c0 = (px[m] * wts[m, None]).sum(0) / a0
        c1 = (px[~m] * wts[~m, None]).sum(0) / a1
        w0, w1 = a0, a1
    return c0 if w0 >= w1 else c1
