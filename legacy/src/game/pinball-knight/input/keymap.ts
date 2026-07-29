/**
 * The keyboard map — one modal cascade, most-modal first.
 *
 * Extracted verbatim from core.ts. The ORDER of the checks is the design: a key
 * belongs to the most modal surface currently open, so the haul screen gets
 * first refusal, then the menu, then the shop, and only then does the key mean
 * what it means during play. Reordering these reads like a tidy-up and is a
 * behaviour change.
 */
import { state, activeWeapon } from "../state";
import { runDeps } from "../run/deps";
import { advanceCardReader } from "../card-reader";
import { toggleFloorMap, closeFloorMap } from "../map-overlay";
import { useBeltSlot, closeShop } from "../economy/shop";
import { canRampage, enterRampage } from "../fps";
import { castAbility } from "../abilities";
import { showToast } from "../ui";
import { sfxPickup } from "../audio";
import { isTavernSceneOpen } from "../../../scenes/tavern";
import { openMenu } from "../gui/screens/menu";
import { WEAPONS } from "../items";
import { showPickupNote } from "../ui";
import { toggleDebugPanel } from "../debug-panel";

/** Tab / 1 / 2 — switch hands. Switching to an empty slot is allowed (fists). */
export function selectSlot(slot: number): void {
  if (slot === state.activeSlot || state.gameOver) return;
  state.activeSlot = slot;
  // Cancel any in-flight swing/charge on the swap. A ranged fire animation left
  // running when you switch to a melee weapon would otherwise strand the attack
  // timeline (melee path expects p.move) and freeze the knight in the fire
  // frame — the "gun back to sword breaks the animation" bug. Reset to a clean
  // idle so the new weapon starts fresh.
  const p = state.player;
  if (p) {
    p.attackT = -1;
    p.move = null;
    p.chargeT = -1;
    p.comboStep = 0;
    p.comboWindowT = 0;
    p.anim.setRate(1);
    p.anim.play("idle", { force: true });
  }
  const w = WEAPONS[activeWeapon().id];
  showPickupNote(`${w.icon} ${w.label.toUpperCase()} in hand`);
  state.hudDirty = true;
}

export function handleKey(e: KeyboardEvent): void {
  if (!state.active) return;
  // The walkable tavern owns the keyboard while it is up. Without this the
  // dungeon still fires abilities underneath it — `e` is Q/E ability here and
  // the interact key there.
  if (isTavernSceneOpen()) return;


  // ` / ~ — THE DEBUG CONSOLE.
  //
  // Checked BEFORE the `uiPauses` gate below, and that ordering is the whole
  // point: the console is itself a pausing screen, so a ` routed after that
  // gate could open the panel and then never close it. `toggleDebugPanel`
  // refuses to stack on top of another modal, so this stays safe up here.
  if (e.key === "`" || e.key === "~") {
    e.preventDefault();
    toggleDebugPanel();
    return;
  }

  // ── An IN-GAME screen owns the keyboard. ──
  // It has already handled this event in `gui/input.ts` (window capture phase,
  // which runs before this handler and calls stopPropagation), so the only job
  // left here is to make sure the gameplay switch below never sees the key.
  // Without this the same Esc would close the screen AND be read as gameplay.
  if (state.uiPauses) {
    e.preventDefault();
    return;
  }

  // M — the floor map. Free inside the dungeon now that the site map yields the
  // key for the run (see map/map-overlay.setMapSuppressed).
  if (e.key === "m" || e.key === "M") {
    e.preventDefault();
    if (state.container) toggleFloorMap(state.container);
    return;
  }


  switch (e.key.toLowerCase()) {
    // Esc/I open the menu (leaving the run is the menu's confirmed ABANDON
    // button now — a reflexive Esc must not vaporize a good run).
    case "escape":
    case "i":
      e.preventDefault();
      closeFloorMap(); // the menu freezes the world; a stale map under it lies
      openMenu(() => runDeps().exitDungeonGame());
      return;

    // ── Weapon slots (plain 1/2) · quick-use belt (Shift+1..4) ──
    case "tab":
      e.preventDefault(); // don't let focus walk out of the game
      selectSlot(1 - state.activeSlot);
      break;
    // ── Quick-use belt potions (plain 1..4) ──
    case "1": useBeltSlot(0); break;
    case "2": useBeltSlot(1); break;
    case "3": useBeltSlot(2); break;
    case "4": useBeltSlot(3); break;

    // ── RAMPAGE: the FPS ultimate (only when the meter is full) ──
    case "r":
      if (canRampage()) enterRampage();
      break;

    // ── Q/E active skills (Diablo HUD). In rampage Q/E steer the FPS camera. ──
    case "q":
      if (!state.fpsActive) castAbility(0);
      break;
    case "e":
      if (!state.fpsActive) castAbility(1);
      break;

    // Everything else (spawn, descend, boss, reaper, FX toggles, fill-rampage,
    // teleport) lives in the ` debug panel, handled at the top of this function.
  }
}
