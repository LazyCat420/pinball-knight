/**
 * In-game HUD, toasts and the game-over screen.
 *
 * These are DOM overlays, so they sit OUTSIDE the pixel pipeline and aren't
 * quantized. Styled to match the palette so they don't clash with the art.
 */
import { state, WEAPON_SLOTS } from "./state";
import { PLAYER_MAX_HP } from "./constants";
import { WEAPONS, GEAR, GEAR_SLOTS, type WeaponId } from "./items";

const FONT = `700 13px ui-monospace, "SF Mono", Menlo, monospace`;
/** SOTN-style serif for headers/toasts — gothic games use serif, not mono. */
const SERIF = `700 13px Georgia, "Times New Roman", serif`;

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
    <div style="margin-top:3px">${weaponRows}</div>
    ${rule}
    ${gearRows}
    ${rule}
    <div style="font:${SERIF};letter-spacing:2px">
      <span style="color:#6b7688;font-variant:small-caps">Depth</span> <span style="color:#f0a63c">${state.level}</span>
      &nbsp;<span style="color:#6b7688;font-variant:small-caps">Kills</span> <span style="color:#8fc46b">${state.kills}</span></div>
    <div style="font:${SERIF};letter-spacing:2px"><span style="color:#6b7688;font-variant:small-caps">Gold</span> <span style="color:#ffd98a">${state.goldRun}</span></div>
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
    font: 700 36px Georgia, "Times New Roman", serif; letter-spacing: 7px;
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
  el.textContent = "WASD MOVE · SPACE ATTACK · TAB SWAP WEAPON · WALK OVER ITEMS TO EQUIP · FIND THE STAIRS · ESC LEAVE";
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 1400);
  }, 7000);
}
