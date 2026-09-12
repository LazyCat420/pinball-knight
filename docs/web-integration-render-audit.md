# Web branch integration and render audit — 2026-09-12

The integration starts at main `9e555363`, including the released Danny DeVito
Blaster Frank and Titan shark-mouth/spin art. All completed, committed web
branches were merged individually. Existing main artwork and the deployment
lock/release guard were preserved when older branches overlapped them.

Merged branches: `feat/armored-pixel-knight`, `fix/level5-boss-disappearance`,
`release/armored-pixel-knight`, `release/forged-knight-roll`,
`release/live-camera-zoom`, `release/tavern-controls`, `fix/maze-curve-junctions`,
`feat/selective-pixel-filter`, and `feat/items-specials-overhaul`.
The first two had no unique patches compared with main; their merges record
ancestry without replacing newer code. The release branches contributed handoff
documentation. The remaining batches add the reviewed curve joins, scenery
filter/UI texture resize fix, directional shortcuts, and item effects.

## Integration repairs

- Recheck passage clearance after invalid curves revert to square masonry.
  Without this, four fluid-flow cases retained narrow corridors. Restrict the
  late pass to one-tile bottlenecks, preserving already authored two-wide bends
  and corner pockets. It protects track lanes, sealed walls and surviving arc faces;
  the cleanup loop then rechecks remaining curve backing and joins.
- Preserve prefab anchor tiles during the furniture budget clamp. Newly added
  wall springs otherwise exhausted the budget and removed authored prefab parts.
- Recognize widened straight corridors by their bounded cross-section and
  longitudinal span in both placement grammar and socket extraction. Immediate
  neighbour counts alone mislabeled every three-wide interior as a junction.
  Horizontal/vertical fixtures cover actual width and clearance; a crossing
  remains a junction. Circuit connectivity gates retain their original thresholds.
- Update the scenery-setting keyboard test for the two current camera buttons.
- Retain all density limits. L14/19156 no longer needs trimming with the combined
  layout; the other regression seeds still require nonzero repairs.
- Refresh the 12 representative JSON/SVG floor fixtures and five full-author
  fingerprints after geometry review. These capture the intentional combined
  geometry/content changes, including wall springs and the magnet-core pickup.

Focused control/placement/flow checks: 69 passed. Geometry gates: 246 passed
across piece rules (including the 150-floor matrix), floor rules, floor metrics,
wall runs and wall junctions. The separately updated density regression passed
all six tests. Production Vite build passed. Final release suite is recorded in
the release handoff after completion.

## Sprite and frame-pacing observations

Windows Chrome, actual NVIDIA Ampere WebGPU backend, 1920×1080, seed 777.
Muted, isolated test profile; multiplayer WebSockets blocked. God mode keeps
combat active throughout measurement. Each sample lasts 15 seconds after
warmup. The crowd contains 12 each of zombie, goblin, spider, ghost, Titan and
Blaster Frank (72 living actors). Resize sequence: 1280×720, 1920×1080,
1440×900, 1920×1080.

| Sample | Main p50 / p95 / p99 ms | Integrated p50 / p95 / p99 ms |
|---|---|---|
| Ordinary floor | 6.10 / 12.95 / 24.22 | 6.50 / 14.35 / 19.04 |
| 72-monster crowd | 10.60 / 18.67 / 29.45 | 8.91 / 18.16 / 25.84 |
| Crowd after resize | 16.86 / 30.21 / 36.40 | 9.49 / 18.16 / 29.80 |

These are short local samples, not a guaranteed frame rate or an isolated
causal benchmark. Both runs retained active gameplay. No JavaScript exceptions,
WebGPU validation errors or device loss were observed. The integrated dev
server emitted one unrelated `/favicon.ico` 404.

The six crowd atlases range from 1,449×69 to 8,142×207 pixels, below the tested
GPU's 16,384 limit. Actor frames use individual UV buffers, nearest sampling and
no mipmaps. The largest new sheets correctly wrap across atlas rows. Captures
before/after resize showed intact Titan/Frank silhouettes and UI; the reported
intermittent sprite corruption was not reproduced. The merged UI fix addresses
an established CanvasTexture resize allocation bug, but this audit does not
claim that it explains every reported sprite glitch.

A heavier repeat with 29 of each kind (174 living actors) stayed active with
zero script/GPU errors. Crowd p50/p95/p99: 12.16/20.42/29.99 ms; after resize:
12.53/21.82/33.95 ms. There were 5 and 12 frames over 33.4 ms respectively.
This is acceptable local stress behavior, not a claim of locked 60 FPS. These
measurements preceded the final corridor-classifier repair; no renderer or
sprite code changed afterward.

## Work deliberately preserved

Four historical native-port branches remain outside this web release:
`feature/conversion-phase-b`, `feature/full-port`, `feature/gameplay-systems`,
`feature/parity-phase-a`. They change the Rust/native game, not this web build.

Uncommitted work in other developers' worktrees is not a completed branch
handoff and was not edited, stashed, reset or committed by this audit. In
particular, unfinished Frank-run, cyber-jungle, demon-basketball, sprite-forge,
and pancake changes remain with their owners. This release therefore merges
all completed web branch commits, not every uncommitted file on the computer.
