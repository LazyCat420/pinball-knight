# DOORWAY PLAN — canonical openings between sections

Status: **not shipped.** Two attempts built and reverted (2026-07-27). Neither
was wasted — the measurement and the failure modes below are the expensive part,
and the third attempt should be short.

Live QA, verbatim:

> "we need to make sure we don't have narrow exits because they are being
> generated in the maze generator system and it looks bad/looks sloppy. It
> should have clear doorways, entrances from one place to another … it should be
> a uniform size, and we have different uniform sizes that can go from one
> section to another"

**Read it as a VOCABULARY, not a minimum.** A minimum turns a 1-tile squeeze
into a 3-tile one and leaves every other opening at whatever width the maze
happened to leave, so the floor still reads as accidental. What makes an opening
look authored is being recognisably the same object each time you meet it.

⚠️ **The physics half of the complaint ("it makes the user bounce a bunch") is
owned by another dev.** This plan is geometry only. Do not touch bounce damping
or launcher behaviour.

---

## 1. The measurement (do not redo this — it cost the most to get right)

Passage width must be measured on the **medial axis**: the widest circle that
fits at the pinch. An arbitrary tile's wall clearance is *not* width — every
tile of a 2-wide corridor touches a wall exactly like a 1-wide one.

Over 120 generated floors:

| passage at a pinch | share | slack per side (ball r = 0.3) |
|---|---|---|
| **1 tile** | **81.3%** | **0.20** |
| 3 tiles | 16.4% | 1.20 |
| 5 tiles | 2.3% | 2.20 |

Restricted to pinches that gate a **section** (a squeeze between two 5+-wide
spaces): **10.9 per floor**. That is the target set. Widening all 51 pinches per
floor would carve the maze open wholesale.

At 22 u/s with 0.20 of slack per side the ball cannot cross without touching
both walls, which is the reported rattle.

**Two measurement mistakes that were made and must not be repeated:**

1. Filtering candidates to clearance ≤ 2 and then printing "the clearance
   histogram" — truncated by its own filter, told us nothing about the tail.
2. Treating tile clearance as width (see above).

---

## 2. What v1 did wrong — self-amplification

v1 decided what counted as a "room" from **local clearance, re-derived on every
pass**. That is self-amplifying: widening an opening promotes the corridor
beyond it into a room, which manufactures a fresh doorway, which widens again.

    iterated with removeWallStubs:  34 → 107 doorways/floor
    surviving pinches over the same run:  109 → 102

It is the **opposite** of `removeWallStubs`, where every round strictly reduces
the work left. The "iterate to a fixed point" reflex is wrong here and applying
it made things measurably worse.

---

## 3. What v2 got right — keep all of this

Section labels computed **once**, from the clearance field, before any carving.
A doorway is then *"the opening between section 3 and section 7"* — a statement
carving cannot invalidate.

- **Siting:** multi-source BFS out of every section at once (a Voronoi partition
  of corridor space). Where two territories meet, those sections are connected;
  the meeting tile with the greatest clearance is the cheapest place to put the
  door, because it is already the widest part of that connection.
- **One door per section PAIR.** Two sections joined by three corridors get one
  canonical door, not three — otherwise the widest-point rule opens every route
  between them and the pair dissolves into a single space.
- **Vocabulary `[3, 5, 7]`, odd on purpose** so an opening has a true centre tile
  and centres on the passage's own axis.
- **Size from what it JOINS** (bigger section ⇒ wider mouth), never an rng roll,
  so the size carries information a player can learn.
- **Clamp the centre inside the border at PLAN time.** `carveDoorways` refuses
  to touch the outermost ring, so an opening sited one tile in silently comes out
  narrower. Sliding the centre fixes it; 9 floors in 78 shipped a 2-wide door for
  exactly this reason before the clamp.
- **Only ever wall → floor**, so it can never strand anything and needs no repair.
- **Never carve a `mask.sealed` tile.** The launch chute's side walls are sealed;
  opening one turns the plunger hallway into a corridor with a hole in it.
  `track-launch.test.ts` catches it.
- **Never widen a `T_CRACKED` tile** — that is a deliberate hidden route, and
  announcing it is the opposite of a secret.

Measured with all of the above:

    authored ................... 32.4 doorways/floor, stable
    sizes ...................... 3w ×3035   5w ×469   7w ×382  (120 floors)
    closed by a later pass ..... 0        (v1: 12)
    plan drift on re-plan ...... 2.45/floor — no amplification
    under 3 tiles .............. 0/78 floors

---

## 4. Why v2 still could not ship — and the correction to my earlier note

It broke `piece-rules` ("every curved wall has stone behind it") and then
`floor-metrics`.

**An earlier HANDOFF entry said "v3 must change the arc layer". That is not
quite right — read this instead.** `publishArcs` (`maze/track-carve.ts:244`)
already claims only tiles that are `T_WALL` **at stamp time**, so it is not
publishing over open floor. The actual mismatch is:

> An arc feature's **drawn angular span** covers tiles it does not *own*.
> `arcSweepGeometry` draws the whole `a0 … a0 + span` band. A doorway carved
> anywhere under that band un-backs the drawn geometry even though the feature
> never claimed those tiles.

That is why a 3×3 neighbourhood guard around `arcIdx` was not enough: the guard
was checking ownership, and the requirement is about the **span**.

---

## 5. v3 — do this, in this order

### Step A (cheap, try first): guard on the SPAN, not on ownership

Build a span-occupancy mask once, after all arc authoring:

```
for each feature f in grid.arcs:
    steps = max(8, ceil(f.r * f.span / 0.25))
    for s in 0..steps:
        ang = f.a0 + f.span * s / steps
        for d in 2.0 .. 4.5 step 0.5:            # same band publishArcs probes
            mark tile( f.cx + cos(ang)*(f.r-d), f.cz + sin(ang)*(f.r-d) )
```

Forbid `carveDoorways` from opening any marked tile. This is precise, needs no
change to the arc layer, and mirrors exactly what `piece-rules` samples.

**Then MEASURE how many doorways it blocks.** With ~90 arc features per floor
this may reject too many. Acceptance: if `< 15%` of planned doorways are blocked
and the gate is green, ship it and stop.

### Step B (only if Step A blocks too many): clip arc spans instead

Move `piece-rules`' backing check from assertion into authoring: after doorways
carve, walk each feature's span and **trim or split it** to the sub-ranges that
still have solid backing. `maze/arc-contract.ts` already clips `kicks`/`lanes`
sub-ranges — extend the same idea to the feature span itself. `compactArcs` then
drops whatever is left too small.

This is the more invasive option, which is why it is second.

### Step C: wire and gate

- Plan in `buildTrackFloor` on clean pre-curve geometry; carve **after** all
  floor→wall passes (`authorArcSweeps`, `authorArteryBanks`, `resealChute`,
  `compactArcs`) and **before** `removeWallStubs` — carving raises the
  open-neighbour count of adjacent walls, so the stub sweep must see the result.
- Fence doorway tiles off from those same passes via the `occupied` /
  `isGuarded` predicates they already accept.
- Add the rule to `maze/floor-rules.ts` (`doorways-are-uniform`), checking
  **authored** doorways against the finished grid. Do **not** re-derive the set
  from the final floor: a widened doorway is no longer a pinch, so re-detection
  returns only the ones that were *not* fixed, and then measures a run that has
  merged into the space beyond. An early version reported an opening as "9 wide"
  for exactly this reason and failed 78/78 floors on a meaningless metric.
- Store the plan on `TrackFloor.doorways` so the gate can see it.

---

## 6. Acceptance criteria

Ship only when **all** of these hold:

- [ ] `floor-rules.test.ts` green — no authored doorway finishes under 3 tiles
- [ ] `piece-rules.test.ts` green — both the arc-backing and the full piece sweep
- [ ] `floor-metrics.test.ts` green
- [ ] `track-launch.test.ts` green — the chute is still sealed
- [ ] full suite green (1086 at the time of writing)
- [ ] doorways/floor in the 25–40 band (32.4 was healthy; 107 was amplification)
- [ ] all three vocabulary sizes present across a 120-floor census
- [ ] verified in-engine with a screenshot, not just numbers

---

## 7. Files

| file | role |
|---|---|
| `maze/doorways.ts` | **deleted — rewrite from §3** (clearance field, section labels, plan, carve, audit) |
| `maze/track-floor.ts` | wiring: plan early, carve late, fence the tiles |
| `maze/floor-rules.ts` | the `doorways-are-uniform` rule + `TrackProfile` weights |
| `maze/track-carve.ts` | `publishArcs` — read it before Step B |
| `maze/arc-contract.ts` | existing sub-range clipping to model Step B on |
| `maze/piece-rules.ts` | the backing check to mirror / relocate |

Per-archetype weights belong on `TrackProfile.rules` alongside `perimeterBias`,
the pattern already shipped in `efe67db`.
