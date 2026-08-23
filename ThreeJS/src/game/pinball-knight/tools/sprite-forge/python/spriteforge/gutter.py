"""
THE GUTTER GATE — is there anything in the gaps that should not be there?

A real sheet arrived with a brick WALL sitting between two walk frames and a
laser BEAM crossing the gap between two attack frames. Both merged the cells they
touched; the sheet imported with four frames where it should have had five, and
shipped broken. Neither was the creature — both were scenery or an effect the
ENGINE already draws, which is why the rule is "the sheet holds the creature" and
this is the check that enforces it.

── WHY IT CANNOT USE THE RETURNED CELL RECTS ───────────────────────────────

The obvious version — measure the gap between `cells[i]` and `cells[i+1]` — is
VACUOUS, and a validation of it was published before anyone noticed. The slicer
cuts columns on a band-wide alpha profile, so a column separating two cells has
no ink in it BY CONSTRUCTION: all 44 gutters on three real sheets measure exactly
0.00%, clean or not. And on a dirty sheet the bridged pair MERGES, so the gutter
that would have held the wall does not exist to be measured.

Measuring clean rects against dirty pixels is what produced a 45.6% that looked
like a working detector. Seams must come from a NOMINAL PITCH instead —
information the sheet still holds when a cell has been lost.

── THE THREE PROPERTIES, EACH FORCED BY A MEASUREMENT ──────────────────────

1. PITCH IS THE MEDIAN of adjacent cell-origin deltas across the whole sheet.
   Measured: jester 226, beaver 302, frog 266 — and injecting a 535px merge into
   frog did not move its median off 266. Expected count per row is
   `floor(extent / pitch) + 1`, correct on all 13 real rows with fractional parts
   landing 0.6-0.9. `round()` does NOT work: two real rows land 3.61 and 1.82,
   both near a boundary.

2. PROBE THE EMPTIEST WINDOW near the seam, not the seam itself. Poses sit
   off-centre in their cells, so a fixed probe reads 23% on a clean row —
   unusable. Sliding to the local minimum within +-25% of pitch gives 0.00% on
   all 44 clean seams, because on a clean sheet there really is an empty column
   band near every seam and on a bridged one there is not.

3. MEASURE THE RULE-STRIPPED MASK, not raw alpha, or a ruled sheet fails on its
   own borders — a 2px rule inside a 15px probe reads 13%.

── WHAT IT CATCHES, AND WHAT IT PROVABLY DOES NOT ─────────────────────────

Measured on the two real defects, which fail differently:

    the laser BEAM   crossed the gap between two attack frames.
                     CAUGHT — 12.7% of the seam, 319px, and the row sliced to
                     4 cells where the pitch expects 5, which is reported too.

    the brick WALL   sat beside a frog rather than between two.
                     NOT CAUGHT, and it cannot be. The slicer absorbed it into
                     that frog's own cell — walk[3] came back (847, 1049) where
                     the clean frog is (847, 984) — so every gutter on the row
                     measures a genuine 0.00%. There is nothing in any gap.

No width signal rescues it either: the wall made that cell 203px wide against
siblings of 206/187/197/190, which is INSIDE the normal range. The clean frog is
the narrow one at 138.

So this gate covers the BRIDGING class. An artifact adjacent to a figure and
absorbed into its cell is not detectable by geometry, and the honest answer for
it is the generation rule ("nothing but the creature") plus looking at the
contact sheet — which is what caught the wall in the first place.

Signal on the bridging defect: 8-13%. Floor: exactly 0.00% across 44 clean seams
on three real sheets.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .slice import SheetRow

#: Occupancy share that fails, and the pixel floor that stops a tiny probe
#: tripping on a dozen pixels.
#:
#: An ABSOLUTE floor rather than a separation point: the clean population is
#: exactly 0.00%, so there is nothing to split the difference with. 3% absorbs
#: antialias fringe and a stray dropped fragment; the measured defects clear it
#: by 2.7x-15x.
FAIL_PCT = 0.03
FAIL_PX = 40
#: Probe width, as a share of pitch.
PROBE = 0.06
#: How far either side of the nominal seam to slide, as a share of pitch.
SLIDE = 0.25
#: Above this fractional part the expected cell count is a guess, so warn rather
#: than fail on it. The closest real row sits at 0.86.
AMBIGUOUS = 0.95


@dataclass
class GutterSeam:
    #: Sheet x of the emptiest probe window's left edge.
    at: int
    #: Occupancy of that window, 0..1.
    pct: float
    #: Opaque pixels in it — the second half of the threshold.
    px: int


@dataclass
class GutterRowReport:
    clip: str
    #: From the nominal pitch. A row short of this has probably MERGED cells.
    expected: int
    found: int
    seams: list[GutterSeam] = field(default_factory=list)


@dataclass
class GutterReport:
    pitch: int
    rows: list[GutterRowReport] = field(default_factory=list)
    #: Blocking. Something is in the gaps and the frames are wrong.
    failures: list[str] = field(default_factory=list)
    #: Non-blocking — an expected count that was too close to call.
    warnings: list[str] = field(default_factory=list)
    verdict: str = ""


def gutter_report(
    mask: np.ndarray,
    rows: list[SheetRow],
    clips: list[str] | None = None,
    *,
    allow: list[tuple[int, int]] | None = None,
    threshold: float = FAIL_PCT,
) -> GutterReport:
    """Check every seam of every row. `mask` is the slicer's rule-stripped view.

    `allow` is a list of `(row_index, seam_index)` pairs to accept — the same
    per-instance, authored shape as the matte's `keep_enclosed`, never a blanket
    boolean that would hide a second defect on the same sheet.
    """
    h, w = mask.shape
    names = clips or []
    allowed = set(allow or [])

    deltas: list[int] = []
    for r in rows:
        cs = sorted(r.cells)
        deltas += [cs[i + 1][0] - cs[i][0] for i in range(len(cs) - 1)]
    if not deltas:
        return GutterReport(pitch=0, verdict="GUTTERS  not checked — one cell, no pitch to estimate.")
    pitch = int(np.median(deltas))

    probe_w = max(2, round(pitch * PROBE))
    slide = round(pitch * SLIDE)

    out: list[GutterRowReport] = []
    failures: list[str] = []
    warnings: list[str] = []

    for ri, r in enumerate(rows):
        clip = names[ri] if ri < len(names) else f"row{ri}"
        cs = sorted(r.cells)
        x0 = cs[0][0]
        x1 = cs[-1][2]
        y0 = min(c[1] for c in cs)
        y1 = max(c[3] for c in cs)
        extent = x1 - x0 + 1
        ratio = extent / pitch
        expected = int(ratio) + 1
        n = max(expected, len(cs))
        ambiguous = ratio - int(ratio) > AMBIGUOUS
        if ambiguous:
            warnings.append(f"{clip}: cell count ambiguous ({ratio:.2f} pitches) — gutters not enforced.")

        band = mask[y0 : y1 + 1]
        seams: list[GutterSeam] = []
        step = extent / n
        for i in range(1, n):
            nominal = round(x0 + i * step) - probe_w // 2
            best = GutterSeam(at=nominal, pct=1.0, px=2**31)
            for d in range(-slide, slide + 1):
                px0 = nominal + d
                if px0 < 0 or px0 + probe_w > w:
                    continue
                ink = int(band[:, px0 : px0 + probe_w].sum())
                pct = ink / max(1, probe_w * band.shape[0])
                if pct < best.pct:
                    best = GutterSeam(at=px0, pct=pct, px=ink)
            seams.append(best)

            if ambiguous or (ri, i - 1) in allowed:
                continue
            if best.pct >= threshold and best.px >= FAIL_PX:
                merged = (
                    f"The row also sliced to {len(cs)} cells where the pitch expects {expected}, "
                    f"so it MERGED. "
                    if len(cs) < expected
                    else ""
                )
                failures.append(
                    f"{clip} seam {i - 1} (x~{best.at}): {best.pct * 100:.1f}% of the gap is INK "
                    f"({best.px}px). Something that is not the creature is sitting between two "
                    f"frames — scenery, or an effect the engine already draws. {merged}"
                    f"Remove it from the art, or accept it with gutter.allow=[({ri},{i - 1})]."
                )
        out.append(GutterRowReport(clip=clip, expected=expected, found=len(cs), seams=seams))

    worst = max((s.pct for r in out for s in r.seams), default=0.0)
    verdict = (
        f"GUTTERS  {len(failures)} occupied gap(s) — the sheet holds something that is not the creature."
        if failures
        else f"GUTTERS  clean (pitch {pitch}px, worst gap {worst * 100:.1f}%)."
    )
    return GutterReport(pitch=pitch, rows=out, failures=failures, warnings=warnings, verdict=verdict)
