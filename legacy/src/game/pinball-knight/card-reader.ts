/**
 * THE FLOOR HAUL — where cards are actually READ.
 *
 * HISTORY, because the shape here is a correction of two earlier ones:
 *  1. card-popup.ts flashed a card face dead centre for ~1s on every pickup.
 *     Unreadable, and it sat on top of the ball.
 *  2. This module then made the notable pulls open a MODAL that froze the sim
 *     until you pressed Space. Readable — and a hard stop in the middle of a
 *     bounce chain, several times a floor. You cannot ask a player who is
 *     ricocheting at 22 u/s to stop and read; the interruption was the bug.
 *
 * So nothing interrupts any more. A pickup files the card into `state.floorHaul`
 * and flashes a corner toast (pickup-toast.ts). When the floor is cleared and
 * the knight takes the stairs, the whole haul is laid out as ONE screen on the
 * way to the tavern — one dismissal for the floor instead of one per card, and
 * the faces are big enough to actually read because nothing is happening
 * behind them.
 *
 * The sim-pause contract is unchanged and still hangs off `state.cardReaderEl`
 * (core's `isSimPaused`), which is correct here for the first time: the floor
 * IS over, so there is nothing left to interrupt. Keys are routed by core's
 * handleKey, not a listener here — one keyboard owner, same as the shop.
 */
import { paintCard, cardTier, CARD_W, CARD_H } from "./render/holo-card";
import { RARITY_HEX, cardBase, cardDef, isShinyCard, type CardId } from "./cards";
import { state, type HaulEntry } from "./state";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";
import { showCardToast } from "./pickup-toast";

export type { HaulEntry };

const STYLE_ID = "dungeon-cardreader-style";

/** Run when the haul screen is dismissed. Held here so core's key handler can
 * close the screen without knowing what comes next (the tavern). */
let onHaulDone: (() => void) | null = null;

/**
 * Is this pull one to call out — the first copy this run, or epic and above?
 * Pure, unit-tested. It no longer decides whether to INTERRUPT (nothing does);
 * it drives the NEW flag on the haul screen, so the pull worth looking at is
 * the one that is marked.
 */
export function isNotablePull(id: CardId, seen: ReadonlySet<string>): boolean {
  // Seen-ness is per CARD KIND, not per copy: a level-7 Spider Silk is not a
  // discovery just for being level 7. A SHINY always flags — it genuinely is
  // the first one you have seen.
  return cardTier(id) >= 2 || isShinyCard(id) || !seen.has(cardBase(id));
}

/** One row of the haul screen: a card and every copy of it found this floor. */
export interface HaulStack {
  id: CardId;
  count: number;
  /** Any copy in this stack was the run's first of that card kind. */
  fresh: boolean;
  /** Where the copies went, de-duplicated ("SOCKETED INTO ⚔ SWORD", "STASHED…"). */
  notes: string[];
}

/**
 * Fold a floor's haul into one row per DISTINCT card.
 *
 * Grouped by the full instance id, NOT the base: a level-3 Spider Silk and a
 * level-1 Spider Silk are genuinely different cards and merging them would
 * misreport what you are carrying. Three level-3s are one stack of ×3.
 *
 * Ordered BEST PULL FIRST (rarity → shine → level → count) rather than by
 * pickup order. The thing worth looking at leads the screen instead of sitting
 * at position nine behind eight commons.
 *
 * Pure, so the grouping is unit-tested without a DOM.
 */
export function stackHaul(entries: readonly HaulEntry[]): HaulStack[] {
  const by = new Map<CardId, HaulStack>();
  for (const e of entries) {
    if (!cardDef(e.id)) continue;
    const s = by.get(e.id);
    if (s) {
      s.count++;
      s.fresh = s.fresh || !!e.fresh;
      if (e.note && !s.notes.includes(e.note)) s.notes.push(e.note);
    } else {
      by.set(e.id, { id: e.id, count: 1, fresh: !!e.fresh, notes: e.note ? [e.note] : [] });
    }
  }
  return [...by.values()].sort((a, b) => {
    const ta = cardTier(a.id);
    const tb = cardTier(b.id);
    if (ta !== tb) return tb - ta;
    const sa = isShinyCard(a.id) ? 1 : 0;
    const sb = isShinyCard(b.id) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const la = cardDef(a.id)?.level ?? 1;
    const lb = cardDef(b.id)?.level ?? 1;
    if (la !== lb) return lb - la;
    return b.count - a.count;
  });
}

/**
 * THE PICKUP PATH's single entry point. Files the card into the floor haul,
 * marks it seen, and flashes the corner toast. Deliberately returns without
 * touching the sim — walking over a card costs you nothing.
 */
export function presentCardPickup(id: CardId, note: string): void {
  // Tracked by card KIND. Keying `seenCards` on the full instance id would mark
  // every new LEVEL of a card you already own as a discovery, and the NEW flag
  // would stop meaning anything within two floors.
  const base = cardBase(id);
  const fresh = !state.seenCards.has(base);
  state.seenCards.add(base);
  state.floorHaul.push({ id, note, fresh });
  showCardToast(id, note);
}

function injectStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    /* NO entry fade on the overlay itself, deliberately. It used to start at
       opacity:0 and be carried in by a class-toggled transition; anything of
       that shape can be left sitting at zero (see the long note in
       pickup-toast.ts — a pending animation holds keyframe zero whatever the
       fill mode). Here that would mean an INVISIBLE modal on top of a paused
       sim: the game stops responding and there is nothing on screen to explain
       why or to dismiss. The overlay, the title and the CONTINUE footer are all
       unanimated for that reason; the cards below carry the motion. */
    .cardrd{position:fixed;inset:0;z-index:10003;display:flex;align-items:center;justify-content:center;
      background:rgba(6,8,12,.78);backdrop-filter:blur(3px);overflow-y:auto}
    .cardrd-col{display:flex;flex-direction:column;align-items:center;gap:10px;
      max-width:min(94vw,940px);padding:24px 12px}
    .cardrd-title{font:16px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:4px;
      color:#f0c85a;text-shadow:2px 2px 0 #0b0d12,0 0 14px rgba(240,200,90,.5)}
    .cardrd-sub{font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:2px;color:#9aa48c}
    .cardrd-grid{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;
      gap:10px;margin-top:4px}
    /* Each card rises in on its own small delay (set inline) so the haul deals
       out rather than appearing as a block. This one DOES need a backwards fill
       — that is what holds a card off-screen through its delay — which is only
       acceptable because the haul runs with the sim PAUSED, so the compositor
       is not competing with the game loop. The overlay above is the fail-safe:
       it, the title and the CONTINUE footer are unanimated, so a stalled deal
       can never leave the player facing a blank screen with no way out. */
    .cardrd-cell{display:flex;flex-direction:column;align-items:center;gap:4px;
      animation:cardrd-deal 320ms cubic-bezier(.18,.9,.28,1.2) both}
    @keyframes cardrd-deal{
      from{opacity:0;transform:translateY(14px) scale(.94)}
      to{opacity:1;transform:none}}
    /* THE STACK. The face sits at the front of a relatively-positioned box; the
       ghost plates behind it are absolutely positioned INSIDE that box, so the
       cell's flow width is still exactly one card and the grid doesn't reflow
       around a pile. Room is left at the top-right for the offset plates and the
       count chip via padding on the box rather than a transform on the face —
       transforming the face would fight the deal-in animation on the cell. */
    .cardrd-stack{position:relative;width:100%;padding:11px 11px 0 0;box-sizing:border-box}
    .cardrd-face{position:relative;z-index:2;display:block;width:100%;height:auto;border-radius:8px;
      box-shadow:0 10px 28px rgba(0,0,0,.75),0 0 0 1px rgba(0,0,0,.6)}
    .cardrd-ghost{position:absolute;z-index:1;left:0;top:11px;right:11px;bottom:0;
      border-radius:8px;background:#10141c;border:2px solid #555;
      box-shadow:0 6px 16px rgba(0,0,0,.6);transform-origin:50% 100%}
    .cardrd-count{position:absolute;z-index:3;right:0;top:0;
      min-width:26px;padding:2px 6px;border-radius:11px;text-align:center;
      background:#0b0d12;border:2px solid #f0c85a;color:#f0c85a;
      font:11px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      box-shadow:0 2px 8px rgba(0,0,0,.7),0 0 12px rgba(240,200,90,.45)}
    .cardrd-shiny{display:inline-block;white-space:nowrap;vertical-align:middle;
      padding:1px 5px;border-radius:4px;
      background:#2a1030;border:1px solid #ff9df0;color:#ffd6fb;
      font:8px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      box-shadow:0 0 10px rgba(255,120,235,.6);animation:cardrd-shine 1.8s ease-in-out infinite}
    @keyframes cardrd-shine{0%,100%{opacity:.75}50%{opacity:1}}
    .cardrd-name{font:10px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      text-align:center;text-shadow:1px 1px 0 #0b0d12}
    .cardrd-desc{font:8px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      color:#c9c1ad;text-align:center;line-height:1.6}
    .cardrd-where{font:8px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px;
      color:#9aa48c;text-align:center;line-height:1.5}
    .cardrd-new{display:inline-block;background:#20242e;border:1px solid #f0c85a;border-radius:3px;
      padding:1px 4px;color:#f0c85a;font:8px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px}
    .cardrd-foot{margin-top:10px;display:flex;align-items:center;gap:10px;
      color:#cfd6e4;font:10px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:2px;
      animation:cardrd-pulse 1.6s ease-in-out infinite}
    @keyframes cardrd-pulse{0%,100%{opacity:.55}50%{opacity:1}}
    @media (prefers-reduced-motion:reduce){
      .cardrd,.cardrd-cell{animation-duration:1ms}
      .cardrd-foot,.cardrd-shiny{animation:none}
    }
  `;
  document.head.appendChild(s);
}

/** Display width per card, chosen so even a big haul still fits one screen. */
function faceWidth(n: number): number {
  if (n <= 3) return 190;
  if (n <= 6) return 150;
  if (n <= 10) return 118;
  return 92;
}

function buildCell(s: HaulStack, i: number, w: number): HTMLElement | null {
  const def = cardDef(s.id);
  if (!def) return null;
  const shiny = !!def.shiny;
  const level = def.level ?? 1;
  const cell = document.createElement("div");
  cell.className = "cardrd-cell";
  cell.style.width = `${w}px`;
  // Capped so a 12-card haul doesn't take four seconds to finish dealing.
  cell.style.animationDelay = `${Math.min(i * 55, 660)}ms`;

  // ── The stack ──
  // Duplicates are ONE cell with the copies drawn as offset plates behind the
  // face, because that is what a pile of the same card physically looks like —
  // and because eight identical faces in a row was the thing that made the haul
  // screen read as noise. The count chip carries the actual number; the plates
  // cap at two, since three ghosts already say "several" and any more just eats
  // the cell's width.
  const stack = document.createElement("div");
  stack.className = "cardrd-stack";
  const ghosts = Math.min(2, s.count - 1);
  for (let k = ghosts; k >= 1; k--) {
    const g = document.createElement("div");
    g.className = "cardrd-ghost";
    g.style.borderColor = RARITY_HEX[def.rarity];
    g.style.transform = `translate(${k * 5}px, ${k * -5}px) rotate(${k * 2.2}deg)`;
    stack.appendChild(g);
  }

  const canvas = document.createElement("canvas");
  // paintCard REQUIRES the backing store to be exactly CARD_W x CARD_H.
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  canvas.className = "cardrd-face";
  paintCard(canvas, s.id);
  stack.appendChild(canvas);

  if (s.count > 1) {
    const chip = document.createElement("span");
    chip.className = "cardrd-count";
    chip.textContent = `×${s.count}`;
    stack.appendChild(chip);
  }
  cell.appendChild(stack);

  const name = document.createElement("div");
  name.className = "cardrd-name";
  name.textContent = level > 1 ? `${def.label.toUpperCase()} Lv${level}` : def.label.toUpperCase();
  name.style.color = RARITY_HEX[def.rarity];
  // The shine badge rides the NAME row, not the card face. Floated over the
  // art it landed squarely on the stats strip — a badge that hides the numbers
  // it is bragging about. The painted face carries its own "✦ SHINY" footer and
  // the prismatic border, so this is the third and least intrusive signal.
  if (shiny) {
    const sh = document.createElement("span");
    sh.className = "cardrd-shiny";
    sh.textContent = "✦ SHINY";
    name.appendChild(document.createTextNode(" "));
    name.appendChild(sh);
  }
  if (s.fresh) {
    const badge = document.createElement("span");
    badge.className = "cardrd-new";
    badge.textContent = "NEW";
    name.appendChild(document.createTextNode(" "));
    name.appendChild(badge);
  }
  cell.appendChild(name);

  // The description is the point of reading at all — a card you socketed and
  // never read is a stat you don't know you have. For a levelled copy this is
  // regenerated from the SCALED modifier (cards.ts describeModifier), so the
  // line is what this card actually does rather than what its level-1 twin did.
  const desc = document.createElement("div");
  desc.className = "cardrd-desc";
  desc.textContent = `${def.icon} ${def.description}`;
  cell.appendChild(desc);

  const where = document.createElement("div");
  where.className = "cardrd-where";
  where.textContent = s.notes.join(" · ");
  cell.appendChild(where);

  return cell;
}

/**
 * Lay the floor's cards out as one screen and run `onDone` when the player
 * continues. Falls straight through to `onDone` when there is nothing to show
 * or there is no DOM (headless harness), so the caller can always call this
 * instead of branching itself.
 */
export function showCardHaul(entries: readonly HaulEntry[], floor: number, onDone: () => void): void {
  const stacks = stackHaul(entries);
  const total = stacks.reduce((n, s) => n + s.count, 0);
  if (typeof document === "undefined" || !state.container || stacks.length === 0) {
    onDone();
    return;
  }
  // A haul already up (shouldn't happen — a floor ends once) would strand its
  // continuation; run the old one's first.
  if (state.cardReaderEl) advanceCardReader();

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

  const col = document.createElement("div");
  col.className = "cardrd-col";

  const title = document.createElement("div");
  title.className = "cardrd-title";
  title.textContent = `FLOOR ${floor} HAUL`;
  col.appendChild(title);

  const newCount = stacks.filter((s) => s.fresh).length;
  const shinyCount = stacks.filter((s) => isShinyCard(s.id)).reduce((n, s) => n + s.count, 0);
  const sub = document.createElement("div");
  sub.className = "cardrd-sub";
  sub.textContent =
    `${total} CARD${total === 1 ? "" : "S"}` +
    (stacks.length !== total ? ` · ${stacks.length} KIND${stacks.length === 1 ? "" : "S"}` : "") +
    (newCount ? ` · ${newCount} NEW` : "") +
    (shinyCount ? ` · ${shinyCount} SHINY` : "");
  col.appendChild(sub);

  const grid = document.createElement("div");
  grid.className = "cardrd-grid";
  // Sized off the number of STACKS, not the number of cards — collapsing
  // duplicates is what buys a big-haul floor readable faces instead of 92px
  // thumbnails nobody can read the stat line on.
  const w = faceWidth(stacks.length);
  stacks.forEach((s, i) => {
    const cell = buildCell(s, i, w);
    if (cell) grid.appendChild(cell);
  });
  col.appendChild(grid);

  const foot = document.createElement("div");
  foot.className = "cardrd-foot";
  foot.textContent = "SPACE / ENTER — ON TO THE TAVERN";
  col.appendChild(foot);

  el.appendChild(col);
  state.container.appendChild(el);
  state.cardReaderEl = el;
  onHaulDone = onDone;
}

/**
 * Space/Enter/click: close the haul and continue.
 *
 * Named for the key branch in core's handleKey that has always called it. The
 * continuation runs AFTER `cardReaderEl` is cleared, because it is the thing
 * that opens the tavern and the pause gate must not be double-owned.
 */
export function advanceCardReader(): void {
  const el = state.cardReaderEl;
  if (!el) return;
  el.remove();
  state.cardReaderEl = null;
  // Drain the queued dismiss tap so it doesn't fire a dodge on resume.
  state.input?.clearTransient();
  const done = onHaulDone;
  onHaulDone = null;
  done?.();
}

/**
 * Hard teardown (death / exit while open). Unlike `advanceCardReader` this
 * DROPS the continuation — the run that was on its way to the tavern isn't any
 * more.
 */
export function dismissCardReader(): void {
  onHaulDone = null;
  state.cardReaderEl?.remove();
  state.cardReaderEl = null;
}
