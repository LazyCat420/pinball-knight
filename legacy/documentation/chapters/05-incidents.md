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

## The knight moonwalked, and the engine was innocent

**2026-08-05.** "Walking down or sideways still shows his back." Three earlier
sessions had gone looking in the facing code; the chain was correct every time,
and measuring it live (stick → `facingFromVelocity` → `dir:clip` → the E/W flip)
confirmed all four directions resolve right.

The fault was in the ART, and there was no standard for it to violate. A
generator asked for "a side profile" picks its own side, and the knight's came
back facing LEFT under an `E` label. An inverted E is wrong BOTH ways: E draws
left-facing art, and W — which the engine derives by mirroring E — draws
right-facing art. Every direction looked like the back of a knight who was
walking the other way.

Rendering each published E sheet's first walk cell took two minutes and settled
it: knight and zombie inverted, beaver and fish_feet correct, frog and stiltneck
not side views at all (front views under an E label — a flip cannot fix those).

> **The rule: a facing bug is an ART question before it is a CODE question, and
> "which way does this sheet face" is answered by rendering it, not by reading
> the pipeline.** `dir` is now a documented promise about the screen
> (`tools/sprite-forge/docs/FACING_STANDARD.md`), art that disagrees declares
> `mirror` in its sidecar, and the compass fixtures make a wrong answer
> unmissable rather than plausible.

## A profiled run found a crash the suite could not

**2026-08-05.** The first 1080p profiled playtest failed on
`Cannot read properties of null (reading 'clip')`. It was not the resolution
change — it was a one-frame race that had been shipping for as long as ricochet
form existed.

`updateRicochet` returns true on the frame it decrements `ricochetT` to zero
(it still owes the exit speed and the burst), but `ricochetSpec()` is gated on
`ricochetT > 0` and has already gone null. `p.anim.play(ricochetSpec()!.clip)`
asserted the two could not disagree. They disagree for exactly one frame, once
per use of the form, and the throw killed the rest of that frame's player
update.

Nothing in 2100 tests drove the form to its last frame. A bot playing for 25
seconds did.

> **The rule: a non-null assertion is a claim about a state machine, and the
> frame a state ENDS is the one where two guards on the same condition drift
> apart. The regression test has to drive the real update across that boundary
> — a test that merely proves the disagreement is reachable passes with the bug
> restored.** (Verified by reverting the fix: green→red, same error text.)

## Intake could not accept a creature wider than it is tall

**Symptom.** Every four-legged creature is rejected at intake, with two
complaints that both sound like bad art: *"figure fills the frame ✖ — 42.8%
tall (want 68.0%–76.0%)"* and *"slices as a single cell ✖ — 2 row(s), 3
cell(s) … the slicer sees more than one figure — a caption, a border, or a
second component"*. There was no caption, no border and no second component:
one clean single-blob hound.

**Two constants that guaranteed it.** `reframeSubject` scales by
`min(targetH/h, SUBJECT_W_MAX/w)` — it fits BOTH bounds and lets whichever
binds decide, which is correct. Everything downstream then assumed the height
bound had won:

- **`intake-qa`'s size check asked only about height.** A hound at the 75.0%
  width cap is 42.8% tall, and no reframe could do better: 68% tall at that
  aspect is 108% wide. The check was unpassable by construction for any
  subject wider than about 1:1.
- **`slice.ts` erased the animal's own back as a ruled border.** The
  sheet-wide pass strips any scanline whose longest contiguous run spans
  `RULE_FILL` (0.70) of the width. `SUBJECT_W_MAX` is **0.75** — so intake
  frames a wide creature *above* the threshold that deletes it. The body rows
  went, the head and the legs survived as separate bands, and that is where
  "2 rows, 3 cells" came from.

The second one had already been half-learned. The comment above that pass
records the `frog.png` incident — five wide frogs per row read as a border on
total ink — and the fix was to measure the longest CONTIGUOUS run instead,
which separates a rule from a ROW of creatures because the row has gaps. It
does not separate a rule from ONE wide creature, whose back is a single
unbroken run. The vertical pass in the same file already knew the missing half
and says so: *"a vertical rule is SPANNING **and** NARROW, fill alone is not
enough."*

**Fix.** A rule is a line in BOTH axes — it spans, and it is thin. Both
horizontal passes (sheet-wide and band-local) now erase a spanning run of
scanlines only when that run is thin, mirroring the frame-sides pass:

```
ruled border      spans ~100%,   1-3px tall
hound's back      spans   75%,  ~440px tall
```

The band-local pass needed it more than the sheet-wide one: against a band's
own extent a lone creature's body spans 100%, so no fill threshold could ever
survive it, and fixing only the sheet-wide pass left the hound's four legs
standing as four cells with the body erased between them.

`intake-qa` now asks whether the subject is at the cap on the axis that BOUND
it, with the other inside its own bound, and reports which kind of subject it
measured.

**Verified on real art, not fixtures.** The styled hound went from REJECT on
two checks to **READY on all ten** — `figure fills the frame ok 42.4% tall,
75.0% wide — wide subject` and `slices as a single cell ok 1 row(s), 1
cell(s)`. `inbox.test.ts`, which slices the shipped sheets, stayed green.

> **The rule: when one stage's output is another stage's input, their
> constants are a contract. `SUBJECT_W_MAX` (0.75) sitting above `RULE_FILL`
> (0.70) meant the framer aimed at a value the slicer deletes — and neither
> file mentions the other.**

## The hound's charge tell was drawn, tested, and never once played

**Symptom.** None — that is the whole point. The hound charges, the tint comes
up, the dash lands. It just plays its **idle** through the telegraph, and an
idle hound at 52px with a warning tint looks enough like a tell that nobody
questioned it.

**What it actually was: two names for one pose.** `render/monsters/hound.ts`
authored the gathered crouch as the clip **`attack`**, and the file says so at
length — the whole creature is designed around `HOUND_CHARGE_WINDUP`. But the
hound's behaviour had since moved to the shared `leaper` policy
(`entities/enemy-rules.ts`: `hound: "leaper"`), whose telegraph
`render/tell-clips.ts` resolves to the clip **`crouch`**. The painter authored
no `crouch`, so `CLIP_FALLBACK` sent it to `idle`.

Probed against the running game (`scripts/clip-probe.mjs --kind hound`):

```
attack   3f        3f        3f          ← authored, reachable only from the
crouch   →idle 2f  →idle 2f  →idle 2f       0.3s contact bite
```

`attack` is not dead — the melee windup at `HOUND_CONTACT_RANGE` still plays it
— but that is a 0.3 s bite the player is already inside. The 0.45 s warning the
art exists to give was never drawn.

**Why nothing caught it.** `hound.test.ts` asserted the gather thoroughly: that
it differs from the walk, that the ridge bristles higher. Every one of those
assertions names `attack`. The suite and the screen were both consistent and
they disagreed with each other, because **the test asked about the clip the
mechanic had stopped requesting** and no test asked what the mechanic requests.

**Fix.** The three frames are now published under both names — `attack` for the
bite (`anim.attack` 12 fps → 0.25 s) and `crouch` for the telegraph
(`anim.crouch` 7 fps → 0.43 s, which is `HOUND_CHARGE_WINDUP` 0.45 s almost
exactly). One authored pose, two rates, nothing duplicated.

The regression test derives both halves instead of restating either: it reads
the hound's policy out of `MOVEMENT_BY_KIND`, **runs that policy**, asks
`clipForSteer` what it demands, and requires the painter to author every answer
in every facing. The driver moved to `testkit/tell-clip-demand.ts` so
`tell-clips.test.ts` and the art tests cannot drift apart. Verified by reverting
the painter: `S: the game asks a hound for "crouch" and the painter authors
none`.

> **The rule: a clip name is an interface between behaviour and art, and an art
> test that names the clip itself can only confirm the art. Ask the BEHAVIOUR
> what it will request.** Any monster whose tell was authored before its policy
> was assigned is a candidate for the same defect.

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
