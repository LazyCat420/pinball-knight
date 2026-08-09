# Status board

The living broken / fixed / working record. **Update this page in the same PR
as the change it records.** Newest entries first within each section.

## Working

- **2026-08-09 — Playable vertical slice, native + wasm-WebGPU.** The knight
  walks the demo floor with the ported collision (wall-slide, border clamp),
  camera-follow at the 38°/45° ortho rig, Diablo-rule low walls, animated
  billboard from the real published sheets (embedded, ÷4 at load), facing
  swaps S/N/E with W mirrored. Verified end-to-end in **real Windows host
  Chrome over CDP** (screenshots + scripted key input). Run: `trunk serve`
  → `http://localhost:8787` in host Chrome, or `cargo run -p pk-game` (WSLg).
- **2026-08-09 — Collision port green.** `engine/{grid,collision}.ts` →
  `pk_core::{grid,collide}`: square-wall sweep-and-clamp, sub-stepping,
  surface reporting, wall contact — 8 legacy test cases ported and passing.
  Shaped tiles (slants/arcs/kick bands/lanes) are M2 with tile-shape.

- **2026-08-09 — Extraction complete.** 870 commits filtered from
  braindeadbot-client (paths `src/objects/dungeon-game` → `src/scenes/dungeon`
  → `src/game/pinball-knight`, plus tavern, forge surface, net/services/utils
  deps, scripts, docs) into `legacy/`, pushed as `main`. `git log --follow`
  reaches file births.
- **2026-08-09 — Legacy oracle green standalone.** `cd legacy && npm ci &&
  npm test`: 246 files / 2,649 tests passed (131 s, metered through
  `scripts/ops/pk-run.sh`).
- **2026-08-09 — Workspace scaffold.** pk-core / pk-assets / pk-audio /
  pk-game / xtask compile; `Mulberry32` ported and pinned bit-exact against the
  JS oracle (5 seeds × 5 draws); `pk-assets` parses all 19+ published sprite
  manifests.

## Broken / not started

- `cargo xtask bake` — stub. M0's real exit criterion (baked knight frame on
  screen) is open.
- `cargo xtask dist` — stub (wasm-bindgen/wasm-opt/brotli pipeline not built;
  trunk not yet installed on the box).
- The slice embeds the knight sheets in the binary and downsamples ÷4 at load
  — a stand-in for the per-rung bake, not the destination.
- `wayland` Bevy feature is off (WSL box lacks libwayland-dev); X11 via WSLg.
- Slice clip timing is guessed (8 fps walk / 4 fps idle); real timing ports
  with the animator in M2.
- CI (GitHub Actions) not set up: fmt/clippy/test + wasm build + size check +
  legacy vitest job all pending.
- Legacy `/forge` UI + `next dev` not yet smoke-tested from the new location
  (vitest suite is green; the dev-server path needs one manual run).

## Fixed

*(nothing yet — entries move here from Broken with the commit that fixed them)*

## Known environment facts (not bugs)

- The legacy suite must run from `legacy/` (paths resolve relative to it).
- Test/browser runs are metered — the box is shared. See
  [Dev environment](../reference/dev-env.md).
