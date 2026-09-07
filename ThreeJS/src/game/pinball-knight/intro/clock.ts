/** Presentation time excludes long stalls so an unseen shot is never skipped.
 * Normal frames retain their real duration; physics has its own tighter cap. */
export const SIM_DT_CLAMP = 0.05;
export const PRESENTATION_DT_CLAMP = 0.1;

export interface IntroDeltas {
  pdt: number;
  dt: number;
}

/** A negative origin starts on the first visible frame, after shader warm-up. */
export function introDeltas(now: number, lastNow: number): IntroDeltas {
  if (lastNow < 0) return { pdt: 0, dt: 0 };
  const elapsed = Math.max(0, (now - lastNow) / 1000);
  return { pdt: Math.min(PRESENTATION_DT_CLAMP, elapsed), dt: Math.min(SIM_DT_CLAMP, elapsed) };
}
