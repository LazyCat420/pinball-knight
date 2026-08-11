# Build-out — from skeleton to dungeon, in order

The [checklist](port-checklist.md) is the inventory and the
[completion plan](completion-plan.md) is the route to cutover. **This page is
the queue**: the ordered list of what gets built next, why it is in that
position, and what each item puts on the screen.

It exists because of one report, on 2026-08-11, looking at a real generated
floor in the Windows build:

> it attempts to render the maze but it's missing the textures/boosters, it's
> just the skeleton

That is exactly right, and it is two different absences that look like one:

- **No textures** — the RENDERER draws untextured grey boxes.
  `maze/build.ts` (1,834 lines) makes every surface out of procedurally painted
  canvases, and none of that is ported.
- **No boosters, props, torches or items** — the floor has no CONTENT.
  `buildTrackFloor` authors a floor's SHAPE, and nine of its twenty-three
  passes have landed. Everything you stand on, shoot at or bounce off is
  authored afterwards by `decorateMaze` (3,169 lines), which is not started.

Neither is a defect. Both are unported files with a queue position.

## The two tracks, and why they are separate

**Track V (visual)** only reads the grid, so it can proceed at any time and its
gate is a screenshot A/B against the legacy game.

**Track C (content)** is strictly sequential and gated on bit-exact digests:
`decorateMaze` runs on a FINISHED floor, so porting it before passes 10-23 land
would decorate a floor the oracle never produced, and every fixture would
disagree for a reason that has nothing to do with `decorateMaze`.

They are independent. Track V is what makes the report above go away fastest;
Track C is what makes the floor a game.

---

## Track V — make it look like the game

### V1. Wall, floor and cap textures · `maze/build.ts:356-670`
The procedural canvases: `makeFloorTexture`, `makeWallTexture` (mossy / low /
cracked variants), `makeCapTexture`, and the `pixelTexture` / `normalTexture`
helpers plus the value-noise field they all sample. This is the single biggest
change in how the game looks, and `dungeon_render.rs` already sorts tiles into
the buckets that want them — the moss bucket exists today with a plain stone
material, precisely so this lands as a material swap and not a re-bucketing.

**Gate:** an A/B rig against the legacy dungeon at 1920×1080, the twin of
`scripts/pk-ab-tavern.mjs`. That rig does not exist and is the first thing this
item builds.

### V2. Torches, sconces and the light pool · `build.ts:1694-`
Sconce mesh + flame quad + a pooled `PointLight` per torch. Needs
`plan.torches`, which is Track C's output — so until C3 lands, V2 can only be
built against a hand-placed set. **Do V2 after C3, or accept a stub.**

### V3. Architecture, banners and the stairs marker · `build.ts:1521-1693`
The Castlevania pass: arches, banners (`makeBannerTexture`), and the stairs-down
marker that has to be findable from across a big maze. The stairs half is
blocked on pass 21 (Track C).

### V4. Shaped tiles at their real heights · `build.ts:958-1079`, `1382-1474`
Slant prisms and round shells currently draw FULL height and ignore the
knee-high rule; arc sweeps draw as boxes. The geometry functions are ported
approximations today and this is the item that makes them exact.

### V5. Cracked bands as removable meshes · `build.ts:1475-1520`
Each 2×2 secret band is its own mesh so smashing it can remove one. Needs
`T_CRACKED`, which no floor carries before `decorateMaze`.

### V6. The GUI into the pixel pass · `post/composite.wgsl` `@binding(7)`
The reserved slot, with the blend already written out in the shader. Today the
GUI composites OVER the present blit, so the menu does not wear the cel grade
the art does. The bindings must be added at explicit indices — `@binding(6)` is
reserved for the albedo MRT target and renumbering it is how the outline and
palette stubs stop being parity-exact.

---

## Track C — make it a floor

### C1. Maze passes 10-23 · ~4.3k lines
The remaining topology, in `PASS_ORDER`. Each is 10/10 corpus floors bit-exact
before the next starts; the method is fixed and documented in the plan file, and
every pass gets a sabotage sweep because a green boundary is not a green pass.

| Pass | Name | Legacy source |
|---|---|---|
| 10 | `publish-arcs` | `track-carve.ts` |
| 11, 12 | `orbit-island`, `arc-sweeps` | `arc-sweeps.ts` (694) + `flow-orient.ts` (252) |
| 13, 14 | `repair-2`, `endpoints-final` | `track-socket.ts` + orchestrator |
| 15 | `boss-chamber` (snapshot-rollback) | `track-floor.ts` |
| 16 | `artery-banks` | `artery-banks.ts` (501) |
| 17 | `reseal-chute` | `track-launch.ts` |
| 18 | `carve-doorways` | `doorways.ts` |
| 19 | `funnels-relays` | `doorway-funnels.ts` (687) + `relay-chambers.ts` (219) |
| 20 | `compact-fixed-point` | `arc-contract.ts` (538) |
| 21, 23 | `stairs`, `done` | orchestrator + validation |
| 22 | `arc-rails` | `arc-sweeps.ts` |

**Pass 10 is the first to write `grid.arcs`**, so it is also the first to make
the renderer's arc bucket non-empty — the real-floor test currently asserts that
bucket is EMPTY at P9, and that assertion flips here rather than being deleted.
**Pass 21 is the stairs**, which retires the provisional exit marker and the
banner's "provisional" word.

Two sabotage findings ride into this stage: `connect_all` carves nothing at
repair-1 and provably cannot, so the two sabotages that ride on it must be
**re-run at pass 13**, where fillets fill pockets with no degree constraint.

### C2. The `onPass` seam inside `decorateMaze` — THE GATE BEFORE THE CONTENT
The seam exists in `track-floor.ts` ONLY. All 23 green boundaries certify a
floor's shape and **nothing standing on it**. Before a line of `decorate.ts` is
ported: add the same thunked-`extra` probe at its natural section boundaries,
digest the `LevelPlan` fields each section owns (spawns / torches / items /
props / parts / rooms / secrets / circuits) plus cumulative rng draws, certify
the digests on their own vectors, export 10-floor fixtures, and sabotage-verify
both sides.

Skipping this is the single most expensive mistake available in this project:
5.4k lines would land with no oracle at all.

### C3. `decorateMaze` · 3,169 lines, in its own order
The sections, in the order the file runs them — each is a fixture boundary:

1. rooms (archetype content seeds the pools below)
2. zombie spawns — far floor tiles, spread, never near the start
3. **torches** — floor tiles with an adjacent solid wall, ≥4 apart → unblocks V2
4. items — the level's roll on quieter tiles
5. props — sparse scenery, clear of stairs and loot
6. **pinball parts** — classify every floor tile by topology, draw a mixed set
7. circuits — the floor's highway loops (`circuit.ts` 634, `flow-loops.ts` 371)
8. **the station spine** — the connected booster route, with its own budget
9. chains, then the sparse-region fill and its clutter ceiling
10. vault ramps, **booster tributaries**, rollover lane arrays
11. target bullseyes and the drop-target bank
12. dead-end economics, floor hazards (pit / electric / fire vent / magnet)
13. prefab anchors (`prefabs.ts` 702 + the `assembly*` family, ~2.4k)
14. launch break-throughs, polish, secrets

Items 6, 8 and 10 are the **boosters** in the report. They are four sections
deep in a file that has to land in order.

### C4. The rest of `authorFloor` · `spawn/floor-authoring.ts` (388)
`stampSecretBands`, `authorLampPuzzle` (106), `paintSurfaces` (291), and the
archetype config glue. Gate: an `AuthoredFloor`-level digest, 10/10 floors equal
end to end from seed to finished plan.

### C5. `createPinballParts` + `populateFloor` · `spawn/floor-populate.ts` (363), `factory.ts` (525)
The plan becomes live entities. **This is the item where a booster you can see
becomes a booster you can hit**, and it needs P1's remaining verbs (below).

### C6. P1 remainder — the verbs the sim already has and the shell never wired
`entities/{marble, pinball-collide, ricochet-*, rail, multiball}.ts` plus the
player's launch verbs. The sim core landed on 08-09; the game still only walks.

---

## Track T — the tavern

### T1. The economy tables · ~2.5k lines
`items.ts` (535: weapons, gear, potions, durability, rarity/slots),
`cards.ts` (885), `reagents.ts` (147), `recipes.ts` (86),
`armor-styles.ts` (127), and the price/stock constants at the head of
`economy/tavern-shop.ts`. Static tables and pure arithmetic — mechanical to
transcribe, and every one of them has a legacy test suite to port with it.

### T2. The run state the counters read and write
Gold (`utils/gold-wallet.ts` 155), belt, gear, weapon slots, sockets, reagents,
unlocked styles. pk-core has a `SimState` for physics and nothing for a RUN.

### T3. `economy/tavern-shop.ts` (453) — the rules
Offers, prices, and every vendor action, each of which mutates state and returns
a message or `null`. Four rules carry their own war stories and must keep their
comments: the two-step upgrade confirm, insurance saving the RAREST cards first,
the forge's Grim Bone gate, and the respec costing a rarity tier but never the
level.

### T4. The four counters · `gui/screens/tavern.ts` (607) + `gui/icons.ts` (546)
ALCHEMIST, CARD DEALER, WEAPONSMITH, ARMORER, in counter mode — the mode the
walkable hub uses, where "back" hands control to the caller because the room
behind is the real scene. The chrome is already ported and byte-exact; this is
the content inside it.

**Gate:** the golden-fixture route that already exists —
`legacy/scripts/bake-gui-fixtures.mjs` paints a scene with the REAL `im.ts` and
`crates/pk-gui/tests/legacy_fixtures.rs` repaints it, currently at 0 differing
bytes in 9.9M pixels. Every counter added here adds a scene to that bake.

### T5. The gambler cabinet
All four games are ported and tested in `pk_core::gambler`, RTP Monte-Carlos
included. Only the screen is missing.

---

## The order this actually gets done in

1. **C1** passes 10-23 — everything in Track C is behind it, and pass 10 and
   pass 21 each change what the renderer and the shell can claim.
2. **V1** textures — parallel, independent, and the largest visible change per
   line of work.
3. **C2** the decorate seam, then **C3** decorate — the boosters, in order.
4. **V2/V3/V4/V5** as their inputs land.
5. **C4/C5/C6** — the floor becomes playable.
6. **T1-T5** the tavern economy and its counters.
7. **V6** the GUI into the pixel pass; P5 menus; P8 sweep.

Track T can be pulled forward whenever the dungeon work is blocked on a gate
that has to be built first — it shares nothing with the maze.
