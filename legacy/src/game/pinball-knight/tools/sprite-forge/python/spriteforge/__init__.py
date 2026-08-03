"""
spriteforge — turn a generated sprite sheet into game-ready frames.

Extracted from braindeadbot's pinball-knight so the pipeline is not welded to one
game. Everything here is PALETTE-AGNOSTIC: a palette is passed in, never held.

That rule is the whole reason the predecessor was deleted. The original Python
importer carried its OWN copy of a 32-colour palette, which "would go stale the
first time the palette moved and report confident nonsense". Hold no palette, and
that failure cannot recur.

── WHAT IS HERE, AND WHAT DELIBERATELY IS NOT ──────────────────────────────

Here (pure image maths, no game knowledge):
    grid      is this actually pixel art, and at what block size
    matte     opaque background -> alpha, by flood fill from the border
    slice     a sheet -> ragged rows of cells
    gutter    is anything sitting BETWEEN frames that should not be
    resample  a cell -> its target footprint
    palette   snap to a palette handed in by the caller

NOT here, and it must stay with the game that owns it: scoring. A census that
compares imported art against a PAINTED roster needs that game's real crush and
real palette. Reimplementing them is exactly the drift that killed the first
Python importer, so the split is: this tool makes the sheet, the game judges it.
"""

from .grid import GridReport, block_reduce, cell_purity, detect_pixel_grid
from .gutter import GutterReport, gutter_report
from .matte import MatteReport, estimate_background, matte, rgb_hex
from .palette import evict_to, nearest_index, snap, to_lab
from .resample import resample_cell
from .slice import Cell, SheetRow, SliceDetail, equal_cells, slice_sheet, slice_sheet_detail

__all__ = [
    # gate
    "GridReport", "detect_pixel_grid", "cell_purity", "block_reduce",
    # matte
    "MatteReport", "matte", "estimate_background", "rgb_hex",
    # slice
    "Cell", "SheetRow", "SliceDetail", "slice_sheet", "slice_sheet_detail", "equal_cells",
    # gutter
    "GutterReport", "gutter_report",
    # resample + palette (the palette is always PASSED IN)
    "resample_cell", "snap", "evict_to", "nearest_index", "to_lab",
]
