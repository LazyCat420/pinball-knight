/**
 * PICKUP TICKER — the bottom-right corner rail that every "you just got a
 * thing" message lands in.
 *
 * Replaces two surfaces that fought the player for the screen:
 *  - card-popup.ts, which flashed a card face dead centre (left:50%, top:44%)
 *    for up to 1.9s on every pickup;
 *  - ui.showPickupNote's full-width banner across the bottom of the play area.
 *
 * Pinball Knight is played at up to 22 u/s while ricocheting off walls.
 * ANYTHING drawn in the middle of the screen is drawn over the one thing the
 * player is tracking. So the rule this module exists to enforce is simply:
 * pickup feedback lives in the corner, never pauses, never needs a dismiss, and
 * never grows without bound.
 *
 * The card FACES are not shown here — they are read as one screen at the end of
 * the floor (card-reader.showCardHaul). What lands here is a thumbnail, the
 * name in its rarity colour, and where the card went.
 *
 * Stacking: newest sits closest to the corner (column-reverse), the rail holds
 * at most MAX_ROWS, and an overflowing row evicts the OLDEST immediately rather
 * than queueing — during a horde clear you want the last four things you picked
 * up, not a four-second-stale backlog.
 */
import { paintCard, cardTier, CARD_W, CARD_H } from "./render/holo-card";
import { CARDS, RARITY_HEX, type CardId } from "./cards";
import { state } from "./state";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";

const STYLE_ID = "dungeon-pickup-toast-style";
const RAIL_ID = "dungeon-pickup-rail";

/** How many rows may be on the rail at once. */
const MAX_ROWS = 4;
/** Milliseconds a plain text row holds before it starts leaving. */
const HOLD_MS = 2200;
/** A card row holds a beat longer — it is the one worth glancing at. */
const CARD_HOLD_MS = 2900;
const OUT_MS = 260;

/**
 * The HUD is a full-width bar pinned to the bottom of the screen (~100px tall)
 * and the touch action buttons sit above it. The rail starts above both.
 */
const RAIL_BOTTOM = 118;

/** Live rows, oldest first. Kept so the cap can evict from the front. */
let rows: HTMLElement[] = [];
const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>[]>();

function injectStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    #${RAIL_ID}{position:fixed;right:10px;bottom:${RAIL_BOTTOM}px;z-index:10001;
      display:flex;flex-direction:column-reverse;align-items:flex-end;gap:5px;
      pointer-events:none;user-select:none;max-width:min(46vw,300px)}
    .pkt{display:flex;align-items:center;gap:8px;
      background:rgba(10,12,17,.82);border:1px solid #2b3140;border-left-width:3px;
      border-radius:5px;padding:5px 8px 5px 6px;
      box-shadow:0 4px 14px rgba(0,0,0,.55);
      transform:translateX(26px);opacity:0;
      transition:transform 200ms cubic-bezier(.18,.9,.28,1.2),opacity 200ms ease-out}
    .pkt.in{transform:translateX(0);opacity:1}
    .pkt.out{transform:translateX(26px);opacity:0;
      transition:transform ${OUT_MS}ms ease-in,opacity ${OUT_MS}ms ease-in}
    .pkt-face{display:block;width:38px;height:auto;border-radius:3px;flex:0 0 auto;
      box-shadow:0 2px 6px rgba(0,0,0,.6)}
    .pkt-text{display:flex;flex-direction:column;gap:2px;min-width:0}
    .pkt-title{font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      color:#ffd98a;text-shadow:1px 1px 0 #0b0d12;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pkt-sub{font:8px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      color:#9aa48c;text-shadow:1px 1px 0 #0b0d12;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    /* Rarity reads off the left edge alone — no glow, nothing animated. A rail
       that pulses in the corner is still something moving in your periphery. */
    .pkt-t0{border-left-color:#8d8f96}
    .pkt-t1{border-left-color:#4f8fdb}
    .pkt-t2{border-left-color:#a46fe8}
    .pkt-t3{border-left-color:#f0a63c}
    .pkt-t4{border-left-color:#ff77e9}
    @media (prefers-reduced-motion:reduce){
      .pkt,.pkt.in,.pkt.out{transition-duration:1ms}
    }
  `;
  document.head.appendChild(s);
}

function rail(): HTMLElement | null {
  if (typeof document === "undefined" || !state.container) return null;
  injectStyles();
  let el = document.getElementById(RAIL_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = RAIL_ID;
    state.container.appendChild(el);
  }
  return el;
}

function killRow(el: HTMLElement): void {
  for (const t of timers.get(el) ?? []) clearTimeout(t);
  timers.delete(el);
  el.remove();
  rows = rows.filter((r) => r !== el);
}

/** Drop every row on the floor immediately (game teardown). */
export function clearPickupToasts(): void {
  for (const el of [...rows]) killRow(el);
  if (typeof document !== "undefined") document.getElementById(RAIL_ID)?.remove();
}

function push(el: HTMLElement, holdMs: number): void {
  const r = rail();
  if (!r) return;
  r.appendChild(el);
  rows.push(el);
  // Newest wins: over the cap, the OLDEST row goes, not the incoming one.
  while (rows.length > MAX_ROWS) killRow(rows[0]);

  requestAnimationFrame(() => el.classList.add("in"));
  const ts: ReturnType<typeof setTimeout>[] = [];
  ts.push(
    setTimeout(() => {
      el.classList.remove("in");
      el.classList.add("out");
      ts.push(setTimeout(() => killRow(el), OUT_MS));
    }, holdMs),
  );
  timers.set(el, ts);
}

/**
 * A plain line of pickup/hint text in the corner. This is what
 * `ui.showPickupNote` funnels into.
 */
export function showPickupToast(text: string): void {
  if (typeof document === "undefined" || !state.container) return;
  ensurePixelFonts();
  const el = document.createElement("div");
  el.className = "pkt pkt-t0";
  const t = document.createElement("div");
  t.className = "pkt-text";
  const title = document.createElement("div");
  title.className = "pkt-title";
  title.textContent = text;
  title.title = text; // the full string is still reachable on hover when elided
  t.appendChild(title);
  el.appendChild(t);
  push(el, HOLD_MS);
}

/**
 * A card landed. Thumbnail + name in its rarity colour + where it went.
 *
 * Fire-and-forget, and pointedly small: the full painted face is the reward at
 * the end of the floor, not an interruption in the middle of one.
 */
export function showCardToast(id: CardId, note: string): void {
  if (typeof document === "undefined" || !state.container) return;
  const def = CARDS[id];
  if (!def) return;
  ensurePixelFonts();

  const tier = Math.max(0, Math.min(4, cardTier(id)));
  const el = document.createElement("div");
  el.className = `pkt pkt-t${tier}`;

  const canvas = document.createElement("canvas");
  // paintCard REQUIRES the backing store to be exactly CARD_W x CARD_H; CSS
  // scales it down to the 38px thumbnail.
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  canvas.className = "pkt-face";
  paintCard(canvas, id);
  el.appendChild(canvas);

  const t = document.createElement("div");
  t.className = "pkt-text";
  const title = document.createElement("div");
  title.className = "pkt-title";
  title.textContent = `${def.icon} ${def.label.toUpperCase()}`;
  title.style.color = RARITY_HEX[def.rarity];
  t.appendChild(title);
  const sub = document.createElement("div");
  sub.className = "pkt-sub";
  sub.textContent = note;
  sub.title = note;
  t.appendChild(sub);
  el.appendChild(t);

  push(el, CARD_HOLD_MS);
}
