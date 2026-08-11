# The clip that does not move

**2026-08-08, the session after the first approved clip.** The work order was
mechanical: same command, different `--preset`, twenty runs to go. It was not
mechanical. Two clips came back as still photographs and **every automated gate
passed them**, which is the finding worth more than the art.

---

## What happened

Two runs, both A14B, both from the approved dog master, both with the recipe
chapter 09 settled:

| clip | init | churn median | distinct bboxes | ghost | verdict printed |
|---|---|---|---|---|---|
| **approved walk** (the control) | — | **23.7%** | 18 / 21 | 0.36% | ready |
| `idle4 --loop` | frame 09, planted | **0.2%** | **2 / 21** | 0.09% | **ready** |
| `run4 --loop` | frame 12, mid-stride | **0.2%** | **1 / 21** | 0.18% | **ready** |

Both clips are beautifully rendered. The identity is perfect, the field is
keyable, no limb dissolved. Played back at 8fps they are photographs.

**The pipeline said `ready` both times.** That is the defect this chapter is
about.

---

## Why every gate missed it

The gates were each doing their job, and the union of them still had a hole the
size of the most common failure this pipeline has.

**`ghost.ts` cannot see it, structurally.** It scores frames for a limb rendered
as a washed-out flat smear — a *decode* artefact. A clip that never moves has no
fast-moving limb for `VAEDecodeTiled` to cross-fade, so it scores *better* than
a good clip. The 08-08 idle read 0.09% against a 1% floor. **The gate was
passing because the clip was dead**, which is the worst shape a gate can have:
its output is not merely uninformative, it is anti-correlated.

**`drift.ts` can see it, too late.** `driftClip` already has a duplicate-pose
check — IoU over the alpha mask, and it would catch both of these. It runs on
**registered cells**: after matte, after slice, after `registerCell`. By the
time it speaks, the clip has been cut, filed and reviewed, and 370 seconds of
GPU are spent. It is also blind in a way the raw check is not — a creature that
breathes without changing outline moves many interior pixels and almost no edge.

**Chapter 09's gate 3 is "motion", and it was a human.** "Consecutive cells
should differ substantially" was written down as a gate and never implemented as
one. It has now failed twice by being a sentence.

> **The standing lesson: a gate that cannot fail on the failure it is nearest to
> is not covering it.** Ghosting and freezing both live in "the clip is
> unusable", and having a sharp instrument for one of them read `ready` was
> taken, twice, as evidence about the other.

---

## `motion.ts` — and what it refuses to do

It runs on the RAW frames inside the generating run, next to `ghostClip`, and
asks one question: **did anything happen?**

That scope is deliberate and it is the interesting part. The obvious thing to
build is a motion-quality score, and **that metric already exists and already
nearly cost us the pipeline's one working lever** — on 2026-08-08 it scored
`walk4 + --loop` at 37% against a bare free-run's 36%, and the recommendation
was to retire the lever. The operator looked at the two clips side by side and
the walk4 arm was obviously better. A gait reads because the *right* pixels
change in the *right order*, and churn cannot see order.

So the gate answers the question that has an unambiguous answer, and hands
everything above a corpse to the eye. Calibration:

```
approved walk   churn median 23.7%   min 3.4%   18 of 21 distinct boxes
frozen idle      churn median  0.2%   max 1.5%    2 of 21
frozen run       churn median  0.2%   max 1.0%    1 of 21
```

`FROZEN` sits at 2% — above the dead clips' *maximum* frame and more than ten
times below the good clip's median. Two orders of magnitude of separation is
what lets a threshold be picked carelessly and still be right.

**The positive side is n=1**, and `motion.ts` says so in its header. One
approved clip is enough to establish that 0.2% is dead and nowhere near enough
to say what good looks like. The threshold is set to find a corpse, not to judge
a performance, and raising it toward the positive is rebuilding the metric the
paragraph above warns about.

`motion.test.ts` includes the confound that would make the gate worthless: a
frozen clip with heavy per-pixel noise. "The pixels changed" and "the creature
moved" are different claims, and the figure-box denominator is what keeps them
apart.

---

## The angles question, which turned out to be a wiring question

The ask was whether turning a character 360° and keeping it consistent needs a
LoRA, a ControlNet, or a different model. **It needs a LoRA, we already own the
right one, and the CLI was not using it.**

### ControlNet is already dead here, with numbers

Chapter 10 records it: OpenPose on Qwen-Image-Edit 2511 at strength 0.8 moved
the output **1.08 / 255**; at strength **2.0**, 1.85. Tripling the strength
changing nothing is the signature of conditioning that is not consumed at all —
2511 routes it through `TextEncodeQwenImageEditPlus`. That is a model-generation
problem, not a tuning one.

### The standard 2026 recipe does not transfer

The consensus stack is IP-Adapter FaceID + a character LoRA + ControlNet
OpenPose. Two thirds of it is for **human faces** in **photoreal** output. This
is a quadruped with no face to lock, shipping at ~72 texels.

### What we have

`fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA`, on disk since 2026-08-04 and
wired into the `rotate` mode. Trained on **3000+ Gaussian-Splatting renders of
the same object** — the consistency is not prompted, it is baked in by training
on genuinely 3D-consistent views of one thing, which is exactly the property a
turnaround needs and a text prompt cannot supply. 96 poses, driven by a fixed
grammar:

```
<sks> [azimuth] [elevation] [distance]
```

| axis | trained tokens |
|---|---|
| azimuth (8) | `front view` · `front-right quarter view` · `right side view` · `back-right quarter view` · `back view` · `back-left quarter view` · `left side view` · `front-left quarter view` |
| elevation (4) | `low-angle shot` · `eye-level shot` · `elevated shot` · `high-angle shot` |
| distance (3) | `close-up` · `medium shot` · `wide shot` |

### The two defects found

**1. `cli.mjs rotate` never dispatched through `MODES`.** It restated the prompt
inline and called `qwenEdit` with an image and a seed — the exact drift that
file's own header names, and which `animate` and `retarget` were already fixed
for. Silently off on every command-line rotation: the multi-angle LoRA, the
pixel style lock, the Lightning speed LoRA, and the panel's chosen unet.

This is not academic. **Chapter 11's work order opens with two `cli.mjs rotate`
calls to build the S and N masters.** Every facing this creature was about to
get would have come off the freeform path — and cross-facing identity drift is
precisely what the LoRA is installed to prevent. The failure would have surfaced
as "the three facings look like three animals" a full session later.

**2. `FACINGS` exposed four of the eight trained azimuths.** The missing four
are the quarter views, which is to say **the diagonals**.

### What that settles about diagonals

Chapter 11 priced the diagonal question as three options and recommended
deferring. The generation half of that price is now known: **it is free.** The
LoRA was trained on all eight azimuths, so a diagonal facing costs one `rotate`
run exactly like a cardinal one. The blocker is entirely the engine —
`Dir = "S" | "N" | "E"` and the `Record<Dir, …>` tables behind it — and the
recommendation to finish one creature first stands for the reason it always did,
which is that no creature in this game has a complete moveset yet.

All eight are in the table now, the four the engine cannot consume are flagged
`diagonal`, and the three-facing batch cannot pick one up by accident.

`rotate-grammar.test.ts` pins the vocabulary to the model card. This is the one
place a test *should* restate an external constant: `camera-sync.test.ts`
refuses to write a third copy because both its copies are in-repo, but here the
authority is the LoRA's training data, and comparing `modes.mjs` to itself would
pass with all eight tokens misspelled.

---

## Quadruped presets, and what they did not fix

`idle4` and `run4` now exist for the reason `walk4` exists: the shipped presets
are written in biped vocabulary. `idle` says "chest and shoulders lifted";
`run` asks for "a full **two-step** side-view run cycle" with "knees driving
high". A dog does not have that gait.

`run4` asks for a **gallop**: front pair reaching together, hind pair driving
together, all four off the ground in suspension, and — the clause that matters —
**the spine flexing and extending**. That is the literal opposite of `walk4`'s
"the spine level and the head steady", which is why it could not be a tweak to
`walk4` and had to be a second preset.

**Neither preset fixed the freeze.** They are better prompts and the clips were
still dead, which is how we know the cause is not vocabulary.

---

## Where the freeze actually comes from

The three data points, one variable at a time:

| | init | `--loop` | leg | `pix3lwalk` | moved |
|---|---|---|---|---|---|
| approved walk | mid-stride | ✅ | A14B | **✅** | 23.7% |
| ch.10 A/B arm | mid-stride | ❌ | 5B | ❌ | yes |
| `idle4` | planted | ✅ | A14B | ❌ | **0.2%** |
| `run4` | mid-stride | ✅ | A14B | ❌ | **0.2%** |

The dead pair is exactly **A14B + `--loop` + no pixel LoRA**, and the init is
ruled out — `run4` used the same frame 12 the approved walk used.

Two candidate causes, and they are not exclusive:

- **`--loop` over-constrains a clip with no motion pressure.**
  `WanFirstLastFrameToVideo` pins frame 1 == frame 21. Holding still satisfies
  both endpoints exactly, and for `idle4` the prompt even asks for "all four
  paws staying planted".
- **`pix3lwalk` may be doing motion work the repo has filed as style work.** It
  is gated on `clip === "walk"`, so neither clip received it. It is a pixel
  *walk* adapter; chapter 10 files it under "pixel art" as a style lock that
  drives backgrounds black. If it is what makes A14B move under `--loop`, that
  is a different thing than the repo believes it is.

`--loop` is the cheaper and safer test and it is the one that was run.

### The answer: `--loop` is the cause

Same init (frame 09), same seed, same preset, same leg, one variable:

| | churn median | distinct bboxes | seam | verdict |
|---|---|---|---|---|
| `idle4 --loop` | 0.2% | 2 / 21 | 4.9% | **frozen** |
| `idle4` (no loop) | **2.08%** | **12 / 21** | 12.6% | alive |

Rendered at 8fps the second one is a real idle: the tail swings, the head and
muzzle shift, the ribcage settles, and all four paws stay planted with no travel
and no turn — which is exactly what `idle4`'s `avoid` clause asked for.

**So `--loop` is not the house recipe. It is a walk-and-run lever.** Chapter 09
recorded it as *the* verified recipe off a single clip — a walk, the one clip
where pinning first == last is unambiguously correct, because a gait really does
return to its start pose. Applied to a clip with no strong intrinsic motion, the
same pin is permission to hold still: frame 1 == frame 21 is satisfied perfectly
by never moving, and `idle4` even asks for planted paws.

That affects **five of the seven clips** — `idle`, `attack`, `stumble`,
`crouch`, `death`. Chapter 11 had already flagged `attack` and `crouch` for a
different reason (a one-shot is not a cycle); this is a second, stronger reason
covering the rest.

### `run4` without the pin — the strong confirmation

The same change on the run, and this one is not marginal:

| | churn median | distinct bboxes | seam |
|---|---|---|---|
| `run4 --loop` | 0.2% | **1 of 21** | 3.6% |
| `run4` no loop | **19.8%** | **21 of 21** | 47.3% |
| approved walk (reference) | 23.7% | 18 of 21 | 42.4% |

It sits alongside the approved walk rather than near the floor, and unlike the
idle it does not decay — churn holds between 10.9% and 27.9% across the whole
clip. The frames show a real gallop: the front pair reaching together, a tucked
suspension phase with all four paws off the ground, the spine flexing. That is
`run4`'s prompt being answered, and it is a gait the biped `run` preset does not
describe.

This is also the cleanest evidence that the freeze had nothing to do with the
init or the prompt: `run4` used **the same frame 12** the approved walk was
generated from, and the only thing that changed between the corpse and the
gallop was the pin.

**Open on it: the figure changes size by 21%.** Bounding box height runs
475–600 px against the approved walk's 587–604, a 3% spread — so seven times the
variation. Part is honest anatomy, because a galloping animal genuinely
compresses in the tuck and extends in the reach. Whether the remainder reads as
galloping or as *zooming* is an eye question, and it matters more than it looks:
`register.ts` puts the lowest ink on the baseline, so any size swing that is not
real anatomy becomes the creature pulsing while it charges. Unresolved at the
end of this session.

### Two things the live idle is still not

- **It decays.** Churn runs `5.78, 3.85, 4.29, … 1.21, 1.18, 0.98` — the clip
  starts moving and settles. The usable motion is front-loaded.
- **It does not close.** Seam 12.6%, six times the median, so frame 20 does not
  lead back into frame 0.

Both are curation problems on a LIVE clip, which is legitimate — the prohibition
in `10-dead-ends.md` is against curating a DEAD one. The candidate built from it
is frames 0–11 forward then reversed: 22 frames, a closed loop by construction,
and it drops the settled tail of the clip where the motion has run out.
Ping-ponging an idle is ordinary sprite practice, not a workaround.

---

## ⚠️ The freeze gate is far weaker on an idle than its headline number

Worth stating plainly, because the calibration table reads better than the
instrument is:

| comparison | separation |
|---|---|
| frozen vs the approved **walk** | 0.2% vs 23.7% — **100×** |
| frozen vs the live **idle** | 0.2% vs 2.08% — **1.4×** |

The live idle cleared the 2% floor by **0.08 points**. An idle moves a little by
definition, and pixel churn cannot cleanly separate "a little" from "not at
all". Against a gait the gate is decisive; against a subtle clip it is a coin
flip that landed right this once.

It is still worth having — it would have caught both of today's failures, which
nothing else did — but a near-floor result on a subtle clip means **look at it**,
in either direction. That is why the gate warns and records rather than throwing
away frames.

The deeper tell that churn is the wrong quantity: it decayed monotonically
across the live clip (5.78% → 0.98%) while the creature was visibly moving the
whole time. The number and the phenomenon are only loosely related — the same
thing that made the motion-quality metric nearly retire `walk4`.

---

## What this cost, and the thing worth carrying

Four A14B runs, roughly half an hour of GPU. Two produced corpses, one produced
a live idle, one re-ran the run without the pin. The corpses were not wasted:
they are the calibration `motion.ts` and its test now stand on, and they are why
a third corpse will announce itself in the run that makes it rather than at
review.

> **The lesson is the anti-correlated gate.** `ghost.ts` is a good instrument,
> and on a frozen clip it does not merely fail to help — it returns its *best
> possible score*, because the defect it measures needs the motion that is
> missing. Two clips were read as healthy on the strength of it. When a gate
> passes, the honest question is not "did it pass" but "could this gate have
> failed on the thing I am actually worried about" — and for freezing the answer
> was no, by construction, for as long as this pipeline has existed.
