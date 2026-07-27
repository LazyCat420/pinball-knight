# Handoff — braindeadbot-client

_Replaced on each deploy. Not a log; if something here is done, delete it._

> ⚠️ **Two sessions were live in this checkout on 2026-07-26.** Both are recorded
> here; neither replaced the other. **Two more were live on 2026-07-27** — the
> flow-orientation wave (`2215eff`) and the descent screen (`89d1aeb`), written
> concurrently in the same checkout. The second was committed by the first
> session at the user's instruction; see the note under it. **A third 07-27
> session (site-map readability, `ef78126`) found uncommitted pinball-knight
> edits (`boss.ts`, `boss.test.ts`, `entities/zombie.ts`) in the tree and left
> them strictly alone — committed only its own two files, deployed from a clean
> `HEAD` worktree.**

## 🗺️ SITE MAP READABLE — binarized text sprites + a 2x logical grid (2026-07-27)

**`main@ef78126`** → synology (clean `HEAD` worktree deploy). Touches only
`src/map/map-renderer.ts` + new `src/pixel/pixel-text.ts`.

### What was reported

> "the resolution for the pixels is too blurry, the words are unreadable"

### Two root causes, compounding

1. **Canvas `fillText` anti-aliases glyphs and cannot be told not to.** On the
   352px-logical surface, every grey fringe pixel became a 4×4 grey block after
   the integer upscale. `imageSmoothingEnabled=false` never touches this — the
   grey is baked into the low-res surface before the blit.
2. **Labels were VT323 at 8px — HALF that face's 16px native design size** — so
   strokes never landed on the pixel grid to begin with.

### The fix

- **`src/pixel/pixel-text.ts`**: rasterise each string once offscreen,
  threshold alpha to 0/255 (cut at 96, not 128, so a stroke straddling two
  pixels thickens instead of vanishing), cache per `(font,color,text)`, blit at
  integer coords. `clearPixelTextCache()` is called when the webfonts land —
  sprites rasterised in the fallback face must not survive.
- **Map grid doubled to 640 logical px** (every layout constant ×2, icons drawn
  at 2× cell scale, `maxScale` 6→4): same physical size on screen, twice the
  pixel detail, and labels run at VT323's **native 16px**.
- Label placement gained left/right fallbacks after below/above — recovers
  PINBALL KNIGHT, AQUARIUM, SKI SLOPE, RACCOON TORNADO in the dense middle.
- `LABEL_MAX` 13→16 ("PINBALL KNIGHT" now fits whole).

### Verified

Headless playwright screenshots at DPR 1 **and** 2, 1440×900 (`shotmap.mjs`
recipe in the session scratchpad): every label crisp at both densities;
`hitTestRoom` unchanged in structure (slop scaled with the grid). `tsc` clean
for `src/map` + `src/pixel`; `pixel-canvas.test.ts` 11/11.

### Gotchas for whoever touches this next

- `drawPixelText` assumes **solid fills** — the threshold trick breaks on
  gradients. Fine here; don't lift it somewhere it isn't.
- The dungeon's own floor map (`src/pixel/` consumer) still uses raw `fillText`
  — same mush is available there if anyone complains; the sprite cache is
  drop-in.
- The intro's SKIP button can still be up when the map opens over it
  (bottom-right, overlaps "YOU ARE HERE") — cosmetic, site-level, not the map's
  z-order.

## 👑 THE KING GUARDS HIS POST + FLOOR RULES (2026-07-27)

**`main@efe67db`** → synology. 1075 tests green · `tsc` clean · boss bar
verified absent at spawn in-engine.

### What was reported

> "the boss can't be next to the starting point. and the starting point should
> always be the corner of a map not just randomly in the middle of it unless
> it's for specific types of levels … global maze generation logic … then we can
> just cycle those theme rules with the global rules"

### The boss was never misplaced — measure before building

| | |
|---|---|
| king's spawn tile, nearest observed to the player (78 floors) | **56 BFS steps** |
| mean, as a fraction of the floor's whole reach | **68%** |

He rides the exit (`nearestOpenTile(stairs, 2)`) and the exit is already pushed
a lap away. **Placement was correct and always had been.** `spawnBoss` set
`z.aggro = true` — the one flag the generic zombie AI reads to decide whether to
chase. Every other enemy starts `false` and wakes only inside `AGGRO_TILES` *by
path distance*; the king opted out of that gate, so from the frame the floor
built he walked to the spawn and never stopped.

**No generation rule can fix a mover.** Hence `boss.ts` THE LEASH: an anchor
(his spawn = the exit), a wake radius on the same flow field the grunts use, and
a leash measured **from the anchor** so kiting him away and looping back cannot
walk him off the stairs a step at a time. Disengaged he returns home. His
barrage and slam are gated too — otherwise the leash removes the chase and
leaves the harassment, which is the worse half. 8 tests in `boss.test.ts`.

The boss bar is gated on engagement as well; it used to announce
"☠ THE REAPER KING ☠" the instant the floor built, which by itself reads as
"he's right here". `BossAux.engaged` is streamed so replicas agree.

### maze/floor-rules.ts — the registry

Rules are **scored preferences, not booleans**. "Spawn in a corner", "exit a lap
away" and "boss far from spawn" can be jointly unsatisfiable on a small floor;
applied in sequence, whichever ran last silently wins. When a rule genuinely
cannot be met the generator records a **declared relaxation**
(`TrackFloor.relaxed`) and the gate caps the rate — currently **3.8%**, capped
at 12%. A silent fallback is indistinguishable from a broken rule.

Every rule carries its own `check`, and `floor-rules.test.ts` iterates them over
78 floors — a new rule is covered the moment it joins the array. It also prints
each rule's *tightest observed margin*, which is what tells a regression guard
apart from a threshold that has drifted into irrelevance.

The archetype supplies **weights, never its own placement code**.

| archetype | perimeterBias | why |
|---|---|---|
| warrens | 0.90 | a tangle with no centre worth starting in |
| ringkeep | 0.85 | progression is working inward ring by ring |
| spine | 0.80 | start at an END of the boulevard, not halfway along |
| cavern | 0.70 | no architecture to respect |
| **greathall** | **0.15** | **the exemption** — the floor IS its central chamber |

Consumed by `carveLaunchChute` (which decides spawn on **94%** of floors) as a
**term, never a filter**: a filter would reject every site on a floor whose
circuit never reaches the border, and could override the runout gate that stops
a chute firing into a wall. The geometry band is unchanged; perimeter chooses
*within* it.

    spawn perimeterScore, mean by archetype (1.0 = hard against the edge)
      before   all five 0.35-0.42 — an 8-point spread, i.e. no archetype effect
      after    warrens 0.68  spine 0.73  cavern 0.70  ringkeep 0.68
               greathall 0.44  ← still central, on purpose

### ⚠️ Found on the way — `removeWallStubs` stopped mid-cascade

Moving the chute to the edge took the piece gate from 0 to **9 violations per
150 floors**, 8 of them wall stubs. Against a bias-off control on the *same*
floors: **2/150 before, 9/150 after** — the regression was real, the cause was
not the chute.

`removeWallStubs` iterated with `maxRounds = 6`. That is not a fixed point, it
is six waves — opening a stub creates stubs around it, and on floors needing
more the loop stopped **mid-cascade**, leaving nubs its own previous round had
manufactured. Silently. Raising the cap to a runaway guard takes **both regimes
to 0/150**, clearing the pre-existing 1.3% as well.

The piece gate's sweep is widened **40 → 150 floors** and stays zero-tolerance:
a 40-floor sample is exactly what let a 1.3% defect sit green.

**A measurement mistake worth not repeating:** the first census of this said the
two regimes were indistinguishable (5/300 vs 6/300). It built floors its own way
instead of the way the gate does, so it sampled a different population. Rebuilt
against `floorAt` verbatim, the difference was 4.5×. Copy the harness you are
comparing against.

### ⚠️ Open

- `KING_WAKE_TILES` (26) / `KING_LEASH_TILES` (34) are reasoned, not playtested.
  A test pins WAKE < LEASH (inverted, he oscillates), but the *feel* is unproven.
- The leash is world distance from the anchor; the wake is path distance. Mixing
  metrics is deliberate (you should not wake through a wall; the leash is about
  how far he has physically strayed) but if he ever behaves oddly around a thin
  wall, that asymmetry is the first place to look.
- `perimeterScore` is edge distance, not corner distance — see its comment for
  why corners were rejected. If "corner" specifically is wanted, that is a new
  rule, not a retune.

## ⏳ THE DESCENT SCREEN — the freeze was SHADER COMPILATION, not generation (2026-07-27)

**`main@89d1aeb`** → synology. Written by a **parallel session** in this
checkout; committed and shipped by the flow-orientation session because
`deploy.sh` builds `COPY . .` (the working tree, **not** HEAD), so an
uncommitted file either ships untracked or is lost on the next clean deploy.

### The measurement that reframes it

On real hardware (NVIDIA Ampere, WebGPU backend):

    buildLevel .................  544 ms
    first frame after it ....... 5103 ms   ← the freeze

WebGPU compiles a render pipeline **per distinct material, lazily**, the first
time it is drawn — so a floor's worth of shaders all landed on frame one with
the main thread blocked and nothing on screen. **A progress bar over the maze
generator would have covered a tenth of the wait**, which is the trap here.

### The shape of the fix

`floor-loading.ts` puts a descent screen up; `warmFloorPipelines` then calls
`renderer.compileAsync(child, camera, scene)` per top-level scene child (per
child, not one whole-scene call, so the bar shows real progress) while
`renderHeldForLoad` keeps the loop from simulating or rendering. Rendering early
would trigger the exact compile storm the warm-up exists to schedule. Same
technique as Unity's `ShaderVariantCollection.WarmUp` / Unreal PSO precaching.

`buildLevel` (the old `startLevel` body) stays **synchronous**: `descendInto`,
the co-op regroup, the seed-adoption rebuild and `__dungeonLevel` all rely on
the floor existing the moment the call returns.

### The other half — SHARED MATERIALS AND GEOMETRY (in `2215eff`, undocumented there)

⚠️ **This shipped inside the flow-orientation commit, not the descent-screen
one**, because the two sessions shared a checkout. `render/pinball-parts.ts` is
where it lives, and it is the half that made the descent screen affordable:
prewarming ~1400 redundant pipelines cost 10.1 s, prewarming the deduplicated
set costs ~6 s.

A live-floor census found the parts were built from private copies of identical
GPU objects:

| | instances | distinct | redundant |
|---|---|---|---|
| materials | 1707 | 504 | 70% |
| geometries | 1668 | 100 | 94% |

`std()` and six `*Geo` helpers now memoise by value. **Two invariants, and both
will bite whoever adds the next part builder:**

1. **A material an animator WRITES to must not be shared.** The `PART_ANIMATORS`
   pulse `emissiveIntensity`, most of them offset per part by `part.i` or a
   random `phase`. Share one and every part of that kind breathes in lockstep,
   last writer winning. Build those with **`stdOwn`**. The reliable tell is that
   *every animated material is the one stashed in `userData`* — that made the
   audit mechanical, and it currently balances exactly: **24 `userData` captures
   ↔ 24 `stdOwn` call sites**. If you add a builder, keep that count matched.
2. **Never dispose a shared object.** `disposePinballParts` used to traverse and
   dispose everything it found; on cached geometry that is a use-after-free the
   *next* floor renders as nothing. `releaseOwned()` skips anything flagged
   `userData.shared`. Same rule the texture cache in `maze/build.ts` states.

`ExtrudeGeometry` is deliberately left uncached — both uses `.translate()` the
result, and a shared geometry translated once per part walks off the origin.

### Verified before shipping

Booted headless against the dev server: descent screen paints, the hold
**RELEASES**, floor renders with 152 parts. That check matters more than it
looks — `renderHeldForLoad` is only cleared in a `.finally()`, so a
`compileAsync` that never settled would strand the player on the loading screen
with no way out. `tsc` clean, 1059 tests green.

### Verified LIVE on production (2026-07-27, real WebGPU)

`https://braindeadbot.com/dungeon` over host Chrome/CDP — secure context, so the
adapter is real (`nvidia/ampere`) and the backend is **WebGPU**, not the WebGL2
fallback you get over `http://<IP>`:

| | before | after |
|---|---|---|
| first frame | **5103 ms frozen** | 44 ms |
| steady p50 / p95 | 81 ms / — | **35 ms / 40 ms** |
| p95 over 40 s of bot play | — | **12 ms** (60fps budget = 16.67) |
| draw calls at spawn | 1326 | 985 |
| descent screen up | — | 220–250 ms |
| playable | ~5.6 s frozen, then hitches | 6.2 s warm / 10.1 s cold |

Zero page errors; the floor renders complete (parts, chevrons, walls) — the
visual regression sharing could have caused did not happen.

**The honest trade:** the descent is now *longer* in wall-clock (6–10 s vs
~5.6 s) because the warm-up compiles **everything**, where lazy compilation only
did what was on screen — which is precisely why the old build kept hitching for
the next 10–20 s as you moved. It is now an animated screen with no hitches
after. The cold/warm gap is Chrome's on-disk pipeline cache, so a returning
player sees the 6 s number.

### ⚠️ Open / unverified

- **No test covers `floor-loading.ts`.** The release path is guarded by
  `try/catch` + `.finally()`, but nothing pins it.
- The 5103 ms figure is from the **WebGPU** backend on a real GPU. WSL/headless
  falls back to WebGL2 ([[webgpu-needs-a-secure-context]]), where the compile
  cost is different — don't re-tune the batching against a SwiftShader run.
  Concretely: under SwiftShader steady-state frames are **~1300 ms**, so a
  `compileAsync` experiment there measured **18.4 s** and looked like it made
  things *worse*. The same experiment on the real adapter took 6.6 s and removed
  the stall. Use host Chrome over CDP and confirm
  `(await navigator.gpu.requestAdapter()).info` names a real vendor.
- **Next lever, if 6–10 s is judged too long:** warm only what is near the
  player, close the screen, and background-warm the rest on a per-frame budget
  (~8 ms). The remaining unique-material count is dominated by ~466 sprite
  materials, which are per-instance **by design** — `createStaticSprite` says
  why (`tavern/npcs.ts` tints individual keepers via `mesh.material.color`), so
  that one needs the tint case handled before it can be shared.
- Captions and phase fractions (`0.3 + 0.7 * f`) are hand-set; the bar's
  relationship to real remaining time is approximate.

## 🧭 THE TRACK RUNS ONE WAY — Φ, and the booster family (2026-07-27)

**`main@2215eff`** → synology. 1059 tests pass (93 files) · `tsc` clean for
`pinball-knight` · verified in a rendered screenshot, not just as numbers.

### What was reported

> "here's examples I boxed in red of tracks that randomly generate that make no
> sense … it's making paths that feed back into itself causing feedback loops
> where the user gets stuck. we need to make sure that MOST of the tracks are
> going one direction but have multiple paths that are possible over having one
> set path. can we make different types of boosters? … we need corner booster,
> curved boosters, more jumpers in the mix"

The screenshot boxed two booster runs a few tiles apart pointing opposite ways.

### What the census found (78 floors, the shipping `TRACK_FIRST` path)

| measure | before |
|---|---|
| launch parts firing back toward the spawn | **16.2%** (544/3364) |
| …of non-spine boosters | **57.2%** (253/442) |
| …of flippers | **42.5%** (130/306) |
| anti-parallel duels surviving `breakLaunchDuels` | **1.58/floor** — 121 of 123 spine-vs-spine |
| launchers inside a CLOSED exit-ray cycle | **130** (6.4% of chained pads) |
| `booster` share of all launch furniture | **73%** (2471 of 3364) |

### Three rule bugs

1. **`booster` and `flipper` were never in `FORWARD_FLOW_KINDS`.** A kind not in
   that set takes its heading from `classifyTopology`, which resolves a straight
   run's two ends with `rng() < 0.5`. The most common launch part on the floor
   was aimed by a **coin flip**. The old comment justified omitting `flipper`
   ("a redirect — its direction is already meaningful") and never mentioned
   `booster` at all.
2. **`breakLaunchDuels` skips spine-vs-spine by design** — which was 98% of what
   it found — and cannot represent a ring of 3+ at all. The runtime
   `BOOSTER_JAM` guard can't see those either: it trips when a pad catches the
   ball in the same SPOT twice, and in a multi-pad ring it never does.
3. **One route.** `layStationSpine` furnished the single traced artery, so the
   floor had one set path however well it was aimed.

### The fix — a scalar potential, not more pairwise repair

`maze/flow-orient.ts` builds **Φ = BFS distance to the STAIRS**. Every launch
part fires strictly downhill on Φ, so any chain of shoves is a strictly
decreasing integer sequence — **a loop is impossible rather than rare**. Because
Φ is defined on every walkable tile (not just one artery), every leg of the
grown circuit gets a consistent forward direction, which is where the multiple
routes come from: `alternateRoutes` descends Φ from far-apart heads, giving up
to `ALT_ROUTES_MAX = 3` extra roads that all drain to the exit.

**Φ is distance-to-STAIRS, not distance-from-start, and that is the whole
point.** "Further from the spawn" is satisfied by any dead-end branch, so the
old down-flow test could certify a pad firing down a pocket the exit isn't in —
which is exactly how it stayed green while 16% of pads pointed home.

`maze/flow-loops.ts` then walks the successor graph (each part's exit ray → the
part it feeds; a functional graph, so trees hanging off cycles and nothing
else), finds every cycle in one linear three-colour pass, and breaks it. **No
spine exemption** — downhill is onward by definition now, so re-aiming a route
part is safe, which is what made the old pass a no-op.

### The booster family (was: one flat pad)

- **`boostcorner`** — a turn that ACCELERATES: enters on `dir`, fires along
  `dir2` (same two-leg convention as `deflector`, so they're interchangeable in
  the plan). Replaces the "curve carry" hack — a straight pad dropped in a
  corner, which re-fired its own rebound. This one knows which leg the ball
  arrived on and **declines a rebound** instead of relaunching it.
- **`boostcurve`** — carries a **TANGENT**, not a cardinal, so a grid staircase
  renders and plays as one curved lane instead of a zigzag of axis-aligned
  arrows. It fails `|dirI| + |dirJ| === 1`, so it is excluded from every
  cardinal-only repair pass *by construction* rather than by a flag.
- **`jumppad`** — the hop, made visible. The one shot per floor that flies over
  a wall band was a `ramp` with a `vault` flag and no distinguishing mesh.

### Found on the way — the jump shot didn't exist on track floors

`strictLaunchers` is on for every track floor and lifted the `vault` exemption
from the final runway re-aim. A vault part's runway is **0 by construction**
(it's aimed at rock on purpose), so it failed `MIN_RUNWAY` on every floor and
was re-aimed down the longest open corridor — silently turning the floor's only
jump-the-maze shot into an ordinary dash pad, on every track floor since that
flag shipped. `vault` is now exempt unconditionally.

### After, same 78 floors

| measure | before → after |
|---|---|
| firing backward | 16.2% → **1.5%** |
| closed feedback cycles | 130 → **2** |
| duels | 1.58 → **0.44** /floor |
| side-by-side contraflow (the screenshot case) | 0.0137 → **0.0031** /launcher |
| launch furniture | 3364 → **9162** (booster 50%, corner 40%, + curve/jump) |

Baseline measured by re-running the census in a worktree at the **unmodified**
parent commit, not from memory.

### Two tests were proxies; they now assert the property

- The down-flow test measured **dist-from-start** — wrong field, green while 16%
  pointed home. Now Φ.
- The duel test called an **intercepted lane** a duel. Two roads converging on a
  Φ minimum with a corner booster at the meeting point is a **merge**, not a
  ping-pong; the un-intercepted predicate would have "repaired" it by re-aiming
  one road back up itself. Both the test and production `firesAt` now require a
  clear lane with **nothing that catches the ball** in between.
- Added: `NO CLOSED LOOP of shoves survives` and `route pads run STRICTLY
  downhill on Φ`.
- The station-spine chain gate went from 75%-per-seed to an **aggregate** 70%
  plus a 50% per-seed collapse detector: a floor now has up to four roads and
  therefore four times as many run-ends, so the un-chained share rises for a
  structural reason. Measured 74.1% aggregate (was 69.6% before terminus
  stations were added, 75% on the old single-road floor).

### ⚠️ Gotchas

- **`boostcorner` is NOT in `LAUNCH_KINDS`** and must not be added. Its `dir` is
  the leg the ball ARRIVES on; a pass that read `dir` as a fire direction would
  re-aim the entry. `maze/flow-loops.ts` handles it via its own `exitRay`.
- **`boostcurve` has a non-integer `dirI/dirJ`.** Anything stepping
  `p.i + p.dirI * s` over tiles must exclude it (they all gate on
  `|dirI| + |dirJ| === 1`, which excludes it automatically).
- `TANGENT_SNAP` (0.34 ≈ 20°) decides straight-pad vs curved-pad. Raise it and
  curves become staircases again; drop it and near-straight runs get curve pads
  that read as noise.
- Emissives on the new parts were tuned **from a screenshot**: at the first
  values the jump pad rendered as one white mass because its chevrons were
  `C_SHOT`, the same colour and brightness as the takeoff lip behind them. Gold
  chevrons under a `C_SHOT` lip is the hierarchy. Re-check in-engine if you
  touch them.

### Open

- **Contraflow is down 77% per launcher but the absolute count is flat** (399 →
  430 pairs/78 floors) because the floor now carries 2.7× the launch furniture.
  If the user still points at side-by-side opposing runs, the remaining ones are
  two *different roads* passing each other, both individually correct — the
  lever would be `ALT_ROUTE_GAP` (currently 6) to push alternate roads further
  apart.
- **2 closed cycles remain** out of 5535 chained launchers. Not chased; they are
  cases where `breakFlowLoops` could neither re-aim downhill nor demote (fewer
  than 3 open sides) and removal left another ring.
- `ramp` is still 22.3% backward — mostly the deliberate `KICKBACK_CHANCE`
  (0.12) plus pads whose only open lane runs uphill. Both wanted; not a bug.

## 🙃 THE FLIP, ACTUALLY FIXED THIS TIME — the PIXEL PASS was inverting every frame (2026-07-26, third session)

### What was reported

> "flip the pinball knight game so its right side up. you have attempted to fix
> this multiple times and have failed do not attempt the same tactics look at
> your work."

The user was right for the third time. `38484a6` (the six flipY=false edits, the
section this replaces) shipped, was live on prod, and the game was **still
upside down** — because that fix, like `e1426d2` before it, compensated
individual textures **inside a flipped frame** instead of fixing the frame.

### The real root cause — one line of orientation, at the present seam

Under `WebGPURenderer` (BOTH backends), sampling a **render target's** texture
with TSL `uv()` on a fullscreen quad reads it **v-flipped** relative to the
legacy `WebGLRenderer`+`ShaderMaterial` idiom. The pixel pass
(`engine/render/pixel-pass.ts`) does exactly that for every frame of the game —
so the **entire presented frame** was upside down: geometry, sprites, textures,
everything except the DOM HUD.

**Fix:** every RT sampling hop in the pixel pass now goes through `rtUv()`
(v-flipped UV). The seven `flipY=false` texture edits are **reverted** — the
textures were never wrong.

### How it was proven (do it this way next time)

1. **Reproduce in the USER'S browser, not a harness**: headless **Vivaldi** over
   CDP (`/mnt/c/Users/Barco/AppData/Local/Vivaldi/Application/vivaldi.exe`,
   same recipe as playtest's `--gpu`) against prod. Landmarks matched the
   user's screenshot exactly.
2. **Pure-math oracle, no rasterizer**: replicate the camera from source
   constants (tilt 38°, yaw 45°, dist 24, ortho, zoom 0.78, target at spawn)
   and `project()` landmark world positions. The ENTER MAZE sign (y 3.0, north
   wall) projects to the screen **top**-right; the render had it **bottom**-
   right, in exactly the v-mirrored position. x preserved + y mirrored ⇒
   composite v-flip, not a yaw/mirror bug.
3. **The bloom parity clincher**: the "fireflies" floating in the void were the
   marquee's bloom, v-mirrored from its diffuse. Diffuse path = 1 RT sampling
   hop (odd ⇒ flipped), bloom path = 4 hops (even ⇒ upright). One flip **per
   hop** is the only model consistent with both — that pinned the seam without
   touching a line of code.
4. **Why the texture fixes fooled review**: with `flipY=false`, a texture is
   pre-inverted, so the flipped composite flips it back to readable — "ENTER
   MAZE" read fine on a frame where the KNIGHT WAS STANDING ON HIS HEAD (crop
   the sprites next time; sprite.ts keeps flipY=true so sprites showed the
   truth all along).

### Verified after the fix (dev server, real browsers over CDP)

| Oracle | webgl (Vivaldi) | webgpu (Chrome, real Dawn) |
|---|---|---|
| Marquee ABOVE notice board, top of screen | ✓ | ✓ |
| "ENTER MAZE" glyphs upright, arrows point DOWN at board | ✓ | ✓ |
| Player + NPC sprites head-up | ✓ | ✓ |
| Dartboard low on the SOUTH wall (5.9, 6.6) | ✓ | ✓ |
| Bloom registered on its source (no void bokeh) | ✓ | ✓ |

1427 pre-existing tests pass. (One failure in the full run is `__census.test.ts`,
an untracked in-flight file belonging to the parallel session — it passes alone.)

⚠️ Open, webgpu-only, **Vivaldi-only**: headless Vivaldi with `?gpu=webgpu`
renders a black canvas (zero console errors). Chrome webgpu is fine. Prod is
http-over-IP (insecure context ⇒ no `navigator.gpu`) so every prod visitor gets
webgl regardless; this only matters if prod ever moves to https.

### The backend default (unchanged by this session)

`auto` resolves to WebGPU, falling back to WebGL2 when `navigator.gpu` is
absent (i.e. all of http-over-IP prod today). `cf377a9`'s "WebGPU renders
upside down on some forks" attribution stays retired — the flip was the pixel
pass, on every backend.

⚠️ **Sprite atlas exception still real**: `engine/render/sprite.ts` computes
`offset.y = (rows-1-row)/rows`, which depends on `flipY=true`. It was correct
before, throughout, and now.

### ⚠️ How to test WebGPU from WSL — and why `?gpu=webgpu` alone proves nothing

**Headless SwiftShader has NO WebGPU adapter.** It logs "No available adapters",
`WebGPURenderer` silently falls back to WebGL2, and the page still reports
`__renderBackend === "webgpu"`. A run that looks like WebGPU but is not.

Working recipe: drive **host Windows Chrome over CDP**
(`/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`, `--headless=new
--remote-debugging-port=<p> --remote-allow-origins=* --user-data-dir=C:\Temp\...
--enable-unsafe-webgpu`), then `chromium.connectOverCDP`. WSL2 forwards listening
ports, so the WSL dev server on :5174 is reachable as `localhost`. Always assert
`navigator.gpu` **and** that `requestAdapter()` returned an adapter. The tell that
you are really on Dawn: Chrome logs "The powerPreference option is currently
ignored … on Windows". `scripts/playtest.mjs --gpu` already implements the pattern.

### `selectBackend()` now has tests — it had ZERO

`src/render/backend.test.ts`, 8 tests. This is the one function whose regression
flips the screen or silently downgrades the renderer, and `backend.ts` documents
that neither is detectable from inside the page. **Negative-controlled**:
restoring `forceWebGL = true` fails 4 of the 8, so the guard is not vacuous.

### ⚠️ METHOD WARNING — how the first pass got it wrong

The earlier session compared its own headless render against the user's
screenshot, found every landmark matching, and concluded "not flipped". **Both
images were flipped**, so they agreed. Comparing a suspect against another suspect
proves nothing.

What actually worked was an **absolute** oracle — an object whose correct
orientation is knowable from the source alone:
- `makeFlameTexture` paints tongues from `base = F - 4` (canvas BOTTOM) **upward**
  via `base - h`. So the wide base belongs at the bottom and the tip points up.
  On screen it was tip-down. That is decisive without any reference image.
- `makeWallTexture`'s own comment says moss is "denser at the bottom". It was
  rendering at the top.

Sprites and the HUD are drawn in screen space and stayed upright throughout, which
is exactly why this read as "everything except the UI is upside down" and why a
landmark-position check could not see it.

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

## 🔄 The flip's history, for anyone reading old commit messages (2026-07-26)

Three attempts are cited in commits; only the third is correct:
- **`e1426d2`** "the ENTER MAZE sign rendered upside down" — flipped the sign
  texture inside a flipped frame; its write-up's "the game is NOT flipped" was
  wrong (suspect-vs-suspect comparison).
- **`38484a6`** "the dungeon was upside down — flipY on canvas textures" —
  flipped six more textures inside the same flipped frame; its "verified
  upright" screenshots were textures double-flipped back to readable while the
  sprites in the same frame stood on their heads.
- The **pixel-pass `rtUv()` fix** at the top of this file is the root cause;
  both earlier commits' texture edits are reverted by it.

⚠️ **For the parallel session**: a `git stash` mishap briefly yanked your
in-flight edits; everything was restored from `stash@{0}` except
`jungle-controller.ts`, where your NEWER working-tree version was kept.
`stash@{0}` is intentionally left in place as a safety net — drop it once
you've confirmed nothing is missing.

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
