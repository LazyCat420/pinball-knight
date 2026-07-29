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
import { openGameMenu, closeGameMenu, cycleMenuTab, menuTabByIndex } from "../menu";
import { toggleFloorMap, closeFloorMap } from "../map-overlay";
import { useBeltSlot, closeShop } from "../economy/shop";
import { canRampage, enterRampage } from "../fps";
import { castAbility } from "../abilities";
import { showToast } from "../ui";
import { sfxPickup } from "../audio";
import { isTavernSceneOpen } from "../../../scenes/tavern";
import { paintMenuPortrait } from "../boot/sheets";
import { inGameUiEnabled } from "../gui/flag";
import { openMenu } from "../gui/screens/menu";
import { top as topScreen } from "../gui/stack";
import { WEAPONS } from "../items";
import { showPickupNote } from "../ui";

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

  // ── The floor-haul screen is up: Space/Enter/Escape continue to the tavern,
  // everything else is swallowed (including the map — the floor is over). ──
  if (state.cardReaderEl) {
    if (e.key === " " || e.key === "Enter" || e.key === "Escape") advanceCardReader();
    e.preventDefault();
    return;
  }

  // ── An IN-GAME screen owns the keyboard. ──
  // It has already handled this event in `gui/input.ts` (window capture phase,
  // which runs before this handler and calls stopPropagation), so the only job
  // left here is to make sure the gameplay switch below never sees the key.
  // Without this the same Esc would close the screen AND be read as gameplay.
  if (topScreen()) {
    e.preventDefault();
    return;
  }

  // ── Game menu is open: Esc/I close, Tab/arrows cycle tabs, 1-5 jump. ──
  if (state.menuEl) {
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "i") closeGameMenu();
    else if (k === "tab" || k === "arrowright") cycleMenuTab(1);
    else if (k === "arrowleft") cycleMenuTab(-1);
    else if (/^[1-5]$/.test(k)) menuTabByIndex(Number(k) - 1);
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

  // ── Shop is open: number keys buy, Escape/enter leaves; nothing else. ──
  if (state.shopEl) {
    if (e.key === "Escape") {
      closeShop();
    } else if (/^[1-9]$/.test(e.key)) {
      const rows = state.shopEl.querySelectorAll("[data-shop-row]");
      (rows[Number(e.key) - 1] as HTMLElement | undefined)?.click();
    }
    e.preventDefault();
    return;
  }

  switch (e.key.toLowerCase()) {
    // Esc/I open the menu (leaving the run is the menu's confirmed ABANDON
    // button now — a reflexive Esc must not vaporize a good run).
    case "escape":
    case "i":
      e.preventDefault();
      closeFloorMap(); // the menu freezes the world; a stale map under it lies
      if (inGameUiEnabled()) {
        openMenu(() => runDeps().exitDungeonGame());
      } else if (state.container) {
        openGameMenu(state.container, { onAbandon: () => runDeps().exitDungeonGame(), paintPortrait: paintMenuPortrait });
      }
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
    // teleport) lives in the ` debug panel now — no more scattered letter keys.
  }
}
