# Port checklist — every subsystem, by phase

The complete inventory of what must move from `legacy/` (TypeScript/Three.js)
to Rust/WebGPU, sized from measured line counts. **A box is checked only when
the item is ported AND verified** — verification method listed per phase.
What the user sees missing today (intro, tavern, ESC menu, backtick debug
panel) is listed here as unported scope, not bugs.

Status legend: `[x]` ported+verified · `[~]` partial · `[ ]` not started.

## P0 — Port infrastructure (the checker) — ACTIVE

The harness that gates every later phase. Nothing ships unverified.

- [x] Fixture pattern: legacy vitest exports golden JSON → Rust replays
      bit-equal (`legacy/.../port-fixtures.test.ts` → `assets/fixtures/` →
      `pk-core` integration test). First fixture: 600-tick movement trace
      through the demo floor.
- [x] `window.__pk` debug surface in the wasm build (tick/pos/facing/moving —
      the seed of the `__lab()` equivalent).
- [x] `scripts/pk-check.mjs`: drives the wasm build in **real host Chrome**
      (CDP): console-error gate, sim-tick advance gate, scripted-input
      movement gate, FPS measurement, screenshots to `.checks/`.
- [x] Windows-native build (`x86_64-pc-windows-gnullvm` + llvm-mingw,
      `scripts/pk-win.sh`) — the play/dev target. Verified: exe launched on
      the Windows desktop via interop, demo floor rendering (screenshot).
- [ ] CI: fmt/clippy/`cargo test` + legacy vitest + wasm build + pk-check +
      wasm-size budget + windows-gnullvm build.
- [ ] Perf baseline page in docs: record FPS/frame-time from pk-check per
      commit (the benchmarking log).

## P1 — Pinball physics: full collision vocabulary (~4k src + tests)

The game's identity. The slice has square walls only.

- [x] `engine/tile-shape.ts`: slants, rounds, ARC features,
      `resolve_circle_shape`, `resolve_arc_feature`, kick bands, lane bands +
      `lane_tangent`. Verified: ported test suite + shaped-trace fixture.
- [x] `engine/collision.ts` shaped paths: `resolve_shaped` corrective pass,
      `resolve_shape_or_arc`, `LaneHit` identity, `compute_arc_corners`.
      Verified: ported lane/slant/corner tests + bit-exact shaped trace.
- [x] `engine/surfaces.ts`: tables + materials + mixes ported; identity rule
      and one-draw pick pinned. (Physics CONSUMPTION lands with the player
      pinball port below.)
- [ ] `entities/pinball-collide.ts`, `marble.ts`, `ricochet-*`, `rail.ts`,
      `multiball.ts`: momentum modes, reflections, rail rides, kicker launches.
- [ ] Player verbs on top: sprint charge, wall-kick (`wallContact` consumer),
      pounce (`entities/player.ts`, 916+ lines root `abilities.ts`).
- Verify: port `collision.test.ts` remaining cases, `tile-shape.test.ts`,
  `arc-sweeps` moveCircle cases, `booster-corner-sim.test.ts`; new trace
  fixtures at pinball speeds (sub-stepping exercised); pk-check drive test.

## P2 — Maze generation (19.7k src, 7.3k tests)

- [ ] `maze/generator.ts` + `build.ts` (growing-tree, braiding, thicken).
- [ ] `maze/archetypes.ts`, `assembly*.ts`, `prefabs.ts` (+ biome tables).
- [ ] Track systems: `track-carve`, `track-grow`, `track-launch`,
      `arc-sweeps`, `arc-lanes`, `conic-fit` (authors the P1 arc features).
- [ ] `doorways`, `flow-loops`, `circuit`, `relay-chambers`, `lamp-puzzle`.
- [ ] `decorate.ts`, `surface-paint.ts` (paints P1 surfaces).
- [ ] `floor-rules/metrics/density/seed`.
- Verify: fixture route — legacy exports full-floor JSON (tiles/shapes/
  surfaces/arcs/spawns) across the vitest seed corpus; Rust generates
  byte-identical. PRNG call-order parity is the tripwire. Plus ported
  property tests (connectivity, reachability).

## P3 — Rendering proper (15.2k render/ + engine/render)

- [ ] Per-rung atlas bake (`cargo xtask bake` real implementation) —
      replaces the embedded ÷4 sheets.
- [ ] `engine/render/animator.ts`: real clip timing/looping (slice guesses
      8/4 fps), tell-clips.
- [ ] Silhouette pass (GreaterDepth "Diablo trick").
- [ ] `engine/render/pixel-pass.ts`: the pixelation post pass (TSL → WGSL).
- [ ] Room dressing: wall/floor materials & textures, `boot/lighting.ts`,
      `boot/biomes.ts` looks, torch/window glass looks (or slice-level
      approximations first).
- [ ] `render/pinball-parts.ts`, `arc-kickers/lanes` visuals,
      `part-instancer.ts` → instanced meshes.
- [ ] `render/palette*.ts` palette-swap shader (armor styles, zombie tints).
- [ ] Damage text (`engine/render/damage-text.ts` + pixel fonts).
- Verify: pk-check screenshot A/B against the TS game at matched
  camera/seed; per-frame FPS budget.

## P4 — Entities & combat (11.3k src, 6.2k tests + root files)

- [ ] Nine `Record<EnemyKind,X>` registries → enums + `EnumMap` (bestiary,
      factory, reagents, combat, enemy-rules, stagger, card-styles, portraits,
      state).
- [ ] `entities/movement.ts`, `ai`, `engine/flow-field.ts` pathfinding.
- [ ] `entities/combat.ts`, `projectiles`, `hazards`, `stagger`,
      `wall-erosion`, `floor-fx`, `combo-curve`.
- [ ] Per-kind behaviors (`zombie.ts`, monsters incl. croaker knee-wall hop).
- [ ] `boss.ts` (772), `spawn/{factory,tide,reaper,floor-populate}`.
- [ ] Root gameplay: `state.ts` (1556) fully mirrored, `cards.ts`,
      `abilities.ts`, `skills.ts`, `items.ts`, `secrets.ts` (cracked walls),
      `economy/` (coins, loot, pickups, ground-items).
- Verify: ported entity/spawn vitest suites; combat trace fixtures; pk-check
  scripted fight on a fixed seed.

## P5 — GUI, menus, intro, game flow (7.4k gui + 1.1k intro + run/)

The items reported missing today live here.

- [ ] `Painter2d` immediate-mode layer (rect/atlas-sprite/pixel-font text/
      nine-patch/scissor → 2–3 draw calls).
- [ ] Pixel fonts (`src/pixel/pixel-font.ts` + `map-render` text).
- [ ] **ESC game menu** (`gui/screens/menu.ts`), settings + `settings-save`.
- [ ] **Backtick debug panel** (`gui/screens/debug.ts`, `debug-panel.ts`) +
      `__lab`-equivalent console API (grow `window.__pk`).
- [ ] **Intro/title** (`intro/title-grid.ts`, `clock.ts`, intro-chrome).
- [ ] HUD: `hud-face.ts` (1330), meters, minimap (`map-render.ts`),
      floor-map overlay, toasts, pickup-toast.
- [ ] Screens: shop, character-select, haul, game-over, floor-loading.
- [ ] Run flow: `run/{descend,death,ledger,grade,lobby,floor-hold,
      grave-hole}`, corpse-run, best-depth.
- [ ] Saves (`SaveStore`: native file / wasm localStorage).
- Verify: pk-check flow scripts (open menu, navigate, die, descend) +
  screenshot A/B; ported run/ledger tests.

## P6 — Tavern (15.8k)

The between-runs hub — reported not rendering today because it is unported.

- [ ] `legacy/src/scenes/tavern/**` scene: walkable isometric room, NPCs,
      tavern-shop, hand-off (`enterTavern`/descend/death/lobby wiring).
- Verify: pk-check flow (die → tavern → descend); screenshot A/B.

## P7 — FX & audio (3.8k fx + 1.1k sfx)

- [ ] `fx/` pools/elements TSL → WGSL storage-buffer particles (fire, frost,
      water, molten, goo, rod, noise; puffs, heat haze, decals).
- [ ] Juice (`engine/juice.ts` screenshake etc.).
- [ ] `pk-audio` backends (web-audio-api native / web-sys wasm) + all `sfx/`
      patches (ambience/combat/monsters/weapons/pinball/world/run), bus,
      gate, mute; gesture unlock on wasm.
- Verify: by ear vs TS + offline render spectral diff on a few stings;
  visual A/B for FX.

## P8 — Parity sweep, perf, deploy

- [ ] Port remaining vitest logic suites wholesale; kill remaining gaps.
- [ ] Playtest-bot equivalent driving the Rust build (soak, stuck detection).
- [ ] Multiplayer protocol (net/) — post-parity decision point.
- [ ] Leaderboard client (`/api/scores`, localStorage fallback).
- [ ] wasm release pipeline (`xtask dist`: wasm-opt + brotli), size budget.
- [ ] Docker static container → Synology → Cloudflare; link from
      braindeadbot.com.
- Verify: soak green, size/FPS budgets met, deployed URL loads over WebGPU.

## P9 — Post-parity

Steam (`steamworks`, cargo-xwin), monster-art-system rebuild, forge-lite,
co-op multiplayer.

---

## Ported so far (verified)

| Item | Where | Verified by |
|---|---|---|
| Mulberry32 RNG | `pk-core/src/rng.rs` | bit-exact vs JS oracle, 5 seeds |
| Tile grid | `pk-core/src/grid.rs` | ported cases |
| Square-wall collision (sweep, sub-step, surfaces, wall contact) | `pk-core/src/collide.rs` | 8 ported legacy cases + movement-trace fixture |
| Player movement @60 Hz, facing | `pk-core/src/state.rs` | tests + trace fixture + pk-check drive |
| Published-manifest schema | `pk-assets` | parses all 19+ legacy manifests |
| 38°/45° ortho camera, follow | `pk-game` | host-Chrome screenshots |
| Diablo-rule wall heights | `pk-game` | host-Chrome screenshots |
| Knight billboard, S/N/E + mirrored W | `pk-game` | host-Chrome screenshots |
| wasm/WebGPU build (trunk) | `Trunk.toml`, `web/` | pk-check in host Chrome |
