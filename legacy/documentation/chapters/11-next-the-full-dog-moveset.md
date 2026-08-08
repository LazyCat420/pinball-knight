# Next: the full dog moveset

**Written 2026-08-08 at the end of the session that got the first approved clip.
This is the next session's work order.** Start here, not by re-reading the
handoff.

The decision taken at the end of that session: **do not publish into the game
until the moveset is complete.** A partial sheet falls through to the painted
hound per clip, so a dog that walks and then dies as a different creature is
worse than no dog. Publishing is the LAST step now, not the next one.

---

## Where we actually are

| | |
|---|---|
| **approved** | `walk` (E facing) — `walk4 + --loop` on A14B, 451 s, ghost 0.36% against a 1% floor, judged good by eye |
| master | `sources/dog-2026-08-07/` — 21 frames, **E facing only** |
| recipe | verified and saved — chapter 09, and the `pixel-sprite-animation` skill |
| box | A14B completes again (Windows baseline 15.1 GB); 5B leg installed as the fallback |
| in game | **nothing yet, deliberately** |

Run it with the skill, or directly:

```bash
cd src/game/pinball-knight/tools/sprite-forge/comfy
node cli.mjs animate --init <init.png> --preset walk4 --loop \
                     --frames 21 --seed 7 --file-as dog
```

---

## ⚠️ First: the direction question is an ENGINE question, not an art one

The ask was walk cycles for up, down, bottom-left, bottom-right, top-left,
top-right. **The engine cannot draw those today.**

```ts
/** The three painted directions. W is rendered by horizontally flipping E. */
export type Dir = "S" | "N" | "E";
```

So the roster is **4 apparent directions from 3 authored ones** — S (toward
camera), N (away), E (right), and W for free by mirroring E. There are no
diagonals in the type, and adding them is not an art task:

- `Dir` is a union consumed by `Record<Dir, …>` tables in every painter, in
  `cel-painter.ts`, `imported-paints.ts`, `sprite.ts` and the animator. Adding
  `NE/NW/SE/SW` makes every one of those a compile error until filled.
- It **doubles the art**: 8 authored facings instead of 3 (only W stays free),
  so the matrix below goes from 21 rows to 49.
- The mirror trick only pays for one axis. NE mirrors to NW, SE to SW — so 8
  apparent directions need **6** authored, not 4.

**Three options, and this needs a decision before any diagonal work starts:**

| option | art cost | engine cost | what it looks like |
|---|---|---|---|
| **A — keep 3 authored (S/N/E+mirror)** | 21 rows | none | what every creature in the game does now. A dog walking diagonally plays its nearest cardinal |
| **B — add 4 diagonals** | **49 rows** | `Dir` union + every `Record<Dir,…>` + the facing picker | true 8-way movement |
| **C — 3 now, diagonals later** | 21 rows now | deferred | finish the dog, decide on diagonals once one complete creature exists |

**Recommendation: C.** No creature in this game has ever had a complete 3-facing
moveset — the best is the player knight at 21 rows, hand-repaired rather than
generated. Doubling the matrix before finishing one is how the last several
sessions ended with nothing shippable. Get one creature complete, look at it in
game, then decide whether diagonals are worth 28 more clips.

---

## The matrix — what "complete" means

Seven clips × three authored facings = **21 rows**. One is done.

| clip | E | S | N | notes |
|---|---|---|---|---|
| `idle` | ☐ | ☐ | ☐ | **mandatory** — `importedPaints` returns null without it and logs nothing |
| `walk` | ✅ | ☐ | ☐ | done E, `walk4 + --loop` |
| `run` | ☐ | ☐ | ☐ | `--preset run`; it correctly does NOT carry `pix3lwalk` |
| `attack` | ☐ | ☐ | ☐ | the bite |
| `stumble` (hurt) | ☐ | ☐ | ☐ | else `withRecoil` synthesizes one from idle frame 0 |
| `crouch` | ☐ | ☐ | ☐ | the **leaper telegraph**. No fallback — unauthored it plays `idle`, which is how the hound charged for weeks with no tell |
| `death` | ☐ | ☐ | ☐ | the brute shipped without one and died as another creature |

**Cost: 20 runs × ~450 s ≈ 2.5 h of GPU**, plus two `rotate` runs to make the S
and N masters, plus review time. It is a long session but a mechanical one — the
recipe is settled and every run is the same command with a different `--preset`
and `--init`.

---

## Order of work

**1. Rotate the master to S and N first — S FROM E, THEN N FROM S.**

> ⚠️ **CORRECTED 2026-08-08.** This step used to say "everything branches off
> the ONE approved master; never rotate a facing off another facing", on the
> reasoning that Qwen-Image-Edit identity drift compounds over serial edits.
> That reasoning is still true and it is still outranked, because **E → N in
> one step does not return a back view. It returns the E master flipped
> horizontally** — measured at **0.942 silhouette IoU against mirrored E**,
> which is not "similar", it is the same picture.
>
> From a side view, "back view" is satisfiable by a reflection, and a
> reflection is free while a real 180° turn means synthesising the entire
> unseen far side. The model takes the cheap reading. A front view is not
> reachable by any reflection of a side view, so **E → S is safe and S → N is
> safe**; only the 180° ask is ambiguous. Two generations of mild drift is a
> cost; a mirror is not a back view at all.
>
> Full measurement in chapter 13.

```bash
# S from the approved E master — 90 degrees, unambiguous.
node cli.mjs rotate --init <E master> --to S --file-as dog
# N from the S RESULT — 90 degrees again. NOT from E.
node cli.mjs rotate --init <S result> --to N --file-as dog
```

`--to` now takes a facing ID and resolves it to the multi-angle LoRA's trained
azimuth token, so a facing cannot be spelled wrong. **Verify every rotation
against the MIRROR of its input**, not just against the input — a flip scores
far from the original and is trivially wrong.

Note `cli.mjs rotate` used to bypass `MODES` entirely and never loaded the
`fal-multi-angle` LoRA at all, so any rotation run before 2026-08-08 was
freeform turning. Fixed; the run now prints which grammar it used.

**2. Finish E first — all seven clips on the facing that already works.** Do not
spread thin across facings. A complete E is something to look at and judge; three
half-facings is not, and the facings must look like the same animal.

**3. Then S, then N.** N last: it is the facing nobody looks at closely and the
one most likely to be acceptable at lower quality.

**4. Judge each clip as it lands**, at 8 fps, side by side with the previous
approved clip of the same creature. Do not batch twenty runs and review at the
end — that is how a 14%-motion idle survived review.

**5. Publish only when the matrix is full**, then it is one line:
`IMPORTED_ART = { ..., hound: "dog" }`, then `__lab.only("hound")`.

### Per-clip notes worth having before starting

- **`idle` is the risk clip.** The 08-07 failure was an idle that measured
  479×588 for all 21 frames — Wan produced no motion at all. An idle is small
  movement, which is exactly where free-running I2V does nothing. If it comes
  back static, **that is a failed generation, not a curation problem** — and it
  is the clip most likely to need the keyframe path.
- **`crouch` is a HELD pose**, not a cycle. It must end on its deepest frame:
  `anim.crouch` at 7 fps ≈ 0.43 s against `LEAP_WINDUP` 0.45 s, so a key that
  wanders is a telegraph that finishes where the pounce does not start.
- **`death` must not dissolve.** Both 08-06 death runs drove the field black and
  turned the figure into particle VFX, which a sprite bakes in permanently. The
  negative already bans smoke/glow/particles; check the field is still keyable.
- **`attack`/`crouch` may want `--loop` OFF.** A one-shot is not a cycle, and
  pinning first == last would force it back to its start pose.

---

## What is NOT blocking this

Recorded so the next session does not go looking:

- **The box.** A14B completes; both legs installed; the guard has not struck
  since 05:43 on 08-08.
- **The recipe.** Settled and saved as a skill.
- **The decode.** One temporal window on both legs, pinned by
  `decode-window.test.ts`.
- **The clip contract.** Seven clips, three lists pinned together by
  `clip-contract.test.ts`.
- **The intake.** A quadruped no longer gets rejected for being wider than tall.

## What IS still unbuilt, and can wait

- **`txt2img`** — there is no way to generate a master from a prompt alone; the
  generate route rejects every request without an init. Not blocking, because
  the dog already has a master.
- **The raw pixel gate** — `detectPixelGrid` still runs after the crush, where
  it always reads 100%. The dog's art quality is inherited from its source
  rather than generated, so this bites the *next* creature, not this one.
- **The keyframe path** — draw the poses, then in-between them. The escalation
  if `idle` (or any clip) comes back static.
