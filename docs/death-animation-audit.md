# Monster death animations — the audit that ended the hunt (2026-09-04)

Twenty-two commits over three days said they had fixed the monster death
animation, and it was still being reported as broken. This is the record of
what was actually true, measured against the **deployed** build rather than
against a unit test or a lab.

**The finding: the death pipeline works.** It worked before this audit started.
Every layer of it — combat event, state transition, frame progression, texture
UV, rendered pixels, scene visibility, delivery identity — checks out on the
build that is live right now. What was broken was the **measurement**, in three
separate places, and each broken measurement produced a report that read like a
broken game.

## What was measured, and how

All of it drives the real WebGPU runtime on the host GPU against
`https://pinballknight.braindeadbot.com/`. Nothing below is a unit test.

| Check | Method | Result |
| --- | --- | --- |
| **Delivery identity** | `npm run build` at HEAD, byte-compare to the live `/assets/index-*.js` | **Identical** but for the embedded `BUILD_ID` string. Deployed *is* HEAD. |
| **Ordinary play, WebGPU** | `scripts/audit-death-live.mjs` — `__dungeonBot` plays, every death transcribed from the build's own `[death:step]` logging | **34/34** stepped cel 0→N-1 and held the terminal cel |
| **Ordinary play, WebGL backend** | same, `--gpu cpu` | **32/32** |
| **Ordinary play, default entry** | same, `--intro` (full title sequence, no query params) | **33/34** (the 1 was still mid-death when sampling stopped) |
| **Whole roster** | `scripts/death-lab.mjs --all --kill force` | **27/28**, and the 1 was a probe defect — see below |
| **Real kill mechanisms** | one goblin, pinball ram via `__dungeonLaunch`, then melee via `__playerAttack` | both kill, both play all four cels |
| **Pixels** | contact sheet, live build | goblin visibly collapses to a flat puddle |

The delivery check is the one that had never been run. Every earlier report
asserted "Live manifest & atlas verified" as a **sentence the script always
prints**, with nothing behind it.

## The three broken measurements

### 1. A probe that could not land its kill blamed the art

`death-lab.mjs --all --kill ram` printed **2/28 kinds play a death animation**.
The traces said `texture played [1,2,3,0] of [12,13,14,15]` — cels 0–3 are the
**idle** row. The monsters were alive and walking for the entire sample window.
The launch trigger lands on the first kind and misses every one after it, and
the verdict spent the survivors' evidence on the wrong claim.

*Fixed:* the probe now asserts the precondition and gives it its own verdict —
`⚠ NEVER DIED — the ram trigger did not land (hp 3, clip idle); says NOTHING
about the death animation` — and excludes those kinds from the denominator. A
trigger that misses can no longer be read as art that does not play.

### 2. The roster's only ✖ was the wrong atlas, not a broken monster

`death-lab` scored every actor against `__dungeonClipCels(kind).clips["S:death"]`.
A **reaper is a brute wearing the boss atlas**: its death cels are 50–53, while
the kind's own `S:death` reads 12–15. It stepped 50→53 monotonically and was
marked failed for it.

*Fixed:* the terminal cel is read off the **dying actor**
(`__dungeonAnim()[0].indices`), with the kind's row kept only as the fallback
for a spawn that never reached the death clip.

### 3. A claimed co-op fix that was unreachable code

`fa720106` added `"death"` to `MIRRORED_CLIPS` in `render/remote-party.ts` and
reported the co-op death gap closed. It could never fire: `v.dead` is latched
three lines above the mirror check, and the dead branch forces `play("idle")`
and `continue`s past it. **A dead peer stood in an idle pose for the entire
period the set said death was mirrored.**

*Fixed:* the dead branch now plays the peer's `death` clip and holds its
terminal cel, with facing captured once at the transition (`Animator` has no
death lock — that lives on `MonsterAnimator` — so re-asserting the reported
facing every tick would re-seat the clip's row mid-collapse). `"death"` was
removed from `MIRRORED_CLIPS`, because that path cannot see it.

## Corrections to the record

- The asset census claimed **35 manifests** and named 16 with authored death
  rows. There are **43**, and **39** carry a death row. The four without are
  `brute-S`, `compass-E/N/S` — and only `brute` is a monster.
- Removing the `clip === "death" → S:idle` fallback from `MonsterAnimator` was
  correct, but it was **not** the cause of the reported bug: that fallback was
  introduced by `c183259e` on 2026-09-03, after the complaint it was credited
  with causing.
- The procedural path it was said to be blocking already animates.
  `withRecoil()` in `render/cel-painter.ts` synthesizes a four-frame
  rotate-and-squash collapse off the idle frame for any painter with no
  authored death row. `brute` was never showing a frozen standing pose from
  that seam.

## Open items

- **`death-lab --kill ram` only lands the first kind.** The trigger is not
  re-armed between roster entries — the knight's position or momentum after
  `__dungeonClear()` is the likely culprit, unconfirmed. `--kill force` is the
  reliable roster mode. The probe is now honest about the miss, but it is not
  fixed.
- **`RemotePartyRenderer` drives its own animators.** It calls
  `v.animator.update(dt)` directly rather than registering with
  `AnimationPresentationSystem`, whose header declares itself "the SINGLE
  animation clock owner in the game". Those animators are not in `state.zombies`
  so nothing double-ticks today, but the stated invariant is not the one the
  code holds.
- **Duplicate `Cache-Control` on hashed assets.** `nginx.conf` emits both
  `max-age=31536000` (from `expires 1y`) and
  `public, max-age=31536000, immutable` (from `add_header`). Harmless in
  practice; one of them should go.

## The residual report

The complaint that triggered this audit was against the deployed web build in a
browser. Nothing in the pipeline reproduces it. The remaining explanation is a
**stale `index.html` on the client**: the no-cache fix for it landed in
`61f9cd4b` (2026-09-02), and a browser that cached the header-less HTML before
that deploy can hold the old bundle — and therefore the old game — under RFC
9111 heuristic freshness until it revalidates.

`__dungeonBuild()` in the console is the one-line answer. It must print the
`BUILD_ID` of the live deploy; anything older is a pre-fix bundle, and a hard
reload is the whole fix.
