/**
 * Pickups — walking over a thing and taking it.
 *
 * Extracted verbatim from core.ts. `checkPickups` is the per-frame sweep over
 * every ground item, so it is the one place that decides what a step onto a
 * tile means: coin flight, card reader, weapon swap, corpse-run looting rules.
 *
 * Sits ABOVE loot.ts and shop.ts in the layering (it calls into both); nothing
 * in the economy calls back into it.
 */
import { myId } from "../../../net/presence";
import { sfxCoin, sfxPickup } from "../audio";
import { presentCardPickup } from "../card-reader";
import { CARDS, STASH_MAX, socketCard, type CardId } from "../cards";
import { BOOTS_SPEED_FACTOR, COIN_CHEST_Y, COIN_MAGNET_TIME, DROP_CLEAR_RANGE, GOLD_PER_KILL, PICKUP_RANGE } from "../constants";
import { canLoot } from "../corpse-run";
import { creditGold, updateCoins } from "./coins";
import { removeGroundItem } from "./ground-items";
import { dropWeapon, creditReagent } from "./loot";
import { addToBelt, applyPotion } from "./shop";
import { MATERIALS, applyMaterial } from "../entities/marble";
import { faceOnSpecial } from "../hud-face";
import { GEAR, POTIONS, WEAPONS, type GearSlot, type PotionId, type WeaponId, type WeaponState } from "../items";
import { at } from "../maze/generator";
import { REAGENTS, type ReagentId } from "../reagents";
import { state, type GroundItem, type MarbleMaterial } from "../state";
import { showPickupNote } from "../ui";

/** Walk over a card: socket into the active weapon if it fits + has room, else
 * stash it for the Tavern. Returns false (leave it) only if the stash is full. */
export function pickUpCard(it: GroundItem): boolean {
  const id = it.id as CardId;
  const def = CARDS[id];
  if (!def) return true;
  const active = state.weaponSlots[state.activeSlot];
  if (active && socketCard(active, id)) {
    // Reader for first-of-kind / epic+ (pauses the world); popup for repeats.
    presentCardPickup(id, `SOCKETED INTO ${WEAPONS[active.id].icon} ${WEAPONS[active.id].label.toUpperCase()}`);
    faceOnSpecial();
    showPickupNote(`${def.icon} ${def.label.toUpperCase()} SOCKETED — ${def.description}`);
    return true;
  }
  if (state.cardStash.length < STASH_MAX) {
    state.cardStash.push(id);
    presentCardPickup(id, `STASHED FOR THE TAVERN — ${state.cardStash.length}/${STASH_MAX}`);
    showPickupNote(`${def.icon} ${def.label.toUpperCase()} — stashed for the Tavern`);
    return true;
  }
  showPickupNote(`🃏 stash full — visit the Tavern`);
  return false;
}

export function pickUpWeapon(it: GroundItem): void {
  const id = it.id as WeaponId;
  // Carry the rolled RARITY, sockets and upgrade level across the pickup — a
  // weapon that forgot its rarity would silently lose card slots, and one that
  // forgot its cards would eat them on every exchange.
  const incoming: WeaponState = {
    id,
    durability: it.durability ?? WEAPONS[id].maxDurability,
    rarity: it.rarity ?? "common",
    cards: it.cards ?? [],
    bonusSlots: 0,
    upgrade: it.upgrade ?? 0,
  };

  const empty = state.weaponSlots.findIndex((s) => s === null);
  if (empty >= 0) {
    state.weaponSlots[empty] = incoming;
    state.activeSlot = empty;
  } else {
    const outgoing = state.weaponSlots[state.activeSlot]!;
    state.weaponSlots[state.activeSlot] = incoming;
    dropWeapon(outgoing, it.x, it.z);
  }

  const w = WEAPONS[id];
  const detail = w.kind === "ranged" ? `ammo ${incoming.durability}` : `dmg ${w.damage}`;
  showPickupNote(`${w.icon} ${w.label.toUpperCase()} — ${detail} · TAB swaps`);
}

/** Walk-over pickups: weapons fill/exchange the hand slots, gear fills its slot. */
export function checkPickups(dt: number): void {
  const p = state.player;
  if (!p) return;
  updateCoins(dt);

  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    const it = state.groundItems[k];
    const dist = Math.hypot(it.x - p.x, it.z - p.z);

    // A weapon you just put down: inert until you actually leave the spot.
    if (it.blockedUntilAway) {
      if (dist > DROP_CLEAR_RANGE) it.blockedUntilAway = false;
      continue;
    }
    // SOMEONE ELSE'S CORPSE. Visible, walkable-over, not takeable. Checked
    // before any pickup branch so no item kind can leak past it. The nudge only
    // fires within pickup range, or standing near a friend's grave would spam.
    if (it.corpseOwner !== undefined && !canLoot({ id: it.corpseId ?? "", floor: state.level, x: it.x, z: it.z, owner: it.corpseOwner, items: [] }, myId())) {
      if (dist < PICKUP_RANGE) showPickupNote(`⚰️ another knight's kit — not yours to take`);
      continue;
    }
    // A coin is absorbed when its magnet flight ARRIVES, not on proximity: the
    // flight IS the animation, and cutting it short by walking into the coin
    // would put us straight back to a number appearing out of nowhere.
    if (it.kind === "coin") {
      const c = it.coin;
      if (c && c.magT < COIN_MAGNET_TIME) continue; // still bursting / resting / flying
      creditGold(it.value ?? GOLD_PER_KILL);
      state.vfx?.sparks(it.x, COIN_CHEST_Y, it.z, 0, 0, 7); // absorb flash at the chest
      sfxCoin();
      removeGroundItem(k);
      continue;
    }
    // A reagent mote is banked when its magnet flight ARRIVES, same as a coin —
    // the flight is the pickup animation, so proximity alone doesn't grab it.
    if (it.kind === "reagent") {
      const c = it.coin;
      if (c && c.magT < COIN_MAGNET_TIME) continue;
      const rid = it.id as ReagentId;
      creditReagent(rid);
      const def = REAGENTS[rid];
      state.vfx?.sparks(it.x, COIN_CHEST_Y, it.z, 0, 0, 6);
      sfxPickup();
      showPickupNote(`${def.icon} ${def.label.toUpperCase()} — ${state.reagents[rid]} in pouch`);
      removeGroundItem(k);
      continue;
    }
    if (dist > PICKUP_RANGE) continue;

    if (it.kind === "weapon") {
      pickUpWeapon(it);
    } else if (it.kind === "potion") {
      // Diablo model: potions are STOWED on the belt for manual use (Shift+1–4),
      // not drunk on contact. If the belt is full, drink it now so it's not lost.
      const pid = it.id as PotionId;
      if (addToBelt(pid)) {
        showPickupNote(`${POTIONS[pid].icon} ${POTIONS[pid].label.toUpperCase()} — ${POTIONS[pid].description} · belt: press 1-4 to drink`);
      } else {
        applyPotion(pid);
      }
    } else if (it.kind === "card") {
      if (!pickUpCard(it)) continue; // stash full — leave the card on the floor
    } else if (it.kind === "material") {
      // Marble materials apply on contact (held one at a time; a 2nd opens a
      // fusion window). Not brewable, not belted — the ball IS the material.
      const m = it.id as MarbleMaterial;
      applyMaterial(m);
      showPickupNote(`${MATERIALS[m].icon} ${MATERIALS[m].label.toUpperCase()} MARBLE — ACTIVE NOW, the ball IS the material`);
    } else {
      const slot = it.id as GearSlot;
      const def = GEAR[slot];
      state.gear = { ...state.gear, [slot]: def.absorb > 0 ? def.absorb : 1 };
      // Say what it DOES: boots grant speed and soak nothing, so "equipped"
      // alone made them look like a no-op item.
      const gearNote = def.absorb > 0 ? `soaks ${def.absorb} damage` : `+${Math.round((BOOTS_SPEED_FACTOR - 1) * 100)}% move speed`;
      showPickupNote(`${def.icon} ${def.label.toUpperCase()} — ${gearNote}`);
    }
    sfxPickup();
    state.hudDirty = true;
    removeGroundItem(k);
  }
}
