# CARD LEVELS, SHINIES & THE STACKED HAUL

Three changes to the card system, all of them pulling on the same thread: a card
should stop being *the same object* every time it drops.

Today a Spider Silk off floor 1 and a Spider Silk off floor 17 are byte-identical
strings, so the end-of-floor haul is a wall of repeated faces and the twelfth copy
of a common is worth exactly as much as the first. That is the complaint.

---

## §0 — What exists now (read this before editing)

| Thing | Where | Shape |
|---|---|---|
| Card catalogue (25 defs) | `cards.ts` `CARDS` | `Record<CardId, CardDef>`, `CardId = string` |
| A card *in the world* | everywhere | a **bare string**: `state.cardStash: string[]`, `WeaponState.cards: string[]`, `GroundItem.id: string` |
| Drop roll | `cards.ts` `rollCardDrop` | rarity gates → affinity pick → base id |
| Aggregation | `cards.ts` `aggregateCards` | folds `CARDS[id].modifier` over socketed ids |
| The face | `render/holo-card.ts` `paintCard(canvas, id)` | 512×716 canvas, deterministic from the id |
| The DOM frame | `ui-cards.ts` `holoCard(id, opts)` | `.hcard` + painted `<canvas>` + tilt/glare |
| **End-of-floor haul** | `card-reader.ts` `showCardHaul` | one cell per `state.floorHaul` entry — *the screen this task is about* |
| Ground sprite | `economy/loot.ts`, `core.ts:581` | `ITEM_PAINTS[id]` — keyed by **base id** |
| Co-op wire | `coop.ts` `SnapItem.i` | the id string, verbatim |

Cards are **run-scoped**: nothing writes `cardStash` to localStorage, so there is
no save migration to worry about. The only persistence is the corpse-run drop,
which is in-memory.

---

## §1 — The enabler: instance ids

Everything downstream of a card is typed `string`. Rather than convert four
collections, a co-op wire format and a corpse-run snapshot to objects, the level
and the shiny flag are **encoded into the id**:

```
spidersilk        →  level 1, plain     (canonical; every existing id still valid)
spidersilk#4      →  level 4, plain
spidersilk#4s     →  level 4, SHINY
spidersilk#1s     →  level 1, SHINY
```

`cardKey(base, level, shiny)` is canonical: level 1 + not shiny collapses back to
the bare base id, so nothing in the game ever holds two spellings of the same card.

New in `cards.ts`:

- `parseCard(id) → { base, level, shiny }` — tolerant; anything unparseable reads as level 1 plain.
- `cardBase(id) → CardId` — for `ITEM_PAINTS`, `cardsOfSource`, affinity.
- `cardKey(base, level, shiny) → CardId`
- `cardDef(id) → CardDef | undefined` — **the new lookup**, memoised. Returns the
  catalogue def for a plain card and a *derived* def (scaled modifier, generated
  description, `level`/`shiny` fields) for an instance.

`CARDS[id]` stays the raw catalogue and keeps its meaning: **base defs only**.
Every site that can see a *world* card switches to `cardDef(id)`. That is the whole
migration, and it is mechanical (§5 lists the sites).

### Why not objects

`WeaponState.cards`, `GroundItem.id`, `SnapItem.i` and `HaulEntry.id` are all
strings today, three of them crossing a serialisation boundary. Encoding keeps the
diff at "swap the lookup function" instead of "rewrite the loadout model".

---

## §2 — Stat scaling

A level is a **multiplier on the card's own delta from neutral**, never a rewrite
of what the card does. A Hulk Knuckle at level 6 is a bigger Hulk Knuckle — bigger
damage *and* a bigger cooldown penalty. Scaling only the upside would quietly
launder every drawback card into a strict upgrade, and the drawback cards are a
design pillar here (`gladeath`, `bloodpact`, `hulkknuckle`).

```
growth = 1 + CARD_LEVEL_STEP·(level − 1) + (shiny ? SHINY_GROWTH : 0)
```

| Constant | Value | Reasoning |
|---|---|---|
| `CARD_LEVEL_MAX` | 10 | Level 10 ≈ 2.08× the base delta. Beyond that the aggregate stacks past what the enemy HP curve can absorb. |
| `CARD_LEVEL_STEP` | 0.12 | +12% of the delta per level — a level is felt but a level-2 is not a must-reroll. |
| `SHINY_GROWTH` | 0.30 | A shiny is worth ~2.5 levels. Enough to be a *pull*, not enough that a shiny common beats a plain epic. |

Per field:

| Field | Rule | Clamp |
|---|---|---|
| `damageMult`, `durabilityMult`, `pinballMult`, `materialMult` | `1 + (v−1)·growth` | `durabilityMult ≥ 0.05` |
| `cooldownMult` | same formula, both directions | `[0.35, 2]` — an unclamped level-10 Time Ripper reaches 0.17 and the swing animation stops reading |
| `damageFlat`, `lifesteal`, `pierce` | `max(v, round(v·growth))` — integers, never regress | — |
| `critChance` | `v·growth` | `≤ 0.9` (the aggregate caps at 1 anyway) |
| `critMult` | `1 + (v−1)·growth` | `≤ 6` |
| `bolt`, `onHit` | untouched — booleans don't have a magnitude | — |

Multipliers are rounded to 3dp so float noise never reaches the face.

**Descriptions.** The hand-written `description` ("+35% durability") becomes a lie
the moment a card levels. `describeModifier(m)` generates the line from the actual
modifier; a level-1 plain card keeps its hand-written string (it reads better),
everything else gets the generated one.

---

## §3 — Rolling a level, and a shiny

`rollCardDrop` **keeps returning base ids** — its rand-stream ordering is pinned by
`cards.test.ts` against a rate-inflation regression, and that guard is worth more
than the convenience. The level/shiny roll sits in a wrapper:

```ts
rollCardInstance(opts, rand) = cardKey(rollCardDrop(opts, rand), rollCardLevel(...), rollShiny(...))
```

Draws happen strictly *after* the gates have already decided a card drops, so the
drop RATE is untouched by construction.

**Level rides depth** — this is the "cards get better as you go up" ask:

```
base = 1 + floor((floor − 1) / 2)     // floors 1-2 → 1, 3-4 → 2, 5-6 → 3, …
jitter: 20% base−1 · 55% base · 20% base+1 · 5% base+2, clamped to [1, 10]
```

So floor 1 hands out level 1s with the occasional 2, and floor 19 hands out 9s and
10s. The same monster's card is a different card at depth, which is the point.

**Shiny** is flat and rare: `SHINY_CHANCE = 0.04`, doubled off a boss, capped at
0.12. Roughly one shiny per 1–2 runs — a thing you shout about, not a thing you
plan around.

Non-dungeon sources roll off `state.runDeepestFloor` so a deep run's tavern shelf
keeps pace with its loot:

| Source | Level | Shiny |
|---|---|---|
| Dungeon drop (`economy/loot.ts`) | `rollCardLevel(state.level)` | rolled, boss-boosted |
| Tavern shelf (`rollBarOffers`) | `rollCardLevel(runDeepestFloor)` | rolled at base rate |
| Forge (2 commons → 1 rare) | `max(level of the two) `, +1 if both matched | shiny if **either** input was |
| Reroll (same rarity, new card) | **preserved** — you paid to reroll the card, not to lose the level | preserved |
| Un-socket (drops one rarity tier) | preserved | preserved |
| Pack Rat legacy perk | `rollCardLevel(1)` | rolled |

---

## §4 — The haul screen (the headline change)

`card-reader.ts`, `showCardHaul`.

**Stacking.** A new pure, unit-tested `stackHaul(entries)` folds
`state.floorHaul` by **instance id** — a level-3 Spider Silk and a level-1 Spider
Silk are genuinely different cards and must not merge, but three level-3s are one
stack of `×3`.

```ts
stackHaul(entries) → Array<{ id, count, fresh, notes: string[] }>
```

Ordered **best pull first**: rarity tier desc → shiny → level desc → count desc.
The thing worth looking at leads the screen instead of being buried at position 9.

**The stack reads as physical.** Each cell with `count > 1` renders up to two
offset backing plates behind the painted face (rotated ~2°/4°, rarity-tinted) plus
a `×N` chip on the corner. `faceWidth()` now sizes off the number of *stacks*, so
a 12-card haul of 4 kinds gets big readable faces instead of 92px thumbnails.

Header line becomes `12 CARDS · 4 KINDS · 2 NEW`.

**NEW is per base card.** `state.seenCards` tracks base ids, so a level-7 Spider
Silk is not "NEW" just for being level 7 — but a **shiny always flags**, because a
shiny genuinely is the first one you have seen.

**Shiny badge sits in the NAME row, not on the card.** First cut floated a
`✦ SHINY` pill over the bottom of the face; rendered, it landed squarely on the
stats strip — a badge hiding the numbers it is bragging about. It now rides the
name line beside `NEW`. The painted face already carries its own `✦ SHINY` footer
and the prismatic border, so this is the third and least intrusive signal.

---

## §5 — Call-site migration (`CARDS[id]` → `cardDef(id)`)

Every site below can see a *world* card and must resolve instances:

| File | Site |
|---|---|
| `ui-cards.ts:47` | `holoCard` — plus shiny class + level chip |
| `card-reader.ts:123,175` | haul cells |
| `pickup-toast.ts:185` | corner toast |
| `render/holo-card.ts:218,657` | `paintCard`, `cardTier` |
| `economy/pickups.ts:48` | `pickUpCard` |
| `economy/loot.ts:55,56,64` | rarity latches + `ITEM_PAINTS[cardBase(id)]` |
| `core.ts:581` | co-op `spawnGhostItem` → `ITEM_PAINTS[cardBase(id)]` |
| `tavern.ts:347,366,788,805,846,931,946,955,957` | dealer, forge, reroll, un-socket, insurance rank |
| `menu.ts:535` | un-socket |
| `dev/window-hooks.ts:241,251` | `id in CARDS` → `cardDef(id)` so a dev can drop `spidersilk#8s` |
| `dev/window-hooks.ts` | **new** `__dungeonHaul(ids?, floor?)` — opens the haul screen on a synthetic haul. It is otherwise only reachable by descending off a floor that dropped cards, which made the stacking, level badges and shiny treatment the hardest surface in the game to look at |
| `cards.ts` internals | `aggregateCards`, `cardFitsKind`, `socketCard` |

**Left alone on purpose:** `bestiary.ts` and `cel-painter.ts` iterate `CARD_IDS` —
they are talking about card *kinds*, not instances, and `CARDS[...]` is correct there.

**The stash is NOT stacked.** `menu.ts`/`tavern.ts` address stash cards by array
index (`data-idx`) for pick/socket/forge/reroll; collapsing duplicates would break
that contract for a screen where you socket cards one at a time anyway.

---

## §6 — The face

`paintCard` gains two marks:

- **Level chip** — `Lv N` plate to the right of the stage pill, drawn only for
  level ≥ 2. The `PWR` number already derives from the modifier, so it scales for free.
- **Shiny** — prismatic border regardless of tier, a stronger baked foil pass, a
  scatter of 4-point sparkle stars over the art window, and `✦ SHINY` in the footer
  beside the rarity stars.

The DOM frame gets `.hcard-shiny` (animated rainbow ring + faster shimmer) so a
shiny is identifiable at 74px thumbnail size, before you can read anything on it.

---

## §7 — Tests

| File | Asserts |
|---|---|
| `card-levels.test.ts` (new) | round-trip `cardKey`/`parseCard`; level 1 plain canonicalises to the bare id; deltas scale in **both** directions (drawbacks grow too); clamps hold at level 10; `rollCardLevel` rises with depth and stays in range; shiny rate sits near 4%; `aggregateCards` folds scaled instances |
| `card-reader.test.ts` | `stackHaul` merges identical ids with the right count, keeps different levels apart, orders best-first, and ORs `fresh` |
| `cards.test.ts` | unchanged — `rollCardDrop` still returns base ids, so the pinned rate invariant still means what it meant |

---

## §8 — Order of work

1. `cards.ts` — encoding, scaling, `cardDef`, `rollCardLevel`/`rollShiny`/`rollCardInstance`.
2. `card-levels.test.ts` — pin the math before anything renders it.
3. `render/holo-card.ts` — resolve instances, level chip, shiny treatment.
4. `ui-cards.ts` — resolve, shiny class, level badge.
5. `card-reader.ts` — `stackHaul` + the stacked cell.
6. Call sites: `pickup-toast`, `pickups`, `loot`, `core`, `tavern`, `menu`, `ledger`, `window-hooks`.
7. `vitest run` + `tsc --noEmit`.
8. **Render it and look** — `__dungeonHaul()` under headless chromium. Everything
   above is DOM and canvas; the stacking, the plates, the count chip, the level
   chip and the shiny treatment are only verifiable in pixels, and the badge
   overlap in §4 was invisible until the screenshot.

---

## §9 — Status: SHIPPED

All of the above is implemented. 1059 pinball-knight tests pass; `tsc --noEmit`
is clean for the game. Verified in a real render: a 12-card haul folds to 6
stacks (`×4`, `×3`, `×2`) ordered mythic→common, level chips on the faces, two
shinies with prismatic borders and sparkle fields, and every levelled card
printing its own scaled stat line — including the level-10 shiny Hulk Knuckle
reading **"+143% damage, 36% slower"**, i.e. the drawback grew with the upside,
which is the rule §2 exists to protect.
