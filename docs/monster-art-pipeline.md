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

## 4. Importing a kind that already has art — the Don Quixote case (2026-09-12)

A worked example, because the drop for this one had been sitting unused in
`sources/don_quixote-2026-08-02/` since August and every trap on the path cost
real time. What shipped: `don_quixote`, a level-3 `leaper` whose wind-up
releases into `startCharge`.

### The source geometry is not what the filenames say

The four pages are named `*_6frames.png` and each holds **eight** poses: a 4x2
grid over 1024x1024, so the cells are **256 wide and 512 tall**. Reading them as
256 squares — the shape every other prep script in `prep/` uses — cuts every
figure off at the chest, and the result still slices, still publishes, and still
passes the suite. **Measure a cell before trusting a filename.**

Only the TOP row of each page is taken. The bottom row is the same four poses
shifted down inside the cell; mixing the two baselines in one clip makes the
figure bounce a whole body-height per cycle.

### Two things a chroma key cannot do, and what replaces each

1. **A border in the subject's own colour.** The `walk_fixed` page draws each
   pose inside a panel whose border is a 1-2px line in the SAME blue-grey as the
   knight's plate. Any key radius wide enough to remove it removes his
   pauldrons. **Connectivity separates what colour cannot**: keep only the
   largest connected blob per cell, because the border touches nothing.
2. **A pocket the border fill cannot reach.** `matte` flood-fills inward from
   the sheet border. The gap between this knight's boots is SEALED by his own
   silhouette in two of the walk poses, so the fill never arrives and the first
   published pass shipped a **magenta wedge between his legs** — visible in the
   game, invisible to every test. The fix is to emit the sheet **already keyed**,
   with real alpha instead of a magenta field: `cutSheet` mattes only a sheet
   that arrives opaque (`clearShare(data) < OPAQUE_BELOW`, 5%), so a pre-keyed
   sheet skips the matte and its pocket policy entirely.

### ⚠️ `npm run sprites` republishes EVERY sheet in the inbox

It is not scoped to the sheet you just prepped and there is no flag that scopes
it. Publishing Don Quixote re-cut **eleven other monsters** from their inbox
sidecars — and the sidecar is not the best version of several of them. fries,
slime, milkshake, blaster_frank and pinball_boss are baked by the
`scripts/bake-*.mjs` rigs in section 1 into **6-frame** clips; their inbox
sidecars describe **4**. The republish silently cut all five back to 4.

The only symptom was five `render/*-3d.test.ts` reds reading `expected [...] to
have a length of 6 but got 4`, which look exactly like unrelated pre-existing
failures in a repo that has some.

**After any `npm run sprites`: `git status ThreeJS/public/sprites/` and
`git checkout --` every file you did not intend to touch.** Here that was 22 of
24 changed files.

### The painter is the PORTRAIT, so it must agree with the sheet

Section 2 covers why the painter cannot be deleted. This case adds a second
reason it cannot be left *wrong*: `render/monster-portrait.ts` paints every
bestiary card from `SHEET_PAINTERS` regardless of whether the kind also has an
atlas. The first painter for this kind drew him mounted on a donkey (faithful to
the novel, and to the plan document); the art is a dismounted knight. A portrait
that disagrees with the sprite teaches the player the wrong silhouette to look
for. **Paint what the sheet shows, not what the plan said.**

---

## 5. Registering the kind: three registries the compiler cannot see

`AGENTS.md` names nine compile-enforced `Record<EnemyKind, X>` tables and points
at `scripts/hooks/registry-drift.mjs` for the rest. **That file does not exist
in this repo.** Nothing covers the following, and each fails silently or far
from its cause:

| Registry | What a missing/wrong row does |
|---|---|
| `spawn/kind-skin.ts` (`KIND_SKIN`) | `makeSkinned` opens `if (!skin) return null`. No row ⇒ `spawnKind` returns null ⇒ the kind is fully registered, fully typed, fully green, and **never appears in the game**. |
| `boot/lazy-sheets.test.ts`'s `ALL_KEYS` | A hand-written literal, not derived from `SHEET_KEYS`. Fails with "points at unknown key", which reads like your bug rather than the roster's. |
| `LABEL_OVERRIDE` (`debug-panel.ts`, `gui/screens/debug.ts`) | **8 characters max.** "Don Quixote" (11) fails `debug-console.test.ts`. |

Two more are typed loosely enough to compile and break at runtime:

- `render/card-styles.ts` accepts any string but `StyleId` is only
  `bone|ink|stone|chitin|iron|void`.
- `reagents.ts` drop ids are unchecked: an invented id crashes **the bestiary
  screen**, four files away, at `REAGENTS[e.id].label`.

And a behavioural one: a `leaper` / `packhunter` / `ambusher` kind must author
the telegraph clip its policy demands (`crouch` for leaper) or
`tell-clips-roster.test.ts` fails — and in-game the charge arrives with no tell.

### The method that catches all of them

**Build the monster in its test through `spawnKind(...)`, never from an object
literal.** A hand-rolled `as unknown as Zombie` stand-in cannot see any row
above. That is precisely how the first pass at this monster reached a green
suite over a creature that could not spawn at all, alongside a 169-line private
state machine that **nothing in the game ever called** — the same shape as the
inert-port failure the repo has hit before.

Reuse before inventing: the engine already had the committed locked-line dash
(`startCharge` in `entities/zombie.ts`, used by the Hound and the woken Mimic)
and the stun (`staggerT`). Registering the kind as a `leaper` and reusing both
reduced `entities/don-quixote.ts` from 169 lines to ~50 holding the one thing no
other family does: the wall crash costs him real health and staggers him 1.8s.

### Evidence

Landed as `main@2e5f493e` and deployed to the NAS. Verified on the deployed tree:
vitest **4520 passed / 0 failed** across 393 files; `tsc --noEmit` 60 errors, all
pre-existing, **none** in any file this touched; `prep-don-quixote.mjs` re-run
reproduces the committed sheet byte-identically; the container serves
`/sprites/don_quixote-S.png` (200, 2.46 MB) and `-S.json` with clips
`idle/walk/attack/death`.

### Not yet verified

**Nobody has played him.** Every check above is static. Unconfirmed: that he
renders correctly at real camera zoom, that the charge telegraph is readable at
speed, and that the wall crash actually fires — it depends on
`moved < step * 0.4` in the `charge` branch, which was reasoned about but never
watched. Drive it on the host GPU; llvmpipe under WSL is not a valid check.

---

## 6. Open items

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
- **`scripts/hooks/registry-drift.mjs` does not exist.** `AGENTS.md` and the
  session hook both cite it as the guard for the registries in section 5. Until
  it is written, section 5's table is the only list of them.
- **`don_quixote` has no `N`/`E` facings.** `IMPORTED_FACINGS` gives him
  `["S"]`, so he is the same figure from every angle, like most of the imported
  roster.
- **The 2026-08-02 drop's bottom rows are unused.** Four more poses per clip sit
  in `sources/don_quixote-2026-08-02/`, on a different vertical baseline. Worth
  revisiting if his walk cycle reads as too short.
