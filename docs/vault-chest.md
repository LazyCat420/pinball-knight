# The vault chest — an unlock nobody could reach

**Shipped 2026-08-29, `4de41afd`, live on `pinballknight.braindeadbot.com`.**
Tree: `ThreeJS/`. Code: `ThreeJS/src/game/pinball-knight/lamp-puzzle.ts`,
`run/descend.ts`, `boot/wiring.ts`. Tests: `vault-chest.test.ts` (10).

## The report

> "for the pinballknight.braindeadbot.com version of the game I'm noticing that
> when I beat the boss there's a chest but the chest can't be opened. what are
> the qualifications to open it or did we not make any?"

Both halves of that were true at once, which is why it is worth writing down.

## What it proved

**1. The chest and the boss share a tile by construction, and nothing said so.**
`maze/lamp-puzzle.ts authorLampPuzzle` picks the vault as the deepest *open*
reachable tile from the start:

```ts
const far = cand.filter((c) => c.d >= maxD * 0.5).sort((a, b) => b.d - a.d);
const vaultC = far.find(openTile) ?? far[0] ?? cand[cand.length - 1];
```

The stairs are the far end of the same distance field, and `carveBossChamber`
carves the arena *at the stairs* (`maze/track-floor.ts`). So on most floors the
sealed vault stands inside the boss chamber. The player reads it as the prize
for the fight. It never was: the only unlock was `lightLamp` firing on the last
of 3–5 braziers scattered across the whole floor.

**2. The refusal was silent, and silence is indistinguishable from broken.** The
chest is a `THREE.Group` in the scene with **no collider and no handler** —
`entities/pinball-collide.ts` has a `lamp` case and nothing for the vault. There
is no "open" input to miss. Bumping it produces no flash, no sound, no toast.

**3. The prerequisite was unteachable.** `grep -rn lampPuzzle gui/` returns
nothing: the HUD never mentions braziers. The only mention in the game is
`showPickupNote("🔥 BRAZIER n/N")`, fired *after* lighting one. A player who has
lit zero has never been told the mechanic exists. There was no reachable state
in which that chest opened for them.

## What shipped

**The key.** `openVaultOnBossDefeat()` opens the vault on the overlord's death.
Every floor's exit is boss-gated (`spawn/floor-populate.ts` spawns a
biome-picked boss whenever `state.stairs` exists), so this is the one unlock a
player cannot miss. It hangs off `run/descend.ts dropBossReward`, **plus** the
co-op replica path in `boot/wiring.ts onRemoteKill` — a replica never runs
`dropBossReward` (the authority owns the kill), so without that second call the
vault would open on one screen and stay sealed on the other.

The brazier route is untouched and still opens the vault *early*, mid-floor.
This is a floor under the feature, not a replacement. Both funnel through one
`openVault(by)`, so it pays out exactly once; `by === "boss"` also sets
`lit = total` **inside** the scene guard, so a boss kill on a torn-down scene
cannot leave a sealed vault reporting itself solved.

The boss path uses `showPickupNote`, not `showToast`: `gui/screens/toasts.ts
pushBanner` is a **single slot**, and "OVERLORD SLAIN" is already in it.

**The object.** It was three boxes and a floating torus — a slab base, a slab
lid that drifted straight up on open, a sigil. Now: a plank carcass on four
feet, two iron straps, an iron rim frame, a brass lockplate with a hasp on the
lid latching over it, under a barrel lid (a half-cylinder) on a real hinge group
at the back rim. Opening swings it back past vertical onto a lit interior.
Colours come from `PALETTE_HEX`, so the pixel pass has nothing to re-quantize.

## How it was verified, and why that mattered

The mesh was **rendered headlessly and looked at** — a throwaway flat-shaded
z-buffer rasteriser driven through the game's own camera basis (yaw 45°, tilt
38°, orthographic), writing PNGs via `tools/sprite-forge/png-indexed.ts`. Four
defects were found by looking that no assertion would have caught, and each
survived a green suite:

| Looked wrong | Why |
| --- | --- |
| A rectangle with straps on it | The chest was yawed flat-on to the camera. The iso view is *already* three-quarter — axis-aligned shows front, side and the curve of the lid at once. |
| The open chest read as a violet **table** | The rim was a solid slab: with the lid off it is the largest surface on screen. It is four bars now, with the mouth in the middle. |
| The whole open chest was one violet slab | The lid's underside was emissive. It is wood; only the interior glows. |
| A brass stud floating above the lock | The hasp sat *behind* the lockplate, which occluded its lower half. It is an L now — tab off the lid's lip, tongue proud of the plate. |

The interior also had to move **above** the carcass's top face: a "mouth" plane
inside a solid box is invisible, which is how the first pass shipped an interior
nothing could ever see.

`vault-chest.test.ts` then pins what a still cannot: nothing below the floor,
the chest inside its 1-unit tile, the dome above the hinge, the lid *swinging*
rather than lifting, the inside dark until open, and one payout per floor.
The dome assertion is the load-bearing one — the lid is a half-cylinder whose
surviving half is chosen by the sign of one `rotation.z`, and the wrong sign
buries it under the floor with every other assertion in the file still green.

Suite green on the final tree: **230 files / 2543 tests** (sprite-forge
excluded — it rewrites tracked files under `tools/sprite-forge/work/`).

## Still open

- **No standing brazier readout.** The HUD still never mentions the puzzle, so
  the *early* unlock remains undiscoverable; only the boss route is reachable
  blind. A counter while `state.lampPuzzle` is unsolved is the fix.
- **The sealed chest still gives no refusal feedback.** It has no collider, so
  bumping it is a no-op — the original "it can't be opened" reading. A collider
  plus a "sealed — N braziers remain" bump was scoped and deliberately not
  built, because it is the larger of the two changes.
- **Vault loot carries no `nid`.** `openVault` pushes ground items without one
  while `dropBossReward` uses `nextItemNid()`. Pre-existing, unchanged here, and
  it means vault loot is per-client in co-op — same as the shared kill gold, but
  it was never a decision.
- **The unlit brazier still reads as scenery** — a dark iron bowl with a cold
  arcane bead (`render/pinball-parts.ts buildLamp`).
