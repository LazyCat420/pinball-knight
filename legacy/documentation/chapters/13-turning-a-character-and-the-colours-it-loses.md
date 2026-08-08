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
