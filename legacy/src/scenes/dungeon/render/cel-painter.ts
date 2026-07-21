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
import { paletteCss, inkFor, shadeFor, highlightFor } from "./palette";
import { SPRITE_PX } from "../constants";
import { WEAPONS, type WeaponId } from "../items";
import { CARDS, CARD_IDS, RARITY_HEX } from "../cards";
import { FULL_PLATE, type KnightLook } from "./knight-look";
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
  R_LEATHER,
  R_BONE,
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

/**
 * The two other steps of a palette entry's RAMP.
 *
 * `SH` is a shade that steps COOLER and more saturated (toward arcane blue),
 * `HI` a highlight that steps WARMER and paler (toward torch light) — roughly a
 * 15-25° hue rotation per step rather than a slide along the same hue toward
 * black or white. Shading by lightness alone is the single biggest cause of a
 * sprite reading as muddy, and muddy at sprite resolution reads as BLURRY.
 *
 * Both keep the base index, so the selout helpers still derive the outline from
 * the material rather than from the shaded value: a shadow and its highlight
 * share one edge colour, which is what holds a form together.
 */
const SH = (index: number, amt = 0.45): readonly [string, number] => [shadeFor(index, amt), index];
const HI = (index: number, amt = 0.4): readonly [string, number] => [highlightFor(index, amt), index];

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
function knightHelm(ctx: CanvasRenderingContext2D, head: Pt, dir: Dir3, plumeLag = 0, hasHelm = true): void {
  const [x, y] = head;
  const pl = plumeLag;
  // No helmet equipped: same dome, same T-visor (the readability contract),
  // but dull dark iron, no plume, no arcane eye-spark. Gear brightens; it
  // never changes the silhouette's grammar.
  const dome: Ramp = hasHelm ? K_PLATE : K_PLATE_DK; // +x trails right; the crest tip drags opposite motion
  // Crest plume — a bold blood-red comb, drawn BEHIND the helm so it reads as a
  // silhouette-topping shape, not an antenna. Multi-lobe for a flowing mane and a
  // brighter front lobe for volume; the tip lobes carry the lag.
  if (!hasHelm) {
    // bare dull helm — plume and spark are the helmet's reward
  } else if (dir === "E") {
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
    plateShaded(ctx, [[x - 12, y - 12], [x + 12, y - 12], [x + 14, y + 4], [x + 8, y + 12], [x - 10, y + 10]], dome, { backlight: 30 });
    // brow ridge catches light — a bright band across the crown
    figDetail(ctx, [[x - 10, y - 9], [x + 10, y - 9]], 1.5, 21);
    // nose guard juts forward (+x)
    plateShaded(ctx, [[x + 12, y - 4], [x + 19, y + 2], [x + 12, y + 8]], K_PLATE_DK);
    // eye slit — hard black void, the only pure-INK on the figure
    rrectShaded(ctx, x + 2, y - 3, 11, 4, 1.5, 1, { ink: 1 });
  } else {
    plateShaded(ctx, [[x - 13, y - 13], [x + 13, y - 13], [x + 14, y + 6], [x + 6, y + 13], [x - 6, y + 13], [x - 14, y + 6]], dome, { backlight: 30 });
    // brow ridge highlight across the crown for a defined forehead
    figDetail(ctx, [[x - 11, y - 9], [x + 11, y - 9]], 1.5, 21);
    if (dir === "S") {
      // T-visor: a vertical breath-slot meeting a horizontal eye-slit — the
      // single most important readability feature. Hard black.
      rrectShaded(ctx, x - 11, y - 3, 22, 4, 2, 1, { ink: 1 }); // eye slit
      rrectShaded(ctx, x - 2.5, y - 1, 5, 12, 2, 1, { ink: 1 }); // breath slot
      if (hasHelm) {
        figGlow(ctx, x - 6, y - 1, 1.6, 30, 18); // faint arcane eye-spark, left
        figGlow(ctx, x + 6, y - 1, 1.6, 30, 18); // right
      }
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
function knightFrame(ctx: CanvasRenderingContext2D, dir: Dir, pose: KPose, weapon: WeaponId, look: KnightLook = FULL_PLATE): void {
  const { bob, stride, atk } = pose;
  // Gear → ramps. Equipped pieces paint bright polished steel with gold trim;
  // missing pieces paint the SAME shapes in dull dark iron (see knight-look.ts).
  const CUIRASS: Ramp = look.armor ? K_PLATE : K_PLATE_DK;
  const TASSET: Ramp = look.armor ? K_LEG : K_PLATE_DK;
  const TRIM = look.armor ? K_TRIM : K_STEEL_DK;
  const GREAVE: Ramp = look.boots ? K_PLATE : K_PLATE_DK;
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
    knightGreave(ctx, sk.kneeR, sk.footR, GREAVE); // near greave
  } else {
    legShaded(ctx, sk.hipL, sk.kneeL, sk.footL, 12, K_LEG, K_PLATE_DK, d3);
    legShaded(ctx, sk.hipR, sk.kneeR, sk.footR, 12, K_LEG, K_PLATE_DK, d3);
    knightGreave(ctx, sk.kneeL, sk.footL, GREAVE);
    knightGreave(ctx, sk.kneeR, sk.footR, GREAVE);
  }

  // ── faulds + tassets (armoured skirt over the hips) ──
  if (dir !== "E") {
    // central fauld
    plateShaded(ctx, [[sk.hipL[0] - 2, sk.hip[1] - 4], [sk.hipR[0] + 2, sk.hip[1] - 4], [sk.hipR[0] + 5, sk.hip[1] + 10], [sk.hipL[0] - 5, sk.hip[1] + 10]], K_PLATE_DK);
    // two thigh tassets hanging over the legs — reads as layered plate armour
    plateShaded(ctx, [[sk.hipL[0] - 4, sk.hip[1] + 2], [sk.hipL[0] + 4, sk.hip[1] + 2], [sk.hipL[0] + 3, sk.hip[1] + 15], [sk.hipL[0] - 5, sk.hip[1] + 14]], TASSET);
    plateShaded(ctx, [[sk.hipR[0] - 4, sk.hip[1] + 2], [sk.hipR[0] + 4, sk.hip[1] + 2], [sk.hipR[0] + 5, sk.hip[1] + 14], [sk.hipR[0] - 3, sk.hip[1] + 15]], TASSET);
  } else {
    // profile: a single tasset over the near thigh
    plateShaded(ctx, [[sk.hip[0] - 2, sk.hip[1] - 2], [sk.hip[0] + 9, sk.hip[1] - 2], [sk.hip[0] + 8, sk.hip[1] + 13], [sk.hip[0] - 2, sk.hip[1] + 12]], K_PLATE_DK);
  }

  // ── torso: a tapered cuirass, wider at the chest ── (cool backlight rim on
  // the shadow side — the second light that makes plate read as polished metal)
  const t = knightTorsoPts(sk, dir);
  plateShaded(ctx, t, CUIRASS, { backlight: 30 });
  // plackart V-seam + fluting + belt + gold buckle
  if (dir === "S") {
    figDetail(ctx, [[sk.chest[0], sk.chest[1] + 2], [sk.chest[0], sk.hip[1] - 2]], 2, K_STEEL_DK); // central keel
    figDetail(ctx, [[sk.chest[0] - 12, sk.chest[1] + 4], [sk.chest[0], sk.chest[1] + 15], [sk.chest[0] + 12, sk.chest[1] + 4]], 1.5, K_STEEL_DK); // plackart V
    figDetail(ctx, [[sk.chest[0] - 9, sk.chest[1] - 1], [sk.chest[0] - 7, sk.chest[1] + 10]], 1.2, 21); // pec highlight L
    figDetail(ctx, [[sk.chest[0] + 9, sk.chest[1] - 1], [sk.chest[0] + 7, sk.chest[1] + 10]], 1.2, 21); // pec highlight R
    rrectShaded(ctx, sk.chest[0] - 3, sk.chest[1] - 2, 6, 5, 1.5, TRIM); // gorget-boss / gold stud
  } else if (dir === "E") {
    figDetail(ctx, [[sk.chest[0] + 8, sk.chest[1] - 1], [sk.chest[0] + 7, sk.hip[1] - 3]], 1.4, 21); // front-edge highlight
    figDetail(ctx, [[sk.chest[0] - 6, sk.chest[1] + 3], [sk.chest[0] - 7, sk.hip[1] - 3]], 1.4, K_STEEL_DK); // back-edge shadow
  }
  rrectShaded(ctx, sk.hipL[0] - 2, sk.hip[1] - 6, (sk.hipR[0] - sk.hipL[0]) + 4, 6, 2, 27); // belt
  rrectShaded(ctx, sk.hip[0] - 4, sk.hip[1] - 6, 8, 6, 1.5, TRIM); // buckle

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
    plateShaded(ctx, [[px - 11 * flip, py - 5], [px + 10 * flip, py - 8], [px + 12 * flip, py + 5], [px - 9 * flip, py + 9]], CUIRASS, { backlight: 30 });
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
  knightHelm(ctx, sk.head, d3, plumeLag, look.helmet);

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
function knightRollFrame(dir: Dir, t: number, weapon: WeaponId, look: KnightLook): FramePaint {
  const base = (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 4, stride: 0, roll: 0.3 }, weapon, look);
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
function knightBallFrame(dir: Dir, spin: number, weapon: WeaponId, look: KnightLook): FramePaint {
  const base = (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 6, stride: 0, roll: 0.4 }, weapon, look);
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

/** Build the full painter set for the knight holding `weapon`, dressed as `look`. */
export function makeKnightPaints(weapon: WeaponId, look: KnightLook = FULL_PLATE): ActorPaints {
  const ranged = WEAPONS[weapon].kind === "ranged";
  const F = (dir: Dir, p: KPose) => (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, p, weapon, look);

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
      knightRollFrame(dir, 0.12, weapon, look),
      knightRollFrame(dir, 0.4, weapon, look),
      knightRollFrame(dir, 0.68, weapon, look),
      knightRollFrame(dir, 0.92, weapon, look),
    ],

    // ── BALL: the pinball-overcharge form — a looping quarter-turn-per-frame
    // spin of the tucked figure with a chasing speed ring. ──
    ball: [
      knightBallFrame(dir, 0, weapon, look),
      knightBallFrame(dir, Math.PI / 2, weapon, look),
      knightBallFrame(dir, Math.PI, weapon, look),
      knightBallFrame(dir, (3 * Math.PI) / 2, weapon, look),
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
  /**
   * -1..1 arm swing phase. The zombie's arms used to be HARD-POSED by facing,
   * so the walk cycle translated the body without articulating anything — a
   * blob sliding across the floor. Feeding the rig's swing channel makes the
   * reaching arms actually sweep; `droop` sags them further on the drag beats.
   */
  swing?: number;
  /** -1..1 lateral weight-shift roll (half-cadence sway). */
  roll?: number;
  /** Extra downward sag on the hands, px — the dead-weight arm droop. */
  droop?: number;
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
  /**
   * Which shoulder has the BROKEN BLADE — a bone-white scapula/collarbone spur
   * punched out through the flesh. Asymmetry is the single loudest "this thing
   * is wrong" cue, and at ~7px wide it's one of the few details that survives
   * the 128→52 crush. null = intact (rare; most variants get one).
   */
  spur: "L" | "R" | null;
  /**
   * Which bone-white mass is exposed. Every zombie tone lives in the 6-9 green
   * band, so ALL of them mush into one value after the crush; a R_BONE element
   * is the light note that separates torso from limbs from head.
   */
  bone: "ribs" | "spine" | "skull";
  /** Length of the long rag trailing off the hip, px (0 = none). Drawn BEHIND. */
  tatter: number;
  /** Per-variant jitter seed for splatter placement. */
  seed: number;
}

/** Deterministic 0..1 from an integer step — no Math.random (breaks resume). */
function vrand(seed: number, step: number): number {
  const x = Math.sin(seed * 127.1 + step * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The variant pool. A handful of distinct looks; zombies index in by seed.
 *
 * The old pool varied skin/rag INDEX and little else — and every one of those
 * indices sits inside the same narrow rot-green band, so after the crush the
 * five "variants" were five identical green blobs. The pool now varies the
 * SILHOUETTE first (spur side, exposed-bone mass, trailing rag length, stump)
 * and the hue second, so two zombies in a horde read apart at a glance.
 */
export const ZOMBIE_VARIANTS: ZVariant[] = [
  { skin: 7, rag: 26, gore: 1, stump: null, bandage: false, spur: "R", bone: "ribs", tatter: 22, seed: 1 },
  { skin: 8, rag: 27, gore: 2, stump: "L", bandage: false, spur: "R", bone: "skull", tatter: 0, seed: 2 },
  { skin: 6, rag: 2, gore: 3, stump: null, bandage: true, spur: "L", bone: "spine", tatter: 30, seed: 3 },
  { skin: 9, rag: 28, gore: 0, stump: "R", bandage: false, spur: "L", bone: "ribs", tatter: 14, seed: 4 },
  { skin: 7, rag: 29, gore: 2, stump: null, bandage: true, spur: null, bone: "skull", tatter: 34, seed: 5 },
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

/**
 * Zombie skin ramp from a variant's base index.
 *
 * The old formula was `[s, s+1, s+2]` clamped to 9 — a THREE-WIDE window inside
 * the four-entry rot band, which meant (a) very little internal contrast to
 * survive the crush and (b) the skin:9 variant degenerating to [9,9,9], i.e. a
 * literally flat, unshaded body. Now the ramp always spans the FULL rot band
 * (6 → 9) and the variant only picks where the mid sits, so every zombie has
 * real shade/light separation and the tone still differs between variants.
 */
function zombieRamp(v: ZVariant): Ramp {
  const mid = Math.min(8, Math.max(7, v.skin)); // 7 or 8 — the variant's tone
  return [6, mid, 9] as const;
}

/**
 * Hunched, sunken zombie proportions.
 *
 * Shoulders WIDENED (13→17) against a narrowed hip (8→7): the knight reads
 * because its shoulder:hip ratio is ~1.9 and the pauldrons push it further,
 * while the zombie's old 1.6 gave a straight-sided quad that crushed to a slab.
 * At 17/7 the torso is a genuine wedge even at 52px. Everything else stays —
 * in particular headY is NOT raised, because the boss scales this rig 1.6×
 * about GROUND and a taller head would clip out of the 128px cel.
 */
const ZOMBIE_RIG: RigConfig = {
  shoulderW: 17,
  hipW: 7,
  torsoTop: 54, // shoulders lower than the knight's (hunched)
  hipY: 32,
  headY: 66,
  step: 11,
  lift: 7,
};

/**
 * The rotten head, drawn at the head joint.
 *
 * REBUILT for the 128→52 crush (2026-07-18 "the zombie looks like a blob"). The
 * old head was a plain oval plus a 4px socket and a 2.4px glow — roughly two
 * dots of face survived the downscale, so the head read as a featureless egg.
 * Three things fix it, all borrowed straight from the knight's helm, which is
 * the most legible thing in the game:
 *
 *   1. A single HARD-BLACK VOID MASS (`{ ink: 1 }`, pure palette 1) spanning the
 *      brow, both sockets and the open maw — ~20×16 cel px, so ~8×6 real pixels
 *      after the crush. This is the knight's T-visor trick: one big committed
 *      black shape beats any number of small dark features, because black
 *      against rot-green is the highest-contrast edge on the figure. The
 *      glowing pupils sit INSIDE it, so they read as lights in a hollow rather
 *      than as two floating specks.
 *   2. A HANGING SLACK JAW — a mandible plate unhinged well below the cranium.
 *      It breaks the head's oval outline, which is what stops the silhouette
 *      reading as "ball on a body".
 *   3. `backlight: 30` on the cranium (the knight's helm has it) — a cool rim
 *      on the shadow side that separates the head from the dark floor.
 *
 * Faces per direction; N shows a weeping crater instead of a face.
 */
function zombieHead(ctx: CanvasRenderingContext2D, head: Pt, dir: Dir3, dead: boolean, v: ZVariant): void {
  const [x, y] = head;
  const skin = zombieRamp(v);
  const tilt = dir === "E" ? 0.32 : 0.14;
  // A "skull" variant wears its cranium bare — bone-white against the green
  // body is the biggest value jump available in this palette, and it's the one
  // light note that keeps the head from merging into the torso.
  const cranium = v.bone === "skull" ? R_BONE : skin;

  // ── hanging mandible, drawn FIRST so the cranium overlaps its hinge ──
  // Offset forward and asymmetrically so it juts off the oval instead of
  // sitting inside it. Slightly narrower than the cranium = reads as a jaw.
  if (!dead) {
    const jx = dir === "E" ? x + 6 : x + 2;
    plateShaded(ctx, [[jx - 8, y + 4], [jx + 8, y + 4], [jx + 6, y + 18], [jx - 5, y + 20]], cranium, { backlight: 30 });
  }

  // skull — a gaunt oval
  ellShaded(ctx, x, y, 12, 13, cranium, tilt);
  // mangy dark scalp patch
  ellShaded(ctx, x - 3, y - 8, 6, 4, skin[0], tilt, { rim: false });

  if (dir === "N") {
    // back of the skull: a weeping wound + a couple of hair mats, no face
    ellShaded(ctx, x + 2, y - 1, 4, 5, 11, 0, { rim: false });
    figDetail(ctx, [[x - 6, y - 6], [x - 4, y + 4]], 2, skin[0]);
    return;
  }

  const ex = dir === "E" ? x + 4 : x;
  if (dead) {
    // x-ed out eyes
    figDetail(ctx, [[ex - 7, y - 4], [ex - 2, y + 1]], 2.5, 1);
    figDetail(ctx, [[ex - 2, y - 4], [ex - 7, y + 1]], 2.5, 1);
    if (dir === "S") {
      figDetail(ctx, [[ex + 3, y - 4], [ex + 8, y + 1]], 2.5, 1);
      figDetail(ctx, [[ex + 8, y - 4], [ex + 3, y + 1]], 2.5, 1);
    }
    return;
  }

  // ── THE VOID MASS — sockets + maw as ONE pure-INK shape ──
  // Profile shows a narrower slab (one socket, the cheek turned away); front
  // shows the full skull-face plate. Both run brow→jawline in a single fill.
  // Sized to leave a rim of rot-green (or bone) skull showing all the way
  // round: a void that reaches the head's outline stops reading as a hollow
  // face and starts reading as a bucket helm.
  if (dir === "E") {
    plateShaded(ctx, [[ex - 6, y - 5], [ex + 8, y - 4], [ex + 7, y + 7], [ex - 5, y + 6]], 1, { ink: 1, rim: false });
  } else {
    plateShaded(ctx, [[ex - 9, y - 6], [ex + 9, y - 6], [ex + 8, y + 8], [ex - 8, y + 8]], 1, { ink: 1, rim: false });
  }
  // Glowing pupils sunk INSIDE the void. Mismatched sizes — a symmetrical pair
  // reads as a face, a mismatched pair reads as a ruined one.
  figGlow(ctx, ex - 5, y - 1, 3, 16, 17);
  if (dir === "S") figGlow(ctx, ex + 5, y - 1, 2.2, 16, 17);
  // Upper tooth row along the void's lower lip — a solid BONE bar, not a hairline.
  // (The old 1.5px "tooth glint" was invisible after the crush.)
  figDetail(ctx, [[ex - 7, y + 7], [ex + 7, y + 7]], 3, R_BONE);
}

/**
 * The zombie's standing body, posed from the shared biped rig with a forward
 * LEAN (the shamble). Signature preserved for the brute/spitter/boss overlays
 * that scale this and draw on top. `lurch` becomes the lean angle.
 */
function zombieStanding(ctx: CanvasRenderingContext2D, dir: Dir, pose: ZPose, v: ZVariant): void {
  const { bob, stride, lurch, dead } = pose;
  const swing = pose.swing ?? 0;
  const roll = pose.roll ?? 0;
  const droop = pose.droop ?? 0;
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
  const sk = buildSkeleton(d3, { bob, stride, lean, swing, roll, crouch: dead ? 0.4 : 0 }, ZOMBIE_RIG);

  // ── the long trailing RAG, drawn BEHIND everything ──
  // A silhouette break that costs nothing to read: a single wide strip of cloth
  // dragging off the hip, well clear of the body outline. Deliberately ONE big
  // tapering shape (~9px at the waist) rather than the little 5px scraps the
  // `rags()` helper makes — those crush to nothing. It drags opposite the walk
  // direction and lags the stride, so it also sells motion.
  if (v.tatter > 0 && !dead) {
    const back = dir === "E" ? -1 : 1; // profile trails behind (-x); front/back to the side
    const len = v.tatter;
    const sway = -stride * 4 * back; // cloth lags the leg swing
    const hx = sk.hip[0] + back * 6;
    const hy = sk.hip[1] - 4;
    poly(
      ctx,
      [
        [hx, hy],
        [hx + back * 9, hy + 2],
        [hx + back * 7 + sway, hy + len * 0.6],
        [hx + back * 11 + sway * 1.4, hy + len],
        [hx + back * 2 + sway, hy + len * 0.72],
      ],
      F(v.rag),
    );
  }

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
  // `backlight: 30` (arcane mid) rims the shadow side, exactly as the knight's
  // cuirass and helm do. It's nearly free and it's what stops the body fusing
  // into the dark floor — a green mass on a near-black floor has almost no
  // edge contrast without it.
  const t = zombieTorsoPts(sk, dir);
  plateShaded(ctx, t, skin, { backlight: 30 });

  // ── exposed BONE ──
  // The old version drew ribs as three 1.8px arcs. At 128→52 that is 0.7 of a
  // pixel: they vanished completely, which is a large part of why the torso
  // crushed to a featureless quad. They're now SOLID bone-white masses in
  // R_BONE [20,21,22] — a value family the zombie never used, and the only
  // thing bright enough to separate the torso from the limbs after the crush.
  zombieBone(ctx, sk, dir, v, skin);
  if (dir !== "N") {
    // gut wound
    ellShaded(ctx, sk.chest[0] + 5, sk.hip[1] - 6, 5, 4, 11, 0, { rim: false });
  }
  if (v.bandage) limbShaded(ctx, [sk.chest[0] - 13, sk.chest[1] + 2], [sk.chest[0] + 12, sk.chest[1] + 10], 5, rag);


  // ── arms — reaching forward, grasping (the zombie shape) ──
  //
  // These used to be pinned to hard constants per facing, which meant the walk
  // cycle NEVER moved them: the zombie translated across the floor without
  // articulating, the classic "sliding blob" read. They now counter-swing off
  // the pose (`swing`, opposed left/right so it's a real contralateral gait)
  // and sag on `droop` during the drag beats — dead weight on the end of a
  // shoulder, not a mannequin's arms.
  //
  // Profile reach stays at 26: the boss scales this rig 1.6× about GROUND, and
  // a longer forward reach pushes the claw past the right edge of the 128px
  // cel. The front/back views have room, so they get the extra length there
  // (16→21) plus a deeper hang, which is what breaks the torso outline head-on.
  const armReach = dir === "E" ? 26 : 21;
  const armY = sk.chest[1] + 4;
  const sw = swing * 7; // lead/trail offset in the swing plane
  if (dir === "E") {
    // both arms out toward +x, one higher; they scissor fore/aft on the swing
    zombieArm(ctx, [sk.chest[0] + 2, sk.chest[1]], [sk.chest[0] + armReach + sw, armY - 6 - swing * 3 + droop], skin, flesh, stumpR);
    zombieArm(ctx, [sk.chest[0], sk.chest[1] + 4], [sk.chest[0] + armReach - 3 - sw, armY + 8 + swing * 3 + droop], skin[0], flesh, stumpL);
  } else if (dir === "S") {
    // reaching toward the camera: hands come DOWN and forward, big
    zombieArm(ctx, sk.shoulderL, [sk.shoulderL[0] - 4 - sw * 0.5, armY + 24 - sw + droop], skin, flesh, stumpL);
    zombieArm(ctx, sk.shoulderR, [sk.shoulderR[0] + 4 + sw * 0.5, armY + 24 + sw + droop], skin, flesh, stumpR);
  } else {
    // from behind: both droop outward
    zombieArm(ctx, sk.shoulderL, [sk.shoulderL[0] - 8 - sw * 0.5, armY + 26 - sw + droop], skin[0], dark, stumpL);
    zombieArm(ctx, sk.shoulderR, [sk.shoulderR[0] + 8 + sw * 0.5, armY + 26 + sw + droop], skin[0], dark, stumpR);
  }

  // ── the BROKEN BLADE — an asymmetric bone spur through one shoulder ──
  //
  // This is the single most valuable addition: it is (a) big enough to survive
  // the crush, (b) bone-white against green, and (c) ASYMMETRIC, which is what
  // the eye reads as "wrong" — a symmetrical figure reads as a person, a
  // lopsided one as a corpse.
  //
  // Drawn AFTER the arms on purpose. Behind them it was occluded at the joint
  // and only its outboard tip survived, which read as a little white axe head
  // hovering next to the zombie rather than bone tearing out of a shoulder. It
  // also overlaps well inboard of the shoulder joint for the same reason: a
  // silhouette break has to stay visibly ATTACHED or it just looks like a prop.
  if (v.spur && !dead && dir !== "N") {
    // In profile the spur always goes on the BACK of the shoulder (-x). On the
    // front side it collides with the forward-thrust head and the reaching
    // arms; off the back it juts into empty cel where nothing competes.
    const sd = dir === "E" ? -1 : v.spur === "L" ? -1 : 1;
    const sx = (sd < 0 ? sk.shoulderL : sk.shoulderR)[0];
    const sy = sk.shoulderL[1];
    // the torn flesh it punched through — a dark blood collar at the base
    ellShaded(ctx, sx + sd * 2, sy + 2, 7, 5, 11, 0, { rim: false });
    plateShaded(ctx, [[sx - sd * 10, sy + 4], [sx - sd * 2, sy - 9], [sx + sd * 8, sy - 4], [sx + sd * 6, sy + 8]], R_BONE, { backlight: 30 });
  }

  // caked gore on the torso for the gorier variants (kept subtle after silhouette)
  if (v.gore > 0 && !dead) goreSplatter(ctx, v, sk.chest[0], sk.chest[1] + 6);

  // ── head — thrust forward off the hunch ──
  zombieHead(ctx, sk.head, d3, !!dead, v);
}

/**
 * The variant's exposed-bone mass on the torso — the light note in a figure
 * that is otherwise entirely inside the rot-green 6-9 band.
 *
 * Every shape here is deliberately CHUNKY (>=4 cel px, mostly 6-10). Anything
 * thinner than ~2.5 cel px is below one pixel of the 52px output grid and
 * simply does not exist in the final sprite, which is what happened to the old
 * 1.8px rib arcs. Three mutually-exclusive looks so variants read apart.
 */
function zombieBone(ctx: CanvasRenderingContext2D, sk: Skeleton, dir: Dir, v: ZVariant, skin: Ramp): void {
  const c = sk.chest;
  if (dir === "N") {
    // From behind, all three variants show the spine — but "spine" shows it as
    // a bared vertebral column in bone rather than a shaded groove.
    if (v.bone === "spine") {
      plateShaded(ctx, [[c[0] - 4, c[1] - 2], [c[0] + 4, c[1] - 2], [c[0] + 3, sk.hip[1]], [c[0] - 3, sk.hip[1]]], R_BONE);
      for (let i = 0; i < 3; i++) figDetail(ctx, [[c[0] - 5, c[1] + 4 + i * 7], [c[0] + 5, c[1] + 4 + i * 7]], 2.4, skin[0]);
    } else {
      figDetail(ctx, [[c[0], c[1]], [c[0] - 1, sk.hip[1]]], 3, skin[0]);
    }
    return;
  }

  // Front / profile. Bone sits on the lit side so it catches the key light.
  const bx = dir === "E" ? c[0] + 1 : c[0] - 6;
  if (v.bone === "ribs") {
    // A torn-open ribcage: one solid bone PLATE with dark gaps cut across it.
    // Carving gaps out of a light mass survives the crush; drawing light lines
    // on a dark mass does not (thin light strokes are the first thing to go).
    plateShaded(ctx, [[bx - 9, c[1] + 1], [bx + 9, c[1] + 3], [bx + 7, c[1] + 21], [bx - 8, c[1] + 19]], R_BONE);
    figDetail(ctx, [[bx - 9, c[1] + 8], [bx + 8, c[1] + 10]], 3.4, 6); // gap between ribs
    figDetail(ctx, [[bx - 9, c[1] + 15], [bx + 8, c[1] + 17]], 3.4, 6);
  } else if (v.bone === "spine") {
    // A collarbone yoke — a broad bone band across the top of the chest.
    plateShaded(ctx, [[c[0] - 14, c[1] - 2], [c[0] + 14, c[1] - 2], [c[0] + 11, c[1] + 7], [c[0] - 11, c[1] + 7]], R_BONE);
    figDetail(ctx, [[c[0], c[1] - 2], [c[0], c[1] + 7]], 3, 6); // sternal notch
  } else {
    // "skull" variants carry their bone up top; the torso gets a bare sternum
    // slab so there's still a light anchor at body height.
    plateShaded(ctx, [[bx - 5, c[1] + 3], [bx + 5, c[1] + 3], [bx + 4, c[1] + 20], [bx - 4, c[1] + 20]], R_BONE);
  }
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
  // Grasping claw — TWO fat splayed fingers, not three thin ones. At 1.6px the
  // old fingers were well under one output pixel and the hand crushed to a
  // featureless dot; at 3.6px they clear the grid and the claw actually reads
  // as a claw. Fewer, bolder shapes is the whole lesson of the 128→52 crush.
  ellShaded(ctx, hand[0], hand[1], 4.5, 4.5, handM, 0, { rim: false });
  const dir = Math.sign(hand[0] - sh[0]) || 1;
  const clawInk = typeof handM === "number" ? handM : handM[0];
  for (const i of [-1, 1]) {
    figDetail(ctx, [[hand[0], hand[1]], [hand[0] + dir * 7, hand[1] + i * 5]], 3.6, clawInk);
  }
}

/**
 * Hunched ribcage torso outline from the skeleton — a WEDGE, not a barrel.
 * The old front outline was 12 half-width over a 8 half-width hip: near enough
 * to a rectangle that it crushed to a featureless slab. Widened to 16 against
 * the narrowed 7 hip it tapers hard, and a hard taper is legible at any
 * resolution (it's the same trick the knight's cuirass plays at 15-over-9).
 */
function zombieTorsoPts(sk: Skeleton, dir: Dir): Pt[] {
  const c = sk.chest;
  const hy = sk.hip[1] + 2;
  if (dir === "E") {
    return [[c[0] - 10, c[1] - 7], [c[0] + 13, c[1] - 4], [c[0] + 9, hy], [c[0] - 8, hy - 2]];
  }
  const sw = 16;
  return [[c[0] - sw, c[1] - 6], [c[0] + sw, c[1] - 6], [sk.hipR[0] + 3, hy], [sk.hipL[0] - 3, hy]];
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
    // Idle breathes AND sags: the arms droop a little on the settle frame, so a
    // standing zombie is never a completely static image.
    idle: [
      zombieFrame(dir, { bob: 0, stride: 0, lurch: lurchBase, droop: 0 }, v),
      zombieFrame(dir, { bob: 2.5, stride: 0, lurch: lurchBase - lurchWobble, droop: 2 }, v),
    ],
    // ── WALK: an ASYMMETRIC step-drag limp (deep-research 2026-07-15: pose
    // asymmetry is what makes a shamble read as undead, not a slowed man-walk).
    // The good leg PLANTS in two quick frames; the bad leg spends four frames
    // DRAGGING to catch up while the body pitches forward over it (lurch pulse)
    // and sinks (bob) — a lopsided 6-beat instead of a metronome. ──
    // The arms now ride the same beat: they COUNTER-swing the legs (swing is
    // opposite in sign to stride) and DROOP hardest through the four drag
    // frames, so the limp reads in the upper body too. Roll adds the lopsided
    // half-cadence weight-shift onto the good leg.
    walk: [
      // good-leg step — quick, weight slams onto it
      zombieFrame(dir, { bob: 3, stride: 1, lurch: lurchBase + 0.05, swing: -1, roll: 1, droop: 0 }, v),
      zombieFrame(dir, { bob: 0.5, stride: 0.5, lurch: lurchBase, swing: -0.5, roll: 0.5, droop: 1 }, v),
      // bad-leg drag — slow, body pitches hard over the plant and sinks, and
      // the arms hang progressively deader as the drag goes on
      zombieFrame(dir, { bob: 1.5, stride: 0.1, lurch: lurchBase + 0.08, swing: 0.1, roll: -0.2, droop: 3 }, v),
      zombieFrame(dir, { bob: 3.5, stride: -0.3, lurch: lurchBase + 0.1, swing: 0.45, roll: -0.6, droop: 4 }, v),
      zombieFrame(dir, { bob: 2.5, stride: -0.7, lurch: lurchBase + 0.04, swing: 0.8, roll: -0.9, droop: 3 }, v),
      zombieFrame(dir, { bob: 1, stride: -1, lurch: lurchBase - 0.03, swing: 1, roll: -0.5, droop: 1.5 }, v),
    ],
    death: zombieDeath(v),
  });

  return {
    S: dirClips("S", 0.02, 0.04),
    N: dirClips("N", 0.02, 0.04),
    E: dirClips("E", 0.12, 0.02),
  };
}


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

// spur: null — the brute draws its OWN bony shoulder spurs over the top of the
// scaled body, and stacking the zombie's broken-blade under them just muddies
// the shoulder line. It keeps the exposed ribcage, which reads huge at 1.36×.
const BRUTE_VARIANT: ZVariant = { skin: 6, rag: 26, gore: 2, stump: null, bandage: false, spur: null, bone: "ribs", tatter: 18, seed: 9 };
// The overlord (boss) is the brute drawn even bigger, with a jagged bone crown
// and blood-red glowing eyes so it reads as "the big one" at a glance.
const BOSS_VARIANT: ZVariant = { skin: 6, rag: 26, gore: 3, stump: null, bandage: false, spur: null, bone: "spine", tatter: 26, seed: 13 };

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

// bone: "spine" — the collarbone yoke sits high on the chest, clear of the acid
// sac that gets painted over the belly; an exposed ribcage would be hidden.
const SPITTER_VARIANT: ZVariant = { skin: 8, rag: 27, gore: 1, stump: null, bandage: false, spur: "L", bone: "spine", tatter: 16, seed: 11 };

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
// GHOST — a floating white sheet-ghost. A rounded draped dome with a
// wavy tattered hem, two hollow black eye-sockets and a small O of a
// mouth. Near-white (stone-highlight ramp) with a faint cold underglow
// so it reads as spectral, not paper. Hovers (drawn HIGH in the cel so
// there's room to float); the material's own transparency makes it see-
// through. No walk-cycle legs — it drifts, so "walk" is a hem-ripple.
// ══════════════════════════════════════════════════════════════════

// Ghost palette: stone-highlight body (near white), void eyes, a cold arcane
// underlight so it glows spectrally rather than reading as a flat white blob.
const GHOST_BODY = 5; // stone highlight (0x9aa4b4) — brightest cool grey
const GHOST_BODY_HI = 22; // steel highlight (near white) for the lit crown
const GHOST_SHADE = 4; // stone light — the shaded underside of the drape

interface GPose {
  /** Vertical drift bob, px (visual only — the real hover is world-space). */
  bob: number;
  /** Hem ripple phase, drives the wavy bottom edge. */
  ripple: number;
  dead?: boolean;
}

/** The wavy tattered hem of the sheet — a row of scallops whose depth ripples. */
function ghostHem(ctx: CanvasRenderingContext2D, cx: number, topY: number, halfW: number, ripple: number): Pt[] {
  const pts: Pt[] = [];
  const lobes = 5;
  const baseY = topY;
  for (let i = 0; i <= lobes; i++) {
    const t = i / lobes;
    const x = cx - halfW + t * halfW * 2;
    // alternate up/down scallop, animated by ripple so the hem flutters
    const dip = (i % 2 === 0 ? 10 : 2) + Math.sin(ripple + i * 1.1) * 3;
    pts.push([x, baseY + dip]);
  }
  return pts;
}

/** One ghost frame, posed from a GPose. cy is the drape crown height. */
function ghostFrame(dir: Dir, pose: GPose): FramePaint {
  return (ctx) => {
    const cx = 64;
    const crownY = 46 + pose.bob; // drawn high — it hovers, room below to float
    const halfW = 22;
    const hemY = 92 + pose.bob;

    // faint spectral underglow (unshaded, blooms) so it reads as a spirit
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(cx, (crownY + hemY) / 2, halfW + 4, (hemY - crownY) / 2 + 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(30); // arcane mid — cold halo
    ctx.fill();
    ctx.restore();

    // Body: a domed drape. Build the outline — rounded top, straight-ish sides,
    // scalloped rippling hem — as one filled path so the silhouette is clean.
    const hem = ghostHem(ctx, cx, hemY, halfW, pose.ripple);
    ctx.beginPath();
    ctx.moveTo(cx - halfW, hemY);
    // left side up to the crown
    ctx.lineTo(cx - halfW, crownY + 14);
    ctx.quadraticCurveTo(cx - halfW, crownY, cx, crownY); // round the top-left
    ctx.quadraticCurveTo(cx + halfW, crownY, cx + halfW, crownY + 14); // top-right
    ctx.lineTo(cx + halfW, hemY);
    // scalloped hem back across (right→left)
    for (let i = hem.length - 1; i >= 0; i--) {
      const [hx, hy] = hem[i];
      ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = C(GHOST_BODY);
    ctx.fill();
    ctx.lineWidth = INK_W;
    ctx.strokeStyle = C(3); // soft cool-grey selout, not black
    ctx.stroke();

    // lit crown band (upper-left) — the highlight that gives the drape volume
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx - 5, crownY + 12, halfW - 5, 14, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(cx - 8, crownY + 8, halfW - 8, 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(GHOST_BODY_HI);
    ctx.fill();
    ctx.restore();

    // shaded lower drape (a cool underside band)
    ctx.beginPath();
    ctx.moveTo(cx - halfW + 3, hemY - 14);
    ctx.lineTo(cx + halfW - 3, hemY - 14);
    ctx.lineTo(cx + halfW - 3, hemY - 4);
    ctx.lineTo(cx - halfW + 3, hemY - 4);
    ctx.closePath();
    ctx.fillStyle = C(GHOST_SHADE);
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Face: two hollow eyes + a small mouth. N (facing away) shows no face.
    if (dir !== "N") {
      const eyeY = crownY + 24;
      const ex = dir === "E" ? cx + 3 : cx; // profile shifts the face forward
      if (pose.dead) {
        // spent: drooping x-eyes as it dissipates
        line(ctx, [[ex - 12, eyeY - 3], [ex - 6, eyeY + 3]], 2.5, F(1));
        line(ctx, [[ex - 6, eyeY - 3], [ex - 12, eyeY + 3]], 2.5, F(1));
        line(ctx, [[ex + 6, eyeY - 3], [ex + 12, eyeY + 3]], 2.5, F(1));
        line(ctx, [[ex + 12, eyeY - 3], [ex + 6, eyeY + 3]], 2.5, F(1));
      } else {
        // hollow black sockets with a faint cold spark deep inside
        ell(ctx, ex - 8, eyeY, 4.5, 6, F(1), 0, C(1));
        ell(ctx, ex + 8, eyeY, 4.5, 6, F(1), 0, C(1));
        figGlow(ctx, ex - 8, eyeY + 1, 1.5, 30, 31); // cold spark, left
        figGlow(ctx, ex + 8, eyeY + 1, 1.5, 30, 31);
        // small O of a wailing mouth
        ell(ctx, ex, eyeY + 12, 3, 4, F(1), 0, C(1));
      }
    }
  };
}

/** Build the ghost painter set. Two-frame idle + a hem-rippling drift. */
export function makeGhostPaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [
      ghostFrame(dir, { bob: 0, ripple: 0 }),
      ghostFrame(dir, { bob: -2, ripple: 1.6 }),
      ghostFrame(dir, { bob: 0, ripple: 3.1 }),
      ghostFrame(dir, { bob: 2, ripple: 4.7 }),
    ],
    // "walk" is a drift — same bob, faster hem ripple so the sheet flutters.
    walk: [
      ghostFrame(dir, { bob: -1, ripple: 0 }),
      ghostFrame(dir, { bob: 1, ripple: 2.1 }),
      ghostFrame(dir, { bob: -1, ripple: 4.2 }),
      ghostFrame(dir, { bob: 1, ripple: 6.3 }),
    ],
    // Death: fade-dissipate — the sheet crumples with x-eyes (opacity handled by
    // the sprite material's flash; here we just show the spent pose).
    death: [
      ghostFrame(dir, { bob: 2, ripple: 1, dead: true }),
      ghostFrame(dir, { bob: 5, ripple: 3, dead: true }),
      ghostFrame(dir, { bob: 9, ripple: 5, dead: true }),
      ghostFrame(dir, { bob: 14, ripple: 7, dead: true }),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// THE DEATH DEALER (reaper) — the last tint-only reskin. It used to be
// the sheet-ghost dyed blood-red at REAPER_TINT and scaled up, which
// meant the game's most dramatic beat ("it cannot be slain — take the
// stairs") was announced by a red bedsheet.
//
// Bespoke now, and built around ONE silhouette idea: a tall hooded
// column topped by a huge pale SCYTHE CRESCENT. The crescent is the
// whole point — it's the only shape in the game that arcs across the
// top of the cel, so the reaper is identifiable from across a room even
// at 52px, in a way no amount of robe detail would be. The cowl carries
// the same hard-INK void the knight's visor and the zombie's face use,
// with two burning coals set inside it.
//
// Drifts rather than walks (no legs, hovering hem), so "walk" is a
// faster hem ripple + a longer scythe sway, exactly like the ghost.
// ══════════════════════════════════════════════════════════════════

/** Robe ramp — blood shadow→mid. Darker than R_BLOOD so the crescent pops. */
const REAPER_ROBE: Ramp = [10, 11, 12];

interface RPose {
  /** Vertical drift bob, px. */
  bob: number;
  /** Hem ripple phase. */
  ripple: number;
  /** -1..1 scythe sway — the haft rocks as it drifts. */
  sway: number;
  dead?: boolean;
}

/**
 * The scythe. A long haft with a big pale crescent blade swept off the top.
 * Drawn as two quadratics into one filled path so the crescent is a single
 * clean shape — a stroked arc would thin out to nothing under the crush.
 * `flip` mirrors the whole tool for the profile facing.
 */
function reaperScythe(ctx: CanvasRenderingContext2D, bob: number, sway: number, flip: number): void {
  const bx = 64 + flip * 15; // haft top / blade root
  const by = 26 + bob + sway * 3;
  // haft — a long dark shaft running from the hem up past the shoulder
  limbShaded(ctx, [64 + flip * 36, 114 + bob], [bx, by], 5, R_LEATHER, { rim: false });
  // crescent blade — outer sweep out, inner sweep back, filled as one mass
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(bx - flip * 26, by - 22 + sway * 2, bx - flip * 52, by + 6 + sway * 3);
  ctx.quadraticCurveTo(bx - flip * 22, by - 2 + sway, bx, by + 9);
  ctx.closePath();
  ctx.fillStyle = C(21); // steel light — the brightest thing on the figure
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.lineJoin = "round";
  ctx.strokeStyle = C(19);
  ctx.stroke();
  // edge glint along the cutting side
  figDetail(ctx, [[bx - flip * 6, by - 6], [bx - flip * 30, by - 8 + sway * 2], [bx - flip * 46, by + 4 + sway * 3]], 2.4, 22);
}

/** One reaper frame. */
function reaperFrame(dir: Dir, pose: RPose): FramePaint {
  return (ctx) => {
    const cx = 64;
    const crownY = 30 + pose.bob; // hovers — drawn high, room below to float
    const shoulderY = crownY + 26;
    const hemY = 106 + pose.bob;
    const flip = dir === "E" ? -1 : 1; // profile carries the scythe on the far side

    // Scythe first, BEHIND the robe — only the haft is occluded, and the
    // crescent riding clear above the hood is the read we want.
    if (!pose.dead) reaperScythe(ctx, pose.bob, pose.sway, flip);

    // ── ROBE — a tall column that flares from a narrow cowl to a wide hem.
    // The flare is the second silhouette cue: the ghost is a dome, this is a
    // triangle, and the two never get confused even as 52px blobs.
    const hem = ghostHem(ctx, cx, hemY, 30, pose.ripple);
    ctx.beginPath();
    ctx.moveTo(cx - 11, crownY + 4);
    ctx.lineTo(cx - 21, shoulderY); // shoulder break
    ctx.lineTo(cx - 30, hemY);
    for (let i = hem.length - 1; i >= 0; i--) ctx.lineTo(hem[i][0], hem[i][1]);
    ctx.lineTo(cx + 30, hemY);
    ctx.lineTo(cx + 21, shoulderY);
    ctx.lineTo(cx + 11, crownY + 4);
    ctx.closePath();
    ctx.fillStyle = C(REAPER_ROBE[0]);
    ctx.fill();
    ctx.lineWidth = INK_W;
    ctx.lineJoin = "round";
    ctx.strokeStyle = C(1);
    ctx.stroke();
    // lit front panel — a mid-tone slab down the left of the robe so the column
    // has two values instead of reading as one flat cut-out
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - 19, shoulderY);
    ctx.lineTo(cx - 2, shoulderY + 2);
    ctx.lineTo(cx - 4, hemY - 4);
    ctx.lineTo(cx - 26, hemY - 2);
    ctx.closePath();
    ctx.fillStyle = C(REAPER_ROBE[1]);
    ctx.fill();
    ctx.restore();

    // ── COWL — a pointed hood over a hard-INK void where a face isn't ──
    plateShaded(ctx, [[cx - 13, crownY + 16], [cx - 9, crownY - 2], [cx, crownY - 8], [cx + 9, crownY - 2], [cx + 13, crownY + 16], [cx, crownY + 20]], REAPER_ROBE, { backlight: 30 });
    // the void inside the hood — one committed black mass, ~20×14 cel px
    plateShaded(ctx, [[cx - 10, crownY + 2], [cx + 10, crownY + 2], [cx + 8, crownY + 16], [cx - 8, crownY + 16]], 1, { ink: 1, rim: false });
    if (dir !== "N" && !pose.dead) {
      // two burning coals set deep in the cowl. Blood-light cores keep the
      // "death dealer" read that REAPER_TINT used to carry for the whole sprite.
      const ex = dir === "E" ? cx + 3 : cx;
      figGlow(ctx, ex - 5, crownY + 9, 3, 12, 13);
      figGlow(ctx, ex + 5, crownY + 9, 3, 12, 13);
    }

    // ── skeletal hand gripping the haft, drawn last so it reads as ON the shaft ──
    if (!pose.dead) {
      const hx = cx + flip * 24;
      const hy = shoulderY + 16 + pose.sway * 2;
      ellShaded(ctx, hx, hy, 5.5, 5.5, R_BONE, 0, { rim: false });
      for (const i of [-1, 1]) figDetail(ctx, [[hx, hy], [hx + flip * 6, hy + i * 5]], 3.4, 20);
    }
  };
}

/**
 * Build the reaper painter set. It is immune (combat.ts), so "death" only ever
 * plays if something forces it — keep a spent, sinking pose so the clip exists
 * and the animator never indexes an empty array.
 */
export function makeReaperPaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [
      reaperFrame(dir, { bob: 0, ripple: 0, sway: 0 }),
      reaperFrame(dir, { bob: -2, ripple: 1.6, sway: 0.6 }),
      reaperFrame(dir, { bob: 0, ripple: 3.1, sway: 0 }),
      reaperFrame(dir, { bob: 2, ripple: 4.7, sway: -0.6 }),
    ],
    // "walk" is the advance — same hover, faster hem, harder scythe rock, so it
    // reads as gliding at you rather than stepping.
    walk: [
      reaperFrame(dir, { bob: -1, ripple: 0, sway: 1 }),
      reaperFrame(dir, { bob: 1, ripple: 2.1, sway: 0.2 }),
      reaperFrame(dir, { bob: -1, ripple: 4.2, sway: -1 }),
      reaperFrame(dir, { bob: 1, ripple: 6.3, sway: -0.2 }),
    ],
    death: [
      reaperFrame(dir, { bob: 3, ripple: 1, sway: 0, dead: true }),
      reaperFrame(dir, { bob: 7, ripple: 3, sway: 0, dead: true }),
      reaperFrame(dir, { bob: 12, ripple: 5, sway: 0, dead: true }),
      reaperFrame(dir, { bob: 18, ripple: 7, sway: 0, dead: true }),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// BAT — a fast little flyer: dark furred body, big leathery membrane
// wings that FLAP hard (2 extreme poses — pixel-scale flaps read best
// as up/down, no inbetweens), long ears, red eyes, needle fangs.
// Drawn small and HIGH in the cel (it flies; the mesh hovers too).
// ══════════════════════════════════════════════════════════════════

/** One bat frame. `flap` -1 (wings down) .. 1 (wings up). */
function batFrame(dir: Dir, flap: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      // crumpled on the floor, one wing sticking up
      groundShadow(ctx, 64, GROUND + 2, 14);
      ellShaded(ctx, 64, GROUND - 6, 10, 6, R_LEATHER, 0.2);
      poly(ctx, [[70, GROUND - 8], [84, GROUND - 26], [76, GROUND - 6]], F(26));
      figDetail(ctx, [[58, GROUND - 8], [62, GROUND - 4]], 2, 1); // x eye
      figDetail(ctx, [[62, GROUND - 8], [58, GROUND - 4]], 2, 1);
      return;
    }
    const cy = 56; // flies high in the cel
    const wingY = cy - flap * 10; // wingtip height swings with the flap
    const wingSpread = 26 - Math.abs(flap) * 4;
    // wings first (behind the body) — big webbed triangles with finger ribs
    for (const side of [-1, 1]) {
      const tipX = 64 + side * wingSpread;
      plateShaded(ctx, [[64 + side * 6, cy], [tipX, wingY - 8], [64 + side * 12, cy + 8]], R_LEATHER, { rim: false });
      figDetail(ctx, [[64 + side * 8, cy + 1], [tipX - side * 3, wingY - 6]], 1.4, 26); // rib
    }
    // body — a furry teardrop
    ellShaded(ctx, 64, cy + 2, 9, 11, R_LEATHER);
    // ears — two tall points
    poly(ctx, [[58, cy - 7], [56, cy - 16], [62, cy - 9]], F(27));
    poly(ctx, [[70, cy - 7], [72, cy - 16], [66, cy - 9]], F(27));
    if (dir !== "N") {
      // red glowing eyes + needle fangs
      figGlow(ctx, 60, cy - 2, 1.8, 13, 13);
      figGlow(ctx, 68, cy - 2, 1.8, 13, 13);
      figDetail(ctx, [[61, cy + 6], [61, cy + 9]], 1.4, 22);
      figDetail(ctx, [[67, cy + 6], [67, cy + 9]], 1.4, 22);
    }
    // tiny feet tucked under
    figDetail(ctx, [[60, cy + 12], [59, cy + 15]], 1.6, 26);
    figDetail(ctx, [[68, cy + 12], [69, cy + 15]], 1.6, 26);
  };
}

/** Build the bat painter set — the flap IS the animation. */
export function makeBatPaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [batFrame(dir, 0.6), batFrame(dir, -0.6)],
    walk: [batFrame(dir, 1), batFrame(dir, -1)], // full-power flap in flight
    death: [batFrame(dir, 0.3), batFrame(dir, -0.8), batFrame(dir, 0, true), batFrame(dir, 0, true)],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// SLIME — a glossy arcane-teal blob (NOT rot-green — it must read as
// its own family next to the zombies). Squash-and-stretch scoot for a
// walk, two beady eyes, a wet highlight. Death melts it into a puddle
// (the split minis pop from core, scaled-down copies of this sheet).
// ══════════════════════════════════════════════════════════════════

/** Arcane-teal slime ramp. */
const R_SLIME: Ramp = [29, 30, 31];

/** One slime frame. `squash` -1 (tall/gathered) .. 1 (flat/spread). */
function slimeFrame(dir: Dir, squash: number, melt = 0): FramePaint {
  return (ctx) => {
    const spread = 20 + squash * 6 + melt * 14;
    const height = 22 - squash * 6 - melt * 14;
    const cy = GROUND - height * 0.55;
    groundShadow(ctx, 64, GROUND + 2, spread * 0.9);
    // the blob — a dome that squashes/spreads; melt sinks it into a puddle
    ellShaded(ctx, 64, cy, spread, height, R_SLIME);
    // dribble blobs at the base (goopier when squashed/melting)
    if (squash > 0.2 || melt > 0) {
      ellShaded(ctx, 64 - spread * 0.8, GROUND - 4, 4, 3, R_SLIME, 0, { rim: false });
      ellShaded(ctx, 64 + spread * 0.75, GROUND - 3, 3, 2.5, R_SLIME, 0, { rim: false });
    }
    // wet highlight — the gloss that sells "gel"
    ell(ctx, 64 - spread * 0.35, cy - height * 0.4, spread * 0.22, height * 0.2, F(31), -0.4);
    if (melt < 0.6 && dir !== "N") {
      // beady dark eyes suspended in the gel (drop as it melts)
      const ey = cy - height * 0.15 + melt * 8;
      ellShaded(ctx, 57, ey, 2.6, 3.2, 1, 0, { rim: false, ink: 1 });
      ellShaded(ctx, 71, ey, 2.6, 3.2, 1, 0, { rim: false, ink: 1 });
    }
  };
}

/** Build the slime painter set — squash-stretch scoot, melt on death. */
export function makeSlimePaints(): ActorPaints {
  const dirClips = (dir: Dir) => ({
    idle: [slimeFrame(dir, -0.2), slimeFrame(dir, 0.25)],
    // the scoot: gather tall → spring flat → settle — a 4-beat squash cycle
    walk: [slimeFrame(dir, -1), slimeFrame(dir, -0.2), slimeFrame(dir, 1), slimeFrame(dir, 0.3)],
    death: [slimeFrame(dir, 0.6, 0.15), slimeFrame(dir, 0.8, 0.4), slimeFrame(dir, 1, 0.7), slimeFrame(dir, 1, 1)],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// WAVE-B BESPOKE ART — the six pinball-reactive monsters get their own
// silhouettes (they shipped as tinted reskins first). Same idle/walk/
// death frame contract as the slime; the webspinner (ranged) also gets
// an attack rear-back so its telegraph reads.
// ══════════════════════════════════════════════════════════════════

const R_GOBLIN: Ramp = [15, 16, 17]; // warm rubber amber
const R_STONE: Ramp = [2, 3, 4]; // cold masonry
const R_PIN: Ramp = [20, 21, 22]; // cream/steel
const R_PLANT: Ramp = [7, 8, 9]; // rot-green stalk
const R_SILK: Ramp = [4, 21, 22]; // pale spider

/** BUMPER GOBLIN — a round rubbery amber imp; squash-stretch bounce. */
function goblinFrame(dir: Dir, squash: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, 64, GROUND + 2, 20);
      ellShaded(ctx, 64, GROUND - 6, 21, 8, R_GOBLIN); // splatted flat
      figDetail(ctx, [[53, GROUND - 9], [59, GROUND - 4]], 2, 1);
      figDetail(ctx, [[59, GROUND - 9], [53, GROUND - 4]], 2, 1);
      figDetail(ctx, [[69, GROUND - 9], [75, GROUND - 4]], 2, 1);
      figDetail(ctx, [[75, GROUND - 9], [69, GROUND - 4]], 2, 1);
      return;
    }
    const w = 20 + squash * 5;
    const h = 22 - squash * 5;
    const cy = GROUND - h * 0.7;
    groundShadow(ctx, 64, GROUND + 2, w * 0.85);
    for (const s of [-1, 1]) limbShaded(ctx, [64 + s * 8, cy + h * 0.5], [64 + s * 10, GROUND], 4, R_GOBLIN);
    ellShaded(ctx, 64, cy, w, h, R_GOBLIN); // round bouncy body
    for (const s of [-1, 1]) limbShaded(ctx, [64 + s * w * 0.7, cy], [64 + s * (w + 6), cy + 2], 4, R_GOBLIN); // bumper arms
    if (dir !== "N") {
      ell(ctx, 57, cy - 3, 4, 4.5, F(22));
      ell(ctx, 71, cy - 3, 4, 4.5, F(22));
      ell(ctx, 57, cy - 2, 2, 2.5, F(1));
      ell(ctx, 71, cy - 2, 2, 2.5, F(1));
      ctx.beginPath();
      ctx.moveTo(56, cy + 5);
      ctx.quadraticCurveTo(64, cy + 12, 72, cy + 5);
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      figDetail(ctx, [[60, cy + 7], [60, cy + 10]], 1.4, 22);
      figDetail(ctx, [[68, cy + 7], [68, cy + 10]], 1.4, 22);
    }
    ell(ctx, 64 - w * 0.4, cy - h * 0.4, w * 0.2, h * 0.18, F(18), -0.4); // rubber gloss
  };
}
export function makeGoblinPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [goblinFrame(dir, -0.15), goblinFrame(dir, 0.2)],
    walk: [goblinFrame(dir, -0.8), goblinFrame(dir, 0.1), goblinFrame(dir, 0.8), goblinFrame(dir, 0.1)],
    death: [goblinFrame(dir, 0.9), goblinFrame(dir, 0, true), goblinFrame(dir, 0, true), goblinFrame(dir, 0, true)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** BOWLING PIN — tall cream pin with red neck stripes; wobble + topple. */
function pinFrame(dir: Dir, lean: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, 64, GROUND + 2, 22);
      ctx.save();
      ctx.translate(64, GROUND - 6);
      ctx.rotate(1.3); // toppled on its side
      ellShaded(ctx, 0, 0, 9, 26, R_PIN);
      ctx.restore();
      return;
    }
    groundShadow(ctx, 64, GROUND + 2, 12);
    ctx.save();
    ctx.translate(64, GROUND);
    ctx.rotate(lean * 0.12);
    // classic pin profile — a bulb base narrowing to a neck + head
    plateShaded(ctx, [[-9, 0], [9, 0], [7, -18], [4, -26], [5, -34], [-5, -34], [-4, -26], [-7, -18]], R_PIN);
    ellShaded(ctx, 0, -38, 6, 7, R_PIN); // head
    // two red neck stripes
    line(ctx, [[-6, -30], [6, -30]], 3, F(12));
    line(ctx, [[-7, -25], [7, -25]], 3, F(12));
    ctx.restore();
  };
}
export function makePinPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [pinFrame(dir, -0.3), pinFrame(dir, 0.3)],
    walk: [pinFrame(dir, -1), pinFrame(dir, 1)],
    death: [pinFrame(dir, 1.4), pinFrame(dir, 0, true), pinFrame(dir, 0, true), pinFrame(dir, 0, true)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** BRICK GOLEM — a stacked-masonry brute with glowing arcane eyes; barely stirs. */
function golemFrame(dir: Dir, breath: number, crumble = 0): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 2, 26 - crumble * 6);
    const cy = 92 + breath;
    if (crumble > 0) {
      // shattering: scatter loose bricks
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        rrectShaded(ctx, 64 + Math.cos(a) * (10 + crumble * 22) - 5, cy + Math.sin(a) * (6 + crumble * 16) - 5, 10, 8, 1, R_STONE);
      }
      return;
    }
    for (const s of [-1, 1]) rrectShaded(ctx, 64 + s * 12 - 6, GROUND - 14, 12, 14, 2, R_STONE); // stubby legs
    // brick torso — a coursed stack
    rrectShaded(ctx, 44, cy - 22, 40, 34, 3, R_STONE);
    for (const by of [cy - 14, cy - 4, cy + 6]) line(ctx, [[45, by], [83, by]], 1.5, F(2)); // mortar courses
    line(ctx, [[64, cy - 22], [64, cy - 14]], 1.5, F(2));
    line(ctx, [[54, cy - 4], [54, cy + 6]], 1.5, F(2));
    line(ctx, [[74, cy - 4], [74, cy + 6]], 1.5, F(2));
    // heavy arms
    for (const s of [-1, 1]) rrectShaded(ctx, 64 + s * 26 - 6, cy - 16, 12, 24, 3, R_STONE);
    // block head with glowing eyes
    rrectShaded(ctx, 54, cy - 36, 20, 16, 2, R_STONE);
    if (dir !== "N") {
      figGlow(ctx, 59, cy - 28, 2.2, 31, 18);
      figGlow(ctx, 69, cy - 28, 2.2, 31, 18);
    }
  };
}
export function makeGolemPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [golemFrame(dir, 0), golemFrame(dir, 1)],
    walk: [golemFrame(dir, -1), golemFrame(dir, 0), golemFrame(dir, 1), golemFrame(dir, 0)],
    death: [golemFrame(dir, 0, 0.3), golemFrame(dir, 0, 0.6), golemFrame(dir, 0, 0.85), golemFrame(dir, 0, 1)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** CHOMPER PLANT — a rooted stalk topped by a toothy maw that snaps. */
function chomperFrame(dir: Dir, open: number, dead = false): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 2, 18);
    if (dead) {
      // wilted — the head flops over the base
      limbShaded(ctx, [64, GROUND], [58, GROUND - 12], 8, R_PLANT);
      ellShaded(ctx, 54, GROUND - 14, 12, 8, R_PLANT);
      return;
    }
    // pot/root base
    plateShaded(ctx, [[52, GROUND], [76, GROUND], [72, GROUND - 12], [56, GROUND - 12]], R_PLANT);
    // stalk
    limbShaded(ctx, [64, GROUND - 10], [64, GROUND - 34], 7, R_PLANT);
    // leaf pair
    ellShaded(ctx, 52, GROUND - 24, 8, 4, R_PLANT, -0.5);
    ellShaded(ctx, 76, GROUND - 24, 8, 4, R_PLANT, 0.5);
    // the maw — two jaws hinged at the neck; `open` splits them
    const jaw = open * 12;
    const my = GROUND - 44;
    // lower jaw
    plateShaded(ctx, [[52, my + jaw], [76, my + jaw], [70, my + jaw + 12], [58, my + jaw + 12]], R_PLANT);
    // upper jaw
    plateShaded(ctx, [[52, my - jaw], [76, my - jaw], [70, my - jaw - 12], [58, my - jaw - 12]], R_PLANT);
    // red gullet + white fangs when open
    if (open > 0.15) {
      ellShaded(ctx, 64, my, 9, jaw + 2, R_BLOOD, 0, { rim: false });
      for (const fx of [56, 62, 68, 72]) {
        figDetail(ctx, [[fx, my - jaw + 2], [fx, my - jaw + 6]], 1.6, 22);
        figDetail(ctx, [[fx, my + jaw - 2], [fx, my + jaw - 6]], 1.6, 22);
      }
    }
    if (dir !== "N") figGlow(ctx, 64, my, 1.6, 13, 18); // a red glint deep in the throat
  };
}
export function makeChomperPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [chomperFrame(dir, 0.15), chomperFrame(dir, 0.32)],
    walk: [chomperFrame(dir, 0.1), chomperFrame(dir, 0.4)], // it's rooted; the maw just breathes
    attack: [chomperFrame(dir, 0.9), chomperFrame(dir, 1), chomperFrame(dir, 0.05)], // gape then SNAP
    death: [chomperFrame(dir, 0.5), chomperFrame(dir, 0, true), chomperFrame(dir, 0, true), chomperFrame(dir, 0, true)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** MAGNET CRAWLER — a horseshoe magnet on skittering legs, poles arcing. */
function magnetFrame(dir: Dir, step: number, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, 64, GROUND + 2, 16);
      ctx.save();
      ctx.translate(64, GROUND - 6);
      ctx.rotate(0.8);
      // the horseshoe on its side
      plateShaded(ctx, [[-14, -10], [-6, -10], [-6, 8], [6, 8], [6, -10], [14, -10], [14, 14], [-14, 14]], R_STEEL);
      ctx.restore();
      return;
    }
    const cy = 90;
    groundShadow(ctx, 64, GROUND + 2, 16);
    // six little legs, alternating with `step`
    for (const s of [-1, 1]) {
      for (let l = 0; l < 3; l++) {
        const lx = 64 + s * (8 + l * 4);
        const ph = (l % 2 === 0 ? step : -step) * 3;
        limbShaded(ctx, [lx, cy + 8], [lx + s * 4, GROUND + ph], 2.5, 1);
      }
    }
    // the U-magnet body (opening downward)
    plateShaded(ctx, [[50, cy - 12], [58, cy - 12], [58, cy + 8], [70, cy + 8], [70, cy - 12], [78, cy - 12], [78, cy + 16], [50, cy + 16]], R_STEEL);
    // painted poles — one red, one blue — on the prongs
    rrectShaded(ctx, 50, cy + 10, 8, 8, 1, R_BLOOD);
    rrectShaded(ctx, 70, cy + 10, 8, 8, 1, [29, 30, 31]);
    // an arcane arc crackling between the poles
    figDetail(ctx, [[54, cy + 16], [60, cy + 12], [64, cy + 18], [68, cy + 12], [74, cy + 16]], 1.4, 31);
    if (dir !== "N") {
      figGlow(ctx, 58, cy - 4, 1.6, 31, 18);
      figGlow(ctx, 70, cy - 4, 1.6, 31, 18);
    }
  };
}
export function makeMagnetPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [magnetFrame(dir, 0.3), magnetFrame(dir, -0.3)],
    walk: [magnetFrame(dir, 1), magnetFrame(dir, -1)],
    death: [magnetFrame(dir, 0.4), magnetFrame(dir, 0, true), magnetFrame(dir, 0, true), magnetFrame(dir, 0, true)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** WEB SPINNER — a bloated pale spider with a silk-sac abdomen. */
function webspinnerFrame(dir: Dir, legPh: number, rear = 0, dead = false): FramePaint {
  return (ctx) => {
    if (dead) {
      groundShadow(ctx, 64, GROUND + 2, 18);
      ellShaded(ctx, 64, GROUND - 5, 14, 7, R_SILK);
      for (const s of [-1, 1]) for (let l = 0; l < 3; l++) figDetail(ctx, [[64, GROUND - 5], [64 + s * (12 + l * 4), GROUND - 2]], 1.6, 2);
      return;
    }
    const cy = 92 - rear * 6;
    groundShadow(ctx, 64, GROUND + 2, 20);
    // eight legs, arched, alternating gait
    for (const s of [-1, 1]) {
      for (let l = 0; l < 4; l++) {
        const bend = Math.sin(legPh + l) * 4;
        const kx = 64 + s * (14 + l * 3);
        const fx = 64 + s * (22 + l * 5);
        figDetail(ctx, [[64, cy], [kx, cy - 8 - bend], [fx, GROUND]], 2, 1);
      }
    }
    // bulbous silk-sac abdomen (behind), then the cephalothorax
    ellShaded(ctx, 64, cy + 2, 16, 14, R_SILK);
    ellShaded(ctx, 64, cy - 10, 10, 8, R_SILK);
    // a wound-silk texture on the sac
    for (const ry of [cy - 2, cy + 4, cy + 9]) ell(ctx, 64, ry, 12, 2, F(22));
    if (dir !== "N") {
      // cluster of red eyes + fangs
      for (const [ex, ey] of [[60, cy - 12], [64, cy - 13], [68, cy - 12], [62, cy - 9], [66, cy - 9]] as const) figGlow(ctx, ex, ey, 1.3, 13, 18);
      figDetail(ctx, [[61, cy - 6], [60, cy - 2]], 1.6, 22);
      figDetail(ctx, [[67, cy - 6], [68, cy - 2]], 1.6, 22);
    }
  };
}
export function makeWebspinnerPaints(): ActorPaints {
  const dc = (dir: Dir) => ({
    idle: [webspinnerFrame(dir, 0), webspinnerFrame(dir, 1.6)],
    walk: [webspinnerFrame(dir, 0), webspinnerFrame(dir, 1.6), webspinnerFrame(dir, 3.1), webspinnerFrame(dir, 4.7)],
    attack: [webspinnerFrame(dir, 0, 0.5), webspinnerFrame(dir, 0, 1), webspinnerFrame(dir, 0, 0.2)], // rear back to spit silk
    death: [webspinnerFrame(dir, 2, 0), webspinnerFrame(dir, 0, 0, true), webspinnerFrame(dir, 0, 0, true), webspinnerFrame(dir, 0, 0, true)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
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

/**
 * ONE struck gold coin — the kill drop. Sprites now render at the 72px grid 1:1
 * to screen pixels, so this can carry real coin anatomy instead of the old
 * three-blob pile: a THICKNESS slab under the face (it's an object, not a
 * decal), a bright raised RIM, a darker recessed FACE so the rim reads as a
 * lip, a stamped mark, and one hot specular that the bloom pass picks up.
 *
 * The ramp is hue-shifted, not lightness-only: the thickness uses SH (cooler,
 * more saturated toward arcane blue) and the rim HI (warmer, paler toward torch
 * light). Shading gold by lightness alone reads as muddy brown, and muddy at
 * sprite resolution reads as blurry.
 */
/**
 * One TINY coin for a heap. Diablo-style dropped gold is a scatter of little
 * discs, not one minted token — so this skips the diamond stamp (mush at 72px
 * on something this small) and paints just a shadowed rim, a face and a pin
 * glint. `r` is the coin's screen radius (heaps mix a few sizes for texture).
 */
function tinyCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ell(ctx, cx, cy + r * 0.22, r, r * 0.72, SH(15, 0.4)); // thin shadow slab under it
  ell(ctx, cx, cy, r, r * 0.72, F(17)); // rim — the brightest gold ring
  ell(ctx, cx, cy, r * 0.58, r * 0.42, F(16)); // recessed face
  ell(ctx, cx - r * 0.4, cy - r * 0.32, r * 0.18, r * 0.14, F(18)); // pin glint
}

/**
 * Paint a heap of tiny coins from a [cx, cy, r] list. The list must run
 * back-to-front (ascending cy) so the near, lower coins overprint the ones
 * behind — that overlap is what reads as a loose PILE rather than a flat spray.
 */
function coinHeap(ctx: CanvasRenderingContext2D, heap: Array<[number, number, number]>): void {
  for (const [cx, cy, r] of heap) tinyCoin(ctx, cx, cy, r);
}

/** The per-kill drop — a small DUST PILE of loose gold, Diablo-style. */
function coinItem(): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 98, 30);
    coinHeap(ctx, [
      [56, 82, 6], [65, 81, 6], [73, 84, 5], // crest (back)
      [50, 89, 7], [61, 88, 7], [70, 89, 6], [78, 91, 6],
      [63, 93, 7],
      [47, 97, 7], [58, 98, 8], [69, 98, 7], [79, 97, 7], // base (front), the biggest
    ]);
    celShade(ctx);
  };
}

/** A big windfall — the same loose gold, just a taller/wider mound so a fat
 *  payout reads as fat at a glance (boss drops, style kills; COIN_STACK_VALUE+). */
function coinStackItem(): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 103, 38);
    coinHeap(ctx, [
      [64, 58, 6], // peak
      [56, 67, 7], [66, 66, 6], [74, 70, 6],
      [49, 77, 7], [60, 76, 8], [71, 77, 7], [80, 80, 6],
      [45, 87, 8], [57, 87, 8], [68, 88, 8], [79, 88, 7],
      [41, 98, 8], [53, 99, 9], [65, 99, 9], [77, 98, 8], [88, 99, 7], // wide base
    ]);
    celShade(ctx);
  };
}

/** Ground-item art, keyed by weapon id / gear slot / potion id. */
/** A dropped CARD — a standing tarot-ish card with a rarity-coloured border
 * and centre gem, so its rarity reads at a glance on the floor. */
function cardItem(hex: string): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 106, 15);
    rrect(ctx, 50, 42, 28, 46, 4, F(23)); // parchment card face
    ctx.strokeStyle = hex;
    ctx.lineWidth = 3;
    ctx.strokeRect(52, 44, 24, 42); // rarity border
    ctx.fillStyle = hex; // rarity gem
    ctx.beginPath();
    ctx.ellipse(64, 65, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(64, 65, 9, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    line(ctx, [[55, 48], [59, 52]], 2, F(22)); // glint
    celShade(ctx);
  };
}

export const ITEM_PAINTS: Record<string, FramePaint> = {
  // Dropped modifier cards, one per CardId, tinted by rarity (see cards.ts).
  ...Object.fromEntries(CARD_IDS.map((id) => [id, cardItem(RARITY_HEX[CARDS[id].rarity])])),
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
  coin: coinItem(), // the per-kill coin drop
  coinStack: coinStackItem(), // the high-value tier (COIN_STACK_VALUE and up)
  // The pinball power-ups — same flask, signature liquids.
  ballform: potionItem("#f0a63c"),
  freeze: potionItem("#bfe8ff"),
  multiball: potionItem("#b06fe8"),
  curveshot: potionItem("#6fd0e8"),
  magnetboots: potionItem("#a83244"),
};

// ══════════════════════════════════════════════════════════════════
// NPCs — the Magician, the Speed Witch, the Oracle Frog, the Merchant
// and the Tout. Static-sprite friendlies (bobbed by core), so one
// FramePaint each is the whole rig.
//
// These five are the only characters the player ever stands still and LOOKS
// at — they staff the tavern's counters (`scenes/tavern/npcs.ts`) — so they
// carry more shape than the dungeon's enemies do. Four rules, applied to all
// of them:
//
//  1. SHADE BY HUE, NOT BY LIGHTNESS. Every material is a 3-4 step ramp built
//     from SH()/HI(): shadows step cooler and more saturated, highlights step
//     warmer and paler. Sliding one hue toward black is what makes a sprite
//     read muddy, and muddy at this resolution reads as BLURRY.
//  2. COLOURED OUTLINES. The selout helpers already derive each edge from its
//     own fill; pure INK is spent only on the DOWN-facing contour (boots,
//     hems, haunches, hat brims) where the body meets the tavern floor, so the
//     silhouette survives against the boards without looking stickered on.
//  3. SILHOUETTE FIRST. Filled solid black these must still be four different
//     people, so each one's defining feature is exaggerated past realism: the
//     smith's shoulders and apron, the barkeep's hat and tankard, the dealer's
//     stovepipe and fan of cards, the armorer's squat width, the tout's flat
//     visor peak.
//  4. NO DITHERING. At sprite size a checker reads as noise and crawls between
//     frames — every transition here is a hard band or a ramp step.
//
// Light is the same upper-left key celShade() bakes in, so highlights sit on
// the upper-left of every form and shade on the lower-right. Ramps are shared
// ACROSS the cast (one leather, one steel, one linen) so the five read as one
// scene rather than five separate drawings.
// ══════════════════════════════════════════════════════════════════

/**
 * A fan of playing cards held in a hand — the dealer's tell and the tout's.
 *
 * Alternating linen/steel faces rather than one flat colour, because a fan of
 * identical rectangles reads as a single blob once it is downsampled; the pip
 * is what stops each one reading as a roof tile.
 */
function cardFan(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, n = 4): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.rotate((i - (n - 1) / 2) * 0.3);
    rrect(ctx, -5.5, -26, 11, 26, 2, i % 2 === 0 ? F(22) : HI(21, 0.25));
    ell(ctx, 0, -18, 2, 2.4, F(12));
    ctx.restore();
  }
  ctx.restore();
}

const MAGICIAN_NPC: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 114, 22);
  // Tailcoat in three ramp steps — lit edge, body, cool core.
  poly(ctx, [[46, 112], [52, 56], [78, 56], [84, 112]], F(29));
  poly(ctx, [[68, 56], [78, 56], [84, 112], [70, 112]], SH(29, 0.4));
  poly(ctx, [[52, 56], [59, 56], [54, 112], [46, 112]], HI(29, 0.25));
  poly(ctx, [[46, 112], [56, 100], [74, 100], [84, 112]], F(29), INK); // hem on the floor
  // The croupier's uniform under it: shirt, waistcoat, studs, bow tie.
  poly(ctx, [[57, 56], [73, 56], [71, 96], [59, 96]], F(22));
  poly(ctx, [[58, 62], [72, 62], [70, 94], [60, 94]], F(11));
  for (const by of [70, 78, 86]) ell(ctx, 65, by, 1.7, 1.7, F(16));
  poly(ctx, [[57, 55], [65, 60], [57, 64]], F(12));
  poly(ctx, [[73, 55], [65, 60], [73, 64]], SH(12, 0.3));
  // Arms mid-flourish, white gloves.
  limb(ctx, 54, 62, 38, 80, 10, F(29));
  limb(ctx, 76, 62, 92, 70, 10, SH(29, 0.3));
  ell(ctx, 36, 84, 6.5, 6.5, F(22));
  ell(ctx, 94, 68, 6.5, 6.5, SH(22, 0.25));
  cardFan(ctx, 33, 84, -0.55); // the hand you actually watch
  line(ctx, [[94, 68], [107, 53]], 2.5, F(27)); // wand, hot tip (blooms)
  ell(ctx, 108, 51, 3, 3, F(18));
  // Pale face under the brim, moustache, knowing grin.
  ell(ctx, 64, 46, 9, 8.5, F(22));
  ell(ctx, 60, 42, 3.5, 3, HI(22, 0.3));
  ell(ctx, 60, 44, 1.6, 1.8, F(1));
  ell(ctx, 69, 44, 1.6, 1.8, F(1));
  line(ctx, [[58, 50], [63, 51]], 2, SH(27, 0.3)); // waxed moustache — brown, not
  line(ctx, [[67, 51], [72, 50]], 2, SH(27, 0.3)); // black, or it eats the eyes
  line(ctx, [[60, 54], [69, 54]], 1.6, F(8)); // the grin
  // The stovepipe hat — taller and wider-brimmed than a real one, because it
  // IS this character's silhouette from across the room.
  rrect(ctx, 49, 8, 30, 27, 2, F(29));
  rrect(ctx, 49, 8, 9, 27, 2, HI(29, 0.22));
  rrect(ctx, 40, 31, 48, 6, 2, F(29), INK);
  line(ctx, [[50, 29], [78, 29]], 4, F(9)); // rot-green band
  celShade(ctx);
};

const WITCH_NPC: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 114, 22);
  // Ragged arcane-blue robe, three steps plus a genuinely dark hem.
  poly(ctx, [[48, 112], [54, 56], [76, 56], [84, 112]], F(30));
  poly(ctx, [[66, 56], [76, 56], [84, 112], [68, 112]], SH(30, 0.4));
  poly(ctx, [[54, 56], [61, 56], [56, 112], [48, 112]], HI(30, 0.28));
  poly(ctx, [[48, 112], [58, 104], [72, 106], [84, 112]], F(29), INK);
  rrect(ctx, 50, 78, 30, 8, 2, F(27)); // belt
  rrect(ctx, 60, 79, 9, 6, 1, F(16)); // buckle
  // Arms: the rag in one hand, a tankard in the other. She is the BARKEEP as
  // much as the potion-seller, and both hands say so.
  limb(ctx, 56, 62, 40, 84, 10, F(30));
  limb(ctx, 74, 62, 90, 72, 10, SH(30, 0.3));
  ell(ctx, 38, 87, 6, 6, F(9));
  ell(ctx, 92, 70, 6, 6, SH(9, 0.3));
  rrect(ctx, 24, 80, 18, 14, 5, F(22)); // the polishing cloth
  line(ctx, [[27, 87], [39, 85]], 2, SH(22, 0.35));
  rrect(ctx, 84, 54, 16, 18, 3, F(20)); // tankard
  rrect(ctx, 84, 54, 5, 18, 3, HI(20, 0.35));
  line(ctx, [[100, 58], [105, 63], [100, 68]], 3, F(19)); // handle
  ell(ctx, 92, 53, 8, 4, F(22)); // foam over the lip
  // Green face, hooked nose, red eyes.
  ell(ctx, 64, 48, 10, 9, F(9));
  ell(ctx, 60, 44, 4, 3, HI(9, 0.3));
  poly(ctx, [[64, 46], [73, 54], [64, 54]], F(8)); // the nose
  ell(ctx, 60, 45, 1.8, 1.8, F(13));
  ell(ctx, 69, 45, 1.8, 1.8, F(13));
  line(ctx, [[59, 53], [69, 51]], 1.8, SH(8, 0.4)); // wry mouth
  ell(ctx, 72, 50, 1.6, 1.4, SH(9, 0.3)); // wart
  // Pointed hat — dark, but arcane-dark, never black.
  poly(ctx, [[44, 38], [84, 38], [80, 44], [48, 44]], F(29), INK); // brim
  poly(ctx, [[50, 40], [78, 40], [66, 10]], F(29));
  poly(ctx, [[70, 40], [78, 40], [66, 10]], SH(29, 0.35));
  poly(ctx, [[50, 40], [56, 40], [66, 10]], HI(29, 0.2));
  line(ctx, [[51, 38], [77, 38]], 4, F(31)); // arcane band
  celShade(ctx);
};

const FROG_NPC: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 112, 24);
  // Squat, and now BULKY — the armory keeper is a wide low mass, which is the
  // only silhouette in the cast with no head-and-shoulders taper at all.
  ell(ctx, 40, 104, 13, 7, F(8), 0, INK); // splayed feet, dark on the floor
  ell(ctx, 88, 104, 13, 7, F(8), 0, INK);
  ell(ctx, 64, 90, 25, 21, F(9));
  ell(ctx, 48, 82, 10, 9, HI(9, 0.3)); // lit shoulder
  ell(ctx, 82, 96, 13, 11, SH(9, 0.35)); // cool flank
  ell(ctx, 64, 98, 17, 11, HI(9, 0.2)); // pale belly plate
  line(ctx, [[52, 96], [76, 96]], 2, SH(9, 0.35)); // belly bands
  line(ctx, [[54, 102], [74, 102]], 2, SH(9, 0.35));
  // Arms folded over the gut — a doorman's posture, and it widens him further.
  limb(ctx, 44, 86, 63, 94, 10, F(8));
  limb(ctx, 84, 86, 66, 99, 10, SH(8, 0.3));
  // A warty ridge instead of dithering: readable lumps, not noise.
  for (const [wx, wy] of [[46, 78], [55, 72], [73, 72], [82, 78]]) ell(ctx, wx, wy, 3.5, 3, SH(9, 0.25));
  // The oracle's eyes — huge, gold, unblinking, with an upper-left catch-light.
  for (const ex of [54, 74]) {
    ell(ctx, ex, 68, 9, 9, F(9));
    ell(ctx, ex, 68, 5, 5, F(17));
    ell(ctx, ex, 69, 2, 3.6, F(1));
    ell(ctx, ex - 2.5, 65, 1.8, 1.6, F(18));
  }
  line(ctx, [[48, 82], [80, 82]], 2.5, SH(8, 0.4)); // wide mouth
  ell(ctx, 64, 86, 9, 5, SH(9, 0.22)); // throat sac
  celShade(ctx);
};

const MERCHANT_NPC: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 116, 26);
  // The cart is BACKDROP now rather than the subject: shrunk and pushed back
  // and right, so the trader's own shoulders own the silhouette. (He staffs the
  // forge in the tavern, where a wagon read as a parked vehicle, not a person.)
  for (const wx of [80, 106]) {
    ell(ctx, wx, 102, 7, 7, SH(28, 0.3));
    ell(ctx, wx, 102, 3, 3, F(27));
    for (const a of [0, 1.05, 2.1, 3.15, 4.2, 5.25]) line(ctx, [[wx, 102], [wx + Math.cos(a) * 6, 102 + Math.sin(a) * 6]], 1.2, F(26));
  }
  rrect(ctx, 74, 78, 40, 20, 3, F(28));
  line(ctx, [[74, 88], [114, 88]], 2, SH(28, 0.4)); // plank seam
  for (let s = 0; s < 5; s++) rrect(ctx, 72 + s * 8, 62, 8, 12, 1, F(s % 2 === 0 ? 12 : 17)); // awning
  poly(ctx, [[72, 62], [114, 62], [110, 57], [76, 57]], F(27));
  ell(ctx, 82, 82, 3, 4, F(31)); // wares catching the light
  ell(ctx, 92, 82, 3, 4, F(13));
  ell(ctx, 102, 82, 3.5, 4, F(17)); // gold — blooms
  // ── THE TRADER — heavy legs, then a slab of shoulder, then the apron.
  limb(ctx, 48, 92, 46, 108, 12, SH(27, 0.35));
  limb(ctx, 64, 92, 66, 108, 12, F(27));
  rrect(ctx, 36, 103, 22, 11, 3, F(26), INK); // boots
  rrect(ctx, 56, 103, 22, 11, 3, F(26), INK);
  rrect(ctx, 32, 44, 48, 30, 11, F(27)); // torso, deliberately too wide
  ell(ctx, 34, 52, 11, 10, HI(27, 0.3)); // lit shoulder
  ell(ctx, 78, 52, 11, 10, SH(27, 0.35)); // cool shoulder
  poly(ctx, [[38, 62], [76, 62], [82, 106], [32, 106]], F(28)); // the apron
  poly(ctx, [[42, 64], [70, 64], [73, 92], [39, 92]], HI(28, 0.28)); // bleached bib
  line(ctx, [[46, 63], [56, 50]], 3, F(26)); // straps over the shoulders
  line(ctx, [[68, 63], [60, 50]], 3, F(26));
  rrect(ctx, 40, 88, 34, 8, 2, SH(28, 0.45)); // waist tie
  limb(ctx, 38, 54, 26, 84, 13, F(27)); // forearms, thick
  limb(ctx, 76, 54, 92, 74, 13, SH(27, 0.3));
  ell(ctx, 24, 88, 7, 7, F(24));
  ell(ctx, 94, 76, 7, 7, SH(24, 0.3));
  // Head: iron-grey beard and a flat cap, so the head still reads at 72px
  // when the face itself is barely three pixels wide.
  ell(ctx, 56, 33, 14, 13, HI(24, 0.22)); // lit a step up: the face is the one
  ell(ctx, 62, 36, 8, 9, F(24)); // place a dark hole would kill the character
  ell(ctx, 50, 28, 5, 4, HI(24, 0.4));
  line(ctx, [[48, 33], [54, 33]], 2.4, F(23)); // squint
  line(ctx, [[60, 33], [66, 33]], 2.4, F(23));
  poly(ctx, [[46, 39], [68, 39], [63, 58], [51, 58]], F(4)); // iron-grey beard
  poly(ctx, [[46, 39], [54, 39], [53, 56], [51, 56]], HI(4, 0.3)); // lit edge of it
  line(ctx, [[58, 42], [58, 56]], 2, SH(4, 0.4)); // strands
  rrect(ctx, 41, 10, 30, 14, 5, F(26)); // flat cap, lifted clear of the eyes
  rrect(ctx, 37, 21, 39, 5, 2, F(26), INK); // brim
  // The hammer he keeps in the near hand — the forge read, in silhouette.
  limb(ctx, 24, 90, 22, 66, 6, F(28));
  rrect(ctx, 11, 55, 21, 12, 2, F(20));
  rrect(ctx, 11, 55, 6, 12, 2, SH(20, 0.4));
  celShade(ctx);
};

/**
 * The casino tout — a shifty gambler in shirtsleeves.
 *
 * Deliberately built to NOT collide with the magician, who is the other
 * card-handling body in the room: no tall hat (a flat visor peak instead), no
 * tailcoat (rolled sleeves and an arm garter), and a dart cocked back in the
 * far hand, which is what his idle loop in `tavern/npcs.ts` actually throws.
 */
const TOUT_NPC: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 114, 20);
  limb(ctx, 58, 88, 52, 108, 11, F(2)); // narrow trousers — a slighter build
  limb(ctx, 70, 88, 76, 108, 11, SH(2, 0.35));
  rrect(ctx, 43, 103, 20, 10, 3, F(1), INK); // shoes
  rrect(ctx, 67, 103, 20, 10, 3, F(1), INK);
  poly(ctx, [[54, 54], [76, 54], [78, 92], [52, 92]], F(22)); // shirt
  poly(ctx, [[54, 54], [64, 58], [62, 92], [52, 92]], F(11)); // waistcoat, open
  poly(ctx, [[76, 54], [64, 58], [66, 92], [78, 92]], SH(11, 0.3));
  for (const by of [68, 76, 84]) ell(ctx, 63, by, 1.7, 1.7, F(16)); // gold buttons
  rrect(ctx, 50, 88, 30, 7, 2, F(27), INK); // low-slung belt
  // One arm fans cards, the other is cocked back with a dart.
  limb(ctx, 54, 60, 36, 74, 8, F(22));
  limb(ctx, 76, 60, 96, 50, 8, HI(22, 0.2));
  rrect(ctx, 86, 47, 8, 10, 2, F(12)); // arm garter
  ell(ctx, 34, 78, 6, 6, F(24));
  ell(ctx, 99, 47, 6, 6, F(24));
  cardFan(ctx, 32, 80, -0.75, 3);
  line(ctx, [[98, 45], [113, 32]], 3, F(20)); // the dart
  poly(ctx, [[113, 32], [120, 26], [116, 35]], F(21)); // point
  poly(ctx, [[98, 45], [91, 46], [95, 52]], F(13)); // flight
  // Sharp face, sidelong smirk.
  ell(ctx, 64, 47, 9.5, 9, F(25));
  ell(ctx, 60, 43, 4, 3, HI(25, 0.3));
  ell(ctx, 60, 47, 1.6, 1.8, F(1));
  ell(ctx, 69, 47, 1.6, 1.8, F(1));
  line(ctx, [[59, 53], [70, 51]], 2, SH(23, 0.35));
  // The green dealer's visor. Nothing else in the cast has a flat horizontal
  // peak, so this alone tells him from the magician at a glance.
  rrect(ctx, 50, 27, 28, 9, 3, F(8));
  line(ctx, [[52, 31], [76, 31]], 2, HI(8, 0.3));
  poly(ctx, [[42, 35], [86, 32], [84, 41], [44, 43]], F(7), INK);
  celShade(ctx);
};

/** NPC art, keyed by Npc.kind. */
export const NPC_PAINTS: Record<string, FramePaint> = {
  magician: MAGICIAN_NPC,
  witch: WITCH_NPC,
  frog: FROG_NPC,
  merchant: MERCHANT_NPC,
  tout: TOUT_NPC,
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
