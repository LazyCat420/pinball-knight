# Handoff — braindeadbot-client

_Replaced on each deploy. Not a log; if something here is done, delete it._

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

Recipe: playwright at `HTML-Notes/.venv/bin/python`, chromium with
`--use-gl=swiftshader --enable-unsafe-swiftshader --no-sandbox`, `goto /dungeon`,
then poll for `window.__tavernProbe` (`__dungeonProbe` does **not** exist in the
lobby). Do **not** add `?no-intro=1` to `/dungeon` — it breaks chunk loading.
Run against `next dev` on a spare port, never a rebuild under the live
`next start`, which pins its own manifest and yields phantom missing chunks.
