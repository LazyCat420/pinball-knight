# Legacy tree map

`legacy/` mirrors the braindeadbot-client layout it was cut from, so every
intra-tree relative path still resolves. The interesting roots:

| Path | Lines | What |
|---|---|---|
| `legacy/src/game/pinball-knight/` | 104k src + 40k test | The game. Subsystems: `maze/` (19.7k, floor gen), `render/` (15.2k, painters + atlas), `entities/` (11.3k, combat/AI), `engine/` (8.7k, collision/camera/input/sim loop), `gui/` (7.4k), `fx/` (3.8k), `sfx/` (1.1k, all-synth), `constants/`, `spawn/`, `run/`, `boot/`, `economy/`, `dev/` (debug harnesses). |
| `legacy/src/game/pinball-knight/tools/sprite-forge/` | ~25k | The art pipeline (see Art chapter). `sources/` = 66 MB of tracked original generations — art provenance, kept deliberately. |
| `legacy/src/scenes/tavern/` | 15.8k | The between-runs hub — built from ~40 PK imports; ports in M5. |
| `legacy/src/{utils,net,services,pixel,render}/` | small | The cross-boundary deps PK imports (wallet, rng, audio manager, multiplayer protocol, leaderboard client, pixel fonts, backend policy). |
| `legacy/app/` + `legacy/components/` | ~7k | The Next.js `/forge` UI and API routes. `app/page.tsx` is a minimal shell mounting the dungeon directly (the site router stayed behind). |
| `legacy/scripts/` | ~8k mjs | Playtest bot, audit/census probes, CPU broker (`ops/pk-run.sh`), hooks (`registry-drift.mjs` — retired on the Rust side by exhaustive enums). |
| `legacy/documentation/chapters/` + `legacy/docs/` + `legacy/HANDOFF.md` | — | The TS era's measured history: sprite pipeline chapter, WebGPU plans, lag investigations, incident logs. |
| `legacy/src/game/pinball-knight/*.md` | 7.5k | 22 design docs; `BLUEPRINT.md` is the architecture reference the port follows. |

Design decisions the port must respect are indexed in
[Architecture decisions](../game/architecture.md); the TS-era design docs
remain the deeper source.
