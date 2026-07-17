/**
 * 🛡️ THE KNIGHT'S FACE — one shared portrait canvas, mounted by BOTH HUDs.
 *
 * A single <canvas> drawn procedurally (no image assets): a blocky Doom/
 * Wolfenstein status-bar face that reads the player's health tier and reacts to
 * hits (pain wince + a glance toward the blow), heals (a quick grin) and
 * special pickups. The Diablo HUD sits it between the two liquid globes; the
 * Wolf HUD sits it in the centre column. Because it's the SAME DOM element moved
 * between the two face slots, health/expression state never resets on a swap.
 *
 * Draw grid is 20×20 "cells"; the backing store is GRID×SCALE px with
 * imageSmoothing off, so it stays crisp and pixel-snapped at any CSS size.
 */

const GRID = 20;
const SCALE = 5; // backing store = 100×100
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
    // ease the glance back to centre once the wince is over
    lookX *= Math.max(0, 1 - dt * 6);
    lookY *= Math.max(0, 1 - dt * 6);
  }

  // Blink cadence — quicker, twitchier blinks the closer to death.
  blinkFor = Math.max(0, blinkFor - dt);
  blinkT -= dt;
  if (blinkT <= 0) {
    blinkFor = 0.11;
    const tier = tierOf();
    blinkT = tier === "dying" ? 0.9 + Math.abs(lookX) * 0.3 : 2.2 + (hp / maxHp) * 2;
  }

  // Repaint guard: build a coarse signature of everything that changes the pixels.
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

// ── palette ──
const C = {
  plate: "#171a22",
  plateHi: "#2b303b",
  steel: "#6b7688",
  steelHi: "#8a94a6",
  steelDk: "#3a3f4b",
  gold: "#f0a63c",
  skin: "#c98d63",
  skinDk: "#9c6a45",
  skinLo: "#7a5236",
  blood: "#a83244",
  bloodHi: "#d95763",
  white: "#eef1f5",
  pupil: "#1a1c22",
};

/** Fill a rectangle in GRID cells. */
function cell(gx: number, gy: number, gw: number, gh: number, color: string): void {
  if (!ctx) return;
  ctx.fillStyle = color;
  ctx.fillRect(gx * SCALE, gy * SCALE, gw * SCALE, gh * SCALE);
}

function paint(): void {
  if (!ctx) return;
  const expr = exprNow();
  const tier = tierOf();
  ctx.clearRect(0, 0, PX, PX);

  // Backing plate (steel, riveted like the Wolf bar).
  const grd = ctx.createLinearGradient(0, 0, 0, PX);
  grd.addColorStop(0, C.plateHi);
  grd.addColorStop(1, C.plate);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, PX, PX);
  cell(0, 0, GRID, 1, C.steelHi); // top rivet ridge
  cell(0, 0, 1, GRID, C.steelDk);
  cell(GRID - 1, 0, 1, GRID, C.steelDk);

  // Helmet dome + side guards.
  cell(4, 1, 12, 3, C.steel);
  cell(5, 0, 10, 1, C.steelHi);
  cell(4, 1, 12, 1, C.steelHi);
  cell(3, 3, 2, 11, C.steel); // left guard
  cell(15, 3, 2, 11, C.steel); // right guard
  cell(3, 3, 1, 11, C.steelHi);
  cell(9, 1, 2, 3, C.gold); // nasal crest on the helm
  cell(9, 1, 1, 3, C.gold);

  // Face skin.
  cell(5, 4, 10, 10, C.skin);
  cell(5, 12, 10, 2, C.skinDk); // jaw shadow
  cell(5, 4, 10, 1, C.skinDk); // brow-line shade

  // Brow — lowers (angrier) as the fight wears on / winces.
  const browY = expr === "wince" || tier === "dying" || tier === "bloodied" ? 6 : 5;
  cell(5, browY, 4, 1, C.skinLo);
  cell(11, browY, 4, 1, C.skinLo);

  // Eyes.
  const shut = blinkFor > 0 || expr === "dead";
  const px = Math.round(lookX); // -1,0,1
  const py = Math.round(lookY * 0.5);
  if (expr === "dead") {
    // X-eyes.
    drawX(6, 7);
    drawX(12, 7);
  } else if (shut) {
    cell(6, 8, 3, 1, C.skinLo);
    cell(11, 8, 3, 1, C.skinLo);
  } else {
    const squint = expr === "wince" || tier === "dying";
    const eh = squint ? 1 : 2;
    const ey = squint ? 8 : 7;
    cell(6, ey, 3, eh, C.white);
    cell(11, ey, 3, eh, C.white);
    // pupils, offset by the glance.
    cell(7 + px, ey, 1, eh, C.pupil);
    cell(12 + px, ey, 1, eh, C.pupil);
    // fear at death's door: wide whites, tiny darting pupils already handled by squint off
    if (tier === "dying" && expr !== "wince") {
      cell(6, ey - 1, 3, 1, C.white);
      cell(11, ey - 1, 3, 1, C.white);
    }
    void py;
  }

  // Nose.
  cell(9, 9, 2, 2, C.skinDk);
  cell(9, 9, 1, 2, C.skinLo);

  // Mouth by expression.
  paintMouth(expr);

  // Blood / battle damage grows with the tier.
  paintDamage(tier);

  // Reaction tint wash.
  if (painT > 0) tint(`rgba(200,40,60,${0.28 * (painT / 0.32)})`);
  else if (healT > 0) tint(`rgba(90,200,120,${0.22 * (healT / 0.42)})`);
  else if (specialT > 0) tint(`rgba(240,200,90,${0.2})`);
}

function paintMouth(expr: ReturnType<typeof exprNow>): void {
  switch (expr) {
    case "grin": // wide toothy
      cell(7, 12, 6, 2, C.skinLo);
      cell(7, 12, 6, 1, C.white);
      break;
    case "smile":
      cell(7, 13, 6, 1, C.skinLo);
      cell(6, 12, 1, 1, C.skinLo);
      cell(13, 12, 1, 1, C.skinLo);
      break;
    case "wince": // gritted grimace
      cell(7, 12, 6, 1, C.white);
      cell(7, 13, 6, 1, C.skinLo);
      for (let i = 7; i < 13; i += 2) cell(i, 12, 1, 1, C.skinLo);
      break;
    case "dead": // slack, tongue out
      cell(8, 12, 4, 2, C.skinLo);
      cell(9, 13, 2, 1, C.bloodHi);
      break;
    case "dying": // pained open mouth
      cell(8, 12, 4, 2, C.skinLo);
      cell(9, 12, 2, 1, C.blood);
      break;
    case "bloodied":
    case "hurt": // flat/tight
      cell(7, 13, 6, 1, C.skinLo);
      break;
    default: // steady / fresh — set jaw
      cell(7, 13, 6, 1, C.skinDk);
      cell(8, 12, 4, 1, C.skinDk);
  }
}

function paintDamage(tier: Expr): void {
  if (tier === "fresh") return;
  // a cheek scratch appears at 'hurt', deepens after.
  cell(5, 9, 2, 1, C.blood);
  if (tier === "steady") return;
  cell(14, 6, 1, 3, C.blood); // brow gash
  if (tier === "hurt") return;
  cell(6, 11, 2, 1, C.bloodHi); // split lip / cheek
  cell(13, 10, 2, 1, C.blood);
  if (tier === "bloodied") return;
  // dying — smeared, sweat/blood over half the face.
  cell(5, 5, 3, 1, C.blood);
  cell(11, 12, 3, 1, C.bloodHi);
  cell(7, 6, 1, 2, C.blood);
}

function drawX(gx: number, gy: number): void {
  cell(gx, gy, 1, 1, C.pupil);
  cell(gx + 2, gy, 1, 1, C.pupil);
  cell(gx + 1, gy + 1, 1, 1, C.pupil);
  cell(gx, gy + 2, 1, 1, C.pupil);
  cell(gx + 2, gy + 2, 1, 1, C.pupil);
}

function tint(rgba: string): void {
  if (!ctx) return;
  ctx.fillStyle = rgba;
  ctx.fillRect(0, 0, PX, PX);
}
