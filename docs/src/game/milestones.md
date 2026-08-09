# Milestones & sizing

Vertical-slice ordering — every milestone leaves something playable. 1u ≈ a
focused week; total ≈ 30–40u. The TS game stays live on braindeadbot.com
throughout.

| # | Milestone | Size | Exit criterion |
|---|---|---|---|
| M0 | Skeleton + oracle rig | 1.5u | `cargo xtask bake && cargo run` shows a baked knight frame, native **and** wasm-in-host-Chrome. CI: fmt/clippy/test + wasm build + size check; legacy vitest green in CI. |
| M1 | One room rendered right | 4u | Static room comparable to a TS screenshot: 38° camera, Diablo wall heights, billboard clip animation, **silhouette pass**, rung selection. Front-loads all custom-render risk. |
| M2 | Knight moves | 4u | Wall-slide, rail rides, kicker launches feel identical; first golden **trace** fixtures replay bit-equal (f64 + libm — if not bit-equal, find out now, not at M6). |
| M3 | Maze gen | 5u | Same seed → byte-identical floor vs TS across the vitest seed corpus; floors load into the M1 renderer. |
| M4 | Combat + entities | 7u | A full floor fightable start-to-stairs. Order: registries → spawn → melee → AI/flow-field → bosses → cards/economy. |
| M5 | GUI + game flow | 5u | Complete run loop keyboard-to-credits: Painter2d, HUD, map overlay, menus, saves. **Tavern lands here.** |
| M6 | FX + audio | 4u | Sounds and sparkles like the original (ear + offline spectral diff; TSL→WGSL particle families). |
| M7 | Parity sweep + deploy | 4u | Remaining vitest logic suites ported; playtest-bot rebuilt against the Rust build; deployed behind Cloudflare; parity declared, legacy demoted from oracle to reference. |
| M8+ | Post-parity | — | Steam (`steamworks`, cargo-xwin), multiplayer (sim-as-pure-function already paid for it), monster-art-system rebuild, forge-lite previewer. |

**Oracle discipline:** every ported subsystem lands in the same PR as its
fixtures (exact) or ported tests (behavioral). No intentional behavior changes
before M7.
