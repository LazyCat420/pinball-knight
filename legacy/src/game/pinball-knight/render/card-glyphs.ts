/**
 * CARD GLYPHS — every mark on a card face, drawn as canvas PATHS.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: a card face contains no text-rendered
 * emoji. Not one.
 *
 * The old face painted `⚔️`, `⚡`, `🔥`, `❄️`, `🛡️`, `🪩` with `ctx.fillText`
 * for its energy emblem and its move bullets, and `CardDef.icon` at 150px for
 * any card with no monster to draw. That is broken twice over:
 *
 *   1. It is FONT-DEPENDENT. Whether an emoji renders at all — and whether it
 *      renders in colour, as a flat glyph, or as a tofu box — is a property of
 *      the machine's installed font stack, not of this code. A headless render
 *      of the previous face drew a ✗-in-a-circle where the energy emblem should
 *      be on nearly every card, and that same hole is reachable on any client
 *      missing an emoji font. The single loudest element on the card was one
 *      font-fallback away from being a placeholder box.
 *   2. It looks GENERIC. A stock emoji is the same mark every other piece of
 *      software on earth uses, at a fixed design weight nobody here chose. It
 *      cannot be lit, tinted, weighted or aged to match a frame style.
 *
 * Paths have none of those problems: they render identically everywhere, they
 * take the frame's own ink and metal colours, and they can be stroked as
 * engraving rather than filled as stickers.
 *
 * DOM-free apart from the CanvasRenderingContext2D handed in, so the card face
 * tests can import this without a browser.
 */

/** A glyph draws itself into a unit box centred on (0,0), roughly ±1 in extent. */
export type Glyph = (ctx: CanvasRenderingContext2D) => void;

/**
 * Draw a glyph centred at (x, y) at a given pixel radius.
 *
 * Everything is stroked or filled in the CURRENT ctx style, so the caller
 * decides whether a mark is inked, engraved or lit — the glyph only owns shape.
 */
export function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r, r);
  // Strokes are authored in unit space, so undo the scale on line width or a
  // 20px emblem and a 300px sigil would have wildly different apparent weight.
  ctx.lineWidth = ctx.lineWidth / r;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  g(ctx);
  ctx.restore();
}

/** Trace a closed polygon from a flat [x,y,x,y,…] list in unit space. */
function poly(ctx: CanvasRenderingContext2D, pts: number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** An n-pointed star, outer radius 1, inner radius `inner`. */
function star(ctx: CanvasRenderingContext2D, points: number, inner: number, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const rad = i % 2 ? inner : 1;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
}

// ── ELEMENT EMBLEMS ───────────────────────────────────────────────────────────
// One per card element, replacing the ⚡/🔥/❄️/🛡️/⚔️/🪩 fillText emblems. These
// are drawn small (a ~17px emblem, a ~14px move bullet), so every one is a bold
// silhouette with no interior detail — detail at that size is mud.

/** STORM — a lightning bolt. */
export const glyphBolt: Glyph = (ctx) => {
  poly(ctx, [0.12, -1, -0.62, 0.1, -0.08, 0.1, -0.3, 1, 0.62, -0.18, 0.05, -0.18]);
  ctx.fill();
};

/** BLAZE — a flame, teardrop with a curled tip. */
export const glyphFlame: Glyph = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(0.62, -0.34, 0.86, 0.16, 0.52, 0.6);
  ctx.bezierCurveTo(0.28, 0.92, -0.3, 1.02, -0.6, 0.66);
  ctx.bezierCurveTo(-0.92, 0.26, -0.66, -0.28, -0.2, -0.52);
  ctx.bezierCurveTo(-0.34, -0.16, -0.16, 0.06, 0.04, 0.02);
  ctx.bezierCurveTo(0.3, -0.04, 0.26, -0.5, 0, -1);
  ctx.closePath();
  ctx.fill();
};

/** FROST — a six-armed snowflake, stroked. */
export const glyphFrost: Glyph = (ctx) => {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    ctx.moveTo(0, 0);
    ctx.lineTo(cx, cy);
    // Barbs, two per arm.
    for (const t of [0.5, 0.78]) {
      for (const s of [-1, 1]) {
        const ba = a + s * 0.72;
        ctx.moveTo(cx * t, cy * t);
        ctx.lineTo(cx * t + Math.cos(ba) * 0.3, cy * t + Math.sin(ba) * 0.3);
      }
    }
  }
  ctx.stroke();
};

/** GUARD — a kite shield with a centre rib. */
export const glyphShield: Glyph = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0, -0.94);
  ctx.lineTo(0.8, -0.62);
  ctx.bezierCurveTo(0.8, 0.24, 0.46, 0.76, 0, 1);
  ctx.bezierCurveTo(-0.46, 0.76, -0.8, 0.24, -0.8, -0.62);
  ctx.closePath();
  ctx.fill();
};

/**
 * POWER — a single upright blade.
 *
 * This was a CROSSED PAIR, and at emblem size the two blades collapsed into an
 * ✗ — indistinguishable from the tofu box the glyph library exists to remove.
 * One broad blade keeps a readable silhouette all the way down to the 5px move
 * bullet, which is the size that actually has to work.
 */
export const glyphBlades: Glyph = (ctx) => {
  // Blade: a wide taper to a point, so the shape survives being 5px tall.
  poly(ctx, [0, -1.06, 0.26, -0.62, 0.22, 0.2, -0.22, 0.2, -0.26, -0.62]);
  ctx.fill();
  // Crossguard.
  ctx.fillRect(-0.62, 0.2, 1.24, 0.2);
  // Grip + pommel.
  ctx.fillRect(-0.13, 0.4, 0.26, 0.44);
  ctx.beginPath();
  ctx.arc(0, 0.92, 0.19, 0, Math.PI * 2);
  ctx.fill();
};

/**
 * MOMENTUM — a comet: a filled head with three trailing speed lines.
 *
 * The first cut was a core inside a swept ellipse, which read as an EYE (pupil
 * in a lid) rather than as an orbit — and an eye is the wrong idea entirely.
 * A comet says "carrying speed" at every size and cannot be misread.
 */
export const glyphMomentum: Glyph = (ctx) => {
  ctx.save();
  ctx.rotate(-Math.PI / 5);
  ctx.beginPath();
  ctx.arc(0.44, 0, 0.42, 0, Math.PI * 2);
  ctx.fill();
  // Trail — three tapered streaks off the head, longest through the centre.
  for (const [oy, len, w] of [
    [0, 1.5, 0.24],
    [-0.42, 1.06, 0.15],
    [0.42, 1.06, 0.15],
  ]) {
    poly(ctx, [0.2, oy - w, 0.2 - len, oy - w * 0.34, 0.2 - len, oy + w * 0.34, 0.2, oy + w]);
    ctx.fill();
  }
  ctx.restore();
};

/** SWIFT — a chevron pair, the "fast" mark. */
export const glyphSwift: Glyph = (ctx) => {
  ctx.beginPath();
  for (const dx of [-0.34, 0.3]) {
    ctx.moveTo(dx - 0.3, -0.72);
    ctx.lineTo(dx + 0.36, 0);
    ctx.lineTo(dx - 0.3, 0.72);
  }
  ctx.stroke();
};

/** A blood drop — the Blood Pact sigil bleeds these. Module-local. */
const glyphDrop: Glyph = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.bezierCurveTo(0.66, -0.16, 0.72, 0.36, 0.32, 0.76);
  ctx.bezierCurveTo(-0.06, 1.1, -0.62, 0.9, -0.76, 0.4);
  ctx.bezierCurveTo(-0.86, 0.0, -0.5, -0.4, 0, -1);
  ctx.closePath();
  ctx.fill();
};

export const glyphFang: Glyph = (ctx) => {
  poly(ctx, [-0.68, -0.78, 0.68, -0.78, 0.3, -0.3, 0.16, 0.98, -0.02, -0.24, -0.24, 0.7, -0.34, -0.34]);
  ctx.fill();
};

/** A four-point sparkle — the SHINY mark and the art-window twinkles. */
export const glyphSparkle: Glyph = (ctx) => {
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.quadraticCurveTo(0.14, -0.14, 1, 0);
  ctx.quadraticCurveTo(0.14, 0.14, 0, 1);
  ctx.quadraticCurveTo(-0.14, 0.14, -1, 0);
  ctx.quadraticCurveTo(-0.14, -0.14, 0, -1);
  ctx.closePath();
  ctx.fill();
};

/** The rarity pip in the footer, replacing the "★★★" text run. */
export const glyphPip: Glyph = (ctx) => {
  star(ctx, 4, 0.34, -Math.PI / 2);
  ctx.fill();
};

// ── MYTHIC SIGILS ─────────────────────────────────────────────────────────────
// The sourceless chase cards have no monster to draw. They used to fall back to
// `CardDef.icon` at 150px — a 🌋 / ⏳ / 🩻 / 🖤 sticker, which made the RAREST
// cards in the game the only ones with no authored art at all.
//
// These are drawn LARGE (a ~300px art window), so unlike the emblems above they
// carry interior line-work and are meant to be stroked as engraving over the
// card's ink, then lit — the look of a plate etching rather than a logo.

/** WORLD BREAKER — a cracked world-rune: a ringed globe split by a fault. */
export const sigilWorldBreaker: Glyph = (ctx) => {
  ctx.beginPath();
  ctx.arc(0, 0, 0.86, 0, Math.PI * 2);
  ctx.stroke();
  // Latitude bands, squashed into ellipses so the disc reads as a sphere.
  for (const t of [-0.42, 0, 0.42]) {
    ctx.beginPath();
    ctx.ellipse(0, t, Math.sqrt(Math.max(0, 0.86 * 0.86 - t * t)), 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Meridian.
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.3, 0.86, 0, 0, Math.PI * 2);
  ctx.stroke();
  // The fault — a jagged split straight through the globe, drawn heavier.
  ctx.save();
  ctx.lineWidth *= 2.2;
  ctx.beginPath();
  ctx.moveTo(-0.16, -1.12);
  ctx.lineTo(0.12, -0.4);
  ctx.lineTo(-0.2, -0.1);
  ctx.lineTo(0.2, 0.34);
  ctx.lineTo(-0.06, 0.66);
  ctx.lineTo(0.14, 1.12);
  ctx.stroke();
  ctx.restore();
  // Shed shards, thrown clear of the break.
  for (const [sx, sy, ss] of [
    [-0.72, -0.86, 0.14],
    [0.82, -0.6, 0.1],
    [0.68, 0.84, 0.13],
    [-0.86, 0.62, 0.09],
  ]) {
    poly(ctx, [sx, sy - ss, sx + ss, sy, sx, sy + ss, sx - ss, sy]);
    ctx.fill();
  }
};

/** TIME RIPPER — an hourglass whose lower bulb has shattered. */
export const sigilTimeRipper: Glyph = (ctx) => {
  // Caps.
  ctx.beginPath();
  ctx.moveTo(-0.72, -0.96);
  ctx.lineTo(0.72, -0.96);
  ctx.moveTo(-0.72, 0.96);
  ctx.lineTo(0.72, 0.96);
  ctx.stroke();
  // Upper bulb — intact.
  ctx.beginPath();
  ctx.moveTo(-0.58, -0.9);
  ctx.bezierCurveTo(-0.58, -0.28, -0.12, -0.14, 0, 0);
  ctx.bezierCurveTo(0.12, -0.14, 0.58, -0.28, 0.58, -0.9);
  ctx.stroke();
  // Sand still falling.
  ctx.save();
  ctx.lineWidth *= 0.7;
  ctx.beginPath();
  ctx.moveTo(0, 0.04);
  ctx.lineTo(0, 0.52);
  ctx.stroke();
  ctx.restore();
  // Lower bulb — INTACT on the left, blown out on the right.
  //
  // The first cut drew only the right wall as a stub and left the left wall to
  // a curve that ran to the cap, so the bulb never closed and the whole lower
  // half read as an open "V" rather than as a broken vessel. The left wall now
  // runs neck→cap in full, and the break is unambiguous because the right wall
  // stops dead a third of the way down with its debris thrown clear.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-0.12, 0.14, -0.58, 0.28, -0.58, 0.9);
  ctx.stroke();
  // Right wall — snapped, ending in a jagged edge instead of reaching the cap.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(0.12, 0.14, 0.44, 0.24, 0.53, 0.46);
  ctx.lineTo(0.42, 0.54);
  ctx.lineTo(0.56, 0.64);
  ctx.stroke();
  // A surviving fragment of the missing wall, still standing on the base.
  ctx.beginPath();
  ctx.moveTo(0.58, 0.9);
  ctx.lineTo(0.57, 0.74);
  ctx.lineTo(0.66, 0.82);
  ctx.stroke();
  // Escaping grains.
  for (const [sx, sy, ss] of [
    [0.5, 0.42, 0.05],
    [0.72, 0.62, 0.04],
    [0.34, 0.68, 0.035],
    [0.86, 0.3, 0.04],
  ]) {
    poly(ctx, [sx, sy - ss, sx + ss, sy, sx, sy + ss, sx - ss, sy]);
    ctx.fill();
  }
};

/** TEMPEST CROWN — a circlet of storm-spines around an eye of calm. */
export const sigilTempestCrown: Glyph = (ctx) => {
  // The spiral eye.
  ctx.beginPath();
  for (let i = 0; i <= 130; i++) {
    const t = i / 130;
    const a = t * Math.PI * 4.2;
    const rad = 0.08 + t * 0.42;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.stroke();
  // Crown band.
  ctx.beginPath();
  ctx.arc(0, 0, 0.66, 0, Math.PI * 2);
  ctx.stroke();
  // Spines, alternating tall and short like a crown's points.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const len = i % 2 ? 0.86 : 1.04;
    const w = 0.075;
    poly(ctx, [
      Math.cos(a - w) * 0.66,
      Math.sin(a - w) * 0.66,
      Math.cos(a) * len,
      Math.sin(a) * len,
      Math.cos(a + w) * 0.66,
      Math.sin(a + w) * 0.66,
    ]);
    ctx.fill();
  }
};

/**
 * GLASS CANNON — a rib-cage snapped open down one side.
 *
 * The ribs are drawn as arcs that START on the spine and sweep out-and-down,
 * mirrored per side. The first cut let each rib's control points run past the
 * spine before curving back, so no rib actually touched it: the sigil read as a
 * stack of loose "S" curves next to a line. Anchoring every arc ON the spine at
 * (0, y) and keeping both control points strictly on one side fixes it.
 *
 * The RIGHT side is cut short mid-cage with its severed ends thrown outward —
 * the card's −60% durability drawback, said in the art rather than only in the
 * stat strip.
 */
export const sigilGlassCannon: Glyph = (ctx) => {
  // Sternum, drawn heavier than the ribs so the cage hangs off something.
  ctx.save();
  ctx.lineWidth *= 1.3;
  ctx.beginPath();
  ctx.moveTo(0, -1.02);
  ctx.lineTo(0, 0.72);
  ctx.stroke();
  ctx.restore();

  // Vertebrae ticks.
  ctx.save();
  ctx.lineWidth *= 0.7;
  for (let i = 0; i < 7; i++) {
    const y = -0.92 + i * 0.26;
    ctx.beginPath();
    ctx.moveTo(-0.09, y);
    ctx.lineTo(0.09, y);
    ctx.stroke();
  }
  ctx.restore();

  // Ribs, as PARAMETRIC arcs rather than beziers.
  //
  // Two rewrites failed here for the same reason: bezier control points placed
  // to make a rib "sweep" put the curve's extremum past the spine, so ribs
  // visibly crossed the sternum and continued out the far side — a stack of
  // arcs behind a pole, not a rib-cage. Sampling an explicit quarter-ellipse
  // makes the constraint structural: x is `side * span * sin(t)` with t from 0,
  // so the rib LEAVES the spine at exactly x=0 and can never return past it.
  //
  // `span` tapers at both ends so the cage is widest through the middle, and
  // each rib drops as it sweeps, which is what makes it read as anatomy.
  const ROWS = 6;
  //
  // A rib must leave the spine ALREADY HEADING DOWN and keep falling, or
  // consecutive ribs crest above their own anchors, overlap each other, and the
  // cage reads as a stack of continuous hoops behind a pole. Two earlier
  // parameterisations both had a flat start (`y ∝ u²`, `y ∝ 1-cos t`) and both
  // produced exactly that. The linear term is what fixes it: y grows from the
  // very first sample, so no rib ever rises above where it met the spine.
  const rib = (side: number, y: number, span: number, drop: number, frac: number): void => {
    ctx.beginPath();
    const STEPS = 24;
    for (let s = 0; s <= STEPS; s++) {
      const u = (s / STEPS) * frac;
      // x eases out (fast near the spine, slowing at the tip); y accelerates
      // down. Together: a rib that starts angled and hooks under at the end.
      ctx.lineTo(side * span * Math.sin(u * (Math.PI / 2)), y + drop * (0.45 * u + 0.55 * u * u * u));
    }
    ctx.stroke();
  };
  for (let i = 0; i < ROWS; i++) {
    const y = -0.92 + i * 0.3;
    const span = 0.9 - Math.abs(i - 2.1) * 0.12;
    // Drop is kept well UNDER the row pitch (0.3): a rib that falls further
    // than the gap to the next anchor lands on top of the rib below it, which
    // is the other half of why earlier cuts read as solid hoops.
    const drop = 0.2;
    for (const side of [-1, 1]) {
      // Right-side ribs 2 and 3 are the broken ones — they stop mid-sweep.
      const broken = side === 1 && (i === 2 || i === 3);
      const frac = broken ? 0.45 : 1;
      rib(side, y, span, drop, frac);
      if (broken) {
        // A splintered tip at the break, kicked away from the cage. Must use the
        // SAME parameterisation as `rib` or the splinter detaches from the end
        // it is supposed to grow out of.
        const ex = side * span * Math.sin(frac * (Math.PI / 2));
        const ey = y + drop * (0.45 * frac + 0.55 * frac * frac * frac);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + side * 0.12, ey - 0.09);
        ctx.stroke();
      }
    }
  }

  // The shed fragments of the two snapped ribs, thrown clear to the right.
  ctx.save();
  ctx.lineWidth *= 0.9;
  for (const [fx, fy, rot] of [
    [0.78, -0.3, 0.5],
    [0.92, 0.14, -0.35],
  ]) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-0.16, 0);
    ctx.quadraticCurveTo(0.02, 0.1, 0.2, 0.04);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
};

/** BLOOD PACT — a heart pierced by a dagger, bleeding. */
export const sigilBloodPact: Glyph = (ctx) => {
  // Heart, drawn as an outline so it engraves rather than blobs.
  ctx.beginPath();
  ctx.moveTo(0, 0.92);
  ctx.bezierCurveTo(-0.94, 0.2, -0.82, -0.62, -0.4, -0.72);
  ctx.bezierCurveTo(-0.16, -0.78, -0.02, -0.56, 0, -0.4);
  ctx.bezierCurveTo(0.02, -0.56, 0.16, -0.78, 0.4, -0.72);
  ctx.bezierCurveTo(0.82, -0.62, 0.94, 0.2, 0, 0.92);
  ctx.closePath();
  ctx.stroke();
  // The dagger through it, top-right to bottom-left.
  ctx.save();
  ctx.rotate(-Math.PI / 5);
  poly(ctx, [-0.07, -1.06, 0.07, -1.06, 0.05, 0.5, 0, 0.62, -0.05, 0.5]);
  ctx.fill();
  ctx.fillRect(-0.3, -1.2, 0.6, 0.1);
  ctx.fillRect(-0.06, -1.44, 0.12, 0.24);
  ctx.restore();
  // Drops falling from the wound.
  for (const [sx, sy, ss] of [
    [0.24, 0.62, 0.09],
    [-0.3, 0.5, 0.07],
    [0.02, 0.92, 0.06],
  ]) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(ss, ss);
    glyphDrop(ctx);
    ctx.restore();
  }
};

/** Fallback for a sourceless card with no bespoke sigil — an arcane seal. */
export const sigilSeal: Glyph = (ctx) => {
  ctx.beginPath();
  ctx.arc(0, 0, 0.94, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 0.78, 0, Math.PI * 2);
  ctx.stroke();
  star(ctx, 5, 0.42);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.78, Math.sin(a) * 0.78);
    ctx.lineTo(Math.cos(a) * 0.94, Math.sin(a) * 0.94);
    ctx.stroke();
  }
};

/**
 * Which sigil a sourceless card wears.
 *
 * Keyed by card id rather than by rarity: these are the five hand-authored
 * chase cards, and each one's art is a statement about that specific card
 * (Glass Cannon's ribs are BROKEN because the card's drawback is fragility).
 * Anything not listed falls back to the generic seal rather than to an emoji.
 */
export const CARD_SIGILS: Record<string, Glyph> = {
  worldbreaker: sigilWorldBreaker,
  timeripper: sigilTimeRipper,
  tempestcrown: sigilTempestCrown,
  gladeath: sigilGlassCannon,
  bloodpact: sigilBloodPact,
};

/** The sigil for a card id, falling back to the arcane seal. Never null. */
export function sigilFor(id: string): Glyph {
  return CARD_SIGILS[id] ?? sigilSeal;
}
