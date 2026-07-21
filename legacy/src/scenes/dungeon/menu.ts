/**
 * 🎒 THE GAME MENU — Esc/I from anywhere in the dungeon. Disgaea/FFT energy:
 * one full-screen sheet, five tabs, everything about YOUR knight in one place.
 *
 *   EQUIPMENT — paperdoll portrait, weapon slots (swap the active hand), plate,
 *               belt. The portrait repaints live as the loadout changes.
 *   CARDS     — manage sockets anywhere: socket stash cards into free slots,
 *               un-socket at the same one-tier-drop cost as the tavern (the
 *               menu must not be a free respec the armory charges for).
 *               BUYING/forging/rerolling stays at the tavern — menu manages,
 *               tavern sells.
 *   SKILLS    — the skill tree (skills.ts) + Q/E active-ability assignment.
 *   STATS     — the run at a glance.
 *   SETTINGS  — player prefs (sound, pixel FX, card-reader policy), persisted
 *               via settings-save.ts. Distinct from the ` debug panel, which
 *               stays session-only god-mode tooling.
 *
 * While open, `state.menuEl` freezes the sim through core's isSimPaused() gate,
 * exactly like the shop and tavern. Keyboard routing lives in core.handleKey
 * (Esc/I close, Tab/arrows cycle tabs, 1-5 jump); clicks are delegated here via
 * the same data-act convention as tavern.ts.
 */
import { state, activeWeapon, WEAPON_SLOTS } from "./state";
import { WEAPONS, GEAR, GEAR_SLOTS, POTIONS, weaponSlotCount, type GearSlot } from "./items";
import { CARDS, STASH_MAX, cardFitsKind, socketCard, lowerRarity, cardsOfRarity } from "./cards";
import { ABILITIES, ABILITY_IDS, type AbilityId } from "./abilities";
import { getBalance } from "../../utils/gold-wallet";
import { GOLD, iconTag, holoCard, paintHoloCards, injectCardStyles, weaponPanel, btn } from "./ui-cards";
import { getSettings, saveSettings, type ReaderPolicy, type DungeonSettings } from "./settings-save";
import { setSfxMuted } from "./audio";
import { loadBestDepth } from "./best-depth";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";

export type MenuTab = "equipment" | "cards" | "skills" | "stats" | "settings";
const TABS: Array<{ id: MenuTab; label: string; icon: string }> = [
  { id: "equipment", label: "EQUIPMENT", icon: "🗡️" },
  { id: "cards", label: "CARDS", icon: "🃏" },
  { id: "skills", label: "SKILLS", icon: "✨" },
  { id: "stats", label: "STATS", icon: "📜" },
  { id: "settings", label: "SETTINGS", icon: "⚙️" },
];

interface MenuDeps {
  /** Leave the dungeon for good (the old hard-Esc). Two-click confirmed. */
  onAbandon: () => void;
  /** Repaint the paperdoll canvas — wired to render/knight-portrait. */
  paintPortrait?: (canvas: HTMLCanvasElement) => void;
}

let activeTab: MenuTab = "equipment";
let deps: MenuDeps | null = null;
let selectedStash = -1; // a stash card picked to socket (Cards tab)
let abandonArmed = false;

const STYLE_ID = "dungeon-menu-style";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .gmenu{position:fixed;inset:0;z-index:10004;display:flex;align-items:center;justify-content:center;
      background:rgba(6,8,12,.78);backdrop-filter:blur(3px);animation:gmenu-fade .16s ease}
    @keyframes gmenu-fade{from{opacity:0}to{opacity:1}}
    .gmenu-sheet{width:min(880px,96vw);height:min(620px,92vh);display:flex;flex-direction:column;
      background:linear-gradient(180deg,#171310,#100d0a);border:2px solid #4a3d28;border-radius:10px;
      box-shadow:0 18px 60px rgba(0,0,0,.8),0 0 0 1px #000;overflow:hidden;
      font:400 13px ui-monospace,Menlo,monospace;color:#e8dcc0;user-select:none}
    .gmenu-head{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #4a3d28;background:#00000033}
    .gmenu-title{font:14px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:3px;color:${GOLD}}
    .gmenu-tabs{display:flex;gap:4px;margin-left:auto}
    .gmenu-tab{cursor:pointer;background:#171208;border:1px solid #4a3d28;border-bottom:none;color:#9a8f77;
      border-radius:6px 6px 0 0;padding:6px 10px;font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:1px}
    .gmenu-tab.on{color:${GOLD};border-color:${GOLD};background:#241a0f}
    .gmenu-body{flex:1;min-height:0;overflow:auto;padding:12px 16px}
    .gmenu-foot{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid #4a3d28;
      color:#9a8f77;font-size:9px;letter-spacing:1px;background:#00000033}
    .gmenu-h{color:#c9c1ad;font-size:11px;letter-spacing:.5px;margin:10px 0 4px;border-top:1px solid #4a3d28;padding-top:8px}
    .gmenu-h:first-child{border-top:none;margin-top:0;padding-top:0}
    .gmenu-row{display:flex;align-items:center;gap:8px;margin:4px 0;padding:5px 7px;
      background:#00000044;border:1px solid #4a3d28;border-radius:6px}
    .gmenu-flash{height:14px;color:${GOLD};font-size:10px;letter-spacing:1px;opacity:0;transition:opacity .25s}
    .gmenu-doll{display:flex;gap:14px;align-items:flex-start}
    .gmenu-portrait{width:168px;height:168px;flex:0 0 auto;border:2px solid #4a3d28;border-radius:8px;
      background:radial-gradient(circle at 50% 38%,#242c38,#0b0d12 78%);image-rendering:pixelated}
    .gmenu-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 8px;border-bottom:1px dashed #33291a;font-size:12px}
    .gmenu-kv b{color:${GOLD}}
    .gmenu-danger{margin-left:auto;cursor:pointer;background:#1a0c0c;color:#d95763;border:1px solid #6e2f35;
      border-radius:5px;padding:4px 9px;font:700 10px ui-monospace,Menlo,monospace;letter-spacing:1px}
    .gmenu-danger.armed{background:#d95763;color:#160606;border-color:#ffb3ba}
    .gmenu-toggle{cursor:pointer;min-width:44px;text-align:center;border-radius:4px;padding:3px 8px;
      font:700 10px ui-monospace,Menlo,monospace;letter-spacing:1px}
    .gmenu-toggle.on{background:#1c2a17;color:#8fe86f;border:1px solid #8fe86f}
    .gmenu-toggle.off{background:#241609;color:#9a8f77;border:1px solid #4a3d28}
  `;
  document.head.appendChild(s);
}

// ── Tab bodies ────────────────────────────────────────────────────────────────

function equipmentBody(): string {
  const gearRows = GEAR_SLOTS.map((slot) => {
    const def = GEAR[slot];
    const cur = state.gear[slot] ?? 0;
    const base = def.absorb > 0 ? def.absorb : 1;
    const status = cur <= 0 ? `<span style="color:#6c5a3e">none — buy at the Tavern armory</span>` : cur < base ? `<span style="color:#d9a75a">worn ${cur}/${base}</span>` : `<span style="color:#8fe86f">sound ${cur}/${base}</span>`;
    const what = def.absorb > 0 ? `soaks ${def.absorb}` : "+move speed";
    return `<div class="gmenu-row">${iconTag(slot, def.icon, 30)}
      <span style="display:flex;flex-direction:column;line-height:1.2"><b style="color:#e8dcc0;font-size:12px">${def.label}</b><span style="color:#9a8f77;font-size:9px">${what}</span></span>
      <span style="flex:1"></span>${status}</div>`;
  }).join("");

  const weapons = state.weaponSlots
    .map((w, i) => {
      if (!w) return `<div class="gmenu-row" style="justify-content:center;color:#6c5a3e">empty hand slot — weapons drop in the maze</div>`;
      const swap = i === state.activeSlot ? "" : `<div>${btn(`equip:${i}`, "⇄ Equip", undefined, false)}</div>`;
      return weaponPanel(w, i) + swap;
    })
    .join("");

  const beltTxt = state.belt.map((b, i) => `<span style="border:1px solid #4a3d28;border-radius:5px;padding:4px 8px;background:#00000044">${i + 1}&nbsp;${b ? `${b.icon}×${b.count}` : "·"}</span>`).join(" ");

  return `<div class="gmenu-doll">
      <canvas id="gmenu-portrait" class="gmenu-portrait" width="168" height="168"></canvas>
      <div style="flex:1;min-width:0">
        <div class="gmenu-h">HANDS — TAB swaps in the field</div>
        ${weapons}
        <div class="gmenu-h">PLATE</div>
        ${gearRows}
        <div class="gmenu-h">BELT — keys 1-4</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${beltTxt}</div>
      </div>
    </div>`;
}

function cardsBody(): string {
  const stash = state.cardStash;
  const weapons = state.weaponSlots.map((w, i) => (w ? weaponPanel(w, i) : "")).join("");
  const stashHtml = stash.length
    ? stash.map((id, i) => holoCard(id, { act: "pick", idx: i, picked: i === selectedStash, size: "md" })).join("")
    : `<span style="color:#6c5a3e;font-size:11px">no stashed cards — kill enemies to find them</span>`;
  return `
    <div class="gmenu-h">YOUR WEAPONS — pick a stash card, then click a ＋ slot</div>
    <div style="color:#9a8f77;font-size:9px;margin-bottom:4px">un-socketing drops the card one rarity tier, same as the armory · buying & forging live at the Tavern</div>
    ${weapons}
    <div class="gmenu-h">STASH (${stash.length}/${STASH_MAX})</div>
    <div style="display:flex;flex-wrap:wrap;margin-top:4px">${stashHtml}</div>`;
}

/** Overridden by Phase-5's skill tree; today: Q/E active-ability loadout. */
let skillsExtraBody: (() => string) | null = null;
export function setSkillsExtraBody(fn: (() => string) | null): void {
  skillsExtraBody = fn;
}

function skillsBody(): string {
  const rows = ABILITY_IDS.map((id) => {
    const a = ABILITIES[id];
    const onQ = state.abilitySlots[0] === id;
    const onE = state.abilitySlots[1] === id;
    return `<div class="gmenu-row">
      <span style="font-size:20px;filter:drop-shadow(0 0 6px ${a.color})">${a.icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.2">
        <b style="color:${a.color};font-size:12px">${a.label}</b>
        <span style="color:#9a8f77;font-size:9px">${a.detail} · ${a.cost} mana · ${a.cooldown}s cd</span>
      </span>
      <span style="flex:1"></span>
      <button data-act="abq:${id}" class="gmenu-toggle ${onQ ? "on" : "off"}">Q</button>
      <button data-act="abe:${id}" class="gmenu-toggle ${onE ? "on" : "off"}">E</button>
    </div>`;
  }).join("");
  const extra = skillsExtraBody ? skillsExtraBody() : "";
  return `${extra}<div class="gmenu-h">ACTIVE ABILITIES — assign to Q / E</div>${rows}`;
}

function statsBody(): string {
  const runS = state.runStartMs > 0 ? Math.max(0, (performance.now() - state.runStartMs) / 1000 - state.pausedRunS) : 0;
  const mm = Math.floor(runS / 60);
  const ss = Math.floor(runS % 60).toString().padStart(2, "0");
  const w = activeWeapon();
  const rows: Array<[string, string]> = [
    ["Floor", `${state.level}`],
    ["Deepest this run", `${state.runDeepestFloor}`],
    ["Best depth ever", `${Math.max(loadBestDepth(), state.runDeepestFloor)}`],
    ["Kills", `${state.kills}`],
    ["Best combo", `×${state.runBestCombo}`],
    ["Gold this run", `${state.goldRun}g`],
    ["Purse (banked)", `${getBalance()}g`],
    ["In hand", `${WEAPONS[w.id].icon} ${WEAPONS[w.id].label}`],
    ["Run time", `${mm}:${ss} (pauses don't count)`],
  ];
  return `<div class="gmenu-h">THE RUN SO FAR</div>` + rows.map(([k, v]) => `<div class="gmenu-kv"><span>${k}</span><b>${v}</b></div>`).join("");
}

function toggleRow(key: keyof DungeonSettings & string, label: string, hint: string, on: boolean): string {
  return `<div class="gmenu-row">
    <span style="display:flex;flex-direction:column;line-height:1.2"><b style="color:#e8dcc0;font-size:12px">${label}</b><span style="color:#9a8f77;font-size:9px">${hint}</span></span>
    <span style="flex:1"></span>
    <button data-act="set:${key}" class="gmenu-toggle ${on ? "on" : "off"}">${on ? "ON" : "OFF"}</button>
  </div>`;
}

function settingsBody(): string {
  const s = getSettings();
  const policyLabel: Record<ReaderPolicy, string> = {
    always: "ALWAYS — every pickup pauses to read",
    smart: "SMART — first-of-kind & epic+ pause, repeats flash by",
    never: "NEVER — cards only flash, nothing pauses",
  };
  return `
    <div class="gmenu-h">SOUND</div>
    <div class="gmenu-row">
      <span style="display:flex;flex-direction:column;line-height:1.2"><b style="color:#e8dcc0;font-size:12px">Sound FX</b><span style="color:#9a8f77;font-size:9px">every sting is synthesized — this is the only switch</span></span>
      <span style="flex:1"></span>
      <button data-act="set:muted" class="gmenu-toggle ${s.muted ? "off" : "on"}">${s.muted ? "MUTED" : "ON"}</button>
    </div>
    <div class="gmenu-h">PIXEL LOOK</div>
    ${toggleRow("quantize", "Palette quantize", "snap colours to the 32-colour palette", s.quantize)}
    ${toggleRow("dither", "Dither", "ordered dithering between palette steps", s.dither)}
    ${toggleRow("scanline", "Scanlines", "CRT scanline overlay", s.scanline)}
    ${toggleRow("outline", "Outline", "depth-edge ink outline", s.outline)}
    <div class="gmenu-h">CARD READER</div>
    <div class="gmenu-row">
      <span style="display:flex;flex-direction:column;line-height:1.2"><b style="color:#e8dcc0;font-size:12px">When a card pickup pauses</b>
      <span style="color:#9a8f77;font-size:9px">${policyLabel[s.readerPolicy]}</span></span>
      <span style="flex:1"></span>
      <button data-act="cycle-reader" class="gmenu-toggle on">${s.readerPolicy.toUpperCase()}</button>
    </div>`;
}

const TAB_BODY: Record<MenuTab, () => string> = {
  equipment: equipmentBody,
  cards: cardsBody,
  skills: skillsBody,
  stats: statsBody,
  settings: settingsBody,
};

// ── Render / open / close ─────────────────────────────────────────────────────

function render(): void {
  const el = state.menuEl;
  if (!el) return;
  const tabs = TABS.map((t) => `<button data-act="tab:${t.id}" class="gmenu-tab ${t.id === activeTab ? "on" : ""}">${t.icon} ${t.label}</button>`).join("");
  el.innerHTML = `<div class="gmenu-sheet">
    <div class="gmenu-head">
      <span class="gmenu-title">⚔ KNIGHT</span>
      <span style="color:#c9c1ad;font-size:11px">purse <b style="color:${GOLD}">${getBalance()}g</b></span>
      <div class="gmenu-tabs">${tabs}</div>
    </div>
    <div id="gmenu-flash" class="gmenu-flash" style="margin:4px 16px 0"></div>
    <div class="gmenu-body">${TAB_BODY[activeTab]()}</div>
    <div class="gmenu-foot">
      <span>ESC / I close · TAB or ←→ cycle · 1-5 jump</span>
      <button data-act="abandon" class="gmenu-danger ${abandonArmed ? "armed" : ""}">${abandonArmed ? "CONFIRM — LEAVE RUN?" : "ABANDON RUN"}</button>
    </div>
  </div>`;
  paintHoloCards(el);
  if (activeTab === "equipment") {
    const cv = el.querySelector<HTMLCanvasElement>("#gmenu-portrait");
    if (cv && deps?.paintPortrait) deps.paintPortrait(cv);
  }
}

let flashTimer = 0;
function flash(msg: string): void {
  const el = state.menuEl?.querySelector("#gmenu-flash") as HTMLElement | null;
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = "1";
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    el.style.opacity = "0";
  }, 1600);
}

function handle(act: string, ds: { idx?: string; w?: string }): void {
  const raw = ds.idx ?? "";
  const idx = ds.idx !== undefined && ds.idx !== "" ? parseInt(ds.idx, 10) : -1;
  const wIdx = ds.w !== undefined && ds.w !== "" ? parseInt(ds.w, 10) : -1;
  // Any click that isn't the abandon button disarms it.
  if (act !== "abandon" && abandonArmed) abandonArmed = false;

  if (act === "tab") {
    if ((TABS as Array<{ id: string }>).some((t) => t.id === raw)) setMenuTab(raw as MenuTab);
    return;
  }

  if (act === "abandon") {
    if (!abandonArmed) {
      abandonArmed = true;
      render();
      return;
    }
    const go = deps?.onAbandon;
    closeGameMenu();
    go?.();
    return;
  }

  // ── Equipment ──
  if (act === "equip") {
    if (idx >= 0 && idx < WEAPON_SLOTS && state.weaponSlots[idx]) {
      state.activeSlot = idx;
      state.hudDirty = true; // applyWeaponArt picks the new hand up next frame
      render();
    }
    return;
  }

  // ── Cards (same contract as the tavern handler, minus commerce) ──
  if (act === "pick") {
    selectedStash = selectedStash === idx ? -1 : idx;
    render();
    return;
  }
  if (act === "slot") {
    if (selectedStash < 0 || wIdx < 0) {
      flash("pick a stash card first");
      return;
    }
    const w = state.weaponSlots[wIdx];
    const id = state.cardStash[selectedStash];
    if (!w || !id) return;
    if (!cardFitsKind(id, WEAPONS[w.id].kind)) {
      flash("this card doesn't fit that weapon");
      return;
    }
    if (socketCard(w, id)) {
      state.cardStash.splice(selectedStash, 1);
      selectedStash = -1;
      state.hudDirty = true;
      render();
    } else {
      flash("no free slot on that weapon");
    }
    return;
  }
  if (act === "unsocket") {
    const w = state.weaponSlots[wIdx];
    if (!w || !w.cards || !w.cards[idx]) return;
    if (state.cardStash.length >= STASH_MAX) {
      flash("stash full");
      return;
    }
    const removed = w.cards.splice(idx, 1)[0];
    // Same respec cost as the tavern: one rarity tier down, commons crumble.
    const lower = lowerRarity(CARDS[removed].rarity);
    if (lower) {
      const bag = cardsOfRarity(lower);
      state.cardStash.push(bag[Math.floor(Math.random() * bag.length)]);
      flash(`un-socketed → dropped to ${lower}`);
    } else {
      flash("common card crumbled to dust");
    }
    state.hudDirty = true;
    render();
    return;
  }

  // ── Skills: Q/E assignment ──
  if (act === "abq" || act === "abe") {
    const slot = act === "abq" ? 0 : 1;
    const id = raw as AbilityId;
    if (!ABILITIES[id]) return;
    const other = 1 - slot;
    // Assigning an ability that's on the other key swaps them instead of duping.
    if (state.abilitySlots[other] === id) state.abilitySlots[other] = state.abilitySlots[slot];
    state.abilitySlots[slot] = id;
    state.hudDirty = true;
    render();
    return;
  }

  // ── Settings ──
  if (act === "set") {
    const key = raw as keyof DungeonSettings;
    const s = getSettings();
    if (typeof s[key] !== "boolean") return;
    const v = !s[key];
    saveSettings({ [key]: v } as Partial<DungeonSettings>);
    applySettingsLive();
    render();
    return;
  }
  if (act === "cycle-reader") {
    const order: ReaderPolicy[] = ["smart", "always", "never"];
    const cur = getSettings().readerPolicy;
    saveSettings({ readerPolicy: order[(order.indexOf(cur) + 1) % order.length] });
    render();
    return;
  }
}

/** Push the persisted settings onto the live systems (sfx gate + pixel pass). */
export function applySettingsLive(): void {
  const s = getSettings();
  setSfxMuted(s.muted);
  state.quantize = s.quantize;
  state.dither = s.dither;
  state.scanline = s.scanline;
  state.outline = s.outline;
  state.pixelPass?.setQuantize(s.quantize);
  state.pixelPass?.setDither(s.dither);
  state.pixelPass?.setScanline(s.scanline);
  state.pixelPass?.setOutline(s.outline);
}

export function isGameMenuOpen(): boolean {
  return !!state.menuEl;
}

export function setMenuTab(tab: MenuTab): void {
  activeTab = tab;
  selectedStash = -1;
  render();
}

export function cycleMenuTab(dir: 1 | -1): void {
  const i = TABS.findIndex((t) => t.id === activeTab);
  setMenuTab(TABS[(i + dir + TABS.length) % TABS.length].id);
}

export function menuTabByIndex(i: number): void {
  if (i >= 0 && i < TABS.length) setMenuTab(TABS[i].id);
}

export function openGameMenu(container: HTMLElement, d: MenuDeps): void {
  if (state.menuEl) return;
  deps = d;
  abandonArmed = false;
  selectedStash = -1;
  ensurePixelFonts();
  injectCardStyles();
  injectStyles();

  const el = document.createElement("div");
  el.className = "gmenu";
  // Keep clicks out of the attack surface below.
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!t) {
      // Clicking the dim scrim (not the sheet) closes — FFT muscle memory.
      if (e.target === el) closeGameMenu();
      return;
    }
    const [name, suffix] = t.dataset.act!.split(":");
    handle(name, { idx: t.dataset.idx ?? suffix, w: t.dataset.w });
  });
  container.appendChild(el);
  state.menuEl = el;
  render();
}

export function closeGameMenu(): void {
  state.menuEl?.remove();
  state.menuEl = null;
  deps = null;
  abandonArmed = false;
  // The Esc/I that closed us is already queued in the gameplay handle.
  state.input?.clearTransient();
}
