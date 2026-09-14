# Hallway approach clearance

The generator now evaluates a doorway's approach as a strip, rather than only
checking the opening tile. For each end it examines up to three cross-sections
at the authored doorway width. A short wall nose can be removed only if the
original centerline is open throughout and the full-width passage already
exists beyond it. Protected stone rejects the whole proposal. Candidates come
from one snapshot, so widening cannot create more widening candidates.

The pass runs before content placement. It respects sealed structures, special
wall tiles, shaped tiles and drawn arc spans. Existing stub cleanup removes
newly exposed tips; arc compaction rechecks backing. The doorway protection
halo keeps later diagonal backing out of the cleared approach.

Diagonal backing also checks all eight grid directions. Previously only four
cardinal rays rejected short gaps, allowing opposing diagonal corners to be
missed. This is a conservative raster check, not a proof of arbitrary-angle
collision clearance or a guarantee that every maze passage is three tiles wide.

This implements a bounded bottleneck-relief rule without a fluid simulation.
The existing generator already uses a chamfer clearance field and section
labels. Continuous flow simulation would add tuning and computation without
replacing the need for hard geometry constraints. Broader future widening can
use a ball-radius clearance field and route costs; it must preserve intentional
section boundaries and validate actual launch trajectories.

An 18-floor census (levels 1–6, seeds 1, 777 and 424242) initially cleared 14
nose tiles on four floors. The generated regression L6/1 verifies nonzero
removal and confirms cleared tiles remain open after the full author runs.
The small image compares that pass directly, before diagonal backing/content,
with cleared wall tiles in gold. It is a grid diagnostic, not a live-site image.

The pass costs one grid snapshot plus at most six doorway-width scans per
planned door. It uses no RNG and no fluid time steps.

Changed geometry also exposed a decoration-stage launch regression (track seed
4): a jump-relay's final booster lost its safe output during later wall shaping.
Decoration now revalidates patterns at the end and removes unsafe groups
atomically, repeating when removal invalidates another group's handoff. The
existing strict runway regression remains unchanged and passes.

Validation: production build passed; compiler diagnostics match the baseline
(60 existing, no additions). Scaling checks at 6,693 / 26,441 / 105,105 /
419,105 tiles reported zero unreachable tiles and reachable stairs. The largest
sample generated in 14.1 seconds under concurrent test load; this is generation
and connectivity evidence, not an FPS benchmark or exhaustive playability proof.
