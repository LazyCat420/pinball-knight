# 🗡️ Dungeon Crawler — Blueprint

**Working title:** Crypt of the Braindead
**Route:** `/dungeon`
**Entry point:** a sword propped in the back-left corner of the **mouse room**.
**Pitch:** 8-bit, top-down, Diablo-2-flavoured maze crawler. A hero, a procedurally
generated maze, and zombies. Kill everything, find the stairs, descend. Each level
generates a different maze pattern.

Status: **plan only — no code written yet.**

---

## 1. Guiding decisions (read this part first)

### 1.1 The art direction is the hard part, not the game

The gameplay (maze + player + zombies) is a weekend of work. Making it *look*
genuinely 8-bit — and not "3D game with a blur filter on it" — is the thing that
will make or break this. So **Phase 0 is a style sandbox with no gameplay in it at
all.** We nail the look on a static screen, then build systems behind it.

### 1.2 How we get the 8-bit look

Three techniques stacked, all of which the repo can already support (three.js
0.185 is already a dependency):

**(a) Low-resolution render target + nearest-neighbour upscale.**
Render the whole 3D scene into a `WebGLRenderTarget` at a fixed tiny resolution
(**320×180**, 16:9), then blit that to the screen as a full-screen quad with
`THREE.NearestFilter`. Every pixel becomes a chunky, honest pixel. This is what
makes 3D geometry read as 8-bit rather than as low-poly.

Critically: the render target is a **fixed** size regardless of window size. The
upscale factor changes, the pixel grid never does. This is the single most
important rule — if the internal resolution scales with the window, the art
"breathes" and the illusion dies.

**(b) Palette quantization.**
A fragment shader on the blit quad snaps every output colour to the nearest
entry in a fixed **32-colour palette**. This is what kills the giveaway
smooth-gradient shading of a modern renderer. It also forces visual coherence for
free — procedural geometry and hand-drawn sprites land in the same colour space
automatically, so they can't clash.

Optionally add ordered (Bayer 4×4) dithering *before* the snap, which buys back
apparent colour depth in the classic way.

**(c) Sprites for anything that moves, geometry for anything that doesn't.**
This is exactly what Diablo 2 did: a 3D-ish world, but characters were 2D sprite
sheets rendered from 8 angles.

- **World** (walls, floor, props, stairs, doors): real three.js geometry, boxes
  and planes, instanced. Lit, casts shadows, feels 3D.
- **Actors** (player, zombies, items, projectiles): **billboarded pixel sprites**
  on camera-facing planes. Frame-by-frame animation. Unlit or minimally lit.

The mix is what produces the Diablo-2 feel. Pure geometry would look like Minecraft;
pure sprites would look like a SNES game.

### 1.3 Where the pixel art comes from

There is no artist on this project and no sprite sheets in `public/`. So: **sprites
are authored in code as pixel matrices**, the same way `mouse-room.ts` already
defines its maze pattern as a nested array of `0`/`1`.

```ts
// sprite-sheets.ts — a frame is rows of palette indices; 0 = transparent
const ZOMBIE_WALK_S = [
  [0,0,3,3,3,3,0,0],
  [0,3,2,3,3,2,3,0],   // 2 = eye socket, 3 = rotten green
  [0,3,3,3,3,3,3,0],
  ...
];
```

At load, each frame is painted into an offscreen `<canvas>` and packed into a
single `CanvasTexture` atlas; the sprite billboard just offsets its UVs per frame.
Zero binary assets, zero build step, fully diffable in git, and editable by anyone
who can count squares.

This is not a workaround — it is **already the house style**. Almost every texture
in this codebase is a runtime `THREE.CanvasTexture` drawn with 2D canvas calls
(`fishtank/aquarium/textures.ts`, `record-shelf.ts`, `window.ts`, `cosmic-pool.ts`,
`mouse-room.ts:3125`). There are barely any image files. We're doing the same thing,
just with a pixel-matrix source.

**Start at 16×16 px per actor frame.** Small enough to hand-author, big enough to
read.

### 1.4 Animation scope for v1 — deliberately small

Diablo 2 used 8 facing directions. That's 8× the art. **We ship 4 directions**
(N/S/E/W), and mirror E→W in the shader so we only *author* 3. Per direction:

| Animation | Frames | Notes                          |
| --------- | ------ | ------------------------------ |
| Idle      | 2      | subtle breath/sway             |
| Walk      | 4      | classic 4-frame cycle          |
| Attack    | 3      | player only, in v1             |
| Death     | 4      | zombie only, plays once        |

Player: 3 dirs × (2 + 4 + 3) = 27 frames. Zombie: 3 dirs × (2 + 4 + 4) = 30 frames.
That's the entire art budget for v1. It's very achievable.

### 1.5 Physics: we do **not** use Rapier or cannon-es for v1

Both are in `package.json`, but a top-down grid maze does not need a physics
engine — it needs circle-vs-AABB resolution against a tile grid, which is ~40
lines and is deterministic, debuggable, and free. Bringing in Rapier here would
add a WASM load, a fixed-timestep loop, and a whole coordinate-sync problem to
solve a problem we don't have.

Revisit only if we later want physics-y loot scatter, knockback ragdolls, or
destructible walls. Noted as a Phase 5 "maybe".

---

## 2. Where it plugs into the existing app

The codebase has a clean, repeatable pattern for this and we follow it exactly.
A game is a **fullscreen overlay that owns its own renderer**, launched from a
clickable prop, torn down back into the room.

### 2.1 The five integration points

| # | File | Change |
| - | ---- | ------ |
| 1 | `src/objects/sword-prop.ts` | **new** — `createSwordProp(scene) → { group, hitbox }` |
| 2 | `src/objects/mouse-room.ts` | Wire the prop in: hover, click, `_launchDungeon()`, guard flag, teardown |
| 3 | `src/main.ts` | `registerRoute("/dungeon", …)` — lazy `import()` of the game |
| 4 | `src/map/map-data.ts` | Add a `/dungeon` entry (`parentRoom: "mouse"`) so it shows on the map |
| 5 | `src/utils/gold-hud.ts` | Add `"dungeon-game": "🗡️ Dungeon"` to `SOURCE_LABELS_MAP` |
| 6 | `src/objects/dungeon-game/` | The game itself (new folder) |

`mouse-room.ts` is already **3333 lines**. The sword mesh goes in its own module
following the `src/objects/cc-board.ts` precedent (which is how the Chinese
Checkers table is built and returned to the room), rather than adding a seventh
`_createX()` to an already-huge file.

### 2.2 The sword in the corner

The mouse room is **10 wide (x ∈ [-5, 5]) × 8 deep (z ∈ [-4, 4])**, floor at
**y = -1**, walls rising to y = +4. (Confirmed in `mouse-room.ts:328-342, 372-376`.)

The three existing games (mahjong pipe, maze, chinese checkers) all live *on the
table* and are only clickable **after** you zoom into the table. The sword is
different — it's a room-level prop, so it must be clickable **without** zooming,
like the table itself is.

That means it goes in the `if (!_zoomedIn)` branch of `_onClick()`
(`mouse-room.ts:2533-2542`), alongside `tableHitbox` — *not* in the zoomed-in
branch with the other games.

**Placement:** back-left corner, leaning against the wall.

```
position ≈ (-4.35, -0.35, -3.45)   // tucked into the corner, base on the floor
rotation ≈ z: +0.28 rad, y: -0.79  // leaning into the corner, blade angled out
```

**Build:** a `THREE.Group` of primitives, matching how every other prop in this
room is made (`_createPipeDoor()` at `mouse-room.ts:2320` is the cleanest
self-contained reference — prop mesh + invisible hitbox + glow):

- blade — tapered box, cool steel (add `steel: 0xc8ccd4` to the `P` palette)
- crossguard — box, gold (`P.mazeBorder` already reads well in this room)
- grip — dark leather box
- pommel — small box or low-poly sphere
- a nonzero `emissive` on the blade **is required** — the hover glow works by
  ramping `emissiveIntensity`, so a material with `emissive: 0x000000` cannot glow

**Hitbox — add it to the scene root, not to the group.** Every existing hitbox does
this, because the click dispatch uses non-recursive
`intersectObject(hitbox, false)`; a hitbox parented to the group would never be
hit.

```ts
swordHitbox = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 1.6, 0.6),          // generous — it's a thin object
  new THREE.MeshBasicMaterial({ visible: false }),
);
swordHitbox.position.copy(swordGroup.position);
swordHitbox.name = "sword-hitbox";
scene.add(swordHitbox);
```

**Interaction:** mirrors the existing hover system exactly — throttled hover raycast
(`_updateHover`, already capped to ~15fps via `_HOVER_THROTTLE_MS`),
`emissiveIntensity` ramp on hover, cursor swapped to the existing
`/pixel-cursor-pointer.png`, and a `labelDiv` tooltip ("🗡️ The Crypt").
The hover raycast must go in the **`!_zoomedIn`** branch, or the cursor will never
change.

Test the sword hitbox **before** the table hitbox in that branch, so a sword click
near the table edge doesn't get swallowed by a zoom.

**Launch:** `_launchDungeon()` is a copy of `_launchMaze()`
(`mouse-room.ts:2935-2955`) — cancel the room's `animId` (stop *rendering*, not just
CSS-hide), hide the room canvas and label, call `launchDungeonGame(onExit)`, and on
exit restore the canvas + restart the loop.

Three easy-to-forget bits of bookkeeping:
- add `dungeonGameRunning` to the early-return guard at the top of `_onClick`,
  `_onMove`, **and** `_onKey` (all three check the same running-flags list)
- null out `swordHitbox` / `swordGroup` in `_exitRoom()` (`mouse-room.ts:228-231`)
- optionally add `{ emoji: "🗡️", label: "The Crypt", … }` to the game-select
  overlay's `games` array (~line 2857). Chess, Poker and Cigar are overlay-only
  entries with no 3D hitbox, so the two systems are independent — the sword can
  have a hitbox, an overlay button, or both.

### 2.3 Game lifecycle contract

Every game here exposes the same three functions (`mouse-game/index.ts`):

```ts
export { launchDungeonGame, exitDungeonGame, isDungeonGameActive } from "./core";
```

And `launchDungeonGame()` does what `mouse-game/core.ts:24` does:
create a fixed-position overlay `<div>` at `z-index: 10000`, `stopPropagation()` on
its clicks, spin up its **own** `WebGLRenderer` / `Scene` / `Camera`, call
`setInputOwner("dungeon-game")` so the room stops listening to the keyboard, and
run its own RAF loop. On exit: `clearInputOwner()`, dispose everything, remove the
overlay, fire `onExitCallback()`.

---

## 3. Module layout

Mirrors `mouse-game/`, which is already well-factored (a `state.ts` singleton, a
`constants.ts` of tuning values, one file per concern, `dispose.ts` that tears it
all down). Nothing here should be novel.

```
src/objects/dungeon-game/
├── index.ts            # public API: launch / exit / isActive
├── core.ts             # lifecycle, the RAF loop, system orchestration
├── state.ts            # the module state singleton
├── constants.ts        # ALL tuning numbers (speeds, damage, spawn counts)
│
├── render/
│   ├── palette.ts      # the 32-colour palette, as hex
│   ├── pixel-pass.ts   # 320×180 render target + nearest upscale + quantize shader
│   ├── sprite.ts       # pixel-matrix → CanvasTexture atlas → billboard sprite
│   ├── animator.ts     # frame timing, direction picking, clip state machine
│   └── sprite-data.ts  # THE PIXEL ART: player + zombie frames as arrays
│
├── maze/
│   ├── generator.ts    # grid → maze. Pluggable algorithms (see §5)
│   ├── decorate.ts     # place stairs, torches, props, spawn points
│   └── build.ts        # maze grid → InstancedMesh walls + floor
│
├── entities/
│   ├── player.ts       # movement, attack, health, facing
│   ├── zombie.ts       # spawn, AI, chase, attack, death
│   ├── ai.ts           # BFS flow-field pathing over the maze grid
│   └── combat.ts       # hit resolution, damage, knockback, i-frames
│
├── collision.ts        # circle-vs-grid resolution (no physics engine)
├── camera.ts           # top-down / slight-tilt follow cam
├── input.ts            # WASD + mouse, and mobile touch controls
├── ui.ts               # HUD: health orb, level, kill count
├── audio.ts            # WebAudio SFX, procedural (see mouse-game/audio.ts)
└── dispose.ts          # tear down geometry, materials, textures, listeners
```

---

## 4. The pixel pipeline in detail

### 4.1 `pixel-pass.ts`

```
scene ──render──▶ WebGLRenderTarget (320×180, NearestFilter, depth buffer)
                            │
                            ▼
              full-screen quad, ShaderMaterial
              ├─ optional Bayer 4×4 ordered dither
              ├─ snap to nearest palette colour
              └─ optional subtle scanline / vignette
                            │
                            ▼
                    canvas (window size)
```

Notes:
- Render target is **fixed** at 320×180. On resize we only change the CSS size of
  the output canvas and letterbox to preserve 16:9. The pixel grid never changes.
- `renderer.setPixelRatio(1)` — deliberately ignore devicePixelRatio. We *want*
  big fat pixels on a retina screen.
- The blit quad uses an `OrthographicCamera` and needs no `EffectComposer`
  dependency — it's ~60 lines by hand, and the repo has no postprocessing setup
  today, so let's not add one for a single pass.

### 4.2 `palette.ts`

A curated 32-colour ramp, dungeon-appropriate: cold stone greys, torch oranges,
rot greens, blood reds, plus a small skin/steel/gold set. Kept as a flat array; the
quantize shader gets it as a `uniform vec3[32]`.

Nearest-colour in **linear RGB with a luma weight** looks noticeably better than
naive Euclidean distance in sRGB — worth the extra four lines.

### 4.3 `sprite.ts` + `sprite-data.ts`

- Each frame is an `N×N` array of palette indices (`0` = transparent).
- On init, all frames for an actor are painted into one offscreen canvas laid out
  as a horizontal strip → one `CanvasTexture`, `NearestFilter`, `magFilter` +
  `minFilter` both nearest, `generateMipmaps: false`.
- The billboard is a `PlaneGeometry` with a `MeshBasicMaterial` (or a lit variant
  if we want torches to affect actors — start unlit, it's more authentically 8-bit).
- Billboarding: since the camera is fixed-angle top-down, we don't need true
  spherical billboarding — just set `sprite.rotation.x = -cameraTilt` once. Cheaper
  and it keeps sprites pixel-aligned, which true billboarding would break.
- **Pixel alignment matters:** snap sprite world positions to the render-target
  pixel grid before drawing, or the sprites will shimmer as they move. This is the
  #1 bug that makes 8-bit 3D look wrong, and it will *not* be obvious why until
  someone names it.

### 4.4 `animator.ts`

A tiny clip state machine per actor:

```ts
type Clip = "idle" | "walk" | "attack" | "death";
// { frames: number[], fps: number, loop: boolean, onEnd?: () => void }
```

Direction is derived from the actor's velocity (or attack vector), quantized to
N/S/E/W. East is West mirrored via `texture.repeat.x = -1` on a cloned material.

---

## 5. Maze generation

`generator.ts` produces a `Grid` — a 2D array of tile enums:

```ts
enum Tile { Wall, Floor, Door, StairsDown, Spawn }
```

Everything downstream (build, AI pathing, collision, spawn placement) reads only
this grid, so the *algorithm is swappable* and each level can pick a different one.
That directly serves "the maze generates different patterns for each level."

| Algorithm | Character it produces | Use for |
| --------- | --------------------- | ------- |
| **Recursive backtracker** | Long, winding, few dead ends. Claustrophobic. | Levels 1–2. Simplest to write; ship this first. |
| **Prim's / Kruskal's** | Bushy, many short dead ends. Maze-y. | Mid levels |
| **Rooms + corridors** (BSP) | Actual *rooms* joined by halls. The Diablo feel. | Later levels, boss floors |
| **Cellular automata** | Organic caves, no right angles. | A "caverns" theme break |

v1 ships **recursive backtracker only**, with the `Grid` interface designed so the
others drop in without touching anything else. Don't build all four up front.

Per-level after generation, `decorate.ts`:
- carves a start cell and places the player
- places `StairsDown` at the maximum BFS distance from start (guarantees a real
  journey, never a stairs-next-to-spawn anticlimax)
- scatters zombie spawns weighted *away* from the player start
- places torches at wall junctions for lighting + landmarking

Level N scaling: grid size, zombie count, and zombie speed all step up with N.
All of it lives in `constants.ts` as a single tunable curve.

### 5.1 Building the geometry

Walls are one **`InstancedMesh`** of box geometry — one draw call for the whole
maze regardless of size. Floor is a single plane with a tiling nearest-filtered
texture. This is what keeps it fast even on a big grid.

---

## 6. Entities & AI

### 6.1 Player
Grid-free continuous movement (a circle of radius r), WASD / left-stick.
Attack is a short-range **arc in front of the facing direction** — check zombies
within radius R and within ±60° of facing. No projectiles in v1. Attack has
windup/active/recovery frames matching the 3-frame attack animation, so the
animation and the hitbox agree.

Health, i-frames on hit, knockback. Death → game over screen → retry.

### 6.2 Zombies
Slow, dumb, numerous — that's the fantasy. They should be threatening in a group
and trivial alone.

**AI (`ai.ts`): a BFS flow field.** Once per ~250ms (not per frame), run a BFS from
the player's tile across the whole walkable grid, producing a "distance to player"
field. Each zombie just walks downhill on that field. This gives *every* zombie
correct maze-aware pathing for the cost of **one** BFS per tick, instead of an A*
per zombie per frame. It is the right call at this scale and it scales to hundreds
of zombies.

States: `idle` (until player within aggro radius or line of sight) → `chase`
(follow flow field) → `attack` (in contact, wind up, deal damage) → `dead`
(play death clip once, then despawn).

### 6.3 Combat
Centralized in `combat.ts` so damage numbers, i-frames, knockback, and death all
resolve in one place rather than being smeared across player and zombie.

---

## 7. Camera

Top-down with a **slight tilt** — a true 90° overhead loses all the sprite art
(you'd see the tops of everyone's heads), and full isometric fights the square
grid. Diablo's actual angle is roughly 30–35° from horizontal.

**Start:** `OrthographicCamera`, tilted ~35°, fixed rotation, smoothly following the
player with a small dead-zone so it doesn't jitter on every micro-movement.
Orthographic (not perspective) because it keeps the pixel scale *constant* across
the screen, which perspective would ruin — a sprite at the top of the screen would
be a different pixel size than one at the bottom.

Camera position must also be **snapped to the pixel grid** (same reason as §4.3).

---

## 8. Build phases

Each phase is independently reviewable and leaves the game in a runnable state.

### Phase 0 — Style sandbox ⭐ *do this first, alone, and stop*
Route `/dungeon` renders a **static scene**: a hand-placed 8×8 stone room, one
torch, the player sprite standing in the middle, one zombie. No input, no AI, no
maze. The full pixel pipeline (§4) is live.

**Exit criteria: it looks right in a screenshot.** We iterate on palette, sprite
scale, internal resolution, camera tilt, and lighting here — and *nowhere else*.
Getting this wrong and discovering it in Phase 4 means redoing Phase 4.

### Phase 1 — It moves
WASD input, collision against the grid, walk/idle animation with 4-way facing,
follow camera. Still a hand-made room, still no maze, still no AI. The zombie is a
statue.

### Phase 2 — It's a maze
Recursive-backtracker generator, instanced wall build, stairs placement, torch
decoration, level counter. Descend the stairs → regenerate → level 2. Zombies are
still statues.

### Phase 3 — It's a game
Zombie flow-field AI, chase/attack, player attack arc, damage both ways, death,
game over + retry. HUD. **This is the first genuinely playable build.**

### Phase 4 — It's got juice
Procedural WebAudio SFX (follow `mouse-game/audio.ts`), hit flash, screen shake,
blood pixels, torch flicker, damage numbers, gold drops wired into the existing
`gold-wallet.ts` (`addGold(amount, "dungeon-game")`), localStorage best-depth.

### Phase 5 — Maybe / later
Alternate maze algorithms, more enemy types, loot & equipment, boss floor,
leaderboard via the service's `/api/scores` (would need a new table — today it only
has `raccoon_scores`), Rapier for physics-y knockback.

---

## 9. Conventions this must follow

Inferred from the codebase (there is **no `CLAUDE.md`**, and the **`README.md` is
stale** — it claims Vite, vanilla JS and Biome; the project is actually Next 16 +
React 19 + TypeScript + ESLint. Trust the code).

- Vanilla imperative TS. **No react-three-fiber, no drei** — they'd fight the
  architecture. Raw `import * as THREE from "three"`.
- No state library. Module-scoped state singleton (`state.ts`), private functions
  prefixed `_`.
- Dynamic `import()` from `main.ts` — never static-import a game.
- Always `setInputOwner("dungeon-game")` on launch / `clearInputOwner()` on exit.
- Always `cancelAnimationFrame` + dispose geometry/materials/textures on unmount.
  `src/utils/dispose-utils.ts` exists for this.
- **Audio is fully synthesized** — there are zero audio files in the repo. SFX go
  through Web Audio, following `src/utils/audio-manager.ts` and
  `mouse-game/audio.ts`. Sword swings, zombie groans and hits all get oscillators
  and noise bursts. (Which, conveniently, is *very* 8-bit.)
- Emoji-prefixed `console.log` for lifecycle tracing.
- Tests are colocated `*.test.ts`, and only **pure-logic** modules get tested —
  three.js rendering does not. For this game that means the natural test surface is
  `maze/generator.ts` (is it solvable? is every floor tile reachable? does the
  stairs placement respect the max-distance rule?), `entities/ai.ts` (does the flow
  field descend to the player?), and `collision.ts`. Those are worth real tests.

---

## 10. Decisions locked

- ✅ **Internal resolution: 320×180.** Fixed. Nearest-neighbour upscale, letterboxed
  to 16:9. `renderer.setPixelRatio(1)`.
- ✅ **Palette: "cold crypt", 32 colours.** Cold stone greys/blues, rot greens,
  blood reds, steel — with torch orange as the *only* warm hue in the entire
  palette. This deliberately contrasts with the mouse room's warm earth `P` palette,
  so descending feels like going somewhere else.

```
stone   #2b303b  #454f5e  #6b7688
rot     #3d5c3a  #5f8a4f  #8fc46b
blood   #6b1f2a  #a83244  #d95763
torch   #d97b29  #f0a63c  #ffd98a
steel   #8a94a6  #c8ccd4  #eef1f5
```
*(a starting ramp — the full 32 gets tuned in Phase 0, which is the point of Phase 0)*

## 11. Still open (not blocking Phase 0)

1. **Perma-death or checkpoints?** Diablo-2-ish suggests a roguelite loop: you keep
   your gold, you restart the run. Alternative is a level-select. Doesn't affect the
   style sandbox — decide before Phase 3.
2. **Do actor sprites get lit by torches?** Unlit is more authentically 8-bit; lit
   is more atmospheric and more Diablo. Cheap to try both *in* Phase 0 — I'll
   prototype both and we pick from screenshots.
