# Plan: Fix Maze Depth Menu Scrolling in Tavern (`depth-select.ts`)

## Problem Statement

### Expected Behavior
When entering the "SELECT MAZE DEPTH" screen in the Tavern with 7 or more unlocked floors:
1. The floor list should be scrollable via:
   - **Mouse wheel** over the content area
   - **Keyboard arrow keys** / D-pad (scrolling to keep the focused row visible via `followFocus`)
   - **Mouse click / drag** on the scrollbar track or scrolling to selected floor
2. All unlocked floors (Floors 1 through 7+) should be reachable, visible, and selectable.
3. The visual scrollbar track and thumb should indicate position and allow scrolling down to the deepest unlocked floor.
4. When selecting a floor, focus and selection should stay in sync and allow descending directly.

### Actual Behavior
1. In the attached screenshot, Floors 1–5 are visible, Floor 6 is cut off at the bottom border, and Floor 7 is completely hidden below the footer buttons.
2. The user cannot scroll down using the mouse wheel, mouse drag, or arrow keys to view or select Floor 7.
3. The scroll offset remains frozen at `0` every frame.

### Reproduction Steps
1. In the Tavern or using `depthSelectScreen`, unlock depth 7 (`saveUnlockedDepth(7)`).
2. Open the Depth Select screen (`pushUiScreen(depthSelectScreen({ ... }))`).
3. Scroll down with the mouse wheel or press the Down arrow key repeatedly.
4. **Result**: The list remains locked at scroll offset 0. Lower floors cannot be scrolled into view.

---

## Root Cause Analysis (First Principles & Evidence)

We wrote and executed targeted tests in vitest (`depth-select.test.ts`) using the internal `beginUi` and `scrollProbe` harnesses. The root causes were confirmed:

### 1. Primary Bug: Transposed Arguments in `beginScroll`
- **Location**: `ThreeJS/src/game/pinball-knight/gui/screens/depth-select.ts:118`
- **Definition in `im.ts:924`**:
  ```ts
  export function beginScroll(
    f: UiFrame,
    r: Rect,
    contentH: number, // 3rd argument: total content height
    offset: number    // 4th argument: current scroll offset
  ): { inner: Rect; offset: number }
  ```
- **Failing call in `depth-select.ts`**:
  ```ts
  const sc = beginScroll(f, region, self.scroll, totalContentHeight);
  ```
- **Mechanism of Failure**:
  - `depth-select.ts` passed `self.scroll` (initially `0`) as `contentH`, and `totalContentHeight` (~`320`) as `offset`.
  - Inside `beginScroll`:
    ```ts
    const max = Math.max(0, contentH - r.h);
    let next = Math.max(0, Math.min(max, offset));
    ```
  - Because `contentH = 0`, `max = Math.max(0, 0 - 226) = 0`!
  - `next` was therefore clamped to `Math.min(0, ...)` = **`0` on every single frame**.
  - Any wheel delta or keyboard focus scroll offset was clamped back down to 0 immediately inside `beginScroll`, freezing `sc.offset` and preventing context translation `f.g.translate(0, -shift)`.

### 2. Secondary Bug: `self.focus` Clamping vs Syncing
- In `depth-select.ts:191`:
  ```ts
  self.focus = clampFocus(self.focus, f.count);
  ```
- Contrast with working screens (`haul.ts`, `tavern.ts`):
  ```ts
  self.focus = f.focus;
  ```
- When `f.focus` updates on hover or click, `self.focus` was not updated from `f.focus`, causing mouse-driven focus state to desynchronize.

### 3. Focus Ordering & Initial Cursor Position
- In `depth-select.ts`, the footer buttons (`[ FLOOR 1 ]`, `[ DESCEND ]`, `[ BACK ]`) are declared before the scrollable floor list.
- This causes widget indices 0, 1, and 2 to be the footer buttons.
- On screen open, focus starts on `[ FLOOR 1 ]` at the bottom instead of on the current/resume floor or Floor 1 row in the list.
- Re-ordering the button declarations to after the scroll region (matching `haul.ts` and `settings.ts`) puts the floor rows first in the tab/arrow navigation sequence and sets initial focus directly on the selected floor.

---

## Multiple Solution Approaches

### Approach A: Targeted Parameter Fix + Focus Sync + Tab Ordering (Recommended)
1. Swap arguments to `beginScroll(f, region, totalContentHeight, self.scroll)`.
2. Sync `self.focus = f.focus` and set initial focus to the pre-selected floor index.
3. Move footer button registrations after `endScroll` so keyboard navigation flows naturally from list items down to the action buttons.
4. Auto-scroll on screen open: initialize `self.scroll` to show `resumeFloor` if it is below the fold.

### Approach B: Minimal Parameter Swap Only
1. Only swap arguments in `beginScroll(f, region, totalContentHeight, self.scroll)`.
2. Keep footer buttons at the top of the registration queue.
*Trade-off*: Leaves focus order backwards (footer buttons are widgets 0, 1, 2) and does not pre-scroll to resume floor on launch.

---

## Proposed Changes

### Worktree: `.worktrees/wt-depth-select-scroll`
Branch: `fix/depth-select-scroll`

#### [MODIFY] `ThreeJS/src/game/pinball-knight/gui/screens/depth-select.ts`
- Fix `beginScroll` argument order: `beginScroll(f, region, totalContentHeight, self.scroll)`.
- Update `self.focus = f.focus`.
- Position footer buttons logically after `endScroll` or ensure tab order starts on list items.
- Ensure initial scroll brings the selected floor into view on open (`scrollToShow(region, selectedFloorRect, 0)`).
- Ensure scrollbar track has clean contrast and hover/click feedback.

#### [MODIFY] `ThreeJS/src/game/pinball-knight/gui/screens/depth-select.test.ts`
- Add regression tests verifying:
  - Mouse wheel scrolling down advances `screen.scroll` past 0.
  - Keyboard arrow navigation down to lower floors advances `screen.scroll`.
  - Floor 7+ is visible and selectable.
  - Initial selected floor auto-scrolls into view when opening the menu.

#### [MODIFY] `ThreeJS/src/game/pinball-knight/gui/screens/scroll-follow.test.ts`
- Add `depthSelectScreen` to the suite's `CASES` array so it is automatically protected by the global multi-screen scroll-follow regression tests.

---

## Verification Plan

### Automated Tests
1. Run targeted depth select tests:
   ```bash
   npx vitest run ThreeJS/src/game/pinball-knight/gui/screens/depth-select.test.ts
   ```
2. Run global scroll-follow regression tests:
   ```bash
   npx vitest run ThreeJS/src/game/pinball-knight/gui/screens/scroll-follow.test.ts
   ```
3. Run full test suite:
   ```bash
   npx vitest run
   ```

### Deploy to Synology NAS
1. Commit changes to `fix/depth-select-scroll`.
2. Merge to `main` and push to GitHub (`LazyCat420/pinball-knight`).
3. Run `npm run deploy` to redeploy the container.
