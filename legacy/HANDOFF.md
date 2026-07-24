# Handoff — braindeadbot-client / -service

_Replaced on each deploy. Not a log; if something here is done, delete it._

## 🧹 NEWEST (2026-07-23, wave 3): audit + cleanup sweep — both repos

Five-subsystem audit (core/UI, entities, maze, render, net+service) then a
cleanup pass. **891 client + 36 service tests green, tsc 0 in all kept-clean
trees, `next build` clean.** Everything below is unit/build-verified; none of it
was click-tested (nothing here changes feel — it's deletions, guards and three
real bug fixes).

**Real bugs fixed:**
- **Reaper King slam telegraph drew under the LOCAL player** (`boss.ts`): the
  slam commits to the nearest knight (`target`, possibly a pool-mate) but the
  warning ring used `p.x/p.z`. In co-op the host saw the ring under its own feet
  while the slam landed on the peer. Now uses `target`.
- **Mana Well never worked** — passive regen (`abilities.ts`) and the per-kill
  top-up (`combat.ts`) clamped to base `MANA_MAX`, so the skill's +15/+30 pool
  could never fill outside the `infMana` debug path. Both clamp to
  `playerManaMax()` now.
- **Boss bar said "☠ THE OVERLORD ☠"** (`ui.ts`) — user-visible leftover from
  the pre-Reaper-King boss. Now "THE REAPER KING".
- Dungeon-tree tsc regression fixed: `intro/index.ts` LevelPlan literal was
  missing the new `plazas` field.

**Multiplayer/net cleanup (protocol is now honest):**
- `src/net/protocol.ts` pruned to the messages the live hub actually speaks
  (hello/move/world/act/ping ⇆ welcome/room:*/player:*/world/act/pong). All
  party/solo/session/ready variants deleted; `src/net/session.ts` (dead party
  baton) deleted; `socket.ts` dead `onAny`/`onStatus` API removed. Header now
  names **`server/realtime.mjs` as canonical** (was pointing at the service).
- `RemoteKnight` gained `mode` and the hub's `view()` now sends it: a mid-scene
  joiner renders existing peers in their real pose (was: everyone idle until
  their next move). `ready:false` dropped from the wire.
- **Hub hardening** (`server/realtime.mjs`): `maxPayload` 64 KB (ws default is
  100 MB — one giant frame would have fanned out to 23 peers), overflow
  waiting-room capped at 32 (was unbounded), refusals close 1013.
- `coop.ts initCoop` is now idempotent (calls `endCoop` first) — a double init
  would have doubled world/act subscriptions and applied snapshots twice.
- Service repo: `src/realtime/` KEPT (it still attaches in server.ts and its
  tests cover it) but its protocol header now says clearly it's a DORMANT,
  drifted copy — the canonical lives in the client. Its hub also got the 64 KB
  `maxPayload`.

**Dead code deleted (client):**
- The whole retired **curve-court subsystem** (~150 lines): `stampCurveCourts`
  + `CurveCourt` + `LevelPlan.curveCourts` (decorate.ts), `buildCurveCourts` +
  `courtTiles` skip (build.ts), intro literal field. Curves are ROUND tile
  shapes now; the misleading "smooth half-cylinder shells" comments went too.
- The superseded **centred combo flash** (`flashBounceCombo`/`createComboFlash`/
  `COMBO_RANKS` in ui.ts + `state.comboFlashEl` + mount/dispose) — the element
  was built and torn down every run but never shown; `spawnFloatingCombo` is the
  live system.
- Unused exports: `getDiabloEl`/`getDiabloFaceFrame`, `getWolfEl` +
  write-only `state.hudEl`, `secrets.isBreakableWall`, `audio.isSfxMuted`,
  `tile-shape.roundOpenDir`, `settings-save.__resetSettingsCache`, dead imports
  (`KING_SPEED`, `BALL_RAM_KNOCKBACK`, `PINBALL_COMBO_WINDOW` + its `void`,
  `MANA_MAX` where superseded). decorate's `WEAPON_POOL` now aliases
  `items.PICKUP_WEAPONS` (was a drifted copy). Lifecycle `console.log`s removed
  from core.ts.
- Stale docs fixed: `modifiers.rollModifier` rng-draw contract, palette "only
  warm hues" claim, run-score's "core.ts is ~1900 lines".

**New guard:** `render/atlas-loader.ts` now REJECTS (falls back to procedural
painter, with a console.warn) an atlas whose cell height ≠ `SPRITE_PIXEL_GRID`
or whose strip exceeds the probed GPU `MAX_TEXTURE_SIZE` — closes the known
"silently paints nothing over 8192px" hazard at the loader instead of leaving
it to each caller.

**Known-open (deliberately NOT touched):**
- `pixel-pass.ts` render-target realloc thrash on slow window edge-drag (~every
  2px). Real but needs a feel-safe debounce; profile before fixing.
- Zombie aggro still only hunts the authority's knight; spitter projectiles not
  mirrored; authority menu-pause freezes replica floors (documented v1 gaps).
- `prefabs.fullyReachable` (test-only third flood-fill) and the PX_LABEL/WOLF
  font-stack near-duplicates: judged not worth the churn.

## Prior (2026-07-23, wave 2): FX wave made LEGIBLE + movement feel — screenshot-verified

Wave 1 shipped the mechanics but the visuals didn't land in a real playtest
("same hit every time / red circle / orange things / never saw slick field").
Wave 2 fixed every one and was **verified with headless playwright+swiftshader
screenshots** (recipe below). Plan doc: `src/scenes/dungeon/ABILITY_FX_PLAN.md`.

- **Red-circle root cause**: the pulse chaser was 0x8800ff purple — OFF-PALETTE,
  so the composite quantizer snapped it to blood red. Rule: **VFX colours must
  be palette-native** (render/palette.ts) or they become a different colour.
  Rings/bursts now use arcane blues; the white core blooms as intended.
- **Combo legibility**: light-1 classic cut → light-2 crossed X (orange+white
  mirrored) → finisher big white draw-cut + echo + blur ON THE SWING (connect
  still adds flash/triple-cut/victim ghosts). Chain shortens + clip rate ramps
  per step, small forward lunge per swing, finisher RESETS to step 0.
- **Fire/oil floorFx have painted canvas textures** (floor-fx.ts
  paintKindTexture): fire = white-hot core/ragged edge/additive + per-frame
  ember stream (was 1 ember/0.5s — the "orange things"); oil = dark pool with
  bright iridescent rim. Both read from across the room.
- **Slick Field is default-unlocked** (arcana node removed — nobody found it).
- **Movement feel**: sprint spool 3s→1.5s + base 1.35 (Shift kicks now); corner
  bounce gains softened (rest 1.08 / add 1.0 / ceiling K 0.15); **pocket-rattle
  guard** (player.ts notePocketBounce + POCKET_* constants) bleeds momentum when
  5+ bounces cluster inside one 1.4u circle — no more stuck-in-a-gap ricochets
  (QA: rides now settle instead of climbing 14→22 u/s forever).
- **Floor 1 variety**: spiders/hounds/goblins/bowling pins spawn from level 1.
- **Curves**: corner reshape mix now 75% quarter-rounds (live since 07-21 at
  50/50 — the engine does REAL arc collision; not a boxes limitation).

**Headless visual QA recipe (WORKS — use before shipping FX):** dev server
:5174 → `/dungeon?no-intro=1` → wait `__tavernProbe`, waypoint-walk around the
centre table to (0,-5.3), press `e` → dungeon. Knight starts PARKED IN THE
PLUNGER (movement+attacks dead until SPACE pull-release launches). ` panel:
GOD MODE/INF MANA/NO COOLDOWN + spawn chips (`[title=zombie]`). Hooks:
`__dungeonWarp(x,z)` zeroes momentum (melee is LOCKED OUT while riding — warp
≥3u from every `__dungeonParts()` entry or bumpers re-grab instantly),
`__dungeonAbility(slot,id)`, `__dungeonStats().floorFx`. Script: session
scratchpad qa.mjs pattern; playwright import from lupos-bot node_modules.

**Live:** client + service carry **Pinball-Knight multiplayer as a DROP-IN POOL**
— no lobby/ready/party. Everyone on the site auto-joins ONE shared world (shared
server seed → identical maze/enemy/boss), sees each other in the tavern hub AND
on their dungeon floor, and pops in/out freely. The boss floor is the **REAPER
KING** whose death opens the exit portal. Additive; solo/offline is the same
single-player game. Prior work (materials, armor, shaped walls, 4× floors, combo
ramp, casino) all live/untouched.

## ✅ CONNECTIVITY — SOLVED: the hub lives IN the game server (READ FIRST)

**The multiplayer pool hub now runs IN-PROCESS in the client's own production
server** — `server.mjs` + `server/realtime.mjs` (`npm start` = `node server.mjs`,
which serves Next AND hosts `/ws`). The browser always connects SAME-ORIGIN
(`src/net/socket.ts realtimeUrl()`): `wss://braindeadbot.com/ws` publicly,
`ws://10.0.0.16:5174/ws` on the LAN — **one pool for everyone, no edge changes,
no service networking.**

Why the previous approaches died, so nobody retries them:
- Edge route `/ws → :5175`: correct but lives in deploy-kit = **read-only**.
- Client-server TCP tunnel → service: the service binds `10.0.0.16:5175`
  (LAN-only) and sits on a different docker network — **unreachable from inside
  the client container** (502 / socket hang-up).
The pool is pure in-memory state (roster/seed/poses, no DB), so in-process is the
right home. `braindeadbot-service/src/realtime/` still exists but is **UNUSED**
(its REST scores/youtube routes are unaffected). Keep the wire protocol in
lockstep: `server/realtime.mjs` ⇔ `src/net/protocol.ts`.

**🪤 THE TRAP THAT ATE A DAY — Next kills foreign websockets LAZILY.** Next 16
embedded as a custom server attaches its own socket management on the FIRST HTTP
request it serves, and from then on destroys every upgraded socket it doesn't
recognize (~10ms after the 101, close 1006, NOTHING logged). The container's
healthcheck hits `/` seconds after boot → /ws was always dead in prod, while
every local "ws first, http later" test passed. A plain `server.on("upgrade")`
listener CANNOT fix it (Next's late listener still runs after yours). The fix in
`server/realtime.mjs`: `WebSocketServer({noServer})` + wrap `server.emit` so
`/ws` upgrades are handled directly and never dispatched to other listeners.
If /ws ever regresses to instant-1006: check that emit wrapper first, and test
the "http request FIRST, then ws" order — it's the only order production sees.

**VERIFIED LIVE (2026-07-22):** two ws clients via `wss://braindeadbot.com/ws` —
same pool seed, join fan-out, scene-tagged moves, both directions.

Dev note: `next dev` has no custom server → no `/ws` → game runs solo. To test
multiplayer locally: `npm run build && npm start`, two tabs on localhost:5174.

## 🕸️ MULTIPLAYER — the drop-in pool (SHIPPED)

**User goal:** land in the tavern, others on the site join in real time, party
drops into the shared dungeon, run ends on a **boss that gates the exit portal**
(the boss = the Reaper "with multiple skulls + a tentacle slam").
**Model:** raw `ws`, ONE global drop-in pool. No lobby/ready/party — connecting is
joining. Pose-synced + shared-seed (each client sims its own world off one seed);
enemy authority is the documented next step.

### The pool (presence + shared world)
**Service** `src/realtime/` on `:5175` at `/ws`: `protocol.ts` (canonical) ·
`lobby.ts` (now a POOL: everyone auto-joins one room ≤ `POOL_MAX` 24, color slots
repeat past 8, **persistent `poolSeed` handed out in `welcome`**, regenerated when
the pool empties; `move` carries a `scene` tag) · `hub.ts` (origin gate,
heartbeat, flood guard). (`session.ts` party-relay code remains but is DORMANT —
the pool doesn't use ready/party/countdown.)
**Client** `src/net/`: `socket.ts` (`NetClient` + captured `seed`; `realtimeUrl()`
= baked private backend on a LAN page, else SAME-ORIGIN `/ws` — see connectivity
note) · `presence.ts` (**the one persistent roster**: id→slot/name/scene/pose,
installs subs once, survives tavern↔dungeon; `sendPose`/`setLocalScene`/`peers()`/
`poolSeed()`) · `protocol.ts` (**MIRROR**). Renderer: `dungeon/render/remote-party.ts`
`RemotePartyRenderer.sync(peers, dt)` — scene-filtered tinted knights + nameplates
+ interpolation, shared by both scenes.
- **Tavern hub** (`tavern/multiplayer.ts`, `lobby:true` entry): renders `scene==="tavern"`
  peers, shows an "N ONLINE / OFFLINE" pill (`ui.ts createLobbyHud`). Descend is
  IMMEDIATE (no ready gate). Between-floor taverns stay a solo shop.
- **Dungeon** (`dungeon/coop.ts`): renders `scene==="dungeon:<floor>"` peers;
  `startLevel` adopts `coopSeed()` into `state.runSeed` (identical floors) and
  tags the floor via `setCoopFloor`. `exitDungeonGame`→`stopPresence()` closes the
  socket.

### The Reaper King boss
- **`scenes/dungeon/boss.ts` — the REAPER KING.** A killable `brute` in reaper
  art (real `reaper` kind is combat-immune), scaled up, with an ORBITING SKULL
  ring (skulls also fling bone projectiles) and a telegraphed TENTACLE SLAM
  (growing ring → AoE damage + pinball-launch). Spawns on `level % BOSS_EVERY===0`
  (floor 5, 10, …) replacing the old OVERLORD; `state.exitLocked` seals the stairs
  until it dies, then the **PORTAL blooms over the stairs** and the stairs descend
  as normal. All procedural meshes (no art pipeline). Tuning constants at the top
  of boss.ts.
- Tests: `boss.test.ts` (spawn→locked, death→portal→unlocked, headless) +
  36 service + 699 client, `tsc`+`next build` clean. Live in-process 2-client pool
  test confirmed shared seed + scene-tagged move fan-out.

**Verified:** solo path (boss fully works solo) + server-side pool presence
(2 real clients see each other in prod). **NOT 2-browser client-tested** (no such
env) — sprite tint, nameplates, and same-floor rendering need QA with two LAN
browsers on `http://10.0.0.16:5174`. **Test the boss fast:** in the dungeon, `
panel → "next boss" (jumps to floor 5), or `__dungeonLevel(5)`.

### ✅ ENEMY/BOSS/LOOT SYNC — SHIPPED (per-floor authority)

Each dungeon floor elects ONE simulator: **authority = smallest peer id on the
floor** (deterministic, no negotiation; recomputed every frame from presence, so
join/leave hands over seamlessly). The authority runs the normal sim and streams
a 10Hz `world` snapshot (zombies by `nid`: kind/pos/hp/mode/boss · nid'd ground
items · boss aux: bones/slam/portal · exit lock); the server relays `world`/`act`
to SAME-SCENE peers only.

- **Replicas** (`coop.ts`): suppress `updateZombies`/`spawnReaper`/boss AI;
  reconcile `state.zombies`+`state.groundItems` against snapshots by `nid`
  (same objects, positions lerped). nids are minted by `makeZombie` in creation
  order — seed-deterministic at startLevel, so both clients hand out the SAME
  ids and adoption is seamless (no respawn flicker).
- **Shared HP**: replica hits compute damage locally (attacker's momentum gates)
  then forward via `act:dmg` (`combat.ts` coop bridge, injected — no cycles);
  authority applies with force (reaper stays immune). Deaths broadcast `act:kill`
  → gibs + shared kill gold on every screen (co-op pays every knight fully).
- **Shared loot**: `removeGroundItem` is the take-funnel → `act:take` removes the
  item on every screen. Authority drops (cards/potions/materials/boss reward)
  carry `nid`s; coins/reagent motes stay personal.
- **Boss synced**: aux snapshot mirrors bones/slam-telegraph/portal on replicas
  (`boss.ts applyRemoteBossAux`/`updateBossReplica`); slam + bone damage applied
  by EACH client vs its own knight (player HP is client-owned); slams/bones
  target the NEAREST knight incl. peers (`nearestKnight`). Handover: promotion
  `adoptBoss`es a living king; demotion `disposeBoss`es the frozen module.
- **Animation fix**: poses carry the CURRENT CLIP (`p.anim.getClip()`);
  remotes mirror ball/roll/attack/run instead of deriving walk from velocity —
  a bouncing marble no longer renders as "running back and forth".
- **Marble-vs-marble**: knights collide (`coop.playerCollisions`) — rolling
  reflects off a peer, a standing knight hit by a rolling marble gets launched.
  Each client resolves only its own knight.
- **Teammates on the map** (`map-render.ts`): same-floor pool-mates draw on the
  HUD minimap AND the M map in their knight colors, through fog (a teammate is
  not a spoiler); off-window mates get a border chevron in their color.

**Known v1 gaps (deliberate):** zombie AI still *chases* only the authority's
knight (replicas take contact damage when overlapped, but aggro won't hunt them
— needs a target abstraction in zombie.ts); enemy PROJECTILES (spitters) aren't
mirrored to replicas; authority opening a menu pauses its sim → floor freezes
for replicas; two players grabbing one item in the same tick can double it.

**Keep in lockstep:** `service/src/realtime/protocol.ts` ⇔ `client/src/net/protocol.ts`.

## Prior — Shadow + Lava: the material set is COMPLETE (`c8465a3`, `1201c1a`)

All six brainstorm materials now live: 💎diamond 💧water 🪨stone ⚡storm 🌑shadow 🔥lava.

🌑 **Shadow (`c8465a3`)** — evasion/control:
- collider shrinks 0.3→0.21 (`materialPlayerR` at the ride sweep) = slips gaps;
  flat restitution 1.05 (slowly accelerates); bumper scatter ×2.
- On bounce: a SHADOW-CLONE decoy — nearby foes chase it via a new per-enemy
  lure (`zombie lureT/lureX/lureZ` overrides the flow-field target, same shape
  as slick `slipT`).
- On slam: VOID IMPLOSION — yanks foes inward (moveCircle, no wall-clip) + dmg.

🔥 **Lava (`1201c1a`)** — terrain scorcher, reuses the existing `fire` floor-fx:
- explosive bumper kicks (materialBumperMult 1.6, foil to stone's 0.15).
- On bounce: deposits a burning puddle (fire floor-fx = burn DoT); chain
  bounces leave a trail of flame.
- On slam: ERUPTION — a ring of fire puddles.
- Terrain: Lava × oil → VAPORIZE (`lavaVaporizesOil` in the oil handler).
- Self-harm on your own fire behind the existing SELF-HARM toggle.

Adding a material touches ~9 seams (union, MATERIALS meta, MATERIAL_LIST,
isMaterial, MATERIAL_DURATION, ITEM_PAINTS gem, debug chip, ui + hud-diablo
chips, idle sparkle). Per-material tests: marble-storm/shadow/lava.test.ts.
432 dungeon tests green. NOT click-tested.

## Prior — Storm, the 4th marble material (`9bb89a2`)

⚡ Storm joins diamond/water/stone (`entities/marble.ts`):
- **Physics:** lane-centring pull ×2 (`materialLanePull` → the lane-glide nudge)
  = rails corridors with inhuman precision; sharper steer ×1.45.
- **On bounce:** a sideways LIGHTNING ARC perpendicular to travel (`stormArc`,
  CARD_BOLT-style damage lane + `vfx.bolt`).
- **On slam:** THUNDERCLAP (`thunderclap`) — a ring that damages AND STUNS,
  freezing foes in place by reusing the water-slick `slipT` with zero drift.
- **Synergy:** Storm × water-slick → ELECTRIFIED FLOOR (`stormElectrifyWet`) — a
  storm bounce discharges into every foe on any slick tile (the fusion-window
  Tesla-coil payoff: grab water then storm inside the 2s window).

Added to every material seam: `MarbleMaterial` union, MATERIALS meta +
MATERIAL_LIST + isMaterial + MATERIAL_DURATION, ITEM_PAINTS gem sprite, ` panel
chip, both HUD chips (ui + hud-diablo), idle sparkle. Drops + floor-1 seeding
pick it up automatically off MATERIAL_LIST. `marble-storm.test.ts` pins
lane-pull / steer / thunderclap-stun. 424 dungeon tests green. NOT click-tested.

## Prior — material × terrain reactions (`491384b`)

The brainstorm's deferred terrain layer, wired to the 3 live materials. Each is
a helper in `entities/marble.ts` (gated by `reactingAs()` = materials on +
`state.dbgMaterialTerrain` + right material), called from the REAL hazard
handlers so it composes with the existing part logic:

- 💧 **Water × magstrip → STEAM ERUPTION** (`tryWaterSteam`, magstrip handler):
  the anti-speed trap flash-boils — instead of the crawl-clamp you erupt: a
  scalding radial burst (dmg + knockback) and a launch to `WATER_STEAM_LAUNCH`.
- 🪨 **Stone × magstrip → PLOW** (`stoneMagstripCap`): the field can't grip a
  boulder — clamp rises to 13 u/s (vs 3.2).
- 🪨 **Stone × oil → GRIP** (`stoneIgnoresOil`, oil handler early-return): no
  hydroplane.
- 🪨 **Stone × pit → BRIDGE** (`stoneBridgesPit`, pit handler): too heavy to be
  swallowed while rolling; plows across with a dust plume.
- 💧 **Water × firevent → STEAM** (`waterQuenchesFire`, hazards firevent): the
  jet flash-boils harmlessly, no burn.
- 💎 **Diamond × electric → DISCHARGE** (`tryDiamondDischarge`, hazards
  electric): eats the shock, zaps nearby foes instead.

Flip the whole layer with the ` panel **TERRAIN RX** toggle. New constants in
the MATERIAL × TERRAIN block. `marble-terrain.test.ts` pins gating + launch
contract (damageZombie propagation is its own tested path — needs a real grid).
420 dungeon tests green. NOT click-tested. Reachability caveat: magstrip/oil/
pit/electric/firevent are depth-gated + RNG-placed parts, so a floor may not
have every hazard — use the ` panel to spawn a material and hunt a strip.

## Prior — stairs beacon reads as the exit (`1df5f6d`)

Playtest report: the tall arcane beam over the stairs pocket read as "???" —
its base (pit + pylons) hides behind wall rims, and iso projection puts the
beam's pixels over tiles NORTH of the trigger tile, so "walking over it" did
nothing. Now: the beam breathes (opacity pulse + slow twist, animated via
`MazeHandle.stairsBeam` next to the torch flames), rising arcane sparks climb
it within ~20 tiles, and a one-shot per-floor hint fires when it first comes
into view ("⬇ THE BLUE BEACON — the stairs down; step into its base",
`state.stairsHintShown`, crackHint pattern).

## Prior — marble VFX polish + loot spread + route geometry (`d73c5aa`)

Audit-then-implement wave on three complaints: transformations looked flat,
loot clustered, and some floors were a straight sparse line to the stairs.

- **`vfx.burst(x,y,z,color,count,speed)`** — new tinted additive radial
  primitive (render/vfx.ts). ~35% white-hot cores push it over the 0.7 bloom
  threshold, so bursts glow; every other primitive has hardcoded colours.
- **Transformation moment** (`entities/marble.ts applyMaterial`): tint + trail
  double burst, 3 stacked afterimages, shake/hitstop, per-material sting
  (diamond `sfxFreeze`, water `sfxSpring`, stone `sfxHeavy`). Fusion fires the
  outgoing material's burst too. MATERIALS meta grew `trail` + `sfx` fields —
  trail hues are DISTINCT from potion tells (diamond can't be `0x6fd0e8`,
  that's HASTE).
- **Material trails** (player.ts `updateBuffTells`): trail ghost each tell tick
  (+ fusing material's), plus an idle sparkle cadence (diamond glints, water
  drips, stone crumbles). Runs during the pinball ride (called before the ride
  branch).
- **Floor-fx animation** (entities/floor-fx.ts): grow-in pop with overshoot,
  breathing pulse, slick slowly spins, fire breathes embers / slick sheds motes
  on tick, shrink+fade on the back third.
- **Loot spread** (maze/decorate.ts): items now bin into FOUR distance-from-
  start rings and round-robin them (paces loot across the whole trek);
  off-spine tiles first (loot rewards leaving the artery); pairwise separation
  scales with the trek (`max(5, 12% of maxDist)`, relax floor 5 — the
  Manhattan-5 test invariant holds). Floor-1 marbles fan out at rings 4/7/10
  via `nearestOpenTile` `minRing` (its `n` is an ORDINAL — that was the
  stacked-on-spawn bug).
- **Winding exits** (decorate.ts `pickEndpoints`): samples 6 far-band
  candidates and keeps the lowest `directness − bendRate` (directness =
  euclid/pathLen; 1.0 = straight shot). Kills the "straight line to the exit"
  floors; far-band ≥0.82 and quadrant variety survive. Measured: old mean
  directness 0.630 → 0.575, and the ~1.0 tail is gone.
- **Density** (core.ts + decorate.ts): part budget now adds
  `floorTiles/2000` (the 4× floors change had left `PARTS_MAX=26` absolute
  over ~26k late tiles), and a **sparse-region fill** drops one omni part
  (bumper, spinpad every 3rd) into every ~24-tile coarse region that has
  junction candidates but no machine — junction-topology only, so the
  runway/orphan and topology tests all hold. `LevelConfig` now exposes
  `floorTiles`.
- **`maze/route-metrics.test.ts`** pins all of it: worst directness < 0.82
  across 24 seeds, ≥1 bend per 12 tiles, no big region without a part.
  414 dungeon tests green.

NOT click-tested — build + unit only. QA loop: floor 1, grab a marble (they're
now 4/7/10 tiles out from spawn), watch the recrystallize burst + trail; `` ` ``
panel MARBLE chips for the rest.

## Prior — crisp knight in the intro run phase (`ba9b484`)

The intro's running knight looked muddy (fat pixels beside thin ones): he was
drawn 1.4× onto the 480px background canvas, which is THEN CSS-upscaled ~3.3× to
screen — two fractional resamples, uneven pixel grid. Now he rides his OWN
display-resolution overlay canvas (`kc`, z 9001, 1:1 with screen, no CSS
upscale) drawn at the nearest INTEGER multiple of the 72px sprite grid (`KS`,
~5×) at integer position → one art pixel = KS whole pixels. Background stays on
the low-res canvas (solid shapes don't care). Contact shadow moved onto the same
overlay; overlay retires in `beginShatter` (he's the 3D ball then) + teardown.
Verified headless: uniform pixel grid + full run→bonk→shatter→sweep, zero
errors, no leftover overlay at the shatter. **This is the reusable fix for any
"blurry 2D sprite" here: a bitmap needs an INTEGER final scale; put it on its
own display-res canvas rather than through a fractional CSS upscale.**

## Prior — deflectors GRAB & THROW the knight (`7598968`)

A deflector used to smoothly bank your momentum around a corner. Now it CATCHES
the knight — snaps him onto the rail, holds a `DEFLECTOR_GRAB_TIME` (0.13s)
wind-up beat (hitstop + thunk + gathering sparks), then HURLS him along the
exit leg at a real launch speed (`DEFLECTOR_THROW_SPEED` 19 u/s floor,
`×DEFLECTOR_THROW_BOOST` 1.18 on a fast entry, clamped to PINBALL_MAX_SPEED).
Reads as a slingshot, not a curve.

- The catch is armed in `pinball-collide.ts deflector` (keeps the leg-choice +
  cornering guards; sets player `grabT/grabX/grabZ/throwDir*/throwSpeed`; guards
  re-grab while held). The HOLD+release lives in a block at the TOP of
  `updatePinball` (player.ts) — it OWNS the player while grabbed (pinned,
  i-frames up, no steer/collision/friction), fires the throw on release, and is
  cleared on ride-exit so a grab can never hang. `grabT` is on the
  `__dungeonPlayer` dev probe.

Verified: 850 tests green (deflector unit test rewritten to the grab-throw
contract + a no-re-grab test), build + dungeon tsc clean, headless ride caught
at 22 u/s → thrown at the 19 floor, zero console errors. Knobs
(GRAB_TIME/THROW_SPEED/THROW_BOOST) at the top of constants.ts; NOT feel-judged
on a real monitor.

## Prior — progressive combo ramp (`5f9fbfe`)

The pinball combo was a LINEAR chain (each bounce +1 combo, +1 gold, speed
climbing straight into the 22 u/s cap). Reworked into a CONCAVE ramp across six
levers, all pure functions in **`entities/combo-curve.ts`** (10 tests) read by
player.ts / combat.ts / core.ts:

- **Part 1** log speed ceiling on WALL/CORNER **gains only** — `comboSpeedCeil`.
  Corrected from the source plan, which would have clamped the plunger (13 at
  combo 0) and springs (16) down to 8: the ceiling caps what BOUNCING earns and
  never drags you below a speed a PART already gave you.
- **Part 3** corner restitution + flat kick taper toward speed-neutral with
  depth (`comboCornerRestitution`/`comboCornerAdd`) — speed from the LINE, not a
  pop. Parts 1+3 both flatten the approach to the cap; they're tuned together.
- **Part 4** the combo window shrinks 2.2s→0.9s (`comboWindow`), replacing the
  flat `PINBALL_COMBO_WINDOW` at **all 6 bounce sites** (player, pinball-collide,
  zombie, hazards). The tension mechanic — a second of open floor drops a deep
  chain, which kills the ping-pong ceiling.
- **Part 5** gentle global combo friction (`1+0.015√n`, +15% at 100×) nudges
  deep chains onto the tight route. Kept as a FEEL lever, NOT the plan's stated
  perf fix — see the diagnosis note below.
- **Part 6** tiered gold (`comboKillGold` = +3g per DOUBLING: 2/5/8/11/14/17/20)
  replaces the flat +1/step capped at 12, in combat.ts; floored to whole coins.
- **Part 2** tempo zones Launch→Cruise(≥8)→Frenzy(≥30) (`comboZone`): Cruise
  arms ball form + gold aura + toast; Frenzy pushes ball speed 1.35→1.6, pulls
  the vignette 0.32→0.48 and adds a pulsing chromatic aberration. The FX are a
  **new `uAberration` uniform + `setFrenzyFx(intensity)` on the pixel pass**,
  driven per rendered frame from core's existing combo hook via
  `frenzyIntensity(combo)`. `state.comboZone` tracks the act; signals fire on
  upward crossings only.

**⚠️ The source plan's PERFORMANCE DIAGNOSIS was false and it's worth knowing.**
It claimed 100× combo lags because collision "sub-steps every tick cause
geometry thrash." But `moveCircle` only sub-steps above `MAX_STEP` = 0.4/tick,
and at the 22 u/s cap the ball moves `22/60 = 0.367` — **exactly one collision
step per tick**, never more, and nothing scales cost with combo depth. There is
no combo-linked lag in the code. Part 5 was implemented as a route-bias feel
lever, not a perf fix. If real lag ever shows at high combo, profile it fresh —
it is NOT this.

All magnitudes (ceiling base 8 / Nsat 40, taper λ 0.08 / μ 0.06, window
2.2→0.9, friction k 0.015, gold tier +3, zone thresholds 8/30, frenzy vignette
0.48 / aberration 0.006 / ball 1.6) are **named constants at the top of
constants.ts** — they are play-test tuning knobs.

Verified: 849 tests green (10 new: concavity, monotonicity, economy bounds,
zone thresholds), build + dungeon tsc clean, and a headless playwright run that
fired the plunger and drove a REAL combo through Cruise (×9, HUD "BALL READY"
armed) into Frenzy (×34) — vignette visibly pulls the corners dark, style kills
bank gold (23 kills that run), sim stable, zero console errors. **NOT judged for
FEEL on a real monitor** — first manual QA: ride a long chain, judge whether the
window floor is too punishing and whether the ramp still feels urgent early.

## Prior — 4× floor area + ROUTE_MATH_PLAN v2 (`137f32c`)

Floors are 4× the area (2× per side): level 1 ~74×54 → **~150×106 tiles**,
deep caps ~134×102 → **~266×202 (~54k tiles)**. `levelConfig` cell formulas
doubled; budgets that ride `floorTiles` (zombies, torches, artery length →
spine parts, FAR_BAND stair distance) scale on their own; hand-tuned caps were
re-set: zombies 60→110, torches 40→80 (`TORCH_LIGHT_POOL` stays 6 — it's a
GPU budget), rooms 5+1.2l cap 14, secrets 4+1l cap 10, launchBreaks 8..16,
corridor `partBudget` 8→16 (decorate.ts), `FROG_TRAIL_TILES` 30→50. The floor
texture is a fixed 512px repeating tile, so no 8192px-texture-cap hazard.

**`src/scenes/dungeon/ROUTE_MATH_PLAN.md`** is the reworked route-geometry /
generation-math plan, corrected against the engine (Part 0 lists the five v1
assumptions the code contradicts — read that before implementing any of it).
Key additions: speed-interval propagation along the route DAG (§2b — booster
spacing from restitution math, cracked-wall punches speed-gated), tier-2
validation that replays routes through the REAL `moveCircle`, and the 4×
scaling table (§10). Build order in §11; step 1 (4×) is this commit.

**Perf watchlist for real-GPU QA** (headless can't measure frame rate): ~110
zombie sprites ≈ 110 draw calls; AI flow field is O(tiles) at up to 54k tiles;
`floor-pipeline.test.ts` runtime grew ~4× (suite still ~13s). If deep floors
chug: flow-field cadence → zombie cap → wall culling, in that order. Also NOT
judged headless: whether 4× floors FEEL right (walk time to stairs roughly
doubles; the spine + trapdoor rides matter much more now).

Verified: 839 tests green (floor-pipeline start→stairs solvability over 17
depths × 4 seeds at the new sizes), build clean, ASCII renders of levels 1/9
eyeballed (healthy corridor structure, no voids/hypostyle artifacts), headless
boot of a live 4× floor + full-map overlay with 110 zombies and zero console
errors.

## Prior — PINBALL KNIGHT title intro (`877c83c`)

`/dungeon` now opens on a title sequence instead of dropping straight into
floor 1: the knight sprints through a chirpy Mario-style 2D overworld
("WORLD 1-1", clouds, hills), headbutts a `?` brick (hitstop, DING, COIN x01),
and the whole 2D plane shatters into falling shards — revealing he was inside
the dungeon all along: a 3D letter maze whose WALLS spell `PINBALL / KNIGHT`,
with the knight in ball form ricocheting off the letterforms while the camera
tilts up from side-on (7°→38°) and pulls out to frame the title. PRESS ANY KEY.

- **`intro/title-grid.ts`** (pure, 6 tests incl. a 2-sim-minute soak) — 5-row
  wall-stroke letter font + sealed arena `Grid` fed to the REAL `buildMaze`;
  ricochet sim on the REAL `moveCircle` (slant-normal reflect else axis flip,
  constant energy, anti-wedge guards).
- **`intro/index.ts`** — phase machine (run/bonk/shatter/sweep/title) on its
  own RAF, registered on `state.animFrameId` so `exitDungeonGame` cancels it.
  The letter maze is parked on `state.maze` — `startLevel(1)`'s `disposeLevel`
  reclaims it, no special casing. Fog, camera zoom, sun shadow bounds, and HUD
  visibility are stashed and restored on teardown. Intro-only stage lights
  (the gameplay rig is a dim ambience + a player-following lamp — neither
  works for a title card). The stairs kit `buildMaze` always erects is hidden
  by proximity (its arcane beam pokes over the border wall).
- **Skips:** any key/click, SKIP button, `?no-intro=1`, `__skipDungeonIntro`,
  prefers-reduced-motion. It also auto-completes (~12s) with no input. QA
  probe: `window.__dungeonIntroPhase` (null once done).
- **Gotcha worth keeping: the knight atlas is ~8600px wide, over swiftshader's
  8192 GPU texture cap — canvas `drawImage` from it can silently paint
  NOTHING** (first frames drew the shadow but no knight; headless screenshot
  caught it). The 2D phase pre-extracts its ~12 frames via `getImageData`
  (CPU path, immune). Same family as the open `atlas-loader` size finding.
- **Headless QA scripts that launch `/dungeon` now cross the intro first** —
  append `?no-intro=1` (or set `__skipDungeonIntro`) before probing gameplay;
  under swiftshader the intro takes ~2min of wall clock to auto-complete.

Verified: 839 tests green, build + dungeon-tree tsc clean, playwright/
swiftshader run of all five phases with per-phase screenshots READ (that is
how the missing-knight and HUD-over-intro bugs were found), zero console
errors, and the game boots normally after the intro and with `?no-intro=1`.
NOT yet play-tested on a real GPU/monitor — first manual QA: watch the whole
thing once, judge pacing (RUN_DUR/SWEEP_DUR/TITLE_DUR at the top of
`intro/index.ts`), and confirm the bumper sting isn't too chatty.

## Prior — shaped walls: slants + CURVES on room/bend corners (`b2f4f21`+`b77ac83`)

The maze was locked to axis-aligned boxes at every layer, and the old "curve
court" faked curves with a `CylinderGeometry` shell painted OVER square colliders
— the floating green arc the user rightly hated (visual ≠ physical). Reinvented
so a tile can carry a SHAPE and ONE derivation feeds BOTH the wall mesh and the
collider.

- **`maze/tile-shape.ts`** (new, pure+tested) — `TileShape` (FULL + 4 SLANTs),
  `shapeTriangle`/`shapeNormal`, `resolveCircleTriangle`. THE single source of
  truth; extends to `ROUND` (arc) shapes next.
- **`generator.ts`** — `Grid.shapes` parallel `Uint8Array` (default FULL).
  Walkability unchanged → AI/flow-field/spawns untouched. All `Grid` literals
  (incl. test helpers) now pass `shapes`.
- **`collision.ts`** — the axis sweep uses `blocksSquare` (shaped tiles are
  TRANSPARENT to it, or the diagonal is never felt — the key correction); a
  corrective `resolveShaped` owns slant triangles and returns the contact
  normal; `moveCircle` sub-steps > 0.4/step and returns `hitN`; `circleCollides`
  is shape-aware (so `wallContact` normals stay right). FULL-only = identical
  (regression-tested).
- **`entities/player.ts`** — pinball ricochet reflects about the slant normal
  (`v−2(v·n)n`, flat restitution, `v·n<0` guard); takes precedence over the
  square axis-flip (the push-out also trips blockedX/Z).
- **`maze/build.ts`** — slant tiles render as triangular-prism instanced meshes
  (`slantPrismGeometry`, explicit per-face normals) from the SAME triangle the
  collider uses. `stampCurveCourts`/`buildCurveCourts` retired → green arc gone.
- **`maze/decorate.ts`** — `assignCornerShapes` bevels convex outer corners
  (two-pass, leak-safe: a slant only lands when both backing legs stay full
  squares, so 2×2 nubs stay square and no leg leaks).

Tests 829 green (tile-shape 9, collision slant 3, decorate authoring+leak-safety
1). Build + tsc clean. Headless (playwright+swiftshader): dungeon renders, **no
green arc**.

**Curves + concave shipped (`b77ac83`).** `tile-shape.ts` now has `ROUND_*`
(quarter-disc, radius 1) beside the slants, on the same pipeline —
`resolveCircleShape` dispatches slant→triangle, round→ARC (radial normal → a
real curved ricochet). `build.ts roundShellGeometry` renders a capless curved
shell sampled in the collider's frame (visual on the arc). `assignCornerShapes`
now also reshapes CONCAVE corners — the solid diagonal wall tile of an inner
crook, gated by `computeArcCorners`' ≥2×2-pocket rule so tight 1-wide turns stay
square ("rooms + wide bends only"); SLANT vs ROUND picked per-tile (mixed).
Headless confirms curved corner shells render, the ball rolls + combos, and the
green arc is gone. Config knobs: the slant/round mix hash and the convex/concave
gates in `assignCornerShapes`; tighten/loosen there.

Open follow-ups: (a) the mix is a positional hash — could theme by floor/room;
(b) ROUND shells are capless (DoubleSide) like the old court — add a quarter-disc
cap if a top seam shows; (c) enemies still path tile-centres (they don't ride the
curves — fine, they're not balls).

## Prior — elemental armor STYLE sets at the Armorer (`96b3a76`)

Ask: "more styles of knight armor — ice, wind, fire, thunder — priced high
vs gold/monster so they're not easy to get." Four purchasable plate SKINS
beside the free iron default, sold at the Tavern Armorer.

- **`armor-styles.ts`** (new, pure + fail-soft persistence) — the four sets
  (ice/wind/fire/thunder) + iron. A style is a **permanent unlock**
  (localStorage `pinball-knight-armor-styles`, the `legacy.ts` pattern —
  survives death like wallet gold, NOT run-scoped). One worn at a time;
  `activeStyle()` / `unlockStyle()` (unlock+wear) / `setActiveStyle()` (wear
  an owned one, free). `activeStyle()` is fail-soft to iron if storage is
  blocked or corrupt (never paints a locked set).
- **Pricing is prestige-tier** (the "not easy" ask): ice/wind 600, fire 750,
  thunder 900 gold vs `GOLD_PER_KILL=2` → **300–450 plain kills each**,
  several runs of banked gold. `armor-styles.test.ts` PINS `price/GOLD_PER_KILL
  ≥ 250` so a future GOLD_PER_KILL bump can't quietly make them cheap.
- **Modest mechanical edge, look is the product:** while an elemental set is
  worn the Armorer's plate is finer steel — helmet +2 / armor +3 soak on buy
  (`styleGearGrant`). Boots stay the `1` sentinel. Floor-found plate is
  unaffected — the style is a skin over whatever you wear.
- **`render/knight-look.ts`** — style now rides `KnightLook.style` AND the
  sheet cache key: `lookKey` went `"weapon|HAB"` → **`"weapon|HAB|style"`**
  (absent = iron, so old keys don't collide). `lookFromGear(gear, style?)`
  reads `activeStyle()` by default. Because the key changed, wearing a set
  re-dresses EVERY consumer (dungeon, walkable tavern, multiball echoes,
  paperdolls) through the exact per-frame key checks gear swaps already use —
  no new hooks. Tavern knight re-dresses on counter close via the existing
  `refreshTavernPlayerArt` string-key compare.
- **`render/cel-painter.ts`** — `STYLE_PAINTS` maps each set to REAL Cold-Crypt
  palette ramps (ice→arcane 29/30/31, wind→rot-green 7/8/9, fire→torch
  14/15/16, thunder→**storm-slate 2/3/4** + lightning-gold plume/trim/spark).
  Ramp swaps ONLY — silhouette grammar untouched, same rule as gear presence.
  `knightHelm` takes the `StylePaint` so the crest plume + visor eye-spark
  recolour per set too.
- **`tavern.ts armorBody`** — a "STYLES OF THE FORGE" section under the plate
  list: Buy set / Wear / WORN, with the MIRROR hover-previewing the FULL set
  in that style (`data-prevstyle`), and the plate-grant reflecting the worn
  style's finer-steel bonus. Buying a set unlocks+wears it AND grants full
  plate in that set's steel.

**Verified:** 10 new/updated unit tests (`armor-styles.test.ts`,
`knight-look.test.ts`) + a throwaway **headless render check** (node-canvas
shim → real `renderKnightPortrait` → crush pipeline) confirming all 5 styles
produce distinct dominant plate tones and each elemental set shifts >15% of
sprite pixels vs iron. **Thunder was retuned during that check:** it first
reused steel-mid and quantized to the SAME dominant tone as iron — moved to
stone 2/3/4 (dark storm-slate) so the black-and-gold reads clearly distinct.
Prod build clean; deploy test-gate green.

**⚠️ NOT click-tested in a live browser** (no playwright harness in env, per
the reagent/menu passes). First manual QA: Tavern → Armorer → hover each set
in the mirror (full-set preview), buy one → knight re-dresses on stepping
back into the room, walk into the dungeon and confirm the plate/plume/eye
recolour holds across facings and the multiball echoes match.

## Prior — Armorer MIRROR + game menu reachable from the tavern (`26a4f1f`)

Two asks: "see what the armor looks like ON the character at the Armorer", and
"how do I open the inventory/character menu" (answer: Esc/I — but it was
unreachable from the tavern, see below).

- **Armorer mirror** (`dungeon/tavern.ts armorBody` + `wireArmorerMirror`) —
  the Armorer counter now shows the knight paperdoll (`renderKnightPortrait`,
  whose header always said "the armorer counter, later") beside the plate list.
  Hovering a row repaints the doll with that piece forced ON
  (`lookFromGear(state.gear)` + slot override), caption flips to "wearing the
  Helmet" etc. Buying repaints via the normal `render()` pass. The wiring runs
  after EVERY armor-counter render because the counter is string-HTML — canvas
  and listeners are recreated each time, same reason `paintHoloCards` re-runs.
- **Game menu from the tavern** (`tavern/core.ts`) — the dungeon's Esc/I
  handler deliberately yields while the walkable tavern is open
  (`isTavernSceneOpen()` early-return in `core.handleKey`), so the Diablo-style
  menu was unreachable in the one room built for loadout fiddling. The tavern's
  own `onKey` now opens it on Esc/I (when no other panel is up), routes menu
  keys (Esc/I close, Tab/arrows cycle, 1-5 jump), and `panelOpen()` includes
  `isGameMenuOpen()` so movement freezes and the 3D pass skips.
- **z-index trap, caught headless:** `.gmenu` is 10004 in its stylesheet —
  chosen against the DUNGEON canvas. The tavern canvas sits at 10005, so the
  menu was in the DOM, keyboard-live, and 100% invisible. `openTavernMenu`
  lifts `state.menuEl` to 10008 inline. If the menu ever "doesn't open" in a
  new full-screen scene, check stacking before keys.
- **ABANDON from the tavern** — new optional `onAbandon` threaded
  `enterTavern → TavernOptions → tavern.onAbandon`; the menu's confirmed
  ABANDON closes the tavern scene first, then `exitDungeonGame()`. Both
  dungeon call sites pass it.
- **Frozen→free edge re-dresses the knight** (`wasFrozen` in the frame loop) —
  the menu can swap the active hand, and previously only the vendor-counter
  close path refreshed the sprite. Cheap: `refreshTavernPlayerArt` is a
  string-key compare.

**Verified headless** (playwright+swiftshader, dev :5174 AND live :5174 after
deploy): menu opens/closes over the room with tabs cycling; walked to the
armory via `__tavernProbe` navigation, E opens the counter, mirror canvas
paints (~10k px), and all three hover previews hash to distinct pixels
(helmet also adds the plume silhouette). Screenshots in session scratchpad.
NOTE: armor/boots previews are RAMP SWAPS (brightness, not silhouette) —
pixel-count metrics can't see them; hash pixel VALUES.

## Prior — Ragnarok-style reagent drops + Alchemist brewing (`9f442be`)

Kills now drop **themed alchemy reagents** and you **brew potions** from them at
the Tavern Alchemist — the RO model (a monster drops what it's "made of", you
combine loot + an Empty Bottle catalyst at an Alchemist per recipes).

- **`reagents.ts`** (new, pure+tested) — 14 themed reagents, each keyed to the
  enemy it comes from via `ENEMY_DROPS`, EXHAUSTIVE by `EnemyKind` (a new enemy
  is a compile error here). `rollReagentDrops(kind, {boss}, rand)` rolls each
  table entry independently (0–2 drops); a boss guarantees a Grim Bone.
- **`recipes.ts`** (new, pure+tested) — the brew book. Re-craftable classics +
  6 new craft-only brews. `canCraft(r, pouch, flasks, gold)` / `craftCost(r)`.
- **6 new powerups** (`items.ts` POTIONS + new `Player` timers): Regen Salve,
  Venom Coat, Stoneskin, Static Charge, Greed Draught, Elixir of Life. Each fires
  at ONE existing choke point — Venom/Static in `applyCardOnHit`, Stoneskin in
  `hitPlayer`/`hitPlayerRanged`, Greed in `killZombie`'s coin credit, Regen in
  the `core.ts` buff-tick loop, Elixir via `state.bonusMaxHp` → `playerMaxHp()`.
- **Drops as motes** — `dropReagentsMaybe`/`spawnReagentMote` in `core.ts` reuse
  the coin flight (`updateCoins` keys off `it.coin`, not kind); a new
  `kind:"reagent"` branch in `checkPickups` banks them on magnet arrival. Gem
  sprites via `gemItem()` in `cel-painter.ts`, tinted per reagent colour.
- **Empty Flask catalyst** — `state.flasks`, bought cheap (`PRICE_FLASK`) OR
  brewed from `Glass Shard ×3` (the `flask` recipe). Glass drops from golem/pin.
- **Alchemist UI** — `tavern.ts potionsBody` gained a **Buy/Brew** toggle: brew
  book with have/need ingredient badges + a pouch strip; brew routes the output
  onto the belt. Read-only pouch view added to the menu **Stats** tab.
- **Run-scoped** — `state.reagents`/`flasks`/`bonusMaxHp` reset in
  `beginRunProgression` + `resetState` (only wallet gold + legacy perks survive).

**Tests:** 806 green (23 new: `reagents.test.ts`, `recipes.test.ts`,
`entities/combat-brews.test.ts`). Build compiles; tsc clean on all touched files.

**⚠️ NOT click-tested in a live browser** — no playwright/swiftshader harness in
the build env, so the pure logic + on-hit wiring are unit-verified but the live
tavern brew clicks, gem-mote rendering, and each buff's in-game FEEL were not
driven. First manual QA pass: kill a slime/golem → see gem motes fly in + pouch
toast; open Tavern Alchemist → Brew tab → buy a flask, craft a flask from 3 Glass
Shards, brew Health + Stoneskin/Regen → confirm belt fill + HUD tiles + effects.

## Prior — booster STATION SPINE (path-first routing, `d93856c`)

The complaint: pinball parts read as isolated clusters — a booster lane that
shoved you into empty corridor, rooms stacked with pin grids and parallel
speedway lanes — instead of ONE route. Now every floor strings a **connected
booster route down the main start→stairs artery**, so getting pushed feeds
into the next thing. All in `maze/decorate.ts`:

- **`traceArtery()`** — the ordered start→stairs path, extracted from
  `widenArtery` (one source of truth; the artery is already carved + widened
  every floor by `widenMainArtery`, so the spine already exists in the map).
- **`layStationSpine()`** — walks that path and lays booster RUNS (stride 3-4,
  always down-flow into open floor) that feed into reactive STATIONS: a
  `deflector` banks each bend onto the next leg, a `bumper` caroms each open
  crossing. Every part is marked **`spine: true`** — a new flag on
  `PinballPartSpot`, exempt from the anti-clustering spacing (like `chain`) AND
  from the A1 runway repair (`openLaunchTargets`), because a pad feeding a bend
  is MEANT to have the turn a tile or two ahead. It is its own layer OFF the
  corridor budget (`corridorBudget` is measured after it), so the deal fills the
  pockets that branch off the spine.
- **Old standalone booster-lanes → TRIBUTARIES** that must merge onto the spine
  (a run only counts if an end touches the spine), never dead-end into blank
  corridor. `CHAINS_DEFAULT` 2→1 (the spine is the primary route now).
- **`furnishRooms`** leaves the spine lane CLEAR (`onSpine` predicate) so the
  route runs through a room — it becomes a station ON the path; speedway rooms
  collapse their 2-3 parallel lanes to ONE down-flow segment.
- **`stampCurveCourts`** reverts any arc that would wall a spine tile (a
  booster's forward tile is itself a spine tile — burying it fired boosts into
  rock; `onSpine` guard added alongside the connectivity revert).

Verified: 349 dungeon tests (incl. `decorate.test.ts` "STATION SPINE" over 45
seeds on the REAL pipeline — asserts a connected, down-flow route into open
floor, deflector legs walkable, spanning ≥25% of the floor), tsc 0 in
`src/scenes/dungeon`, `next build`, headless boot smoke 0 console errors
(plunger fires straight into the first spine booster run).

**The `spine` flag is the seam.** Anything that reasons about launch parts
(runway repair, spacing, budget) must decide whether it applies to spine parts
— they are deliberately clustered and deliberately short-runway. Tests that
assert the A1 invariant / spacing / budget all now skip `p.spine`.

**Next lever (deferred, taste):** bias `archetypeFor` toward the `spine`
archetype (or force a spine seed every floor) so the artery is a straight
boulevard rather than a winding widened corridor — pure "make the road
straighter". Routing along the existing artery already delivers the connected
path; see `PINBALL_KNIGHT_PLAN.md` §1.5.

- Client — http://10.0.0.16:5174 · Service — http://10.0.0.16:5175
- 349 dungeon tests green; repo tsc errors ~5970 (all pre-existing, in
  `src/objects` / `src/main.ts`), masked by `ignoreBuildErrors`.
- `src/scenes/dungeon`, `src/scenes/tavern`, `src/pixel`, `src/map`,
  `src/services` all typecheck at **0 errors**. Keep them there.

---

## What's live

**Pinball Knight (`/dungeon`)** — the game. Recent structural change: pinball
part collision moved to `entities/pinball-collide.ts` as an exhaustive
`Record<PinballPartKind, handler>`, so adding a part kind is a compile error
until it's handled.

### Level generation — FLOOR ARCHETYPES (new, `121a3eb`)

Floors used to be one object re-tinted: a uniform-density growing-tree maze with
rects sprinkled over it. Themes changed furniture, biomes changed colour, but
nothing changed SHAPE. Four layers now sit on top, all in `maze/`:

- **`archetypes.ts`** — Warrens / Spine / Great Hall / Cavern / Ring Keep.
  Each returns CELL SEEDS that `generateMaze` pre-carves and grows out of
  (`MazeOpts.seeds`). Cycles every 5 against the biome's 4 → the pair repeats
  every 20 floors, not 4. Announced on the descent card.
- **`prefabs.ts` LANDMARKS** — a 7-11 cell set-piece tier above the furniture
  stamps (Tilt Table, Pachinko Drop, Grinder, Observatory, Nest). Exactly one
  per floor via `stampLandmark`, placed FIRST with a wider mortar; regular
  stamps then fill in around it via `pickFocusCells` hot-zone clustering.
- **`modifiers.ts`** — Flooded / Blackout / Overcharged / Gilded / Collapsing,
  rolled from the floor's own seed (not a cycle) so two runs at the same depth
  differ. Budget multipliers ONLY — a modifier cannot touch connectivity.
- **braid gradient** — braid ramps down with distance from spawn, so a floor
  opens flankable and tightens toward the stairs.

**Exit placement.** `pickEndpoints(g, rng)` in `maze/decorate.ts` chooses START
and STAIRS ONCE per floor; `startLevel` passes the result to BOTH
`widenMainArtery` and `decorateMaze`. Do not let either derive its own again —
that was the old bug: each independently used "start = first floor tile from the
top-left, stairs = farthest tile from it", which pinned the exit to the
bottom-right corner on 57 of 60 level-1 runs, and if you fix only one side the
floor gets a widened launch highway leading somewhere that isn't the exit.
Start is drawn from one of the four corners; stairs from the top BFS-distance
band (`FAR_BAND` 0.82) rather than the strict argmax.

**Audio.** 28 procedural stings in `audio.ts`, all wired. Before adding a new
one, check it isn't already there — attack/roll/hit/death/hurt/pickup/coin/
break/stairs all existed and were live. `beep()`/`burst()` run their bodies
through `safely()`: the module's contract is that audio can NEVER break the
game, and guarding only `ctx()` was not enough (a context that resolves then
throws on `createOscillator` threw into the game loop). `audio.test.ts` pins
this with a hostile-context case.

**Invariants, and why they hold.** Every archetype is carve-only, so
connectivity can only increase; `stitchCells` (union-find in `generator.ts`)
welds any seed shape that came out in pieces, so a seed set need NOT be
connected. `maze/floor-pipeline.test.ts` mirrors `startLevel`'s exact build
order over 17 depths × 4 run seeds and asserts start→stairs solvability with no
stranded tiles — run it after touching any generation stage.

**Defaults are bit-identical.** Absent `seeds` and `braidGradient: 0` leave the
rng stream and output untouched, so existing floors do not reroll. There are
tests pinning this; don't let them rot.

**Gotchas found the hard way (all fixed, all have regression tests):**
- The shuffle bag held ORIENTATIONS, so no-repeat was per-VARIANT — a floor
  could land four rotations of the Switchback and read as the same room ×4. The
  bag holds SHAPES now; orientation is drawn after.
- Hot-zone bias scored candidates BEFORE testing mortar clash. Once stamps
  clustered, every later draw hit an occupied spot and failed, so only the
  smallest shape in the pool ever fit — and repeated. Clash test now happens
  inside the candidate loop. `FOCUS_TRIES` was measured, not guessed: 5
  collapsed clustering, 10 was break-even, it sits at 12.
- Welding adjacent seeds opens the walls between cells but LEAVES the even/even
  corner pillar standing, so the "Great Hall" was really a hypostyle hall — a
  2×2 column every four tiles after thickening. `MazeOpts.solidSeeds` knocks
  them out (as `carveRooms` has always done for its rects); it's on for
  greathall/cavern/ringkeep and a no-op for the 1-cell-wide Spine.

None of these three were caught by the invariant tests — they were all found by
RENDERING the floors to ASCII and looking at them. Do that when changing
generation; a floor can be perfectly solvable and still be bad.

**The Tavern (`src/scenes/tavern/`)** — a walkable isometric room between
floors, not a menu. Five stations plus a descend gate plus a casino corner. Five
keepers, each with its OWN paint and idle loop, room tone, hearth/forge VFX.
Socketed cards show as rune plates on the weapon in the armory vice.

**The Gambler** — a casino cabinet at the tavern station (2.2, 5.5). All four
games are now fully built, each with its own art + audio module:
- **Slots** — drawn cabinet, bezel chase bulbs, printed paytable, attract mode.
- **Roulette** — a real three-phase physics model (`roulette-physics.ts`):
  counter-rotating rotor vs stationary bowl, track departure at
  `w² <= (g/r)tan a`, deflector scatter, fret rattle. Cited to Small & Tse
  (arXiv:1204.6412) in the file header.
- **Darts** — a genuine two-stage aim-then-power throw (`darts-throw.ts`, pure
  and testable), real flight arc, darts that stick.
- **Blackjack** — hand-authored card art (3x5 rank bitmaps, true pip layouts,
  court figures), felt table, dealing animation, edge-on hole-card flip.

**Maps** — the site room map (`M` outside the dungeon) is pixel art; the dungeon
has fog of war, a HUD minimap, and a full floor map on `M`.

**Leaderboards** — `game_scores` table with a `game` discriminator. Pinball can
write scores; **it doesn't yet** (see below).

## HOW TO SEE THE TAVERN (do this before touching it)

The room was worked on BLIND for several passes and it showed. There is now a
harness; use it, and Read the PNGs.

```
npm run dev                                    # port 5174
python tavern.py <outdir>                      # scratchpad/tavern.py
```
It routes to `/dungeon`, calls the `window.__dungeonTavern()` dev hook, polls
for the canvas, and shoots at 1920x1080. `window.__tavernProbe()` returns the
player's `{x,z,facing,speed,focus}` when you need positional truth rather than
pixels — that is how the control fix was verified (world delta converted through
the game's own screen basis, all four keys correct).

Headless WebGL runs at 2-5fps under swiftshader, so POLL for state changes;
never `waitForTimeout` and assume. A full run is 3-6 minutes.

**Three bugs that had survived multiple code-reading passes and died instantly
to one screenshot:** the pinball table was landscape (a sofa footprint), its
rake was inverted relative to its own comment, and its gold marquee was
occluded by its own backglass so it had never rendered a single pixel. A fourth:
the room was dark because of FOG (18/42 against CAMERA_DIST 24 — the camera's
own target sat 25% faded), not the light rig everyone kept adjusting.

## This pass — an adversarial audit of the two passes below

Three reviewers were pointed at the previous two commits and told to find what
was BROKEN, not to summarise. They found ~30 issues including three in work I'd
just shipped. **The pattern worth keeping: every one of the worst findings sat
in a gap the tests did not reach, and several tests were green while the thing
they named was false.**

**A stake-eating P0.** `placeBet` spends gold the instant you press PLAY, and
every game calls `resolve()` from inside its own `render()`. Switching games or
hitting LEAVE mid-round disposed the game and stopped its loop, so `resolve()`
never fired — no payout, no round counted, no ledger entry, gold gone. Every
game was exposed; no test drove `dispose()` mid-round. Guarded at the buttons
AND settled as a forfeit in `closeGambler`, because `closeTavern()` calls that
directly and would have bypassed a button-only fix.

**`sprite-scale.test.ts` was green while its own invariant was violated.**
It asserts `SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID` — but screen pixels per
world unit is `PPU * camera.zoom`, and the test cannot see `zoom` or
`mesh.scale`. The tavern (0.78, easing to 0.92), the reaper (1.4), all six
enemy reskins and slime minis were never 1:1. **A test that pins constants in
isolation proves nothing about the runtime.** The tavern zoom is now static;
it is still not 1:1 on most windows and that is now written down.

**Coins weren't banked before the tavern** — every sweep site is a teardown and
the tavern isn't one, so uncollected kill gold was missing in the one place
gold is spendable.

**Three of my own changes were wrong**: `ICON_UPSCALE` made shop icons worse
(7.2× minification instead of 2.4×), `MAX_RENDER` at 1600×900 letterboxed 31%
of a 1080p screen, and a comment claimed `createStaticSprite` is what makes the
tavern keepers crisp when the tavern is the one scene where it can't be.

**Two performance findings that only measurement could surface:** coin sprites
were rebuilt per coin (~166k palette evaluations each, ~3.3M on a multi-kill),
and roulette baked nothing (6,276 `fillRect`/frame at 8.61ms, when only the
pocket ring rotates). Now cached / baked: 1,516/frame at 2.60ms, verified
pixel-identical against the old renderer across four wheel states.

**Still open from the audit** — see the numbered list below: `planSpin` blocks
~17ms mean / 66ms worst on PLAY; the burst integrator is dt-dependent (3
bounces at 144Hz vs 2 at 60Hz); `atlas-loader.ts` will silently reintroduce
non-integer minification the moment a forged 128px atlas lands; RT realloc
thrash on window drag; and the optimal darts aim is +203g/visit, not the
documented +172g, because the test measures `TREBLE_20` which no optimal player
would use.

## The pass before — tavern controls, coin drops, the casino

**The tavern's controls were rotated 90°.** `tavern/player.ts` hand-rolled the
screen→world rotation as `(a.x - a.z, a.x + a.z) * ISO` instead of calling the
shared `screenDirToWorld`. That expression is the correct basis turned exactly a
quarter turn: **W walked screen-RIGHT, A screen-UP, S screen-LEFT, D
screen-DOWN.** The dungeon was fine because it always called the shared helper —
the tavern held the only second copy of the maths, and a second copy is the only
reason the two could disagree. `movement.test.ts` pins each key back to the axis
it was pressed on. **Lesson: there is exactly one screen↔world basis in this
codebase and it lives in `dungeon/camera.ts`. Never write another.**

**Coin drops were already implemented, wired, and invisible.** `killZombie` →
`onCoinDrop` → `spawnCoin` all worked. The coin was alive for **118ms**: the
magnet was a per-FRAME fraction (`x += (px - x) * 0.22`), i.e. exponential
approach, 7.1 frames from the 2.6u magnet range to the 0.45u pickup range, and
it slid flat along the floor. It was also frame-rate dependent — 49ms at 144Hz.
Now burst (projectile motion + bounces) → rest (same bob as other ground items)
→ a fixed 0.42s eased arc to chest height, with an absorb flash and a chime.
A test asserts the flight is >200ms and identical at 30/60/144fps.
**Found on the way:** `dropBossReward` had a `!state.scene` early-return ABOVE
its `addGold`, so headless boss gold was never credited at all.

**Darts was a gold faucet and nobody noticed.** The old curve paid 6× for 120+
with 180 reachable every round once you had the timing: **+3000g per visit**
against 80–200g of floor income. Refitted over four candidate curves at 120k
rounds each; mastery now nets ~+172g/visit at max stake, and RTP *slopes down*
with stake because hand-wobble widens faster than reward, so the cap is
self-enforcing rather than resting entirely on `ROUNDS_PER_VISIT`. **Check this
arithmetic before touching any casino payout.**

**Roulette never steers the ball.** The pocket is drawn first, then launch
SPEED is treated as the free parameter — 600 physically plausible values are
simulated honestly to rest and the first that lands in the target is kept.
600/600 spins land naturally with zero corrections, because the deflector strike
makes launch-speed→pocket chaotic. The trajectory is baked at a fixed 1/120s and
replayed against wall clock: a variable frame rate cannot integrate a chaotic
system reproducibly.

**Blackjack's felt tells the truth.** The conventional printed arc is "DEALER
MUST HIT SOFT 17" — which would be a LIE here, since `blackjack.ts` stands on
all 17. The felt prints `DEALER STANDS ON ALL 17`. This is the third instance
this month of the same bug class: **an agent- or player-facing document
promising behaviour the implementation never had.** When you print a rule,
read the implementation first.

## The pass before — pixel fidelity

**The "blurry characters" complaint was never a filtering problem.** Filtering
was already `NearestFilter` on both mag and min, mipmaps off, `SRGBColorSpace`
set. The art was being destroyed by RESAMPLING, in two independent places that
compounded.

**1. The sprite pipeline resampled three times to display once.** Art painted at
128px → crushed to a 52px grid → nearest-upscaled BACK into a 128px texture
(128/52 = 2.46, so the stored "pixels" were unevenly 2 and 3 texels wide) → then
MINIFIED by the GPU to ~70 screen px. That last step is the killer: it is a
0.55× downscale, so nearest sampling threw away ~45% of the texels, picking
different ones each frame the actor moved. Muddy when still, crawling when
walking.

Now it is ONE crush, straight to a 72px grid that *is* the texture, with
`SPRITE_UNITS` derived as `SPRITE_PIXEL_GRID / PPU` so one art pixel lands on
exactly one render pixel. `SPRITE_PX` (128) stays as the AUTHORING box — it is a
coordinate system for `cel-painter.ts`/`figure.ts`, not a resolution — and the
2× supersample still earns its keep by anti-aliasing curves before the crush.
52 → 72 is also a real fidelity jump: ~52px is the awkward size where a face is
2–3px of mush.

**2. `INTEGER_SCALE` was false**, so the whole 1280×720 framebuffer was stretched
by a fractional factor (×1.5 at 1080p) and shown with `image-rendering:pixelated`
— every pixel alternately 1 or 2 device pixels wide, across the entire screen,
hitting props and tiles as well as actors. The comment justifying it ("cel art
scales cleanly, it's smooth shapes not a pixel grid") was stale; the pipeline
crushes everything to a hard grid now.

Render size is now derived from the window (`computeRenderSizing`) so the scale
is always whole. **The trap:** the ortho frustum is baked from `RENDER_W` ONCE in
`createDungeonCamera()` with no resize path, so making the target adaptive
without syncing the frustum would have silently made PPU 96 instead of 64 and
re-broken the sprite identity — the fix would have been worse than the bug. It
is synced per-frame in `pixel-pass.ts`. Same bake existed on the FPS rampage
camera's `aspect` (latent, pre-existing).

**3. `aimCamera` snapped to `1/PPU`, which is one pixel only at zoom 1.** The
dungeon never sets zoom so it was correct there; the TAVERN runs 0.78 → 0.92, so
the hub was snapping to 0.78 of a pixel — quantising motion onto a lattice
aligned with nothing, which is strictly worse than not snapping. The tavern's
sprite mesh had the identical bug.

**Bugs found that were not cosmetic:**

- The `table` station's stand-spot sat **0.08 units INSIDE** the only legal
  position, so you were permanently pinned against the central pinball table.
  `isOpen()` passed, so no existing check caught it.
- The **descent plunger housing had no collision rect at all** — it is built at
  x 2.6 but `OBSTACLES[5]` only spans ±2.1, so you could walk through the thing
  that launches you into the next floor.

**Four rooms were reworked in an earlier pass. Three of the four had the same
shape of bug: something that LOOKED like it was working contributed nothing.**

**The pirate cabin (`/pirate`) rendered as a near-black frame.** The candles
were the only real lights and they were `PointLight` at intensity **0.8** over
distance 6. three.js lights are physical — intensity is candela with
inverse-square falloff — so that is roughly 0.2 by the time it reaches the desk.
The candle meshes and flames were drawn, so it looked like the lights were
there. Now: candles at 11 candela over 7.5 units, moonlight through the porthole
as the shadow-casting key (entering at the porthole's real position so it is
motivated in-fiction), and a hanging deck lantern for the dead black ceiling.
The chest's glow light had the identical problem (0.5 over 2), so the gold never
glowed. **Candle flicker is now a FRACTION of base intensity** — it was an
absolute ±0.33, which was a ~40% swing against a base of 0.8 and an invisible
~3% against the base the candles actually need.

**The kitchen's appliances were black because of `metalness`, not lighting.**
The toaster, microwave, fridge, stove and sink were `MeshStandardMaterial` at
metalness 0.85–0.95 and **the scene has no environment map** — a PBR metal with
nothing to reflect renders pure black no matter how much light you add. All
appliances are now ≤0.45. The counter was also bare quartz with one floating
orange; it now has three prop clusters with deliberate gaps between them, and
the cabinets have under-counter and toe-kick lighting.

**The window's outdoor scene was BEHIND THE WALL.** The left wall is a solid
plane with no cutout sitting 0.01 behind the window group, and local +z points
into the room — so the sky, hills, trees and ground, all at negative local z,
were silently occluded. Only the raccoon (at z≈0) survived, which is why it read
as a smudge on blank glass. **The old tests encoded the bug as the expectation**
(`expect(fakeSky.position.z).toBe(-0.1)`). They now assert the real invariant:
every outdoor mesh clears the wall at every nesting depth, and depth ORDERING
rather than magic numbers. `window.ts` also went 28 → 8 tsc errors while gaining
423 lines.

**The jungle room needed a value structure, not more relighting.** After the
lighting was fixed it still read flat, because wall/floor/ceiling were
`0xaebaa4`/`0xc0b6a2`/`0xafc0a6` — the same luminance and nearly the same hue. No
relighting fixes surfaces that are genuinely the same colour. Now separated
darkest-overhead to warmest-underfoot: ceiling `0x5c7159`, wall `0x93a88c`,
floor `0xc4a878`.

**Boot no longer freezes on START.** ~60 forest shaders are pre-compiled during
the DOS loading bar via `compileAsync()` instead of on the first post-click
frame. It waits for `signalSceneReady()` first — three.js keys shader programs
on the scene's light configuration, so compiling before the room's lights exist
produces programs that get expensively relinked anyway.

**The jungle room was also relit in an earlier pass and decluttered.** It used to be lit by six
sources at once — ambient, a spot, a hemi and four point lights — so every
surface was reached by several of them, nothing was ever in shadow, and the room
resolved to one flat mid-green. That is why previous passes kept lowering
numbers without it ever looking less bright: turning any one light down did
nothing, the other five filled the gap. It is now ONE key light casting real
shadows, a low ambient that only prevents crushed blacks, and two tight accents.
The key is golden and the ambient/hemi are cool — that warm/cool split is what
stops the room reading green-on-green.

**The production leaderboard works now — it never did before.**
`NEXT_PUBLIC_BACKEND_URL` was set nowhere, and `NEXT_PUBLIC_*` is inlined at
BUILD time, so the deployed bundle told every visitor's browser to fetch
`http://localhost:5175`. Every read and write fell through to the localStorage
fallback — the one path designed to look like success — so the symptom was "the
leaderboard is oddly empty", never an error. It is now a Docker **build arg**
threaded Dockerfile → docker-compose → deploy.sh.

**All four leaderboards go through the service.** Ski and Pirate Surf used to
keep private localStorage boards with their own top-10 rule; they now post to
`game_scores` with their extras in the `detail` column.

**`src/services/` is now genuinely the single door to the backend.** Everything
that talks to the service goes through it, and `src/services/api-config.ts` is
the only place the backend URL is spelled.

---

## Pinball Knight — the plan's open list is cleared

`src/scenes/dungeon/PINBALL_KNIGHT_PLAN.md` was rewritten against the actual
code (the 2026-07-17 revision had gone stale — most of its A/B/C programme
shipped in waves 12-14b), then its whole §1 was built. Highlights:

- **The dungeon submits scores.** It never had. `run-score.ts` grades a run
  DEPTH-DOMINANT: one floor deeper beats any amount of farming the floor above,
  because death restarts at floor 1 and a board rewarding a safe early floor
  would fight the Death Dealer. The run-scoped ledger is separate from the
  per-floor one `startLevel` wipes — without that the board would only ever see
  the FINAL floor's combo.
- **`services/player-name.ts` is shared across every game.** Pirate Surf posted
  to the shared board without ever asking for a name, so every row rendered as
  the server's `"???"`. A name belongs to the player, not one game.
- **Damage numbers, card-pickup previews, best-depth persistence**, an
  off-window stairs chevron, archetype room washes on the full map, and a
  ground shadow that stays on the ground while you're airborne.
- **`render/pinball-parts.ts` is exhaustive now.** A new `PinballPartKind` used
  to typecheck, collide correctly, and render nothing.

**The "control inversion" is solved and it was never an inversion.** Movement
and aim share one code path with no sign error anywhere. `arrowleft`/`arrowright`
were bound in `MOVE_KEYS` *and* `TURN_LEFT`/`TURN_RIGHT`, both read from the same
held-key set, so in FPS mode Left strafed AND rotated on the same frame.
`input.test.ts` now forbids double-binding. ROADMAP §6 / VERIFY_CHECKLIST §6 can
be closed.

**The biggest remaining risk is that nobody has playtested the game.**
`VERIFY_CHECKLIST.md` is 40 items with zero checked. That outranks every unbuilt
feature left in the plan.

---

## Open items

Ordered by what I'd do first. (Numbering is not contiguous — resolved items
are deleted rather than renumbered, per the note at the top of this file.)

0. **Open findings from the audit, none of them fixed.** Ordered by what I'd do
   first.
   - **`planSpin` blocks the main thread on PLAY.** Measured over 400 spins:
     mean 16.9ms, p95 34ms, **max 66ms** — so the average press drops a frame
     and the worst drops four, on a fast dev box. The physics is right; the
     scheduling is wrong. Spread the launch-speed search across the wheel's
     wind-up frames rather than doing it all on the click.
   - **`atlas-loader.ts` will silently reintroduce the blur** the moment a
     forged sprite atlas lands. It builds a `SpriteSheet` from a PNG at whatever
     cell size the artist packed, but the mesh is hardcoded `SPRITE_UNITS` = 72
     render px. A 128px-cell atlas minifies 128→72 at ratio 1.78 — exactly the
     artifact the pixel pass exists to kill. Inert today only because
     `public/dungeon/sprites/` doesn't exist. **Validate
     `img.height === SPRITE_PIXEL_GRID` in the loader.**
   - **The coin burst integrator is dt-dependent** despite the file's own
     docblock claiming otherwise: 2 bounces at 60Hz, **3 at 144Hz**, and an 8%
     spread in settle time. Only the magnet segment is dt-exact; the test only
     covers rest→magnet because `fakeCoin()` defaults to `phase: "rest"`.
   - **Render-target realloc thrash on window drag.** The guard compares
     `renderW/renderH`, but below the cap those track window width directly, so
     dragging an edge reallocates the scene target, depth texture and both bloom
     targets every 2px of drag. Needs a debounce or a coarser size step.
   - **The darts payout budget is measured against a strategy no optimal player
     would use.** `TREBLE_20` gives the documented +172g/visit, but a grid
     search finds `(-0.13, -0.50)` — nudged toward 19 — worth **+203g/visit**,
     because 20's neighbours (1 and 19) are wildly asymmetric. The test asserts
     `< 1.35` RTP using `TREBLE_20` only, so the real optimum sits ~1.2% under
     the ceiling rather than the 4.8% the docs imply. Any loosening of
     `wobbleRadius` breaks the budget with nothing to catch it.
   - **Resting coins are not durable.** A coin in `rest` phase is uncredited
     indefinitely and nothing persists `state.groundItems`, so a refresh or
     crash discards up to `COIN_LIVE_CAP` (28) coins' worth of gold.
   - **`splitCoinValue` drifts on non-integer input** (`7.5, 2 → [4,4] = 8`,
     inventing 0.5g) despite a docblock promising it sums exactly "for every
     input". Unreachable today — every caller passes integers and `spawnCoin`
     floors — but it's an exported function whose contract is wrong.
   - **6912px atlases exceed the 4096 `MAX_TEXTURE_SIZE`** floor on older
     integrated GPUs, where the knight would render as garbage. Much improved
     (was 12288) and not a regression, but nothing asserts a bound.

1. **Decide two design calls from the casino pass.**
   - **Darts now has bounded RNG in the outcome**, which the original file
     header explicitly disclaimed. The dart never lands further from your aim
     than `wobbleRadius` (asserted), and it exists because without it the skill
     ceiling was one memorised beat. Revert to fully deterministic if the
     no-RNG rule matters more than the ceiling.
   - **Roulette's `busy()` now returns `spinning || settleT > 0`**, so controls
     stay locked through the 1.9s settle hold instead of unlocking the instant
     the ball stops. Deliberate — the settle is the payoff — but it is a
     behaviour change from `busy: () => spinning`.

1. **The gambler canvas should probably be 240px tall, not 200.** At 200,
   blackjack's two 50px card rows plus the rail eat the vertical budget, so the
   betting circle had to go BESIDE the player's hand rather than below it, which
   is backwards from a real table. 40 more pixels would also let cards grow to
   ~60px, at which point 9s and 10s could keep the full 7×7 pip instead of
   dropping to the small one. NOT done this pass because slots, roulette and
   darts were all designed and visually verified against 200 — changing it
   invalidates three other layouts that would need re-verifying. It lives in
   `gambler/index.ts`.

2. **Play the tavern and judge the walk speed.** `WALK_SPEED` went 3.4 → 4.6,
   but `CAM_LEAN = 0.5` in `tavern/core.ts` literally halves apparent on-screen
   motion, and it is the largest remaining contributor to "sluggish". It was NOT
   changed — a full player-follow was tried in an earlier pass and rejected
   because it pushed half the stations out of frame. **The wider FOV from this
   pass makes a higher lean safer than it was when it was rejected**, so ~0.65 is
   the next lever if it still drags. Three feel changes landed unverified-on-
   screen this pass (speed, sprite snap, camera snap); don't stack a fourth
   blind.

2. **There is no master volume or mute anywhere in the codebase.** Every SFX in
   `dungeon/audio.ts`, `tavern/audio.ts` and the new `gambler/audio.ts` writes an
   absolute gain straight to `ctx.destination`. Gains were hand-picked to sit
   under the room tone. Adding a mute means a master `GainNode` in
   `utils/audio-manager.ts` that every cue routes through — a real feature, and
   it touches every audio file.

3. **Props that overhang their collision rects.** The audit that caught the
   plunger also flagged: the anvil/stump (~0.05 south of the forge rect, and
   `npcs.ts` ANVIL agrees with it, so probably deliberate), the arcade lever and
   knob, the bar's top lip and foot rail, the table backglass, and the wall
   dartboard. All cosmetic-only today — you clip a corner, nothing breaks.

6. **Legacy type debt.** ~5975 repo-wide tsc errors, masked by
   `ignoreBuildErrors: true` in `next.config.js`. They're concentrated in
   `src/objects` and `src/room` — old JS renamed to `.ts`. Not worth a sweep;
   just don't let the clean directories regress. Note the "clean zone" is
   narrower than the directory globs suggest: `src/utils/**` and `src/scenes/**`
   are NOT globally at 0, only the specific files listed at the top are.

7. **The service still has no authentication.** Hardened but not authenticated:
   the rate limiter is now genuinely per-IP (it used to `clear()` every IP at
   once on a global 60s timer, and it trusted client-controlled
   `x-forwarded-for`, so rotating that header defeated it entirely), CORS is an
   allowlist, and the container binds to the LAN rather than every interface.
   Nothing identifies a caller. Acceptable only because the service is marked
   internal in vault `projects.json`, has no reverse proxy, and is not publicly
   routed — if that ever changes, this becomes urgent the same day.

8. **Pirate Surf still doesn't ask for a player name**, but the hard part is
   done: `src/services/player-name.ts` now exists, is shared across games, and
   defaults to `KNIGHT` rather than the server's `"???"`. Surf just needs to
   call `getPlayerName()` instead of passing nothing. Ski already collects one
   of its own and could migrate to the shared module too.

9. **`SurfUI` declares no fields**, so every property access on it is a tsc
   error — including the new `_scoreSaved`. That's the file's existing pattern,
   not a new break; typing the class is its own change.

10. **The contract is still hand-copied across the two repos**, deliberately —
    `GameId` in `score-service.ts` mirrors `GAME_IDS` in the service by comment,
    and the 1–12 name rule exists on both sides. Keeping the repos decoupled was
    the explicit call. Drift shows up as a runtime 400, never a type error, so
    when you add a game remember it is TWO edits.

---

## Gotchas

**Things that look like bugs and aren't:**

- **Headless QA runs at ~2–5fps under swiftshader.** Sim `dt` is clamped, so
  2.6s of animation can take 20+ seconds of wall clock. Always POLL for a state
  change; never `waitForTimeout` a fixed duration and assume.
- **Tavern input is screen-relative under the iso yaw**, so one key walks a
  world diagonal. `w+a` = world north, `a` alone = northwest.
- **Pressing PLAY mid-animation is intentionally swallowed** (it speeds a slot
  reel; it's ignored during a dart's flight). A test that clicks on a timer will
  lose presses and look broken.

**Things that look safe and aren't:**

- **`SPRITE_UNITS`, `SPRITE_PIXEL_GRID` and `PPU` are a locked triple.**
  `SPRITE_UNITS * PPU` must equal `SPRITE_PIXEL_GRID` exactly, or sprites go
  soft again. Nothing crashes when it drifts — the art just quietly stops being
  crisp — which is how the old 1.354 ratio survived for months.
  `sprite-scale.test.ts` exists solely to fail on this.
- **`MAX_RENDER_W/H` (1600×900) is a FIELD-OF-VIEW clamp, not an allocation
  guard.** PPU is pinned, so render width IS the field of view: an unclamped
  1920-wide target shows 30 tiles where the game was designed around 20, which
  makes every sprite physically *smaller*. Raising it re-opens that question; it
  is not a free "use more screen" dial. 2560×1440 and 3840×2160 already fill
  perfectly at the designed 20-tile view; 1080p takes ~160px bars each side.
- **Any camera that sets `zoom` must snap to `1/(PPU * zoom)`**, not `1/PPU`.
  See `aimCamera`. The dungeon's zoom is always 1, so this stays invisible until
  someone reuses the camera in a scene that zooms — which the tavern does.
- **`renderPaintIcon` upscales by a WHOLE number** (`ICON_UPSCALE`) for DOM shop
  icons. The consumer still needs `image-rendering: pixelated` or the browser
  undoes it.
- **The `merchant` paint is shared with the dungeon's merchant.** Redressing him
  as an aproned smith for the tavern forge changes how he reads down there too.
  Deliberate, but cross-scene — the same is true of any `NPC_PAINTS` edit.
- **Never delete `pnpm-workspace.yaml` or `pnpm-lock.yaml`.** The Dockerfile
  uses `npm ci`, so they look inert — but deploy-kit's test gate runs `pnpm
  install`, and the workspace file carries the approved-native-build allowlist
  (client: canvas, sharp, unrs-resolver). Deleting them aborts every deploy.
- **Placement bugs in a 3D scene are silent.** Something positioned inside
  geometry simply never renders — nothing throws, no test fails, only a
  screenshot shows it. All tavern placement therefore lives in
  `scenes/tavern/layout.ts` as pure data with assertions. Put new placement
  there. **The jungle room has no such test** and it bit again this pass: a fern
  sat inside the beer pong table's footprint and grew up through the table
  surface. If you touch `room/tropical-plants.ts` placement, screenshot it.
- **`deploy.sh` builds with `COPY . .` — the WORKING TREE, not git HEAD.** With
  another session mid-edit in this repo, deploying straight from the shared
  checkout ships their uncommitted work. Deploy from a clean worktree instead:
  `git worktree add <dir> HEAD`, symlink `deploy-kit` **beside** it (the script
  resolves `../deploy-kit/lib.sh` relative to the repo root), run `bash
  deploy.sh` there, then `git worktree remove <dir> --force`. Verified this
  session; the banner reads `HEAD@<sha>` rather than `main@<sha>`.
- **`NEXT_PUBLIC_*` is inlined at BUILD time, so it must be a build ARG.**
  Setting it in `docker-compose.yml` under `environment:` looks right and does
  nothing — the bundle was already compiled. If the leaderboard ever goes quiet
  again, grep `.next/static/chunks/` for `localhost:5175` before debugging
  anything else; zero hits means the wiring is intact.
- **The mouse den's seats put their local origin at their BASE, not their
  centre.** The old chairs centred on the seat and floated 0.065 above the floor
  because the leg reach had to be computed by hand. Keep new props origin-at-base
  so `set(x, SEAT_FLOOR_Y, z)` is the only number that can be wrong.
- **three.js lights are PHYSICAL: intensity is candela with inverse-square
  falloff.** An intensity under ~1 over more than a couple of units lights
  essentially nothing, and because the emitter mesh still renders it looks like
  the light is working. This exact bug was found THREE times in one pass (pirate
  candles, pirate chest glow, kitchen under-cabinet spacing). If a room is
  mysteriously dark, print the light intensities before touching anything else.
- **A PBR metal with no environment map renders BLACK.** `metalness` above ~0.5
  with no `scene.environment` cannot be fixed by adding light — a metal has
  nothing to reflect. That, not the lighting, is why the kitchen appliances were
  featureless slabs. Keep `metalness` ≤0.45 in these scenes or set an env map.
- **A test that pins a coordinate can encode a bug as the expectation.** The
  window tests asserted the sky sat at exactly `-0.1`, which is *behind the
  wall* — so the suite was green while the scene was invisible. Prefer
  relational invariants (ordering, "clears the wall") over magic numbers.
- **Shadow flags are read per-mesh at render time, and the jungle room mounts
  across several idle callbacks.** `enableRoomShadows()` therefore runs after the
  LAST mount batch — move it earlier and the late props silently never cast.
- **Ambient intensity is exported from `room/lights.ts`, not hardcoded.** The
  zoom modes lift ambient for close-up viewing and restore it on exit. Those were
  four magic numbers tuned against the old baseline, so every retune of
  `lights.ts` silently desynced them and left the room brighter after a zoom than
  it started. Use `AMBIENT_BASE` / `AMBIENT_ZOOM` / `AMBIENT_ZOOM_BRIGHT`.
- **Unicode glyphs are not pixel art.** Press Start 2P has digits and A–Z but
  none of `●◉⌒◆★☠♠♥`, so those silently fall back to a smooth system font.
  Anything symbolic must be hand-authored pixel runs (`gambler/symbols.ts`,
  `gambler/cards-art.ts`, `map/map-icons.ts`).
- **Payout maths must be computed, never eyeballed.** The first slots paytable
  read as reasonable and enumerated to a **13% RTP**. Every gambler game has an
  RTP test; re-run it after touching any paytable.
- **Only `gambler/table.ts` may move gold.** Games return an outcome; the shell
  settles it. That's what makes the stake caps and the six-round visit limit
  unbypassable.
- **Don't let renderers stack.** The dungeon and tavern both used to render
  fully-hidden 3D behind panels, starving the panel canvas to ~4fps. Both are
  gated now — keep new full-screen UI gated the same way.

---

## Where the reasoning lives

- `MAP_PLAN.md` — both map tracks (shipped). Why the map isn't DPR-scaled, why
  room names live in an info bar.
- `src/scenes/tavern/TAVERN_PLAN.md` — the walkable-hub design, the floor plan,
  and what was deliberately cut.
- `src/scenes/tavern/gambler/GAMBLER_PLAN.md` — the four games, the house-edge
  gradient (skill is the axis), and why each number is what it is.
- `src/scenes/dungeon/BLUEPRINT.md` — the game's architecture.
- `src/scenes/dungeon/VERIFY_CHECKLIST.md` — manual QA pass; there's no E2E
  harness for the 3D game, so this is how a change gets confirmed by hand.

Browser QA scripts used this session are in the session scratchpad, not the
repo — they drive a real chromium via `playwright-core` with
`--use-gl=swiftshader`. Worth re-creating rather than resurrecting.
