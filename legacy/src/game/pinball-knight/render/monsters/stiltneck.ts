/**
 * STILTNECK — a spotted, long-necked beast walking on four lashed timber
 * stilts, with a pannier of lit bombs strapped over its withers. It reaches
 * back, takes one in its teeth, and whips its whole neck round like a
 * shepherd's sling to hurl it down the room.
 *
 * ── BUILT FROM A REFERENCE SHEET AS A SHAPE SPEC, NOT AS PIXELS ─────────────
 * Same discipline as sporeling.ts, hound.ts, jester.ts and rotortail.ts. The
 * reference was a 20-frame single-facing sheet — an idle, a five-beat walk, the
 * grab / coil / whip / release of the throw, a wobble, and a topple → sprawl —
 * painted in saturated cartoon yellows on a baked-in checkerboard. Importing
 * those pixels would have bought ONE facing, a foreign palette, a foreign
 * lighting model, and a neck frozen at whatever handful of angles the sheet
 * happened to draw. So it is re-authored as a painter parameterised by
 * (dir, phase, pose), which buys N/S/E, the Cold Crypt palette, and — the part
 * that matters most here — a neck that is INTEGRATED FROM A TURN RATE rather
 * than drawn, so the sling can sit at any point of its swing in any frame.
 *
 * ── THE PALETTE PROBLEM THIS FILE SOLVES, AND HOW IT INVERTS THE ROSTER ─────
 * A giraffe is golden with dark brown blotches. In this palette the only warm
 * gold is the TORCH RAMP (14-18), and render/palette.ts's census is blunt about
 * what that ramp is currently worth: 2.26% of all actor pixels, almost all of it
 * a goblin's lantern and a few glow dots. "The only warmth down here" has never
 * been on a body.
 *
 * So this is the first creature whose BODY is painted out of that ramp rather
 * than its accents — the rotortail has brass rivets and glowing goggles and is
 * still a brown animal; this one's coat, belly and muzzle are all torch, and its
 * only browns are the gear strapped to it. Measured on the E idle cel, the neck
 * band is ~20% torch and the shin band is 0%, which is the whole palette plan in
 * two numbers (and is what stiltneck.test.ts pins). The bands:
 *   · coat — flame (15-17). Amber body, orange shade band, pale-gold rim.
 *   · belly / muzzle — one rung up (16-18), so the underside catches light
 *     without leaving the family.
 *   · spots — leather (26-27), painted as INKLESS lozenges. Against 16 that is a
 *     value drop of most of the ramp, which is the whole giraffe read, and the
 *     one place a repeated mark earns its pixels on this body.
 *   · stilts / pannier — leather (26-28), the palette's only wood. Its
 *     BOUNCE_FOR tone is 4 (cold stone), so four thin poles pick up a cool
 *     contact rim instead of dissolving into a torch pool. They are also the
 *     only browns on the figure, which is what makes "gold animal, brown gear"
 *     a thing a measurement can check rather than a thing a comment claims.
 *   · bombs — void and ink (0-2), the darkest thing the palette has, sat on the
 *     brightest body in the game. Nothing else needs to be done to make the
 *     ordnance read.
 *
 * THE EYES ARE COLD, AND THAT IS DELIBERATE. The roster's shared eye vocabulary
 * is an ember core with a hot halo (sporeling, hound, rotortail) — which on this
 * creature would be a torch-ramp dot on a torch-ramp head, i.e. invisible. So
 * the stiltneck's eyes are ARCANE (29-31), the only cold hue on it, and the only
 * cold thing in its silhouette. Same job as everyone else's embers, done with
 * the opposite half of the palette because the body took the warm half.
 *
 * ── THE SILHOUETTE IS THE MECHANIC ──────────────────────────────────────────
 * Two shapes, and both are gameplay:
 *   1. FOUR THIN POLES WITH DAYLIGHT BETWEEN THEM, and a very high centre of
 *      mass sat on top. That is PAIN_BY_KIND's highest entry drawn rather than
 *      written: the thing looks like it goes over if you hit it hard, and it
 *      does (pain chance is momentum-scaled).
 *   2. A NECK THAT IS THE LONGEST SINGLE ELEMENT ON IT. Nothing else is tall
 *      and thin, so a stiltneck is identifiable in pure silhouette at any
 *      distance — which is the read you need in order to leave the ground its
 *      bomb is about to land on.
 */
import {
  type Pt,
  type Ramp,
  CX,
  GROUND,
  limbShaded,
  ellShaded,
  plateShaded,
  detail as figDetail,
  glow as figGlow,
  groundShadow,
} from "../../engine/render/figure";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

/** Coat: the torch ramp, spent on a body for the first time in the roster.
 *  NOT [14,15,16] — ember (14, 0x7a3b12) is a dark brown and `ellShaded` paints
 *  the SHADE tone over the whole shape, so the first pass produced a mud-brown
 *  animal with a gold rim. Starting at 15 puts real gold on both bands. */
const R_COAT: Ramp = [15, 16, 17];
/** Far-side limbs and the neck's shadow side: one rung down, so near reads in
 *  front of far without changing family. */
const R_COAT_DK: Ramp = [14, 15, 16];
/** Belly, muzzle, inner ear: brighter than the coat's mid but capped at 17.
 *
 *  NOT [16,17,18], and the cap is a POST-CHAIN constraint, not taste. The
 *  pixel pass blooms anything over BLOOM_THRESHOLD 0.7 in linear luma; palette
 *  18 sits at ~0.90 and 17 at ~0.72, so a belly field of 18 glows like a torch
 *  core and the quantizer then shreds the halo into speckle (measured in-game
 *  2026-07-29 — the "white blobs" on the first shipped stiltneck were its own
 *  muzzle blooming). 18 is for EMITTERS: the fuse spark, torches, nothing that
 *  is meat. 17's overshoot past the threshold is k≈0.07 — invisible. */
const R_BELLY: Ramp = [15, 16, 17];
/** Stilts, pannier, straps: the palette's only wood. Bounces cold (BOUNCE_FOR
 *  [26]=4), which is the entire reason four 5px poles stay visible on a floor. */
const R_WOOD: Ramp = [26, 27, 28];
/** Far-side stilts: darker still, so the back pair sits behind the front pair. */
const R_WOOD_DK: Ramp = [1, 26, 27];
/** Rope lashings binding hoof to pole. Skin reads as hemp cord and is the one
 *  warm-neutral the coat does not already own. */
const R_ROPE: Ramp = [23, 24, 25];
/** Iron banding on the stilts, and the bomb's collar. */
const R_IRON: Ramp = [19, 20, 21];
/** THE BOMB: void, ink, stone-dark. The darkest thing available, and it is sat
 *  on the brightest body in the game — the contrast does all the work. */
const R_BOMB: Ramp = [0, 1, 2];
/** Eyes. The only cold hue on the creature — see the header. */
const R_EYE: Ramp = [29, 30, 31];

/** Spot fill. Painted with `figDetail` (no ink) so blotches stay marks on the
 *  coat rather than becoming a second set of outlined shapes. */
const SPOT = 27;
/** Fuse spark core / halo. The roster's glow vocabulary, on the one part of this
 *  creature dark enough for it to register. */
const SPARK_CORE = 16;
const SPARK_HOT = 18;

// ── PROPORTIONS ─────────────────────────────────────────────────────────────
//
// The cel is 128 tall with GROUND at 118, and this creature wants all of it. The
// three heights below are the whole design: poles for the bottom third, a low
// barrel in the middle, and a neck that owns the top half.

/** Where a stilt is strapped to the animal's own leg. Above this it is a golden
 *  limb, below it is dark wood — the joint IS the "on stilts" read, so it sits
 *  high enough to be a third of the leg rather than a detail near the floor. */
const STILT_TOP = 92;
/**
 * Where a pole ENDS, four px shy of the shared GROUND line.
 *
 * Not a stylistic choice — a cel budget. `limbShaded` strokes its selout with
 * `lineCap: "round"`, so a 6px pole's ink bulges ~6px PAST its endpoint; land
 * that endpoint on GROUND (118) and the sprite's real bottom is 124 in a 128
 * box, leaving nothing for the lean. Every leaning frame in the clip table — the
 * throw's follow-through, both stumbles, the first death beat — then pushes the
 * outer foot through the bottom of the cel and out of the atlas.
 *
 * Four px up costs nothing visually: `groundShadow` is drawn at this same line
 * and is ~8px deep, so the feet sit INSIDE the shadow pool rather than above it.
 */
const FOOT_Y = GROUND - 4;
/** Barrel centre. */
const BODY_Y = 64;
/** How long the neck is, cel px. The single longest element on the creature,
 *  and BOUNDED BY THE CEL rather than by taste: the head sits at the end of it
 *  and the ossicones sit past that, so every px added here comes straight off
 *  the top margin. The first pass ran 46 and sheared the horns off. */
const NECK_LEN = 32;

/**
 * ── THE NECK, INTEGRATED RATHER THAN DRAWN ──────────────────────────────────
 *
 * The neck is not a set of hand-posed curves at the angles the reference sheet
 * happened to use. It is a path integrated from a TURN RATE: start at the
 * withers heading at angle `a0` (0 = straight up the screen, positive = toward
 * the creature's front), turn uniformly to `a1` at the tip, stepping a fixed
 * arc length each segment.
 *
 * That one choice buys everything the sling needs:
 *   · a0 ≈ a1 is a straight neck; a0 far from a1 is a coil, and the SIGN of the
 *     difference is which way it coils. Idle, reach-back, wind and whip are four
 *     pairs of numbers, not four drawings.
 *   · the head lands wherever the curve ends, so the mouth is always ON the neck
 *     — there is no pose in which the skull detaches, which is exactly the bug a
 *     hand-placed head produces the first time the wind angle is retuned.
 *   · the tip TANGENT is a1, so the head can be rotated by the curve's own
 *     heading and the whole thing reads as one animal rather than as a head
 *     riding a hose.
 *
 * `lat` foreshortens the lateral component: seen head-on (S/N) a sling that
 * sweeps through the screen plane must sweep through a NARROW arc, or the
 * creature reads as bending sideways rather than as reaching toward you. Same
 * projection idea as the rotortail's rotor squash, applied to a curve.
 */
function neckPath(base: Pt, a0: number, a1: number, lat: number, segs = 7): Pt[] {
  const pts: Pt[] = [base];
  let x = base[0];
  let y = base[1];
  const step = NECK_LEN / segs;
  for (let i = 1; i <= segs; i++) {
    // Sample the heading at the segment's MIDPOINT — sampling at the start
    // biases every curve toward its opening angle and the tip lands short.
    const t = (i - 0.5) / segs;
    const a = a0 + (a1 - a0) * t;
    x += Math.sin(a) * step * lat;
    y -= Math.cos(a) * step;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * THE NECK AS A TUBE — one pass per shading band over the WHOLE path.
 *
 * The obvious way to paint a curved limb is a chain of `limbShaded` capsules
 * along it, and it looks right in isolation. It is not: `limbShaded` strokes its
 * own 3.2px selout ink first, so capsule i+1's OUTLINE lands squarely on capsule
 * i's fill, and a seven-segment neck built that way is mostly outline by area.
 *
 * That is not a guess. Running the palette census (the same luma-weighted snap
 * the atlas uses) over the first version put ink at 35.9% and leather at 26.6%
 * of the creature, against 10.8% for the torch ramp — i.e. a file whose whole
 * header is "this is the roster's one GOLD monster" was painting a brown one,
 * and its biggest gold shape was the thing eating itself.
 *
 * Passing band-at-a-time fixes it for free: every stroke inside a pass is the
 * same colour, so overlap is invisible, and the ink stays on the silhouette
 * where selout is supposed to put it. The four passes and their offsets are
 * lifted verbatim from `limbShaded` so the neck shades like every other limb in
 * the game rather than like a special case.
 */
function neckTube(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  const wAt = (i: number): number => 12.5 - i * 0.85;
  const pass = (mul: number, idx: number, ox: number, oy: number, add = 0): void => {
    for (let i = 0; i < pts.length - 1; i++) {
      figDetail(ctx, [[pts[i][0] + ox, pts[i][1] + oy], [pts[i + 1][0] + ox, pts[i + 1][1] + oy]], wAt(i) * mul + add, idx);
    }
  };
  pass(1, 1, 0, 0, 6.4);        // selout ink
  pass(1, 15, 1.6, 1.6);        // shade, offset down-right
  pass(0.82, 16, 0, 0);         // mid fill
  pass(0.34, 17, -1.4, -1.6);   // warm rim, offset up-left toward the key
}

/** Where the neck leaves the body, per facing. */
function neckBase(dir: Dir): Pt {
  return [CX + (dir === "E" ? 10 : 0), BODY_Y - 9];
}

/** Which way "forward" is on screen for this facing. N faces away, so its whole
 *  swing mirrors — without this the creature slings the bomb over its shoulder
 *  toward the camera while walking away from it. */
function facingSign(dir: Dir): number {
  return dir === "N" ? -1 : 1;
}

/** Lateral foreshortening of the neck curve. See neckPath. */
function neckLat(dir: Dir): number {
  return dir === "E" ? 1 : 0.42;
}

/**
 * Blotches, scattered along a shape with a fixed pattern.
 *
 * Drawn as short thick strokes rather than as circles: a giraffe's markings are
 * irregular polygons, and a round-capped stroke of a few px length crushes to a
 * lozenge where a circle crushes to a dot, and a field of dots is spots on a
 * ladybird. Painted with `figDetail`, so they have NO ink — a spot is a mark on
 * the coat, and outlining each one would turn the body into a stained-glass
 * window at the 72px grid.
 *
 * The offsets are a fixed table, not a random draw: the atlas is painted once
 * per session and a random pattern would put a different animal in the walk clip
 * than in the idle clip.
 */
const SPOT_FIELD: Array<[number, number, number, number]> = [
  // dx, dy, length, angle. FIVE, not six — at the 81-texel grid each blotch is
  // a ~3x2-texel mark on a barrel ~28 texels wide, and the live-atlas census
  // showed the marks (plus their neighbours' ink) outweighing the coat they
  // decorate. The giraffe read needs the pattern to be legible, which means
  // GOLD BETWEEN THE SPOTS more than it means spots.
  [-0.58, -0.32, 4, 0.4],
  [-0.05, -0.5, 4, -0.3],
  [0.5, -0.26, 4, 0.6],
  [-0.45, 0.32, 4, -0.5],
  [0.4, 0.28, 4, -0.4],
];

function spotBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  // Clipped to the barrel it decorates, inset so a spot never touches the ink
  // outline — a blotch that reaches the silhouette edge reads as a bite taken
  // out of the animal.
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.84, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.clip();
  for (const [fx, fy, len, ang] of SPOT_FIELD) {
    const x = cx + fx * rx;
    const y = cy + fy * ry;
    figDetail(ctx, [[x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5], [x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5]], 4.6, SPOT);
  }
  ctx.restore();
}

/** Spots down the neck: ALTERNATE interior segments, not every one.
 *
 *  The neck tube is ~7 texels wide at the stored grid. A spot per segment plus
 *  the mane plus two selout edges left roughly two texels of actual coat per
 *  row — the live atlas censused the neck at more leather than torch, on the
 *  one creature whose whole identity is "the gold one". Half the spots reads
 *  MORE like a giraffe, because the pattern needs ground to sit on. */
function spotNeck(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  for (let i = 1; i < pts.length - 1; i += 2) {
    const [x, y] = pts[i];
    const side = i % 2 === 0 ? 1 : -1;
    figDetail(ctx, [[x - 1.2, y - side * 0.6], [x + 1.2, y + side * 0.6]], 3.8, SPOT);
  }
}

/**
 * ONE BOMB — a black iron sphere, a cord fuse, and a spark.
 *
 * Three parts, and each is load-bearing at the 72px grid. The sphere alone is a
 * dot. Sphere + collar reads as a bomb. Sphere + collar + a hot spark is the
 * only thing on the creature that says the fuse is LIT, which is the difference
 * between cargo and a countdown — and it is the same mark on the pannier, in the
 * mouth, and on the shot in flight, so the player learns it once.
 *
 * @param a fuse angle, radians from vertical — the cord flops with the swing
 */
function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a = 0): void {
  ellShaded(ctx, x, y, r, r, R_BOMB, 0, { rim: false });
  // Specular: one short stroke on the upper-left, where the fixed key light is.
  // Without it a black sphere is a hole in the sprite.
  figDetail(ctx, [[x - r * 0.5, y - r * 0.45], [x - r * 0.15, y - r * 0.6]], Math.max(1.2, r * 0.28), 3);
  // Collar + cord.
  const cx2 = x + Math.sin(a) * r * 0.35;
  const cy2 = y - Math.cos(a) * r * 0.9;
  ellShaded(ctx, cx2, cy2, r * 0.36, r * 0.26, R_IRON, 0, { rim: false });
  const tipX = cx2 + Math.sin(a + 0.5) * r * 1.1;
  const tipY = cy2 - Math.cos(a + 0.5) * r * 1.1;
  figDetail(ctx, [[cx2, cy2], [tipX, tipY]], Math.max(1.2, r * 0.22), 27);
  figGlow(ctx, tipX, tipY, Math.max(1.6, r * 0.34), SPARK_CORE, SPARK_HOT);
}

/**
 * ONE STILT + the golden leg above it.
 *
 * The joint is the whole point: a warm limb ending in a rope collar on a dark
 * pole. Both halves must be present at every facing or the creature is just a
 * tall animal, and "tall animal" is a silhouette the roster already has room
 * for but no mechanic attached to.
 *
 * @param topX  where the leg leaves the body
 * @param footX where the pole meets the floor (the two differ — the stilts
 *              SPLAY, which is what makes the stance read as precarious)
 * @param lift  how far this foot is off the ground, px
 * @param far   draw with the darker ramps (the off-side pair)
 */
function drawStilt(ctx: CanvasRenderingContext2D, topX: number, topY: number, footX: number, lift: number, far: boolean, snap = 0): void {
  // A far pole's foot lands HIGHER up the screen — the only depth cue a
  // quadruped seen head-on gets, and the thing that keeps four poles from
  // merging into one bar at the ankle row.
  const strapY = STILT_TOP - lift * 0.5;
  const strapX = topX + (footX - topX) * 0.25;
  // SNAP: how much of the pole has broken off. A toppling stiltneck does not
  // ride four intact poles down — they go first, which is both the reference
  // sheet's read and the only way the death frames fit the cel at all (a full
  // pole on a body leaning past half a radian reaches well under the floor).
  const keep = 1 - snap;
  const foot = strapY + (FOOT_Y - lift - (far ? 9 : 0) - strapY) * keep;
  footX = strapX + (footX - strapX) * keep;
  // The pole. Drawn first and full length so the rope collar can sit on top of
  // the seam between wood and leg.
  limbShaded(ctx, [strapX, strapY], [footX, foot], 6, far ? R_WOOD_DK : R_WOOD);
  // ONE iron band, dark. The first pass drew two in steel-mid, and between them
  // and `limbShaded`'s cold BOUNCE line the poles came out reading as grey
  // scaffolding rather than as lashed timber — a thin limb has no room for three
  // separate light marks on it.
  {
    const bx = strapX + (footX - strapX) * 0.55;
    const by = strapY + (foot - strapY) * 0.55;
    figDetail(ctx, [[bx - 4, by], [bx + 4, by]], 2.2, 19);
  }
  // Foot block: a wider pad, so the pole ends in something rather than stopping.
  // A broken pole ends in a splintered stub, not a foot block.
  if (snap > 0.2) {
    figDetail(ctx, [[footX - 3, foot + 2], [footX, foot - 3], [footX + 3, foot + 1]], 2, 26);
  } else {
    ellShaded(ctx, footX, foot - 2, 5.5, 3, far ? R_WOOD_DK : R_WOOD, 0, { rim: false });
  }
  // The animal's own leg, golden, hip → collar.
  limbShaded(ctx, [topX, topY], [strapX, strapY], 6.5, far ? R_COAT_DK : R_COAT);
  // ROPE LASHING — three wraps at the joint. This is the single detail that
  // turns "long legs" into "strapped onto poles", so it gets the pixels.
  for (let w = -1; w <= 1; w++) {
    figDetail(ctx, [[strapX - 4.5, strapY + w * 3], [strapX + 4.5, strapY + w * 3 + 1]], 2, far ? R_ROPE[0] : R_ROPE[1]);
  }
}

/** The four stilt anchors for a facing: [hipX, hipY, footX, far]. */
function stiltPlan(dir: Dir, cx: number): Array<[number, number, number, boolean]> {
  if (dir === "E") {
    // Profile: fore and hind pairs, each with a near and a far leg. The far leg
    // of each pair is offset back and up so the two do not paint as one bar.
    return [
      [cx + 12, BODY_Y + 10, cx + 22, true],
      [cx - 12, BODY_Y + 10, cx - 25, true],
      [cx + 15, BODY_Y + 12, cx + 28, false],
      [cx - 9, BODY_Y + 12, cx - 15, false],
    ];
  }
  // Head-on / from behind: the far pair sits INSIDE the near pair and higher up
  // the screen, which is the only depth cue a front-facing quadruped gets.
  return [
    [cx - 7, BODY_Y + 8, cx - 10, true],
    [cx + 7, BODY_Y + 8, cx + 10, true],
    [cx - 14, BODY_Y + 12, cx - 28, false],
    [cx + 14, BODY_Y + 12, cx + 28, false],
  ];
}

/**
 * THE PANNIER — a leather bomb bag strapped over the withers, with live bombs
 * standing in it.
 *
 * It has to read from BEHIND as well as from the front, because a stiltneck
 * walking away from you is still a stiltneck about to throw. So it sits on the
 * TOP of the barrel where nothing occludes it at any facing, and the bombs stand
 * proud of its rim rather than nesting inside it.
 *
 * @param loaded how many bombs are still in the bag (one leaves during a throw)
 */
function drawPannier(ctx: CanvasRenderingContext2D, dir: Dir, cx: number, cy: number, loaded: number): void {
  const px = cx + (dir === "E" ? -9 : 0);
  const py = cy - 12;
  // Bombs first, so the bag's rim overlaps their bases and they sit IN it.
  const slots: number[] = dir === "E" ? [-6, 2] : [-6, 3];
  for (let i = 0; i < Math.min(loaded, slots.length); i++) {
    drawBomb(ctx, px + slots[i], py - 4, 5, -0.3 + i * 0.5);
  }
  // The bag: a shallow trapezoid slung across the spine. HALF the width it
  // started at — at ±15 on a ±24 barrel it covered the whole animal, and a
  // stiltneck rendered as a dark leather slab on legs is not a giraffe, it is a
  // pack mule. The bag is CARGO; the coat is the creature.
  plateShaded(
    ctx,
    [[px - 10, py - 1], [px + 10, py - 1], [px + 8, py + 7], [px - 8, py + 7]],
    R_WOOD,
  );
  // Girth strap round the barrel, and a steel buckle on it.
  figDetail(ctx, [[px - 9, py + 4], [px - 11, py + 15]], 2.6, 26);
  figDetail(ctx, [[px + 9, py + 4], [px + 11, py + 15]], 2.6, 26);
  ellShaded(ctx, px + 11, py + 11, 2.2, 1.9, R_IRON, 0, { rim: false });
}

/**
 * THE HEAD, in the neck's own frame.
 *
 * Rotated by the curve's tip TANGENT plus a fixed offset, so the muzzle leads
 * the swing without ever having to be posed. A giraffe's skull sits at an angle
 * to its neck — hence HEAD_TILT — and carrying that offset in the transform is
 * what makes the head look attached during the whip instead of dragged.
 *
 * @param bite a bomb clenched in the teeth (the middle of the sling)
 * @param dead X eyes, lolling tongue
 */
const HEAD_TILT = 1.4;
function drawHead(ctx: CanvasRenderingContext2D, tip: Pt, tangent: number, dir: Dir, sign: number, opts: { bite?: boolean; dazed?: number; dead?: boolean; scale?: number; tilt?: number } = {}): void {
  const { bite = false, dazed = 0, dead = false, scale = 1, tilt = HEAD_TILT } = opts;
  ctx.save();
  ctx.translate(tip[0], tip[1]);
  // THE FRAME. The head is drawn along its local +x (muzzle forward, ossicones
  // on local -y); the neck's tip TANGENT is measured from screen-up. So aligning
  // the head with the neck is `tangent - π/2`, and `tilt` is how far off the
  // neck's axis the skull is cocked — about 80° at rest, which is what a
  // browsing giraffe looks like.
  //
  // The first version used `tangent + tilt` with no −π/2, which is right at
  // exactly one neck angle and wrong everywhere else: at full whip the muzzle
  // ended up pointing BACK along a neck that was pointing forward. Which is why
  // `tilt` is now a pose input — the sling drives it to ~0 at release, so the
  // head leads the throw instead of folding onto it.
  ctx.rotate(tangent + sign * (tilt - Math.PI / 2));
  ctx.scale(sign * scale, scale);
  // Skull — a wedge, longer than it is deep, running out along the local +x.
  ellShaded(ctx, 6, -2, 11, 7.5, R_COAT);
  // OSSICONES. Two knobbed horns, and the fastest way to say "giraffe" in a
  // silhouette — they break the skull's outline upward at every facing, which a
  // pair of ears alone does not.
  for (const s of [-1, 1]) {
    const ox = 2 + s * 4;
    limbShaded(ctx, [ox, -7], [ox - 1, -13], 2.4, R_COAT_DK);
    ellShaded(ctx, ox - 1, -14, 2, 1.8, R_WOOD, 0, { rim: false });
  }
  // Ear, swept back off the skull. COAT ramp, not the far-side one: this is
  // the near ear on a lit head, and in the atlas census the darker ramp was
  // reading as one more brown mass on the creature's most-looked-at band.
  plateShaded(ctx, [[-2, -4], [-11, -9], [-13, -3], [-4, 1]], R_COAT, { rim: false });
  // Muzzle: the pale band, and the only place the belly ramp appears above the
  // body. A giraffe's face is dark-eyed and light-nosed and the light nose is
  // what stops the head reading as a golden blob at distance.
  ellShaded(ctx, 15, 1, 6.5, 5, R_BELLY);
  // Nostril + the mouth line. LOAD-BEARING: without a mouth behind it, a bomb
  // held in the teeth reads as a bomb floating in front of the face.
  figDetail(ctx, [[18, -1], [19.5, -1]], 1.6, 26);
  figDetail(ctx, [[11, 4], [19, 4]], 1.6, 26);
  if (dead) {
    // Tongue out — the reference's one piece of pure cartoon, and the roster has
    // no other way to say "this one is finished" on a face this small.
    plateShaded(ctx, [[15, 4], [22, 7], [20, 11], [14, 7]], [11, 12, 13] as Ramp, { rim: false });
  }
  // EYE — high and to the back of the skull, where a browser's eye actually
  // sits, and the only cold thing on the animal (see the header).
  const ex = 2;
  const ey = -4;
  if (dead) {
    for (const s of [-1, 1]) {
      figDetail(ctx, [[ex - 3, ey - 3 * s], [ex + 3, ey + 3 * s]], 1.8, 1);
    }
  } else if (dir === "N") {
    // From behind there is no eye, only the back of a skull. A face on the back
    // of a head is the bug every one of these painters has had once.
    figDetail(ctx, [[ex - 5, ey], [ex + 4, ey + 1]], 2, 15);
  } else {
    ellShaded(ctx, ex, ey, 4.4, 3.8 + dazed * 1.2, [0, 0, 1] as Ramp, 0, { rim: false });
    ellShaded(ctx, ex, ey, 3, 2.7, R_EYE, 0, { rim: false });
    figGlow(ctx, ex - 0.6, ey - 0.6, 1.3, 31, 22);
    // Lashes / brow, one stroke. The cheapest expression in pixel art.
    figDetail(ctx, [[ex - 4, ey - 5], [ex + 4, ey - 4]], 1.8, 14);
  }
  if (bite) drawBomb(ctx, 24, 5, 6, 1.2);
  ctx.restore();
}

/**
 * One stiltneck frame.
 *
 * @param dir   facing — E is the profile the sling reads best in, N hides the
 *              face and shows the pannier, S is the head-on approach
 * @param phase -1..1 gait phase; drives the body sway, the neck's idle drift and
 *              the counter-swing of the legs
 * @param opts  pose: `a0`/`a1` neck heading at base and tip · `bite` bomb in the
 *              teeth · `loaded` bombs left in the pannier · `lean` body tilt ·
 *              `lift` per-leg foot lift · `arcs` swing streaks · `dazed`
 *              wobbling on the stilts · `sprawl` down, stilts snapped
 */
function stiltneckFrame(
  dir: Dir,
  phase: number,
  opts: {
    a0?: number;
    a1?: number;
    bite?: boolean;
    loaded?: number;
    lean?: number;
    arcs?: number;
    dazed?: number;
    sprawl?: boolean;
    headScale?: number;
    headTilt?: number;
    sink?: number;
    snapped?: number;
  } = {},
): FramePaint {
  return (ctx) => {
    const sign = facingSign(dir);
    const {
      a0 = 0.22 * sign,
      a1 = -0.12 * sign,
      bite = false,
      loaded = 2,
      lean = 0,
      arcs = 0,
      dazed = 0,
      sprawl = false,
      headScale = 1,
      headTilt = HEAD_TILT,
      sink = 0,
      snapped = 0,
    } = opts;

    // ── SPRAWL ───────────────────────────────────────────────────────────
    // Flat on the floor, stilts snapped into loose sticks, bombs rolled clear,
    // smoke still coming off. The one pose with no vertical read at all — which
    // is exactly why it is worth painting: a creature whose whole identity is
    // HEIGHT has to visibly stop being tall.
    if (sprawl) {
      groundShadow(ctx, CX, GROUND - 2, 30);
      // Broken poles, scattered. Drawn first, so the body lies on top of them.
      for (const [x0, y0, x1, y1] of [[-40, 2, -22, -2], [-18, 5, 0, 7], [12, 0, 30, 3], [20, 7, 36, 4]] as Array<[number, number, number, number]>) {
        limbShaded(ctx, [CX + x0, GROUND + y0 - 6], [CX + x1, GROUND + y1 - 6], 4.5, R_WOOD_DK);
      }
      // Barrel on its side.
      ellShaded(ctx, CX - 4, GROUND - 12, 24, 11, R_COAT);
      spotBody(ctx, CX - 4, GROUND - 12, 24, 11);
      ellShaded(ctx, CX - 6, GROUND - 7, 16, 5, R_BELLY, 0, { rim: false });
      // The pannier spilled, and two bombs on the flags beside it.
      plateShaded(ctx, [[CX - 26, GROUND - 22], [CX - 6, GROUND - 24], [CX - 4, GROUND - 15], [CX - 24, GROUND - 13]], R_WOOD);
      drawBomb(ctx, CX - 34, GROUND - 6, 5.5, 1.4);
      drawBomb(ctx, CX - 45, GROUND - 3, 5, -1.1);
      // The neck laid out along the floor — a long limp curve, which is the
      // shape the whole creature is remembered by and so must survive death.
      const laid = neckPath([CX + 8, GROUND - 22], 1.6, 2.0, 1);
      neckTube(ctx, laid);
      spotNeck(ctx, laid);
      drawHead(ctx, laid[laid.length - 1], 2.0, dir, 1, { dead: true, tilt: 0.1 });
      // Smoke, still rising off the wreck.
      for (const [dx, dy] of [[-20, -30], [-8, -36], [8, -33]] as Pt[]) {
        ellShaded(ctx, CX + dx, GROUND + dy, 4, 3, [2, 3, 4] as Ramp, 0, { rim: false, bounce: false });
      }
      return;
    }

    // ── STANDING ─────────────────────────────────────────────────────────
    const sway = Math.sin(phase * Math.PI) * 2;
    const cx = CX + sway * 0.6;
    const cy = BODY_Y + sway;
    const narrow = dir === "E" ? 1 : 0.72;

    groundShadow(ctx, CX, FOOT_Y, 26);

    // The whole animal leans as ONE rigid body. A stiltneck that tips its body
    // while its poles stay planted is a creature standing still; a stiltneck
    // that tips everything is one going over. The stilts are INSIDE this
    // transform for that reason — they are what is being tipped.
    //
    // PIVOTED AT THE BARREL, not at the floor, and that is a cel constraint
    // rather than a physical claim. This creature is ~100px tall in a 128px box.
    // Rotating that about the FEET — which is what actually happens when
    // something on stilts goes over — swings the head 75px sideways at the
    // topple angles the death clip uses, and the head leaves the cel. About the
    // barrel, the top and the bottom swing opposite ways and mostly cancel.
    // `sink` then drops the whole figure, which is the part of falling the
    // rotation cannot express.
    ctx.save();
    ctx.translate(cx, cy + sink);
    ctx.rotate(lean);
    ctx.translate(-cx, -cy);

    // ── STILTS ── far pair, then near pair (the plan is already in that order).
    const plan = stiltPlan(dir, cx);
    plan.forEach(([hx, hy, fx, far], i) => {
      // Contralateral gait: diagonally-opposite legs lift together, which is how
      // a quadruped walks and what stops the four poles pumping in unison.
      const beat = i === 0 || i === 3 ? phase : -phase;
      const lift = Math.max(0, beat) * (dir === "E" ? 7 : 5) + dazed * (i % 2 ? 5 : 0);
      drawStilt(ctx, hx, hy + sway, fx + dazed * (i % 2 ? 3 : -3), lift, far, snapped);
    });

    // ── BARREL ── long and shallow. A giraffe's body is small for its height,
    // and keeping it small is what leaves the neck room to be the silhouette.
    const bw = 24 * narrow;
    ellShaded(ctx, cx, cy, bw, 16, R_COAT);
    if (dir === "N") {
      // Dorsal stripe instead of a belly: from behind, an underside is a lie the
      // N sheet tells very loudly.
      ellShaded(ctx, cx, cy + 1, 5, 13, R_COAT_DK, 0, { rim: false });
    } else {
      // A BAND along the underside, not a patch over the front. At 0.7×15 it
      // covered the barrel and took the spots with it, and a giraffe with no
      // spots is a camel.
      ellShaded(ctx, cx + (dir === "E" ? -3 : 0), cy + 9, bw * 0.58, 5, R_BELLY, 0, { rim: false });
    }
    spotBody(ctx, cx, cy, bw, 16);
    // Tuft tail, off the back. Small, but it closes the rear of the silhouette.
    if (dir !== "N") {
      const tx = cx - (dir === "E" ? 22 : 18) * narrow;
      limbShaded(ctx, [tx, cy - 2], [tx - 4, cy + 12 + sway], 2.6, R_COAT_DK);
      ellShaded(ctx, tx - 5, cy + 15 + sway, 3.4, 4, R_WOOD, 0, { rim: false });
    }

    // ── SWING ARCS ── the sweep the neck has just come through, drawn BEFORE the
    // neck so the neck crosses in front of its own wash. Arcs, not straight
    // streaks: this is a sling, and a straight line behind a rotating limb reads
    // as a dash rather than as a rotation.
    if (arcs > 0.02) {
      const base = neckBase(dir);
      // PALETTE-EXACT, not a translucent stroke. The first pass drew these as
      // `rgba(255,217,138,a)` arcs — warm gold, and they crushed to COLD BLUE
      // DASHES, because a thin semi-transparent line antialiases into the void
      // behind it and the 32-colour snap then routes that blend onto whichever
      // family happens to be nearest in the luma-weighted metric. Which is never
      // the one you asked for. Real indices land exactly where they are put, and
      // the fade-in becomes a COUNT of arcs rather than an alpha ramp — which is
      // the pixel-art answer to "half a line" anyway.
      const sweep = (rf: number, idx: number): void => {
        const pts: Pt[] = [];
        for (let k = 0; k <= 9; k++) {
          const a = -Math.PI * 0.95 + (k / 9) * Math.PI * 0.8;
          pts.push([base[0] + Math.cos(a) * sign * NECK_LEN * rf, base[1] + Math.sin(a) * NECK_LEN * rf]);
        }
        figDetail(ctx, pts, 2.4, idx);
      };
      if (arcs > 0.35) sweep(1.2, 17);
      sweep(0.88, 15);
    }

    // ── PANNIER ── over the withers, under the neck's root.
    drawPannier(ctx, dir, cx, cy, loaded);

    // ── NECK ── tapering base → tip, painted as overlapping capsules so the
    // curve is a tube rather than a polyline. Drawn root-first so each segment
    // laps the one before it and the joints never show as notches.
    const pts = neckPath([cx + (dir === "E" ? 10 : 0), cy - 9], a0, a1, neckLat(dir));
    neckTube(ctx, pts);
    // Mane: a dark ridge down the back edge of the neck. It is what gives a
    // smooth tube a FRONT and a BACK, and therefore what makes the coil legible
    // as a coil rather than as a bent pipe.
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const d = Math.hypot(dx, dy) || 1;
      const off = 3.8 - i * 0.2;
      figDetail(ctx, [[x0 + (dy / d) * off, y0 - (dx / d) * off], [x1 + (dy / d) * off, y1 - (dx / d) * off]], 2, 14);
    }
    spotNeck(ctx, pts);

    // ── HEAD ── at the tip, rotated by the curve's own tip tangent.
    drawHead(ctx, pts[pts.length - 1], a1, dir, sign, { bite, dazed, scale: headScale, tilt: headTilt });

    // ── WOBBLE MARKS ── a staggered stiltneck is a stack of poles losing its
    // balance, and a pose change alone is missable across a lit room. Two motion
    // ticks by the barrel and two sweat beads by the head, which is the roster's
    // existing "it is in trouble" vocabulary.
    if (dazed > 0.2) {
      for (const s of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const wx = cx + s * (30 + k * 5);
          figDetail(ctx, [[wx, cy - 6 + k * 7], [wx + s * 5, cy - 8 + k * 7]], 1.8, 4);
        }
      }
      const [hx, hy] = pts[pts.length - 1];
      for (const [dx, dy] of [[-13, -9], [11, -13]] as Pt[]) {
        ellShaded(ctx, hx + dx, hy + dy, 2.4, 3.2, [29, 30, 31] as Ramp, 0, { rim: false });
      }
    }

    ctx.restore();
  };
}

/**
 * THE SLING — the clip the whole family rests on, in four beats.
 *
 * 0.00 REACH  the neck folds BACK over the withers, muzzle into the pannier
 * 0.35 BITE   a bomb comes out in its teeth, neck still behind the shoulder
 * 0.62 WIND   coiled hard back and low, body leaning away, arcs starting
 * 1.00 WHIP   the neck has come all the way over and down in front, the bomb is
 *             gone, and the arcs are at full strength
 *
 * The beats change the SILHOUETTE, not just the head position: at 0.62 the whole
 * creature is bent backwards over its own hips, which is readable at any
 * distance, and at 1.00 it is bent forwards past its own front feet. A wind-up
 * that only moves a head is a wind-up nobody outside melee range ever sees, and
 * this thing fires from nine tiles away.
 */
function stiltneckSling(dir: Dir, t: number): FramePaint {
  const sign = facingSign(dir);
  // TWO segments, not one. A single monotonic sweep from "behind" to "in front"
  // sounds right and is wrong: it makes the WIND frame — the one the player has
  // to read — already lean forward, so the throw has no load in it. A sling
  // reaches back FURTHER before it comes over, which is the whole tell.
  //
  //   0.00 → 0.62   REACH → BITE → WIND: the neck folds back and rises into a
  //                 loaded C behind the withers
  //   0.62 → 1.00   WHIP: it comes all the way over and down in front
  const seg = t < 0.62 ? t / 0.62 : (t - 0.62) / 0.38;
  const [b0, b1, e0, e1] = t < 0.62 ? [-0.9, -2.3, -1.45, -0.55] : [-1.45, -0.55, 1.15, 2.15];
  const a0 = (b0 + (e0 - b0) * seg) * sign;
  const a1 = (b1 + (e1 - b1) * seg) * sign;
  // Body counter-leans: back through the wind, then whips forward on release —
  // the same weight transfer a person throwing a stone makes, and the reason the
  // stilts are inside the lean transform.
  const lean = (t < 0.62 ? -t * 0.16 : -0.1 + (t - 0.62) * 0.5) * sign;
  return stiltneckFrame(dir, -0.15 + t * 0.3, {
    a0,
    a1,
    // The bomb is in the teeth from the bite until just before release.
    bite: t > 0.28 && t < 0.9,
    loaded: t > 0.28 ? 1 : 2,
    lean,
    arcs: Math.max(0, (t - 0.45) * 2.2),
    // The head aligns with the neck as the whip releases — see drawHead. Held at
    // rest tilt through the load, so only the release re-frames the skull.
    headTilt: HEAD_TILT * (1 - Math.max(0, (t - 0.62) / 0.38) * 0.92),
    // Head-on, the head comes AT the camera on release. Growing it is the only
    // perspective cue a 2D cel has, and without it the S-facing throw reads as
    // the neck merely nodding.
    headScale: dir === "E" ? 1 : 1 + Math.max(0, t - 0.6) * 0.55,
  });
}

/** WOBBLE — staggered. Splayed poles, a tipping body, and the neck thrown out
 *  as a counterweight, which is what a thing on stilts actually does. */
function stiltneckWobble(dir: Dir, t: number): FramePaint {
  const sign = facingSign(dir);
  return stiltneckFrame(dir, 0.3 + t * 0.5, {
    a0: (-0.5 - t * 0.5) * sign,
    a1: (0.9 + t * 0.6) * sign,
    lean: (0.07 + t * 0.1) * sign,
    dazed: 0.5 + t * 0.45,
  });
}

export function makeStiltneckPaints(): ActorPaints {
  const dc = (dir: Dir): Partial<Record<string, FramePaint[]>> => {
    const sign = facingSign(dir);
    return {
      // Standing tall, browsing: a slow drift of the head and a shift of weight.
      idle: [
        stiltneckFrame(dir, -0.2, { a0: 0.24 * sign, a1: -0.16 * sign }),
        stiltneckFrame(dir, 0.25, { a0: 0.16 * sign, a1: -0.04 * sign }),
      ],
      // The stilt-walk: four beats, stiff and high-stepping, the neck rocking
      // half a beat behind the legs. The lag is the gag — a mass that heavy on
      // legs that thin cannot possibly move in time with them.
      walk: [
        stiltneckFrame(dir, -0.95, { a0: 0.3 * sign, a1: -0.2 * sign, lean: 0.03 * sign }),
        stiltneckFrame(dir, 0.05, { a0: 0.2 * sign, a1: -0.05 * sign, lean: 0.01 * sign }),
        stiltneckFrame(dir, 0.95, { a0: 0.12 * sign, a1: 0.08 * sign, lean: 0.03 * sign }),
        stiltneckFrame(dir, 0.05, { a0: 0.22 * sign, a1: -0.1 * sign, lean: 0.01 * sign }),
      ],
      attack: [stiltneckSling(dir, 0), stiltneckSling(dir, 0.35), stiltneckSling(dir, 0.62), stiltneckSling(dir, 1)],
      stumble: [stiltneckWobble(dir, 0), stiltneckWobble(dir, 1)],
      death: [
        // Hit — already losing the poles.
        stiltneckWobble(dir, 0.6),
        // Going over: the lean past the point of return, one pair of stilts off
        // the floor entirely.
        stiltneckFrame(dir, 0.8, { a0: -0.9 * sign, a1: 1.4 * sign, lean: 0.42 * sign, dazed: 1, sink: 8, snapped: 0.45, headTilt: 0.6 }),
        stiltneckFrame(dir, 0.4, { a0: -1.2 * sign, a1: 1.95 * sign, lean: 0.82 * sign, dazed: 1, loaded: 0, sink: 20, snapped: 0.85, headTilt: 0.2 }),
        stiltneckFrame(dir, 0, { sprawl: true }),
      ],
    };
  };
  return { S: dc("S"), N: dc("N"), E: dc("E") } as ActorPaints;
}
