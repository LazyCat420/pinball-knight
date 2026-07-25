# Card rework — monsters ARE the cards, and nothing is permanent

_Written 2026-07-25, from the user's design call. Supersedes the card sections
of `MONSTER_CARD_PLAN.md` (which shipped; see §0 for what stays)._

---

## 0. The design, in the user's words

> "skill tree is for the player, card system is for the weapons and the gear."
>
> "you can talk to the card guy to pay to remove the card."
>
> "you can upgrade a weapon but at the very end the higher you go the higher the
> chance is you could break the weapon when the stats are getting crazy. This way
> it always incentivises the user to keep farming and **nothing is permanent
> because thats what makes games boring** — people will end up hoarding the best
> items and its over."
>
> "If all these things were permanent then repair wouldn't be valuable, and there
> would be no point to keep going after a while."

Two axes that must NOT overlap:

| Axis | What it upgrades | Where it lives | Persistence |
|---|---|---|---|
| **Skill tree** | the PLAYER (hp, mana, move, ability unlocks) | `skills.ts` | run-scoped + legacy perks |
| **Cards** | the GEAR (weapons + armor) | `cards.ts` | run-scoped, and **losable** |

**Consequence — a correction to what I shipped:** the six `grantsAbility` /
`abilityCostMult` skill-cards were the wrong idea. Abilities are the TREE's job.
Those cards get re-cut as gear effects. `CardModifier.grantsAbility` comes out.

**The anti-hoard rule is the point of the whole system.** Every power source must
have a way to be lost or spent:
- weapons/armor break (durability, and now UPGRADE RISK)
- cards can be pulled (paid, and the card drops a tier — already built)
- the run resets on death

---

## 1. What already ships — do NOT rebuild

| Piece | Where |
|---|---|
| Cards socket into `WeaponState.cards[]`, bounded by slot count | `items.ts:52-88`, `cards.ts` |
| Paid UN-SOCKET at the dealer; removed card drops one rarity tier | `tavern.ts:698-705`, `lowerRarity` `cards.ts:290` |
| Repair weapon (30g) / repair gear (40g) | `tavern.ts:42-45` |
| Buy an extra card slot (`bonusSlots`) | `tavern.ts:748` |
| `CardDef.source` + affinity drop roll + BESTIARY | shipped 2026-07-25 |
| **8 zombie SUB-TYPES** (shambler/runner/lurcher/hulk/midget/crawler/flailer/hobbler) | `zombie-types.ts` |

---

## 2. The card table — 25 cards, 5 per rarity

Replaces the current lopsided **6 / 15 / 13 / 9 / 5**. Every non-mythic card is
the essence of exactly ONE monster — and the eight zombie sub-types are cards in
their own right, which is the user's point: a Hulk and a Midget are different
monsters and should drop different cards.

| Rarity | Cards (source) |
|---|---|
| **COMMON** | Shambler (zombie), Midget (zombie:midget), Slime, Bat, Spider |
| **RARE** | Runner (zombie:runner), Hobbler (zombie:hobbler), Goblin, Spitter, Hound |
| **EPIC** | Hulk (zombie:hulk), Lurcher (zombie:lurcher), Crawler (zombie:crawler), Ghost, Golem |
| **LEGENDARY** | Flailer (zombie:flailer), Reaper, Necromancer, Warden, Brute |
| **MYTHIC** | 5 chase cards, `source: undefined` — Tavern shelf / deep boss only |

### 2.1 Sub-type sourcing needs a new field

`CardDef.source` is an `EnemyKind`, and all eight sub-types share
`kind: "zombie"`. Add:

```ts
/** For a card sourced to a zombie SUB-TYPE rather than the family. The affinity
 *  roll and the bestiary both key on `${source}:${subType}` when present. */
subType?: ZombieType;
```

`rollCardDrop` gains the slain `ztype` and prefers a sub-type-matched card over a
family-matched one. Bestiary files those cards under the sub-type ROW, not the
Zombie row — that is what makes "farm Hulks for the Hulk card" legible.

### 2.2 Effects must read as the monster

Each card's stats should be the monster's behaviour bottled, not an arbitrary
chip. Examples (final numbers in implementation):

- **Midget** (common) — small and quick → `−12% cooldown`
- **Hulk** (epic) — huge and heavy → `+60% dmg, −15% cooldown` (slow but massive)
- **Crawler** (epic) — legless, drags → `+40% dmg vs. slowed/chilled foes`
- **Runner** (rare) — fast, frail → `+35% dmg while riding momentum`
- **Flailer** (legendary) — no arms, all bite → `+50% dmg, 30% CRIT`
- **Ghost** (epic) → `hits CHILL` · **Reaper** (legendary) → `+2 flat, lifesteal 1`

---

## 3. Item rarity drives 1-4 card slots, on weapons AND armor

Today `cardSlots` is hand-authored per weapon (sword 1, mace 2, flamer 3) and
armor has **no** slots at all. Replace both with rarity.

```ts
export type ItemRarity = "common" | "rare" | "epic" | "legendary";
export const SLOTS_BY_RARITY: Record<ItemRarity, number> = {
  common: 1, rare: 2, epic: 3, legendary: 4,
};
```

- `WeaponState` and `GearState` each gain `rarity: ItemRarity` and `cards?: CardId[]`.
- A dropped weapon/gear piece rolls a rarity (deeper floors bias higher).
- `weaponSlotCount()` becomes `SLOTS_BY_RARITY[rarity] + (bonusSlots ?? 0)`,
  capped at 4. `WEAPONS[id].cardSlots` is deleted.
- **Gear cards apply to gear stats**, not weapon damage — a card in a helmet must
  not buff your sword. `aggregateCards` gets called per-item and the damage path
  reads only the HELD WEAPON's aggregate (it already does).

⚠️ **This touches the co-op protocol.** A weapon on the floor now carries a
rarity + socketed cards. `braindeadbot-service/src/realtime/protocol.ts` must
carry them or a picked-up weapon differs per screen.

---

## 4. UPGRADE RISK — the anti-hoard mechanic

The heart of the user's design. The Weaponsmith gains **Upgrade**, separate from
the existing repair/add-slot.

```ts
/** Each upgrade adds +1 level: +12% damage, +8% durability … and RISK. */
export interface UpgradeState { level: number; }

/** Break chance climbs with the level. Below SAFE_LEVEL it is ZERO — early
 *  upgrades are a pure win, so the mechanic teaches before it bites. */
export const UPGRADE_SAFE_LEVEL = 3;
export function breakChance(level: number): number {
  if (level < UPGRADE_SAFE_LEVEL) return 0;
  return Math.min(0.6, (level - UPGRADE_SAFE_LEVEL + 1) * 0.12);
}
```

| Level | Damage | Break chance on the NEXT upgrade |
|---|---|---|
| 0→1, 1→2, 2→3 | +12% each | **0%** — safe, teaches the system |
| 3→4 | +12% | 12% |
| 4→5 | +12% | 24% |
| 5→6 | +12% | 36% |
| 6→7 | +12% | 48% |
| 7→8 | +12% | 60% (cap) |

**On a failed upgrade the weapon is DESTROYED, and its socketed cards go with
it.** That is the whole incentive to keep farming. The UI must state the exact
percentage before the click, and require a confirm — a hidden coin-flip that eats
a legendary is a feel-bad, a *stated* 36% gamble the player chose is a story.

Open question for playtest: whether a failed upgrade should return the cards to
the stash instead of destroying them. Starting position: **cards are destroyed**
(maximum anti-hoard pressure); soften if it plays too harshly.

---

## 5. What comes OUT

- `CardModifier.grantsAbility` — abilities are the skill tree's job (§0).
- `CardModifier.abilityCostMult` — same reason.
- `skill-runtime.ts`: the card-grant merge in `unlockedAbilities()` and
  `abilityCostMult()`. `syncAbilitySlots()` STAYS — a weapon swap still has to
  drop a Q/E binding the tree no longer supports.
- `WEAPONS[id].cardSlots` — replaced by rarity.
- The 6 skill-cards (`magnetheart`, `reaperclock`, `brutewhirl`, `wispspark`,
  `pinsoul`, `bloateroil`, `witchfocus`) — re-cut as gear-effect cards in the 25.

---

## 6. Card FACE redesign — monster-first

The user's actual complaint: the card reads as a skill chip. Today the face
invents generic perk names from raw stats (`holo-card.ts:114-118` turns any
`cooldownMult < 1` into "Quickdraw"), and those invented names are the loudest
thing on the card while the source monster is 12px at 62% opacity in a corner.

- **Monster name/icon BIG in the art window**, tinted by rarity.
- The `COMMON · SWIFT CHIP` banner becomes **`SLAIN: SPIDER`** (or
  `SLAIN: ZOMBIE — HULK` for a sub-type).
- Kill the invented perk names. Show plain stat lines: `−10% cooldown`,
  `+25% durability`. The stats ARE the text.
- Keep the rarity foil/holo treatment — that part reads well.

---

## 7. Checklist

### Phase A — data model
- [ ] A1. `ItemRarity` + `SLOTS_BY_RARITY` in `items.ts`; delete `cardSlots`.
- [ ] A2. `WeaponState.rarity`; `GearState.rarity` + `.cards`.
- [ ] A3. `weaponSlotCount()` off rarity; new `gearSlotCount()`.
- [ ] A4. Rarity roll on weapon/gear drops, depth-biased.
- [ ] A5. `CardDef.subType?: ZombieType`.
- [ ] A6. Remove `grantsAbility` / `abilityCostMult` + their `skill-runtime` merge.
- [ ] A7. Tests: slot counts by rarity, gear cards never touch weapon damage.

### Phase B — the 25 cards
- [ ] B1. Rewrite `CARDS` to exactly 5 per rarity, per §2.
- [ ] B2. Every non-mythic has a `source`; the 8 sub-type cards have `subType`.
- [ ] B3. `rollCardDrop` prefers a sub-type match over a family match.
- [ ] B4. Bestiary files sub-type cards under the SUB-TYPE row.
- [ ] B5. Tests: exactly 5/rarity; every monster reachable; sub-type affinity works;
      the drop RATE is unchanged (the invariant from the last wave).

### Phase C — upgrade risk
- [ ] C1. `UpgradeState` on weapons + gear; `breakChance()` pure + tested.
- [ ] C2. Weaponsmith "Upgrade" action; destroys the item (and its cards) on fail.
- [ ] C3. UI states the exact break % and requires a confirm.
- [ ] C4. Tests: 0% below the safe level, monotonic climb, hard cap, and that a
      destroyed weapon frees its slot cleanly.

### Phase D — card face
- [ ] D1. Monster-first `holo-card.ts` per §6; drop the invented perk names.
- [ ] D2. `SLAIN: <MONSTER>` band, sub-type aware.
- [ ] D3. Headless screenshot of one card per rarity to confirm it reads.

### Phase E — ship
- [ ] E1. `pnpm test` green; 0 dungeon type errors; `next build` clean.
- [ ] E2. **Co-op protocol**: weapon/gear rarity + sockets on the wire (§3).
      This is the one that needs a SERVICE change.
- [ ] E3. In-engine QA via the descend recipe (walk to `board` + E).
- [ ] E4. Update `HANDOFF.md`; commit; deploy when the tree is clean.
