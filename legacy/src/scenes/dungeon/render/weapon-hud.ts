/**
 * WEAPON VIEW-MODEL (2026-07-16 Wolfenstein overhaul).
 *
 * A bottom-centre pixel-art sprite of the weapon in hand — the doom/wolf
 * "gun on screen" read — drawn to a 2D canvas overlay ABOVE the status bar.
 * It bobs while walking and kicks/draws back on attack, so the same action
 * that fires a projectile also animates here. Purely cosmetic: it reads
 * `state.player` + the active weapon each frame and never feeds back into sim.
 *
 * DOM/canvas only (outside the pixel pass, like the HUD). No three.js.
 */
import { state } from "./../state";
import { WEAPONS, type WeaponId } from "./../items";

export interface WeaponHud {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  walkPhase: number;
  dispose(): void;
}

const CW = 280;
const CH = 200;

export function createWeaponHud(container: HTMLElement): WeaponHud {
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  canvas.id = "dungeon-weapon-hud";
  canvas.style.cssText = `
    position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%);
    width: ${CW}px; height: ${CH}px; z-index: 10000;
    image-rendering: pixelated; pointer-events: none; user-select: none;
  `;
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return {
    canvas,
    ctx,
    walkPhase: 0,
    dispose() {
      canvas.remove();
    },
  };
}

/** Blocky filled rect helper (integer pixels keep the pixel-art crisp). */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function updateWeaponHud(h: WeaponHud, dt: number): void {
  const p = state.player;
  const ctx = h.ctx;
  ctx.clearRect(0, 0, CW, CH);
  if (!p || state.fpsActive) return; // the rampage overlay draws its own gun

  const held = state.weaponSlots[state.activeSlot];
  const id: WeaponId = (held?.id as WeaponId) ?? "fists";
  const def = WEAPONS[id];

  // Walk bob: advance the phase only while moving; a gentle vertical + lateral
  // sway sells footfalls without touching the sim.
  const moving = !!p.move && p.momSpeed <= 0;
  if (moving) h.walkPhase += dt * 8.5;
  const bobY = moving ? Math.sin(h.walkPhase) * 3 : Math.sin((h.walkPhase = h.walkPhase * 0.98)) * 0.6;
  const bobX = moving ? Math.cos(h.walkPhase * 0.5) * 3 : 0;

  // Attack kick: attackT counts up from 0 on a swing/shot; a short decaying
  // pulse drives recoil (ranged) or the draw-back (bow) / swing (melee).
  const kick = p.attackT >= 0 ? Math.max(0, 1 - p.attackT / (def.cooldown * 0.6 + 0.12)) : 0;

  ctx.save();
  ctx.translate(bobX, bobY);
  if (def.kind === "ranged") {
    if (id === "bow") drawBow(ctx, kick);
    else if (id === "flamethrower") drawFlamer(ctx, kick, h.walkPhase);
    else drawGun(ctx, kick);
  } else if (id === "fists") {
    drawFists(ctx, kick);
  } else {
    drawMelee(ctx, kick, def.slashColor ?? 0xeef1f5);
  }
  ctx.restore();
}

// ── Per-weapon view-models ───────────────────────────────────────────────────

function drawGun(ctx: CanvasRenderingContext2D, kick: number): void {
  const cx = CW / 2;
  const ky = kick * 12; // recoil punch: barrel jumps up/back
  const baseY = CH - 6 + ky;
  // Grip + slide, centred, rising from the bottom edge.
  px(ctx, cx - 20, baseY - 70, 40, 76, "#2b303b"); // frame
  px(ctx, cx - 16, baseY - 66, 32, 68, "#454f5e"); // lit face
  px(ctx, cx - 12, baseY - 62, 8, 60, "#6b7688"); // catch-light
  // Slide + barrel jutting up.
  px(ctx, cx - 14, baseY - 92, 28, 26, "#171a22");
  px(ctx, cx - 10, baseY - 88, 20, 18, "#3a3f4b");
  px(ctx, cx - 4, baseY - 104, 8, 14, "#171a22"); // muzzle
  // Muzzle flash on the kick.
  if (kick > 0.55) {
    const f = (kick - 0.55) / 0.45;
    px(ctx, cx - 10, baseY - 118 - f * 6, 20, 14, "#fff3c8");
    px(ctx, cx - 6, baseY - 126 - f * 8, 12, 10, "#f0a63c");
  }
}

function drawBow(ctx: CanvasRenderingContext2D, kick: number): void {
  const cx = CW / 2;
  const cy = CH * 0.5;
  const draw = kick; // 1 = fully drawn back
  ctx.strokeStyle = "#6b4a2e";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  // The bow limb — an arc bulging left (held out toward the aim).
  ctx.beginPath();
  ctx.arc(cx + 40, cy, 66, Math.PI * 0.62, Math.PI * 1.38);
  ctx.stroke();
  // Riser highlight.
  ctx.strokeStyle = "#8a5a34";
  ctx.lineWidth = 3;
  ctx.stroke();
  // Bowstring — pulled back toward the archer (right) by the draw amount.
  const tipTopX = cx + 40 + Math.cos(Math.PI * 0.62) * 66;
  const tipTopY = cy + Math.sin(Math.PI * 0.62) * 66;
  const tipBotX = cx + 40 + Math.cos(Math.PI * 1.38) * 66;
  const tipBotY = cy + Math.sin(Math.PI * 1.38) * 66;
  const nockX = cx - 6 + draw * 30;
  ctx.strokeStyle = "#eef1f5";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tipTopX, tipTopY);
  ctx.lineTo(nockX, cy);
  ctx.lineTo(tipBotX, tipBotY);
  ctx.stroke();
  // Nocked arrow, sliding forward as the string releases.
  const ax = nockX;
  px(ctx, ax - 44 + draw * 8, cy - 1, 52, 3, "#c8ccd4"); // shaft
  px(ctx, ax - 50 + draw * 8, cy - 3, 8, 7, "#8a94a6"); // head
  px(ctx, ax + 6, cy - 3, 5, 7, "#d95763"); // fletching
}

function drawFlamer(ctx: CanvasRenderingContext2D, kick: number, phase: number): void {
  const cx = CW / 2;
  const baseY = CH - 4;
  // Tank + nozzle rising from bottom-right.
  px(ctx, cx - 4, baseY - 64, 34, 66, "#3a3f4b");
  px(ctx, cx, baseY - 60, 26, 58, "#556070");
  px(ctx, cx - 22, baseY - 40, 26, 12, "#171a22"); // nozzle barrel
  px(ctx, cx - 30, baseY - 39, 10, 10, "#2b303b");
  if (kick > 0.2) {
    // Flame lick flickering off the nozzle.
    const fl = Math.sin(phase * 3) * 3;
    px(ctx, cx - 48, baseY - 40 + fl, 20, 10, "#f0a63c");
    px(ctx, cx - 62, baseY - 38 - fl, 16, 8, "#d95763");
    px(ctx, cx - 40, baseY - 42, 12, 6, "#fff3c8");
  }
}

function drawMelee(ctx: CanvasRenderingContext2D, kick: number, slashHex: number): void {
  const cx = CW / 2 + 46;
  const baseY = CH; // pivot on the bottom edge; the weapon rises UP into view
  // Swing: the weapon rocks from rest (leaning right) up across on a hit.
  const swing = kick; // 0 rest, 1 full swing
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.rotate(-0.3 - swing * 1.2); // rock up-left through the arc
  // Handle rising upward from the pivot.
  px(ctx, -6, -70, 12, 70, "#6b4a2e");
  px(ctx, -3, -70, 4, 70, "#8a5a34");
  // Blade / head above the grip.
  const col = "#" + (slashHex >>> 0).toString(16).padStart(6, "0");
  px(ctx, -9, -128, 18, 60, col);
  px(ctx, -3, -128, 4, 60, "#ffffff");
  // A little crossguard where blade meets grip.
  px(ctx, -13, -74, 26, 7, "#3a3f4b");
  ctx.restore();
  // A whoosh arc at the peak of the swing.
  if (swing > 0.5) {
    ctx.strokeStyle = `rgba(255,255,255,${(swing - 0.5) * 1.4})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, baseY, 96, Math.PI * 1.12, Math.PI * 1.72);
    ctx.stroke();
  }
}

function drawFists(ctx: CanvasRenderingContext2D, kick: number): void {
  const baseY = CH - 2;
  const punch = kick * 20;
  // Two blocky fists rising from the bottom corners, one jabbing forward.
  px(ctx, CW / 2 - 74, baseY - 46, 40, 46, "#8a5a34");
  px(ctx, CW / 2 - 70, baseY - 42, 32, 20, "#a86a3e");
  px(ctx, CW / 2 + 34, baseY - 46 - punch, 40, 46, "#8a5a34");
  px(ctx, CW / 2 + 38, baseY - 42 - punch, 32, 20, "#a86a3e");
}
