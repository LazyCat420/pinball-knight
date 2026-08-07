# PLAN — generate the sprite, don't restyle a photo of one

**Status:** design, not built. Written 2026-08-07 after a moveset generated the
old way was published and rejected on sight. The pipeline shape below is the
user's; the measurements and the file references are what this repo already
knows. Nothing here needs new models — one new mode, one new gate, and a
sequence that uses four modes that already exist.

## THE SHAPE

    1. TEXT -> IMAGE, no init at all.        the master. prompt only.
    2. that image becomes the init.
    3. KEYFRAMES per clip, 4-6 poses         one generation, one sheet, N poses
       in ONE generation.
    4. CUT the sheet into cells.             each pose is now its own frame
    5. IN-BETWEEN each adjacent pair,        keyframe A as init, keyframe B as
       generating the gap frames.            the end. Repeat around the loop.

Every step after (1) is conditioned on art this pipeline made, at the size it
will ship at. That is the whole idea, and it is the opposite of what happens
today.

## WHY THE CURRENT PATH CANNOT PRODUCE PIXEL ART

Read this before proposing a smaller fix. Four measurements, all in-repo:

**1. Nothing generates pixel art. The lattice is manufactured at the end.**
`commit.ts` block-reduces the finished sheet onto an x8 lattice and snaps to 20
colours. That is a downsample of a painting. The forge says so in the report,
in its own words, about the sheet published on 2026-08-07:

    GRID  NOT PIXEL ART — no lattice (best x3 at 1.2%, need 90%) and only 44%
          flat neighbours. Continuous/anti-aliased art: it will be RESAMPLED,
          not reduced, and CANNOT import 1:1.

**2. The gate cannot tell good from bad, because it runs after the crush.**
Post-commit, the rejected 08-07 sheet and the liked 08-06 one BOTH measure
`grid x8, confidence 100%, cell purity 100%`. `detectPixelGrid` is measuring
the reduce, not the art. This is why a bad drop passed every check and got a
"BETTER than the painted roster" verdict on its way out the door.

**3. Asking harder for pixel art makes it worse.** `PROMPTS.md` measured it:
capitals demanding no-AA / flat fills / <=16 colours produced **301,541
distinct colours**, entries 26.6->30.7, isolated 41.5->47.8, matte keyed
79.2%->61.3%. Wording is not the dial. Neither is the game's resolution
(`a-sheet-authored-above-the-texel-budget-cannot-be-rescued`).

**4. The quality in the liked sheet is not generated — it is inherited.**
`55f98e2` is titled "a Ragnarok sheet in, a playable brute out": a real
Ragnarok Online sprite, drawn by a human at ~70 texels, went in. Every
generation since has been a restyle of a restyle of that, and each hop loses
edge hardness. The figure ships at ~70 texels; the generations are 640-1024px,
a 9.5:1 crush that `7c8036f` already named "mush".

`7c8036f` also wrote the conclusion this plan implements: *"art authored above
the texel budget cannot be rescued downstream. The durable fix is to generate
for ~70 texels in the first place."*

## AND WHY THE ANIMATION DOES NOT PLAY

Share of the sprite box that changes between consecutive published frames,
measured on the cells the game actually draws:

    row      liked (55f98e2)   rejected (08-07)
    idle           63%               14%
    walk           69%               53%
    attack         75%               65%

Idle is what a monster does most of the time on screen, and the rejected one is
effectively a still. The cause is upstream of frame-picking: the S idle clip
measured **479x588 for all 21 frames**, `gaitSignals` lean flat at +0.068. Wan
I2V, free-running from one image and a sentence, produced no motion — and the
prompt it was given even contains *"the character stays centered in frame"*.

Nothing in that path conditions the pose. Step (3) below is what fixes it: a
pose is not something you hope for, it is something you draw and then ask the
model to reach.

## WHAT ALREADY EXISTS (do not rebuild these)

    keyframes    modes.mjs:441   N named poses in ONE generation, one sheet out
    inbetween    modes.mjs:409   needs.end — first frame + LAST frame, gap filled
    segment      modes.mjs:275   cut-out to alpha
    pose         cli.mjs         ControlNet: --init = IDENTITY, --control = STRUCTURE
    cut          pipeline route  the real matte+slicer, sheet -> cells
    commit       commit.ts       x8 lattice + 20-colour derive, at the very end

`components/forge/JobsBoard.tsx` already cuts a keyframe sheet into cells
client-side and offers each cell as `-> init` / `-> last` / `+ sheet`. The
keyframe workflow was built and then bypassed; `animate` was easier to call.

## WHAT IS MISSING

**1. A text-to-image mode. This is the one real gap.** `app/api/comfy/generate/route.ts`
rejects every request without an init:

    if (!body.imageB64) return 400 "imageB64 is required — pick an init frame first"

Every mode in `MODES` declares `needs.init`. There is no path in this repo that
generates from a prompt alone. Step (1) cannot be done today.

**2. A pixel gate that runs on the GENERATION, not on the crush.** Run
`detectPixelGrid` on the raw model output, before `commit`, and FAIL the run
there. On the 08-07 frames that gate reads `grid x1, confidence 0%, flat 36%` —
it would have stopped the whole drop on the first image. Today the same
function only runs after the lattice has been imposed, where it always says
100%.

**3. Nothing renders a clip as a clip.** Every judgement in this repo is made on
still contact sheets. A 4-frame loop played at the game's frame rate is the
only honest preview of a walk cycle, and the reason a 14%-motion idle survived
review is that nobody watched it move.

## THE STEPS, CONCRETELY

### 1 — master from a prompt, no init

New mode `txt2img` in `modes.mjs`, plus dropping the hard init requirement in
the generate route for modes that declare `needs.init === false`.

- Generate **at the texel budget or a clean multiple of it** — target the
  figure at ~70 texels tall, so a 560px canvas is x8 and reduces exactly.
  Generating at 1024 and hoping is what produced the mush.
- Put `tarn59_pixel_art_style_qwen` (`rot-lora-style`, already in the manifest
  and installed) on this leg. This is the one place a pixel LoRA belongs — note
  that `pix3lwalk` on the WAN leg failed completely (`55f98e2`: black
  background, 0/21 usable), which is evidence about the animate leg, not about
  pixel LoRAs.
- **Magenta field, not white.** `55f98e2`: "the repo's own magenta chroma key
  survives luminance drift where a white field does not." `isChroma` keys the
  magenta family for free and exactly; a pale field needs the tolerance matte
  and leaves a soft fringe.
- GATE, hard: `detectPixelGrid` on the output. Reject unless it reports a real
  lattice at the intended factor. Re-roll, do not "fix downstream".
- Keep the seed and the resolved prompt in `job.json` — `cli.mjs` records both
  now.

### 2 — that master is the init, and the only one

Both other facings branch off the ONE approved master, never off each other
(Qwen-Image-Edit identity drift compounds over serial edits — this rule is
already in the 08-07 README and it held up). `rotate` mode, seed pinned.

Re-run the step-1 gate on each rotation. A rotation that comes back
anti-aliased has left the lattice and everything downstream inherits it.

### 3 — keyframes, 4-6 poses per clip, one generation

`keyframes` mode, one call per (facing, clip). Its presets already declare the
poses per clip (`modes.mjs:189-260`). Read `POSE_IS_THE_LATENT.md` first — the
poses regress toward each other when four share one denoising pass, which is
the known failure of this mode and the reason `pose`/ControlNet exists as the
escalation:

    cli.mjs pose --init <master.png> --control <posed reference.png> \
                 --type openpose --strength 0.8

`--init` carries identity, `--control` carries structure. Handing a pose in as
the init is "the thing POSE_IS_THE_LATENT.md measured failing six ways".

Success is that the poses are DIFFERENT. Measure it, do not eyeball it:
`gaitSignals` lean (drift.ts) should show real alternation for a walk, and
consecutive cells should differ by the 60-75% the liked sheet shows, not 14%.

### 4 — cut

`op: "cut"` on the pipeline route — the real matte + slicer, the same code the
import runs. The panel already does this and lays the cells on ONE canvas
sized to the widest and tallest, feet on a shared baseline. Read the comment
above `cutSheetToCells` in `JobsBoard.tsx` before changing anything there: tight
per-cell crops arrive at different scales and the video leg then interpolates a
slow zoom, which is what that shared canvas exists to prevent.

### 5 — in-between, keyframe to keyframe

`inbetween` mode, which already takes `init` + `end`. For a clip with keyframes
K1..Kn, run K1->K2, K2->K3, … and Kn->K1 to close the loop. Take 1-2 frames
from the middle of each gap.

- Wan spends its first ~6-8 frames easing out of the init (measured three times:
  idle 8, attack 7, walk 6). With a pinned END this should shrink or vanish —
  verify it rather than assuming, because the whole point of pinning both ends
  is that the model no longer has to invent where it is going.
- Re-run the pixel gate on the in-betweens. This is where blur will appear
  first if it appears at all.

### 6 — assemble, and only then commit

`prep/prep-clips.mjs` with a `recipe-<DIR>.json` (the format and its `report`
mode are already there; it keys any background as of 2026-08-07). Then
`npm run sprites`, which runs `driftRow` as a hard gate and prints the census.

If step 1 held the lattice, `commit` becomes a no-op that confirms it rather
than a crush that manufactures it. **That is the test of whether this plan
worked.**

## GATES, IN ORDER, ALL FAIL-CLOSED

    1. master        detectPixelGrid on the RAW generation — real lattice or re-roll
    2. rotations     same gate, per facing
    3. keyframes     poses measurably differ (lean alternation / >=50% cell-to-cell)
    4. in-betweens   same pixel gate; no new blur
    5. sheet         cutSheet finds the intended shape; driftRow centred+grounded
    6. published     published.test.ts coverage; every clip authored, no painter
                     fallthrough (see `a-partial-sheet-plays-the-painter-for-what-it-omits`)
    7. THE EYE       play the clip at game frame rate and watch it. No number
                     replaces this. A census verdict of "BETTER than the painted
                     roster" was printed for art that was rejected on sight.

## WHAT NOT TO DO AGAIN

- Do not run `animate` free from one image and pick frames out of the result.
  That is the rejected path.
- Do not treat a static clip as a curation problem. If the frames do not differ,
  the generation failed; regenerate it.
- Do not read a post-commit `grid x8, confidence 100%` as evidence the art is
  pixel art. It measures the reduce.
- Do not publish a partial set of facings or clips — a missing clip plays the
  PAINTER, which is a costume change mid-animation (`boot/sheets.ts` `paintsFor`).
- Do not restyle the restyle. Every generation branches from the ONE approved
  master.

## STATE AS OF THIS COMMIT

`public/sprites/brute-S.{png,json}` is back to the 55f98e2 gym zombie,
byte-identical — the sheet that is "at least halfway there". The 08-07 sheets
were published during that session and have been reverted; the brute is once
again `3/18 rows · facings S · NO DEATH`, with death and stumble falling
through to the painter. That bug is real and this plan is how it gets fixed
properly.

Kept, because they are independent of the art and measured:
`sources/brute-2026-08-07/` (masters, clips, `recipe-<DIR>.json` recording what
was picked and on what), the `prep-clips` matte fix, the `/forge` panel's
editability work, and the moveset lab.
