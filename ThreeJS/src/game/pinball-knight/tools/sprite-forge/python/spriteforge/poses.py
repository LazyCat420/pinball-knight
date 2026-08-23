"""A ripped character → a POSE LIBRARY to generate other characters from.

    python3 -m spriteforge.poses .rip/mario characters/mario.moves.json --out .poses/mario

── WHY THIS EXISTS ─────────────────────────────────────────────────────────────

The `keyframes` mode asks for four poses by DESCRIBING them: "(1) contact (2)
passing (3) contact (4) passing". Four poses sharing one denoising pass regress
toward each other, and every row generated so far came back 97-99% identical —
measured, in both fast and quality mode. Words are the wrong instrument: the
model is being asked to invent pose diversity it has no reason to produce.

A hand-drawn reference sheet has the opposite property. Its poses are visibly,
deliberately different because an animator drew them that way, and Paper Mario's
in particular are now KNOWN GOOD — they are the frames shipping in the game. So
this turns them into what the generator can actually consume: one image per
clip, laid out exactly the way `keyframes` describes its output, to be handed
back as the structural reference instead of a sentence.

── THE FACING IS THE POINT, NOT A DETAIL ───────────────────────────────────────

`dir` is a promise about the SCREEN: E means seen walking right. This sheet's art
faces LEFT and says so with `mirror`, which the game honours at cel-build time —
so the pixels ON DISK face the opposite way to the standard everything else is
measured against.

Handing those to a generator would teach every new character to face left, and
the mirror flag would then have to be carried, remembered and re-declared for
each one. So the library is NORMALISED on the way out: the mirror is applied
here, once, and every pose in it faces screen-right. A character generated from
this library is born facing correctly and needs no `mirror` of its own.

── THE ROW IS THE ARTIFACT ─────────────────────────────────────────────────────

`row.png` is the frames evenly spaced on a plain white background at one shared
baseline — which is word for word what the keyframes prompt asks the model to
produce. Giving it back as a reference means the layout is no longer something
the model has to be persuaded into.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

from .character import frames_for, load_rip

# Gap between poses in a row, and the white the generator is asked for. Plain
# white rather than transparent: the prompt says "plain white background", and a
# transparent PNG composited by an uploader lands on black as often as not.
ROW_PAD = 8
WHITE = (255, 255, 255, 255)


def row_image(frames: list[Image.Image], mirror: bool) -> Image.Image:
    """Poses in one horizontal row, shared baseline, plain white.

    Bottom-aligned rather than centred: "feet on one shared baseline" is the
    line the prompt uses, and it is also what makes a row readable as one
    character moving rather than as several characters at different heights.
    """
    ims = [im.transpose(Image.FLIP_LEFT_RIGHT) if mirror else im for im in frames]
    w = sum(im.width + ROW_PAD for im in ims) + ROW_PAD
    h = max(im.height for im in ims) + ROW_PAD * 2
    out = Image.new("RGBA", (w, h), WHITE)
    x = ROW_PAD
    for im in ims:
        out.alpha_composite(im, (x, h - ROW_PAD - im.height))
        x += im.width + ROW_PAD
    return out


def build(rip_dir: Path, table_path: Path, out: Path, scale: int = 4) -> dict:
    index = load_rip(rip_dir)
    table = json.loads(table_path.read_text())
    mirror = bool(table.get("mirror"))
    out.mkdir(parents=True, exist_ok=True)

    entries: list[dict] = []
    for clip in table["clips"]:
        for facing, facing_row in table["facings"].items():
            cells = frames_for(index, clip["band"], facing_row, clip["cols"])
            if not cells:
                continue
            frames = [Image.open(rip_dir / c["file"]).convert("RGBA") for c in cells]
            d = out / clip["clip"] / facing
            d.mkdir(parents=True, exist_ok=True)

            files = []
            for i, im in enumerate(frames):
                one = im.transpose(Image.FLIP_LEFT_RIGHT) if mirror else im
                p = d / f"f{i:02d}.png"
                one.save(p)
                files.append(str(p.relative_to(out)))

            row = row_image(frames, mirror)
            # Upscaled NEAREST: these sheets are ~30px tall and a diffusion model
            # given a 30px reference reads it as noise. Nearest keeps the lattice
            # exact, so the reference still says "pixel art" rather than "blurry
            # small picture".
            row = row.resize((row.width * scale, row.height * scale), Image.NEAREST)
            row_path = d / "row.png"
            row.save(row_path)

            entries.append({
                "clip": clip["clip"],
                "facing": facing,
                "frames": len(frames),
                "row": str(row_path.relative_to(out)),
                "files": files,
                "size": [row.width, row.height],
            })

    manifest = {
        "character": table["name"],
        "source": index["source"],
        # Stated rather than implied: everything in here faces screen-right, and
        # a consumer that assumes otherwise will generate a mirrored character.
        "facingStandard": "E = screen-right; every pose is normalised, mirror already applied",
        "normalisedFrom": {"mirror": mirror},
        "scale": scale,
        "poses": entries,
    }
    (out / "poses.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rip", type=Path, help="a directory written by spriteforge.rip")
    ap.add_argument("table", type=Path, help="the moves table that names its columns")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--scale", type=int, default=4, help="nearest upscale for the row references")
    a = ap.parse_args(argv)

    m = build(a.rip, a.table, a.out, a.scale)
    print(f"{m['character']}: {len(m['poses'])} pose rows → {a.out}")
    for e in m["poses"]:
        print(f"  {e['clip']:<10} {e['facing']}  {e['frames']} frames  {e['size'][0]}x{e['size'][1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
