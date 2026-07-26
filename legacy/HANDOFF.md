# Handoff — braindeadbot-client

_Replaced on each deploy. Not a log; if something here is done, delete it._

## 🎮 CONTROLLER FIXES — rampage turn + tavern polling (2026-07-25, this session)

**Commit `dbaf032`** · pushed to `main` · deployed **`main@dbaf032` → synology**
**Live:** http://10.0.0.16:5174/dungeon — verified in **production**, not just built.

1368 tests / 118 files pass · `next build` compiles.

### What was reported

> "rampage mode — I tried it with the controller and I can't go left or right.
> Also the controller doesn't work in the tavern at the beginning, it only works
> in the map in game."

Two separate defects. Both real, both fixed.

### 1. Tavern: the pad was never polled

`src/scenes/tavern/core.ts` created an `InputHandle` (`createInput(canvas)`) and
read `input.axis()` every frame via `updateTavernPlayer`, but **never called
`input.poll()`**.

The Gamepad API is **pull-only** — it fires no events for stick movement, so the
poller is the only thing that ever writes the pad's move vector. Without that call
the pad contributed nothing and `axis()` saw the keyboard alone. The dungeon polls
in its own loop (`core.ts`, `state.input?.poll()`), which is exactly why the same
controller worked "in the map in game" and nowhere else.

Fix: `input?.poll()` in the tavern frame loop, before the player reads the axis.
It runs **unconditionally**, including while a station panel is frozen — the poller
also bridges pad buttons to keys (E = interact, I = menu) via synthetic events, and
those must keep working so you can leave a counter with the pad.

### 2. Rampage: the right stick was not wired to the camera turn

The FPS camera turn reads `input.turnAxis()` (`fps.ts:186`), which was
**keyboard-only** (q/e). The right stick filled `aimX`, which only ranged aiming
and the pinball steer ever read.

So on a pad in rampage you could walk and strafe but **never turn**. With no turn,
strafe is the only lateral control — that is what "I can't go left or right" was.
It is **not** a sign/inversion bug; the movement maths was already correct.

Fix: `turnAxis()` now also takes the right stick's X. Analog (a half-pushed stick
turns at half speed), taking the **larger deflection** rather than summing —
matching the rule `axis()` already uses, so keyboard + stick can't turn faster
than either alone.

### Verification (live game, synthetic pad)

- **Tavern**: knight walks `0.94` units from the stick where it previously moved
  **zero**. Re-confirmed on the deployed production build (`0.715`).
- **Rampage**: right stick turns yaw **+0.520 right / −0.520 left**, with
  **0.0000 idle drift** (a resting stick does not spin the view).
- On the **unfixed** build the same pad populates `gamepad.aimX = 1` — the hardware
  reached the game fine, `turnAxis` just ignored it.

### Tests

- `src/scenes/dungeon/input.test.ts` — covers the stick turn through the **real
  hardware path** (`navigator.getGamepads` → `readPad` → poller → `turnAxis`), not
  only the touch surface. This matters: touch and gamepad fill **different**
  `VirtualPad` structs, so a test asserting against `input.pad` alone would pass
  while the hardware path stayed broken.
- `src/scenes/dungeon/gamepad-polling.test.ts` — **new**. Pins the missing-poll
  class statically: every scene that creates an `InputHandle` must also poll it.
  A missing method call is invisible to the type checker and to every behavioural
  test (the scene still runs, it just ignores the pad), and the tavern frame loop
  needs a live three.js scene to drive.

Both fail without their respective fix (verified by reverting each).

### Also changed

`__dungeonProbe()` now returns `fpsYaw` / `fpsPitch`. Nothing read the camera angle
back, so a harness could only infer it from where forward movement travels — which
is **wrong**, because forward slides along walls in rampage. That inference produced
a **false PASS** (a "40.8° turn") against code where the right stick provably was
not wired to `turnAxis` at all. Measure the angle, not the displacement.

### Traps worth knowing (these cost real time)

- **`ultCharge` resets to 0 on every floor change** (`state.ts` `resetLevel`).
  Filling the rampage meter with the playtest bot is a lottery — identical runs
  gave 0.09 / 0.36 / 0.63 / 0.99 / 1.00. Feed 1-hp enemies on the current floor and
  poll fast instead. `fillRampage` is a debug-**panel** action, not a window hook,
  and clicking that panel is a known hazard in this repo.
- **11 kills = 0.99, not 1.0** (`ULT_CHARGE_PER_KILL = 0.09`). A `>= 1` poll gate
  stalls one kill short; `canRampage()` genuinely wants `>= 1`.
- The playtest bot **self-stops** when its `seconds` budget expires and charge then
  plateaus — restart it rather than reading the stall as a result.
- Scripted `pg.mouse.click` at a fixed screen point **never swings** (`attackT`
  stays −1). Use `__dungeonPad` or `__dungeonBot`.
- `__dungeonPad` is the game's own fake pad (`connect/hold/release/tap/stick/aim`)
  and is preferable to a hand-rolled `getGamepads` stub — core.ts warns that
  hand-rolled stubs mis-handle the held-at-connect edge case.

### Not changed

The mapping itself (`gamepad.ts`) was already correct. Deadzones verified: full
deflection returns exactly 1.0; `0.08/0.05` drift returns 0.
