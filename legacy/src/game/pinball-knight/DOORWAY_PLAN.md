# DOORWAY PLAN — canonical openings between sections

Status: **SHIPPED** (2026-07-27), third attempt. `maze/doorways.ts`, planned and
carved in `buildTrackFloor`, gated by `doorways-are-uniform` in the floor-rules
registry and a census in `floor-rules.test.ts`, inspectable at runtime with
`__dungeonDoorways()`.

Live QA that started it, verbatim:

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
owned by another dev.** This work is geometry only; bounce damping and launcher
behaviour were not touched.

---

## 1. What shipped

`maze/doorways.ts` — clearance field, section labels, Voronoi siting, plan,
carve, audit. The module header carries the full rationale; this is the shape:

1. **Clearance field** — a 3-4 chamfer distance transform. Width is measured on
   the medial axis (§2), never from one tile's neighbours.
2. **Sections, labelled ONCE** — connected components of clearance ≥ 3 (passage
   ≥ 5 tiles) holding ≥ 14 tiles. Labelled before anything is carved, so a
   doorway is *"the opening between section 3 and section 7"* — a statement
   carving cannot invalidate, which is what kills v1's self-amplification (§3).
3. **Siting** — multi-source BFS out of every section at once, a Voronoi
   partition of corridor space. The boundary is grouped into connected strips;
   each strip is one CONNECTION and gets one door.
4. **Size** — the smallest member of `[3, 5, 7]` that clears both the size the
   two sections earned (bigger section ⇒ wider mouth) and the opening's current
   width. So a 4-tile gap becomes a 5-tile doorway; it is never left at 4.
5. **Carve** — wall → floor only, extending along the travel axis until the
   full-width cross-section is already open at both ends.
6. **Audit** — `measureDoorway` reads the narrowest cross-section through the
   AUTHORED centre. Never re-derived from the finished floor (§4).

### Measured on the shipping path, 78 floors (6 seeds × 13 depths)

```
authored ...................... 9.9 doorways/floor, max 23
sizes ......................... 3w ×301   5w ×340   7w ×131
finished at the authored size .. 99.2%     (before the jamb rule: 83%)
under 3 tiles ................. 0
carved ........................ 6.15 tiles/floor across 1.5 doorways
openShare ..................... 0.60 → 0.61
dead ends per 1k tiles ........ 0.30 → 0.29
```

A/B against the same builder with the pass disabled, same seeds:

```
narrow section connections (< 3 tiles) on the shipped floor
   pass off ... 4.13 per floor
   pass on .... 3.41 per floor
```

**That 17% is the honest headline, and the residue is fully accounted for.**
Every narrow opening the pass declines has a named reason (266 over 78 floors):

| why | n | is that right? |
|---|---|---|
| `throat` | 89 | the squeeze is a long corridor, not a threshold. Widening corridors wholesale is exactly how v1 carved floors open. |
| `arc` | 76 | a published curve occupies the cross-section. The circuit's fillets are the racing line and never yield (`arc-contract.yields`). |
| `jamb` | 50 | a one-tile partition cannot hold a doorway — see §5. |
| `span` | 23 | the arc-span guard (§4). **3.6% of planned sites, well under the 15% Step-A acceptance, so Step B was never needed.** |
| `border` | 23 | the outermost ring stays solid. |
| `sealed` | 5 | the launch chute. |

---

## 2. The measurement (do not redo this — it cost the most to get right)

Passage width must be measured on the **medial axis**: the widest circle that
fits at the pinch. An arbitrary tile's wall clearance is *not* width — every tile
of a 2-wide corridor touches a wall exactly like a 1-wide one.

Over 120 generated floors:

| passage at a pinch | share | slack per side (ball r = 0.3) |
|---|---|---|
| **1 tile** | **81.3%** | **0.20** |
| 3 tiles | 16.4% | 1.20 |
| 5 tiles | 2.3% | 2.20 |

At 22 u/s with 0.20 of slack per side the ball cannot cross without touching
both walls, which is the reported rattle.

**Two measurement mistakes that were made and must not be repeated:**

1. Filtering candidates to clearance ≤ 2 and then printing "the clearance
   histogram" — truncated by its own filter, told us nothing about the tail.
2. Treating tile clearance as width (see above).

---

## 3. What v1 did wrong — self-amplification

v1 decided what counted as a "room" from **local clearance, re-derived on every
pass**. That is self-amplifying: widening an opening promotes the corridor
beyond it into a room, which manufactures a fresh doorway, which widens again.

    iterated with removeWallStubs:  34 → 107 doorways/floor
    surviving pinches over the same run:  109 → 102

It is the **opposite** of `removeWallStubs`, where every round strictly reduces
the work left. The "iterate to a fixed point" reflex is wrong here.

Pinned by `doorways.test.ts` → "re-planning after carving does not manufacture
new doorways".

---

## 4. What v2 got right, and the two places its spec was wrong

Kept wholesale: sections labelled once; Voronoi siting; the odd `[3,5,7]`
vocabulary; size from what it joins rather than an rng roll; clamping the centre
at PLAN time (`carveDoorways` refuses the outermost ring, so a centre sited one
tile in silently comes out narrower); wall → floor only; never a `mask.sealed`
tile; never a `T_CRACKED` tile.

### 4a. The arc guard — the plan was right, its pseudo-code was not

The blocker was correctly diagnosed: `publishArcs` claims only tiles that are
`T_WALL` at stamp time, so ownership is never the problem. The mismatch is that
an arc feature's **drawn angular span** covers tiles it never owned, and a
doorway carved under that band un-backs the drawn geometry.

But §5's pseudo-code guarded the band `publishArcs` probes (2.0–4.5 tiles inside
the radius). That is the OWNERSHIP band. `piece-rules` samples `backedAt`, which
probes **0.6** tiles inside — a different set of tiles entirely, and guarding the
first would have blocked plenty while protecting nothing.

`arcSpanMask` therefore mirrors `backedAt`, sampled at 4× the density
`backedFraction` uses so the marked set is a strict superset of what the gate
probes. Pinned by "builds the span mask from what the backing check SAMPLES, not
from what the feature owns".

### 4b. "The meeting tile with the greatest clearance" is a no-op

Read connection-by-connection this is sound: among several corridors joining two
sections, the widest is the cheapest to bring up to standard. Read
tile-by-tile — which is how it was implemented — it puts the door on the wrong
side of the squeeze.

Two rooms separated by a wall with a one-tile slot meet across exactly two
tiles: the slot, and the room tile beyond it. The room tile has the greater
clearance, so the door is sited one tile PAST the squeeze, inside the room,
where it measures nineteen tiles across and is discarded as "these two have
merged". The squeeze it existed to remove is untouched.

Measured on 78 real floors: **1181 doorways carving 5.6 tiles per floor between
them.** The pass was doing essentially nothing, and every number in v2's census
still looked healthy — that is the failure mode worth remembering.

The fix is to site at the connection's narrowest CROSS-SECTION (open run across
the passage), not at its greatest clearance. Cross-section rather than clearance
because clearance also falls off near the walls at the *ends* of a perfectly good
wide opening; minimising it would site the door in the corner of a 15-tile mouth.

Also corrected: **one door per CONNECTION, not per pair.** Per pair leaves every
squeeze but one between the same two sections at its original width.

---

## 5. Two rules the plan did not have, both from measurement

**A seam wider than the vocabulary gets no door.** Two sections meeting across a
12-tile front have not got a threshold between them, they have merged. 36% of
seams are like this, and cutting a "doorway" into one authors an object standing
in a field.

**`jambsSurvive` — a doorway is a hole in a wall, so there must still be a
wall.** Widening a 1-tile slot whose neighbour is a lone pillar breaks sideways
into whatever is behind it, and `removeWallStubs` then eats the rest of a thin
partition (every tile of a one-tile wall already has open floor on both sides, so
a hole gives its neighbours a third open side and the whole wall zips out).
Before this check, **17% of doorways finished wider than the size they were
authored at, the worst at 52 tiles.** After it, 1.3%.

---

## 6. Two neighbouring bugs this uncovered

Both are independent of doorways and were fixed here because doorways made them
fire.

**`compactArcs` and `removeWallStubs` need a joint fixed point** (`track-floor`).
Running each once leaves whichever defect the other just created: de-stubbing can
open the last stone BEHIND a drawn arc span (the backing probe sits 0.6 tiles
inside the radius, well short of the 2.0–4.5 band `publishArcs` claims), and
compaction turns a dropped feature's rims into plain stone that can be a nub.
Iterating is safe here — unlike the doorway pass — because both are MONOTONE in
opposite directions and neither can undo the other's work.

**`arc-sweeps.planFillet` asked `occupied` only on the concave branch.** True of
content, false of a plan: a convex sweep carves its shoulder open and marks a rim
straight through a doorway planned before the curves existed. It was the single
largest reason doorways were refused — 220 of 1788, more than every other guard
combined.

---

## 7. Where the code is

| file | role |
|---|---|
| `maze/doorways.ts` | the pass. Header carries the rationale. |
| `maze/doorways.test.ts` | the unit half — 23 cases, each one a thing that went wrong |
| `maze/track-floor.ts` | plan before the curves, carve after them, fence the tiles |
| `maze/floor-rules.ts` | the `doorways-are-uniform` rule |
| `maze/floor-rules.test.ts` | the census: count band, all three sizes, empty-floor rate |
| `dev/window-hooks.ts` | `__dungeonDoorways()` — authored vs finished, in the running game |

---

## 8. Next — CORRIDOR MOUTHS (the `throat` third), spec'd for a fresh pair of hands

**89 of the 266 declined narrow openings are the same shape**, and it is the
largest single bucket: a 1-wide corridor running between two sections, longer
than `MAX_DOORWAY_DEPTH`. Today the pass sites a door at the connection's
midpoint, finds the throat never reaches daylight within 4 tiles, and declines —
correctly, because widening the whole corridor is how attempt 1 carved floors
open (§3).

But a player meets that corridor at its **ends**, and both ends are exactly the
thing the QA complaint names: a 1-tile slot in the wall of a room. **The doorway
belongs at each mouth, not at the midpoint.**

### The change

`planDoorways` currently emits one site per boundary component, at that
component's narrowest cross-section. Add a second siting rule for the case the
first one declines:

1. When a connection's throat exceeds `MAX_DOORWAY_DEPTH`, walk the corridor
   from the meeting tile **toward each section** until the tile's owning label
   is that section (`sectionTerritory` already gives you this) — that tile's
   predecessor is the MOUTH.
2. Emit a `DoorwaySite` at each mouth, travel axis along the corridor, `want`
   from the section that mouth opens into (not `min` of the pair — a mouth
   belongs to the room it is a hole in).
3. Everything downstream is unchanged: `resolveDoorway` still rounds up to the
   vocabulary, still requires jambs, still refuses arc spans and secrets.

### Why this is not a repeat of v1

The self-amplification trap (§3) is about re-deriving what counts as a ROOM.
This does not: sections stay labelled once, and a mouth is defined by the
section labels, not by clearance. The mouths of a corridor are a fixed set the
moment the labels exist, so a second `planDoorways` on the carved floor must
return the same sites — pin that, it is the property that matters.

### Acceptance

- [ ] `doorways.test.ts`: a fixture with two rooms joined by a 10-tile 1-wide
      corridor authors TWO doorways, one at each mouth, and does NOT widen the
      corridor between them (assert the midpoint's cross-section is unchanged).
- [ ] Re-plan after carving authors no additional work (the §3 pin, extended to
      the new rule).
- [ ] `throat` rejections fall by ≥ 50% on the 78-floor census, and
      **`openShare` stays under 0.65** — if the corridor itself starts widening,
      this rule has become v1 and must be reverted, not tuned.
- [ ] narrow section connections (the A/B in §1) improve on 3.41; report the new
      number against a control built with the pass disabled, **same builder, same
      seeds**.
- [ ] `piece-rules`, `floor-metrics`, `floor-rules`, `track-launch` green; full
      suite green.
- [ ] verified with `__dungeonDoorways()` in the running game, not from the
      generator's own numbers.

### Do NOT start here

- **The count band.** §6 of the original plan wrote down 25–40 per floor from a
  rule that authored a door at every section pair whether or not a threshold
  existed there. The honest number for this pass is 9.9 and the gate asserts
  4–30 as an amplification guard. This change will raise it; **re-derive the
  band from measurement, do not port the old one.**
- **`arc` (76 declined).** The circuit's own fillets win over a doorway and that
  precedence is deliberate (`arc-contract.yields`). Whether the *scavenged*
  sweeps should also win is a real question, but it is a change to the arc
  layer's priority, not to doorways.
- **`jamb` (50).** These are one-tile partitions. They cannot hold a doorway,
  and the check that says so is what took drift from 17% to 1.3% (§5).
