/**
 * THE ROLLING CART — the merchant's shop, in the game.
 *
 * A list of wares bought by click, by pad, or by number key. The number keys
 * are worth keeping: the DOM version routed them from `core.handleKey` by
 * synthesising a CLICK on the matching row element
 * (`rows[n-1].click()`), which only worked because the rows happened to be
 * elements. Here the digit is read straight off the input snapshot, so the
 * shortcut is a first-class path rather than a simulated mouse.
 */
import { UI, GRID, ROW_H } from "../theme";
import { button, cutTop, fillRect, focusRing, focusable, heading, rect, scrim, sheet, strokeRect, text } from "../im";
import { drawIcon, glyph, itemIcon } from "../icons";
import { pop, type UiScreen } from "../stack";

/**
 * ── THE SHEET IS SIZED FROM THE STOCK, AND THE BOX FROM A ROW BUDGET ──
 *
 * It used to be `sheet(f, 440, Math.min(322, 120 + stock.length * 30))`, and
 * both numbers were wrong in a way that only showed up when a seventh ware was
 * added (✨ laser, 2026-07-29):
 *
 *   · a row costs 33, not 30 — `cutTop(body, 30)` plus the `cutTop(body, 3)`
 *     gap under it — so the estimate drifted 3px short per row, and
 *   · 322 was the tallest sheet a 338-tall design box can hold, so the seventh
 *     row did not make the sheet taller, it OVERPRINTED the footer. Shot on a
 *     real adapter: "Laser · become a beam" ran straight through "ESC / B —
 *     LEAVE THE CART" and its price was clipped by the LEAVE button.
 *
 * So the height is derived from the parts that actually consume it, and the
 * design box is derived from a stated row budget — `DESIGN_ROWS` — rather than
 * from a constant nobody can re-check. `shop-fit.test.ts` holds the real stock to
 * that budget AND holds the box under the 450 the zoom floor needs, because a
 * box past 450 does not clip anything: it silently drops the whole sheet to 1x
 * on a 900-line grid, which reads as "the shop is suddenly tiny".
 */
const WARE_ROW = 30;
const WARE_GAP = 3;
/** The title row, the WARES heading, and the footer. */
const SHOP_CHROME = 30 + ROW_H + ROW_H;
/** `sheet()` insets by GRID*2 on every side. */
const SHEET_PAD = GRID * 4;

/** How many wares the design box is authored to hold. See the note above. */
export const DESIGN_ROWS = 9;

/** The sheet height for `n` wares. */
export function shopSheetH(n: number): number {
  return SHOP_CHROME + n * (WARE_ROW + WARE_GAP) + SHEET_PAD;
}

/** The authored box: the tallest sheet, plus the margin `sheet()` needs around it. */
export const DESIGN = { w: 600, h: shopSheetH(DESIGN_ROWS) + GRID * 2, max: 2 } as const;

export interface ShopEntry {
  id: string;
  label: string;
  icon: string;
  price: number;
  detail: string;
}

export function shopScreen(
  stock: readonly ShopEntry[],
  getBalance: () => number,
  onBuy: (i: number) => void,
  onClose: () => void,
): UiScreen {
  return {
    id: "shop",
    pauses: true,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`, and the sizing note at the top of this file: the
    // box is DERIVED from the row budget so that every sheet in the game still
    // lands on the same 2x a desktop grid gives — a menu at 1x beside a HUD at
    // 2x reads as two different games stapled together.
    design: DESIGN,
    onClose,
    paint(f, self) {
      scrim(f);
      const body = sheet(f, 440, shopSheetH(stock.length));

      const head = cutTop(body, 30);
      text(f, "ROLLING CART", head.x, head.y, { size: 16, colour: UI.gold });
      const bal = getBalance();
      drawIcon(f.g, glyph("coin", 8, UI.gold), head.x + head.w - 70, head.y + 6, 8);
      text(f, `${bal}g`, head.x + head.w, head.y + 6, { size: 8, colour: UI.gold, align: "right" });

      heading(f, cutTop(body, ROW_H), "WARES — click, or press its number");

      for (const [i, s] of stock.entries()) {
        const afford = bal >= s.price;
        const r = cutTop(body, WARE_ROW);
        const st = focusable(f, r, { disabled: !afford });
        fillRect(f, r, afford ? UI.well : UI.sheet);
        strokeRect(f, r, afford ? UI.wellEdge : UI.sheet);

        text(f, String(i + 1), r.x + 6, r.y + 10, { size: 8, colour: UI.textFaint });
        drawIcon(f.g, itemIcon(s.id), r.x + 20, r.y + 3, 24);
        text(f, s.label, r.x + 50, r.y + 5, { size: 8, colour: afford ? UI.text : UI.textFaint, max: r.w - 160 });
        text(f, s.detail, r.x + 50, r.y + 18, { size: 8, colour: UI.textDim, max: r.w - 160 });
        text(f, `${s.price}g`, r.x + r.w - 8, r.y + 10, {
          size: 8,
          colour: afford ? UI.heading : UI.danger,
          align: "right",
        });
        if (st.focused) focusRing(f, r);

        // Number key OR activation. The digit is checked against this row's
        // index rather than dispatched to an element, so an unaffordable row
        // simply does not fire — the DOM version relied on the click listener
        // not having been attached, which is the same result by accident.
        if (st.activated || (afford && f.input.digit === i + 1)) onBuy(i);
        cutTop(body, WARE_GAP);
      }

      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      text(f, "ESC / B — LEAVE THE CART", foot.x, foot.y + 8, { size: 8, colour: UI.textFaint });
      if (button(f, rect(foot.x + foot.w - 96, foot.y, 96, ROW_H), "LEAVE")) pop();
      self.focus = f.focus;
    },
  };
}
