/**
 * In-game HUD, toasts and the game-over screen.
 *
 * These are DOM overlays, so they sit OUTSIDE the pixel pipeline and aren't
 * quantized. Styled to match the palette so they don't clash with the art.
 */
import { state, WEAPON_SLOTS } from "./state";
import { SPRINT_RIDE_THRESHOLD, BOOTS_SPEED_FACTOR } from "./constants";
import { playerMaxHp } from "./skill-runtime";
import { WEAPONS, GEAR, GEAR_SLOTS, type WeaponId } from "./items";
import { ensurePixelFonts } from "./pixel-fonts";
import { clamp, clamp01 } from "../../utils/math";
import { loadBestDepth } from "./best-depth";
import { getPlayerName, setPlayerName, NAME_MAX } from "../../services/player-name";

/**
 * !! SINGLE QUOTES, DELIBERATELY !!
 *
 * These are interpolated into inline `style="..."` attributes. A family name in
 * DOUBLE quotes ("SF Mono") closes the attribute early, so the browser parses
 * `style="font:700 13px ui-monospace, "` and silently discards EVERY declaration
 * after the font shorthand. That is what hid the buff row's white-space:nowrap
 * for two rounds of "fixing" it — the rule was in the source and never reached
 * the element. Keep font-family names single-quoted anywhere they can end up in
 * an attribute.
 */
const FONT = `700 13px ui-monospace, 'SF Mono', Menlo, monospace`;
/**
 * Header/toast face. Was Georgia serif (SOTN-gothic); switched 2026-07-15 to the
 * same heavily-tracked monospace the HUD uses so titles read "arcade cabinet"
 * and stay self-contained (no Google-Fonts network dependency / load flash).
 * Name kept as SERIF to avoid churning every call site.
 */
const SERIF = `700 13px ui-monospace, 'SF Mono', Menlo, monospace`;
/** Big display face for the depth-title toast — tracked mono, small-caps. */
const DISPLAY = `900 34px ui-monospace, 'SF Mono', Menlo, monospace`;

// ── Wolfenstein HUD faces (2026-07-16 overhaul) ──────────────────────────────
// Blocky pixel labels + a tall pixel numeral face, both from Google Fonts with
// a hard monospace fallback so an offline / NAS boot still reads cleanly (no
// blank flash — the fallback shows immediately, the pixel font swaps in if it
// loads). Injected once by ensureWolfFonts().
const WOLF_LABEL = `'Press Start 2P', ui-monospace, 'SF Mono', monospace`;
const WOLF_NUM = `'VT323', 'Courier New', ui-monospace, monospace`;

// The pixel fonts are self-hosted (base64 woff2, no network) — see pixel-fonts.ts.
// Kept the ensureWolfFonts name so every existing call site still works.
export function ensureWolfFonts(): void {
  ensurePixelFonts();
}

// Wolfenstein concrete palette — dark steel with a gold rivet line, sharp text.
const WOLF_BG = "linear-gradient(180deg, #24262e 0%, #14151a 60%, #0b0c10 100%)";
const WOLF_TOP = "linear-gradient(90deg,#3a3f4b,#8a94a6 50%,#3a3f4b)"; // rivet ridge

/**
 * The Wolfenstein status bar (2026-07-16 overhaul): a full-width dark-steel
 * panel bolted to the bottom of the screen with a riveted top edge, holding
 * SCORE · DEPTH/KILLS · HEALTH · AMMO · WEAPON in blocky pixel type. A thin
 * strip above the columns carries the live gameplay rails (sprint spool,
 * overcharge, buffs, rampage) that the gothic panel used to stack — nothing
 * is dropped, it just lies flat. updateHUD fills #dungeon-hud-body each frame.
 */
export function createHUD(container: HTMLElement): HTMLDivElement {
  ensureWolfFonts();
  const el = document.createElement("div");
  el.id = "dungeon-hud";
  el.style.cssText = `
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 10001;
    font-family: ${WOLF_LABEL}; color: #e8ebf0;
    background: ${WOLF_BG};
    border-top: 3px solid transparent;
    border-image: ${WOLF_TOP} 1;
    box-shadow: 0 -2px 0 #0b0c10, 0 -6px 16px rgba(0,0,0,0.6), inset 0 3px 0 rgba(255,255,255,0.04);
    pointer-events: none; user-select: none;
  `;
  // The gold rivet hairline just under the steel ridge.
  const rivet = document.createElement("div");
  rivet.style.cssText = `position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,#6b4a2e 20%,#f0a63c 50%,#6b4a2e 80%,transparent);`;
  el.appendChild(rivet);
  const body = document.createElement("div");
  body.id = "dungeon-hud-body";
  el.appendChild(body);
  container.appendChild(el);
  return el;
}

/** A labelled Wolfenstein column: small pixel caption over a tall value. */
function wolfCell(label: string, value: string, color: string): string {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;padding:0 4px">
      <div style="font-family:${WOLF_LABEL};font-size:8px;letter-spacing:1px;color:#7a8496;margin-bottom:5px">${label}</div>
      <div style="font-family:${WOLF_NUM};font-size:30px;line-height:0.8;color:${color};text-shadow:2px 2px 0 #0b0c10;white-space:nowrap">${value}</div>
    </div>`;
}

/**
 * The RAMPAGE overlay: a Doom-style crosshair and a chunky gun barrel jutting
 * up from the bottom-centre, plus a red vignette so the whole screen reads
 * "power mode". A DOM overlay (outside the pixel pass), shown only while the
 * first-person rampage is active. Built once, toggled with setFpsOverlay.
 */
export function createFpsOverlay(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-fps-overlay";
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10002; display: none;
    pointer-events: none; user-select: none;
    box-shadow: inset 0 0 220px 40px rgba(168, 50, 68, 0.35);
  `;
  el.innerHTML = `
    <style>@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }</style>
    <!-- crosshair -->
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
                width:26px;height:26px;">
      <div style="position:absolute;left:12px;top:0;width:2px;height:9px;background:#ffd98a;box-shadow:0 0 3px #000"></div>
      <div style="position:absolute;left:12px;bottom:0;width:2px;height:9px;background:#ffd98a;box-shadow:0 0 3px #000"></div>
      <div style="position:absolute;top:12px;left:0;height:2px;width:9px;background:#ffd98a;box-shadow:0 0 3px #000"></div>
      <div style="position:absolute;top:12px;right:0;height:2px;width:9px;background:#ffd98a;box-shadow:0 0 3px #000"></div>
    </div>
    <!-- gun barrel rising from the bottom, pixel-blocky -->
    <div id="dungeon-fps-gun" style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);
                width:120px;height:150px;transition:transform 0.09s ease-out;">
      <div style="position:absolute;left:34px;bottom:0;width:52px;height:150px;
                  background:linear-gradient(90deg,#2b303b,#6b7688 45%,#8a94a6 55%,#2b303b);
                  border:3px solid #171a22;border-bottom:none;"></div>
      <div style="position:absolute;left:44px;bottom:120px;width:32px;height:34px;
                  background:linear-gradient(90deg,#171a22,#454f5e 50%,#171a22);
                  border:3px solid #171a22;border-radius:4px 4px 0 0;"></div>
      <!-- muzzle flash -->
      <div id="dungeon-fps-flash" style="position:absolute;left:50%;bottom:150px;transform:translateX(-50%);
                  width:46px;height:46px;display:none;
                  background:radial-gradient(circle,#fff3c8,#f0a63c 45%,transparent 70%);"></div>
    </div>
    <!-- kill-streak combo readout, upper-right -->
    <div id="dungeon-fps-streak" style="position:absolute;right:40px;top:90px;text-align:right;
                display:none;font:900 38px ui-monospace, 'SF Mono', Menlo, monospace;
                color:#ffd98a;text-shadow:0 0 12px rgba(217,123,41,0.9),2px 2px 0 #0b0d12;
                letter-spacing:1px;line-height:0.9;"></div>
  `;
  container.appendChild(el);
  return el;
}

/** Ranks for the kill-streak readout — the higher you climb, the hotter it reads. */
const STREAK_RANKS: Array<[number, string, string]> = [
  [3, "TRIPLE", "#8fc46b"],
  [5, "RAMPAGE", "#6fd0e8"],
  [8, "CARNAGE", "#f0a63c"],
  [12, "SLAUGHTER", "#d95763"],
  [18, "GODLIKE", "#fff3c8"],
];

/**
 * Update the on-screen combo readout for the current kill-streak. Hidden below
 * 2; above that it shows "×N" plus a rank word that escalates. A quick scale
 * pop each call (via inline transition) sells each fresh frag.
 */
export function updateFpsStreak(el: HTMLDivElement | null, streak: number): void {
  if (!el) return;
  const node = el.querySelector("#dungeon-fps-streak") as HTMLDivElement | null;
  if (!node) return;
  if (streak < 2) {
    node.style.display = "none";
    return;
  }
  let rank = "DOUBLE";
  let color = "#c8ccd4";
  for (const [n, word, c] of STREAK_RANKS) {
    if (streak >= n) { rank = word; color = c; }
  }
  node.style.display = "block";
  node.style.color = color;
  node.innerHTML = `<div style="font-size:52px">×${streak}</div><div style="font-size:22px;letter-spacing:3px">${rank}</div>`;
  // pop
  node.style.transition = "none";
  node.style.transform = "scale(1.35)";
  requestAnimationFrame(() => {
    node.style.transition = "transform 0.18s ease-out";
    node.style.transform = "scale(1)";
  });
}

/** Show/hide the rampage overlay. */
export function setFpsOverlay(el: HTMLDivElement | null, on: boolean): void {
  if (el) el.style.display = on ? "block" : "none";
}

/** Escalating word + colour for the on-screen bounce-combo flash. */
const COMBO_RANKS: Array<[number, string, string]> = [
  [2, "COMBO", "#ffd23f"],
  [4, "NICE", "#8fc46b"],
  [6, "SLICK", "#6fd0e8"],
  [9, "WILD", "#f0a63c"],
  [13, "INSANE", "#d95763"],
];

/**
 * A centred "×N" flash that pops on every bounce-combo STEP (the pinball
 * counterpart to the FPS kill-streak readout). Built once; flashBounceCombo
 * pops + fades it. Kept separate from the HUD's static combo tag so each fresh
 * bounce actually reads as an escalating hit, not a quiet number ticking up.
 */
export function createComboFlash(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-combo-flash";
  ensureWolfFonts();
  el.style.cssText = `
    position: fixed; left: 50%; top: 120px; transform: translateX(-50%) scale(1);
    z-index: 10001; text-align: center; opacity: 0; display: none;
    pointer-events: none; user-select: none;
    font-family: ${WOLF_NUM}; line-height: 0.9;
    text-shadow: 0 0 8px rgba(255,210,63,0.7), 2px 2px 0 #0b0d12;
  `;
  container.appendChild(el);
  return el;
}

let comboFlashTimer = 0;
export function flashBounceCombo(el: HTMLDivElement | null, combo: number): void {
  if (!el || combo < 2) return;
  let word = "COMBO";
  let color = "#ffd23f";
  for (const [n, w, c] of COMBO_RANKS) {
    if (combo >= n) { word = w; color = c; }
  }
  el.style.color = color;
  el.innerHTML = `<div style="font-family:${WOLF_NUM};font-size:26px">×${combo}</div>` +
    `<div style="font-family:${WOLF_LABEL};font-size:9px;letter-spacing:2px;margin-top:2px">${word}</div>`;
  el.style.display = "block";
  el.style.transition = "none";
  el.style.opacity = "1";
  el.style.transform = `translateX(-50%) scale(${Math.min(1.25, 1.0 + combo * 0.015)})`;
  requestAnimationFrame(() => {
    el.style.transition = "transform 0.16s ease-out, opacity 0.5s ease-out 0.22s";
    el.style.transform = "translateX(-50%) scale(1)";
    el.style.opacity = "0";
  });
  // Hide after the fade so a stale flash can't linger over the next floor.
  window.clearTimeout(comboFlashTimer);
  comboFlashTimer = window.setTimeout(() => { el.style.display = "none"; }, 800);
}

// Fix 2 — RAGNAROK-style floating combo numbers. Instead of one static centred
// counter, every fresh bounce spawns a small bold "×N" at the knight's SCREEN
// position that floats up, shrinks and fades — and stacks with an upward
// waterfall offset so a fast chain reads as a spray of rising numbers. Tier
// colour escalates (white → yellow → orange → red/gold) with a brief screen
// shake on the big ones. Caller passes the projected screen pixels (camera.ts
// worldToScreenPx) so this module stays DOM-only.
let floatComboActive = 0;
export function spawnFloatingCombo(combo: number, sx: number, sy: number): void {
  if (!state.container || combo < 2) return;
  ensureWolfFonts();
  const color = combo >= 10 ? "#ffcf3f" : combo >= 6 ? "#f0a63c" : combo >= 3 ? "#ffe066" : "#eef1f5";
  const stack = floatComboActive; // waterfall: each live number starts higher
  floatComboActive++;
  const jitterX = (Math.random() * 2 - 1) * 8;
  const startY = sy - stack * 12;
  const size = 18 + Math.min(18, combo); // bigger chains punch bigger numbers
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; left: ${sx + jitterX}px; top: ${startY}px;
    transform: translate(-50%,-50%) scale(1); z-index: 10001;
    pointer-events: none; user-select: none; white-space: nowrap;
    font-family: ${WOLF_NUM}; font-size: ${size}px; line-height: 1;
    color: ${color}; text-shadow: 0 0 7px ${color}99, 2px 2px 0 #0b0d12;
    opacity: 1; transition: transform 0.8s ease-out, opacity 0.8s ease-out;
  `;
  el.textContent = `×${combo}`;
  state.container.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = "translate(-50%,-50%) translateY(-40px) scale(0.7)";
    el.style.opacity = "0";
  });
  window.setTimeout(() => {
    el.remove();
    floatComboActive = Math.max(0, floatComboActive - 1);
  }, 820);
  if (combo >= 6) state.shakeT = Math.max(state.shakeT, combo >= 10 ? 0.22 : 0.12);
}

/**
 * The overlord boss bar: a classic wide health bar pinned to the top-centre of
 * the screen, shown only while the mini-boss is alive. Built once, appended to
 * the container; updateBossBar drives its fill + visibility each frame.
 */
export function createBossBar(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-boss-bar";
  el.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 10001; width: 420px; display: none;
    pointer-events: none; user-select: none; text-align: center;
  `;
  el.innerHTML = `
    <div style="font:900 14px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:3px;color:#d95763;
                text-shadow:0 0 8px rgba(217,87,99,0.8),1px 1px 0 #0b0d12;margin-bottom:3px">
      ☠ THE OVERLORD ☠
    </div>
    <div style="height:12px;background:#0b0d12;border:2px solid #6b1f2a;
                box-shadow:0 0 8px rgba(217,87,99,0.5)">
      <div id="dungeon-boss-fill" style="height:100%;width:100%;
           background:linear-gradient(90deg,#6b1f2a,#a83244 50%,#d95763)"></div>
    </div>`;
  container.appendChild(el);
  return el;
}

/** Drive the boss bar: pass the boss's hp/maxHp, or null when no boss is alive. */
export function updateBossBar(el: HTMLDivElement | null, hp: number | null, maxHp: number | null): void {
  if (!el) return;
  if (hp === null || maxHp === null || hp <= 0) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  const fill = el.querySelector("#dungeon-boss-fill") as HTMLDivElement | null;
  if (fill) fill.style.width = `${clamp((hp / maxHp) * 100, 0, 100)}%`;
}

/**
 * THE PLUNGER meter — shown while the floor is parked awaiting launch. A prompt
 * teaches the pull, and a power bar fills as the player draws the plunger back.
 */
export function createPlungerMeter(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-plunger";
  el.style.cssText = `
    position: fixed; bottom: 120px; left: 50%; transform: translateX(-50%);
    z-index: 10001; width: 300px; display: none;
    pointer-events: none; user-select: none; text-align: center;
  `;
  el.innerHTML = `
    <div id="dungeon-plunger-prompt"
         style="font:900 12px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:2px;color:#ffd23f;
                text-shadow:0 0 8px rgba(255,210,63,0.7),1px 1px 0 #0b0d12;margin-bottom:5px;white-space:nowrap">
      HOLD [SPACE] — PULL BACK, RELEASE TO LAUNCH · ←/→ AIM
    </div>
    <div style="height:14px;background:#0b0d12;border:2px solid #7a5a12;
                box-shadow:0 0 8px rgba(255,210,63,0.4)">
      <div id="dungeon-plunger-fill" style="height:100%;width:0%;
           background:linear-gradient(90deg,#7a5a12,#e0a020 55%,#ffe27a)"></div>
    </div>`;
  container.appendChild(el);
  return el;
}

/** Drive the plunger meter from the live state each frame. */
export function updatePlungerMeter(el: HTMLDivElement | null): void {
  if (!el) return;
  if (!state.plungerArmed) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  const fill = el.querySelector("#dungeon-plunger-fill") as HTMLDivElement | null;
  if (fill) fill.style.width = `${clamp(state.plungerPower * 100, 0, 100)}%`;
  const prompt = el.querySelector("#dungeon-plunger-prompt") as HTMLDivElement | null;
  if (prompt) {
    prompt.textContent = state.plungerCharging
      ? "RELEASE [SPACE] TO LAUNCH · ←/→ AIM"
      : "HOLD [SPACE] — PULL BACK, RELEASE TO LAUNCH · ←/→ AIM";
  }
}

/** Blip the muzzle flash + kick the gun barrel down for one shot's recoil. */
export function flashFpsMuzzle(el: HTMLDivElement | null): void {
  if (!el) return;
  const f = el.querySelector("#dungeon-fps-flash") as HTMLDivElement | null;
  const gun = el.querySelector("#dungeon-fps-gun") as HTMLDivElement | null;
  if (f) {
    f.style.display = "block";
    window.setTimeout(() => { f.style.display = "none"; }, 55);
  }
  if (gun) {
    // punch the barrel down + back, then it eases back up (recoil)
    gun.style.transition = "none";
    gun.style.transform = "translateX(-50%) translateY(14px) scale(0.97)";
    requestAnimationFrame(() => {
      gun.style.transition = "transform 0.11s ease-out";
      gun.style.transform = "translateX(-50%) translateY(0) scale(1)";
    });
  }
}

/** ▮▮▮▯▯-style durability meter. */
function meter(value: number, max: number, color: string, blocks = 10): string {
  const filled = clamp(Math.ceil((value / max) * blocks), 0, blocks);
  return (
    `<span style="color:${color}">${"▮".repeat(filled)}</span>` +
    `<span style="color:#2b303b">${"▮".repeat(blocks - filled)}</span>`
  );
}

/** Buff-strip chip data for each marble material (inlined to avoid an import
 *  cycle through entities/marble → combat → ui). Mirror of MATERIALS meta. */
const MATERIAL_CHIP: Record<string, { icon: string; label: string; color: string }> = {
  diamond: { icon: "💎", label: "DIAMOND", color: "#6fd0e8" },
  water: { icon: "💧", label: "WATER", color: "#4aa6d0" },
  stone: { icon: "🪨", label: "STONE", color: "#9aa4b4" },
};

export function updateHUD(el: HTMLDivElement): void {
  const hp = Math.max(0, state.player?.hp ?? 0);
  const hearts =
    `<span style="color:#d95763">${"♥".repeat(hp)}</span>` +
    `<span style="color:#2b303b">${"♥".repeat(Math.max(0, playerMaxHp() - hp))}</span>`;

  // Sprint spool (the 3s Shift ramp) — a thin blue rail that turns gold once
  // the charge passes the wall-ride threshold, so "the ride is armed" reads at
  // a glance. Hidden entirely at zero charge to keep the HUD quiet when walking.
  const spool = clamp01(state.player?.sprintCharge ?? 0);
  const spoolArmed = spool >= SPRINT_RIDE_THRESHOLD;
  const spoolRow =
    spool > 0.01
      ? `
    <div style="height:3px;margin-top:2px;background:#2b303b;border:1px solid #454f5e;position:relative">
      <div style="height:100%;width:${spool * 100}%;background:${spoolArmed ? "#ffd23f" : "#5aa9e6"};transition:width 0.08s linear"></div>
      <div style="position:absolute;left:${SPRINT_RIDE_THRESHOLD * 100}%;top:-1px;bottom:-1px;width:1px;background:#8a94a6"></div>
    </div>`
      : "";

  // Overcharge (pinball) — appears only once the spool is full and overflowing.
  // A hot orange→cyan rail; at 100% it pulses to read "BALL FORM ARMED". A live
  // bounce COMBO count rides alongside it once you're ricocheting (the Sonic
  // reward — chain wall hits, watch it climb).
  const over = clamp01(state.player?.overcharge ?? 0);
  const overFull = over >= 0.999;
  const combo = state.player?.bounceCombo ?? 0;
  const comboTag = combo >= 2 ? ` <span style="color:#ffd23f;font-weight:900">×${combo} COMBO</span>` : "";
  const overRow =
    over > 0.01
      ? `
    <div style="height:3px;margin-top:1px;background:#2b303b;border:1px solid #6b1f2a;position:relative">
      <div style="height:100%;width:${over * 100}%;background:${overFull ? "#6fd0e8" : "#f0a63c"};box-shadow:${overFull ? "0 0 5px #6fd0e8" : "none"};transition:width 0.08s linear"></div>
    </div><div style="font-size:8px;letter-spacing:1px;color:#6fd0e8">${overFull ? "◉ BALL READY" : ""}${comboTag}</div>`
      : combo >= 2
        ? `<div style="font-size:9px;letter-spacing:1px;color:#ffd23f;font-weight:900">×${combo} BOUNCE COMBO</div>`
        : "";

  // The ACTIVE weapon → the AMMO + WEAPON columns. Ranged shows real ammo,
  // melee shows remaining durability (its "shots"), fists are unbreakable (∞).
  const activeHeld = state.weaponSlots[state.activeSlot];
  const activeW = activeHeld ? WEAPONS[activeHeld.id as WeaponId] : null;
  const ammoVal = activeHeld ? `${activeHeld.durability}` : "∞";
  const ammoColor = !activeHeld ? "#8fc46b" : activeHeld.durability <= 3 ? "#d95763" : activeW?.kind === "ranged" ? "#ffd98a" : "#c8ccd4";
  const weaponName = activeW ? `${activeW.icon} ${activeW.label.toUpperCase()}` : "✊ FISTS";
  // The other slot, shown small so a swap (1/2) still reads.
  const otherSlot = 1 - state.activeSlot;
  const otherHeld = state.weaponSlots[otherSlot];
  const otherW = otherHeld ? WEAPONS[otherHeld.id as WeaponId] : null;
  const swapChip = `<span style="color:#5a6270">[${otherSlot + 1}] ${otherW ? otherW.icon + " " + otherW.label : "—"}</span>`;

  // Worn gear (helmet/armor/boots) → a compact icon strip in the WEAPON cell.
  const gearChips = GEAR_SLOTS.map((slot) => {
    const def = GEAR[slot];
    const dur = state.gear[slot];
    if (dur === undefined) return "";
    // Soak gear shows its remaining durability; boots soak nothing, so show
    // the speed bonus they actually grant instead of a bare, meaningless icon.
    return def.absorb > 0 ? `${def.icon}${dur}` : `${def.icon}+${Math.round((BOOTS_SPEED_FACTOR - 1) * 100)}%`;
  }).filter(Boolean).join(" ");

  // Active potion buffs, with a ticking seconds countdown. Only shown while
  // one is running, so the HUD stays quiet the rest of the time.
  const p = state.player;
  const buffs: string[] = [];
  if (p && p.rageT > 0) buffs.push(`<span style="color:#d97b29">💢 RAGE ${Math.ceil(p.rageT)}s</span>`);
  if (p && p.hasteT > 0) buffs.push(`<span style="color:#6fd0e8">⚡ HASTE ${Math.ceil(p.hasteT)}s</span>`);
  if (p && p.shieldT > 0) buffs.push(`<span style="color:#8fc46b">🛡️ SHIELD ${Math.ceil(p.shieldT)}s</span>`);
  // Ball Form drives iron/turbo/spring together, so key the chip off the RAM
  // core (ironT), not off turboT. The flipper-charge ability raises turboT
  // ALONE, and keying off it labelled that "Ball Form" too — you'd read that you
  // had the whole pinball fantasy when all you had was frictionless momentum.
  // `hud-diablo.ts:472-474` already fixed this; the rampage bar had not.
  if (p && p.ironT > 0) buffs.push(`<span style="color:#f0a63c">🪩 BALL FORM ${Math.ceil(p.ironT)}s</span>`);
  else if (p && p.turboT > 0) buffs.push(`<span style="color:#6fd0e8">💨 TURBO ${Math.ceil(p.turboT)}s</span>`);
  if (p && p.material && p.materialT > 0) {
    const m = MATERIAL_CHIP[p.material];
    const fuse = p.fuseT > 0 && p.fuseMaterial ? ` +${MATERIAL_CHIP[p.fuseMaterial].icon}` : "";
    buffs.push(`<span style="color:${m.color}">${m.icon} ${m.label} ${Math.ceil(p.materialT)}s${fuse}</span>`);
  }
  if (p && p.multiBallT > 0) buffs.push(`<span style="color:#b06fe8">🔮 MULTI-BALL ${Math.ceil(p.multiBallT)}s</span>`);
  if (p && p.curveT > 0) buffs.push(`<span style="color:#6fd0e8">🌀 CURVE ${Math.ceil(p.curveT)}s</span>`);
  if (p && p.magBootsT > 0) buffs.push(`<span style="color:#a83244">🧲 BOOTS ${Math.ceil(p.magBootsT)}s</span>`);
  if (state.freezeT > 0) buffs.push(`<span style="color:#bfe8ff">❄️ FROZEN ${Math.ceil(state.freezeT)}s</span>`);
  if (p && p.webbedT > 0) buffs.push(`<span style="color:#eef1f5">🕸️ WEBBED</span>`);
  // The Q/E ability buffs. The Diablo strip has always tiled these
  // (hud-diablo.ts:478-480) but this bar did not, so entering a rampage with a
  // Blade Storm running made it vanish from the HUD while it was still very much
  // active. The section is called the UNIFIED buff strip; the two HUDs should
  // not disagree about what is on you.
  if (state.slowT > 0) buffs.push(`<span style="color:#bfe8ff">⏳ TIME CRAWL ${Math.ceil(state.slowT)}s</span>`);
  if (p && p.bladeStormT > 0) buffs.push(`<span style="color:#d95763">🌪️ BLADES ${Math.ceil(p.bladeStormT)}s</span>`);
  if (p && p.magnetAuraT > 0) buffs.push(`<span style="color:#6fd0e8">🧲 AURA ${Math.ceil(p.magnetAuraT)}s</span>`);
  // ONE LINE, clipped. The buffs are joined inline, and without `nowrap` a run
  // with five or more active (rage + haste + ball form + curve + boots is an
  // ordinary mid-floor state) wrapped onto a second line. That grew the top
  // strip past its min-height and pushed it down over the Targets row and the
  // SCORE/DEPTH/KILLS cells beneath — the rampage HUD rendered with its own text
  // sliced through. Matches the Diablo strip, which is already nowrap+hidden.
  const buffRow = buffs.length
    ? `<div style="font:${SERIF};letter-spacing:1px;margin-top:2px;white-space:nowrap;overflow:hidden;min-width:0;flex:0 1 auto">${buffs.join("&nbsp;&nbsp;")}</div>`
    : "";

  // The floor's target objective — only shown when the floor has targets.
  const targetsRow =
    state.targetsTotal > 0
      ? `<div style="font:${SERIF};letter-spacing:2px"><span style="color:#6b7688;font-variant:small-caps">Targets</span> <span style="color:${state.targetsHit >= state.targetsTotal ? "#8fc46b" : "#d95763"}">🎯 ${state.targetsHit}/${state.targetsTotal}</span></div>`
      : "";

  // RAMPAGE: a compact charge chip for the top strip (the old panel had a full
  // bar; here it's one rail among many).
  const pct = Math.round(state.ultCharge * 100);
  const full = state.ultCharge >= 1;
  const ultChip = state.fpsActive
    ? `<span style="color:#d95763">🔫 RAMPAGE ${Math.ceil(state.fpsTimer)}s</span>`
    : full
      ? `<span style="color:#ffd98a;animation:pulse 0.8s infinite">🔫 RAMPAGE — R</span>`
      : `<span style="color:#6b7688">🔫 ${pct}%</span>`;

  // HEALTH cell: a big Wolfenstein numeric %, red at low HP, hearts beneath.
  const hpPct = Math.round((hp / playerMaxHp()) * 100);
  const hpColor = hp <= 1 ? "#d95763" : hp <= 2 ? "#f0a63c" : "#8fc46b";
  const healthCell = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 6px">
      <div style="font-family:${WOLF_LABEL};font-size:8px;letter-spacing:1px;color:#7a8496;margin-bottom:5px">HEALTH</div>
      <div style="font-family:${WOLF_NUM};font-size:32px;line-height:0.7;color:${hpColor};text-shadow:2px 2px 0 #0b0c10">${hpPct}%</div>
      <div style="font-size:11px;letter-spacing:1px;margin-top:3px">${hearts}</div>
    </div>`;

  // WEAPON cell: icon + name, with the swap chip + worn gear beneath.
  const weaponCell = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 6px">
      <div style="font-family:${WOLF_LABEL};font-size:8px;letter-spacing:1px;color:#7a8496;margin-bottom:5px">WEAPON</div>
      <div style="font-family:${WOLF_LABEL};font-size:11px;color:#e8ebf0;text-shadow:1px 1px 0 #0b0c10;white-space:nowrap">${weaponName}</div>
      <div style="font:${SERIF};font-size:10px;margin-top:5px;color:#8a94a6">${swapChip}${gearChips ? `&nbsp;&nbsp;${gearChips}` : ""}</div>
    </div>`;

  const sep = `<div style="width:2px;align-self:stretch;margin:8px 0;background:linear-gradient(180deg,transparent,#3a3f4b 50%,transparent)"></div>`;
  // Thin labelled rail wrapper for the strip (empty inner → nothing shown).
  const railSeg = (label: string, inner: string): string =>
    inner ? `<div style="min-width:78px"><span style="color:#5a6270;font-size:8px;letter-spacing:1px">${label}</span>${inner}</div>` : "";

  const body = (el.querySelector("#dungeon-hud-body") as HTMLDivElement) ?? el;
  // NOTE: the top strip carries white-space:nowrap on the STRIP, not on
  // individual rows. It is a flex row, so when its contents outgrow the width
  // every item is squeezed and each wraps its own TEXT onto a second line. That
  // grew the strip past its min-height and pushed it down through the Targets
  // row and the SCORE/DEPTH/KILLS cells below, so the rampage HUD rendered with
  // its own text sliced through. Setting nowrap on just the buff row fixed only
  // that row — Targets still broke into "ARGETS" / "/5". Inheriting from the
  // parent covers every child, and overflow:hidden clips the tail cleanly.
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:5px 18px 0;min-height:16px;font:${SERIF};font-size:10px;letter-spacing:1px;color:#c8ccd4;overflow:hidden;white-space:nowrap">
      ${ultChip}
      ${targetsRow}
      ${buffRow}
      <div style="flex:1"></div>
      ${railSeg("SPRINT", spoolRow)}
      ${railSeg("CHARGE", overRow)}
    </div>
    <div style="display:flex;align-items:stretch;justify-content:center;gap:4px;padding:4px 18px 10px;max-width:1120px;margin:0 auto">
      ${wolfCell("SCORE", `${state.goldRun}`, "#ffd98a")}
      ${sep}
      ${wolfCell("DEPTH", `${state.level}`, "#f0a63c")}
      ${wolfCell("KILLS", `${state.kills}`, "#8fc46b")}
      ${sep}
      ${healthCell}
      ${sep}
      ${wolfCell("AMMO", ammoVal, ammoColor)}
      ${sep}
      ${weaponCell}
    </div>
  `;
}

/** Big centred text that fades out — "DEPTH 2", "MACE BROKE", etc. */
// Fix 1 — a SINGLE toast slot. Toasts are full-screen centred overlays, so two
// alive at once render on top of each other (the "SECRET WALL SMASHED" pile-up
// when you smash several walls in a chain). Keep exactly one: a new toast
// evicts the old one first, cancelling its pending fade/remove timers.
let activeToast: HTMLDivElement | null = null;
let toastHideTimer = 0;
let toastRemoveTimer = 0;

export function showToast(text: string, subtext = ""): void {
  if (!state.container) return;
  // Evict any live toast immediately so messages never stack/overlap.
  if (activeToast) {
    window.clearTimeout(toastHideTimer);
    window.clearTimeout(toastRemoveTimer);
    activeToast.remove();
    activeToast = null;
  }
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10001;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    pointer-events: none; user-select: none;
    font: ${DISPLAY}; letter-spacing: 7px;
    font-variant: small-caps;
    color: #f0a63c; text-shadow: 0 0 18px rgba(240,166,60,0.45), 2px 2px 0 #0b0d12;
    opacity: 0; transition: opacity 0.25s ease;
  `;
  const flourish = `
    <div style="display:flex;align-items:center;gap:10px;width:280px;margin:6px 0">
      <span style="flex:1;height:1px;background:linear-gradient(90deg,transparent,#f0a63c)"></span>
      <span style="width:7px;height:7px;background:#f0a63c;transform:rotate(45deg)"></span>
      <span style="flex:1;height:1px;background:linear-gradient(90deg,#f0a63c,transparent)"></span>
    </div>`;
  el.innerHTML =
    flourish +
    `<div>${text}</div>` +
    flourish +
    (subtext
      ? `<div style="font-size:13px;letter-spacing:2px;color:#9aa4b4;margin-top:6px;font-variant:normal">${subtext}</div>`
      : "");
  state.container.appendChild(el);
  activeToast = el;

  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
  toastHideTimer = window.setTimeout(() => {
    el.style.opacity = "0";
    toastRemoveTimer = window.setTimeout(() => {
      el.remove();
      if (activeToast === el) activeToast = null;
    }, 400);
  }, 1400);
}

/** Small bottom-centre notice for pickups — quieter than a full toast. */
export function showPickupNote(text: string): void {
  if (!state.container) return;
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; bottom: 54px; left: 0; right: 0; z-index: 10001;
    text-align: center; pointer-events: none; user-select: none;
    font: 700 14px ui-monospace, Menlo, monospace; letter-spacing: 2px;
    color: #ffd98a; text-shadow: 1px 1px 0 #0b0d12;
    opacity: 0; transition: opacity 0.2s ease;
  `;
  el.textContent = text;
  state.container.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 1100);
}

export function showGameOver(opts: { onRetry: () => void; onLeave: () => void }): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10002;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(11, 13, 18, 0.72);
    font: 700 14px ui-monospace, "SF Mono", Menlo, monospace;
    color: #9aa4b4; letter-spacing: 2px; user-select: none;
  `;

  const btn = (accent: string) => `
    background: #171a22; color: ${accent};
    border: 2px solid ${accent}; border-radius: 2px;
    font: 700 14px ui-monospace, Menlo, monospace; letter-spacing: 2px;
    padding: 10px 26px; margin: 6px; cursor: pointer;
  `;

  ensureWolfFonts();
  el.innerHTML = `
    <div style="font-family:${WOLF_LABEL};font-size:40px;line-height:1.3;color:#d95763;text-shadow:4px 4px 0 #0b0d12;text-align:center">YOU ARE<br>DEAD</div>
    <div style="font-family:${WOLF_NUM};font-size:26px;letter-spacing:2px;margin:22px 0 26px;color:#c8ccd4">
      DEPTH <span style="color:#f0a63c">${state.level}</span>
      &nbsp;·&nbsp; KILLS <span style="color:#8fc46b">${state.kills}</span>
      &nbsp;·&nbsp; GOLD <span style="color:#ffd98a">${state.goldRun}</span>
    </div>
  `;

  // ── Best depth ──────────────────────────────────────────────────────────
  // The one number a solo player wants between runs. A NEW record is called out
  // explicitly; otherwise it just sits there as the target to beat.
  const best = loadBestDepth();
  const isRecord = state.level >= best && state.level > 1;
  const bestLine = document.createElement("div");
  bestLine.style.cssText =
    `font-family:${WOLF_NUM};font-size:15px;letter-spacing:2px;margin:-14px 0 20px;` +
    `color:${isRecord ? "#ffd98a" : "#6b7688"}`;
  bestLine.textContent = isRecord ? `★ DEEPEST YET — FLOOR ${best}` : `BEST DEPTH · FLOOR ${best}`;
  el.appendChild(bestLine);

  // ── Leaderboard name ────────────────────────────────────────────────────
  // The run has already been posted under the stored name by the time this
  // shows, so editing here applies to FUTURE runs. Saying so avoids implying
  // the score just submitted gets renamed.
  const nameRow = document.createElement("div");
  nameRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:14px";
  const nameLabel = document.createElement("span");
  nameLabel.style.cssText = "font-size:11px;letter-spacing:2px;color:#6b7688";
  nameLabel.textContent = "BOARD NAME";
  const nameInput = document.createElement("input");
  nameInput.value = getPlayerName();
  nameInput.maxLength = NAME_MAX;
  nameInput.style.cssText = `
    background:#171a22;color:#c8ccd4;border:2px solid #2a2f3a;border-radius:2px;
    font:700 13px ui-monospace,Menlo,monospace;letter-spacing:2px;
    padding:6px 10px;width:130px;text-transform:uppercase;
  `;
  // The dungeon binds nearly every key; without this, typing a name walks the
  // knight around behind the death screen.
  nameInput.addEventListener("keydown", (e) => e.stopPropagation());
  nameInput.addEventListener("change", () => {
    nameInput.value = setPlayerName(nameInput.value);
  });
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  el.appendChild(nameRow);

  const retry = document.createElement("button");
  retry.style.cssText = btn("#f0a63c");
  retry.textContent = "⚔ DESCEND AGAIN";
  retry.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onRetry();
  });

  const leave = document.createElement("button");
  leave.style.cssText = btn("#6b7688");
  leave.textContent = "← CRAWL BACK OUT";
  leave.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onLeave();
  });

  const row = document.createElement("div");
  row.appendChild(retry);
  row.appendChild(leave);
  el.appendChild(row);

  state.container?.appendChild(el);
  return el;
}

export interface ShopEntry {
  id: string;
  label: string;
  icon: string;
  price: number;
  detail: string;
}

/**
 * The Rolling Cart Merchant's shop overlay: a list of wares with prices,
 * bought by click or number key (routed from core.handleKey). Shows the live
 * gold balance; `onBuy(index)` spends + applies, `onClose` dismisses. The sim
 * is paused by core while this is open.
 */
export function openShopOverlay(container: HTMLElement, stock: ShopEntry[], balance: number, onBuy: (i: number) => void, onClose: () => void): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10002;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(11, 13, 18, 0.8);
    font: 700 14px ui-monospace, "SF Mono", Menlo, monospace;
    color: #9aa4b4; letter-spacing: 1px; user-select: none;
  `;
  el.addEventListener("click", (e) => e.stopPropagation());

  const panel = document.createElement("div");
  panel.style.cssText = `
    background: #171a22; border: 2px solid #6b4a2e; border-radius: 4px;
    padding: 20px 24px; min-width: 340px; box-shadow: 0 0 40px rgba(0,0,0,0.6);
  `;
  const render = (bal: number) => {
    panel.innerHTML = `
      <div style="font-size:20px;letter-spacing:3px;color:#ffd98a;text-align:center">🛒 ROLLING CART</div>
      <div style="text-align:center;margin:4px 0 14px;color:#6b7688">“everything's for sale, friend”</div>
      <div style="text-align:center;margin-bottom:12px">GOLD <span style="color:#ffd98a;font-size:16px">${bal}</span></div>
    `;
    stock.forEach((s, i) => {
      const afford = bal >= s.price;
      const rowEl = document.createElement("div");
      rowEl.setAttribute("data-shop-row", String(i));
      rowEl.style.cssText = `
        display:flex;align-items:center;gap:10px;padding:7px 10px;margin:3px 0;border-radius:3px;
        border:1px solid ${afford ? "#454f5e" : "#2b303b"};cursor:${afford ? "pointer" : "not-allowed"};
        color:${afford ? "#c8ccd4" : "#454f5e"};background:${afford ? "#0b0d12" : "transparent"};
      `;
      rowEl.innerHTML = `
        <span style="color:#6b7688;width:14px">${i + 1}</span>
        <span style="font-size:16px">${s.icon}</span>
        <span style="flex:1">${s.label} <span style="color:#6b7688;font-weight:400">${s.detail}</span></span>
        <span style="color:${afford ? "#ffd98a" : "#6b1f2a"}">${s.price}g</span>
      `;
      if (afford)
        rowEl.addEventListener("click", (e) => {
          e.stopPropagation();
          onBuy(i);
        });
      panel.appendChild(rowEl);
    });
    const close = document.createElement("div");
    close.style.cssText = `text-align:center;margin-top:14px;color:#6b7688;cursor:pointer`;
    close.textContent = "ESC — LEAVE THE CART";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      onClose();
    });
    panel.appendChild(close);
  };
  render(balance);
  (el as unknown as { _render: (b: number) => void })._render = render;
  el.appendChild(panel);
  container.appendChild(el);
  return el;
}

/** Repaint the shop's balance/afford states after a purchase. */
export function refreshShopOverlay(el: HTMLDivElement | null, balance: number): void {
  (el as unknown as { _render?: (b: number) => void })?._render?.(balance);
}

/** One-time controls hint, bottom of the screen, fades after a few seconds. */
export function showControlsHint(container: HTMLElement): void {
  ensureWolfFonts();
  const el = document.createElement("div");
  // Sits ABOVE the HUD bar (its own centred pill) so it never overlaps the
  // status console, and fades out after a few seconds.
  el.style.cssText = `
    position: fixed; bottom: 148px; left: 50%; transform: translateX(-50%); z-index: 10000;
    text-align: center; pointer-events: none; user-select: none;
    font-family: ${WOLF_NUM}; font-size: 17px; letter-spacing: 1px; line-height: 1;
    color: #9aa4b4; text-shadow: 1px 1px 0 #0b0d12;
    background: rgba(11,12,16,0.72); border: 1px solid #2b303b;
    box-shadow: inset 1px 1px 0 rgba(255,255,255,0.05), 0 2px 0 rgba(0,0,0,0.5);
    padding: 5px 12px; max-width: 92vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transition: opacity 1.2s ease;
  `;
  el.textContent = "WASD MOVE · CLICK ATTACK (HOLD=HEAVY) · SPACE/RMB DODGE · SHIFT SPRINT · Q/E SKILLS · 1-4 POTIONS · TAB SWAP · R RAMPAGE · ` DEBUG · ESC";
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 1400);
  }, 7000);
}
