/**
 * 🩸 THE DIABLO/DOOM HUD — a hybrid iso "strategy layer" status bar.
 *
 * A centred, segmented status bar bolted to the bottom of the screen, styled
 * like a DOS shooter's console (Press Start 2P labels, VT323 numbers, hard pixel
 * edges) but carrying the ARPG data an iso game needs. Left→right the segments
 * are, separated by riveted dividers:
 *
 *   SKILLS (Q/E + card) │ WEAPON+AMMO │ LIFE-orb · FACE · MANA-orb │ STATS │ BELT
 *
 * — the Doom numeric cells (AMMO / SCORE / DEPTH / KILLS / RAMPAGE) flanking the
 * Diablo life+mana globes and the shared knight face. A thin strip above carries
 * the transient status pips (combo / ball-ready / targets) on the left and the
 * unified BUFF STRIP (one tile per active power-up, with a countdown) on the
 * right — no more loose floating text.
 *
 * Globes + cooldown rings are canvas, animated every frame by renderDiablo(dt);
 * the numeric cells + buff tiles + pips rebuild in the same loop but only when
 * their content signature changes. Skill/belt tiles rebuild on state.hudDirty.
 */
import { state } from "./state";
import { createFace, renderFace, setFaceHealth } from "./hud-face";
import { createMinimap, renderMinimap, disposeMinimap } from "./hud-minimap";
import { toggleFloorMap } from "./map-overlay";
import { ABILITIES, type AbilityId } from "./abilities";
import { playerMaxHp, playerManaMax } from "./skill-runtime";
import { POTIONS, WEAPONS, type WeaponId } from "./items";
import { ensureWolfFonts } from "./ui";
import { clamp, clamp01 } from "../../utils/math";

const GLOBE_PX = 30; // globe canvas backing size — small so it upscales to CHUNKY pixels

// Pixel typography, shared with the Wolf bar.
// SINGLE quotes: this is interpolated into inline `style="..."` attributes, and
// a double-quoted family name closes the attribute early — every declaration
// after `font-family` is then silently dropped by the parser. See the same note
// in ui.ts; it cost two rounds of "fixing" a rule that was never reaching the
// element.
const PX_LABEL = `'Press Start 2P', ui-monospace, 'SF Mono', monospace`;
const PX_NUM = `'VT323', 'Courier New', ui-monospace, monospace`;

// ── module-held element refs (built once) ──
let panelEl: HTMLDivElement | null = null;
let lifeCtx: CanvasRenderingContext2D | null = null;
let manaCtx: CanvasRenderingContext2D | null = null;
let lifeValEl: HTMLDivElement | null = null;
let manaValEl: HTMLDivElement | null = null;
let pipsEl: HTMLDivElement | null = null;
let buffStripEl: HTMLDivElement | null = null;
let weaponEl: HTMLDivElement | null = null;
let statsEl: HTMLDivElement | null = null;
let beltEls: HTMLDivElement[] = [];
let skillSlots: Array<{ ring: CanvasRenderingContext2D; icon: HTMLDivElement; cost: HTMLDivElement; wrap: HTMLDivElement }> = [];
let cardSlotEl: HTMLDivElement | null = null;
let faceFrameEl: HTMLDivElement | null = null;

let wavePhase = 0;
let lifeRippleT = 0; // >0 = a potion just splashed the life globe
let manaRippleT = 0;
let lastHeaderSig = ""; // repaint guard for the numeric cells + buff strip + pips

/** A potion/spell splash on a globe: a brief amplitude + brightness pulse. */
export function rippleGlobe(which: "life" | "mana"): void {
  if (which === "life") lifeRippleT = 0.5;
  else manaRippleT = 0.5;
}

// FLAT DOS-steel panel (no gradient — gradients read "flash game"), gold rivet.
const STONE_BG = "#14151b";
const CELL_BG = "#211d16"; // flat segment/tile fill
const BRONZE = "linear-gradient(90deg,#3a2a18,#a97a3c 50%,#3a2a18)"; // top rivet only
// A hard 2-tone pixel bevel: bright top-left edge, dark bottom-right edge.
const BEVEL = "inset 2px 2px 0 rgba(230,200,140,0.22), inset -2px -2px 0 rgba(0,0,0,0.7)";

/** Build the Diablo panel once and mount the shared face into its centre. */
export function createDiabloHUD(container: HTMLElement): HTMLDivElement {
  ensureWolfFonts();
  const el = document.createElement("div");
  el.id = "dungeon-hud-diablo";
  el.style.cssText = `
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 10001;
    color: #e8e0cf; font-family: ${PX_NUM};
    background: ${STONE_BG};
    border-top: 3px solid transparent; border-image: ${BRONZE} 1;
    box-shadow: 0 -2px 0 #000, 0 -6px 0 rgba(0,0,0,0.55);
    pointer-events: none; user-select: none;
    transition: transform 0.2s ease-in;
  `;

  // Centred console so the HUD stops stretching edge-to-edge on wide screens.
  const console_ = document.createElement("div");
  console_.style.cssText = `max-width: 1000px; margin: 0 auto; padding: 0 12px`;
  el.appendChild(console_);

  // ── TOP STRIP: transient pips (left) + unified buff strip (right) ──
  const header = document.createElement("div");
  header.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:12px;
    min-height:20px;padding:4px 2px 2px`;
  pipsEl = document.createElement("div");
  pipsEl.style.cssText = `display:flex;gap:5px;align-items:center;flex-wrap:nowrap;overflow:hidden`;
  buffStripEl = document.createElement("div");
  // Stable hook for VERIFY_CHECKLIST harnesses. The strip is otherwise an
  // unlabelled styled div, so a test could only find it by matching CSS — which
  // breaks on any restyle and silently starts asserting nothing.
  buffStripEl.setAttribute("data-buff-strip", "");
  buffStripEl.style.cssText = `display:flex;gap:5px;align-items:center;flex-wrap:nowrap;overflow:hidden`;
  header.appendChild(pipsEl);
  header.appendChild(buffStripEl);
  console_.appendChild(header);

  // ── MAIN ROW: a segmented Doom bar of bordered cells, centred as a block ──
  const row = document.createElement("div");
  row.style.cssText = `display:flex;align-items:stretch;justify-content:center;gap:8px;padding:2px 2px 8px`;
  console_.appendChild(row);

  // Segment 1 — SKILLS (Q / E) + card socket.
  const skills = document.createElement("div");
  skills.style.cssText = `display:flex;gap:6px;align-items:center`;
  skillSlots = [0, 1].map((i) => makeSkillSlot(i === 0 ? "Q" : "E"));
  skills.appendChild(skillSlots[0].wrap);
  skills.appendChild(skillSlots[1].wrap);
  cardSlotEl = makeCardSlot();
  skills.appendChild(cardSlotEl);
  row.appendChild(segmentBox(withLabel("SKILLS", skills)));

  // Segment 2 — WEAPON + AMMO (Doom numeric cell).
  weaponEl = document.createElement("div");
  weaponEl.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:66px;gap:1px`;
  row.appendChild(segmentBox(weaponEl));

  // Segment 3 — LIFE globe | FACE | MANA globe (Diablo core).
  const center = document.createElement("div");
  center.style.cssText = `display:flex;gap:12px;align-items:center;justify-content:center`;
  const lifeGlobe = makeGlobe("LIFE");
  const faceFrame = makeFaceFrame();
  faceFrameEl = faceFrame;
  const manaGlobe = makeGlobe("MANA");
  lifeCtx = lifeGlobe.ctx;
  manaCtx = manaGlobe.ctx;
  lifeValEl = lifeGlobe.val;
  manaValEl = manaGlobe.val;
  center.appendChild(lifeGlobe.wrap);
  center.appendChild(faceFrame);
  center.appendChild(manaGlobe.wrap);
  row.appendChild(segmentBox(center));

  // Segment 4 — STATS (score / depth / kills / rampage) as Doom cells.
  statsEl = document.createElement("div");
  statsEl.style.cssText = `display:grid;grid-template-columns:auto auto;gap:2px 14px;align-items:center`;
  row.appendChild(segmentBox(statsEl));

  // Segment 5 — BELT (4 quick-use slots, keys Shift+1..4).
  const belt = document.createElement("div");
  belt.style.cssText = `display:flex;gap:5px`;
  beltEls = [0, 1, 2, 3].map((i) => makeBeltSlot(i));
  beltEls.forEach((b) => belt.appendChild(b));
  row.appendChild(segmentBox(withLabel("BELT · ⇧1-4", belt)));

  // Segment 6 — MINIMAP. Last in the row so the existing four segments keep
  // their positions. The panel is `pointer-events: none`, so clicking anything
  // in it is normally dead; the minimap is the one exception — re-enable pointer
  // events on just this segment and toggle the full-screen map on click, so the
  // "MAP · M" caption isn't the only way in.
  const mapBox = document.createElement("div");
  mapBox.style.cssText = `width:58px;height:58px`;
  mapBox.appendChild(createMinimap());
  const mapSeg = segmentBox(withLabel("MAP · M", mapBox));
  mapSeg.style.pointerEvents = "auto";
  mapSeg.style.cursor = "pointer";
  mapSeg.addEventListener("click", () => {
    if (state.container) toggleFloorMap(state.container);
  });
  row.appendChild(mapSeg);

  container.appendChild(el);
  panelEl = el;
  lastHeaderSig = "";
  refreshDiablo();
  return el;
}

export function getDiabloEl(): HTMLDivElement | null {
  return panelEl;
}

/** The centre socket the shared face lives in while the Diablo HUD is active. */
export function getDiabloFaceFrame(): HTMLDivElement | null {
  return faceFrameEl;
}

export function disposeDiabloHUD(): void {
  disposeMinimap();
  panelEl?.remove();
  panelEl = null;
  lifeCtx = manaCtx = null;
  lifeValEl = manaValEl = null;
  pipsEl = null;
  buffStripEl = null;
  weaponEl = null;
  statsEl = null;
  beltEls = [];
  skillSlots = [];
  cardSlotEl = null;
  faceFrameEl = null;
  wavePhase = 0;
  lastHeaderSig = "";
}

// ── builders ────────────────────────────────────────────────────

/** A segment framed by a tiny caption underneath (Doom cell label). */
function withLabel(label: string, inner: HTMLElement): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:3px`;
  const cap = document.createElement("div");
  cap.textContent = label;
  cap.style.cssText = `font-family:${PX_LABEL};font-size:7px;letter-spacing:1px;color:#8a7c5e`;
  wrap.appendChild(inner);
  wrap.appendChild(cap);
  return wrap;
}

/** A bordered, bevelled cell that frames a console segment (the Doom-bar boxes). */
function segmentBox(inner: HTMLElement): HTMLDivElement {
  const box = document.createElement("div");
  box.style.cssText = `display:flex;align-items:center;justify-content:center;padding:5px 9px;
    border:2px solid #5a4a2c;box-shadow:${BEVEL};background:${CELL_BG}`;
  box.appendChild(inner);
  return box;
}

function makeGlobe(label: string): { wrap: HTMLDivElement; ctx: CanvasRenderingContext2D; val: HTMLDivElement } {
  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:3px`;
  const box = document.createElement("div");
  box.style.cssText = `position:relative;width:56px;height:56px`;
  const c = document.createElement("canvas");
  c.width = c.height = GLOBE_PX;
  c.style.cssText = `width:56px;height:56px;image-rendering:pixelated;display:block`;
  const val = document.createElement("div");
  val.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    font-family:${PX_NUM};font-size:22px;color:#fff;text-shadow:1px 1px 0 #000,0 0 5px rgba(0,0,0,0.9);pointer-events:none`;
  box.appendChild(c);
  box.appendChild(val);
  const cap = document.createElement("div");
  cap.textContent = label;
  cap.style.cssText = `font-family:${PX_LABEL};font-size:7px;letter-spacing:1px;color:#8a7c5e`;
  wrap.appendChild(box);
  wrap.appendChild(cap);
  return { wrap, ctx: c.getContext("2d")!, val };
}

function makeFaceFrame(): HTMLDivElement {
  const frame = document.createElement("div");
  frame.id = "dungeon-diablo-face-slot";
  frame.style.cssText = `
    width:66px;height:66px;overflow:hidden;
    border:3px solid #a97a3c; box-shadow: ${BEVEL}, 0 0 0 2px #0b0c10;
    background:#0d0b09;`;
  frame.appendChild(createFace());
  return frame;
}

function makeSkillSlot(key: string): { ring: CanvasRenderingContext2D; icon: HTMLDivElement; cost: HTMLDivElement; wrap: HTMLDivElement } {
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:relative;width:42px;height:42px;
    background:#17140e;border:2px solid #5a4a2c;box-shadow:${BEVEL}`;
  const ring = document.createElement("canvas");
  ring.width = ring.height = 42;
  ring.style.cssText = `position:absolute;inset:0;image-rendering:pixelated`;
  const icon = document.createElement("div");
  icon.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:19px`;
  const keyBadge = document.createElement("div");
  keyBadge.textContent = key;
  keyBadge.style.cssText = `position:absolute;left:2px;top:1px;font-family:${PX_LABEL};font-size:7px;color:#e8d9a8;text-shadow:1px 1px 0 #000`;
  const cost = document.createElement("div");
  cost.style.cssText = `position:absolute;right:2px;bottom:0;font-family:${PX_NUM};font-size:14px;line-height:1;color:#6fd0e8;text-shadow:1px 1px 0 #000`;
  wrap.append(ring, icon, keyBadge, cost);
  return { ring: ring.getContext("2d")!, icon, cost, wrap };
}

function makeCardSlot(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `width:28px;height:42px;display:flex;align-items:center;justify-content:center;
    font-size:15px;color:#4a4030;border:2px dashed #4a3c22;background:rgba(0,0,0,0.35)`;
  el.textContent = "◈"; // empty gem socket — the equipped-card seam (Phase 4)
  el.title = "Card socket";
  return el;
}

function makeBeltSlot(i: number): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.belt = String(i);
  el.style.cssText = `position:relative;width:38px;height:38px;
    background:#17140e;border:2px solid #5a4a2c;box-shadow:${BEVEL};
    display:flex;align-items:center;justify-content:center;font-size:19px`;
  return el;
}

/** A Doom-style labelled numeric cell (caption over a big pixel value). */
function statHTML(label: string, value: string, color: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;line-height:1">
      <div style="font-family:${PX_LABEL};font-size:6px;letter-spacing:1px;color:#7a8496">${label}</div>
      <div style="font-family:${PX_NUM};font-size:19px;color:${color};text-shadow:1px 1px 0 #0b0c10">${value}</div>
    </div>`;
}

/** A small bordered status pip (combo / ball-ready / targets). */
function pillHTML(text: string, color: string): string {
  return `<span style="font-family:${PX_LABEL};font-size:7px;letter-spacing:1px;padding:2px 4px;
    border:1px solid ${color};color:${color};background:rgba(0,0,0,0.35)">${text}</span>`;
}

/** One buff tile for the unified strip: icon + a thin depleting bar + seconds. */
function buffTileHTML(b: BuffView): string {
  const frac = clamp01(b.t / b.max);
  const secs = Math.ceil(b.t);
  const expiring = b.t <= 3; // about to run out — warn on the timer + border
  const border = expiring && secs % 2 === 1 ? "#ffd23f" : b.color; // blink amber near the end
  const secColor = expiring ? "#ffd23f" : "#f0e6c8";
  return `<div title="${b.label}" style="position:relative;width:34px;height:34px;
      background:#0d0b09;border:2px solid ${border};box-shadow:${BEVEL};
      display:flex;align-items:center;justify-content:center;font-size:16px">
      ${b.icon}
      <div style="position:absolute;left:2px;right:2px;bottom:2px;height:3px;background:#000">
        <div style="height:100%;width:${frac * 100}%;background:${b.color}"></div>
      </div>
      <div style="position:absolute;top:-1px;right:1px;font-family:${PX_NUM};font-size:13px;line-height:1;font-weight:${expiring ? 900 : 400};
        color:${secColor};text-shadow:1px 1px 0 #000">${secs}</div>
    </div>`;
}

// ── per-frame render (globes + cooldown rings + face + header) ───

/** Advance the liquid + cooldown animations and repaint the face + header. */
export function renderDiablo(dt: number): void {
  if (!panelEl) return;
  // Cheap: renderMinimap early-outs unless something it draws actually changed.
  renderMinimap();
  wavePhase += dt * 3.4;
  const p = state.player;

  lifeRippleT = Math.max(0, lifeRippleT - dt);
  manaRippleT = Math.max(0, manaRippleT - dt);
  const lifeLvl = p ? Math.max(0, p.hp) / playerMaxHp() : 0;
  const manaLvl = p ? clamp(p.mana, 0, playerManaMax()) / playerManaMax() : 0;
  if (lifeCtx) drawGlobe(lifeCtx, lifeLvl, wavePhase, "#e0455a", "#5a0e17", lifeLvl <= 0.25, lifeRippleT);
  if (manaCtx) drawGlobe(manaCtx, manaLvl, wavePhase * 0.85 + 2, "#5aa9e6", "#141a4a", manaLvl <= 0.15, manaRippleT);
  // Live numeric readouts over the globes (HP hearts, whole mana).
  if (lifeValEl) {
    const hp = Math.max(0, Math.ceil(p?.hp ?? 0));
    lifeValEl.textContent = String(hp);
    lifeValEl.style.color = lifeLvl <= 0.25 ? "#ff6a7a" : "#fff";
  }
  if (manaValEl) manaValEl.textContent = String(Math.floor(manaLvl * playerManaMax()));

  // Skill cooldown sweeps.
  for (let i = 0; i < skillSlots.length; i++) {
    const id = state.abilitySlots[i];
    drawCooldownRing(skillSlots[i].ring, id);
  }

  paintHeader();

  setFaceHealth(p?.hp ?? 0, playerMaxHp());
  renderFace(dt);
}

/**
 * A FLAT, chunky-pixel liquid orb (Wolfenstein/VGA, not a glossy Flash sphere):
 * a solid two-tone fill with a blocky wavy waterline, a hard pixel highlight,
 * CRT scanlines and a hard 2px rim. Rendered at a tiny backing res so the CSS
 * upscale (image-rendering:pixelated) makes every pixel read chunky.
 */
function drawGlobe(ctx: CanvasRenderingContext2D, level: number, phase: number, top: string, bot: string, critical: boolean, ripple = 0): void {
  const S = GLOBE_PX; // ~30
  const r = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.clip();

  // Empty glass (flat).
  ctx.fillStyle = "#0a0a10";
  ctx.fillRect(0, 0, S, S);

  const amp = (critical ? 2.0 : 1.1) + ripple * 5;
  const surfaceY = (1 - level) * S;
  // Liquid — a SOLID top colour with a blocky sine waterline (no gradient).
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(0, S);
  for (let x = 0; x <= S; x += 2) {
    const y = Math.round(surfaceY + Math.sin(x * 0.55 + phase) * amp);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(S, S);
  ctx.closePath();
  ctx.fill();
  // Darker flat band in the lower third (2-tone, reads retro).
  ctx.fillStyle = bot;
  ctx.fillRect(0, Math.max(Math.round(surfaceY), Math.round(S * 0.6)), S, S);

  // Bright blocky waterline.
  if (level > 0.03 && level < 0.98) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let x = 0; x <= S; x += 2) {
      const y = Math.round(surfaceY + Math.sin(x * 0.55 + phase) * amp);
      ctx.fillRect(x, y, 2, 1);
    }
  }
  // Hard pixel highlight glint (top-left), NOT a soft ellipse.
  ctx.fillStyle = "rgba(255,255,255,0.20)";
  ctx.fillRect(Math.round(r * 0.55), Math.round(r * 0.5), 3, 2);
  // CRT scanlines.
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let y = 0; y < S; y += 2) ctx.fillRect(0, y, S, 1);
  // Splash flash.
  if (ripple > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 * (ripple / 0.5)})`;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.restore();

  // Hard rim: 2px black + 1px bronze inner.
  ctx.strokeStyle = "#0b0c10";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#a97a3c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(r, r, r - 2.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCooldownRing(ctx: CanvasRenderingContext2D, id: AbilityId | null): void {
  const S = 42;
  ctx.clearRect(0, 0, S, S);
  if (!id) return;
  const def = ABILITIES[id];
  const cd = state.abilityCd[id] ?? 0;
  const affordable = (state.player?.mana ?? 0) >= def.cost && cd <= 0;

  ctx.strokeStyle = affordable ? def.color : "rgba(90,74,44,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, S - 4, S - 4);

  if (cd > 0) {
    const frac = Math.min(1, cd / def.cooldown);
    ctx.fillStyle = "rgba(6,6,10,0.66)";
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.arc(S / 2, S / 2, S, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  }
}

// ── header: pips + weapon/ammo + stats + buff strip (per-frame, sig-guarded) ──

interface BuffView {
  key: string;
  icon: string;
  color: string;
  t: number; // seconds remaining
  max: number; // full duration (for the depleting bar)
  label: string;
}

/** Every active power-up on the player right now, richest-context first. */
function activeBuffs(): BuffView[] {
  const p = state.player;
  const out: BuffView[] = [];
  if (!p) return out;
  const add = (t: number, key: string, icon: string, color: string, max: number, label: string): void => {
    if (t > 0.05) out.push({ key, icon, color, t, max, label });
  };
  add(p.rageT, "rage", "💢", "#d97b29", POTIONS.rage.duration, `Rage · ${POTIONS.rage.description}`);
  add(p.hasteT, "haste", "⚡", "#6fd0e8", POTIONS.haste.duration, `Haste · ${POTIONS.haste.description}`);
  add(p.shieldT, "shield", "🛡️", "#8fc46b", POTIONS.shield.duration, `Shield · ${POTIONS.shield.description}`);
  // Ball Form sets ironT+turboT+springT together, but the Speed Witch and the
  // flipper-charge ability raise turboT ALONE — keying the tile off turboT
  // labelled both of those "Ball Form". Require the ram core, and give the
  // speed-only case its own honest tile.
  add(p.ironT, "ball", "🪩", "#f0a63c", POTIONS.ballform.duration, `Ball Form · ${POTIONS.ballform.description}`);
  if (p.ironT <= 0.05) add(p.turboT, "turbo", "💨", "#6fd0e8", POTIONS.ballform.duration, "Turbo · frictionless momentum");
  add(state.freezeT, "freeze", "❄️", "#bfe8ff", POTIONS.freeze.duration, "Freeze · the horde is stopped");
  add(p.multiBallT, "multiball", "🔮", "#b06fe8", POTIONS.multiball.duration, `Multi-Ball · ${POTIONS.multiball.description}`);
  add(p.curveT, "curve", "🌀", "#6fd0e8", POTIONS.curveshot.duration, `Curve Shot · ${POTIONS.curveshot.description}`);
  add(p.magBootsT, "boots", "🧲", "#a83244", POTIONS.magnetboots.duration, `Magnet Boots · ${POTIONS.magnetboots.description}`);
  // ── Marble material (entities/marble.ts) — the "what the ball is made of" axis.
  // Inlined tile meta (icon/colour/max/label) to avoid an import cycle. ──
  if (p.material) {
    const M: Record<string, { icon: string; color: string; max: number; label: string }> = {
      diamond: { icon: "💎", color: "#6fd0e8", max: 20, label: "Diamond Marble · elastic; fires shards on bounce/slam" },
      water: { icon: "💧", color: "#4aa6d0", max: 16, label: "Water Marble · fast & slippery; lays a slick trail" },
      stone: { icon: "🪨", color: "#9aa4b4", max: 24, label: "Stone Marble · heavy; shockwaves + boulder slam" },
      storm: { icon: "⚡", color: "#f0e05a", max: 16, label: "Storm Marble · rails corridors; lightning arcs + thunderclap" },
    };
    const m = M[p.material];
    if (m) add(p.materialT, `mat-${p.material}`, m.icon, m.color, m.max, m.label);
  }
  // ── Craft-only brews (recipes.ts) ──
  add(p.regenT, "regen", "🧪", "#8fd46b", POTIONS.regen.duration, `Regen Salve · ${POTIONS.regen.description}`);
  add(p.venomCoatT, "venomcoat", "☠️", "#a83fd0", POTIONS.venomcoat.duration, `Venom Coat · ${POTIONS.venomcoat.description}`);
  add(p.stoneT, "stoneskin", "🪨", "#9a8f77", POTIONS.stoneskin.duration, `Stoneskin · ${POTIONS.stoneskin.description}`);
  add(p.staticT, "static", "⚡", "#f0e05a", POTIONS.static.duration, `Static Charge · ${POTIONS.static.description}`);
  add(p.greedT, "greed", "💰", "#ffd98a", POTIONS.greed.duration, `Greed Draught · ${POTIONS.greed.description}`);
  add(state.slowT, "timecrawl", "⏳", "#bfe8ff", 3, "Time Crawl · slowed horde");
  add(p.bladeStormT, "blades", "🌪️", "#d95763", 5, "Blade Storm · orbiting blades");
  add(p.magnetAuraT, "aura", "🧲", "#6fd0e8", 4, "Magnet Aura · pulling loot");
  add(p.webbedT, "webbed", "🕸️", "#eef1f5", 3, "Webbed · slowed");
  return out;
}

/** Repaint the header (pips + weapon/ammo + stats + buff strip) on change only. */
function paintHeader(): void {
  if (!weaponEl || !statsEl || !buffStripEl || !pipsEl) return;
  const p = state.player;
  const buffs = activeBuffs();

  // WEAPON + AMMO (mirrors the Wolf bar's readout, iso-side).
  const held = state.weaponSlots[state.activeSlot];
  const w = held ? WEAPONS[held.id as WeaponId] : null;
  const ammo = held ? String(held.durability) : "∞";
  const ammoColor = !held ? "#8fc46b" : held.durability <= 3 ? "#d95763" : w?.kind === "ranged" ? "#ffd98a" : "#c8ccd4";
  const wIcon = w ? w.icon : "✊";
  const wName = w ? w.label.toUpperCase() : "FISTS";

  // STATS (Doom numeric cells).
  const pct = Math.round(state.ultCharge * 100);
  const rampage = state.ultCharge >= 1 ? "R!" : `${pct}%`;
  const rampageColor = state.ultCharge >= 1 ? "#ffd98a" : "#6b7688";

  // Transient pips (only when active, so the strip stays quiet otherwise).
  const pips: string[] = [];
  const combo = p?.bounceCombo ?? 0;
  if (combo >= 2) pips.push(pillHTML(`×${combo} COMBO`, "#ffd23f"));
  if ((p?.overcharge ?? 0) >= 0.999) pips.push(pillHTML("◉ BALL READY", "#6fd0e8"));
  if (state.targetsTotal > 0) {
    const done = state.targetsHit >= state.targetsTotal;
    pips.push(pillHTML(`🎯 ${state.targetsHit}/${state.targetsTotal}`, done ? "#8fc46b" : "#d95763"));
  }

  // Rebuild only on a content change (ceil-seconds granularity for buff timers).
  const sig = [
    wIcon, wName, ammo,
    state.goldRun, state.level, state.kills, rampage,
    combo, (p?.overcharge ?? 0) >= 0.999 ? 1 : 0, state.targetsHit, state.targetsTotal,
    buffs.map((b) => `${b.key}:${Math.ceil(b.t)}`).join(","),
  ].join("|");
  if (sig === lastHeaderSig) return;
  lastHeaderSig = sig;

  weaponEl.innerHTML =
    `<div style="font-family:${PX_LABEL};font-size:6px;letter-spacing:1px;color:#7a8496">AMMO</div>` +
    `<div style="font-family:${PX_NUM};font-size:26px;line-height:0.8;color:${ammoColor};text-shadow:1px 1px 0 #0b0c10">${ammo}</div>` +
    `<div style="font-family:${PX_LABEL};font-size:7px;color:#bfae86;white-space:nowrap;margin-top:2px">${wIcon} ${wName}</div>`;

  statsEl.innerHTML =
    statHTML("SCORE", String(state.goldRun), "#ffd98a") +
    statHTML("DEPTH", String(state.level), "#f0a63c") +
    statHTML("KILLS", String(state.kills), "#8fc46b") +
    statHTML("RAMPAGE", rampage, rampageColor);

  pipsEl.innerHTML = pips.join("");
  buffStripEl.innerHTML = buffs.map(buffTileHTML).join("");
}

// ── discrete content refresh (on hudDirty) ──────────────────────

/** Repaint the belt tiles + skill icons/affordability. */
export function refreshDiablo(): void {
  if (!panelEl) return;
  const p = state.player;

  for (let i = 0; i < skillSlots.length; i++) {
    const s = skillSlots[i];
    const id = state.abilitySlots[i];
    if (!id) {
      s.icon.textContent = "";
      s.cost.textContent = "";
      continue;
    }
    const def = ABILITIES[id];
    const cd = state.abilityCd[id] ?? 0;
    const affordable = (p?.mana ?? 0) >= def.cost && cd <= 0;
    s.icon.textContent = def.icon;
    s.icon.style.opacity = affordable ? "1" : "0.4";
    s.cost.textContent = String(def.cost);
    s.cost.style.color = (p?.mana ?? 0) >= def.cost ? "#6fd0e8" : "#8a94a6";
    s.wrap.title = `${def.label} — ${def.detail} (${def.cost} mana)`;
  }

  for (let i = 0; i < beltEls.length; i++) {
    const el = beltEls[i];
    const slot = state.belt[i];
    el.innerHTML = "";
    if (!slot) {
      el.style.opacity = "0.5";
      const hint = document.createElement("span");
      hint.textContent = String(i + 1);
      hint.style.cssText = `font-family:${PX_LABEL};font-size:8px;color:#4a4030`;
      el.appendChild(hint);
      continue;
    }
    el.style.opacity = "1";
    const ic = document.createElement("span");
    ic.textContent = slot.icon;
    el.appendChild(ic);
    if (slot.count > 1) {
      const badge = document.createElement("span");
      badge.textContent = String(slot.count);
      badge.style.cssText = `position:absolute;right:1px;bottom:0;font-family:${PX_NUM};font-size:14px;line-height:1;color:#f0e6c8;text-shadow:1px 1px 0 #000`;
      el.appendChild(badge);
    }
    const key = document.createElement("span");
    key.textContent = String(i + 1);
    key.style.cssText = `position:absolute;left:2px;top:0;font-family:${PX_LABEL};font-size:7px;color:#8a7c5e`;
    el.appendChild(key);
  }
}
