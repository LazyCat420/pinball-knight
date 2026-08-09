# Turning a character, and the colours it loses

**Written 2026-08-08.** Two defects found in one session, both on art that had
already passed every gate the pipeline had, and both invisible to the metric
that was supposed to catch them. A third — the panel reporting a live
generation as finished — is here because it is the same shape of error.

The operator found two of the three by looking. That is now three sessions
running where the eye beat the instrumentation, and the pattern in *how* it
beat it is the useful part: **every one of these gates was measuring the right
quantity along the wrong axis.**

---

## 1. The rotation that was a mirror

### What happened

Chapter 11's work order opens by rotating the approved E master into S and N.
Both ran. S came back a genuine front view — same green eyes, same tan muzzle,
same shaggy black coat. **N came back as the E master flipped horizontally: a
side-on dog facing left.** Filed as "done", with a perfectly clean job record.

The dog is roughly bilaterally symmetric, so the flip is not obviously wrong in
a thumbnail. It is catastrophic in the game: `Dir.N` is the away-facing sheet,
`W` is *already* drawn by mirroring E, so shipping this would have given the
hound two identical side views and no back.

### The measurement

Silhouette IoU against the E master, and against the E master flipped:

| facing | vs E as-is | vs E **mirrored** | verdict |
|---|---|---|---|
| S (front) | 0.592 | 0.602 | low against both — a real turn |
| **N, rotated from E** | 0.539 | **0.942** | **the output IS flipped E** |
| N, rotated from S | 0.539 | 0.516 | low against both — a real turn |

0.942 is not "similar". It is the same silhouette.

### The cause, and it is not the LoRA

Ruled out in this order:

- **Not a missing LoRA.** `fal-multi-angle` loaded; the banner printed the
  trained grammar `<sks> back view eye-level shot medium shot`.
- **Not the wrong token.** `back view` is one of the LoRA's eight trained
  azimuths, spelled exactly.
- **Not ControlNet.** There is none in this graph, and chapter 10 already
  records that ControlNet does not bind on 2511 at all.

**It is the 180° ask itself.** From a side view, "back view" has two readings:
turn the animal 180° about its vertical axis, or reflect it. Both put the head
where the tail was. The reflection is available to the model essentially for
free — it is a symmetry of the latent — while the true turn requires
synthesising the entire unseen far side. Given an ambiguous instruction and one
cheap satisfying answer, the model takes the cheap one.

**S does not have this problem**, because a front view is not reachable by any
reflection of a side view. That is the whole fix.

### The rule

> **Never rotate 180° in one step. Go through the perpendicular.**
> E → S (90°, unambiguous), then S → N (90°, unambiguous). Rotating E → N
> directly returns a mirror.

This **contradicts chapter 11 step 1**, which said to branch every facing off
the one approved master and never rotate a facing off another facing, because
Qwen-Image-Edit identity drift compounds over serial edits. That advice is
sound and its reasoning still holds — it is simply outranked here. Two
generations of mild drift is a cost; a mirror is not a back view at all.
Chapter 11 has been corrected.

### What it means for diagonals

Better than expected. The LoRA is trained on **eight** azimuths, not four:

```
front view · front-right quarter view · right side view · back-right quarter view
back view  · back-left quarter view   · left side view  · front-left quarter view
```

So the diagonals the engine cannot yet consume are *generatable today* — they
are ordinary rotations, and all four quarter views are ≤90° from either E or S,
so none of them hits the 180° trap. `FACINGS` now lists all eight, with the
diagonals marked so the three-facing batch cannot pick one up by accident. The
blocker for 8-way movement remains what chapter 11 said: the `Dir` union and
its `Record<Dir, …>` tables, which is engine work, not art work.

---

## 2. The colour that drains into the body

### What happened

Reported by eye, unprompted, on the **one approved clip**: "a couple frames in
the walk it started to fade."

### The measurement

Cluster the whole clip's figure pixels into five colours, then track each
cluster's share of the figure per frame:

| cluster | what it is | median share | worst frame | drop |
|---|---|---|---|---|
| `#05041a` | body dark | 45.6% | f17 | 6.7% |
| `#18162c` | body dark | 29.3% | f00 | 5.2% |
| `#342f3c` | body mid | 17.7% | f10 | 6.8% |
| **`#6c6658`** | **tan paw markings** | 4.9% | **f05** | **22.5%** |
| **`#bfb8a5`** | **cream paw highlights** | 2.9% | f02 | 11.8% |

The three body clusters are stable within 7%. Only the markings collapse, and
the frames where they collapse — 4, 5, 18, 19 — are exactly the frames that
read as "the legs merged into a black blob". Cropping f00 against f05 shows it
plainly: four legs with distinct tan paws become an undifferentiated dark mass.

Whole-figure brightness is *not* the signal and would have found nothing:
luminance spread across the clip is 2.70/255 and the mean colour never moves
more than 2.51/255 from frame 0. Nothing is fading globally.

### Why `ghost.ts` scored it 0.36% and flagged nothing

Two independent reasons, and neither is a threshold that could be tuned:

1. **Ghost is directional.** It scores pixels that are *washed* — blended
   toward the **field colour** — and flat. The tan paws do not blend toward the
   white background; they are absorbed into the creature's own **black body**,
   which moves the pixel *away* from the field. Ghost is looking the other way.
2. **Ghost normalises within each frame**, deliberately, so its numbers do not
   merely encode "a dark subject on a light field". A frame that has quietly
   lost a marking is still internally consistent, and internal consistency is
   all ghost ever examines.

So ghost was correct by its own definition and useless for this. `fade.ts` is
not a better ghost; it is the cross-frame axis ghost chose not to measure.

### The gate

`fade.ts`, advisory, run on the raw frames beside `ghost` and `motion`. It
reproduces the finding independently — 23.0% on `#686157` at frame 5 — and
reports `USABLE`, naming the frame. Correct severity: a real defect, not a
reason to bin an approved clip.

**Its honest limit:** `MIN_SHARE` excludes clusters under 1% of the figure,
because a cluster that small swings wildly for free and flagging those would
bury every real finding. **The hound's green eyes are well under 1%.** This
gate catches the paws; it would not catch an eye going out.

**Prompting is not the lever.** `walk4`'s negative already bans "legs merging",
and the legs merged.

---

## 3. The live job that reported itself finished

Asked while a 21-run sweep was saturating the GPU: *"so is it generating?"* The
panel said **0 running · 0 queued**. Both halves of the page were lying.

- **The counter** only ever knew jobs the panel itself submitted, which live in
  the route's in-memory Map. A `cli.mjs` run is invisible to it.
- **The rows** were worse. `cli.mjs` wrote `job.json` once, at the *end*. For
  the 6–15 minutes a Wan run takes, its directory exists with no `job.json` and
  no frames — and the disk scan renders exactly that as
  `{state: "done", mode: "cli", frames: []}`. **A live generation appeared as a
  finished row containing nothing.** Reproduced live while writing the fix: the
  in-flight directory was empty.

An unattended sweep was therefore indistinguishable from a broken one, which
defeats the point of `bench-moveset.mjs`.

The file is now the transport: `cli.mjs` writes `job.json` at **queue** time and
heartbeats sampler progress into it. No websocket for the panel to hold, no
second source of truth, and it survives a dev-server reload because it was never
in memory. The route needed a matching change or the fix would have made things
worse — it condemned any frameless running row as "lost in a dev-server reload",
which is right for panel jobs and now wrong for CLI jobs, where
frameless-and-running is the healthy state. The heartbeat is the liveness
signal, with a **180-second** window because the quiet stretches are real: model
load is ~31GB of reads with no progress traffic, and the VAE decode is another
silent gap.

### And the banner shipped with the bug it was built to prevent

`watchProgress` multiplexes two events onto one field:

```
sampler step   {node: "sh", value: 7, max: 20}   -> 35%
NODE CHANGE    {node: "uh", value: 0, max: 1}    -> not progress at all
```

The banner tested `p.max` for truthiness, accepted the node change, and pinned
the bar at **0% for the ~90 seconds of model loading** — which is what a hung
run looks like, the one thing the banner exists to rule out. `JobCard`, three
hundred lines above in the same file, already had the correct `max > 1` guard.

The fix was not to correct the second copy but to delete it: `samplerPct()` is
now the single implementation, used by both. `progress-pct.test.ts` asserts that
`{value:0,max:20}` and `{value:0,max:1}` do **not** agree — both are "zero", and
a check that returns the same answer for both has stopped discriminating.

---

## The pattern across all three

Every one of these gates measured a real quantity along the wrong axis:

| gate | measures | blind to |
|---|---|---|
| `ghost` | washing toward the **field**, within a frame | a marking absorbed into the **body**, across frames |
| `motion` (pre-ch.12) | that pixels change | whether a *silhouette* changes — a ping-pong scores well |
| the rotate check | that a run produced a PNG | whether the PNG is a **mirror** of its own input |
| the jobs counter | jobs **this process** started | every job started by anything else |

The common failure is not laxity. Each is a correct measurement whose axis was
chosen before the defect existed, and **a defect that moves along an unmeasured
axis is invisible no matter how tight the threshold**. Tuning any of these
numbers would have found none of these bugs.

Which is the case for the eye as a gate — not because looking is more rigorous,
but because looking is the only check that is not axis-bound.

---

## 4. The facing decides which clips can read at all

Found on the first complete facing — all seven S clips, generated back to back.
The gaits came out strong and the one-shots came out as the same wrong thing,
and the pattern is geometric rather than a prompting accident.

| clip | churn | what it is | reads? |
|---|---|---|---|
| run | 26.9% | gallop | ✅ |
| death | 23.8% | collapse | ❌ shrinks |
| walk | 22.1% | four-beat gait | ✅ |
| crouch | 16.3% | gather to spring | ~ |
| stumble | 11.9% | flinch | ❌ shrinks |
| attack | 11.3% | lunge and bite | ❌ "just showing its teeth" |
| idle | 6.0% | breathing | ✅ |

**S is the FRONT facing, so any motion along the view axis is foreshortened.**
A walk swings the legs *across* the view and reads perfectly. A lunge, a
backward recoil and a downward collapse all move mostly *toward or away from
the camera*, where there is very little silhouette change available — and the
model resolves "move" the only way the geometry allows: the creature **hunches
down and gets smaller**.

Measured on the S death clip: frame 2 is a full standing wolf, frames 12–20 are
a small dark heap with the legs tucked entirely underneath. The S stumble does
the same by frame 14. Both are supposed to be different actions and both
degenerate into one crouching blob.

This is the same root cause as the operator's attack report, generalised. The
attack was not uniquely badly prompted; it was the clip where a
front-facing one-shot fails most visibly.

**Consequences:**

- **Judge a one-shot on E, not on S.** A side view puts a lunge, a recoil and a
  collapse all perpendicular to the camera, which is where they have silhouette
  to spend.
- **⚠️ CORRECTED — you cannot prompt your way out of the shrink.** This chapter
  first said "a one-shot prompt must pin SCALE, not position", on the theory
  that the old "stays centered in frame" had been holding the size as a side
  effect. That theory was written down before it was tested. **It is wrong**,
  and the measurement is in §6.
- **A scale change is worse than a pose problem downstream.** `drift.ts`
  registers cells by bounding box and baseline; a figure that halves in size
  across a clip is not a pose it can register, it is a different sprite.

## 5. The fade gate cannot tell occlusion from dissolution

The first two hard rejects the gate has ever produced, both on this sweep:

    S:stumble   fade=reject   frames 8, 9, 10
    S:death     fade=reject   frames 13-20

Both are **false positives, and instructively so.** The creature hunches down
and its own body covers its paws — so the tan cluster really has left the
frame, and `fade` reports exactly that. What it cannot know is the CAUSE: a
marking hidden behind the animal is legitimate, a marking dissolved into the
animal is a defect, and they are pixel-identical from a colour histogram.

This is not worth "fixing" by loosening the threshold, which would only make
the gate blind to the defect it was built for. It is worth **knowing**: on any
clip where the creature curls, rolls or turns away, a fade reject means "look at
it", not "throw it away". The gate is a pointer, and here it pointed at a real
problem — just not the one it named. The death clip IS broken; it is broken by
shrinking, not by fading.

Recorded as a limit alongside the small-cluster floor: `fade` does not see the
green eyes (under `MIN_SHARE`), and it cannot distinguish self-occlusion from
dissolution.

---

## 6. Three arms on one clip: the metric improved, the clip got worse, twice

The attack, S facing, same init and seed 7, one prompt variable per arm. "Area
swing" is the largest-to-smallest change in the figure's bounding-box area.

| arm | churn | boxes | seam | **area swing** | by eye |
|---|---|---|---|---|---|
| 1 — original template | 11.1% | 20/21 | 45.1% | **7.3%** | stable size, inert. "just showing its teeth" |
| 2 — new beats, pose freed | 28.3% | 21/21 | 61.1% | **43.9%** | shrinks to a head |
| 3 — arm 2 + "stays the same size" | 27.1% | 21/21 | 63.6% | **62.3%** | shrinks MORE |

**Arm 2 was a 2.5× churn improvement and a worse clip.** It bought the motion by
shrinking the dog — frame 0 a full standing wolf, frame 20 barely more than a
head. Churn cannot tell a lunge from a zoom-out, because a receding figure
changes an enormous number of pixels. This is the same failure as the walk4
near-miss, inverted: there a number nearly discarded something good, here a
number nearly shipped something bad.

**Arm 3 is the correction to this chapter's own first draft.** Adding an
explicit "the character stays the same size throughout" made the shrink *worse*,
not better. And Wan's shared negative in `graphs.mjs` has always carried:

    camera zoom, zoom in, zoom out, dolly, camera pan, camera movement,
    changing scale, character growing, character shrinking

Every one of those terms was active in all three arms. **Neither polarity of
prompting moves this.** Re-banning a banned thing is the "prompting harder" dead
end from chapter 10, and it was nearly re-shipped here.

**It is geometry.** On a front facing, a lunge has no lateral silhouette to
spend, so "move toward the target" and "get smaller" are the same picture in
projection. No wording changes a projection. The fix is the facing (§4), or
structural conditioning the animate leg does not currently have (§7).

### The fourth gate

Nothing could see this. `motion` scored the two broken arms as a large
improvement; `ghost` was clean; `fade` was advisory. So `motion.ts` now measures
it — free, because it already computes every frame's bounding box for the
distinct-silhouette count. `SCALE_SWING_SOFT` is 25%, between the good arm's
7.3% and the first bad one's 43.9%, and SOFT because a real death collapse
genuinely shrinks its own box.

It is the one defect on this list that **nothing downstream can repair**:
`drift.ts` registers cells by bounding box and baseline, so a figure that halves
across a clip is not a pose it can register, it is a different sprite.

## 7. What the animate leg is NOT using, and why that is the melting

Asked directly, on seeing the front-facing attack: *"it's melting — are we using
the control nets and the masking?"*

**No, to both, and the animate leg has no structural conditioning of any kind.**
`wanI2V` receives one image and a sentence. There is no pose map, no depth map,
no edge map, no mask. Nothing holds the anatomy from frame to frame, so when the
model is asked for motion it cannot express in-plane, the body dissolves.

The two must not be confused, and the repo's own notes invite the confusion:

| | the **still-image leg** (`leg: "qwen"`) | the **video leg** (`leg: "wan"`) |
|---|---|---|
| model | Qwen-Image-Edit 2511 | Wan 2.2 I2V A14B |
| in → out | one picture → one picture | one picture → 21 frames |
| used by | `rotate`, `edit`, background removal, keyframes | `animate` |
| ControlNet | wired, and **benched** — does not bind on 2511 | **never wired at all** |

Chapter 10's ControlNet dead end was measured on the FIRST column. It says
nothing about the second. Treating "ControlNet is dead" as covering video
control would be exactly the category error this chapter keeps documenting.

**The video equivalent is VACE** — Wan's control module, which takes per-frame
pose or depth and is supported for Wan 2.2 in ComfyUI. It is not installed. Two
honest costs before anyone reaches for it:

1. **It needs a driving motion source.** VACE transfers motion from a reference
   sequence. For a galloping quadruped that means real dog footage or a rigged
   3D render — a whole new input pipeline, not a checkbox.
2. **RAM is already the binding constraint.** A14B is ~31GB of reads and the
   guard interrupts at 1.2GiB WSL-available; the control module lands on top of
   that.

**The cheaper structural control already exists and is unused: the keyframe
path.** `cli.mjs animate --end <png>` pins a different LAST frame, so the poses
can be drawn on the still-image leg and Wan asked only to in-between them. That
is pose control with no new weights, and chapter 11 already lists it as the
escalation. It is the thing to try before VACE.

---

## 8. The rock, and the gate I nearly blinded on a theory

The scale gate from §6 fired on its first real clip: **N:run, 33.13% area
swing**. I looked at the area series —

```
1.16 1.14 1.04 0.86 0.82 0.78 0.95 1.00 0.99 0.99 1.01
1.03 1.04 1.01 0.91 0.90 0.93 1.00 1.12 1.17 1.16
```

— and reasoned that a galloping body extends and gathers, so an oscillation
that *returns to its starting size* must be a stride rather than a recession.
The trend confirmed it: **+0.42%/frame**, dead flat, against the known-bad
attack arm's **−4.11%/frame**. Clean separation, three labelled clips, a
plausible story. I rewrote the gate to fire on trend instead of swing, which
would have made it pass N:run.

**Then the operator watched the clip: "the dog just looks like it's rocking
back and forth."**

The frames confirm it — a standing dog seen from behind, tail swinging, whole
body scaling up and down. No stride, no suspension, no gallop. **The sinusoid
IS the defect.** It is the figure rocking toward and away from the camera,
which is what a gait becomes when the model has no lateral silhouette to spend.

So the swing check was right and the rewrite would have blinded it to the
commonest front/back failure there is. The corrected shape:

| swing | trend | meaning |
|---|---|---|
| high | ~0 | **ROCKING** toward/away — no gait at all |
| high | falling | **RECEDING** — the figure shrinks away |
| low | — | stable (the approved S walk, 7.3%) |

A real side-on gait **barely swings**. That is the fact that should have stopped
me: the approved walk is 7.3%, because a body extending sideways does not change
its bounding area much. "A big swing means a gait" was simply wrong — on this
pipeline a big swing IS the defect, and only its direction varies. Swing
triggers; trend picks which of the two messages to print, and they carry
different fixes.

An oscillation COUNT was tried first as the discriminator and is not one: a
monotonic decline still jitters, so gait and recession both scored 6–7 sign
changes. Same answer for both cases, so not a check — the third time in this
chapter that a proposed discriminator failed to discriminate.

**The lesson is not "the operator was right".** It is that I had a measurement
(+0.42 vs −4.11), a mechanism (extend-and-gather), and three labelled examples,
and the conclusion was still wrong, because every one of those was reasoning
about the number rather than watching the clip. A story that explains the data
is not evidence that the story is what happened.

## 9. Judge at the texel budget, not at 640px

Chapter 10's rule is **generate** at the texel budget. The corollary went
unnoticed until the operator asked why the feet distort on S/N: **judge at it
too.**

Every review this session — every GIF, every crop, every side-by-side — was
done on the 640px raw frames. The atlas cell is **72–120 texels**
(`README.md`). Downscaled to 96, the S walk reads considerably better than it
does at full resolution: legs separate, tan paws legible, the foot ambiguity
much reduced. Some of what looks broken never reaches the screen.

This does not excuse the defects — the N run still rocks at 96 texels, and the
attack still shrinks. But it changes what is worth regenerating, and reviewing
at 640 systematically over-rejects.

```bash
# what the player actually sees, at the rate they see it
ffmpeg -framerate 8 -pattern_type glob -i "<dir>/*.png" \
  -vf "scale=-1:96:flags=area,scale=-1:384:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif
```

## 10. A gait has a natural frequency and 21 frames is the wrong one

Asked whether the run needed **more** frames. It needs fewer.

A dog's gallop cycle is roughly **0.35 s**. At the game's 8 fps that is about
**three frames**. A 21-frame clip asks the model to stretch one stride across
**2.6 seconds** — and a maximally slowed gallop is, precisely, a rock. More
frames makes it slower and worse.

Two ways out, and the first is free:

- **Subsample.** Keeping every 3rd frame plays the same stride 3× faster. The
  panel already has `keep every 2th / 3th / 4th` on each job card, so it is a
  curation choice, not a regeneration.
- **Ask for fewer frames** and let each one carry a bigger pose change.

The general form: **match the clip length to the gait's period, not to a
default.** 21 frames suits a walk (~1 s) and a death (a one-shot that wants
detail); it is roughly 7× too long for a gallop.

---

## The standing rules these bought

1. **Never rotate 180° in one step.** Go E → S → N. A direct E → N is a mirror,
   measured at 0.942 IoU against flipped E.
2. **Verify a rotation against the MIRROR of its input**, not just against the
   input. A flip scores far from the original and is trivially wrong.
3. **A gate that normalises within a frame cannot see drift across frames.**
   They are different axes and need different gates.
4. **A tiny feature is below the fade gate's floor.** Eyes are not covered.
5. **A long-running job must announce itself at the START**, not on completion.
   Silence and success must never render identically.
6. **Two copies of a guard in one file is one bug waiting.** Extract it and pin
   the discrimination — not the happy path — with a test.
7. **Do not deploy while a Wan run is resident.** A Docker build alongside a
   31GB generation OOM-killed the box and took the sweep with it. Deploy in the
   gaps.
8. **A cycle and a one-shot need different prompts.** "Smooth looping animation,
   the character stays centered in frame" is correct for a gait and cancels a
   lunge twice over. Keyed on the CLIP, in `CYCLE_CLIPS`.
9. **Pin SCALE on a one-shot, never position.** Free the pose, forbid the
   shrink. A figure that halves in size is not something `drift.ts` can
   register.
10. **Judge one-shots on E.** A front facing foreshortens every attack, recoil
    and collapse into "hunch down and get smaller".
11. **A fade reject on a curling creature means LOOK, not DISCARD.** Occlusion
    and dissolution are identical to a histogram.
12. **The animate leg has NO structural conditioning.** No ControlNet, no pose,
    no depth, no mask — one image and a sentence. That is why it melts. The
    ControlNet dead end is about the STILL-IMAGE leg and does not cover video.
13. **Try `--end` before VACE.** Pinning a drawn last frame is pose control with
    no new weights, on a box where RAM is already the binding constraint.
14. **A big area swing is a DEFECT, not a gait.** A real side-on gait swings
    7%. High swing + flat trend is rocking; high swing + falling trend is
    receding. Both are bad, and they need different fixes.
15. **Judge at 96 texels, not 640.** Reviewing at generation resolution
    systematically over-rejects — the atlas cell is 72-120 texels.
16. **Match the frame count to the gait's period.** A gallop cycle is ~0.35s =
    ~3 frames at 8fps; 21 frames stretches one stride to 2.6s, which reads as
    a rock. Subsample with `keep every 3th` rather than regenerating.
17. **A story that explains the number is not evidence the story happened.** I
    had a measurement, a mechanism and three labelled examples, and was still
    wrong, because all three were reasoning about numbers instead of watching
    the clip.
