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
import { haulScreen } from "./gui/screens/haul";
import { close as closeUiScreen, push as pushUiScreen } from "./gui/stack";
import { paintCard, cardTier, CARD_W, CARD_H } from "./render/holo-card";
import { RARITY_HEX, cardBase, cardDef, isShinyCard, type CardId } from "./cards";
import { state, type HaulEntry } from "./state";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";
import { showCardToast } from "./pickup-toast";

export type { HaulEntry };


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


/** Display width per card, chosen so even a big haul still fits one screen. */


/**
 * Lay the floor's cards out as one screen and run `onDone` when the player
 * continues. Falls straight through to `onDone` when there is nothing to show
 * or there is no DOM (headless harness), so the caller can always call this
 * instead of branching itself.
 */
/**
 * The haul screen moved to `gui/screens/haul.ts`.
 *
 * What stays here is the part that was never about presentation: `stackHaul`
 * (folding a floor's haul into one row per distinct card), `isNotablePull`, and
 * `presentCardPickup`. Those are rules about what a haul IS; the screen only
 * ever drew the result.
 */
export function showCardHaul(entries: readonly HaulEntry[], floor: number, onDone: () => void): void {
  pushUiScreen(haulScreen(entries, floor, onDone));
}

/** Advance/dismiss are the screen's own business now. */
export function advanceCardReader(): void {
  closeUiScreen("haul");
}

export function dismissCardReader(): void {
  closeUiScreen("haul");
}
