# Generated sprite configs

`sprite_frames.py` reads `<name>.json` from here. Work products (raw
sheets, sliced frames, previews) land in `work/`, which is gitignored so
a kept sheet can seed the next `--ref` iteration without being committed.

    python3 ../sprite_frames.py generate ratking
    SPRITE_IN=work/ratking npx vitest run src/game/pinball-knight/render/sprite-score

The second command is the one that matters. The generator's own census
runs on the 512px frame; the game ships 63 texels, and the whole question
is what the crush does to art between those two sizes.
