# Ability & Map-Effect Wave — grounded plan (2026-07-23)

The original draft was written against a partial read of the codebase. This version
corrects it against what actually exists and scopes the wave.

## Corrections to the draft

| Draft claim | Reality |
|---|---|
| "Build a combo state machine in combat.ts" | Already exists: `p.comboStep` / `p.comboWindowT` drive LIGHT_1 → LIGHT_2 → COMBO_FINISH in `entities/player.ts`. Work = finisher *presentation* + buff, not a new machine. |
| "pixel-pass has a `brightnessBoost` uniform" | It does not. Added a real `uFlash` uniform + `setFlash()` (same pattern as `setFrenzyFx`), driven off new `state.flashT`. |
| "Create a `FloorDecal` system" | Already exists: `entities/floor-fx.ts` (`slick`/`fire` discs, zombie overlap, burn ticks, ember emission). Oil is a third `FloorFxKind`, not a new subsystem. |
| "Replace Magnet Aura" | Rejected. Magnet is woven into the skill tree (`unlockmagnet`), coin capture range (core), co-op state sync, and saves. Slick Field ships as a NEW 6th ability with its own arcana unlock node. |
| "Replace Blade Storm with the sword combo" | Rejected — the combo is base-kit already; Blade Storm stays. |
| "Marble oil speed mult" | Reuses existing `p.oilT` (frictionless + dead steering) — rolling over oil keeps ball speed alive, which *is* the "faster and slicker" read. |

## Shipped in this wave

1. **VFX primitives** — `RingPool` (`vfx.ring(x, z, color, maxRadius, duration, delay)`)
   expanding flat shockwave rings; `uFlash` full-screen white flash in the composite pass.
2. **Arcane Pulse rework** — sonar-ping double ring (white core + lagging purple),
   damage applied *when the wave crosses each enemy* (module-local wave tracker in
   abilities.ts), mini-bolt from cast point to each victim, 8 rim bursts at max radius.
3. **Katana finisher** — COMBO_FINISH buffed (2.0× dmg, wider arc/reach, heavier hitstop)
   and on connect: white player afterimage, screen flash, triple parallel slashes,
   orange contact burst, white ghost of every foe it cuts through.
4. **Flipper Charge fire trail** — the launch ignites the knight for ~0.9s: flame
   afterimages + embers while riding, and a burning `fire` floorFx dropped on every NEW
   tile crossed (existing burn-tick logic damages the horde; player immune unless the
   self-harm debug toggle is on).
5. **Slick Field (new ability, 🛢️ 25 mana / 8s cd)** — spills a big `oil` floorFx disc.
   Oiled zombies lose steering (heading-blend skid, `oiledT`), the rolling ball picks up
   `p.oilT` glide, and any FIRE floorFx overlapping oil IGNITES it into a long-lived fire
   pool — Flipper Charge over your own slick is the built-in combo. Unlocked via new
   arcana node `unlockslick`.

## Deliberately deferred (same infra, cheap follow-ups)

- **Frost Runes / Tar Pit / Lightning Rod / Blood Altar / Mirror Wall / Pressure-plate
  chain** from the draft — all become `FloorFxKind`s or deployables on the now-proven
  floor-fx + wave primitives. Tar = surface-friction kind; runes = freeze on overlap.
- **Burning-bumper jackpot synergy** — needs a seam in pinball-collide's bumper hit;
  fold into the next pinball wave.
