# Dead ends — what did not work, and the number that proved it

**Read this before proposing a fix to the sprite pipeline.** Every row was
actually attempted and actually measured. Re-attempting one costs a session; we
have spent several that way.

The rule for this chapter: **a dead end is only recorded here with the
measurement that killed it.** "It didn't seem to help" is not an entry — that is
how a thing gets re-tried by the next person who thinks they will do it properly.
And it is recorded **in the same change that discovers it**, never afterwards
from memory.

---

## Generation — pose and motion

| attempted | what happened | source |
|---|---|---|
| **ControlNet on Qwen-Image-Edit 2511** | **Does not bind.** OpenPose at strength 0.8 moved the output **1.08 / 255** against a no-ControlNet baseline at the same seed; canny 1.97; strength **2.0** across the full sampling range moved it 1.85. Tripling the strength changes nothing, which is the tell that hints are not being consumed rather than being weak — 2511 routes conditioning through `TextEncodeQwenImageEditPlus`. The preprocessors are fine and the maps are clean. **The fix is a MODEL swap (2509), not a graph change.** | `4689d57`, `POSE_IS_THE_LATENT.md` round 3 |
| **Handing a posed reference in as the `init`** | Six failed runs. Pose and silhouette are the same low-frequency signal in this latent, so nothing carrying an outline can move one without the other — feed it a human and you get a correctly-posed figure with a human's proportions. | `POSE_IS_THE_LATENT.md` |
| **Free-running `animate` from one image + a sentence** | **No motion at all.** The S idle clip measured **479×588 for all 21 frames**, gait lean flat at +0.068. Frame-to-frame change 14% where a good sheet is 63%. The prompt it was given even contains "the character stays centered in frame". | `PLAN_KEYFRAME_PIPELINE.md` |
| **Curating a static clip instead of regenerating it** | Picking "the two least-identical frames" out of a dead generation. If the frames do not differ, the generation failed — that is not a curation problem. | `7035534` |
| **Four keyframes sharing one denoising pass** | The poses regress toward each other. Asked for "right foot planted far forward" with no camera pinned, the model expresses the stride the easiest way it can — by **rotating the character** — so the in-between animated a turn rather than a walk. `CAMERA_BY_DIR` now pins one camera per facing. | `modes.mjs`, measured on the frog 08-05 |

## Generation — pixel art

| attempted | what happened | source |
|---|---|---|
| **Prompting harder for pixel art** (capitals, "no anti-aliasing", "flat fills", "≤16 colours") | **301,541 distinct colours.** Every metric moved the wrong way: entries 26.6→30.7, isolated texels 41.5→47.8, matte keyed 79.2%→61.3%. **Wording is not the dial.** | `PROMPTS.md` |
| **Committing a smooth generation onto an ×8 lattice** | "Mush." It block-averages a painting. The forge's own report on that sheet read `NOT PIXEL ART — no lattice (best x3 at 1.2%, need 90%)` and it was published anyway. | `7035534` |
| **Reading a post-commit grid score as evidence** | The rejected sheet and the liked one **both** measure `grid x8, confidence 100%, cell purity 100%`. `detectPixelGrid` after the crush measures the **reduce**, not the art. The gate has to run on the RAW generation, where the same frames read `grid x1, confidence 0%`. | `7035534` |
| **`pix3lwalk` on the WAN leg** (as a general style lock) | Drove the background to **black**, and a black field is *unkeyable* — `matte()` floods from the border and walks into the body when the creature's own outlines are black on black. **0 of 21** walk frames survived, against 15 of 21 for attack in the same run. It stays as a walk-preset specialist only. | `55f98e2`, `graphs.mjs` |
| **Crushing earlier in the pipeline / prompting harder** | Both examined and rejected as approaches in the audit review. Neither addresses the cause, which is that generation happens at 640–1024 px for a figure that ships at ~72 texels. | `AUDIT_REVIEW_2026-08-07.md` |

## Decode

| attempted | what happened | source |
|---|---|---|
| **`VAEDecodeTiled temporal_size: 8, temporal_overlap: 4`** | The dog walk's unusable frames were **4, 5, 8, 12, 13, 16** — and 4/8/12/16 are exactly where those windows meet. The decoder **cross-fades** its temporal windows, so a fast-moving limb arrives as a double exposure at half strength, which motion blur cannot do. Measured, one variable: `temporal_size 8` → **10.43%** worst-frame ghost, **7 of 21** flagged, 435 s. `temporal_size 24` → **0.23%**, **0 flagged**, 556 s. | `PLAN_DOG_WALK.md` §1 |
| **Assuming the spatial-seam argument carries over** | It does not. "Seams don't survive the crush" is true of a *spatial* seam — a hairline inside one frame. A *temporal* seam is a whole frame the animation cannot use. | same |
| **Re-writing a second decode from the pre-fix source** | `wanTi2v5B` was written a day after the fix landed, from the old `wanI2V`, and hardcoded `temporal_size: 8` again. **The defect was re-shipped within 24 hours of being solved.** `decode-window.test.ts` now pins every Wan builder to one window. | 2026-08-08 |

## The box

| attempted | what happened | source |
|---|---|---|
| **WSL cap at 40 GB** | Host freeze. 40 GB cap + a **27.3 GB** Windows baseline = 67.3 GB worst case on a **63.9 GB** machine — the cap was larger than the machine, so any run that filled it *had* to cross the ceiling. Guaranteed by arithmetic, not bad luck. | `.wslconfig`, measured 08-08 |
| **WSL cap at 32 GB, running A14B** | Host is safe (peak 46.2, guard at 62.5) and **the constraint moved inside**. WSL available steps down as each expert loads (26.9 → 19.6 → 8.4 GiB), holds flat through all ten sampling steps, then the **VAE decode** takes it to 0.7 GiB and the guard interrupts at its 1.2 GiB floor. 1024²/21f and 640²/17f die **identically** — resolution and frame count barely matter, because the cost is both experts resident plus decode staging. | measured 08-07 |
| **Bouncing ComfyUI first for a fresh allocator** | Does not help. | same |
| **Treating "the render fails and memory is full" as one cause** | It was **three**, cleared one at a time, each of which looked like the whole answer: leaked headless browsers from the playtest harness (9 GB), the /forge panel's runaway poll loop (5.6 GB in one renderer, worst *while rendering*), and the WSL cap. **If the guard strikes after a fix, assume a fourth thing rather than that the third fix failed.** | `HANDOFF_2026-08-08.md` §4 |
| **Diagnosing a failed run without reading `guard.log`** | Two sessions lost hours to "model swap" / "settings too high" theories, both wrong. A **SOFT** strike writes no `guard-tripped.json`, so the absence of that file is *not* evidence the guard stayed out of it. **Read `~/comfy/guard.log` first, every time.** | `PLAN_DOG_WALK.md` §8 |
| **MiniMax H3 as a lighter model** | ⚠️ **REVIEW CLOSED 2026-08-09 — MEASURED, and it dies at the DECODE, not on weight size.** Every Phase 0 disqualifier cleared: it is image-conditioned (`first_frame` AND `last_frame`), the audio VAE is not needed, and the community pruned GGUF loads on the installed city96 loader without patching. 29.8 GB downloaded, three runs at the model's smallest possible ask (5 frames, 576²), one variable each: min WSL available **0.96 / 1.29 / 1.09 GiB** against chapter 14's **3 GiB** kill criterion. **0 frames from 3 runs**; two were killed by the guard, one of them HARD-stopping the server. The prediction that a single-model pipeline would "encode, free the encoder, then load unet+VAE" is **false as observed** — ComfyUI loads TE (14,960 MB) → VAE (4,966 MB) → unet (8,783 MB) with no unload between, and 28.7 GB against 24 GB of VRAM means the encoder is OFFLOADED to the CPU rather than freed. `unload_all_models()` is a move to the offload device too, so the explicit purge has the same failure. Sampling itself was fine — 4.07 s/it, 81 s, at 5–8 GiB available. See chapter 16. One lever remains untried: `VAEDecodeTiled` on the H3 VAE. | chapter 16, `16-the-h3-measurement.md` |
| **A GGUF text encoder for H3** | Closed without a run. `comfy/text_encoders/minimax.py` calls `self.visual(...)` on the keyframe path, so the Qwen3-VL vision tower is mandatory for fl2va — and every community GGUF encoder splits it into a separate `mmproj` in llama.cpp style, which needs **Nif00's fork of ComfyUI-GGUF** to reassemble. Swapping the fork in puts the Wan and Qwen legs, which both depend on city96's loader, behind an untested third-party build. The MiniStack's cheap 2.5 GB `qwen3vl-4b-h3student` is worse than useless here: **text-only, no vision path**, so it cannot do fl2va under any loader. | chapter 16 §1 |
| **(superseded) H3 as "larger, not lighter"** | The original arithmetic compared the wrong quantity. Recorded as: larger, not lighter, smallest official stack **39.6 GB** (19.5 pruned INT8 + 14.6 NVFP4 text encoder + 5.5 VAEs), community INT4 31.4 GB, ComfyUI's quoted optimised total **42.5 GB**, against Wan A14B's 24 GB of weights. All of those are **totals**, and the number that binds this box is **peak resident**. Wan is a TWO-EXPERT model and both experts were measured resident simultaneously (~30 GB peak); a single-model H3 can encode the prompt, free the text encoder, then load unet+VAE. On community GGUF quants that lands near **21 GB peak** — *lower* than what we run today. Still true and still disqualifying-ish: community quants only, no official ComfyUI workflow, and a native audio branch that is dead weight. **Do not treat this row as settled either way; see chapter 14 for the test that resolves it.** | audited 08-08, challenged 08-09 |

## Process

| attempted | what happened |
|---|---|
| **Leaving finished work on an unmerged branch** | **This is the one that cost the most.** The dog frames, both plans, the decode fix, the ghost metric and twelve forge bug fixes sat on `brute-ragnarok-sources` for a day. Sessions start on `main`, cannot see any of it, and re-derive it. It happened at least twice — the second time by an agent that had *already written down* "merge this branch first" as its top item and then built on `main` anyway. **A second source of truth is a guarantee of repeated work.** |
| **A comment asserting an invariant instead of a test** | `DEFAULT_CLIPS` was introduced by a comment saying all three clip lists agreed "because two lists of what a character needs is how they drift apart" — while the list beneath it was already missing `crouch`. Readers checked the prose. Now `clip-contract.test.ts` compares the copies to each other. |
| **A check written `pass: true`** | The pixel-lattice check could not fail, so it reported success on every sheet including the one rejected on sight. |
| **A count used as a contract** | The knight's census row reads `21/21 rows` **and** `NO CROUCH` — the count is satisfied by extra rows (two `attack`, a `roll`) while a required clip is missing. |

---

## ⚠️ NOT a dead end — and the near miss is the lesson

**`walk4` + `--loop` + `pix3lwalk` on A14B was about to be recorded here as
"made no measurable difference". It would have been wrong.**

Measured 2026-08-08, same init (`dog-2026-08-07/12_wan_00699_.png`), same seed 7,
same 21 frames, one variable at a time. Both arms verified as actually applying —
`WanFirstLastFrameToVideo` with `end_image` wired, all three LoRA loads attached:

| | 5B, free-run, no LoRA | A14B, `walk4 + --loop + pix3lwalk` |
|---|---|---|
| ghost worst | 0.26% | 0.36% |
| over the 1% floor | 0 of 21 | 0 of 21 |
| **motion median** | **36%** | **37%** |
| time | 107 s | 451 s |

One percentage point for four times the cost. On that table the lever was dead.

**Then the two clips were rendered as GIFs at the game's 8 fps, put side by
side, and looked at — and the `walk4` arm was clearly better.** The operator's
verdict was immediate and unambiguous.

**What the metric was actually measuring.** Frame-to-frame pixel churn over the
figure box. A gait does not read as a gait because pixels change; it reads
because the *right* pixels change in the *right order* — paws leaving and
planting, the diagonal pairs alternating, the spine staying level. A four-beat
quadruped gait and a scrambling free-run can churn identical numbers of pixels.

> **The rule: never retire a lever on a metric alone.** Render both arms at the
> game's frame rate, put them side by side, and ask. This is the same failure as
> the census that printed "BETTER than the painted roster" for art rejected on
> sight — a number standing in for looking — except inverted: here the number
> would have thrown away something that works.
>
> Both directions of that error have now happened in this repo. The gate is the
> eye; metrics are for catching what the eye cannot see (ghosting at 0.3%,
> a lattice at ×8), not for deciding what looks right.

**Status: `walk4 + --loop` is the working recipe for a quadruped walk.** It is in
the skill and in the playbook. The 5B leg remains the fallback for when A14B
cannot finish, and for new masters.

---

## The standing rules these bought

1. **Read `guard.log` before theorising.** One line, names the cause.
2. **A pose is drawn and then reached, never hoped for.** Free-running I2V does
   not produce a stride.
3. **Generate at the texel budget.** Art authored above it cannot be rescued
   downstream — the crush averages a painting.
4. **Gate the RAW generation, not the crush.** After the reduce every sheet
   looks like pixel art.
5. **One temporal window.** Buy decode headroom with a smaller canvas, never
   with a windowed decode.
6. **A quadruped breaks assumptions written for bipeds.** Two intake checks
   rejected a clean dog with messages that read as "the art is bad".
7. **Merge the branch the same day.** See the process table.
8. **THE EYE is a gate.** A census printed "BETTER than the painted roster" for
   art that was rejected on sight. No number replaces looking at it moving, at
   the game's frame rate.
