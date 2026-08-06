"""A ripped reference sheet + a moves table → a playable character sheet.

    python3 -m spriteforge.character .rip/mario characters/mario.moves.json \
        --out public/sprites

`rip.py` cuts a labelled sheet into matted frames and groups them into captioned
BANDS. It deliberately stops there: which frames are "walk" is a reading of the
caption, and the measurement in rip.py's header says an automatic reading is
wrong three times too often. This step takes the human's answer — a moves table
naming column ranges — and emits what the game loads.

── WHY THIS SKIPS `commit.ts` ──────────────────────────────────────────────────

That pipeline exists to impose a pixel lattice on GENERATED art: a model emits a
continuous-tone rendering of flat pixel art, every apparently-flat block is a
gradient of hundreds of near-identical values, and the palette snap sends each to
a different index. None of that is true here. A ripped reference sheet is already
indexed, already flat, already on a lattice — a person drew it that way. So the
commit's reduce/snap/upscale would be three destructive steps to arrive back at
the pixels we started with.

── THE FACING TRICK ────────────────────────────────────────────────────────────

On the Paper Mario sheet a band's tile ROWS are FACINGS: row 0 draws the move
seen from the front, row 1 draws the same poses from behind. That is why the
moves table names columns rather than frames — one column range names the move in
every row, so S and N fall out of the same table with no second reading. Sheets
without that property simply declare one facing and the engine reuses it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

# Gap between packed frames. Non-zero so a resample that samples a texel outside
# its own cell picks up transparency rather than the neighbouring frame's ink.
PAD = 2


def load_rip(rip_dir: Path) -> dict:
    return json.loads((rip_dir / "index.json").read_text())


def frames_for(index: dict, band_i: int, facing_row: int, cols: list[int]) -> list[dict]:
    """The cells of one move, in one facing, in column order.

    `facing_row` indexes the band's OWN row list, not the sheet's — band 6 sits
    on sheet rows 8 and 9, and its front facing is still facing 0.
    """
    bands = index["bands"]
    if band_i >= len(bands):
        raise SystemExit(f"band {band_i} does not exist (sheet has {len(bands)})")
    band = bands[band_i]
    if facing_row >= len(band["rows"]):
        return []
    row = band["rows"][facing_row]
    by_col = {c["col"]: c for c in index["cells"] if c["row"] == row}
    out = []
    for col in cols:
        cell = by_col.get(col)
        if cell is None:
            raise SystemExit(f"band {band_i} row {row} has no column {col}")
        out.append(cell)
    return out


def build_facing(rip_dir: Path, index: dict, table: dict, facing: str, facing_row: int) -> tuple[Image.Image, dict] | None:
    """Pack one facing's clips into a sheet, and describe it as a manifest."""
    packed: list[tuple[str, list[Image.Image]]] = []
    for entry in table["clips"]:
        cells = frames_for(index, entry["band"], facing_row, entry["cols"])
        if not cells:
            continue
        ims = [Image.open(rip_dir / c["file"]).convert("RGBA") for c in cells]
        packed.append((entry["clip"], ims))
    if not packed:
        return None

    width = max(sum(im.width + PAD for im in ims) + PAD for _, ims in packed)
    height = sum(max(im.height for im in ims) + PAD for _, ims in packed) + PAD

    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    rows: list[dict] = []
    y = PAD
    for clip, ims in packed:
        rh = max(im.height for im in ims)
        x = PAD
        cells_out: list[list[int]] = []
        for im in ims:
            # Bottom-align within the row: these are standing figures and the
            # feet line is the one edge that must agree between frames.
            oy = y + rh - im.height
            sheet.alpha_composite(im, (x, oy))
            cells_out.append([x, oy, x + im.width - 1, oy + im.height - 1])
            x += im.width + PAD
        rows.append({"clip": clip, "cells": cells_out})
        y += rh + PAD

    manifest = {
        "name": table["name"],
        "dir": facing,
        "image": f"/sprites/{table['name']}-{facing}.png",
        "source": [sheet.width, sheet.height],
        "rows": rows,
    }
    if "scale" in table:
        manifest["scale"] = table["scale"]
    # WHICH WAY THE ART FACES, declared rather than repainted.
    #
    # `dir` is a promise about the SCREEN: E means "seen walking right". A ripped
    # sheet made that choice years ago and it is often the other one — Paper
    # Mario's overworld art faces LEFT. Flipping the PNG would invalidate every
    # rect in this sidecar, so the engine flips at cel-build time instead and
    # this is the flag that asks it to. It composes with the W-is-mirrored-E rule
    # in animator.ts rather than fighting it: mirrored cel + the draw-time flip
    # cancels back to left-facing for W, which is what walking left should look
    # like.
    if table.get("mirror"):
        manifest["mirror"] = True
    return sheet, manifest


def build(rip_dir: Path, table_path: Path, out: Path) -> list[str]:
    index = load_rip(rip_dir)
    table = json.loads(table_path.read_text())
    out.mkdir(parents=True, exist_ok=True)

    clips = [e["clip"] for e in table["clips"]]
    if "idle" not in clips:
        # importedPaints returns null without an idle, and a null return is
        # silent by design — the character would simply stay the painter's.
        raise SystemExit("the moves table has no `idle` clip; the game would silently ignore this sheet")

    written: list[str] = []
    for facing, facing_row in table["facings"].items():
        built = build_facing(rip_dir, index, table, facing, facing_row)
        if built is None:
            continue
        sheet, manifest = built
        png = out / f"{table['name']}-{facing}.png"
        sheet.save(png)
        # THE IMAGE'S CACHE KEY, written AFTER the PNG exists so it is a hash of
        # the bytes actually shipped rather than of what we meant to ship. The
        # sidecar is served no-store and the PNG for a day, so this is what stops
        # a returning browser pairing a fresh manifest with a stale image — see
        # `versioned()` in render/imported-paints.ts.
        manifest["hash"] = hashlib.sha256(png.read_bytes()).hexdigest()[:12]
        (out / f"{table['name']}-{facing}.json").write_text(json.dumps(manifest, indent=1) + "\n")
        written.append(f"{png.name} {sheet.width}x{sheet.height} ({len(manifest['rows'])} clips)")
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rip", type=Path, help="a directory written by spriteforge.rip")
    ap.add_argument("table", type=Path, help="the moves table naming column ranges")
    ap.add_argument("--out", type=Path, required=True, help="usually public/sprites")
    a = ap.parse_args(argv)

    for line in build(a.rip, a.table, a.out):
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
