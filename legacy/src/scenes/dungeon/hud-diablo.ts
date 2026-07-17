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
import { ABILITIES, type AbilityId } from "./abilities";
import { PLAYER_MAX_HP, MANA_MAX } from "./constants";
import { POTIONS, WEAPONS, type WeaponId } from "./items";
import { ensureWolfFonts } from "./ui";

const GLOBE_PX = 84; // globe canvas backing size

// Pixel typography, shared with the Wolf bar.
const PX_LABEL = `'Press Start 2P', ui-monospace, "SF Mono", monospace`;
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

// Flat DOS-steel, gold rivet line — matches the Wolf bar's palette.
const STONE_BG = "linear-gradient(180deg,#24262e 0%,#16171d 60%,#0b0c10 100%)";
const BRONZE = "linear-gradient(90deg,#3a2a18,#a97a3c 50%,#3a2a18)";
// A hard pixel bevel: bright top-left, dark bottom-right, no blur.
const BEVEL = "inset 2px 2px 0 rgba(255,220,150,0.14), inset -2px -2px 0 rgba(0,0,0,0.65)";

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

/** Slide the panel off (down) / on (up) — used by the HUD swap on rampage. */
export function showDiabloHUD(on: boolean): void {
  if (panelEl) panelEl.style.transform = on ? "translateY(0)" : "translateY(110%)";
}

export function disposeDiabloHUD(): void {
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
    border:2px solid #5a4a2c;box-shadow:${BEVEL};
    background:linear-gradient(180deg,rgba(38,34,26,0.5),rgba(13,11,9,0.55))`;
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
    background:linear-gradient(180deg,#26221c,#0d0b09);
    border:2px solid #5a4a2c;box-shadow:${BEVEL}`;
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
    background:linear-gradient(180deg,#26221c,#0d0b09);
    border:2px solid #5a4a2c;box-shadow:${BEVEL};
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
  const frac = Math.max(0, Math.min(1, b.t / b.max));
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
  wavePhase += dt * 3.4;
  const p = state.player;

  lifeRippleT = Math.max(0, lifeRippleT - dt);
  manaRippleT = Math.max(0, manaRippleT - dt);
  const lifeLvl = p ? Math.max(0, p.hp) / PLAYER_MAX_HP : 0;
  const manaLvl = p ? Math.max(0, Math.min(MANA_MAX, p.mana)) / MANA_MAX : 0;
  if (lifeCtx) drawGlobe(lifeCtx, lifeLvl, wavePhase, "#e0455a", "#5a0e17", lifeLvl <= 0.25, lifeRippleT);
  if (manaCtx) drawGlobe(manaCtx, manaLvl, wavePhase * 0.85 + 2, "#5aa9e6", "#141a4a", manaLvl <= 0.15, manaRippleT);
  // Live numeric readouts over the globes (HP hearts, whole mana).
  if (lifeValEl) {
    const hp = Math.max(0, Math.ceil(p?.hp ?? 0));
    lifeValEl.textContent = String(hp);
    lifeValEl.style.color = lifeLvl <= 0.25 ? "#ff6a7a" : "#fff";
  }
  if (manaValEl) manaValEl.textContent = String(Math.floor(manaLvl * MANA_MAX));

  // Skill cooldown sweeps.
  for (let i = 0; i < skillSlots.length; i++) {
    const id = state.abilitySlots[i];
    drawCooldownRing(skillSlots[i].ring, id);
  }

  paintHeader();

  setFaceHealth(p?.hp ?? 0, PLAYER_MAX_HP);
  renderFace(dt);
}

function drawGlobe(ctx: CanvasRenderingContext2D, level: number, phase: number, top: string, bot: string, critical: boolean, ripple = 0): void {
  const S = GLOBE_PX;
  const r = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "#0a0a10";
  ctx.fillRect(0, 0, S, S);

  const amp = (critical ? 4.2 : 2.2) + ripple * 12;
  const surfaceY = (1 - level) * S;
  const grd = ctx.createLinearGradient(0, surfaceY, 0, S);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bot);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(0, S);
  for (let x = 0; x <= S; x += 3) {
    const y = surfaceY + Math.sin(x * 0.16 + phase) * amp + Math.sin(x * 0.07 - phase * 0.6) * amp * 0.5;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(S, S);
  ctx.closePath();
  ctx.fill();

  if (level > 0.02 && level < 0.99) {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= S; x += 3) {
      const y = surfaceY + Math.sin(x * 0.16 + phase) * amp + Math.sin(x * 0.07 - phase * 0.6) * amp * 0.5;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(r * 0.7, r * 0.62, r * 0.4, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
  if (ripple > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.4 * (ripple / 0.5)})`;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.restore();

  ctx.strokeStyle = "#a97a3c";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(r, r, r - 4, 0, Math.PI * 2);
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
  add(p.rageT, "rage", "💢", "#d97b29", POTIONS.rage.duration, "Rage · 2× damage");
  add(p.hasteT, "haste", "⚡", "#6fd0e8", POTIONS.haste.duration, "Haste · faster");
  add(p.shieldT, "shield", "🛡️", "#8fc46b", POTIONS.shield.duration, "Shield · invulnerable");
  add(p.turboT, "ball", "🪩", "#f0a63c", POTIONS.ballform.duration, "Ball Form · ram + steer + spring");
  add(p.multiT, "multi", "🔮", "#b06fe8", POTIONS.multiball.duration, "Multi-Ball · ghost knights");
  add(state.freezeT, "freeze", "❄️", "#bfe8ff", POTIONS.freeze.duration, "Freeze · the horde is stopped");
  add(p.curveT, "curve", "🌀", "#6fd0e8", POTIONS.curveshot.duration, "Curve Shot · bending projectiles");
  add(p.magBootsT, "boots", "🧲", "#a83244", POTIONS.magnetboots.duration, "Magnet Boots · repel + strip launch");
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
