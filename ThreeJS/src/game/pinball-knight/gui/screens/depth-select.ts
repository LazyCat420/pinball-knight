/**
 * 🪜 DEPTH SELECT SCREEN
 *
 * Allows players to choose and replay any unlocked maze depth (Floor 1 through Best Depth).
 * Accessible from the Tavern Descend Board and the Game Over screen.
 */
import { UI, GRID, ROW_H } from "../theme";
import {
  beginScroll,
  button,
  clampFocus,
  cutTop,
  endScroll,
  fillRect,
  focusRing,
  focusable,
  followFocus,
  rect,
  scrim,
  sheet,
  strokeRect,
  text,
  type Rect,
  type UiFrame,
} from "../im";
import { pop, type UiScreen } from "../stack";
import {
  loadUnlockedDepth,
  depthMetadata,
  type DepthInfo,
} from "../../unlocked-depths";
import { loadResumeFloor } from "../../corpse-run";
import { loadBestDepth } from "../../best-depth";

export interface DepthSelectOptions {
  /** Called when a floor is confirmed. */
  onSelect: (floor: number) => void;
  /** Called when the player cancels and returns. */
  onCancel?: () => void;
  /** Pre-selected floor (defaults to resume floor or 1). */
  initialFloor?: number;
}

export function depthSelectScreen(opts: DepthSelectOptions): UiScreen {
  const maxUnlocked = loadUnlockedDepth();
  const resumeFloor = Math.min(maxUnlocked, Math.max(1, loadResumeFloor()));
  const bestDepth = loadBestDepth();

  let selected = opts.initialFloor
    ? Math.min(maxUnlocked, Math.max(1, opts.initialFloor))
    : resumeFloor;

  return {
    id: "depth-select",
    pauses: true,
    focus: 0,
    scroll: 0,
    design: { w: 580, h: 360, max: 2 },
    onCancel: () => {
      pop();
      opts.onCancel?.();
      return true;
    },
    paint(f, self) {
      scrim(f);
      const b = sheet(f, 580, 340);

      // ── Header Title ──
      const title = cutTop(b, 26);
      text(f, "SELECT MAZE DEPTH", title.x + title.w / 2, title.y + 4, {
        size: 16,
        colour: UI.gold,
        align: "center",
      });

      // ── Subheader info ──
      const info = cutTop(b, 22);
      text(
        f,
        `UNLOCKED: 1..${maxUnlocked}   RESUME: FLOOR ${resumeFloor}   RECORD: FLOOR ${bestDepth}`,
        info.x + info.w / 2,
        info.y + 2,
        { size: 8, colour: UI.textDim, align: "center" },
      );

      // ── Footer bar geometry ──
      const footerH = ROW_H + 8;
      const footerY = b.y + b.h - footerH;
      const btnW = Math.floor((b.w - 16) / 3);

      // Button 1: Start at Floor 1
      if (button(f, rect(b.x, footerY + 4, btnW, ROW_H), "FLOOR 1", { good: selected === 1 })) {
        pop();
        opts.onSelect(1);
        return;
      }

      // Button 2: Descend to selected floor
      const descendLabel = `DESCEND (F${selected})`;
      if (button(f, rect(b.x + btnW + 8, footerY + 4, btnW, ROW_H), descendLabel, { good: true })) {
        pop();
        opts.onSelect(selected);
        return;
      }

      // Button 3: Cancel
      if (button(f, rect(b.x + (btnW + 8) * 2, footerY + 4, btnW, ROW_H), "BACK", { danger: true })) {
        pop();
        opts.onCancel?.();
        return;
      }

      // ── Scrollable list of unlocked depths (fills space between header and footer) ──
      const scrollH = footerY - b.y - 6;
      const region = rect(b.x, b.y, b.w, scrollH);
      const rowHeight = 36;
      const totalContentHeight = maxUnlocked * (rowHeight + 4);
      const sc = beginScroll(f, region, self.scroll, totalContentHeight);
      self.scroll = sc.offset;

      let currentY = region.y;
      for (let floor = 1; floor <= maxUnlocked; floor++) {
        const meta = depthMetadata(floor);
        const r = rect(region.x + 4, currentY, region.w - 16, rowHeight);
        const isSelected = selected === floor;
        const isResume = floor === resumeFloor;

        const st = focusable(f, r);
        if (st.activated) {
          selected = floor;
        }

        // Row background and border
        let fillColour = isSelected ? UI.selectFace : UI.well;
        let strokeColour = isSelected ? UI.gold : isResume ? UI.arcane : UI.sheetEdge;
        if (meta.isBoss) {
          fillColour = isSelected ? UI.selectFace : "#2a1015";
          strokeColour = isSelected ? UI.danger : "#882030";
        }

        fillRect(f, r, fillColour);
        strokeRect(f, r, strokeColour, isSelected ? 2 : 1);
        if (st.focused) focusRing(f, r);

        // Floor number badge
        const badgeW = 60;
        const badgeRect = rect(r.x + 4, r.y + 4, badgeW, rowHeight - 8);
        fillRect(f, badgeRect, meta.isBoss ? "#55101a" : isResume ? "#10354a" : UI.well);
        text(
          f,
          `F${floor}`,
          badgeRect.x + badgeRect.w / 2,
          badgeRect.y + 8,
          { size: 8, colour: meta.isBoss ? UI.danger : UI.gold, align: "center" },
        );

        // Floor name & biome
        const textX = r.x + badgeW + 12;
        text(
          f,
          meta.name.toUpperCase(),
          textX,
          r.y + 6,
          { size: 8, colour: isSelected ? UI.heading : UI.text, max: r.w - 180 },
        );

        // Subtitle / Danger / Tags
        let tagText = `DANGER: ${meta.danger}`;
        if (isResume) tagText += " · [RESUME CHECKPOINT]";
        text(
          f,
          tagText,
          textX,
          r.y + 20,
          { size: 8, colour: meta.isBoss ? UI.danger : isResume ? UI.good : UI.textDim },
        );

        // Right-hand status indicator
        const statusX = r.x + r.w - 8;
        if (meta.isBoss) {
          text(f, "BOSS", statusX, r.y + 12, { size: 8, colour: UI.danger, align: "right" });
        } else if (isResume) {
          text(f, "RESUME", statusX, r.y + 12, { size: 8, colour: UI.good, align: "right" });
        }

        currentY += rowHeight + 4;
      }

      endScroll(f, region, totalContentHeight, sc.offset);
      self.scroll = followFocus(f, region, sc.offset);
      self.focus = clampFocus(self.focus, f.count);
    },
  };
}
