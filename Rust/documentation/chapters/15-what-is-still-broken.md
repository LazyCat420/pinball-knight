---
part: Problems
status: in-progress
updated: 2026-08-09
supersedes: 11-next-the-full-dog-moveset.md
---

# What is still broken — the next session's work order

**Written 2026-08-09 at the end of the sweep session.** Start here. Chapter 11
is superseded by this file for anything it disagrees with.

---

## 1. THE LEAD: the end pin, not the prompt

**This is the first thing to try and it is cheap.**

Three separate prompt changes were tried against the shrinking and every one
made it worse (chapter 13 §6, and `194bee7`). Meanwhile the flag that has been
there all along mechanically bounds it, and nobody connected the two:

| | clips | area swing |
|---|---|---|
| **with `--loop`** (walk, run) | 6 | 7.3 – 33.1% |
| **without `--loop`**, low motion (idle) | 3 | 4.6 – 19.8% |
| **without `--loop`**, one-shots | 8 | **39.9 – 93.0%** |

`--loop` pins frame 21 to frame 1 via `WanFirstLastFrameToVideo`. That is a
**constraint on the latent**, not a request in a sentence — the model cannot end
small because the end is given to it. Every clip that recedes is a one-shot with
no end pin. Every clip with a pin stayed bounded.

**The experiment, in order:**

1. **`--loop` ON for `attack` and `stumble`.** A game attack returns to its
   neutral stance so it can transition back to idle — ending where it began is
   *correct* for these, not a compromise. `bench-moveset.mjs` `LOOPING` currently
   holds only `walk` and `run`; add these two and re-run E:attack. Prediction:
   the 93% swing collapses.
2. **`--end <posed frame>` for `crouch` and `death`.** These must END elsewhere
   (a crouch at its deepest gather, a death on the ground), so a first==last pin
   is wrong. Pin a *different* full-size frame instead. The cheapest source
   needs no new authoring: take a late frame from the existing clip that is
   still full-size and use it as `--end`.
3. Only if both fail, look at VACE (chapter 14).

**Do not attempt another prompt wording.** Three arms, monotonic in the wrong
direction, and Wan's shared negative already bans "character shrinking".

## 2. The attack is inert when it is stable

The unresolved trade. `stays centered in frame` keeps the scale but produces the
operator's original complaint — "the hound looks like it's just showing its
teeth", churn 11% against a walk's 22%. Removing it produces motion and
recession together.

The end pin above is the hypothesis that breaks the trade: pinned ends should
allow real motion in the middle without letting it escape as scale. If it does
not, the fallback is the keyframe path — `--end` with an AUTHORED pose (draw the
lunge on the Qwen leg, interpolate to it), which is chapter 13 §7's
recommendation and still untried.

## 3. Rows that need regenerating

Everything below was generated with the bad one-shot tail (merged 23:10 UTC,
reverted in `194bee7`). The **N** facing is entirely in this window:

| row | swing | why |
|---|---|---|
| E:attack | 93.0% | the worst; regenerate first, it is the test case |
| N:death | 72.0% | |
| N:attack | 63.5% | |
| N:stumble | 54.3% | |
| N:crouch | 35.6% | |
| E:stumble, E:crouch, E:death | — | finished after the revert? **check the dir timestamp against 23:10 UTC before trusting them** |

S's one-shots used the OLD tail and are fine except `S:stumble` (39.9%) and
`S:death` (42.9%), which recede for a different, unidentified reason.

**The operator has said the N clips look OK by eye**, so this is a
regenerate-if-cheap list, not a blocker.

## 4. Curation is the missing step, and it mostly works

`prep/pick-frames.mjs` was written this session and is **not yet wired into the
publish path**. It picks the 3–4 frames a clip actually ships out of Wan's 21:

    N:death   72.0% raw -> 23.0% curated
    N:attack  63.5% raw -> 19.7% curated
    N:stumble 54.3% raw -> 14.9% curated

Twelve of fourteen finished rows come under the 25% threshold once curated. Two
do not: **N:run 27.0%** and **S:death 26.2%**.

**Next:** generate the three recipes (`recipe-dog-E/S/N.json`), run
`prep/prep-clips.mjs build`, then `npm run sprites`. `driftRow` is a hard gate
and has not been run on this creature yet — it is the most likely place the
publish fails, and the scale swing is exactly what it checks.

## 5. Publish, which has not started

One line once the sheets exist: `IMPORTED_ART = { ..., hound: "dog" }` in
`boot/sheets.ts`, then `__lab.only("hound")`.

Two traps that have both shipped before:

- **`idle` is mandatory** — `importedPaints` returns null without it and logs
  nothing. All three facings have one.
- **Unauthored clips fall through to the PAINTER, per clip.** A partial sheet
  means the hound changes species mid-fight. All 7 × 3 must be present, which is
  why publishing waits for the full matrix.

## 6. Free speed, untested

Chapter 14. `EasyCache` and `PathchSageAttentionKJ` are **already exposed** by
this ComfyUI install; KJNodes and triton 3.7.1 are installed; only the
`sageattention` pip package is missing. A sweep row is 500–600 s and community
reports put block-caching at ~45% off.

Run these before considering the H3 swap — and judge them with the four gates at
96 texels, because a speedup that softens the gait is not a win.

## 7. Smaller things

- **`--cache-lru 2` may be keeping both Wan experts resident.** Peak is ~30 GB
  against a 31.3 GB cap, and only one expert is needed at a time. Try
  `--cache-lru 1` and measure peak. One variable, big potential headroom.
- **`--frames 4` on A14B has never been tried.** We only ship 3–4 frames; the
  VAE decode is where the guard has always struck.
- **The fade gate cannot see the green eyes** (under `MIN_SHARE` 1%).
- **The fade gate cannot tell occlusion from dissolution** — a curling creature
  hides its own markings and reads as a reject.
- **`bench-dog.json` rows before ~01:50 UTC lack `scaleSwing`/`scaleTrend`** —
  the persistence fix landed mid-sweep. Re-derive from the frames if needed.

## The one rule this session earned

Every wrong turn today — the mirror, the fade, the rocking, the receding, the
8/14 progress bar — came from **reasoning about a number instead of looking at
the thing**. The gates are worth having; four of them found real defects. But
the operator overturned my conclusion three separate times by watching a clip,
and each time the measurement I was defending was internally correct and about
the wrong quantity.

**Render it at 96 texels, at the clip's own frame rate, and look at it.**
