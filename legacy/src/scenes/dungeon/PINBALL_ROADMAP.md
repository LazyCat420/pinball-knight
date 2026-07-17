# 🪩 Pinball-Crawler Hybrid — Checklist & Roadmap

*(2026-07-16. Companion to BLUEPRINT.md, which stops at the 2026-07-14 rounds.
This doc reconciles the playtest asks + brainstorm list against what the code
actually contains as of commit `bcd1271`.)*

> **STATUS UPDATE (2026-07-16, same day):** Waves A–F below are **BUILT** in a
> single implementation pass. §2's checklist is annotated with ✅. What shipped:
> glove/oil/spinpad/slingshot/target/trapdoor parts (`state.PinballPartKind`,
> `decorate.classifyTopology` pools, `render/pinball-parts.ts` builders,
> `player.touchPinballParts` + `entities/hazards.ts`); the six Wave-B monsters
> as tinted reskins (`core.RESKIN`) with bespoke behaviours in `zombie.ts` +
> momentum gates in `combat.ts`; prefab stamps + shuffle bag + 4 floor themes
> (`maze/prefabs.ts`); curved deflector rails + the trapdoor coaster
> (`player.startRide`); the Magician/Witch/Frog (`entities/npc.ts`); the five
> Wave-F potions + multiball + frenzy/strike/target/bonus-room score glue.
> Deliberately deferred: flipper tiles (gloves cover the fantasy), angle
> mirrors, pit/electric/fire-vent/magnet-strip floor hazards, Rolling Cart
> Merchant (needs a shop), Curve Shot / Magnet Boots, real boss antechamber
> prefab (shipped as a brute-guard pack at the stairs), and bespoke cel-paints
> for the reskinned monsters (sprite-forge follow-up).
>
> **STATUS UPDATE 2 (2026-07-17): the ENTIRE deferred set above is now BUILT
> (Waves G–L).** Flipper (`buildFlipper` + junction-launch physics) and angle
> mirror (`buildMirror` + reflect-across-surface) parts; four floor hazards —
> pit (fall→respawn+penalty), electric grid (phased zap plates), fire vent
> (wall-mounted timed jet in `entities/hazards.ts`), magnet strip (momentum
> cap / walk-drag); **bespoke cel-paint atlases** for goblin/pin/golem/chomper/
> magnet/webspinner (`cel-painter.ts` `make*Paints`, wired into `core.RESKIN`,
> no more tints); the **Rolling Cart Merchant** (`npc.ts` slide+flee) + a full
> **shop overlay** (`ui.openShopOverlay`, sim pauses, gold via `spendGold`);
> **Curve Shot** (projectile lateral accel) + **Magnet Boots** (repel crawlers,
> launch off strips) potions; and a **real boss antechamber** — a bumper-ringed
> carom arena + scaled brute pack + guaranteed prize around the stairs. Hazard
> placement is its own layer over the part budget; fire vents mount wall-adjacent
> (2-wide corridors have ~no strict-straight tiles). Verified headless: all 16
> part/hazard kinds place across themed floors, the 6 bespoke atlases render,
> flipper/pit/curve/boots/shop all fire, 257 tests pass, build clean.
> NOW nothing from the original brainstorm remains deferred except pure taste
> calls (extra prefab archetypes, 8-direction art).

---

## 1. What is ALREADY BUILT (verified in code — don't rebuild these)

| System | Where | Notes |
| ------ | ----- | ----- |
| Pinball momentum core | `entities/player.ts` | Flat wall bounce preserves speed (0.94), corner slam accelerates (1.12 + kick), 22 u/s cap, gentle friction, steerable |
| Bounce combo + style kills | `player.ts`, `combat.ts` | Combo counter w/ 1.6s window; kills carried by momentum pay combo-scaled gold |
| Ball form + ram | `player.ts` | Full overcharge → tuck into ball, ram zombies w/ knockback |
| Pinball parts ×4 | `state.ts`, `maze/decorate.ts`, `render/pinball-parts.ts`, `player.ts` | **bumper** (junctions, radial pop), **spring** (dead-end plunger, 16 u/s), **ramp** (dash pad, speed floor + steer lock), **deflector** (banked corner rail). Topology-placed, animated, SFX'd |
| Room archetypes ×4 | `maze/generator.ts` `carveRooms`, `decorate.ts` `furnishRooms` | bumper chamber / speedway / arena / vault — carved over the backtracker pre-thicken so connectivity is free |
| Secret smash-walls | `generator.ts` `crackSecretWalls`, `secrets.ts` | Solid at walk, shatter at momentum ≥ 7; every launcher clears the bar |
| Enemy roster ×8 | `state.ts` `EnemyKind`, `zombie.ts` | zombie, spider, brute, spitter, **ghost** (phases walls = brainstorm "Phase Ghost"), **bat** (sine-weave flyer), **slime** (splits into 2 minis = brainstorm "Jelly Split"), **reaper** |
| The Death Dealer | `constants.ts` REAPER_*, `zombie.ts` | Already exists under that exact name — spawns at 110s, phases walls, accelerates forever, unkillable. The Spelunky ghost |
| Floor grade | `constants.ts` GRADE_*, `fps.ts`, `ui.ts` | S–D on pace/carnage/style, gold payout per grade |
| Wall moves, dodge roll | `player.ts` | wall-kick / wall-ride grind / pounce; Gungeon-style roll w/ i-frames |
| Buff potions | `items.ts` | health / rage / haste / shield / gold — the extension seam for new power-ups |
| Dead-end reward logic | `decorate.ts` | Springs aim OUT of dead ends; vault rooms hold guarded prizes |

**Brainstorm items that are already done** (map them, don't duplicate):
Classic Bumpers ✅ · Speed Lanes ✅ (ramp) · Secret walls ✅ · Jelly Split ✅
(slime) · Phase Ghost ✅ (ghost — lacks only the "materialize window" damage
rule) · Death Dealer ✅ (reaper) · Style bonuses ✅ · Floor-end grade ✅ ·
Bounce-combo multiplier ✅ (window exists; no on-screen multiplier flash yet).

---

## 2. NOT built — the gap checklist

> **STATUS UPDATE 3 (2026-07-16, later same day): an audit found the STATUS
> UPDATE 2 "all built" claim was TRUE for parts/hazards/monsters/NPCs/coaster/
> power-ups but OVERSTATED for generation, curved walls, and score glue. The
> remaining genuine gaps have now been CLOSED — see the ✅(v3) marks below.**
> Shipped this pass: **curved walls** (collision.computeArcCorners → per-corner
> momentum bank, the deflector move on EVERY qualifying corner, + rendered
> quarter-cylinder wedges in build.ts; guarded to ≥2×2 open pockets so 1-wide
> bends never pinch); the missing prefabs — **Mirror Maze, Pit Room, S-Bend,
> Squeeze, Boulevard** (maze/prefabs.ts) — plus **mirror variants** in the
> shuffle bag (variantsOf: up to 8 orientations) and **connector-hallway
> mini-challenges** (the squeeze's electric gauntlet, the boulevard's carom
> island); **theme-driven enemy-ratio overrides** (FloorTheme.enemies →
> themedHordePick, ~55% of the horde drawn from the biome's families); the
> on-screen **×N bounce-combo flash** (ui.createComboFlash/flashBounceCombo,
> the pinball twin of the FPS streak pop); and a **guaranteed bonus vault**
> (grade S/A forces the +1 room to a vault via decorateMaze forceVault).
> Verified: 263 tests pass, next build clean, headless boot renders with zero
> console errors. Honest deviations noted inline.

### From the playtest asks
- [x] 🥊 **Boxing-glove walls** ✅ · [x] 🛢️ **Oil-spill floor boosters** ✅ · [x] 🎩 **The Magician** ✅ · [x] 🎢 **Trap doors → rollercoaster ramps** ✅
- [x] 🧩 **Prefab/component maze generation** ✅(v3) — stamp library + shuffle bag now carries mirror AND rotation variants, richer room + hallway shapes, connector mini-challenges. (Note: the 4 rect archetypes remain a separate carve/furnish path by design, not re-expressed as stamps.)
- [x] ⌒ **Curved walls** ✅(v3) — every qualifying maze corner banks momentum leg→leg (return-lane sweep, speed intact) with a rendered quarter-cylinder wedge. HONEST NOTE: implemented as a point-trigger bank + visual wedge (the proven deflector model), NOT a naive circle-vs-arc SOLID — a 1-tile grid can't host a real corner fillet without pinching the 0.6-wide player.

### From the brainstorm (new, grouped by cost)
**Parts/hazards** (cheap — the part seam already exists):
- [x] Spin pad ✅ · [x] Slingshot gate ✅ · [x] Flipper tiles ✅ · [x] Target bullseyes ✅ · [x] Angle mirrors ✅ · [x] Pit tile ✅ · [x] Electric grid ✅ · [x] Fire vents ✅ · [x] Magnet strip ✅

**Monsters** (medium — EnemyKind seam exists):
- [x] Bumper Goblin ✅ · [x] Brick Golem ✅ (5 shards, not 3) · [x] Magnet Crawler ✅ · [x] Bowling Pin Crew ✅ · [x] Web Spinner ✅ · [x] Chomper Plant ✅ · [x] Ghost materialize-window rule ✅ · (Pinwheel Spinner folded into the spinpad PART — no separate monster)

**NPCs** (medium):
- [x] Magician ✅ · [x] Speed Witch ✅ · [x] Oracle Frog ✅ (ember route-trail, not a HUD map) · [x] Rolling Cart Merchant ✅ (+ full shop overlay)

**Generation** (big):
- [x] Prefab stamp library ✅ · [x] Seeded floor themes ✅ · [x] Boss antechamber before the stairs ✅ (inline feature, not a stamp) · [x] Magician's Parlor / Slalom / Gauntlet ✅
- [x] Connector-hallway mini-challenges ✅(v3) — squeeze (electric gauntlet), boulevard (carom island), S-bend (mirrored elbow)
- [x] Mirror Maze ✅(v3) · [x] Pit Room ✅(v3)
- Seeded floor themes now also override the enemy ratio ✅(v3) (FloorTheme.enemies)

**Power-ups & score glue** (cheap-medium):
- [x] Iron Core ✅ · [x] Turbo Charge ✅ · [x] Spring Legs ✅ · [x] Freeze Ray ✅ · [x] Multi-Ball ghosts ✅ · [x] Curve Shot ✅ · [x] Magnet Boots ✅ · [x] MULTIBALL FRENZY streak bonus ✅
- [x] On-screen ×N multiplier flash ✅(v3) — a centred bounce-combo pop, escalating word + colour, fires once per combo step
- [x] Floor score target → bonus room unlock ✅(v3) — grade S/A now guarantees a VAULT (forceVault). HONEST NOTE: still an extra *room*, not a literal locked door + key (that stays deferred as pure polish).

---

## 3. Build plan — six waves, each shippable alone

Ordering rationale: A and B ride existing seams (fast, visible wins), C is the
generation rebuild everything later stamps into, D–F layer content on top.

### Wave A — Hazard & part expansion (the part seam)
Every new part is the same 4-touch recipe the existing four prove out:
1. `state.ts` — extend `PinballPartKind` (+ per-part fields if needed)
2. `maze/decorate.ts` `classifyPartSpot` — a topology rule for where it lands
   (gloves want wall faces on long straights; oil wants open rooms/corridor
   runs; spin pads want junction centres; slingshots want 2-wide gaps)
3. `render/pinball-parts.ts` — a builder + an animate hook
4. `entities/player.ts` part loop (~line 450) — the physics on touch/trigger

Contents: **boxing glove** (timed piston: `fireT` cycle, hits player AND
enemies in its lane via `combat.damageZombie` — first part that's also a
weapon), **oil slick** (a *zone*, not a point: `PINBALL_STEER × 0.1`,
friction ≈ 0, walking entry converts to momentum — the cheap "wheee" part),
**spin pad**, **slingshot gate**, **target bullseyes** (per-room counter →
door unlock or prize spawn — first *objective* part). Flipper tiles: prototype
last, only if gloves don't already scratch the itch (a glove IS a flipper with
a clearer read).
*Tests:* part-placement topology rules in `decorate.test.ts`; oil steering
math in `player.test.ts`.

### Wave B — Pinball-reactive monsters (the EnemyKind seam)
Recipe per monster: `EnemyKind` union + stats block in `constants.ts` (the
`*_RATIO` / `*_FROM_LEVEL` convention) + behaviour branch in `zombie.ts` +
cel-painter sheet + spawn table entry.
Priority order (each teaches the player a different momentum lesson):
1. **Bumper Goblin** — contact = bumper kick on the player (reuse BUMPER_KICK
   math verbatim); low HP; only dies to momentum hits — the walking tutorial
   for "hit things fast"
2. **Bowling Pin Crew** — spawn 6 in triangle formation; knockback chains
   (a shoved pin damages pins it collides with; wall slam = bonus) — reuses
   existing knockback, needs pin-vs-pin collision pass
3. **Brick Golem** — inert wall-tile actor until hit ≥ SECRET_BREAK_SPEED
   (reuse the secret-wall gate), death spawns 3 ricocheting shard projectiles
4. **Chomper Plant** — stationary corridor gate, snap telegraph, knocked open
   only by a speed hit
5. **Magnet Crawler** — radial pull force on the player each tick; wall
   contact snaps the tether
6. **Web Spinner** — web glob projectile → `webbedT` slow on player; touching
   any bumper/spring clears it (makes parts defensive tools)
7. **Ghost materialize rule** — vulnerability window after its attack lands
*Tests:* golem speed-gate + goblin kick vectors in `ghost.test.ts`-style
colocated tests.

### Wave C — Prefab maze generation (the big one)
Goal: "reuse component parts (rooms/hallway shapes) without repeating the same
pattern over and over."
- **`maze/prefabs.ts`** — a stamp library. A prefab = a small tile matrix
  (pre-thicken cell space, like `carveRooms` output) + anchor metadata (part
  spots, spawn spots, prize spots, door cells). Room prefabs (Slalom S-curve,
  Gauntlet, Pit Room, Mirror Maze, Magician's Parlor, Boss Antechamber, plus
  the existing 4 archetypes re-expressed as stamps) AND hallway prefabs
  (S-bend, switchback, wide boulevard with a centre island, squeeze).
- **Placement** — keep the backtracker as the connective skeleton (it already
  guarantees solvability); stamp prefabs over it exactly the way `carveRooms`
  does (only carve floor, never add wall over corridor → connectivity by
  construction). Hallway prefabs replace straight corridor runs ≥ N cells.
- **No-repeat variety** — a seeded **shuffle-bag** per floor: each prefab id
  enters the bag with rotation/mirror variants (×4–8 variants each, free);
  drawing without replacement until empty guarantees a floor never repeats a
  stamp before it's used everything, and the bag reshuffles across floors with
  the level seed.
- **Floor themes** — depth-seeded theme table gating the prefab pool + palette
  accents + enemy-ratio overrides (e.g. 1–2 Crypt, 3–4 Sewer/oil-heavy,
  5+ Hellfire/fire-vent-heavy). Cheap: it's a pool filter, not new art.
- **Dead-end economics** — every dead end draws from {spring (already), prize,
  Oracle Frog, trapdoor} so exploration always pays.
- **Boss antechamber** — always stamped adjacent to the stairs room from
  depth 3+; brute-pack + arena furniture now, a real boss later.
*Tests:* `generator.test.ts` gains: every prefab stamp preserves full
reachability; shuffle-bag never repeats within a floor; stairs BFS-distance
rule survives stamping.

### Wave D — Curved walls + trapdoor coasters (the showpiece)
- **Curved walls** — new tile flag for *convex corner arcs*: where two wall
  bands meet at an L, replace the corner cap with a quarter-cylinder segment
  (`build.ts` already special-cases wall heights per neighbour; this is one
  more case). Collision: `collision.ts` gains circle-vs-arc for flagged
  corners — bounce normal is radial, so a fast player entering the curve
  *sweeps around it* like a pinball return lane. This upgrades every corner
  the deflector part can't cover, and Mirror-Maze/Slalom prefabs get them by
  default. Physics note: a swept curve should behave like the deflector
  (keep speed ×1.03), NOT like a corner pocket (no accel farming loop).
- **Trap doors → rollercoaster** — a `Trapdoor` tile (rendered as a bordered
  hatch): step on it at ≥ ramp speed (or after a 0.4s creak if slow) → it
  flips open → **`coaster.ts`**: a seeded Catmull-Rom spline threaded along
  the maze's wall-top graph (2–4 s ride), player control locked, camera
  follows, i-frames on, sparks + wind SFX, exits by *launching* you at spring
  speed at a far tile (shuffle-bag picks: near-vault / near-stairs / mid-horde
  for risk-reward). Mechanically a teleport with a ride — all state mutation
  happens at exit, so it can't desync combat.
*Tests:* arc-collision reflection math; spline endpoints always land on
walkable tiles.

### Wave E — NPCs
- **The Magician** 🎩 — every MAGICIAN_PERIOD (~45 s, jittered), spawns in
  view-edge smoke, bows, teleports the PLAYER to a shuffle-bag tile (biased:
  60% neutral, 25% treasure-adjacent, 15% trouble), laughs (`audio.ts` gets a
  cackle), vanishes. Unkillable + untargetable (reuse the reaper's immunity
  path in `combat.ts`). Momentum is preserved through the teleport — landing
  at 20 u/s in a bumper chamber is the feature. Suppressed while the reaper
  is out (two uncontrollable actors at once reads as unfair).
- **Speed Witch** — secret-room NPC (spawns only behind cracked walls —
  finally a *reason* to hunt them): pay half current HP → 30 s
  turbo+spring-legs buff. One trade per floor.
- **Oracle Frog** — dead-end NPC: touch → 3 s minimap reveal of the route to
  the stairs (UI already draws a map? if not, a compass ping is the v1).
- Rolling Cart Merchant — **deferred** until a gold-shop exists.

### Wave F — Power-ups & score glue
- New potions on the existing `PotionId` seam: **Iron Core** (ram damage ×3,
  20 s), **Turbo Charge** (PINBALL_FRICTION → 0, steer ×1.5, 10 s), **Spring
  Legs** (wall restitution → 1.05 flat, 15 s), **Freeze Ray** (all enemies +
  timed parts frozen 6 s).
- **Multi-Ball** — 2 ghost knights offset ±0.8 tiles mirroring player
  momentum, dealing ram damage only, 12 s. (Render = tinted player sheet;
  no AI needed.)
- **Score glue** — on-screen ×N multiplier flash per bounce-combo step;
  "MULTIBALL FRENZY" banner + gold at 5 part-hits inside one combo window;
  per-floor score target (scaled from grade thresholds) that unlocks one
  bonus-room door (a locked vault prefab from Wave C).

---

## 4. Verification per wave (house rules)

- Colocated `*.test.ts` for pure logic only (generator/collision/part math) —
  run `npm test`.
- Visual/feel changes: the headless Playwright harness (swiftshader; **poll
  sim time, don't sleep** — sim caps at 0.1 s per rendered frame). Screenshot
  every new part/monster/prefab from the fixed camera before calling it done.
- Commit + push before any deploy; the tree must be clean (parallel sessions
  touch this repo).

---

## 5. Speed wall-breaking + Wolfenstein UI / control-fix plan (2026-07-16)

### 5.0 Speed wall-breaking — BUILT
Carry pinball momentum ≥ `WALL_BREAK_SPEED` (15 u/s, near ball-form / a hot
part chain) into an ORDINARY wall that has a corridor on the far side and you
KOOL-AID straight through it — your own shortcut. Guarded by `isBreakableWall`
(never the outer shell, never a hole into dead rock) so the maze stays solvable.
Wiring: `constants.WALL_BREAK_SPEED`/`WALL_BREAK_SPEED_COST` → `player.trySmashWallAhead`
(sits right after the cracked-secret smash in `updatePinball`) → `secrets.smashWallAt`
(opens the grid, pops the wall instance out of its `InstancedMesh` via the new
`MazeHandle.wallAt` tile→instance map, bursts dust; no loot — the shortcut IS
the reward). Cracked secret walls keep their lower bar (7) + loot payout.

### 5.1 The pasted dev plan — PATHS CORRECTED
> The external plan below referenced `src/objects/dungeon-game/`. That path does
> NOT exist — the real code is **`src/scenes/dungeon/`**. Its control-bug
> diagnoses (left/right inversion, aim) are hedged ("may be flipping", "if
> needed"); the game currently renders + drives correctly in headless QA, so
> those are to be EMPIRICALLY VERIFIED (drive keys, read `__dungeonPlayer`)
> before any sign is flipped — a blind flip would introduce the very bug. The
> Wolfenstein UI overhaul is a real, additive feature request.

- **Bug 1 (left/right):** claim = `input.ts` MOVE_KEYS + `camera.ts`
  `SCREEN_RIGHT_XZ`/`CAMERA_YAW` invert; also `render/animator.ts`
  `facingFromVelocity` E/W. → verify before flipping.
- **Bug 2 (aim):** ranged shots pull `FACING_VEC[p.facing]` (`entities/combat.ts`)
  → `entities/projectiles.ts fireWeapon`. Verify direction post-move-fix.
- **UI overhaul (`ui.ts` + `render/pixel-pass.ts`):** replace the top-left
  gothic HUD with a full-width **bottom bar** (SCORE | HEALTH | AMMO), numeric
  HP in a pixel font, "YOU ARE DEAD" game-over. (Aesthetic pivot from the
  current Castlevania look — keep it behind the same `createHUD`/`updateHUD`
  seam.)
- **Weapon HUD (new `render/weapon-hud.ts`):** bottom-centre gun/bow sprite,
  walk-bob, bow drawback on `attackT`, swaps on `state.activeSlot`.
- **Arrow VFX (`render/vfx.ts` + `entities/projectiles.ts`):** a travelling
  arrow trail hooked to bow fire.

Implementation order: verify+fix controls → UI bar → weapon HUD → arrow VFX.
