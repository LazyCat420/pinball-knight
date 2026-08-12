# The tavern, 1:1 — what the old game has, and what the port has

> **Standing instruction (user, 2026-08-11):** *"keep auditing 1:1 how the tavern
> is in the old game and copy it over and convert into rust/webgpu."*

This is the audit for ONE scene. It is deliberately not the whole-tree
[1:1 plan](one-to-one.md): that one measures 61,936 uncovered lines across the
game and answers "how far to the finish line". This one answers a smaller,
sharper question — **stand at each station in the old game, list what it does,
and say whether the port does it** — because that is what the tavern being
"finished 1:1" means, and it is the gate before the maze starts.

Sources on the oracle side, all under
`legacy/src/game/pinball-knight/`:

| file | lines | what it holds |
|---|---:|---|
| `gui/screens/tavern.ts` | 607 | every counter's LAYOUT (`potionsBody`, `armorBody`, `weaponsBody`, `cardsBody`) |
| `economy/tavern-shop.ts` | 453 | every counter's RULES — prices, stock, 24 actions |
| `cards.ts` | 885 | the card system: rarity, levels, shiny, sockets, rerolls |
| `reagents.ts` | 147 | 14 monster materials + the per-enemy drop table |
| `recipes.ts` | 86 | the brew book (16 recipes) + `canCraft`/`craftCost` |
| `armor-styles.ts` | 127 | the four elemental sets + `styleGearGrant` |

## The stations

| station | what the old game does there | port |
|---|---|---|
| **Descend** (`board`) | commit the loadout, drop to the next floor | ✅ **DONE** — real hand-off through `FloorLoading` |
| **Review Run** (`table`) | grade, floor, kills, best combo, gear, purse | 🟡 **CHROME ONLY** — six rows painted; `gear`/`purse` are em-dashes because `TavernStats` has neither |
| **Manage Loadout** (`armory`) | 3 plate slots, repair-all, 4 elemental sets | ✅ **DONE** — rules in `pk_core::economy::armory`, art from the icon bake, silhouettes for the sets |
| **Trade** (`bar`, the Alchemist) | shelf of 6 potions + Empty Flask; brew book over pouch + flasks | ✅ **DONE** — `economy::alchemist`; the brew book is a GRID, see below |
| **Forge / Repair** (`forge`) | repair, add socket, the two-step upgrade gamble, insure, sacrifice | ✅ **DONE** — `economy::forge` |
| **Cards** (`dealer`) | three pulls you cannot choose, reroll the shelf, socket/unsocket into weapons | 🟡 **RULES UNBLOCKED** — `pk_core::cards` is ported; still needs `economy::dealer`, a screen, and a card-face bake |
| **Risk Gold** (`gambler`) | slots, roulette, blackjack, darts | 🟡 **RULES DONE, NO UI** — `pk_core::gambler` is complete with 250 tests; the cabinet screen is unbuilt |

## Where the port DEVIATES, and why

Every one of these is a decision with a reason, not drift. The rule they share:
the oracle scrolls its counters, and this port is under a standing instruction
not to.

1. **The metrics are smaller.** Rows 34/32 → 22, headings 24 → 14, buttons
   76×22 → 64×16. The oracle's vendor bodies are taller than its 338px design
   box and it wraps them in `beginScroll`; the port shrinks until the counter
   fits and keeps the region as the failure mode for a future row.
   *8px text is the floor — the baked atlas has no smaller size, and a size the
   bake does not ship draws nothing at all.*
2. **The brew book is an 8×2 icon grid with a detail strip**, not sixteen rows.
   Sixteen 22px rows is 352px of content in a 228px view; no shrinking closes
   that. First press selects, second brews.
3. **The pouch is gem chips**, not `Label xN` joined by spaces — fourteen labels
   do not fit in 528px, and the oracle's own row ellipsizes them away.
4. **The elemental sets show a silhouette** of the armour in the set's steel.
   The oracle draws a 3px colour bar; beside three rows of real gear that reads
   as a bullet point.
5. **The upgrade roll is an argument.** `upgradeWeapon` calls `Math.random()`;
   the port draws from a seeded `Mulberry32` in the shell and passes the value
   in, so the rules stay pure and a shatter is replayable.

## What is faked, and must stop being faked

Both are marked DEV STOCK in the code and both exist because the dungeon does
not yet hand the player anything:

- `dev_satchel()` — 2 of every reagent, 2 flasks. Real source: `ENEMY_DROPS`
  (P4 combat). Without it the brew book is sixteen grey tiles.
- `dev_weapon()` — a rare Sword at 12/30 with two socketed cards. Real source:
  weapon pickups (P4). Without it the smith is one grey sentence.
- The purse opens at 1200g every launch. Real source: a persisted wallet
  (track F) — the oracle keeps gold and unlocked styles in `localStorage`.

## What is missing that no counter can hide

- ✅ **`cards.ts` IS PORTED** (2026-08-11) — `pk_core::cards`, 35 tests, with
  the 25-card catalogue generated from the oracle's own literal and diffed back
  against it field for field. The rarity RANK the forge was missing now exists,
  so **insurance really does save the rarest first**: the shell passed a flat
  `|_| 0` from the day the forge shipped, which made the stable sort a no-op
  and "rarest" silently mean "socket order". An unknown id ranks −1, below
  common, and is dropped first — the oracle's `indexOf(undefined)`, kept.
- **The dealer still needs its screen and its shop rules.** `cards.ts` was the
  blocker; `economy::dealer` and `screens::dealer` are the remaining work.
- **Card faces are a separate bake.** A card in the UI is `cardFaceAt()`, a
  different renderer at a different aspect — not an `itemIcon`.
- **The run summary has no economy behind it** — gear and purse are em-dashes.
- **No persistence.** Nothing survives a relaunch.
