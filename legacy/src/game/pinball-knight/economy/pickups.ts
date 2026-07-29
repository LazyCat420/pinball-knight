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
import { cardDef, socketCard, type CardId } from "../cards";
import {
  BOOTS_SPEED_FACTOR,
  CARD_PICKUP_RANGE,
  COIN_CHEST_Y,
  COIN_MAGNET_TIME,
  DROP_CLEAR_RANGE,
  GOLD_PER_KILL,
  PICKUP_NOTE_COOLDOWN,
  PICKUP_RANGE,
  PICKUP_SWEEP_MAX,
} from "../constants";
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

/**
 * Walk over a card: socket it into the active weapon if it fits and has room,
 * otherwise stash it for the Tavern. ALWAYS takes the card.
 *
 * There is no refusal path any more. This used to return false once the stash
 * hit STASH_MAX (10) and the caller would leave the card lying on the floor —
 * see the note where that constant used to live in cards.ts. The stash is
 * uncapped, so every card the knight runs over comes off the floor.
 *
 * Nothing here opens a modal. `presentCardPickup` files the card into the floor
 * haul and flashes a corner toast; the faces are read as one screen when the
 * floor is cleared. Picking up a card mid-bounce must not cost you the bounce.
 */
export function pickUpCard(it: GroundItem): void {
  const id = it.id as CardId;
  const def = cardDef(id);
  if (!def) return;
  // The ACTIVE hand first, then the off-hand: a card refused into the stash
  // while the weapon on your back had an empty slot for it was the same defect
  // in miniature — a pickup the player cannot see the reason for.
  const order = [state.activeSlot, 1 - state.activeSlot];
  for (const s of order) {
    const w = state.weaponSlots[s];
    if (w && socketCard(w, id)) {
      presentCardPickup(id, `SOCKETED INTO ${WEAPONS[w.id].icon} ${WEAPONS[w.id].label.toUpperCase()}`);
      faceOnSpecial();
      return;
    }
  }
  state.cardStash.push(id);
  presentCardPickup(id, `STASHED FOR THE TAVERN — ${state.cardStash.length} HELD`);
}

/**
 * How wide the mouth is for a given item kind. Cards and marble materials are
 * the drops a run is built out of, so they get the generous radius; a spare
 * helmet does not need one.
 */
function grabRange(kind: GroundItem["kind"]): number {
  return kind === "card" || kind === "material" ? CARD_PICKUP_RANGE : PICKUP_RANGE;
}

/**
 * Distance from point (px,pz) to the SEGMENT (ax,az)→(bx,bz).
 *
 * This is the whole pickup fix: the knight's path through a step is a segment,
 * not the point it happened to stop on. Exported for the unit test — the
 * failure it guards (a card passed over at speed and missed) is invisible at
 * walking pace and only reproduces above ~15 u/s.
 */
export function segmentDistance(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  // Degenerate segment (the knight stood still) — plain point distance.
  if (len2 < 1e-9) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Where the knight was at the END of the previous sweep, i.e. the start of the
 * segment travelled this step. Invalid before the first sweep of a floor. */
let sweepFromX = 0;
let sweepFromZ = 0;
let sweepValid = false;

/** Forget the previous position — call on any hard reposition the sweep must
 * not draw a line through (new floor, teardown). */
export function resetPickupSweep(): void {
  sweepValid = false;
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

  // ── The segment travelled this step ──
  // `distNow` (point) still answers "am I standing there?" for the two
  // proximity NOTES below; `distSwept` (segment) answers "did I go over it?"
  // for the pickup itself. A teleport-sized gap falls back to the point test —
  // see PICKUP_SWEEP_MAX.
  const fromX = sweepValid ? sweepFromX : p.x;
  const fromZ = sweepValid ? sweepFromZ : p.z;
  const swept = sweepValid && Math.hypot(p.x - fromX, p.z - fromZ) <= PICKUP_SWEEP_MAX;
  sweepFromX = p.x;
  sweepFromZ = p.z;
  sweepValid = true;

  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    const it = state.groundItems[k];
    const distNow = Math.hypot(it.x - p.x, it.z - p.z);
    const distSwept = swept ? segmentDistance(fromX, fromZ, p.x, p.z, it.x, it.z) : distNow;
    if (it.noteCd) it.noteCd = Math.max(0, it.noteCd - dt);

    // A weapon you just put down: inert until you actually leave the spot.
    // Deliberately the CURRENT distance — "step away" is a place you are, not a
    // path you took, and the swept value would clear the block on the same step
    // that dropped it.
    if (it.blockedUntilAway) {
      if (distNow > DROP_CLEAR_RANGE) it.blockedUntilAway = false;
      continue;
    }
    // SOMEONE ELSE'S CORPSE. Visible, walkable-over, not takeable. Checked
    // before any pickup branch so no item kind can leak past it. The nudge only
    // fires within pickup range, or standing near a friend's grave would spam.
    if (it.corpseOwner !== undefined && !canLoot({ id: it.corpseId ?? "", floor: state.level, x: it.x, z: it.z, owner: it.corpseOwner, items: [] }, myId())) {
      if (distNow < PICKUP_RANGE && !it.noteCd) {
        showPickupNote(`⚰️ another knight's kit — not yours to take`);
        it.noteCd = PICKUP_NOTE_COOLDOWN;
      }
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
    if (distSwept > grabRange(it.kind)) continue;

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
      pickUpCard(it);
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
