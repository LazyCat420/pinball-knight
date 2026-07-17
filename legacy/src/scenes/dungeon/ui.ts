/**
 * In-game HUD, toasts and the game-over screen.
 *
 * These are DOM overlays, so they sit OUTSIDE the pixel pipeline and aren't
 * quantized. Styled to match the palette so they don't clash with the art.
 */
import { state, WEAPON_SLOTS } from "./state";
import { PLAYER_MAX_HP, SPRINT_RIDE_THRESHOLD } from "./constants";
import { WEAPONS, GEAR, GEAR_SLOTS, type WeaponId } from "./items";

const FONT = `700 13px ui-monospace, "SF Mono", Menlo, monospace`;
/**
 * Header/toast face. Was Georgia serif (SOTN-gothic); switched 2026-07-15 to the
 * same heavily-tracked monospace the HUD uses so titles read "arcade cabinet"
 * and stay self-contained (no Google-Fonts network dependency / load flash).
 * Name kept as SERIF to avoid churning every call site.
 */
const SERIF = `700 13px ui-monospace, "SF Mono", Menlo, monospace`;
/** Big display face for the depth-title toast — tracked mono, small-caps. */
const DISPLAY = `900 34px ui-monospace, "SF Mono", Menlo, monospace`;

/**
 * The gothic frame (Phase 4): a carved-stone panel with a gold fillet line
 * and diamond finials on the corners. All done with stacked box-shadows and
 * four absolutely-positioned corner glyphs — no images, palette colours only.
 */
export function createHUD(container: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "dungeon-hud";
  el.style.cssText = `
    position: fixed; left: 14px; top: 12px; z-index: 10001;
    font: ${FONT}; line-height: 1.75; letter-spacing: 1px;
    color: #c8ccd4; text-shadow: 1px 1px 0 #0b0d12;
    background:
      linear-gradient(160deg, rgba(43, 48, 59, 0.55), rgba(11, 13, 18, 0.82) 55%);
    border: 1px solid #454f5e;
    box-shadow:
      inset 0 0 0 2px #0b0d12,
      inset 0 0 0 3px #6b4a2e,
      0 0 0 2px #0b0d12,
      0 4px 14px rgba(0, 0, 0, 0.6);
    padding: 12px 16px; min-width: 180px;
    pointer-events: none; user-select: none;
  `;
  // Diamond finials pinned to the corners of the gold fillet.
  for (const [cx, cy] of [["-5px", "-5px"], ["-5px", ""], ["", "-5px"], ["", ""]] as const) {
    const pip = document.createElement("div");
    pip.style.cssText = `
      position: absolute; width: 8px; height: 8px;
      ${cx ? `left:${cx}` : "right:-5px"}; ${cy ? `top:${cy}` : "bottom:-5px"};
      background: #f0a63c; border: 1px solid #0b0d12;
      transform: rotate(45deg);
      box-shadow: inset 1px 1px 0 #ffd98a;
    `;
    el.appendChild(pip);
  }
  const body = document.createElement("div");
  body.id = "dungeon-hud-body";
  el.appendChild(body);
  container.appendChild(el);
  return el;
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
                display:none;font:900 38px ui-monospace, "SF Mono", Menlo, monospace;
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
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%`;
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
  const filled = Math.max(0, Math.min(blocks, Math.ceil((value / max) * blocks)));
  return (
    `<span style="color:${color}">${"▮".repeat(filled)}</span>` +
    `<span style="color:#2b303b">${"▮".repeat(blocks - filled)}</span>`
  );
}

export function updateHUD(el: HTMLDivElement): void {
  const hp = Math.max(0, state.player?.hp ?? 0);
  const hearts =
    `<span style="color:#d95763">${"♥".repeat(hp)}</span>` +
    `<span style="color:#2b303b">${"♥".repeat(Math.max(0, PLAYER_MAX_HP - hp))}</span>`;

  // Sprint spool (the 3s Shift ramp) — a thin blue rail that turns gold once
  // the charge passes the wall-ride threshold, so "the ride is armed" reads at
  // a glance. Hidden entirely at zero charge to keep the HUD quiet when walking.
  const spool = Math.max(0, Math.min(1, state.player?.sprintCharge ?? 0));
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
  const over = Math.max(0, Math.min(1, state.player?.overcharge ?? 0));
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

  // Two hand slots — the active one is arrowed and bright, ranged weapons
  // show an ammo count instead of a wear meter.
  const weaponRows = Array.from({ length: WEAPON_SLOTS }, (_, slot) => {
    const held = state.weaponSlots[slot];
    const active = slot === state.activeSlot;
    const marker = active ? `<span style="color:#f0a63c">▶</span>` : `<span style="color:#2b303b">${slot + 1}</span>`;
    if (!held) {
      const label = active ? `✊ Fists <span style="color:#6b7688">unbreakable</span>` : `<span style="color:#454f5e">— empty —</span>`;
      return `<div${active ? "" : ' style="color:#454f5e"'}>${marker} ${label}</div>`;
    }
    const w = WEAPONS[held.id as WeaponId];
    const detail =
      w.kind === "ranged"
        ? `<span style="color:${active ? "#ffd98a" : "#6b7688"}">×${held.durability}</span> ${meter(held.durability, w.maxDurability, active ? "#f0a63c" : "#6b7688", 6)}`
        : meter(held.durability, w.maxDurability, active ? "#f0a63c" : "#6b7688");
    return `<div${active ? "" : ' style="color:#6b7688"'}>${marker} ${w.icon} ${w.label.padEnd(7)} ${detail}</div>`;
  }).join("");

  const gearRows = GEAR_SLOTS.map((slot) => {
    const def = GEAR[slot];
    const dur = state.gear[slot];
    if (dur === undefined) {
      return `<div style="color:#454f5e">${def.icon} ${def.label.padEnd(7)} — none —</div>`;
    }
    const detail =
      def.absorb > 0
        ? meter(dur, def.absorb, "#8a94a6", def.absorb)
        : `<span style="color:#8fc46b">+speed</span>`;
    return `<div>${def.icon} ${def.label.padEnd(7)} ${detail}</div>`;
  }).join("");

  // Active potion buffs, with a ticking seconds countdown. Only shown while
  // one is running, so the HUD stays quiet the rest of the time.
  const p = state.player;
  const buffs: string[] = [];
  if (p && p.rageT > 0) buffs.push(`<span style="color:#d97b29">💢 RAGE ${Math.ceil(p.rageT)}s</span>`);
  if (p && p.hasteT > 0) buffs.push(`<span style="color:#6fd0e8">⚡ HASTE ${Math.ceil(p.hasteT)}s</span>`);
  if (p && p.shieldT > 0) buffs.push(`<span style="color:#8fc46b">🛡️ SHIELD ${Math.ceil(p.shieldT)}s</span>`);
  if (p && p.ironT > 0) buffs.push(`<span style="color:#8a94a6">🔩 IRON ${Math.ceil(p.ironT)}s</span>`);
  if (p && p.turboT > 0) buffs.push(`<span style="color:#f0a63c">🚀 TURBO ${Math.ceil(p.turboT)}s</span>`);
  if (p && p.springT > 0) buffs.push(`<span style="color:#8fc46b">🦵 SPRING ${Math.ceil(p.springT)}s</span>`);
  if (p && p.multiT > 0) buffs.push(`<span style="color:#b06fe8">🔮 MULTI ${Math.ceil(p.multiT)}s</span>`);
  if (p && p.curveT > 0) buffs.push(`<span style="color:#6fd0e8">🌀 CURVE ${Math.ceil(p.curveT)}s</span>`);
  if (p && p.magBootsT > 0) buffs.push(`<span style="color:#a83244">🧲 BOOTS ${Math.ceil(p.magBootsT)}s</span>`);
  if (state.freezeT > 0) buffs.push(`<span style="color:#bfe8ff">❄️ FROZEN ${Math.ceil(state.freezeT)}s</span>`);
  if (p && p.webbedT > 0) buffs.push(`<span style="color:#eef1f5">🕸️ WEBBED</span>`);
  const buffRow = buffs.length
    ? `<div style="font:${SERIF};letter-spacing:1px;margin-top:2px">${buffs.join("&nbsp;&nbsp;")}</div>`
    : "";

  // The floor's target objective — only shown when the floor has targets.
  const targetsRow =
    state.targetsTotal > 0
      ? `<div style="font:${SERIF};letter-spacing:2px"><span style="color:#6b7688;font-variant:small-caps">Targets</span> <span style="color:${state.targetsHit >= state.targetsTotal ? "#8fc46b" : "#d95763"}">🎯 ${state.targetsHit}/${state.targetsTotal}</span></div>`
      : "";

  // RAMPAGE meter: a charge bar that fills from kills. When full, a pulsing
  // "READY" hint invites the R key; while active, a countdown.
  const pct = Math.round(state.ultCharge * 100);
  const full = state.ultCharge >= 1;
  const ultLabel = state.fpsActive
    ? `<span style="color:#d95763">🔫 RAMPAGE ${Math.ceil(state.fpsTimer)}s</span>`
    : full
      ? `<span style="color:#ffd98a;animation:pulse 0.8s infinite">🔫 RAMPAGE — press R</span>`
      : `<span style="color:#6b7688;font-variant:small-caps">Rampage</span>`;
  const ultBar = state.fpsActive
    ? ""
    : `<div style="height:5px;margin-top:2px;background:#2b303b;border:1px solid #454f5e">
         <div style="height:100%;width:${pct}%;background:${full ? "#f0a63c" : "#a83244"}"></div>
       </div>`;
  const ultRow = `<div style="font:${SERIF};letter-spacing:1px;margin-top:3px">${ultLabel}</div>${ultBar}`;

  // A carved rule with a diamond stud — the section divider.
  const rule = `
    <div style="display:flex;align-items:center;gap:6px;margin:7px 0 5px">
      <span style="flex:1;height:1px;background:linear-gradient(90deg,transparent,#454f5e)"></span>
      <span style="width:5px;height:5px;background:#6b4a2e;transform:rotate(45deg);box-shadow:inset 1px 1px 0 #f0a63c"></span>
      <span style="flex:1;height:1px;background:linear-gradient(90deg,#454f5e,transparent)"></span>
    </div>`;

  const body = (el.querySelector("#dungeon-hud-body") as HTMLDivElement) ?? el;
  body.innerHTML = `
    <div style="font-size:17px;letter-spacing:3px;text-shadow:0 0 6px rgba(217,87,99,0.5),1px 1px 0 #0b0d12">${hearts}</div>
    ${spoolRow}
    ${overRow}
    <div style="margin-top:3px">${weaponRows}</div>
    ${rule}
    ${gearRows}
    ${rule}
    <div style="font:${SERIF};letter-spacing:2px">
      <span style="color:#6b7688;font-variant:small-caps">Depth</span> <span style="color:#f0a63c">${state.level}</span>
      &nbsp;<span style="color:#6b7688;font-variant:small-caps">Kills</span> <span style="color:#8fc46b">${state.kills}</span></div>
    <div style="font:${SERIF};letter-spacing:2px"><span style="color:#6b7688;font-variant:small-caps">Gold</span> <span style="color:#ffd98a">${state.goldRun}</span></div>
    ${targetsRow}
    ${buffRow}
    ${ultRow}
  `;
}

/** Big centred text that fades out — "DEPTH 2", "MACE BROKE", etc. */
export function showToast(text: string, subtext = ""): void {
  if (!state.container) return;
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

  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
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

  el.innerHTML = `
    <div style="font-size:44px;letter-spacing:10px;color:#d95763;text-shadow:3px 3px 0 #0b0d12">YOU DIED</div>
    <div style="margin:18px 0 26px">
      DEPTH <span style="color:#f0a63c">${state.level}</span>
      &nbsp;·&nbsp; KILLS <span style="color:#8fc46b">${state.kills}</span>
      &nbsp;·&nbsp; GOLD KEPT <span style="color:#ffd98a">${state.goldRun}</span>
    </div>
  `;

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
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; bottom: 18px; left: 0; right: 0; z-index: 10001;
    text-align: center; pointer-events: none; user-select: none;
    font: 700 12px ui-monospace, Menlo, monospace; letter-spacing: 2px;
    color: #6b7688; text-shadow: 1px 1px 0 #0b0d12;
    transition: opacity 1.2s ease;
  `;
  el.textContent = "WASD MOVE · SHIFT SPRINT · SPACE DODGE · J/CLICK ATTACK (HOLD=HEAVY) · TAB SWAP · R RAMPAGE · ESC LEAVE";
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 1400);
  }, 7000);
}
