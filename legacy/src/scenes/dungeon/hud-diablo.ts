/**
 * 🩸 THE DIABLO HUD — the isometric "strategy layer" panel.
 *
 * A full-width carved-stone bar bolted to the bottom of the screen: two liquid
 * globes (LIFE left, MANA right) flanking the shared knight face, the two Q/E
 * skill slots with cooldown sweeps on the left, and the quick-use BELT on the
 * right. It's the counterpart to the Wolfenstein bar (hud-wolf) that takes over
 * during a rampage; the face canvas is the same DOM element shared between them.
 *
 * Globes + cooldown rings are canvas, animated every frame by renderDiablo(dt).
 * The discrete content (belt tiles, skill affordability, rail text) only rebuilds
 * on state.hudDirty via refreshDiablo().
 */
import { state } from "./state";
import { createFace, renderFace, setFaceHealth } from "./hud-face";
import { ABILITIES, type AbilityId } from "./abilities";
import { PLAYER_MAX_HP, MANA_MAX } from "./constants";

const GLOBE_PX = 84; // globe canvas backing size

// ── module-held element refs (built once) ──
let panelEl: HTMLDivElement | null = null;
let lifeCtx: CanvasRenderingContext2D | null = null;
let manaCtx: CanvasRenderingContext2D | null = null;
let railEl: HTMLDivElement | null = null;
let beltEls: HTMLDivElement[] = [];
let skillSlots: Array<{ ring: CanvasRenderingContext2D; icon: HTMLDivElement; cost: HTMLDivElement; wrap: HTMLDivElement }> = [];
let cardSlotEl: HTMLDivElement | null = null;
let faceFrameEl: HTMLDivElement | null = null;

let wavePhase = 0;
let lifeRippleT = 0; // >0 = a potion just splashed the life globe
let manaRippleT = 0;

/** A potion/spell splash on a globe: a brief amplitude + brightness pulse. */
export function rippleGlobe(which: "life" | "mana"): void {
  if (which === "life") lifeRippleT = 0.5;
  else manaRippleT = 0.5;
}

const STONE_BG = "linear-gradient(180deg,#2a2622 0%,#1a1714 55%,#0d0b09 100%)";
const BRONZE = "linear-gradient(90deg,#3a2a18,#a97a3c 50%,#3a2a18)";

/** Build the Diablo panel once and mount the shared face into its centre. */
export function createDiabloHUD(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-hud-diablo";
  el.style.cssText = `
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 10001;
    color: #e8e0cf; font: 12px ui-monospace,"SF Mono",monospace;
    background: ${STONE_BG};
    border-top: 3px solid transparent; border-image: ${BRONZE} 1;
    box-shadow: 0 -2px 0 #000, 0 -8px 20px rgba(0,0,0,0.7), inset 0 3px 0 rgba(255,220,150,0.05);
    pointer-events: none; user-select: none;
    transition: transform 0.2s ease-in;
  `;

  // Live rail strip (combo / buffs / rampage / targets) above the columns.
  railEl = document.createElement("div");
  railEl.style.cssText = `min-height:14px;padding:4px 16px 0;display:flex;gap:14px;align-items:center;
    font-size:10px;letter-spacing:1px;color:#c9bfa6;overflow:hidden`;
  el.appendChild(railEl);

  const row = document.createElement("div");
  row.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 18px 8px`;
  el.appendChild(row);

  // ── LEFT: skill slots (Q / E) + card socket ──
  const left = document.createElement("div");
  left.style.cssText = `display:flex;gap:8px;align-items:center;min-width:0`;
  skillSlots = [0, 1].map((i) => makeSkillSlot(i === 0 ? "Q" : "E"));
  left.appendChild(skillSlots[0].wrap);
  left.appendChild(skillSlots[1].wrap);
  cardSlotEl = makeCardSlot();
  left.appendChild(cardSlotEl);
  row.appendChild(left);

  // ── CENTER: life globe | face | mana globe ──
  const center = document.createElement("div");
  center.style.cssText = `display:flex;gap:10px;align-items:center;justify-content:center`;
  const lifeGlobe = makeGlobe("LIFE");
  const faceFrame = makeFaceFrame();
  faceFrameEl = faceFrame;
  const manaGlobe = makeGlobe("MANA");
  lifeCtx = lifeGlobe.ctx;
  manaCtx = manaGlobe.ctx;
  center.appendChild(lifeGlobe.wrap);
  center.appendChild(faceFrame);
  center.appendChild(manaGlobe.wrap);
  row.appendChild(center);

  // ── RIGHT: belt (4 quick-use slots, keys Shift+1..4) ──
  const right = document.createElement("div");
  right.style.cssText = `display:flex;flex-direction:column;gap:3px;align-items:flex-end`;
  const beltLabel = document.createElement("div");
  beltLabel.textContent = "BELT · shift+1–4";
  beltLabel.style.cssText = `font-size:8px;letter-spacing:1px;color:#8a7c5e`;
  right.appendChild(beltLabel);
  const beltRow = document.createElement("div");
  beltRow.style.cssText = `display:flex;gap:5px`;
  beltEls = [0, 1, 2, 3].map((i) => makeBeltSlot(i));
  beltEls.forEach((b) => beltRow.appendChild(b));
  right.appendChild(beltRow);
  row.appendChild(right);

  container.appendChild(el);
  panelEl = el;
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
  railEl = null;
  beltEls = [];
  skillSlots = [];
  cardSlotEl = null;
  faceFrameEl = null;
  wavePhase = 0;
}

// ── builders ────────────────────────────────────────────────────

function makeGlobe(label: string): { wrap: HTMLDivElement; ctx: CanvasRenderingContext2D } {
  const wrap = document.createElement("div");
  wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:2px`;
  const c = document.createElement("canvas");
  c.width = c.height = GLOBE_PX;
  c.style.cssText = `width:58px;height:58px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6))`;
  const cap = document.createElement("div");
  cap.textContent = label;
  cap.style.cssText = `font-size:8px;letter-spacing:1px;color:#8a7c5e`;
  wrap.appendChild(c);
  wrap.appendChild(cap);
  return { wrap, ctx: c.getContext("2d")! };
}

function makeFaceFrame(): HTMLDivElement {
  const frame = document.createElement("div");
  frame.id = "dungeon-diablo-face-slot";
  frame.style.cssText = `
    width:64px;height:64px;border-radius:6px;overflow:hidden;
    border:3px solid #a97a3c; box-shadow: inset 0 0 8px rgba(0,0,0,0.8), 0 0 0 2px #1a1714;
    background:#0d0b09;`;
  frame.appendChild(createFace());
  return frame;
}

function makeSkillSlot(key: string): { ring: CanvasRenderingContext2D; icon: HTMLDivElement; cost: HTMLDivElement; wrap: HTMLDivElement } {
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:relative;width:44px;height:44px;border-radius:6px;
    background:radial-gradient(circle at 50% 35%,#26221c,#0d0b09);
    border:2px solid #5a4a2c;box-shadow:inset 0 0 6px rgba(0,0,0,0.7)`;
  const ring = document.createElement("canvas");
  ring.width = ring.height = 44;
  ring.style.cssText = `position:absolute;inset:0`;
  const icon = document.createElement("div");
  icon.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px`;
  const keyBadge = document.createElement("div");
  keyBadge.textContent = key;
  keyBadge.style.cssText = `position:absolute;left:2px;top:1px;font-size:8px;color:#e8d9a8;text-shadow:1px 1px 0 #000`;
  const cost = document.createElement("div");
  cost.style.cssText = `position:absolute;right:2px;bottom:1px;font-size:8px;color:#6fd0e8;text-shadow:1px 1px 0 #000`;
  wrap.append(ring, icon, keyBadge, cost);
  return { ring: ring.getContext("2d")!, icon, cost, wrap };
}

function makeCardSlot(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `width:30px;height:44px;border-radius:5px;display:flex;align-items:center;justify-content:center;
    font-size:16px;color:#4a4030;border:2px dashed #4a3c22;background:rgba(0,0,0,0.35)`;
  el.textContent = "◈"; // empty gem socket — the equipped-card seam (Phase 4)
  el.title = "Card socket";
  return el;
}

function makeBeltSlot(i: number): HTMLDivElement {
  const el = document.createElement("div");
  el.dataset.belt = String(i);
  el.style.cssText = `position:relative;width:38px;height:38px;border-radius:5px;
    background:radial-gradient(circle at 50% 30%,#26221c,#0d0b09);
    border:2px solid #5a4a2c;box-shadow:inset 0 0 5px rgba(0,0,0,0.7);
    display:flex;align-items:center;justify-content:center;font-size:19px`;
  return el;
}

// ── per-frame render (globes + cooldown rings + face) ───────────

/** Advance the liquid + cooldown animations and repaint the face. */
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

  // Skill cooldown sweeps.
  for (let i = 0; i < skillSlots.length; i++) {
    const id = state.abilitySlots[i];
    drawCooldownRing(skillSlots[i].ring, id);
  }

  setFaceHealth(p?.hp ?? 0, PLAYER_MAX_HP);
  renderFace(dt);
}

function drawGlobe(ctx: CanvasRenderingContext2D, level: number, phase: number, top: string, bot: string, critical: boolean, ripple = 0): void {
  const S = GLOBE_PX;
  const r = S / 2;
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  // circular clip
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.clip();

  // empty-glass backdrop
  ctx.fillStyle = "#0a0a10";
  ctx.fillRect(0, 0, S, S);

  // liquid fill with a sine surface — a potion splash briefly cranks the wave.
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

  // bright surface line
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

  // glass gloss
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(r * 0.7, r * 0.62, r * 0.4, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // potion-splash brightness flash
  if (ripple > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.4 * (ripple / 0.5)})`;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.restore();

  // stone rim
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
  const S = 44;
  ctx.clearRect(0, 0, S, S);
  if (!id) return;
  const def = ABILITIES[id];
  const cd = state.abilityCd[id] ?? 0;
  const affordable = (state.player?.mana ?? 0) >= def.cost && cd <= 0;

  // ready-glow border tinted by the ability colour
  ctx.strokeStyle = affordable ? def.color : "rgba(90,74,44,0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(2, 2, S - 4, S - 4, 5);
  ctx.stroke();

  // cooldown wedge (dark, sweeping clockwise from top)
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

// ── discrete content refresh (on hudDirty) ──────────────────────

/** Repaint the belt tiles, skill icons/affordability and rail text. */
export function refreshDiablo(): void {
  if (!panelEl) return;
  const p = state.player;

  // Skill slots: icon + cost + dim-when-unaffordable.
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

  // Belt tiles.
  for (let i = 0; i < beltEls.length; i++) {
    const el = beltEls[i];
    const slot = state.belt[i];
    el.innerHTML = "";
    if (!slot) {
      el.style.opacity = "0.5";
      const hint = document.createElement("span");
      hint.textContent = String(i + 1);
      hint.style.cssText = `font-size:9px;color:#4a4030`;
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
      badge.style.cssText = `position:absolute;right:1px;bottom:0;font-size:9px;font-weight:900;color:#f0e6c8;text-shadow:1px 1px 0 #000`;
      el.appendChild(badge);
    }
    const key = document.createElement("span");
    key.textContent = String(i + 1);
    key.style.cssText = `position:absolute;left:2px;top:0;font-size:8px;color:#8a7c5e`;
    el.appendChild(key);
  }

  if (railEl) railEl.innerHTML = railText();
}

function railText(): string {
  const p = state.player;
  const bits: string[] = [];
  const combo = p?.bounceCombo ?? 0;
  if (combo >= 2) bits.push(`<span style="color:#ffd23f;font-weight:900">×${combo} COMBO</span>`);
  const over = Math.max(0, Math.min(1, p?.overcharge ?? 0));
  if (over >= 0.999) bits.push(`<span style="color:#6fd0e8">◉ BALL READY</span>`);
  if (state.slowT > 0) bits.push(`<span style="color:#bfe8ff">⏳ TIME CRAWL ${Math.ceil(state.slowT)}s</span>`);
  if (p && p.bladeStormT > 0) bits.push(`<span style="color:#d95763">🌪️ BLADES ${Math.ceil(p.bladeStormT)}s</span>`);
  if (p && p.magnetAuraT > 0) bits.push(`<span style="color:#6fd0e8">🧲 AURA ${Math.ceil(p.magnetAuraT)}s</span>`);
  if (p && p.rageT > 0) bits.push(`<span style="color:#d97b29">💢 RAGE ${Math.ceil(p.rageT)}s</span>`);
  if (p && p.hasteT > 0) bits.push(`<span style="color:#6fd0e8">⚡ HASTE ${Math.ceil(p.hasteT)}s</span>`);
  if (p && p.shieldT > 0) bits.push(`<span style="color:#8fc46b">🛡️ SHIELD ${Math.ceil(p.shieldT)}s</span>`);
  // rampage charge chip
  const pct = Math.round(state.ultCharge * 100);
  bits.push(state.ultCharge >= 1 ? `<span style="color:#ffd98a">🔫 RAMPAGE — R</span>` : `<span style="color:#6b7688">🔫 ${pct}%</span>`);
  if (state.targetsTotal > 0) {
    const done = state.targetsHit >= state.targetsTotal;
    bits.push(`<span style="color:${done ? "#8fc46b" : "#d95763"}">🎯 ${state.targetsHit}/${state.targetsTotal}</span>`);
  }
  return bits.join(`<span style="color:#4a4030">·</span>`);
}
