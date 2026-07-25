# Handoff — braindeadbot-client / -service

_Replaced on each deploy. Not a log; if something here is done, delete it._

## 🧟 MONSTER CARDS + ZOMBIE SUB-TYPES (2026-07-25, this session)

1242 tests / 105 files pass · 0 dungeon type errors.

**Service: ZERO changes.** `braindeadbot-service` is co-op realtime transport
only. No new ground-item `kind` string was introduced (cards already flow through
`removeGroundItem` → `coopItemTaken`), and sub-types are DERIVED per-peer from the
shared spawn hash rather than transmitted — so `realtime/protocol.ts` is untouched
by design, not by omission.

### 0. FIRST — three-quarters of the ask was already shipped

Verified in source before writing a line. Do not "add" these again:

- **Cards were already Ragnarok-style weapon sockets**, not standalone powerups —
  `WeaponState.cards[]` bounded by `WEAPONS[id].cardSlots` (cap 3,
  blacksmith-upgradable via `bonusSlots`). `items.ts:52-88`, `cards.ts:206-217`.
- **Monster-themed item drops were already the full RO reagent model** —
  `reagents.ts` `ENEMY_DROPS` is exhaustive by `EnemyKind`: `spider: silk+fang`,
  `zombie: rotflesh`, `golem: ironshard`, `reaper: grimbone`, brewed into potions
  at the Tavern Alchemist. Exactly the spider-leg/zombie-skull design.
- **Money + rare card drops** already worked (~8% common, boss-gated rare+).

What was actually missing, and is now built:

### 1. Zombie sub-types — variety that is BEHAVIOUR, not paint

`ZOMBIE_VARIANTS` already varied the silhouette, but all five shared
`ZOMBIE_HP = 3` and one speed: **the one-armed zombie fought identically to the
intact one.** New `zombie-types.ts` adds 8 sub-types — shambler / runner /
lurcher / hulk / midget / crawler / flailer / hobbler — as a **multiplier bundle
on `kind: "zombie"`, NOT new `EnemyKind`s.**

⚠️ **That choice is load-bearing.** `EnemyKind` feeds SIX exhaustive
`Record<EnemyKind, …>` tables (`STATS`, `HP_BY_KIND`, `ENEMY_DROPS`, the bite
table, `spawnKind`, `EXPANSION_SKIN`). Eight flavours as kinds = 48 duplicate rows
and `rotflesh` forked across nine keys. Do not "simplify" it into kinds later.

- **Weights sum to 100** so the table reads as percentages; shambler keeps the
  plurality (34%) on purpose — the horde must still read as a horde.
- **Silhouettes now match the stats.** `ZVariant` gained `legStump`, `stump`
  gained `"both"`, and `legStumpShaded()` paints an amputated thigh mirroring the
  existing arm stump. **Four variants were ADDED, none replaced** — the five
  intact ones still carry most spawns (per the `vfx-dont-strip-gore` rule).
- **The limp is real motion**, not an animation: `LIMP_AMP=0.6` oscillates the
  hobbler's speed, phase seeded from `nid` (never wall-clock) so peers agree and
  two hobblers don't limp in lockstep. `bobT` had to be advanced in the main loop
  — the bat branch and ghost path each advance it for themselves, and a grounded
  hobbler reaches NEITHER, so its phase would have stayed pinned at 0.

⚠️ **THE COLLIDER TRAP, twice.** `state.ts`'s `bodyR` comment records the Reaper
King walking half-buried into corridors because a 2.17× mesh kept a 0.42
collider. Both halves are now guarded: `zombie-types.test.ts` asserts
`bodyRMult ≠ 1` whenever `scale ≠ 1`, and `resolveZombieType()` **refuses to spawn
a hulk on a tile with <3 open neighbours** (falls through to a lurcher) — a
1.5×-wide body in a 1-tile corridor is that same bug in a new costume.

⚠️ **Crawler pose is ROTATION ONLY.** `syncActorMesh` re-pins `y = 0` every
frame, so a height offset set at construction is silently erased next update.
That is why the ghost's hover lives in `syncGhostMesh` and not on the actor.

### 2. Monster identity on cards

- `CardDef.source?: EnemyKind` — 28 existing cards annotated, 8 new
  monster-essence cards so **every** kind is worth hunting. Mythics stay
  deliberately sourceless (Tavern chase cards, not loot); a test enforces it.
- **Affinity roll**: a dropping card is 70% likely to be the slain monster's own.
  ⚠️ The affinity `rand()` is drawn **inside** `pick`, i.e. only after a gate has
  already decided a drop happens. Drawing it earlier shifts the stream the gates
  see and **inflates the drop rate as a side effect** — a silent buff to every
  kill in the game. `cards.test.ts` pins the total rate against exactly that.
- `dropMult` (from `typeDropMult`, capped 2×) scales the COMMON gate, reagents and
  kill gold, so a 9-HP hulk doesn't pay a 2-HP midget's wage. Boss rarities are
  deliberately NOT scaled — milestone rewards, not grind.
- **`bestiary.ts` + a BESTIARY menu tab.** Every row DERIVES from `ENEMY_DROPS` /
  `CardDef.source` / `ZOMBIE_TYPES` — a hand-written drop list would be a second
  source of truth and would drift on the first retune. Rows reveal per-monster
  (and per sub-type) off `state.killsByKind`, so it teaches through play instead
  of being a wiki. First kill of a sub-type toasts its name once.

### 3. Skill cards — abilities socketed into a weapon

`CardModifier.grantsAbility` + `abilityCostMult`. Merged into
**`unlockedAbilities()`, still the ONE funnel** for "what can Q/E cast" — the
grants join there rather than being re-looked-up at the cast site.

⚠️ **Only THREE abilities are grantable.** The knight already starts with
`flippercharge`/`arcanepulse`/`slickfield` (`state.unlockedAbilities`), so only
`magnetaura`/`timecrawl`/`bladestorm` are genuinely locked. My first cut shipped
three cards "granting" defaults — **dead chips wearing build-defining
descriptions.** Those became cost-discount cards instead, and a test now fails if
anyone reintroduces one.

⚠️ **`syncAbilitySlots()` is hooked in `applyWeaponArt()`** — already documented
as the one funnel every hand change passes through (pickup, swap, break, retry).
Patching the five `activeSlot =` call sites instead is a bug waiting for the
sixth. It unbinds Q/E **and clears the stale cooldown**, or the ability would be
blocked when the weapon came back.

### 4. ⚠️ PARALLEL SESSION HAZARD — this cost a full rebuild

Mid-session, another agent ran `git reset` in the shared working tree **three
times**, discarding every tracked edit (untracked new files survived). I rebuilt
in an isolated `git worktree` and rebased on top of their `b5133f3`.

**If you are editing braindeadbot-client, use a worktree.** Also: symlinking
`node_modules` into a worktree **breaks `next build`** ("Symlink points out of the
filesystem root") — tests and `tsc` run fine, but the real build needs a real
install or the primary checkout.

The superseded partial edits are in `git stash` as
`claude-partial-monster-cards-superseded-by-worktree` — droppable.

### 5. Not done / next

- **Headless QA of the 8 silhouettes was NOT run.** `__zombieTypes(ring)` is
  wired for exactly this and returns each placed sub-type with its resolved
  `hp` / `bodyR` / `scale`. Per `dungeon-harness-loop-traps`: **descend from the
  tavern first** (a lobby with `polls: 0` means you never entered the dungeon),
  pull the plunger release, THEN spawn. Never click the ` panel from a harness.
- Sub-type numbers are a **first pass** — tune after playtest.
- Crawler pose is a rotated billboard; a bespoke prone atlas is a follow-up.
