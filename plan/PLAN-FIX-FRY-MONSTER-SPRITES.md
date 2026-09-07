# Plan: Fix Fry Sentinel Monster Sprite Transparency & Re-render Sprite Sheet

## 1. Problem Diagnosis & Root Cause
- **Issue**: The Fry Sentinel monster appears semi-transparent / see-through in-game.
- **Root Cause**: The original sprite sheet was generated on a bright pink / magenta chroma background (`#FF00FF`). The fry monster's body is a bright red fast-food fry carton. During chroma-keying in `prep-fries.mjs`:
  ```javascript
  const isMagenta = (r > 160 && b > 160 && g < 110) || (r > 130 && b > 130 && (r + b) > g * 2.1);
  ```
  And during sprite-forge palette quantisation/indexing, reddish-magenta fringe pixels, anti-aliased edges, and shadowed carton red tones were classified as background chroma. This carved holes in the red carton body, making the monster see-through.

---

## 2. Proposed Solution & Architecture

### Phase A: Re-render Sprite Sheet on Pure Chroma Green (`#00FF00`)
1. **Background**: Uniform, flat chroma green (`#00FF00`, RGB `0, 255, 0`) edge-to-edge.
   - Red carton (high R, low G, low B) and golden fries (high R, mid G, low B) have maximum color distance from pure green.
   - Chroma bleed risk is completely eliminated.
2. **Art Style**: 16-bit SNES pixel art, crisp outlines, side/isometric camera angle (facing South).
3. **Character Design**:
   - Sentient red cardboard fry carton.
   - Crispy golden crinkle-cut french fries protruding from the top.
   - Two crinkle-cut french fries as legs, two as arms.
   - Single glowing mystic eye amulet / medallion necklace hanging on the front of the red box.
4. **Grid Layout**: 4 columns × 4 rows (1024×1024 total, 256×256 per cell):
   - **Row 0 (Idle)**: 4 frames — slight bobbing, eyes blinking, fries twitching.
   - **Row 1 (Walk)**: 4 frames — crinkle-cut legs waddling forward with cartoon weight.
   - **Row 2 (Attack)**: 4 frames — carton squats, fries rocket upward out of the head as projectiles.
   - **Row 3 (Death)**: 4 frames — carton crumples/folds flat to the floor with fries spilling outward.

---

### Phase B: Sprite-Forge Prep Script Overhaul (`prep-fries.mjs`)
1. Update `prep-fries.mjs` in `.worktrees/wt-fix-fry-monster/ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-fries.mjs`:
   - Replace magenta chroma detection with strict green chroma detection (`g > 160 && r < 120 && b < 120` or Euclidean RGB distance).
   - Ensure the red carton pixels (`r > 120 && r > g * 1.3`) are strictly protected from transparency.
   - Output cleaned 1024×1024 sheet with solid green or clean transparent PNG into:
     - `sources/fries-2026-09-06/fries-S.png`
     - `inbox/fries-S.png`
   - Archive original take and new take into `sources/fries-2026-09-06/alt-takes/`.
   - Update bounding box computation in `prep-fries.mjs` to accurately bound all 16 cells.

---

### Phase C: Sprite-Forge Compilation & Verification
1. Run sprite forge:
   `npm run sprites` (`FORGE_PUBLISH=1 vitest run src/game/pinball-knight/tools/sprite-forge`).
2. Verify generated files:
   - `public/sprites/fries-S.png`
   - `public/sprites/fries-S.json`
3. Inspect alpha channel across the red carton body to confirm 100% opacity (`alpha === 255`).

---

### Phase D: Automated Unit Testing
1. Run fry monster unit tests:
   `npx vitest run src/game/pinball-knight/entities/fries.test.ts`
2. Run sprite published suite:
   `npx vitest run src/game/pinball-knight/tools/sprite-forge/published.test.ts`
3. Run lazy sheets and bestiary suite:
   `npx vitest run src/game/pinball-knight/boot/lazy-sheets.test.ts src/game/pinball-knight/bestiary.test.ts`

---

### Phase E: Git Integration & NAS Deployment
1. Commit all changes on worktree branch `fix/fry-monster-sprites`.
2. Merge into `main` and push to GitHub `origin/main`.
3. Build and deploy container to Synology NAS:
   `docker build -t pinball-knight-web:latest ...` and `bash deploy.sh --deploy-only`.
4. Validate container health on `http://10.0.0.16:8789`.
5. Proactively notify the user with web and native executable test paths.
