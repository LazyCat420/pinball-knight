# Overview

Pinball Knight is being ported from TypeScript/Three.js (WebGPU) to **Rust +
Bevy** so it can scale as it grows and run on smaller hardware. Targets:
**Windows native** (`x86_64-pc-windows-gnullvm` — the day-to-day play/dev
build AND the eventual Steam artifact; `scripts/pk-win.sh run` launches the
.exe straight onto the Windows desktop via WSL2 interop), and
braindeadbot.com (wasm, WebGPU-only — also the parity-gate harness, since
`pk-check.mjs` verifies the sim through host Chrome).

This book is the project's own documentation — separate from braindeadbot's
`documentation/`. It tracks **what's broken, what's fixed, what's working**
(see [Status board](status/board.md)) alongside the architecture decisions.

## Where things came from

The whole game — 104k lines of non-test TS, 40k lines of tests, and the
sprite-forge art pipeline — was extracted from `braindeadbot-client` with full
git history (`git filter-repo` across three historical paths:
`src/objects/dungeon-game` → `src/scenes/dungeon` → `src/game/pinball-knight`)
into `legacy/`. The extraction preserved 870 commits; `git log --follow` on any
legacy file reaches its birth.

`legacy/` is not dead code:

- **It is the oracle.** Its 2,649 vitest tests stay green until the Rust port
  reaches parity; ported subsystems are verified against fixtures exported
  from it (same seed → same maze, same inputs → same positions, bit-equal).
- **It is the art toolchain.** sprite-forge (generation via local ComfyUI,
  matte→slice→crush) and the procedural painters keep running in TS forever;
  the Rust game only consumes their baked output (see
  [Bake pipeline](art/bake.md)).

The TS game keeps serving braindeadbot.com unchanged for the entire port.
Nothing was deleted from braindeadbot-client.

## The three commandments

1. **Determinism** — pk-core is f64 + `libm`, seeded PRNG only. If a fixture
   fails, fix the port, never the pin.
2. **WebGPU-only on the web** — no WebGL2 fallback, carried from the TS game's
   explicit policy.
3. **Parity before improvement** — no intentional behavior changes before M7.
   The monster-art system rebuild, in particular, is post-parity work.
