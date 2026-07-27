/**
 * Loot drops — what a corpse leaves behind.
 *
 * Extracted verbatim from core.ts. Every roll (weapon, card, reagent, marble
 * material) lives here; the coin half of a drop is economy/coins.ts, which this
 * module deliberately does NOT wrap — a kill credits coins and rolls loot as
 * two independent things.
 */
import { CARDS, rollCardDrop } from "../cards";
import { COIN_BURST_SPREAD, COIN_BURST_VY, COIN_DROP_SCALE, COIN_REST_Y, COIN_SPAWN_Y } from "../constants";
import { updateCoins } from "./coins";
import { nextItemNid } from "./ground-items";
import { type WeaponState } from "../items";
import { rollReagentDrops, type ReagentId } from "../reagents";
import { ITEM_PAINTS } from "../render/cel-painter";
import { createStaticSprite } from "../engine/render/sprite";
import { state, type EnemyKind, type MarbleMaterial } from "../state";
import { type ZombieType } from "../zombie-types";

/** Drop a carried weapon on the floor, durability intact, un-grabbable until you step away. */
export function dropWeapon(w: WeaponState, x: number, z: number): void {
  if (!state.scene) return;
  const sprite = createStaticSprite(ITEM_PAINTS[w.id]);
  sprite.mesh.position.set(x, 0, z);
  state.scene.add(sprite.mesh);
  state.groundItems.push({
    kind: "weapon",
    id: w.id,
    x,
    z,
    sprite,
    bobPhase: Math.random() * Math.PI * 2,
    durability: w.durability,
    rarity: w.rarity,
    cards: w.cards,
    upgrade: w.upgrade,
    blockedUntilAway: true,
  });
}

/**
 * A weapon comes off the floor: into an empty slot if there is one, otherwise
 * it EXCHANGES with the active hand (the old weapon drops where the new one
 * lay). Either way the new weapon ends up in the active hand — picking a
 * thing up and not holding it would feel like a misclick.
 */
/** A kill rolled the dice — maybe spawn a modifier card on the floor. */
export function dropCardMaybe(x: number, z: number, boss: boolean, kind: EnemyKind = "zombie", dropMult = 1, subType?: ZombieType): void {
  if (!state.scene) return;
  // `kind` + `subType` drive the AFFINITY pick (cards.ts): a card off a Ghost
  // should be a Ghost's card, and one off a HULK should be the Hulk card rather
  // than any old zombie chip. `dropMult` is the sub-type's loot weight.
  const id = rollCardDrop({ boss, floor: state.level, legendaryAllowed: !state.legendaryDropped, mythicAllowed: !state.mythicDropped, kind, subType, dropMult });
  if (!id) return;
  if (CARDS[id].rarity === "legendary") state.legendaryDropped = true;
  if (CARDS[id].rarity === "mythic") state.mythicDropped = true;
  spawnCardDrop(x, z, id);
}

/** Put a SPECIFIC card on the floor. Split out of the roll above so a harness
 * can place a known card (dev/window-hooks `__dungeonDropCard`) — card drops
 * are otherwise random, which makes the pickup path untestable unattended. */
export function spawnCardDrop(x: number, z: number, id: string): void {
  if (!state.scene || !CARDS[id]) return;
  const sprite = createStaticSprite(ITEM_PAINTS[id]);
  sprite.mesh.position.set(x, 0, z);
  state.scene.add(sprite.mesh);
  state.groundItems.push({ nid: nextItemNid(), kind: "card", id, x, z, sprite, bobPhase: Math.random() * 6 });
}

/**
 * THE ONE PLACE a coin's value reaches the wallet. Absorb, cull and sweep all
 * funnel through here, which is what makes "never lose and never duplicate
 * gold" checkable rather than hopeful.
 */


/** Credit a reagent straight into the run pouch (headless fallback + arrival). */
export function creditReagent(id: ReagentId): void {
  state.reagents[id] = (state.reagents[id] ?? 0) + 1;
  state.hudDirty = true;
}

/**
 * Roll a kill's themed reagent drops (reagents.ts) and scatter them as motes.
 * Each mote rides the SAME burst→rest→magnet flight as a coin (updateCoins keys
 * off `it.coin`, not the kind), so it fans out of the corpse and homes to the
 * knight — but it's absorbed into the alchemy pouch, not the purse.
 */
export function dropReagentsMaybe(x: number, z: number, kind: EnemyKind, boss: boolean, dropMult = 1): void {
  const ids = rollReagentDrops(kind, { boss, dropMult });
  for (let i = 0; i < ids.length; i++) spawnReagentMote(x, z, ids[i], i, ids.length);
}

export function spawnReagentMote(x: number, z: number, id: ReagentId, i: number, n: number): void {
  if (!state.scene) {
    creditReagent(id); // headless harness: no scene, just bank it
    return;
  }
  const sprite = createStaticSprite(ITEM_PAINTS[id]);
  sprite.mesh.scale.multiplyScalar(COIN_DROP_SCALE * 1.15); // a touch bigger than a coin
  sprite.mesh.position.set(x, COIN_SPAWN_Y, z);
  state.scene.add(sprite.mesh);
  const ang = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.9;
  const spd = COIN_BURST_SPREAD * (0.4 + Math.random() * 0.7);
  state.groundItems.push({
    kind: "reagent",
    id,
    x,
    z,
    sprite,
    bobPhase: Math.random() * Math.PI * 2,
    coin: {
      phase: "burst",
      y: COIN_SPAWN_Y,
      vx: Math.cos(ang) * spd,
      vy: COIN_BURST_VY * (0.85 + Math.random() * 0.3),
      vz: Math.sin(ang) * spd,
      age: 0,
      magT: 0,
      fromX: x,
      fromY: COIN_REST_Y,
      fromZ: z,
    },
  });
}

/** Drop a marble material on the floor (elite/vault reward; grabbed on contact). */
export function spawnMaterialDrop(x: number, z: number, m: MarbleMaterial): void {
  if (!state.scene) return;
  const sprite = createStaticSprite(ITEM_PAINTS[m]);
  sprite.mesh.position.set(x, 0, z);
  state.scene.add(sprite.mesh);
  state.groundItems.push({ nid: nextItemNid(), kind: "material", id: m, x, z, sprite, bobPhase: Math.random() * 6 });
}
