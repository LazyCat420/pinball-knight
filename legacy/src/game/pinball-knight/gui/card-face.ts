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

const scaled = new Map<string, HTMLCanvasElement>();

/**
 * The face, PRE-SCALED to `w` UI pixels wide.
 *
 * ── WHY NOT JUST `drawImage(face, x, y, w, h)` ──
 * A card is painted at 512x716 and the UI shows it between 44 and 180 wide. The
 * UI context has `imageSmoothingEnabled = false` — correct for sprites and the
 * whole reason the interface shares the art's pixel grid — so that blit is a
 * ~5.8:1 NEAREST resample. It keeps roughly one pixel in six, which on card art
 * whose whole job is to carry a title, a rarity band and three stat lines
 * destroys exactly the part that had to be read. Every one of the seven call
 * sites was doing it, at a different ratio each.
 *
 * So the resample happens ONCE, here, FILTERED, into a cache keyed by width;
 * call sites then blit 1:1 and the UI's nearest-sampling never touches it. This
 * is the same trade `gui/icons.ts` makes in `reframe`, and the same rule: a
 * filtered downscale is right when it lands in a cache, and wrong when it lands
 * on the screen.
 */
export function cardFaceAt(id: CardId, w: number): HTMLCanvasElement | null {
  const width = Math.max(1, Math.round(w));
  const key = `${id}:${width}`;
  const hit = scaled.get(key);
  if (hit) return hit;
  const src = cardFace(id);
  if (!src || typeof document === "undefined") return null;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = Math.round((CARD_H / CARD_W) * width);
  const g = out.getContext("2d");
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, out.width, out.height);
  scaled.set(key, out);
  return out;
}

/** The height a `cardFaceAt(id, w)` canvas will have. Layout wants this first. */
export function cardFaceHeight(w: number): number {
  return Math.round((CARD_H / CARD_W) * Math.round(w));
}

/** Drop the cache — card art depends on level/shine encoded in the id. */
export function clearCardFaceCache(): void {
  cache.clear();
  scaled.clear();
}

export { CARD_W, CARD_H };
