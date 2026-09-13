# The Tilt Titan's spin: why three art rebuilds didn't fix it

**Written 2026-09-12.** Reported three separate times as *"the 3d pinball is
spinning really slow"*. Each earlier attempt rebuilt the art. The speed was
never in the art.

Related: [`docs/monster-art-pipeline.md`](monster-art-pipeline.md) for how the
rig becomes a sheet, `src/game/pinball-knight/pinball-spin.ts` for the tuning.

---

## 1. The previous attempt changed the speed by exactly zero

| commit | what it did |
|---|---|
| `d354bf6f` | "redo pinball boss sprite sheet with true 360 spin and loop animation" |
| `be98e858` | "rebuild Tilt Titan as a 3D rig with a real 360° spin, bake S/N/E" |
| `be6c68be` | "add shark teeth and varied multi-axis Titan spins" |

`git show be6c68be^` settles it. Before: the sheet had **12** attack cells and
no `beats` override, so the loop ran 12/12 = **1.000 s**. After: **32** cells
with `beats: 12`, so the loop runs... **1.000 s**. The 32-cell re-bake and the
override landed in the *same commit* and cancelled out. `1.0 + progress * 2.5`
and the hard-coded `3.0` were never touched. **Delta 0.000 rev/s at every
rate.** That is the "still" in the third report.

## 2. Loop time, and the thing that makes it not the whole story

From `engine/render/monster-animator.ts`:

```
smooth = frames / beats
step   = 1 / (fps · rate · smooth)     seconds per displayed cell
loop   = frames · step = beats / (fps · rate)
```

The override in `boot/sheets.ts` sets `beats` equal to each clip's effective
fps (attack 12 vs `anim.attack` 12, roll 14 vs `anim.roll` 14, ball 6 vs the
`default: 6` in `fpsFor` — there is deliberately no `case "ball"`), so **one
loop takes `1/rate` seconds for all three clips**.

**But one loop is not one turn.** `roll` and `ball` carry a full turn about
*two* axes. Integrating the rig's own Euler paths as a geodesic quaternion path:

| clip | Euler (`render/pinball-boss-3d.ts`) | surface turns per loop |
|---|---|---|
| attack | `YXZ(0.34 sin ph, ph, 0.26 sin 2ph)` | **1.0883** |
| roll | `ZYX(ph, −ph, 0.55 sin ph)` | **1.4602** |
| ball | `YZX(ph, 0.65 sin 2ph, −ph + 0.25 sin ph)` | **1.6431** |

So the old flat `3.0` delivered **3.26 / 4.38 / 4.93** surface rev/s depending
only on which path the RNG drew — the *same* charge reading 51% different run
to run. Rates are now expressed in **surface rev/s** and divided by the clip's
gain (`SPIN_TURNS_PER_LOOP`).

## 3. Four causes, ranked

### 1. The ambient window did not spin at all — the biggest one

Between charges the Titan used the generic `walk` gait. That pose turns the
**riveted seam ring only**:

```ts
seam.rotation.x = ph;                          // the thin ring turns
ball.rotation.x = 0.16 + 0.03 * Math.sin(ph * 2);   // the HULL does not
```

`ball` carries the hull *and* the face, and it gets a static 0.16 lean with a
±0.03 wobble. For roughly a quarter of the fight, a chrome sphere crossed the
floor **without rotating** — which does not read as "spinning slowly", it reads
as *sliding*. It now plays `roll`, looped, at 1.2 surface rev/s.

### 2. The launch decelerated

The rev-up ramped to `3.5`; the release frame hard-coded `3.0`. The ball
visibly **slowed by 14% on the exact frame it fired** — the opposite of a
release. Both ends now evaluate the same expression, and a test pins the rate
sequence monotone across the boundary.

### 3. The per-clip gain spread (§2)

### 4. The rev-up opened at a standstill

`1.0 + progress * 2.5` starts at 1.0 rev/s and ramps linearly — and the
telegraph is the one window where the boss stands still at eye level with the
player watching it. A spin-up is torque-limited, so it now uses a concave
`sqrt` ramp from a **2.4 rev/s floor** to the dash rate, and that peak scales
with `spec.speed` so phase 2 escalates. The old `3.0` was identical in both
phases.

### Result

| state | share | before | after |
|---|---|---|---|
| ambient | 25.7% | **~0** (hull static) | **1.20** |
| telegraph | 49.1% | mean 3.14 | mean **4.80** |
| dash | 25.2% | 3.26 / 4.38 / 4.93 | **6.00** (all three) |
| release frame | — | **−14% step down** | continuous |
| **time-weighted** | | **2.59 rev/s** | **4.17 rev/s** (+61%) |

Phase 2: 2.77 → **4.95** (+79%).

## 4. Why it is not pushed further — the ceiling is real

At 60 Hz the display advances `32 · rate / 60` baked cells per shown frame.
Measured frame-to-frame decorrelation on the shipped `pinball_boss-S.png`
reaches the arbitrary-pair baseline at a lag of about **3.5 cells**. Past that,
consecutive frames are as different as unrelated ones and the surface **boils**
rather than reading as faster — this is the way pushing a spin harder makes it
look *slower*, and it is the same family of defect as
[[a-symmetric-object-cannot-be-shown-turning-faster-than-fps-over-2n]].

Every shipped rate stays under **3.4 cells/frame** and shows **≥ 8 distinct
cells per revolution**. `PINBALL_SPIN.max` encodes the ceiling and
`pinball-spin.test.ts` guards it as a property, not a constant.

**The gap was closed by raising the FLOOR, not the ceiling.**

## 5. The art was not touched

No re-bake, no rig edit, no sheet change. `attack` *is* measurably the weakest
clip — **7 of its 32 cells contain no face pixels at all**, where `roll` hides
the face in none, and it has the lowest adjacent-frame delta of the three. It
is therefore **de-weighted in the pick** (`["roll","ball","roll","ball","attack"]`)
rather than repaired. Fixing the cells themselves would mean an oblique seam
ring or a back-of-ball mark plus a re-bake, which needs a GPU and touches
shipped art; that is a separate decision and is not taken here.

## 6. Blast radius

- The only change outside the boss's own files is the ambient clip in
  `entities/zombie.ts`, gated on `bossKind === "pinball_boss"`.
- **It has to live there.** `sim/simulate.ts` runs `updateZombies` *before*
  `updateBoss`, and `play()` resets `frameIdx` to 0 on any clip **change** — so
  a boss that set the clip itself would fight the AI every frame and freeze the
  ball on frame 0 for the whole ambient window.
- ⚠️ `roll` does **not** loop by default. Every caller must pass `{loop: true}`
  or the ball completes one turn and stops on its last cell — which looks
  exactly like the static hull this change removes.
- **`engine/config.ts anim.attack` was deliberately not touched.** It retimes
  every monster's attack clip, and it is mirrored in `constants/render.ts` and
  `constants/pinball.ts`, so editing one silently does nothing.
- `boot/sheets.ts`'s beats override was not touched either: it is pinned by
  `boot/titan-spin-cadence.test.ts`, and `ball: 6` is fitted to the missing
  `case "ball"` in `fpsFor`.

## 7. Evidence

- **Five sabotages verified red**, then green on restore: the 3.0 launch rate,
  the ambient rate, the linear ramp, the clip wiring, and the loop flag.
- The clip-wiring test drives the **real `updateZombies`**, not a predicate — a
  helper that returns the right answer while nothing calls it is a bug shape
  that has already shipped in this repo once.
- All five pre-existing pinball-boss test files pass **untouched**.
- Suite: **392 files passed, 5 skipped; 4,502 tests passed, 12 skipped, 0
  failed.** `tsc --noEmit`: **60 before and after**, none in the touched files.

### Not verified

**Nobody has watched this spin.** llvmpipe under WSL invents artefacts, so a
capture from that box is not evidence. Needs eyes on Windows:

- whether ~2.9 cells/frame at the dash reads as **fast** or as **boil**. If it
  boils, drop `PINBALL_SPIN.peak` to 5.0 — that is the one dial.
- whether 1.2 rev/s ambient reads as a ball rolling or as a ball drifting.
- whether the three clips now genuinely look alike charge to charge.
- **which state the player was actually watching** when they said "really
  slow". If it was the ambient approach, cause 1 is the whole fix; if the
  rev-up, cause 4 is. The code cannot settle that, so all four were fixed.

## 8. Open

- `rt.spinAngle` has no reader (`rotateSprite` is only ever called with a
  literal `0`; the quad-rotation approach was tried and abandoned). `rt.spinSpeed`
  is still read by `entities/pinball-boss.test.ts`. Dead-ish, low value, left
  alone with the abandonment comment intact as the record of why.
- The Titan's zombie is spawned with `kind: "brute"` while wearing the
  `pinball_boss` sheet, and `boot/sheets.ts` matches actors by
  `sheetKeyForKind(z.kind)` — so a late `rebuild("brute")` could hand the Titan
  the 4-frame brute attack mid-fight. Not observed, not fixed here; it would
  present as a sudden genuine slowdown.
