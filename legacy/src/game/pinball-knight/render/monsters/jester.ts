/**
 * JESTER — a spring-loaded harlequin: a motley body under a huge scalloped
 * ruff, a greasepainted face, belled horns, and a COIL SPRING rising off the
 * crown with a star-stamped plate balanced on top. It walks you down, loads the
 * spring, and fires the plate.
 *
 * Built from a reference sheet as a SHAPE SPEC, not as pixels — the same method
 * render/monsters/sporeling.ts documents. The reference was a five-clip
 * single-facing sheet (idle / spring attack / walk / hurt / death) in a bright
 * carnival palette on a baked-in checkerboard. Importing those pixels buys one
 * facing, a foreign palette and a foreign lighting model. Authoring the creature
 * as a painter parameterised by (dir, phase, spring extension) buys N/S/E,
 * phase-driven animation and the Cold Crypt palette by construction, and there
 * is no quantization step because no soft image is ever made.
 *
 * ── THE SILHOUETTE IS THE MECHANIC ──────────────────────────────────────────
 * Everything else on the roster is a blob with limbs. The jester is a VERTICAL
 * STACK that CHANGES HEIGHT: squat body, then a thin coil, then a wide flat
 * plate. The spring's extension is the attack telegraph — `SPRING_IDLE` at rest,
 * `SPRING_LOAD` compressed on the wind-up, `SPRING_FIRE` at full stretch on the
 * release. You read the threat off the creature's HEIGHT, from across a room,
 * at any facing, with no colour cue needed. That is the one thing the reference
 * sheet gets right that a tinted reskin could never carry.
 *
 * ── THE PALETTE PROBLEM THIS FILE SOLVES ────────────────────────────────────
 * The reference is red/yellow motley on cream. Cold Crypt has no cream, and its
 * only warm family is the torch ramp (14-18) — which the palette census found
 * to be 2.26% of all actor pixels, i.e. structurally unused. A harlequin is
 * exactly the body that should spend it: the motley alternates BLOOD (10-13)
 * against TORCH (15-17), which is a hue break AND a value break tiling the whole
 * torso, so the checker survives the 128→72 crush as a pattern rather than
 * mushing to one orange. Cream goes to BONE (20-22) for the ruff, gloves, face
 * and stockings.
 *
 * The hazard is the SPRING: steel (19-22) on a stone floor (2-5) is the
 * near-value merge figure.ts exists to prevent, and the coil is thin. Two
 * defences, both structural. The coil is drawn as a projected HELIX with its
 * back half in steel-dark and its front half in steel-mid plus a specular — so
 * it is high-contrast against ITSELF and reads as a coil, not a grey bar. And
 * it never touches the floor: it sits above a bone ruff, which is the brightest
 * thing on the figure, so the eye finds the stack before it has to resolve wire.
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
import { paletteCss } from "../palette";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

// ── MATERIALS ───────────────────────────────────────────────────────────────
//
// ⚠️ RETUNED 2026-07-31 TO MATCH THE SHIPPED SHEET. `public/sprites/jester-S`
// is this creature's imported art and it is what players see by default; this
// painter is the fallback and the A/B arm. They had drifted into two different
// costumes — the sheet is DARK RED + GOLD + CREAM, the painter was bright red +
// COLD STEEL WHITE — so the lab strip compared a maroon jester against a white
// one and the difference read as "the pipeline is wrong" when it was only two
// palettes. Painted and imported have to be the same creature or the A/B
// measures the costume instead of the conversion.
//
// The three ramps below are chosen for VALUE separation, which is the rule this
// whole session measured: red bottoms out in blood, gold occupies the middle of
// the torch ramp, cream takes its top. Two clear steps between the motley's
// gold and the ruff's cream, so the checker still separates from the collar
// after a luma-weighted snap.
/** Motley red — blood, one step deeper than before to match the sheet's maroon. */
const R_RED: Ramp = [10, 11, 12];
/** Motley gold — the lower torch ramp. The census entry nothing was spending. */
const R_GOLD: Ramp = [14, 15, 16];
/** Ruff, gloves, stockings, greasepaint. CREAM, not bone: the sheet's collar is
 *  warm, and cold steel-white beside a warm motley was the whole mismatch. Sits
 *  two steps above `R_GOLD`'s top so the scallops keep their edge. */
const R_BONE_W: Ramp = [16, 17, 18];
/** Curl-toe shoes: leather-dark, so the feet anchor on the floor. */
const R_SHOE: Ramp = [26, 27, 28];
/** The plate's rim and the bells — gold one step darker, so the rim reads as
 *  metal against the same-family field it encircles. */
const R_RIM: Ramp = [14, 15, 16];

/** Greasepaint eye diamonds. Arcane-light is the one cold accent on a figure
 *  that is otherwise entirely warm — it is why the face reads as a MASK. */
const PAINT = 31;
/** Nose / mouth. */
const NOSE = 13;
/** Star stamp on the plate, and the pupil glint. */
const STAR = 18;

// ── GEOMETRY (cel units; GROUND = 118, CX = 64) ─────────────────────────────
//
// Shared by every pose. A spring attack and an idle are the SAME creature at
// different extensions; sharing the numbers is what stops the two poses drifting
// into two different monsters (the lesson hound.ts records).
// The first cut put the hips at GROUND-20 and the torso covered the legs down
// to the shoe, so the walk cycle had nothing visible to swing. The stockings
// are half the reference's read — the hips sit high enough that a full leg
// shows below the motley.
const HIP_Y = GROUND - 24;
const RUFF_Y = GROUND - 46;
const HEAD_Y = GROUND - 60;
const HEAD_R = 13;
/** Where the spring is bolted to the crown — clear of the skull, so the
 *  bolt-plate reads as hardware sitting ON the head rather than inside it. */
const CROWN_Y = GROUND - 74;
/** Coil half-width. Narrow: a fat coil reads as a slinky toy, not a launcher. */
const COIL_W = 7.5;
/**
 * Plate half-width.
 *
 * It was 25 and the creature read as a hat-stand: the plate was wider than the
 * ruff, so the eye landed on it first and never travelled down to the body. At
 * 21 it is about shoulder-and-arms wide, which is the reference's proportion —
 * big enough to be the thing you watch, small enough that the jester under it
 * is still a jester.
 */
const PLATE_R = 21;

/**
 * Spring extension in cel px, by state. The whole telegraph is these numbers.
 *
 * The first cut used 12 at rest and the coil disappeared entirely — the plate
 * sat on the horns and the creature lost the one feature the reference is
 * built around. At 18 there is always a hand's width of visible spring, so the
 * COMPRESSION on the wind-up reads as a change rather than as an appearance.
 */
const SPRING_IDLE = 18;
const SPRING_WALK = 22;
const SPRING_LOAD = 7; // compressed — the wind-up is a CROUCH of the spring
// 30, not 32: at 32 the plate's ink edge landed on row 0 of the 128px cel, so
// the tallest frame of the most important clip was one tweak away from shipping
// with its top sheared off. The telegraph is unharmed — idle tops out at y=14
// and this still reaches y=2.
const SPRING_FIRE = 30; // full stretch at release (the plate must stay in the cel)

// ══════════════════════════════════════════════════════════════════════════
// THE COIL — a helix, projected.
//
// Parameterise the wire by t ∈ [0,1] climbing `h` px over `turns` revolutions:
//
//     x(t) = cx + rw·sin(2πNt)              the loop, seen edge-on
//     y(t) = yBase − h·t + rw·k·cos(2πNt)   the climb, plus the loop's own tilt
//     front = cos(2πNt) > 0                 which half of the loop faces us
//
// `front` is the whole trick. Sampling the curve and stroking the back-facing
// runs BEFORE the front-facing ones gives correct occlusion for free — no depth
// buffer, no per-ring bookkeeping — and it stays correct at any extension
// because it is a property of the parameterisation rather than of a pose.
// ══════════════════════════════════════════════════════════════════════════

interface CoilSample { x: number; y: number; front: boolean }

function sampleCoil(cx: number, yBase: number, h: number, turns: number, rw: number, lean: number): CoilSample[] {
  const steps = 12 * Math.max(1, Math.round(turns * 2));
  const out: CoilSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.PI * 2 * turns * t;
    out.push({
      x: cx + Math.sin(a) * rw + lean * t,
      // 0.22 is the loop's apparent tilt — a coil viewed from slightly above.
      // At 0 the helix collapses to a sine wave and the spring reads as ribbon.
      y: yBase - h * t + Math.cos(a) * rw * 0.22,
      front: Math.cos(a) > 0,
    });
  }
  return out;
}

/** Stroke the runs of the sampled wire that satisfy `want`, offset by (dx,dy). */
function strokeRuns(
  ctx: CanvasRenderingContext2D,
  s: CoilSample[],
  want: (p: CoilSample) => boolean,
  w: number,
  css: string,
  dx = 0,
  dy = 0,
): void {
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = css;
  let open = false;
  for (let i = 0; i < s.length; i++) {
    if (want(s[i])) {
      if (!open) {
        ctx.beginPath();
        ctx.moveTo(s[i].x + dx, s[i].y + dy);
        open = true;
      } else ctx.lineTo(s[i].x + dx, s[i].y + dy);
    } else if (open) {
      // Carry one segment past the crossing so the front and back halves meet
      // instead of leaving a hairline gap at every quarter turn.
      ctx.lineTo(s[i].x + dx, s[i].y + dy);
      ctx.stroke();
      open = false;
    }
  }
  if (open) ctx.stroke();
}

/**
 * Draw the spring rising `h` px from (cx, yBase). Turn count scales with height
 * so the wire PITCH stays roughly constant — a stretched spring has the same
 * gauge with wider gaps, which is what makes the extension read as tension
 * rather than as a different object.
 */
function coilSpring(ctx: CanvasRenderingContext2D, cx: number, yBase: number, h: number, rw: number, lean: number): void {
  const turns = Math.max(2.5, Math.min(6, h / 5.5));
  const s = sampleCoil(cx, yBase, h, turns, rw, lean);
  strokeRuns(ctx, s, () => true, 6.4, paletteCss(1)); // selout, whole wire
  strokeRuns(ctx, s, (p) => !p.front, 3.6, paletteCss(19)); // far half, in shadow
  strokeRuns(ctx, s, (p) => p.front, 4.2, paletteCss(20)); // near half
  strokeRuns(ctx, s, (p) => p.front, 1.7, paletteCss(22), -0.9, -1.0); // specular
}

// ══════════════════════════════════════════════════════════════════════════
// THE PLATE — the launcher's ammunition, and the creature's memorable feature.
// ══════════════════════════════════════════════════════════════════════════

/** A five-pointed star as a polygon: alternate R and R·0.42 every π/5. */
function starPts(cx: number, cy: number, R: number, squash: number, rot: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? R : R * 0.42;
    const a = rot + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash]);
  }
  return pts;
}

/** Flat-fill a concave polygon (plateShaded's rim logic assumes convex). */
function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[], idx: number, ink?: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (ink != null) {
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = paletteCss(ink);
    ctx.stroke();
  }
  ctx.fillStyle = paletteCss(idx);
  ctx.fill();
}

/**
 * The star-stamped plate, seen as a foreshortened disc.
 *
 * `squash` is the perspective: 0.30 on the head (we look slightly down at it),
 * near 1 when it is coming at the camera mid-flight. Drawn as a stack — rim
 * edge underneath for thickness, gold rim ring, red field, star — so the plate
 * has a readable EDGE and does not flatten into a coloured coin.
 */
function plate(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, squash: number, spin: number): void {
  const ry = Math.max(2.2, rx * squash);
  ellShaded(ctx, cx, cy + ry * 0.42, rx, ry, R_RIM, 0, { rim: false }); // thickness
  ellShaded(ctx, cx, cy, rx, ry, R_GOLD); // rim ring
  // Field. The rim highlight stays ON here, unlike the plate's edge stack: with
  // it off the disc filled with the ramp's SHADE and the reference's bright red
  // plate came out maroon — a dark hole with a gold ring round it.
  ellShaded(ctx, cx, cy, rx * 0.76, ry * 0.7, R_RED);
  fillPoly(ctx, starPts(cx, cy, rx * 0.5, squash * 0.94, -Math.PI / 2 + spin), STAR, 15);
}

// ══════════════════════════════════════════════════════════════════════════
// THE MOTLEY — a diamond lattice, shaded by POSITION rather than per-cell.
//
// A checker painted in one flat colour would erase the torso plate's shading in
// exactly the cells it covers, and the body would go flat. So each gold cell
// picks its tone from where it sits on the form: upper-left cells take the light
// tone, lower-right the dark, which is the same fixed key every part painter in
// figure.ts uses. The lattice inherits the body's lighting instead of fighting
// it, and the checker still survives the crush because red↔gold is a hue break.
// ══════════════════════════════════════════════════════════════════════════

function motley(ctx: CanvasRenderingContext2D, body: Pt[], x0: number, y0: number, x1: number, y1: number, dw: number, dh: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(body[0][0], body[0][1]);
  for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
  ctx.closePath();
  ctx.clip();
  const rows = Math.ceil((y1 - y0) / dh) + 1;
  const cols = Math.ceil((x1 - x0) / dw) + 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 !== 0) continue; // the other half is the red field showing
      const x = x0 + (c + (r % 2) * 0.5 - 0.5) * dw;
      const y = y0 + r * dh;
      // Tone by position on the form: -1 (upper-left) → +1 (lower-right).
      const u = (x - (x0 + x1) / 2) / Math.max(1, (x1 - x0) / 2);
      const v = (y - y0) / Math.max(1, y1 - y0);
      const lit = u * 0.5 + v - 0.5;
      const idx = lit < -0.28 ? R_GOLD[2] : lit > 0.24 ? R_GOLD[0] : R_GOLD[1];
      fillPoly(ctx, [[x, y - dh / 2], [x + dw / 2, y], [x, y + dh / 2], [x - dw / 2, y]], idx);
    }
  }
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════════
// THE FIGURE
// ══════════════════════════════════════════════════════════════════════════

interface Pose {
  /** -1..1 gait phase — legs scissor, arms counter-swing, body bobs. */
  phase: number;
  /** Spring extension in cel px. */
  spring: number;
  /** false once the plate has been fired — the coil stands bare. */
  hat?: boolean;
  /** 0..1 arms thrown wide (the launch flourish). */
  flourish?: number;
  dead?: boolean;
}

function jesterFrame(dir: Dir, pose: Pose): FramePaint {
  return (ctx) => {
    const { phase, spring } = pose;
    const hat = pose.hat !== false;
    const narrow = dir === "E" ? 0.84 : 1; // profile is thinner

    if (pose.dead) {
      groundShadow(ctx, CX, GROUND + 2, 26);
      // Body collapsed forward, ruff splayed out under the head.
      const heap: Pt[] = [
        [CX - 22, GROUND - 16], [CX + 18, GROUND - 16], [CX + 18, GROUND + 2], [CX - 22, GROUND + 2],
      ];
      ellShaded(ctx, CX - 2, GROUND - 7, 20, 9, R_RED);
      motley(ctx, heap, CX - 22, GROUND - 15, CX + 18, GROUND + 1, 9, 8);
      for (let i = -2; i <= 2; i++) {
        ellShaded(ctx, CX - 12 + i * 5, GROUND - 12 + Math.abs(i) * 1.4, 5.5, 4.6, R_BONE_W);
      }
      ellShaded(ctx, CX - 15, GROUND - 15, 10, 8.5, R_BONE_W); // face, cheek-down
      for (const s of [-1, 1]) {
        const ex = CX - 18 + s * 5;
        figDetail(ctx, [[ex - 2, GROUND - 18], [ex + 2, GROUND - 14]], 1.6, 1);
        figDetail(ctx, [[ex + 2, GROUND - 18], [ex - 2, GROUND - 14]], 1.6, 1);
      }
      // The spring has SPRUNG: off the crown and uncoiled into a loose squiggle.
      // Same function — a spring that lost its tension is just a low-turn coil
      // with a big lean, which is exactly what the reference's death row draws.
      const s = sampleCoil(CX + 4, GROUND - 18, 26, 2.2, 11, 22);
      strokeRuns(ctx, s, () => true, 5.4, paletteCss(1));
      strokeRuns(ctx, s, () => true, 3.2, paletteCss(20));
      plate(ctx, CX + 31, GROUND - 5, 14, 0.72, 0.5); // rolled off, on its edge
      for (const [bx, by] of [[CX - 26, GROUND - 20], [CX + 12, GROUND - 27], [CX + 21, GROUND - 12]]) {
        ellShaded(ctx, bx, by, 2.4, 2.2, R_RIM, 0, { rim: false }); // shed bolts
      }
      return;
    }

    const bob = Math.sin(phase * Math.PI) * 2.2;
    const sway = phase * 2.6;
    const fl = pose.flourish ?? 0;
    const hipY = HIP_Y + bob;
    const ruffY = RUFF_Y + bob;
    const headY = HEAD_Y + bob;
    const crownY = CROWN_Y + bob;

    groundShadow(ctx, CX, GROUND + 2, 21 * narrow);

    // ── legs: banded stockings into curl-toe shoes ──
    for (const s of [-1, 1]) {
      const swing = phase * 5 * s * (dir === "E" ? 1.6 : 1);
      const hip: Pt = [CX + s * 6 * narrow, hipY];
      const foot: Pt = [CX + s * 7.5 * narrow + swing, GROUND - 3];
      limbShaded(ctx, hip, foot, 6, R_BONE_W);
      // Bands, not vertical stripes: at the 72px grid a vertical stripe on a
      // 6px limb is one pixel of noise, a band is a readable rung.
      for (const k of [0.3, 0.62]) {
        const bx = hip[0] + (foot[0] - hip[0]) * k;
        const by = hip[1] + (foot[1] - hip[1]) * k;
        figDetail(ctx, [[bx - 3.2, by], [bx + 3.2, by]], 3.2, R_RED[1]);
      }
      // curl-toe shoe: a sole ellipse plus a tip that hooks up and forward
      const toe = dir === "E" ? 1 : s;
      ellShaded(ctx, foot[0] + toe * 2, GROUND - 3, 7, 4.2, R_SHOE);
      limbShaded(ctx, [foot[0] + toe * 5, GROUND - 4], [foot[0] + toe * 9, GROUND - 9], 3.2, R_SHOE);
      ellShaded(ctx, foot[0] + toe * 9.5, GROUND - 10, 2.4, 2.2, R_RIM, 0, { rim: false }); // toe bell
    }

    // ── torso: a motley barrel, widest at the belly, tucked in at the hips so
    //    the stockings below it stay visible ──
    const bodyTop = ruffY + 4;
    const body: Pt[] = [
      [CX - 13 * narrow, bodyTop],
      [CX + 13 * narrow, bodyTop],
      [CX + 17 * narrow, hipY - 8],
      [CX + 11 * narrow, hipY + 2],
      [CX - 11 * narrow, hipY + 2],
      [CX - 17 * narrow, hipY - 8],
    ];
    plateShaded(ctx, body, R_RED);
    motley(ctx, body, CX - 17 * narrow, bodyTop + 2, CX + 17 * narrow, hipY + 1, 11 * narrow, 9);

    // ── arms: puffed sleeves into white gloves ──
    for (const s of [-1, 1]) {
      if (dir === "E" && s === -1) continue; // far arm occluded in profile
      const sh: Pt = [CX + s * 13 * narrow, bodyTop + 5];
      const spread = fl * 9;
      const el: Pt = [CX + s * (19 + spread) * narrow, bodyTop + 15 - phase * 3 * s - fl * 8];
      const hand: Pt = [CX + s * (22 + spread * 1.5) * narrow, bodyTop + 25 - phase * 5 * s - fl * 16];
      limbShaded(ctx, sh, el, 7, R_RED);
      limbShaded(ctx, el, hand, 5.2, R_GOLD);
      ellShaded(ctx, hand[0], hand[1], 4.4, 4.2, R_BONE_W); // glove
      ellShaded(ctx, sh[0], sh[1] - 1, 6.5, 5.5, R_GOLD); // shoulder puff
      ellShaded(ctx, sh[0] + s * 5, sh[1] + 4, 2.6, 2.4, R_RIM, 0, { rim: false }); // shoulder bell
    }

    // ── the ruff: scallops around the near rim of a collar disc, so the arc
    //    DIPS at the centre — that is what makes it a ring the head sits inside
    //    rather than a bib hung off the chest. ──
    //
    // FIVE wide flat lobes, not seven round ones: at seven the scallops were the
    // same size and value as the gloves, and the figure grew a belt of identical
    // white discs that the eye could not parse. Wide and overlapping, they fuse
    // into one collar shape whose SCALLOPED EDGE is the detail.
    const scallops = dir === "E" ? 4 : 5;
    for (let i = 0; i < scallops; i++) {
      const th = (i / (scallops - 1)) * Math.PI; // 0..π, left to right
      ellShaded(ctx, CX - Math.cos(th) * 19 * narrow, ruffY + Math.sin(th) * 5, 8.5, 5.6, R_BONE_W);
    }

    // ── head: greasepainted, with belled horns ──
    //
    // THE VALUE TRAP: the reference's face and ruff are both white, and drawing
    // them both in bone made one undifferentiated white mass with a nose
    // floating in it — the exact "readable cluster vs mush" failure figure.ts
    // warns about, arrived at from the light end instead of the dark. Two fixes,
    // both physical rather than cosmetic: the collar CASTS a shadow onto the
    // neck, and the greasepaint is a brighter tone than the linen ruff. A
    // half-step of value plus a hard dark line is enough to separate them.
    const headX = CX + sway * 0.4;
    ellShaded(ctx, headX, ruffY - 3, 10 * narrow, 6, [0, 1, 1] as Ramp, 0, { rim: false, bounce: false });
    ellShaded(ctx, headX, headY, HEAD_R * narrow, HEAD_R, [20, 22, 22] as Ramp);

    // Horns drawn AFTER the skull so they read as headgear ON it.
    //
    // They DROOP. The first cut swept them up and out to ±24 to clear the coil,
    // and two limbs angled up from the shoulders is the universal read for ARMS
    // RAISED — the creature looked like it was cheering, in every clip, at every
    // facing. Hanging them down the sides of the head fixes it for free: nothing
    // reads a downward limb from a skull as an arm, the face opens up, and the
    // bells land near the ruff where the reference puts them.
    for (const s of [-1, 1]) {
      if (dir === "E" && s === -1) continue;
      // Bases sit at the TEMPLE, not the crown: an 8px-wide horn rooted at ±7
      // covered everything but a 6px strip of face, and the greasepaint — the
      // whole reason the head is worth drawing — went with it.
      const base: Pt = [headX + s * 11 * narrow, headY - 9];
      const mid: Pt = [headX + s * 17 * narrow, headY - 3];
      const tip: Pt = [headX + s * 20 * narrow + sway * 0.6, headY + 7];
      limbShaded(ctx, base, mid, 6.5, s < 0 ? R_RED : R_GOLD);
      limbShaded(ctx, mid, tip, 4.8, s < 0 ? R_RED : R_GOLD);
      ellShaded(ctx, tip[0], tip[1] + 1, 3.6, 3.4, R_RIM, 0, { rim: false }); // horn bell
    }

    if (dir !== "N") {
      const ex = dir === "E" ? headX + 4 : headX;
      const gap = dir === "E" ? 3.5 : 6.4;
      for (const s of dir === "E" ? [1] : [-1, 1]) {
        const x = ex + s * gap;
        // The clown's eye is a DOT; the diamonds above and below it are what
        // make the face a MASK rather than a face. Cold accent on an otherwise
        // entirely warm figure — the only place the arcane family appears.
        fillPoly(ctx, [[x, headY - 11], [x + 2.4, headY - 7.2], [x, headY - 3.4], [x - 2.4, headY - 7.2]], PAINT);
        fillPoly(ctx, [[x, headY + 2], [x + 2.2, headY + 5], [x, headY + 8], [x - 2.2, headY + 5]], PAINT);
        ellShaded(ctx, x, headY - 0.4, 2.6, 2.8, [0, 0, 1] as Ramp, 0, { rim: false });
        figGlow(ctx, x - 0.7, headY - 1.3, 1, STAR, STAR);
      }
      // The nose. In PROFILE it is pushed past the skull's silhouette on
      // purpose — a red ball sticking out of the outline is what tells an E
      // frame from an N frame at a glance, and it is the only face feature that
      // survives a side view of a head this small.
      ellShaded(ctx, dir === "E" ? headX + 10 : ex, headY + 6, 4.6, 4.4, [11, 12, NOSE] as Ramp);
      figDetail(
        ctx,
        [[ex - 7, headY + 10.5], [ex - 2, headY + 13.5], [ex + 3, headY + 13.5], [ex + 7.5, headY + 10.5]],
        1.9,
        R_RED[0],
      ); // grin
    }

    // ── the spring, and what rides on it ──
    ellShaded(ctx, headX, crownY + 2, 8 * narrow, 4, R_RIM); // crown bolt-plate
    const lean = sway * 1.4 + (dir === "E" ? spring * 0.06 : 0);
    coilSpring(ctx, headX, crownY, spring, COIL_W * narrow, lean);
    if (hat) plate(ctx, headX + lean, crownY - spring - 3, PLATE_R * narrow, 0.3, 0);
  };
}

/**
 * SPRING ATTACK — the four beats the reference sheet spends its whole middle
 * row on: load, extend, release, recoil.
 *
 * The spring's HEIGHT is the animation. Nothing else about the creature needs
 * to move much, which is why it reads at gameplay distance where a swinging arm
 * would not.
 */
function jesterAttack(dir: Dir, beat: 0 | 1 | 2 | 3): FramePaint {
  return (ctx) => {
    // LOAD — spring compressed under the plate, arms starting to open.
    if (beat === 0) return jesterFrame(dir, { phase: 0.1, spring: SPRING_LOAD, flourish: 0.25 })(ctx);
    // EXTEND — full stretch, plate still seated, arms flung wide.
    if (beat === 1) return jesterFrame(dir, { phase: -0.1, spring: SPRING_FIRE, flourish: 1 })(ctx);

    // RELEASE (2) and RECOIL (3) — the plate is gone and the bare coil rings.
    const ring = beat === 2 ? SPRING_FIRE * 0.92 : SPRING_IDLE + 5;
    jesterFrame(dir, {
      phase: beat === 2 ? -0.2 : 0.3,
      spring: ring,
      hat: false,
      flourish: beat === 2 ? 1 : 0.4,
    })(ctx);

    // The plate in flight, drawn unshaded on top (layer 3 of the cel
    // convention). In profile it flies out along the facing; head-on it comes
    // straight at the camera, so it is drawn rounder and LARGER — the two reads
    // a player needs to tell "it fired sideways" from "it fired at me".
    const t = beat === 2 ? 0 : 1;
    if (dir === "E") {
      const fx = CX + 24 + t * 22;
      const fy = CROWN_Y - SPRING_FIRE + 4 + t * 6;
      plate(ctx, fx, fy, 16, 0.34, 0.9 + t * 1.7);
      for (let i = 0; i < 3; i++) {
        const y = fy - 5 + i * 5;
        figDetail(ctx, [[fx - 22 - i * 2, y], [fx - 12, y]], 1.8, R_RED[2]);
      }
    } else if (dir === "S") {
      // Head-on, the plate is rounder and lower each beat — it is coming at the
      // camera. It must NOT grow past the ruff, or the last attack frame is a
      // dinner plate with a monster hidden behind it.
      const fy = CROWN_Y - SPRING_FIRE + 6 + t * 14;
      plate(ctx, CX, fy, 14 + t * 2, 0.58 + t * 0.26, 1.1 + t * 1.9);
      for (const s of [-1, 1]) {
        figDetail(ctx, [[CX + s * 21, fy - 14 - t * 4], [CX + s * 14, fy - 6]], 1.8, R_RED[2]);
      }
    } else {
      const fy = CROWN_Y - SPRING_FIRE - 2 - t * 8;
      plate(ctx, CX, fy, 14 - t * 4, 0.3, 1.1 + t * 1.9);
      for (const s of [-1, 1]) {
        figDetail(ctx, [[CX + s * 16, fy + 11 + t * 3], [CX + s * 11, fy + 4]], 1.8, R_RED[2]);
      }
    }
  };
}

export function makeJesterPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    // Idle breathes through the SPRING, not the body — a jester at rest is a
    // loaded mechanism, and the bob of the plate is what says so.
    idle: [
      jesterFrame(dir, { phase: -0.1, spring: SPRING_IDLE }),
      jesterFrame(dir, { phase: 0.12, spring: SPRING_IDLE + 3 }),
      jesterFrame(dir, { phase: 0.02, spring: SPRING_IDLE + 1 }),
    ],
    walk: [
      jesterFrame(dir, { phase: -0.9, spring: SPRING_WALK }),
      jesterFrame(dir, { phase: 0.05, spring: SPRING_WALK - 3 }),
      jesterFrame(dir, { phase: 0.9, spring: SPRING_WALK }),
      jesterFrame(dir, { phase: 0.05, spring: SPRING_WALK + 3 }),
    ],
    attack: [jesterAttack(dir, 0), jesterAttack(dir, 1), jesterAttack(dir, 2), jesterAttack(dir, 3)],
    death: [
      jesterFrame(dir, { phase: 0.6, spring: SPRING_FIRE * 0.7, flourish: 0.8 }),
      jesterFrame(dir, { phase: 0, spring: 0, dead: true }),
      jesterFrame(dir, { phase: 0, spring: 0, dead: true }),
      jesterFrame(dir, { phase: 0, spring: 0, dead: true }),
    ],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}
