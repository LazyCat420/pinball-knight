/**
 * THE CEL ART — smooth vector-drawn frames (2026-07-14: "make the sprites cel
 * shaded instead of this pixel look").
 *
 * Every frame is a PAINTER: a function that draws one 128×128 cel with plain
 * canvas-2D paths. The style is classic cel shading, produced by three layers:
 *
 *   1. flat palette fills with SELOUT outlines — each shape's edge is a darker,
 *      cool-shifted version of its own fill (inkFor), not pure black, so metal
 *      edges cool-grey and leather edges cold-brown (see the draw helpers),
 *   2. hard-stop gradient bands composited `source-atop` over the finished
 *      figure: a WARM torch-tinted highlight (upper-left) and a COOL arcane
 *      shadow (lower-right) — hue-shifted, not just light/dark. Hard stops =
 *      flat bands, which is what makes it read as cel rather than airbrush,
 *   3. unshaded effects on top (muzzle flash, swing swoosh, flame).
 *
 * The screen-space palette quantizer then snaps the band blends to clean
 * palette steps, so the cels and the 3D world stay in one colour space.
 *
 * The knight is PARAMETRIC: one body painter per facing, posed by a small
 * pose object, with the held weapon drawn from WEAPON_HELD at the hand
 * anchor. That's what makes "the sword changes to whatever you picked up"
 * cheap — a new player sheet is just makeKnightPaints(weaponId).
 *
 * Only three directions are authored — W is E flipped horizontally at runtime.
 */
import { paletteCss, inkFor } from "./palette";
import { SPRITE_PX } from "../constants";
import { WEAPONS, type WeaponId } from "../items";
import {
  type Pt,
  type Dir3,
  type RigConfig,
  type Skeleton,
  type Ramp,
  CX,
  R_STEEL,
  R_STEEL_DK,
  R_BLOOD,
  buildSkeleton,
  legShaded,
  armShaded,
  limbShaded,
  ellShaded,
  plateShaded,
  rrectShaded,
  detail as figDetail,
  glow as figGlow,
} from "./figure";

export type FramePaint = (ctx: CanvasRenderingContext2D) => void;
export type Dir = "S" | "N" | "E";
export type ClipName = "idle" | "walk" | "attack" | "death" | "roll" | "run" | "ball";
export type ActorPaints = Record<Dir, Partial<Record<ClipName, FramePaint[]>>>;

const PX = SPRITE_PX; // 128 — all coordinates below live in this box
const C = paletteCss;
const INK = C(1);
const INK_W = 3;

/**
 * Fill token for the selout draw helpers: pairs the css colour with its palette
 * index so the outline can be derived from the fill (inkFor). Every shape fill
 * below is written `F(n)` instead of `C(n)`; the helpers pull the selout ink
 * from the index automatically.
 */
const F = (index: number): readonly [string, number] => [C(index), index];

// ── Draw helpers — SELOUT outlines ──────────────────────────────
//
// Pixel-art rule: don't outline in pure black. Every solid shape's outline is a
// darker, cool-shifted version of ITS OWN fill (via inkFor), so steel gets a
// cool-grey edge, leather a cold-brown edge, rot a dark-green edge. Pure black
// (INK) is reserved for the few places that read as true void: eye slits, the
// visor, x-eyes. Pass an explicit `ink` to override (e.g. keep a hard black
// slit), otherwise it's derived from the fill's palette index.
//
// Fills are passed as a [cssString, paletteIndex] pair so the helper can derive
// the matching selout ink. A bare css string still works (falls back to INK)
// for the handful of ad-hoc colours.

type Fill = string | readonly [string, number];

function fillCss(f: Fill): string {
  return typeof f === "string" ? f : f[0];
}
function fillInk(f: Fill, override?: string): string {
  if (override) return override;
  return typeof f === "string" ? INK : inkFor(f[1]);
}

function ell(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: Fill, rot = 0, ink?: string): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fillCss(fill);
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = fillInk(fill, ink);
  ctx.stroke();
}

function poly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, fill: Fill, ink?: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fillCss(fill);
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.lineJoin = "round";
  ctx.strokeStyle = fillInk(fill, ink);
  ctx.stroke();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: Fill, ink?: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fillCss(fill);
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = fillInk(fill, ink);
  ctx.stroke();
}

/** An outlined capsule limb from (x1,y1) to (x2,y2), selout edge from the fill. */
function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, fill: Fill, ink?: string): void {
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w + INK_W * 2;
  ctx.strokeStyle = fillInk(fill, ink);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w;
  ctx.strokeStyle = fillCss(fill);
  ctx.stroke();
}

/** Un-outlined detail stroke (ribs, string, cracks). Accepts a Fill or css. */
function line(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, w: number, color: Fill): void {
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = w;
  ctx.strokeStyle = fillCss(color);
  ctx.stroke();
}

/** Soft contact shadow under the figure. Drawn first, sits under everything. */
function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(11, 13, 18, 0.35)";
  ctx.fill();
}

/**
 * The cel-shading pass: HUE-SHIFTED highlight + shade bands composited over
 * everything opaque so far. HARD gradient stops — a smooth ramp would read as
 * airbrushing; abrupt bands are the whole point of cel.
 *
 * The key upgrade over a plain light/dark band: the highlight is composited
 * `overlay` in a WARM torch tint (the only warm light down here) and the shadow
 * is a COOL arcane-blue multiplied over the dark side. That's hue shifting —
 * lit steel goes warm-white, shadowed steel goes cold-blue, instead of a flat
 * grey-to-black ramp. Three bands, not two: a bright rim, a mid, and a cool
 * core shadow, so materials read as sculpted rather than pillow-lit.
 *
 * Direction is fixed in ART space (light from upper-left), NOT silhouette-
 * following, so the band models a light source instead of tracing the outline
 * (which is what pillow-shading does). Sprites can be flipped at runtime for W
 * facing; upper-left is the least-wrong constant given the scene's cold key.
 */
function celShade(ctx: CanvasRenderingContext2D): void {
  // Warm highlight on the lit (upper-left) side — overlay so it tints, not paints.
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const hi = ctx.createLinearGradient(PX * 0.18, PX * 0.04, PX * 0.62, PX * 0.62);
  hi.addColorStop(0, "rgba(255, 235, 178, 0.30)"); // torch-warm rim
  hi.addColorStop(0.33, "rgba(255, 235, 178, 0.30)");
  hi.addColorStop(0.331, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, PX, PX);
  ctx.restore();

  // Cool shade on the unlit (lower-right) side — two steps: mid then deep core.
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const sh = ctx.createLinearGradient(PX * 0.82, PX * 0.96, PX * 0.34, PX * 0.34);
  sh.addColorStop(0, "rgba(20, 42, 66, 0.42)"); // deep cool core (arcane-dark)
  sh.addColorStop(0.32, "rgba(20, 42, 66, 0.42)");
  sh.addColorStop(0.321, "rgba(28, 40, 60, 0.24)"); // cool mid
  sh.addColorStop(0.6, "rgba(28, 40, 60, 0.24)");
  sh.addColorStop(0.601, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, PX, PX);
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// HELD WEAPONS — drawn in a local frame: grip at the origin, business
// end pointing UP (-y). The knight painter translates/rotates this to
// the hand, so one drawing serves every pose in every direction.
// ══════════════════════════════════════════════════════════════════

type HeldPaint = (ctx: CanvasRenderingContext2D, o: { fire?: boolean }) => void;

/** A starburst muzzle flash / impact flash at local (x, y). Unshaded — drawn post-cel. */
function flash(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = C(17);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = C(18);
  ctx.fill();
  ctx.restore();
}

function drawSwordHeld(ctx: CanvasRenderingContext2D): void {
  poly(ctx, [[-4, -14], [-4, -58], [0, -68], [4, -58], [4, -14]], F(21)); // blade
  line(ctx, [[0, -18], [0, -60]], 1.5, F(22)); // fuller ridge
  rrect(ctx, -12, -16, 24, 7, 3, F(16)); // crossguard
  rrect(ctx, -3.5, -9, 7, 15, 3, F(27)); // grip
  ell(ctx, 0, 9, 4.5, 4.5, F(16)); // pommel
}

function drawStickHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 8, -3, -30, 9, F(28));
  limb(ctx, -3, -30, 3, -56, 8, F(28));
  ell(ctx, -2, -18, 2.5, 2, F(27)); // knots
  ell(ctx, 1, -42, 2.5, 2, F(27));
}

function drawMaceHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 8, 0, -38, 7, F(27));
  // spikes first so the ball's outline overlaps their bases
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const sx = Math.cos(a);
    const sy = Math.sin(a);
    poly(ctx, [
      [sx * 11 - sy * 4, -48 + sy * 11 + sx * 4],
      [sx * 11 + sy * 4, -48 + sy * 11 - sx * 4],
      [sx * 19, -48 + sy * 19],
    ], F(20));
  }
  ell(ctx, 0, -48, 12, 12, F(20));
  ell(ctx, 0, -48, 5, 5, F(19));
  rrect(ctx, -5, -12, 10, 5, 2, F(16)); // gold band
}

function drawChairHeld(ctx: CanvasRenderingContext2D): void {
  // A little wooden chair brandished by one leg. Ridiculous on purpose.
  limb(ctx, 0, 6, 0, -20, 7, F(28)); // the held leg
  limb(ctx, 14, -20, 14, -2, 6, F(28)); // the other front leg
  rrect(ctx, -6, -30, 28, 9, 3, F(28)); // seat
  limb(ctx, -2, -30, -2, -54, 6, F(27)); // backrest posts
  limb(ctx, 18, -30, 18, -54, 6, F(27));
  rrect(ctx, -5, -56, 26, 8, 3, F(28)); // headrail
  rrect(ctx, -3, -44, 22, 6, 2, F(27)); // slat
}

function drawGunHeld(ctx: CanvasRenderingContext2D, o: { fire?: boolean }): void {
  rrect(ctx, -5, -12, 10, 15, 3, F(27)); // grip
  rrect(ctx, -6, -34, 12, 24, 3, F(19)); // body/slide
  rrect(ctx, -3.5, -46, 7, 13, 2, F(19)); // barrel
  line(ctx, [[-4, -30], [4, -30]], 2, F(20)); // slide catch
  ell(ctx, 0, -14, 3, 3, F(16)); // hammer pin
  if (o.fire) flash(ctx, 0, -54, 12);
}

function drawBowHeld(ctx: CanvasRenderingContext2D, o: { fire?: boolean }): void {
  // Limbs curve across the aim axis; the arrow rides the -y aim line.
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-4, -44);
  ctx.quadraticCurveTo(20, 0, -4, 44);
  ctx.lineWidth = 7 + INK_W * 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-4, -44);
  ctx.quadraticCurveTo(20, 0, -4, 44);
  ctx.lineWidth = 7;
  ctx.strokeStyle = C(28);
  ctx.stroke();
  line(ctx, [[-4, -44], [-4, 44]], 2, F(21)); // string
  rrect(ctx, 2, -7, 8, 14, 3, F(27)); // grip wrap
  if (o.fire) {
    // nocked arrow, an instant from release
    line(ctx, [[0, 26], [0, -34]], 3, F(28));
    poly(ctx, [[-4, -34], [4, -34], [0, -46]], F(21)); // head
    poly(ctx, [[-1.5, 18], [-7, 28], [-1.5, 26]], F(12)); // fletching
    poly(ctx, [[1.5, 18], [7, 28], [1.5, 26]], F(12));
  }
}

function drawFlamethrowerHeld(ctx: CanvasRenderingContext2D, o: { fire?: boolean }): void {
  rrect(ctx, -9, -24, 18, 30, 5, F(14)); // fuel tank
  line(ctx, [[-9, -14], [9, -14]], 2, F(15)); // tank seam
  ell(ctx, 0, -2, 3.5, 3.5, F(16)); // valve
  rrect(ctx, -4, -44, 8, 21, 2, F(19)); // nozzle
  poly(ctx, [[-6, -44], [6, -44], [4, -52], [-4, -52]], F(20)); // muzzle bell
  // hose looping from tank base to nozzle
  ctx.beginPath();
  ctx.moveTo(8, 2);
  ctx.quadraticCurveTo(20, -18, 4, -30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (o.fire) {
    // cone of fire past the bell — three nested tongues
    poly(ctx, [[-7, -52], [7, -52], [13, -86], [-13, -86]], F(15));
    poly(ctx, [[-5, -54], [5, -54], [9, -82], [-9, -82]], F(16));
    ell(ctx, 0, -70, 5, 11, F(17));
  } else {
    ell(ctx, 0, -55, 2.5, 4, F(16)); // pilot light
  }
}

const WEAPON_HELD: Partial<Record<WeaponId, HeldPaint>> = {
  sword: (ctx) => drawSwordHeld(ctx),
  stick: (ctx) => drawStickHeld(ctx),
  mace: (ctx) => drawMaceHeld(ctx),
  chair: (ctx) => drawChairHeld(ctx),
  gun: drawGunHeld,
  bow: drawBowHeld,
  flamethrower: drawFlamethrowerHeld,
};

function drawHeld(ctx: CanvasRenderingContext2D, id: WeaponId, x: number, y: number, rot: number, fire = false): void {
  const paint = WEAPON_HELD[id];
  if (!paint) return; // fists
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  paint(ctx, { fire });
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════
// KNIGHT — parametric body per facing. Pose: bob (px down), stride
// (-1..1 leg scissor), atk (attack phase, melee or ranged flavours).
// ══════════════════════════════════════════════════════════════════

type MeleePhase = "windup" | "strike" | "low";
type RangedPhase = "aim" | "fire" | "recover";
interface KPose {
  bob: number;
  stride: number;
  atk?: MeleePhase | RangedPhase;
  /** -1..1 contralateral arm swing (walk). */
  swing?: number;
  /** -1..1 lateral body roll (walk weight-shift). */
  roll?: number;
  /** px the crest trails behind head motion (overlapping action). */
  plumeLag?: number;
  /** Forward lean radians — the sprint gait (0 for the upright walk). */
  lean?: number;
}

/** Hand anchor + weapon rotation per facing per phase. `rest` is the carry pose. */
interface HandPose {
  x: number;
  y: number;
  rot: number;
}

const HAND_S: Record<string, HandPose> = {
  rest: { x: 90, y: 84, rot: 0.14 },
  windup: { x: 80, y: 48, rot: -0.65 },
  strike: { x: 92, y: 76, rot: 1.5 },
  low: { x: 82, y: 98, rot: 2.5 },
  aim: { x: 84, y: 84, rot: 2.8 },
  fire: { x: 84, y: 84, rot: 2.8 },
  recover: { x: 85, y: 82, rot: 2.55 },
};

// N carries on the other visual side and mirrors the swing.
const HAND_N: Record<string, HandPose> = {
  rest: { x: 38, y: 84, rot: -0.14 },
  windup: { x: 48, y: 48, rot: 0.65 },
  strike: { x: 36, y: 76, rot: -1.5 },
  low: { x: 46, y: 98, rot: -2.5 },
  aim: { x: 44, y: 78, rot: -0.3 },
  fire: { x: 44, y: 78, rot: -0.3 },
  recover: { x: 43, y: 80, rot: -0.5 },
};

const HAND_E: Record<string, HandPose> = {
  rest: { x: 84, y: 82, rot: 0.5 },
  windup: { x: 68, y: 44, rot: -1.15 },
  strike: { x: 98, y: 66, rot: 1.62 },
  low: { x: 92, y: 96, rot: 2.2 },
  aim: { x: 88, y: 74, rot: 1.57 },
  fire: { x: 88, y: 74, rot: 1.57 },
  recover: { x: 86, y: 72, rot: 1.34 },
};

/**
 * The SMEAR that sells a melee strike frame — a filled crescent wedge along the
 * swing path (Medeiros' smear rules, deep-research 2026-07-15), not a thin arc:
 * the smear "connects" this frame to the previous one. Colour gradation inside
 * the wedge does the work of extra inbetween frames: the trailing (a0) end is
 * dark and fading, the leading (a1) edge — where the blade is NOW — is bright
 * steel-highlight, and lighter colours bleed OVER darker ones (drawn last).
 * A thin ghost arc trails behind the wedge (the "ghosted multiple").
 */
function swoosh(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  const wedge = (rOut: number, rIn: number, from: number, to: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, rOut, from, to);
    ctx.arc(cx, cy, rIn, to, from, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // NB alphas stay ≥ 0.55: the pixel-crush pass hard-cuts alpha < 128, so a
  // fainter layer simply VANISHES over transparent background. The smear is a
  // SOLID wedge on purpose — Medeiros lists the solid filled wedge as the
  // canonical smear shape, and solid is all that survives the cutout anyway.
  const span = a1 - a0;
  // ghosted multiple — a thin arc trailing BEHIND the wedge start
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, a0 - span * 0.3, a0 + span * 0.15);
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(138, 148, 166, 0.55)"; // steel-mid ghost
  ctx.stroke();
  // trailing body — dark, fading (drawn first so lighter layers bleed over it)
  wedge(r + 2, r - 13, a0, a1, "rgba(138, 148, 166, 0.6)");
  // mid band — brighter, covers the leading 60%
  wedge(r + 1, r - 10, a0 + span * 0.4, a1, "rgba(200, 204, 212, 0.75)");
  // leading edge — near-white hot edge over the last 30%, bleeding over everything
  wedge(r, r - 6, a0 + span * 0.7, a1, "rgba(238, 241, 245, 0.95)");
}

const GROUND = 118;

// Knight materials — RAMPS (shade/mid/hi palette indices) so every part shades
// along the steel ramp and quantizes to clean bands. Gold trim + blood plume
// are single accents.
const K_PLATE: Ramp = R_STEEL; // [19,20,21] main armour
const K_PLATE_DK: Ramp = R_STEEL_DK; // [19,19,20] under-plates / boots
const K_STEEL_DK = 19; // deepest shadow metal (flat)
const K_TRIM = 16; // flame/gold — buckle, trim glints
const K_PLUME: Ramp = R_BLOOD; // [11,12,13] helmet crest
const K_LEG: Ramp = R_STEEL; // legs (cuisses)

/** Upright knight proportions — a real standing figure, not a barrel. */
const KNIGHT_RIG: RigConfig = {
  shoulderW: 17,
  hipW: 9,
  torsoTop: 62, // shoulders sit high
  hipY: 34,
  headY: 82,
  step: 13,
  lift: 9,
};

/**
 * The plumed great-helm, drawn at the head joint. Faces per direction.
 * `plumeLag` (px) trails the crest behind the head's motion — overlapping action
 * so the plume flows on the walk/attack instead of moving rigidly with the helm.
 */
function knightHelm(ctx: CanvasRenderingContext2D, head: Pt, dir: Dir3, plumeLag = 0): void {
  const [x, y] = head;
  const pl = plumeLag; // +x trails right; the crest tip drags opposite motion
  // Crest plume — a bold blood-red comb, drawn BEHIND the helm so it reads as a
  // silhouette-topping shape, not an antenna. Multi-lobe for a flowing mane and a
  // brighter front lobe for volume; the tip lobes carry the lag.
  if (dir === "E") {
    // side profile — a long horsehair mane sweeping back off the crown
    plateShaded(ctx, [[x - 1, y - 15], [x - 14, y - 24 + pl * 0.3], [x - 27, y - 16 + pl], [x - 30, y + 2 + pl * 1.2], [x - 20, y - 2], [x - 6, y - 5]], K_PLUME, { rim: false });
    figDetail(ctx, [[x - 4, y - 13], [x - 18, y - 16 + pl * 0.6], [x - 27, y - 8 + pl]], 2, 13); // bright strand
    figDetail(ctx, [[x - 6, y - 8], [x - 20, y - 6 + pl]], 1.5, 11); // dark strand
  } else {
    // front/back — a tall fanned crest rising off the crown, tip trailing on pl
    plateShaded(ctx, [[x - 4, y - 14], [x - 2 + pl * 0.4, y - 27], [x + 6 + pl, y - 30], [x + 11 + pl * 1.2, y - 22], [x + 6, y - 14]], K_PLUME, { rim: false });
    figDetail(ctx, [[x + 1, y - 15], [x + 3 + pl * 0.6, y - 25], [x + 8 + pl, y - 28]], 2, 13); // bright strand
    figDetail(ctx, [[x + 2, y - 15], [x + 5 + pl, y - 23]], 1.5, 11); // dark strand
  }
  // Helm dome — a rounded bucket, not a ball: flat-ish crown, jaw taper.
  if (dir === "E") {
    plateShaded(ctx, [[x - 12, y - 12], [x + 12, y - 12], [x + 14, y + 4], [x + 8, y + 12], [x - 10, y + 10]], K_PLATE, { backlight: 30 });
    // brow ridge catches light — a bright band across the crown
    figDetail(ctx, [[x - 10, y - 9], [x + 10, y - 9]], 1.5, 21);
    // nose guard juts forward (+x)
    plateShaded(ctx, [[x + 12, y - 4], [x + 19, y + 2], [x + 12, y + 8]], K_PLATE_DK);
    // eye slit — hard black void, the only pure-INK on the figure
    rrectShaded(ctx, x + 2, y - 3, 11, 4, 1.5, 1, { ink: 1 });
  } else {
    plateShaded(ctx, [[x - 13, y - 13], [x + 13, y - 13], [x + 14, y + 6], [x + 6, y + 13], [x - 6, y + 13], [x - 14, y + 6]], K_PLATE, { backlight: 30 });
    // brow ridge highlight across the crown for a defined forehead
    figDetail(ctx, [[x - 11, y - 9], [x + 11, y - 9]], 1.5, 21);
    if (dir === "S") {
      // T-visor: a vertical breath-slot meeting a horizontal eye-slit — the
      // single most important readability feature. Hard black.
      rrectShaded(ctx, x - 11, y - 3, 22, 4, 2, 1, { ink: 1 }); // eye slit
      rrectShaded(ctx, x - 2.5, y - 1, 5, 12, 2, 1, { ink: 1 }); // breath slot
      figGlow(ctx, x - 6, y - 1, 1.6, 30, 18); // faint arcane eye-spark, left
      figGlow(ctx, x + 6, y - 1, 1.6, 30, 18); // right
      figDetail(ctx, [[x - 12, y + 9], [x + 12, y + 9]], 1.5, K_STEEL_DK); // chin seam
    } else {
      // back of the helm — a central ridge + neck guard
      figDetail(ctx, [[x, y - 12], [x, y + 12]], 2.5, K_STEEL_DK);
      figDetail(ctx, [[x - 10, y + 9], [x + 10, y + 9]], 2, K_STEEL_DK);
    }
  }
}

/**
 * A greave — a shin plate over the lower leg + a sabaton toe cap. Drawn on top
 * of the leg so the knight reads as fully armoured, not bare-legged in boots.
 */
function knightGreave(ctx: CanvasRenderingContext2D, knee: Pt, foot: Pt, m: Ramp): void {
  // shin plate: a tapered plate from just below the knee to the ankle
  const mx = (knee[0] + foot[0]) / 2;
  plateShaded(ctx, [[knee[0] - 5, knee[1] + 2], [knee[0] + 5, knee[1] + 2], [mx + 4, foot[1] - 4], [mx - 4, foot[1] - 4]], m);
  figDetail(ctx, [[knee[0], knee[1] + 3], [mx, foot[1] - 5]], 1.4, 21); // centre glint
  // knee cop (poleyn) — a rounded disc over the knee
  ellShaded(ctx, knee[0], knee[1], 4.5, 4.5, m);
}

/**
 * One knight frame, posed from the shared biped rig. Draw order is
 * back-to-front so limbs overlap correctly; the held weapon rides the weapon
 * hand from the HAND_* tables (kept — they encode good swing arcs).
 */
function knightFrame(ctx: CanvasRenderingContext2D, dir: Dir, pose: KPose, weapon: WeaponId): void {
  const { bob, stride, atk } = pose;
  const swing = pose.swing ?? 0;
  const roll = pose.roll ?? 0;
  const plumeLag = pose.plumeLag ?? 0;
  const ranged = WEAPONS[weapon].kind === "ranged";
  const hands = dir === "S" ? HAND_S : dir === "N" ? HAND_N : HAND_E;
  const hand = hands[atk ?? "rest"];
  const firing = atk === "fire" || (atk === "strike" && !ranged);
  const d3 = dir as Dir3;

  const sk = buildSkeleton(d3, { bob, stride, swing, roll, lean: pose.lean ?? 0, crouch: atk === "windup" ? 0.3 : 0 }, KNIGHT_RIG);
  const weaponHand: Pt = [hand.x, hand.y];

  groundShadow(ctx, CX, GROUND + 3, 26);

  // Ghosted weapon multiple on the strike frame (pose-to-pose + smear, not
  // tweening): the weapon is drawn ONCE more at the halfway pose between windup
  // and strike, faint, so the eye reads the swept path. Melee only.
  const drawGhost = (): void => {
    if (!(firing && !ranged && weapon !== "fists")) return;
    const wu = hands.windup;
    ctx.save();
    ctx.globalAlpha = 0.55; // ≥0.55 or the crush pass's alpha cutout deletes it
    drawHeld(ctx, weapon, (wu.x + hand.x) / 2, (wu.y + hand.y) / 2, wu.rot + (hand.rot - wu.rot) * 0.55);
    ctx.restore();
  };

  // Which arm holds the weapon: S → right (screen +x), N → left, E → near arm.
  const weaponBehind = dir === "N";
  if (weaponBehind) {
    drawGhost();
    drawHeld(ctx, weapon, hand.x, hand.y, hand.rot, atk === "fire");
  }

  // ── BACK leg first, then front, so the near leg overlaps ──
  if (dir === "E") {
    // profile: far leg (dimmer) behind, near leg in front
    legShaded(ctx, sk.hip, sk.kneeL, sk.footL, 11, K_STEEL_DK, K_STEEL_DK, d3);
    knightGreave(ctx, sk.kneeL, sk.footL, K_PLATE_DK); // far greave (dim)
    legShaded(ctx, sk.hip, sk.kneeR, sk.footR, 12, K_LEG, K_PLATE_DK, d3);
    knightGreave(ctx, sk.kneeR, sk.footR, K_PLATE); // near greave
  } else {
    legShaded(ctx, sk.hipL, sk.kneeL, sk.footL, 12, K_LEG, K_PLATE_DK, d3);
    legShaded(ctx, sk.hipR, sk.kneeR, sk.footR, 12, K_LEG, K_PLATE_DK, d3);
    knightGreave(ctx, sk.kneeL, sk.footL, K_PLATE);
    knightGreave(ctx, sk.kneeR, sk.footR, K_PLATE);
  }

  // ── faulds + tassets (armoured skirt over the hips) ──
  if (dir !== "E") {
    // central fauld
    plateShaded(ctx, [[sk.hipL[0] - 2, sk.hip[1] - 4], [sk.hipR[0] + 2, sk.hip[1] - 4], [sk.hipR[0] + 5, sk.hip[1] + 10], [sk.hipL[0] - 5, sk.hip[1] + 10]], K_PLATE_DK);
    // two thigh tassets hanging over the legs — reads as layered plate armour
    plateShaded(ctx, [[sk.hipL[0] - 4, sk.hip[1] + 2], [sk.hipL[0] + 4, sk.hip[1] + 2], [sk.hipL[0] + 3, sk.hip[1] + 15], [sk.hipL[0] - 5, sk.hip[1] + 14]], K_LEG);
    plateShaded(ctx, [[sk.hipR[0] - 4, sk.hip[1] + 2], [sk.hipR[0] + 4, sk.hip[1] + 2], [sk.hipR[0] + 5, sk.hip[1] + 14], [sk.hipR[0] - 3, sk.hip[1] + 15]], K_LEG);
  } else {
    // profile: a single tasset over the near thigh
    plateShaded(ctx, [[sk.hip[0] - 2, sk.hip[1] - 2], [sk.hip[0] + 9, sk.hip[1] - 2], [sk.hip[0] + 8, sk.hip[1] + 13], [sk.hip[0] - 2, sk.hip[1] + 12]], K_PLATE_DK);
  }

  // ── torso: a tapered cuirass, wider at the chest ── (cool backlight rim on
  // the shadow side — the second light that makes plate read as polished metal)
  const t = knightTorsoPts(sk, dir);
  plateShaded(ctx, t, K_PLATE, { backlight: 30 });
  // plackart V-seam + fluting + belt + gold buckle
  if (dir === "S") {
    figDetail(ctx, [[sk.chest[0], sk.chest[1] + 2], [sk.chest[0], sk.hip[1] - 2]], 2, K_STEEL_DK); // central keel
    figDetail(ctx, [[sk.chest[0] - 12, sk.chest[1] + 4], [sk.chest[0], sk.chest[1] + 15], [sk.chest[0] + 12, sk.chest[1] + 4]], 1.5, K_STEEL_DK); // plackart V
    figDetail(ctx, [[sk.chest[0] - 9, sk.chest[1] - 1], [sk.chest[0] - 7, sk.chest[1] + 10]], 1.2, 21); // pec highlight L
    figDetail(ctx, [[sk.chest[0] + 9, sk.chest[1] - 1], [sk.chest[0] + 7, sk.chest[1] + 10]], 1.2, 21); // pec highlight R
    rrectShaded(ctx, sk.chest[0] - 3, sk.chest[1] - 2, 6, 5, 1.5, K_TRIM); // gorget-boss / gold stud
  } else if (dir === "E") {
    figDetail(ctx, [[sk.chest[0] + 8, sk.chest[1] - 1], [sk.chest[0] + 7, sk.hip[1] - 3]], 1.4, 21); // front-edge highlight
    figDetail(ctx, [[sk.chest[0] - 6, sk.chest[1] + 3], [sk.chest[0] - 7, sk.hip[1] - 3]], 1.4, K_STEEL_DK); // back-edge shadow
  }
  rrectShaded(ctx, sk.hipL[0] - 2, sk.hip[1] - 6, (sk.hipR[0] - sk.hipL[0]) + 4, 6, 2, 27); // belt
  rrectShaded(ctx, sk.hip[0] - 4, sk.hip[1] - 6, 8, 6, 1.5, K_TRIM); // buckle

  // ── off arm (non-weapon) — now driven by the rig joints so it SWINGS ──
  if (dir === "E") {
    // far arm hint behind the torso (dim), tracks the swing subtly
    armShaded(ctx, [sk.shoulderL[0] + 2, sk.shoulderL[1] + 2], sk.elbowL, sk.handL, 7, K_STEEL_DK, K_PLATE_DK);
  } else {
    const offSh: Pt = dir === "S" ? sk.shoulderL : sk.shoulderR;
    const offEl: Pt = dir === "S" ? sk.elbowL : sk.elbowR;
    const offHand: Pt = dir === "S" ? sk.handL : sk.handR;
    armShaded(ctx, offSh, offEl, offHand, 8, K_LEG, K_PLATE_DK);
  }

  // ── pauldrons (shoulder cops) — angular LAYERED plates (two lames) that widen
  // the shoulders. A rounded multi-point plate reads as armour, not a button. ──
  const pauldron = (px: number, py: number, flip: number): void => {
    // main cop
    plateShaded(ctx, [[px - 11 * flip, py - 5], [px + 10 * flip, py - 8], [px + 12 * flip, py + 5], [px - 9 * flip, py + 9]], K_PLATE, { backlight: 30 });
    // lower lame (a second overlapping plate for depth)
    plateShaded(ctx, [[px - 9 * flip, py + 5], [px + 11 * flip, py + 3], [px + 10 * flip, py + 11], [px - 7 * flip, py + 12]], K_PLATE_DK);
    figDetail(ctx, [[px - 7 * flip, py - 1], [px + 9 * flip, py - 4]], 1.5, 21); // top-edge glint
  };
  if (dir === "E") {
    pauldron(sk.shoulderR[0] + 3, sk.shoulderR[1], 1);
  } else {
    pauldron(sk.shoulderL[0], sk.shoulderL[1], -1);
    pauldron(sk.shoulderR[0], sk.shoulderR[1], 1);
  }

  // ── weapon arm: shoulder → hand anchor ──
  const wShoulder: Pt = dir === "S" ? sk.shoulderR : dir === "N" ? sk.shoulderL : sk.shoulderR;
  armShaded(ctx, wShoulder, [(wShoulder[0] + weaponHand[0]) / 2, (wShoulder[1] + weaponHand[1]) / 2 - 3], weaponHand, 8, K_LEG, K_PLATE_DK);
  // gauntlet fist at the weapon hand
  ellShaded(ctx, weaponHand[0], weaponHand[1], 5, 5, K_PLATE);

  // ── head / helm (plume trails on plumeLag) ──
  knightHelm(ctx, sk.head, d3, plumeLag);

  if (!weaponBehind) {
    drawGhost();
    drawHeld(ctx, weapon, hand.x, hand.y, hand.rot, atk === "fire");
  }

  // post effects: full-brightness swing smear / punch flash (no global celShade
  // — the parts are self-shaded now, so the soft gradient would only mush them)
  if (firing && !ranged && weapon !== "fists") {
    if (dir === "S") swoosh(ctx, 64, 74, 44, 0.55, 1.85);
    else if (dir === "N") swoosh(ctx, 64, 74, 44, Math.PI + 0.55, Math.PI + 1.85);
    else swoosh(ctx, 66, 62, 46, -0.75, 0.75);
  }
  if (firing && weapon === "fists") {
    // Punch smear: a ghost fist + speed lines back along the punch path (from
    // the windup hand pose to the strike), then the impact star at the fist.
    const wu = hands.windup;
    const gx = wu.x + (hand.x - wu.x) * 0.45;
    const gy = wu.y + (hand.y - wu.y) * 0.45;
    ctx.save();
    ctx.globalAlpha = 0.55; // ≥0.55 or the crush pass's alpha cutout deletes it
    ell(ctx, gx, gy, 5, 5, F(20)); // ghosted gauntlet multiple
    ctx.restore();
    for (let i = -1; i <= 1; i++) {
      const t0 = 0.25 + Math.abs(i) * 0.12;
      line(
        ctx,
        [
          [wu.x + (hand.x - wu.x) * t0 + i * 5, wu.y + (hand.y - wu.y) * t0 - i * 4],
          [wu.x + (hand.x - wu.x) * 0.85 + i * 3, wu.y + (hand.y - wu.y) * 0.85 - i * 2],
        ],
        2,
        "rgba(238, 241, 245, 0.8)",
      );
    }
    flash(ctx, hand.x + (dir === "N" ? -10 : 10), hand.y - 4, 10);
  }
}

/** Cuirass outline points from the skeleton — a breastplate that tapers to the waist. */
function knightTorsoPts(sk: Skeleton, dir: Dir): Pt[] {
  const c = sk.chest;
  const hy = sk.hip[1] - 2;
  if (dir === "E") {
    return [[c[0] - 11, c[1] - 2], [c[0] + 12, c[1] - 2], [c[0] + 10, hy], [c[0] - 10, hy]];
  }
  const sw = 15;
  return [[c[0] - sw, c[1] - 4], [c[0] + sw, c[1] - 4], [c[0] + sw - 2, c[1] + 14], [sk.hipR[0] + 2, hy], [sk.hipL[0] - 2, hy], [c[0] - sw + 2, c[1] + 14]];
}

/**
 * DODGE-ROLL frame: reuse the standing (idle) body but tuck it into a ball and
 * spin it about the feet, the same trick the death collapse uses (rotate a
 * finished figure around GROUND). `t` 0→1 across the roll: the knight ducks,
 * spins a full turn, and pops back up — so the 4-frame clip reads as a
 * forward tumble. Direction of spin follows facing so a westward roll turns
 * the other way from an eastward one.
 */
function knightRollFrame(dir: Dir, t: number, weapon: WeaponId): FramePaint {
  const base = (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 4, stride: 0, roll: 0.3 }, weapon);
  const spinDir = dir === "N" ? -1 : 1; // N faces away → tumble reads reversed
  const angle = spinDir * t * Math.PI * 2; // one full rotation across the roll
  const tuck = 0.72 + 0.12 * Math.sin(t * Math.PI); // squash to a ball mid-roll
  return (ctx) => {
    ctx.save();
    // pivot about the feet line, tuck (scale down), then spin
    ctx.translate(CX, GROUND - 22);
    ctx.rotate(angle);
    ctx.scale(tuck, tuck);
    ctx.translate(-CX, -(GROUND - 22));
    base(ctx);
    ctx.restore();
  };
}

/**
 * BALL-FORM frame: the pinball overcharge ultimate — the knight tucked to a
 * tight ball, spinning a quarter-turn per frame, with a bright speed ring
 * chasing the spin so it reads as a blurring wheel even at 4 frames. Same
 * rotate-a-finished-figure trick as the roll, just tighter and looping.
 */
function knightBallFrame(dir: Dir, spin: number, weapon: WeaponId): FramePaint {
  const base = (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 6, stride: 0, roll: 0.4 }, weapon);
  return (ctx) => {
    groundShadow(ctx, CX, GROUND + 3, 22);
    ctx.save();
    ctx.translate(CX, GROUND - 20);
    ctx.rotate(spin);
    ctx.scale(0.6, 0.6);
    ctx.translate(-CX, -(GROUND - 20));
    base(ctx);
    ctx.restore();
    // speed ring — an arc chasing the spin angle (alpha ≥0.55: crush cutout)
    ctx.beginPath();
    ctx.arc(CX, GROUND - 20, 27, spin, spin + 3.6);
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(238, 241, 245, 0.7)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CX, GROUND - 20, 22, spin + 0.6, spin + 2.6);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(111, 208, 232, 0.6)"; // arcane streak inside
    ctx.stroke();
  };
}

/** Build the full painter set for the knight holding `weapon`. */
export function makeKnightPaints(weapon: WeaponId): ActorPaints {
  const ranged = WEAPONS[weapon].kind === "ranged";
  const F = (dir: Dir, p: KPose) => (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, p, weapon);

  const dirClips = (dir: Dir) => ({
    // ── IDLE: a 4-frame breathing loop. The chest rises (bob up) and settles,
    // and the plume drifts a touch — a living stance, not a 2-frame twitch. ──
    idle: [
      F(dir, { bob: 0, stride: 0, plumeLag: 0 }),
      F(dir, { bob: -1, stride: 0, plumeLag: -0.6 }), // inhale, plume lifts
      F(dir, { bob: 0.5, stride: 0, plumeLag: 0.4 }), // settle
      F(dir, { bob: 1.5, stride: 0, plumeLag: 1 }), // exhale, plume drops
    ],

    // ── WALK: an 8-frame cycle. Two contact→passing→push per stride, with
    // contralateral arm SWING, half-cadence body ROLL, a vertical bob that peaks
    // at passing, and the plume trailing the head. This reads as a real gait. ──
    walk: [
      // right foot forward — contact
      F(dir, { bob: 0, stride: 1, swing: -1, roll: 1, plumeLag: 1 }),
      // passing (feet under, body lifts)
      F(dir, { bob: -1.5, stride: 0.3, swing: -0.4, roll: 0.4, plumeLag: 0.3 }),
      // left foot forward — contact
      F(dir, { bob: 0.5, stride: -0.4, swing: 0.4, roll: -0.4, plumeLag: -0.4 }),
      // push
      F(dir, { bob: 1, stride: -1, swing: 1, roll: -1, plumeLag: -1 }),
      // right foot forward again — mirror half of the cycle for a smooth loop
      F(dir, { bob: 0, stride: -1, swing: 1, roll: -1, plumeLag: -1 }),
      F(dir, { bob: -1.5, stride: -0.3, swing: 0.4, roll: -0.4, plumeLag: -0.3 }),
      F(dir, { bob: 0.5, stride: 0.4, swing: -0.4, roll: 0.4, plumeLag: 0.4 }),
      F(dir, { bob: 1, stride: 1, swing: -1, roll: 1, plumeLag: 1 }),
    ],

    // ── RUN: the sprint gait — same 8-beat cycle as the walk but LEANING into
    // it, with a deeper stride, harder arm pump and the plume streaming further.
    // player.ts swaps walk→run as the sprint charge builds and ramps the
    // playback rate with the charge, so the sprint visibly winds up. ──
    run: [
      F(dir, { bob: 0.5, stride: 1.4, swing: -1.4, roll: 1.2, plumeLag: 2, lean: 0.2 }),
      F(dir, { bob: -2.5, stride: 0.4, swing: -0.6, roll: 0.5, plumeLag: 1, lean: 0.24 }),
      F(dir, { bob: 0.8, stride: -0.6, swing: 0.6, roll: -0.5, plumeLag: -0.8, lean: 0.2 }),
      F(dir, { bob: 1.8, stride: -1.4, swing: 1.4, roll: -1.2, plumeLag: -2, lean: 0.17 }),
      F(dir, { bob: 0.5, stride: -1.4, swing: 1.4, roll: -1.2, plumeLag: -2, lean: 0.2 }),
      F(dir, { bob: -2.5, stride: -0.4, swing: 0.6, roll: -0.5, plumeLag: -1, lean: 0.24 }),
      F(dir, { bob: 0.8, stride: 0.6, swing: -0.6, roll: 0.5, plumeLag: 0.8, lean: 0.2 }),
      F(dir, { bob: 1.8, stride: 1.4, swing: -1.4, roll: 1.2, plumeLag: 2, lean: 0.17 }),
    ],

    // ── ATTACK: anticipation → STRIKE (index 1, the hit frame) → follow-through
    // → recover. Fast into the strike, slow out — "speed communicates weight".
    // The strike stays at index 1 so it lands in the ATTACK_ACTIVE time window. ──
    attack: ranged
      ? [
          F(dir, { bob: 0, stride: 0, atk: "aim", plumeLag: -0.5 }),
          F(dir, { bob: 1, stride: 0, atk: "fire", plumeLag: 1.5 }), // release recoil
          F(dir, { bob: 0.5, stride: 0, atk: "recover", plumeLag: 0.6 }),
          F(dir, { bob: 0, stride: 0, atk: "aim", plumeLag: 0 }), // settle back to aim
        ]
      : [
          // anticipation — coil back, plume swings forward (opposing wind-up)
          F(dir, { bob: -1, stride: 0, atk: "windup", roll: 0.6, plumeLag: -1.5 }),
          // STRIKE (index 1) — full commit, body drops into it, plume whips back
          F(dir, { bob: 1.5, stride: 0, atk: "strike", roll: -0.8, plumeLag: 2 }),
          // follow-through — the swing overshoots low, weight carries through
          F(dir, { bob: 1, stride: 0, atk: "low", roll: -0.5, plumeLag: 1 }),
          // recover — ease back toward the carry rest
          F(dir, { bob: 0.3, stride: 0, plumeLag: 0.3 }),
        ],

    // ── ROLL: a 4-frame forward tumble — duck, spin a full turn about the
    // feet, pop back up. i-frames cover the front half (see player.ts); the
    // spin is fastest through the middle two frames where the tuck is tightest. ──
    roll: [
      knightRollFrame(dir, 0.12, weapon),
      knightRollFrame(dir, 0.4, weapon),
      knightRollFrame(dir, 0.68, weapon),
      knightRollFrame(dir, 0.92, weapon),
    ],

    // ── BALL: the pinball-overcharge form — a looping quarter-turn-per-frame
    // spin of the tucked figure with a chasing speed ring. ──
    ball: [
      knightBallFrame(dir, 0, weapon),
      knightBallFrame(dir, Math.PI / 2, weapon),
      knightBallFrame(dir, Math.PI, weapon),
      knightBallFrame(dir, (3 * Math.PI) / 2, weapon),
    ],
  });

  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// ZOMBIE — hunched, lopsided, rotten. One parametric body per facing;
// the death collapse reuses the standing body rotated around the feet.
// ══════════════════════════════════════════════════════════════════

interface ZPose {
  bob: number;
  stride: number;
  /** Extra forward lean, radians — the shamble. */
  lurch: number;
  dead?: boolean;
}

// ── Zombie VARIETY ──────────────────────────────────────────────
//
// One shared sheet made every zombie identical. Now each zombie rolls a small
// deterministic VARIANT (a few pre-built sheets, picked per-spawn by seed) that
// changes: skin rot tone, torn-clothing patches, splashed blood, and a chance
// of a lopped-off / bandaged limb. Purely cosmetic — the collision body and
// clip layout are untouched, so a variant sheet drops into the same animator.

export interface ZVariant {
  /** Rot skin base index (6=shadow-green .. 9=light-green) — shifts the tone. */
  skin: number;
  /** Torn-cloth colour index for hanging rags on torso/legs. */
  rag: number;
  /** 0..3 — how much extra caked blood/gore to splatter on. */
  gore: number;
  /** Which arm is a stump (null = both intact). Reads as battle-worn. */
  stump: "L" | "R" | null;
  /** A soiled bandage wrap somewhere, adds silhouette noise. */
  bandage: boolean;
  /** Per-variant jitter seed for splatter placement. */
  seed: number;
}

/** Deterministic 0..1 from an integer step — no Math.random (breaks resume). */
function vrand(seed: number, step: number): number {
  const x = Math.sin(seed * 127.1 + step * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The variant pool. A handful of distinct looks; zombies index in by seed. */
export const ZOMBIE_VARIANTS: ZVariant[] = [
  { skin: 7, rag: 26, gore: 1, stump: null, bandage: false, seed: 1 },
  { skin: 8, rag: 27, gore: 2, stump: "L", bandage: false, seed: 2 },
  { skin: 6, rag: 2, gore: 3, stump: null, bandage: true, seed: 3 },
  { skin: 9, rag: 28, gore: 0, stump: "R", bandage: false, seed: 4 },
  { skin: 7, rag: 29, gore: 2, stump: null, bandage: true, seed: 5 },
];

/** Caked-blood splatter for a gorier variant — post-fill, pre-shade. */
function goreSplatter(ctx: CanvasRenderingContext2D, v: ZVariant, cx: number, cy: number): void {
  const n = v.gore * 3;
  for (let i = 0; i < n; i++) {
    const a = vrand(v.seed, i * 2) * Math.PI * 2;
    const r = 4 + vrand(v.seed, i * 2 + 1) * 16;
    const rad = 1.6 + vrand(v.seed, i * 3) * 2.6;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, rad, rad * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = i % 3 === 0 ? C(12) : C(11);
    ctx.fill();
  }
}

/** A few torn rags hanging off a limb/torso point — jagged triangles. */
function rags(ctx: CanvasRenderingContext2D, v: ZVariant, x: number, y: number, count = 3): void {
  for (let i = 0; i < count; i++) {
    const dx = (i - count / 2) * 5 + vrand(v.seed, i + 40) * 3;
    const len = 6 + vrand(v.seed, i + 50) * 8;
    poly(ctx, [[x + dx - 3, y], [x + dx + 3, y], [x + dx + vrand(v.seed, i) * 3 - 1.5, y + len]], F(v.rag));
  }
}

/** Zombie skin ramp from a variant's base index (shade→mid→light, clamped). */
function zombieRamp(v: ZVariant): Ramp {
  const s = v.skin; // 6..9
  return [Math.max(6, s), Math.min(9, s + 1), Math.min(9, s + 2)] as const;
}

/** Hunched, sunken zombie proportions — head thrust forward, narrow shoulders. */
const ZOMBIE_RIG: RigConfig = {
  shoulderW: 13,
  hipW: 8,
  torsoTop: 52, // shoulders lower than the knight's (hunched)
  hipY: 32,
  headY: 66,
  step: 11,
  lift: 7,
};

/**
 * The rotten head, drawn at the head joint. A gaunt skull-ish oval with a
 * mangy scalp, mismatched GLOWING eyes (unshaded so they bloom), and a slack
 * jaw. Faces per direction; N shows a weeping crater instead of a face.
 */
function zombieHead(ctx: CanvasRenderingContext2D, head: Pt, dir: Dir3, dead: boolean, v: ZVariant): void {
  const [x, y] = head;
  const skin = zombieRamp(v);
  const tilt = dir === "E" ? 0.32 : 0.14;
  // skull — a gaunt oval, jaw dropped
  ellShaded(ctx, x, y, 12, 13, skin, tilt);
  // mangy dark scalp patch
  ellShaded(ctx, x - 3, y - 8, 6, 4, skin[0], tilt, { rim: false });

  if (dir === "N") {
    // back of the skull: a weeping wound + a couple of hair mats, no face
    ellShaded(ctx, x + 2, y - 1, 4, 5, 11, 0, { rim: false });
    figDetail(ctx, [[x - 6, y - 6], [x - 4, y + 4]], 2, skin[0]);
    return;
  }

  const ex = dir === "E" ? x + 5 : x;
  if (dead) {
    // x-ed out eyes
    figDetail(ctx, [[ex - 7, y - 4], [ex - 2, y + 1]], 2.5, 1);
    figDetail(ctx, [[ex - 2, y - 4], [ex - 7, y + 1]], 2.5, 1);
    if (dir === "S") {
      figDetail(ctx, [[ex + 3, y - 4], [ex + 8, y + 1]], 2.5, 1);
      figDetail(ctx, [[ex + 8, y - 4], [ex + 3, y + 1]], 2.5, 1);
    }
  } else {
    // sunken eye SOCKETS (dark) with a glowing pupil inside — the socket gives
    // the glow a rim so it doesn't float, and reads as a rotten face.
    ellShaded(ctx, ex - 5, y - 1, 4, 4, 6, 0, { rim: false, ink: 1 });
    figGlow(ctx, ex - 5, y - 1, 2.4, 16, 17);
    if (dir === "S") {
      ellShaded(ctx, ex + 5, y - 1, 3.4, 3.6, 6, 0, { rim: false, ink: 1 });
      figGlow(ctx, ex + 5, y - 1, 1.8, 16, 17);
    }
  }
  // slack jaw — a dark maw with a tooth glint
  const jx = dir === "E" ? x + 5 : x + 1;
  ellShaded(ctx, jx, y + 9, 5.5, 4.5, 6, tilt, { rim: false, ink: 1 });
  figDetail(ctx, [[jx - 3, y + 7], [jx + 3, y + 7]], 1.5, 22); // teeth glint
}

/**
 * The zombie's standing body, posed from the shared biped rig with a forward
 * LEAN (the shamble). Signature preserved for the brute/spitter/boss overlays
 * that scale this and draw on top. `lurch` becomes the lean angle.
 */
function zombieStanding(ctx: CanvasRenderingContext2D, dir: Dir, pose: ZPose, v: ZVariant): void {
  const { bob, stride, lurch, dead } = pose;
  const d3 = dir as Dir3;
  const skin = zombieRamp(v);
  const dark = skin[0];
  const flesh = skin[1];
  const rag: Ramp = [Math.max(26, v.rag - 1), v.rag, Math.min(28, v.rag + 1)] as const;
  const stumpL = v.stump === "L";
  const stumpR = v.stump === "R";

  // Lean the whole upper body forward around the feet (the shamble) — bigger in
  // profile where it reads, subtle head-on.
  const lean = (dir === "E" ? 1 : 0.45) * (0.5 + lurch * 4);
  const sk = buildSkeleton(d3, { bob, stride, lean, crouch: dead ? 0.4 : 0 }, ZOMBIE_RIG);

  // ── legs — bare rotten shanks in tattered trousers ──
  if (dir === "E") {
    legShaded(ctx, sk.hip, sk.kneeL, sk.footL, 9, skin[0], dark, d3);
    legShaded(ctx, sk.hip, sk.kneeR, sk.footR, 10, rag, flesh, d3);
  } else {
    legShaded(ctx, sk.hipL, sk.kneeL, sk.footL, 10, rag, dark, d3);
    legShaded(ctx, sk.hipR, sk.kneeR, sk.footR, 10, rag, dark, d3);
  }
  if (dir !== "N") rags(ctx, v, CX - 2, sk.hip[1] + 8, 2); // trouser cuffs

  // ── torso — a hunched ribcage barrel ──
  const t = zombieTorsoPts(sk, dir);
  plateShaded(ctx, t, skin);
  // exposed ribs on the lit side (a few clean arcs, not noise)
  if (dir !== "N") {
    const rx = dir === "E" ? sk.chest[0] + 2 : sk.chest[0] - 7;
    for (let i = 0; i < 3; i++) {
      const ry = sk.chest[1] + 4 + i * 6;
      figDetail(ctx, [[rx - 6, ry], [rx + 6, ry + 1]], 1.8, skin[2]);
    }
    // gut wound
    ellShaded(ctx, sk.chest[0] + 5, sk.hip[1] - 6, 5, 4, 11, 0, { rim: false });
  } else {
    figDetail(ctx, [[sk.chest[0], sk.chest[1]], [sk.chest[0] - 1, sk.hip[1]]], 3, skin[0]); // spine
  }
  if (v.bandage) limbShaded(ctx, [sk.chest[0] - 13, sk.chest[1] + 2], [sk.chest[0] + 12, sk.chest[1] + 10], 5, rag);

  // ── arms — reaching forward, grasping (the zombie shape) ──
  const armReach = dir === "E" ? 26 : 16;
  const armY = sk.chest[1] + 4;
  if (dir === "E") {
    // both arms out toward +x, one higher
    zombieArm(ctx, [sk.chest[0] + 2, sk.chest[1]], [sk.chest[0] + armReach, armY - 6], skin, flesh, stumpR);
    zombieArm(ctx, [sk.chest[0], sk.chest[1] + 4], [sk.chest[0] + armReach - 3, armY + 8], skin[0], flesh, stumpL);
  } else if (dir === "S") {
    // reaching toward the camera: hands come DOWN and forward, big
    zombieArm(ctx, sk.shoulderL, [sk.shoulderL[0] - 4, armY + 22], skin, flesh, stumpL);
    zombieArm(ctx, sk.shoulderR, [sk.shoulderR[0] + 4, armY + 22], skin, flesh, stumpR);
  } else {
    // from behind: both droop outward
    zombieArm(ctx, sk.shoulderL, [sk.shoulderL[0] - 8, armY + 24], skin[0], dark, stumpL);
    zombieArm(ctx, sk.shoulderR, [sk.shoulderR[0] + 8, armY + 24], skin[0], dark, stumpR);
  }

  // caked gore on the torso for the gorier variants (kept subtle after silhouette)
  if (v.gore > 0 && !dead) goreSplatter(ctx, v, sk.chest[0], sk.chest[1] + 6);

  // ── head — thrust forward off the hunch ──
  zombieHead(ctx, sk.head, d3, !!dead, v);
}

/** A zombie arm shoulder→hand with a grasping claw or a bleeding stump. */
function zombieArm(ctx: CanvasRenderingContext2D, sh: Pt, hand: Pt, m: Ramp | number, handM: Ramp | number, stump: boolean): void {
  if (stump) {
    const mid: Pt = [(sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2];
    limbShaded(ctx, sh, mid, 8, m);
    ellShaded(ctx, mid[0], mid[1], 5, 5, 11, 0, { rim: false }); // bleeding stump cap
    return;
  }
  const elbow: Pt = [(sh[0] + hand[0]) / 2 + 1, (sh[1] + hand[1]) / 2 - 2];
  limbShaded(ctx, sh, elbow, 8, m);
  limbShaded(ctx, elbow, hand, 7, m);
  // grasping claw — three splayed fingers
  ellShaded(ctx, hand[0], hand[1], 4, 4, handM, 0, { rim: false });
  const dir = Math.sign(hand[0] - sh[0]) || 1;
  for (let i = -1; i <= 1; i++) {
    figDetail(ctx, [[hand[0], hand[1]], [hand[0] + dir * 5, hand[1] + i * 4]], 1.6, typeof handM === "number" ? handM : handM[0]);
  }
}

/** Hunched ribcage torso outline from the skeleton. */
function zombieTorsoPts(sk: Skeleton, dir: Dir): Pt[] {
  const c = sk.chest;
  const hy = sk.hip[1] + 2;
  if (dir === "E") {
    return [[c[0] - 8, c[1] - 6], [c[0] + 11, c[1] - 4], [c[0] + 9, hy], [c[0] - 9, hy - 2]];
  }
  const sw = 12;
  return [[c[0] - sw, c[1] - 5], [c[0] + sw, c[1] - 5], [sk.hipR[0] + 3, hy], [sk.hipL[0] - 3, hy]];
}

function zombieFrame(dir: Dir, pose: ZPose, v: ZVariant): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 25);
    // No global celShade — the rig parts are self-shaded along their ramps, so
    // the soft gradient would only muddy the clean bands (same call the knight
    // dropped). celShade stays on the brute/spitter overlays that draw extra art.
    zombieStanding(ctx, dir, pose, v);
  };
}

/** Blood pool — post-shade so it stays saturated. */
function bloodPool(ctx: CanvasRenderingContext2D, rx: number): void {
  ctx.beginPath();
  ctx.ellipse(66, GROUND - 2, rx, rx * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = C(11);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(62, GROUND - 3, rx * 0.55, rx * 0.16, 0, 0, Math.PI * 2);
  ctx.fillStyle = C(12);
  ctx.fill();
}

function zombieDeath(v: ZVariant): FramePaint[] {
  // A gorier variant leaves a bigger stain.
  const pool = 16 + v.gore * 6;
  return [
    // buckle — knees give, eyes go out
    (ctx) => {
      groundShadow(ctx, 64, GROUND + 3, 25);
      zombieStanding(ctx, "S", { bob: 8, stride: 0, lurch: 0.14, dead: true }, v);
      celShade(ctx);
    },
    // fold — the whole figure pitches around the feet
    (ctx) => {
      groundShadow(ctx, 64, GROUND + 3, 25);
      ctx.save();
      ctx.translate(60, GROUND);
      ctx.rotate(-0.62);
      ctx.translate(-64, -GROUND);
      zombieStanding(ctx, "S", { bob: 10, stride: 0, lurch: 0, dead: true }, v);
      ctx.restore();
      celShade(ctx);
    },
    // collapse — nearly flat, first blood
    (ctx) => {
      ctx.save();
      ctx.translate(56, GROUND + 2);
      ctx.rotate(-1.25);
      ctx.translate(-64, -GROUND);
      zombieStanding(ctx, "S", { bob: 12, stride: 0, lurch: 0, dead: true }, v);
      ctx.restore();
      celShade(ctx);
      bloodPool(ctx, pool * 0.55);
    },
    // the heap and the stain
    (ctx) => {
      bloodPool(ctx, pool);
      goreSplatter(ctx, v, 64, GROUND - 6);
      ell(ctx, 58, GROUND - 8, 22, 9, F(v.skin), 0.08); // body mound
      ell(ctx, 82, GROUND - 8, 9, 7, F(v.skin + 1), -0.2); // lolled head
      line(ctx, [[86, GROUND - 10], [82, GROUND - 6]], 2.5, F(1)); // x eye
      line(ctx, [[82, GROUND - 10], [86, GROUND - 6]], 2.5, F(1));
      limb(ctx, 44, GROUND - 10, 34, GROUND - 4, 7, F(v.skin)); // outflung arm
      line(ctx, [[50, GROUND - 12], [62, GROUND - 10]], 2, F(Math.min(9, v.skin + 2))); // rib glint
      celShade(ctx);
    },
  ];
}

/** Build a full zombie painter set for one cosmetic variant. */
export function makeZombiePaints(v: ZVariant): ActorPaints {
  const dirClips = (dir: Dir, lurchBase: number, lurchWobble: number) => ({
    idle: [
      zombieFrame(dir, { bob: 0, stride: 0, lurch: lurchBase }, v),
      zombieFrame(dir, { bob: 2.5, stride: 0, lurch: lurchBase - lurchWobble }, v),
    ],
    // ── WALK: an ASYMMETRIC step-drag limp (deep-research 2026-07-15: pose
    // asymmetry is what makes a shamble read as undead, not a slowed man-walk).
    // The good leg PLANTS in two quick frames; the bad leg spends four frames
    // DRAGGING to catch up while the body pitches forward over it (lurch pulse)
    // and sinks (bob) — a lopsided 6-beat instead of a metronome. ──
    walk: [
      // good-leg step — quick, weight slams onto it
      zombieFrame(dir, { bob: 3, stride: 1, lurch: lurchBase + 0.05 }, v),
      zombieFrame(dir, { bob: 0.5, stride: 0.5, lurch: lurchBase }, v),
      // bad-leg drag — slow, body pitches hard over the plant and sinks
      zombieFrame(dir, { bob: 1.5, stride: 0.1, lurch: lurchBase + 0.08 }, v),
      zombieFrame(dir, { bob: 3.5, stride: -0.3, lurch: lurchBase + 0.1 }, v),
      zombieFrame(dir, { bob: 2.5, stride: -0.7, lurch: lurchBase + 0.04 }, v),
      zombieFrame(dir, { bob: 1, stride: -1, lurch: lurchBase - 0.03 }, v),
    ],
    death: zombieDeath(v),
  });

  return {
    S: dirClips("S", 0.02, 0.04),
    N: dirClips("N", 0.02, 0.04),
    E: dirClips("E", 0.12, 0.02),
  };
}

/** Back-compat default (variant 0) for any caller that wants one sheet. */
export const ZOMBIE_PAINTS: ActorPaints = makeZombiePaints(ZOMBIE_VARIANTS[0]);

// ══════════════════════════════════════════════════════════════════
// GIANT SPIDER — a low, wide, many-legged skitterer. Reads totally
// differently from the tall shambling zombie: bulbous abdomen, eight
// jointed legs that scissor as it walks, a cluster of glowing eyes.
// Sits LOW to the floor, so it's drawn in the lower half of the cel.
// ══════════════════════════════════════════════════════════════════

interface SPose {
  /** Leg cycle phase, 0..1 — drives the scissor. */
  step: number;
  /** Body bob, px. */
  bob: number;
  dead?: boolean;
}

// Spider palette: chitinous dark — leather body, but legs are a LIGHTER steel
// so the spidery silhouette reads against the dark floor. Blood-red eye cluster
// and a rot-green back marking keep it in the Cold-Crypt ramps.
const SP_BODY = 27; // leather dark — carapace (lifted from 26 so it's not pure void)
const SP_BODY_HI = 28; // leather mid — the lit top of the abdomen
const SP_JOINT = 20; // steel MID — legs catch light and read as spindly
const SP_JOINT_HI = 21; // steel light — the lit femur segment
const SP_EYE = 13; // blood light — eye cluster glow
const SP_MARK = 8; // rot mid — a sickly marking on the back

/**
 * One jointed leg: hip → knee (raised) → foot (planted out). Two segments,
 * the outer one lighter so the leg reads spindly against the floor; a dark
 * foot tip taps the ground.
 */
function spiderLeg(ctx: CanvasRenderingContext2D, hx: number, hy: number, kx: number, ky: number, fx: number, fy: number, w: number): void {
  limb(ctx, hx, hy, kx, ky, w, F(SP_JOINT)); // femur
  limb(ctx, kx, ky, fx, fy, w * 0.7, F(SP_JOINT_HI)); // tibia (lit)
  ell(ctx, fx, fy, w * 0.55, w * 0.45, F(1)); // foot tip
}

function spiderBody(ctx: CanvasRenderingContext2D, dir: Dir, pose: SPose): void {
  const { step, bob, dead } = pose;
  const cy = 92 + bob; // body sits low
  // Leg scissor: front legs reach when back legs plant, and vice-versa.
  const s = Math.sin(step * Math.PI * 2) * 6;
  const s2 = Math.sin(step * Math.PI * 2 + Math.PI) * 6;

  if (dead) {
    // curled on its back: legs pulled inward over the belly
    ell(ctx, 64, 104, 22, 11, F(SP_BODY)); // abdomen flat
    for (let i = 0; i < 4; i++) {
      const a = -0.5 + i * 0.35;
      limb(ctx, 64, 100, 64 + Math.cos(a) * 20, 100 - Math.abs(Math.sin(a)) * 14, 5, F(SP_JOINT));
      limb(ctx, 64, 100, 64 - Math.cos(a) * 20, 100 - Math.abs(Math.sin(a)) * 14, 5, F(SP_JOINT));
    }
    ell(ctx, 64, 100, 9, 8, F(SP_BODY_HI)); // upturned cephalothorax
    return;
  }

  // ── eight legs, four per side, radiating from the cephalothorax ──
  if (dir === "E") {
    // profile: legs on the near side splay forward/back along the walk axis
    const cx = 58;
    for (let i = 0; i < 4; i++) {
      const ph = i % 2 === 0 ? s : s2;
      const fx = cx + 20 + i * 8;
      spiderLeg(ctx, cx + 6, cy - 2, cx + 16 + i * 6, cy - 14, fx, GROUND - 2 + ph, 5);
    }
    // far-side legs, dimmer, behind the body
    for (let i = 0; i < 3; i++) {
      const fx = cx + 12 + i * 8;
      limb(ctx, cx + 4, cy - 4, fx, GROUND - 6, 4, F(SP_BODY));
    }
    ell(ctx, cx + 30, cy, 22, 16, F(SP_BODY), 0.1); // abdomen (rear)
    ell(ctx, cx + 30, cy - 4, 12, 8, F(SP_BODY_HI), 0.1); // lit back
    ell(ctx, cx + 8, cy, 13, 11, F(SP_BODY_HI)); // cephalothorax (front)
    // fangs + eyes face forward (+x)
    ell(ctx, cx - 2, cy + 2, 5, 4, F(1));
    for (let e = 0; e < 3; e++) glowDot(ctx, cx + 2 - e * 3, cy - 3 - (e % 2) * 3, 2.2);
  } else {
    // S/N: top-down-ish, symmetric splay left/right. Legs reach WIDE so the
    // eight-legged silhouette is unmistakable against the dark floor.
    const cx = 64;
    const front = dir === "S"; // eyes toward camera on S, abdomen toward camera on N
    for (let i = 0; i < 4; i++) {
      const ph = i % 2 === 0 ? s : s2;
      const spread = 26 + i * 11; // wider fan
      const yy = cy - 18 + i * 12;
      const kneeLift = 10; // knees ride high, feet plant far out
      // left legs
      spiderLeg(ctx, cx - 7, yy, cx - spread * 0.62, yy - kneeLift + ph, cx - spread, yy + 10 - ph, 4);
      // right legs
      spiderLeg(ctx, cx + 7, yy, cx + spread * 0.62, yy - kneeLift + ph, cx + spread, yy + 10 - ph, 4);
    }
    if (front) {
      ell(ctx, cx, cy + 12, 20, 17, F(SP_BODY)); // abdomen behind
      ell(ctx, cx, cy + 8, 11, 9, F(SP_BODY_HI)); // lit
      line(ctx, [[cx, cy + 4], [cx, cy + 20]], 2, F(SP_MARK)); // marking
      ell(ctx, cx, cy - 8, 14, 12, F(SP_BODY_HI)); // cephalothorax toward camera
      ell(ctx, cx - 6, cy - 4, 4, 3.5, F(1)); // fang shadow
      ell(ctx, cx + 6, cy - 4, 4, 3.5, F(1));
      // eye cluster (glowing)
      glowDot(ctx, cx - 5, cy - 12, 2.4);
      glowDot(ctx, cx + 5, cy - 12, 2.4);
      glowDot(ctx, cx - 2, cy - 9, 1.8);
      glowDot(ctx, cx + 2, cy - 9, 1.8);
    } else {
      ell(ctx, cx, cy - 6, 14, 12, F(SP_BODY)); // cephalothorax (far)
      ell(ctx, cx, cy + 12, 22, 18, F(SP_BODY)); // abdomen toward camera
      ell(ctx, cx, cy + 8, 13, 10, F(SP_BODY_HI)); // lit hump
      // spinnerets + marking on the back
      line(ctx, [[cx - 4, cy + 6], [cx, cy + 22]], 2, F(SP_MARK));
      line(ctx, [[cx + 4, cy + 6], [cx, cy + 22]], 2, F(SP_MARK));
    }
  }
}

/** A glowing eye dot — no outline, blooms through the pipeline. */
function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = C(SP_EYE);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = C(17); // hot core
  ctx.fill();
}

function spiderFrame(dir: Dir, pose: SPose): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 2, 30); // wide low shadow
    spiderBody(ctx, dir, pose);
    celShade(ctx);
  };
}

const SPIDER_DEATH: FramePaint[] = [
  (ctx) => { groundShadow(ctx, 64, GROUND + 2, 28); spiderBody(ctx, "S", { step: 0, bob: 4 }); celShade(ctx); },
  (ctx) => { groundShadow(ctx, 64, GROUND + 2, 26); spiderBody(ctx, "S", { step: 0, bob: 8, dead: true }); celShade(ctx); },
  (ctx) => {
    groundShadow(ctx, 64, GROUND + 2, 24);
    spiderBody(ctx, "S", { step: 0, bob: 10, dead: true });
    // a little ichor
    ctx.beginPath(); ctx.ellipse(64, GROUND - 2, 16, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(7); ctx.fill();
    celShade(ctx);
  },
];

/** The giant-spider painter set. No variants (yet) — one menacing look. */
export function makeSpiderPaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [spiderFrame(dir, { step: 0, bob: 0 }), spiderFrame(dir, { step: 0.5, bob: 1 })],
    walk: [
      spiderFrame(dir, { step: 0, bob: 0 }),
      spiderFrame(dir, { step: 0.25, bob: 2 }),
      spiderFrame(dir, { step: 0.5, bob: 0 }),
      spiderFrame(dir, { step: 0.75, bob: 2 }),
    ],
    death: SPIDER_DEATH,
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// BRUTE — the tank. It's a zombie body scaled up + bulked: a hulking
// dark-green mass with slab shoulders, tiny head sunk between them, and
// two massive fists. Built on top of zombieStanding (scaled about the
// feet) so it animates + dies for free, with extra bulk drawn over it.
// ══════════════════════════════════════════════════════════════════

const BRUTE_VARIANT: ZVariant = { skin: 6, rag: 26, gore: 2, stump: null, bandage: false, seed: 9 };
// The overlord (boss) is the brute drawn even bigger, with a jagged bone crown
// and blood-red glowing eyes so it reads as "the big one" at a glance.
const BOSS_VARIANT: ZVariant = { skin: 6, rag: 26, gore: 3, stump: null, bandage: false, seed: 13 };

/** `scale` = body size multiplier; `crowned` adds boss horns/crown + red eyes. */
function bruteFrame(dir: Dir, pose: ZPose, scale = 1.36, crowned = false): FramePaint {
  const variant = crowned ? BOSS_VARIANT : BRUTE_VARIANT;
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 34 * (scale / 1.36)); // wide heavy shadow
    ctx.save();
    // Scale the whole zombie up about the feet — a genuinely bigger body.
    ctx.translate(64, GROUND);
    ctx.scale(scale, scale);
    ctx.translate(-64, -GROUND);
    zombieStanding(ctx, dir, pose, variant);
    // Slab pauldrons of grown-over muscle/bone on the shoulders.
    const sy = 58 + pose.bob;
    if (dir !== "N") {
      ell(ctx, 44, sy, 13, 10, F(7));
      ell(ctx, 84, sy, 13, 10, F(7));
      // a bony spur off each shoulder
      poly(ctx, [[40, sy - 6], [46, sy - 14], [50, sy - 4]], F(22));
      poly(ctx, [[88, sy - 6], [82, sy - 14], [78, sy - 4]], F(22));
    } else {
      ell(ctx, 44, sy, 13, 10, F(7));
      ell(ctx, 84, sy, 13, 10, F(7));
      // spine ridge down the huge back
      line(ctx, [[64, 54 + pose.bob], [64, 92 + pose.bob]], 4, F(22));
    }
    // Boss regalia: a jagged bone crown over the head + burning red eyes.
    if (crowned && dir !== "N") {
      const hy = 38 + pose.bob;
      for (const [hx, tip] of [[54, 22], [62, 16], [70, 16], [78, 22]] as const) {
        poly(ctx, [[hx - 3, hy - 6], [hx + 3, hy - 6], [hx, tip]], F(22)); // horn/crown spike
      }
      // red glowing eyes (unshaded so they bloom)
      ctx.beginPath(); ctx.ellipse(58, hy, 3.2, 3.2, 0, 0, Math.PI * 2); ctx.fillStyle = C(13); ctx.fill();
      ctx.beginPath(); ctx.ellipse(70, hy, 3.2, 3.2, 0, 0, Math.PI * 2); ctx.fillStyle = C(13); ctx.fill();
    }
    ctx.restore();
  };
}

const BRUTE_DEATH: FramePaint[] = zombieDeath(BRUTE_VARIANT).map((f) => (ctx) => {
  // Same collapse, drawn bigger.
  ctx.save();
  ctx.translate(64, GROUND);
  ctx.scale(1.3, 1.3);
  ctx.translate(-64, -GROUND);
  f(ctx);
  ctx.restore();
});

export function makeBrutePaints(): ActorPaints {
  const dirClips = (dir: Dir, lurch: number) => ({
    idle: [
      bruteFrame(dir, { bob: 0, stride: 0, lurch }),
      bruteFrame(dir, { bob: 3, stride: 0, lurch: lurch - 0.03 }),
    ],
    walk: [
      bruteFrame(dir, { bob: 3, stride: 1, lurch: lurch + 0.02 }),
      bruteFrame(dir, { bob: 0, stride: 0, lurch }),
      bruteFrame(dir, { bob: 3, stride: -1, lurch: lurch - 0.04 }),
      bruteFrame(dir, { bob: 0, stride: 0, lurch }),
    ],
    death: BRUTE_DEATH,
  });
  return { S: dirClips("S", 0.04), N: dirClips("N", 0.04), E: dirClips("E", 0.14) };
}

// Bigger than a brute (1.36) but capped so the crowned head still fits the
// 128px cel — the body scales about the feet (GROUND), so too much scale pushes
// the head off the top of the frame.
const BOSS_SCALE_ART = 1.6;
const BOSS_DEATH: FramePaint[] = zombieDeath(BOSS_VARIANT).map((f) => (ctx) => {
  ctx.save();
  ctx.translate(64, GROUND);
  ctx.scale(BOSS_SCALE_ART * 0.78, BOSS_SCALE_ART * 0.78);
  ctx.translate(-64, -GROUND);
  f(ctx);
  ctx.restore();
});

/** The overlord: the brute even bigger, crowned, red-eyed. Guards the stairs. */
export function makeBossPaints(): ActorPaints {
  const dirClips = (dir: Dir, lurch: number) => ({
    idle: [
      bruteFrame(dir, { bob: 0, stride: 0, lurch }, BOSS_SCALE_ART, true),
      bruteFrame(dir, { bob: 4, stride: 0, lurch: lurch - 0.03 }, BOSS_SCALE_ART, true),
    ],
    walk: [
      bruteFrame(dir, { bob: 4, stride: 1, lurch: lurch + 0.02 }, BOSS_SCALE_ART, true),
      bruteFrame(dir, { bob: 0, stride: 0, lurch }, BOSS_SCALE_ART, true),
      bruteFrame(dir, { bob: 4, stride: -1, lurch: lurch - 0.04 }, BOSS_SCALE_ART, true),
      bruteFrame(dir, { bob: 0, stride: 0, lurch }, BOSS_SCALE_ART, true),
    ],
    death: BOSS_DEATH,
  });
  return { S: dirClips("S", 0.03), N: dirClips("N", 0.03), E: dirClips("E", 0.1) };
}

// ══════════════════════════════════════════════════════════════════
// SPITTER — the artillery. A bloated, sickly zombie with a swollen
// acid sac for a belly that pulses; it rears back to gob at range. The
// sac glows so you can read the threat across a room.
// ══════════════════════════════════════════════════════════════════

const SPITTER_VARIANT: ZVariant = { skin: 8, rag: 27, gore: 1, stump: null, bandage: false, seed: 11 };

/** A spit-charge pose flag rides on ZPose.lurch magnitude — big lurch = rearing. */
function spitterFrame(dir: Dir, pose: ZPose, charging = false): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 26);
    zombieStanding(ctx, dir, pose, SPITTER_VARIANT);
    // Distended acid belly — a glowing green sac over the torso.
    const by = 82 + pose.bob;
    const pulse = charging ? 1.25 : 1;
    ell(ctx, 64, by, 15 * pulse, 13 * pulse, F(8));
    ell(ctx, 64, by, 9 * pulse, 8 * pulse, F(9));
    // acid drip highlights
    ell(ctx, 60, by + 8, 2.5, 3.5, F(9));
    ell(ctx, 70, by + 6, 2, 3, F(9));
    if (charging && dir !== "N") {
      // a bright gob forming at the mouth just before release
      const mx = dir === "E" ? 84 : 66;
      ell(ctx, mx, 44 + pose.bob, 5, 5, F(9));
      ell(ctx, mx, 44 + pose.bob, 2.5, 2.5, F(17));
    }
    celShade(ctx);
  };
}

export function makeSpitterPaints(): ActorPaints {
  // "attack" clip = the rear-back-and-spit; the AI plays it on windup.
  const dirClips = (dir: Dir) => ({
    idle: [spitterFrame(dir, { bob: 0, stride: 0, lurch: 0.02 }), spitterFrame(dir, { bob: 2, stride: 0, lurch: -0.02 })],
    walk: [
      spitterFrame(dir, { bob: 2, stride: 1, lurch: 0.04 }),
      spitterFrame(dir, { bob: 0, stride: 0, lurch: 0 }),
      spitterFrame(dir, { bob: 2, stride: -1, lurch: -0.04 }),
      spitterFrame(dir, { bob: 0, stride: 0, lurch: 0 }),
    ],
    attack: [
      spitterFrame(dir, { bob: 0, stride: 0, lurch: -0.12 }, true), // rear back
      spitterFrame(dir, { bob: 1, stride: 0, lurch: 0.1 }, true), // lunge/spit
    ],
    death: zombieDeath(SPITTER_VARIANT),
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// GROUND ITEMS — the held weapon art lying at an angle, plus gear.
// ══════════════════════════════════════════════════════════════════

function groundWeapon(id: WeaponId): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 102, 26);
    ctx.save();
    ctx.translate(58, 96);
    ctx.rotate(1.05); // lying diagonally, business end up-right
    WEAPON_HELD[id]?.(ctx, {});
    ctx.restore();
    celShade(ctx);
  };
}

const HELMET_ITEM: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 102, 22);
  // crest plume
  ctx.beginPath();
  ctx.moveTo(60, 62);
  ctx.quadraticCurveTo(54, 46, 42, 48);
  ctx.quadraticCurveTo(52, 54, 55, 66);
  ctx.closePath();
  ctx.fillStyle = C(12);
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ell(ctx, 64, 82, 18, 17, F(21));
  rrect(ctx, 51, 79, 26, 6, 3, F(1)); // visor
  line(ctx, [[50, 92], [78, 92]], 2.5, F(20)); // rim
  celShade(ctx);
};

const ARMOR_ITEM: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 104, 24);
  poly(ctx, [[44, 62], [84, 62], [78, 98], [50, 98]], F(21)); // breastplate
  ell(ctx, 46, 64, 8, 6, F(20)); // shoulder cops
  ell(ctx, 82, 64, 8, 6, F(20));
  line(ctx, [[64, 66], [64, 94]], 2, F(20)); // seam
  line(ctx, [[52, 72], [58, 78]], 3, F(22)); // shine tick
  celShade(ctx);
};

const BOOTS_ITEM: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 104, 22);
  for (const bx of [48, 74]) {
    rrect(ctx, bx, 68, 12, 26, 4, F(27)); // shaft
    poly(ctx, [[bx, 88], [bx + 12, 88], [bx + 20, 98], [bx, 98]], F(26)); // foot
    line(ctx, [[bx + 2, 74], [bx + 10, 74]], 2, F(28)); // strap
  }
  celShade(ctx);
};

/**
 * A corked round-bottomed flask of glowing liquid. `liquid` is a raw css colour
 * (the potion's own hue, which may sit outside the palette — the quantizer snaps
 * it to the nearest ramp). A bright core sits on the liquid so it reads as
 * magical and blooms through the pipeline.
 */
function potionItem(liquid: string): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 104, 18);
    // neck + cork
    rrect(ctx, 59, 60, 10, 12, 2, F(2)); // glass neck (dark stone-grey glass)
    rrect(ctx, 58, 54, 12, 8, 2, F(27)); // cork
    // round body
    ell(ctx, 64, 88, 17, 17, F(2)); // glass
    // liquid fills the lower body
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(64, 88, 13, 13, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = liquid;
    ctx.fillRect(48, 84, 32, 20); // liquid line partway up
    ctx.restore();
    // magical core glow + surface glint
    ctx.beginPath();
    ctx.ellipse(64, 92, 5, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(18); // hot core — blooms
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    line(ctx, [[56, 82], [60, 78]], 3, F(22)); // glass highlight
    celShade(ctx);
  };
}

/**
 * The greed idol — a squat golden statuette on a coin pile, unmistakably
 * "treasure" and not a flask. Warm gold (torch ramp) so it glints and blooms.
 */
function goldIdolItem(): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 106, 20);
    // coin pile at the base
    for (const [cx, cy] of [[52, 100], [60, 103], [70, 101], [64, 98], [76, 103]] as const) {
      ell(ctx, cx, cy, 5, 3, F(16));
    }
    // idol body — a little tiki/totem
    poly(ctx, [[56, 96], [72, 96], [70, 70], [58, 70]], F(16)); // trunk
    ell(ctx, 64, 66, 12, 11, F(16)); // head
    // face carvings (dark)
    ell(ctx, 60, 64, 2.5, 3, F(14));
    ell(ctx, 68, 64, 2.5, 3, F(14));
    rrect(ctx, 59, 70, 10, 3, 1, F(14)); // mouth slot
    // crown/glint highlights
    poly(ctx, [[58, 58], [64, 50], [70, 58]], F(17)); // crown point
    line(ctx, [[58, 80], [70, 80]], 2, F(17)); // belt glint
    ell(ctx, 60, 62, 2, 2, F(18)); // hot glint — blooms
    celShade(ctx);
  };
}

/** Ground-item art, keyed by weapon id / gear slot / potion id. */
export const ITEM_PAINTS: Record<string, FramePaint> = {
  sword: groundWeapon("sword"),
  stick: groundWeapon("stick"),
  mace: groundWeapon("mace"),
  chair: groundWeapon("chair"),
  gun: groundWeapon("gun"),
  bow: groundWeapon("bow"),
  flamethrower: groundWeapon("flamethrower"),
  helmet: HELMET_ITEM,
  armor: ARMOR_ITEM,
  boots: BOOTS_ITEM,
  // Potions — liquid colour comes from the POTION table.
  health: potionItem("#d95763"),
  rage: potionItem("#d97b29"),
  haste: potionItem("#6fd0e8"),
  shield: potionItem("#8fc46b"),
  gold: goldIdolItem(),
};

// ══════════════════════════════════════════════════════════════════
// PROPS — walk-over set dressing. Drawn low so they hug the floor.
// ══════════════════════════════════════════════════════════════════

const BONES_PROP: FramePaint = (ctx) => {
  limb(ctx, 40, 100, 62, 108, 5, F(22)); // long bone
  ell(ctx, 38, 99, 4, 4, F(21));
  ell(ctx, 64, 109, 4, 4, F(21));
  limb(ctx, 74, 94, 88, 104, 4, F(21)); // second bone
  ell(ctx, 90, 105, 3.5, 3.5, F(22));
  line(ctx, [[54, 92], [60, 96]], 3, F(20)); // shard
  celShade(ctx);
};

const SKULL_PROP: FramePaint = (ctx) => {
  ell(ctx, 64, 98, 12, 11, F(22));
  ell(ctx, 60, 96, 3, 3.5, F(1)); // sockets
  ell(ctx, 69, 96, 3, 3.5, F(1));
  poly(ctx, [[63, 101], [66, 101], [64.5, 104]], F(1)); // nose
  rrect(ctx, 58, 106, 13, 5, 2, F(21)); // jaw
  line(ctx, [[61, 106], [61, 110]], 1.5, F(1)); // teeth gaps
  line(ctx, [[65, 106], [65, 110]], 1.5, F(1));
  celShade(ctx);
};

const RUBBLE_PROP: FramePaint = (ctx) => {
  poly(ctx, [[42, 110], [50, 96], [62, 102], [58, 112]], F(3));
  poly(ctx, [[60, 108], [70, 94], [84, 104], [80, 112]], F(4));
  poly(ctx, [[80, 110], [88, 102], [96, 110]], F(3));
  ell(ctx, 52, 112, 4, 2.5, F(2));
  celShade(ctx);
};

/** Scenery art, keyed by PropSpot.kind. */
export const PROP_PAINTS: Record<string, FramePaint> = {
  bones: BONES_PROP,
  skull: SKULL_PROP,
  rubble: RUBBLE_PROP,
};
