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
import type { EnemyKind } from "./state";
import { KIND_IDS, KIND_INFO } from "./bestiary";
import { floorLock, setFloorLock } from "./dev/floor-lock";
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
  /**
   * Jump straight to a floor. Distinct from `nextFloor`, which calls the real
   * `descend()` — that banks coins, grades the floor and opens the TAVERN, so
   * as a debug "go to a floor" button it went somewhere else entirely, and
   * never went UP.
   */
  gotoFloor(n: number): void;
  nextBoss(): void;
  spawnReaper(): void;
  teleportStairs(): void;
  spawnRing(): void;
  giveWeapon(id: string): void;
  /** Drink one — instants fire now, timed buffs (re)start their clock. */
  applyPotion(id: string): void;
  applyMaterial(id: string): void;
  /** Spawn `count` of a kind. >1 arranges them in a ring around the knight, so
   *  an AoE can be aimed at a horde at a known range instead of one monster
   *  standing on your toes. */
  spawnEnemy(kind: string, count: number): void;
}

const LABEL_OVERRIDE: Partial<Record<EnemyKind, string>> = {
  magnet: "Crawler",
  webspinner: "Spinner",
  necromancer: "Necro",
  crystalback: "Crystal",
  pin: "Pin",
  golem: "Golem",
  reaper: "Reaper",
  fish_feet: "FishFeet",
  mimic: "Mimic",
  platypus: "Platypus",
  espresso: "Espresso",
  jade_buddha: "Buddha",
};

export const SPAWNABLE: Array<{ kind: string; label: string }> = (KIND_IDS as EnemyKind[]).map((kind) => {
  const info = KIND_INFO[kind];
  return { kind, label: `${info.icon} ${LABEL_OVERRIDE[kind] ?? info.label}` };
});


/**
 * ── THE PANEL ITSELF MOVED ──
 * `gui/screens/debug.ts` draws it inside the pixel pass. What stays here is the
 * ACTION CONTRACT (`DebugActions`) and the derived spawn roster, because those
 * are what the rest of the game wires against.
 *
 * The roster being derived is load-bearing and is why it lives with the type:
 * the list used to be hand-written and drifted twice — `reaper` was never in
 * it, and `sporeling` was missing the day it shipped. A debug panel that cannot
 * spawn the newest monster hides exactly the kind you most need to look at.
 */
import { debugScreen } from "./gui/screens/debug";
import { debugSkillActions } from "./dev/debug-actions";
import { close as closeUiScreen, isOpen as uiIsOpen, push as pushUiScreen, screens as uiScreens } from "./gui/stack";

/**
 * The live ` toggle, parked here so the KEYMAP can reach it.
 *
 * It used to be handed back to `core.ts` and nowhere else, and core stored it
 * in a variable called `debugPanelDispose` — so the console had a documented
 * key ("press ` / ~ to toggle", said in three files), a working screen, and no
 * caller. Pressing ` did nothing for as long as that was true. Registering it
 * in the module the keymap can import is what actually connects the two.
 */
let liveToggle: (() => void) | null = null;

/** Returns the ` toggle, exactly as the DOM version did. */
export function createDebugPanel(_container: HTMLElement | null, actions: DebugActions): () => void {
  liveToggle = () => {
    if (uiIsOpen("debug")) {
      closeUiScreen("debug");
      return;
    }
    // Never stack the console on top of a MODAL — the menu, the shop, the haul
    // screen. Closing still works from anywhere, so it can't get stuck open
    // behind something else.
    //
    // The predicate is `pauses`, NOT an id whitelist. The first cut said
    // `some(s => s.id !== "hud")` and the console then refused to open at all,
    // because a normal play stack is ["hud", "toasts"] — `toasts` is a second
    // permanent non-pausing overlay, and an id whitelist silently forgot it.
    // `pauses` is the property that actually means "a modal owns the screen",
    // it already exists on every screen, and it cannot drift as screens are
    // added. See debug-toggle.test.ts.
    if (uiScreens().some((s) => s.pauses)) return;
    // Core's verbs, plus the skill/ability/mana ones that need nothing from core
    // and are therefore mixed in here rather than routed through it — see
    // `SkillDebugActions`.
    pushUiScreen(debugScreen({ ...actions, ...debugSkillActions() }));
  };
  return liveToggle;
}

/** Toggle the console — the ` key's entry point (input/keymap.ts). */
export function toggleDebugPanel(): void {
  liveToggle?.();
}

export function disposeDebugPanel(): void {
  closeUiScreen("debug");
  liveToggle = null;
}
