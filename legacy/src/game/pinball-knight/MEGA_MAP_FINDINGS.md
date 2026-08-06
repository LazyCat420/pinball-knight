# MEGA MAP — what the generator actually repeats

Built 2026-08-05 to answer one complaint: *"it's just random walls being jumbled
together"*. The tool is `npm run megamap` (`scripts/mega-map.mjs`); this document
is its first run's findings and the work they justify.

    node scripts/mega-map.mjs --scale 3 --png            # a 10x floor, rendered + censused
    node scripts/mega-map.mjs --scale 1 --png --px 10    # the SHIPPED floor, same instrument
    node scripts/mega-map.mjs --scale 1 --px 26 --crop 24,8,44,30 --png   # look closely

Three modules, all pure and node-runnable like the rest of the maze layer:

| file | what it is |
| --- | --- |
| `dev/mega-floor.ts` | the shipped chain with the grid-size cap lifted |
| `dev/floor-svg.ts` | the render — walls tinted by shape, arcs as real arcs, parts by function |
| `dev/pattern-census.ts` | nine sections of distribution, ending in a SCALE CHECK |

## Read this before quoting any number below

**The instrument is pinned to the shipped chain.** `dev/mega-floor.test.ts`
asserts that at `scale 1, density raw` the mega builder produces a floor
*byte-identical* to `buildHeadlessPlan` — same tiles, same shapes, same parts,
same facings, across 5 archetypes × 3 seeds. That is the strongest form of the
guard `dev/headless-floor.ts` earned the hard way (a drifted harness once agreed
with the shipped chain on **0 of 15** floors).

**Every report ends in a SCALE CHECK** comparing the mega floor against a
shipped-size floor of the same level and seed. A defect that only appears at 10x
is a property of the magnifying glass. All the findings below are read off the
**shipped** column unless stated otherwise.

**One number in this document was wrong before it was checked.** The first
curve-dead-end measurement said 86%. The probe started its tangent ray *on* the
wall surface, so it rounded into stone on step one and condemned every curve for
a reason about the probe. Corrected (start a ball-radius clear, `CLEARANCE`), the
answer is 79.5% — still the headline defect, but the first figure was inflated.
This is `piece-rules.ts`'s own scar, repeated; it is why `CLEARANCE` carries a
warning comment.

---

## Finding 1 — the machine library is DEAD CODE

`maze/assembly-lib.ts` defines eight authored pinball mechanisms (orbit,
slingshot pair, drop-target bank, …) with ports, roles and relative facings.
`maze/assembly-place.ts` is the router written to place them, complete with a
`PlaceReport`. Both are fully unit-tested.

**`placeAssemblies` is called from no non-test file.** The census confirms the
consequence: **0.0% of parts on any floor belong to a machine**, at every scale.

    in a MACHINE 0.0%   in a CIRCUIT 10.1%   chain 0.5%   spine 12.3%   LOOSE 57.1%

This is the single largest item for "invent more lego pieces". The lego system
already exists, is tested, and is not plugged in. Adding a ninth machine before
placing the first eight would add nothing to a floor.

## Finding 2 — the curve vocabulary is THREE SHAPES, all 90°

Bucketing every arc by radius and sweep, a shipped floor's 67 arcs are:

    r2.0 × 90°  ×50      r3.0 × 90°  ×14      r5.0 × 90°  ×2      r2.5 × 360° ×1 (the orbit island)

`arc-sweeps.ts` states the cause in its own header and does not hide it:
`FILLET_RADII = [3, 2]`, and *"a rail's length is one quarter-turn"*. Everything
else is rotation, and rotation is not variety — which is why the census folds it
out. The render is unambiguous: every blue crescent in
`debug/mega-map/*-crop24_8.png` is the same piece.

That header also names the fix and says it is not a tuning change: **"longer
banks need a different AUTHORING primitive — an arc placed along a corridor run
rather than filleted into a corner."**

## Finding 3 — 79.5% of curve ends bank you into nothing

    ends that FEED something within 12 tiles: 27/132 (20.5%)
      ↳ DEAD ENDS: 105

"Feeds" is generous on purpose: a part, a doorway, the stairs, *or* simply a
clear run. Four fifths of curve ends reach none of those. This is the user's rule
— *"if there's a curve it should feed into something instead of being a dead
end"* — measured for the first time.

Related, same cause: **74.6% of arcs are PLAIN STONE**, carrying neither a
booster lane nor kicker rubber. The two dressings that make a curve *do*
something are capped per floor at 16 and 6 and are consumed in raster scan
order, so on a shipped floor the rubber lands measurably north (mean j/h **0.276**
against an arc baseline of **0.431**, over 80 floors).

## Finding 4 — the floor is not corridors, it is a plain with rocks in it

The render is the evidence and no summary statistic said it. "56.9% open" reads
as a normal maze; the picture is an open field with amoeba-shaped stone islands
scattered through it.

    16 separate masses   largest holds 43.8% of all stone   debris (≤4 tiles) 3

Each mass is built from 2×2 chunks with single-block steps and speckled with
chamfered corner tiles — that gravel texture *is* the "jumbled walls" being
complained about. It is not a rule violation anywhere in the current gates.

Consequence for furniture: bumpers land in the middle of the plain. Only a small
share are formally "floating" (1.7% have no stone within 3 tiles), but the
dominant furniture motif is a bumper with nothing near it at all:

    21.8%  bumper (alone)          10.6%  bumper + bumper,bumper
    bumper is 41.6% of ALL parts

## Finding 5 — 60.1% of wall separators are 3+ tiles thick

    separator thickness   1:4.9%  2:39.2%  3:21.6%  4:12.9%  5:7.5%  6:6.4%  7:4.4%  8+:3.1%

This is the user's other rule — *"once there is a wall it doesn't need another
wall on the other side"* — as a distribution. Three in five gaps between two
corridors carry three or more tiles of stone where one or two would separate
them. 39.7% of all wall tiles are interior: masonry no player ever sees.

## Finding 6 — the combo vocabulary is small, and it is mostly one combo

    49 chains, longest 7 parts   distinct triples 20   top-20 cover 100%
      17.6%  boostcorner → boostcorner → booster
      14.7%  booster → booster → booster

Twenty distinct three-part combos exist on a 10x floor, and two of them are a
third of all of them. Orphan launchers (a shove that lands on nothing) are
**30.8%** of launchers on a shipped floor.

---

## What the tool says the work is, in order

1. **Call `placeAssemblies`.** The library is written, routed and tested. This is
   plumbing, not design, and it moves "0.0% in a machine" first.
2. **A second curve primitive** — the along-a-corridor bank `arc-sweeps.ts` asks
   for by name. Three shapes is the vocabulary; this is the only way to widen it.
3. **A feed rule for curves**, gated the way `piece-rules.ts` gates pieces: a
   curve end must reach a part, a doorway or a runway. `curveCensus` already
   computes the predicate; it is a census today and could be a gate.
4. **A separator-thickness rule**, once someone decides what the right thickness
   *is*. The census reports the distribution; it does not claim 3 is wrong.

Anything that scales curve dressing (lanes, rubber) off AREA rather than a flat
per-floor cap also removes the north-bias in Finding 3 for free.

## Known limits of the instrument

- **Arc density collapses with grid size** — 17.6 arcs/1k walkable at shipped,
  0.15 at scale 3, because arc supply comes from wall-mass corners and a bigger
  floor is proportionally more open (56.9% → 68.6%). The SCALE CHECK flags this
  with a ⚠. **Do not read curve findings off a mega floor**; read them off the
  shipped column. Every curve number in this document is shipped-column.
- Orphan-launcher share also moves with scale (30.8% shipped → 55.9% at 10x) and
  is flagged the same way.
- Only `ringkeep` at L5 was examined closely. `--level` reaches the other four
  archetypes and nobody has looked yet.
