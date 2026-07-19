# Pinball Knight — Consolidated Plan (Tavern + Cards + Map Gen)

_Rewritten 2026-07-17. Supersedes the old brainstorm. This doc is honest about
what is ALREADY BUILT (so we don't redo it), what is NEW from this round of
feedback, and what OUTSTANDING work is ported from the retired plans
(`src/scenes/dungeon/PINBALL_HYBRID_PLAN.md`, `PINBALL_ROADMAP.md`,
`BLUEPRINT.md`, `VERIFY_CHECKLIST.md`)._

All file paths are under `braindeadbot-client/src/scenes/dungeon/` unless noted.

---

## 0. Status Ledger — Already Built (do NOT rebuild)

Verified in code this round. These were the bulk of the old plan and they ship:

| Feature | Where | State |
|---|---|---|
| Wall-bounce physics (reflect + restitution) | `entities/player.ts:1230-1245` | ✅ flat wall keeps speed (`PINBALL_WALL_RESTITUTION` 0.94), **corner hits accelerate** (`PINBALL_CORNER_RESTITUTION` 1.12 + `PINBALL_CORNER_ADD` 1.4) |
| Break walls by going fast | `secrets.ts` + `player.ts:1213-1228` | ✅ cracked-secret bands smash at `SECRET_BREAK_SPEED` (7 u/s); **ordinary** walls punch through at `WALL_BREAK_SPEED` (15 u/s) if corridor behind |
| Map size scales with floor | `constants.ts:1135-1142` `levelConfig()` | ✅ `cellsW = min(17+ceil(l*1.4),30)`, `cellsH = min(12+l,22)`; braid/rooms/secrets/torches scale too |
| No-orphan launch validation | `maze/decorate.ts:276,630-665` | ✅ launch parts need `MIN_RUNWAY`=3 floor tiles ahead or they flip/cull |
| Ramp visual (wedge, rails, arrows, lip) | `render/pinball-parts.ts:82-136` | ✅ real `ExtrudeGeometry` wedge, side rails, 3 glowing arrows, gold kicker lip, scroll anim |
| Three-zone floors (launch→core→drain) | HYBRID Slice 9 | ✅ BFS-distance banding |
| Lit bumpers + jackpot, drop-target sequence, flipper redirect, momentum lanes, per-surface friction | HYBRID Slices 4-8 | ✅ |
| Card system (13 cards, 4 rarities, socketing, drops) | `cards.ts` + `cards.test.ts` | ✅ fully modeled + unit-tested |
| **Card effects: attack-faster / +damage / ice / fire** | `cards.ts:21-34,105-120` | ✅ `cooldownMult` (faster), `damageFlat`/`damageMult`, `onHit:"chill"` (ice), `onHit:"burn"` (fire), `pinballMult` |
| Tavern hub (Armory/Bar/Blacksmith/Notice Board) | `tavern.ts` | ✅ but as a **DOM overlay**, not isometric (see §B) |
| Card price spread | `tavern.ts:24-31` | ✅ 20/45/90/180g — but no high-end (see §C2) |
| Floating combo numbers, wall-break toast | HYBRID Wave 10 | ✅ |

**Takeaway:** the card *mechanics* and pinball *physics* the user described are
done. The real gaps this round are: (1) launch parts can still aim at a
**dead** unbreakable wall; (2) ramps don't yet **jump over** walls; (3) the
tavern is a flat DOM panel, not an isometric room with talkable NPCs; (4) cards
render as tiny chips, not holo cards; (5) no truly expensive cards.

---

## A. Pinball Map Generation — New Work

### A1. Launch parts never aim at a dead wall (promote-or-redirect)

**Problem.** `decorate.ts` only guarantees `MIN_RUNWAY` (3) *floor* tiles ahead
of a booster/ramp. After that runway the trajectory can terminate in an
**unbreakable** wall — the player rockets forward, bounces, and the launch feels
pointless. The user's rule: _"boosters are never pointed at a wall unless we can
break that wall — if we go fast enough we can break the wall, otherwise it gets
boring."_

**Plan.** Add a **launch-target resolution pass** in `decorate.ts`, run after
part placement, before render build:

- For each `LAUNCH_KINDS` part (ramp, booster, spring, slingshot, flipper),
  raycast along its fire direction across the grid until the first wall tile.
- Classify the terminating wall:
  - **Already breakable** (`T_CRACKED`, or `isBreakableWall()` true → corridor
    behind it): leave it — the launch pays off by smashing through. This is the
    desired "go fast → break → shortcut" loop.
  - **Dead unbreakable wall** (border shell, or solid rock with no corridor
    behind): fix it by, in priority order:
    1. **Promote** that wall tile to `T_CRACKED` **if** there is floor two tiles
       beyond (so the smash opens into real space, matching `crackSecretWalls`'s
       existing invariant). This is the primary fix — it turns every launch into
       a breakable target and directly enables "the map gets bigger/more complex
       as you smash outward."
    2. If promotion is impossible (nothing but shell beyond), **re-aim** the part
       to an open direction (reuse the existing flip-to-opposite-side logic at
       `decorate.ts:630-638`, generalized to 4 directions).
    3. If neither works, **cull** the part (orphan).
- Gate promotion so a launch can't chain-break the entire floor: only the FIRST
  wall in the trajectory is promoted; require the part's launch speed
  (`RAMP_SPEED` 13 / `BOOSTER_SPEED` 15) to clear the relevant break threshold
  (`SECRET_BREAK_SPEED` 7 — both do), so the promise is always keepable.

**Why this is the keystone.** It makes the user's mental model true everywhere:
*a booster you can see is always either a clear lane or a breakable wall you'll
punch through at speed.* No dead ricochets.

### A2. Ramp jump-over-walls (airborne arc)

**Problem.** Ramps (`player.ts:666`) and boosters (`player.ts:682`) only set a
floor heading + speed; the player still collides with every wall. There is NO
airborne state for launch parts. Airborne exists ONLY for the trapdoor
rollercoaster (`player.ts:1063` `updateRide`, a Catmull-Rom spline flown at
`TRAPDOOR_HEIGHT` 1.8 with collision bypassed) and wall-kick/pounce (which stay
grid-clamped). The user wants: _"when we hit a ramp can we jump over certain
walls, then physics so we hit a wall and bounce off it."_

**Plan.** Give ramps (not boosters — keep boosters as flat ground-speed lanes so
the two parts stay distinct) a real **launch arc**:

- On ramp trigger, if incoming `momSpeed ≥ RAMP_LAUNCH_MIN` (new constant),
  enter a new **`airborneT` state** on the player instead of the flat speed set.
- Reuse the trapdoor arc math: raise `p.sprite.mesh.position.y` on a parabola
  peaking ~`RAMP_HOP_HEIGHT` (≈1.2) over `RAMP_HOP_DIST` tiles (2-3 in the
  ramp's direction), bypassing `moveCircle` wall collision for the arc — so the
  knight **clears 1-2 walls** and lands beyond.
- Landing rules (this is where existing physics takes over):
  - Land on **floor** → resume `updatePinball` momentum in the ramp direction
    (carry speed, keep combo). Spawn the landing puff + speed trail already in
    `render/vfx.ts`.
  - Land **inside/against a wall** → nudge back to the last valid tile and hand
    to the normal pinball wall-bounce (§0) — reflect off it. This is exactly the
    "jump over walls, then bounce when you hit one" the user described.
- The ramp's **launch-target pass (A1)** should ensure the landing tile is floor
  when possible; if the only landing spot is a breakable wall, that's fine — the
  arc ends in a smash.
- Telegraph: while airborne, the shadow decouples from the sprite (draw a ground
  shadow at `y=0` under the arc) so the height reads in iso. Add a short i-frame
  window over the apex (matches trapdoor).

**Scope note:** this is the single genuinely-new *mechanic*. Everything it lands
into (bounce, break, combo, VFX) already exists.

### A3. Progressive size / complexity (extend, don't rebuild)

Map size already scales (`levelConfig`). This round only tunes the *curve* so
the smash-outward loop from A1 has room to grow:

- Raise the `cellsW`/`cellsH` caps modestly on deep floors (e.g. 30→34, 22→26)
  now that breakable launch-walls (A1) let the player expand the reachable area
  themselves — the floor can start denser because the player carves openness.
- Scale **launch-part density** and **cracked-wall budget** with depth in
  `levelConfig` so later floors read as more machine-like (more ramps/boosters,
  more breakable targets), delivering "gradually bigger / more complex."
- Keep the render viewport fixed (`VIEW_W` 20) — camera already follows.

### A4. Ported map-gen residue (from retired plans — optional / lower priority)

Carried forward so nothing is lost; none block A1-A3:

- **Kicker gates** and **multiball wells** as distinct part kinds — specced in
  the original brainstprm (Fix 3A), never built. (Multiball exists only as a
  potion power-up.) Nice-to-have.
- **Per-zone corridor WIDTH carve** + making the core the single densest band —
  explicitly deferred in HYBRID Slice 9 (taste, not blocking).
- **Literal layered generator** (Chi/freeway drunkard's-walk skeleton →
  slime-mold/Physarum branch fill → explicit Bagua 3×3 zone grid → Layer-4
  sightline scoring + reveal corridors). The shipped generator uses
  BFS-distance three-zone banding instead; the literal algorithm was never
  built. Treat as a research spike, not committed work.
- **Table-shaped prefab rooms** (circular/oct bumper court, teardrop return
  lane, ramp spiral, funnel rooms) — partial arc-corner flow exists; these
  specific prefabs don't.

---

## B. Tavern — Isometric Room With Talkable NPCs

**Current:** `tavern.ts` is a full-screen fixed DOM overlay (`z-index:10005`)
with four styled panels (Armory ⚔ / Bar 🍺 / Blacksmith 🔨 / Notice Board 📜).
No 3D, no fireplace, no characters — the "NPCs" are emoji in panel headers. The
old plan itself flagged this deviation ("plan named a 3D scene but shipped a DOM
overlay").

**Target (user request):** an **isometric tavern** — a warm room with a
**fireplace**, that you walk through, with **four distinct NPCs you talk to**:

1. **Potion-seller** (Bar/Alchemist) — potions.
2. **Armorer** — armor/gear.
3. **Weaponsmith** — weapons + repairs + card-slot upgrades.
4. **Card-dealer** — cards for sale (the holo cards, §C).

### B1. Render the room in the existing iso pipeline

- Build the tavern as an **iso scene reusing the dungeon renderer** (same
  Three.js + cel/pixel pass in `render/`), NOT a from-scratch scene — this is
  cheaper and keeps the art consistent. A single walled room tile-map (~9×7),
  wood-plank floor palette, a back wall with a **fireplace**: an emissive
  flickering ember mesh (reuse the torch flicker in the dungeon) + a warm point
  light, a mantel, a chimney. Tables/stools/barrels as simple primitive props
  (like `pinball-parts.ts` furniture).
- The player sprite walks the room (reuse `entities/player.ts` movement, combat
  disabled). Descend stairs / an exit door replaces the DESCEND button.
- Camera: the dungeon iso camera, framed on the room.

### B2. Four NPC vendors as figures you approach + talk to

- Add tavern NPCs as `figure.ts`-rigged sprites (reuse the biped rig; recolor
  per vendor). Each stands at a station: fireplace armchair (alchemist), armor
  rack (armorer), forge/anvil (weaponsmith), a card table (dealer).
- **Interaction:** walk within ~1.5 tiles → a floating prompt ("▲ Talk"); press
  the interact key → open that vendor's panel. Reuse the existing `tavern.ts`
  panel bodies (`station()` + `handle()` switch) as the *content* of each
  vendor's dialogue overlay — so the shop logic is preserved, just re-fronted by
  a character. This keeps the working buy/socket/forge/reroll code intact.
- Split today's single "Bar" panel across the four vendors:
  - Potion-seller ← potions.
  - Weaponsmith ← weapon repair, add-card-slot, weapon stock. (Blacksmith's
    repair/forge/reroll folds in here or stays a 5th anvil — TBD.)
  - Armorer ← **new** gear/armor stock (gear already exists in `runState.gear`;
    surface buyable armor pieces).
  - Card-dealer ← card stock + reroll (the §C holo cards).
- Notice-board stats stay as a readable board prop on the wall.

**Keep the DOM overlay as the *dialogue* layer** (it works, it's tested-shaped)
— the new part is the walkable iso room + NPC figures that trigger it. This is
the pragmatic path vs. a full in-world 3D shop UI.

---

## C. Cards — Holo Trading-Card Look (Pokémon-style)

**Current:** cards render as tiny inline chips (`tavern.ts:80-94` `cardChip`) —
a bordered pill with emoji + label + 8px description. Functional, but "very
basic."

**Reference (user-cited):** the Congress/Senate Pokémon cards in
`trading-client/frontend/src/components/HoloCard.jsx` +
`lib/holoCardEngine.js`. That system is a **512×716 canvas-painted card** with:
- 5 rarity tiers (0 matte → 1 cosmic art box → 2 full-art metallic → 3 gold
  etched → 4 rainbow secret rare), driven by `deriveCardData().tier`.
- Painted frame, portrait art box, HP, two "moves" with power, a plaque, foil
  **speckle** field, metallic sheen, gold edge, master-ball rarity icon.
- A CSS **`.holo-shimmer`** overlay (globals.css:1421) — a diagonal
  rainbow gradient sweep whose opacity scales with rarity.
- Optional WebGL 3D tilt/holographic shader on hover (shared renderer).

### C1. Port a card painter into the dungeon

- New module `render/holo-card.ts` (a trimmed port of `holoCardEngine.js`'s
  `paintCard`, minus the congress-specific data) that paints a `CardDef` to a
  canvas: frame in the card's `RARITY_HEX` color, an **icon/art box** (use the
  card's emoji large + a themed backdrop per element — red ember for burn, cyan
  frost for chill, gold for pinball, steel for utility), the label, rarity
  ribbon, the effect described as a "move" line (e.g. "Frost Chip — CHILL: slow
  on hit"), and tier treatment (speckle foil + metallic sheen + gold edge for
  epic/legendary).
- Map the 4 card rarities to tiers: common→0, rare→1/2, epic→3, legendary→4
  (rainbow secret-rare treatment for legendaries — Pinball Wizard / Soul Reaver
  should feel like a chase pull).
- Wrap it in a small element with the **`.holo-shimmer`** sweep (port the CSS
  into the dungeon's stylesheet) so cards glint in the tavern.
- Use these painted cards wherever cards show at meaningful size: the
  card-dealer's stock, the Armory socketing view, the on-pickup preview modal.
  Keep the tiny chip only for dense inline lists (weapon slot occupancy).
- 3D tilt is optional polish (defer) — the painted canvas + shimmer already
  reads far better than chips.

### C2. Expensive cards (price ceiling + a top tier)

User: _"cards should not just be cheap — there should be more expensive ones."_

- Current prices key off rarity only: 20/45/90/180 (`tavern.ts:24-31`).
- Raise the top and widen the spread: e.g. common 20 / rare 60 / epic 140 /
  legendary 300, and add a **`mythic`** rarity (tier-4 rainbow, a couple of
  build-defining cards) priced ~500-750g, sold rarely (dealer stock roll or
  once-per-run chase). Add `mythic` to `RARITY_COLOR`/`RARITY_HEX` (`cards.ts`)
  and the price map.
- Optionally price a card off its *modifier strength* (a big `damageMult` costs
  more than a small `damageFlat`) so a strong rare can out-price a weak epic —
  makes the shop feel curated, not flat by tier.
- Ensure the dealer's stock roll can surface expensive cards (weight by gold on
  hand / floor depth) so late runs have something to spend on.

### C3. Card effects — already done (confirm only)

The four the user named already exist and are unit-tested (`cards.ts`,
`cards.test.ts`): attack-faster = `cooldownMult` (<1), +damage =
`damageFlat`/`damageMult`, ice = `onHit:"chill"`, fire = `onHit:"burn"`, plus
`pinballMult` momentum synergy. **No new effect code needed** — just make sure
each card's painted "move" line reads its effect clearly (§C1). If new
expensive/mythic cards are added, they compose from the existing modifier
fields.

---

## D. Ported Outstanding (from retired plans — not this round's focus)

Carried so nothing is dropped; schedule after A-C:

- **BLUEPRINT Phase 4 juice not confirmed:** blood pixels, best-depth
  `localStorage` persistence, gold-wallet wiring. (Damage/combo numbers ✅.)
- **BLUEPRINT Phase 5:** leaderboard via `/api/scores`, Rapier physics,
  alternate maze algorithms — long-horizon, optional.
- **BLUEPRINT §11 open decisions:** perma-death vs checkpoints; do actor sprites
  get lit by torches. Decide, then implement.
- **§5.1 control-inversion empirical check** (flagged in ROADMAP §6 +
  VERIFY_CHECKLIST §6): left/right movement + aim direction possible inversion —
  never verified. Do a live playtest pass.
- **VERIFY_CHECKLIST.md** is entirely unchecked — every item is a live in-browser
  test (debug console, HUD, buff strip, power-ups, rampage swap, enemies/parts).
  Wave 10/11 features (incl. the current tavern) were only build/tsc-verified,
  never playtested. Run the checklist in-browser.

---

## E. Files to Touch

| Work | File(s) |
|---|---|
| A1 launch-target promote/redirect | `maze/decorate.ts` (new post-placement pass), `maze/generator.ts` (`T_CRACKED` promotion helper), `secrets.ts` (reuse `isBreakableWall`) |
| A2 ramp airborne arc | `entities/player.ts` (new `airborneT` state; ramp trigger at ~`:666`; arc math ported from `updateRide` `:1063`), `constants.ts` (`RAMP_LAUNCH_MIN`, `RAMP_HOP_HEIGHT`, `RAMP_HOP_DIST`), `render/vfx.ts` (ground shadow + landing puff) |
| A3 size/complexity curve | `constants.ts` `levelConfig()` |
| B1 iso tavern room | new `scenes/tavern/room.ts` (or extend `tavern.ts`) reusing `render/*`; fireplace via torch-flicker + point light |
| B2 vendor NPCs | `render/figure.ts` (vendor sprites), `entities/npc.ts` (interaction prompt), `tavern.ts` (re-front panels as per-vendor dialogue; add Armorer stock) |
| C1 holo card painter | new `render/holo-card.ts` (port `trading-client/.../holoCardEngine.js` `paintCard`); port `.holo-shimmer` CSS; wire into `tavern.ts` card views + pickup modal |
| C2 pricing + mythic | `cards.ts` (add `mythic` rarity + roster), `tavern.ts:24-31` (price map, stock roll weighting) |
| D verification | live playtest against `VERIFY_CHECKLIST.md`; control-inversion check |

---

## F. Suggested Order

1. **A1** (launch-target promote/redirect) — biggest gameplay win, unblocks the
   "smash outward → bigger map" loop; pure generation code, low risk.
2. **A2** (ramp airborne jump) — the one new mechanic; lands into existing physics.
3. **C1 + C2** (holo cards + pricing) — high visual payoff, self-contained port.
4. **B1 + B2** (iso tavern + NPCs) — largest surface; keep DOM panels as the
   dialogue layer to de-risk.
5. **A3** tuning, then **D** playtest verification.

Each is independently shippable and testable (`npm test` + `npx tsc --noEmit`,
then in-browser). Commit + push before any deploy.
