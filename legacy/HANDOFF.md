# Handoff — braindeadbot-client / -service

_Replaced on each deploy. Not a log; if something here is done, delete it._

**Live:** client `3207487`, service `dee17f0`, both on synology, both verified
against the running containers (not dev).

- Client — http://10.0.0.16:5174 · Service — http://10.0.0.16:5175
- 602 client tests, 28 service tests, production build clean.
- Repo tsc errors ~5970 (all pre-existing, in `src/objects` / `src/main.ts`).
- `src/scenes/dungeon`, `src/scenes/tavern`, `src/pixel`, `src/map`,
  `src/services` all typecheck at **0 errors**. Keep them there.

---

## What's live

**Pinball Knight (`/dungeon`)** — the game. Recent structural change: pinball
part collision moved to `entities/pinball-collide.ts` as an exhaustive
`Record<PinballPartKind, handler>`, so adding a part kind is a compile error
until it's handled.

**The Tavern (`src/scenes/tavern/`)** — a walkable isometric room between
floors, not a menu. Five stations plus a descend gate plus a casino corner. Five
keepers, each with its OWN paint and idle loop, room tone, hearth/forge VFX.
Socketed cards show as rune plates on the weapon in the armory vice.

**The Gambler** — a casino cabinet at the tavern station (2.2, 5.5): slots,
roulette, darts, blackjack. All four playable. Slots has a drawn cabinet
(bezel chase bulbs, printed paytable, coin slot, payout tray, attract mode)
and seven procedural SFX in `gambler/audio.ts`.

**Maps** — the site room map (`M` outside the dungeon) is pixel art; the dungeon
has fog of war, a HUD minimap, and a full floor map on `M`.

**Leaderboards** — `game_scores` table with a `game` discriminator. Pinball can
write scores; **it doesn't yet** (see below).

## This pass — pixel fidelity

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

1. **Play the tavern and judge the walk speed.** `WALK_SPEED` went 3.4 → 4.6,
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
