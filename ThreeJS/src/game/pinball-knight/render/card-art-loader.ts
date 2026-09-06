/**
 * CARD ART LOADER — Preloads and caches high-fidelity monster illustrations.
 *
 * Sourced from Nano Banana custom art assets in `public/cards/art/<cardId>.png`.
 * When an image is ready, it is blitted into the 452×320 art window of the
 * 512×716 trading card face in `holo-card.ts`.
 *
 * Graceful fallback: If an image is missing or loading, returns `null` so
 * `holo-card.ts` falls back to the in-engine cel-shaded `monsterPortrait` or
 * procedural `paintSigil`.
 */
import { CARD_IDS, cardBase, type CardId } from "../cards";

const artCache = new Map<string, HTMLImageElement>();
const failedSet = new Set<string>();

/**
 * Synchronously retrieves a loaded card art image element, or null if not yet loaded.
 */
export function getCardArtImage(id: CardId): HTMLImageElement | null {
  const base = cardBase(id);
  if (failedSet.has(base)) return null;
  const img = artCache.get(base);
  if (img && img.complete && img.naturalWidth > 0) {
    return img;
  }
  // If not yet requested, trigger lazy load
  if (!img && typeof Image !== "undefined") {
    loadCardArt(base);
  }
  return null;
}

/**
 * Loads a single card art image into cache.
 */
export function loadCardArt(baseId: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  const existing = artCache.get(baseId);
  if (existing) {
    if (existing.complete && existing.naturalWidth > 0) return Promise.resolve(existing);
  }
  if (failedSet.has(baseId)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      artCache.set(baseId, img);
      resolve(img);
    };
    img.onerror = () => {
      // Try relative path if absolute failed
      if (!img.src.startsWith("./")) {
        img.src = `./cards/art/${baseId}.png`;
      } else {
        failedSet.add(baseId);
        resolve(null);
      }
    };
    img.src = `/cards/art/${baseId}.png`;
  });
}

/**
 * Preload all card illustrations in the background.
 */
export async function preloadAllCardArt(): Promise<void> {
  if (typeof Image === "undefined") return;
  const promises = CARD_IDS.map((id) => loadCardArt(cardBase(id)));
  await Promise.allSettled(promises);
}
