# brute, 2026-08-07 — the Ragnarok restyle, generated and awaiting curation

Three masters and eleven of twelve motion clips. TRACKED because `work/comfy/`
is gitignored and that is exactly how the 2026-08-06 build lost the source
frames for its own `attack` row.

    00_master_S.png   the styled front master   (qwen edit,   seed 11)
    01_master_E.png   rotated to the side       (qwen rotate, seed 11)
    01_master_N.png   rotated to the back       (qwen rotate, seed 11)
    clip_<DIR>_<CLIP>/  6 frames each, first cull (see below)

## The recipe

    # STYLE BY EXAMPLE, not by adjective. PROMPTS.md measured that stronger
    # pixel-art wording makes every metric WORSE: capitals asking for no-AA /
    # flat fills / <=16 colours produced 301,541 distinct colours, entries
    # 26.6->30.7, isolated 41.5->47.8, matte keyed 79.2%->61.3%.
    cli.mjs edit --init ../brute-2026-08-06/00_master_idle.png \
                 --ref <one idle cell cropped from inbox/zombie-E.png> \
                 --prompt "Redraw this character as clean pixel art, a hulking
                           gym-buff zombie brute, same pose, same size, same
                           position. Match the pixel art style, palette and
                           proportions of Figure 2." --seed 11

    cli.mjs rotate  --init 00_master_S.png --to right|back --seed 11
    cli.mjs animate --init <master> --preset walk|idle|attack|death \
                    --frames 21 --tile 96 --seed 11

Both other facings branch off the ONE approved master, never off each other —
Qwen-Image-Edit's identity drift compounds over serial edits.

The style reference is the repo's own Ragnarok zombie sheet, the brute's
literal ancestor, cropped to a single idle cell.

## What is missing, and why it is not blocking

`clip_E_idle` — the run died on a guard strike. Not blocking: idle is normally
picked from the WALK clip's quietest frames anyway, which is what
`prep-brute.mjs` did deliberately ("Wan's 'walk' for a creature this heavy is a
weight-shifting stomp, and its quietest frames ARE the idle sway"), and it
guarantees the two clips share a body.

`run` and `stumble` are deliberately NOT generated. `alias()` hands `run` the
walk frames by reference at the run frame rate, and `withRecoil()` synthesizes
`stumble` from idle frame 0 — see `RUNTIME_COVERED` in build-plan.ts. That is 6
of 18 runs saved for no player-visible loss.

## THE FRAMES HERE ARE A FIRST CULL, NOT A CURATION

Each clip generated 21 frames; 6 are kept, evenly strided from frame 8 on.
64MB -> 21MB, because 234 raw frames is not something to put in a repo forever.

Wan spends its first ~6-8 frames easing out of the init (measured in
`55f98e2`: idle settled at 8, attack at 7, walk at 6), so the head of every
clip is near-duplicates of the master and unusable regardless.

STRIDED rather than scored, deliberately: `c4d9477` records that a scored
auto-picker was written and DELETED because it ranked the crisp init frame
worst — it was not measuring the defect it claimed to. A human still has to
look at these and pick 2-6 per clip.

## Next steps

1. **Look at the frames.** Build a contact sheet per clip and pick. Watch for
   Wan's aperiodic translucent smears — `prep-clips.mjs`'s `ghosting()` scores
   them, and on the 08-06 clip a smeared frame read 22743 against ~2000 for its
   crisp neighbours.
2. **Write a recipe** and run `prep/prep-clips.mjs build`. It never writes a
   `cells` override (that override is what made the 08-06 walk slide sideways)
   and it commits onto the x8 lattice with `derive: 20`.
3. **`npm run sprites`** — now runs `driftRow` as a hard gate and prints
   `gait peak` beside it, so this walk can be scored against the sway it
   replaces (08-06 measured 0.05; the frog, a good example, measures 0.45).
4. **`npm run moveset`** — the contact sheet of every (facing, clip) cropped
   from the LIVE atlas. Success is that its last line STOPS saying
   `facings drawing IDENTICAL frames — walk: S=N=E`.

## DO NOT PUBLISH A PARTIAL SET

This brute is a green orc-like creature; the one deployed at `c772aeb` is grey
and armoured. An E sheet in the new style over an old-style S would make the
creature CHANGE SPECIES when it turns — strictly worse than the missing-facing
bug it fixes. All three facings land together.

## Box notes, both measured the hard way

**`--frames 33` trips the RAM guard.** It took WSL under the 2.5GiB-sustained
floor and the guard HARD-stopped ComfyUI mid-run. 21 frames at `--tile 96`
completes in 236-360s. One clip (E/idle) still died to a strike at 21 frames,
so it is close to the edge — re-run a single clip rather than assuming a whole
block will survive.

**Bounce ComfyUI before any Wan block.** It was holding 13.8GB retained RSS
after 5.8h of qwen work; restarting returned 19 -> 33GB free. And start the
guard with it — a SOFT strike writes NO file and surfaces only as a bare
`execution_interrupted` plus one line in `~/comfy/guard.log`.
