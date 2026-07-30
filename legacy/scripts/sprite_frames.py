#!/usr/bin/env python3
"""Pinball Knight sprite-set generator — adapted from Paper Harvest.

Prompts tools-service's image model for a chromakeyed sprite sheet,
slices it by alpha bands, and normalizes each pose onto THIS game's
registration contract. Then — and this is the part Paper Harvest has
no equivalent of — it snaps every frame to the 32-colour Cold Crypt
palette and refuses to emit a frame that busts the roster's noise
budget.

  python3 scripts/sprite_frames.py generate ratking
  python3 scripts/sprite_frames.py generate ratking --ref work/sheet.png
  python3 scripts/sprite_frames.py from-sheet ratking <sheet.png>
  python3 scripts/sprite_frames.py score ratking      # census only, no calls

── WHAT IS DIFFERENT FROM THE PAPER HARVEST SCRIPT ──────────────────

Five things, and every one of them is load-bearing here and absent
there. Read them before tuning a prompt, because four of the five are
reasons a beautiful sheet still ships as mush.

1. THE PRODUCT IS 63 TEXELS, NOT A 256 STICKER. Paper Harvest draws
   onto a 256px sticker canvas and what you generate is roughly what
   you see. Here the cel is rasterised at SPRITE_PX and area-crushed
   to SPRITE_PIXEL_GRID — 63 texels at the shipped camera rung — and
   ONE TEXEL IS 2.03 ART UNITS. Every feature under about four units
   wide is sub-texel and will not survive. Detail is not neutral here;
   it is actively converted into noise.

2. THE PALETTE IS A HARD CONSTRAINT, NOT A STYLE NOTE. The pixel pass
   snaps every pixel to 32 fixed colours using a LUMA-WEIGHTED metric,
   and those 32 are grouped in eight material families that are far
   apart in hue. Free colours do not land where they look like they
   should: a warm gold wash measured 26.8% ROT GREEN once. This script
   therefore snaps to the palette itself and reports where each colour
   went, rather than hoping.

3. THREE FACINGS, NOT ONE PROFILE. Paper Harvest asks for "true side
   profile FACING RIGHT" throughout. This game's animator packs S
   (toward camera), N (away) and E (side); W is E with a negative
   texture repeat, so a west-facing pose must never be drawn.

4. NO BAKED OUTLINE. Paper Harvest strips borders because the sticker
   ring is applied in-engine. The same rule holds here for a different
   reason: `crushInto` runs its own selout pass, darkening the
   shadow-side rim toward palette index 1. Art that arrives with its
   own black outline gets a second one on top and the silhouette
   thickens by a texel a side — on a 63-texel figure that is visible.

5. THE REGISTRATION CONTRACT IS THE PAINTERS'. Not a shared baseline
   near the canvas bottom, but the exact frame the vector painters use:
   a 128-unit art box with CX = 64 and GROUND = 118. A generated frame
   that does not sit on that ground line will float or sink relative to
   its shadow, its collider and every other monster.

── THE HONEST PRIOR ─────────────────────────────────────────────────

This has been tried on this codebase before and the finding was that
generated pixel art was not production quality — it census'd wrong
colours. What is new is not the generator, it is the JUDGE: the roster
now has measured noise numbers (entries / isolated% / runLen) and a
gate that enforces them, so the comparison can be settled instead of
argued. Run `render/sprite-score.test.ts` on the output and read the
verdict; do not adopt a sheet because a preview looked good at 8x.

Deps: pillow, numpy, scipy. Env: TOOLS_SERVICE_URL (default
http://192.168.86.2:5590), SPRITE_USERNAME.
"""

import argparse
import base64
import io
import json
import math
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

try:
    from scipy import ndimage
except ImportError:  # the blob cleanup is optional; slicing is not
    ndimage = None

REPO = Path(__file__).resolve().parent.parent
SPRITES_DIR = REPO / "scripts" / "sprites"
WORK_DIR = SPRITES_DIR / "work"

TOOLS_URL = os.environ.get("TOOLS_SERVICE_URL", "http://192.168.86.2:5590")
USERNAME = os.environ.get("SPRITE_USERNAME", "rodrigo")

# ── The registration contract, from constants/render.ts ──────────────
ART_PX = 128        # the painters' coordinate space
CX = 64             # horizontal centre
GROUND = 118        # the ground line every painter stands its actor on
GEN_PX = 512        # what we normalize to; the engine rasterises from here

# The Cold Crypt palette (render/palette.ts). Duplicated deliberately:
# this script must run in plain python with no bundler, and a stale copy
# is caught by `scripts/sprite_frames.py score`, which re-censuses
# through the REAL crush and would report off-palette pixels.
PALETTE = [
    0x0B0D12, 0x171A22, 0x2B303B, 0x454F5E, 0x6B7688, 0x9AA4B4,   # stone/void
    0x1E2F1F, 0x3D5C3A, 0x5F8A4F, 0x8FC46B,                       # rot
    0x3A0F18, 0x6B1F2A, 0xA83244, 0xD95763,                       # blood
    0x7A3B12, 0xD97B29, 0xF0A63C, 0xFFD98A, 0xFFF3C8,             # torch
    0x544E63, 0x8A94A6, 0xC8CCD4, 0xEEF1F5,                       # steel
    0x6B4436, 0xA9705A, 0xD69F7E,                                 # skin
    0x2A1C14, 0x4A3222, 0x6B4A2E,                                 # leather/wood
    0x1F3D52, 0x2E6D8F, 0x6FD0E8,                                 # arcane
]
FAMILY_OF = (
    ["stone"] * 6 + ["rot"] * 4 + ["blood"] * 4 + ["torch"] * 5
    + ["steel"] * 4 + ["skin"] * 3 + ["leather"] * 3 + ["arcane"] * 3
)

# The clip table the animator packs (engine/render/paint-types.ts).
# Frame counts match the current roster; `beats` is the authored cadence.
DEFAULT_CLIPS = [
    {"name": "idle", "frames": 2, "desc": "standing, weight settled, breathing"},
    {"name": "walk", "frames": 4, "desc": "walk cycle: contact, passing, opposite contact, passing"},
    {"name": "attack", "frames": 3, "desc": "wind up, strike, recover"},
    {"name": "death", "frames": 4, "desc": "hit, buckle, fall, sprawled on the ground"},
]

DIRS = [
    ("S", "seen FROM THE FRONT, facing the camera"),
    ("E", "seen in TRUE SIDE PROFILE, facing RIGHT"),
    ("N", "seen FROM BEHIND, facing away from the camera"),
]

STYLE = (
    "Drawn as a 16-bit SNES-era dungeon-crawler monster sprite, in the "
    "idiom of Ragnarok Online's monster art. Style rules (follow "
    "strictly):\n"
    "- FLAT solid colour areas with hard-edged cel shading. Three tones "
    "per material at most: a shadow, a mid and a highlight. No "
    "gradients, no airbrush, no painterly texture, no noise.\n"
    "- BIG READABLE SHAPES. Every feature must be at least a tenth of "
    "the creature's height. No fine detail, no filigree, no small "
    "patterns, no individual hairs, scales, rivets or stitches — at the "
    "size this ships, anything smaller becomes speckle.\n"
    "- A LIMITED PALETTE: pick at most FIVE materials for the whole "
    "creature and give each one three tones. Strongly saturated, "
    "clearly distinct hues.\n"
    "- LIT FROM THE UPPER LEFT, consistently, on every pose.\n"
    "- NO OUTLINE. Do not draw a black or dark border around the "
    "creature or around its interior shapes — the engine adds its own.\n"
    "- Separate adjacent materials by VALUE, not only by hue: a light "
    "thing must never sit against another light thing of a different "
    "colour, because the renderer resolves brightness before hue."
)


def load_config(name):
    path = SPRITES_DIR / f"{name}.json"
    if not path.exists():
        sys.exit(
            f"No config at {path}\n"
            'Create one, e.g. {"creature": "a hulking rat king in rusted '
            'plate", "clips": null} — null takes DEFAULT_CLIPS.'
        )
    config = json.loads(path.read_text())
    config.setdefault("clips", None)
    config["clips"] = config["clips"] or DEFAULT_CLIPS
    return config


# ── Prompt assembly ──────────────────────────────────────────────────

def build_prompt(config, direction, label, clips):
    cells = []
    n = 0
    for clip in clips:
        for f in range(clip["frames"]):
            n += 1
            cells.append(f"({n}) {clip['name']} frame {f + 1} of {clip['frames']} — {clip['desc']}")
    columns = 4
    rows = math.ceil(n / columns)
    return (
        f"A sprite sheet of {config['creature']}\n\n{STYLE}\n\n"
        f"Layout: a STRICT grid of {columns} columns and {rows} rows — "
        f"{n} equal cells, the SAME creature at the exact same scale in "
        f"every cell, {label}, feet on the same invisible ground line. "
        "Every cell is framed IDENTICALLY: the creature stands the same "
        "height in each one, about two thirds of the cell's height, with "
        "the same wide empty margin on all four sides, so nothing touches "
        "a cell boundary. In every cell at least one foot rests ON that "
        "ground line — no jumping, no hovering. No text, no grid lines, "
        "no props, no ground shadows, no motion lines or speed lines.\n\n"
        + "\n".join(cells)
    )


# ── tools-service ────────────────────────────────────────────────────

def request_image(body, what, attempts=3):
    print(f"Generating {what} via {TOOLS_URL} …")
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(
            f"{TOOLS_URL}/creative/generate-image",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "x-username": USERNAME},
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.loads(response.read())
        except urllib.error.HTTPError as error:
            result = {"error": f"HTTP {error.code}: {error.read().decode(errors='replace')[:300]}"}
        except urllib.error.URLError as error:
            result = {"error": f"unreachable: {error.reason}"}
        if result.get("success") and result.get("image"):
            if not result.get("transparencyApplied"):
                print("WARNING: chromakey removal did not apply — sheet is opaque")
            return Image.open(io.BytesIO(base64.b64decode(result["image"]["data"])))
        print(f"  attempt {attempt}/{attempts} failed: {result.get('error')}")
    sys.exit(f"Generation failed after {attempts} attempts")


def encode_reference(image, half=True):
    if image.mode == "RGBA":
        flat = Image.new("RGB", image.size, (0, 255, 0))
        flat.paste(image, mask=image.getchannel("A"))
    else:
        flat = image.convert("RGB")
    if half:
        flat = flat.resize((flat.width // 2, flat.height // 2), Image.LANCZOS)
    buffer = io.BytesIO()
    flat.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


# ── Sheet slicing ────────────────────────────────────────────────────

def bands(profile, min_gap=8, min_size=40):
    index = np.where(profile)[0]
    if len(index) == 0:
        return []
    out, start, previous = [], index[0], index[0]
    for i in index[1:]:
        if i - previous > min_gap:
            if previous - start >= min_size:
                out.append((start, previous))
            start = i
        previous = i
    if previous - start >= min_size:
        out.append((start, previous))
    return out


def slice_sheet(sheet, count):
    mask = np.array(sheet.getchannel("A")) > 8
    cells = []
    for y0, y1 in bands(mask.any(axis=1)):
        strip = mask[y0:y1 + 1]
        for x0, x1 in bands(strip.any(axis=0)):
            sub = strip[:, x0:x1 + 1]
            ys, xs = np.where(sub)
            cells.append((x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1))
    if len(cells) != count:
        sys.exit(f"Sliced {len(cells)} cells but the clip table wants {count}")
    return [sheet.crop(box) for box in cells]


def clean(crop, label):
    """Drop small floating alpha blobs (stray motion smudges)."""
    array = np.array(crop)
    mask = array[:, :, 3] > 8
    if ndimage is not None:
        labels, count = ndimage.label(mask)
        if count > 1:
            sizes = ndimage.sum(mask, labels, range(1, count + 1))
            keep = sizes >= sizes.max() * 0.02
            if int((~keep).sum()):
                print(f"  {label}: dropped {int((~keep).sum())} stray blob(s)")
                array[~np.isin(labels, np.where(keep)[0] + 1)] = 0
                mask = array[:, :, 3] > 8
    ys, xs = np.where(mask)
    return Image.fromarray(array).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


# ── Palette snap + census ────────────────────────────────────────────

def palette_arrays():
    rgb = np.array([[(c >> 16) & 255, (c >> 8) & 255, c & 255] for c in PALETTE], dtype=float)
    return rgb, np.array([0.3, 0.59, 0.11])


def snap(image):
    """Snap to the 32 colours with the SAME luma-weighted metric the
    engine uses. Not a generic quantizer: matching the weights is what
    makes the preview honest, and getting them wrong is how a gold wash
    ends up measuring as rot green."""
    rgb, weights = palette_arrays()
    array = np.array(image.convert("RGBA"), dtype=float)
    flat = array[:, :, :3].reshape(-1, 3)
    diff = (flat[:, None, :] - rgb[None, :, :]) * weights
    index = np.argmin((diff ** 2).sum(axis=2), axis=1)
    array[:, :, :3] = rgb[index].reshape(array.shape[0], array.shape[1], 3)
    # Hard alpha cutout at the GPU's alphaTest, so the preview's
    # silhouette is the one the game keeps.
    array[:, :, 3] = np.where(array[:, :, 3] > 127, 255, 0)
    return Image.fromarray(array.astype(np.uint8)), index.reshape(array.shape[0], array.shape[1])


def census(image):
    """entries / isolated% / runLen on a snapped frame — the same three
    numbers render/atlas-census.ts computes, so the python preview and
    the TypeScript gate can be compared directly."""
    snapped, index = snap(image)
    alpha = np.array(snapped.getchannel("A")) > 127
    index = np.where(alpha, index, -1)
    entries = len(set(index[alpha].tolist()))
    # A texel is isolated when NO orthogonal neighbour shares its index.
    # Padded rather than rolled: np.roll wraps, which would let the left
    # edge of the sprite match the right edge and undercount.
    padded = np.pad(index, 1, constant_values=-1)
    matches = np.zeros_like(alpha)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        shifted = padded[1 + dy: 1 + dy + index.shape[0], 1 + dx: 1 + dx + index.shape[1]]
        matches |= (shifted == index) & alpha
    isolated_pct = 100.0 * float((alpha & ~matches).sum()) / max(int(alpha.sum()), 1)
    runs = int((index[:, 1:] != index[:, :-1]).sum() + alpha[:, :1].sum())
    run_len = float(alpha.sum()) / max(runs, 1)
    families = {}
    for i in set(index[alpha].tolist()):
        families[FAMILY_OF[i]] = families.get(FAMILY_OF[i], 0) + int((index == i).sum())
    return {"entries": entries, "isolated": isolated_pct, "runLen": run_len, "families": families}


def normalize(crops):
    """Compose onto GEN_PX² on the PAINTERS' contract: centred at CX,
    feet on GROUND, one uniform scale across every frame so the flipbook
    holds size."""
    k = GEN_PX / ART_PX
    ground = GROUND * k
    max_h = max(c.height for c in crops)
    max_w = max(c.width for c in crops)
    scale = min((110 * k) / max_h, (108 * k) / max_w)
    out = []
    for crop in crops:
        w, h = round(crop.width * scale), round(crop.height * scale)
        art = crop.resize((w, h), Image.LANCZOS)
        canvas = Image.new("RGBA", (GEN_PX, GEN_PX), (0, 0, 0, 0))
        canvas.alpha_composite(art, ((GEN_PX - w) // 2, round(ground) - h))
        out.append(canvas)
    print(f"uniform scale {scale:.3f}, feet at y={ground:.0f}/{GEN_PX}")
    return out


def process(name, config, sheets):
    """Slice, clean, normalize, snap, census, write."""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    out_dir = WORK_DIR / name
    out_dir.mkdir(exist_ok=True)
    clips = config["clips"]
    labels = [f"{c['name']}{i}" for c in clips for i in range(c["frames"])]

    for direction, sheet in sheets.items():
        crops = [clean(c, f"{direction}:{labels[i]}") for i, c in enumerate(slice_sheet(sheet, len(labels)))]
        frames = normalize(crops)
        print(f"\n{direction}  frame        entries  isolated%  runLen  families")
        for label, frame in zip(labels, frames):
            snapped, _ = snap(frame)
            stats = census(frame)
            snapped.save(out_dir / f"{direction}-{label}.png")
            fam = " ".join(f"{k}:{v}" for k, v in sorted(stats["families"].items(), key=lambda p: -p[1])[:4])
            print(
                f"   {label:<12} {stats['entries']:>7} {stats['isolated']:>10.1f} "
                f"{stats['runLen']:>7.2f}  {fam}"
            )
    print(
        f"\nWrote {out_dir}. NOW JUDGE IT THROUGH THE REAL CRUSH — these numbers "
        f"are on the {GEN_PX}px frame, and the product is 63 texels:\n"
        f"  SPRITE_IN={out_dir} npx vitest run src/game/pinball-knight/render/sprite-score"
    )


# ── Commands ─────────────────────────────────────────────────────────

def cmd_generate(args):
    config = load_config(args.name)
    clips = config["clips"]
    reference = Image.open(args.ref) if args.ref else None
    sheets = {}
    for direction, label in DIRS:
        body = {
            "prompt": build_prompt(config, direction, label, clips),
            "transparentBackground": True,
            "aspectRatio": "4:3",
            "size": "2K",
        }
        if reference is not None:
            body["referenceImages"] = [{
                "url": encode_reference(reference),
                "label": args.note or "THE CREATURE — same design, same colours, same proportions",
            }]
        sheet = request_image(body, f"{args.name} facing {direction}")
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        sheet.save(WORK_DIR / f"{args.name}-{direction}-current.png")
        sheets[direction] = sheet.convert("RGBA")
        if reference is None:
            # The FIRST sheet becomes the identity for the other two, or
            # the three facings come back as three different creatures.
            reference = sheet
    process(args.name, config, sheets)


def cmd_from_sheet(args):
    config = load_config(args.name)
    process(args.name, config, {args.dir: Image.open(args.sheet).convert("RGBA")})


def cmd_score(args):
    config = load_config(args.name)
    sheets = {}
    for direction, _ in DIRS:
        path = WORK_DIR / f"{args.name}-{direction}-current.png"
        if path.exists():
            sheets[direction] = Image.open(path).convert("RGBA")
    if not sheets:
        sys.exit(f"No kept sheets for '{args.name}' in {WORK_DIR}")
    process(args.name, config, sheets)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="ask tools-service for all three facings")
    g.add_argument("name")
    g.add_argument("--ref", help="seed sheet to keep the design across re-rolls")
    g.add_argument("--note")
    g.set_defaults(func=cmd_generate)

    f = sub.add_parser("from-sheet", help="process a sheet you already have")
    f.add_argument("name")
    f.add_argument("sheet")
    f.add_argument("--dir", default="E", choices=[d for d, _ in DIRS])
    f.set_defaults(func=cmd_from_sheet)

    s = sub.add_parser("score", help="re-census the kept sheets, no service calls")
    s.add_argument("name")
    s.set_defaults(func=cmd_score)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
