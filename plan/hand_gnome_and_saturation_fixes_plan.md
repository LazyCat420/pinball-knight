# Plan: Fix Crawling Hand Transparency, Gnome Hat Cutoff, and Monster Saturation

**Date**: 2026-09-07  
**Target Projects**: `pinball-knight`  
**Status**: BRAINSTORMING & PLAN ONLY (Awaiting User Review & Approval — DO NOT IMPLEMENT)

---

## 1. Executive Summary & Root Cause Evidence

### Issue 1: Crawling Hand Monster Rendering See-Through
- **Observed Behavior**: The `crawling_hand` monster appears hollow, transparent, or with see-through holes in the palm and fingers during gameplay.
- **Root Cause (Verified Fact)**:
  - In `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-crawling-hand.mjs` line 52:
    ```javascript
    const isMagenta = (r > 160 && b > 160 && g < 110) || (r > 130 && b > 130 && (r + b) > g * 2.1);
    ```
  - The second clause `(r > 130 && b > 130 && (r + b) > g * 2.1)` does **not** check `g < 110`.
  - The master source take `crawling_hand_sheet_1788760396424.jpg` has a clean magenta background with `RGB=(253, 0, 251)` (`G ~ 0`).
  - The hand's fleshy skin tones have `R ~ 210..236`, `G ~ 160..202`, and `B ~ 160..190`. For many flesh pixels, `(r + b) > g * 2.1` evaluates to `true` (e.g. at pixel `(100, 110)`: `R=236, G=202, B=190` -> `426 > 424.2`).
  - As a result, flesh pixels inside the hand were rewritten to pure magenta (`#FF00FF`), and sprite-forge's `matte` keyed them out to `alpha = 0`.
  - Inspection of `public/sprites/crawling_hand-S.png` confirmed Swiss-cheese holes throughout the palm and fingers.

---

### Issue 2: Gnome Monster Hat Cut Off
- **Observed Behavior**: The Lawnmower Gnome's red cone hat appears with a flat, truncated top rather than a pointed gnome hat.
- **Root Cause (Verified Fact)**:
  - In `ThreeJS/src/game/pinball-knight/tools/sprite-forge/prep/prep-gnome.mjs`:
    ```javascript
    const isOuterBorder = px < 8 || px >= w - 8 || py < 8 || py >= h - 8;
    const isGridLine = (px % 256 <= 2 || px % 256 >= 253 || py % 256 <= 2 || py % 256 >= 253) && (r < 80 && g < 80 && b < 80);
    ```
  - In `gnome_lawnmower_master.jpg`, the gnome figure is 253 pixels tall inside a 256-pixel cell.
  - In row 0 (idle), the hat tip sits at `minY = 4..5`. `isOuterBorder` (`py < 8`) wiped lines 0–7 to magenta, cutting off 4 rows of the hat.
  - In row 1 (walk), the hat tip sits at `minY = 2..3` from the cell top. `isGridLine` (`py % 256 <= 2`) wiped the top 3 rows.
  - Furthermore, in the raw AI image, the cone hat was already clipped flat at 5 pixels wide due to lack of vertical margin/headroom.

---

### Issue 3: Monsters Coloring Oversaturated
- **Observed Behavior**: Several monsters appear blindingly neon and oversaturated in the game environment compared to the gothic dungeon palette.
- **Root Cause (Verified Fact)**:
  - **Measurement**: We measured the average saturation across all imported sheets:
    - Standard dungeon monsters: `ghost` = 0.375 avgSat, `bat` = 0.450 avgSat.
    - Extreme novelty outliers: `fries-S.png` = **0.759 avgSat** (31.0% pixels > 0.85 sat), `burger-S.png` = **0.727 avgSat** (24.8% pixels > 0.85 sat), `toucan-S.png` = **0.652 avgSat** (41.8% pixels > 0.85 sat), `crawling_hand-S.png` = **0.544 avgSat**.
  - **Post-Processing Amplification**:
    - In `ThreeJS/src/game/pinball-knight/constants/render.ts` line 510:
      ```typescript
      export const CEL_SATURATION = 1.15;
      ```
    - The post-processing cel shader amplifies all scene colors by 1.15× (+15%), which pushes high-saturation sprites into neon blinding territory.

---

## 2. Proposed Architectural & Visual Changes

### Part A: Fix Crawling Hand Transparency
1. **Refactor Background Keying in `prep-crawling-hand.mjs`**:
   - Replace the flawed heuristic with strict magenta keying:
     ```javascript
     const isMagenta = (r > 210 && b > 210 && g < 50);
     ```
   - Implement flood-fill background removal from the outer border: only pixels topologically connected to the canvas border are cleared. Interior flesh pixels are 100% protected.
2. **Re-run Sprite Pipeline**:
   - Re-run `node src/game/pinball-knight/tools/sprite-forge/prep/prep-crawling-hand.mjs`.
   - Run `npm run sprites` to bake solid `crawling_hand-S.png` and `crawling_hand-S.json`.
   - Mirror to `dist/pinball-knight-windows-x86_64/assets/sprites/crawling_hand-S.*`.

---

### Part B: Fix Gnome Monster Hat Cutoff
1. **Provide Headroom in `prep-gnome.mjs`**:
   - Rescale each cell slightly (e.g. 0.94×) or shift the gnome downward by 6–8 pixels within each 256×256 cell so the hat has adequate clearance from the top border.
   - Remove the aggressive `py < 8` top crop that truncates the hat.
2. **Taper Hat Tip**:
   - Add a procedural cone taper pass in `prep-gnome.mjs` to complete the hat's natural conical apex to a sharp point (using the gnome's cap red tones `#c42020` / `#981818` with highlight `#e03030`), eliminating the flat horizontal cutoff.
3. **Re-run Sprite Pipeline**:
   - Re-run `node src/game/pinball-knight/tools/sprite-forge/prep/prep-gnome.mjs`.
   - Run `npm run sprites` to generate updated `gnome-S.png` and `gnome-S.json`.
   - Mirror to `dist/pinball-knight-windows-x86_64/assets/sprites/gnome-S.*`.

---

### Part C: Balance Monster Saturation

We propose two complementary adjustments:

#### Option 1 (Recommended): Two-Tier Saturation Balance
1. **Tier 1 — Global Cel Grade Harmony**:
   - Adjust `CEL_SATURATION` in `constants/render.ts` from `1.15` down to `1.02` (or `1.00`).
   - This keeps the entire dungeon looking rich and cohesive without blowing out the highlights.
2. **Tier 2 — Asset-Level Desaturation for Extreme Outliers**:
   - For outlier novelty monsters whose raw saturation exceeds 0.70 (`fries`, `burger`, `toucan`), add a mild desaturation pass (~15–20% saturation reduction) in their prep scripts.
   - This prevents neon McDonalds red/yellow from looking like glowing radioactive signs in a dark gothic dungeon.

#### Option 2: Asset-Only Desaturation
- Keep `CEL_SATURATION = 1.15` unchanged.
- Only reduce saturation by ~25% directly on the specific novelty monsters (`fries`, `burger`, `toucan`, `milkshake`) in their prep scripts.

#### Option 3: Global-Only Adjustment
- Leave sprite sheets untouched and solely reduce `CEL_SATURATION` in `constants/render.ts` to `0.95`–`1.00`.

---

## 3. User Review Required & Open Questions

1. **Saturation Strategy**:
   - Do you want to go with **Option 1 (Two-Tier)**: adjust the global `CEL_SATURATION` down to 1.02, AND tone down the most extreme novelty sprites (`fries`, `burger`, `toucan`) by ~18%? Or do you prefer Option 2 (asset-only) or Option 3 (global-only)?
2. **Gnome Hat Tip**:
   - For the gnome's pointy hat, do you prefer a sharp upright cone point, or a slightly curved/flopped tip?
3. **Specific Monster Priorities**:
   - Aside from `fries`, `burger`, `toucan`, and `milkshake`, are there any other specific monsters whose coloring looked oversaturated to you?
