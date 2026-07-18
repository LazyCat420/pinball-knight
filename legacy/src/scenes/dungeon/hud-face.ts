/**
 * 🛡️ THE KNIGHT'S FACE — one shared portrait canvas, mounted by BOTH HUDs.
 *
 * A single <canvas> drawn procedurally (no image assets): a chunky VGA
 * status-bar portrait in the Wolfenstein 3D mould — a helmeted knight rendered
 * on a 24×24 pixel grid with five skin tones for real form, that reads the
 * player's health tier and reacts to hits (pain wince + a glance toward the
 * blow), heals (a quick grin) and special pickups. The Diablo HUD sits it
 * between the two liquid globes; the Wolf HUD sits it in the centre column.
 * Because it's the SAME DOM element moved between the two face slots, health/
 * expression state never resets on a swap.
 *
 * Draw grid is 24×24 "cells"; the backing store is GRID×SCALE px with
 * imageSmoothing off, so it stays crisp and pixel-snapped at any CSS size.
 */

const GRID = 24;
const SCALE = 5; // backing store = 120×120
const PX = GRID * SCALE;

type Expr = "fresh" | "steady" | "hurt" | "bloodied" | "dying" | "dead";

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

// ── Live face state ──
let hp = 6;
let maxHp = 6;
let painT = 0; // >0 = wincing from a recent hit
let healT = 0; // >0 = brief smile
let specialT = 0; // >0 = wide grin (item/power pickup)
let lookX = 0; // -1..1 pupil offset (toward a damage source)
let lookY = 0;
let blinkT = 2.4; // countdown to the next blink
let blinkFor = 0; // >0 = eyes shut this frame
let lastSig = ""; // repaint guard

/** Create (once) the shared face canvas and return it. */
export function createFace(): HTMLCanvasElement {
  if (canvas) return canvas;
  const c = document.createElement("canvas");
  c.width = PX;
  c.height = PX;
  c.id = "dungeon-hud-face";
  c.style.cssText = `image-rendering: pixelated; width: 100%; height: 100%; display: block;`;
  const context = c.getContext("2d");
  if (context) context.imageSmoothingEnabled = false;
  canvas = c;
  ctx = context;
  lastSig = "";
  return c;
}

export function getFaceCanvas(): HTMLCanvasElement | null {
  return canvas;
}

export function disposeFace(): void {
  canvas = null;
  ctx = null;
  painT = healT = specialT = 0;
  lookX = lookY = 0;
  blinkT = 2.4;
  blinkFor = 0;
  lastSig = "";
}

/** Latch the current health so the tier + blood level track it. */
export function setFaceHealth(currentHp: number, currentMax: number): void {
  hp = Math.max(0, currentHp);
  maxHp = Math.max(1, currentMax);
}

/** A hit landed — wince, and (if we know where it came from) glance that way. */
export function faceOnDamage(sourceAngle?: number): void {
  painT = 0.32;
  if (sourceAngle !== undefined) {
    lookX = Math.cos(sourceAngle);
    lookY = Math.sin(sourceAngle) * 0.6;
  }
}

/** A heal — a quick relieved grin. */
export function faceOnHeal(): void {
  healT = 0.42;
}

/** A special / power pickup — a wide toothy grin. */
export function faceOnSpecial(): void {
  specialT = 0.7;
}

function tierOf(): Expr {
  if (hp <= 0) return "dead";
  const f = hp / maxHp;
  if (f <= 0.18) return "dying";
  if (f <= 0.36) return "bloodied";
  if (f <= 0.55) return "hurt";
  if (f <= 0.78) return "steady";
  return "fresh";
}

/**
 * Advance the face's own animation timers and repaint if anything visible
 * changed. Call once per rendered frame with the frame's dt.
 */
export function renderFace(dt: number): void {
  if (!ctx || !canvas) return;

  painT = Math.max(0, painT - dt);
  healT = Math.max(0, healT - dt);
  specialT = Math.max(0, specialT - dt);
  if (painT === 0) {
    lookX *= Math.max(0, 1 - dt * 6);
    lookY *= Math.max(0, 1 - dt * 6);
  }

  blinkFor = Math.max(0, blinkFor - dt);
  blinkT -= dt;
  if (blinkT <= 0) {
    blinkFor = 0.11;
    const tier = tierOf();
    blinkT = tier === "dying" ? 0.9 + Math.abs(lookX) * 0.3 : 2.2 + (hp / maxHp) * 2;
  }

  const sig = [
    tierOf(),
    exprNow(),
    blinkFor > 0 ? 1 : 0,
    Math.round(lookX * 2),
    Math.round(lookY * 2),
    painT > 0 ? Math.ceil(painT * 20) : 0,
    healT > 0 ? 1 : 0,
    specialT > 0 ? 1 : 0,
  ].join(":");
  if (sig === lastSig) return;
  lastSig = sig;
  paint();
}

function exprNow(): Expr | "grin" | "smile" | "wince" {
  const tier = tierOf();
  if (tier === "dead") return "dead";
  if (specialT > 0) return "grin";
  if (painT > 0) return "wince";
  if (healT > 0) return "smile";
  return tier;
}

// ── palette (VGA-limited, five skin tones for real form) ──
const C = {
  bg: "#090a0e",
  bgHi: "#12141c",
  // steel helmet — dark→bright
  steelDk: "#2b313b",
  steel: "#4c5666",
  steelHi: "#7c8898",
  steelBright: "#aeb8c6",
  gold: "#c68f2e",
  goldHi: "#f2c250",
  // skin — deep shadow → highlight
  skinLo: "#6b4326",
  skinDk: "#8d5832",
  skin: "#b27846",
  skinHi: "#d59a62",
  skinBright: "#eec090",
  // eyes
  white: "#e6e8dc",
  iris: "#3f74a8",
  pupil: "#0d1017",
  glint: "#f4f6ee",
  // mouth
  mouthDk: "#37190f",
  teeth: "#d8d1b6",
  // blood + sweat
  blood: "#9a1b29",
  bloodHi: "#d1313d",
  sweat: "#bcd4e6",
  // OLD-MAN hair + beard — weathered greys/whites (shows as the helm breaks)
  hairDk: "#565963",
  hair: "#868a94",
  hairHi: "#b8bcc6",
  hairWhite: "#dde0e6",
  scalp: "#c99a72", // bald-pate skin under the broken dome
  scalpHi: "#e2b488",
};

/** Fill a rectangle in GRID cells. */
function cell(gx: number, gy: number, gw: number, gh: number, color: string): void {
  if (!ctx) return;
  ctx.fillStyle = color;
  ctx.fillRect(gx * SCALE, gy * SCALE, gw * SCALE, gh * SCALE);
}
/** One grid pixel. */
function px(gx: number, gy: number, color: string): void {
  cell(gx, gy, 1, 1, color);
}

function paint(): void {
  if (!ctx) return;
  const expr = exprNow();
  const tier = tierOf();
  ctx.clearRect(0, 0, PX, PX);

  // ── Backdrop (flat, faint centre glow — no gradient sheen) ──
  cell(0, 0, GRID, GRID, C.bg);
  cell(6, 3, 12, 19, C.bgHi);

  // ── Head UNDER the helm (grey hair + bald pate) drawn first, so as the
  // helmet plates shatter away (higher stages) the old man's head shows through.
  const stage = helmetStageOf();
  paintScalp(stage);
  // ── Helmet: rounded dome, brim, gold crest, side cheek-guards — progressively
  // BREAKS APART as the fight wears on (Doom status-face energy). ──
  paintHelmet(stage);

  // ── Face skin base + sculpted shading ──
  // base mid tone, rounded corners under the brim / at the jaw
  cell(7, 5, 10, 15, C.skin);
  px(7, 5, C.bg); px(16, 5, C.bg);
  px(7, 19, C.bg); px(16, 19, C.bg);
  cell(8, 20, 8, 1, C.skin); // chin tip
  px(8, 20, C.bg); px(15, 20, C.bg);

  // forehead + nose-bridge highlight (light from upper-left)
  cell(8, 6, 6, 1, C.skinHi);
  cell(8, 6, 3, 1, C.skinBright);
  cell(11, 9, 2, 4, C.skinHi); // nose bridge catch
  // cheekbone highlights
  cell(8, 12, 2, 2, C.skinHi);
  cell(14, 12, 2, 2, C.skinHi);
  // side + jaw shadow (form)
  cell(7, 9, 1, 9, C.skinDk);
  cell(16, 9, 1, 9, C.skinDk);
  cell(8, 18, 8, 1, C.skinDk);
  cell(9, 19, 6, 1, C.skinLo);
  // under-brow shadow band
  cell(8, 8, 8, 1, C.skinDk);

  // ── Brow — angrier (lower, inner-tilted) as the fight wears on ──
  const angry = expr === "wince" || tier === "dying" || tier === "bloodied";
  const by = angry ? 8 : 7;
  cell(8, by, 3, 1, C.skinLo);
  cell(13, by, 3, 1, C.skinLo);
  if (angry) {
    px(10, by + 1, C.skinLo);
    px(13, by + 1, C.skinLo);
  }

  // ── Eyes ──
  paintEyes(expr, tier);

  // ── Nose (bridge highlight already laid; add tip + nostrils) ──
  px(11, 13, C.skinDk);
  px(12, 13, C.skinHi);
  px(10, 13, C.skinLo); // left nostril wing shadow
  px(13, 13, C.skinLo); // right nostril wing shadow

  // ── Old-man BEARD — a full grizzled grey beard framing the jaw (drawn before
  // the mouth so the mouth reads through it). Gets more unkempt/whiter with age
  // of the fight. ──
  paintBeard(tier);

  // ── Mouth by expression (over the beard) ──
  paintMouth(expr);

  // ── Battle damage grows with the tier ──
  paintDamage(tier);

  // ── Reaction tint wash (flat overlay) ──
  if (painT > 0) tint(`rgba(190,30,45,${0.3 * (painT / 0.32)})`);
  else if (healT > 0) tint(`rgba(80,190,110,${0.22 * (healT / 0.42)})`);
  else if (specialT > 0) tint(`rgba(240,200,90,${0.2})`);
}

/**
 * Helmet damage stage 0-5 from the health tier: the plates chip, crack, shatter
 * and finally fall away entirely, Doom-status-face style, so LOW HP literally
 * reads as "the armour is gone and it's just his bloody face".
 */
function helmetStageOf(): number {
  switch (tierOf()) {
    case "fresh": return 0;
    case "steady": return 1;
    case "hurt": return 2;
    case "bloodied": return 3;
    case "dying": return 4;
    default: return 5; // dead
  }
}

/**
 * The old knight's HEAD under the helm — a balding grey-haired pate. Fully
 * hidden while the dome is intact; shows through the holes as it shatters, then
 * is fully bared (wild bloody grey hair) once the helmet's gone.
 */
function paintScalp(stage: number): void {
  // bald crown skin + a light rake
  cell(8, 2, 8, 4, C.scalp);
  cell(8, 2, 4, 1, C.scalpHi);
  // grey hair fringe down the sides
  cell(6, 3, 2, 3, C.hair);
  cell(16, 3, 2, 3, C.hair);
  cell(6, 3, 1, 3, C.hairDk);
  px(9, 2, C.hairHi);
  px(13, 2, C.hairWhite); // a white strand (age)
  if (stage >= 4) {
    // helm gone — disheveled grey hair sticking up, blood matting the pate
    cell(7, 1, 10, 1, C.hair);
    px(8, 0, C.hairHi); px(11, 0, C.hairWhite); px(14, 0, C.hair);
    cell(6, 2, 1, 4, C.hairDk);
    cell(17, 2, 1, 4, C.hairDk);
    px(12, 2, C.blood); cell(9, 3, 2, 1, C.blood);
    if (stage >= 5) { cell(11, 1, 3, 1, C.bloodHi); px(10, 2, C.blood); px(14, 2, C.blood); }
  }
}

function paintHelmet(stage: number): void {
  if (stage >= 5) {
    // DEAD — helmet entirely gone; only a battered blood-streaked gorget left.
    cell(6, 21, 12, 3, C.steelDk);
    cell(6, 21, 12, 1, C.steel);
    px(9, 22, C.blood);
    return;
  }

  // ── Gorget (neck plate) — holds on until death ──
  cell(6, 21, 12, 3, C.steel);
  cell(6, 21, 12, 1, C.steelHi);
  cell(6, 23, 12, 1, C.steelDk);
  cell(11, 21, 2, 3, C.steelDk);

  if (stage >= 4) {
    // DYING — helm smashed off; only a bent remnant brow-plate clings on the
    // left, plus a dangling cheek strap. The rest is bare (paintScalp shows).
    cell(6, 4, 4, 2, C.steelDk);
    cell(6, 4, 4, 1, C.steel);
    cell(5, 6, 1, 5, C.steelDk); // dangling left cheek strap
    px(6, 3, C.steelDk);
    px(7, 4, C.blood);
    return;
  }

  // ── Dome (stepped rounded top) ──
  cell(9, 0, 6, 1, C.steel);
  cell(7, 1, 10, 1, C.steel);
  cell(6, 2, 12, 1, C.steel);
  cell(6, 3, 12, 2, C.steel);
  // highlight rake — pristine only when fresh
  if (stage === 0) {
    cell(9, 0, 3, 1, C.steelBright);
    cell(7, 1, 3, 1, C.steelHi);
    cell(6, 2, 3, 1, C.steelHi);
    cell(6, 3, 2, 1, C.steelBright);
    px(7, 4, C.steelBright); px(16, 4, C.steelBright); // brim rivets
  } else {
    cell(7, 1, 2, 1, C.steelHi);
  }
  // lower-right dome shadow
  px(14, 0, C.steelDk);
  cell(15, 1, 2, 1, C.steelDk);
  cell(16, 2, 2, 1, C.steelDk);
  // brim shadow line under the helmet
  cell(6, 5, 11, 1, C.steelDk);
  px(7, 5, C.bg);

  // ── Gold crest / nasal spine — knocked clean off at stage ≥ 2 ──
  if (stage < 2) {
    cell(11, 0, 2, 5, C.gold);
    cell(11, 0, 1, 5, C.goldHi);
  } else {
    px(11, 4, C.gold); // torn stub
    px(12, 3, C.steelDk);
  }

  // ── Cracks + punched-out holes (hair shows through), growing per stage ──
  if (stage >= 1) {
    cell(16, 2, 1, 2, C.steelDk); // first ding
    px(9, 3, C.steelDk);
  }
  if (stage >= 2) {
    // a crack forks across the dome
    px(10, 2, C.steelDk); px(11, 3, C.steelDk); px(13, 2, C.steelDk);
    cell(15, 3, 2, 1, C.steelDk);
  }
  if (stage >= 3) {
    // SHATTERED — chunks punched out; the grey head shows through the gaps
    px(8, 2, C.hair); px(9, 2, C.hair);
    px(13, 3, C.hair); px(14, 3, C.hairHi);
    px(15, 1, C.hair); px(7, 3, C.hairDk);
    cell(11, 4, 2, 1, C.hair); // jagged brim bite
    px(12, 2, C.blood);
  }

  // ── Cheek guards — the right one takes the worst of it ──
  const leftBot = stage >= 3 ? 11 : stage >= 2 ? 15 : 18;
  cell(5, 5, 2, leftBot - 5, C.steel);
  cell(5, 5, 1, leftBot - 5, C.steelHi);
  if (stage < 3) px(6, 8, C.steelBright);
  if (stage >= 2) px(6, leftBot - 1, C.steelDk); // jagged break edge

  const rightBot = stage >= 3 ? 9 : stage >= 2 ? 13 : 18;
  cell(17, 5, 2, rightBot - 5, C.steel);
  cell(18, 5, 1, rightBot - 5, C.steelDk);
  if (stage < 2) { px(17, 8, C.steelBright); px(17, 14, C.steelBright); }
  else px(17, rightBot - 1, C.steelDk);
}

/**
 * A full grizzled GREY beard framing the jaw (drawn under the mouth). Whiter and
 * more unkempt as the fight wears on — the old-man read.
 */
function paintBeard(tier: Expr): void {
  const greye = tier === "fresh" || tier === "steady" ? C.hair : C.hairHi;
  // moustache across the upper lip, split under the nose
  cell(9, 14, 6, 1, C.hairDk);
  cell(9, 15, 2, 1, greye);
  cell(13, 15, 2, 1, greye);
  // jaw sides + chin mass (the mouth is painted over this after)
  cell(8, 16, 2, 4, C.hairDk);
  cell(14, 16, 2, 4, C.hairDk);
  cell(9, 18, 6, 2, greye);
  cell(9, 20, 6, 1, C.hairDk);
  cell(10, 18, 4, 1, C.hair);
  // stray white strands (age)
  px(9, 19, C.hairWhite); px(13, 19, C.hairHi); px(11, 20, C.hairWhite);
}

function paintEyes(expr: ReturnType<typeof exprNow>, tier: Expr): void {
  const shut = blinkFor > 0 || expr === "dead";
  const ox = Math.round(lookX); // -1,0,1
  if (expr === "dead") {
    drawX(8, 10);
    drawX(13, 10);
    return;
  }
  if (shut) {
    cell(8, 10, 3, 1, C.skinLo);
    cell(13, 10, 3, 1, C.skinLo);
    return;
  }
  const squint = expr === "wince" || tier === "dying";
  const ey = squint ? 10 : 9;
  const eh = squint ? 1 : 2;
  // sockets (whites)
  cell(8, ey, 3, eh, C.white);
  cell(13, ey, 3, eh, C.white);
  // upper-lid shadow line
  cell(8, ey - 1, 3, 1, C.skinDk);
  cell(13, ey - 1, 3, 1, C.skinDk);
  // iris + pupil, offset by the glance
  const lix = 9 + ox;
  const rix = 14 + ox;
  cell(lix, ey, 1, eh, C.iris);
  cell(rix, ey, 1, eh, C.iris);
  px(lix, ey, C.pupil);
  px(rix, ey, C.pupil);
  // catch-light (kills the "dead doll" look)
  if (!squint) {
    px(lix + 1, ey, C.glint);
    px(rix + 1, ey, C.glint);
  }
  // wide, fearful whites at death's door
  if (tier === "dying" && !squint) {
    cell(8, ey + 1, 3, 1, C.white);
    cell(13, ey + 1, 3, 1, C.white);
  }
}

function paintMouth(expr: ReturnType<typeof exprNow>): void {
  switch (expr) {
    case "grin": // wide toothy roar
      cell(9, 16, 6, 2, C.mouthDk);
      cell(9, 16, 6, 1, C.teeth);
      px(10, 17, C.teeth);
      px(13, 17, C.teeth);
      break;
    case "smile":
      cell(9, 17, 6, 1, C.mouthDk);
      px(8, 16, C.skinLo);
      px(15, 16, C.skinLo);
      break;
    case "wince": // gritted grimace, bared teeth
      cell(9, 16, 6, 1, C.teeth);
      cell(9, 17, 6, 1, C.mouthDk);
      for (let i = 9; i < 15; i += 2) px(i, 16, C.skinLo);
      break;
    case "dead": // slack, tongue lolling
      cell(9, 16, 5, 2, C.mouthDk);
      cell(10, 18, 2, 1, C.bloodHi);
      break;
    case "dying": // pained open mouth
      cell(9, 16, 5, 2, C.mouthDk);
      px(10, 16, C.blood);
      break;
    case "bloodied":
    case "hurt": // tight, downturned
      cell(9, 17, 6, 1, C.mouthDk);
      px(9, 16, C.skinLo);
      px(14, 16, C.skinLo);
      break;
    default: // steady / fresh — set jaw
      cell(9, 17, 6, 1, C.skinLo);
      cell(10, 16, 4, 1, C.skinDk);
  }
}

function paintDamage(tier: Expr): void {
  if (tier === "fresh") return;
  // steady — a first cheek scratch.
  px(8, 13, C.blood);
  cell(8, 13, 2, 1, C.blood);
  if (tier === "steady") return;
  // hurt — brow gash + a bruise under one eye.
  cell(15, 8, 1, 3, C.blood);
  px(14, 11, C.bloodHi);
  if (tier === "hurt") return;
  // bloodied — split lip, cheek smear, a sweat bead.
  cell(9, 18, 2, 1, C.bloodHi);
  cell(14, 12, 2, 1, C.blood);
  px(12, 7, C.sweat);
  if (tier === "bloodied") return;
  // dying — smeared over half the face, running sweat/blood, blackened eye.
  cell(8, 6, 3, 1, C.blood);
  cell(13, 15, 3, 1, C.bloodHi);
  cell(9, 7, 1, 3, C.blood);
  px(15, 9, C.sweat);
  px(9, 11, C.sweat);
}

function drawX(gx: number, gy: number): void {
  px(gx, gy, C.pupil);
  px(gx + 2, gy, C.pupil);
  px(gx + 1, gy + 1, C.pupil);
  px(gx, gy + 2, C.pupil);
  px(gx + 2, gy + 2, C.pupil);
}

function tint(rgba: string): void {
  if (!ctx) return;
  ctx.fillStyle = rgba;
  ctx.fillRect(0, 0, PX, PX);
}
