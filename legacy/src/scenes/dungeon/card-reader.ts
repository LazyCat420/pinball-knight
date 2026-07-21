/**
 * CARD READER — the modal that opens when a card worth reading is picked up.
 *
 * The old flow (card-popup.ts, which still handles repeats) flashed the face
 * over LIVE combat for ~1s: unreadable, and it covered the fight. This modal
 * takes the opposite trade — while it is up the whole sim is FROZEN (its handle
 * on `state.cardReaderEl` is part of core's `isSimPaused()` gate), the card is
 * shown big with its description, and the player continues with Space/Enter.
 *
 * Design decisions, deliberate:
 *  - NOT every pickup opens it. `shouldOpenReader` sends the first copy of a
 *    card this run and every epic+ pull here; the 4th Blood Edge of the night
 *    goes back to the fire-and-forget popup. The reader's job is teaching and
 *    savoring; interrupting combat for a known common teaches nothing.
 *  - Rapid pickups QUEUE (the popup replaces). Time is frozen in here, so
 *    every queued card gets its beat; a "×N MORE" chip shows the backlog.
 *  - Dismissal calls `input.clearTransient()`: the window keydown listener has
 *    already queued the dismissing Space as a dodge, and without the drain the
 *    knight rolls the instant the world unfreezes.
 *  - Keys are routed by core's handleKey (the branch above the map key), not a
 *    listener here — one keyboard owner, same as the shop.
 */
import { paintCard, cardTier, CARD_W, CARD_H } from "./render/holo-card";
import { CARDS, RARITY_HEX, type CardId } from "./cards";
import { state } from "./state";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";
import { showCardPickup } from "./card-popup";

const STYLE_ID = "dungeon-cardreader-style";

/** Cards waiting behind the one on screen, each with its "where it went" line. */
let queue: Array<{ id: CardId; note: string }> = [];

/**
 * Should this pickup interrupt (full reader) or just flourish (popup)?
 * Pure — unit-tested. First copy of any card this run reads; epic and above
 * ALWAYS read (a legendary landing mid-horde is exactly the moment to savor).
 */
export function shouldOpenReader(id: CardId, seen: ReadonlySet<string>): boolean {
  return cardTier(id) >= 2 || !seen.has(id);
}

/**
 * The single entry point the pickup path calls: applies the policy, marks the
 * card seen, and routes to the reader or the old non-blocking popup.
 */
export function presentCardPickup(id: CardId, note: string): void {
  const open = shouldOpenReader(id, state.seenCards);
  state.seenCards.add(id);
  if (open) showCardReader(id, note);
  else showCardPickup(id);
}

function injectStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .cardrd{position:fixed;inset:0;z-index:10003;display:flex;align-items:center;justify-content:center;
      background:rgba(6,8,12,.62);backdrop-filter:blur(2px);opacity:0;transition:opacity 180ms ease-out}
    .cardrd.in{opacity:1}
    .cardrd-col{display:flex;flex-direction:column;align-items:center;gap:10px;max-width:min(92vw,420px)}
    .cardrd-frame{position:relative;border-radius:12px;padding:3px;
      transform:scale(.86) translateY(14px);transition:transform 220ms cubic-bezier(.18,.9,.28,1.2)}
    .cardrd.in .cardrd-frame{transform:scale(1) translateY(0)}
    .cardrd-face{display:block;width:min(46vw,258px);max-height:56vh;height:auto;border-radius:10px;
      box-shadow:0 14px 40px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.6)}
    .cardrd-t1 .cardrd-face{box-shadow:0 14px 40px rgba(0,0,0,.8),0 0 18px rgba(79,143,219,.5)}
    .cardrd-t2 .cardrd-face{box-shadow:0 14px 40px rgba(0,0,0,.8),0 0 26px rgba(164,111,232,.6)}
    .cardrd-t3 .cardrd-face{box-shadow:0 14px 44px rgba(0,0,0,.85),0 0 34px rgba(240,166,60,.75)}
    .cardrd-t4 .cardrd-face{box-shadow:0 16px 50px rgba(0,0,0,.9),0 0 44px rgba(255,119,233,.85)}
    .cardrd-t4 .cardrd-frame{background:conic-gradient(from 0deg,#ff5edb,#7cf9ff,#f5f36e,#ff8a5e,#ff5edb);
      animation:cardrd-rainbow 3.2s linear infinite}
    @keyframes cardrd-rainbow{to{filter:hue-rotate(360deg)}}
    .cardrd-name{font:14px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:2px;
      text-shadow:1px 1px 0 #0b0d12,0 0 10px rgba(0,0,0,.9)}
    .cardrd-rarity{font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:3px;opacity:.85}
    .cardrd-desc{color:#e8e2d2;font:11px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      line-height:1.7;text-align:center;text-shadow:1px 1px 0 #0b0d12}
    .cardrd-note{color:#9aa48c;font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px}
    .cardrd-foot{margin-top:6px;display:flex;align-items:center;gap:10px;
      color:#cfd6e4;font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:2px;
      animation:cardrd-pulse 1.6s ease-in-out infinite}
    @keyframes cardrd-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    .cardrd-more{background:#20242e;border:1px solid #3a4152;border-radius:4px;padding:3px 7px;color:#f0c85a}
    @media (prefers-reduced-motion:reduce){
      .cardrd,.cardrd-frame{transition-duration:1ms}
      .cardrd-t4 .cardrd-frame,.cardrd-foot{animation:none}
    }
  `;
  document.head.appendChild(s);
}

/** Fill the open overlay with one card's face + text. */
function paintCurrent(el: HTMLDivElement, id: CardId, note: string): void {
  const def = CARDS[id];
  const tier = Math.max(0, Math.min(4, cardTier(id)));
  el.innerHTML = "";

  const col = document.createElement("div");
  col.className = "cardrd-col";

  const frame = document.createElement("div");
  frame.className = "cardrd-frame";
  el.className = `cardrd in cardrd-t${tier}`;
  const canvas = document.createElement("canvas");
  // paintCard REQUIRES the backing store to be exactly CARD_W×CARD_H.
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  canvas.className = "cardrd-face";
  paintCard(canvas, id);
  frame.appendChild(canvas);
  col.appendChild(frame);

  const name = document.createElement("div");
  name.className = "cardrd-name";
  name.textContent = def.label.toUpperCase();
  name.style.color = RARITY_HEX[def.rarity];
  col.appendChild(name);

  const rarity = document.createElement("div");
  rarity.className = "cardrd-rarity";
  rarity.textContent = `— ${def.rarity.toUpperCase()} —`;
  rarity.style.color = RARITY_HEX[def.rarity];
  col.appendChild(rarity);

  const desc = document.createElement("div");
  desc.className = "cardrd-desc";
  desc.textContent = `${def.icon} ${def.description}`;
  col.appendChild(desc);

  const where = document.createElement("div");
  where.className = "cardrd-note";
  where.textContent = note;
  col.appendChild(where);

  const foot = document.createElement("div");
  foot.className = "cardrd-foot";
  foot.textContent = "SPACE / ENTER — CONTINUE";
  if (queue.length > 0) {
    const more = document.createElement("span");
    more.className = "cardrd-more";
    more.textContent = `×${queue.length} MORE`;
    foot.appendChild(more);
  }
  col.appendChild(foot);
  el.appendChild(col);
}

/**
 * Open the reader on `id` (or queue it if one is already up). The sim freezes
 * for as long as `state.cardReaderEl` is set — core's pause gate does the rest.
 */
export function showCardReader(id: CardId, note: string): void {
  if (typeof document === "undefined" || !state.container) return;
  if (!CARDS[id]) return;
  if (state.cardReaderEl) {
    queue.push({ id, note });
    // Refresh the ×N chip on the visible card without disturbing its face.
    const foot = state.cardReaderEl.querySelector(".cardrd-foot");
    if (foot) {
      const more = foot.querySelector(".cardrd-more") ?? foot.appendChild(document.createElement("span"));
      more.className = "cardrd-more";
      more.textContent = `×${queue.length} MORE`;
    }
    return;
  }

  ensurePixelFonts();
  injectStyles();

  const el = document.createElement("div");
  el.className = "cardrd";
  // A dismiss-click must not leak into the attack surface below and queue a swing.
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    advanceCardReader();
  });
  state.container.appendChild(el);
  state.cardReaderEl = el;
  paintCurrent(el, id, note);
  // Double-rAF so the entry transition actually animates instead of snapping.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
}

/** Space/Enter/click: show the next queued card, or close and unfreeze. */
export function advanceCardReader(): void {
  const el = state.cardReaderEl;
  if (!el) return;
  const next = queue.shift();
  if (next) {
    paintCurrent(el, next.id, next.note);
    return;
  }
  el.remove();
  state.cardReaderEl = null;
  // Drain the queued dismiss tap so it doesn't fire a dodge on resume.
  state.input?.clearTransient();
}

/** Hard teardown (level exit / death while open). */
export function dismissCardReader(): void {
  queue = [];
  state.cardReaderEl?.remove();
  state.cardReaderEl = null;
}
