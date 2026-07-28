/**
 * FIGURE FOUNDATION — a systematic articulated-body rig for the crawler's
 * actors (2026-07-15 "rebuild the sprites from scratch so they have a better
 * base for animation").
 *
 * The old cel-painter drew every actor as soft overlapping ellipses/capsules at
 * low internal contrast, then crushed the result to a 36px grid. Two things
 * fell apart: the SILHOUETTE (near-value shapes merged into a blob under the
 * crush) and the ANIMATION (limbs weren't anchored to joints, so the walk cycle
 * barely moved). This module fixes both at the source.
 *
 *   1. Every part is drawn with a THREE-TONE selout treatment baked per-shape —
 *      a cool core shadow, the flat fill, a warm rim light, and a darker
 *      hue-shifted outline (palette.inkFor/shadeFor/highlightFor). High internal
 *      contrast means the shape survives the downscale as a READABLE cluster
 *      instead of mush, and it doesn't depend on the soft global celShade pass.
 *
 *   2. Bodies are posed by a small SKELETON of joint points (see Skeleton). A
 *      pose is expressed as joint positions, so a limb drawn hip→knee→foot
 *      genuinely swings when the pose changes. Walk/idle/attack are just
 *      different skeletons fed to the same part painters.
 *
 * Coordinates live in the 128px cel box (SPRITE_PX); GROUND (feet line) matches
 * cel-painter's constant so figures share the floor with the old props/items.
 */
import { enginePalette } from "../palette-source";

// Delegates rather than aliasing `enginePalette.css` directly: the game
// installs its palette after this module is imported, so capturing the
// function reference at load time would pin the greyscale fallback.
const C = (index: number): string => enginePalette.css(index);

// ── MATERIAL RAMPS ──────────────────────────────────────────────
//
// Pixel art shades by stepping along a hand-picked RAMP, not by computing a
// tint. Computed tints (the old shadeFor/highlightFor) pushed grey steel toward
// arcane green-blue, which the 32-colour quantizer then snapped to scattered
// rot-green specks — the "confetti" on the plate. Instead every material
// declares [shadeIdx, midIdx, hiIdx] as real palette indices, so the shade and
// highlight bands land EXACTLY on palette entries and quantize with zero noise.
//
// A ramp may carry a FOURTH tone, the BOUNCE (see BOUNCE below). It is optional
// so every existing 3-tuple still assigns, and `matBounce` fills one in from
// BOUNCE_FOR when a ramp does not name its own.
export type Ramp = readonly [shade: number, mid: number, hi: number, bounce?: number];

/** Steel plate ramp (dark → light). */
export const R_STEEL: Ramp = [19, 20, 21];
/** Dark steel (boots, under-suit). */
export const R_STEEL_DK: Ramp = [19, 19, 20];
/** Rot-green flesh ramp. */
/** Leather / cloth. */
export const R_LEATHER: Ramp = [26, 27, 28];
/** Blood / plume. */
export const R_BLOOD: Ramp = [11, 12, 13];
/** Bone / steel-highlight (skulls, spurs). */
export const R_BONE: Ramp = [20, 21, 22];
/** Human skin tone ramp (shadow, mid, light). */
export const R_SKIN: Ramp = [23, 24, 25];

// ── THE BOUNCE TONE ─────────────────────────────────────────────
//
// Three tones shade a form. They do not SEPARATE it. Everything above lights an
// actor entirely out of its own ramp, so a figure's darkest edge and the floor
// behind it can be the same value — and after the 32-colour snap, the same
// COLOUR. The palette census (render/palette.ts) put a number on how bad that
// had got: the torch ramp (14-18), the palette's only warm family and the thing
// the whole art direction is built around, was 2.26% of all actor pixels. The
// screenshot version of the same fact is a rot-green zombie standing on a
// painted flowstone patch with no edge at all.
//
// So each material gets a fourth tone taken from a DIFFERENT family than its
// own, painted on the LOWER-RIGHT silhouette — opposite the fixed upper-left
// key. That is not decoration, it is the rig:
//
//   boot/lighting.ts builds a cold blue directional (0xa7c0e0) raking from the
//   world's north-west — that is the key, and `hi` already serves it — plus a
//   WARM point lamp (0xd9cba8) that follows the player at y=1.3, i.e. low and
//   close. A low warm lamp plus torch pools is exactly a bounce: a thin warm
//   line along the bottom edge of anything standing on the floor.
//
// Warm-against-cold and cold-against-warm both survive the quantizer (they are
// far apart in the luma-weighted metric), which a value-only rim does not: a
// "slightly lighter green" snaps straight back onto the green it came from.
//
// KEYED ON THE SHADE TONE, and sparse on purpose. The shade is the band that
// actually touches the shadow-side edge, so it is the one that decides whether
// there is a separation problem at all — and a LIGHT material does not have
// one. The first cut keyed on the mid tone and gave steel a warm edge; the
// contact sheet said it plainly, the knight's plate read as rust. Anything not
// listed here gets no bounce and paints exactly as it did before.
const BOUNCE_FOR: Record<number, number> = {
  // rot flesh — flame, because a green rim on a green floor is not an edge, and
  // green floor is precisely what the surface painter now puts under it
  6: 16,
  7: 16,
  // skin
  23: 16,
  // blood / plume — the warm ramp keeps it red instead of pushing it pink
  10: 14,
  11: 15,
  // leather, wood, rag — already the warmest thing on the body, so its bounce
  // is the COLD key wrapping round the far side instead
  26: 4,
  27: 4,
  // dark steel and the under-suit — stone highlight, the entry the census found
  // nothing naming. Cool and pale: steel picking up the room, not rusting.
  19: 5,
  // stone / masonry props
  2: 5,
  // arcane
  29: 31,
};

/**
 * How wide the bounce line is, in cel px. Deliberately THIN: at 1.9 it crushes
 * to roughly one pixel at the 72px grid, which is a contact edge. Widen it and
 * actors stop looking lit and start looking like stickers with a glow border.
 */
const BOUNCE_W = 1.9;

/** Feet line in the 128px cel — kept identical to cel-painter's GROUND. */
export const GROUND = 118;
/** Horizontal centre of the cel box. */
export const CX = 64;

/** A 2D point in the 128px cel box. */
export type Pt = [number, number];

// ══════════════════════════════════════════════════════════════════
// THREE-TONE PART PAINTING
//
// Every solid part is: fill + a cool core-shadow crescent on the lower-right +
// a warm rim on the upper-left + a selout outline. The light direction is fixed
// in ART space (upper-left) to match cel-painter's celShade, so the two systems
// agree and a flip for W facing stays "least wrong".
// ══════════════════════════════════════════════════════════════════

/** Outline width in cel px (parts are ~128px, crushed later — keep it bold). */
const INK_W = 3.2;

/**
 * A material is EITHER a Ramp (3-tone shading) or a bare palette index (flat).
 * Bare index → shade/hi both fall back to that index (flat fill), which keeps
 * the ad-hoc single-colour calls terse.
 */
type Mat = Ramp | number;
function matMid(m: Mat): number {
  return typeof m === "number" ? m : m[1];
}
function matShade(m: Mat): number {
  return typeof m === "number" ? m : m[0];
}
function matHi(m: Mat): number {
  return typeof m === "number" ? m : m[2];
}
/**
 * The bounce tone for a material: its own 4th entry if it declares one, else
 * the cross-family pick in BOUNCE_FOR, else -1 for "this material gets no
 * bounce". -1 rather than a fallback index on purpose — a material with no
 * mapping should stay exactly as it painted before, not acquire a rim by
 * accident.
 */
function matBounce(m: Mat): number {
  if (typeof m !== "number" && m[3] != null) return m[3];
  return BOUNCE_FOR[matShade(m)] ?? -1;
}

/**
 * A capsule limb from a→b with rounded caps, shaded along the ramp. The shade
 * band is a thinner capsule offset down-right and the highlight a thin capsule
 * offset up-left — both filled with REAL palette indices so they quantize to
 * clean bands (no confetti). Reads as a rounded tube after the crush.
 */
export function limbShaded(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, m: Mat, opts: { rim?: boolean; bounce?: boolean } = {}): void {
  ctx.lineCap = "round";
  stroke(ctx, a, b, w + INK_W * 2, C(inkIdx(m))); // outline
  stroke(ctx, [a[0] + 1.6, a[1] + 1.6], [b[0] + 1.6, b[1] + 1.6], w, C(matShade(m))); // shade underneath
  stroke(ctx, a, b, w * 0.82, C(matMid(m))); // mid fill on top, shifted up-left
  if (opts.rim !== false) {
    stroke(ctx, [a[0] - 1.4, a[1] - 1.6], [b[0] - 1.4, b[1] - 1.6], w * 0.34, C(matHi(m))); // rim
  }
  // BOUNCE — the mirror of the rim: a thinner stroke offset DOWN-RIGHT, the
  // shadow side, in a cross-family tone. Last, and narrow, so it lands as a
  // contact line just inside the ink rather than as a second fill.
  const bo = opts.bounce === false ? -1 : matBounce(m);
  if (bo >= 0) {
    stroke(ctx, [a[0] + 1.9, a[1] + 2.1], [b[0] + 1.9, b[1] + 2.1], Math.min(BOUNCE_W, w * 0.3), C(bo));
  }
}

/** Selout ink for a material: darker cool version of its shade tone. */
function inkIdx(m: Mat): number {
  const s = matShade(m);
  // Steel/bone shade to 19; rot to 6; leather to 26; blood to 10 — one step
  // below the ramp's own shade. Fall back to the global inkFor via a css escape
  // hatch only for bare indices with no darker neighbour.
  const below: Record<number, number> = { 20: 19, 19: 1, 21: 19, 8: 6, 7: 6, 9: 7, 12: 10, 11: 10, 13: 11, 27: 26, 28: 27, 26: 1, 22: 20 };
  return below[s] ?? 1;
}

function stroke(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** A ramp-shaded ellipse: shade underneath, mid on top, warm rim arc, ink edge. */
export function ellShaded(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, m: Mat, rot = 0, opts: { ink?: number; rim?: boolean; bounce?: boolean } = {}): void {
  // shade base (full shape in the shade tone)
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = C(matShade(m));
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = opts.ink != null ? C(opts.ink) : C(inkIdx(m));
  ctx.stroke();
  // mid fill — a slightly smaller ellipse nudged up-left, so a shade crescent
  // shows on the lower-right. Clean two-band read.
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.14, y - ry * 0.16, rx * 0.9, ry * 0.9, rot, 0, Math.PI * 2);
  ctx.fillStyle = C(matMid(m));
  ctx.fill();
  // warm rim (upper-left arc)
  if (opts.rim !== false) {
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.3, y - ry * 0.34, rx * 0.5, ry * 0.5, rot, 0, Math.PI * 2);
    ctx.fillStyle = C(matHi(m));
    ctx.fill();
  }
  // BOUNCE — a thin stroked arc along the LOWER-RIGHT limb of the ellipse, just
  // inside the ink. An arc rather than a filled crescent on purpose: a crescent
  // would replace the shade band that sculpts the form, and the job here is to
  // separate the shape from the floor, not to re-light it.
  const bo = opts.bounce === false ? -1 : matBounce(m);
  if (bo >= 0 && rx > 3 && ry > 3) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, rx - INK_W * 0.45), Math.max(0.5, ry - INK_W * 0.45), rot, -0.14 * Math.PI, 0.64 * Math.PI);
    ctx.lineWidth = BOUNCE_W;
    ctx.lineCap = "round";
    ctx.strokeStyle = C(bo);
    ctx.stroke();
  }
}

/**
 * A ramp-shaded convex polygon plate (torso, pauldron, skirt). Shade fills the
 * whole plate, then a mid copy nudged up-left leaves a shade crescent on the
 * lower-right, then a bright rim stroke on the upper-left silhouette. All real
 * palette indices → clean bands.
 */
export function plateShaded(ctx: CanvasRenderingContext2D, pts: Pt[], m: Mat, opts: { ink?: number; rim?: boolean; backlight?: number; bounce?: boolean } = {}): void {
  // shade base
  path(ctx, pts);
  ctx.fillStyle = C(matShade(m));
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.lineJoin = "round";
  ctx.strokeStyle = opts.ink != null ? C(opts.ink) : C(inkIdx(m));
  ctx.stroke();
  // mid — nudge the plate up-left inside its own clip
  ctx.save();
  path(ctx, pts);
  ctx.clip();
  path(ctx, pts.map((p) => [p[0] - 3, p[1] - 4] as Pt));
  ctx.fillStyle = C(matMid(m));
  ctx.fill();
  ctx.restore();
  // warm rim — bright stroke along the upper-left silhouette
  if (opts.rim !== false) {
    const top = topLeftRun(pts);
    if (top.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = C(matHi(m));
      ctx.stroke();
    }
  }
  // BACKLIGHT / BOUNCE rim along the lower-right (shadow-side) silhouette.
  //
  // This started as an opt-in for ARMOUR only — highly reflective metal reads
  // with both a specular hotspot and a shadow-side rim. The census showed the
  // opt-in was the problem: only the helm and a couple of plates ever passed
  // `backlight`, so everything made of flesh, rag or bone had no shadow-side
  // edge at all and merged into whatever it was standing on. Now an explicit
  // `backlight` still wins (it is how a plate names a colour the ramp does not
  // imply), and everything else falls through to the material's BOUNCE_FOR
  // tone. `backlight: -1` opts a plate out.
  const bo = opts.backlight ?? (opts.bounce === false ? -1 : matBounce(m));
  if (bo >= 0) {
    const bot = bottomRightRun(pts);
    if (bot.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(bot[0][0], bot[0][1]);
      for (let i = 1; i < bot.length; i++) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.strokeStyle = C(bo);
      ctx.stroke();
    }
  }
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** The upper-left silhouette run of a polygon: vertices above+left of centroid. */
function topLeftRun(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.filter((p) => p[1] <= cy || p[0] <= cx);
}

/** The lower-right silhouette run — where a cool BACKLIGHT rim lands on metal. */
function bottomRightRun(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.filter((p) => p[1] >= cy || p[0] >= cx);
}

/** A rounded rect (belts, straps, blocky armour bits). Flat with a shade base. */
export function rrectShaded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, m: Mat, opts: { ink?: number } = {}): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = C(matShade(m));
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = opts.ink != null ? C(opts.ink) : C(inkIdx(m));
  ctx.stroke();
  // mid fill inset a touch from the lower-right so a shade edge shows
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = C(matMid(m));
  ctx.fillRect(x, y, w - 1.5, h - 1.5);
  ctx.restore();
}

/** An un-outlined detail line (seams, ribs, string). Accepts a Mat or bare index. */
export function detail(ctx: CanvasRenderingContext2D, pts: Pt[], w: number, m: Mat): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = w;
  ctx.strokeStyle = C(matMid(m));
  ctx.stroke();
}

/** A hard-edged, unshaded glow dot (eyes) — no ink so it blooms cleanly. */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, coreIdx: number, hotIdx = 18): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = C(coreIdx);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - r * 0.28, y - r * 0.28, r * 0.45, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = C(hotIdx);
  ctx.fill();
}

/** Soft contact shadow under the figure, drawn first. */
export function groundShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(11, 13, 18, 0.4)";
  ctx.fill();
}

// ══════════════════════════════════════════════════════════════════
// BIPED SKELETON — the shared rig. A pose produces joint POINTS; the
// actor painters draw parts anchored to those joints. Because a limb is
// drawn hip→knee→foot from these points, changing the pose genuinely
// swings the limb — the walk cycle MOVES.
// ══════════════════════════════════════════════════════════════════

export interface Skeleton {
  /** Pelvis / hip centre. */
  hip: Pt;
  hipL: Pt;
  hipR: Pt;
  kneeL: Pt;
  kneeR: Pt;
  footL: Pt;
  footR: Pt;
  /** Chest / shoulder centre. */
  chest: Pt;
  shoulderL: Pt;
  shoulderR: Pt;
  elbowL: Pt;
  elbowR: Pt;
  handL: Pt;
  handR: Pt;
  /** Neck base + head centre. */
  neck: Pt;
  head: Pt;
}

/** Facing the rig is posed for. W is drawn as E flipped at runtime. */
export type Dir3 = "S" | "N" | "E";

/**
 * Pose inputs, normalised so every actor drives the SAME rig:
 *   bob     — vertical body bounce (px, adds down)
 *   stride  — -1..1 leg scissor phase (0 = feet together)
 *   lean    — forward lean radians (zombie shamble; 0 for the upright knight)
 *   crouch  — 0..1 sink (attack windup / death)
 *   swing   — -1..1 arm swing phase; arms counter-swing the legs (contralateral
 *             gait). Applied to the OFF arm and the carry arm so a walk reads as
 *             a real stride, not a bob. 0 = arms at carry rest.
 *   roll    — -1..1 lateral body roll; shifts shoulders/hips side-to-side and
 *             tilts the head a touch, the half-cadence sway that sells weight.
 *   twist   — -1..1 torso rotation toward/away (subtle chest turn on walk/attack)
 */
export interface Pose {
  bob: number;
  stride: number;
  lean?: number;
  crouch?: number;
  swing?: number;
  roll?: number;
  twist?: number;
}

/**
 * Build a biped skeleton for a direction + pose. `cfg` lets each actor set its
 * own proportions (limb reach, stance width, hunch) while sharing the maths, so
 * the knight stands tall and the zombie hunches from ONE rig.
 */
export interface RigConfig {
  /** Shoulder half-width, px. */
  shoulderW: number;
  /** Hip half-width, px. */
  hipW: number;
  /** Standing height from GROUND to shoulders, px. */
  torsoTop: number;
  /** Hip height above GROUND, px. */
  hipY: number;
  /** Head centre height above GROUND, px. */
  headY: number;
  /** How far a striding foot reaches forward in profile, px. */
  step: number;
  /** Knee-lift in the front view when a foot is raised, px. */
  lift: number;
}

export function buildSkeleton(dir: Dir3, pose: Pose, cfg: RigConfig): Skeleton {
  const bob = pose.bob;
  const lean = pose.lean ?? 0;
  const crouch = (pose.crouch ?? 0) * 10;
  const swing = pose.swing ?? 0;
  const roll = pose.roll ?? 0;
  const hipY = GROUND - cfg.hipY + bob + crouch;
  const chestY = GROUND - cfg.torsoTop + bob + crouch;
  const headY = GROUND - cfg.headY + bob + crouch;

  // Lean shifts the upper body forward (screen -x for E profile, up-ish for S/N)
  const leanX = dir === "E" ? Math.sin(lean) * 22 : 0;
  const leanUp = dir === "E" ? 0 : Math.sin(lean) * 10;

  // Lateral roll: shoulders sway one way, hips the counter way (a shallow S),
  // and the head tips slightly — the half-cadence weight-shift of a real gait.
  const shoulderRoll = roll * 3;
  const hipRoll = -roll * 1.6;
  const headTip = roll * 1.4;

  const hip: Pt = [CX + hipRoll, hipY];
  const chest: Pt = [CX + leanX * 0.5 + shoulderRoll, chestY - leanUp];
  const neck: Pt = [CX + leanX * 0.8 + shoulderRoll * 0.7, chestY - 6 - leanUp];
  const head: Pt = [CX + leanX + headTip, headY - leanUp];

  // Contralateral arm swing (profile has real fore/back reach; front/back views
  // read it as a smaller in-plane sweep). The carry arm and off arm swing in
  // opposition to their same-side leg.
  const armReach = dir === "E" ? swing * 12 : swing * 5;
  const armLift = Math.abs(swing) * 4;

  const sk: Skeleton = {
    hip,
    hipL: [hip[0] - cfg.hipW, hipY],
    hipR: [hip[0] + cfg.hipW, hipY],
    kneeL: [hip[0] - cfg.hipW, hipY + (GROUND - hipY) * 0.5],
    kneeR: [hip[0] + cfg.hipW, hipY + (GROUND - hipY) * 0.5],
    footL: [hip[0] - cfg.hipW, GROUND],
    footR: [hip[0] + cfg.hipW, GROUND],
    chest,
    shoulderL: [chest[0] - cfg.shoulderW, chest[1]],
    shoulderR: [chest[0] + cfg.shoulderW, chest[1]],
    // elbow/hand carry the swing: left arm forward when swing>0, right arm back
    elbowL: [chest[0] - cfg.shoulderW - 2 + armReach, chest[1] + 16 - armLift],
    elbowR: [chest[0] + cfg.shoulderW + 2 - armReach, chest[1] + 16 - armLift],
    handL: [chest[0] - cfg.shoulderW - 2 + armReach * 1.6, chest[1] + 30 - armLift * 1.4],
    handR: [chest[0] + cfg.shoulderW + 2 - armReach * 1.6, chest[1] + 30 - armLift * 1.4],
    neck,
    head,
  };

  // ── legs: scissor by facing ── (feet track the rolled hip via hcx)
  const hcx = hip[0];
  if (dir === "E") {
    // profile — real forward/back reach
    const reach = pose.stride * cfg.step;
    sk.footR = [hcx + reach, GROUND - Math.abs(pose.stride) * 3];
    sk.footL = [hcx - reach, GROUND];
    sk.kneeR = [hcx + reach * 0.6, hipY + (GROUND - hipY) * 0.52 - Math.abs(pose.stride) * 3];
    sk.kneeL = [hcx - reach * 0.5, hipY + (GROUND - hipY) * 0.5];
    sk.hipL = [hcx - 3, hipY];
    sk.hipR = [hcx + 3, hipY];
  } else {
    // front/back — alternating knee lift reads as walking toward/away
    const liftL = Math.max(0, pose.stride) * cfg.lift;
    const liftR = Math.max(0, -pose.stride) * cfg.lift;
    sk.footL = [hcx - cfg.hipW, GROUND - liftL];
    sk.footR = [hcx + cfg.hipW, GROUND - liftR];
    sk.kneeL = [hcx - cfg.hipW, hipY + (GROUND - hipY) * 0.5 - liftL * 0.5];
    sk.kneeR = [hcx + cfg.hipW, hipY + (GROUND - hipY) * 0.5 - liftR * 0.5];
  }

  return sk;
}

/** Draw a two-segment leg hip→knee→foot with a shaded boot cap at the foot. */
export function legShaded(ctx: CanvasRenderingContext2D, hip: Pt, knee: Pt, foot: Pt, w: number, leg: Ramp | number, boot: Ramp | number, dir: Dir3): void {
  limbShaded(ctx, hip, knee, w, leg);
  limbShaded(ctx, knee, foot, w * 0.92, leg);
  // boot — an ellipse pointing in the walk direction
  const bw = dir === "E" ? 9 : 8;
  ellShaded(ctx, foot[0] + (dir === "E" ? 3 : 0), foot[1] - 2, bw, 5, boot);
}

/** Draw a two-segment arm shoulder→elbow→hand. Fist optional. */
export function armShaded(ctx: CanvasRenderingContext2D, sh: Pt, el: Pt, hand: Pt, w: number, m: Ramp | number, fist?: Ramp | number): void {
  limbShaded(ctx, sh, el, w, m);
  limbShaded(ctx, el, hand, w * 0.9, m);
  if (fist != null) ellShaded(ctx, hand[0], hand[1], w * 0.62, w * 0.62, fist);
}
