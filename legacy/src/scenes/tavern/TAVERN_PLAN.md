# The Tavern — walkable hub

_Live plan. Delete when the build order below is done._

## Where it actually stood (audited 2026-07-18)

The tavern was **a fullscreen DOM overlay with a WebGL still-life behind it**.
The 3D canvas was `pointerEvents: none` — wallpaper. Concretely:

| | State |
|---|---|
| Player in the tavern | **None.** No actor, no input, no movement. |
| Proximity / prompts | **None.** A CSS `:hover` on a floating DOM name-plate. |
| Stations | 4 DOM buttons → a fullscreen vendor panel. |
| 3D props | Floor, 2 walls, fireplace, **2 barrels, 1 table, 1 leg**. |
| Pinball identity | **Zero.** `render/pinball-parts.ts` never imported. |
| Audio / VFX | **None at all.** |
| Camera | Set once, never moves. |
| Module layout | 2 files inside `scenes/dungeon/`. |

The DOM copy already said *"walk up to a keeper, then take the stairs"* — the
intent was written into the strings, never into the code.

**What was already good and is being kept:** the entire economy —
`cards.ts` (15 cards, 5 rarities, socket/forge/reroll), the price and stock
tuning, the 512×716 holo-card renderer, and the proof that the dungeon's render
pipeline drops into a second scene cleanly.

So the gap is **scene architecture and set dressing, not systems.** This build
does not touch the economy; it gives it a room to live in.

## Architecture

`src/scenes/tavern/`, sharing the dungeon's render primitives but owning its own
renderer/scene/loop — two scenes must not share `state.renderer`/`state.scene`,
which the dungeon tears down between floors.

| File | Owns |
|---|---|
| `layout.ts` | The floor plan as **pure data** — room bounds, station positions, obstacle rects. No THREE. Testable. |
| `state.ts` | Scene-local state: player pose, focused station, open panel. |
| `player.ts` | ~90-line controller: axis → velocity → rect collision → facing. |
| `build.ts` | Room shell — floor, walls, hearth, dungeon stair. |
| `props.ts` | Station props + the central pinball table. |
| `stations.ts` | Proximity, focus, prompt, spotlight. |
| `core.ts` | Fixed-step loop + scene bootstrap. |
| `index.ts` | `enterTavern` / `closeTavern`, and the DOM fallback. |
| `npcs.ts` | The four keepers and their idle loops. |
| `audio.ts` | Room tone + anvil / focus / plunger one-shots. |
| `ui.ts` | The run summary (every other panel is the existing vendor UI). |

**Do NOT reuse `entities/player.ts`.** It is 1569 lines interleaved with pinball
momentum, wall-launches, rides, rolls, melee combo state and grid smashing, and
it requires a `Grid`. The tavern needs axis → move → collide → face. Reuse the
sprite *sheets* (`state.playerSheets`), not the controller.

Run-persistent state (`goldRun`, `weaponSlots`, `gear`, `cardStash`, `belt`) is a
module singleton in `scenes/dungeon/state.ts` and the gold wallet is already
scene-independent, so the tavern reads it directly.

## Floor plan

```
                    ╔═══ NOTICE BOARD ═══╗          north (-z)
                    ║   DESCEND PLUNGER  ║
   ┌──────────┐     ╚════════╦═══════════╝     ┌──────────┐
   │  FORGE   │              ║                 │   BAR    │
   │ blacksmith              ║                 │ alchemist│
   └──────────┘     ╔════════╩═══════════╗     └──────────┘
                    ║  CENTRAL PINBALL   ║
                    ║   TABLE (diorama)  ║
                    ╚════════╦═══════════╝
   ┌──────────┐              ║                 ┌──────────┐
   │ GAMBLER  │      ┌───────╨────────┐        │ CARD     │
   │ (later)  │      │ ARMORY BENCH   │        │ DEALER   │
   └──────────┘      └────────────────┘        └──────────┘
                              ║
                     ▓▓ DUNGEON STAIR ▓▓        south (+z)
```

Every station is visible from the room's centre — the failure mode to avoid is a
hub that reads as a long UI hallway.

Stations map onto the vendors that already exist, so no economy is rewritten:

| Station | Vendor | Interaction |
|---|---|---|
| Armory bench | `armor` | plate & repairs |
| Card dealer | `cards` | buy cards, socket into weapons |
| Blacksmith forge | `weapons` | repair, add slot, forge, reroll |
| Bar | `potions` | belt potions |
| Central table | — | run summary (new) |
| Notice board / plunger | — | DESCEND |

## Build order

1. ✅ **Pure layout + greybox.** Room shell, player, fixed iso camera, 6 stations.
2. ✅ **Station routing.** Proximity → prompt → existing vendor panel → close
   returns to movement. Browser-verified end to end (19/19 checks).
3. ✅ **Central pinball table.** Sloped playfield, rails, lit bumper caps,
   flippers, a ball that laps, distressed jackpot backglass.
4. ✅ **Station props** — forge + anvil + hood, bar + bottles, armory bench with
   vice, card table with engraved steel plates, notice board + plunger gate,
   wall-mounted rails and bumper caps.
5. ✅ **Lighting, VFX and audio.** Warm forge/hearth vs cold machine glow with
   flicker; hearth/forge embers, dust motes, sparks on each hammer blow; a
   procedural room tone (brown-noise hearth + machinery hum) plus anvil, station
   focus and plunger one-shots.
6. 🔶 **NPCs** done — four keepers with distinct idle loops (the smith's hammer
   is a real beat the sparks and sound hang off). **The gambler is not built.**

### Also still open

- **The gambler** — no wager station exists.
- **No camera zoom-in** on Armory/Blacksmith interaction (the wide hub framing
  holds through the panel).
- **The diorama does not reflect the actual run** — bumper caps chase on a timer
  rather than showing completed targets, and the ball laps constantly instead of
  moving after a strong floor.
- **Keepers do not react** to being approached (no turn-to-face, no greeting).

### Retired

The 3D-backdrop-plus-DOM-overlay hybrid (`tavern-scene.ts`, `roomView3d`, the
name-plate tracker) is **deleted** — 351 lines. It was unreachable: the DOM
tavern now runs only when a WebGLRenderer could not be constructed, and that
backdrop needed one too, so its scene was always null on the only path that
still reached it. `scenes/dungeon/tavern.ts` is now purely the economy plus a
flat DOM fallback room.

### Verified

`scratchpad/tavern-qa.mjs` (19/19) drives a real browser: spawn → walk → focus a
station → prompt → [E] → panel → movement freezes → Escape → control returns →
walk to a second station → open a real vendor counter → back → wall collision.
`scratchpad/vice-qa.mjs` (4/4) sockets cards via `__dungeonSocket` and asserts
the rune plates appear on the blade in the vice.

Three things that only showed up on screen, all fixed: ceiling beams projected as
black bars across a fixed iso frame; a straight copy of the dungeon's light
levels rendered the room nearly black; and all four keepers were placed INSIDE
their own counters, so every NPC rendered buried in furniture — silent, nothing
threw, the room was just still empty. Keeper positions now live in `layout.ts`
and are asserted to be open floor.

## Rules

- Fixed orthographic iso, same world scale as the dungeon. No free rotation — it
  breaks the staged prop silhouettes.
- Camera may pan slightly toward a focused station; wide hub view otherwise.
- Keep the dungeon stair and the descend gate in frame where possible.
- Warm orange = forge/hearth/bar. Cold cyan = pinball hardware, card sockets,
  the descent gate. Gold = rewards only. Every interactable readable by shape +
  light colour, not by a permanent text label.
- **Keep the DOM fallback.** `openTavernScene` returns false when a
  WebGLRenderer can't be constructed, and `enterTavern` falls back to the flat
  DOM room in `scenes/dungeon/tavern.ts`. That path must keep working — but note
  it can no longer host any 3D of its own, which is exactly why the old hybrid
  backdrop was deleted.
