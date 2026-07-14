/**
 * THE CEL ART — smooth vector-drawn frames (2026-07-14: "make the sprites cel
 * shaded instead of this pixel look").
 *
 * Every frame is a PAINTER: a function that draws one 128×128 cel with plain
 * canvas-2D paths. The style is classic cel shading, produced by three layers:
 *
 *   1. flat palette fills with dark ink outlines (fill + stroke per shape),
 *   2. one hard-stop gradient composited `source-atop` over the finished
 *      figure — an abrupt highlight band (upper-right) and shadow band
 *      (lower-left) across every shape at once. Hard stops = flat bands,
 *      which is what makes it read as cel rather than airbrush,
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
import { paletteCss } from "./palette";
import { SPRITE_PX } from "../constants";
import { WEAPONS, type WeaponId } from "../items";

export type FramePaint = (ctx: CanvasRenderingContext2D) => void;
export type Dir = "S" | "N" | "E";
export type ClipName = "idle" | "walk" | "attack" | "death";
export type ActorPaints = Record<Dir, Partial<Record<ClipName, FramePaint[]>>>;

const PX = SPRITE_PX; // 128 — all coordinates below live in this box
const C = paletteCss;
const INK = C(1);
const INK_W = 3;

// ── Draw helpers — every solid shape gets an ink outline ────────

function ell(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function poly(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = INK_W;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** An outlined capsule limb from (x1,y1) to (x2,y2). */
function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, fill: string): void {
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w + INK_W * 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w;
  ctx.strokeStyle = fill;
  ctx.stroke();
}

/** Un-outlined detail stroke (ribs, string, cracks). */
function line(ctx: CanvasRenderingContext2D, pts: Array<[number, number]>, w: number, color: string): void {
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
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
 * The cel-shading pass: one highlight band + one shadow band composited over
 * everything opaque so far. HARD gradient stops — a smooth ramp here would
 * read as airbrushing, and abrupt bands are the whole point of cel.
 */
function celShade(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const g = ctx.createLinearGradient(PX * 0.78, PX * 0.06, PX * 0.2, PX * 0.94);
  g.addColorStop(0, "rgba(255, 243, 200, 0.17)");
  g.addColorStop(0.36, "rgba(255, 243, 200, 0.17)");
  g.addColorStop(0.361, "rgba(0, 0, 0, 0)");
  g.addColorStop(0.63, "rgba(0, 0, 0, 0)");
  g.addColorStop(0.631, "rgba(11, 13, 18, 0.3)");
  g.addColorStop(1, "rgba(11, 13, 18, 0.3)");
  ctx.fillStyle = g;
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
  poly(ctx, [[-4, -14], [-4, -58], [0, -68], [4, -58], [4, -14]], C(21)); // blade
  line(ctx, [[0, -18], [0, -60]], 1.5, C(22)); // fuller ridge
  rrect(ctx, -12, -16, 24, 7, 3, C(16)); // crossguard
  rrect(ctx, -3.5, -9, 7, 15, 3, C(27)); // grip
  ell(ctx, 0, 9, 4.5, 4.5, C(16)); // pommel
}

function drawStickHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 8, -3, -30, 9, C(28));
  limb(ctx, -3, -30, 3, -56, 8, C(28));
  ell(ctx, -2, -18, 2.5, 2, C(27)); // knots
  ell(ctx, 1, -42, 2.5, 2, C(27));
}

function drawMaceHeld(ctx: CanvasRenderingContext2D): void {
  limb(ctx, 0, 8, 0, -38, 7, C(27));
  // spikes first so the ball's outline overlaps their bases
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const sx = Math.cos(a);
    const sy = Math.sin(a);
    poly(ctx, [
      [sx * 11 - sy * 4, -48 + sy * 11 + sx * 4],
      [sx * 11 + sy * 4, -48 + sy * 11 - sx * 4],
      [sx * 19, -48 + sy * 19],
    ], C(20));
  }
  ell(ctx, 0, -48, 12, 12, C(20));
  ell(ctx, 0, -48, 5, 5, C(19));
  rrect(ctx, -5, -12, 10, 5, 2, C(16)); // gold band
}

function drawChairHeld(ctx: CanvasRenderingContext2D): void {
  // A little wooden chair brandished by one leg. Ridiculous on purpose.
  limb(ctx, 0, 6, 0, -20, 7, C(28)); // the held leg
  limb(ctx, 14, -20, 14, -2, 6, C(28)); // the other front leg
  rrect(ctx, -6, -30, 28, 9, 3, C(28)); // seat
  limb(ctx, -2, -30, -2, -54, 6, C(27)); // backrest posts
  limb(ctx, 18, -30, 18, -54, 6, C(27));
  rrect(ctx, -5, -56, 26, 8, 3, C(28)); // headrail
  rrect(ctx, -3, -44, 22, 6, 2, C(27)); // slat
}

function drawGunHeld(ctx: CanvasRenderingContext2D, o: { fire?: boolean }): void {
  rrect(ctx, -5, -12, 10, 15, 3, C(27)); // grip
  rrect(ctx, -6, -34, 12, 24, 3, C(19)); // body/slide
  rrect(ctx, -3.5, -46, 7, 13, 2, C(19)); // barrel
  line(ctx, [[-4, -30], [4, -30]], 2, C(20)); // slide catch
  ell(ctx, 0, -14, 3, 3, C(16)); // hammer pin
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
  line(ctx, [[-4, -44], [-4, 44]], 2, C(21)); // string
  rrect(ctx, 2, -7, 8, 14, 3, C(27)); // grip wrap
  if (o.fire) {
    // nocked arrow, an instant from release
    line(ctx, [[0, 26], [0, -34]], 3, C(28));
    poly(ctx, [[-4, -34], [4, -34], [0, -46]], C(21)); // head
    poly(ctx, [[-1.5, 18], [-7, 28], [-1.5, 26]], C(12)); // fletching
    poly(ctx, [[1.5, 18], [7, 28], [1.5, 26]], C(12));
  }
}

function drawFlamethrowerHeld(ctx: CanvasRenderingContext2D, o: { fire?: boolean }): void {
  rrect(ctx, -9, -24, 18, 30, 5, C(14)); // fuel tank
  line(ctx, [[-9, -14], [9, -14]], 2, C(15)); // tank seam
  ell(ctx, 0, -2, 3.5, 3.5, C(16)); // valve
  rrect(ctx, -4, -44, 8, 21, 2, C(19)); // nozzle
  poly(ctx, [[-6, -44], [6, -44], [4, -52], [-4, -52]], C(20)); // muzzle bell
  // hose looping from tank base to nozzle
  ctx.beginPath();
  ctx.moveTo(8, 2);
  ctx.quadraticCurveTo(20, -18, 4, -30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (o.fire) {
    // cone of fire past the bell — three nested tongues
    poly(ctx, [[-7, -52], [7, -52], [13, -86], [-13, -86]], C(15));
    poly(ctx, [[-5, -54], [5, -54], [9, -82], [-9, -82]], C(16));
    ell(ctx, 0, -70, 5, 11, C(17));
  } else {
    ell(ctx, 0, -55, 2.5, 4, C(16)); // pilot light
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

/** The translucent arc that sells a melee strike frame. Post-shade. */
function swoosh(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(238, 241, 245, 0.55)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 9, a0 + 0.12, a1 - 0.12);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(238, 241, 245, 0.3)";
  ctx.stroke();
}

const GROUND = 118;

function knightLegsFront(ctx: CanvasRenderingContext2D, bob: number, stride: number): void {
  // Facing the camera: the stride reads as alternating knee lifts.
  const liftL = Math.max(0, stride) * 8;
  const liftR = Math.max(0, -stride) * 8;
  limb(ctx, 56, 86 + bob, 54, GROUND - liftL - 4, 13, C(20));
  limb(ctx, 72, 86 + bob, 74, GROUND - liftR - 4, 13, C(20));
  ell(ctx, 54, GROUND - liftL, 9, 5, C(19)); // sabatons
  ell(ctx, 74, GROUND - liftR, 9, 5, C(19));
}

function knightLegsProfile(ctx: CanvasRenderingContext2D, bob: number, stride: number): void {
  // Profile: a real scissor — one foot reaches, the other trails.
  const reach = stride * 12;
  limb(ctx, 62, 86 + bob, 62 + reach, GROUND - Math.abs(stride) * 3 - 4, 13, C(20));
  limb(ctx, 66, 86 + bob, 66 - reach, GROUND - 4, 13, C(19));
  ell(ctx, 62 + reach + 3, GROUND - Math.abs(stride) * 3, 9, 5, C(19));
  ell(ctx, 66 - reach + 3, GROUND, 9, 5, C(19));
}

function knightTorso(ctx: CanvasRenderingContext2D, bob: number, profile: boolean): void {
  if (profile) {
    poly(ctx, [[52, 56 + bob], [78, 56 + bob], [76, 88 + bob], [54, 88 + bob]], C(21));
    rrect(ctx, 52, 82 + bob, 25, 8, 3, C(27)); // belt
    rrect(ctx, 61, 83 + bob, 7, 6, 1.5, C(16)); // buckle
  } else {
    poly(ctx, [[42, 56 + bob], [86, 56 + bob], [79, 88 + bob], [49, 88 + bob]], C(21));
    line(ctx, [[64, 60 + bob], [64, 82 + bob]], 2, C(20)); // plackart seam
    rrect(ctx, 48, 82 + bob, 32, 8, 3, C(27)); // belt
    rrect(ctx, 60, 83 + bob, 8, 6, 1.5, C(16)); // buckle
  }
}

function knightHead(ctx: CanvasRenderingContext2D, bob: number, dir: Dir): void {
  const y = 38 + bob;
  if (dir === "E") {
    // plume streams back off a profile helm with a nose guard
    ctx.beginPath();
    ctx.moveTo(58, y - 14);
    ctx.quadraticCurveTo(40, y - 20, 34, y - 4);
    ctx.quadraticCurveTo(46, y - 10, 58, y - 6);
    ctx.closePath();
    ctx.fillStyle = C(12);
    ctx.fill();
    ctx.lineWidth = INK_W;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ell(ctx, 66, y, 16, 15, C(21));
    poly(ctx, [[78, y - 6], [84, y + 2], [78, y + 6]], C(20)); // nose guard
    rrect(ctx, 66, y - 4, 13, 5, 2, C(1)); // eye slit
  } else {
    // plume: a little crest flopping to one side
    ctx.beginPath();
    ctx.moveTo(60, y - 16);
    ctx.quadraticCurveTo(56, y - 30, 44, y - 28);
    ctx.quadraticCurveTo(54, y - 22, 56, y - 12);
    ctx.closePath();
    ctx.fillStyle = C(12);
    ctx.fill();
    ctx.lineWidth = INK_W;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ell(ctx, 64, y, 17, 16, C(21));
    if (dir === "S") {
      rrect(ctx, 52, y - 3, 24, 6, 3, C(1)); // visor slit
      line(ctx, [[52, y + 8], [76, y + 8]], 2, C(20)); // chin plate seam
    } else {
      line(ctx, [[64, y - 12], [64, y + 12]], 2, C(20)); // helm back ridge
    }
  }
}

function pauldrons(ctx: CanvasRenderingContext2D, bob: number, profile: boolean): void {
  if (profile) {
    ell(ctx, 74, 58 + bob, 12, 9, C(20));
  } else {
    ell(ctx, 42, 60 + bob, 11, 9, C(20));
    ell(ctx, 86, 60 + bob, 11, 9, C(20));
  }
}

/**
 * One knight frame. Draw order matters per facing: N hides the weapon behind
 * the body, S and E hold it in front.
 */
function knightFrame(ctx: CanvasRenderingContext2D, dir: Dir, pose: KPose, weapon: WeaponId): void {
  const { bob, stride, atk } = pose;
  const ranged = WEAPONS[weapon].kind === "ranged";
  const hands = dir === "S" ? HAND_S : dir === "N" ? HAND_N : HAND_E;
  const hand = hands[atk ?? "rest"];
  const firing = atk === "fire" || (atk === "strike" && !ranged);

  groundShadow(ctx, 64, GROUND + 3, 27);

  const weaponBehind = dir === "N";
  if (weaponBehind) drawHeld(ctx, weapon, hand.x, hand.y, hand.rot, atk === "fire");

  if (dir === "E") {
    knightLegsProfile(ctx, bob, stride);
    knightTorso(ctx, bob, true);
    pauldrons(ctx, bob, true);
    // far arm hint
    limb(ctx, 58, 62 + bob, 54, 84 + bob, 8, C(19));
  } else {
    knightLegsFront(ctx, bob, stride);
    knightTorso(ctx, bob, false);
    pauldrons(ctx, bob, false);
    // off hand
    const off = dir === "S" ? { sx: 42, hx: 38 } : { sx: 86, hx: 90 };
    limb(ctx, off.sx, 62 + bob, off.hx, 86 + bob, 9, C(20));
    ell(ctx, off.hx, 88 + bob, 5, 5, C(19)); // gauntlet
  }

  // weapon arm: shoulder → hand anchor
  const shoulder = dir === "S" ? { x: 86, y: 62 + bob } : dir === "N" ? { x: 42, y: 62 + bob } : { x: 74, y: 60 + bob };
  limb(ctx, shoulder.x, shoulder.y, hand.x, hand.y, 9, C(20));
  ell(ctx, hand.x, hand.y, 5.5, 5.5, C(19)); // gauntlet fist

  knightHead(ctx, bob, dir);

  if (!weaponBehind) drawHeld(ctx, weapon, hand.x, hand.y, hand.rot, atk === "fire");

  celShade(ctx);

  // post-shade effects: full-brightness flash/swoosh
  if (firing && !ranged && weapon !== "fists") {
    if (dir === "S") swoosh(ctx, 64, 74, 44, 0.55, 1.85);
    else if (dir === "N") swoosh(ctx, 64, 74, 44, Math.PI + 0.55, Math.PI + 1.85);
    else swoosh(ctx, 66, 62, 46, -0.75, 0.75);
  }
  if (firing && weapon === "fists") {
    // a punch impact puff just past the fist
    flash(ctx, hand.x + (dir === "N" ? -10 : 10), hand.y - 4, 8);
  }
}

/** Build the full painter set for the knight holding `weapon`. */
export function makeKnightPaints(weapon: WeaponId): ActorPaints {
  const ranged = WEAPONS[weapon].kind === "ranged";
  const phases: Array<MeleePhase | RangedPhase> = ranged ? ["aim", "fire", "recover"] : ["windup", "strike", "low"];

  const dirClips = (dir: Dir) => ({
    idle: [
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 0, stride: 0 }, weapon),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 2, stride: 0 }, weapon),
    ],
    walk: [
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 1.5, stride: 1 }, weapon),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 0, stride: 0 }, weapon),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 1.5, stride: -1 }, weapon),
      (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: 0, stride: 0 }, weapon),
    ],
    attack: phases.map(
      (atk) => (ctx: CanvasRenderingContext2D) => knightFrame(ctx, dir, { bob: atk === "strike" || atk === "fire" ? 1 : 0, stride: 0, atk }, weapon),
    ),
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

function zombieHead(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir, dead: boolean): void {
  const tilt = dir === "E" ? 0.35 : 0.18;
  ell(ctx, x, y, 14, 13, C(8), tilt);
  // mangy scalp patch
  ell(ctx, x - 4, y - 9, 6, 3.5, C(7), tilt);
  if (dir === "N") {
    // back of the skull: a weeping wound instead of a face
    ell(ctx, x + 3, y - 2, 4, 5, C(11));
    return;
  }
  const ex = dir === "E" ? x + 7 : x;
  if (dead) {
    line(ctx, [[ex - 7, y - 4], [ex - 2, y + 1]], 2.5, C(1));
    line(ctx, [[ex - 2, y - 4], [ex - 7, y + 1]], 2.5, C(1));
    if (dir === "S") {
      line(ctx, [[ex + 3, y - 4], [ex + 8, y + 1]], 2.5, C(1));
      line(ctx, [[ex + 8, y - 4], [ex + 3, y + 1]], 2.5, C(1));
    }
  } else {
    // mismatched glowing eyes — one big, one pinprick. No ink outline: they
    // GLOW, and at game scale an outlined 4px eye is all outline.
    ctx.beginPath();
    ctx.ellipse(ex - 5, y - 2, 4.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(13);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(ex - 6, y - 3, 1.8, 1.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = C(17);
    ctx.fill();
    if (dir === "S") {
      ctx.beginPath();
      ctx.ellipse(ex + 5, y - 1, 2.8, 2.8, 0, 0, Math.PI * 2);
      ctx.fillStyle = C(13);
      ctx.fill();
    }
  }
  // slack jaw
  const jx = dir === "E" ? x + 8 : x + 1;
  ell(ctx, jx, y + 9, 5.5, 4, C(6), tilt);
  line(ctx, [[jx - 3, y + 6.5], [jx + 3, y + 6.5]], 1.5, C(22)); // teeth glint
}

function zombieStanding(ctx: CanvasRenderingContext2D, dir: Dir, pose: ZPose): void {
  const { bob, stride, lurch, dead } = pose;

  ctx.save();
  // the whole body lurches around the feet
  ctx.translate(64, GROUND);
  ctx.rotate(dir === "E" ? lurch : lurch * 0.4);
  ctx.translate(-64, -GROUND);

  // ── legs — tattered trousers, uneven stance ──
  const reach = stride * (dir === "E" ? 11 : 0);
  const liftL = dir === "E" ? 0 : Math.max(0, stride) * 7;
  const liftR = dir === "E" ? 0 : Math.max(0, -stride) * 7;
  limb(ctx, 58, 88 + bob, 54 + reach, GROUND - liftL - 3, 11, C(26));
  limb(ctx, 70, 88 + bob, 74 - reach, GROUND - liftR - 3, 11, C(26));
  ell(ctx, 54 + reach, GROUND - liftL, 8, 4.5, C(7)); // bare rotten feet
  ell(ctx, 74 - reach, GROUND - liftR, 8, 4.5, C(7));

  // ── torso — hunched, one shoulder high ──
  const tx = dir === "E" ? 66 : 64;
  ell(ctx, tx, 72 + bob, 20, 18, C(7), dir === "E" ? 0.5 : 0.15);
  // exposed ribs
  const rx = dir === "E" ? tx + 4 : tx - 6;
  line(ctx, [[rx - 6, 64 + bob], [rx + 6, 66 + bob]], 2, C(9));
  line(ctx, [[rx - 7, 70 + bob], [rx + 6, 72 + bob]], 2, C(9));
  line(ctx, [[rx - 6, 76 + bob], [rx + 5, 78 + bob]], 2, C(8));
  // gut wound
  ell(ctx, tx + 6, 80 + bob, 5, 4, C(11));

  // ── arms ──
  if (dir === "E") {
    // both reaching forward, grasping
    limb(ctx, 74, 62 + bob, 96, 70 + bob, 8, C(8));
    limb(ctx, 70, 68 + bob, 92, 82 + bob, 8, C(7));
    ell(ctx, 98, 71 + bob, 4.5, 4.5, C(9));
    ell(ctx, 94, 84 + bob, 4.5, 4.5, C(8));
  } else if (dir === "S") {
    // one hangs dead, one half-raised
    limb(ctx, 46, 64 + bob, 40, 94 + bob, 8, C(7));
    limb(ctx, 82, 62 + bob, 92, 80 + bob, 8, C(8));
    ell(ctx, 40, 97 + bob, 4.5, 4.5, C(9));
    ell(ctx, 93, 83 + bob, 4.5, 4.5, C(9));
  } else {
    // from behind: both droop outward
    limb(ctx, 46, 64 + bob, 38, 90 + bob, 8, C(7));
    limb(ctx, 82, 64 + bob, 90, 90 + bob, 8, C(7));
    // spine knuckles up the back
    line(ctx, [[64, 58 + bob], [63, 84 + bob]], 3, C(6));
  }

  // ── head — thrust forward off the hunch ──
  const hx = dir === "E" ? 78 : 70;
  zombieHead(ctx, hx, 46 + bob, dir, !!dead);

  ctx.restore();
}

function zombieFrame(dir: Dir, pose: ZPose): FramePaint {
  return (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 25);
    zombieStanding(ctx, dir, pose);
    celShade(ctx);
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

const ZOMBIE_DEATH: FramePaint[] = [
  // buckle — knees give, eyes go out
  (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 25);
    zombieStanding(ctx, "S", { bob: 8, stride: 0, lurch: 0.14, dead: true });
    celShade(ctx);
  },
  // fold — the whole figure pitches around the feet
  (ctx) => {
    groundShadow(ctx, 64, GROUND + 3, 25);
    ctx.save();
    ctx.translate(60, GROUND);
    ctx.rotate(-0.62);
    ctx.translate(-64, -GROUND);
    zombieStanding(ctx, "S", { bob: 10, stride: 0, lurch: 0, dead: true });
    ctx.restore();
    celShade(ctx);
  },
  // collapse — nearly flat, first blood
  (ctx) => {
    ctx.save();
    ctx.translate(56, GROUND + 2);
    ctx.rotate(-1.25);
    ctx.translate(-64, -GROUND);
    zombieStanding(ctx, "S", { bob: 12, stride: 0, lurch: 0, dead: true });
    ctx.restore();
    celShade(ctx);
    bloodPool(ctx, 16);
  },
  // the heap and the stain
  (ctx) => {
    bloodPool(ctx, 34);
    ell(ctx, 58, GROUND - 8, 22, 9, C(7), 0.08); // body mound
    ell(ctx, 82, GROUND - 8, 9, 7, C(8), -0.2); // lolled head
    line(ctx, [[86, GROUND - 10], [82, GROUND - 6]], 2.5, C(1)); // x eye
    line(ctx, [[82, GROUND - 10], [86, GROUND - 6]], 2.5, C(1));
    limb(ctx, 44, GROUND - 10, 34, GROUND - 4, 7, C(7)); // outflung arm
    line(ctx, [[50, GROUND - 12], [62, GROUND - 10]], 2, C(9)); // rib glint
    celShade(ctx);
  },
];

export const ZOMBIE_PAINTS: ActorPaints = {
  S: {
    idle: [zombieFrame("S", { bob: 0, stride: 0, lurch: 0.02 }), zombieFrame("S", { bob: 2.5, stride: 0, lurch: -0.02 })],
    walk: [
      zombieFrame("S", { bob: 2, stride: 1, lurch: 0.05 }),
      zombieFrame("S", { bob: 0, stride: 0, lurch: 0 }),
      zombieFrame("S", { bob: 2, stride: -1, lurch: -0.05 }),
      zombieFrame("S", { bob: 0, stride: 0, lurch: 0 }),
    ],
    death: ZOMBIE_DEATH,
  },
  N: {
    idle: [zombieFrame("N", { bob: 0, stride: 0, lurch: 0.02 }), zombieFrame("N", { bob: 2.5, stride: 0, lurch: -0.02 })],
    walk: [
      zombieFrame("N", { bob: 2, stride: 1, lurch: 0.05 }),
      zombieFrame("N", { bob: 0, stride: 0, lurch: 0 }),
      zombieFrame("N", { bob: 2, stride: -1, lurch: -0.05 }),
      zombieFrame("N", { bob: 0, stride: 0, lurch: 0 }),
    ],
    death: ZOMBIE_DEATH,
  },
  E: {
    idle: [zombieFrame("E", { bob: 0, stride: 0, lurch: 0.1 }), zombieFrame("E", { bob: 2.5, stride: 0, lurch: 0.14 })],
    walk: [
      zombieFrame("E", { bob: 2, stride: 1, lurch: 0.16 }),
      zombieFrame("E", { bob: 0, stride: 0, lurch: 0.1 }),
      zombieFrame("E", { bob: 2, stride: -1, lurch: 0.06 }),
      zombieFrame("E", { bob: 0, stride: 0, lurch: 0.1 }),
    ],
    death: ZOMBIE_DEATH,
  },
};

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
  ell(ctx, 64, 82, 18, 17, C(21));
  rrect(ctx, 51, 79, 26, 6, 3, C(1)); // visor
  line(ctx, [[50, 92], [78, 92]], 2.5, C(20)); // rim
  celShade(ctx);
};

const ARMOR_ITEM: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 104, 24);
  poly(ctx, [[44, 62], [84, 62], [78, 98], [50, 98]], C(21)); // breastplate
  ell(ctx, 46, 64, 8, 6, C(20)); // shoulder cops
  ell(ctx, 82, 64, 8, 6, C(20));
  line(ctx, [[64, 66], [64, 94]], 2, C(20)); // seam
  line(ctx, [[52, 72], [58, 78]], 3, C(22)); // shine tick
  celShade(ctx);
};

const BOOTS_ITEM: FramePaint = (ctx) => {
  groundShadow(ctx, 64, 104, 22);
  for (const bx of [48, 74]) {
    rrect(ctx, bx, 68, 12, 26, 4, C(27)); // shaft
    poly(ctx, [[bx, 88], [bx + 12, 88], [bx + 20, 98], [bx, 98]], C(26)); // foot
    line(ctx, [[bx + 2, 74], [bx + 10, 74]], 2, C(28)); // strap
  }
  celShade(ctx);
};

/** Ground-item art, keyed by weapon id / gear slot. */
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
};

// ══════════════════════════════════════════════════════════════════
// PROPS — walk-over set dressing. Drawn low so they hug the floor.
// ══════════════════════════════════════════════════════════════════

const BONES_PROP: FramePaint = (ctx) => {
  limb(ctx, 40, 100, 62, 108, 5, C(22)); // long bone
  ell(ctx, 38, 99, 4, 4, C(21));
  ell(ctx, 64, 109, 4, 4, C(21));
  limb(ctx, 74, 94, 88, 104, 4, C(21)); // second bone
  ell(ctx, 90, 105, 3.5, 3.5, C(22));
  line(ctx, [[54, 92], [60, 96]], 3, C(20)); // shard
  celShade(ctx);
};

const SKULL_PROP: FramePaint = (ctx) => {
  ell(ctx, 64, 98, 12, 11, C(22));
  ell(ctx, 60, 96, 3, 3.5, C(1)); // sockets
  ell(ctx, 69, 96, 3, 3.5, C(1));
  poly(ctx, [[63, 101], [66, 101], [64.5, 104]], C(1)); // nose
  rrect(ctx, 58, 106, 13, 5, 2, C(21)); // jaw
  line(ctx, [[61, 106], [61, 110]], 1.5, C(1)); // teeth gaps
  line(ctx, [[65, 106], [65, 110]], 1.5, C(1));
  celShade(ctx);
};

const RUBBLE_PROP: FramePaint = (ctx) => {
  poly(ctx, [[42, 110], [50, 96], [62, 102], [58, 112]], C(3));
  poly(ctx, [[60, 108], [70, 94], [84, 104], [80, 112]], C(4));
  poly(ctx, [[80, 110], [88, 102], [96, 110]], C(3));
  ell(ctx, 52, 112, 4, 2.5, C(2));
  celShade(ctx);
};

/** Scenery art, keyed by PropSpot.kind. */
export const PROP_PAINTS: Record<string, FramePaint> = {
  bones: BONES_PROP,
  skull: SKULL_PROP,
  rubble: RUBBLE_PROP,
};
