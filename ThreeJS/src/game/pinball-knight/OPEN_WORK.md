# Pinball Knight — OPEN WORK

**The one backlog.** Twenty-two plan documents lived here. Ten of them described
work that had shipped, in some cases a month earlier; two described code that
does not exist under the names they use. Reading them cost more than it paid,
and the genuinely open items were scattered across their unchecked boxes and
their prose.

So they were pruned on **2026-08-27** and everything still open was folded into
this file. Two survive alongside it because they are not plans:

- `BLUEPRINT.md` — the architecture reference. Still accurate.
- `VERIFY_CHECKLIST.md` — 44 manual QA items, **still zero ever run**. A live
  instrument, and the oldest open item in the project.

**Every row below cites the code.** A backlog whose claims cannot be checked is
how the last set of documents got into the state that retired them.

### The retired documents are still readable

About twenty-five comments across this tree cite a plan by name — "DECLONE_PLAN
§3.1 said", "MAZE_COLOUR_PLAN.md carried this as backlog item 2". Those
citations are the reasoning behind real decisions and were left in place, so
they need to stay followable:

```
git show 31e5863:src/game/pinball-knight/DECLONE_PLAN.md
git show 31e5863^:src/game/pinball-knight/          # the whole set
```

`31e5863` is the last commit on which all twenty-two existed. Nothing was lost —
what was removed was the obligation to read ten documents to find out that they
were describing work already done.

---

## How to read the tiers

Ranked by value per unit of effort, not by size. Tier 1 is finished work that
nothing calls; Tier 2 is the game telling the player something untrue; the rest
descends into design and cleanup.

---

## Tier 1 — finished work attached to nothing

### 1.1 A finished boss atlas nothing spawns — CLOSED 2026-08-28
**The Overlord wears it.** `makeBossPaints` is the Bloodworks guardian's art.
The paragraph below is kept because it is why the roster exists.

`makeBossPaints` (`render/cel-painter.ts`), `SheetKey "boss"`, and the `boss`
row in `render/sheet-painters.ts` all exist and are palette-tested
(`boot/lazy-sheets.test.ts`). `boot/sheets.ts` says outright that the only
reader is the dev art-QA hook in `dev/window-hooks.ts`, and deliberately keeps
`boss` out of `BACKFILL` — "~275 ms spent on an atlas no player ever sees".

Meanwhile the boss the game **does** fight wears `reaperSheet()` at
`REAPER_SCALE * 1.55` (`boss.ts` `KING_SCALE`). So there is a painted overlord
nobody meets and a fought king wearing someone else's clothes.

Either dress the king in his own atlas or retire the atlas. Note
`registry-drift.mjs` check I exempts `boss` by name for exactly this reason —
that exemption should disappear with whichever way this goes.

### 1.2 The reaper's portrait disagrees with the reaper — STILL OPEN
`render/monster-portrait.ts` `PORTRAIT_FRAMING` gives `reaper` 1.05 while
`spawn/reaper.ts` scales it by `REAPER_SCALE` (1.4). Every other such
disagreement was removed on 2026-08-27 by deriving the portrait's scale from
`spawn/kind-skin.ts`; this one survives because the reaper is scaled outside
that table. Purely cosmetic, and re-framing the Death Dealer's card is an art
call — but it is a disagreement, and it is the last one.

---

## Tier 2 — the game says something that is not true

### 2.0 The flipper — CLOSED 2026-08-28

Both halves. The art shipped first (`buildFlipper` draws the real silhouette —
two circles joined by their external tangents — and the paddle sweeps across
the floor about Y instead of tipping up about Z like a drawbridge), which made
the missing verb louder rather than quieter: the part looked like a flipper and
promised something `PART_HANDLERS.flipper`, a bare radial trigger, could not do.

It has a button now. `entities/flippers.ts` owns command and clock; the handler
still owns consequence. **F** / pad **B**:

- **TAP** — the nearest ready paddle within `FLIPPER_REACH` swings. Meet it
  inside `FLIPPER_ACTIVE` (0.16 s) and you launch at `FLIPPER_SPEED` with a
  named shot and `FLIPPER_TIMED_GOLD`. That window is the timing skill.
- **HOLD** — the paddle parks at the top and CRADLES you: momentum killed,
  caught on the bat. Release fires, and the stick bends the exit, so a cradle
  is how you *aim* a launch rather than taking the angle you arrived at.
- **NOTHING** — contact still launches, at `FLIPPER_PASSIVE_SPEED` (12 vs 18).

**Passive contact is deliberate and load-bearing.** `flipper` is in
`LAUNCH_KINDS` and `FORWARD_FLOW_KINDS` (`maze/decorate.ts`); level-gen counts
flippers when it proves a floor's routes are traversable under momentum, and
`circuit.test.ts` / `track-socket.test.ts` assert against that set. Press-only
would have invalidated that on every floor at once, and the symptom would have
been a player meeting dead routes, not a red test. The button does not switch
the part on, it switches it up.

Console: `__dungeonFlip()` taps it, `__dungeonFlippers()` lists every paddle
with its live swing state — the only way to SEE a 0.16 s window, since a
screenshot harness cannot catch one.

### 2.0b The nudge and the tilt — CLOSED 2026-08-28

`entities/nudge.ts`. **SHIFT** / pad **LT** plus a direction, while momentum is
live — the sprint modifier, which is read at exactly one place in
`entities/player.ts`, in the WALKING path, after `updatePinball` has already
returned. It was the only binding free on both devices; the pad had no unbound
button left once B went to the flipper.

A shove rotates the heading by a fixed `NUDGE_BEND` and adds a little pace —
sharper than `PINBALL_STEER` can be — and charges a meter that only drains with
time. Flat out, that ladder is fine → **TILT WARNING** → **TILT**, and a tilt
kills the ride, zeroes the bounce combo and the frenzy counter, clears the shot
chain and locks the table out. The penalty is the chain on purpose: gold would
make a nudge a purchase, health would make it a hazard.

The three tilt constants are ONE decision — what matters is the *net* gain per
shove at the fastest rate `NUDGE_COOLDOWN` allows, not the cost of one. The
first pass read reasonably and tilted on the seventh shove while its own comment
said three. `nudge.test.ts` drives the real function at the real cadence.

Console: `__dungeonNudge(dx, dz)` shoves and returns the meter, so the ladder
can be walked without three perfectly timed keypresses.

### 2.0c The PLAZA parts — THREE BUILT 2026-08-28, one dropped, one undefined

The `PLAZA_PLAN` named five part kinds and defined none of them. The user
specified what they do on 2026-08-28; that is what shipped.

- **`swingarm`** — a bar with a hand on the end, spinning both ways. The HAND
  connects, not the hub, and the throw is the hand's TANGENT, so the exit
  depends on *when* you met it. Needs a clear disc to sweep, so it lands in
  rooms.
- **`flywheel`** — the plan's `scoop`, renamed for what it is: two
  counter-rotating wheels with a gap you shoot through. Its exit speed does not
  read your momentum, which makes it the only part that can restart a dead run.
- **`magpost`** — a pachinko post, in staggered fields with **bumpers mixed
  in**. The bumpers are load-bearing: posts take pace, bumpers give it back, and
  a field of pure posts is where momentum goes to die.
- **`gate`** — dropped at the user's call. Not in `PinballPartKind`.
- **`maw`** — **still undefined and still open.** Nobody has said what it is.
  Left out rather than invented.

Placement runs LAST in `buildParts`, after `rollItemRarity`, so every existing
phase's rng draws are bit-identical to before — the only difference in a floor
built from the same seed is the new furniture. How many is not a constant and
not an area divisor: it is the floor's MEASURED remaining density budget under
`floor-density.ts`'s 34/1k cap. A flat 32 parts breached that on 30 of 60
floors; an area-scaled version on 7 of 60, because a dense small floor has less
room than a sparse one twice its size.

`testkit/live-floor.ts` now owns the only faithful floor builder, shared by the
density gate and the plaza gate. Written because `plaza-place.test.ts` twice
concluded a correct pass was broken from a hand-rolled corridor maze the game
never generates — read its header before writing another maze test.

Console: `__dungeonPlaza()` censuses what this floor actually got.

### 2.1 The sporeling's spore cloud does not exist — CLOSED 2026-09-04
`bestiary.ts` promises "a walking fruiting body; **it bursts a spore cloud when
it dies**". Closed: `killZombie` (`entities/combat.ts`) now wires
`onSporelingBurst` from `boot/wiring.ts`, spawning a toxic spore cloud volume
(`vfx.sporeCloud`) and slippery ground residue on death.

### 2.2 Fish Feet's "heavy kick strikes" is still a bite
Half-closed on 2026-08-27: it now spawns at all, and `FISH_FEET_DAMAGE` is 2
rather than `ZOMBIE_DAMAGE`, so "heavy" is true of the number. The **kick** —
a telegraph, a wind-up, a shove — is not built. The goblin's kick was
deliberately not borrowed: `entities/zombie.ts` gates it on
`z.kind === "goblin"` and that bumper-pop is the goblin's identity, so reusing
it would have swapped one lie for another.

### 2.3 The Death Dealer's bestiary row is unreachable by construction
`entities/combat.ts` makes `reaper` immune, so `state.killsByKind.reaper` can
never increment. Three things are therefore permanently out of reach in normal
play: the "Death Dealer" row stays `???` forever (the reveal gate is documented
in `bestiary.ts`), `ENEMY_DROPS.reaper` (grimbone, 12%) never drops, and
`grimscythe` (`cards.ts`, `source: "reaper"`) has an **affinity source that
cannot be farmed**. Either make it killable under some condition, or reveal the
row some other way, or stop hanging farmable content off it.

---

## Tier 3 — the machine layer, now that it runs

Wired up on 2026-08-27 (`maze/decorate.ts`, the AUTHORED MACHINES block). Three
things it surfaced and did not resolve:

### 3.1 `sling-pair` is authored as a soft-lock
Two slingshots facing each other across a lane (E and W, `maze/assembly-lib.ts`)
— the launch duel `breakLaunchDuels` exists to break, and `assembly.ts` is
explicit that machines get no exemption from that guard. It can only ever ship
half-built, so it is **withheld** from the router (`PLACEABLE` in
`decorate.ts`). Re-author the pair at an angle so the two rebounds do not fire
down each other's throat.

### 3.2 An orbit can ship without its entrance
Measured 2026-08-27: 34 machines across the 36 census floors, **2 of them short
one `drive` part** — an orbit losing seq 0, its entry ramp, to the launch-duel
guard. That is legal by design and the rate is gated at >85% whole in
`maze/assembly-place.test.ts`. Still worth a look: a machine that keeps its
turns and loses its mouth is furniture wearing a machine's name.

### 3.3 `polishParts`' `isLauncher` is broader than `duelEligible`
`duelEligible` requires `LAUNCH_KINDS.has(p.kind)`; `polishParts`' `isLauncher`
asks only "has a heading and is not a deflector". A drop **target** has a
heading and launches nothing, so it passes one and fails the other — and was
being deleted as half of a duel it could not physically be in. Machine parts are
now held to `LAUNCH_KINDS`; loose corridor furniture still is not. Narrowing it
there changes every existing floor, so it is a measurement job: census the
before/after part counts, then decide.

---

## Tier 4 — card economy

### 4.1 Card affinity works for 3 of 28 kinds
`cards.ts` states the design pillar: farm a monster for its card. Sources exist
for 13 kinds; **15 have no card at all** (slime, sporeling, jester, croaker,
rotortail, stiltneck, fish_feet, pin, chomper, magnet, hound, bloater, warden,
sapper, mimic), and their bestiary rows render an empty card column. Of the 13
that do have one, only **zombie, bat and spider** have a *common* card — every
other source is rare+ and therefore boss/gold-wall-only. `cards.test.ts` states
this as a known condition rather than a bug.

### 4.2 There is no card level-up path
`rollCardLevel` fixes a card's level **at drop time** from the floor number;
`reKeyCard` only preserves level across a tavern reroll. No upgrade, fuse or
evolve verb exists anywhere. (Was `CONTENT_EXPANSION_PLAN` A6, "evolving cards".)

### 4.3 Set bonuses cover 3 of 13 modifier fields
`cards.ts` hardcodes three pairs (bolt / crit / material). Ten aggregate fields
have no set bonus at all. Shine is cosmetic plus a flat `SHINY_GROWTH = 0.3`.

---

## Tier 5 — content that was planned and never landed

From `CONTENT_EXPANSION_PLAN` part C and `DECLONE_PLAN` waves 2-5. Both
documents are retired; these are the items that were actually still open.

- **On-hit statuses** — Shock, Poison, Bleed, Mark/Curse. `CardModifier.onHit`
  is still `"chill" | "burn"` only.
- **Execute, Cleave/Overkill, Multishot, Ricochet, Homing** — no code anywhere.
- **Six of the eight marble-synergy cards** — only `crystalshard` and
  `golemcore` exist.
- **Expanded movesets for 14 monsters** — zombie pack-surge, spider web trail,
  spitter acid puddle, ghost phase-blink, bat swoop-dive, slime acid trail,
  reaper scythe sweep, goblin rock-throw, golem reassemble, chomper vine-grab,
  magnet overcharge, webspinner web-wall, **pin stand-back-up**. Only
  brute-enrage and slime-split shipped, and both predate the plan.
- **The Boo-stalker Warden** (`DECLONE` §3.1) — `spawn/reaper.ts` is still the
  straight-line accelerating drift on a flat `REAPER_AFTER` wall clock
  (`sim/simulate.ts`), which the plan calls the borrowed mechanic.
- **Descent contracts** (§4.1) — `rollModifier` is one uniform pick with zero
  player agency; no payout, no stacking, no notice board.
- **The tavern reading the run** (§4.2) — `TavernStats` is display-only; its
  single consumer is a heading string.
- **Per-weapon momentum identities** (§6.4) — `momentumScaling` is still a
  single boolean on one weapon (wreckingball), pinned by `combo.test.ts`.
- **The boss as a table part** (§6.3) — battable orbiting skulls, and a slam
  that keeps player control so you can surf it. The skulls are cosmetic meshes
  with no player collision; `doSlam` overwrites `p.momX/momZ/momSpeed`, which is
  the opposite of keeping control.
- **Gold as dust, not tokens** (user, 2026-08-30) — the coin drop should read
  as pinches of gold dust the knight inhales, not discs. The look is one paint
  seam — `tinyCoin`/`coinItem`/`coinStackItem` (`render/cel-painter.ts`) plus
  `COIN_DROP_SCALE` (`constants/economy.ts`) — while the flight/credit
  machinery (`economy/coins.ts`, the `GroundItem.sprite` contract,
  `coins.test.ts`) stays untouched. Wants a colour param on `vfx.mote`
  (hardcoded to `C_DUST` in `fx/system.ts`) for a gold shimmer during the
  0.42 s magnet flight, and a dust-inhale absorb at `economy/pickups.ts` in
  place of the plain spark.
- **The vault opens like a crate** (user, 2026-08-30) — `openVault`
  (`lamp-puzzle.ts`) spawns its loot as an instant flat ring (radius 0.9): no
  arc, no stagger, no fountain. The `openT` lid swing (0.6 s cubic, same file)
  is the clock to hang staged FX on; `spawnReagentMote` (`economy/loot.ts`)
  shows how to seed each item with a coin-style pop-and-settle `CoinFlight`.
  Companion gaps in `docs/vault-chest.md` are still open too: the sealed-bump
  refusal and the brazier HUD readout.

---

## Tier 6 — the boss (LARGELY CLOSED 2026-08-28)

Four guardians now, one per biome — `boss-kinds.ts` is the roster,
`boss-moves.ts` the six shared attack primitives, `boss.ts` the encounter. Each
has two attacks and an HP-threshold phase flip, and every attack has a wind-up
(`boss-roster.test.ts` refuses one under 0.3 s). The King's untelegraphed
barrage is fixed. What is left of this tier:

- **The boss still has no bestiary row and no card.** `tallyKill` now credits
  `boss:<kind>` alongside the brute, so the count is honest and the data exists
  — but nothing renders it, and the loot still rolls Brute Cleaver by affinity.
- **`sling-pair` and the Overlord's atlas** — see 3.1 and 1.1; 1.1 is closed,
  the Overlord wears `makeBossPaints` now.
- **`boss.test.ts` still does not cover** the party-size HP scaling or the
  portal's own geometry, though it now covers the phase flip, telegraph
  cleanup and per-boss divergence.

### The original entry, for the record

One boss, the Reaper King (`boss.ts`). **Two attacks, no phases, no HP-threshold
behaviour of any kind.** The tentacle slam has a pulsing telegraph ring; the
skull barrage has **no telegraph at all** — `fireBone` fires straight off a 2.6 s
timer with no wind-up, no tint, no clip. The "MEGA" boss every fifth floor
(`BOSS_EVERY`) is the same fight at 2x HP with a different toast.

He has no bestiary row and no card: `tallyKill` does `bump(z.kind)` and his kind
is `"brute"`, so killing him credits a brute and drops Brute Cleaver by affinity.

`boss.test.ts` has 8 tests, all about the exit gate and the leash. Nothing tests
the slam damage, the barrage, the party-size HP scaling, the portal, or
`adoptBoss`.

---

## Tier 7 — code health

Ordered by payoff. None of these change behaviour.

- **`PuffPool` is a fork of `ParticlePool`** — `fx/puffs.ts` against
  `fx/pools/particle-pool.ts`: identical field set, identical constructor body,
  identical ring-buffer bookkeeping, ~120 duplicated lines. `PuffPool` adds only
  two instanced attributes (`age`, `seed`), which should be an opt-in
  constructor argument.
- **Three copies of the floor-authoring pipeline** —
  `spawn/floor-authoring.ts` (ships), `dev/headless-floor.ts`,
  `dev/mega-floor.ts`. `mega-floor.ts` annotates itself *"`authorFloor`'s draw
  order, from here down. Do not reorder"*, a comment that exists only because
  the order is copied. This bit on 2026-08-27: the assembly layer's seed had to
  be threaded through all three by hand or the harnesses would measure a
  different floor than the one that ships.
- **`render/cel-painter.ts` is 4,785 lines** holding 15 monster painters inline,
  while 7 newer painters already live one-per-file in `render/monsters/`
  importing `engine/render/figure.ts`. The seam is obvious; the cost is
  triaging the private helpers those 15 share. `ITEM_PAINTS` / `NPC_PAINTS` /
  `PROP_PAINTS` are a separate file's worth on their own.
- **`entities/player.ts` is 2,445 lines** with four inline state machines (roll,
  wall-launch, drop/ride, ramp-hop) plus a 600-line `updatePinball` and melee.
  At minimum `player-forms.ts` and `player-pinball.ts`. Highest gameplay risk
  in this tier — hard to verify without playtesting.
- **`stranded()` is written three times** — `maze/artery-banks.ts`,
  `maze/relay-chambers.ts`, `maze/doorway-funnels.ts` each inline
  `bfsDistancesOwned` plus a full grid scan, and the revert-while-stranded loop
  after it is duplicated too. `engine/flow-field.ts` already owns
  `bfsDistancesOwned` and is the natural home.
- **`ui.ts` no-ops with no call sites** — its docblock says the functions are
  kept "so their call sites (mostly in core.ts and fps.ts) compile unchanged".
  Eight of them have **zero** call sites: `disposeFloatingCombos`,
  `ensureWolfFonts`, `createFpsOverlay`, `createBossBar`, `updateBossBar`,
  `createPlungerMeter`, `updatePlungerMeter`, `showControlsHint`. The file could
  shrink to ~45 lines.
- **~40 exports whose only reference is their own declaration** — across
  `constants/`, `maze/`, `render/`, `gui/`, `engine/`. Individually trivial,
  collectively a lot of false surface area.
- **Half-finished DOM → painted-GUI shims** — `floor-loading.ts`,
  `map-overlay.ts`, `pickup-toast.ts` forward to `gui/screens/*`. Fair for
  `ui.ts`'s `showToast` (23 importers), not for `pickup-toast.ts` (2) or
  `map-overlay.ts` (3), and `dev/gui-hooks.ts` already bypasses one of them.
- **`maze/floor-density.ts` and `maze/piece-rules.ts`** are reached only from
  their own tests. `render/light-crossing.ts` is reached only from
  `light-crossing.test.ts`, and is referenced in prose from four other modules
  as though it were live.

---

## Retired on 2026-08-27, and why

| doc | why |
|---|---|
| `ABILITY_FX_PLAN` | shipped — ring pool, `setFlash`, `oilT`, `unlockslick` all live |
| `CARD_LEVELS_PLAN` | shipped — `cardKey`, `stackHaul`, the shiny haul path |
| `CONTENT_EXPANSION_PLAN` | parts A/B shipped; part C is Tier 5 above |
| `DOORWAY_PLAN` | shipped — `maze/doorways.ts`, `doorway-funnels.ts`, `__dungeonDoorways` |
| `INGAME_UI_PLAN` | shipped — `gui/im.ts`, and `gui/no-dom.test.ts` enforces it |
| `LOAD_PERF_PLAN` | shipped. **18 unchecked boxes for work that fully landed** — `gpu-adapter.ts`, `warmupTarget`/`warmupReveal`, `FLOOR_FX_MAX`, `load-warmup.test.ts` all verified present. The checklist was simply never ticked |
| `LONG_BANKS_PLAN` | shipped — `maze/artery-banks.ts`, wired from `track-floor.ts` |
| `MARBLE_FORMS_PLAN` | shipped — 42/42, plus per-material tests |
| `MONSTER_CARD_PLAN` | shipped — 41/42; every path it cites was `src/scenes/dungeon/`, deleted 2026-07-26 |
| `ROUTE_MATH_PLAN` | **the most misleading doc in the set.** `marchRay`, `SpeedInterval`, `catmullRom` and `__dungeonRoute` return zero hits — verified. The work landed as `maze/track-grow.ts` and `maze/conic-fit.ts`. Reading it would not tell you what the code is called |
| `ARPG_FEATURE_PLAN` | part B never started; its ideas are research, not commitments |
| `CARD_REWORK_PLAN` | 21/23 done; the co-op wire format is the remainder |
| `DECLONE_PLAN` | wave 1 shipped; waves 2-5 are Tier 5 above |
| `MAZE_COLOUR_PLAN` | core shipped; its §4 is an albedo design question, not a plan |
| `MAZE_OVERHAUL_PLAN` | tracks A/B/D/F shipped; C and E were superseded |
| `MEGA_MAP_FINDINGS` | its tool shipped and its headline item — "the machine library is DEAD CODE" — was closed on 2026-08-27 |
| `NEXT_WAVE_PLAN` | track 1 shipped as TSL instancing; track 2 closed 2026-08-27; track 3 it recommended against |
| `PINBALL_KNIGHT_PLAN` | historical; its open items are folded in above |
| `PLAZA_PLAN` | A-0 shipped, the other ten waves never started. Its part kinds (`swingarm`, `scoop`, `maw`, `gate`, `magpost`) appear nowhere in `PinballPartKind` |
| `SPRITE_FIDELITY_PLAN` | measurement seam and palette lock shipped; the non-integer scales it counted are now named exemptions under `registry-drift.mjs` check H |
