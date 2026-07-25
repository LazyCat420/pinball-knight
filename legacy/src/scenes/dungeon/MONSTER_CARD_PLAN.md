# Monster Cards & Zombie Sub-Types — plan + checklist

_Written 2026-07-24. Scope: `braindeadbot-client/src/scenes/dungeon/`.
`braindeadbot-service` needs **no** card/monster logic — it is co-op realtime
transport only (`src/realtime/{session,peer,lobby,protocol}.ts`), so the only
service-side touch is one new item kind in the co-op TAKE payload (§5)._

---

## 0. What already ships — read this before building anything

Three of the four things asked for are **already the shipped design**. Verified
in source at the line numbers below. Do not rebuild them.

| Asked for | Already true | Where |
|---|---|---|
| Cards socket into weapons like Ragnarok, not standalone powerups | ✅ Exactly this. `WeaponState.cards[]` bounded by `WEAPONS[id].cardSlots` (cap 3, blacksmith-upgradable via `bonusSlots`) | [items.ts:52-88](items.ts#L52-L88), [cards.ts:206-217](cards.ts#L206-L217) |
| Monsters drop money | ✅ Coins mint per kill through one funnel | [core.ts:1063](core.ts#L1063) `setCoinDropHandler`, `creditGold` [core.ts:2495](core.ts#L2495) |
| Monsters drop items themed to the monster (spider→silk, zombie→rotflesh) | ✅ The **whole RO reagent model** ships. 14 reagents, `ENEMY_DROPS` exhaustive by `EnemyKind` | [reagents.ts:86-112](reagents.ts#L86-L112) — `spider: silk+fang`, `zombie: rotflesh`, `golem: ironshard`, `reaper: grimbone` |
| Monsters rarely drop cards | ✅ ~8% common off any kill; rare/epic gated to bosses; legendary once per run off a floor-5+ boss | [cards.ts:232-253](cards.ts#L232-L253) `rollCardDrop`, wired [core.ts:2482](core.ts#L2482) |
| Different-looking zombies (no legs, no arms, etc.) | ⚠️ **Cosmetic only.** `ZOMBIE_VARIANTS` varies silhouette — `stump: "L"\|"R"\|null`, `spur`, `bone: ribs\|skull\|spine`, `tatter`, `gore` | [render/cel-painter.ts:1213-1219](render/cel-painter.ts#L1213-L1219) |

So the **actual gaps** are three, and they are the interesting ones:

1. **Zombie variants are paint, not behaviour.** Five distinct silhouettes all
   share `ZOMBIE_HP = 3` ([constants.ts:1574](constants.ts#L1574)),
   `ZOMBIE_R = 0.3`, and one `levelConfig().zombieSpeed`. The one-armed zombie
   fights identically to the intact one. A stumped zombie should *limp*; a
   legless one should *crawl*; there are no fast/slow/big/midget zombies at all.
   Sub-types are `EnemyKind`-free — they must **not** become new `EnemyKind`s
   (see §1 rationale).
2. **Cards carry no monster identity.** A card is an anonymous stat chip. There
   is no "this card came off a Spider", no bestiary, no reason to hunt a
   specific monster for a specific card. That's the missing half of the RO
   card fantasy.
3. **Cards carry no *skills*.** `CardModifier` has 12 stat/on-hit fields
   ([cards.ts:23-49](cards.ts#L23-L49)) but cannot grant an **active ability**
   — `AbilityId` unlocks live only in the skill tree
   ([skills.ts:38](skills.ts#L38) `unlockAbility`). A card that hands you Blade
   Storm when socketed is the "skills attached to the weapon" ask, and the
   plumbing for it already exists on the skills side.

---

## 1. Zombie sub-types — the shape

**Decision: sub-types are a MODIFIER on `kind: "zombie"`, not new `EnemyKind`s.**

Rationale, and it is load-bearing: `EnemyKind` is consumed by **six exhaustive
`Record<EnemyKind, …>` tables** — `STATS` ([entities/zombie.ts:108](entities/zombie.ts#L108)),
`HP_BY_KIND` ([core.ts:1116](core.ts#L1116)), `ENEMY_DROPS`
([reagents.ts:86](reagents.ts#L86)), the bite table in combat.ts, plus the
`spawnKind` switch and `EXPANSION_SKIN`. Adding 8 zombie flavours as kinds means
8×6 = 48 new table rows that all say the same thing, and it would fork
`rotflesh` drops across 9 keys. A `ztype` field costs one new optional field on
`Zombie` and one lookup table.

### 1.1 The roster (8 sub-types)

New file **`zombie-types.ts`** (pure, DOM- and three-free, unit-tested — same
discipline as `cards.ts` / `reagents.ts`):

```ts
export type ZombieType =
  | "shambler"   // baseline — what a zombie is today (speed 1.0, hp 3, r 1.0)
  | "runner"     // fast, frail: speed 1.75, hp 2, scale 0.95
  | "lurcher"    // slow, tanky: speed 0.55, hp 6, scale 1.1
  | "hulk"       // BIG: speed 0.7, hp 9, scale 1.55, bodyR 1.5, knocks you back
  | "midget"     // small, quick, low reach: speed 1.35, hp 2, scale 0.62, bodyR 0.6
  | "crawler"    // NO LEGS: very slow, hard to hit at speed, hp 4, scale 0.5 (prone)
  | "flailer"    // NO ARMS: bites instead of swings — shorter reach, faster windup
  | "hobbler";   // one leg / stump: LIMPS — alternating fast/slow gait
```

Each entry is a multiplier bundle over the zombie baseline, never absolute
numbers, so `levelConfig().zombieSpeed` floor-scaling keeps working:

```ts
export interface ZombieTypeDef {
  id: ZombieType;
  label: string;              // "Crawler" — bestiary + damage-number use
  speedMult: number;          // × levelConfig().zombieSpeed
  hpMult: number;             // × ZOMBIE_HP, rounded, min 1
  scale: number;              // sprite mesh scale
  bodyRMult: number;          // MUST be set whenever scale ≠ 1 (see §1.4)
  reachMult: number;          // × ZOMBIE_CONTACT_RANGE
  windupMult: number;         // × ZOMBIE_ATTACK_WINDUP
  weight: number;             // spawn weight within the zombie kind
  fromLevel: number;          // gate the nastier ones behind depth
  /** Forces a silhouette from ZOMBIE_VARIANTS: crawler/flailer/hobbler must
   *  visually match their stat story (see §1.3). null = any variant. */
  variantFilter: ((v: ZVariant) => boolean) | null;
  gait?: "limp" | "crawl";    // animation hook, §1.5
  knockback?: number;         // hulk only
}
```

Plus `pickZombieType(hash: number, level: number): ZombieType` — weighted,
level-gated, driven by the **same spawn hash** `spawnHordeMember` already uses
([core.ts:1373](core.ts#L1373)) so co-op stays seed-deterministic. **No
`Math.random()` on the spawn path** — the pool must agree on the horde.

### 1.2 Numbers, first pass (tune after playtest)

| Type | speed× | hp× (→hp) | scale | bodyR× | reach× | windup× | weight | fromLevel |
|---|---|---|---|---|---|---|---|---|
| shambler | 1.00 | 1.0 → 3 | 1.00 | 1.0 | 1.00 | 1.00 | 34 | 1 |
| runner | 1.75 | 0.67 → 2 | 0.95 | 0.95 | 1.00 | 0.75 | 16 | 2 |
| lurcher | 0.55 | 2.0 → 6 | 1.10 | 1.10 | 1.05 | 1.30 | 14 | 1 |
| hulk | 0.70 | 3.0 → 9 | 1.55 | 1.50 | 1.35 | 1.45 | 6 | 4 |
| midget | 1.35 | 0.67 → 2 | 0.62 | 0.65 | 0.70 | 0.85 | 12 | 2 |
| crawler | 0.40 | 1.33 → 4 | 0.50 | 0.70 | 0.65 | 1.10 | 8 | 3 |
| flailer | 1.15 | 1.0 → 3 | 1.00 | 1.0 | 0.60 | 0.70 | 6 | 3 |
| hobbler | 0.85* | 1.0 → 3 | 1.00 | 1.0 | 0.90 | 1.00 | 4 | 2 |

\* hobbler's `speedMult` is the **average**; the limp gait oscillates ±60%
around it (§1.5).

Weights sum to 100 so the table reads as percentages. Shambler stays the
plurality — the horde must still read as *a horde*, not a freak show.

### 1.3 Silhouette ↔ stats must agree

The existing `ZOMBIE_VARIANTS` pool already contains stumps and bared bone. A
crawler that renders with two intact legs is a lie the player will notice, so:

> ⚠️ **CORRECTION made during implementation.** This section originally had the
> limbs backwards: the existing `ZVariant.stump` is an **ARM** stump
> (`zombieArm(..., stump)`), and there was no leg field at all. So the new field
> is **`legStump`**, not `armStump`, and `stump` gained `"both"` for the flailer.
> As built:
- `crawler` → `variantFilter: v => v.legStump === "both"` **and** render prone (§1.5).
- `flailer` → `variantFilter: v => v.stump === "both"` (both ARMS gone), via the
  widened `stump` field + `stumpL`/`stumpR` both deriving from `"both"`.
- `hobbler` → `variantFilter: v => v.legStump === "L" || v.legStump === "R"`
  (exactly one leg gone = the limp; both would be the crawler).
- New `legStumpShaded()` paints the amputated thigh, mirroring the arm stump.
- `hulk`/`midget`/`runner`/`lurcher` → `null` (any silhouette; scale carries it).

⚠️ **Memory note — `vfx-dont-strip-gore`:** the variant pool was deliberately
rewritten to vary silhouette first *because* the old hue-only pool crushed to
five identical green blobs. Extend `ZOMBIE_VARIANTS`; do **not** re-tune or trim
the gore/splatter that already ships.

### 1.4 The collider trap — non-negotiable

[state.ts:300-309](state.ts#L300-L309) documents this in blood: the Reaper King
walked half-buried into corridors because its mesh scaled 2.17× while its
collider stayed at the brute's 0.42. The comment ends *"Anything that scales a
sprite mesh must set this too, or it will drift the same way."*

So: **every** sub-type with `scale ≠ 1` MUST set `Zombie.bodyR`. And `hulk` at
`bodyR ≈ 0.45` is wider than a 1-tile corridor allows — add a spawn guard that
rejects `hulk` on tiles whose open-neighbour count is < 3, falling through to
`lurcher`. Test it (`zombie-types.test.ts`).

### 1.5 Gait — crawl and limp

- **`gait: "crawl"`** — crawler renders prone. Cheapest honest version: rotate
  the sprite mesh ~70° about its facing axis and drop `hoverY` to near-floor, so
  the existing 4-facing atlas still animates. A bespoke prone atlas is a
  follow-up, not this wave.
- **`gait: "limp"`** — in `entities/zombie.ts`, multiply the per-frame speed by
  `1 + LIMP_AMP * Math.sin(t * LIMP_FREQ)` with `LIMP_AMP = 0.6`. Drive it off a
  per-zombie phase seeded from `nid` (not wall-clock), so two hobblers don't
  limp in lockstep and co-op peers agree.

### 1.6 Drops scale with the sub-type

`rollReagentDrops` currently keys on `kind` alone. Add an optional
`typeMult` so a hulk is worth more than a midget:

```ts
rollReagentDrops(kind, { boss, dropMult: ZOMBIE_TYPES[t].hpMult })
```

Same for coins (`hpMult`-scaled) and the card roll (§2.3). A 9-HP hulk paying
the same as a 2-HP midget is the kind of thing that quietly kills the loop.

---

## 2. Monster identity on cards

### 2.1 `CardDef.source`

Add to `CardDef` ([cards.ts:51-60](cards.ts#L51-L60)):

```ts
/** Which monster this card is the essence OF. Drives the bestiary, the
 *  card art's monster window, and the affinity drop table (§2.3).
 *  null = not monster-derived (tavern-only mythics, gold-wall epics). */
source?: EnemyKind | null;
```

Then theme cards to monsters the way reagents already are. Existing cards keep
working — `source` is optional and additive. Natural pairings from the current
table:

| Card | source | Reads as |
|---|---|---|
| `frostchip` / `frostbite` | `ghost` | chill from ectoplasm |
| `stormchain` / `thunderlord` | `wisp` | the blink-caster's arc |
| `embercore` | `bloater` | the burst-into-fire gas-bag |
| `leech` / `vampiricedge` | `bat` | drain |
| `piercer` / `railgun` | `spitter` | ranged identity |
| `cleaver` | `brute` | big swing |
| `keenmind` / `assassin` | `spider` | precision |
| `deathmark` / `soulreaver` | `reaper` | death |
| `tempered` / `reinforced` | `golem` | stone |
| `gluttony` | `chomper` | the eater |
| `momentumstrike` | `pin` | pinball identity |
| `elementalist` / `overcharged` | `crystalback` | material synergy |

Mythics (`worldbreaker`, `timeripper`, `tempestcrown`, `gladeath`, `bloodpact`)
stay `source: null` — they are tavern chase cards by design
([PINBALL_KNIGHT_PLAN.md](PINBALL_KNIGHT_PLAN.md) §0C).

**New monster-flavoured cards** to fill the gaps (one per uncovered kind, so
every monster is worth hunting):

- `spidersilk` (spider, common): −10% cooldown, +25% durability
- `houndfang` (hound, rare): +35% dmg on the first hit after a dash
- `wardenplate` (warden, rare): +150% durability, +1 dmg
- `sapperfuse` (sapper, epic): hits have a 15% chance to detonate a small AoE
- `mimicjaw` (mimic, epic): +80% dmg vs. enemies that haven't aggroed you
- `necrosigil` (necromancer, legendary): kills briefly raise a friendly husk
- `magnetcore` (magnet, rare): coins within 4 tiles drift to you

(The last four need effect plumbing — sequence them behind §3, or ship them
stat-only first and add the verbs in a follow-up. Say which in the checklist.)

### 2.2 Bestiary — the "which monster drops what" screen

New `bestiary.ts` + a menu tab. Pure data derived from the three existing
tables — **no new source of truth**:

- monster label, icon, `fromLevel`, HP
- its `ENEMY_DROPS` reagents (already themed)
- its `source`-matched cards from `CARDS`
- for `zombie`: the 8 sub-types with their stat deltas
- kill counters per kind (`state.killsByKind`), so entries reveal as you fight —
  an unfought monster shows silhouette + `???` drops.

This is what turns "a card dropped" into "I need to farm Wisps."

### 2.3 Affinity drop roll

`rollCardDrop` ([cards.ts:232](cards.ts#L232)) takes no `kind` today, so a
Spider and a Ghost roll identical pools. Extend the signature (keep it
back-compatible — `kind` optional, defaults to current behaviour):

```ts
rollCardDrop(
  { kind?: EnemyKind, boss?, goldWall?, floor, legendaryAllowed?, dropMult? },
  rand = Math.random,
)
```

Rule: when a card drops and the slain kind has `source`-matched cards,
**70% of the time pick from that monster's pool**, 30% from the rarity pool at
large. Rarity gates are unchanged — affinity picks *which* card at a rarity, not
*whether* one drops. Rarity must stay rare: the ~8% common rate stands.

`dropMult` scales the roll by zombie sub-type `hpMult` (§1.6), capped so a hulk
can't exceed ~2× the base chance.

Update the existing `cards.test.ts` roll tests, which assume the current
signature.

---

## 3. Skill cards — abilities socketed into a weapon

The Ragnarok "card grants a skill" fantasy. Two new `CardModifier` fields:

```ts
/** Socketing this card GRANTS this active ability while the weapon is held.
 *  Same AbilityId space the skill tree unlocks (skills.ts unlockAbility). */
grantsAbility?: AbilityId;
/** Ability mana cost multiplier (<1 = cheaper) while socketed. */
abilityCostMult?: number;
```

The plumbing already exists and is the reason this is cheap:
`unlockedAbilities()` ([skill-runtime.ts:41](skill-runtime.ts#L41)) is
**already the single funnel** for "what can Q/E cast" — it merges
`state.unlockedAbilities` with `skillAgg().unlocked`. Add a third source: the
abilities granted by cards socketed in the **held** weapon.

Design decisions that need to be deliberate:

- **Held weapon only.** Swap weapons → the granted ability leaves the Q/E slots.
  This is the interesting part of the system (weapon = loadout, not just damage)
  and it makes the two weapon slots a real choice.
- **Edge case that will bite:** if the ability is *mid-cast* when you swap or the
  weapon breaks at 0 durability, the cast must not strand state. Cancel it
  cleanly in `tickAbilities`, and drop it from the Q/E binding on the same frame.
  Test it.
- Cards granting an ability the tree *also* unlocked should give the
  `abilityCostMult` discount rather than a dead duplicate.

Cards to add (each `source`-themed, so they're monster essence, not generic):

| Card | source | Rarity | Grants |
|---|---|---|---|
| `wispspark` | wisp | epic | `arcanepulse` |
| `pinsoul` | pin | epic | `flippercharge` |
| `magnetheart` | magnet | rare | `magnetaura` |
| `reaperclock` | reaper | legendary | `timecrawl` |
| `brutewhirl` | brute | legendary | `bladestorm` |
| `bloateroil` | bloater | epic | `slickfield` |

`aggregateCards` gains `unlocked: AbilityId[]` and `abilityCostMult` in its
return — mirroring `aggregateSkills`, so the two aggregates stay symmetrical.

Also: `holo-card.ts` should paint the ability icon in the "moves" rows it
already renders, and the card art window should show the **source monster** for
`source`-bearing cards (the cosmic speckle field stays for `source: null`).

---

## 4. Risks and traps

1. **`Record<EnemyKind, …>` exhaustiveness is a feature.** Sub-types-as-modifier
   (§1) exists precisely to avoid 48 duplicate rows. Don't "simplify" it into
   new kinds later.
2. **Collider drift** — §1.4. The one mistake this codebase has already made.
3. **Co-op determinism.** Spawn-path sub-type selection must come from the
   shared hash, never `Math.random()`. `zombieNidSeq` resets per floor
   ([core.ts:1470](core.ts#L1470)) and the pool adopts `coopSeed()` — the same
   discipline applies to `ztype`.
4. **Rarity inflation.** Affinity changes *which* card, never *how often*. If
   playtest shows more cards dropping, the affinity roll leaked into the gate.
5. **Bestiary as a second source of truth.** It must *derive* from `CARDS` /
   `ENEMY_DROPS` / `ZOMBIE_TYPES`. A hand-written drop list will drift.
6. **`ZVariant.armStump` touches an exhaustive painter.** Adding a field to
   `ZVariant` means every entry in `ZOMBIE_VARIANTS` needs it, and
   `makeZombiePaints` builds one sheet per variant — 5 variants × new arm states
   grows `state.zombieVariantSheets`. Watch the atlas budget; `dispose.ts:70`
   already disposes the array, keep that honest.
7. **Sheet count / VRAM.** Sub-types reuse the existing 5 variant sheets (scale
   and tint at the mesh, not new atlases). Do **not** bake 8 × 5 = 40 sheets.
8. **`hpMult`-scaled drops must round.** `ZOMBIE_HP = 3` × 0.67 = 2.01 → `Math.max(1, Math.round())`.

---

## 5. Service side

Only one thing: if skill-cards or sub-typed drops introduce a **new ground-item
kind**, the co-op TAKE broadcast in `braindeadbot-service/src/realtime/protocol.ts`
must carry it, or a card picked up on one screen lingers on another. Cards
already flow through `removeGroundItem` → `coopItemTaken`
([core.ts:2510](core.ts#L2510)), so if we add no new `kind` string, **the service
needs zero changes**. Verify before touching it.

Sub-typed zombies need **no** protocol change if `ztype` is derived from the
shared spawn hash on each peer (§1.1) rather than transmitted. That's the whole
reason to derive it.

⚠️ **Memory note:** `braindeadbot-service` is ours to edit, but the deploy is
working-tree-based (`COPY . .`, not git HEAD) — see the
`braindeadbot-deploy-working-tree` memory. And `pnpm install` clobbers the
`canvas` native rebuild; rebuild **after** the gate.

---

## 6. Implementation checklist

Ordered so each phase is independently shippable and testable. Phase A is the
user's headline ask (zombie variety) and lands first.

### Phase A — zombie sub-types (behavioural variety)

- [x] A1. Create `zombie-types.ts`: `ZombieType`, `ZombieTypeDef`,
      `ZOMBIE_TYPES` table (§1.2 numbers), `pickZombieType(hash, level)`.
      Pure, no imports from `three` or DOM.
- [x] A2. Create `zombie-types.test.ts`: weights sum to 100; every type's
      `fromLevel ≥ 1`; `pickZombieType` is deterministic for a given
      `(hash, level)`; nothing gated above the level it's picked at; every
      `scale ≠ 1` entry has `bodyRMult ≠ 1`; hp rounds to ≥ 1.
- [x] A3. Add `ztype?: ZombieType` to `Zombie` in `state.ts`, documented beside
      the existing `bodyR` comment.
- [x] A4. `core.ts` `makeZombie`: accept `opts.ztype`; apply `hpMult` to hp,
      `scale` to the mesh, `bodyRMult` → **`z2.bodyR`** (§1.4), `speedMult` to
      speed.
- [x] A5. `core.ts` `spawnHordeMember`: at the final baseline-zombie branch
      ([core.ts:1416-1419](core.ts#L1416-L1419)), call `pickZombieType(hash, level)`
      and pass it through. Reuse the same `hash` — no new RNG.
- [x] A6. Hulk corridor guard: reject `hulk` where the tile has < 3 open
      neighbours, fall through to `lurcher`. Test it.
- [x] A7. `entities/zombie.ts`: per-zombie `reachMult` / `windupMult` applied on
      top of the `STATS.zombie` row (the table stays keyed by `EnemyKind`; the
      sub-type multiplies).
- [x] A8. Limp gait: `LIMP_AMP` / `LIMP_FREQ` in `constants.ts`; phase seeded
      from `nid`; applied in the zombie speed path.
- [x] A9. Crawl pose: prone rotation + low hover for `gait: "crawl"`.
- [x] A10. Hulk knockback on contact — reuse the existing shove/bounce path, do
      not invent a second one.
- [x] A11. `ZVariant.armStump` + the no-arms painter branch in `cel-painter.ts`;
      extend all 5 `ZOMBIE_VARIANTS` entries. **Add** paint, strip nothing.
- [x] A12. `variantFilter` wiring: crawler/hobbler pick stumped silhouettes,
      flailer picks an `armStump` one.
- [x] A13. Sub-type label on the damage number / a small tag when a non-shambler
      is struck, so the player *learns* the roster exists.
- [x] A14. `debug-spawn.ts`: extend `__dungeonSpawn` to take a sub-type
      (`__dungeonSpawn("zombie:hulk", …)`) for headless QA.
      ⚠️ Per the `dungeon-spawn-debugger` memory: **never click the backtick
      panel from a harness** — call the hook.
- [x] A15. `dropReagentsMaybe` + coin drop take `dropMult` = `hpMult` (§1.6);
      round with `Math.max(1, Math.round(…))`.

### Phase B — monster identity on cards

- [x] B1. `CardDef.source?: EnemyKind | null`; annotate the existing ~35 cards
      per the §2.1 table.
- [x] B2. Add the 7 new monster-flavoured cards (§2.1). Ship the four needing
      new verbs **stat-only** first; note the deferred verbs in `CHANGES.md`.
- [x] B3. `rollCardDrop` takes optional `kind` + `dropMult`; 70/30 affinity
      pick; rarity gates untouched.
- [x] B4. Update `cards.test.ts` for the new signature; add a test that
      affinity does **not** change total drop *rate* (the §4.4 risk) — assert
      the rate over a seeded run.
- [x] B5. `core.ts` `dropCardMaybe` passes the slain `kind` and sub-type mult.
- [x] B6. `state.killsByKind: Record<string, number>`; increment on death;
      reset per run beside `state.reagents` ([state.ts:1101](state.ts#L1101)).
- [x] B7. `bestiary.ts` — pure derivation from `CARDS` / `ENEMY_DROPS` /
      `ZOMBIE_TYPES` / `killsByKind`. No hand-written drop lists.
- [x] B8. `bestiary.test.ts`: every `EnemyKind` has an entry; every card with
      `source` appears under that monster; unfought monsters mask their drops.
- [x] B9. Menu tab for the bestiary (`menu.ts` — follow the existing tab
      registration, don't fork the dispatch; `menu-dispatch.test.ts` guards it).
- [x] B10. `holo-card.ts`: paint the source monster in the art window for
      `source`-bearing cards; keep the speckle field for `source: null`.

### Phase C — skill cards

- [x] C1. `CardModifier.grantsAbility?: AbilityId` + `abilityCostMult?: number`.
- [x] C2. `aggregateCards` returns `unlocked: AbilityId[]` + `abilityCostMult`.
- [x] C3. `unlockedAbilities()` in `skill-runtime.ts` merges the **held**
      weapon's card grants as a third source. One funnel — do not add a parallel
      lookup at the cast site.
- [x] C4. `castAbility` applies `abilityCostMult` to the mana cost.
- [x] C5. Weapon-swap / weapon-break cancels a granted ability mid-cast and
      drops it from Q/E on the same frame (§3).
- [x] C6. Add the 6 skill cards (§3 table), each `source`-themed.
- [x] C7. `cards.test.ts`: socketing grants the ability; un-socketing removes
      it; a tree-unlocked duplicate yields the discount, not a dead slot;
      cost-mult compounds correctly across sockets.
- [x] C8. `skills-audit.test.ts` (already exists) — extend so a card-granted
      ability is audited by the same rules as a tree-granted one.
- [x] C9. Card-reader + HUD show the granted-ability icon so the grant is
      legible at pickup.

### Phase D — verify & ship

- [x] D1. `pnpm test` green (vitest). New suites: `zombie-types`, `bestiary`,
      plus the extended `cards` / `skills-audit`.
- [ ] D2. **NOT RUN** — headless QA per the `braindeadbot-headless-screenshots` +
      `dungeon-harness-loop-traps` memories: **descend from the tavern first**
      (a lobby with `polls: 0` means you never entered the dungeon), pull the
      plunger release, then `__dungeonSpawn` one of each sub-type in a ring and
      screenshot. Confirm 8 visually distinct silhouettes.
- [ ] D3. **NOT RUN in-engine** (the guard itself is unit-tested) — confirm
      hulks never spawn wall-embedded in 1-tile corridors (A6).
- [ ] D4. **NOT RUN** — two clients on one seed agree on every zombie's
      `ztype`. Derivation is unit-tested as deterministic, but no two-client
      run was done. This is the one that silently breaks.
- [x] D5. Verify no new ground-item `kind` string reached the co-op protocol
      (§5). If one did, update the service and deploy both.
- [ ] D6. **BLOCKED in the worktree** — a symlinked `node_modules` breaks
      Turbopack ("points out of the filesystem root"). `tsc` + 1242 tests are
      green; run `pnpm build` from the primary checkout. **Rebuild `canvas` after any
      `pnpm install`** (`dungeon-4x-floors-route-math` memory).
- [x] D7. Update `CHANGES.md`, `VERIFY_CHECKLIST.md`, `HANDOFF.md`.
- [x] D8. Commit, deploy (`bash deploy.sh`), verify at the LIVE URL — not just
      the local dev server.

---

## 7. Sequencing note

Phase A is self-contained and is the headline ask — ship it alone if you want a
fast win. Phase B depends on nothing in A except `ZOMBIE_TYPES` for the
bestiary's zombie entry (stub it if B goes first). Phase C is independent of
both and is the largest design risk (the held-weapon ability swap), so it should
be last and playtested hardest.
