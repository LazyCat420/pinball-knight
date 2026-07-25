/**
 * AIM INDICATOR GEOMETRY — pure, DOM/GL-free, so the arrow maths is pinned by
 * tests instead of by squinting at the screen.
 *
 * Both helpers take the momentum direction and the steer direction as unit-ish
 * vectors on the XZ ground plane and answer the two questions the indicator
 * needs: HOW FAR apart are they, and WHICH WAY does the turn go.
 */

/**
 * How divergent the steer is from the heading, as 0..1.
 *
 * 0 = pointing exactly where you're already going (nothing to show), 1 = fully
 * reversed. Uses the angle rather than the raw dot so the ramp is linear in
 * degrees — a 45° turn reads as half of a 90° one, which a dot product would
 * not give you.
 */
export function bendFraction(momX: number, momZ: number, steerX: number, steerZ: number): number {
  const ml = Math.hypot(momX, momZ);
  const sl = Math.hypot(steerX, steerZ);
  if (ml < 1e-6 || sl < 1e-6) return 0;
  const dot = (momX * steerX + momZ * steerZ) / (ml * sl);
  const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
  return ang / Math.PI;
}

/**
 * Which side the steer sits on: +1 for one hand, -1 for the other, 0 when
 * collinear. The XZ cross product's Y component — sign only, magnitude unused.
 */
export function steerSign(momX: number, momZ: number, steerX: number, steerZ: number): number {
  const cross = momX * steerZ - momZ * steerX;
  if (Math.abs(cross) < 1e-6) return 0;
  return cross > 0 ? 1 : -1;
}
