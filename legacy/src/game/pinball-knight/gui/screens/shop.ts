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
    // See `UiScreen.design`. 800x450 is the design floor every sheet in this
    // game now targets, so on a desktop grid they all come out at 2x and at the
    // SAME zoom as each other — a menu at 1x beside a HUD at 2x reads as two
    // different games stapled together.
    design: { w: 800, h: 450 },
    onClose,
    paint(f, self) {
      scrim(f);
      const body = sheet(f, 520, Math.min(424, 140 + stock.length * 34));

      const head = cutTop(body, 30);
      text(f, "ROLLING CART", head.x, head.y, { size: 16, colour: UI.gold });
      const bal = getBalance();
      drawIcon(f.g, glyph("coin", 8, UI.gold), head.x + head.w - 70, head.y + 6, 8);
      text(f, `${bal}g`, head.x + head.w, head.y + 6, { size: 8, colour: UI.gold, align: "right" });

      heading(f, cutTop(body, ROW_H), "WARES — click, or press its number");

      for (const [i, s] of stock.entries()) {
        const afford = bal >= s.price;
        const r = cutTop(body, 30);
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
        cutTop(body, 3);
      }

      const foot = rect(body.x, body.y + body.h - ROW_H, body.w, ROW_H);
      text(f, "ESC / B — LEAVE THE CART", foot.x, foot.y + 8, { size: 8, colour: UI.textFaint });
      if (button(f, rect(foot.x + foot.w - 96, foot.y, 96, ROW_H), "LEAVE")) pop();
      self.focus = f.focus;
    },
  };
}
