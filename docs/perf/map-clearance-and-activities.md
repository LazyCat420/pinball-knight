# Whole-map clearance and room activities

The doorway-mouth pass missed the reported diagonal aperture at tile (55,30)
on depth 6 / seed 1. A doorway-only scan and a reachability test cannot establish
passage width. The new detector scans every floor tile for opposing cardinal or
diagonal walls, requiring open space on both sides of the suspected aperture
so ordinary solid room corners are not mistaken for passages.

Repairs make a 3x3 turning pocket, shifting inward when the map rim or protected
stone prevents a centered pocket. A local work queue revisits affected tiles.
Before furniture, a redundant slit may instead be closed only if its surviving
neighbors still connect locally; protected routes stay open. Newly opened floor
and newly closed stone are never reversed by the same repair.

The finished author audits again after secret bands, decoration and wall art.
This stage only opens floor, so it cannot put a wall under content. It first
preserves curved backing, then permits local curve trimming/removal if that is
necessary to resolve a choke. Cleared tiles lose their stale collision metadata;
arc joins, backing and wall stubs are rechecked. Actual chute flanks and secret
bands stay protected. Existing strand-guarded chute access ports are widened
around their original footprint and recorded as access ports, rather than left
as one-tile emergency openings. Circular island ring clearance rises from 1.6
to 3 tiles, preventing the generator from authoring thin perimeter lanes.

`authorMaze().clearanceAudit` exposes widened-pocket counts and every remaining
gap. `maze:scale` now reports `narrowGaps` and fails for any remaining gap, as well
as unreachable floor or an unreachable exit. The seeded completion gate checks
15 finished floors across depths 1, 3, 6, 12 and 24; the exact reported corner has
its own non-vacuous detection-and-repair regression.

Large open rooms can receive solid 2x3 wall islands inside fully open 15x15
windows, preserving main lanes, boss arenas and doorway approaches. Smaller
9x9 open pockets also supply activity sites. The machine router now considers
these sites as well as route anchors, with bounded extra machine capacity;
existing fit, runway and exit rules still apply. This exposes the existing
library's banks, bumpers, rotating gates, ramp returns and other interactions
inside room space, instead of concentrating everything along the main route.

The final author can fit a compact chicane into an irregular open pocket. If the
part budget is full, it atomically replaces at most eight loose bumpers, boosters
or targets, preserving structured parts, vaults and existing patterns. Failure
leaves the original parts intact. Placement follows population repair and uses
the existing grammar, occupancy and launch-exit checks. This changes composition
rather than bypassing the density cap.

The PNG is a diagnostic of actual generated tiles and parts, not a screenshot of
the deployed game. Gold marks opened wall tiles in the upper comparison; the
lower view shows a generated wall island and nearby activities. Curved faces are
simplified to tile occupancy in this view. NAS deployment remains on hold.

Circuit selection prefers a ring that shares a real tile with an accepted
circuit before spending the remaining budget on a separate loop. Length order
is preserved within the shared/separate groups. This keeps room activities
connected to the pinball network; the existing interchange-rate and intact-link
gates remain unchanged.

Validation includes zero narrow gaps and zero unreachable floor at 6,693,
26,441, 105,105 and 419,105 tiles. The largest audited sample took 21.4 seconds
under concurrent test load. This is generation/clearance evidence, not an FPS
benchmark. The broader audit and activity search add generation work; no runtime
fluid simulation is introduced. The production build passed and compiler
diagnostics match the 65 existing baseline diagnostics with no additions.
