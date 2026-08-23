"""
`python -m spriteforge SHEET.png` — run the pipeline and print what it found.

Prints a report and, unless `--json`, nothing a script should parse. The report
is the product: this tool's whole job is to tell you whether a sheet is usable
and, when it is not, which stage said so and why.

── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────

It does not SCORE. A census comparing imported art against a game's painted
roster needs that game's real crush and real palette, and reimplementing them is
exactly the drift that got the predecessor deleted. The split is: this tool makes
the sheet, the game judges it.

It also does not decide that "NOT PIXEL ART" means stop. That verdict refuses the
1:1 CLAIM, not the sheet — every sheet shipped so far fails it and three of them
render fine through the resample path. A gate that hard-rejects at some purity
threshold would have rejected all of them, including the one a human picked as
best.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from .grid import detect_pixel_grid
from .gutter import gutter_report
from .matte import matte, rgb_hex
from .palette import as_array, evict_to, snap
from .slice import equal_cells, slice_sheet_detail

#: Below this share of transparency the sheet arrived opaque and needs matting.
#: Not zero: a generator emits a few stray transparent pixels, and a hand-keyed
#: sheet always has a large clear field.
OPAQUE_BELOW = 0.05


def _load_palette(spec: str | None) -> np.ndarray | None:
    if not spec:
        return None
    p = Path(spec)
    if p.exists():
        text = p.read_text()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
        return as_array(data)
    return as_array([c for c in spec.split(",") if c.strip()])


def run(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="spriteforge", description=__doc__.split("\n")[1])
    ap.add_argument("sheet", type=Path)
    ap.add_argument("--rows", help="comma-separated clip name per row, in reading order")
    ap.add_argument("--cells", help="comma-separated frame count per row (OVERRIDE; see --help-cells)")
    ap.add_argument("--palette", help="file (json or one hex per line) or inline '#rrggbb,#rrggbb'")
    ap.add_argument("--max-entries", type=int, help="evict to at most this many palette entries")
    ap.add_argument("--metric", choices=["luma", "lab"], default="luma")
    ap.add_argument("--tolerance", type=int, default=None, help="matte tolerance")
    ap.add_argument("--out", type=Path, help="write the matted sheet here")
    ap.add_argument("--json", action="store_true", help="machine-readable report on stdout")
    a = ap.parse_args(argv)

    img = np.asarray(Image.open(a.sheet).convert("RGBA"))
    h, w = img.shape[:2]
    out: dict = {"sheet": str(a.sheet), "size": [w, h]}
    lines: list[str] = [f"═══ {a.sheet.name} — {w}x{h}"]

    clear = float((img[..., 3] == 0).mean())
    if clear < OPAQUE_BELOW:
        img, mrep = matte(img, tolerance=a.tolerance or 40)
        out["matte"] = {
            "bg": rgb_hex(mrep.bg),
            "confidence": mrep.bg_confidence,
            "keyed": mrep.keyed_pct,
            "enclosed": len(mrep.enclosed),
            "failures": mrep.failures,
        }
        lines.append(
            f"MATTE  bg {rgb_hex(mrep.bg)} ({mrep.bg_confidence * 100:.0f}% of the border) — "
            f"keyed {mrep.keyed_pct * 100:.1f}%"
            + (f", {len(mrep.enclosed)} pocket(s) LEFT OPAQUE" if mrep.enclosed else "")
        )
        for f in mrep.failures:
            lines.append(f"  ✗ {f}")
        for warn in mrep.warnings:
            lines.append(f"  ⚠ {warn}")
        if mrep.failures:
            print("\n".join(lines), file=sys.stderr)
            return 2

    detail = slice_sheet_detail(img[..., 3])
    rows = detail.rows
    if sum(len(r.cells) for r in rows) <= 1:
        lines.append("✗ sliced into one cell — is the background transparent?")
        print("\n".join(lines), file=sys.stderr)
        return 2

    clips = [c.strip() for c in a.rows.split(",")] if a.rows else [f"row{i}" for i in range(len(rows))]

    # ⚠️ The gutter check runs BEFORE any --cells override. The override is where
    # this defect is most dangerous: it cuts a bridging artifact in half and hands
    # back the right cell count with two broken frames, which is exactly how a
    # laser beam shipped once already.
    grep = gutter_report(detail.mask, rows, clips)
    out["gutter"] = {"pitch": grep.pitch, "failures": grep.failures, "warnings": grep.warnings}
    lines.append(grep.verdict)
    for f in grep.failures:
        lines.append(f"  ✗ {f}")

    if a.cells:
        counts = [int(c) for c in a.cells.split(",")]
        if len(counts) != len(rows):
            lines.append(f"✗ --cells lists {len(counts)} rows but {len(rows)} were found")
            print("\n".join(lines), file=sys.stderr)
            return 2
        for r, n in zip(rows, counts):
            r.cells = equal_cells(r, n)

    shape = "/".join(str(len(r.cells)) for r in rows)
    lines.insert(1, f"SLICE  {len(rows)} rows [{shape}], {sum(len(r.cells) for r in rows)} frames")
    out["rows"] = [{"clip": c, "cells": [list(x) for x in r.cells]} for c, r in zip(clips, rows)]

    boxes = [c for r in rows for c in r.cells]
    g = detect_pixel_grid(img, boxes)
    out["grid"] = {
        "factor": g.factor,
        "gridded": g.gridded,
        "confidence": g.confidence,
        "flat_share": g.flat_share,
        "cell_purity": g.cell_purity,
    }
    lines.insert(2, f"GRID   {g.verdict}")

    if a.palette:
        pal = _load_palette(a.palette)
        assert pal is not None
        img = snap(img, pal, a.metric)
        info = {"entries": None}
        if a.max_entries:
            img, info = evict_to(img, pal, a.max_entries, a.metric)
            lines.append(
                f"PALETTE  snapped to {len(pal)} entries ({a.metric}); "
                f"kept {info['entries']}, evicted {info['evicted']}, "
                f"moved {info['moved_share'] * 100:.2f}% of opaque texels"
            )
        else:
            lines.append(f"PALETTE  snapped to {len(pal)} entries ({a.metric})")
        out["palette"] = {"size": int(len(pal)), "metric": a.metric, **info}

    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(img).save(a.out)
        lines.append(f"→ {a.out}")

    failed = bool(grep.failures)
    if a.json:
        out["ok"] = not failed
        print(json.dumps(out, indent=1))
    else:
        print("\n".join(lines))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())
