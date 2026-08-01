# Generation prompts for imported sheets

The two creatures with imported art are `jester` and `rotortail` (whose sheet is
named `beaver`). See `IMPORTED_ART` in `boot/sheets.ts`.

**Generate ONE IMAGE PER CLIP ROW.** A 6-frame row of 432px-tall figures is
~2900px wide, which no generator gives you in one shot at usable fidelity.
Strips composite cleanly — `slice.ts` finds rows.

**What to optimise for.** Not the pixel lattice — no generator emits one, and
the gate will keep saying NOT PIXEL ART. Optimise for **flat fills, a low
colour count, and poses that actually differ**, because those are the failures
the census and the eye actually report (jester: 26.6 entries against the
20-entry atlas lock, 41.5% isolated pixels against the roster's 22.5%).

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

    SUBJECT: a grinning harlequin jester whose lower body is a COILED STEEL
    SPRING instead of legs, mounted on a round metal base plate stamped with a
    star. Diamond-lattice motley costume in DARK MAROON RED and GOLD. A large
    scalloped CREAM ruff collar at the neck, cream gloves, cream stockings.
    Belled jester cap. Pale mask-like face with CYAN diamond greasepaint over
    the eyes and a bright red nose. Dark brown curl-toe shoes on the base plate.

    PALETTE — use ONLY these, no substitutes:
    maroon  #3a0f18 #6b1f2a #a83244
    gold    #7a3b12 #d97b29 #f0a63c
    cream   #f0a63c #ffd98a #fff3c8
    steel   #4a5364 #8a94a6 #c8ccd4   (the spring only)
    leather #2a1c14 #4a3222 #6b4a2e   (shoes)
    accent  #6fd0e8 (greasepaint)  #d95763 (nose)
    outline #171a22

    The spring must read as a HELIX, not a grey bar: back half of each coil in
    #4a5364, front half in #8a94a6 with a #c8ccd4 specular. Keep it clear of
    the base plate rim.

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
3. Read `work/report.txt`. The line that matters is not GRID (it will still
   fail) but the census:

       MEAN   entries <20  isolated <25%
       ROSTER entries 20.1 isolated 22.5%

   Beating the roster on `entries` and `isolated%` is the win condition for a
   regenerated sheet. GRID passing needs a grid-commit step, not a better prompt.

**Naming.** `<creature>-S.png` is south / toward camera. `-E` is the true side
profile, `-N` is away. W is never authored — the engine mirrors E.
