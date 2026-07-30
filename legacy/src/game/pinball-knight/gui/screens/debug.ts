/**
 * THE ` DEBUG PANEL, in the game.
 *
 * Session-only god-mode tooling. It is the ONE screen where DOM was arguably
 * the better host — it never ships to a player, and an element tree is cheaper
 * to extend than a painted list. It is ported anyway because the goal was zero
 * DOM, and because a debug panel that renders through a DIFFERENT path from the
 * game it debugs is a debug panel that can lie: the DOM version sat outside the
 * pixel pass, so it could not be used to judge anything about the pass.
 *
 * ── IT IS A LEFT DOCK, NOT A CENTRED SHEET ──
 * The first port was a 760x600 sheet in the middle of the screen, which is the
 * wrong shape for what this thing is for. Every button here changes the WORLD —
 * spawn a horde, jump a floor, hand yourself a flamer — and the whole point is
 * to watch what that does. A centred sheet covers the knight, the horde and the
 * arena, so the loop becomes press, close, look, reopen, press. Docked to one
 * edge the arena stays visible and the console is a control surface rather than
 * a modal interruption.
 *
 * ── EVERY ROW CARRIES ITS MARK ──
 * Weapons and materials use the GAME'S OWN sprite for the thing they hand you,
 * and monsters use the creature's own cel (`monsterIcon`). That is not
 * decoration: a spawn list of thirty ALL-CAPS names is thirty identical chips,
 * and "which one is the Croaker" gets answered by reading rather than looking.
 * With the art on the row the roster is scannable — and because these are the
 * same painters the horde is drawn from, the panel doubles as the art-QA
 * contact sheet it was already being used as.
 *
 * ── EVERY ROSTER IS DERIVED, NOT WRITTEN ──
 * Carried over intact from `debug-panel.ts`, including why: the spawn list used
 * to be hand-written and drifted twice — `reaper` was never in it, and
 * `sporeling` was missing on the day it shipped. A debug panel that cannot
 * spawn the newest monster is worse than no panel, because the one kind you
 * most need to look at is the one it hides. So the roster comes from
 * `bestiary.ts`'s `KIND_IDS`, which is compile-enforced exhaustive over
 * `EnemyKind`, and a new kind appears here automatically.
 *
 * POWERUPS, ABILITIES and the SKILL TREE are listed the same way, off
 * `POTION_IDS`, `ABILITY_IDS` and `SKILL_IDS`, and `debug-console.test.ts`
 * holds all four rosters to it.
 *
 * ── WHAT THE POWERUP / SKILL SECTIONS ARE FOR ──
 * Those three sections were missing until 2026-07-29, and the gap was not
 * cosmetic: the console could hand you any weapon, any material and any monster
 * but not one potion or one spell, so the entire consumable and progression half
 * of the game could only be reached by playing for it. Three families had NO
 * other route at all — the craft-only brews (farm reagents, walk to the tavern
 * Alchemist), a rank-2 ability rule (six skill points into one spell), and
 * ✨ LASER, which has no floor spawn, no shop row and no recipe anywhere.
 *
 * The controls that CYCLE (ability rank, node rank) do so on purpose. A debug
 * button that only goes up can show you what a rule does but never what the
 * game is like without it, and "is this rule an improvement" is the question
 * these are pressed to answer.
 */
import { KIND_IDS, KIND_INFO } from "../../bestiary";
import { state, type EnemyKind } from "../../state";
import type { DebugActions } from "../../debug-panel";
import type { SkillDebugActions } from "../../dev/debug-actions";
import { ABILITIES, ABILITY_IDS, abilityRank, type AbilityId } from "../../abilities";
import { ABILITY_RANK_MAX } from "../../constants";
import { POTIONS, POTION_IDS, type PotionId } from "../../items";
import { SKILLS, SKILL_IDS, SKILL_BRANCHES, isKeystone, type SkillBranch, type SkillId } from "../../skills";
import { UI, GRID, ROW_H } from "../theme";
import {
  beginScroll,
  button,
  cutRight,
  cutTop,
  endScroll,
  fillRect,
  rect,
  strokeRect,
  text,
  type Rect,
  type UiFrame,
} from "../im";
import { abilityIcon, glyph, itemIcon, monsterIcon, type GlyphId } from "../icons";
import { pop, type UiScreen } from "../stack";

/**
 * Everything the console can do: the verbs core owns plus the ones mixed in by
 * `debug-panel.ts` because they need nothing from core. Two source interfaces,
 * one surface — the screen does not care which side of the boundary a verb came
 * from, and neither list can quietly lose a member without tsc saying so.
 */
type ConsoleActions = DebugActions & SkillDebugActions;

/**
 * The box this screen is authored for — see `UiScreen.design`.
 *
 * 560x360 buys 2x on a 1600x900 grid and 3x on a 4K one. The dock is a fixed
 * 232 of that width; the rest is deliberately EMPTY, because it is the arena
 * this panel exists to let you watch, and reserving it in the design box is
 * what stops a future row from creeping across the screen.
 */
/**
 * 560x340 capped at 2x. The dock is a fixed 232 of the width, so the design box
 * is really a statement about how much of the screen the console is allowed to
 * cover: at 2x on a 1712-wide grid that is 27%, and the arena — the thing this
 * panel exists to let you watch — keeps the rest. A smaller box would zoom to
 * 3x and hand the dock 41%.
 */
export const DESIGN = { w: 560, h: 340, max: 2 };

/** How wide the dock is, in UI pixels. */
const DOCK_W = 232;
/**
 * One row of the console.
 *
 * 26 rather than 22 because of `exactIconSize`: sprites are 72px native, so the
 * icon sizes that divide exactly are 24, 18, 12, 9… A 22px row leaves 16px of
 * icon box, which snaps DOWN to 12 — and a weapon sprite at 12px is a smudge
 * with a few lit pixels in it, which is exactly the "the icons are just dots"
 * complaint this pass exists to fix. 26 leaves 20, which snaps to 18.
 */
const ROW = 26;
const GAP = 3;
/** Explicit rather than derived, so the divisor above is stated where it is chosen. */
const ROW_ICON = 18;

/**
 * Chip names that deliberately differ from the bestiary label — space is tight.
 *
 * The five at the bottom were added on 2026-07-29 off a screenshot: the list had
 * overrides for the names somebody had NOTICED overflowing, and the budget it was
 * written against (16 characters, per debug-panel.test.ts) is nearly twice the
 * real one, so "SPORELI…", "ROTORTA…", "STILTNE…", "DEATH D…" and "BRICK G…"
 * had been shipping trimmed. See `CHIP_CHARS` for how the 8 is arrived at.
 */
const LABEL_OVERRIDE: Partial<Record<EnemyKind, string>> = {
  magnet: "Crawler",
  webspinner: "Spinner",
  necromancer: "Necro",
  crystalback: "Crystal",
  pin: "Pin",
  sporeling: "Spore",
  rotortail: "Rotor",
  stiltneck: "Stilt",
  reaper: "Reaper",
  golem: "Golem",
};

const MATERIALS = ["diamond", "water", "stone", "storm", "shadow", "lava"];
const WEAPONS_DBG = ["sword", "axe", "bow", "gun", "flamer", "katana"];
const FLOOR_JUMPS = [1, 3, 5, 10, 15, 20];
const SPAWN_COUNTS = [1, 3, 5, 8];

/**
 * Potion chips whose table label does not fit the dock.
 *
 * A column is 104 UI pixels wide and gives 18 of them to the sprite, which
 * leaves room for EIGHT characters of Press Start 2P (see `CHIP_CHARS`) — so
 * "Magnet Boots", "Elixir of Life" and even "Ball Form" have to be said
 * shorter. `ellipsize` would do it silently, which is the failure the monster
 * roster already carries a LABEL_OVERRIDE for.
 */
const POTION_LABEL: Partial<Record<PotionId, string>> = {
  ballform: "Ballform",
  multiball: "M-Ball",
  curveshot: "Curve",
  magnetboots: "Boots",
  regen: "Regen",
  venomcoat: "Venom",
  stoneskin: "Stone",
  static: "Static",
  greed: "Greed",
  elixir: "Elixir",
};

/** The branch marks, same glyphs the menu's tree columns use. */
const BRANCH_MARK: Record<SkillBranch, GlyphId> = { steel: "steel", flipper: "flipper", arcana: "spark" };

/**
 * How many characters of caption each control actually has room for.
 *
 * 8px Press Start 2P is monospace at exactly 8px per character, and `button`
 * lays an icon row out as `gutter(6) + 1 + iconSize(18) + 6` of lead-in plus 4
 * of trailing pad — so a row `w` wide fits `floor((w - 35) / 8)` characters.
 * The body is `DOCK_W - GRID*2 - 4` = 212 wide, which gives:
 *
 *   chip   104 wide (a 2-column cell, minus the gap)   →  8
 *   row    212 wide (the full body)                    → 22
 *   bind   175 wide (the row minus the rank button)    → 17
 *
 * ⚠️ THESE WERE WRONG ONCE, AND NOTHING FAILED. The first cut read the body as
 * 222 and published 9/23/18. Every test passed and three captions shipped
 * ellipsized — "BALL FO…", "MULTIBA…", "MAX SKI…" — because `ellipsize` is a
 * silent success: the panel keeps working, the button keeps working, and only a
 * screenshot says otherwise. So the numbers are stated here with the arithmetic
 * that produced them, exported for `debug-console.test.ts`, and were checked
 * against a real WebGPU capture rather than against this comment.
 *
 * A section HEADING is drawn with no icon and no `max` at all, so it has the
 * whole body: 212/8 = 26 characters, and it CLIPS rather than ellipsizing —
 * "ABILITIES — TAP TO BIND ON Q" (28) ran off the dock in that same capture.
 */
export const CHIP_CHARS = 8;
export const ROW_CHARS = 22;
export const BIND_CHARS = 17;
export const HEAD_CHARS = 26;

/**
 * The captions that are written here rather than derived from a game table.
 *
 * Exported for the width guard: a hand-written label is exactly as capable of
 * overflowing as a generated one, and these three are the ones that did.
 */
export const SECTION = {
  knight: "KNIGHT",
  floor: "FLOOR",
  weapons: "WEAPONS",
  materials: "MATERIALS",
  powerups: "POWERUPS",
  abilities: "ABILITIES — TAP BINDS Q",
  monsters: "MONSTERS",
} as const;

/** The two skill-tree act chips, half a row each. */
export const SKILL_ACTS = { max: "MAX ALL", clear: "CLEAR" } as const;

/**
 * The caption on a monster chip — the bestiary label, with the narrow-dock
 * override where one exists ("Crawler" fits where "Magnet Crawler" does not).
 */
export function monsterChipLabel(kind: EnemyKind): string {
  return (LABEL_OVERRIDE[kind] ?? KIND_INFO[kind]?.label ?? kind).toUpperCase();
}

/** The caption on a potion chip. */
export function potionChipLabel(id: PotionId): string {
  return (POTION_LABEL[id] ?? POTIONS[id].label).toUpperCase();
}

/**
 * The caption on a skill-tree row — the node, and where its rank sits.
 *
 * The rank is IN the caption rather than beside it as pips, because this row is
 * a button you press repeatedly: without a readout, "did that do anything" has
 * no answer on screen, and a maxed node looks exactly like an untaken one.
 */
export function skillChipLabel(id: SkillId, rank: number): string {
  return `${SKILLS[id].label.toUpperCase()} ${rank}/${SKILLS[id].maxRank}`;
}

/**
 * A potion's own sprite, falling back to a flask glyph in its liquid colour.
 *
 * The fallback exists because of ✨ LASER specifically. Every other potion has a
 * `FramePaint` in ITEM_PAINTS because every other potion can be found on a
 * floor, bought, or brewed — the laser can be NONE of those. It is a real,
 * finished mechanic (`applyPotion` hands you to the ricochet form) with no
 * supply anywhere in the game, which is precisely why the console is the only
 * place it can ever be exercised, and why a chip with no mark would be the one
 * chip that needed one most. Tinting the flask with `PotionDef.color` — the
 * same swatch the HUD uses — keeps the row readable without inventing art.
 */
function potionIcon(id: string): HTMLCanvasElement | null {
  const sprite = itemIcon(id);
  if (sprite) return sprite;
  const def = POTIONS[id as PotionId];
  if (!def) return null;
  return glyph("flask", ROW_ICON, `#${def.color.toString(16).padStart(6, "0")}`);
}

/** A knight/floor action: label, mark, and what it does. */
interface Act {
  label: string;
  icon: GlyphId;
  colour?: string;
  run(a: ConsoleActions): void;
}

const KNIGHT_ACTS: Act[] = [
  { label: "HEAL", icon: "heart", colour: UI.good, run: (a) => a.heal() },
  { label: "+500 GOLD", icon: "coin", run: (a) => a.addGold(500) },
  { label: "+1000 XP", icon: "spark", run: (a) => a.grantXp(1000) },
  { label: "+5 SKILL", icon: "plus", run: (a) => a.grantSkillPoints(5) },
  { label: "FILL RAGE", icon: "flame", run: (a) => a.fillRampage() },
  // Mana is a SEPARATE pool from the rampage meter (deliberately un-aliased in
  // constants/skills.ts), so it needs its own button — otherwise "why won't Time
  // Crawl fire" has no answer inside the console.
  { label: "FILL MANA", icon: "spark", colour: UI.arcane, run: (a) => a.fillMana() },
  { label: "KILL ALL", icon: "burst", colour: UI.danger, run: (a) => a.killAll() },
  { label: "CLEAR ROOM", icon: "erase", run: (a) => a.clearEnemies() },
  { label: "TO STAIRS", icon: "stairs", run: (a) => a.teleportStairs() },
];

const FLOOR_ACTS: Act[] = [
  { label: "NEXT FLOOR", icon: "descend", run: (a) => a.nextFloor() },
  { label: "BOSS FLOOR", icon: "crown", run: (a) => a.nextBoss() },
  { label: "REAPER", icon: "scythe", colour: UI.danger, run: (a) => a.spawnReaper() },
  { label: "MONSTER RING", icon: "circle", run: (a) => a.spawnRing() },
];

/** Section rule + caption, cut off the top of the running body rect. */
function section(f: UiFrame, body: Rect, label: string): void {
  const r = cutTop(body, ROW_H);
  fillRect(f, rect(r.x, r.y + 2, r.w, 1), UI.sheetEdge);
  text(f, label, r.x, r.y + 10, { size: 8, colour: UI.heading });
}

export function debugScreen(actions: ConsoleActions): UiScreen {
  let spawnCount = 1;
  /** Last frame's measured content height — see the comment at `beginScroll`. */
  let contentH = 0;

  return {
    id: "debug",
    pauses: true,
    focus: 0,
    scroll: 0,
    design: DESIGN,
    paint(f: UiFrame, self) {
      // ── The dock ──
      const dock = rect(0, 0, DOCK_W, f.h);
      fillRect(f, dock, UI.sheet);
      // One lit edge down the RIGHT side only: the panel is flush against the
      // window's left edge, so a full frame would draw a border where there is
      // no gap for it to separate anything from.
      fillRect(f, rect(dock.x + dock.w - 1, 0, 1, f.h), UI.sheetEdgeLit);

      const head = rect(GRID, GRID, DOCK_W - GRID * 2, 24);
      text(f, "DEBUG", head.x, head.y, { size: 16, colour: UI.danger });
      text(f, "` CLOSES", head.x + head.w, head.y + 4, { size: 8, colour: UI.textFaint, align: "right" });

      const foot = rect(GRID, f.h - ROW_H - GRID, DOCK_W - GRID * 2, ROW_H);
      const viewTop = head.y + head.h + 4;
      const view = rect(0, viewTop, DOCK_W - 2, foot.y - viewTop - GRID);

      // Content height, MEASURED off the previous frame's layout.
      //
      // It used to be a hand-tuned 900, which was already short of its own list
      // — the bottom two monster rows could not be reached by any means. That
      // was replaced by arithmetic over the roster lengths, which was correct
      // but had to be edited in lockstep with the body below: this pass added
      // four sections and ~30 rows, and a formula that forgets one of them fails
      // in exactly the same silent way the constant did.
      //
      // So the layout measures itself instead. `cutTop` already advances `body`
      // by precisely what each row consumes, so the distance it travelled last
      // frame IS the content height, whatever anyone adds below — the counting
      // and the drawing cannot disagree because there is only one of them. The
      // first frame runs with 0 (no scrollbar, offset clamped to 0, nothing
      // else in the layout reads `body.h`) and every frame after is exact.
      const sc = beginScroll(f, view, contentH, self.scroll);
      const body: Rect = { x: sc.inner.x + GRID, y: sc.inner.y, w: DOCK_W - GRID * 2 - 4, h: sc.inner.h };

      /** One full-width action row. */
      const act = (a: Act): void => {
        const r = cutTop(body, ROW + GAP);
        if (button(f, rect(r.x, r.y, r.w, ROW), a.label, { icon: glyph(a.icon, ROW_ICON, a.colour ?? UI.gold), iconSize: ROW_ICON })) {
          a.run(actions);
        }
      };

      /** A grid of icon chips, `cols` across. */
      const chips = (
        items: readonly string[],
        cols: number,
        iconOf: (id: string) => HTMLCanvasElement | null,
        nameOf: (id: string) => string,
        run: (id: string) => void,
      ): void => {
        const lines = Math.ceil(items.length / cols);
        const cw = Math.floor((body.w + GAP) / cols);
        for (let line = 0; line < lines; line++) {
          const r = cutTop(body, ROW + GAP);
          for (let c = 0; c < cols; c++) {
            const i = line * cols + c;
            if (i >= items.length) continue;
            const id = items[i];
            if (button(f, rect(r.x + c * cw, r.y, cw - GAP, ROW), nameOf(id), { icon: iconOf(id), iconSize: ROW_ICON })) run(id);
          }
        }
      };

      section(f, body, SECTION.knight);
      for (const a of KNIGHT_ACTS) act(a);
      cutTop(body, GRID);

      section(f, body, SECTION.floor);
      for (const a of FLOOR_ACTS) act(a);
      chips(
        FLOOR_JUMPS.map(String),
        3,
        () => glyph("layers", ROW_ICON, UI.textDim),
        (n) => `F${n}`,
        (n) => actions.gotoFloor(Number(n)),
      );
      cutTop(body, GRID);

      section(f, body, SECTION.weapons);
      chips(
        WEAPONS_DBG,
        2,
        itemIcon,
        (id) => id.toUpperCase(),
        (id) => actions.giveWeapon(id),
      );
      cutTop(body, GRID);

      section(f, body, SECTION.materials);
      chips(
        MATERIALS,
        2,
        itemIcon,
        (id) => id.toUpperCase(),
        (id) => actions.applyMaterial(id),
      );
      cutTop(body, GRID);

      // ── POWERUPS ──
      // The whole potion table, derived, for the same reason the spawn roster is:
      // a hand-picked subset is a subset that goes stale. It also covers the two
      // families that have NO other route in — the craft-only brews (you would
      // have to farm reagents and stand at the Alchemist) and ✨ LASER, which has
      // no floor spawn, no shop row and no recipe at all.
      section(f, body, SECTION.powerups);
      chips(
        POTION_IDS as readonly string[],
        2,
        potionIcon,
        (id) => potionChipLabel(id as PotionId),
        (id) => actions.applyPotion(id),
      );
      cutTop(body, GRID);

      // ── ABILITIES ──
      // Two controls per row, because there are two independent things to poke:
      // WHICH spell is on the cast bar, and how far it is RANKED. The menu can
      // already do both, gated on points; the console's whole reason to exist
      // here is that it is not gated and that the rank cycles back to 0, so a
      // rank-2 rule can be judged against its own absence in two clicks.
      section(f, body, SECTION.abilities);
      for (const id of ABILITY_IDS) {
        const r = cutTop(body, ROW + GAP);
        const line = rect(r.x, r.y, r.w, ROW);
        const rankBox = cutRight(line, 34);
        const rank = abilityRank(id);
        const key = state.abilitySlots[0] === id ? "Q·" : state.abilitySlots[1] === id ? "E·" : "";
        if (
          button(f, rect(line.x, line.y, line.w - GAP, ROW), `${key}${ABILITIES[id].label.toUpperCase()}`, {
            icon: abilityIcon(id, ROW_ICON),
            iconSize: ROW_ICON,
            good: key !== "",
          })
        ) {
          actions.giveAbility(id);
        }
        // R0 is not "no rank" as a disabled state — it is the bottom of a cycle
        // you are meant to come back to, so the button stays live at every value.
        if (button(f, rankBox, `R${rank}`, { good: rank >= ABILITY_RANK_MAX })) {
          actions.cycleAbilityRank(id);
        }
      }
      cutTop(body, GRID);

      // ── SKILL TREE ──
      // One row per node, three sections in branch order, both derived from
      // skills.ts. Full-width rows rather than two columns because the rank has
      // to be on the row: a tree chip that cannot say "2/3" is a button whose
      // effect is invisible, and every node here is worth several presses.
      {
        const r = cutTop(body, ROW + GAP);
        const half = Math.floor((body.w + GAP) / 2);
        if (button(f, rect(r.x, r.y, half - GAP, ROW), SKILL_ACTS.max, { icon: glyph("plus", ROW_ICON, UI.good), iconSize: ROW_ICON })) {
          actions.maxSkills();
        }
        if (button(f, rect(r.x + half, r.y, half - GAP, ROW), SKILL_ACTS.clear, { icon: glyph("erase", ROW_ICON, UI.danger), iconSize: ROW_ICON, danger: true })) {
          actions.clearSkills();
        }
      }
      for (const branch of SKILL_BRANCHES) {
        const ids = SKILL_IDS.filter((id) => SKILLS[id].branch === branch).sort((x, y) => SKILLS[x].row - SKILLS[y].row);
        section(f, body, branch.toUpperCase());
        for (const id of ids) {
          const def = SKILLS[id];
          const rank = state.skillRanks[id] ?? 0;
          const r = cutTop(body, ROW + GAP);
          // An unlock node wears the ABILITY'S mark, not its branch's — it is the
          // one kind of node whose effect is a specific, recognisable thing, and
          // the arcana column would otherwise be five identical sparks.
          const unlock = def.modifier.unlockAbility;
          const key = isKeystone(def);
          const mark = unlock
            ? abilityIcon(unlock, ROW_ICON)
            : glyph(BRANCH_MARK[branch], ROW_ICON, rank > 0 ? UI.good : key ? UI.danger : UI.textDim);
          if (
            button(f, rect(r.x, r.y, r.w, ROW), skillChipLabel(id, rank), {
              icon: mark,
              iconSize: ROW_ICON,
              good: rank > 0,
              // A keystone is a RULE with a drawback, so an untaken one is
              // flagged rather than just listed — pressing dynamo by accident
              // and then wondering why mana stopped arriving is the exact
              // confusion the floor lock's "be loud" rule exists to prevent.
              danger: rank === 0 && key,
            })
          ) {
            actions.cycleSkillRank(id);
          }
        }
        cutTop(body, GRID);
      }

      section(f, body, `SPAWN — x${spawnCount}`);
      {
        const r = cutTop(body, ROW + GAP);
        const cw = Math.floor((body.w + GAP) / SPAWN_COUNTS.length);
        for (const [i, n] of SPAWN_COUNTS.entries()) {
          if (button(f, rect(r.x + i * cw, r.y, cw - GAP, ROW), `x${n}`, { good: spawnCount === n })) spawnCount = n;
        }
      }

      section(f, body, SECTION.monsters);
      chips(
        KIND_IDS as readonly string[],
        2,
        (id) => monsterIcon(id as EnemyKind),
        (id) => monsterChipLabel(id as EnemyKind),
        (id) => actions.spawnEnemy(id, spawnCount),
      );

      // What the rows above actually consumed, for the next frame's scrollbar
      // and clamp. Taken BEFORE endScroll, while `body` is still the remainder.
      contentH = body.y - sc.inner.y;

      endScroll(f, view, contentH, sc.offset);
      self.scroll = sc.offset;

      // ── The foot, outside the scroll region so it never scrolls away ──
      fillRect(f, rect(0, foot.y - GRID / 2, DOCK_W - 1, 1), UI.sheetEdge);
      if (button(f, rect(foot.x, foot.y, foot.w, ROW_H), "CLOSE", { danger: true })) pop();
      strokeRect(f, rect(0, 0, DOCK_W, f.h), UI.sheetEdge, 1);

      self.focus = f.focus;
    },
  };
}
