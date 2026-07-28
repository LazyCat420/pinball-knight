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
import { STASH_MAX, cardDef, cardFitsKind, socketCard, lowerRarity, cardsOfRarity, reKeyCard } from "./cards";
import { ABILITIES, ABILITY_IDS, abilityRank, abilityRankCost, type AbilityId } from "./abilities";
import { ABILITY_RANK_MAX, ABILITY_RANK_STEP, ABILITY_RANK_RULE } from "./constants";
import { getBalance, spendGold } from "../../utils/gold-wallet";
import { GOLD, iconTag, holoCard, paintHoloCards, injectCardStyles, weaponPanel, btn } from "./ui-cards";
import { getSettings, saveSettings, type DungeonSettings } from "./settings-save";
import { setSfxMuted } from "./audio";
import { loadBestDepth } from "./best-depth";
import { SKILLS, SKILL_IDS, SKILL_BRANCHES, canLearn, xpForLevel, type SkillBranch } from "./skills";
import { REAGENTS, REAGENT_IDS } from "./reagents";
import { buildBestiary, bestiaryProgress } from "./bestiary";
import { spendSkillPoint, spendAbilityRank, unlockedAbilities, invalidateSkillAgg } from "./skill-runtime";

/**
 * What each ability GAINS at rank 2, printed on its row.
 *
 * A rule the player cannot see before buying it is a rule that may as well not
 * exist — this repo already lost a mechanic that way (secret walls that had no
 * supply and no tell). One line each, in the menu, before the points are spent.
 */
const ABILITY_RANK_RULE_TEXT: Record<AbilityId, string> = {
  flippercharge: "invulnerable for the whole ride",
  arcanepulse: "plants a lightning rod",
  magnetaura: "the field drags the horde in",
  timecrawl: "lays a ring of frost runes",
  bladestorm: "the blades shred enemy shots",
  slickfield: "adds a tar core",
};
import { LEGACY_PERKS, PERK_IDS, perkRank, addPerkRank } from "./legacy";
import { ensurePixelFonts, PIXEL_FONT_LABEL } from "./pixel-fonts";

export type MenuTab = "equipment" | "cards" | "skills" | "bestiary" | "stats" | "settings";
const TABS: Array<{ id: MenuTab; label: string; icon: string }> = [
  { id: "equipment", label: "EQUIPMENT", icon: "🗡️" },
  { id: "cards", label: "CARDS", icon: "🃏" },
  { id: "skills", label: "SKILLS", icon: "✨" },
  { id: "bestiary", label: "BESTIARY", icon: "📖" },
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
    .gmenu-tree{display:flex;gap:10px;align-items:flex-start}
    .gmenu-branch{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
    .gmenu-branch-h{font:9px ${PIXEL_FONT_LABEL},ui-monospace,monospace;letter-spacing:2px;margin-bottom:2px}
    .gmenu-node{display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;font-family:inherit;
      background:#00000044;border:1px solid #4a3d28;border-radius:7px;padding:7px 8px;color:#e8dcc0}
    .gmenu-node-icon{font-size:18px;flex:0 0 auto}
    .gmenu-node-text{display:flex;flex-direction:column;line-height:1.25;min-width:0}
    .gmenu-node-text b{font-size:11px}
    .gmenu-node-text span{color:#9a8f77;font-size:9px}
    .gmenu-node-text i{font-style:normal;font-size:8px;letter-spacing:.5px;margin-top:1px}
    .gmenu-node.open{border-color:#8fe86f}
    .gmenu-node.open i{color:#8fe86f}
    /* Prereqs met, just can't afford it yet: stays legible and stays put.
       Only the affordability tint changes when points are spent. */
    .gmenu-node.reachable{opacity:.9;border-color:#5c6f4e}
    .gmenu-node.reachable i{color:#7f9a6f}
    .gmenu-node.locked{opacity:.55;cursor:not-allowed}
    .gmenu-node.locked i{color:#d9a75a}
    .gmenu-node.maxed{border-color:${GOLD};cursor:default}
    .gmenu-node.maxed i{color:${GOLD}}
    .gmenu-pips{display:flex;flex-direction:column;gap:2px;margin-left:auto}
    .gmenu-pip{width:7px;height:7px;border-radius:2px;background:#241609;border:1px solid #4a3d28}
    .gmenu-pip.on{background:${GOLD};border-color:#fff3c0}
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

const BRANCH_META: Record<SkillBranch, { label: string; color: string }> = {
  steel: { label: "⚔ STEEL", color: "#c8ccd4" },
  flipper: { label: "🪩 FLIPPER", color: "#6fd0e8" },
  arcana: { label: "✷ ARCANA", color: "#b06fe8" },
};

/** One node card: rank pips, cost, and its gate state. */
function skillNode(id: string): string {
  const def = SKILLS[id];
  const rank = state.skillRanks[id] ?? 0;
  const gate = canLearn(id, state.skillRanks, state.skillPoints);
  const maxed = rank >= def.maxRank;
  // Four states, not three. "reachable" (prereqs met, can't afford yet) is its
  // own quiet look so the tree does NOT flip from all-green to all-dark on
  // every spend — that flicker is what read as broken selection.
  const cls = maxed ? "maxed" : gate.ok ? "open" : gate.reachable ? "reachable" : "locked";
  const pips = Array.from({ length: def.maxRank }, (_, i) => `<span class="gmenu-pip ${i < rank ? "on" : ""}"></span>`).join("");
  const req = (def.requires ?? []).map((r) => SKILLS[r]?.label).filter(Boolean).join(", ");
  const sub = maxed ? "MAXED" : gate.ok ? `+1 rank · ${def.cost}pt` : gate.why ?? "";
  return `<button data-act="skill:${id}" class="gmenu-node ${cls}" ${maxed ? "disabled" : ""} title="${req ? `requires ${req}` : ""}">
    <span class="gmenu-node-icon">${def.icon}</span>
    <span class="gmenu-node-text"><b>${def.label}</b><span>${def.description}</span><i>${sub}</i></span>
    <span class="gmenu-pips">${pips}</span>
  </button>`;
}

function skillsBody(): string {
  // ── Header: level, XP bar, points ──
  const need = xpForLevel(state.charLevel);
  const pct = Math.max(0, Math.min(100, Math.round((state.charXp / need) * 100)));
  const header = `<div class="gmenu-row" style="gap:12px">
      <b style="color:${GOLD};font-size:13px">LEVEL ${state.charLevel}</b>
      <span style="flex:1;height:8px;border:1px solid #4a3d28;border-radius:4px;background:#0b0d12;overflow:hidden">
        <span style="display:block;height:100%;width:${pct}%;background:linear-gradient(90deg,#7a5c22,${GOLD})"></span>
      </span>
      <span style="color:#9a8f77;font-size:10px">${state.charXp}/${need} xp</span>
      <b style="color:${state.skillPoints > 0 ? "#8fe86f" : "#9a8f77"};font-size:11px">${state.skillPoints} point${state.skillPoints === 1 ? "" : "s"}</b>
    </div>`;

  // ── The tree: three branch columns ──
  const cols = SKILL_BRANCHES.map((b) => {
    const meta = BRANCH_META[b];
    const nodes = SKILL_IDS.filter((id) => SKILLS[id].branch === b)
      .sort((x, y) => SKILLS[x].row - SKILLS[y].row)
      .map(skillNode)
      .join("");
    return `<div class="gmenu-branch"><div class="gmenu-branch-h" style="color:${meta.color}">${meta.label}</div>${nodes}</div>`;
  }).join("");

  // ── Legacy perks: permanent, wallet-gold, survive death ──
  const perks = PERK_IDS.map((id) => {
    const def = LEGACY_PERKS[id];
    const rank = perkRank(id);
    const maxed = rank >= def.maxRank;
    const afford = getBalance() >= def.cost;
    const status = maxed ? `<span style="color:${GOLD};font-size:10px;letter-spacing:1px">OWNED${def.maxRank > 1 ? ` ${rank}/${def.maxRank}` : ""}</span>` : btn(`perk:${id}`, rank > 0 ? `Rank ${rank + 1}` : "Buy", def.cost, !afford);
    return `<div class="gmenu-row" style="border-color:${maxed ? GOLD : "#4a3d28"}">
      <span style="font-size:18px">${def.icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.2"><b style="color:#e8dcc0;font-size:12px">${def.label}</b><span style="color:#9a8f77;font-size:9px">${def.description}</span></span>
      <span style="flex:1"></span>${status}</div>`;
  }).join("");

  // ── Active abilities: unlocked assign to Q/E, locked point at the tree ──
  const unlocked = unlockedAbilities();
  const rows = ABILITY_IDS.map((id) => {
    const a = ABILITIES[id];
    const has = unlocked.includes(id);
    const onQ = state.abilitySlots[0] === id;
    const onE = state.abilitySlots[1] === id;
    // Ranks live on the ability row rather than in the tree columns: they are
    // bought with the same points, so the opportunity cost has to be visible
    // right next to the thing the points would otherwise buy.
    const rank = abilityRank(id);
    const maxed = rank >= ABILITY_RANK_MAX;
    const cost = abilityRankCost(rank);
    const pips = Array.from({ length: ABILITY_RANK_MAX }, (_, i) => `<span class="gmenu-pip ${i < rank ? "on" : ""}"></span>`).join("");
    const rankBtn = maxed
      ? `<span style="color:${GOLD};font-size:9px;letter-spacing:1px">MAX</span>`
      : `<button data-act="abrank:${id}" class="gmenu-toggle ${state.skillPoints >= cost ? "on" : "off"}" title="rank ${rank + 1} — ${cost} point${cost === 1 ? "" : "s"}">+${cost}pt</button>`;
    const controls = has
      // `.gmenu-pips` stacks VERTICALLY — it was written for the tall node
      // cards in the tree columns. On a single-line ability row that reads as
      // three specks; laid out along the row it reads as a rank meter.
      ? `<span class="gmenu-pips" style="flex-direction:row;margin-left:0;align-items:center">${pips}</span>${rankBtn}
         <button data-act="abq:${id}" class="gmenu-toggle ${onQ ? "on" : "off"}">Q</button>
         <button data-act="abe:${id}" class="gmenu-toggle ${onE ? "on" : "off"}">E</button>`
      : `<span style="color:#6c5a3e;font-size:9px;letter-spacing:1px">🔒 unlock in ARCANA</span>`;
    const ruleAt = has && rank < ABILITY_RANK_RULE ? ` · rank ${ABILITY_RANK_RULE}: ${ABILITY_RANK_RULE_TEXT[id]}` : "";
    return `<div class="gmenu-row" style="${has ? "" : "opacity:.55"}">
      <span style="font-size:20px;filter:drop-shadow(0 0 6px ${a.color})">${a.icon}</span>
      <span style="display:flex;flex-direction:column;line-height:1.2">
        <b style="color:${a.color};font-size:12px">${a.label}${rank > 0 ? ` <span style="color:${GOLD}">+${Math.round(ABILITY_RANK_STEP * rank * 100)}%</span>` : ""}</b>
        <span style="color:#9a8f77;font-size:9px">${a.detail} · ${a.cost} mana · ${a.cooldown}s cd${ruleAt}</span>
      </span>
      <span style="flex:1"></span>
      ${controls}
    </div>`;
  }).join("");

  return `${header}
    <div class="gmenu-tree">${cols}</div>
    <div class="gmenu-h" style="color:${GOLD}">LEGACY — permanent, bought with banked gold, survives death</div>
    ${perks}
    <div class="gmenu-h">ACTIVE ABILITIES — assign to Q / E, or invest points for power</div>${rows}`;
}

/**
 * BESTIARY tab — what each monster is made of, and which cards are its essence.
 *
 * Everything here comes out of `buildBestiary()`, which derives from ENEMY_DROPS
 * / CardDef.source / ZOMBIE_TYPES. Nothing about loot is written twice.
 *
 * An unfought monster shows its name and blurb but MASKS its drops behind `???`.
 * Handing over the full table on floor 1 would make the screen a wiki; making
 * you earn each row is what makes it a bestiary.
 */
function bestiaryBody(): string {
  const entries = buildBestiary(state.killsByKind);
  const p = bestiaryProgress(state.killsByKind);
  const HIDDEN = `<span style="color:#6c5a3e;font-size:11px">??? — slay one to learn what it carries</span>`;

  const rowsFor = (e: ReturnType<typeof buildBestiary>[number]): string => {
    if (!e.seen) return HIDDEN;
    const drops = e.drops.length
      ? e.drops
          .map(
            (d) =>
              `<span title="${REAGENTS[d.id].description}" style="color:${d.color};font-size:11px;white-space:nowrap">${d.icon} ${d.label} <span style="color:#6c5a3e">${Math.round(d.chance * 100)}%</span></span>`,
          )
          .join("")
      : `<span style="color:#6c5a3e;font-size:11px">carries no materials</span>`;
    const cards = e.cards.length
      ? e.cards
          .map(
            (c) =>
              `<span title="${c.description}" style="color:${c.hex};font-size:11px;white-space:nowrap">${c.icon} ${c.label}</span>`,
          )
          .join("")
      : `<span style="color:#6c5a3e;font-size:11px">no card of its own</span>`;
    // Sub-type rows (zombies only) reveal one at a time, same rule as the kinds.
    const subs = e.subTypes.length
      ? `<div style="display:flex;flex-direction:column;gap:2px;margin-top:4px;padding-left:8px;border-left:1px solid #4a3d28">` +
        e.subTypes
          .map((s) =>
            s.seen
              ? `<span style="font-size:11px;color:#c9c1ad;white-space:nowrap"><b style="color:#e8dcc0">${s.label}</b> <span style="color:#9a8f77">${s.hp} hp${s.notes.length ? " · " + s.notes.join(" · ") : ""}</span> <span style="color:#6c5a3e">×${s.kills}</span>${s.cards.map((c) => ` <span title="${c.description}" style="color:${c.hex}">${c.icon} ${c.label}</span>`).join("")}</span>`
              : `<span style="font-size:11px;color:#6c5a3e">${s.label} — not yet met</span>`,
          )
          .join("") +
        `</div>`
      : "";
    // THE RULES IT PLAYS BY. These were behaviour-only until now: nothing on
    // any screen said a golem needs smash-speed or that ramming a crystalback
    // sprays shards back into you, so the game's clearest teaching about
    // momentum could only be learned by dying to it.
    // How you have been killing them. A ram tally next to a sword tally is the
    // pinball layer and the ARPG layer finally scoring the same fight.
    const style =
      e.ramKills > 0 || e.bestCombo > 0
        ? `<span style="font-size:10px;color:#6c5a3e">${e.ramKills > 0 ? `· ${e.ramKills} run down` : ""}${e.bestCombo > 0 ? ` · best chain ×${e.bestCombo}` : ""}</span>`
        : "";
    const mech = e.mechanics.length
      ? `<div style="display:flex;flex-direction:column;gap:1px;margin-top:3px">` +
        e.mechanics.map((m) => `<span style="font-size:10px;color:#a89b7d">· ${m}</span>`).join("") +
        `</div>`
      : "";
    return `${mech}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:3px">${drops}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:3px">${cards}</div>${style}${subs}`;
  };

  /**
   * The kill tally, now that it BUYS something. A count with no consequence is
   * a statistic; a count with a next threshold on it is a reason to go back.
   */
  const tally = (e: ReturnType<typeof buildBestiary>[number]): string => {
    if (!e.seen) return `<span style="color:#6c5a3e;font-size:10px">unmet</span>`;
    const m = e.milestone;
    const aff = m.affinity > 1 ? ` <span style="color:${GOLD}">·${m.affinity.toFixed(2)}× its card</span>` : "";
    const next = m.toNext !== null ? ` <span style="color:#6c5a3e">(${m.toNext} to next)</span>` : "";
    return `<span style="color:#9a8f77;font-size:10px;white-space:nowrap">×${e.kills}${aff}${next}</span>`;
  };

  const body = entries
    .map(
      (e) => `<div style="padding:6px 0;border-top:1px solid #33291a">
      <div style="display:flex;align-items:baseline;gap:6px">
        <b style="color:${e.seen ? "#e8dcc0" : "#6c5a3e"};font-size:12px">${e.icon} ${e.label}</b>
        <span style="color:#9a8f77;font-size:10px;flex:1">${e.blurb}</span>
        ${tally(e)}
      </div>
      ${rowsFor(e)}
    </div>`,
    )
    .join("");

  return `<div class="gmenu-h" style="color:${GOLD}">BESTIARY — ${p.seen}/${p.total} monsters met</div>
    <div style="color:#9a8f77;font-size:10px;margin-bottom:2px">A monster's materials brew at the Tavern Alchemist; its card is its power, socketed into a weapon or armour. Every zombie shape drops its own card. Keep killing a family and its card grows more likely to drop.</div>
    ${body}`;
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
  const held = REAGENT_IDS.filter((id) => (state.reagents[id] ?? 0) > 0);
  const pouch = held.length
    ? held.map((id) => `<span title="${REAGENTS[id].description}" style="color:${REAGENTS[id].color};font-size:12px;white-space:nowrap">${REAGENTS[id].icon} ${REAGENTS[id].label} ×${state.reagents[id]}</span>`).join("")
    : `<span style="color:#6c5a3e;font-size:11px">no reagents — slay monsters to gather them, brew at the Tavern Alchemist</span>`;
  const pouchBlock = `<div class="gmenu-h">ALCHEMY POUCH</div>
    <div class="gmenu-kv"><span>Empty Flasks</span><b>🧴 ${state.flasks}</b></div>
    <div style="display:flex;flex-direction:column;gap:3px;padding:2px 0">${pouch}</div>`;
  return `<div class="gmenu-h">THE RUN SO FAR</div>` + rows.map(([k, v]) => `<div class="gmenu-kv"><span>${k}</span><b>${v}</b></div>`).join("") + pouchBlock;
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
    <div class="gmenu-h">CARDS</div>
    ${toggleRow("haulReveal", "Floor haul screen", "read every card you found when the floor ends — nothing interrupts the fight either way", s.haulReveal)}`;
}

const TAB_BODY: Record<MenuTab, () => string> = {
  equipment: equipmentBody,
  cards: cardsBody,
  skills: skillsBody,
  bestiary: bestiaryBody,
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

/**
 * Resolve one delegated click into the two things a handler actually wants:
 * an ENTITY ID (a skill/perk/ability/tab name, from the `data-act` suffix) and
 * a NUMERIC INDEX (a stash/slot position, from `data-idx`).
 *
 * These used to share one field, which is what broke the skill tree: holoCard
 * renders `data-idx=""` (empty string, not absent), and `ds.idx ?? suffix`
 * only falls through on `undefined` — so an empty index SHADOWED the suffix and
 * `spendSkillPoint("")` looked up an unknown node, failing silently while the
 * re-render repainted every affordance. Empty means ABSENT here, and the id
 * never reads from `data-idx` at all.
 *
 * Exported for menu-dispatch.test.ts — the fault was in this resolution, not in
 * any of the pure tables the rest of the suite already covers.
 */
export function resolveAct(
  suffix: string | undefined,
  ds: { idx?: string; w?: string },
): { id: string; idx: number; wIdx: number } {
  const num = (v: string | undefined): number => (v !== undefined && v !== "" ? parseInt(v, 10) : -1);
  const idx = num(ds.idx);
  return {
    // The suffix is the id. Fall back to a numeric data-idx only for the
    // legacy card handlers ("pick") that carry their id positionally.
    id: suffix !== undefined && suffix !== "" ? suffix : idx >= 0 ? String(idx) : "",
    idx,
    wIdx: num(ds.w),
  };
}

function handle(act: string, ds: { idx?: string; w?: string; suffix?: string }): void {
  const { id: raw, idx, wIdx } = resolveAct(ds.suffix, ds);
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
    const lower = lowerRarity(cardDef(removed)!.rarity);
    if (lower) {
      const bag = cardsOfRarity(lower);
      // Rarity tier down, LEVEL kept — same rule as the tavern armory.
      state.cardStash.push(reKeyCard(removed, bag[Math.floor(Math.random() * bag.length)]));
      flash(`un-socketed → dropped to ${lower}`);
    } else {
      flash("common card crumbled to dust");
    }
    state.hudDirty = true;
    render();
    return;
  }

  // ── Skills: spend a point into a tree node ──
  if (act === "skill") {
    // A dispatch that loses the node id used to no-op silently while still
    // re-rendering, which read as "the tree selects everything then nothing".
    if (!raw || !SKILLS[raw]) {
      flash("couldn't read that skill node");
      return;
    }
    const res = spendSkillPoint(raw);
    if (!res.ok) flash(res.why ?? "can't learn that yet");
    else flash(`${SKILLS[raw].icon} ${SKILLS[raw].label} — rank ${state.skillRanks[raw]}`);
    render();
    return;
  }

  // ── Legacy: buy a permanent perk with banked gold ──
  if (act === "perk") {
    const def = LEGACY_PERKS[raw];
    if (!def) return;
    if (perkRank(raw) >= def.maxRank) { flash("already owned"); return; }
    if (getBalance() < def.cost || !spendGold(def.cost)) { flash("not enough banked gold"); return; }
    state.goldRun = Math.max(0, state.goldRun - def.cost); // same honesty rule as the tavern
    addPerkRank(raw);
    invalidateSkillAgg();
    state.hudDirty = true;
    flash(`${def.icon} ${def.label} — yours forever`);
    render();
    return;
  }

  // ── Skills: invest a point into an ability's ranks ──
  if (act === "abrank") {
    const id = raw as AbilityId;
    if (!ABILITIES[id]) {
      flash("couldn't read that ability");
      return;
    }
    const res = spendAbilityRank(id);
    if (!res.ok) flash(res.why ?? "can't rank that yet");
    else flash(`${ABILITIES[id].icon} ${ABILITIES[id].label} — rank ${abilityRank(id)}`);
    render();
    return;
  }

  // ── Skills: Q/E assignment ──
  if (act === "abq" || act === "abe") {
    const slot = act === "abq" ? 0 : 1;
    const id = raw as AbilityId;
    if (!ABILITIES[id] || !unlockedAbilities().includes(id)) return;
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
    handle(name, { idx: t.dataset.idx, w: t.dataset.w, suffix });
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
