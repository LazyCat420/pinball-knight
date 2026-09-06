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
import { paletteCss, inkFor, shadeFor, highlightFor, PALETTE_HEX } from "./palette";
import { ART_PX } from "../constants";
import { WEAPONS, type WeaponId } from "../items";
import { CARDS, CARD_IDS, RARITY_HEX } from "../cards";
import { REAGENTS, REAGENT_IDS } from "../reagents";
// TYPE-ONLY: `state` is the root module and pulls in half the game. A value
// import here would close a cycle through render/ at module-load time; the type
// is erased, so this costs nothing and still compile-enforces MARBLE_SKINS.
import type { MarbleMaterial } from "../state";
import { FULL_PLATE, type KnightLook } from "./knight-look";
import type { ArmorStyleId } from "../armor-styles";
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
  R_SKIN,
  buildSkeleton,
  legShaded,
  armShaded,
  limbShaded,
  ellShaded,
  plateShaded,
  rrectShaded,
  detail as figDetail,
  glow as figGlow,
} from "../engine/render/figure";

// The painter VOCABULARY is engine (see engine/render/paint-types.ts); the art
// below is content. Re-exported so this module's many call sites are unchanged.
export type { FramePaint, Dir, ClipName, ActorPaints } from "../engine/render/paint-types";
import type { FramePaint, Dir, ClipName, ActorPaints } from "../engine/render/paint-types";

const PX = ART_PX; // 128 — all coordinates below live in this box
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
// TELEGRAPH CLIPS — the poses a policy's TELL needs.
//
// entities/movement.ts ships six intents that each declare a telegraph, and
// until this wave every one of those telegraphs was a TINT and nothing else.
// A tint is legible but thin: a crouching leaper, a stalking pack-hunter and an
// ambusher that has just committed all played the same `idle`, and a staggered
// monster played `idle` pale — the single most frequent piece of feedback in
// the game had no animation whatsoever.
//
// Two of the four tells need a real POSE and get one on the rig (the leaper's
// crouch, the pack-hunter's stalk). The other two are BODY DISPLACEMENTS —
// a stagger is the whole figure rocked off its feet, an ambusher's spring is
// the whole figure thrown forward — and those are built here as transforms of
// an actor's own existing art, pivoting about the feet.
//
// That is not a shortcut, it is how a 2D animator would do it: the read is the
// silhouette moving through an arc, not new draughtsmanship. It also makes the
// two clips affordable across families that share nothing else, which matters
// because stagger applies to every family in the bestiary and pose art does not.
// ══════════════════════════════════════════════════════════════════

/**
 * Re-frame an existing painted frame: rotate by `tilt` and shift by (dx, dy)
 * about the FEET, so the figure pivots where it touches the floor instead of
 * sliding. Rotating about the cel centre would lift a heavy actor off the
 * ground on the way past.
 */
function reframed(base: FramePaint, tilt: number, dx: number, dy: number): FramePaint {
  return (ctx) => {
    ctx.save();
    ctx.translate(CX + dx, GROUND + dy);
    ctx.rotate(tilt);
    ctx.translate(-CX, -GROUND);
    base(ctx);
    ctx.restore();
  };
}

/**
 * STUMBLE — three beats of a body absorbing a hit, built off the actor's own
 * idle pose: rocked hard away from the blow, a deeper sag as the weight
 * arrives, then a partial recovery that HOLDS (the animator does not loop this
 * clip). The knight's attack already proved the shape — fast into the extreme,
 * slow out of it — so the first frame is the biggest displacement, not the
 * middle one.
 *
 * Reads at 72px because the whole SILHOUETTE moves: a 5px lean plus a 3px sink
 * on a 40px-tall figure is an unmistakable change of outline, where a re-posed
 * arm would be two pixels nobody sees during a fight.
 */
function stumbleFrames(base: FramePaint): FramePaint[] {
  return [reframed(base, 0.26, 5, 1), reframed(base, 0.19, 7, 3), reframed(base, 0.08, 3, 1)];
}

/**
 * WAKE — the ambusher's spring and the strafer's dart: rear back a touch
 * (anticipation, one frame, because the burst is the point and a long wind-up
 * would contradict "it never moved and then it was on you"), then throw the
 * whole body forward and hold the lunge for the rest of the burst.
 *
 * Forward is -x in the E profile, which is the facing the sheet is authored
 * for; S/N read the same lean as a squash toward the camera. Close enough at
 * this size, and it costs nothing to be wrong about.
 */
function wakeFrames(base: FramePaint): FramePaint[] {
  return [reframed(base, 0.1, 3, 2), reframed(base, -0.24, -6, -2), reframed(base, -0.34, -9, 0)];
}

/**
 * Fill in `wake` and `stumble` for any actor that has not authored them, off
 * its own idle art. Applied once in boot/sheets.ts to every MONSTER atlas.
 *
 * The alternative was to let the animator's fallback chain send them to `idle`,
 * which is what the game did before this wave — and the reason that is not good
 * enough is a number: stagger fires on a proportion of every damage event
 * (entities/stagger.ts, 78% on fodder at speed), so it is now the most frequent
 * feedback in the game. "Only the four families I hand-posed react to being
 * hit" is not a shippable answer to that.
 *
 * Bespoke clips WIN — the zombie rig, the spider and the magnet author their
 * own and keep them. This only reaches families that would otherwise have
 * nothing.
 *
 * Built ONCE off the E-profile idle and shared by all three facings, for the
 * same reason the zombie's are: every frame here is a `crushToGrid` at boot and
 * a bigger atlas for every actor to clone. Three facings of a 0.3s recoil is
 * three times the cost for a distinction nobody can see at 72px.
 */
function deathFrames(base: FramePaint): FramePaint[] {
  return [
    reframed(base, 0.15, 2, 2),
    (ctx) => {
      ctx.save();
      ctx.translate(CX + 4, GROUND + 4);
      ctx.rotate(0.28);
      ctx.scale(1.15, 0.75);
      ctx.translate(-CX, -GROUND);
      base(ctx);
      ctx.restore();
    },
    (ctx) => {
      ctx.save();
      ctx.translate(CX + 6, GROUND + 6);
      ctx.rotate(0.42);
      ctx.scale(1.35, 0.45);
      ctx.translate(-CX, -GROUND);
      base(ctx);
      ctx.restore();
    },
    (ctx) => {
      ctx.save();
      ctx.translate(CX + 8, GROUND + 8);
      ctx.rotate(0.55);
      ctx.scale(1.5, 0.25);
      ctx.translate(-CX, -GROUND);
      ctx.globalAlpha = 0.85;
      base(ctx);
      ctx.restore();
    },
  ];
}

export function withRecoil(p: ActorPaints): ActorPaints {
  const base = p.E.idle?.[0] ?? p.S.idle?.[0];
  if (!base) return p;
  const stumble = stumbleFrames(base);
  const wake = wakeFrames(base);
  const death = deathFrames(base);
  const out = { ...p } as ActorPaints;
  for (const dir of ["S", "N", "E"] as Dir[]) {
    out[dir] = {
      ...p[dir],
      stumble: p[dir].stumble ?? stumble,
      wake: p[dir].wake ?? wake,
      death: p[dir].death ?? death,
    };
  }
  return out;
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

/**
 * GREATSWORD — the same silhouette language as the sword but scaled to a
 * two-hander: longer blade, a fuller down the middle (the groove that reads as
 * "big blade" more than length alone) and a broad crossguard.
 */
function drawGreatswordHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 10, 0, -20, 6, F(27)); // grip, long enough for two hands
  rrect(ctx, -8, -26, 16, 5, 2, F(19)); // crossguard
  // Blade: a long tapered wedge.
  poly(ctx, [[-6, -26], [6, -26], [4, -84], [0, -92], [-4, -84]], F(21));
  poly(ctx, [[-2, -28], [2, -28], [1.5, -82], [0, -88], [-1.5, -82]], F(22)); // fuller
  ell(ctx, 0, 10, 4, 4, F(16)); // pommel
}

/**
 * WARHAMMER — mass on a stick. A blocky head with a flat striking face and a
 * back spike, so the silhouette says "this hits ONE thing very hard".
 */
function drawWarhammerHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 8, 0, -42, 8, F(27)); // thick haft
  rrect(ctx, -13, -57, 21, 16, 3, F(20)); // head block
  rrect(ctx, -13, -53, 5, 9, 1, F(21)); // bright striking face
  poly(ctx, [[8, -55], [8, -45], [17, -50]], F(19)); // back spike
  rrect(ctx, -6, -14, 12, 5, 2, F(16)); // band
}

/**
 * WRECKING BALL — a chain and a sphere. Drawn slack and off-centre so it reads
 * as SWUNG rather than held rigid, which is the whole fantasy of the weapon.
 */
function drawWreckingBallHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 8, 0, -22, 5, F(27)); // short handle
  // Chain links arcing out to the ball.
  const pts: Array<[number, number]> = [[2, -26], [5, -33], [9, -40], [13, -47]];
  for (const [lx, ly] of pts) ell(ctx, lx, ly, 3, 3, F(20));
  // The ball: steel sphere with a hot rim and a couple of studs.
  ell(ctx, 17, -54, 12, 12, F(19));
  ell(ctx, 14, -57, 6, 6, F(21)); // lit shoulder
  ell(ctx, 12, -59, 2.5, 2.5, F(22)); // specular
  for (const [sx, sy] of [[24, -49], [22, -61], [11, -47]] as Array<[number, number]>) {
    ell(ctx, sx, sy, 2.5, 2.5, F(20));
  }
}

const WEAPON_HELD: Partial<Record<WeaponId, HeldPaint>> = {
  greatsword: (ctx) => drawGreatswordHeld(ctx),
  warhammer: (ctx) => drawWarhammerHeld(ctx),
  wreckingball: (ctx) => drawWreckingBallHeld(ctx),
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

/**
 * ARMOR STYLE → paint. An elemental set (armor-styles.ts) swaps which RAMPS the
 * equipped pieces brighten to — the same rule as gear presence (ramp swaps,
 * never geometry), so every style keeps the knight's silhouette grammar. All
 * indices are real Cold-Crypt palette entries so the quantizer stays clean:
 * ice rides the arcane ramp, wind the rot-greens, fire the torch ramp, thunder
 * a storm-slate whose highlight and trim crack into lightning gold. Missing
 * pieces stay dull dark iron in EVERY style — the set only paints what you wear.
 */
interface StylePaint {
  plate: Ramp; // helm dome, cuirass, pauldrons, tassets, greaves
  plume: Ramp; // helmet crest
  trim: number; // gorget stud + belt buckle accent
  spark: number; // visor eye-glow core
  sparkHot: number; // eye-glow hot centre
}
const STYLE_PAINTS: Record<ArmorStyleId, StylePaint> = {
  iron: { plate: K_PLATE, plume: K_PLUME, trim: K_TRIM, spark: 30, sparkHot: 18 },
  ice: { plate: [29, 30, 31], plume: [30, 31, 22], trim: 31, spark: 31, sparkHot: 22 },
  wind: { plate: [7, 8, 9], plume: [8, 9, 22], trim: 9, spark: 9, sparkHot: 22 },
  fire: { plate: [14, 15, 16], plume: [15, 16, 17], trim: 17, spark: 16, sparkHot: 18 },
  thunder: { plate: [2, 3, 4], plume: [16, 17, 18], trim: 18, spark: 17, sparkHot: 18 },
};

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
function knightHelm(ctx: CanvasRenderingContext2D, head: Pt, dir: Dir3, plumeLag = 0, hasHelm = true, sp: StylePaint = STYLE_PAINTS.iron): void {
  const [x, y] = head;
  const pl = plumeLag;
  if (!hasHelm) {
    // Bare head for unarmored regular guy (face + hair)
    if (dir === "E") {
      plateShaded(ctx, [[x - 10, y - 10], [x + 9, y - 10], [x + 11, y + 2], [x + 13, y + 4], [x + 7, y + 11], [x - 8, y + 9]], R_SKIN, { backlight: 30 });
      plateShaded(ctx, [[x - 11, y - 12], [x + 7, y - 12], [x + 8, y - 5], [x - 6, y - 4], [x - 11, y + 2]], R_LEATHER, { rim: false });
      rrectShaded(ctx, x + 5, y - 2, 3, 2, 1, 1, { ink: 1 });
    } else {
      plateShaded(ctx, [[x - 10, y - 10], [x + 10, y - 10], [x + 11, y + 4], [x + 5, y + 12], [x - 5, y + 12], [x - 11, y + 4]], R_SKIN, { backlight: 30 });
      if (dir === "S") {
        plateShaded(ctx, [[x - 11, y - 12], [x + 11, y - 12], [x + 10, y - 4], [x - 10, y - 4]], R_LEATHER, { rim: false });
        rrectShaded(ctx, x - 7, y - 2, 4, 3, 1, 1, { ink: 1 });
        rrectShaded(ctx, x + 3, y - 2, 4, 3, 1, 1, { ink: 1 });
      } else {
        plateShaded(ctx, [[x - 11, y - 12], [x + 11, y - 12], [x + 12, y + 4], [x + 8, y + 10], [x - 8, y + 10], [x - 12, y + 4]], R_LEATHER, { backlight: 30 });
      }
    }
    return;
  }
  const dome: Ramp = sp.plate;
  if (dir === "E") {
    // side profile — a long horsehair mane sweeping back off the crown
    plateShaded(ctx, [[x - 1, y - 15], [x - 14, y - 24 + pl * 0.3], [x - 27, y - 16 + pl], [x - 30, y + 2 + pl * 1.2], [x - 20, y - 2], [x - 6, y - 5]], sp.plume, { rim: false });
    figDetail(ctx, [[x - 4, y - 13], [x - 18, y - 16 + pl * 0.6], [x - 27, y - 8 + pl]], 2, sp.plume[2]); // bright strand
    figDetail(ctx, [[x - 6, y - 8], [x - 20, y - 6 + pl]], 1.5, sp.plume[0]); // dark strand
  } else {
    // front/back — a tall fanned crest rising off the crown, tip trailing on pl
    plateShaded(ctx, [[x - 4, y - 14], [x - 2 + pl * 0.4, y - 27], [x + 6 + pl, y - 30], [x + 11 + pl * 1.2, y - 22], [x + 6, y - 14]], sp.plume, { rim: false });
    figDetail(ctx, [[x + 1, y - 15], [x + 3 + pl * 0.6, y - 25], [x + 8 + pl, y - 28]], 2, sp.plume[2]); // bright strand
    figDetail(ctx, [[x + 2, y - 15], [x + 5 + pl, y - 23]], 1.5, sp.plume[0]); // dark strand
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
      figGlow(ctx, x - 6, y - 1, 1.6, sp.spark, sp.sparkHot); // faint elemental eye-spark, left
      figGlow(ctx, x + 6, y - 1, 1.6, sp.spark, sp.sparkHot); // right
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
  const sp = STYLE_PAINTS[look.style ?? "iron"];
  const CUIRASS: Ramp = look.armor ? sp.plate : R_LEATHER;
  const TASSET: Ramp = sp.plate;
  const TRIM = look.armor ? sp.trim : K_STEEL_DK;
  const GREAVE: Ramp = sp.plate;
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
  const legColor = look.armor ? K_LEG : R_LEATHER;
  if (dir === "E") {
    // profile: far leg (dimmer) behind, near leg in front
    legShaded(ctx, sk.hip, sk.kneeL, sk.footL, 11, K_STEEL_DK, K_STEEL_DK, d3);
    if (look.boots) knightGreave(ctx, sk.kneeL, sk.footL, K_PLATE_DK); // far greave (dim)
    legShaded(ctx, sk.hip, sk.kneeR, sk.footR, 12, legColor, K_PLATE_DK, d3);
    if (look.boots) knightGreave(ctx, sk.kneeR, sk.footR, GREAVE); // near greave
  } else {
    legShaded(ctx, sk.hipL, sk.kneeL, sk.footL, 12, legColor, K_PLATE_DK, d3);
    legShaded(ctx, sk.hipR, sk.kneeR, sk.footR, 12, legColor, K_PLATE_DK, d3);
    if (look.boots) {
      knightGreave(ctx, sk.kneeL, sk.footL, GREAVE);
      knightGreave(ctx, sk.kneeR, sk.footR, GREAVE);
    }
  }

  // ── faulds + tassets (armoured skirt over the hips) ──
  if (look.armor) {
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
  }

  // ── torso: a tapered cuirass (if armored) or cloth tunic (if unarmored) ──
  const t = knightTorsoPts(sk, dir);
  plateShaded(ctx, t, CUIRASS, { backlight: 30 });
  if (look.armor) {
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
  }
  rrectShaded(ctx, sk.hipL[0] - 2, sk.hip[1] - 6, (sk.hipR[0] - sk.hipL[0]) + 4, 6, 2, 27); // belt
  rrectShaded(ctx, sk.hip[0] - 4, sk.hip[1] - 6, 8, 6, 1.5, TRIM); // buckle

  // ── off arm (non-weapon) — now driven by the rig joints so it SWINGS ──
  if (dir === "E") {
    // far arm hint behind the torso (dim), tracks the swing subtly
    armShaded(ctx, [sk.shoulderL[0] + 2, sk.shoulderL[1] + 2], sk.elbowL, sk.handL, 7, K_STEEL_DK, look.armor ? K_PLATE_DK : R_SKIN);
  } else {
    const offSh: Pt = dir === "S" ? sk.shoulderL : sk.shoulderR;
    const offEl: Pt = dir === "S" ? sk.elbowL : sk.elbowR;
    const offHand: Pt = dir === "S" ? sk.handL : sk.handR;
    armShaded(ctx, offSh, offEl, offHand, 8, legColor, look.armor ? K_PLATE_DK : R_SKIN);
  }

  // ── pauldrons (shoulder cops) — angular LAYERED plates (two lames) that widen
  // the shoulders. A rounded multi-point plate reads as armour, not a button. ──
  if (look.armor) {
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
  }

  // ── weapon arm: shoulder → hand anchor ──
  const wShoulder: Pt = dir === "S" ? sk.shoulderR : dir === "N" ? sk.shoulderL : sk.shoulderR;
  armShaded(ctx, wShoulder, [(wShoulder[0] + weaponHand[0]) / 2, (wShoulder[1] + weaponHand[1]) / 2 - 3], weaponHand, 8, legColor, look.armor ? K_PLATE_DK : R_SKIN);
  // gauntlet fist at the weapon hand (rides the cuirass style once armoured, bare skin if unarmored)
  ellShaded(ctx, weaponHand[0], weaponHand[1], 5, 5, look.armor ? sp.plate : R_SKIN);

  // ── head / helm (plume trails on plumeLag) ──
  knightHelm(ctx, sk.head, d3, plumeLag, look.helmet, sp);

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
function knightRollFrame(dir: Dir, t: number, weapon: WeaponId, look: KnightLook, tuckOverride?: number): FramePaint {
  const base = (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 4, stride: 0, roll: 0.3 }, weapon, look);
  const spinDir = dir === "N" ? -1 : 1; // N faces away → tumble reads reversed
  const angle = spinDir * t * Math.PI * 2; // one full rotation across the roll
  // `tuckOverride` is how the ENTRY and EXIT frames are authored: a nearly
  // untucked figure at zero rotation, so the clip has a dip before the spin and
  // a rise out of it instead of snapping from standing to fully balled.
  const tuck = tuckOverride ?? 0.72 + 0.12 * Math.sin(t * Math.PI); // squash to a ball mid-roll
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
 * BALL-FORM frame: the pinball OVERCHARGE form — the knight tucked to a tight
 * ball, spinning a quarter-turn per frame, with a bright speed ring chasing the
 * spin so it reads as a blurring wheel even at 4 frames. Same
 * rotate-a-finished-figure trick as the roll, just tighter and looping.
 *
 * This is the ORDINARY ride (overcharge / parts / bounces). Drinking the Ball
 * Form potion swaps to `knightSteelBallFrame` below — an actual metal sphere —
 * so the potion has a visual identity the everyday roll doesn't.
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

/**
 * STEEL BALL-FORM frame: the 🪩 Ball Form potion — you ARE the pinball, so you
 * are drawn as one. A mirror-polished chrome ball bearing, NOT the knight.
 *
 * Only used while `ironT > 0`. The ordinary overcharge ride keeps the spinning
 * knight above; this is what makes the potion feel like a transformation.
 *
 * What sells CHROME is reflection, not shading. A mirror ball is dominated by
 * what it reflects: a blown-out sky-lit crown, a hard dark horizon band, a
 * mirrored floor low down, and — the detail that reads as "polished" more than
 * any other — a razor-sharp SPECULAR with a tight bloom. The palette's steel
 * ramp (19-22) is built for it: the dark end leans warm-violet while the light
 * end stays icy, and that temperature spread is what separates metal from grey
 * plastic.
 *
 * `spin` rotates the reflection and banding only, so the silhouette stays
 * perfectly round while the surface visibly rolls.
 */
function knightSteelBallFrame(dir: Dir, spin: number, _weapon: WeaponId, look: KnightLook): FramePaint {
  const R = 21; // a touch bigger than the old 0.6-scaled figure — it has WEIGHT
  const cy = GROUND - R - 1; // resting on the floor line
  return (ctx) => {
    groundShadow(ctx, CX, GROUND + 3, 20);

    // ── Body: a MIRROR gradient with HARD stops, not a soft ramp. Polish is
    // about contrast — a chrome ball jumps from blown-out sky to near-black
    // horizon over a few pixels, where a satin/plastic ball blends smoothly.
    // Doubling up the stops at 0.34/0.36 and 0.52/0.55 is what buys that snap.
    const body = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    body.addColorStop(0, "#ffffff"); // blown-out sky reflection
    body.addColorStop(0.16, paletteCss(22));
    body.addColorStop(0.34, paletteCss(21));
    body.addColorStop(0.36, paletteCss(20)); // hard step — the polish tell
    body.addColorStop(0.52, paletteCss(19));
    body.addColorStop(0.55, "#181b24"); // near-black horizon band
    body.addColorStop(0.76, "#3d4454"); // cold slate, NOT the warm 19 — keeping
    body.addColorStop(0.9, paletteCss(20)); // the underside cold is what says
    body.addColorStop(1, paletteCss(21)); // STEEL rather than brass

    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // ── Equator band: the dark horizon line a chrome sphere always carries.
    // Rotating it with `spin` is what makes the ball read as ROLLING.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(CX, cy);
    ctx.rotate(spin * 0.5);
    ctx.fillStyle = "rgba(15, 17, 23, 0.5)";
    ctx.fillRect(-R, -2.5, R * 2, 5);
    // A second, thinner band a quarter turn on — two bands make the roll
    // direction unambiguous where one band is symmetric.
    ctx.fillStyle = "rgba(15, 17, 23, 0.26)";
    ctx.fillRect(-R, R * 0.42, R * 2, 3);
    // A bright REFLECTED streak riding between them: a mirror shows the room's
    // lit surfaces, not just its dark ones.
    ctx.fillStyle = "rgba(238, 241, 245, 0.34)";
    ctx.fillRect(-R, -R * 0.55, R * 2, 2.6);
    ctx.restore();

    // ── Bounce light: warm crescent low on the ball where the floor kicks
    // light back up. This is the single detail that stops it reading as a
    // flat grey circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.clip();
    // Kept SUBTLE on purpose: at 0.42 it flooded the lower half and the ball
    // read as brass, not steel. It only needs to hint that a floor exists.
    const bounce = ctx.createRadialGradient(CX, cy + R * 0.78, 1, CX, cy + R * 0.78, R * 0.62);
    bounce.addColorStop(0, "rgba(240, 166, 60, 0.17)"); // torch warmth off the floor
    bounce.addColorStop(1, "rgba(240, 166, 60, 0)");
    ctx.fillStyle = bounce;
    ctx.fillRect(CX - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // ── Specular: the loudest polish cue. A TIGHT blown-out core with a hard
    // edge (a mirror's highlight has almost no falloff — a soft blob reads as
    // satin) plus a wide low bloom for the glare, and a small secondary
    // catchlight from the opposite side that only a shiny surface would pick up.
    const hx = CX + Math.cos(spin) * R * 0.34;
    const hy = cy - R * 0.42 + Math.sin(spin) * R * 0.16;
    const glow = ctx.createRadialGradient(hx, hy, 0.5, hx, hy, R * 0.7);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.62)");
    glow.addColorStop(0.35, "rgba(255, 255, 255, 0.18)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hx, hy, R * 0.7, 0, Math.PI * 2);
    ctx.fill();
    // Hard core — near-zero falloff is what says MIRROR.
    const core = ctx.createRadialGradient(hx, hy, 0, hx, hy, 4.6);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.72, "#ffffff");
    core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(hx, hy, 4.6, 0, Math.PI * 2);
    ctx.fill();
    // Secondary catchlight, opposite side, small and cool.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(CX - Math.cos(spin) * R * 0.46, cy + R * 0.34, 4.2, 2.2, -spin * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = "#dfe8f5";
    ctx.fill();
    ctx.restore();

    // ── Crest tell: a thin equatorial STRIPE in the worn set's plume colour,
    // so you can still tell WHOSE ball this is in co-op (and which armor style
    // you're running). Drawn as a band that rolls with the ball rather than a
    // fixed dot — a dot read as a bug sitting on the sphere.
    const crest = STYLE_PAINTS[look.style ?? "iron"].plume;
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(CX, cy);
    ctx.rotate(spin * 0.5);
    ctx.globalAlpha = 0.75;
    // The ramp's HI tone by index, not `length - 1`: a Ramp may now carry a
    // fourth (bounce) entry, and "the last one" would silently become that.
    ctx.fillStyle = paletteCss(crest[2]);
    ctx.fillRect(-R, -R * 0.92, R * 2, 2.4);
    ctx.restore();

    // ── Rim: a cold bright arc along the top-left edge, the contact between
    // the sphere and the air. Keeps the silhouette crisp after the pixel crush.
    ctx.beginPath();
    ctx.arc(CX, cy, R - 0.8, Math.PI * 1.05, Math.PI * 1.75);
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(238, 241, 245, 0.9)";
    ctx.stroke();

    // ── Outline: the palette's ink, so it sits in the same world as every
    // other actor after quantize.
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = paletteCss(1);
    ctx.stroke();

    // ── Speed streak: a THIN arc hugging the ball, fading at both ends, so it
    // reads as motion blur coming off the metal. The old thick opaque ring sat
    // clearly detached from the sphere and looked like a handle bolted on.
    const sweep = 2.2;
    const streak = ctx.createLinearGradient(
      CX + Math.cos(spin) * (R + 3),
      cy + Math.sin(spin) * (R + 3),
      CX + Math.cos(spin + sweep) * (R + 3),
      cy + Math.sin(spin + sweep) * (R + 3),
    );
    streak.addColorStop(0, "rgba(238, 241, 245, 0)");
    streak.addColorStop(0.5, "rgba(238, 241, 245, 0.42)");
    streak.addColorStop(1, "rgba(238, 241, 245, 0)");
    ctx.beginPath();
    ctx.arc(CX, cy, R + 2.5, spin, spin + sweep);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = streak;
    ctx.stroke();
  };
}

// ══════════════════════════════════════════════════════════════════
// MARBLE BODIES — one sphere per MarbleMaterial.
//
// The material axis (entities/marble.ts) shipped its physics long before it
// had a body: all six drew the plain `ball` clip — the tucked knight — and were
// told apart only by the hue of their trail ghosts. You could not look at the
// ball and say what it was made of.
//
// These are PARAMETRIC, in the same spirit as the monster roster: one frame
// painter driven by a MarbleSkin, not six hand-copied spheres. `steelBallFrame`
// above is ~175 lines for a single material; six more of those would be a
// thousand lines of near-duplicate canvas code that drift apart the first time
// anyone tunes the lighting.
//
// What separates the six is the TREATMENT — the surface pass drawn clipped to
// the sphere and rotated by `spin`. The silhouette stays a perfect circle
// (that's what keeps it reading as a rolling ball); everything that says
// "diamond" or "lava" happens inside that circle.
// ══════════════════════════════════════════════════════════════════

/**
 * The surface pass. Each is a different answer to "why does this read as that
 * material?", and the answer is rarely the colour:
 *
 *   facet — hard flat planes meeting at sharp edges. A diamond has no curve.
 *   fluid — one continuous surface with an internal line that LAGS the spin.
 *   rough — no specular at all. Absence of highlight is what says stone.
 *   arc   — the body is dim and the ENERGY on it is bright, re-seeded per frame.
 *   void  — inverted lighting: darkest where the highlight should be.
 *   crust — dark plates with light leaking from BETWEEN them, not off them.
 */
type MarbleTreatment = "facet" | "fluid" | "rough" | "arc" | "void" | "crust";

interface MarbleSkin {
  treatment: MarbleTreatment;
  /** Body gradient top (lit) → bottom (grounded). Four stops, hard-ish steps. */
  ramp: [string, string, string, string];
  /** The rim arc — the silhouette read against a dark dungeon. */
  rim: string;
  /** Specular strength, 0..1. Zero is a legitimate value (stone). */
  gloss: number;
  /** Radius in px. Mass reads as SIZE before it reads as anything else. */
  r: number;
  /** Ground-shadow width multiplier — a boulder sits heavier than a droplet. */
  weight: number;
  /** The treatment's own colour: facet fringe, seam glow, filament, mote. */
  accent: string;
  /**
   * The catchlight's colour. NOT always white: a steel-white highlight on the
   * void body made shadow look like it had a hole punched in it, and on lava it
   * read as a cold blob sitting in the magma. What a surface returns is the
   * light it is MADE of.
   */
  spec: string;
}

/**
 * A palette entry as an rgba() string.
 *
 * EVERY colour in a marble skin goes through this, and that is load-bearing.
 * The first pass authored the skins in free-hand hex (#d8f6ff for diamond,
 * #6fc4e8 for water, #b06fe8 for shadow) and they looked right at 128px — but
 * the screen-space quantizer snaps every painted pixel to the 32-entry palette,
 * and this palette has no purple, no magenta, and a big ROT GREEN block at
 * 6-9. Pale cyans land on rot light; violets land on skin/leather brown. The
 * rendered contact sheet had a green water marble and a brown shadow marble.
 *
 * So the skins below are built out of the ramps the palette actually has:
 *   arcane 29-31  the only blue        → water, diamond's depths
 *   steel 19-22   19 is the ONLY violet → shadow's rim, diamond's highlights
 *   torch 14-18   the only warmth      → lava, storm's filaments
 *   stone 0-5     greys                → stone
 *   blood 10-13   the only hot pink    → the laser
 * Anything outside those is a colour this game cannot draw.
 */
function pc(i: number, a = 1): string {
  const hex = PALETTE_HEX[i];
  return `rgba(${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}, ${a})`;
}

export const MARBLE_SKINS: Record<MarbleMaterial, MarbleSkin> = {
  // 💎 Cut, not polished. Built on the STEEL highlights (21-22) with arcane
  // depths (29-31) — the palette's coldest, brightest ramp, which is as close
  // to "white fire" as 32 colours get.
  diamond: {
    treatment: "facet",
    ramp: [pc(22), pc(21), pc(31), pc(29)],
    rim: pc(22, 0.95),
    gloss: 1,
    r: 19,
    weight: 0.85,
    accent: pc(31),
    spec: pc(22),
  },
  // 💧 The arcane ramp IS the water ramp — 31 → 30 → 29 is the only blue this
  // game has. The highlight is steel 22 rather than a free white so it stays at
  // the cold end and cannot drift toward the rot greens on the snap.
  water: {
    treatment: "fluid",
    ramp: [pc(31), pc(30), pc(29), pc(1)],
    rim: pc(31, 0.9),
    gloss: 0.45,
    r: 20,
    weight: 0.9,
    accent: pc(22),
    spec: pc(22),
  },
  // 🪨 The stone ramp, straight. `gloss: 0` is deliberate and load-bearing: the
  // moment a rock gets a highlight it reads as a polished marble rather than a
  // chunk of the floor.
  stone: {
    treatment: "rough",
    ramp: [pc(5), pc(4), pc(3), pc(2)],
    rim: pc(5, 0.6),
    gloss: 0,
    r: 22,
    weight: 1.25,
    accent: pc(2),
    spec: pc(5),
  },
  // ⚡ A dim storm body so the FILAMENTS carry the whole read. Those are flame
  // core 18 — the palette's brightest warm, and the only entry that can pass
  // for white-hot electricity.
  storm: {
    treatment: "arc",
    ramp: [pc(20), pc(19), pc(29), pc(1)],
    rim: pc(18, 0.95),
    gloss: 0.6,
    r: 19,
    weight: 0.8,
    accent: pc(18),
    spec: pc(18),
  },
  // 🌑 "Glowing dark purple" — with a caveat worth stating plainly: this
  // palette HAS no purple. Steel dark 19 (0x544e63) is its only violet-leaning
  // entry, called "warm violet-slate" in the palette source. So the body is
  // void black 0/1 and the rim is 19 lifted by 20: against a near-black sphere
  // 19 reads as a violet glow, where a true purple simply snaps to skin-brown
  // and reads as mud — which is exactly what the first pass, authored at
  // #b06fe8, actually rendered.
  shadow: {
    treatment: "void",
    ramp: [pc(0), pc(1), pc(2), pc(19)],
    rim: pc(19, 1),
    gloss: 0.25,
    r: 20,
    weight: 0.7,
    accent: pc(20),
    spec: pc(20),
  },
  /**
   * 🔥 MAGMA UNDER BASALT. Rebuilt after a census of the crushed art, because
   * this body was not warm — it was BROWN:
   *
   *     lava  26:22.5%  27:17.5%  1:12.9%  0:10.1%  28:9.9%  24:5.4%  23:5.0%
   *
   * Leather shadow, leather dark, leather mid and two skin tones — over 60% of
   * the ball spent on the palette's WOODEN entries, with the torch ramp (the
   * only warmth there is) nowhere in the top seven. The old ramp put leather
   * shadow in the body's third stop and the old plates were painted `pc(26)`,
   * so the thing rendered as a varnished pinwheel and no amount of animating
   * the seams was going to fix a colour budget spent on furniture.
   *
   * Two rules now, and both are about CONTRAST rather than about warmth:
   *   · the crust is BASALT — void/outline/stone-dark, a cold near-black. Real
   *     cooled lava is grey-black; brown crust reads as mud, and worse, brown
   *     is only a few luma steps from the magma so nothing glowed against it.
   *   · every warm pixel the ball owns goes into the SEAMS, where it is doing
   *     the work of saying "there is molten rock inside this".
   *
   * The body ramp is what shows through the middle of the plate ring, so it
   * stays hot the whole way down: flame light → flame → flame dark → ember. It
   * no longer bottoms out in void, because a black bottom half is exactly what
   * made this ball look like a hole with a lamp in it.
   */
  lava: {
    treatment: "crust",
    ramp: [pc(17), pc(16), pc(15), pc(14)],
    rim: pc(16, 0.9),
    gloss: 0.35,
    r: 21,
    weight: 1.05,
    accent: pc(17),
    spec: pc(18),
  },
};

/**
 * Stable per-frame jitter. The atlas is painted once at boot, so `Math.random`
 * here would bake ONE arbitrary result and be untestable and unreproducible —
 * a floor that re-seeds differently across a reload is exactly the class of bug
 * the maze census gate exists to catch. This is a plain integer hash instead:
 * same (seed, i) always paints the same lightning bolt.
 */
function marbleJitter(seed: number, i: number): number {
  let h = (seed * 374761393 + i * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The treatment pass, drawn already clipped to the sphere and centred on it. */
function paintTreatment(ctx: CanvasRenderingContext2D, skin: MarbleSkin, spin: number, frame: number): void {
  const R = skin.r;
  const rnd = (i: number) => marbleJitter(frame * 97 + 1, i);

  switch (skin.treatment) {
    // ── FACET: flat planes from the centre out, alternating bright/dark so the
    // edges between them are visible. A gemstone is a POLYHEDRON — the giveaway
    // is that adjacent planes differ in tone with no blend between them.
    case "facet": {
      const n = 9;
      ctx.rotate(spin);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, a0, a1);
        ctx.closePath();
        // Facets facing "up-left" catch the light; the tone steps, never ramps.
        const face = Math.cos(a0 + Math.PI * 0.75);
        // OPAQUE, and each one an exact palette entry: a facet is a flat plane
        // of a single tone. Painting them as translucent washes over the body
        // generated exactly the mid-luminance blends the snap mis-routes.
        ctx.fillStyle = face > 0.45 ? pc(22) : face > -0.2 ? pc(21) : pc(29);
        ctx.fill();
      }
      // Prismatic fringe: white light splitting on two edges. Two hues only —
      // a full rainbow reads as an oil slick, not a diamond.
      for (let i = 0; i < 2; i++) {
        const a = ((i * 4 + 1) / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.lineWidth = 1.6;
        // The "prismatic" split, within what the palette can express: the only
        // two hues that survive next to a cold white are arcane 31 and the
        // violet end of steel 19. A literal rainbow snapped to rot green.
        ctx.strokeStyle = i === 0 ? pc(19, 0.75) : pc(31, 0.7);
        ctx.stroke();
      }
      // The girdle: a bright ring where a cut stone's widest edge sits.
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.58, 0, Math.PI * 2);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = pc(22, 0.6);
      ctx.stroke();
      break;
    }

    // ── FLUID: a single internal surface line. It LAGS the spin (×0.35) so the
    // body turns faster than its contents — the read that says "this is liquid
    // held in a ball" rather than "this is a blue marble".
    case "fluid": {
      ctx.save();
      ctx.rotate(spin * 0.35);
      // Meniscus: a shallow arc across the body with a bright top edge.
      ctx.beginPath();
      ctx.ellipse(0, R * 0.1, R * 0.92, R * 0.34, 0, 0, Math.PI * 2);
      ctx.fillStyle = pc(30);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, R * 0.1, R * 0.92, R * 0.34, 0, Math.PI, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = pc(22);
      ctx.stroke();
      ctx.restore();
      // Refracted caustic: the bright spot sits LOW. Light entering the top of
      // a clear sphere converges below its centre — putting it up top would
      // make it a reflection, and the ball would read as glass, not water.
      const cg = ctx.createRadialGradient(0, R * 0.42, 0, 0, R * 0.42, R * 0.5);
      cg.addColorStop(0, pc(22));
      cg.addColorStop(0.5, pc(22));
      cg.addColorStop(0.51, pc(22, 0));
      ctx.fillStyle = cg;
      ctx.fillRect(-R, -R, R * 2, R * 2);
      // Interior bubbles, drifting with the lagged rotation.
      for (let i = 0; i < 3; i++) {
        const a = spin * 0.35 + rnd(i) * Math.PI * 2;
        const d = R * (0.3 + rnd(i + 9) * 0.45);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 1.1 + rnd(i + 18) * 1.3, 0, Math.PI * 2);
        ctx.fillStyle = pc(22);
        ctx.fill();
      }
      break;
    }

    // ── ROUGH: craters and grain. Each pit is a dark ellipse with a LIT lip on
    // the side facing the light — that lip is what turns a dark smudge into a
    // dent, and without it the ball looks dirty rather than pitted.
    case "rough": {
      ctx.rotate(spin);
      for (let i = 0; i < 5; i++) {
        const a = rnd(i) * Math.PI * 2;
        const d = R * (0.18 + rnd(i + 5) * 0.62);
        const px = Math.cos(a) * d;
        const py = Math.sin(a) * d;
        const pr = 2.2 + rnd(i + 10) * 3.4;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = pc(2, 0.65);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, pr, Math.PI * 0.9, Math.PI * 1.85);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = pc(5, 0.5);
        ctx.stroke();
      }
      // Grain speckle — cheap, and it keeps the large flat mass from reading as
      // plastic after the palette quantizer flattens the gradient.
      for (let i = 0; i < 22; i++) {
        const a = rnd(i + 40) * Math.PI * 2;
        const d = R * Math.sqrt(rnd(i + 60)) * 0.95;
        ctx.fillStyle = rnd(i + 80) > 0.5 ? pc(5, 0.28) : pc(2, 0.35);
        ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, 1.4, 1.4);
      }
      // A chipped edge: one flat bitten out of the rim. A perfectly round rock
      // is a marble; the chip is what makes it look BROKEN off something.
      ctx.beginPath();
      ctx.moveTo(Math.cos(2.1) * R, Math.sin(2.1) * R);
      ctx.lineTo(Math.cos(2.8) * R, Math.sin(2.8) * R);
      ctx.lineTo(Math.cos(2.45) * R * 0.72, Math.sin(2.45) * R * 0.72);
      ctx.closePath();
      ctx.fillStyle = pc(1, 0.55);
      ctx.fill();
      break;
    }

    // ── ARC: filaments from the core to the rim, re-seeded per FRAME (not per
    // spin) so the lightning jumps rather than rotates. Electricity does not
    // roll with the ball, and animating it that way killed the effect.
    case "arc": {
      const bolts = 4;
      for (let b = 0; b < bolts; b++) {
        const a = rnd(b) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        const steps = 4;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const jit = (rnd(b * 8 + s) - 0.5) * 0.9 * (1 - t * 0.4);
          ctx.lineTo(Math.cos(a + jit) * R * t, Math.sin(a + jit) * R * t);
        }
        // Two passes: a wide dim glow, then a thin white-hot core inside it.
        ctx.lineJoin = "round";
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = pc(16, 0.45);
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = pc(18, 1);
        ctx.stroke();
      }
      // Core flare — the filaments have to come FROM something.
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
      core.addColorStop(0, pc(18, 0.85));
      core.addColorStop(0.5, pc(17, 0.35));
      core.addColorStop(1, pc(16, 0));
      ctx.fillStyle = core;
      ctx.fillRect(-R, -R, R * 2, R * 2);
      break;
    }

    // ── VOID: the inversion. A dark radial sits where every other body puts its
    // highlight, so the sphere absorbs the room's light instead of returning
    // it, and violet motes fall INWARD.
    case "void": {
      const hole = ctx.createRadialGradient(-R * 0.3, -R * 0.34, 0, -R * 0.3, -R * 0.34, R * 1.1);
      hole.addColorStop(0, pc(0, 0.95));
      hole.addColorStop(0.55, pc(1, 0.6));
      hole.addColorStop(1, pc(19, 0));
      ctx.fillStyle = hole;
      ctx.fillRect(-R, -R, R * 2, R * 2);
      // Inward motes: drawn as short streaks pointing at the centre, so the eye
      // reads them as being PULLED in rather than sitting on the surface.
      ctx.rotate(spin * 0.6);
      for (let i = 0; i < 7; i++) {
        const a = rnd(i) * Math.PI * 2;
        const d = R * (0.45 + rnd(i + 7) * 0.5);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
        ctx.lineTo(Math.cos(a) * (d - 3.5), Math.sin(a) * (d - 3.5));
        ctx.lineWidth = 1.3;
        ctx.lineCap = "round";
        ctx.strokeStyle = pc(20, 0.35 + rnd(i + 14) * 0.55);
        ctx.stroke();
      }
      break;
    }

    // ── CRUST: the glow is painted FIRST and the dark plates go over it, so the
    // light genuinely leaks from between them. Drawing seams as bright lines on
    // top instead gave a cracked rock with paint in the cracks.
    case "crust": {
      // The molten layer, painted FIRST and never covered completely. Hard
      // stops rather than a smooth ramp, for the reason the body gradient uses
      // them: every intermediate tone a soft ramp invents is a chance for the
      // luma-weighted snap to land it on skin-brown, which is measurably where
      // this ball's pixels used to go.
      //
      // It tops out at 17, NOT 18. Flame core is the palette's near-white, and
      // spending it on a broad disc gave a ball with a LIGHT BULB in it —
      // measured at played size, the crushed sprite read as a glowing orb with
      // a bite out of it rather than as cracked rock. 18 is now reserved for
      // things that are a few texels wide (the drip beads, the catchlight), so
      // the eye reads them as the hottest points instead of as the average.
      const molten = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      molten.addColorStop(0, pc(17));
      molten.addColorStop(0.42, pc(17));
      molten.addColorStop(0.43, pc(16));
      molten.addColorStop(0.78, pc(16));
      molten.addColorStop(0.79, pc(15));
      molten.addColorStop(1, pc(15));
      ctx.fillStyle = molten;
      ctx.fillRect(-R, -R, R * 2, R * 2);

      /**
       * THE PLATES — cooled basalt floating on the melt.
       *
       * Five, not seven, and each one a chunk of near-black rock: at 40px a
       * seven-spoke ring with thin gaps crushes into a pinwheel (which is
       * exactly what shipped), while five fat plates with wide fissures survive
       * the crush as recognisable ROCKS with light between them.
       *
       * The gap is per-plate and per-FRAME, so the fissures OPEN AND CLOSE as
       * the ball turns instead of rotating rigidly. That is the difference
       * between a spinning texture and a crust being pulled apart — the plates
       * ride a liquid, so their spacing cannot be constant.
       */
      ctx.save();
      ctx.rotate(spin);
      const plates = 5;
      for (let i = 0; i < plates; i++) {
        // 0.10 → 0.30 rad of fissure per side, breathing on the frame clock.
        const gap = 0.10 + rnd(i) * 0.12 + Math.abs(Math.sin(frame * 1.31 + i * 2.2)) * 0.08;
        const a0 = (i / plates) * Math.PI * 2 + gap;
        const a1 = ((i + 1) / plates) * Math.PI * 2 - gap;
        // How far the plate has sunk into the melt: a plate that sits proud
        // covers more of the glow than one that has foundered. Kept LOW (the
        // plates reach well in toward the centre) because the read this body
        // has to deliver is crust-with-seams; at 0.30+ the plates were a thin
        // outer ring and everything inside them was molten, which is a fireball.
        const inset = R * (0.16 + rnd(i + 5) * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, R - R * 0.06, a0, a1);
        ctx.arc(0, 0, inset, a1, a0, true);
        ctx.closePath();
        // BASALT, not leather. 0/1/2 are the palette's cold near-blacks; the
        // whole point of the crust is to be the dark thing the seams glow
        // against, and the old brown plates were too close to the magma in
        // luma for anything to read as glowing at all.
        ctx.fillStyle = i % 2 === 0 ? pc(1) : pc(2);
        ctx.fill();
        // The plate's own edge, catching its own light: cooled rock next to a
        // fissure is the hottest crust there is. One thin ember line, opaque —
        // a translucent stroke here is what generated the skin-brown mid-tones.
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = pc(14);
        ctx.stroke();
      }
      ctx.restore();

      /**
       * CRACKS ACROSS THE PLATES — hairlines of light that do not follow the
       * plate boundaries. Without them the crust is five clean shapes, and
       * cooling rock is never clean; it splits everywhere at once. Re-seeded
       * per frame so they flicker like something under tension.
       */
      ctx.save();
      ctx.rotate(spin);
      for (let i = 0; i < 4; i++) {
        const a = rnd(i + 20) * Math.PI * 2;
        const d0 = R * (0.34 + rnd(i + 24) * 0.2);
        const d1 = R * (0.72 + rnd(i + 28) * 0.24);
        const bend = (rnd(i + 32) - 0.5) * 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * d0, Math.sin(a) * d0);
        ctx.lineTo(Math.cos(a + bend * 0.5) * ((d0 + d1) * 0.5), Math.sin(a + bend * 0.5) * ((d0 + d1) * 0.5));
        ctx.lineTo(Math.cos(a + bend) * d1, Math.sin(a + bend) * d1);
        ctx.lineWidth = 1 + rnd(i + 36) * 0.8;
        ctx.lineCap = "round";
        ctx.strokeStyle = rnd(i + 40) > 0.45 ? pc(17) : pc(16);
        ctx.stroke();
      }
      ctx.restore();

      /**
       * THE MELT POOLS DOWN, and this is the term that says "this thing is
       * LIQUID inside" rather than "this thing is lit from within". The base of
       * the ball is where the heat collects, so it gets an opaque hot cap
       * whose upper edge WOBBLES per frame — a level line that held perfectly
       * still would read as a painted stripe.
       */
      ctx.beginPath();
      const lip = R * (0.48 + Math.sin(frame * 1.9) * 0.06);
      ctx.moveTo(-R, lip);
      for (let i = 0; i <= 6; i++) {
        const x = -R + (i / 6) * R * 2;
        ctx.lineTo(x, lip + Math.sin(frame * 2.1 + i * 1.3) * R * 0.05);
      }
      ctx.lineTo(R, R);
      ctx.lineTo(-R, R);
      ctx.closePath();
      ctx.fillStyle = pc(16);
      ctx.fill();
      // …and the hottest sliver right at the bottom, where the ball is in
      // contact with the floor it is melting. This is the tell that ties the
      // sprite to the molten scar it leaves behind.
      ctx.beginPath();
      ctx.ellipse(0, R * 0.74, R * 0.62, R * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = pc(17);
      ctx.fill();

      /**
       * DRIPS — molten strands running off the underside, one to three per
       * frame at different lengths, so the ball is visibly SHEDDING itself.
       * This is the single strongest "it is melting" cue available to a
       * silhouette that must stay a perfect circle: the drips live inside the
       * clip, hanging from the pool rather than escaping the rim.
       */
      for (let i = 0; i < 3; i++) {
        const dx = (rnd(i + 50) - 0.5) * R * 1.1;
        const len = R * (0.12 + rnd(i + 54) * 0.22);
        const top = R * 0.5;
        ctx.beginPath();
        ctx.moveTo(dx, top);
        ctx.lineTo(dx, top + len);
        ctx.lineWidth = 1.4 + rnd(i + 58) * 1.2;
        ctx.lineCap = "round";
        ctx.strokeStyle = pc(17);
        ctx.stroke();
        // The bead on the end — a drip is a blob on a thread, and the blob is
        // what survives the crush to 40px when the thread does not.
        ctx.beginPath();
        ctx.arc(dx, top + len, 1.2 + rnd(i + 62) * 0.9, 0, Math.PI * 2);
        ctx.fillStyle = pc(18);
        ctx.fill();
      }
      break;
    }
  }
}

/**
 * One frame of a marble body. `spin` rolls the surface; the silhouette is a
 * fixed circle. Shares `steelBallFrame`'s anatomy — shadow, body, treatment,
 * specular, rim, ink outline, speed streak — because they are the same object
 * made of different stuff, and having them diverge structurally would show up
 * as the ball changing SIZE when you picked a material up.
 */
function marbleFrame(skin: MarbleSkin, spin: number, frame: number): FramePaint {
  const R = skin.r;
  const cy = GROUND - R - 1; // resting on the floor line, like every ball clip
  return (ctx) => {
    groundShadow(ctx, CX, GROUND + 3, 19 * skin.weight);

    // ── Body: HARD-STOPPED bands, not a ramp. This is load-bearing, and it is
    // the same trick steelBallFrame uses ("doubling up the stops is what buys
    // that snap") — but here it fixes a colour bug, not just a style one.
    //
    // The palette snap is LUMA-WEIGHTED, so the green channel carries 0.587 of
    // the distance. A mid-luminance cyan is therefore matched mostly on its G
    // value, and the rot-green ramp (6-9) sits closer in G than the arcane ramp
    // it belongs to: a soft cyan gradient snapped 27% of the water marble onto
    // ROT GREEN, measured. Every intermediate tone a soft ramp invents is a
    // chance to land on the wrong ramp entirely.
    //
    // Doubling each stop collapses the blend regions to a pixel, so almost
    // every texel is one of the four authored palette colours and there is
    // nothing in between to mis-snap.
    const body = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    body.addColorStop(0, skin.ramp[0]);
    body.addColorStop(0.3, skin.ramp[0]);
    body.addColorStop(0.31, skin.ramp[1]);
    body.addColorStop(0.55, skin.ramp[1]);
    body.addColorStop(0.56, skin.ramp[2]);
    body.addColorStop(0.8, skin.ramp[2]);
    body.addColorStop(0.81, skin.ramp[3]);
    body.addColorStop(1, skin.ramp[3]);
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // ── Treatment, clipped to the sphere so nothing escapes the silhouette.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(CX, cy);
    paintTreatment(ctx, skin, spin, frame);
    ctx.restore();

    // ── Specular. Skipped entirely at gloss 0 — stone earns its dullness by
    // having no highlight at all, not a faint one.
    if (skin.gloss > 0) {
      // An OPAQUE cel highlight, not a translucent bloom. A soft white wash
      // over a saturated body is the single biggest generator of the
      // mid-luminance tones the luma-weighted snap misroutes — on water it was
      // worth several percent of the ball landing on rot green. It is also just
      // more correct for this art style: cel shading is flat shapes with hard
      // edges, and the specular is a shape like any other.
      const hx = CX + Math.cos(spin) * R * 0.3;
      const hy = cy - R * 0.44 + Math.sin(spin) * R * 0.14;
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, cy, R, 0, Math.PI * 2);
      ctx.clip();
      // Size carries the gloss instead of opacity: a matte-ish body gets a
      // small tight catchlight, a mirror gets a broad one.
      ctx.beginPath();
      ctx.ellipse(hx, hy, R * (0.16 + 0.2 * skin.gloss), R * (0.11 + 0.15 * skin.gloss), -0.5, 0, Math.PI * 2);
      ctx.fillStyle = skin.spec;
      ctx.fill();
      // A second, dimmer plate below it reads as the falloff a single flat
      // shape cannot express — two flat tones, not a gradient.
      if (skin.gloss > 0.4) {
        ctx.beginPath();
        ctx.ellipse(hx - R * 0.1, hy + R * 0.22, R * 0.14 * skin.gloss, R * 0.09 * skin.gloss, -0.5, 0, Math.PI * 2);
        ctx.fillStyle = pc(21);
        ctx.fill();
      }
      ctx.restore();
    }

    // ── Rim: the material's own colour along the top-left edge. This is the
    // single strongest identity cue at gameplay distance — at 1:1 the treatment
    // is a few pixels, but the rim outlines the whole ball.
    ctx.beginPath();
    ctx.arc(CX, cy, R - 0.8, Math.PI * 1.02, Math.PI * 1.78);
    ctx.lineWidth = 1.9;
    ctx.lineCap = "round";
    ctx.strokeStyle = skin.rim;
    ctx.stroke();

    // ── Outline in the palette's ink, so it shares a colour space with every
    // other actor after quantize.
    ctx.beginPath();
    ctx.arc(CX, cy, R, 0, Math.PI * 2);
    // Thicker than the steel ball's 1.6 on purpose: this ring is what the
    // anti-aliased silhouette edge blends INTO. Against transparency, a cold
    // body's fringe lands on the rot ramp under the luma-weighted snap; against
    // ink it lands on the body's own dark end.
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = paletteCss(1);
    ctx.stroke();

    // ── Speed streak, tinted by the material — the same motion-blur arc the
    // steel ball carries, so all seven balls read as one family.
    const sweep = 2.2;
    ctx.beginPath();
    ctx.arc(CX, cy, R + 2.5, spin, spin + sweep);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = skin.accent;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
}

/**
 * ⚡ LIGHTNING BOLT / ✨ LASER — the two RICOCHET FORMS.
 *
 * A COMPACT, RADIALLY SYMMETRIC CORE — deliberately not a beam.
 *
 * The first version drew each of these as a long streak lying along the x
 * axis, which was wrong in a way that only shows up in motion: an actor sprite
 * is a camera-facing billboard, so its art cannot rotate to face travel. A
 * painted beam therefore points east no matter which way the ball is actually
 * going, and at ricochet speed it visibly contradicts the path every second.
 *
 * The heading is now carried by the TRAIL RIBBON (fx/system.ts `trail`), which
 * is drawn from the ball's real path and is always correct. That frees the
 * sprite to be the one thing a billboard can honestly be: a bright object with
 * no orientation at all, travelling along that path.
 *
 * NOTE ON GLOW: the actor material runs `alphaTest: 0.5`, so anything painted
 * under half alpha is DISCARDED, not blended — a soft falloff halo would come
 * out as a hard-edged disc. The real glow is the additive, bloom-fed ribbon;
 * what the sprite contributes is a bright opaque core and a flare, which is
 * what survives the cutout.
 *
 * THE TWO ARE NOT THE SAME SIZE, and that is the point. The ⚡ bolt is a mass of
 * crackling light — a big star, wide discs, filaments. The ✨ laser is a DOT: a
 * small hot point with a tight four-arm sparkle and nothing else, because its
 * spectacle is not the ball, it is the zigzag chain of crosses the ball leaves
 * behind it (vfx `laserMark`). Painting the laser as big as the bolt buried
 * that chain under its own sprite — the ball has to be the smallest bright
 * thing on screen for the trail to be the effect.
 */
function ricochetFrame(kind: "bolt" | "laser", frame: number): FramePaint {
  const cy = GROUND - 26;
  // The bolt rides the torch ramp; the laser rides BLOOD 12-13, the only
  // saturated hot hue in the palette — there is no magenta to reach for.
  const glowC = kind === "bolt" ? 15 : 12;
  const bodyC = kind === "bolt" ? 17 : 13;
  const coreC = kind === "bolt" ? 18 : 22;
  const rnd = (i: number) => marbleJitter(frame * 131 + 7, i);
  // Pulse across the four frames so the core throbs instead of sitting static.
  const pulse = 1 + 0.16 * Math.sin((frame / 4) * Math.PI * 2);
  return (ctx) => {
    ctx.save();
    ctx.translate(CX, cy);

    // ── Outer flare: a symmetric star. Symmetric is the whole point — a shape
    // with a long axis would re-introduce the direction lie the streak had.
    // The laser gets FOUR short arms rather than the bolt's eight long ones:
    // a tight sparkle on a dot, not a corona.
    const spikes = kind === "bolt" ? 8 : 4;
    ctx.rotate((frame / 4) * Math.PI * 0.25); // slow spin, no preferred heading
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const len = (kind === "bolt" ? 15 : 9.5) * pulse * (0.72 + rnd(i) * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineWidth = kind === "bolt" ? 2.4 : 1.9;
      ctx.lineCap = "round";
      ctx.strokeStyle = pc(glowC);
      ctx.stroke();
    }

    // ── Body: two concentric opaque discs. Opaque because the cutout eats
    // anything softer, and two flat steps because that is how this game draws
    // falloff everywhere else. The laser's are roughly half the bolt's radius.
    // Sized by looking at the CRUSHED sheet, not the 128px cel: at played size
    // (scripts/marble-sheet.mjs, the @52/@40 columns) a 5.4px glow crushed to a
    // 2px smudge with no white left in it — a dot you lose, not a dot you
    // follow. 7/5/3.4 keeps a lit core pixel at 40px while still reading half
    // the bolt's size next to it.
    const rGlow = kind === "bolt" ? 10 : 7;
    const rBody = kind === "bolt" ? 7 : 5;
    const rCore = kind === "bolt" ? 4.2 : 3.4;
    ctx.beginPath();
    ctx.arc(0, 0, rGlow * pulse, 0, Math.PI * 2);
    ctx.fillStyle = pc(glowC);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, rBody * pulse, 0, Math.PI * 2);
    ctx.fillStyle = pc(bodyC);
    ctx.fill();

    // ── Core: blown out, and the brightest thing on screen. This is what the
    // bloom pass latches onto, so it is what makes the form read as GLOWING
    // rather than as a coloured ball.
    ctx.beginPath();
    ctx.arc(0, 0, rCore * pulse, 0, Math.PI * 2);
    ctx.fillStyle = pc(coreC);
    ctx.fill();

    if (kind === "bolt") {
      // Crackle: short filaments jumping off the core, re-seeded per frame so
      // it sputters. Drawn radially — again, no preferred direction.
      for (let b = 0; b < 3; b++) {
        const a = rnd(b + 20) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
        for (let k = 1; k <= 3; k++) {
          const aa = a + (rnd(b * 7 + k) - 0.5) * 1.1;
          const rr = 5 + k * 4.5;
          ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
        ctx.lineWidth = 1.3;
        ctx.lineJoin = "round";
        ctx.strokeStyle = pc(coreC);
        ctx.stroke();
      }
    }
    ctx.restore();
  };
}

/** The four frames of a ricochet form — authored once, shared by facing. */
export function ricochetFormFrames(kind: "bolt" | "laser"): FramePaint[] {
  return [0, 1, 2, 3].map((i) => ricochetFrame(kind, i));
}

/** The four rolling frames for one material — authored once, shared by facing. */
export function marbleBallFrames(m: MarbleMaterial): FramePaint[] {
  const skin = MARBLE_SKINS[m];
  return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((spin, i) => marbleFrame(skin, spin, i));
}

/** Build the full painter set for the knight holding `weapon`, dressed as `look`. */
export function makeKnightPaints(weapon: WeaponId, look: KnightLook = FULL_PLATE): ActorPaints {
  const ranged = WEAPONS[weapon].kind === "ranged";
  // A SPHERE looks the same from every angle, so the steel ball's four frames
  // are authored ONCE and the same FramePaint objects are handed to all three
  // facings. Building them per-direction produced 12 byte-identical frames and
  // pushed the atlas strip past the GPU's 8192px limit, which silently
  // downscales the whole sheet and blanks every sprite in the game.
  // Same reasoning for the six marble bodies: authored once, shared by facing.
  const marbleFrames: Record<MarbleMaterial, FramePaint[]> = {
    diamond: marbleBallFrames("diamond"),
    water: marbleBallFrames("water"),
    stone: marbleBallFrames("stone"),
    storm: marbleBallFrames("storm"),
    shadow: marbleBallFrames("shadow"),
    lava: marbleBallFrames("lava"),
  };
  const ricochetFrames = { bolt: ricochetFormFrames("bolt"), laser: ricochetFormFrames("laser") };
  const steelBallFrames: FramePaint[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((spin) =>
    knightSteelBallFrame("S", spin, weapon, look),
  );
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

    // ── ROLL: a 6-frame forward tumble — DIP, spin a full turn about the feet,
    // RISE. i-frames cover the front half (see player.ts); the spin is fastest
    // through the middle where the tuck is tightest.
    //
    // It was four frames, and all four were already mid-tumble: the knight
    // snapped from standing to fully balled and back again, so the roll had a
    // spin but no arc — the two poses a viewer needs in order to read WEIGHT
    // (the crouch that loads it, the rise that spends it) were the two that
    // weren't drawn. The entry and exit frames are barely tucked and unrotated,
    // which is what turns a spinning sprite into a body throwing itself forward.
    //
    // FPS_ROLL went 10 → 14 with the two extra frames, so the clip still covers
    // ROLL_DURATION (0.42s) — a roll animation that outlasts its i-frames is a
    // lie about how long you are safe. ──
    roll: [
      knightRollFrame(dir, 0, weapon, look, 0.96), // dip — load the tumble
      knightRollFrame(dir, 0.14, weapon, look),
      knightRollFrame(dir, 0.38, weapon, look),
      knightRollFrame(dir, 0.62, weapon, look),
      knightRollFrame(dir, 0.86, weapon, look),
      knightRollFrame(dir, 1, weapon, look, 0.94), // rise — spend it
    ],

    // ── EQUIP: the tavern gear-hoist — crouch, raise the weapon overhead
    // (the windup pose IS a hoist), plume flourish, settle. One-shot; played
    // by the walkable tavern when the armorer's counter closes on a purchase. ──
    equip: [
      F(dir, { bob: 2, stride: 0, atk: "windup", plumeLag: -1 }), // dip + grab
      F(dir, { bob: -2, stride: 0, atk: "windup", plumeLag: -2 }), // hoist high
      F(dir, { bob: -2.5, stride: 0, atk: "windup", plumeLag: 2 }), // hold the pose, plume whips
      F(dir, { bob: 0.5, stride: 0, plumeLag: 0.5 }), // settle to carry
    ],

    // ── FORGE: hammer strikes at the anvil — the held art is FORCED to the
    // mace so every weapon repairs with the same smith's hammer; the attack
    // hand tables already encode a good hammer arc. Two beats per play. ──
    forge: [
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: -1, stride: 0, atk: "windup", roll: 0.4, plumeLag: -1 }, "mace", look),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 1.5, stride: 0, atk: "strike", roll: -0.6, plumeLag: 1.5 }, "mace", look),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: -0.5, stride: 0, atk: "windup", roll: 0.3, plumeLag: -0.6 }, "mace", look),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 1.5, stride: 0, atk: "low", roll: -0.4, plumeLag: 1 }, "mace", look),
    ],

    // ── BALL: the pinball-overcharge form — a looping quarter-turn-per-frame
    // spin of the tucked figure with a chasing speed ring. ──
    ball: [
      knightBallFrame(dir, 0, weapon, look),
      knightBallFrame(dir, Math.PI / 2, weapon, look),
      knightBallFrame(dir, Math.PI, weapon, look),
      knightBallFrame(dir, (3 * Math.PI) / 2, weapon, look),
    ],

    // ── STEEL BALL: the 🪩 Ball Form potion only — an actual chrome sphere.
    // Kept as its own clip so the everyday overcharge ride above is untouched. ──
    steelball: steelBallFrames,

    // ── MARBLE BODIES: one per material, same reference-sharing trick as the
    // steel ball above (authored once outside dirClips, handed to all three
    // facings, deduped by buildSpriteSheet into 4 atlas frames apiece). ──
    diamondball: marbleFrames.diamond,
    waterball: marbleFrames.water,
    stoneball: marbleFrames.stone,
    stormball: marbleFrames.storm,
    shadowball: marbleFrames.shadow,
    lavaball: marbleFrames.lava,

    // ── RICOCHET FORMS: not a sphere at all — a bolt and a beam. ──
    boltform: ricochetFrames.bolt,
    laserform: ricochetFrames.laser,
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
  /**
   * 0..1+ sink into the legs, straight through to the rig's own `crouch`
   * channel. `dead` already used it internally; exposing it is what lets a
   * leaper's wind-up be a REAL coil (hips and shoulders drop, feet stay
   * planted) rather than the same standing pose in a different colour.
   */
  crouch?: number;
  dead?: boolean;
  /** True to draw red claw swipe slash arcs (ATTACKING row). */
  slash?: boolean;
  /** 0..1 intensity scale for claw slash arcs. */
  slashPower?: number;
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
  /**
   * Which ARM is a stump (null = both intact). Reads as battle-worn. "both" is
   * the FLAILER sub-type's silhouette — it bites because it cannot swing.
   */
  stump: "L" | "R" | "both" | null;
  /**
   * Which LEG is gone (null = both intact). Drives the zombie sub-type
   * silhouette (zombie-types.ts): a HOBBLER limps on one leg and a CRAWLER has
   * lost both, and neither stat story reads unless the art agrees with it.
   */
  legStump: "L" | "R" | "both" | null;
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
  // `rag` MUST be a leather index (26-28). Two variants used to reach outside
  // that band — one to stone dark (2) and one to arcane dark (29) — for
  // variety, and those two indices were the whole reason a cool grey-blue and a
  // slate tone appeared in a body whose vocabulary is flesh, cloth and ink.
  // Cloth variety comes from the leather ramp's own three steps; a zombie's
  // trousers are not made of stone.
  { skin: 7, rag: 26, gore: 1, stump: null, legStump: null, bandage: false, spur: "R", bone: "ribs", tatter: 22, seed: 1 },
  { skin: 8, rag: 27, gore: 2, stump: "L", legStump: null, bandage: false, spur: "R", bone: "skull", tatter: 0, seed: 2 },
  { skin: 6, rag: 28, gore: 3, stump: null, legStump: null, bandage: true, spur: "L", bone: "spine", tatter: 30, seed: 3 },
  { skin: 9, rag: 26, gore: 0, stump: "R", legStump: null, bandage: false, spur: "L", bone: "ribs", tatter: 14, seed: 4 },
  { skin: 7, rag: 27, gore: 2, stump: null, legStump: null, bandage: true, spur: null, bone: "skull", tatter: 34, seed: 5 },
  // ── SUB-TYPE silhouettes (zombie-types.ts) ──
  // ADDED, not substituted: the five above are the intact pool and still carry
  // the plurality of spawns. These exist so a Hobbler/Crawler/Flailer has art
  // matching its stat story — `variantIndicesFor` filters down to them.
  { skin: 8, rag: 26, gore: 2, stump: null, legStump: "L", bandage: true, spur: "R", bone: "ribs", tatter: 10, seed: 6 },
  { skin: 6, rag: 27, gore: 3, stump: null, legStump: "R", bandage: false, spur: "L", bone: "spine", tatter: 18, seed: 7 },
  { skin: 7, rag: 28, gore: 3, stump: null, legStump: "both", bandage: false, spur: "L", bone: "ribs", tatter: 6, seed: 8 },
  { skin: 9, rag: 28, gore: 3, stump: "both", legStump: null, bandage: false, spur: "R", bone: "skull", tatter: 26, seed: 9 },
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
 * THE SIX-COLOUR RULE.
 *
 * Measured on the shipped sprite: 28 distinct colours inside the ~420 opaque
 * pixels a zombie occupies at played size, spanning luma 13 to 204. A sprite of
 * that size in the era this art is aiming at uses five to eight, in two or
 * three clearly separated value groups. Twenty-eight is not detail — every one
 * of those details is about one pixel wide, so none of them RESOLVE; they only
 * add noise, and the figure reads as a busy smudge rather than as a corpse.
 *
 * So the body is allowed exactly this vocabulary:
 *
 *   rot shadow (6) · rot dark (7|8) · rot light (9)   — the flesh, 3 values
 *   cloth (v.rag)                                     — the rags, 1 value
 *   ink (1)                                           — the selout outline
 *   ONE accent                                        — the variant's mark
 *
 * `accentFor` is that last slot, and it is a CHOICE: a variant shows bone, or a
 * wound, or nothing. Previously a single zombie could carry bone ribs AND a
 * bone spur AND bone teeth AND a bone skull AND a red wound AND gore splatter
 * AND a bandage AND glowing eyes — eight bids for attention inside forty
 * pixels, which is why nothing won.
 */
type ZAccent = "bone" | "wound" | "none";

// ══════════════════════════════════════════════════════════════════
// FLAT MASSES — the zombie's own painting primitives.
//
// WHY THE ZOMBIE DOES NOT USE limbShaded/plateShaded.
//
// Those helpers auto-shade: every part they draw lays down a shade base, a
// selout ink, a mid fill, a warm rim along the top-left silhouette, and a
// cross-family bounce along the bottom-right. Five colours per part, chosen by
// the helper. That is exactly right for the knight, whose plate armour SHOULD
// have a specular rim and a bounce, and whose 10 parts of steel all resolve
// into the same two ramps.
//
// It is wrong for a corpse. Measured on the shipped sprite: 74 distinct colours
// inside the 1149 pixels a zombie occupies at its real 72px grid. Sprites of
// the era this art aims at use five to eight. No amount of removing DETAILS
// fixes that, because the count is structural — ten body parts × five
// helper-chosen colours is already seventy before a single accent is drawn.
//
// So the zombie paints FLAT MASSES with hand-placed shading: one fill, one
// shade band where the artist puts it, one ink. Three colours per part, from a
// ramp the caller controls, and the shade goes where the form turns rather than
// where a generic upper-left key implies. That is what pixel art actually is,
// and it is the only way to hold a six-colour budget.
//
// The palette these draw from is deliberately tiny — see ZPal.
// ══════════════════════════════════════════════════════════════════

/**
 * The zombie's entire colour vocabulary. Six entries, and nothing else may be
 * painted on the body.
 */
interface ZPal {
  /** Flesh: darkest, mid, lightest. The body is built from these three. */
  fleshDark: number;
  fleshMid: number;
  fleshLit: number;
  /** Cloth — trousers and the trailing rag. ONE value, not a ramp. */
  cloth: number;
  /** Selout outline. */
  ink: number;
  /** The variant's single accent (bone or wound), or -1 for none. */
  accent: number;
}

function zombiePal(v: ZVariant): ZPal {
  const r = zombieRamp(v);
  return {
    fleshDark: r[0],
    fleshMid: r[1],
    fleshLit: r[2],
    cloth: v.rag,
    ink: 1,
    // Bone is index 20, NOT the shared R_BONE's 22. Steel-white at luma 204 on
    // a rot-green body stopped being an accent and became the subject — 138px
    // of it on a ~420px figure, the largest non-flesh mass on the sprite.
    accent: accentFor(v) === "bone" ? 20 : accentFor(v) === "wound" ? 11 : -1,
  };
}

/**
 * A flat capsule limb: ink outline, flat fill, and ONE shade band along the
 * underside. No rim, no bounce, no gradient.
 *
 * The shade is a second capsule offset down-and-right and drawn narrower, which
 * leaves the fill showing along the top edge — a hand-placed two-tone tube
 * rather than five auto-generated bands.
 */
function zFlatLimb(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, fill: number, shade: number, ink: number): void {
  line(ctx, [[a[0], a[1]], [b[0], b[1]]], w + 3, C(ink));
  line(ctx, [[a[0], a[1]], [b[0], b[1]]], w, C(fill));
  line(ctx, [[a[0] + 1.5, a[1] + 2], [b[0] + 1.5, b[1] + 2]], w * 0.5, C(shade));
}

/** A flat polygon mass: ink outline, flat fill. Shading is the caller's job. */
function zFlatPoly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: number, ink: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = C(ink);
  ctx.stroke();
  ctx.fillStyle = C(fill);
  ctx.fill();
}

/** A flat ellipse mass: ink outline, flat fill. */
function zFlatEll(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: number, ink: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = C(ink);
  ctx.stroke();
  ctx.fillStyle = C(fill);
  ctx.fill();
}

/**
 * A shade band clipped INSIDE a shape that was already filled.
 *
 * This is the hand-placed half of the two-tone read: the caller says which
 * region of a mass is in shadow and the band lands only there. `pts` is the
 * clip (the mass), `band` the shadow region.
 */
function zShadeIn(ctx: CanvasRenderingContext2D, clip: Pt[], band: Pt[], shade: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clip[0][0], clip[0][1]);
  for (let i = 1; i < clip.length; i++) ctx.lineTo(clip[i][0], clip[i][1]);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(band[0][0], band[0][1]);
  for (let i = 1; i < band.length; i++) ctx.lineTo(band[i][0], band[i][1]);
  ctx.closePath();
  ctx.fillStyle = C(shade);
  ctx.fill();
  ctx.restore();
}

function accentFor(v: ZVariant): ZAccent {
  // Bone reads loudest (it is the biggest value jump available against green),
  // so it goes to the variants whose silhouette can carry it: skull and ribs.
  // Spine variants take the wound instead, and one variant per pool takes
  // nothing at all — a plain corpse makes the marked ones read as marked.
  if (v.bone === "skull") return "bone";
  if (v.bone === "ribs") return v.gore > 1 ? "wound" : "bone";
  return v.gore > 0 ? "wound" : "none";
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
  // WIDER and LOWER than before. The silhouette has to say "zombie" before any
  // colour does — that is what the era's sprites relied on, because at 40px
  // colour is four or five pixels and the outline is everything.
  //
  // shoulderW 17→20 against the same 7 hip is a 2.9:1 wedge (the knight is
  // ~1.9:1), so the two are unmistakable as blobs. torsoTop drops 54→50 and
  // headY 66→62: the whole mass sits lower and hunches harder, which is the
  // single most legible undead cue at any resolution.
  shoulderW: 20,
  hipW: 7,
  torsoTop: 50,
  hipY: 32,
  headY: 62,
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
  const pal = zombiePal(v);
  const tilt = dir === "E" ? 0.32 : 0.14;
  // The head keeps the SAME six-colour budget as the body: bone if this variant
  // wears its cranium bare, otherwise flesh. Two tones and an ink, flat.
  const bare = v.bone === "skull" && pal.accent === 20;
  const skFill = bare ? 20 : pal.fleshMid;
  const skShade = bare ? 19 : pal.fleshDark;
  // ── hanging mandible, drawn FIRST so the cranium overlaps its hinge ──
  // Offset forward and asymmetrically so it juts off the oval instead of
  // sitting inside it. Slightly narrower than the cranium = reads as a jaw.
  if (!dead) {
    const jx = dir === "E" ? x + 6 : x + 2;
    zFlatPoly(ctx, [[jx - 8, y + 4], [jx + 8, y + 4], [jx + 6, y + 18], [jx - 5, y + 20]], skShade, pal.ink);
  }

  // skull — a gaunt oval, flat, with the shade on the turning-away side
  zFlatEll(ctx, x, y, 12, 13, skFill, pal.ink, tilt);
  // The shade goes on the side turning AWAY from the light. In profile the head
  // faces +x, so the shaded side is the BACK of the skull (−x); head-on it is
  // the right cheek. Getting this backwards in profile put the shade on the
  // same side as the eye socket and the two merged into one hollow.
  const shadeBand: Pt[] =
    dir === "E"
      ? [[x - 14, y - 14], [x - 5, y - 14], [x - 6, y + 14], [x - 14, y + 14]]
      : [[x + 4, y - 14], [x + 14, y - 14], [x + 14, y + 14], [x + 2, y + 14]];
  zShadeIn(ctx, [[x - 13, y - 14], [x + 13, y - 14], [x + 13, y + 14], [x - 13, y + 14]], shadeBand, skShade);
  // The mangy scalp patch is gone: 6×4 cel px of shade tone sitting on top of
  // the cranium's own shade band, which at played size is one ambiguous pixel
  // that only softened the head's outline.

  if (dir === "N") {
    // back of the skull: a weeping wound + a couple of hair mats, no face
    zFlatEll(ctx, x + 2, y - 1, 4, 5, 11, pal.ink);
    line(ctx, [[x - 6, y - 6], [x - 4, y + 4]], 2, C(pal.fleshDark));
    return;
  }

  const ex = dir === "E" ? x + 4 : x;
  if (dead) {
    // x-ed out eyes
    line(ctx, [[ex - 7, y - 4], [ex - 2, y + 1]], 2.5, C(1));
    line(ctx, [[ex - 2, y - 4], [ex - 7, y + 1]], 2.5, C(1));
    if (dir === "S") {
      line(ctx, [[ex + 3, y - 4], [ex + 8, y + 1]], 2.5, C(1));
      line(ctx, [[ex + 8, y - 4], [ex + 3, y + 1]], 2.5, C(1));
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
    // PROFILE: the void has to leave a skull BEHIND it. `ex` is already x+4, so
    // a mass running ex-6..ex+8 spans x-2..x+12 across a 12-radius head — it ate
    // the cranium and the head rendered as a hollow "C" with no back to it, an
    // artifact only visible in the walk clip. Kept forward of centre and
    // narrower, it reads as a sunken eye socket in a skull that still exists.
    zFlatPoly(ctx, [[ex - 2, y - 5], [ex + 7, y - 4], [ex + 6, y + 6], [ex - 1, y + 5]], 1, 1);
  } else {
    zFlatPoly(ctx, [[ex - 9, y - 6], [ex + 9, y - 6], [ex + 8, y + 8], [ex - 8, y + 8]], 1, 1);
  }
  // Glowing pupils sunk INSIDE the void. Mismatched sizes — a symmetrical pair
  // reads as a face, a mismatched pair reads as a ruined one.
  // THE EYES ARE THE ONE BRIGHT THING ON THE HEAD, and they are the sprite's
  // focal point — a dark hollow face with two lit points is the whole read.
  //
  // SIZE IS MEASURED, NOT GUESSED. A first pass enlarged these on the reasoning
  // that they now carry the head alone, and that put 128 cel px of #f0a63c on a
  // ~420px figure — the crush then bled it into the surrounding dark as a warm
  // smear (#a9705a) that was the third most common colour on the sprite. Two
  // points of light have to stay POINTS: 2.6/2.2 lands each as roughly one
  // bright output pixel with a hot core, which is exactly what an eye should be
  // at this resolution.
  // In profile the socket now sits forward of centre (see the void mass above),
  // so the single visible eye moves with it or it lands on solid skull.
  if (dir === "E") figGlow(ctx, ex + 2, y - 1, 2.4, 16, 17);
  else {
    figGlow(ctx, ex - 5, y - 1, 2.6, 16, 17);
    figGlow(ctx, ex + 5, y - 1, 2.2, 16, 17);
  }
  // The bone tooth row is gone. Bone-white directly under two lit eyes put
  // three competing bright marks inside a head that is ~9 output pixels across,
  // and the teeth lost — they read as a pale smudge that filled in the jaw and
  // destroyed the hollow-face silhouette the void mass exists to create.
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
  const flesh = skin[1];
  // SIX COLOURS, and the body may use no others. See ZPal.
  const pal = zombiePal(v);
  const stumpL = v.stump === "L" || v.stump === "both";
  const stumpR = v.stump === "R" || v.stump === "both";

  // Lean the whole upper body forward around the feet (the shamble) — bigger in
  // profile where it reads, subtle head-on.
  const lean = (dir === "E" ? 1 : 0.45) * (0.5 + lurch * 4);
  const sk = buildSkeleton(d3, { bob, stride, lean, swing, roll, crouch: dead ? 0.4 : pose.crouch ?? 0 }, ZOMBIE_RIG);

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
  //
  // `legStump` amputates one or both. This is the silhouette half of the zombie
  // SUB-TYPE system (zombie-types.ts): a Hobbler limps on one leg and a Crawler
  // has lost both, and neither stat story reads unless the art agrees.
  const legGoneL = v.legStump === "L" || v.legStump === "both";
  const legGoneR = v.legStump === "R" || v.legStump === "both";
  // FLAT masses. `legShaded` paints a leg AND a boot, each with its own fill,
  // shade, rim and bounce — eight colours for two legs before anything else is
  // drawn. These are trousers over shanks: one cloth value, one flesh value,
  // one ink, and a shade band on the underside of each.
  const legPair: Array<[Pt, Pt, Pt, boolean]> =
    dir === "E"
      ? [
          [sk.hip, sk.kneeL, sk.footL, legGoneL],
          [sk.hip, sk.kneeR, sk.footR, legGoneR],
        ]
      : [
          [sk.hipL, sk.kneeL, sk.footL, legGoneL],
          [sk.hipR, sk.kneeR, sk.footR, legGoneR],
        ];
  legPair.forEach(([hip, knee, foot, gone], i) => {
    if (gone) {
      const cut: Pt = [hip[0] + (knee[0] - hip[0]) * 0.62, hip[1] + (knee[1] - hip[1]) * 0.62];
      zFlatLimb(ctx, hip, cut, 10, pal.cloth, pal.fleshDark, pal.ink);
      zFlatEll(ctx, cut[0], cut[1], 5, 4, 11, pal.ink);
      return;
    }
    // thigh in cloth, shank in flesh — the trouser ends mid-calf, which is one
    // more silhouette break and costs no extra colour.
    zFlatLimb(ctx, hip, knee, 10, pal.cloth, pal.fleshDark, pal.ink);
    zFlatLimb(ctx, knee, foot, 8, pal.fleshMid, pal.fleshDark, pal.ink);
    // A foot, flat. The far leg is drawn a step darker so the two read apart.
    zFlatEll(ctx, foot[0] + 1, foot[1] - 1, 6, 4, i === 0 ? pal.fleshMid : pal.fleshDark, pal.ink);
  });

  // ── torso — a hunched ribcage barrel ──
  // `backlight: 30` (arcane mid) rims the shadow side, exactly as the knight's
  // cuirass and helm do. It's nearly free and it's what stops the body fusing
  // into the dark floor — a green mass on a near-black floor has almost no
  // edge contrast without it.
  // FLAT, with the shade band placed by hand down the RIGHT third of the chest.
  //
  // `plateShaded` would give this five colours (shade base, ink, mid, warm rim,
  // bounce) and put the light where its generic upper-left key says. A torso is
  // the biggest single mass on the figure, so that one call was the largest
  // contributor to the 74-colour count. Two tones and an ink, with the shadow
  // where the ribcage actually turns away, reads as more sculpted and costs a
  // third as much.
  const t = zombieTorsoPts(sk, dir);
  zFlatPoly(ctx, t, pal.fleshMid, pal.ink);
  const tx = sk.chest[0];
  const ty = sk.chest[1];
  const hy2 = sk.hip[1] + 2;
  // Which side is in shadow depends on which way the body FACES. Head-on the
  // light comes from the upper left, so the right of the chest is dark. In
  // profile the figure faces +x and the shaded side is its BACK (−x) — using
  // the head-on band there shaded the chest and lit the spine, which read as a
  // very dark body with an oddly bright back edge.
  const torsoBand: Pt[] =
    dir === "E"
      ? [[tx - 14, ty - 12], [tx - 3, ty - 12], [tx - 4, hy2 + 6], [tx - 14, hy2 + 6]]
      : [[tx + 3, ty - 12], [tx + 26, ty - 12], [tx + 26, hy2 + 6], [tx + 1, hy2 + 6]];
  zShadeIn(ctx, t, torsoBand, pal.fleshDark);

  // ── exposed BONE ──
  // The old version drew ribs as three 1.8px arcs. At 128→52 that is 0.7 of a
  // pixel: they vanished completely, which is a large part of why the torso
  // crushed to a featureless quad. They are SOLID bone masses now — the only
  // value bright enough to separate the torso from the limbs after the crush.
  // ONE accent, not five. See accentFor: a variant shows bone OR a wound OR
  // neither, so the mark it does carry is the only bright thing on the body and
  // therefore actually reads at 44px.
  const accent = accentFor(v);
  if (accent === "bone") zombieBone(ctx, sk, dir, v, skin);
  else if (accent === "wound" && dir !== "N") {
    // A gut wound big enough to survive the crush. The old one was 5×4 cel px
    // — under two output pixels — and it competed with four other accents for
    // those two pixels. Alone and at this size it is a legible dark hole.
    zFlatEll(ctx, sk.chest[0] + 3, sk.hip[1] - 7, 8, 7, 11, 1);
  }
  // The bandage was a fifth competing value across the chest and never resolved
  // as cloth — it read as a light smear over the torso's only clean area.


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
    zombieArm(ctx, [sk.chest[0] + 2, sk.chest[1]], [sk.chest[0] + armReach + sw, armY - 6 - swing * 3 + droop], pal, stumpR);
    zombieArm(ctx, [sk.chest[0], sk.chest[1] + 4], [sk.chest[0] + armReach - 3 - sw, armY + 8 + swing * 3 + droop], pal, stumpL);
  } else if (dir === "S") {
    // Reaching toward the camera — but ASYMMETRICALLY. A symmetrical pair of
    // arms reads as a person standing; one arm hanging eight pixels lower than
    // the other, off a dropped shoulder, reads as a body that no longer holds
    // itself up. Asymmetry is the cheapest undead cue there is and it survives
    // any amount of downscaling, because it is a property of the OUTLINE.
    zombieArm(ctx, [sk.shoulderL[0], sk.shoulderL[1] + 5], [sk.shoulderL[0] - 7 - sw * 0.5, armY + 30 - sw + droop], pal, stumpL);
    zombieArm(ctx, sk.shoulderR, [sk.shoulderR[0] + 3 + sw * 0.5, armY + 20 + sw + droop], pal, stumpR);
  } else {
    // from behind: both droop outward
    zombieArm(ctx, sk.shoulderL, [sk.shoulderL[0] - 8 - sw * 0.5, armY + 26 - sw + droop], pal, stumpL);
    zombieArm(ctx, sk.shoulderR, [sk.shoulderR[0] + 8 + sw * 0.5, armY + 26 + sw + droop], pal, stumpR);
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
  // The spur is part of the BONE accent, not an extra one on top of it: a
  // wound-variant showing a bone spur is carrying two bright marks again, which
  // is the exact failure this pass exists to fix.
  if (v.spur && accent === "bone" && !dead && dir !== "N") {
    // In profile the spur always goes on the BACK of the shoulder (-x). On the
    // front side it collides with the forward-thrust head and the reaching
    // arms; off the back it juts into empty cel where nothing competes.
    const sd = dir === "E" ? -1 : v.spur === "L" ? -1 : 1;
    const sx = (sd < 0 ? sk.shoulderL : sk.shoulderR)[0];
    const sy = sk.shoulderL[1];
    // the torn flesh it punched through — a dark blood collar at the base
    zFlatEll(ctx, sx + sd * 2, sy + 2, 7, 5, 11, 1);
    zFlatPoly(ctx, [[sx - sd * 10, sy + 4], [sx - sd * 2, sy - 9], [sx + sd * 8, sy - 4], [sx + sd * 6, sy + 8]], 20, 1);
  }

  // Gore splatter is DEAD ART on a living zombie. Each speck is 1.6-4 cel px,
  // i.e. under one output pixel at played size, so a dozen of them contributed
  // nothing but a dozen more distinct colours to a sprite that already had too
  // many. It still runs on the DEATH frames, where the figure is bigger in the
  // frame and the stain is the point.

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
      zFlatPoly(ctx, [[c[0] - 4, c[1] - 2], [c[0] + 4, c[1] - 2], [c[0] + 3, sk.hip[1]], [c[0] - 3, sk.hip[1]]], 20, 1);
      for (let i = 0; i < 3; i++) line(ctx, [[c[0] - 5, c[1] + 4 + i * 7], [c[0] + 5, c[1] + 4 + i * 7]], 2.4, C(skin[0]));
    } else {
      line(ctx, [[c[0], c[1]], [c[0] - 1, sk.hip[1]]], 3, C(skin[0]));
    }
    return;
  }

  // Front / profile. Bone sits on the lit side so it catches the key light.
  // The profile torso spans c[0]−10 … c[0]+13, so an 18-wide rib plate centred
  // at c[0]+1 hangs off the front edge and the ribs read as white bars floating
  // beside the body rather than as bone showing THROUGH it. In profile the
  // plate is narrower and sits well inboard.
  const bx = dir === "E" ? c[0] - 1 : c[0] - 6;
  const bw = dir === "E" ? 6 : 9;
  if (v.bone === "ribs") {
    // A torn-open ribcage: one solid bone PLATE with dark gaps cut across it.
    // Carving gaps out of a light mass survives the crush; drawing light lines
    // on a dark mass does not (thin light strokes are the first thing to go).
    zFlatPoly(ctx, [[bx - bw, c[1] + 1], [bx + bw, c[1] + 3], [bx + bw - 2, c[1] + 21], [bx - bw + 1, c[1] + 19]], 20, 1);
    line(ctx, [[bx - bw, c[1] + 8], [bx + bw - 1, c[1] + 10]], 3.4, C(6)); // gap between ribs
    line(ctx, [[bx - bw, c[1] + 15], [bx + bw - 1, c[1] + 17]], 3.4, C(6));
  } else if (v.bone === "spine") {
    // A collarbone yoke — a broad bone band across the top of the chest.
    zFlatPoly(ctx, [[c[0] - 14, c[1] - 2], [c[0] + 14, c[1] - 2], [c[0] + 11, c[1] + 7], [c[0] - 11, c[1] + 7]], 20, 1);
    line(ctx, [[c[0], c[1] - 2], [c[0], c[1] + 7]], 3, C(6)); // sternal notch
  } else {
    // "skull" variants carry their bone up top; the torso gets a bare sternum
    // slab so there's still a light anchor at body height.
    zFlatPoly(ctx, [[bx - 5, c[1] + 3], [bx + 5, c[1] + 3], [bx + 4, c[1] + 20], [bx - 4, c[1] + 20]], 20, 1);
  }
}

/** A zombie arm shoulder→hand with a grasping claw or a bleeding stump. */
function zombieArm(ctx: CanvasRenderingContext2D, sh: Pt, hand: Pt, pal: ZPal, stump: boolean): void {
  if (stump) {
    const mid: Pt = [(sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2];
    zFlatLimb(ctx, sh, mid, 8, pal.fleshMid, pal.fleshDark, pal.ink);
    zFlatEll(ctx, mid[0], mid[1], 5, 5, 11, pal.ink); // bleeding stump cap
    return;
  }
  const elbow: Pt = [(sh[0] + hand[0]) / 2 + 1, (sh[1] + hand[1]) / 2 - 2];
  // Upper arm in the mid tone, forearm one step DARKER. A limb that recedes
  // from the body is a two-value read for free, and it means the elbow shows as
  // a value break rather than needing a drawn joint.
  zFlatLimb(ctx, sh, elbow, 8, pal.fleshMid, pal.fleshDark, pal.ink);
  zFlatLimb(ctx, elbow, hand, 7, pal.fleshDark, pal.fleshDark, pal.ink);
  // Grasping claw — TWO fat splayed fingers, not three thin ones. At 1.6px the
  // old fingers were well under one output pixel and the hand crushed to a
  // featureless dot; at 3.6px they clear the grid and the claw actually reads
  // as a claw. Fewer, bolder shapes is the whole lesson of the 128→52 crush.
  zFlatEll(ctx, hand[0], hand[1], 4.5, 4.5, pal.fleshMid, pal.ink);
  const dir = Math.sign(hand[0] - sh[0]) || 1;
  for (const i of [-1, 1]) {
    line(ctx, [[hand[0], hand[1]], [hand[0] + dir * 7, hand[1] + i * 5]], 3.6, C(pal.fleshDark));
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
  // The LEFT shoulder sits 5px lower than the right — the same dropped shoulder
  // the arms hang from, carried into the torso outline so the body reads as
  // lopsided in silhouette rather than as a symmetrical wedge with one odd arm.
  const sw = 18;
  return [[c[0] - sw, c[1] - 1], [c[0] + sw, c[1] - 6], [sk.hipR[0] + 3, hy], [sk.hipL[0] - 3, hy]];
}

/** Draw red claw trajectory slash arcs for zombie swipe attacks (matching Row 3 ATTACKING). */
function zombieClawSlash(ctx: CanvasRenderingContext2D, dir: Dir, power = 1.0): void {
  ctx.save();
  ctx.lineWidth = 2.4 * power;
  ctx.lineCap = "round";
  const cy = GROUND - 22;
  const colors = [C(11), C(12), C(13)]; // rich crimson blood-red shades
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = colors[i % colors.length];
    ctx.beginPath();
    const r = 24 + i * 5;
    if (dir === "E") {
      ctx.arc(58, cy + (i - 1) * 3, r, -Math.PI * 0.35, Math.PI * 0.22);
    } else if (dir === "S") {
      ctx.arc(64 + (i - 1) * 5, cy + 10, r * 0.8, Math.PI * 0.1, Math.PI * 0.9);
    } else {
      ctx.arc(64 + (i - 1) * 5, cy - 10, r * 0.8, Math.PI * 1.1, Math.PI * 1.9);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function zombieFrame(dir: Dir, pose: ZPose, v: ZVariant): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 25);
    // No global celShade — the rig parts are self-shaded along their ramps, so
    // the soft gradient would only muddy the clean bands (same call the knight
    // dropped). celShade stays on the brute/spitter overlays that draw extra art.
    zombieStanding(ctx, dir, pose, v);
    if (pose.slash) {
      zombieClawSlash(ctx, dir, pose.slashPower ?? 1.0);
    }
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
    // 1. impact recoil — head thrown back with blood spray burst (Row 4 frame 1)
    (ctx) => {
      groundShadow(ctx, 64, GROUND + 3, 25);
      zombieStanding(ctx, "S", { bob: -3, stride: 0, lurch: -0.2, swing: 0.8, dead: true }, v);
      goreSplatter(ctx, v, 64, GROUND - 32);
      celShade(ctx);
    },
    // 2. buckle — knees give, eyes go out
    (ctx) => {
      groundShadow(ctx, 64, GROUND + 3, 25);
      zombieStanding(ctx, "S", { bob: 8, stride: 0, lurch: 0.14, dead: true }, v);
      celShade(ctx);
    },
    // 3. fold — the whole figure pitches around the feet
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
    // 4. collapse — nearly flat, first blood
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
    // 5. the heap and the stain
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
  // ── The three SHARED telegraph clips ──────────────────────────────────
  //
  // Authored once, in the E profile, and handed to all three facings — the same
  // trick the steel ball uses (see atlas-size.test.ts), and here it is not an
  // optimisation, it is what makes the clips affordable at all.
  //
  // The zombie rig ships NINE cosmetic variant sheets, so every frame added to
  // it is nine frames of `crushToGrid` (72×72 pixels × a 32-entry palette
  // search, each) at boot AND nine bigger atlases, each of which every live
  // actor clones a texture from. Per-facing telegraph clips cost 39 frames a
  // variant; the first version of this shipped that and pushed the headless
  // boot past `playtest.mjs`'s wait, which is how it was caught.
  //
  // `wait` below is deliberately NOT shared: it is a LOOPING gait an actor
  // holds for as long as its pack is short-handed, and a stalker walking north
  // in its side profile is a bug you would see immediately. These three are
  // all under half a second, and the read is the silhouette's ARC, not which
  // way the face points.
  const crouchClip = [
    zombieFrame("E", { bob: -2, stride: 0, lurch: 0.12, crouch: 0.15, swing: -0.3, droop: -2 }, v),
    zombieFrame("E", { bob: 1, stride: 0, lurch: 0.28, crouch: 1.1, swing: -0.6, droop: -4, slash: true, slashPower: 0.6 }, v),
    zombieFrame("E", { bob: 2, stride: 0, lurch: 0.36, crouch: 1.6, swing: -0.8, droop: -6, slash: true, slashPower: 1.0 }, v),
  ];
  const wakeClip = wakeFrames(zombieFrame("E", { bob: 0, stride: 0.6, lurch: 0.22, swing: -0.6, droop: -3 }, v));
  const stumbleClip = stumbleFrames(zombieFrame("E", { bob: 1, stride: -0.2, lurch: 0.06, swing: 0.4, droop: 4 }, v));

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

    // ── CROUCH: the LEAPER's wind-up (the Flailer sub-type, and any family
    // that runs the policy). This is the one telegraph a player has to read
    // under pressure — LEAP_WINDUP is 0.45s and what follows is a 3.4× burst
    // along a locked arc — so the pose is built to be unmistakable in
    // SILHOUETTE, not in detail: the hips and shoulders sink hard while the
    // feet stay planted, the lean goes steep so the head drops below the
    // shoulder line, and the arms pull in. A figure that was upright a moment
    // ago is now a compressed wedge.
    //
    // Frame 0 rises slightly BEFORE the sink. That half-beat of anticipation is
    // what makes the coil read as a decision rather than as a dropped frame,
    // and it is the same trick the knight's attack windup uses.
    crouch: crouchClip,

    // ── WAIT: the PACK-HUNTER's stalk (the Midget sub-type). It is NOT
    // standing still — the policy shadows you at PACK_HOLD_RANGE at half speed
    // — so this is a gait, and it has to be distinguishable from the walk above
    // at a glance or the green tint is doing all the work.
    //
    // Everything about it is the walk's opposite: the walk is a lopsided
    // 6-beat step-DRAG with the arms hanging dead; this is an even 4-beat with
    // SHORT strides (|stride| <= 0.45 against the walk's 1.0), a permanent
    // half-crouch, a wide lateral sway and the arms held UP and forward
    // (negative droop) instead of trailing. A wary sidle, not a shamble.
    wait: [
      zombieFrame(dir, { bob: 1, stride: 0.45, lurch: lurchBase + 0.06, crouch: 0.55, swing: -0.45, roll: 0.9, droop: -3 }, v),
      zombieFrame(dir, { bob: 2.5, stride: 0, lurch: lurchBase + 0.1, crouch: 0.75, swing: 0, roll: 0.2, droop: -4 }, v),
      zombieFrame(dir, { bob: 1, stride: -0.45, lurch: lurchBase + 0.06, crouch: 0.55, swing: 0.45, roll: -0.9, droop: -3 }, v),
      zombieFrame(dir, { bob: 2.5, stride: 0, lurch: lurchBase + 0.1, crouch: 0.75, swing: 0, roll: -0.2, droop: -4 }, v),
    ],

    // ── WAKE / STUMBLE: whole-body displacements off a standing pose. See
    // wakeFrames/stumbleFrames — the ambusher's spring out of stillness and the
    // recoil off a staggering blow are arcs the silhouette travels, and both
    // want to apply to every family, not just this rig.
    wake: wakeClip,
    stumble: stumbleClip,
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
  (ctx) => {
    groundShadow(ctx, 64, GROUND + 2, 22);
    spiderBody(ctx, "S", { step: 0, bob: 12, dead: true });
    // pooled ichor
    ctx.beginPath(); ctx.ellipse(64, GROUND - 2, 20, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(7); ctx.fill();
    celShade(ctx);
  },
];

/** The giant-spider painter set. No variants (yet) — one menacing look. */
export function makeSpiderPaints(): ActorPaints {
  // Shared across facings — see the note in makeZombiePaints. A spider is
  // nearly radially symmetric anyway; its facing lives in the leg scissor.
  const crouchClip = [
    spiderFrame("E", { step: 0.5, bob: -2 }),
    spiderFrame("E", { step: 0.25, bob: 5 }),
    spiderFrame("E", { step: 0, bob: 8 }),
  ];
  const wakeClip = wakeFrames(spiderFrame("E", { step: 0.25, bob: 1 }));
  const stumbleClip = stumbleFrames(spiderFrame("E", { step: 0.5, bob: 2 }));
  const dirClips = (dir: Dir) => ({
    idle: [spiderFrame(dir, { step: 0, bob: 0 }), spiderFrame(dir, { step: 0.5, bob: 1 })],
    walk: [
      spiderFrame(dir, { step: 0, bob: 0 }),
      spiderFrame(dir, { step: 0.25, bob: 2 }),
      spiderFrame(dir, { step: 0.5, bob: 0 }),
      spiderFrame(dir, { step: 0.75, bob: 2 }),
    ],
    death: SPIDER_DEATH,
    attack: [
      spiderFrame(dir, { step: 0.25, bob: -3 }),
      spiderFrame(dir, { step: 0.75, bob: -5 }),
      spiderFrame(dir, { step: 0.5, bob: 0 }),
    ],
    // The HOUND runs the leaper policy on this sheet (spawn/factory.ts tints it
    // red). A spider has no hips to sink, so its coil is the body DROPPING onto
    // its legs — bob is positive-down here, so the abdomen settles toward the
    // floor while the legs stay planted, which is exactly a spider gathering.
    crouch: crouchClip,
    wake: wakeClip,
    stumble: stumbleClip,
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
const BRUTE_VARIANT: ZVariant = { skin: 6, rag: 26, gore: 2, stump: null, legStump: null, bandage: false, spur: null, bone: "ribs", tatter: 18, seed: 9 };
// The overlord (boss) is the brute drawn even bigger, with a jagged bone crown
// and blood-red glowing eyes so it reads as "the big one" at a glance.
const BOSS_VARIANT: ZVariant = { skin: 6, rag: 26, gore: 3, stump: null, legStump: null, bandage: false, spur: null, bone: "spine", tatter: 26, seed: 13 };

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
    if (dir === "E") {
      // PROFILE. The shoulders are edge-on here, so both pauldrons project onto
      // nearly the same x as the body (~64) — the 44/84 pair the head-on views
      // use left the far one hanging in open magenta, a detached blob beside the
      // brute at every side-facing angle. Far shoulder first, set back (-x) and
      // slightly higher so it reads as depth rather than as a second lump.
      ell(ctx, 57, sy - 3, 11, 9, F(7));
      poly(ctx, [[53, sy - 9], [58, sy - 17], [62, sy - 7]], F(22));
      ell(ctx, 68, sy, 13, 10, F(7));
      poly(ctx, [[64, sy - 6], [69, sy - 15], [74, sy - 4]], F(22));
    } else if (dir !== "N") {
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
    attack: [
      bruteFrame(dir, { bob: -3, stride: 0, lurch: lurch + 0.08 }, BOSS_SCALE_ART, true),
      bruteFrame(dir, { bob: 6, stride: 1, lurch: lurch - 0.05 }, BOSS_SCALE_ART, true),
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
const SPITTER_VARIANT: ZVariant = { skin: 8, rag: 27, gore: 1, stump: null, legStump: null, bandage: false, spur: "L", bone: "spine", tatter: 16, seed: 11 };

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
    attack: [
      ghostFrame(dir, { bob: -3, ripple: 1.5 }),
      ghostFrame(dir, { bob: 0, ripple: 4.5 }),
      ghostFrame(dir, { bob: 2, ripple: 6.0 }),
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
    attack: [
      reaperFrame(dir, { bob: -2, ripple: 1.0, sway: 2.0 }),
      reaperFrame(dir, { bob: 0, ripple: 3.0, sway: 3.5 }),
      reaperFrame(dir, { bob: 2, ripple: 5.0, sway: -1.0 }),
      reaperFrame(dir, { bob: 0, ripple: 0, sway: 0 }),
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

/** One bat frame. `flap` -1 (wings down) .. 1 (wings up). `deathStage` 0..3 */
function batFrame(dir: Dir, flap: number, deathStage?: number): FramePaint {
  return (ctx) => {
    if (deathStage !== undefined) {
      if (deathStage === 0) {
        // 0: Hit shock in air — wings splayed, eyes wide red glow
        const cy = 58;
        for (const side of [-1, 1]) {
          plateShaded(ctx, [[64 + side * 6, cy], [64 + side * 24, cy - 14], [64 + side * 12, cy + 8]], R_LEATHER, { rim: false });
        }
        ellShaded(ctx, 64, cy + 2, 9, 11, R_LEATHER);
        figGlow(ctx, 60, cy - 2, 2.5, 13, 13);
        figGlow(ctx, 68, cy - 2, 2.5, 13, 13);
        return;
      } else if (deathStage === 1) {
        // 1: Tumbling drop — wings folding, tilting down
        const cy = 76;
        groundShadow(ctx, 64, GROUND + 2, 18);
        ctx.save();
        ctx.translate(64, cy);
        ctx.rotate(0.5);
        for (const side of [-1, 1]) {
          plateShaded(ctx, [[side * 5, 0], [side * 18, -4], [side * 8, 8]], R_LEATHER, { rim: false });
        }
        ellShaded(ctx, 0, 0, 9, 11, R_LEATHER);
        ctx.restore();
        return;
      } else if (deathStage === 2) {
        // 2: Ground impact — wings hitting floor
        groundShadow(ctx, 64, GROUND + 2, 16);
        ellShaded(ctx, 64, GROUND - 10, 11, 7, R_LEATHER, 0.2);
        poly(ctx, [[70, GROUND - 10], [84, GROUND - 20], [76, GROUND - 8]], F(26));
        figDetail(ctx, [[58, GROUND - 11], [62, GROUND - 7]], 2, 1);
        figDetail(ctx, [[62, GROUND - 11], [58, GROUND - 7]], 2, 1);
        return;
      } else {
        // 3: Flat crumpled corpse on the floor
        groundShadow(ctx, 64, GROUND + 2, 14);
        ellShaded(ctx, 64, GROUND - 6, 10, 6, R_LEATHER, 0.2);
        poly(ctx, [[70, GROUND - 8], [84, GROUND - 26], [76, GROUND - 6]], F(26));
        figDetail(ctx, [[58, GROUND - 8], [62, GROUND - 4]], 2, 1); // x eye
        figDetail(ctx, [[62, GROUND - 8], [58, GROUND - 4]], 2, 1);
        return;
      }
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
    death: [batFrame(dir, 0, 0), batFrame(dir, 0, 1), batFrame(dir, 0, 2), batFrame(dir, 0, 3)],
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
    walk: [
      slimeFrame(dir, -0.6), // 0: gather tall before the jump
      slimeFrame(dir, 0.8),  // 1: squash flat as it springs forward
      slimeFrame(dir, -0.1), // 2: glide mid-air
      slimeFrame(dir, 0.4),  // 3: land and settle
    ],
    // melt on death: spreading into a wider, flatter puddle over 4 frames
    death: [
      slimeFrame(dir, 0.6, 0.15),
      slimeFrame(dir, 0.8, 0.4),
      slimeFrame(dir, 1.0, 0.7),
      slimeFrame(dir, 1.0, 1.0),
    ],
  });
  return { S: dirClips("S"), N: dirClips("N"), E: dirClips("E") };
}

// ══════════════════════════════════════════════════════════════════
// BUMPER GOBLIN, BRICK GOLEM, BOWLING PIN, CHOMPER, MAGNET, WEBSPINNER
// ══════════════════════════════════════════════════════════════════

const R_GOBLIN: Ramp = [15, 16, 17]; // warm rubber amber
const R_STONE: Ramp = [2, 3, 4]; // cold masonry
const R_PIN: Ramp = [20, 21, 22]; // cream/steel
const R_PLANT: Ramp = [7, 8, 9]; // rot-green stalk
const R_SILK: Ramp = [4, 21, 22]; // pale spider

/** BUMPER GOBLIN — a round rubbery amber imp; squash-stretch bounce. */
function goblinFrame(dir: Dir, squash: number, deathStage?: number): FramePaint {
  return (ctx) => {
    if (deathStage !== undefined) {
      if (deathStage === 0) {
        // 0: Hit stagger — tilted back, mouth gaping, eyes startled
        const cy = GROUND - 18;
        groundShadow(ctx, 64, GROUND + 2, 16);
        for (const s of [-1, 1]) limbShaded(ctx, [64 + s * 8, cy + 8], [64 + s * 12, GROUND], 4, R_GOBLIN);
        ellShaded(ctx, 62, cy, 22, 18, R_GOBLIN);
        for (const s of [-1, 1]) limbShaded(ctx, [62 + s * 14, cy - 4], [62 + s * 22, cy - 10], 4, R_GOBLIN);
        figDetail(ctx, [[58, cy - 4], [62, cy]], 2, 1);
        figDetail(ctx, [[62, cy - 4], [58, cy]], 2, 1);
        figDetail(ctx, [[68, cy - 4], [72, cy]], 2, 1);
        figDetail(ctx, [[72, cy - 4], [68, cy]], 2, 1);
        return;
      } else if (deathStage === 1) {
        // 1: Knee drop / flinch down
        const cy = GROUND - 13;
        groundShadow(ctx, 64, GROUND + 2, 18);
        for (const s of [-1, 1]) limbShaded(ctx, [64 + s * 10, cy + 6], [64 + s * 14, GROUND - 2], 4, R_GOBLIN);
        ellShaded(ctx, 64, cy, 24, 15, R_GOBLIN);
        for (const s of [-1, 1]) limbShaded(ctx, [64 + s * 16, cy], [64 + s * 22, cy + 4], 4, R_GOBLIN);
        figDetail(ctx, [[56, cy - 3], [60, cy + 1]], 2, 1);
        figDetail(ctx, [[60, cy - 3], [56, cy + 1]], 2, 1);
        figDetail(ctx, [[68, cy - 3], [72, cy + 1]], 2, 1);
        figDetail(ctx, [[72, cy - 3], [68, cy + 1]], 2, 1);
        return;
      } else if (deathStage === 2) {
        // 2: Faceplant / impact flattening
        groundShadow(ctx, 64, GROUND + 2, 20);
        ellShaded(ctx, 64, GROUND - 8, 23, 11, R_GOBLIN);
        figDetail(ctx, [[54, GROUND - 11], [60, GROUND - 6]], 2, 1);
        figDetail(ctx, [[60, GROUND - 11], [54, GROUND - 6]], 2, 1);
        figDetail(ctx, [[68, GROUND - 11], [74, GROUND - 6]], 2, 1);
        figDetail(ctx, [[74, GROUND - 11], [68, GROUND - 6]], 2, 1);
        return;
      } else {
        // 3: Flat collapsed corpse
        groundShadow(ctx, 64, GROUND + 2, 20);
        ellShaded(ctx, 64, GROUND - 6, 21, 8, R_GOBLIN); // splatted flat
        figDetail(ctx, [[53, GROUND - 9], [59, GROUND - 4]], 2, 1);
        figDetail(ctx, [[59, GROUND - 9], [53, GROUND - 4]], 2, 1);
        figDetail(ctx, [[69, GROUND - 9], [75, GROUND - 4]], 2, 1);
        figDetail(ctx, [[75, GROUND - 9], [69, GROUND - 4]], 2, 1);
        return;
      }
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
    death: [goblinFrame(dir, 0, 0), goblinFrame(dir, 0, 1), goblinFrame(dir, 0, 2), goblinFrame(dir, 0, 3)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** BOWLING PIN — tall cream pin with red neck stripes; wobble + topple. */
function pinFrame(dir: Dir, lean: number, deathStage?: number): FramePaint {
  return (ctx) => {
    if (deathStage !== undefined) {
      const angle = deathStage === 0 ? 0.35 : deathStage === 1 ? 0.75 : deathStage === 2 ? 1.1 : 1.3;
      const cy = deathStage === 3 ? GROUND - 6 : GROUND;
      groundShadow(ctx, 64, GROUND + 2, 12 + deathStage * 3);
      ctx.save();
      ctx.translate(64, cy);
      ctx.rotate(angle);
      if (deathStage === 3) {
        ellShaded(ctx, 0, 0, 9, 26, R_PIN);
      } else {
        plateShaded(ctx, [[-9, 0], [9, 0], [7, -18], [4, -26], [5, -34], [-5, -34], [-4, -26], [-7, -18]], R_PIN);
        ellShaded(ctx, 0, -38, 6, 7, R_PIN);
        line(ctx, [[-6, -30], [6, -30]], 3, F(12));
        line(ctx, [[-7, -25], [7, -25]], 3, F(12));
      }
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
    death: [pinFrame(dir, 0, 0), pinFrame(dir, 0, 1), pinFrame(dir, 0, 2), pinFrame(dir, 0, 3)],
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
function chomperFrame(dir: Dir, open: number, deathStage?: number): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 2, 18);
    if (deathStage !== undefined) {
      if (deathStage === 0) {
        // 0: Maw snaps shut hard, stalk shuddering
        plateShaded(ctx, [[52, GROUND], [76, GROUND], [72, GROUND - 12], [56, GROUND - 12]], R_LEATHER);
        limbShaded(ctx, [64, GROUND - 10], [62, GROUND - 32], 7, R_PLANT);
        plateShaded(ctx, [[54, GROUND - 40], [74, GROUND - 40], [68, GROUND - 30], [60, GROUND - 30]], R_PLANT);
        return;
      } else if (deathStage === 1) {
        // 1: Stalk bending 45 deg, drooping
        plateShaded(ctx, [[52, GROUND], [76, GROUND], [72, GROUND - 12], [56, GROUND - 12]], R_LEATHER);
        limbShaded(ctx, [64, GROUND - 10], [58, GROUND - 24], 7, R_PLANT);
        ellShaded(ctx, 52, GROUND - 26, 14, 9, R_PLANT, -0.4);
        return;
      } else if (deathStage === 2) {
        // 2: Head striking ground
        plateShaded(ctx, [[52, GROUND], [76, GROUND], [72, GROUND - 12], [56, GROUND - 12]], R_LEATHER);
        limbShaded(ctx, [64, GROUND - 8], [56, GROUND - 14], 8, R_PLANT);
        ellShaded(ctx, 50, GROUND - 16, 13, 8, R_PLANT, -0.2);
        return;
      } else {
        // 3: Wilted flat corpse
        limbShaded(ctx, [64, GROUND], [58, GROUND - 12], 8, R_PLANT);
        ellShaded(ctx, 54, GROUND - 14, 12, 8, R_PLANT);
        return;
      }
    }
    // Pot/root base, in LEATHER rather than the plant ramp (2026-07-31).
    plateShaded(ctx, [[52, GROUND], [76, GROUND], [72, GROUND - 12], [56, GROUND - 12]], R_LEATHER);
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
      for (const fx of [57, 64, 71]) {
        figDetail(ctx, [[fx, my - jaw + 2], [fx, my - jaw + 7]], 3.2, 22);
        figDetail(ctx, [[fx, my + jaw - 2], [fx, my + jaw - 7]], 3.2, 22);
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
    death: [chomperFrame(dir, 0, 0), chomperFrame(dir, 0, 1), chomperFrame(dir, 0, 2), chomperFrame(dir, 0, 3)],
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** MAGNET CRAWLER — a horseshoe magnet on skittering legs, poles arcing. */
function magnetFrame(dir: Dir, step: number, deathStage?: number): FramePaint {
  return (ctx) => {
    if (deathStage !== undefined) {
      const angle = deathStage === 0 ? 0.2 : deathStage === 1 ? 0.45 : deathStage === 2 ? 0.65 : 0.8;
      const cy = deathStage === 3 ? GROUND - 6 : 90 + deathStage * 3;
      groundShadow(ctx, 64, GROUND + 2, 16);
      ctx.save();
      ctx.translate(64, cy);
      ctx.rotate(angle);
      plateShaded(ctx, [[-14, -10], [-6, -10], [-6, 8], [6, 8], [6, -10], [14, -10], [14, 14], [-14, 14]], R_STEEL);
      if (deathStage < 2) {
        rrectShaded(ctx, -14, 6, 8, 8, 1, R_BLOOD);
        rrectShaded(ctx, 6, 6, 8, 8, 1, [29, 30, 31]);
      }
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
  const wakeClip = wakeFrames(magnetFrame("E", 1)); // shared across facings
  const stumbleClip = stumbleFrames(magnetFrame("E", 0.3));
  const dc = (dir: Dir) => ({
    idle: [magnetFrame(dir, 0.3), magnetFrame(dir, -0.3)],
    walk: [magnetFrame(dir, 1), magnetFrame(dir, -1)],
    death: [magnetFrame(dir, 0, 0), magnetFrame(dir, 0, 1), magnetFrame(dir, 0, 2), magnetFrame(dir, 0, 3)],
    // The SAPPER runs the ambusher policy on this sheet. Its whole tell is that
    // it never moved — so the spring out of that stillness is the only frame
    // the player gets, and it has to be a big one.
    wake: wakeClip,
    stumble: stumbleClip,
  });
  return { S: dc("S"), N: dc("N"), E: dc("E") };
}

/** WEB SPINNER — a bloated pale spider with a silk-sac abdomen. */
function webspinnerFrame(dir: Dir, legPh: number, rear = 0, deathStage?: number): FramePaint {
  return (ctx) => {
    if (deathStage !== undefined) {
      groundShadow(ctx, 64, GROUND + 2, 18);
      if (deathStage === 0) {
        // 0: Hit shudder, legs curling upward
        const cy = 92;
        for (const s of [-1, 1]) {
          for (let l = 0; l < 4; l++) {
            figDetail(ctx, [[64, cy], [64 + s * (12 + l * 3), cy - 14], [64 + s * (16 + l * 4), cy - 6]], 2, 1);
          }
        }
        ellShaded(ctx, 64, cy + 2, 16, 14, R_SILK);
        ellShaded(ctx, 64, cy - 10, 10, 8, R_SILK);
        return;
      } else if (deathStage === 1) {
        // 1: Body sinking, legs folding in
        const cy = 97;
        for (const s of [-1, 1]) {
          for (let l = 0; l < 3; l++) {
            figDetail(ctx, [[64, cy], [64 + s * (10 + l * 3), cy - 8], [64 + s * (14 + l * 3), GROUND]], 2, 1);
          }
        }
        ellShaded(ctx, 64, cy, 15, 11, R_SILK);
        return;
      } else if (deathStage === 2) {
        // 2: Flat impact, legs splaying out
        ellShaded(ctx, 64, GROUND - 7, 15, 9, R_SILK);
        for (const s of [-1, 1]) for (let l = 0; l < 3; l++) figDetail(ctx, [[64, GROUND - 7], [64 + s * (10 + l * 4), GROUND - 3]], 1.6, 2);
        return;
      } else {
        // 3: Flat curled corpse
        ellShaded(ctx, 64, GROUND - 5, 14, 7, R_SILK);
        for (const s of [-1, 1]) for (let l = 0; l < 3; l++) figDetail(ctx, [[64, GROUND - 5], [64 + s * (12 + l * 4), GROUND - 2]], 1.6, 2);
        return;
      }
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
    death: [webspinnerFrame(dir, 0, 0, 0), webspinnerFrame(dir, 0, 0, 1), webspinnerFrame(dir, 0, 0, 2), webspinnerFrame(dir, 0, 0, 3)],
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
 * ✨ THE LASER FLASK — the one potion that had no sprite at all.
 *
 * It could not be found, bought or brewed, so nothing ever needed to draw it;
 * and because `createStaticSprite(ITEM_PAINTS[id])` has no guard, putting it in
 * a supply table without this would not have been a missing icon — it would
 * have been the black-screen-with-a-working-HUD failure this file's ITEM_PAINTS
 * comment already describes ("e is not a function", the whole floor build dead).
 *
 * ── WHY IT IS NOT JUST `potionItem(pink)` ──
 * Two reasons, and they are the same reason.
 *
 * There is NO MAGENTA in this palette. `POTIONS.laser.color` was 0xff5ad0, a
 * free hex, and the snap is luma-weighted: shot on a real adapter the laser's
 * own VFX at that value came out STEEL GREY, which is why
 * `entities/ricochet-form.ts` moved the form onto blood 12/13 — the only
 * saturated hot hue there is. A flask following it would then be `potionItem`
 * with health's liquid, i.e. a HEALTH FLASK, and "the red one" already means
 * hearts to anyone who has played five minutes.
 *
 * So it borrows the vessel and diverges where the FORM diverges: the liquid is
 * blood MID (a step under health's), the core is blown out to steel highlight
 * instead of the warm flame core every other brew glows with, and four short
 * arms punch out of that core — the same 4-spike sparkle `ricochetFrame` draws
 * around the ball while you ARE the laser (`spikes = 4`, against the bolt's 8).
 * The thing on the floor is the thing you become.
 *
 * The arms stay INSIDE the glass on purpose: `gui/icons.ts` reframes an icon to
 * its opaque bounding box, so a star poking out of the vessel would shrink the
 * flask itself in every chip that draws it.
 */
function laserItem(): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, 104, 18);
    rrect(ctx, 59, 60, 10, 12, 2, F(2)); // glass neck
    rrect(ctx, 58, 54, 12, 8, 2, F(27)); // cork
    ell(ctx, 64, 88, 17, 17, F(2)); // glass
    // Liquid, clipped to the body exactly as potionItem does it.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(64, 88, 13, 13, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = C(11); // blood DARK — see the value note below
    ctx.fillRect(48, 84, 32, 20);
    // ── THE STAR, and it is sized off the 40px view, not the 128px cel.
    //
    // The first cut was blood MID liquid with two short 13-coloured arms, and at
    // played size it read as "a slightly darker health potion" — which is the
    // one thing this sprite must not be. Both flasks are red at 18px, so hue
    // cannot be doing the work: the separation has to be VALUE (the tight-palette
    // lesson from the white-beard-vs-chainmail pass). Blood dark under a
    // steel-HIGHLIGHT star is the widest value gap this palette can put inside a
    // flask, and it survives the crush because both ends are exact entries.
    //
    // Four arms, diagonal (the vertical/horizontal axes are where every flask's
    // glass glint already lives), reaching nearly the full liquid radius — the
    // same 4-spike sparkle `ricochetFrame` draws around the ball while you ARE
    // the laser, against the bolt's eight.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
      line(ctx, [[64, 90], [64 + Math.cos(a) * 11, 90 + Math.sin(a) * 11]], 3, F(22));
    }
    ctx.restore();
    // Core: blown out to STEEL HIGHLIGHT, not the flame core every other brew
    // glows with. This is the pixel the bloom pass latches onto, and it is what
    // says "light", not "medicine".
    ell(ctx, 64, 90, 4, 4, F(22));
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

/** A dropped REAGENT — a small faceted gem in the material's colour, so the
 * kind reads at a glance on the floor (reagents.ts). One factory, tinted. */
function gemItem(hex: string): FramePaint {
  const facet: Array<[number, number]> = [[64, 60], [80, 78], [64, 100], [48, 78]];
  return (ctx) => {
    groundShadow(ctx, 64, 100, 15);
    ctx.beginPath();
    ctx.moveTo(facet[0][0], facet[0][1]);
    for (const [x, y] of facet.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = hex;
    ctx.fill();
    // Top facet highlight.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(64, 60);
    ctx.lineTo(72, 76);
    ctx.lineTo(64, 84);
    ctx.lineTo(56, 76);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Dark rim for the cel outline.
    ctx.strokeStyle = "#00000066";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(facet[0][0], facet[0][1]);
    for (const [x, y] of facet.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.stroke();
    celShade(ctx);
  };
}

export const ITEM_PAINTS: Record<string, FramePaint> = {
  // Dropped modifier cards, one per CardId, tinted by rarity (see cards.ts).
  ...Object.fromEntries(CARD_IDS.map((id) => [id, cardItem(RARITY_HEX[CARDS[id].rarity])])),
  // DERIVED from the weapon table, not hand-listed. A hand-written list silently
  // omitted three new weapons; the decorator then spawned one as a ground pickup,
  // ITEM_PAINTS[id] came back undefined, and the floor build died with
  // "e is not a function" — a BLACK SCREEN with a working HUD, because the
  // whole level failed to construct. ITEM_PAINTS is an untyped object literal,
  // so nothing caught it at compile time. Generating the entries makes adding a
  // weapon a one-line change that cannot forget its ground sprite.
  ...Object.fromEntries((Object.keys(WEAPONS) as WeaponId[]).filter((id) => id !== "fists").map((id) => [id, groundWeapon(id)])),
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
  // ✨ laser is the exception and has its own painter: see laserItem().
  laser: laserItem(),
  ballform: potionItem("#f0a63c"),
  freeze: potionItem("#bfe8ff"),
  multiball: potionItem("#b06fe8"),
  curveshot: potionItem("#6fd0e8"),
  magnetboots: potionItem("#a83244"),
  // Craft brews that can land on the belt but never on the floor still take a
  // flask sprite for HUD icon fallbacks (renderPaintIcon reads ITEM_PAINTS).
  regen: potionItem("#8fd46b"),
  venomcoat: potionItem("#a83fd0"),
  stoneskin: potionItem("#9a8f77"),
  static: potionItem("#f0e05a"),
  greed: goldIdolItem(),
  elixir: potionItem("#ff8fae"),
  // Dropped reagents — one gem per material, tinted by its colour (reagents.ts).
  ...Object.fromEntries(REAGENT_IDS.map((id) => [id, gemItem(REAGENTS[id].color)])),
  // Marble materials — a polished gem/orb per material (see entities/marble.ts).
  diamond: gemItem("#6fd0e8"),
  water: gemItem("#2e6d8f"),
  stone: gemItem("#6b7688"),
  storm: gemItem("#f0e05a"),
  shadow: gemItem("#3a2a55"),
  lava: gemItem("#f0a63c"),
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

  // ── WIZARD BODY & ROBES (Purple & Gold) ──
  // Striped wizard trousers & pointed curly boots
  limb(ctx, 50, 92, 46, 110, 10, F(30)); // purple trousers
  limb(ctx, 66, 92, 70, 110, 10, SH(30, 0.35));
  rrect(ctx, 36, 105, 20, 10, 3, F(1), INK); // curled boots
  rrect(ctx, 60, 105, 20, 10, 3, F(1), INK);

  // Wizard frock coat with gold buttons and ornate tails
  poly(ctx, [[40, 56], [78, 56], [86, 98], [32, 98]], F(29)); // rich purple velvet
  poly(ctx, [[46, 58], [62, 60], [60, 94], [44, 94]], F(16)); // gold waistcoat
  poly(ctx, [[62, 60], [72, 58], [74, 94], [60, 94]], SH(16, 0.3));
  for (const by of [66, 74, 82]) ell(ctx, 59, by, 1.8, 1.8, F(18)); // gold buttons
  rrect(ctx, 42, 90, 34, 6, 2, F(27)); // buckle belt

  // ── HEAD, WILD HAIR & MANIC EXPRESSION ──
  // Wild white/silver hair puffing out
  ell(ctx, 44, 38, 12, 10, F(22)); // wild left hair puff
  ell(ctx, 74, 38, 12, 10, F(22)); // wild right hair puff
  ell(ctx, 59, 39, 13, 12, F(24)); // skin face
  ell(ctx, 54, 36, 3, 3.5, F(22)); // wide manic eye whites
  ell(ctx, 64, 36, 3, 3.5, F(22));
  ell(ctx, 55, 36, 1.5, 1.8, F(1)); // dark pupils
  ell(ctx, 65, 36, 1.5, 1.8, F(1));
  line(ctx, [[51, 46], [67, 46]], 2, F(1)); // wide wicked grin
  poly(ctx, [[48, 48], [70, 48], [63, 62], [55, 62]], F(22)); // eccentric wizard goatee

  // ── CROOKED TALL TOP HAT (Mad Hatter Style) ──
  // Hat brim resting angled on head
  poly(ctx, [[30, 30], [88, 24], [86, 31], [28, 37]], F(1), INK);
  poly(ctx, [[32, 29], [86, 23], [84, 28], [30, 34]], F(29)); // hat brim top
  // Hat crown — tall and flaring outward at the top
  poly(ctx, [[39, 28], [77, 24], [84, 5], [33, 9]], F(30), INK);
  poly(ctx, [[41, 27], [75, 23], [82, 6], [35, 10]], F(29));
  // Hatband with tarot/playing cards tucked in
  poly(ctx, [[39, 28], [77, 24], [78, 20], [40, 24]], F(16)); // gold sash band
  poly(ctx, [[46, 24], [54, 23], [52, 14], [44, 15]], F(22)); // white card (Ace of Spades)
  poly(ctx, [[54, 23], [62, 22], [60, 13], [52, 14]], F(8)); // 10/6 ticket / tarot card
  ell(ctx, 48, 19, 1.5, 1.5, F(1)); // spade pip

  // ── ARMS & HAT REACH / REVEAL ──
  // Left arm reaching deep into a second inverted top hat in hand
  limb(ctx, 42, 60, 26, 76, 9, F(29));
  limb(ctx, 76, 60, 92, 70, 9, F(29));
  ell(ctx, 24, 78, 6, 6, F(24)); // hands
  ell(ctx, 94, 72, 6, 6, F(24));

  // The inverted trick hat held out in front
  poly(ctx, [[78, 72], [108, 68], [112, 94], [82, 98]], F(1), INK);
  poly(ctx, [[80, 71], [106, 67], [110, 92], [84, 96]], F(30));
  poly(ctx, [[74, 71], [112, 66], [110, 74], [72, 79]], F(29)); // brim
  // Magical wares floating out of the hat with sparkles!
  ell(ctx, 92, 60, 4, 6, F(31)); // glowing blue potion bottle
  ell(ctx, 102, 58, 4, 5, F(13)); // red elixir
  ell(ctx, 98, 48, 3, 3, F(18)); // floating gold spark
  ell(ctx, 88, 52, 2.5, 2.5, F(31)); // arcane mote

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
