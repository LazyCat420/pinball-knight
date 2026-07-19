# Handoff — braindeadbot-client / -service

_Replaced on each deploy. Not a log; if something here is done, delete it._

**Live:** client `8b544f0`, service `dee17f0`, both on synology, both verified
against the running containers (not dev).

- Client — http://10.0.0.16:5174 · Service — http://10.0.0.16:5175
- 482 client tests, 28 service tests, production build clean.
- Repo tsc errors ~5975.
- `src/scenes/dungeon`, `src/scenes/tavern`, `src/pixel`, `src/map`,
  `src/services` all typecheck at **0 errors**. Keep them there.

---

## What's live

**Pinball Knight (`/dungeon`)** — the game. Recent structural change: pinball
part collision moved to `entities/pinball-collide.ts` as an exhaustive
`Record<PinballPartKind, handler>`, so adding a part kind is a compile error
until it's handled.

**The Tavern (`src/scenes/tavern/`)** — a walkable isometric room between
floors, not a menu. Five stations plus a descend gate plus a casino corner. Four
keepers with idle loops, room tone, hearth/forge VFX. Socketed cards show as
rune plates on the weapon in the armory vice.

**The Gambler** — a casino cabinet at the tavern station (3.0, 5.6): slots,
roulette, darts, blackjack. All four playable.

**Maps** — the site room map (`M` outside the dungeon) is pixel art; the dungeon
has fog of war, a HUD minimap, and a full floor map on `M`.

**Leaderboards** — `game_scores` table with a `game` discriminator. Pinball can
write scores; **it doesn't yet** (see below).

**The jungle room (`/`) was relit and decluttered.** It used to be lit by six
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

## Open items

Ordered by what I'd do first.

1. **The dungeon never submits scores.** The service is ready (`POST
   /api/scores` with `game: "pinball-knight"` and a JSON `detail` blob) and
   `src/services/score-service.ts` is game-aware, but nothing in
   `scenes/dungeon/` calls it. Death or descent should post score/floor/combo.
   This is the biggest gap between "built" and "useful".

2. **`render/pinball-parts.ts` still has the old shape.** Two if/else chains
   (~42 branches) over `part.kind` for mesh building and animation. Collision was
   converted to an exhaustive record precisely because a missing branch there
   was silently applying the wrong physics for months; these two are the same
   hazard, unconverted.

3. **`LevelPlan` is dropped after `buildMaze`.** `LevelPlan.rooms` carries room
   archetypes (speedway / bumper / arena / vault) and `LevelPlan.frog`, but only
   the `state.maze` handle survives `startLevel`. Stash the plan on `state` and
   the floor map can label rooms.

4. **Minimap has no off-screen stairs indicator.** Once the stairs are outside
   the 23×23 window there's no hint which way to go.

5. **Tavern polish:** no camera zoom on station focus; the central pinball
   diorama animates on a timer rather than reflecting the actual run (lit
   bumpers should mean completed targets, the ball should move after a strong
   floor); keepers don't react to being approached.

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

8. **Pirate Surf never asks for a player name.** It now posts to the shared
   board, and the server defaults the name to `"???"`. Every surf entry will read
   the same until someone adds a name prompt. Ski already collects one.

9. **`SurfUI` declares no fields**, so every property access on it is a tsc
   error — including the new `_scoreSaved`. That's the file's existing pattern,
   not a new break; typing the class is its own change.

10. **The contract is still hand-copied across the two repos**, deliberately —
    `GameId` in `score-service.ts` mirrors `GAME_IDS` in the service by comment,
    and the 1–12 name rule exists on both sides. Keeping the repos decoupled was
    the explicit call. Drift shows up as a runtime 400, never a type error, so
    when you add a game remember it is TWO edits.

11. **`render/pinball-parts.ts`** still has the two ~42-branch if/else chains
    over `part.kind` (see item 2) — unchanged, still the same silent-miss hazard.

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
- **`NEXT_PUBLIC_*` is inlined at BUILD time, so it must be a build ARG.**
  Setting it in `docker-compose.yml` under `environment:` looks right and does
  nothing — the bundle was already compiled. If the leaderboard ever goes quiet
  again, grep `.next/static/chunks/` for `localhost:5175` before debugging
  anything else; zero hits means the wiring is intact.
- **The mouse den's seats put their local origin at their BASE, not their
  centre.** The old chairs centred on the seat and floated 0.065 above the floor
  because the leg reach had to be computed by hand. Keep new props origin-at-base
  so `set(x, SEAT_FLOOR_Y, z)` is the only number that can be wrong.
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
