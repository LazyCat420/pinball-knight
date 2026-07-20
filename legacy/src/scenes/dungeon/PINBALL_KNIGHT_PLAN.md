# Pinball Knight — Consolidated Plan

_Rewritten 2026-07-19, then updated the same day once §1 was cleared. Every
line below was re-verified against the source; the previous revision (2026-07-17) had gone badly stale — most of its
planned work shipped in waves 12–14b, and it described a DOM-overlay tavern and
tiny card chips that no longer exist._

_This supersedes the retired `PINBALL_HYBRID_PLAN.md` and `PINBALL_ROADMAP.md`
(both deleted). It does NOT supersede `BLUEPRINT.md` (architecture),
`VERIFY_CHECKLIST.md` (manual QA), `../tavern/TAVERN_PLAN.md`,
`../tavern/gambler/GAMBLER_PLAN.md`, or `MAP_PLAN.md` (repo root) — it
consolidates their **open items** and points back at them for reasoning._

All paths are under `braindeadbot-client/src/scenes/dungeon/` unless noted.

---

## 0. Shipped — do NOT rebuild

Verified in code 2026-07-19 with line numbers. The previous plan's entire A/B/C
programme is essentially done.

### Pinball physics and parts

| Feature | Where |
|---|---|
| Wall bounce + **corner acceleration** | `entities/player.ts:1072-1086` |
| Break walls at speed | `SECRET_BREAK_SPEED=7`, `WALL_BREAK_SPEED=15` (`constants.ts:754,762`); `player.ts:1039-1056`; `secrets.ts:34` |
| Three-zone BFS banding (speedway/bumper/arena-vault) | `maze/decorate.ts:576-591,742` |
| Lit bumpers + jackpot | `entities/pinball-collide.ts:276-296`, `fireJackpot:161-180` |
| Drop-target sequence bank | `pinball-collide.ts:448-475` |
| Flipper redirect | `pinball-collide.ts:514-539` |
| Momentum lanes (centring glide) | `player.ts:1016-1030` |
| Per-surface friction | `constants.ts:329-331`, applied `player.ts:1106` |
| **Exhaustive collision dispatch** | `PART_HANDLERS: Record<PinballPartKind, PartHandler>` `pinball-collide.ts:262`; test `pinball-collide.test.ts:105` |
| 18 part kinds | `state.ts:295-315` |
| Orbits, rollover lanes, plunger + skill shot, named shots, shot chains | waves 14 / 14b |

### A1 — launch-target invariant ✅

`maze/decorate.ts:398` `openLaunchTargets()`. Raycasts each launch part
(`runway():415`, `firstWall():425`), then a 4-step ladder: crack the wall to
`T_CRACKED` (`tryCrack():435`, 2×2 band, corridor-beyond required, ≥4 Manhattan
spacing, `HARD_CAP=28`) → re-aim to a cardinal with runway → re-aim + crack →
cull the orphan. Wired at `:1220`, tested `maze/decorate.test.ts:420-481`.
**The "a booster you can see is always a clear lane or a breakable wall" promise
is kept.**

### A2 — ramp hop ✅ (with two deliberate deviations)

`player.ts:842-943`. The state field is **`hopT`**, not the planned `airborneT`
(`startRampHop:854`, `updateHop:910`, driven at `:1208`). Parabolic
`sin(π·u) · RAMP_HOP_HEIGHT`, collision bypassed, i-frames held, landing
pre-snapped to a walkable tile past a crossed wall band (`:866-878`), momentum
resumed along the hop heading on landing (`:931-934`).

Constants are `RAMP_HOP_HEIGHT=1.75` / `RAMP_HOP_MIN=2.5` / `RAMP_HOP_MAX=4.75`
/ `RAMP_HOP_SPEED=16` (`constants.ts:470-487`). `RAMP_LAUNCH_MIN` and
`RAMP_HOP_DIST` were never created — don't go looking for them.

Two things the old plan specced that were **designed out, not forgotten**:
- **No "land against a wall → nudge back → bounce" branch.** Landings are
  pre-snapped to walkable tiles; if none is in range the hop is skipped and the
  flat dash stands (`:881`).
- **Ramps only.** Boosters remain flat ground-speed lanes (`pinball-collide.ts:341`),
  keeping the two parts distinct — as intended.

### B — isometric tavern ✅

An entire scene package at `../tavern/` (12 modules + gambler, ~5,575 lines) —
not the `room.ts` the old plan imagined. Walkable iso room with its own player
controller (`../tavern/player.ts`), hearth, anvil, bar shelf, armory vice
showing your real weapon with lit rune plates, notice board, descend plunger.
Room tone is real audio (`../tavern/audio.ts:43`). All placement is pure data in
`../tavern/layout.ts:87-160` with tests asserting open floor.

Four keepers with idle loops (`../tavern/npcs.ts:38-43,93-135`). Proximity focus
+ spotlight + `[E] LABEL` prompt (`../tavern/stations.ts:23-60,110`). Seven
stations, each opening **its own** vendor counter — board (descend), forge
(weapons), bar (potions), table (run summary), dealer (cards), armory (armor),
gambler (casino).

`dungeon/tavern.ts` (834 lines) survives deliberately as **the economy plus the
dialogue layer**: `openVendorCounter():789` is what the 3D scene opens.
`openTavern():737` — the old four-panel hub — is now only reachable when WebGL
is unavailable. Armorer sells gear: `PRICE_GEAR` `tavern.ts:66`, buy `:601`.

### C — holo cards ✅

`render/holo-card.ts` (540 lines), 512×716. Rarity→tier is
`common:0, rare:1, epic:2, legendary:3, mythic:4` (`:32`) — **not** the old
plan's mapping; mythic took tier 4. Element theming derives from the modifier,
not rarity (`:43-52`). Painted stack: gradient frame, tier≥1 rainbow foil
stripes, tier≥2 metallic wash, tier≥3 etched engraving, tier-4 extra pass,
cosmic art window with a speckle field, "moves" rows, star + rarity footer,
tier-weighted gold edge. Specks use a seeded LCG (`:63-71`) so they don't
shimmer between repaints.

Shimmer shipped as **`.hcard-shimmer`** (`tavern.ts:266-271`), not
`.holo-shimmer`, plus `.hcard-gold` and an animated conic border `.hcard-myth`
for mythics. Painted cards are used at dealer stock, stash/socket picker, weapon
slot occupancy, forge picker and reroll list. **`cardChip` was deleted** — there
is no tiny-chip path left.

Prices are `20 / 60 / 140 / 320 / 600` (`tavern.ts:54`); `mythic` is real
(`cards.ts:17,49,73,151`) with two cards (`worldbreaker`, `timeripper`). Roster
is **15** cards across 5 rarities, not 13. All effect fields intact
(`damageFlat`, `damageMult`, `cooldownMult`, `durabilityMult`,
`onHit: chill|burn`, `pinballMult` — `cards.ts:23-36`).

### Shipped 2026-07-19 — the whole previous open list

| Feature | Where |
|---|---|
| **Leaderboard submission** (depth-dominant scoring) | `run-score.ts`, posted from `core.ts` on death; run-scoped ledger on `state` |
| **Shared player name** (fixes Pirate Surf's `"???"` board too) | `../../services/player-name.ts`; editable on the death screen |
| **Best-depth persistence** | `best-depth.ts`; record called out on game over |
| **Exhaustive part RENDERING** | 3 × `Record<PinballPartKind, …>` in `render/pinball-parts.ts` — a missing kind is now a compile error, matching collision |
| **Floating damage numbers** | `render/damage-text.ts`, pooled + iso-billboarded; hooked in `entities/combat.ts` `damageZombie`, the single funnel |
| **Card pickup preview** | `card-popup.ts`, reuses `holo-card.ts`'s painter; never pauses the game |
| **Airborne ground shadow** | `ActorSprite.setElevation()` pins the contact blob to the floor for ramp hops AND the trapdoor ride |
| **Map labels archetype rooms** | `state.levelRooms` (stashed from `plan.rooms`); full map washes speedway/bumper/arena/vault over discovered floor only |
| **Off-window stairs chevron** | `map-render.ts`, gated on the stairs being discovered |
| **Arrow keys unbound from turning** | `input.ts` — see below |
| **Tavern**: 5th keeper, approach reactions, focus zoom, live diorama | `../tavern/` |

**The "control inversion" is solved, and it was not an inversion.**
`arrowleft`/`arrowright` were bound in `MOVE_KEYS` *and* `TURN_LEFT`/`TURN_RIGHT`
(`input.ts`), both read from the same held-key set, so in FPS mode Left strafed
AND rotated on the same frame. Movement and aim share one code path
(`screenDirToWorld`) with no sign error anywhere. Arrows are movement, q/e turn,
and `input.test.ts` now forbids any key being bound to both. ROADMAP §6 /
VERIFY_CHECKLIST §6 can be closed.

Two bugs found while doing the above, both invisible without looking: the
tavern's five bumper caps **shared one material instance**, so a chase rendered
as five caps pulsing in unison; and the gambler's cabinet had **no collision
rect**, so you could walk through it.

### Postdating the old plan entirely

- **The casino** — four games with tested RTP under `../tavern/gambler/`
  (slots, roulette, blackjack, darts), shared stake/purse/round-limit settlement
  in `table.ts`. See `GAMBLER_PLAN.md`; it lists nothing open.
- **Maps** — both tracks shipped: pixel site map, plus dungeon fog of war,
  HUD minimap and full floor map on **M**. See `MAP_PLAN.md`.
- **Blood pixels** (`render/vfx.ts:373`) and **gold-wallet wiring**
  (`addGold(n,"dungeon-game")` throughout).
- **Alternate maze algorithms** — `maze/generator.ts:87-108` is a growing-tree
  generator parameterised by `windiness` (spans Prim's ↔ recursive backtracker)
  with a `braid` loop probability.
- **Two §11 decisions are settled in code**: death is **roguelite** — banked
  wallet gold persists, the run restarts at floor 1 (`core.ts:1462`); actor
  sprites are **unlit** — `render/sprite.ts:350-352` supports lit, but every
  caller passes `false` (`core.ts:742,993`), so that branch is dead code.

---

## 1. Open work

Everything this section previously listed was cleared on 2026-07-19 (commit
"Pinball Knight: clear the whole open list"). What shipped is folded into §0
above; what remains is below, and it is genuinely short.

### 1. Nobody has playtested it 🔴

`VERIFY_CHECKLIST.md` is **40 items, zero checked**, across 7 sections (debug
console, HUD layout, buff strip, power-ups, rampage swap, enemies & parts, known
issues). Waves 10 onward were build- and tsc-verified only. There is no E2E
harness for the 3D game, so that checklist is the only way a change gets
confirmed by hand — and it is now the single largest source of unknown risk in
the game, well ahead of any unbuilt feature.

Headless QA can drive the dungeon (it boots, renders, and the map draws with no
console errors — verified this round), but it runs at ~2-5fps under swiftshader
and cannot judge feel. Feel is what the checklist is for.

### 2. Card economy tail

Both are shop-tuning, not systems work:

- **Stock roll ignores gold and depth.** `rollBarOffers` (`../dungeon/tavern.ts:119-130`)
  uses flat fixed thresholds (`<0.5` common … else mythic), so a late run with a
  full purse sees the same table as floor 1. Weighting by gold-on-hand or depth
  would give deep runs something to spend on.
- **Pricing keys off rarity only** — a big `damageMult` costs the same as a weak
  one of the same tier. Pricing off modifier strength would make the shop feel
  curated rather than flat.

### 3. Tavern remainders (see `../tavern/TAVERN_PLAN.md`)

- Only four NPC paints exist for five keepers, so the gambler's tout reuses the
  armory frog tinted gold. A fifth paint needs `cel-painter.ts`, which belongs
  to the dungeon.
- `readDiorama` can only see grade/floor/kills/bestCombo. Per-target detail —
  which bumpers a run actually hit — is not plumbed into `TavernStats`, so the
  diorama reflects the run's SHAPE but not its specifics.

### 4. Small deliberate gaps

- **Boosters don't hop.** Ramps do; boosters stay flat ground-speed lanes so the
  two parts read differently. Revisit only if they start feeling samey.
- **Launch-part density doesn't scale with depth.** There is no per-level
  part-count field in `LevelConfig` (`constants.ts:1239-1259`) — counts come from
  room archetypes. The cracked-wall budget DOES scale
  (`launchBreaks: min(5 + ⌊(l-1)/2⌋, 10)`). Worth doing if later floors should
  read as more machine-like.
- **Level size caps** are `cellsW ≤ 33` / `cellsH ≤ 25`, already raised from
  30/22. An older plan asked for 34/26; not worth a commit on its own.
- **No legend on the HUD minimap**, deliberately: the canvas is a 116px backing
  store in a 58 CSS px box, so the smallest readable hand-authored glyph lands at
  1.5×2.5 CSS px. Reasoning is in `hud-minimap.ts`. The full M map has a legend,
  which is where there is room to teach the colours.

### 5. Research spikes — not committed work

Unchanged from the previous revision; none of these block anything.

- **Kicker gates** and **multiball wells** as distinct part kinds. Neither exists
  in `PinballPartKind` (`state.ts:295-315`); multiball is only a potion power-up.
- **Per-zone corridor width carve.** The shipped analogue is the runtime friction
  gradient (`constants.ts:329-331`, `player.ts:1106`) plus `widenMainArtery`.
- **The literal layered generator** (drunkard's-walk → Physarum → Bagua 3×3 →
  sightline scoring). Zero hits repo-wide; the shipped generator uses
  BFS-distance banding. A spike, not a plan.
- **Table-shaped prefab rooms** (circular/oct bumper court, teardrop return lane,
  ramp spiral, funnel). `maze/prefabs.ts:40-169` has 13 CORRIDOR-shape prefabs;
  none is a table shape.
- **Rapier physics.** In `package.json` but only imported by
  `objects/dog-feeding-game.ts`. `BLUEPRINT §1.5` explicitly rejects it for v1 —
  its absence is a decision, not a gap.

---

## 2. Stale statements in the other docs

Found while verifying. Fix these when next touching each file, so the next
reader isn't misled:

| Doc | Line | Says | Truth |
|---|---|---|---|
| `BLUEPRINT.md` | 102 | blood pixels open | shipped (`vfx.ts:373`) |
| `BLUEPRINT.md` | 102 | alternate maze algorithms open | shipped (growing-tree, `generator.ts:87-108`) |
| `BLUEPRINT.md` | §11 | perma-death vs checkpoints undecided | decided: roguelite (`core.ts:1462`) |
| `BLUEPRINT.md` | §11 | actor torch-lighting undecided | decided: unlit; lit branch is dead code |
| `maze/generator.ts` | 10-11 | "v1 ships the backtracker only" | contradicted by the growing-tree impl 75 lines below |
| `VERIFY_CHECKLIST.md` | 11 | cites `pinball_knight_plan.md` at repo root | it lives here, in `scenes/dungeon/` |
| `../tavern/TAVERN_PLAN.md` | open list | "the gambler" open | shipped, four games |

---

## 3. Suggested order

1. **Playtest against `VERIFY_CHECKLIST.md`** (§1.1). Everything else here is
   small; 40 unchecked items on a game nobody has sat down with is not. Do this
   before building anything new.
2. **Card economy tuning** (§1.2) — stock weighting and modifier-strength
   pricing, both contained to `tavern.ts`.
3. **Tavern remainders** (§1.3) if the fifth NPC paint feels worth a
   `cel-painter.ts` trip.
4. §1.4 only as taste dictates; §1.5 is not scheduled work.

Each is independently shippable: `npm test` + `npx tsc --noEmit`, then
in-browser. Commit and push before any deploy.
