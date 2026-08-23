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
| **Review Run** (`table`) | grade, floor, kills, best combo, gear, purse | ✅ **DONE** — all six rows carry real numbers; gear is plate SOAK (`worn/total`), not a count of pieces |
| **Manage Loadout** (`armory`) | 3 plate slots, repair-all, 4 elemental sets | ✅ **DONE** — rules in `pk_core::economy::armory`, art from the icon bake, silhouettes for the sets |
| **Trade** (`bar`, the Alchemist) | shelf of 6 potions + Empty Flask; brew book over pouch + flasks | ✅ **DONE** — `economy::alchemist`; the brew book is a GRID, see below |
| **Forge / Repair** (`forge`) | repair, add socket, the two-step upgrade gamble, insure, sacrifice | ✅ **DONE** — `economy::forge` |
| **Cards** (`dealer`) | three pulls you cannot choose, reroll the shelf, socket/unsocket into weapons | ✅ **DONE** — `economy::dealer` + the card bake + `screens::dealer` (3 tabs, 12 tests), wired to the station: walk up and it opens |
| **Risk Gold** (`gambler`) | slots, roulette, blackjack, darts | ✅ **DONE** — `pk_core::gambler` + `gambler::drive` + `screens::gambler` + the `Cabinet` shell; all four playable, wired to the station |

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
3. **The dealer is THREE tabs** (shelf / sockets / stash), where the oracle has
   one scrolling body. A card cell is 78px tall and **cannot shrink**: only 56
   and 112 blit 1:1, so a smaller cell would resample the very art the two-tier
   bake exists to protect. Two card rows plus the sheet's chrome is 344 against
   a 322 ceiling, so sockets and stash cannot share a plate — each gets its own,
   and each lands with 90+px spare. Sockets are one row for all weapons (three
   weapons × three sockets is nine cells, not three rows), and the stash pages
   eight at a time with the pager on its heading line.
4. **The gambler's viewport is 130px**, not the oracle's 520×200 canvas. The
   oracle's cabinet is a DOM overlay with its own `requestAnimationFrame`; this
   one is a sheet in a 322px box that also needs a game picker, a stake row and
   a control row. At 200 the cabinet wants 360 and overflows by 38; at 130 it
   lands at 296. The games also draw through a PAINT LIST (`GamePaint`) rather
   than a canvas, so their animation stays in `pk_core` where the tests are and
   the screen stays a layout.
5. **The pouch is gem chips**, not `Label xN` joined by spaces — fourteen labels
   do not fit in 528px, and the oracle's own row ellipsizes them away.
6. **The elemental sets show a silhouette** of the armour in the set's steel.
   The oracle draws a 3px colour bar; beside three rows of real gear that reads
   as a bullet point.
7. **The upgrade roll is an argument.** `upgradeWeapon` calls `Math.random()`;
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
- ✅ **THE DEALER IS COMPLETE** (2026-08-11) — rules, art, screen and wiring.
  Walking up to the station opens it; buy, reroll, socket, unsocket, pick and
  page all reach `pk_core::economy::dealer`. Two wiring rules are pinned by
  tests because neither is visible in the types: the shelf's seeded stream must
  be **written back** after a reroll (clippy correctly flags the `.clone()` as
  redundant, and dropping the write-back with it would deal the same three
  cards forever), and `picked` must **clear on a successful socket only** —
  `socket_stash_card` removes the card, so every later index shifts down and a
  surviving pick would name a different card, while a refusal moves nothing and
  must keep it.
- ✅ **CARD FACES ARE BAKED** (2026-08-11) — `legacy/scripts/bake-card-faces.mjs`
  → `assets/gui/cards/`, 100 PNGs / 2.1MB, read by `pk_gui::cards` and blitted
  by `im::draw_card` (non-square; `draw_icon` is square-only and cannot draw a
  card). A card id encodes level and shine, so the full space is 25 × 10 × 2 =
  500 faces; what ships is 100, and the split was measured rather than reasoned:
  - **level is not baked** — it moves 0.6% of a 56px face against an 8.2%
    control for two *different* cards, and levels 1/7/10 are indistinguishable
    on screen. `cards::level_seal_at` gives the port the seal's position.
  - **shine is baked** — it moves 11.7%, more than swapping to a different card
    entirely, and is drawn from the face's own `rand()` stream so it cannot be
    composited on afterwards.
  - **both display sizes are baked** (56 and 112, the vendor box's zoom-2
    ceiling). 716/512 does not survive integer scaling, so there is no single
    master that downscales exactly; a 2× nearest blit of the 56 tier is
    unreadable where the 112 bake reads its title and every stat row.
- ⚠️ **The bake's first palette gate could not fire.** It was copied from the
  icon bake, and a sabotage run showed it passing on all 76 faces a greyscale
  palette destroys — `monsterPortrait()` installs the palette itself, and the
  art window is mostly frame and glow that never touch the palette. The
  fallback also collapses portraits toward BLACK rather than mid-grey, which no
  spread-based statistic sees. The shipped gate counts lit pixels on the
  SUBJECT box and is verified to fail closed. See the script's header.
- ✅ **THE CASINO IS PLAYABLE** (2026-08-11) — the last unbuilt counter. Three
  layers, split where the oracle splits them: `gambler::drive` (round clocks,
  no pixels), `screens::gambler` (layout only), and `pk_game::gambler`'s
  `Cabinet` (the only caller of `gambler::table`, which is the only thing that
  moves gold). Two rules are pinned by tests because neither is visible in the
  types:
  - **every exit settles.** Four ways out — BACK, ESC, the sheet's close
    button, `E` — and only the first is a `Close` action. The outcome is decided
    at `play`, so a round abandoned by any of the other three still owes its
    payout; without this "a teardown eats the stake".
  - **all nine roulette bets fit on the control row.** At the first cut's
    padding they needed 442px of a 434px row and `13-18` was dropped SILENTLY
    by the overflow break — a third of the board unbettable, every test green.
- ✅ **THE RUN SUMMARY IS COMPLETE** (2026-08-11) — gear and purse were em
  dashes on purpose while the economy was unbuilt, because *a number on a
  summary screen is read as a measurement* and a "0 gold" the game had never
  computed would have been a lie. Both are real now: purse from `Wallet`, gear
  as plate SOAK (`worn/total`) rather than a count of pieces — a knight in three
  cracked plates and one in three fresh ones both own three, and only one of
  them is about to die. A slot never bought is on neither side of the ratio.
- **No persistence.** Nothing survives a relaunch.
