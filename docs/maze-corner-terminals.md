# Maze corner orientation and straight terminals

The corner pass now uses the visible wall boundary to decide whether a piece
fits. Each ordinary curved or beveled corner must connect to a permanent,
full-square wall face at both ends. The exposed side of each face must be floor.
A nearby wall tile, a breakable block, or another shaped piece is insufficient.

## Reproduced defects

The old single-tile corner pass treated inward room corners and outward wall
corners as interchangeable. `ROUND_*` describes a **solid quarter-disc**, centered
opposite its open quadrant. Putting that disc in the diagonal masonry behind an
inward room corner buries its two visible endpoints in other wall blocks. The
orientation label pointed toward the room, but the actual shape could not meet
the room's wall faces. The previous test asserted that label and backing alone.

The arc validator also explicitly accepted direct curve-to-curve connections,
and did not validate tile-local corners after later generation passes changed
their surroundings. Nine new regression cases failed on the original code:
four inward-corner placements, four corners losing their backing, and a direct
curve chain.

## Geometry contract

- Convex round/bevel orientation comes from the two adjacent open sides and
  their diagonal. Both endpoints must reach exposed straight square masonry.
- Bevels share the corresponding round's terminal positions. Their intentional
  45-degree transition does not require the bevel tangent to equal a straight
  wall's tangent.
- Inward room corners remain square unless the existing multi-tile arc author
  can fit a proper concave (`solidOut`) arc between straight faces.
- Candidate collection precedes assignment, and candidates cannot use each
  other as backing. Existing arc terminals stay reserved for straight walls.
- The final validator checks small corners as well as larger arcs, including
  after secret-band pruning. Rejected shapes return to existing square masonry;
  validation does not carve or fill floor tiles.
- Ordinary arcs cannot join other arcs, rounds or bevels directly. Closed
  islands have no terminals. Authored conic doorway jaws retain their separate
  assembly contract; their segments are one fitted doorway, not maze corners.

Renderer and collision still read the same shape descriptors. There is no
independent mesh rotation or visual patch concealing different collision.

## Generated-floor comparison

These are complete floors from the shared live author, comparing committed
baseline `37af0bbc` with the corrected rules. “Invalid corners” means a tile-local
corner lacks the required open quadrant or either exposed straight terminal.

| Floor / seed | Invalid corners before → after | Retained corner pieces | Larger arcs before → after | Changed floor/wall tile values |
| --- | ---: | ---: | ---: | ---: |
| 1 / 1 | 31 → 0 | 16 | 14 → 14 | 0 |
| 5 / 777 | 43 → 0 | 23 | 17 → 17 | 0 |
| 24 / 1 | 80 → 0 | 191 | 18 → 18 | 0 |

Removing the invalid inward candidates also frees some legitimate convex
corners previously rejected because a neighboring tile was a candidate. The
change therefore selects correctly fitting pieces rather than merely reducing
their count.

The maze suite passed its geometric, connectivity, passage-width, wall-run and
population checks, including the 150-floor raw piece gate and decorated-floor
checks. Twelve census snapshots and five full-author fingerprints were updated
only after those checks passed. The census changes are corner shape counts,
combined tile/shape hashes, and wall-run measurements; the floor layout and
authored content in those snapshots are unchanged.

The measured comparison is geometry validation, not a claim of a GPU gameplay
inspection or a frame-rate measurement.
