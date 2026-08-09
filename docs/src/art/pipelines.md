# Art pipelines

Three authoring pipelines coexist, all staying in TypeScript in `legacy/`,
none replacing the others:

| Pipeline | Where | For |
|---|---|---|
| **Painters** | `legacy/src/game/pinball-knight/render/monsters/*.ts` | Procedural canvas code — the default artist for most of the roster. |
| **sprite-forge** | `legacy/src/game/pinball-knight/tools/sprite-forge/` | Whole PNG sheets: ComfyUI generation (Wan 2.2 I2V / Qwen-Image-Edit on the local box) → matte → slice → resample → register. For sanctioned imports (jester, rotortail, brute…). |
| **pixel-trace** | `.../tools/sprite-forge/pixel-trace/` | One-off icons: image or sketch → hand-editable JSON grid. |

The `/forge` React UI runs under the legacy Next dev server
(`legacy/forge-dev.sh`) for authoring sessions. The ComfyUI backend lives
outside the repo at `~/comfy/` (~45 GB of models) — the deployed site stays
inert without it by design.

**Decision (2026-08-09):** sprite-forge is *not* being rewritten in Rust. It is
offline tooling whose contract with the game is files on disk; the Rust game
consumes only the baked manifest format. The monster-art system itself is
"basic for now" — it gets rebuilt post-parity, and because the game consumes
only the manifest contract, a future Rust-native art tool slots in without
engine changes.
