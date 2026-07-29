/**
 * ROTORTAIL — a gnawer that bolted a salvaged rotor to a riveted flight cap and
 * never came down again. A fat brown barrel of a body, a slate helmet with the
 * goggles shoved up on the brow, two chisel teeth, a flat scaled paddle tail,
 * and a wooden propeller turning over the top of it all. It hauls a chewed
 * TIMBER overhead and hurls it down the room at you.
 *
 * ── BUILT FROM A REFERENCE SHEET AS A SHAPE SPEC, NOT AS PIXELS ─────────────
 * Same discipline as sporeling.ts, hound.ts and jester.ts. The reference was a
 * 16-frame single-facing sheet — a hover, four flight frames, a log carry, a
 * throw, and a four-beat stun → tumble → splat — painted in a warm sepia
 * palette on a baked-in checkerboard. Importing those pixels would have bought
 * ONE facing, a foreign palette and a foreign lighting model, and would have
 * frozen the creature at whatever cadence the sheet happened to be drawn at. So
 * it is re-authored as a painter parameterised by (dir, phase, pose), which
 * buys N/S/E, phase-driven animation, the Cold Crypt palette and — the part
 * that matters most here — a propeller that is COMPUTED rather than drawn, so
 * it can sit at any angle in any frame of any clip for free.
 *
 * ── THE PALETTE PROBLEM THIS FILE SOLVES ────────────────────────────────────
 * The reference is brown-fur / brown-leather / brass, which in this palette is
 * ONE family: leather-wood (26-28) is the only brown there is. A creature
 * painted entirely out of it is a single-hue blob, and the head — the thing you
 * actually read — would be the same colour as the body it sits on.
 *
 * So the figure is split into three hard bands up its height:
 *   · body / tail — leather (26-28), warm and dark. Its BOUNCE_FOR tone is 4,
 *     cold stone, so the silhouette picks up a cool contact rim on the shadow
 *     side instead of dissolving into a torch pool.
 *   · belly / muzzle — skin (23-25), a warm pale patch that gives the front of
 *     the body somewhere to catch the key light.
 *   · helmet — dark STEEL (19-20), cool and hard. A slate cap on a brown animal
 *     is a hue AND value break across the top third of the figure — the
 *     sporeling's mossy-skirt trick moved up to the head — and it reads as GEAR
 *     rather than as more fur.
 * Plus two small accents that carry the silhouette at the 72px grid: arcane
 * goggle lenses (29-31, the only cold hue on the creature) and brass rivets and
 * hub (15-17, the torch ramp the palette census found nobody spending).
 *
 * ── THE SILHOUETTE IS THE MECHANIC ──────────────────────────────────────────
 * A rotortail never lands. It rings you at altitude and drops timber, so the
 * shape has to say "up there, and not walking": everything hangs BELOW a wide
 * horizontal rotor disc, the feet are tucked, and the ground shadow is small
 * and a long way from the body. Nothing else in the roster has a horizontal bar
 * across its top, so a rotortail is identifiable in pure silhouette at any
 * distance — which is the read you need in order to move before the log lands.
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

/**
 * Pelt: leather-wood, the palette's only brown. Bounces cold (BOUNCE_FOR[26]=4).
 *
 * NOT the natural [26,27,28] reading of the family. `ellShaded` paints the SHADE
 * tone over the whole shape and insets the MID by 10%, so the mid is what a body
 * actually looks like — and leather's mid (27, 0x4a3222) is so dark that the
 * first pass produced a near-black barrel whose only brown was a two-pixel rim.
 * Skipping a rung to [27, 28, 24] puts real browns on BOTH bands and borrows
 * skin-mid (24) for a warm lit edge. Leaving 26 on the shade band was the
 * intermediate version and it failed the crush test in a specific way worth
 * recording: 26 (0x2a1c14) against the void (0x0b0d12) is a two-value
 * difference, so the barrel's whole outer crescent AND its ink outline vanished
 * and the creature read as a floating head with a tail. 26 stays where it
 * belongs — as the ink under 27, drawn by `inkIdx`.
 */
const R_PELT: Ramp = [27, 28, 24];
/** Far-side limbs: one step down, so near reads in front of far. NOTE the shade
 *  tone is 1 (ink) — a whole SHAPE filled with this paints near-black, so it is
 *  for thin limbs only. The tail learned that the hard way. */
const R_PELT_DK: Ramp = [1, 26, 27];
/** Paddle tail: LIGHTER than the pelt, not darker. Anatomically a beaver's tail
 *  is the dark part, but this room is dark and the tail's job here is to break
 *  the body's outline — a darker paddle on a dark floor is a shape you cannot
 *  see, which is the whole point of drawing it. */
const R_TAIL: Ramp = [27, 28, 25];
/** Belly and muzzle: skin, the warm pale patch on the front of the body. Pushed
 *  a rung lighter than the obvious [23,24,25] to stay clear of the pelt's new
 *  highlight tone — two adjacent shapes must not share a band. */
const R_BELLY: Ramp = [24, 25, 25];
/** Flight cap: dark steel. Cool and hard against the fur — this is the value
 *  break that stops the head merging into the body it sits on. */
const R_HELM: Ramp = [19, 19, 20];
/** Propeller blades: wood, with a skin-light tip so a blade keeps a pale edge
 *  when it crosses the dark body behind it. */
const R_BLADE: Ramp = [27, 28, 25];
/** The thrown timber — same wood family, read as a solid baulk not a blade. */
const R_TIMBER: Ramp = [26, 27, 28];
/** Brass: hub, rivets, buckles. The torch ramp, spent where it separates. */
const R_BRASS: Ramp = [14, 16, 17];
/** Goggle glass — the only cold hue on the creature. */
const R_GLASS: Ramp = [29, 30, 31];

/** Chisel teeth. Steel-light, following the hound's TOOTH convention: cold and
 *  bright is the maximum contrast available against a warm brown muzzle. */
const TOOTH = 22;
/** Ember eye core / halo — the roster's one eye vocabulary (sporeling, hound). */
const EYE_CORE = 18;
const EYE_HOT = 16;

// ── FLIGHT GEOMETRY ─────────────────────────────────────────────────────────

/** Body centre at rest. High in the cel, because the creature is AIRBORNE and
 *  the gap between it and its shadow is the whole read. */
const FLY_Y = GROUND - 58;
/** Rotor half-span, cel px. Deliberately wider than the body — the disc is the
 *  identifying mark, so it must be the widest thing in the silhouette. */
const ROTOR_R = 33;

/**
 * ── THE PROPELLER, DERIVED RATHER THAN DRAWN ────────────────────────────────
 *
 * The blades are not sprites at a few hand-picked angles; they are a rotor disc
 * projected into the cel every frame. Two numbers define the projection:
 *
 *   SQUASH — the camera looks DOWN at the world (the same tilt that makes every
 *            ground shadow an ellipse rather than a circle). A horizontal
 *            circle of radius R therefore projects to an ellipse R wide and
 *            R·SQUASH tall. 0.28 sits close enough to `groundShadow`'s own 0.3
 *            that the disc and the shadow agree about where the floor is.
 *   PITCH  — the blades are an airfoil, set at an angle to the rotor plane.
 *            Without it, a blade pointing straight left or right would project
 *            to a zero-width line and blink out of existence twice per turn.
 *
 * From those, for a blade at rotor angle θ:
 *
 *   tip     = hub + (cos θ · R, sin θ · R · SQUASH)
 *             — so the blade is LONG when it crosses the screen and SHORT when
 *             it points toward or away from the camera. That foreshortening is
 *             what reads as rotation in a plane, rather than as a pinwheel
 *             painted flat on the glass.
 *
 *   width   ∝ |ĉ|, where ĉ is the blade's CHORD vector — tangential in the
 *             rotor plane, tipped by PITCH out of it — put through the same
 *             projection:
 *                 ĉ = ( −sin θ · cos β ,  cos θ · cos β · SQUASH − sin β )
 *             At θ = ±π/2 (pointing at or away from the lens) the chord is
 *             broadside and the blade is a fat paddle; at θ = 0 or π it is
 *             nearly edge-on and the blade is a thin bar. That is the correct
 *             behaviour and it costs one square root.
 *
 *   depth   = sin θ. Positive means the blade has swung toward the camera, so
 *             it is drawn LAST and a touch larger. Painting the far blade first
 *             is the only depth cue available in a 2D cel; without it the two
 *             blades read as one rigid bar rocking back and forth.
 */
const SQUASH = 0.28;
const PITCH = 0.38; // radians of blade set angle

/** Projected geometry of one blade at rotor angle θ. */
function bladeProjection(theta: number): { tx: number; ty: number; w: number; near: number } {
  const cb = Math.cos(PITCH);
  const sb = Math.sin(PITCH);
  // Chord vector through the projection (see the derivation above).
  const chordX = -Math.sin(theta) * cb;
  const chordY = Math.cos(theta) * cb * SQUASH - sb;
  return {
    tx: Math.cos(theta) * ROTOR_R,
    ty: Math.sin(theta) * ROTOR_R * SQUASH,
    w: Math.hypot(chordX, chordY),
    near: Math.sin(theta),
  };
}

/**
 * The rotor: blur rings, then the blades far-to-near, then the hub cap.
 *
 * @param spin  rotor angle, radians. Advanced by a LARGE, non-periodic step
 *              between frames — see makeRotortailPaints.
 * @param stall 0 = turning at speed (blur rings on), 1 = dead stick (no blur,
 *              both blades hard-edged and countable). That is the entire visual
 *              difference between "flying" and "about to fall out of the sky",
 *              and it costs one parameter.
 */
function drawRotor(ctx: CanvasRenderingContext2D, hx: number, hy: number, spin: number, stall = 0): void {
  const spinning = 1 - stall;

  // ── BLUR RINGS ──
  // Two concentric stroked ellipses on the projected disc. Unshaded, and drawn
  // BEFORE the blades (layer 3 of the cel convention applies to the blades, not
  // to the air they move through), so a blade crosses in front of its own wash.
  if (spinning > 0.05) {
    for (const [rf, a] of [[1.0, 0.34], [0.72, 0.2]] as Array<[number, number]>) {
      ctx.beginPath();
      ctx.ellipse(hx, hy, ROTOR_R * rf, ROTOR_R * rf * SQUASH, 0, 0, Math.PI * 2);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = `rgba(255,243,200,${a * spinning})`;
      ctx.stroke();
    }
  }

  // ── MAST ── a short brass post the whole assembly turns on.
  limbShaded(ctx, [hx, hy + 11], [hx, hy + 1], 4.5, R_BRASS);

  // ── BLADES ── two, opposed. Far one first (see `near`).
  const blades = [spin, spin + Math.PI]
    .map((t) => bladeProjection(t))
    .sort((a, b) => a.near - b.near);

  for (const p of blades) {
    // The nearer blade rides a little bigger — a cheap perspective cue that
    // makes the disc read as tilted in space rather than painted on the screen.
    const persp = 1 + p.near * 0.16;
    const tipX = hx + p.tx * persp;
    const tipY = hy + p.ty * persp;
    // Unit vector along the blade, and its screen perpendicular.
    const len = Math.hypot(tipX - hx, tipY - hy) || 1;
    const ux = (tipX - hx) / len;
    const uy = (tipY - hy) / len;
    const px = -uy;
    const py = ux;
    // Chord width, FLOORED so an edge-on blade is still a visible bar rather
    // than a hairline that vanishes under the 72px crush.
    const halfW = Math.max(1.9, p.w * 7.5 * persp);
    // A paddle: narrow at the root, widest around 70% out, rounded at the tip.
    const at = (f: number, wf: number, side: number): Pt => [
      hx + ux * len * f + px * halfW * wf * side,
      hy + uy * len * f + py * halfW * wf * side,
    ];
    plateShaded(
      ctx,
      [at(0.12, 0.5, 1), at(0.7, 1, 1), at(1, 0.62, 1), at(1, 0.62, -1), at(0.7, 1, -1), at(0.12, 0.5, -1)],
      R_BLADE,
    );
    // Grain line down the blade — a hint of timber, ONE stroke, so it survives
    // the crush as texture instead of becoming the shape.
    figDetail(ctx, [at(0.25, 0, 0), at(0.92, 0, 0)], 1.1, 26);
  }

  // ── HUB ── brass, drawn over both blade roots so they read as joined.
  ellShaded(ctx, hx, hy, 6.5, 5, R_BRASS);
  ellShaded(ctx, hx, hy - 1.5, 3, 2.4, [16, 17, 18] as Ramp);
}

/**
 * A chewed baulk of TIMBER — the thing it throws.
 *
 * Drawn as a capsule with an END-GRAIN disc: concentric rings on the cap are
 * what make a brown lozenge read as a cut log rather than as a club. At this
 * size two rings is the most that survives, so it is two.
 *
 * @param rot screen rotation, radians (the throw tumbles it)
 * @param s   scale
 */
function drawTimber(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, s = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const L = 15 * s;
  const R = 6.5 * s;
  limbShaded(ctx, [-L, 0], [L, 0], R * 2, R_TIMBER);
  // Bark striations along the barrel.
  for (const o of [-0.45, 0.35]) {
    figDetail(ctx, [[-L * 0.75, R * o], [L * 0.75, R * o]], 1.2 * s, 26);
  }
  // End grain — the cut face, so the shape reads as a cylinder with an end.
  ellShaded(ctx, L * 0.86, 0, R * 0.5, R * 0.9, [27, 28, 24] as Ramp);
  for (const rf of [0.6, 0.3]) {
    ctx.beginPath();
    ctx.ellipse(L * 0.86, 0, R * 0.5 * rf, R * 0.9 * rf, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = "#4a3222";
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The PADDLE TAIL — flat, scaled, and the second-biggest shape on the creature.
 *
 * It is drawn as a foreshortened leaf whose WIDTH is a function of facing: dead
 * on from behind (N) you see the full paddle, from the front (S) it pokes out
 * past the flank, and in profile (E) it is edge-on and streams backward. The
 * cross-hatch is what says "scaled", and it is the one place on the creature
 * where a regular pattern earns its pixels — the rest of the body is fur and
 * would turn to noise under the crush.
 */
function drawTail(ctx: CanvasRenderingContext2D, dir: Dir, bx: number, by: number, sway: number): void {
  // Seen from BEHIND the paddle is the whole animal: full width, hung centrally
  // below the body, and drawn in FRONT of it (see the call site). From the front
  // and in profile it is a foreshortened blade swung out past the flank — far
  // enough out that it breaks the body's outline, because a tail entirely
  // inside the barrel's silhouette is a tail nobody can see.
  const wide = dir === "N" ? 1 : dir === "S" ? 0.62 : 0.3;
  const tx = bx + (dir === "N" ? 0 : dir === "E" ? -30 : -25);
  const ty = by + (dir === "N" ? 20 : 17) + sway * 0.5;
  const rot = (dir === "N" ? 0 : dir === "E" ? -0.2 : -0.62) + sway * 0.05;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(rot);
  const rx = dir === "N" ? 20 : 18;
  const ry = (dir === "N" ? 15 : 13) * wide;
  ellShaded(ctx, 0, 0, rx, ry, R_TAIL);
  // Scutes: a lattice, clipped to the paddle so it never spills onto the body.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.86, ry * 0.82, 0, 0, Math.PI * 2);
  ctx.clip();
  for (let i = -2; i <= 2; i++) {
    figDetail(ctx, [[i * 6, -ry], [i * 6 - 3, ry]], 1.2, 26);
  }
  for (let i = -1; i <= 1; i++) {
    figDetail(ctx, [[-rx, i * 5.5], [rx, i * 5.5]], 1.2, 26);
  }
  ctx.restore();
  ctx.restore();
}

/**
 * One rotortail frame.
 *
 * @param dir   facing — N hides the face and shows the full paddle, E is the
 *              profile (muzzle and teeth jut, tail streams back)
 * @param phase -1..1 hover phase; drives the body bob, the tail sway and the
 *              counter-swing of the tucked feet
 * @param opts  pose: `spin` rotor angle · `tilt` body lean (flight / tumble) ·
 *              `log` 0..1 hoist-to-release of the carried timber (<0 = none) ·
 *              `stall` rotor dying · `drop` how far it has sunk · `dazed`
 *              concussed face and orbiting stars · `dead` splat
 */
function rotortailFrame(
  dir: Dir,
  phase: number,
  opts: {
    spin?: number;
    tilt?: number;
    log?: number;
    stall?: number;
    drop?: number;
    dazed?: number;
    dead?: boolean;
  } = {},
): FramePaint {
  return (ctx) => {
    const { spin = 0, tilt = 0, log = -1, stall = 0, drop = 0, dazed = 0, dead = false } = opts;

    // ── SPLAT ────────────────────────────────────────────────────────────
    // Flat on the floor, rotor bent, teeth out, dust still settling. The one
    // pose where the creature is on the ground at all — which is why it drops
    // the altitude gap and takes a big contact shadow instead.
    if (dead) {
      groundShadow(ctx, CX, GROUND + 1, 26);
      // Body flattened into an oval, tail thrown out behind it.
      ellShaded(ctx, CX - 16, GROUND - 4, 15, 8, R_PELT_DK);
      ellShaded(ctx, CX, GROUND - 6, 22, 10, R_PELT);
      ellShaded(ctx, CX + 4, GROUND - 3, 15, 5, R_BELLY);
      // Head lolling, helmet knocked askew.
      ellShaded(ctx, CX + 18, GROUND - 7, 13, 9, R_PELT);
      ellShaded(ctx, CX + 17, GROUND - 12, 12, 6, R_HELM, -0.3);
      ellShaded(ctx, CX + 27, GROUND - 4, 7, 4.5, R_BELLY);
      // Teeth, still absurd.
      figDetail(ctx, [[CX + 29, GROUND - 2], [CX + 33, GROUND + 1]], 2.6, TOOTH);
      // X eyes — the roster has no other dead-face convention, and two crossed
      // strokes survive the crush where a closed lid does not.
      for (const s of [0, 1]) {
        const ex = CX + 15 + s * 7;
        figDetail(ctx, [[ex - 2.5, GROUND - 12], [ex + 2.5, GROUND - 7]], 1.8, 1);
        figDetail(ctx, [[ex + 2.5, GROUND - 12], [ex - 2.5, GROUND - 7]], 1.8, 1);
      }
      // The rotor: bent off its mast, one blade snapped short. Hand-placed
      // rather than run through drawRotor, because a dead rotor is not a rotor
      // at an angle — it is a broken thing, and the projection would keep
      // insisting it was still a disc.
      limbShaded(ctx, [CX + 14, GROUND - 18], [CX + 8, GROUND - 24], 4, R_BRASS);
      plateShaded(ctx, [[CX + 8, GROUND - 26], [CX - 16, GROUND - 30], [CX - 15, GROUND - 24], [CX + 9, GROUND - 22]], R_BLADE);
      plateShaded(ctx, [[CX + 9, GROUND - 25], [CX + 22, GROUND - 18], [CX + 20, GROUND - 14], [CX + 8, GROUND - 21]], R_BLADE);
      ellShaded(ctx, CX + 8, GROUND - 24, 5, 4, R_BRASS);
      // Dust kicked out sideways by the impact.
      for (const [dx, dy] of [[-30, -6], [-24, -12], [28, -8], [34, -14], [-36, -3]] as Pt[]) {
        figDetail(ctx, [[CX + dx, GROUND + dy], [CX + dx * 1.15, GROUND + dy - 4]], 1.5, 4);
      }
      return;
    }

    // ── AIRBORNE ─────────────────────────────────────────────────────────
    const bob = Math.sin(phase * Math.PI) * 3;
    const sway = phase * 4;
    const narrow = dir === "E" ? 0.88 : 1;
    const cy = FLY_Y + bob + drop;
    const cx = CX;

    // The shadow stays on the FLOOR and shrinks as the creature climbs. The gap
    // between body and shadow is the only thing in a 2D cel that says altitude,
    // so it is drawn every frame, at ground level, never under the body.
    const alt = (GROUND - cy) / 60;
    groundShadow(ctx, CX, GROUND + 2, 15 * Math.max(0.5, 1.15 - alt * 0.35));

    // Everything above the floor tilts as ONE rigid body about the barrel's
    // centre — head, helmet, rotor and all. A propeller hat that stays level
    // while its wearer banks is the fastest way to make this read as
    // pasted-together parts, so the transform wraps the whole creature.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.translate(-cx, -cy);

    // ── TAIL (front / profile) ── behind the body, emerging from under the flank.
    // From the N facing it is drawn AFTER the body instead — see below.
    if (dir !== "N") drawTail(ctx, dir, cx, cy, sway + dazed * 6);

    // ── FAR ARM ── drawn before the body so the near arm reads in front.
    if (dir !== "E") {
      const sh: Pt = [cx - 17 * narrow, cy - 2];
      const hand: Pt = log >= 0 ? [cx - 15, cy - 26] : [cx - 22 - sway * 0.4, cy + 8 + dazed * 4];
      limbShaded(ctx, sh, hand, 6, R_PELT_DK);
    }

    // ── FEET ── webbed and TUCKED. A flyer with its legs hanging reads as
    // falling, which is a pose this creature has and must not wear by accident.
    for (const s of dir === "E" ? [1] : [-1, 1]) {
      const fx = cx + s * 7 * narrow;
      const fy = cy + 16 + Math.sin(phase * Math.PI + s) * 1.5 + dazed * 5;
      limbShaded(ctx, [cx + s * 6 * narrow, cy + 12], [fx, fy], 6.5, R_PELT_DK);
      // Three toes, splayed — the webbing read, at three strokes. SHORT: the
      // first pass hung them low enough that the two feet and two arms read as
      // four insect legs, which is not what a tucked-up flyer looks like.
      for (let t = -1; t <= 1; t++) {
        figDetail(ctx, [[fx, fy], [fx + t * 3 + s * 1.2, fy + 4]], 1.6, 26);
      }
    }

    // ── BODY ── a fat barrel, wider than it is tall. Beavers are round, and a
    // round body under a wide rotor is a shape nothing else in the roster makes.
    ellShaded(ctx, cx, cy, 21 * narrow, 19, R_PELT);
    // Belly patch — warm and pale, low and forward, so the front of the body
    // catches the key light and the silhouette has an inside. THE BACK HAS NO
    // BELLY: the first pass drew it at every facing, and a rotortail flying away
    // from you showed its stomach. Same class of bug as a face on the back of a
    // head, and just as obvious once you look at the N sheet.
    if (dir === "N") {
      // Dorsal ridge instead: a darker band down the spine, which is the only
      // thing that keeps the rear view from being one flat brown oval.
      ellShaded(ctx, cx, cy + 2, 6, 15, [1, 26, 27] as Ramp, 0, { rim: false });
    } else {
      ellShaded(ctx, cx + (dir === "E" ? 5 : 0), cy + 5, 13 * narrow, 11, R_BELLY);
    }
    // ── TAIL (rear view) ── the hero shape, hung in front of the body.
    if (dir === "N") drawTail(ctx, dir, cx, cy, sway + dazed * 6);
    // Two fur strokes, no more. The first pass drew a full pelt texture and the
    // barrel turned to noise under the crush — the same failure sporeling.ts
    // records for its fibres.
    for (const i of dir === "E" ? [-0.55] : [-0.6, 0.55]) {
      figDetail(ctx, [[cx + i * 15 * narrow, cy - 10], [cx + i * 17 * narrow, cy + 6]], 1.3, 26);
    }

    // ── HEAD ── set forward and high, overlapping the body: a beaver has no
    // neck, and drawing one would cost the compact read the shape depends on.
    const hx = cx + (dir === "E" ? 9 : 0);
    const hy = cy - 17;
    ellShaded(ctx, hx, hy, 13.5 * narrow, 11.5, R_PELT);
    // Ears — small, round, half-swallowed by the helmet.
    for (const s of dir === "E" ? [-1] : [-1, 1]) {
      ellShaded(ctx, hx + s * 12 * narrow, hy - 5, 4, 3.6, R_PELT_DK);
    }

    // ── MUZZLE + TEETH ── the front of the face, in the pale ramp so it never
    // merges with the head it sits on.
    if (dir !== "N") {
      const mz = dir === "E" ? 1 : 0.8;
      const mx = hx + (dir === "E" ? 9 : 0);
      const my = hy + 8;
      ellShaded(ctx, mx, my, 9 * mz, 6, R_BELLY);
      // Nose leather.
      ellShaded(ctx, mx + (dir === "E" ? 4 : 0), my - 3, 3, 2.2, [1, 1, 26] as Ramp);
      // A dark lip line under the snout. LOAD-BEARING: without a mouth behind
      // them the teeth read as a pale card held up in front of the face, which
      // is exactly what the first contact sheet showed.
      ellShaded(ctx, mx + (dir === "E" ? 3 : 0), my + 4, 5.5 * mz, 2.6, [0, 0, 1] as Ramp, 0, { rim: false });
      // THE CHISEL TEETH — the most recognisable thing about the animal, drawn
      // as two slabs with a dark seam between them. At the 72px grid one
      // tooth-coloured blob reads as a beak. They OVERLAP the lip so they hang
      // out of a mouth instead of floating under one.
      const tw = 3.1 * mz;
      for (const s of [-1, 1]) {
        const tx2 = mx + (dir === "E" ? 3 : 0) + s * (tw * 0.58);
        plateShaded(
          ctx,
          [
            [tx2 - tw * 0.5, my + 3],
            [tx2 + tw * 0.5, my + 3],
            [tx2 + tw * 0.4, my + 10],
            [tx2 - tw * 0.4, my + 10],
          ],
          [20, 21, TOOTH] as Ramp,
        );
      }
      // Whiskers — TWO strokes a side, short, in the mid skin tone. The first
      // pass drew three long pale ones and they merged into a moustache that
      // read as part of the face rather than as hair off it.
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        for (let w = 0; w < 2; w++) {
          figDetail(
            ctx,
            [[mx + s * 6 * mz, my + w - 1], [mx + s * (13 + w * 2) * mz, my - 3 + w * 4]],
            1,
            24,
          );
        }
      }
    }

    // ── FLIGHT CAP ── the cool band across the top third.
    // A dome, an ear flap and a chin strap. The dome is a CLIPPED ellipse
    // rather than a polygon, so its crown curve matches the skull under it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(hx - 24, hy - 24, 48, 19);
    ctx.clip();
    ellShaded(ctx, hx, hy - 4, 14 * narrow, 14, R_HELM);
    ctx.restore();
    // Ear flap down the side of the head, and the strap under the jaw. NO RIM:
    // with one, the two flaps each grew their own bright highlight and the head
    // read as a pair of headphones rather than as one leather cap.
    for (const s of dir === "E" ? [-1] : [-1, 1]) {
      ellShaded(ctx, hx + s * 12.5 * narrow, hy - 1, 4.4, 6.8, R_HELM, 0, { rim: false });
      figDetail(ctx, [[hx + s * 12.5 * narrow, hy + 5], [hx + s * 4 * narrow, hy + 10]], 2, 19);
    }
    // Brass rivets around the crown — three dots, the smallest spend of the
    // torch ramp that still says "riveted salvage" rather than "hood".
    for (const rv of dir === "E" ? [-0.6, 0.2] : [-0.7, 0, 0.7]) {
      ellShaded(ctx, hx + rv * 13 * narrow, hy - 13 + Math.abs(rv) * 3, 2, 1.8, R_BRASS, 0, { rim: false });
    }

    // ── GOGGLES ── shoved UP on the brow, never over the eyes. Two cold lenses
    // on a dark band, sat exactly where the eye lands first. Pushing them up
    // rather than wearing them is what keeps the ember eyes — the roster's
    // shared focal point — visible.
    {
      // High on the crown — the first pass put the band at hy-9 with 5.5px
      // lenses and the eyes at hy-1 with a 5px socket, so the two collided and
      // the creature read as having four eyes. The band is what carries at
      // distance; the gap between band and eyes is what makes it a FACE.
      const gy = hy - 13;
      figDetail(ctx, [[hx - 16 * narrow, gy + 1], [hx + 16 * narrow, gy + 1]], 4.5, 1);
      if (dir === "N") {
        // From behind, goggles are a STRAP and a buckle, never two lenses. A
        // lens on the back of a head is the same bug as a face on the back of a
        // head, and just as visible once the N sheet is on screen.
        ellShaded(ctx, hx, gy, 3.4, 2.6, R_BRASS, 0, { rim: false });
      } else {
        for (const s of dir === "E" ? [0.35] : [-1, 1]) {
          const lx = hx + s * 7.5 * narrow;
          ellShaded(ctx, lx, gy, 4.6, 3.8, R_GLASS);
          // Specular streak — a lens with no highlight is a hole.
          figDetail(ctx, [[lx - 2.2, gy - 1.6], [lx + 0.4, gy - 2.4]], 1.5, 31);
        }
      }
    }

    // ── EYES ── embers under an angry brow, drawn LAST and unshaded (layer 3
    // of the cel convention). `dazed` swaps the scowl for wide blank shock,
    // which is the whole tell that the rotor has quit.
    if (dir !== "N") {
      const ey = hy - 2;
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        const ex = hx + (dir === "E" ? 5 : s * 6.5);
        ellShaded(ctx, ex, ey, 4.4, 3 + dazed * 1.4, [0, 0, 1] as Ramp);
        if (dazed > 0.4) {
          // Blown-wide eye: a pale disc with a small dark pupil rolling off
          // centre. Reads as "concussed" where a narrowed ember reads as "aim".
          ellShaded(ctx, ex, ey, 3.2, 3, [20, 21, 22] as Ramp, 0, { rim: false });
          ellShaded(ctx, ex + Math.sin(phase * 3) * 1.4, ey, 1.5, 1.5, [0, 0, 1] as Ramp, 0, { rim: false });
        } else {
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate((dir === "E" ? 1 : s) * 0.3);
          ellShaded(ctx, 0, 0, 3.4, 1.7, [EYE_HOT, EYE_CORE, 18] as Ramp);
          ctx.restore();
          figGlow(ctx, ex, ey, 2.2, EYE_CORE, EYE_HOT);
          // Brow: one heavy angled stroke. The cheapest anger in pixel art, and
          // it survives the crush where an eyebrow SHAPE does not.
          figDetail(
            ctx,
            [[ex - (dir === "E" ? 4 : s * 5), ey - 6], [ex + (dir === "E" ? 4 : s * 4), ey - 3.5]],
            2.4,
            26,
          );
        }
      }
    }

    // ── NEAR ARM(S) + THE CARRIED TIMBER ─────────────────────────────────
    // With a log, both arms go UP and the baulk sits across them overhead. That
    // pose is the attack telegraph, and it has to read from BEHIND as well, so
    // the log is drawn above the helmet where nothing occludes it at any facing.
    if (log >= 0) {
      const hoist = Math.min(1, log * 2); // 0..0.5 raise it, 0.5..1 wind and throw
      const throwT = Math.max(0, (log - 0.5) * 2);
      const lift = 34 + hoist * 10;
      const lx = cx + throwT * (dir === "E" ? 26 : 8);
      const ly = cy - lift + throwT * 6;
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        const sh: Pt = [cx + s * 15 * narrow, cy - 4];
        const hand: Pt = [lx + s * 9, ly + 6];
        limbShaded(ctx, sh, hand, 6.5, R_PELT);
      }
      drawTimber(ctx, lx, ly, -0.12 + throwT * 0.9);
    } else {
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        const sh: Pt = [cx + s * 16 * narrow, cy - 3];
        const hand: Pt = [cx + s * (20 + sway * 0.3) * narrow, cy + 5 + dazed * 5];
        limbShaded(ctx, sh, hand, 6, R_PELT);
        // Three claws.
        for (let f = -1; f <= 1; f++) {
          figDetail(ctx, [[hand[0], hand[1]], [hand[0] + f * 2.8 + s * 1.6, hand[1] + 4.5]], 1.3, 26);
        }
      }
    }

    // ── ROTOR ── last, over everything, on its mast above the crown.
    // The mast height is bounded by the CEL, not by taste: at 34 the hub sat at
    // y=9 and the blade tips (±ROTOR_R·SQUASH, plus chord) touched y=0, so the
    // top of the disc was being clipped away by the cel edge. 29 keeps the whole
    // rotor inside the box at every angle, which matters because the disc is the
    // one shape the creature is recognised by.
    drawRotor(ctx, hx, hy - 29, spin, stall);

    // ── DAZE STARS ── the reference's one piece of pure cartoon, and it earns
    // its pixels: a stunned enemy that only changes POSE is missable across a
    // lit room, and these orbit, so they read as motion in any single frame.
    if (dazed > 0.2) {
      for (let i = 0; i < 3; i++) {
        const a = phase * 2 + (i / 3) * Math.PI * 2;
        const sx2 = hx + Math.cos(a) * 26;
        const sy2 = hy - 16 + Math.sin(a) * 9;
        // A four-point star: two crossed strokes with a hot core.
        figDetail(ctx, [[sx2 - 4, sy2], [sx2 + 4, sy2]], 2, 17);
        figDetail(ctx, [[sx2, sy2 - 4], [sx2, sy2 + 4]], 2, 17);
        figGlow(ctx, sx2, sy2, 1.6, 18, 16);
      }
    }

    ctx.restore();
  };
}

/**
 * FLIGHT — nose down, tail streaming, speed lines behind.
 *
 * The banked tilt is what separates `walk` from `idle` at a glance: a hovering
 * rotortail is level, a moving one is leaning into its own line.
 */
function rotortailFly(dir: Dir, phase: number, spin: number): FramePaint {
  return (ctx) => {
    rotortailFrame(dir, phase, { spin, tilt: (dir === "E" ? -0.16 : -0.08) - phase * 0.04 })(ctx);
    if (dir === "N") return;
    // Trailing streaks — STRAIGHT, because the creature's approach is a ring at
    // roughly constant radius and the art should not imply a dive it cannot make.
    for (let i = 0; i < 3; i++) {
      const y = FLY_Y - 12 + i * 14;
      const x0 = CX - 30 - i * 4;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 - 14 - Math.abs(phase) * 8, y + 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(255,217,138,${0.42 - i * 0.1})`;
      ctx.stroke();
    }
  };
}

/**
 * ATTACK — the timber throw, and the one clip the player has to read.
 *
 * Three beats: HOIST (log up, body sags under the weight), WIND (body pitches
 * back, log cocked over the head), RELEASE (body snaps forward, log leaving
 * with an arc behind it). The sag is not decoration — a wind-up that changes
 * the body's SILHOUETTE is readable across a lit room, where one that only
 * moves the arms is not.
 */
function rotortailThrow(dir: Dir, t: number): FramePaint {
  return (ctx) => {
    // Body pitches back through the wind, then whips forward on release.
    const tilt = t < 0.6 ? t * 0.28 : 0.17 - (t - 0.6) * 1.1;
    // It sinks under the load, then the rotor bites and hauls it back up.
    const drop = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 7;
    rotortailFrame(dir, -0.2 + t * 0.5, { spin: t * 5.1, tilt, log: t, drop })(ctx);
    if (t < 0.8 || dir === "N") return;
    // Release arc, unshaded on top — the swept path the timber just left.
    ctx.beginPath();
    ctx.arc(CX, FLY_Y - 24, 30, -1.5, -0.2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(214,159,126,${(t - 0.8) * 2.4})`;
    ctx.stroke();
  };
}

/**
 * STUMBLE — the rotor stalls.
 *
 * A staggered rotortail is not a staggered zombie: it loses ALTITUDE. `stall`
 * kills the blur so both blades go hard-edged and slow (the read: you can
 * suddenly count them), `drop` sinks it toward the floor and swells its own
 * shadow, and the eyes blow wide. PAIN_BY_KIND gives this family a high pain
 * chance precisely so it is a pose the player sees often enough to learn.
 */
function rotortailStall(dir: Dir, t: number): FramePaint {
  return rotortailFrame(dir, 0.4 + t, {
    spin: 1.1 + t * 1.4,
    stall: 0.55 + t * 0.4,
    tilt: 0.16 + t * 0.2,
    drop: 6 + t * 10,
    dazed: 0.5 + t * 0.4,
  });
}

export function makeRotortailPaints(): ActorPaints {
  // Rotor angle per frame. The step is LARGE and deliberately not a neat
  // fraction of 2π: a propeller sampled at ~8fps only reads as fast if
  // successive frames land at unrelated angles. Step it by π/2 and it locks
  // into a wagon wheel that looks like a slow, stately turn — the one thing a
  // propeller must never look like.
  const SPIN_STEP = 2.39; // ≈137°, the golden angle: no short cycle at any frame count

  const dc = (dir: Dir) => ({
    // Hover: level, small bob, rotor turning. Not a walk cycle in place.
    idle: [
      rotortailFrame(dir, -0.15, { spin: 0 }),
      rotortailFrame(dir, 0.2, { spin: SPIN_STEP }),
    ],
    // Flight: banked, four beats.
    walk: [
      rotortailFly(dir, -0.9, SPIN_STEP * 2),
      rotortailFly(dir, 0.05, SPIN_STEP * 3),
      rotortailFly(dir, 0.9, SPIN_STEP * 4),
      rotortailFly(dir, 0.05, SPIN_STEP * 5),
    ],
    attack: [rotortailThrow(dir, 0), rotortailThrow(dir, 0.5), rotortailThrow(dir, 1)],
    stumble: [rotortailStall(dir, 0), rotortailStall(dir, 1)],
    death: [
      // Hit — still up, rotor already failing.
      rotortailStall(dir, 0.3),
      // Tumbling: the disc is gone, the body is on its side, going down.
      rotortailFrame(dir, 0.6, { spin: 3.4, stall: 1, tilt: 0.9, drop: 26, dazed: 1 }),
      rotortailFrame(dir, 0.9, { spin: 4.2, stall: 1, tilt: 2.1, drop: 44, dazed: 1 }),
      rotortailFrame(dir, 0, { dead: true }),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
