# De-Clone Plan — improve what's shipped, then make every borrowed mechanic ours

_Written 2026-07-27 from a two-track review: a full code audit of every shipped
system (working tree @ `6bdd0f9`) and a full digest of the 12 reference-game
reports in `docs/game-dev-rules/game-research/`. Companion to
`ARPG_FEATURE_PLAN.md` (which proposes NEW systems — this doc deliberately
proposes none)._

**The brief, verbatim from the author:** (1) no new features — improve only what
already exists; (2) go feature by feature and reinvent each borrowed mechanic so
it is not a 1:1 copy of the game it was researched from — rebuild it around the
pinball-maze/momentum identity.

**Decisions already made by the author (do not re-litigate):**
- **Reaper:** appears on designated floors only, not every floor. Multi-hit,
  never a one-shot. Boo-style: aggressive only while the player is NOT moving;
  while the player moves it acts like it's hiding (Mario Boo inversion).
- **Upgrade gamble → Tempering:** risk resolved by play, not menu dice.
- **Grade pace axis → Flow:** time-weighted average momentum, not wall-clock.
- **Cadence:** one wave per session, in order, each independently shippable.

---

## 0. The diagnosis — read this before implementing anything

**The pinball layer and the ARPG layer are two games sharing a HUD.** The ports
are high quality and faithful — and faithfulness is the problem. The complete
list of systems that read `momSpeed` or `bounceCombo` outside `player.ts`:

| Site | What it does |
|---|---|
| `combat.ts:88` | `pinballMult` cards — binary gate at `CARD_PINBALL_SPEED` |
| `combat.ts:101-105` | wreckingball `momentumScaling`, `t = min(1, v/22)` |
| `combat.ts:107` | `skills.pinballDamageMult` — same binary gate |
| `combat.ts:117` | `comboDamageMult(bounceCombo)` |
| `combat.ts:377-420` | goblin/golem/chomper/crystalback gates (binary) |
| `combat.ts:756-771` | style-kill gold via `comboKillGold` |
| `abilities.ts:270` | flippercharge — OVERWRITES momSpeed (can slow you) |
| `boss.ts:486,655` | slam knockback writes momSpeed |
| `pinball-collide.ts` | the part handlers |
| `coop.ts:447` | marble-vs-marble |

Everything else — rarity, drops, XP, grade pace, shops, crafting, corpse runs,
the reaper, boss AI, gear, 18 of 22 enemy families, the dodge roll — ignores
speed entirely. And `CARD_PINBALL_SPEED = 8` (`constants.ts:1069`) out of
`PINBALL_MAX_SPEED = 22` means every "momentum build" is fully switched on at
36% of top speed and gains nothing above it. **That constant is the flattest
number in the codebase.**

Clone distance of the big borrowed systems (audit estimates): dodge roll ~85%
Gungeon, cards ~90% Ragnarok Online, upgrade gamble ~80% RO refine, corpse run
~70% D2, reaper ~80% Gungeon's Lord of the Jammed, tavern ~75% D2 town,
abilities ~90% HoT hotbar. The surface system (`engine/surfaces.ts`) is the one
genuinely original mechanic — and the least exploited: painted only by floor
modifiers, read only by bounce physics.

Cross-game laws from the research set (README synthesis), used throughout:
two-bucket stat math; anti-streak beats flat rates; performance is a design
rule; fixed ticks make breakpoints — publish them; **the more momentum decides
outcomes, the softer the failure ledger must be.**

---

## 1. Design spine (every wave obeys these)

1. **One momentum ramp, everywhere.** Add `momentumT(speed)` to
   `entities/combo-curve.ts` — normalized 0→1 from ~walk speed to
   `PINBALL_MAX_SPEED`, hyperbolic `x·k/(x+k)` shape (structurally incapable of
   runaway; the house DR curve per the D2 report). Every binary
   `> CARD_PINBALL_SPEED` check migrates onto it. A toggle becomes a dial.
2. **Two-bucket stat math.** Farmable bonuses (cards, tree smalls) aggregate
   additively or under a concave curve; multipliers live only in slot-limited or
   drawback-carrying places (set bonuses, mythics). Penalties stay LINEAR.
   Mobility stats get ONE clamp at the aggregation layer, never per-source —
   the booster-corner-jam lesson ("a damp guard can never beat a speed floor").
3. **The ranking filter** from `ARPG_FEATURE_PLAN.md` stands: every change must
   make you go faster, take a worse line, or commit to a ride you can't cancel.
4. **Soft failure ledger** (Yoku law): physics never triggers the ARPG death
   penalty. Monsters kill; the table only taxes.
5. **Standing gates per wave:** `npx vitest run` green (~1400);
   `npx tsc --noEmit 2>&1 | grep -c 'game/pinball-knight'` stays **0**;
   `coop-determinism.test.ts` + `maze/floor-pipeline.test.ts` green; seeded RNG
   only in anything the horde/floor sees; generation changes behind a flag with
   bit-identical defaults; real-browser feel pass (SwiftShader cannot judge
   feel, and this repo's history has three bugs only a screenshot caught).

---

## 2. Wave 1 — The Spine ✅ SHIPPED 2026-07-27 (`ed5678e`, `0ac0eed`)

Everything in the table below is live. **Do not re-propose any of it.** Gates
at ship: 1631 tests green, 0 tsc errors in `pinball-knight`, coop-determinism
and floor-pipeline green, `next build` clean, and a real headless run (bot
launched, combo climbed to 21, speeds 13–18.4 u/s, descend fired the flawless
heart hp 6→7) with **zero non-WebSocket console errors**. The `ws://…/ws` 403
seen in that run is pre-existing and unrelated (server.mjs vs realtime.mjs).

Two deviations from the plan as written, both deliberate:

- **§1.2 exempts the best card.** Softening the whole stack made a SINGLE card
  under-deliver its printed value (a +50% card paying +44%), and
  `describeModifier` regenerates every card's text from its own modifier — so
  the card would have been lying about itself, the exact failure the card-level
  system exists to prevent. The curve is now `best × soften(raw/best)`: one
  card is exact, the pile bends. Three tests that pinned raw multiplicative
  stacking were rewritten to the new contract.
- **§1.6 inverted.** The plan said "bounces sustain, kills grow", which is
  Hotline Miami's rule for a KILL combo. Applied literally to a BOUNCE combo it
  would have turned `bounceCombo` into a kill counter and invalidated every
  curve calibrated on it. Shipped inverted instead — bounces still grow the
  count, and a momentum kill REFRESHES the window — which captures the actual
  insight (the productive action must not drop your chain) without gutting the
  system.

Also shipped beyond the plan: the grade line now prints flow and combo on the
way out (`FLOOR GRADE A · flow 34% · combo ×21 · +25g`), because a grade axis
the player cannot see is the same bug as the silent vault.

| # | Change | Files | Notes |
|---|---|---|---|
| 1.1 | `momentumT()` replaces the binary gate at `combat.ts:88/107` and folds in the wreckingball ramp | combo-curve.ts, combat.ts, constants.ts | Colocated test: monotone, clamped, 0 at walk, ~1 at 22 |
| 1.2 | Concave aggregation for stacked same-stat card deltas (Isaac sqrt shape `√(1.2·Σ+1)`), penalties linear, ONE mobility clamp at aggregate | cards.ts `aggregateCards:474`, skill-runtime.ts | Balance guard for everything later waves add |
| 1.3 | `recordShot` for mirror / slingshot / flipper / spinpad / jackpot (today 18 of 23 part kinds are invisible to named combos); 4–6 new `NAMED_COMBOS` from the wider vocabulary | pinball-collide.ts, shots.ts, constants.ts:770 | Vocabulary 5 → ~10 words; pay-once-per-floor unchanged |
| 1.4 | `scoreRun` gains the shot layer: named-combo count, orbit laps, jackpots, best flow | run-score.ts:45 | Today `bestCombo·50` vs `floor·1000` — the whole shot system never reaches the leaderboard |
| 1.5 | Grade rework — **style** rescales past 8 on a log ladder (8/24/64: today combo 8 and combo 80 grade identically, and 8 = `COMBO_ZONE_CRUISE`, where the game *starts*); **pace → FLOW** = time-weighted average momentum (running integral in `core.updateGame`; walking can no longer take full pace marks) | core.ts `gradeFloor:2067`, constants.ts:1392 | HM lesson: flow bonus stays worth less than one good combo |
| 1.6 | Combo timer: bounces and part hits **sustain** the chain window, only kills **grow** the count (HM's rule; HM2 removed it and players hated it) | combo window sites, shots.ts | Long banked shots become combo-viable |
| 1.7 | Flawless floor → +1 max heart for the run, announced (Master Round analog grafted onto `gradeFloor`, which already sees damage inputs) | core.ts, state.ts | ~20 lines; rewards the skill the game teaches |
| 1.8 | Announce the S/A `bonusRoomNext` reward (exists at core.ts:924, currently silent) and print grade→reward linkage on the descent card | core.ts, ui | |
| 1.9 | flippercharge: `momSpeed = max(momSpeed, FLIPPER_LAUNCH_SPEED)` — today it overwrites and can SLOW a fast player | abilities.ts:270 | Bug-shaped design flaw |
| 1.10 | Spinpad de-RNG: exit direction = f(entry angle, pad's seeded spin phase) — deterministic, aimable, co-op-safe; `recordShot("spin")` | pinball-collide.ts:626 | Removes a `Math.random()` from a physics path; the audit's weakest part |

**Effort:** ~1 session. **Risk:** low-medium — 1.5/1.6 change scoring feel;
seeded-floor replay before/after, screenshot the HUD.

## 3. Wave 2 — Signature de-clones

### 3.1 Death Dealer → the Boo-stalker Warden (author-specified)
Retire the flat per-floor 110s wall-clock (`REAPER_AFTER`/`REAPER_WARNING`,
`constants.ts:1366`; trigger at `core.ts:2107`). Instead:
- **Designated reaper floors only** — cadence in `levelConfig` (e.g. every 4th
  floor, or seed-rolled per depth band), **announced on the descent card** so
  it's a dread beat, not a gotcha. Present from early in the floor.
- **Boo behavior:** player above a modest speed threshold (reuse `momentumT`,
  with hysteresis so he doesn't flicker) → he freezes/goes shy — stops
  advancing, hide pose, dimmed. Player slow/stopped → he hunts, and may exceed
  the old 6.2 speed cap since movement now grants full safety.
- **Multi-hit stays:** `REAPER_DAMAGE 2` per touch + a touch cooldown. Never a
  one-shot.
- Reuses `spawnReaper()` (`core.ts:2040`), the art, and the stairs-clear rule.
- Ordinary floors lose their timer; Wave 1's flow grading supplies the
  anti-camping pressure there.

### 3.2 Dodge roll → The Tumble (momentum-inheriting, surface-aware)
De-clone from Gungeon's fixed 2.6-tile roll (`player.ts:352-447`):
- The roll **reads and writes `momSpeed`**: entry speed sets tumble distance and
  speed; exit keeps your momentum instead of discarding it. The absolute i-frame
  window stays fixed and front-loaded — so a fast tumble travels further with a
  longer vulnerable tail. That's the momentum bet.
- `updateRoll` reads `floorSurface()` (today it ignores surfaces): ice extends
  the slide, sand shortens it, flowstone steers harder.
- The wall-kick (`:418`) gets a shot id and sustains the combo window.
- Keep: direction commit, front-half i-frames, no cost, `ROLL_MIN_SPEED` gate.

### 3.3 Upgrade gamble → Tempering (risk resolved by play)
De-clone from RO refine (`items.ts:205-305`). Below `UPGRADE_SAFE_LEVEL`
unchanged. Past it, paying makes the weapon **white-hot for the next floor**:
- Land K momentum/style kills (existing detection, `combat.ts:756`) before
  taking a hit → the upgrade **sets**, with a superlinear over-upgrade bonus
  (RO's +3/+5/+7/+13 gradient) so greed pays visibly.
- Take a hit first → it **shatters**; insurance cards still rescue sockets via
  the existing `insuredCards` path (`items.ts:260`).
- HUD: white-hot progress pips on the weapon slot (hud-wolf top strip).
- The menu keeps only the purchase; the dice leave the menu entirely.
- **Serialization:** `WeaponState` gains tempering state — bump save-shape
  validation in `settings-save.ts` / `corpse-run.ts` / coop item sync
  (`coop.ts:366`) or old saves fail-soft into empty.

**Effort:** ~1.5 sessions. **Risk:** medium — 3.1 touches spawn cadence (floor
seed only), 3.2 is core feel (real-browser mandatory), 3.3 touches every
`WeaponState` serializer.

## 4. Wave 3 — The bet layer (rolls become choices; the run talks to the tavern)

### 4.1 Floor modifiers → Descent contracts
`rollModifier` (`maze/modifiers.ts:189`) is uniform over 7 with zero agency.
Make it a bet at the notice board: 3 seed-rolled offers, stack any subset, each
with an explicit payout (`goldMult`/`cardDropMult`/`bonusItems`). Needs a
`payout` field, a stacking rule (cap `hordeMult` under the 175-actor budget), a
board UI panel, and multi-modifier support (current path assumes 0-or-1).
While in there: fill the two empty `surfaceMix` entries (blackout, collapsing)
and add depth weighting to the offer roll.

### 4.2 The tavern reads the run
`TavernStats {grade, floor, kills, bestCombo}` (`tavern.ts:115`) is passed in
and only displayed. Use it: S/A grade unlocks a dealer stock tier and a
discount; the gambler's per-visit stake cap scales with best combo; prices gain
mild depth scaling. D2's static town becomes a tavern that reacts to how you
played.

### 4.3 Flask belt → charged by the table
De-clone from both "plain hotbar" and PoE: belt slots hold charges refilled by
kills **and high-speed wall impacts** (momentum as the crit analog — the PoE
report's own pinball twist). Size charges so uptime is genuinely partial
(~40-60%) — no flask piano. Seam: `useBeltSlot`/`addToBelt`
(`economy/shop.ts:64`); crafting recipes set charge size/potency instead of
one-shot consumables.

### 4.4 Mana → the table is the battery
Add a per-bounce-combo-tick mana trickle beside the clock+kill regen
(`abilities.ts:377`). Every ability becomes momentum-coupled without touching a
single ability effect.

**Effort:** ~1.5 sessions. **Risk:** low-medium — modifiers module is DOM-free
and tested; belt/mana are small seams.

## 5. Wave 4 — Material world (exploit the original system)

The 5×5 surface matrix is what the reference games don't have — Peglin's report
says explicitly: PK can scope physics effects to materials, Peglin structurally
can't. Today only 5 of 7 modifiers paint it and only bounce physics reads it.

- **5.1 Paint from more authors:** themes/archetypes/prefabs get `surfaceMix` —
  speedway band = steel/flowstone, bumper band = rubber, vault = brass. The
  three-zone BFS banding (`maze/decorate.ts:576`) is the natural driver;
  `paintSurfaces` already runs on a derived RNG so layouts stay bit-identical.
  Doom lesson: physics contrast IS this game's light/dark — and the existing
  tint pipeline already guarantees "no physics change without a visible
  material change".
- **5.2 Material-scoped card effects:** re-author 1-2 existing cards per rarity
  to read surface/bounce context — burn spreads along brass, chill on ice
  hardens to freeze, `pinballMult` ticks harder on rubber. Uses `CardModifier`
  fields + `MoveResult.hitSurface` (already reported). Same 25-card roster —
  cards stop being flat RO stat chips.
- **5.3 Shine gets mechanics:** a shiny card's effect also procs on wall-bounce
  hits, not just weapon hits (today shine = +0.3 growth + sparkle). One rule,
  all 25 cards.
- **5.4 Set-bonus coverage:** 3 hardcoded pairs today; 10 of 13 modifier fields
  orphaned. Author ~6 more pairs (lifesteal, pierce, chill, burn…) on the
  existing seam (`aggregateCards` `cards.ts:474-489`), each loudly announced
  with a banner — the Gungeon-synergy discovery beat.

**Effort:** ~1.5 sessions. **Risk:** low-medium — paint behind a flag, default
bit-identical; screenshot the bands (tint bugs only show in screenshots).

## 6. Wave 5 — Foes and the King (the roster learns what game it's in)

- **6.1 Impact-scaled stagger** (Doom's pain chance, momentum-priced): per-hit
  stagger roll scaled by `momentumT(impact speed)`; high pain-chance for
  fodder (ricochet-stunlockable), low for elites. Use a PoE-style entropy
  accumulator, not raw dice — deterministic, replay-safe, co-op-fair.
- **6.2 Gates → curves + one exception per sub-type:** migrate the 4 binary
  enemy gates (`combat.ts:377-420`) onto `momentumT`; each of the 8 zombie
  sub-types picks ONE asymmetric exception from a tiny shared vocabulary
  (immune-to-bounce-damage / only-killable-at-speed / dodges-ranged) — HM's
  weapon-puzzle trick, pure data in the `ZombieTypeDef` bundle shape.
- **6.3 Boss — his attacks become table parts:** ram the king above a speed
  threshold to stagger him (6.1); orbiting skulls become **battable at speed**;
  the tentacle-slam launch (`SLAM_LAUNCH 16`, `boss.ts:486`) keeps player
  control so you can *surf the slam* into a line. The fight stops being
  stand-swing-dodge and becomes "use his attacks as boosters." Add a soft
  per-window damage cap ONLY if playtests show one big bounce trivializes him
  (Gungeon's shape: cap on a 3s window, single hit ≤ 3× cap, discard silently).
- **6.4 Weapons — two momentum identities:** `momentumScaling` becomes a
  per-weapon coefficient: heft weapons (warhammer/greatsword/wreckingball)
  scale off `momentumT`; light weapons (sword/stick/bow) scale off
  `bounceCombo`. Mass loves speed, finesse loves chains. Boots grant the walk
  speed they claim (`items.ts:337` — currently a comment, not a stat). Gear
  absorb adopts the hit-size formula `DR = absorb/(absorb + k·hit)` so armor
  absorbs chip damage but boss slams punch through — and stops being obsolete
  by floor 2.
- **6.5 Bestiary pays:** per-family kill milestones (from existing
  `killsByKind`) print the momentum gates as explicit mechanics text and bias
  that family's card affinity on milestone. ⚠️ The documented drop-rate trap:
  `rollCardDrop` draws affinity INSIDE the pick (`cards.ts:327`, pinned by
  test) — apply any bias at that exact point in the stream or rates silently
  move. Also record ram kills + best combo per kind.
- **6.6 Co-op honesty:** boss HP scales with party size (today identical for 1
  or 4 knights; `delve.ts` only top-ups players).

**Effort:** ~2 sessions. **Risk:** medium — spawn/combat paths; determinism
tests are the gate.

---

## 7. Explicitly OUT of scope (new features, per the brief)

Shrines/altars · curse stat system · gear/weapon affixes · card transmute +
magic find · champion packs · trait draft · multiple starting knights · torment
tiers/NG+ · blanks-style panic button · devil-deal rooms · transformation
forms · Well/extraction · quest boards · descent shortcuts · stat-sheet
overhaul. All remain catalogued in `ARPG_FEATURE_PLAN.md` and
`docs/game-dev-rules/game-research/` for future waves — several become cheaper
after this plan lands (e.g. affixes inherit the two-bucket aggregation; curse
inherits the Warden).

## 8. Verification per wave (beyond the standing gates)

- **W1:** unit tests for `momentumT` + rescaled grade; seeded-floor replay
  comparing score fields; screenshot the flow meter.
- **W2:** headless bot on a reaper floor — assert the Warden advances only while
  bot speed < threshold (poll `__dungeonPlayer`, use `wait_for_function`, never
  a tight loop — SwiftShader starves RAF); tempering state survives
  save/corpse/coop round-trips.
- **W3:** contract stacking respects the 175-actor cap; board panel reachable by
  pad; modifier tests extended for multi-active.
- **W4:** `floor-pipeline.test.ts` bit-identical with the paint flag off;
  screenshots of painted speedway/bumper bands.
- **W5:** coop-determinism green (entropy accumulator, zero `Math.random()`);
  boss fight feel pass in a real browser.

## 9. Open questions (decide at each wave's start, not now)

1. W2: reaper-floor cadence — fixed every-Nth vs seed-rolled band? (Lean fixed:
   a learnable dread rhythm, per D2's "leak the macro-structure".)
2. W2: does the Tumble's i-frame window scale at all with entry speed, or stay
   absolute? (Lean absolute — the bet must have teeth.)
3. W3: do stacked contracts multiply payouts or add? (Lean multiply multipliers,
   clamp downstream — the code already clamps budgets.)
4. W5: does the skull-bat use the swing or the body? (Lean body-at-speed — it's
   the pinball answer.)
