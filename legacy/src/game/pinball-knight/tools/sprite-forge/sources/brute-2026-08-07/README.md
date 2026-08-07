# brute, 2026-08-07 — the Ragnarok restyle, part-generated

Where the second brute build got to, and what the next session should do with
it. Everything here is TRACKED because `work/comfy/` is gitignored and the
FIRST build lost its `attack` source frames exactly that way.

## What is here

    00_master_S_ragnarok.png   the styled front master  (qwen edit,    seed 11)
    01_master_E_ragnarok.png   rotated to the side      (qwen rotate,  seed 11)
    wan_003*.png               21-frame E walk clip     (Wan animate,  seed 11)

## How they were made

    # STYLE BY EXAMPLE, not by adjective. PROMPTS.md measured that stronger
    # pixel-art wording makes every metric WORSE: asking in capitals for no-AA
    # / flat fills / <=16 colours produced 301,541 distinct colours, entries
    # 26.6->30.7, isolated 41.5->47.8, matte keyed 79.2%->61.3%.
    cli.mjs edit --init sources/brute-2026-08-06/00_master_idle.png \
                 --ref <one idle cell cropped from inbox/zombie-E.png, white-matted> \
                 --prompt "Redraw this character as clean pixel art, a hulking
                           gym-buff zombie brute, same pose, same size, same
                           position. Match the pixel art style, palette and
                           proportions of Figure 2." --seed 11

    cli.mjs rotate  --init 00_master_S_ragnarok.png --to right --seed 11
    cli.mjs animate --init 01_master_E_ragnarok.png --preset walk --frames 21 --tile 96 --seed 11

The style reference is the repo's own Ragnarok zombie sheet — the brute's
literal ancestor — cropped to a single idle cell.

## What worked

**The style transfer.** The master came back as genuine pixel art: hard edges,
flat fills, a black outline, a readable hulking silhouette with tusks, yellow
eyes and the belly wound carried over from the 08-06 identity. This is the
answer to "too 80s, not enough pixel", and it came from a REFERENCE IMAGE
rather than from stronger prompt words.

**The walk has an actual gait.** The 08-06 clip was, in `prep-brute.mjs`'s own
words, "a WEIGHT-SHIFTING SWAY, not a stride… Wan gave the brute almost no
locomotion" — it measures `gait peak 0.05` against the frog's 0.45. These frames
show the legs genuinely passing each other. The un-drifted `cli.mjs animate`
(which now dispatches through `MODES` instead of a hand-copied prompt) is why:
it finally applies the walk preset's lift-and-plant wording AND `preset.avoid`'s
ban on "feet sliding along the ground, gliding, ice skating, floating,
shuffling, legs merging".

**Wan output is SOFT, and that is correct.** These frames are painterly, not
crisp. `commit.ts`'s x8 lattice is what imposes the pixels downstream —
"Generate for pose and layout; let code handle the pixels" (PROMPTS.md).

## THREE THINGS THE NEXT SESSION MUST HANDLE FIRST

**1. There is a cast SHADOW under the figure, and it wrecks measurement.**
The qwen master put a lavender ellipse on the ground and Wan preserved it in
every frame. It is wider than the legs and constant, so it stretches the
silhouette bbox and defeats stance scoring — an attempt to pick frames by leg
spread returned 227-242px across all 21 frames because it was measuring the
shadow, not the creature.

`graphs.mjs`'s Wan negative already bans `shadows`. The QWEN prompts do not.
Fix it in `modes.mjs` (`intake-style`, `rotate`), because the shadow enters at
the master and everything downstream inherits it.

**2. DO NOT PUBLISH THIS AS A PARTIAL SHEET.** This brute is a green orc-like
creature; the one deployed at `c772aeb` is a grey armoured one. Publishing an E
sheet in the new style while S keeps the old would make the creature CHANGE
SPECIES when it turns — strictly worse than the missing-facing bug it fixes.
The whole set lands together or not at all:

    clip     S              E              N
    idle     old sheet      pick from walk  —
    walk     old sheet      THESE FRAMES    —
    attack   old sheet      —               —
    death    painter        —               —

`run` and `stumble` are deliberately NOT generated — `alias()` and
`withRecoil()` cover them at runtime (`RUNTIME_COVERED`, build-plan.ts). That
is 4 clips x 3 facings = 12 Wan runs, of which one is done.

**3. `--frames 33` TRIPS THE RAM GUARD ON THIS BOX.** A 33-frame Wan run took
WSL under the 2.5GiB-sustained floor and the guard HARD-stopped ComfyUI
mid-run (`~/comfy/guard.log`, 03:25:39 — and note a HARD strike DOES log while
a soft one writes nothing). 21 frames at `--tile 96` completes in ~359s.

Bounce ComfyUI before any Wan block regardless: it was holding 13.8GB retained
RSS after 5.8h of qwen work, and restarting returned 19 -> 33GB free.

## Assembly, when the set is complete

`prep/prep-clips.mjs` with a recipe — it never writes a `cells` override (that
override is what made the 08-06 walk slide sideways) and it commits onto the x8
lattice with `derive: 20`. Then `npm run sprites`, which now runs `driftRow` as
a hard gate and prints `gait peak` beside it, so this walk can be scored
against the sway it replaces.
