# Tracked Issues & Backlog

Per external review checklist (`[github_mcp_direct]`), the following items have been triaged and recorded for tracking:

---

### Issue 1: Sprite-Forge Camera Angle Policy Formalization
- **Status**: **Resolved & Pinned**
- **Details**: `build-plan.ts:CAMERA_BY_DIR` and `comfy/modes.mjs` pin camera angle per facing (`E` is true side-view, `S` is front-facing, `N` is back-facing). Unit tests in `camera-sync.test.ts` prevent desynchronization.
- **Reference**: `tools/sprite-forge/docs/ANY_IMAGE_TO_CHARACTER.md` (Row 6.1).

---

### Issue 2: Qwen Lightning 8-Step Mode Integration
- **Status**: **Resolved**
- **Details**: `comfy/modes.mjs` implements `QWEN_FAST` with `optionId: "qwen-lightning-8step"` at steps=8, cfg=1.0 when `ctx.fast` is set.
- **Reference**: `tools/sprite-forge/comfy/modes.mjs:33-53`.

---

### Issue 3: Playfield Obstacle & Prop Depth Occlusion Audit
- **Status**: **Tracked**
- **Details**: When enemies die behind tall pillars or near perimeter wall ledges in isometric view, crop bounding boxes can sample adjacent tile geometry. While animation steps correctly on GPU and in engine, visual audits should continue to refine z-sorting on decorative props.

---

### Issue 4: Co-op Multi-Floor Replication Bounds
- **Status**: **Tracked**
- **Details**: `coop/pool.ts` isolates players by `dungeon:<floor>` room keys. Continue monitoring multi-client room sync during live co-op playtests.
