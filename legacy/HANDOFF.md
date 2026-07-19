# Handoff — braindeadbot-client / -service

_Replaced on each deploy. Not a log; if something here is done, delete it._

**Live:** client `6e3469f`, service `577c6b7`, both on synology, both verified
against the running containers (not dev).

- Client — http://10.0.0.16:5174 · Service — http://10.0.0.16:5175
- 482 client tests, 28 service tests, production build clean.
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

6. **Legacy type debt.** ~5969 repo-wide tsc errors, masked by
   `ignoreBuildErrors: true` in `next.config.js`. They're concentrated in
   `src/objects` (2633) and `src/room` (1914) — old JS renamed to `.ts`. Not
   worth a sweep; just don't let the clean directories regress.

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
- **Placement bugs in a 3D scene are silent.** Twice this session something was
  positioned inside geometry and simply never rendered — nothing threw, no test
  failed, only a screenshot showed it. All tavern placement therefore lives in
  `scenes/tavern/layout.ts` as pure data with assertions. Put new placement
  there.
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
