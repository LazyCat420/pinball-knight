# Generation prompts for imported sheets

The two creatures with imported art are `jester` and `rotortail` (whose sheet is
named `beaver`). See `IMPORTED_ART` in `boot/sheets.ts`.

**Generate ONE IMAGE PER CLIP ROW.** A 6-frame row of 432px-tall figures is
~2900px wide, which no generator gives you in one shot at usable fidelity.
Strips composite cleanly — `slice.ts` finds rows.

## ⛔ READ THIS FIRST — the prompt is not the lever, and that is measured

**A better prompt cannot fix the census. Round 2 proved it.** Do not spend
generations trying. The prompt below is worth using for POSE and LAYOUT, which
a generator does obey, and for nothing else.

Round 2 (`jester_test.png`, 2026-07-31) asked in capitals for *"NO
anti-aliasing"*, *"every region is a FLAT fill of a single solid colour"*, and
*"AT MOST 16 distinct colours"*. It came back visually excellent — and measured:

| metric | shipped `jester-S` | round 2 | target | |
|---|---|---|---|---|
| distinct colours in source | 204,201 | **301,541** | 16 requested | ✗ worse |
| flat neighbours | 11% | 15% | 55% to pass | ✗ |
| census `entries` | 26.6 | **30.7** | 20.1 roster / 20 lock | ✗ worse |
| census `isolated%` | 41.5% | **47.8%** | 22.5% roster | ✗ worse |
| matte keyed | 79.2% | **61.3%** | — | ✗ worse |
| GRID lattice | 0.4% | 0.5% | 90% | ✗ |

**301,541 colours against a request for 16.** The art *looks* like flat 16-colour
pixel art at a glance because it is a continuous-tone RENDERING of that
appearance — every apparently-flat block is a smooth gradient of hundreds of
near-identical values. The crush then snaps each of those to a different palette
index, which is exactly why `entries` went UP.

Not a delivery artifact: JPEG blockiness measured **1.022** (>1.15 would mean
recompression), so re-exporting as PNG changes nothing. The noise is native to
the generator. The empty background is genuinely near-flat (172 colours, σ≈1) —
it is the *artwork* that is continuous.

**What this leaves.** The colour count and the lattice both have to be imposed
OFFLINE, by a deterministic grid-commit step, not asked for. See
[[the after-generating section]] below. Generate for pose and layout; let code
handle the pixels.

---

**What to optimise for.** POSE and LAYOUT — the two things a generator does
obey. Colour count and flatness are handled downstream; asking for them is
measured to be worse than useless (it cost a round and moved every metric the
wrong way).

---

## Lessons from round 1 (2026-07-31) — these are why the rules below exist

The first regeneration came back stylistically excellent and structurally
unusable. Flat fills, hard edges, the motley lattice reading cleanly, the ruff
separating from the gold — the style problem was solved in one shot. Every rule
marked ⚠️ below exists because of a specific structural failure:

- **A palette legend was drawn into the image.** 16 swatches with hex captions
  along the bottom edge. `slice.ts` reads that as a ROW OF CELLS — a phantom
  clip that shifts every subsequent row index and breaks the sidecar mapping.
- **The layout ignored the clip structure**: 2 rows of 8 where the sidecar
  wanted 5 rows of 4/4/6/2/4. Naming a clip and a frame count does not make a
  generator lay out a sheet.
- **The poses did not animate.** Sixteen near-identical standing frames with
  different arm positions. A generator will not infer a cycle from the word
  "walk" — every frame has to be described.
- **The rotor was drawn as scenery**, static crossed planks behind the
  shoulders reading as a woodpile. The one silhouette feature that makes the
  creature not-a-beaver was absent.
- **The figure floated in dead space**, ~40% of canvas height, throwing away
  resolution the resample needs.

---

## Shared preamble — prepend to every prompt

    16-bit SNES-era pixel art sprite strip for a dungeon crawler.

    STYLE: hard-edged pixel art. NO anti-aliasing, NO soft edges, NO gradients,
    NO blur, NO glow, NO dithering, NO texture noise. Every region is a FLAT
    fill of a single solid colour. One solid 1-pixel dark outline around the
    silhouette and around each major form. Chunky, readable, high contrast.

    COLOUR: use ONLY the hex values listed below. Do not substitute a near
    match, do not add tints, do not introduce a colour that is not on the list.
    Shade in 3 discrete steps per material — never a smooth ramp.

    BACKGROUND: solid pure magenta #FF00FF, perfectly flat, edge to edge.
    No ground plane, no shadow, no vignette, no border.

    ⚠️ DO NOT DRAW A PALETTE CHART. No colour swatches, no hex codes, no
    reference strip, no legend, no key — anywhere in the image, including the
    margins. Nothing but the creature on flat magenta. Any coloured rectangle
    that is not part of the creature will be misread as an animation frame.

    ⚠️ DO NOT DRAW: text, numbers, labels, captions, frame borders, grid lines,
    panel dividers, drop shadows, or a title.

    COMPOSITION: all frames in ONE horizontal row, evenly spaced, same scale,
    feet on a common baseline, facing the viewer (front / south facing).

    ⚠️ FILL THE FRAME. The tallest pose in the row must span at least 90% of
    the image height. No more than 5% empty margin above the head or below the
    feet. Wasted canvas is thrown-away resolution.

    ⚠️ EVERY FRAME MUST BE A DIFFERENT POSE, described one by one below. Do not
    repeat a pose with only the arms changed.

---

## jester — `jester-S.png`

**The silhouette rule, and it governs everything.** You read this creature's
threat off its HEIGHT. Its lower body is a coiled steel spring: compressed to a
tight stack on the wind-up, at double body height on the release. A row of
jester frames that are all the same height has failed, however good the costume
looks. Height IS the animation.

**The colour rule, and it is not the one you would guess.** Measured 2026-07-31
(`scripts/jester-colour-ab.mjs`): the pipeline carries IN-PALETTE art at ΔE 1.57
and generated art at ΔE 36.8, so the source is the whole problem — but asking
for the palette does not fix it, because a generator ignores hex lists (16
requested, 301,541 returned). Three snap techniques were tried and separated by
2.4%, which is nothing.

**So stop optimising for hue accuracy and optimise for VALUE SEPARATION.** The
snap will move every colour several steps whatever you do. What survives that is
contrast between neighbouring materials; what dies is two materials at the same
brightness. Fewer materials, further apart in value, is worth more than any
number of correct hexes.

    SUBJECT: a grinning harlequin jester whose lower body is a COILED STEEL
    SPRING instead of legs, mounted on a round metal base plate stamped with a
    star. Diamond-lattice motley costume in DARK MAROON RED and GOLD. A large
    scalloped CREAM ruff collar at the neck, cream gloves, cream stockings.
    Belled jester cap. Pale mask-like face with CYAN diamond greasepaint over
    the eyes and a bright red nose. Dark brown curl-toe shoes on the base plate.

    ⚠️ USE AT MOST SIX MATERIALS, and make each one a clearly different
    BRIGHTNESS from the ones it touches. Read as a greyscale image it must still
    be legible — if two neighbouring parts would be the same grey, they are
    wrong however different their colours are. From darkest to lightest:

      1  outline / shoes        near-black
      2  motley MAROON          dark
      3  spring steel           mid, cool
      4  motley GOLD            mid-bright, warm
      5  ruff / gloves CREAM    bright        (two clear steps above the gold)
      6  face + specular        brightest

    The maroon and the gold are a diamond checker over the whole torso, so they
    must differ in BRIGHTNESS as well as hue — a checker of two equally-bright
    colours turns into one flat mass at sprite size.

    PALETTE — target these, but VALUE SEPARATION above matters more:
    maroon  #3a0f18 #6b1f2a #a83244
    gold    #7a3b12 #d97b29 #f0a63c
    cream   #f0a63c #ffd98a #fff3c8
    steel   #4a5364 #8a94a6 #c8ccd4   (the spring only)
    leather #2a1c14 #4a3222 #6b4a2e   (shoes)
    accent  #6fd0e8 (greasepaint)  #d95763 (nose)
    outline #171a22

    ⚠️ NO DETAIL SMALLER THAN 1/20th OF THE FIGURE'S HEIGHT. The creature is
    about 46 texels tall on screen, so a feature under ~2 texels is not detail,
    it is noise the crush turns into speckle. Big shapes, few of them: three
    diamonds across the torso, not twelve. Four bells, not sixteen.

    The spring must read as a HELIX, not a grey bar: back half of each coil in
    #4a5364, front half in #8a94a6 with a #c8ccd4 specular. Keep it clear of
    the base plate rim. It is the one COOL thing on a warm figure — that is
    what makes it read as metal.

One image per row. Describe the frames explicitly:

**Row 1 — `idle`, 4 frames.** Spring at rest, gentle bob.
1. neutral, spring at rest height, arms loose at sides
2. spring compressed slightly, shoulders dip, cap bells swing out
3. back to rest height, arms loose
4. spring extended slightly, figure rises, bells swing the other way

**Row 2 — `attack`, 4 frames.** The height range must be extreme.
1. deep CROUCH — spring squashed to a tight stack of coils, body low and wide, arms drawn in
2. launch — spring half extended, body rising fast, arms thrown back, cap streaming
3. FULL STRETCH — spring at maximum extension, figure at roughly DOUBLE its idle height, arms overhead, grin wide
4. recover — spring settling, body descending, arms coming down

**Row 3 — `walk`, 6 frames.** A hopping cycle, not a stride.
1. compressed, weight loaded
2. pushing off, spring extending, body tilted forward
3. airborne, spring at full stretch, base plate lifted
4. descending, spring compressing, body tilted forward
5. landing, spring squashed, the coil splayed
6. rebounding, spring mid-extension

**Row 4 — `stumble`, 2 frames.** Staggered, off balance.
1. knocked backward, spring bent sideways in an S, arms flailing, cap askew
2. further off balance, base plate tipping onto its rim, ruff flung up

**Row 5 — `death`, 4 frames.** The spring fails.
1. spring buckles at the middle, body lurching
2. body folds forward over the collapsing coil
3. spring collapsed flat, coils splayed open, figure slumped on the plate
4. lying flat and still, cap fallen off beside the plate

Sidecar `inbox/jester-S.json`:

```json
{ "rows": ["idle", "attack", "walk", "stumble", "death"] }
```

---

## rotortail — `beaver-S.png`

**The silhouette rule.** The rotor is the whole creature. It is a BLADED ROTOR
MOUNTED WHERE THE TAIL IS — low and behind the hips, spinning in the plane of
the body, like a helicopter tail rotor or a circular saw. It is NOT a backpack,
NOT crossed planks behind the shoulders, NOT scenery. If you can remove it and
still have a normal beaver, it is drawn wrong.

    SUBJECT: a stocky armoured BEAVER. Where its flat tail should be — low,
    behind the hips — is a SPINNING BLADED ROTOR: four dark timber blades set
    at an angle on a brass hub, turning in the plane of the body. Dark brown
    pelt, lighter tan belly, big chisel front teeth. Riveted steel skullcap
    helm and round brass-rimmed goggles with a glowing cyan lens.

    PALETTE — use ONLY these, no substitutes:
    pelt    #4a3222 #6b4a2e #a9705a
    belly   #a9705a #d69f7e
    timber  #2a1c14 #4a3222 #6b4a2e   (the blades)
    steel   #4a5364 #8a94a6           (helm, armour)
    brass   #7a3b12 #f0a63c #ffd98a   (goggle rims, rotor hub)
    glass   #1f3d52 #2e6d8f #6fd0e8   (lens)
    teeth   #eef1f5
    outline #171a22

**Row 1 — `idle`, 4 frames.** Rotor turning slowly; blades at four distinct
angles (0°, 22°, 45°, 67°). Body breathing, weight even.

**Row 2 — `walk`, 4 frames.** A waddle: weight onto the left foot, body forward
and low, weight onto the right foot, body forward and low. Rotor keeps turning.

**Row 3 — `attack`, 4 frames.**
1. crouch, rotor spinning up, blades starting to smear
2. rotor at full speed — blades as a solid disc — body leaning forward
3. lunge, the whole body driven forward behind the rotor, jaws open
4. recover, rotor slowing, body straightening

**Row 4 — `death`, 4 frames.**
1. rotor seizes, one blade snapped, body jolted
2. stagger backward, helm knocked askew
3. toppling sideways, rotor digging into the ground
4. flat on the ground, rotor bent and still, goggle lens dark

Sidecar `inbox/beaver-S.json`:

```json
{ "rows": ["idle", "walk", "attack", "death"] }
```

---

## After generating

1. Drop the strips in `inbox/`. If you generated per-row, hand them over to be
   composited into a single `<name>-S.png` — the slicer wants one image.
2. `npm run sprites`
3. Read `work/report.txt`. **Do not expect GRID or the census to pass on raw
   generated art** — round 2 measured both getting worse, not better. What you
   are checking at this stage is that the SLICE is right (`N rows [a/b/c]`
   matching your sidecar) and that the poses read.

### The grid-commit step — SHIPPED, and it is what makes the numbers move

Raw generated art cannot pass, so both properties are imposed offline, once,
deterministically (`commit.ts`). Add `"commit": true` to the sidecar:

```json
{ "rows": ["idle", "walk"], "cells": [8, 8], "commit": true }
```

`npm run sprites` then writes a committed copy into `work/<name>/` and prints
the one command that promotes it. It never touches `inbox/` itself — a commit
decides which 20 of 32 colours the creature keeps, and an eviction nobody
looked at is how a creature quietly loses its costume.

Measured on round 2's jester (`jester_test.png`):

| | raw | **committed** | painted roster |
|---|---|---|---|
| GRID | ✗ no lattice | **✓ ×8 at 100%** | — |
| census `entries` | 30.7 | **23.2** | 20.1 |
| census `isolated%` | 47.8% | **34.5%** | 22.5% |
| census `runLen` | 1.26 | **1.39** | 1.82 |
| **`invented`** | 30.7 | **3.3** | — |
| verdict | WORSE | **COMPETITIVE** | — |

**`invented` is the number that matters** — colours the PIPELINE added after the
artist finished — and it fell 9×. The committed source holds exactly 20 entries;
the residual ~3 are the engine's own `selout` rim pass, which painted sprites
pay too. The resample is no longer inventing anything.

**Sizing.** The commit targets the WIDEST camera rung (54 texels), so the figure
fits at all five and imports 1:1 at every one of them. That caps a standard
monster at 46 texels tall.

**Two traps it has to work around, both measured:**
- A committed cell must be a whole number of blocks, so cells are trimmed to
  their INK before layout — nothing reads the rects the commit emits, because
  the forge and the game both re-slice the PNG. An untrimmed cell re-sliced to
  183px against a ×8 lattice and the 1:1 reduce silently became a 3.98:1
  resample.
- **Never put a `cells` override in a committed sidecar.** `equalCells` divides
  a row into N EQUAL columns, which un-does the ink trim and breaks the lattice
  the same way. The commit verifies its own auto-slice before writing.

**Naming.** `<creature>-S.png` is south / toward camera. `-E` is the true side
profile, `-N` is away. W is never authored — the engine mirrors E.
