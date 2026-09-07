/** Shared vertical flight curve for catapults, hops and authored launch animations. */
export function ballisticArcHeight(progress: number, peak: number): number {
  return Math.sin(Math.PI * Math.max(0, Math.min(1, progress))) * peak;
}
