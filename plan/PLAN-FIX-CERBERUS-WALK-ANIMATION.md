# PLAN: Fix Cerberus Walk Animation Row (Three Heads Consistency)

## 1. Problem Diagnosis & Evidence

### Defect Identified in Current Sprite Sheet
In the medieval Castlevania sprite sheet take (`cerberus_castlevania_sheet_1788809759128.jpg`):
- **Row 1 (`walk` animation, frames 4..7)**:
  - Frame 0 (cell [0, 1]): Shows 3 heads angled toward the viewer.
  - Frames 1..3 (cells [1..3, 1]): The generator turned the creature into a harsh side-profile where only **2 heads** are visible, and the gait rhythm is disjointed compared to Row 0 (`idle`) and Row 2 (`attack`).
- **Rows 0, 2, and 3**:
  - Row 0 (`idle`): Excellent 3-headed gothic stance.
  - Row 2 (`attack`): Excellent signature jaw grab and thrash attack with all 3 heads and brimstone fire.
  - Row 3 (`death`): Excellent gothic dissolution.

---

## 2. Proposed Solution & Architecture

Rather than re-rolling the entire 4×4 sheet (which could alter or degrade the already approved idle, attack, and death rows), we will **surgically replace Row 1 (`walk`)**:

### Method: Targeted Walk Row Generation & Compositing
1. **Reference Image & Generation**:
   - Use `generate_image` ("Nano Banana") referencing the master sheet (`cerberus_castlevania_sheet_1788809759128.jpg`).
   - Prompt specifically for a 4-frame horizontal walk strip (1×4 or full sheet editing) with:
     - **3 distinct heads clearly visible on all 4 frames** (facing South / 3/4 South view matching Row 0).
     - Rhythmic 4-phase predatory quadruped walk cycle:
       - Frame 0: Left foreleg & right hindleg forward, heads low and menacing.
       - Frame 1: Paws planted, heads shifting rhythmically, center head snarling forward.
       - Frame 2: Right foreleg & left hindleg forward, body shifting weight.
       - Frame 3: Paws striking stone, heads stabilizing before loop back to frame 0.
     - Spiked iron collars and chains visible on all 3 necks throughout the walk.
     - Uniform flat `#FF00FF` magenta chroma background.
2. **Splicing & Compositing in `prep-cerberus.mjs`**:
   - In `prep-cerberus.mjs`, composite the newly generated 4-frame walk sequence directly into Row 1 (`y: 256..512`) of the master sheet.
   - Re-compute exact ink-tight bounding boxes per cell to maintain 0px ground spread across all rows.
   - Save the composited master to `sources/cerberus-2026-09-07/cerberus-S.png` and update `inbox/cerberus-S.png` + `inbox/cerberus-S.json`.
   - Archive the walk take in `alt-takes/` and document in `README.md`.

---

## 3. Verification Plan

| Layer | Assertion | Tool / Test |
| :--- | :--- | :--- |
| **Visual Check** | All 4 frames of Row 1 have 3 fully visible heads with smooth walking gait | Visual review of composited sheet |
| **Chroma & Drift** | 0px ground spread across rows, `#FF00FF` flood-filled cleanly | `prep-cerberus.mjs` & `drift.test.ts` |
| **Published Verification** | Sidecar hash matches PNG, all 16 frames load into playable paints | `npm run sprites` & `published.test.ts` |
| **Boss Mechanics** | Grab, thrash, button-spam struggle, and fling operate without regressions | `boss-cerberus.test.ts` |
| **Build & Deploy** | Clean Vite production build, deploy container to Synology NAS | `pnpm run build` & `npm run deploy` |

---

## 4. Open Follow-Up Questions

1. **Walking Stance Angle**: Should Cerberus walk straight forward facing directly at the camera (South view, matching the idle pose), or in a slight 3/4 downward angle so the body length is slightly visible while still keeping all 3 heads front-and-center?
2. **Head Movement During Walk**: Would you like the center head to stay focused straight ahead while the two side heads snarl/bob up and down with the stride, or should all three heads bob in unison?
