# Review of the sprite-forge audit — what the code actually says

**Status:** review, 2026-08-07. An external audit proposed a 3-phase plan for
"why generated sprites are soft illustrations" and "why the monster shrinks".
This file checks each claim against the tree. Four claims are correct, four are
already implemented, and two are contradicted by measurements this repo already
took. Read it before spending generation time on the plan as written.

Companion: `PLAN_KEYFRAME_PIPELINE.md` (the pipeline shape) and
`POSE_IS_THE_LATENT.md` (what the control maps actually carry).

---

## VERDICT TABLE

| # | Audit claim | Verdict | Evidence |
|---|---|---|---|
| A.1 | `wanI2V` has no ControlNet, `qwenEdit` does | **CORRECT** | `graphs.mjs` — `cnet`/`ControlNetApplyAdvanced` appear only in the Qwen leg (~L321). `wanI2V` (L424-560) has no control node. |
| A.2 | Implement `WanFirstLastFrameToVideo` two-keyframe pinning | **ALREADY BUILT** | `graphs.mjs:494` — `class_type: endImage ? "WanFirstLastFrameToVideo" : "WanImageToVideo"`, with `imgEnd` wired at L549. `wanI2V` already takes `endImage`. |
| B.1 | Shrinking is not normalised; a shrunk frame renders small in its cell | **CORRECT** | `register.ts` takes ONE shared scale `k` (the alive-rows vote). `cellScalePx` only ever clamps a cell DOWN when it would overflow; nothing scales an undersized frame up. |
| B.2 | Add baseline alignment to `register.ts` | **ALREADY BUILT, with a stated caveat** | `register.ts:75` — "REGISTRATION IS BY BOUNDING BOX… its LOWEST ink is planted on `GROUND`." The docblock already names the failure it does not cover (debris below the feet, asymmetric FX) and calls a declared per-frame anchor the eventual fix. |
| C.1 | `route.ts` bypasses `resample.ts`, so the UI only ever shows raw soft frames — pipe it through the crusher and it becomes pixel art | **CONTRADICTED** | See §1. The crush already runs, and running it earlier produces the same mush sooner. |
| C.2 | Add BiRefNet/RMBG background removal | **PLAUSIBLE, UNVERIFIED** | No `BiRefNet`/`RMBG` node anywhere in `graphs.mjs` — correct that it is absent. Whether edge haloing is the *cause* of anything was not measured; `matte.ts` already keys and reports `matte keyed %`. |
| C.3 | Enforce pixel-art LoRAs and prompt keywords | **CONTRADICTED + WRONG IDS** | See §2. Also: the ids are `tarn59-pixel-style`, `pix3lwalk`, `styly-pixel-animate` — not `tarn59_pixel_art_style_qwen`. Pixel-art prompt text is already in `modes.mjs` at L299, 312, 314, 349, 485, 539, 588, 634, 637. |
| — | Verify with `cli.mjs stats` | **UNUSABLE AS A GATE** | It needs a live ComfyUI. With the server down it prints `fetch failed` **and exits 0**. A verification step that is green when the thing it verifies is unreachable is not a verification step. |
| — | Verify with `RUN_BENCH=1 npx vitest run bench` | **REAL** | `bench.test.ts:53` gates on `process.env.RUN_BENCH === "1"`. |
| — | Verify with `inbox.test.ts` | **REAL** | Exists; it is the publish path. |

---

## §1 — Crushing earlier does not make pixel art. It makes the same mush sooner.

The audit's central mechanism is that the browser panel shows raw frames
because the crush was "left as a manual CLI script", so wiring `resample.ts`
into `app/api/comfy/generate/route.ts` fixes the softness.

The crush is not missing. `commit.ts` reduces the finished sheet onto an ×8
lattice and snaps to 20 colours — and **that is where the lattice comes from**.
The forge said so about the sheet published on 2026-08-07, in its own report:

    GRID  NOT PIXEL ART — no lattice (best x3 at 1.2%, need 90%) and only 44%
          flat neighbours. Continuous/anti-aliased art: it will be RESAMPLED,
          not reduced, and CANNOT import 1:1.

That sheet was crushed anyway, shipped, and rejected on sight. Reverted in
`7035534`. **Post-crush, the rejected sheet and the liked one both measure
`grid ×8, confidence 100%, cell purity 100%`** — the detector is measuring the
reduce, not the art.

So C.1 as written moves an existing step earlier. Worth doing for *preview
honesty* — a panel that shows what will ship beats one that shows a raw render —
but it is not the fix, and adopting it as the fix is how the 08-07 drop passed
every check on its way out the door.

## §2 — Asking harder for pixel art was measured, and it made things worse.

`PROMPTS.md` recorded the experiment the audit proposes. Capitalised prompts
demanding no-AA, flat fills and ≤16 colours produced:

- **301,541 distinct colours**
- palette entries 26.6 → 30.7
- isolated texels 41.5% → 47.8%
- matte keyed 79.2% → **61.3%**

Every metric moved the wrong way. Wording is not the dial, and neither is the
game's target resolution (`a-sheet-authored-above-the-texel-budget-cannot-be-rescued`).
The style LoRAs the audit lists are already loaded — `tarn59-pixel-style` at
0.8 on the Qwen leg, `pix3lwalk`/`styly-pixel-animate` at 0.8 on Wan.

## §3 — On the shrinking, A.1 is the good finding.

`wanI2V` genuinely runs unconditioned across its 21 frames, and the audit's
reasoning about why Wan drifts scale on a static init is sound. Two caveats
before building it:

1. `POSE_IS_THE_LATENT.md` measured that **pose and silhouette are the same
   low-frequency signal in this graph's latent**. OpenPose is singled out there
   precisely because a stick skeleton is the only map that constrains limb
   position *without* constraining body width. Depth or Canny would lock scale
   and the creature's shape with it. If A.1 is built, it must be openpose.
2. The audit says an OpenPose sequence makes shrinking "physically impossible".
   It does not — ControlNet is a conditioning weight, not a constraint. Expect
   it to reduce drift, and measure how much.

**B.1 is the cheaper half and does not depend on the model behaving.** But not
as written: normalising every frame to a constant height would destroy the
clips that are *legitimately* shorter — a crouch, a stumble, a death collapse.
`register.ts` already excludes `death` from the alive-scale vote for this exact
reason. The correct shape is to correct the *trend* (a monotonic shrink across a
clip is drift; a single short frame is a pose), and to leave `death` alone.

---

## WHAT WAS IMPLEMENTED FROM THIS REVIEW

**The pixel-lattice check is now a real check** (`intake-qa.ts`). It was
`pass: true`, hardcoded, labelled "information, never a gate" — so it reported
identically on a lattice-drawn frame and a smooth painting, which is the one
distinction it exists to make and the reason a continuous moveset finished
READY on 08-07. It is now `pass: grid.gridded`, **soft**: the verdict drops
READY → USABLE with a named fix, and nothing in the existing roster is
rejected (jester, rotortail, croaker and fish_feet are all continuous imports
that ship). `intake.test.ts` carries the negative control — two frames
identical but for an 8px quantisation, where every other check agrees and
`grid` does not.

## THE ROSTER, MEASURED BY THE CHECK THAT COULD NOT FAIL

First run of `detectPixelGrid` across every published sheet, 2026-08-07. This is
what the `pass: true` line was hiding:

| sheet | size | rows | gridded | flat neighbours | verdict |
|---|---|---|---|---|---|
| `brute-S` | 2392×1368 | 3 | **×8, conf 100%** | — | true lattice, imports 1:1 |
| `beaver-S` / `-E` | 1276×1294 | 4 | no (×1) | **66%** | native-res pixel art, cell purity 1.6% |
| `jester-S` | 1476×1600 | 5 | no (×1) | 62% | native-res, cell purity 19.8% |
| `frog-S` | 1402×1122 | 4 | no (×1) | **37%** | **NOT PIXEL ART** — continuous/anti-aliased |

Three things fall out of it:

1. **The only sheet on a real lattice is the one committed from a human-drawn
   Ragnarok sprite.** `brute-S` is `55f98e2`'s gym zombie, block-committed at ×8.
   Nothing generated has ever produced a lattice — which is
   [[nothing-in-the-forge-generates-pixel-art]] stated in numbers rather than
   prose.
2. **The beaver is the best-shaped generated sheet in the tree** at 66% flat
   neighbours, comfortably over `NATIVE_FLAT_SHARE` (0.55). It reads as
   native-resolution pixel art; it is simply not on a block grid. That makes it
   the right subject for the next attempt, which is what it was picked for.
3. **`frog-S` at 37% is the failure shape** — the same verdict class the rejected
   08-07 brute drop carried. Anything that measures like the frog should not be
   published.

Reproduce with `detectPixelGrid` over `public/sprites/<name>.png` + the sidecar's
`rows[].cells`.

## THE BLOCKER ON "RENDER IT FROM SCRATCH"

**There is no text-to-image model installed.** `~/comfy/ComfyUI/models/unet/`
holds only `Qwen-Image-Edit-2509`, `qwen-image-edit-2511` and the two Wan 2.2
**I2V** experts; `checkpoints/` and `diffusion_models/` are empty. Every mode in
`MODES` declares `needs.init` and `generate/route.ts` hard-rejects a request
without `imageB64` — but that is downstream of the real problem, which is that
nothing in the box can turn a prompt into an image.

Step 1 of `PLAN_KEYFRAME_PIPELINE.md` therefore needs a **model download**, not
just code: a Qwen-Image base (non-edit) or an SD/Flux checkpoint carrying a real
pixel-art LoRA. That is a disk and bandwidth decision, so it is called out here
rather than made silently.

## WHAT TO DO NEXT, IN ORDER

1. **Build step 1 of `PLAN_KEYFRAME_PIPELINE.md` — text-to-image.** Still the
   one real gap: `generate/route.ts` hard-rejects any request without
   `imageB64`, and every entry in `MODES` declares `needs.init`. Everything
   downstream is conditioned on art the pipeline did not make.
2. **Gate the RAW generation on `grid`, hard, for generated art only.** The soft
   gate above tells you; a hard gate on the generator's own output is what stops
   a moveset being generated on top of a bad master. Cheap now that the check
   can fail.
3. **Then A.1 (openpose on `wanI2V`) and B.1 (trend-corrected height).** Both
   need a live ComfyUI to evaluate; it was down during this review
   (`cli.mjs stats` → `fetch failed`).
4. **Fix `cli.mjs stats` exiting 0 on a failed fetch** before relying on it in
   any checklist.

## OPEN QUESTIONS, ANSWERED WHERE THE REPO ALREADY HAS AN ANSWER

> Should crushing happen server-side in `resample.ts` or as a Comfy node?

Server-side, one canonical crush engine — but see §1: this is a preview-honesty
change, not the pixel-art fix.

> What target pixel height should generated sprites default to?

Not a free choice. `a-sheet-authored-above-the-texel-budget-cannot-be-rescued`
measured the budget at **~72 texels**, and the game's resolution is not the
dial. `SHIPPED_GRID` / `ART_SPACE` in the forge are the numbers to match, not a
new default to pick.
