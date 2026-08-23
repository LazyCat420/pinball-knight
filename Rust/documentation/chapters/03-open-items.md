---
part: Problems
status: in-progress
updated: 2026-08-10
---

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

## 2. Side-view art quality: two "E" sheets are not side views

*(The previous item here — "`CAMERA_BY_DIR` is decided but not wired" — is
RESOLVED: `f4d55f1` wired it into `comfy/modes.mjs` and `camera-sync.test.ts`
pins the two copies together.)*

**Impact:** `frog-E` and `stiltneck-E` are FRONT views published under an E
label, so those creatures look the same walking sideways as walking down.
Found in the 2026-08-05 roster orientation audit
(`tools/sprite-forge/docs/FACING_STANDARD.md` has the table).

The knight and zombie had the worse version of this — genuinely inverted
side views (facing left under an E label), which made them look backwards
walking BOTH sideways directions since W is E-mirrored. Those are fixed with
the sidecar/manifest `mirror` flag; front-views cannot be fixed by a flip.

**Next step:** regenerate frog-E and stiltneck-E through `/forge` rotate
(`CAMERA_BY_DIR` pins the camera; the `<sks>` grammar names the direction),
then re-run the audit render. Any future sheet: verify against
`FACING_STANDARD.md` before publishing — the compass workflow exists for
exactly this.

## 2b. The E walk cycle plays at half speed

**Impact:** cosmetic but visible. `pinball_knight-E` authors 6 walk/run
frames where S and N author 3, all playing at the same `walk: 8` fps
(`engine/config.ts`), so the side-on stride cycle takes twice as long as the
front/back one. Neither the knight manifests nor `makeKnightPaints` declare
`beats`, and the animator only normalises cycle duration when `beats`
exists (`animator.ts`).

**Next step:** either declare `beats` for imported clips in the manifest, or
have the animator normalise a clip's cycle to a per-clip duration rather
than per-frame fps when frame counts differ across facings.

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

## 6. ~~Two source PNGs are dirty in the working tree~~ — RESOLVED

*(The previous item — `sources/pinball_knight-2026-08-02/14_spin_attack_4frames.png`
and `frame_0.png` modified by another session and left alone during the
`57b0511` merge — is closed. Verified 2026-08-08: `git status` is clean on
`main`, so they were either committed or discarded by a later session.)*

## 6b. The perf harness measures at 1080p now — old numbers are not comparable

**Impact:** any frame time recorded before 2026-08-05 was measured at 1280x720
and cannot be compared with one recorded after. `scripts/playtest.mjs` now
defaults to `--viewport 1920x1080` (2.25x the pixels, and what people actually
play at), and every profile line prints the resolution it was measured at.

The report also carries the whole distribution — p50/p95/p99/worst plus the
share of frames over 16.67ms (`jankPct`) and over 33.3ms (`stutterPct`) — so a
run says WHICH kind of slow it was. `--max-jank-pct` gates on the hitch rate the
way `--max-frame-ms` gates on p95; a game that is fine on average and hitches
twice a second passes the second and fails the first.

**Measured baseline** (nvidia/ampere, host Chrome, 1920x1080, 25s mixed bot):
p50 6.9ms, p95 18.5ms, p99 30.2ms, 7.8% jank. A **472ms** worst frame showed up
immediately — invisible in the old p95-only line. Worth chasing next; it is
almost certainly a first-encounter pipeline compile (see the WebGPU stall notes)
rather than steady-state cost.

## 7. Co-op peers still render marble rides as a walk cycle

**Impact:** multiplayer only. `render/remote-party.ts`'s `MIRRORED_CLIPS`
lists only `ball/roll/attack/run`, so a PEER riding a marble body or steel
ball renders as a walk cycle on your screen. The same defect was fixed for
multi-ball echoes (`isRideClip()` in `engine/render/animator.ts` derives it
from the clip name); remote-party should use that predicate instead of its
own list.

## 8. Traced real-pixel sets are export-only

**Impact:** none yet — this is the road, stated so it isn't rediscovered.
`npm run pixels -- trace-manifest <name>-<dir>` turns any published sheet
into hand-editable `AuthoredCell` grids (per-frame, palette-snapped,
mirror-honouring). Nothing turns an EDITED traced set back into a published
sheet, so edits made in the text format cannot ship. The missing half is a
`publish-set` mode: traced set → sheet PNG + declared `rects` sidecar →
inbox, at which point the whole loop (generate → trace → hand-fix texels →
republish) closes and the traced set becomes the durable source of truth for
consistency work across facings.

## 8b. The forge's clip list is shorter than the game's clip demand

**Impact:** high, and invisible — it is the same defect class as the hound's
charge tell (`97eb184`), which was drawn carefully, published under the wrong
name, and never once appeared on screen.

Three lists describe "what a character needs" and they do not agree:
`MOVESET` authors **seven** clips (it has `defend` → `crouch`), while
`KEYFRAME_SET` and `DEFAULT_CLIPS` author **six** and drop it. `DEFAULT_CLIPS`
is introduced by a comment asserting all three already agree, which is what
makes the drift invisible; `camera-sync.test.ts` pins the camera table across
the same two files and **nothing pins the clip lists**.

Meanwhile the movement policies demand `crouch` (leaper), `wake` (ambusher /
strafer) and `wait` (packhunter — a fully implemented policy with **zero kinds
assigned**). Only `wake` has a fallback. So even a perfect 18/18 build would
still ship a hound whose charge tell plays a breathing idle.

**Next step:** the three-step fix in *Can the forge make a character?* §3 —
one source list, a test that pins the copies together, and a roster-wide
generalisation of `hound.test.ts`. Pure TypeScript, no GPU.

## 9. `__dungeonClips("player")` returns null

**Impact:** cosmetic, affects verification only. The clip-table probe resolves
through `SHEET_KEY_BY_KIND`, and `"player"` is not an `EnemyKind`, so the query
returns null even when the player's art loaded fine. `knight-check.mjs` prints it
and correctly does not rely on it.

**Next step:** teach `__dungeonClips` the player path, so the harness can assert
the clip table and not only the boot line.
