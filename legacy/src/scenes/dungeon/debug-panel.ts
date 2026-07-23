/**
 * 🛠️ THE DEBUG PANEL — a god-mode test console (press ` / ~ to toggle).
 *
 * A pixel-styled overlay bolted to the top-left of the screen so the game can be
 * exercised without playing from depth 1 every time: flip god mode / infinite
 * mana / no-cooldowns, heal, bank gold, fill the rampage meter, clear or spawn
 * any enemy, hand yourself any weapon, and quaff any potion — all live.
 *
 * State toggles are read/written straight on the shared `state` object (so the
 * game systems that check `state.godMode` etc. pick them up next frame); the
 * one-shot actions (heal, spawn, descend…) are injected as callbacks so this
 * module stays decoupled from core's private functions.
 */
import { state } from "./state";
import { WEAPONS } from "./items";
import { POTIONS, POTION_IDS } from "./items";

export interface DebugActions {
  heal(): void;
  addGold(n: number): void;
  /** Grant character XP (drives the skill tree without grinding). */
  grantXp(n: number): void;
  /** Grant unspent skill points directly. */
  grantSkillPoints(n: number): void;
  fillRampage(): void;
  killAll(): void;
  clearEnemies(): void;
  nextFloor(): void;
  nextBoss(): void;
  spawnReaper(): void;
  teleportStairs(): void;
  spawnRing(): void;
  giveWeapon(id: string): void;
  applyPotion(id: string): void;
  applyMaterial(id: string): void;
  spawnEnemy(kind: string): void;
}

const MATERIALS_DBG: Array<{ id: string; label: string }> = [
  { id: "diamond", label: "💎 Diamond" },
  { id: "water", label: "💧 Water" },
  { id: "stone", label: "🪨 Stone" },
  { id: "storm", label: "⚡ Storm" },
  { id: "shadow", label: "🌑 Shadow" },
  { id: "lava", label: "🔥 Lava" },
];

const SPAWNABLE: Array<{ kind: string; label: string }> = [
  { kind: "zombie", label: "🧟 Zombie" },
  { kind: "spider", label: "🕷️ Spider" },
  { kind: "brute", label: "💪 Brute" },
  { kind: "spitter", label: "🤮 Spitter" },
  { kind: "ghost", label: "👻 Ghost" },
  { kind: "bat", label: "🦇 Bat" },
  { kind: "slime", label: "🟢 Slime" },
  { kind: "goblin", label: "👺 Goblin" },
  { kind: "pin", label: "🎳 Pin" },
  { kind: "golem", label: "🗿 Golem" },
  { kind: "chomper", label: "🪴 Chomper" },
  { kind: "magnet", label: "🧲 Crawler" },
  { kind: "webspinner", label: "🕸️ Spinner" },
  { kind: "hound", label: "🐕 Hound" },
  { kind: "bloater", label: "🤢 Bloater" },
  { kind: "necromancer", label: "💀 Necro" },
  { kind: "warden", label: "🛡️ Warden" },
  { kind: "wisp", label: "🔮 Wisp" },
  { kind: "sapper", label: "⚡ Sapper" },
  { kind: "crystalback", label: "💎 Crystal" },
  { kind: "mimic", label: "🪞 Mimic" },
];

const PX_LABEL = `'Press Start 2P', ui-monospace, monospace`;
const PX_NUM = `'VT323', 'Courier New', monospace`;

let panelEl: HTMLDivElement | null = null;
let onKey: ((e: KeyboardEvent) => void) | null = null;
let refreshToggles: (() => void) | null = null;

/** Build + mount the debug panel (hidden until ` is pressed). Returns a disposer. */
export function createDebugPanel(container: HTMLElement, actions: DebugActions): () => void {
  const el = document.createElement("div");
  el.id = "dungeon-debug-panel";
  el.style.cssText = `
    position: fixed; left: 10px; top: 10px; z-index: 10050; display: none;
    width: 230px; max-height: calc(100vh - 20px); overflow-y: auto;
    padding: 8px; color: #d7f0ff; font-family: ${PX_NUM}; font-size: 15px; line-height: 1.15;
    background: linear-gradient(180deg,#12161c,#0a0c10);
    border: 2px solid #2f6f8f; box-shadow: inset 2px 2px 0 rgba(120,200,255,0.12), inset -2px -2px 0 rgba(0,0,0,0.6), 0 4px 0 rgba(0,0,0,0.5);
    pointer-events: auto; user-select: none;`;
  // Clicks inside the panel must not reach the game's attack surface.
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => e.stopPropagation());

  const title = document.createElement("div");
  title.innerHTML = `<span style="font-family:${PX_LABEL};font-size:9px;color:#6fd0e8">DEBUG</span>
    <span style="font-size:12px;color:#5a7a8a"> &nbsp;\` to close</span>`;
  title.style.cssText = `padding-bottom:6px;border-bottom:1px solid #234; margin-bottom:6px`;
  el.appendChild(title);

  // ── State toggles ──
  const toggleRefs: Array<() => void> = [];
  const addToggle = (label: string, get: () => boolean, set: (v: boolean) => void): void => {
    const b = document.createElement("button");
    const paint = (): void => {
      const on = get();
      b.textContent = `${on ? "◉" : "○"} ${label}`;
      b.style.cssText = baseBtn + `width:100%;text-align:left;margin:2px 0;` +
        (on ? `background:#1c5a2a;border-color:#4fd06a;color:#d8ffe0` : `background:#1a1e26;border-color:#2f6f8f;color:#a8c4d4`);
    };
    b.onclick = () => { set(!get()); paint(); };
    paint();
    toggleRefs.push(paint);
    el.appendChild(b);
  };
  addToggle("GOD MODE", () => state.godMode, (v) => (state.godMode = v));
  addToggle("INF MANA", () => state.infMana, (v) => (state.infMana = v));
  addToggle("NO COOLDOWN", () => state.noCooldown, (v) => (state.noCooldown = v));
  refreshToggles = () => toggleRefs.forEach((f) => f());

  // ── One-shot actions ──
  section("ACTIONS");
  const grid = document.createElement("div");
  grid.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:4px`;
  el.appendChild(grid);
  const gbtn = (label: string, fn: () => void): void => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = baseBtn + `background:#1a1e26;border-color:#2f6f8f;color:#cfe6f2`;
    b.onclick = fn;
    grid.appendChild(b);
  };
  gbtn("❤️ Heal", actions.heal);
  gbtn("💰 +100g", () => actions.addGold(100));
  gbtn("✨ +500xp", () => actions.grantXp(500));
  gbtn("🌳 +5pts", () => actions.grantSkillPoints(5));
  gbtn("🔫 Rampage", actions.fillRampage);
  gbtn("💀 Kill All", actions.killAll);
  gbtn("🧹 Clear", actions.clearEnemies);
  gbtn("⬇️ Floor", actions.nextFloor);
  gbtn("👑 Boss Lv", actions.nextBoss);
  gbtn("☠ Reaper", actions.spawnReaper);
  gbtn("⇩ Stairs", actions.teleportStairs);
  gbtn("🎨 Ring", actions.spawnRing);

  // ── Pixel FX toggles (moved off the old F/K/O keys) ──
  section("PIXEL FX");
  addToggle("QUANTIZE", () => state.quantize, (v) => { state.quantize = v; state.pixelPass?.setQuantize(v); });
  addToggle("DITHER", () => state.dither, (v) => { state.dither = v; state.pixelPass?.setDither(v); });
  addToggle("SCANLINE", () => state.scanline, (v) => { state.scanline = v; state.pixelPass?.setScanline(v); });
  addToggle("OUTLINE", () => state.outline, (v) => { state.outline = v; state.pixelPass?.setOutline(v); });

  // ── Give weapon ──
  section("WEAPON");
  chips(el, Object.values(WEAPONS).map((w) => ({ label: `${w.icon}`, title: w.label, fn: () => actions.giveWeapon(w.id) })));

  // ── Apply potion ──
  section("POTION");
  chips(el, POTION_IDS.map((id) => ({ label: POTIONS[id].icon, title: POTIONS[id].label, fn: () => actions.applyPotion(id) })));

  // ── Marble materials (R&D): grant a material + flip each feature live ──
  section("MARBLE");
  chips(el, MATERIALS_DBG.map((m) => ({ label: m.label, title: m.id, fn: () => actions.applyMaterial(m.id), wide: true })));
  addToggle("MAT ENABLED", () => state.dbgMaterialEnabled, (v) => (state.dbgMaterialEnabled = v));
  addToggle("ON-BOUNCE", () => state.dbgMaterialOnBounce, (v) => (state.dbgMaterialOnBounce = v));
  addToggle("SLAM EMIT", () => state.dbgMaterialSlam, (v) => (state.dbgMaterialSlam = v));
  addToggle("FLOOR FX", () => state.dbgMaterialFloorFx, (v) => (state.dbgMaterialFloorFx = v));
  addToggle("TERRAIN RX", () => state.dbgMaterialTerrain, (v) => (state.dbgMaterialTerrain = v));
  addToggle("SELF-HARM", () => state.dbgMaterialSelfHarm, (v) => (state.dbgMaterialSelfHarm = v));
  addToggle("FLOOR-1 DROPS", () => state.dbgMaterialFloor1Spawn, (v) => (state.dbgMaterialFloor1Spawn = v));

  // ── Spawn enemy ──
  section("SPAWN");
  chips(el, SPAWNABLE.map((s) => ({ label: s.label, title: s.kind, fn: () => actions.spawnEnemy(s.kind), wide: true })));

  container.appendChild(el);
  panelEl = el;

  // A small always-on hint so the panel is discoverable.
  const hint = document.createElement("div");
  hint.id = "dungeon-debug-hint";
  hint.textContent = "` debug";
  hint.style.cssText = `position:fixed;left:10px;top:10px;z-index:10049;font-family:${PX_LABEL};font-size:8px;
    color:#3a5a6a;pointer-events:none;user-select:none;opacity:0.6`;
  container.appendChild(hint);

  onKey = (e: KeyboardEvent) => {
    if (e.key !== "`" && e.key !== "~") return;
    e.preventDefault();
    const open = el.style.display === "none";
    el.style.display = open ? "block" : "none";
    hint.style.display = open ? "none" : "block";
    if (open) refreshToggles?.();
  };
  window.addEventListener("keydown", onKey);

  return disposeDebugPanel;

  // ── local helpers ──
  function section(label: string): void {
    const s = document.createElement("div");
    s.textContent = label;
    s.style.cssText = `font-family:${PX_LABEL};font-size:8px;color:#5a7a8a;margin:8px 0 3px;letter-spacing:1px`;
    el.appendChild(s);
  }
}

const baseBtn = `font-family:${PX_NUM};font-size:14px;padding:3px 5px;border:2px solid;cursor:pointer;
  box-shadow:inset 1px 1px 0 rgba(255,255,255,0.08),inset -1px -1px 0 rgba(0,0,0,0.5);line-height:1;`;

/** A flow-wrapped row of small icon chips (weapons/potions/enemies). */
function chips(parent: HTMLElement, items: Array<{ label: string; title: string; fn: () => void; wide?: boolean }>): void {
  const row = document.createElement("div");
  row.style.cssText = `display:flex;flex-wrap:wrap;gap:3px`;
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label;
    b.title = it.title;
    b.style.cssText = baseBtn + `background:#1a1e26;border-color:#2f6f8f;color:#cfe6f2;` +
      (it.wide ? `font-size:11px;` : `min-width:26px;text-align:center;`);
    b.onclick = it.fn;
    row.appendChild(b);
  }
  parent.appendChild(row);
}

export function disposeDebugPanel(): void {
  if (onKey) window.removeEventListener("keydown", onKey);
  onKey = null;
  panelEl?.remove();
  panelEl = null;
  document.getElementById("dungeon-debug-hint")?.remove();
  refreshToggles = null;
}
