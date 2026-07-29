/**
 * CARD FACES for the in-game UI.
 *
 * `render/holo-card.ts` already paints a card onto a canvas, and it is 800
 * lines of deliberate art direction (material stock per monster family, metal
 * frames per rarity, path-drawn emblems). None of that changes — this is only
 * about WHERE the painted canvas goes. The DOM version put it in an `<img>`
 * inside a hover-tilting div; here it is blitted into the UI layer.
 *
 * ── WHAT IS LOST ──
 * `ui-cards.ts` spends ~200 lines on a CSS hover engine: rarity-scaled tilt, a
 * pointer-tracked glare, prismatic foil, face/frame parallax and a sparkle
 * field for mythics. It is a deliberate rarity TELL, not decoration. None of it
 * survives without DOM, and it is not reimplemented here — the tilt and glare
 * are worth rebuilding as canvas transforms and are explicitly outstanding.
 * Cards in this menu are, for now, flat.
 */
import { paintCard, CARD_W, CARD_H } from "../render/holo-card";
import type { CardId } from "../cards";

const cache = new Map<string, HTMLCanvasElement>();

/**
 * The painted face for a card id, cached.
 *
 * `paintCard` memoises internally too, but it still blits; at sixty frames a
 * second over a stash of thirty cards that is thirty blits per frame for an
 * image that never changes. Caching the canvas makes the repaint a `drawImage`.
 */
export function cardFace(id: CardId): HTMLCanvasElement | null {
  const hit = cache.get(id);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  paintCard(c, id);
  cache.set(id, c);
  return c;
}

/** Drop the cache — card art depends on level/shine encoded in the id. */
export function clearCardFaceCache(): void {
  cache.clear();
}

export { CARD_W, CARD_H };
