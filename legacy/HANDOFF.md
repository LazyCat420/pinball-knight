# Handoff — braindeadbot-client

_Replaced on each deploy. Not a log; if something here is done, delete it._

> ⚠️ **Two sessions were live in this checkout on 2026-07-26.** The flipY section
> below belongs to the other one and was still in flight — it is kept, not
> replaced. Only the intro-skip section is mine.

## 🖱️ SKIP left an INVISIBLE CLICK BLOCKER over the whole site (2026-07-26)

**Commit `f78bb4a`** → synology (`HEAD@f78bb4a`, clean worktree). Container
`healthy`. 1419 tests pass (123 files).

### What was reported

> "when i skip in braindeadbot intro then go to map i can't click it"

### Root cause — an orphaned overlay, not a map bug

The toucan flight owns **`#toucan-intro-blocker`**: a transparent, full-viewport
`div` at **z-index 99998** that swallows clicks while the bird flies. The only
thing that removes it is the flying run's own `_cleanupRef` closure.

SKIP stays live for the whole intro, so pressing it **mid-flight** called
`forceSkipBoot()` → the boot re-entered `triggerTransition(true)` → `startDissolve`
→ a **second** `playToucanIntro()` underneath the run already flying. That second
call saw `_running === true`, dismissed it as a stale HMR flag, and reset it —
orphaning the live run's cleanup closure, blocker and all. The `skipToucanIntro()`
immediately after then found `_running === false` and returned without doing
anything.

The console said it out loud, pre-fix:

```
[intro-scene] ⏭️ Skip button clicked
[DOS-Boot]    ⏭️ Fast-forwarding to dissolve
[DOS-Boot]    🎬 Preparing toucan intro…  fastForward: true
[toucan-intro] ⚠️ _running was stale true — resetting   ← blocker orphaned HERE
```

### Why it presented as "the map won't click"

An invisible overlay does not block the **keyboard**. `M` still opened the map,
so the map looked like the broken thing. Every click on the page — map, compass,
room props, games — was landing on the blocker instead. `#map-overlay` also
stayed `hidden` because the compass click never reached it.

### The fix — three layers

| File | Change |
|---|---|
| `src/transitions/toucan-intro.ts` | All end-of-run paths route through `_endLiveRun()`. Re-entry while `_running` now **tears the live run down** instead of writing the flag off as stale. `_sweepStrayBlocker()` added as a backstop. |
| `src/transitions/dos-boot.ts` | `_handedOff` — hand off to the toucan intro exactly **once**. Also stops `onDone`/`onReady` firing twice on a mid-flight skip (the app was booting the room on top of itself). |
| `src/scenes/intro-scene.ts` | Skip the flight **before** the boot; `_finish()` fires the app callback once; teardown sweeps any stranded blocker. |

### How it was verified — and how to re-verify

`scratchpad/skip-probe.mjs` (playwright + swiftshader) drives the real intro,
clicks SKIP mid-flight, then measures the **symptom**, not the teardown logs:
`elementFromPoint` at the viewport centre, plus a real `page.click` on the
compass that an overlay eats exactly as it would for a user.

|  | pre-fix | post-fix (local + prod) |
|---|---|---|
| element at viewport centre | `DIV#toucan-intro-blocker` | `CANVAS#room-canvas-element` |
| real click on the compass | **times out** | reaches it |
| element over the open map | `DIV#toucan-intro-blocker` | `CANVAS#map-canvas` |

Negative control was run by stashing the three files and re-probing — the bug
reproduced, so the probe discriminates. End to end: after a mid-flight skip, `M`
opens the map and a real click on OUTSIDE navigates to `/outside`. Boot-phase
skip (SKIP pressed before the bird appears) re-checked for regression.

⚠️ **No unit test.** This is a DOM-lifetime bug and `jsdom` is not installed
here; a jsdom-free unit test would have to mock the very lifetime it is meant to
check. The browser probe is the honest regression check — keep it.

⚠️ **`deploy.sh` builds the WORKING TREE, not HEAD.** With the other session
mid-edit, this shipped from `git worktree add … HEAD` per
`braindeadbot-deploy-working-tree`. Success banner reads `HEAD@f78bb4a`, not
`main@` — that is how you confirm the clean copy went out.

---

## 🔄 "IS THE GAME FLIPPED 180°?" — no, but the SIGN was (2026-07-26, other session)

**Commit `e1426d2`** → synology. 1419 tests pass (123 files).

### What was reported

> "help me debug/audit/run tests to figure out why its flipped 180 degrees for
> the game. the html isn't upside down only the game thats being rendered."

### The game is NOT flipped — that part was a false alarm

Reproduced the reported scene headless (tavern, `seed=42`, WebGL2) and compared
landmarks against the user's screenshot: sign lower-right, pinball table centre,
pool table upper-right, kitchen lower-left, near wall corner at bottom. **Every
landmark matches in position and handedness.** The dungeon renders upright too.

The room reads as a diamond with its near corner at the bottom because the camera
is yawed **45°** and tilted **38°** (`engine/config.ts`) — that is the intended
isometric projection, not a flip.

### What WAS broken: the ENTER MAZE marquee rendered upside down

`makeSignTexture()` in `src/scenes/tavern/props.ts` left `flipY` at three's
default `true`. A texture on a material `map` samples with **v=0 at the TOP**
under `WebGPURenderer` (both backends), while `PlaneGeometry` puts v=0 at the
BOTTOM. `flipY=true` is the compensation the **legacy** `WebGLRenderer` wanted,
so leaving it on double-flips and every glyph renders inverted. Fix is one line:
`tex.flipY = false`.

**This is the same trap as `a9eab59`** (raccoon-intro retro blit). That commit
audited *render-target* textures and correctly cleared the dungeon pixel pass
(which samples through explicit TSL `texture()` nodes) — a
`CanvasTexture`-on-a-`map` was never in its scope.

### Why this masqueraded as a whole-scene flip

The sign is the **only text in the tavern**, so a garbled sign is a strong false
cue that everything is inverted. "ENTER MAZE" with each letter flipped in place
still looks like *a* word — on screen it was being read as **"TELLER HOUSE"**,
which is what the user's screenshot shows.

⚠️ **Reasoning from the screenshot actively misled**: flipped "ENTER MAZE" looks
*mirrored*, which points at a Y-rotation or negative scale — neither of which was
wrong. Probing with **`"ABC"`** is what settled it: letter order stayed A→B→C
(so nothing is mirrored horizontally) while every glyph was inverted. Order
preserved + glyphs inverted = a **v-flip and nothing else**. If you chase a
suspected orientation bug, render an asymmetric probe rather than squinting at
production copy.

### Two things left open

1. **`selectBackend()` has ZERO test coverage** — no test file references it.
   That is the function whose regression produces a genuinely flipped screen, and
   `src/render/backend.ts` documents that the real WebGPU flip is *undetectable
   from inside the page* (forks strip their UA; an in-page RT probe
   false-positived on Chrome). Worth a test pinning `auto → forceWebGL: true`; a
   silent flip of that default cannot be recovered by probing.
2. **The WebGPU backend could not be tested at all here.** Headless SwiftShader
   reports "No available adapters" and silently falls back to WebGL2, so
   `?gpu=webgpu` is untestable in this environment (the limitation
   `scripts/playtest.mjs:260` already warns about). All verification is WebGL2.
   The genuine WebGPU flip needs real GPU hardware.

Verified the WebGL2-default guard is intact in source, in the local build, **and
on the deployed container** — probing `http://10.0.0.16:5174/dungeon` logs
`[backend] webgl (requested=auto)`. So the user was already on WebGL2.

### Gotchas hit while verifying (both cost real time)

- **`page.screenshot()` hangs** on "waiting for fonts to load" in this app. Use
  CDP instead: `context.newCDPSession(page)` → `Page.captureScreenshot`.
- **`__dungeonTavern()` returns `"no hook"` if called too early** and silently
  leaves the DUNGEON on screen — which is not the scene under test, and looks
  like a successful capture. Poll
  `waitForFunction(() => typeof window.__dungeonTavern === "function")` with a
  **60s+** timeout; the sprite-atlas boot takes ~30s under SwiftShader.

## 🗂 ONE FOLDER PER GAME + a real engine (2026-07-26)

**`main`** → synology. 1419 tests pass (123 files, was 1404/121) ·
`next build` clean · all 21 game routes load in a browser · dungeon boots and
renders (202 enemies, palette intact).

Merged into `main` on top of `cf377a9` (WebGL2 becomes the default backend);
tests and build re-run green after the merge, not just before it.

### The layout now

Every game has one parent folder under **`src/game/`** — 18 of them:
`asteroids, beer-pong, chess, chinese-checkers, cigarette, cosmic-pool,
dog-feeding, fishing, goblin-blocks, mahjong, mouse-game, mouse-poker,
pinball-knight, pirate-chest, pirate-surf, raccoon-tornado, ski-game, toucan`.

`src/objects/` is now **props + infrastructure only**. `src/room/` is rooms and
props. Games no longer live in either.

### `src/game/pinball-knight/engine/` is real, not a folder rename

The engine imports **zero game content** — enforced by
`engine/purity.test.ts`, which resolves each specifier rather than counting
`../`, and was checked with a negative control (adding `import ../state` to
`engine/profiler.ts` does fail it).

Getting there needed dependency inversion, not moves:

| Seam | Was | Now |
|---|---|---|
| `engine/config.ts` | engine imported `constants.ts` (2279 lines) for ~8 numbers | `GameEngine.installEngine()` pushes values in; `constants.ts` still owns them |
| `engine/view-state.ts` | engine read AND WROTE `state.camX/shakeT/camera` | engine owns those fields; `state` delegates via accessors — **no call site changed, tavern untouched** |
| `engine/palette-source.ts` | pass imported "Cold Crypt" | game registers its palette |
| `engine/grid.ts` | collision/AI imported `maze/generator` | tile-grid substrate split out; generator re-exports it |
| `engine/render/paint-types.ts` | `sprite.ts` imported 3372 lines of cel art for 4 types | vocabulary in engine, art stays content |

`GameEngine.ts` holds the boot wiring plus **`FixedStepLoop`**, the 60Hz
accumulator lifted out of core's RAF callback. Its three rules (clamp the delta
BOTH ways, never bank time during a hit-freeze, tick juice clocks in REAL time)
each exist because of a past bug and were untestable inline — now 12 tests.

### Two judgement calls worth knowing

- **beer-pong was NOT split** despite looking like prop+game.
  `createBeerPongTable` shares module-level mutable state (`_sceneRef`, `cups`,
  `readyBall`) with the game functions — the table IS the board. Splitting meant
  duplicating state that drifts. Moved whole; the jungle room imports the
  builder from `game/beer-pong`.
- **fishtank WAS split** — its two halves import nothing from each other, so the
  barrel was the only thing joining them → `game/fishing` + `room/props/aquarium`.
- `cc-board.ts` / `sword-prop.ts` stay with `mouse-room` (they import its
  palette `P`). The `cc-` prefix is misleading — chinese-checkers never uses it.

### ⚠️ `scripts/playtest.mjs` fails on this branch AND on `main`

Reports "dungeon hooks never appeared" while its own diagnostics print
`active: true`. **Verified pre-existing**: checked out `3d0c626` (pre-refactor)
and it fails identically. Not caused by this work. The game does boot — a direct
probe shows all hooks present at ~20s under SwiftShader, which is slower than
the harness's effective window.

## 🔌 SOCKET CONTRACT — geometry that has to mate (2026-07-26)

**`main@0a50ddc`** → synology. 1402 tests pass (121 files) · `next build` clean.

### What was reported

> "the maze still renders as a mess … we don't have a system with labels for
> what things are and where they can and can not connect like a plumbing system
> … walls that go nowhere, dead ends into dead ends, boosters that go into
> curved walls that make no sense."

Correct diagnosis, and **sockets** is the industry term for exactly that. The
track-first change fixed the *topology*; nothing validated that adjacent pieces
actually mate.

### Measured before → after (20 floors)

| Defect | Before | After |
|---|---|---|
| Dead ends | 105.8/floor | **0.4** |
| Wall stubs (nubs into rooms) | 116.4/floor | **0.5** |
| Isolated wall pillars | 5.2/floor | **0** |
| Launchers firing into a wall | 11.3% | **0%** |
| Roads ending in mid-air | 1.3/floor | **0** |

### `maze/track-socket.ts`

Every tile presents a typed socket per edge — `road` / `room` / `wall` / `rim` —
derived from the grid + lane mask (so it cannot drift), plus a compatibility
table and a validator. Same idea as WFC's arc consistency: **a piece is valid
because its edges agree with its neighbours', not because of where it sits.**
Deliberately *not* a WFC solver — the growth model already makes the layout;
this supplies the constraint and the check.

### Four root causes, each of which defeated an earlier guess

1. **Roads to nowhere were degree-1 LEAF NODES in the graph.** `pruneToCircuit`
   keeps the graph connected and loopy — neither forbids a dangling spur.
   Repairing at tile level chases its own tail (each extension becomes the new
   end of the road: "joined" fired 8-24×/floor, count never moved). Fixed
   topologically by `pruneLeaves`.
2. **The socket table first forbade `road|wall`.** Wrong: ~2800 violations per
   floor, *all* of them `road|wall`, because **a road has walls along its
   sides**. The real defect is a road *ending* at a wall — a neighbourhood
   property, now `findRoadTerminations`.
3. **An unbounded dead-end cascade UNRAVELS the maze.** A 1-wide corridor zips
   out tile by tile; off-track floor fell to **1.5% of the grid** and the level
   read as one track blob. Capped, and corridors are **widened to 2-wide**
   instead so they have no 3-walled tiles by construction.
4. **`removeWallStubs` needed a fixed point** — one pass took 86 stubs to 19,
   and the 19 were the ones it had just created.

⚠️ `vault`/`spine` launchers stay exempt on the **legacy** generator (spine
boosters carry a down-flow contract and `breakLaunchDuels` refuses to move
them). Track floors opt in via `strictLaunchers`. Pulling them in unconditionally
broke 3 tests — don't "simplify" that back.

### Still not visually verified in-engine

Same caveat as below: verified as ASCII + metrics, not a rendered screenshot.
**Please play a floor.** Dials: `linkChance` / `fill` / `chance` in
`growMazeAround`, `maxFill` in `uncarveDeadEnds`.

## 🛣️ TRACK-FIRST MAZE — the circuit is grown, then the maze fills in (2026-07-26)

**`main@16bb1b9`** → synology. 1391 tests pass (120 files) · `next build` clean.

### What was reported

> "we need to fix how the maze is rendered as you can see a lot of it just
> doesn't make any sense. we need to build a track system and then build the
> maze around it instead of just randomly putting the course together … so it's
> like a bunch of interconnected highways?"

Chosen by the user: **track-first**, with a **figure-eight-or-better circuit
that morphs every level, grown with mould-growth algorithms**.

### The root cause

The pipeline was ordered backwards:

    generateMaze → carveRooms → pickEndpoints → widenMainArtery → arcSweeps

The "track" was a CONSEQUENCE of a random maze, so it inherited every wiggle it
happened to produce. Hence the three visible symptoms: ramp fragments pointing
nowhere (`authorArcSweeps` scans for corners that *fit*, not corners the ball
takes), curves too short to ride (`artery-banks` censused 22,713 open tiles —
**81.8% have an open radius of ZERO**; radius-4 fillets fitted **4 times in 40
floors**), and nothing reading as a circuit because nothing ever was one.

### The fix — four new modules

    growTrack → buildTrackPath → carveTrack → growMazeAround → publishArcs

- **`maze/track-grow.ts`** — Physarum (slime mould) growth, the
  Tero–Takagi–Nakagawa conductivity model. Flow between food sources thickens
  tubes; decay atrophies the rest. Redundant routes survive where two paths are
  comparably good — the interconnected-highway topology a spanning tree destroys
  by construction. Seeded, so co-op peers agree.
- **`maze/track-path.ts`** — rounds every junction into a real fillet, radius
  3–7 (9.4 tiles of arc at r=7 vs the shipped 3.1).
- **`maze/track-carve.ts`** — sweeps a disc brush so lane width and corner radius
  stay independent; grows the maze around the circuit; `connectAll` guarantees
  one component.
- **`maze/track-floor.ts`** — packages it as a drop-in base grid. `decorateMaze`
  (parts/zombies/torches) is untouched.

Flag: `TRACK_FIRST` in `constants.ts` (currently `true`). The legacy path is
kept so both generators can be A/B'd on one seed.

### Bugs found by measuring, not reading

| Bug | Measurement |
|---|---|
| Reinforcement ~20× weaker than decay — every tube starved | 42/42 edges at conductivity 0.000 |
| Rank pinned at exactly 2 — an *identical* figure-eight every floor | 30/30 seeds. Food count is the dial → now rank 2–9 |
| Uncapped chord length paved the whole floor | one floor 97% track; capped → 24–47%, 0/40 runaways |
| Maze districts sealed off from the track | 83 components on one floor, **75/75 floors fragmented** → 0/75 |
| Arc probe too shallow — curves unregistered | 124 arc tiles / 113 features → 5.6 tiles per feature |
| Arcs published before the maze carved | 20.6% orphaned onto open floor → 0 |

### ⚠️ Not visually verified in-engine

`__dungeonLevel(n)` confirms `startLevel` builds real floors with the new
generator (216 and 267 zombies, 18 parts, no errors), and layout quality was
verified exhaustively as ASCII. But I could **not** get a rendered screenshot:
driving the tavern headlessly didn't reach the board, and `__tavernClose()` is
not a descend (black screen — the `dungeon-headless-descend-recipe` memory).
**Someone should play a floor and confirm it reads right.** Tunables if it
doesn't: `linkChance` (on-ramp density) and `fill` (how much rock the maze
leaves) in `growMazeAround`.

## 🧟 CARD ART — the card now SHOWS the monster (2026-07-25, this session)

**Live:** http://10.0.0.16:5174/dungeon · 1377 tests pass (119 files) · `next build` clean.

### What was reported

> "those cards are suppose to be the monster we kill. So if its a zombie we get a
> zombie card. right now we still get these skill cards we need to change it and
> make the art better."

### What was actually wrong — half the report was already fixed

The card **data** was already monsters: commit `55f90be` earlier the same day
replaced the skill-chip table with 25 monster cards (`CardDef.source`, the eight
zombie sub-types, affinity drops). That was shipped and live. There is no
skill-card code path left — every surface reads the one `CARDS` table.

What had NOT changed was the **art**, and that is why it still read as a skill
card. `holo-card.ts` painted `c.icon` — a **150px emoji** — as the entire
portrait. 🧟 rendered as a washed-out grey blob behind a speckle field, so a
"Shambler Hide" and a "Grim Scythe" looked like the same anonymous stat chip.
The card claimed an identity its art refused to draw.

### The fix

**New `src/scenes/dungeon/render/monster-portrait.ts`.** The game already owns
cel-shaded art for every monster (`cel-painter.ts` — plain canvas-2D painters
over a 128×128 box, no three.js/DOM). A portrait is just: run the same painter
the horde uses, blit it scaled into the art window. `KIND_PORTRAIT` is
exhaustive by `EnemyKind` and **mirrors core.ts's `EXPANSION_SKIN` / `RESKIN`**,
so a Wisp card shows the cyan-tinted ghost a Wisp actually is.

Then in `holo-card.ts`: portrait on a lit stage (floor pool + rarity backlight,
NEAREST sampling so the selout outlines stay crisp), foil/speckle/backdrop damped
behind the subject, a scrim under the monster nameplate, and the stage pill leads
with the monster family instead of the old "CHIP".

**Three real bugs fixed on the way:**
- Tinting was done in-place (`multiply` + `destination-in` onto itself), which
  tinted the transparent background too — the Wisp painted as a **solid cyan
  rectangle**. Now masked via a separate `destination-in` scratch layer.
- Hulk Knuckle's cooldown *penalty* rendered **`−−15%`**, and Glass Cannon's
  durability drawback looked like an upgrade. Percentages are signed honestly
  now, and cooldown says "Attack speed" / "Slower swing" since below-1 is good.
- All five variant-unfiltered zombie sub-types took `ZOMBIE_VARIANTS[0]`, so
  Hulk and Midget were one body at two zoom levels. Spread deterministically.

### Verified

`monster-portrait.test.ts` (9 tests) pins coverage for every kind + sub-type,
the tint-rectangle regression, the sub-type spread, memoisation, and the
headless-null guard. Rendered all 25 faces in **real Chrome** via Playwright —
matches the node-canvas render, so the compositing is right in the browser that
ships.

Committed and pushed to `main`, then deployed to synology.

## 🪧 "ENTER MAZE" SIGN above the tavern notice board (2026-07-25, this session)

**Commit `7d503cc`** · pushed to `main` · deployed **`main@7d503cc` → synology**
**Live:** http://10.0.0.16:5174/dungeon — container verified `healthy` after deploy.

267 tavern tests pass · `tsc` clean on the touched file.

### What was reported

> "in the pinball knight game … make it more obvious where the user has to go to
> start the game. I want a sign above that bulletin board that says Enter Maze"

Shipped exactly that: a lit marquee reading **ENTER MAZE** hangs above the notice
board on the north wall, with a cyan down-arrow in each gutter pointing at the
`board` station. All of it in `src/scenes/tavern/props.ts` — the sign geometry
sits in the NOTICE BOARD block, the legend is drawn by `makeSignTexture()` near
the top of the file.

### Why the room breaks its own rule for this one prop

`TAVERN_PLAN` says stations read from **shape plus accent colour, never text**,
and every other station still honours that. The way down is the exception
because it is the only station a first-time player *must* find: skipping the
forge costs you a socket, skipping the board means no run ever starts. The two
existing cues were not carrying it — a corkboard reads as scenery, and the cold
floor lane only points at the plunger once you are already standing in it.

### Three things the RENDER corrected that reasoning did not

Each of these shipped wrong first and was caught by screenshotting the live
tavern. **If you touch this sign, screenshot it again** — the iso projection does
not do what the world-space numbers suggest.

1. **SIZE.** First pass was 3.1 × 0.62 with the word inset in its canvas. On
   screen the caps stood ~10 pixels tall: a wall-mounted panel is foreshortened
   hard by the 38° camera, and the pixel post-pass quantises whatever survives.
   Now 4.2 × 0.8, and the glyphs are **measured and fitted** to 74% of the canvas
   width rather than sized by eye — `Press Start 2P` is a webfont that may not
   have loaded when the tavern builds, and the monospace fallback has a different
   width per em, so a hardcoded px size overflows in one case and floats in the
   other.
2. **PLACEMENT — `+z` PROJECTS DOWNWARD.** The sign leaned forward 0.16 rad and
   stood 0.06 proud of the board; both push it toward the viewer, and under a
   45°-yaw camera that also pushes it *down the screen*. The legend landed across
   the top row of notices and read as painted **on** the corkboard. Raising it
   could not fix that — the wall caps at `WALL_HEIGHT` 3.2. It now sits back at
   the wall plane (z −6.72, behind the board's −6.6 backing) at y 3.0, lean cut
   to 0.06.
3. **THE ARROWS.** Two failed attempts. Real chevron geometry beside the board
   turned into unreadable diagonal slashes (the 45° yaw rotates anything built in
   the XY plane), and the only free wall — the ~0.1 strip between the notices and
   the sign — is too thin for anything that survives the pixel pass. They are
   **painted into the texture** now. The first texture version used squat
   triangles, which came out of the projection wider than tall and read as
   sideways pennants; they are narrow with a stem so the vertical axis survives
   the squash, and filled at the letters' brightness rather than plain `COLD`
   (the glyphs get a third near-white pass and the arrows did not, which read as
   two different signs sharing a panel).

### Other edits in the same commit

- The board's hooded lantern drops **y 2.35 → 2.05**. Its hood projected directly
  over the sign's left arrow. Lower is the better light anyway — it rakes across
  the notices instead of washing them from overhead.
- `dispose()` now frees `signTex`. It disposed geometries and materials but never
  textures, because until now nothing in the tavern owned one.

### Known-good, deliberately NOT changed

**The interaction prompt still says `[E] DESCEND`,** from `STATIONS[0].label` in
`src/scenes/tavern/layout.ts:110`. The sign and the prompt therefore use
different words for the same action. Left alone as out of scope — if you want
them to agree, change that one `label` field (and the `blurb` under it);
`layout.test.ts` does not assert on the copy.

### Verification

Headless screenshot of the live tavern at spawn (x 0, z 5.4), 1400×900: the
legend is readable **at full frame without zooming**, which was the bar — the
sign has to work from the spawn stair, not just up close.

⚠️ **That verification missed that every glyph was UPSIDE DOWN** — fixed later the
same day in `e1426d2` (see the top section). "Readable at full frame" was checked
by confirming letter-shaped bright pixels filled the panel, which a v-flipped
marquee passes. A legibility check has to actually **read the word**.

Recipe: playwright at `HTML-Notes/.venv/bin/python`, chromium with
`--use-gl=swiftshader --enable-unsafe-swiftshader --no-sandbox`, `goto /dungeon`,
then poll for `window.__tavernProbe` (`__dungeonProbe` does **not** exist in the
lobby). Do **not** add `?no-intro=1` to `/dungeon` — it breaks chunk loading.
Run against `next dev` on a spare port, never a rebuild under the live
`next start`, which pins its own manifest and yields phantom missing chunks.
