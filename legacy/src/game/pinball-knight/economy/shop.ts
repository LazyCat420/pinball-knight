/**
 * The Rolling Cart Merchant + the potion belt.
 *
 * Extracted verbatim from core.ts. Buying, stocking, and every potion effect
 * live together because a purchase and a floor-found flask must apply through
 * the SAME `applyPotion` — two paths would drift.
 */
import { addGold, getBalance, spendGold } from "../../../utils/gold-wallet";
import { sfxBumper, sfxFreeze } from "../audio";
import { spawnMultiBall } from "../entities/multiball";
import { enterRicochetForm } from "../entities/ricochet-form";
import { rippleGlobe } from "../gui/globe-ripple";
import { faceOnHeal, faceOnSpecial } from "../hud-face";
import { ELIXIR_MAXHP_BONUS, POTIONS, REGEN_TICK_INTERVAL, freshWeapon, type PotionId } from "../items";
import { at } from "../maze/generator";
import { playerMaxHp } from "../skill-runtime";
import { state } from "../state";
import { showPickupNote, showToast, type ShopEntry } from "../ui";
import { shopScreen } from "../gui/screens/shop";
import { close as closeUiScreen, isOpen as uiIsOpen, push as pushUiScreen } from "../gui/stack";

/**
 * The Rolling Cart Merchant's wares. Prices are flat (gold is plentiful in a
 * good run); everything routes through applyPotion / freshWeapon on buy.
 */
const SHOP_STOCK: ShopEntry[] = [
  // Potion rows take their blurb from POTIONS[].description — one source of truth.
  { id: "health", label: "Health", icon: "❤️", price: 12, detail: POTIONS.health.description },
  { id: "shield", label: "Shield", icon: "🛡️", price: 18, detail: `${POTIONS.shield.duration}s ${POTIONS.shield.description}` },
  { id: "ballform", label: "Ball Form", icon: "🪩", price: 24, detail: `${POTIONS.ballform.duration}s ${POTIONS.ballform.description}` },
  { id: "multiball", label: "Multi-Ball", icon: "🔮", price: 26, detail: `${POTIONS.multiball.duration}s ${POTIONS.multiball.description}` },
  { id: "curveshot", label: "Curve Shot", icon: "🌀", price: 20, detail: `${POTIONS.curveshot.duration}s ${POTIONS.curveshot.description}` },
  { id: "magnetboots", label: "Magnet Boots", icon: "🧲", price: 24, detail: `${POTIONS.magnetboots.duration}s ${POTIONS.magnetboots.description}` },
  // Weapons are gone from the cart (2026-07-20): they drop in the maze and the
  // tavern forges them — the rolling cart's identity is the mid-floor top-up
  // of TEMPORARY power, which is also what keeps it distinct from the tree.
];

/** Open the merchant's shop overlay and PAUSE the sim while it's up. */
/**
 * Buy row `i` directly.
 *
 * Exists for the dev hook, which used to reach into the DOM and synthesise a
 * click on the row element. With no elements to click, the shortcut has to be a
 * real function — and making it one means the hook exercises the SAME path a
 * number key does, instead of a mouse event that only resembled it.
 */
export function buyShopRow(i: number): void {
  pendingBuy?.(i);
}

let pendingBuy: ((i: number) => void) | null = null;

export function openShop(): void {
  if (uiIsOpen("shop") || !state.container) return;
  const buy = (i: number): void => {
    const entry = SHOP_STOCK[i];
    if (!entry || getBalance() < entry.price) return;
    if (!spendGold(entry.price)) return;
    state.goldRun = Math.max(0, state.goldRun - entry.price); // keep the run tally honest
    // Belt first, like a floor pickup; drink immediately only if the belt's full.
    const pid = entry.id as PotionId;
    if (addToBelt(pid)) showPickupNote(`${POTIONS[pid].icon} ${POTIONS[pid].label.toUpperCase()} — belted`);
    else applyPotion(pid);
    state.hudDirty = true;
    // Nothing to refresh: the in-game shop reads the balance while it paints.
  };
  pendingBuy = buy;
  pushUiScreen(shopScreen(SHOP_STOCK, getBalance, buy, () => {}));
}

/** Close the shop overlay and resume the sim. */
export function closeShop(): void {
  closeUiScreen("shop");
  pendingBuy = null;
}

/**
 * Stow a potion on the quick-use belt. Stacks onto a matching slot, else takes
 * the first empty one. Returns false if the belt is full (caller drinks it).
 */
export function addToBelt(id: PotionId): boolean {
  for (const s of state.belt) {
    if (s && s.id === id) {
      s.count++;
      state.hudDirty = true;
      return true;
    }
  }
  for (let i = 0; i < state.belt.length; i++) {
    if (!state.belt[i]) {
      state.belt[i] = { id, icon: POTIONS[id].icon, count: 1 };
      state.hudDirty = true;
      return true;
    }
  }
  return false;
}

/**
 * Use the belt slot at index i (Shift+1..4): drink one, apply its effect, and
 * splash the matching globe + set the face reaction. Empty slots do nothing.
 */
export function useBeltSlot(i: number): void {
  const slot = state.belt[i];
  if (!slot) return;
  const id = slot.id as PotionId;
  applyPotion(id); // effect + all feedback (face/globe/note) live in applyPotion
  slot.count--;
  if (slot.count <= 0) state.belt[i] = null;
  state.hudDirty = true;
}

/**
 * Drink a potion: heal potions restore hearts instantly (capped at
 * max); buff potions (re)start their timer. A quick tint pulse + toast sells it.
 */
export function applyPotion(id: PotionId): void {
  const p = state.player;
  if (!p) return;
  const def = POTIONS[id];
  if (def.heal > 0) {
    p.hp = Math.min(playerMaxHp(), p.hp + def.heal);
    state.vfx?.blood(p.x, 0.6, p.z, "red", 6); // a little red sparkle for the heal
  }
  if (def.gold && def.gold > 0) {
    // Greed idol: instant gold windfall, banked into the shared wallet.
    state.goldRun += def.gold;
    addGold(def.gold, "dungeon-game");
    state.vfx?.sparks(p.x, 0.7, p.z, 0, 0, 8);
  }
  // ✨ LASER: an instant hand-off, not a timed buff — the ricochet form owns
  // its own clock, so this sits with the heal/gold instants above rather than
  // in the duration block below (its POTIONS duration is deliberately 0).
  if (id === "laser") {
    enterRicochetForm("laser");
    showToast("✨ LASER", "no steering. no brakes.");
  }
  if (def.duration > 0) {
    if (id === "rage") p.rageT = def.duration;
    if (id === "haste") p.hasteT = def.duration;
    if (id === "shield") p.shieldT = def.duration;
    if (id === "ballform") {
      // The consolidated pinball buff drives all three ball systems at once:
      // ram damage (iron), frictionless steering (turbo), springy walls.
      p.ironT = p.turboT = p.springT = def.duration;
      state.shakeT = Math.max(state.shakeT, 0.25);
      sfxBumper();
    }
    if (id === "freeze") {
      state.freezeT = def.duration;
      sfxFreeze();
    }
    if (id === "multiball") {
      // The echoes own their own countdown + teardown (entities/multiball.ts).
      p.multiBallT = def.duration;
      spawnMultiBall();
      sfxBumper();
    }
    if (id === "curveshot") p.curveT = def.duration;
    if (id === "magnetboots") p.magBootsT = def.duration;
    // ── Craft-only brews ──
    if (id === "regen") {
      p.regenT = def.duration;
      p.regenTickT = REGEN_TICK_INTERVAL;
    }
    if (id === "venomcoat") p.venomCoatT = def.duration;
    if (id === "stoneskin") p.stoneT = def.duration;
    if (id === "static") p.staticT = def.duration;
    if (id === "greed") p.greedT = def.duration;
  }
  // Elixir of Life: instant full heal AND a permanent-for-the-run max-hearts
  // bump (the only potion that raises the ceiling). Heal AFTER the bump so it
  // tops off at the new maximum.
  if (id === "elixir") {
    state.bonusMaxHp += ELIXIR_MAXHP_BONUS;
    p.hp = playerMaxHp();
    state.vfx?.sparks(p.x, 0.9, p.z, 0, 0, 18);
  }
  p.sprite.setTint(def.color);
  p.flashT = 0.18; // brief pulse, cleared by updateFlash
  // Consistent pickup feedback for EVERY potion (single source of truth):
  // heals get a relieved grin + red splash, everything else a wide grin + a
  // blue splash; the persistent buff strip then carries the running timer.
  if (def.heal > 0 || id === "elixir") {
    faceOnHeal();
    rippleGlobe("life");
  } else {
    faceOnSpecial();
    if (def.duration > 0 || def.gold) rippleGlobe("mana");
  }
  showPickupNote(`${def.icon} ${def.label.toUpperCase()} — ${def.description}${def.gold ? ` +${def.gold}g` : ""}`);
  state.hudDirty = true;
}
