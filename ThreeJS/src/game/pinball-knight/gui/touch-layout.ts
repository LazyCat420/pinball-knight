/**
 * THE ON-SCREEN PAD'S LAYOUT — a PlayStation face cluster, in UI pixels.
 *
 * Pure, and its own module, because THREE readers have to agree on it: the
 * painter, the hit test, and the test that checks the buttons neither overlap
 * each other nor fall off the grid. Same rule as `canvasOrigin` in coords.ts —
 * one definition, or the paint and the touch drift apart by a few pixels and
 * present as "the button does nothing near its edge".
 *
 * ── WHY THE PS1 ARRANGEMENT, AND NOT SEVEN SCATTERED DISCS ──
 *
 * The pad this replaced had ATK / PULL / Q / E / RUN / M / I at seven
 * hand-placed offsets from the bottom-right corner. Three problems, all of
 * them measured rather than felt:
 *
 *  1. IT WAS INCOMPLETE. There was no flipper button and no rampage button, so
 *     two things a physical controller can do — and that `gamepad.ts` maps to
 *     circle and triangle — could not be done by thumb AT ALL. `pad.flip`
 *     existed in the VirtualPad struct and nothing on the touch path ever set
 *     it.
 *  2. IT DID NOT SCALE. Every number was an absolute UI pixel (`r: 44`,
 *     `x: w - 78`) against a grid that now runs from ~430 (a phone in
 *     portrait) to 2560 (a 1440p desktop with ?touch=1). At the small end the
 *     buttons covered a third of the screen; at the large end they were
 *     thumbnail-sized in the corner.
 *  3. THE LABELS WERE A THIRD VOCABULARY. "ATK"/"PULL"/"RUN" named neither the
 *     keyboard binding nor the controller button, so nothing on screen agreed
 *     with either of the other two ways to play.
 *
 * The face cluster mirrors `gamepad.ts`'s mapping EXACTLY — square attacks,
 * cross dodges, circle flips, triangle rampages, L1/R1 are the two skills,
 * L2 sprints, R2 is the attack alias, Select is the map and Start the menu.
 * That is deliberate: one mapping, three input devices, so muscle memory
 * carries between them and there is one table to change instead of two.
 *
 * ── EVERYTHING IS DERIVED FROM `u` ──
 * `u` is one grid-relative unit, so the pad is the same size relative to the
 * thumb on every screen. It is clamped at both ends: below ~9 the glyphs stop
 * being legible, and above ~30 the cluster starts eating a desktop window.
 */

/**
 * What a button DOES. Mirrors `gamepad.ts`'s mapping one for one.
 *
 * `attack`/`dodge`/`flip`/`sprint` are HELD (and the first three also fire a
 * tap edge); the rest are discrete and bridge through the game's own keydown
 * switch via `pressKey`, exactly as the physical pad does — one definition of
 * what Q does, not two.
 */
export type TouchAction = "attack" | "dodge" | "flip" | "sprint" | "rampage" | "skillQ" | "skillE" | "map" | "menu";

export type TouchGlyph = "square" | "cross" | "circle" | "triangle" | "text";

export interface TouchButton {
  /**
   * Unique per BUTTON, not per action — square and R2 both attack, and the
   * press bookkeeping is keyed by this. Sharing an id there means releasing
   * one finger clears the other's press.
   */
  id: string;
  action: TouchAction;
  /** How it is drawn: a PlayStation glyph, or `label` as text. */
  glyph: TouchGlyph;
  label: string;
  /** Centre, in UI pixels. */
  x: number;
  y: number;
  /** Half-extent of the hit box, in UI pixels. Discs use `rx` as the radius. */
  rx: number;
  ry: number;
  shape: "disc" | "pill";
}

/**
 * One layout unit, in UI pixels. The whole pad is a multiple of this.
 *
 * The SHORT side governs, so the pad is thumb-sized rather than screen-sized —
 * but a narrow grid also caps it by WIDTH, because a portrait phone has plenty
 * of height and no room across, and without that term the shoulder pills and
 * the Start/Select pair collide at 430 wide (measured in touch-layout.test.ts,
 * which sweeps the real grids).
 */
export function padUnit(w: number, h: number): number {
  return Math.max(9, Math.min(30, Math.round(Math.min(Math.min(w, h) / 20, w / 26))));
}

/**
 * Clearance above the painted HUD panel, in UI pixels.
 *
 * The HUD is a fixed 92 UI px tall and this used to be that constant plus a
 * gap — right on a desktop grid and wrong on a phone, where 92 of a 430-tall
 * grid is a fifth of the screen and the cluster ended up squeezed into the
 * middle. Taking the SMALLER of the two keeps the buttons off the HUD on a big
 * grid and off the floor on a small one.
 */
const HUD_H = 92;
function bottomOf(h: number, u: number): number {
  return h - Math.min(HUD_H + u, Math.round(h * 0.28)) - u;
}

/**
 * Where the movement stick rests when no thumb is down.
 *
 * The stick still FLOATS — it re-centres wherever the thumb lands on the left
 * half — but it is drawn at rest here so the pad reads as a controller rather
 * than as an empty half-screen with buttons on the other side.
 */
export function stickHome(w: number, h: number): { x: number; y: number; r: number } {
  const u = padUnit(w, h);
  return { x: Math.round(u * 4.4), y: Math.round(bottomOf(h, u) - u * 2.2), r: Math.round(u * 2.2) };
}

/** THE ONE LAYOUT. Painter, hit test and the layout test all read this. */
export function padLayout(w: number, h: number): TouchButton[] {
  const u = padUnit(w, h);
  const bottom = bottomOf(h, u);

  // ── The face cluster: a diamond in PlayStation order — triangle top, circle
  // right, cross bottom, square left. `spread` exceeds 2 x `faceR`, so two
  // adjacent buttons always clear each other.
  const faceR = u * 1.45;
  const spread = u * 2.7;
  // 4.45 = `spread` (2.7) + `faceR` (1.45) plus a third of a unit of margin.
  // At 3.6 the circle's right edge landed at w + 0.55u — off the screen on
  // every grid, which is what the on-screen test caught first time out.
  const fx = w - u * 4.45;
  const fy = bottom - u * 3.0;
  const disc = (id: string, action: TouchAction, glyph: TouchGlyph, label: string, x: number, y: number): TouchButton => ({
    id, action, glyph, label, x: Math.round(x), y: Math.round(y), rx: faceR, ry: faceR, shape: "disc",
  });

  // ── Shoulders: stacked pills in the two top corners. In landscape — the way
  // this game is meant to be held — that is exactly where the index fingers
  // already rest on the edge of the device.
  const shW = u * 3.1;
  const shH = u * 1.15;
  const shTop = u * 1.6;
  const pill = (id: string, action: TouchAction, label: string, x: number, y: number, rx: number, ry: number): TouchButton => ({
    id, action, glyph: "text", label, x: Math.round(x), y: Math.round(y), rx, ry, shape: "pill",
  });

  // ── Start / Select: the small centred pair a PS1 pad carries between the
  // D-pad and the face buttons.
  const smW = u * 2.2;
  const smH = u * 0.95;

  return [
    disc("face-triangle", "rampage", "triangle", "R", fx, fy - spread),
    disc("face-circle", "flip", "circle", "F", fx + spread, fy),
    disc("face-cross", "dodge", "cross", "SPC", fx, fy + spread),
    disc("face-square", "attack", "square", "ATK", fx - spread, fy),

    pill("sh-l1", "skillQ", "L1", u * 0.4 + shW, shTop, shW, shH),
    pill("sh-l2", "sprint", "L2", u * 0.4 + shW, shTop + shH * 2.5, shW, shH),
    pill("sh-r1", "skillE", "R1", w - u * 0.4 - shW, shTop, shW, shH),
    pill("sh-r2", "attack", "R2", w - u * 0.4 - shW, shTop + shH * 2.5, shW, shH),

    pill("select", "map", "SELECT", w / 2 - smW - u * 0.5, shTop, smW, smH),
    pill("start", "menu", "START", w / 2 + smW + u * 0.5, shTop, smW, smH),
  ];
}

/** Hit test. A disc is radial; a pill is its box. Both read `padLayout`. */
export function padHit(b: TouchButton, x: number, y: number): boolean {
  if (b.shape === "disc") return Math.hypot(x - b.x, y - b.y) <= b.rx;
  return Math.abs(x - b.x) <= b.rx && Math.abs(y - b.y) <= b.ry;
}
