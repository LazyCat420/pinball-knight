# PLAN — make ONE walk correct: the dog

**Status:** plan, written 2026-08-07 after the first end-to-end run
(`create` → `animate`) produced a usable-but-flawed 21-frame walk. Scope is
deliberately one character and one clip. Everything here is either a
measurement taken on that clip's actual frames or a repo fact with a file
reference. Related: `PLAN_KEYFRAME_PIPELINE.md` (the shape), `POSE_IS_THE_LATENT.md`
(what has already been eliminated).

Subject: `work/comfy/animate-walk-2026-08-07T20-46-28/` — 21 frames, 640x640,
seed 7, 435s, `pix3lwalk` at 0.8 on the high-noise expert.
Master: `work/comfy/create-2026-08-07T20-01-52/` — 1024x1024, seed 11,
`tarn59-pixel-style` at 0.8.

---

## 1. THE BLURRY FRAMES ARE A DECODE ARTEFACT, NOT MOTION BLUR

This is the finding. It changes what the fix is.

### The measurement

Per-frame **ghost%** = share of figure pixels that are simultaneously *pale*
(luma > 170 against a black-coated dog) and *flat* (|Laplacian| < 0.02) —
i.e. a limb that has gone semi-transparent rather than moved. Computed over
all 21 frames, background excluded:

    i   ghost%   lapvar   legdark        i   ghost%   lapvar   legdark
    0     0.50   105.20      41.6       11     1.56   118.12      46.1
    1     1.21   117.29      46.4      *12     4.47    55.02     122.9
    2     0.39   125.92      36.6      *13     4.42   142.12      66.2
    3     0.34   122.47      39.4       14     2.12   139.83      51.4
   *4     5.39    50.36     117.3       15     0.19   139.83      35.4
   *5     4.05    99.09      57.3      *16     6.48    95.46      95.9
    6     0.12   111.77      27.9       17     0.71   146.09      29.7
    7     0.46   111.31      35.2       18     1.13   134.65      28.3
   *8     3.66    52.33      70.5       19     1.24   132.76      35.1
    9     0.48   133.66      31.1       20     1.76   127.54      43.4
   10     0.41   115.11      26.5

    median 1.21, MAD 0.82. Outliers (> median + 3*MAD): 4, 5, 8, 12, 13, 16.

Clean frames sit at 0.1–1.3%. Bad frames sit at 3.7–6.5%. That is a 4–8x
separation with nothing in the gap — this is an easy threshold, not a
judgement call. It matches by eye exactly the frames picked out of the
contact sheet.

### The pattern is the mechanism

The bad frames are **4, 5, 8, 12, 13, 16**. The decode is

    dec: VAEDecodeTiled { tile_size: 128, overlap: 32,
                          temporal_size: 8, temporal_overlap: 4 }   graphs.mjs:609

Wan's VAE compresses time 4:1 (which is why `length` must be 4k+1 —
`graphs.mjs:542`). With `temporal_size: 8` / `temporal_overlap: 4` the decoder
walks the clip in overlapping temporal windows and **cross-fades** the two
decodes wherever they overlap. The window boundaries land on output frames
4, 8, 12, 16 — and every one of them is an outlier, plus the frame after two
of them. No frame away from a boundary is an outlier.

The visual signature confirms it: frame 16 is not a *smear*, it is a **double
exposure** — two complete, sharp-ish leg positions superimposed at ~50% each.
Motion blur smears one limb along its path. A crossfade of two independent
decodes shows two limbs. Frames 4 and 16 show two.

This is a known upstream bug shape:
[Comfy-Org/ComfyUI#11767 — "tiled VAE causes ghosting in between temporal
chunk"](https://github.com/Comfy-Org/ComfyUI/issues/11767), with the stated
workaround being *avoid temporal gaps by increasing temporal size*.

### Why prompting cannot fix it

`motion blur` is **already in the negative prompt** (`graphs.mjs:521`), and it
is in there next to the camera and background terms that demonstrably do work.
It did nothing here because the artefact is created *after* the sampler, in the
decoder. This is the same class of error as `PLAN_KEYFRAME_PIPELINE.md` §3
("asking harder for pixel art makes it worse") — the dial is not in the words.

### The fix, in order of preference

1. **Decode the clip in one temporal window.** `temporal_size: 24`
   (>= length), `temporal_overlap: 4`. No boundary, no crossfade, no ghost.
   Costs decode RAM, which is exactly what forced the tiling
   (`graphs.mjs:596-608`, three runs killed by the guard).
2. **Shrink the canvas so (1) fits.** 640x640 is 1.56x the pixel area of
   512x512 and 2.1x that of 448x448. We want a smaller canvas *anyway* for
   §3 below, so this is one change that pays twice: less decode RAM → whole-clip
   temporal decode → no seams, and a figure nearer the texel budget.
3. **Spatial tile stays the RAM lever.** `tile_size` 128 → 96 buys headroom
   without touching the temporal axis. Spatial seams were already argued
   irrelevant under the crush; temporal ones are not, and now we know why.
4. **Gate it either way** (§2). Even a clean decode should be measured, because
   a silent regression here is invisible on a contact sheet.

### THE A/B — RUN, AND IT SETTLES IT

⚠️ The pair originally written here changed the canvas AND the temporal size
together, which would have confounded them. The run that happened changed ONE
variable: same seed 7, same master, same prompt, same 640x640 canvas, same
LoRA stack. Only `temporal_size`.

    A  temporal_size  8   worst frame 10.43%   7 of 21 flagged   435s
    B  temporal_size 24   worst frame  0.23%   0 of 21 flagged   556s

Every frame of B lands between 0.09% and 0.23%. **B's worst frame is cleaner
than A's best.** The two populations do not overlap. Frame 12 — 10.43% in A,
with the hind legs see-through — comes back in B with all four legs solid.

The mechanism is confirmed. It was the decoder's temporal cross-fade: not the
model, not the sampler, not the prompt, not motion blur. The cost is 28% wall
clock, and it buys back a third of the frames.

**Shipped as the default.** `wanI2V` now decodes in one window
(`temporalSize ?? length + 4`). `--temporal N` goes back to a windowed decode
for a box that cannot afford the transient — a headroom trade with a measured
cost in ruined frames, not a tuning knob. `inbetween` inherits it.

### THE A/B ALSO CAUGHT A BUG IN THE GATE

B's 21 frames span 0.09-0.23%, so their MAD is ~0.01% and `median + 3*MAD`
lands at 0.14% — and the relative rule dutifully flagged the three frames above
it as suspicious. A gate reporting a defect in art that is measurably perfect,
because an outlier test on a clean population finds noise and calls it signal
(`a-differently-shaped-probe-condemns-working-code`).

`GHOST.FLOOR` (1%) now floors both rules: nothing fires below the level where
the defect is visible at all. A's verdict is unchanged — its flagged frames are
all above 1.5% and its clean ones all below 0.9%. The regression test uses a
clip with a *small but non-zero* spread, because identical frames would not
reproduce it.

Worth stating plainly: this was found by running the experiment, not by
re-reading the code. The clean clip is the control the gate had never seen.

---

## 1b. THE FLOAT IS 1–2 TEXELS, SO SNAPPING CANNOT FIX IT

Separate defect, separately measured, and the measurement changes the answer.

The theory worth testing was: the frames are continuous paintings, not settled
pixels, so features land at fractional texel positions and the face/body
shimmers as the clip plays. If that were the cause, snapping every frame to a
lattice before playing it would remove the float.

Ink geometry per frame, raw 640px output, field taken from the border median,
expressed in texels at x8 (640px → 80 texels):

    centroid X            span 15.62 px  =  1.95 texels
    lowest ink Y (feet)   span 14.00 px  =  1.75 texels
    ink height            span 18.00 px  =  2.25 texels
    ink width             span 12.00 px  =  1.50 texels

    frame-to-frame |Δfeet|, texels:
      .12 .38 .00 .12 1.00 .12 1.25 .12 .00 .00 .00 .12 .25 .12 .50 .00 1.12 .00 .12 .50

**The float is above the lattice, not below it.** Adjacent frames move the feet
by a full 1.0–1.25 texels three times over the clip, and the centroid by 1.46.
A snap quantises to the lattice; a 1.25-texel jump quantises to a 1-texel jump.
The pop survives, with harder edges. Sub-pixel shimmer would have shown up here
as spans well under 1 texel, and it does not.

So the answer on [spritefusion-pixel-snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper):
it will not fix this float, and used naively it would make a clip worse. It
auto-detects pixel size per image and auto-generates a ~16-colour palette per
image; run frame by frame over a sequence, the detected size and the derived
palette both drift, which is the classic colour-boiling failure. It is a
single-image tool and the README does not claim otherwise.

`commit.ts` already does the part that matters and does it correctly — one
lattice for the whole sheet, cell origins forced to multiples of `factor`
(`commit.ts:862-867`, whose comment says cells gridding to their own origin
"would score as no lattice at all"), and one derived palette per sheet. The
snapper is worth keeping in mind for one job only: as an independent **checker**
of whether a raw generation already sits on a lattice (§3 step 2), used with a
fixed size and a fixed palette. Never inside `commit`.

**What would actually reduce the float: registration, which we already own and
do not apply in the preview.** `registerCell` grounds each cell's feet on the
contract line (`FEET`, `ANCHOR_TOL_PX` in `intake.ts`), and `driftRow` exists
specifically for the figure-slides-across-its-cells defect. None of it touches
the `/forge` clip player, which plays the raw 640px frames as they came out of
the decoder. So the float you are watching is partly an artefact of previewing
unregistered frames — and it is worth knowing how much, because the answer
decides whether the *model* needs fixing or only the preview does.

**The experiment, no GPU:** take these same 21 frames, matte → register →
reduce on one shared lattice, play both versions at game frame rate side by
side, and re-measure the four spans above. If the spans collapse, the float was
framing and the preview is lying to us. If they hold, Wan is genuinely moving
the creature and the fix is first+last-frame pinning (§4), not any snap.

**Caveat on this measurement:** frames 4 and 16 are ghosts, and a
semi-transparent limb changes the ink bounding box. Two of the three big feet
jumps sit next to a ghost frame. That is one more reason the ghost gate comes
first — the ghosts corrupt the measurement of the float.

## 2. THE GHOST GATE — SHIPPED

`ghost.ts` + `ghost.test.ts`, its own file rather than another export on
`drift.ts`, because it needs no master and no clip context to score a frame —
it is a property of the generation, not a comparison against one.

    ghost%  = share of figure pixels that are WASHED (less than half as far
              from the field colour as the typical figure pixel) AND FLAT
              (|Laplacian| under a floor)
    reject  = ghost% > 2.5%  OR  (> median + 3*MAD of its own clip AND > 1.5%)

Both terms of the metric are load-bearing and there is a test for each:
`flat` alone fires on every large area of flat colour, which is what pixel art
IS; `washed` alone fires on any legitimately pale creature. Both rules of the
verdict are load-bearing too — the absolute one catches a clip that is
UNIFORMLY ghosted and therefore has no outliers, and there is a test for that
case specifically (`a-check-that-passes-for-both-states-is-not-a-check`).

Field colour comes from the border median, so magenta scores like white with
no configuration — which matters for §3's open decision.

**What it flags on the dog walk:** 4, 5, 8, 12, 13, 14, 16. A superset of what
the eye picked (4, 12, 16 were obvious); 5, 13 and 14 are the seams' immediate
neighbours and are mildly smeared. Over-dropping is the right error: a
21-frame clip only needs 8 keys, and one morphing frame ruins the loop.

Calibration, three ways, all in `ghost.test.ts`:

    POSITIVE  dog walk           clean 0.11-0.83%, flagged 2.94-10.43%
    NEGATIVE  brute idle clip    median 0.76%, MAX 1.25%, nothing flagged
    NEGATIVE  7 published sheets 0.00% — cannot condemn shipped art

The idle clip is the interesting negative: its score *does* rise at 4-6 and
8-10, the same seams, far weaker because an idle moves less between them. That
is a third independent confirmation of §1's mechanism.

⚠️ **Known limit, documented rather than hidden.** Post-matte the separation
collapses from 95x to 2.1x — the matte's own soft fringe is the confound, and
published pixel art scores a structural 0.00% because its alpha is hard. So
the gate belongs on the RAW generation and the matted path reports itself as
advisory. A check that cannot fire in a domain must say so.

Wired, three places:

- **`cli.mjs run()`** scores every multi-frame result, writes `ghost` into
  `job.json`, and prints the per-frame table. Same hook serves the panel and
  an unattended `build-character.mjs`.
- **`app/api/comfy/generate/route.ts`** does the same for panel-driven jobs.
  Fail-soft on purpose (`canvas` is a native module inside Next's runtime and
  the frames are already paid for) — so it is an INSTRUMENT here, and an
  absent `ghost` field reads as "not measured", never as "clean".
- **`/forge`** — `FramePlayer` skips flagged frames during playback **by
  default**, marks them ✗, and shows the per-frame score on hover. `+ add all`
  became `+ add N clean of 21` and excludes them. The manual version of this
  is what a human did to this clip by hand; doing it by default means the
  first thing played is the clip that would actually ship.

**Also fixed while in there, and it is the more dangerous bug:** `run()` used
to write `state: "done"` with `frames: []` and exit 0 when ComfyUI answered a
guard-interrupted job with an empty output list. It now writes `state:
"failed"` and throws, naming `guard.log`. Eighteen unattended Wan jobs could
previously all report success having produced nothing.

Still to do: `prep-clips` / `driftRow` should refuse a clip containing a
flagged frame, so a ghost cannot reach `public/sprites/` even if someone
clicks past the panel. That is the fail-closed half.

---

## 3. WHY IT STILL LOOKS PAINTED, NOT PIXELLED

The master was generated at **1024x1024**. `cli.mjs create` defaults
`--canvas` to `1024x1024` (`cli.mjs:249`) and the run used the default.
`tarn59-pixel-style` was on at 0.8, and it bought a chunky *outline* — look at
the stair-stepping on the dog's back — but the interior is a continuous
painting. A LoRA cannot impose a lattice the canvas does not have.

`PLAN_KEYFRAME_PIPELINE.md` §1 already wrote the rule and it was not followed
here: **generate at the texel budget or a clean multiple of it.** For a
~70-texel figure that is a 560px canvas at x8, not 1024. The repo has measured
the alternative twice (`7c8036f` "mush", `a-sheet-authored-above-the-texel-budget-cannot-be-rescued`):
art authored above the budget cannot be rescued downstream, and the x8
block-reduce in `commit.ts` *manufactures* a lattice that then reports
`grid x8, confidence 100%` on anything at all.

So, for the dog master, in order:

1. Re-run `create` at **560x560** (x8 → 70 texels) with `tarn59-pixel-style`.
   Cheap: 226s.
2. **Gate on the RAW generation** with `detectPixelGrid` before anything
   downstream — the missing gate named in `PLAN_KEYFRAME_PIPELINE.md` §2.
   Re-roll on failure. Do not "fix downstream".
3. A/B the style LoRA rather than assuming: `tarn59-pixel-style` vs
   `--no-style` vs a second candidate (§5), all at 560, scored by
   `detectPixelGrid` on the raw output. The `create` docblock (`cli.mjs:237-240`)
   asks for exactly this A/B and it has not been run.
4. Only once the master passes does it become the init for anything.

**Open decision — the field colour.** The plan says magenta
(`isChroma` keys the magenta family exactly; a pale field needs the tolerance
matte and leaves a fringe). The white field the dog run produced is *working*
and is one of the three things you called good. Changing it is a real risk and
a real gain and it should be a deliberate choice, not a side effect.

---

## 4. NO, WE ARE NOT DOING KEYFRAMES + IN-BETWEENS YET

Direct answer to the question: the walk we have was made by **`animate`
free-running from one image**, which `PLAN_KEYFRAME_PIPELINE.md` lists under
*WHAT NOT TO DO AGAIN*. It is not a keyframe sheet, nothing was cut, nothing
was in-betweened.

The parts all exist and are unwired for this character:

    keyframes    modes.mjs:441   N named poses in ONE generation, one sheet out
    inbetween    modes.mjs:409   needs.end — first frame + LAST frame, gap filled
    cut          pipeline route  sheet -> cells, shared baseline
    endImage     graphs.mjs:615  WanFirstLastFrameToVideo, already wired

Why it was skipped is documented and is not laziness: `POSE_IS_THE_LATENT.md`
measured `keyframes` returning rows **97-99% identical** — four poses sharing
one denoising pass regress toward each other. The escalation named there is
ControlNet, and ControlNet does not bind (§5). So the keyframe leg is
currently blocked at step 3 of the five-step shape.

**The cheap half of it is not blocked, and is the single biggest win available
on the walk itself:** `WanFirstLastFrameToVideo` is already built into
`wanI2V` and is not being used. Passing the master as **both** `image` and
`endImage` makes the clip a **closed loop** — frame 21 returns to frame 1.
Right now it does not, so the walk pops on every repeat, which is part of what
reads as "the legs mismatch". It also removes the ease-out that Wan spends its
first 6-8 frames on (measured three times: idle 8, attack 7, walk 6), because
the model no longer has to invent where it is going.

The other half of "the legs mismatch": a dog walk is a **four-beat lateral
sequence**, not a two-beat one, and the current prompt asks for
*"a full two-step side-view walk cycle"* — bipedal vocabulary handed to a
quadruped. The animation literature's key poses for a quadruped are
**contact, down, passing, up**, per leg, and the front knee bends backward
while the rear knee bends forward. Naming those in the prompt costs nothing
and is the one prompt change worth making here.

Also still in the resolved prompt: *"the character stays centered in frame"* —
`PLAN_KEYFRAME_PIPELINE.md` already flagged that clause as complicit in a
14%-motion idle. It is a walk; it should say the character walks in place and
the frame does not move, which is what the negative already enforces.

---

## 5. CONSISTENCY — what we actually use, and what is left

**In use today:**
- One master, everything branches off it, never off a branch (2511 identity
  drift compounds over serial edits).
- Seed pinned and recorded in `job.json` alongside the resolved prompt.
- Wan I2V carries identity from the init frame — this is the real workhorse,
  and it held: same green eyes, same tan muzzle, no scale drift over 21 frames.
- A heavily loaded negative prompt (camera terms, scale terms, background
  terms) — each clause of which was added off a measured failure
  (`graphs.mjs:494-521`).
- `pix3lwalk` on the high-noise expert only, for the walk preset
  (`modes.mjs:66`).
- `tarn59-pixel-style` on the `create` leg.
- QA: `driftFrame` / `driftClip` / `driftRow` / `gaitSignals`, `detectPixelGrid`,
  matte keying.

**Built and BENCHED — ControlNet.** `cli.mjs pose` exists, the union ControlNet
is installed, `comfyui_controlnet_aux` gives openpose/lineart/depth/canny, and
`ControlNetApplyAdvanced` wires the map into both conditionings
(`graphs.mjs:284`). It was measured on 2026-08-06 over 4 runs and it **does not
bind on Edit 2511**: openpose at strength 0.8 moved the image 1.08/255, and at
strength **2.0 across the full range** it moved it 1.85/255. A control that
were merely weak would respond to being tripled. The preprocessor maps were
verified good. The diagnosis is the model version — the pipeline this was
copied from runs its pose stage on **Edit 2509**.

**So the highest-value unlock in the whole system is a model download:**
`Qwen-Image-Edit-2509` GGUF, pointed at the pose leg only, leaving 2511 to do
identity and style. It is the only untested variable left on that leg, and it
is what turns the keyframe half of the pipeline from blocked to available.

**Not yet tried, cheap, and worth trying in this order:**
1. First+last frame pinning (§4) — zero new models, already coded.
2. Longer clip, then decimate: generate 33 frames instead of 21 so per-frame
   displacement is smaller, then keep 8 on gait phase. Less motion per frame is
   less of everything that goes wrong per frame.
3. Palette lock across frames: derive the palette once from the approved
   master and quantize every frame to *that* palette rather than per-frame.
   Per-frame quantization is a documented source of colour boiling across a
   clip, and `palette-derive.ts` already exists.

---

## 6. MODELS AND LoRAs WORTH EVALUATING

Already on the shelf and installed (`manifest.mjs`) — no download needed:

    tarn59-pixel-style       loras/tarn59_pixel_art_style_qwen.safetensors     IN USE on create
    styly-pixel-animate      loras/wan2.2_pixel_animate_adapter.safetensors    Wan leg
    pix3lwalk                walk specialist, high-noise half only             IN USE on walk
    tarn59-turnaround        character turnaround sheets                       for the 3 facings
    fal-multi-angle          deterministic camera angles                       for the 3 facings
    qwen-lightning-8step     speed, not yet wired into generation

Candidates to fetch, ranked by what they unblock:

1. **Qwen-Image-Edit-2509 GGUF** — unblocks ControlNet pose, which unblocks
   the keyframe leg. Highest value by a distance. ~Same size as the 2511 quant
   already installed.
2. **PixelArtRedmond (Qwen Image build)** — a second pixel style LoRA to A/B
   against `tarn59-pixel-style` at 560px. Cheap test, and §3 needs an A/B
   anyway. [civitai 144684](https://civitai.com/models/144684/pixelartredmond-pixel-art-loras)
3. **A lattice checker, used as a GATE not a crutch** — `unfake.js`
   (imagequant/WASM, fixed-palette support) or Retro Diffusion's
   `pixel-art-fixer`. The repo's own position is that manufacturing the lattice
   at the end is the failure mode, so these belong on the *measurement* side:
   "does this raw generation already sit on a lattice", which is exactly the
   §3 step-2 gate. Do not let one into `commit.ts`.
4. **Wan 2.2 Lightning pair** — would cut 435s to roughly 100s and make the
   18-job build tractable. Deprioritised: the Lightning discussions are full of
   people reporting blur and ghosting, and we have just spent a session
   learning to tell one ghost mechanism from another. Not while the walk is
   still being tuned.

---

## 7. ORDER OF WORK

    1. ghostScore + gate                     no GPU. Makes everything after it measurable.
    2. decode A/B (§1)                       2 runs, ~15 min GPU. Confirms or kills the mechanism.
    3. first+last pinning + quadruped prompt 1 run. The walk-quality change.
    4. master at 560 + raw pixel gate (§3)    1 run + the style A/B.
    5. re-cut the walk off the new master     the honest end-to-end.
    6. THE EYE                                play it at game frame rate. No number replaces this.

Steps 1-3 are all on the clip we already have and none of them needs a new
model. Step 4 changes the master, which invalidates the clip, which is why it
is fourth and not first.

**Do not start `build-character.mjs` (18 Wan jobs) until 1-3 are done.** It
reports exit 0 on a guard strike, and WSL is at 39 GB with Wan wanting ~18 of
it — an unattended run today can produce nothing and say it succeeded.

---

## 8. STANDING HAZARDS THAT BIT THIS RUN

- `guard.log` names the cause of a failed run in one line, and a SOFT strike
  writes **no** `guard-tripped.json`. Read the log first. Two sessions have now
  lost hours to theorising instead (`POSE_IS_THE_LATENT.md`, and the
  "model swap / settings too high" answers on 2026-08-07, both wrong).
- The last run ended with a HARD strike 39 seconds after the frames landed.
  ComfyUI is stopped; `~/comfy/run.sh -d` brings it back.
- The pressure has moved from the Windows host to inside WSL, and it is not
  stale — it is other sessions' real work. Wan needs most of WSL to itself.
