# Pinball Knight — Consolidated Plan

_Rewritten 2026-07-19. Every line below was re-verified against the source this
round; the previous revision (2026-07-17) had gone badly stale — most of its
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

Ordered by value. Items 1–3 are the ones I'd actually do next.

### 1. The dungeon still never submits a score 🔴

The single biggest gap between "built" and "useful", and it has survived several
rounds. The service is ready (`POST /api/scores`, `game: "pinball-knight"`, JSON
`detail` blob) and `src/services/score-service.ts` is game-aware — but grepping
`score-service|/api/scores|submitScore` across the repo returns only
`objects/ski-game.ts`, `room/pirate-surf-ui.ts` and
`objects/raccoon-tornado/core.ts`. **Zero hits under `scenes/dungeon/`.**
Neither death (`core.ts:1442-1466`) nor descent (`core.ts:1468-1479`) posts
anything; both only touch the gold wallet.

Post on death and on descent: score, floor reached, best combo, kills, run time.
`saveLeaderboardScore` is async and returns `Promise<boolean>` — **await it and
surface failure**; the identical fire-and-forget bug in raccoon-tornado showed
players a score that was silently rejected.

### 2. `render/pinball-parts.ts` is the last silent-miss hazard 🔴

Collision is exhaustive by construction, so adding a `PinballPartKind` without
handling it is a compile error. The renderer is not:

- **builder chain — 17 branches**, `pinball-parts.ts:506-522`, no final `else`
- **animator chain — 16 branches**, `:618-794`, ending `else if (part.kind !== "pit")`
- plus 2 pre-chain guards (`:599` glove, `:609` firevent), 5 inline `s.kind ===`
  ternaries at `:540-548`, and 2 more at `:800`

(The old plan's "~42 branches" was wrong — it's 33 across the two chains.)

A new part kind therefore **type-checks, collides correctly, and renders
nothing**. Convert both to `Record<PinballPartKind, …>` the same way collision
was. This is exactly the bug class that silently applied wrong physics for
months before `pinball-collide.ts` was converted.

### 3. Arrow keys are double-bound — and this is probably the "control inversion" 🟠

`ROADMAP §6` / `VERIFY_CHECKLIST §6` have carried a never-verified note about
left/right movement vs aim inversion. Reading the code, **there is no sign error
anywhere**: movement and mouse aim both route through `screenDirToWorld` with
the same screen-down convention (`camera.ts:51-57,99-100`), iso movement at
`player.ts:281`, and FPS negates `a.z` deliberately with a comment saying why
(`fps.ts:189-191`).

The real defect is different: `arrowleft`/`arrowright` are in **both**
`MOVE_KEYS` (`input.ts:58,60`) and `TURN_LEFT`/`TURN_RIGHT` (`:69-70`), and
`onKeyDown` registers both (`:86-87`). In FPS mode, holding Left arrow strafes
left *and* rotates the camera left simultaneously — which would absolutely feel
like inversion to a playtester. Pick one binding per key, then close the note.

### 4. Ramp-hop polish

- **The ground shadow rises with the knight.** `makeContactBlob` parents the
  blob to the billboard mesh (`render/sprite.ts:90-97`) and `updateHop` lifts
  `sprite.mesh.position.y` (`player.ts:925`), so height doesn't read in iso.
  Decouple the blob and draw it at `y=0` under the arc. Also affects wall-kick
  and pounce.
- Consider whether boosters should hop too, or stay flat by design (currently
  flat, deliberately).

### 5. Map / floor-plan residue

- **`LevelPlan.rooms` is dropped after `buildMaze`.** `plan` is a local const in
  `startLevel` (`core.ts:962`) and never stashed on `state`; `plan.rooms`
  (declared `maze/decorate.ts:135`) is read **nowhere**, so the floor map cannot
  label speedway/bumper/arena/vault rooms. Stash the plan to enable it.
  **Correction to earlier notes: `plan.frog` is NOT lost** — the frog survives as
  an NPC (`core.ts:1142`, `state.npcs` kind `"frog"`, `state.ts:268,473`), so the
  map can already locate it without the plan. Only `rooms` needs retaining.
- **Minimap has no off-screen stairs indicator.** `hud-minimap.ts` (66 lines)
  never mentions stairs; `map-render.ts:168-169` only draws them when already
  discovered AND inside the 23×23 window (`WINDOW=11`). No edge clamp, no arrow.
- **No legend on the HUD minimap.**

### 6. Juice gaps (BLUEPRINT Phase 4)

- **Damage numbers do not exist.** `vfx.ts:310-329` exports only
  `sparks/blood/ember/mote/dust/slash/ghost`. Earlier notes claiming
  "damage/combo floating numbers ✅" were wrong.
- **Combo is a centred DOM `×N` flash** (`state.ts:419`, `core.ts:579`,
  `ui.ts:205,226-227`), not floating world-space text.
- **Best-depth persistence is unbuilt** — zero `localStorage` hits under
  `scenes/dungeon/`. Cheap, and it gives a solo player a reason to push.

### 7. Card economy tail

- **On-pickup card preview modal** — `paintCard` is called in exactly one file
  (`tavern.ts:213`). The dungeon pickup path is a silent `pickUpCard(it)`
  (`core.ts:1627`) with no card visual. Showing the painted card on pickup is
  the highest-value remaining use of a system that's already built.
- **Stock roll ignores gold and depth.** `rollBarOffers` (`tavern.ts:119-130`)
  uses flat fixed thresholds (`<0.5` common … else mythic). Weighting by
  gold-on-hand or floor depth would give late runs something to spend on.
- **Modifier-strength pricing** (a big `damageMult` costing more than a small
  `damageFlat`) — still keys off rarity only.

### 8. Tavern polish (see `../tavern/TAVERN_PLAN.md`)

- Keepers don't react to being approached — nothing in `npcs.ts` reads player
  position; no turn-to-face, no greeting.
- **No keeper at the gambler station** — `KEEPER_SPOTS` (`layout.ts:199-203`)
  omits it, so the casino is an unattended cabinet.
- No camera zoom on station focus.
- The central diorama animates on a timer rather than reflecting the real run
  (lit bumpers should mean completed targets; the ball should move after a
  strong floor).

### 9. Never-playtested

`VERIFY_CHECKLIST.md` is **40 items, zero checked**, across 7 sections (debug
console, HUD layout, buff strip, power-ups, rampage swap, enemies & parts, known
issues). Waves 10+ were only build/tsc-verified. There is no E2E harness for the
3D game, so this checklist is the only way a change gets confirmed by hand.

### 10. Research spikes — not committed work

None of these block anything; recorded so they aren't silently lost.

- **Kicker gates** and **multiball wells** as distinct part kinds. Neither
  exists in `PinballPartKind` (`state.ts:295-315`); multiball exists only as a
  potion power-up. ("kicker" appears solely as ramp *art*.)
- **Per-zone corridor width carve.** Not built. The shipped analogue is the
  runtime friction gradient (`constants.ts:329-331`, `player.ts:1106`) plus
  `widenMainArtery` — not a per-zone width parameter.
- **The literal layered generator** (drunkard's-walk skeleton → Physarum branch
  fill → Bagua 3×3 zones → sightline scoring). Zero hits repo-wide. The shipped
  generator uses BFS-distance banding instead. Treat as a spike, not a plan.
- **Table-shaped prefab rooms** (circular/oct bumper court, teardrop return
  lane, ramp spiral, funnel). `maze/prefabs.ts:40-169` has 13 *corridor-shape*
  prefabs; none is a table shape. Closest is `bullring` (`:98`) and the bumper
  quincunx grid (`decorate.ts:611-621`).
- **Level size curve.** Caps are `cellsW ≤ 33`, `cellsH ≤ 25`
  (`constants.ts:1267-1268`) — already raised from 30/22 and credited to A1 in
  the comment. A previous plan asked for 34/26; the difference is not worth a
  commit on its own. **Launch-part density does not scale with depth** (no
  per-level part-count field in `LevelConfig:1239-1259`; counts come from room
  archetypes) — that one is worth doing if later floors should read as more
  machine-like. The cracked-wall budget *does* scale
  (`launchBreaks: min(5 + ⌊(l-1)/2⌋, 10)`, `:1299`).
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

1. **Score submission** (§1.1) — closes the longest-standing real gap, small,
   and the service side is already built and game-aware.
2. **Exhaustive part rendering** (§1.2) — removes the last silent-miss hazard in
   the part pipeline; mechanical, and the collision conversion is the template.
3. **Arrow-key binding** (§1.3) — one-line class of fix that likely resolves a
   note that has been open across three plans.
4. **Pickup card preview** (§1.7) — highest-value remaining use of the holo card
   system, which is already fully built.
5. **Damage numbers + best-depth persistence** (§1.6) — cheap juice.
6. **Ramp-hop shadow, minimap stairs, `LevelPlan.rooms`** (§1.4, §1.5).
7. **Playtest against `VERIFY_CHECKLIST.md`** (§1.9) — do this before believing
   any of the above is done.

Each is independently shippable: `npm test` + `npx tsc --noEmit`, then
in-browser. Commit and push before any deploy.
