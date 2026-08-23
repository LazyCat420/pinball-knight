/**
 * The globe ripple — a one-shot splash when life or mana changes.
 *
 * `hud-diablo.ts` drove this by pushing a wave onto a DOM-hosted canvas. The
 * effect is the same and the trigger points are unchanged; only the store moved,
 * because the thing that reads it is now the painted HUD.
 */
const until = { life: 0, mana: 0 };
const RIPPLE_MS = 420;

export function rippleGlobe(which: "life" | "mana"): void {
  until[which] = performance.now() + RIPPLE_MS;
}

/** 0..1 — how much ripple is left on that globe this frame. */
export function rippleAmount(which: "life" | "mana"): number {
  const left = until[which] - performance.now();
  return left <= 0 ? 0 : left / RIPPLE_MS;
}
