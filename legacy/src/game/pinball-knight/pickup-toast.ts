/**
 * PICKUP TOASTS — now a delegate.
 *
 * The rail of absolutely-positioned rows, its stylesheet, its per-element
 * timeout map and its 4-row cap all moved to `gui/screens/toasts.ts`. The
 * names stay because loot, the shop and the card layer all raise toasts from
 * places that should not know which screen shows them.
 */
import type { CardId } from "./cards";
import { clearToasts, pushCardToast, pushToast } from "./gui/screens/toasts";

export function clearPickupToasts(): void {
  clearToasts();
}

export function showPickupToast(text: string): void {
  pushToast(text);
}

export function showCardToast(id: CardId, note: string): void {
  pushCardToast(id, note);
}
