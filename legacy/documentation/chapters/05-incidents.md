# Incidents

Failures worth remembering, written so the *mechanism* survives and not just the
patch. Each names the symptom, what it actually was, and the rule it bought.

## The player had no art for weeks, and nothing said so

**Symptom.** `pinball_knight` rendered 100% procedurally. No error, no warning,
no log line — the procedural painter looks fine, so nothing looked wrong.

**Three bugs in a chain**, and the first two are the ones that matter.

**1 — a check that could never pass.** The crush widens the gutter until the
committed sheet "re-slices to the declared shape". That test assumes *one
declared cell is one connected blob*. The knight's spin attack opens with the
body **and a swung element clear of it** — two blobs, one legitimate frame,
correctly declared as one cell. The slicer counts blobs, so it reported one cell
more than declared **at every gutter in the range**. The loop exhausted itself
and threw on art that was fine.

Measured, identically on all three facings:

```
declared cells/row : 5/6/6/4/4/2/3/6
SLICED cells/row   : 5/6/6/4/5/2/3/6     ← row 5 only
declared rect      : [46,2151,438,2549]
sliced  cells      : [46,2151,241,2549] + [257,2254,438,2549]
```

**2 — the throw aborted the whole batch.** E's manifest was written; S and N
never were. One creature's crush problem cost six other sheets their publish.

**3 — so somebody routed around it**, hand-copying the inbox sidecars into
`public/sprites/`. Those have no `image` field, so the loader set
`img.src = "undefined"`, 404'd, returned `null`, and the player fell back to the
painter in silence.

**Fixes** (`57b0511`). `separated()` replaces the count-equality test with the
invariant the gutter actually has to guarantee: every sliced blob nests inside
exactly one placed cell, and every placed cell holds at least one blob. A
two-piece pose passes; two figures merged by a tight gutter still fails. The
publisher collects crush failures and asserts *after* the loop, so every sheet
publishes and the run still goes red. `spin_attack` — never a `ClipName` — is
renamed `attack`.

**Result:** ×8, confidence 100%, block-reduce EXACT; `grid: 8` on all three
facings; 3.5 MB → 189 KB.

> **The rule: a check that cannot pass is worse than no check**, because someone
> will route around it and the workaround is invisible. Both symptoms were
> present for weeks — a test that threw every run, and a published file whose
> shape no writer in the codebase produces. Neither was treated as a signal.
>
> **The corollary: a batch must not abort on its first bad item.** Publishing
> what succeeded and failing loudly afterwards costs nothing and removes the
> incentive to work around the gate.

## A licence bar nobody set, cited back at itself

**Symptom.** The best segmentation node pack in the ecosystem was rejected in
writing, and a plan was drafted around avoiding it.

**What it was.** `comfy/manifest.mjs`'s header claimed "every entry is Apache-2.0
or Civitai Sell-granted — the strict bar **the user set**". No such ruling was
ever made; searching the repo and memory found the assertion in exactly two
places, and the second one cited the first. Later sessions — including the one
that found this — read the comment as policy and enforced it.

The substance was wrong too: GPL-3.0 governs *distributing* a local ComfyUI
plugin and says nothing about the PNGs it produces.

**Fix.** Licences are recorded, never enforced, and the header now explains why
so the rule is not re-derived from its own echo.

> **The rule: a comment asserting "the user decided X" is not evidence that they
> did.** If a constraint has real consequences, it needs a real source.

## A drift metric that condemned working art

**Symptom.** A newly written identity gate flagged four of four shipping sheets.

**What it was.** Bounding-box aspect ratio, used as a hard check. Scored against
their own idle frames, art the game draws today came back 28% off (beaver
attack), 38% (beaver walk), 50% (frog walk) and 251% (jester's last death
frame). Nothing had drifted — a stride is genuinely wider than a stand and a
collapsed body is genuinely a different rectangle. **Bbox aspect measures pose.**

**Fix.** Demoted to advisory, with the measured numbers written into the source
so the next person to think "we should check proportions" finds the measurement
instead of re-deriving it. The same pass found death frames legitimately at
0.61–0.63× their idle's mass, so off-floor clips are exempt from the hard area
band — rather than widening the band for everyone, which would have stopped
catching a dropped weapon.

> **The rule: calibrate a new gate against known-good output before trusting it,
> and treat a metric that condemns working art as refuted, not as a threshold to
> nudge.**

## Earlier lessons, still load-bearing

| symptom | actual cause |
|---|---|
| walk cycle "rubs the floor" | the prompt described mood, not mechanics — "walking in place, smooth" tells the model to keep everything anchored |
| frames slowly zoom in, head cropped | cut cells had different aspect ratios and the FLF node stretches whatever it is given to one square, so it interpolated a scale change |
| the "walk" was a turnaround | pose scripts never pinned the camera, so the model expressed a stride by *rotating* the character |
| colours went muddy after the crush | the preview ignored `commit.derive` and previewed the shared 32-palette |
| every pose came back as a row of copies | a finished **sheet** was fed back as the character reference |
| the box froze at 64 GB | ComfyUI parked models in system RAM; an uncapped WSL2 never returns page cache to Windows |
| the guard killed healthy jobs three times | floors were calibrated above the real envelope — a Wan decode legitimately dips to ~1.5 GiB available |
| a creature shipped for weeks and never drew | its sheet had no `idle` row, and `importedPaints` drops such a sheet **whole**, in silence |
