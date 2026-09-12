# Monster art: what draws a monster, and why the painter cannot be deleted

**Written 2026-09-12** after a session that set out to "delete the bad 3D models
that render under the sprites". Both halves of that premise were wrong, and the
way they were wrong is worth keeping: the mistake is easy to repeat, and acting
on it would have deleted two monsters and frozen every death clip whose imported
death row is empty.

Companion documents: [`docs/art/*/README.md`](art/) for the five rigs,
[`docs/web-integration-render-audit.md`](web-integration-render-audit.md) for the
render audit, [`docs/death-animation-audit.md`](death-animation-audit.md) for the
death-clip rules this depends on.

---

## 1. The invariant: nothing 3D renders under a monster sprite

Every monster in the dungeon is a **billboard quad** sampling an atlas
(`engine/render/sprite.ts`, a shared `PlaneGeometry`). There is no per-enemy
mesh, and there is no `GLTFLoader`, `.glb` or `.gltf` anywhere in the repo.

The only live 3D character in the play bundle is the **player** —
`render/armored-knight.ts` → `render/pixel-knight.ts`.

### The six Three.js rigs are bake SOURCES, not runtime geometry

| Rig | Monster | Bake page + driver |
|---|---|---|
| `render/slime-3d.ts` | Slime | `scripts/slime-bake.html` + `scripts/bake-slime.mjs` |
| `render/fries-3d.ts` | French fries | `scripts/fries-bake.html` + `scripts/bake-fries.mjs` |
| `render/milkshake-3d.ts` | Toxic Shake | `scripts/milkshake-bake.html` + `scripts/bake-milkshake.mjs` |
| `render/blaster-frank-3d.ts` | **Blaster Frank** | `scripts/blaster-frank-bake.html` + `scripts/bake-blaster-frank.mjs` |
| `render/pinball-boss-3d.ts` | **Tilt Titan** | `scripts/pinball-boss-bake.html` + `scripts/bake-pinball-boss.mjs` |
| `render/clockwork-knight.ts` | the PLAYER | `scripts/clockwork-bake.html` + `scripts/bake-clockwork.mjs` |

**No runtime code imports any of them.** Each is reachable only from its
`scripts/*-bake.html` page (a dev-server-only entry point, absent from
`vite.config.ts`'s app graph) and its colocated `*.test.ts`.
`render/armored-knight.ts` and `render/knight-motion.ts` name
`clockwork-knight.ts` with `import type`, which erases at compile.

So the rigs are **not weight in the shipped bundle**. They are weight in the
source tree only. Deleting one to "save the player a download" saves nothing and
destroys the ability to re-bake that monster.

The tell that a sheet came from a rig is **three authored facings** (E/N/S).
Painter-only kinds ship S alone.

### What actually appears before the sprite is a canvas-2D PAINTER

`render/monsters/*.ts` — 61 files, ~12,800 lines. **Not one of them imports
`three`.** They are `FramePaint` closures, `(ctx) => { … }`, drawing into an
`OffscreenCanvas` through the shaded-primitive helpers in
`engine/render/figure.ts`: `ellShaded`, `plateShaded`, `limbShaded`,
`groundShadow`, `glow`.

Those helpers shade a flat ellipse or plate along a hand-authored colour ramp.
**That is why a painter reads as a crude 3D model** — it has the shading cues of
lighting with none of the geometry. `render/monsters/corvid_bomber.ts` is the
clearest example: `R_BODY`, `R_WING`, `R_BEAK` ramps on stacked ellipses.

The birds (`corvid_bomber`, `sky_falcon`, `gull_bomber`, `vulture_scavenger`,
`toucan`) are pure painters. There is no 3D bird.

---

## 2. `paintsFor` MERGES. It does not replace.

`boot/sheets.ts`:

```ts
export function paintsFor(key: SheetKey): ActorPaints {
  const painted = BUILDERS[key]();        // ALWAYS runs, imported or not
  const art = imported.get(key);
  if (!art) return painted;
  return {
    S: { ...painted.S, ...art.S, death: (art.S?.death?.length) ? art.S.death : painted.S.death },
    …
    ...(painted.beats ? { beats: painted.beats } : {}),
  };
}
```

The painter is **load-bearing after the imported sheet has loaded**. Six live
paths depend on it:

1. **`BUILDERS[key]()` is unconditional.** A missing entry is a `TypeError`, not
   a graceful fallback.
2. **Death clips** fall back to the painter whenever the imported death row is
   empty. The brute shipped without one and **froze mid-stride**; that is what
   the explicit `death:` ternary is defending.
3. **`beats`** (animation cadence) can only come from the painter —
   `SheetManifest` has no such field, so taking the imported side would always
   be overwriting authored cadence with `undefined`.
4. **Facings.** 79 of 86 kinds ship **S only**. Any clip a facing lacks spreads
   up from `painted[dir]`.
5. **Portraits, bestiary cards, icons** call `paintsFor` directly
   (`render/monster-portrait.ts`, `gui/icons.ts`).
6. **Failure and opt-out.** A 404, bad JSON, a decode error or a manifest/PNG
   size mismatch returns `null` from `loadImportedSheet`, and
   `__lab.imported(false)` disables imported art outright. The painter is the
   art in all of those.

### Two kinds where the painter IS the shipping art

- **`hydrant_hound`** — no `hydrant_hound-*.png`, no `IMPORTED_ART` row, no
  `IMPORTED_FACINGS` row. The key is still requested at floor 3, so
  `loadMonsterSheet` bails at `if (!name) return false`.
- **`stiltneck`** — a sheet exists in `public/sprites/` but is deliberately
  listed in `INTENTIONALLY_ABSENT_IMPORTED_SHEETS` because the painter tested
  better. The floor-4 load is a guaranteed no-op.

**Deleting either painter deletes the monster.**

### Roster shape (2026-09-12)

86 `EnemyKind`s · 111 `-S` sheets on disk · 140 sprite PNGs.

| Bucket | Count | Kinds |
|---|---|---|
| Rig + baked sheet (E/N/S) | 5 | `slime`, `fries`, `milkshake`, `blaster_frank`, `pinball_boss` |
| Painter + baked S sheet | 79 | everything else |
| Painter only, no sheet | 1 | `hydrant_hound` |
| Sheet on disk, deliberately unused | 1 | `stiltneck` |
| Rig with no shipped sheet | 0 | — |

---

## 3. The fix shipped 2026-09-12 (`main@d430a9de`)

**Symptom:** spawning from the debugger was slow, and the painter was visible
before the sprite replaced it.

### Defect 1 — the lab never awaited the imported sheet

`debugSpawn` bypasses the level gates on purpose; the **art preload does not**.
`loadMonsterSheetsForFloor` only fetches `keysForFloor(level)` behind the
descent bar. So a lab spawn of anything outside the current floor's set landed
on the cold path by construction:

- `sheetFor` built a **painter-only atlas synchronously on the spawning frame** —
  for a kind like `sporeling`, 19 authored frames × 3 facings = **57 frames**,
  each a vector paint into a 138×138 canvas plus a `getImageData` readback that
  the audit note in `engine/render/sprite.ts` measures at **4–36 ms while the
  dungeon renders**;
- then the background backfill reached the key, called `rebuild(key)`, and
  **repainted the whole atlas from scratch** (~275 ms, the figure recorded in
  `boot/sheets.ts`), re-pointing every live actor via `setSheet`.

Two full builds, and the swap between them was the reported "code version, then
the sprite".

**Fix:** `preloadSpawnArt(kind)` in `dev/debug-actions.ts` awaits
`loadMonsterSheet(sheetKeyForKind(kind))` before anything is placed, so
`paintsFor` merges the imported art into the **one** build. `__lab.spawn`,
`.only` and `.ring` are now `async`; `ring` preloads the whole roster in
parallel instead of building 86 atlases back to back with no yield.

It also preloads `computer_screen` when asked for `ascii_human`, because
`debugSpawn` builds the latter out of the former — preloading only the
asked-for kind left the thing you actually see on cold art.

Failure stays silent by design: a rejected fetch leaves `imported` without the
key and `paintsFor` falls through to the painter exactly as before. The spawn
happens either way.

### Defect 2 — `debugClearEnemies` leaked every actor

It called `scene.remove(...)` and truncated `state.zombies`, but never
`releaseActorSprite`. Only `spawn/tide.ts` did. So `__lab.only()` and
`__lab.ring()` left the actor pool **permanently empty** and leaked every
geometry, material and texture they discarded; each following spawn allocated a
fresh `texture.clone()` — a whole atlas re-uploaded to the GPU per actor.

**Fix:** release non-boss actors back to the pool. Bosses are skipped for the
same reason `tide.ts` skips them — `disposeBoss()` owns those.

### What was investigated and deliberately NOT changed

`applyImportedMonsterArt()` was suspected of repainting all 97 sheets on every
console open. **It does not.** It is guarded by `applyingMonsters ||
appliedMonsters` and skips keys already in `imported`, so it runs to completion
once per session and resumes rather than redoes. Left alone.

No painter, rig, bake script or sprite sheet was deleted.

### Evidence

- New `dev/debug-actions.test.ts` (6 tests): pool reuse after a clear, bosses
  excluded from the pool, `preloadSpawnArt` resolving a kind's own key, the
  `ascii_human` → `computer_screen` remap, a rejected fetch still spawning on
  painter art, and `hydrant_hound` spawning with nothing to preload.
- **Both fixes sabotaged and confirmed red**, then green on restore — the leak
  test fails when `debugClearEnemies` is reverted, the remap test fails when the
  `ascii_human` branch is dropped.
- Full suite: **388 files passed, 5 skipped; 4,464 tests passed, 12 skipped, 0
  failed.**
- `tsc --noEmit`: **60 errors before and after**, none in the touched files.
  The build does not typecheck, so run it yourself.
- Deployed `main@edd79aec`, container healthy, public site HTTP 200. The live
  bundle contains the array literal `["computer_screen","ascii_human"]`, which
  exists only in the new `preloadSpawnArt`.

### Not yet verified

The eight-step in-browser check (spawn speed, no visible swap, repeated
`__lab.only` staying smooth, the five rig-baked monsters unchanged, the two
painter-only kinds still rendering, death clips finishing) was **not driven on
the host GPU** in that session. The evidence above is suite + bundle + container
only. Drive it on the host GPU: llvmpipe under WSL invents artefacts, so a
check run there is not a valid one.

---

## 4. Open items

- **`bloater` is missing from `keysForFloor`.** It has art and an `IMPORTED_ART`
  row, but no level lists it, so on a normal descent it only gets imported by
  the background backfill. A real gap in the floor table, not a cosmetic one.
- **`six_armed_god` has an `IMPORTED_ART` row and a `-S.png` but no
  `IMPORTED_FACINGS` entry**, so it silently defaults to `["S"]`. Correct by
  accident; it should have an explicit row.
- **`hydrant_hound` has no sheet and no `INTENTIONALLY_ABSENT` entry.** Unclear
  whether the bake was never run or the omission is deliberate. If deliberate,
  it belongs in `INTENTIONALLY_ABSENT_IMPORTED_SHEETS` next to `stiltneck` so
  the next reader does not treat it as a missing asset.
- **The non-lab spawn paths still spawn cold.** `preloadSpawnArt` is wired into
  `__lab` only. The ` console's own spawn chips go through `debugSpawn`
  directly and will still show a painter build for an un-preloaded kind.
- **`__lab.spawn/only/ring` now return promises.** Harmless from a console, but
  any future script that chains off them must `await`.
