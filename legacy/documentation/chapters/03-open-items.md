# Open items

Ranked by what actually costs something. Each states its blast radius so a
future reader can decide rather than re-investigate.

## 1. Making a character is still a manual relay race

**Impact:** this is the reason the Character Builder exists, and it is the
largest cost in the whole system. The forge owns every individual step and
nothing owns the *character*. Building one means: pick a move, launch, wait,
find the job card, cut it into cells, drag rows into the tray — then repeat
seventeen more times for the other moves and facings.

The allocation is backwards. The GPU is the cheap, unattended resource; human
attention is the scarce one. The machine should render everything and hand back
a wall of frames to cull.

**What exists** (`57b0511`): `build-plan.ts` — the durable `CharacterBuild`
record, refusing at plan time what would otherwise fail half an hour later (an
unpublishable name, a clip outside `KNOWN_CLIPS`, a missing `idle`, a skipped E
facing). `jobOrder()` groups a facing's clips together so a whole build pays zero
model swaps. `drift.ts` — the per-cell identity gate.

**What does not exist:** the planner route, the review workspace, and any
evidence that the two shipped modules survive contact with real generated art.
See *What is not built yet*.

## 2. `CAMERA_BY_DIR` is decided but not wired

**Impact:** every character generated today still mixes cameras, so it visibly
teleports when it switches clips mid-combat.

Walk and run are authored from a true side view; attack, stumble and death from
three-quarter. Each reads best that way *in isolation*, and in isolation is the
problem — the game does not play one clip, it cuts between them.

**Decided 2026-08-05:** one camera per **facing**, not per move. E is side-on, S
faces the camera, N faces away, and every clip of a facing shares that viewpoint.
It costs the attack some depth and buys two things: the creature never pops, and
every cell in a facing becomes geometrically comparable — which is what makes the
drift gate mean anything.

**Status:** the constant lives in `build-plan.ts`. `comfy/modes.mjs` does not
read it. `KEYFRAME_MOVES[].camera` is still per-move and still authoritative for
anything generated today.

**Next step:** replace that field with a `CAMERA_BY_DIR` lookup, thread the
facing through `build(params, ctx)`, and keep a per-move override in the type for
a deliberate cinematic boss.

## 3. A 40-minute build cannot survive a dev-server reload

**Impact:** blocks the planner route (item 1). A full build is ~18 jobs at
~100 s; a Next.js hot reload in the middle currently orphans all of them.

The job engine reports reloaded-away jobs as `"lost in a dev-server reload —
re-roll it"`. That is honest for one job and useless for eighteen. Jobs persist
to `work/comfy/<id>/job.json`, so the data survives; the reconciliation does not.

**Next step:** `work/builds/<id>/build.json` with the same persistence pattern,
and a reconcile that reports each row's true state rather than phantom queued
jobs.

## 4. The panel cannot adopt a sheet without a source edit

**Impact:** every reskin needs a hand edit of `boot/sheets.ts`, so the
publish→play loop is not closed inside the tool.

- **4a** — `IMPORTED_ART` (`boot/sheets.ts`) needs one line per reskin. The panel
  should write it. Source-mutating, so it wants an explicit button and a
  `published.test.ts` re-run after.
- **4b** — `__lab.playAs("<name>")` works but is console-only. It should be a
  picker in `InGameCard`, populated from published sheets, with one-click
  rollback to `pinball_knight`.

## 5. Generated players are cosmetically fixed

**Impact:** accepted, not a bug to fix — but it must be stated in the UI rather
than discovered.

Only 6 of the player's 17 clips are in `PLAYABLE`, so a generated character turns
back into the knight for `roll`, `ball`, the marble forms and the ricochet forms.
Gear swaps are invisible because gear is *painted into* the knight's geometry.
The HUD mugshot and the menu paperdoll stay knight. Co-op peers render as your
creature.

Total parity means rebuilding the paperdoll model. Not worth it; say so on
screen.

## 6. Two source PNGs are dirty in the working tree, provenance unknown

**Impact:** low, but unresolved.
`sources/pinball_knight-2026-08-02/14_spin_attack_4frames.png` (751 KB →
1,044 KB) and `frame_0.png` (283 KB → 278 KB) are modified by another session and
were deliberately left alone during the `57b0511` merge. They are genuinely
edited source art, not debris.

**Next step:** find out whose they are and either commit or discard them.

## 7. `__dungeonClips("player")` returns null

**Impact:** cosmetic, affects verification only. The clip-table probe resolves
through `SHEET_KEY_BY_KIND`, and `"player"` is not an `EnemyKind`, so the query
returns null even when the player's art loaded fine. `knight-check.mjs` prints it
and correctly does not rely on it.

**Next step:** teach `__dungeonClips` the player path, so the harness can assert
the clip table and not only the boot line.
