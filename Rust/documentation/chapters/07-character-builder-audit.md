---
part: Archive
status: reference
updated: 2026-08-05
---

# Character Builder — audit, 2026-08-05

An honest accounting of a session that shipped real infrastructure and **did not
deliver the thing it was asked for**: a pinball knight regenerated from a source
image, playable in game.

## The one-line verdict

**The pipeline can now generate frames, and nothing downstream of "frames exist"
was connected.** The knight in the game today is the OLD art, repaired — not
regenerated.

## Why none of it was visible

This is the most important finding, because it made everything else look like
nothing happened.

Every build ran **headless against a second dev server on `:5176`**, spawned from
a git worktree. `/api/comfy/generate` keeps its job store in
`globalThis.__forgeGen` plus `work/comfy/` — **per server**. The panel on `:5174`
reads a different store, in a different checkout.

So the jobs were real, the art was real, and the operator's panel could not show
any of it, ever. Six generated sheets landed in a gitignored `.build/` directory
inside a worktree.

> **The rule this buys:** a tool built for an operator must run where the
> operator is looking. A headless path is for CI and for unattended batches — not
> for the first proof that a feature works.

## What is actually true

Verified, not asserted.

| claim | status |
|---|---|
| The knight's published art was dead and is fixed | **TRUE** — `grid: 8` on all three facings, boot line prints on the live container |
| The forge can turn an image into a clean master | **TRUE** — `frame_1.png` → intake `READY`, all nine checks green |
| A build can generate keyframe sheets unattended | **TRUE** — 2/2 rows, cut into 4 cells each |
| Camera is locked per facing | **TRUE** — 7 tests; all four idle keys came back side-on, no turnaround |
| The drift gate measures generated art | **PARTLY** — it runs and flags, but its headline metric is wrong (below) |
| **The knight was regenerated** | **FALSE** — repaired, not regenerated |
| **A generated character is playable** | **FALSE** — nothing was assembled, staged, published or bound |
| **Animations are clean** | **FALSE** — duplicate poses in every row generated |

## Defects found in my own work

### 1. The `area` drift metric does not normalise for scale — INVALIDATES A CONCLUSION

`driftFrame` compares **absolute opaque-pixel counts** between a cell and its
master. The intake master is a 1024² canvas with the figure at 72% height; a
keyframe cell is cut from a 1344×768 sheet holding four figures. A figure drawn
at half the master's linear size has **a quarter the mass** — with every piece of
equipment still on it.

That is why quality mode scored 0.32–0.51× and fast mode 0.72–0.79×: the two
modes drew the character at different sizes on the canvas. I reported that as
"quality mode is worse". **That conclusion is withdrawn.** The measurement was
confounded; the quality sheet is arguably the better art.

The sword loss in the first run was real — visible by eye — but the *number*
attached to it was measuring scale as much as equipment.

**Fix:** normalise before comparing — compare ink DENSITY (opaque ÷ bbox area),
or rescale the cell's bbox to the master's before counting. Then re-run the
calibration, because the current thresholds were tuned on same-scale published
cells and never saw this case.

### 2. Duplicate poses — the actual art blocker, unsolved

Every generated row has near-identical keys:

```
idle E   keys 2↔4   97.3% overlap
walk E   keys 2↔4   98.6%
walk E   keys 1↔2   99.3%   (after the equipment fix)
walk E   keys 2↔3   99.2%   (quality mode)
```

The pose scripts are genuinely distinct instructions ("right foot planted far
forward" vs "passing pose, left knee lifted high"). The model is not
differentiating them. Fast and quality behave the same, so step count is not the
cause.

**This is the thing standing between the pipeline and a usable animation.**
Untested hypotheses: the four poses share one denoising pass and regress to a
mean; the sheet layout leaves each cell too little resolution to differentiate; a
pose needs a control signal rather than a sentence.

### 3. `blobs()` and `sliceSheet()` disagree about what ink is

`blobs()` thresholds alpha **≥128**; `sliceSheet()` uses **>8**. On the first
intake source the QA reported *one connected figure* while the slicer found *two
cells* on the same frame. The rejection was correct, for a reason its own checks
contradicted.

### 4. The scorer's baseline convention differs from the gate's

`score-build.mjs` places cells with `padBottom = 6%` of cell height; `drift.ts`
expects feet at `FEET = 0.9` of canvas height. Every scored cell therefore
carries a false `feet on the baseline` warning. Two conventions for one idea —
the same shape of defect as #3.

### 5. Operational

- The operator's dev server on `:5174` was stopped to free RAM and not restarted.
  `/forge` and `/docs` were down for the rest of the session.
- The full 18-sheet build (3 facings × 6 moves) was never run. Only `idle` and
  `walk`, only `E`, three times.

## What DID ship, and is worth keeping

- **The knight's art is alive** — `separated()` in `commit.ts` replaced a check
  that could never pass; a per-sheet crush failure no longer aborts the batch.
- **The guard's host floor** was below the workload's real envelope (58 GB floor
  vs 58.9 GB healthy peak). Raised to 61/62.5 against a measurement.
- **Camera per facing**, closing a long-open question.
- **`op:"drift"`** and the planner script.
- **`documentation/` + `/docs`**.

## The plan

Ordered so the operator can see progress after **every** step.

### A — make the work visible (first, ~30 min)

- [ ] Run all builds against the operator's server on `:5174`, never a worktree
      server. The job store is per-server; a headless run elsewhere is invisible.
- [ ] `build-character.mjs` defaults to `:5174`.
- [ ] Every generated sheet appears as a **job card** in the panel — free, once
      the job runs on the right server.
- [ ] Put the six existing sheets somewhere reviewable and say where.

### B — fix the measurement (~1 h)

- [ ] Normalise `area` for scale; re-derive the thresholds.
- [ ] Re-score the existing builds and re-state fast-vs-quality honestly.
- [ ] Reconcile `blobs()` and `sliceSheet()` on one alpha threshold, with a test
      asserting they agree on a frame with a thin bridge.
- [ ] Make the scorer place cells at `FEET`, killing the false warnings.

### C — solve pose diversity (the real blocker, unknown effort)

- [ ] Test whether the shared denoising pass is the cause: generate the four keys
      as four SEPARATE jobs off the same master, compare IoU.
- [ ] If that fixes it, a clip becomes 4 jobs and the sheet is assembled from
      them.
- [ ] If not, try a pose control signal (`comfyui_controlnet_aux`, scribble or
      depth per key) instead of prose.
- [ ] Gate: no row publishes with a pairwise IoU above 0.94.

### D — close the pipeline to the game (~2 h once C lands)

- [ ] `build-character.mjs` continues past `cut`: assemble the tray →
      `op:"crush"` → `op:"stage"` → `op:"publish"`.
- [ ] Write the `IMPORTED_ART` entry / set the player sheet from the panel.
- [ ] `__lab.playAs("<name>")` surfaced as a button in `InGameCard`.
- [ ] Acceptance: the boot line names the NEW sheet, and the creature moves,
      attacks, staggers and dies under real controls.

### E — the review workspace (~half a day)

- [ ] A `build` tab: rows × facings, each cell green / advisory / blocked, with
      the master as a ghost overlay behind the selected cell.
- [ ] Per-cell re-roll, mask repair, free geometry fixes offered first.

## What would help most from the operator

1. **Which knight is the target?** The published art is a hand-authored 8-row
   sheet including `roll`, `run` and `stumble`. A generated character covers six
   moves and cannot reproduce the ride clips. Replace him, or build a NEW
   creature and leave the knight alone?
2. **Is `frame_1.png` the right source?** It is a single clean side-on knight
   with a red plume. The published knight is a different design (orange/brown), so
   regenerating from `frame_1` yields a different-looking character.
3. **Windows RAM.** Non-WSL Windows sits at ~28.7 GB against an assumed ~17 GB.
   Closing Vivaldi / Discord / the IDE would give generation real headroom instead
   of the 2.9 GB it has now.
