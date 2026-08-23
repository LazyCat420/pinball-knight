---
part: Orientation
status: reference
updated: 2026-08-10
---

# Current state

What is verified working, and the evidence that proved it. Nothing here is
listed on the strength of "it should work" — each row names how it was checked.

*Last verified 2026-08-05 against `main@57b0511`, deployed to synology.*

## Verified working

| capability | evidence |
|---|---|
| **Intake: any image → clean idle frame** | A 900×1200 photo-like source (gradient sky, textured ground, distractor rock, cast shadow, subject off-centre at 38% height) was correctly **rejected** raw with 6 named failures, then `prep` → `segment` (9 s on BiRefNet) → `reframe` returned **READY** on all nine checks: one figure, 72.0% tall, feet at y=921 (want 922), centred at 512, 1.9× upscale. The rock and the shadow were gone. |
| **Move sets from one frame** | Six keyframe sheets generated from a single idle frame, each branching off the same master. |
| **The crush** | The knight commits at **×8, 100% confidence, block-reduce EXACT, cell purity 100%**, 70×72 texels, 20 palette entries (8 evicted, 0.74% of opaque texels moved). |
| **Publish** | `npm run sprites` writes all seven inbox sheets; suite green at **145 passed / 1 skipped**. |
| **The player's imported art loads** | `[dungeon] player: imported pinball_knight art loaded`, read from the **live container** at `10.0.0.16:5174`, on Windows Chrome over CDP. Screenshot confirms the knight rendering. |
| **Five monsters draw imported art** | Live boot lines for `jester [S]`, `rotortail [S/E]`, `croaker [S/E]`, `fish_feet [S/E]`, `zombie [E]`. |
| **Drift gate** | Calibrated against four shipping sheets; see below. |

## The knight, end to end

The player character is the sharpest proof the pipeline works, because it was
the thing most thoroughly broken. As shipped in `57b0511`:

```
public/sprites/pinball_knight-{E,S,N}.json
  keys   name, dir, image, source, grid, rows      (was: rows, rects, commit)
  grid   8                                          (was: absent — uncommitted)
  rows   idle 5 · walk 6 · run 6 · attack 4 · attack 4 · stumble 2 · death 3 · roll 6
  png    188,963 bytes                              (was: 3,564,083)
```

Two `attack` rows is correct, not a bug: rows sharing a clip name are
**appended** by `importedPaints`, so a long attack authored as two rows works.
The second was the old `spin_attack` row, which was never a `ClipName` and had
been silently dropped on every import since it was authored.

Verified live rather than locally:

```
$ curl http://10.0.0.16:5174/sprites/pinball_knight-E.json
  keys: name, dir, image, source, grid, rows   grid: 8
$ node scripts/knight-check.mjs --url http://10.0.0.16:5174/dungeon
  [dungeon] player: imported pinball_knight art loaded
  VERDICT: IMPORTED ART LOADED ✓
```

## The drift gate, and what calibrating it proved

`drift.ts` scores every generated cell against its facing's master. `intake-qa`
asks whether one frame obeys the geometry contract; it cannot ask about identity,
because at intake there is nothing to compare against.

| check | verdict | calibration result |
|---|---|---|
| `area` — body mass vs master | **hard** (advisory for off-floor clips) | every standing cell of four shipping sheets sits inside the band |
| `palette` — asymmetric OKLab distance | **hard** | **zero failures across all four sheets** |
| `aspect` — bbox proportions | **advisory only** | see below |
| `feet` — baseline | advisory | skipped for death / roll / ball / stumble |
| `distinct` — pairwise IoU across a clip's keys | **hard** | catches the model returning one pose three times |

**Calibration refuted one of these metrics, which is the entire reason it exists.**
Scored against art the game draws today, bbox aspect came back 28% off (beaver
attack), 38% (beaver walk), 50% (frog walk) and 251% (jester's final death frame)
from their own idle frames. Nothing had drifted — a stride is genuinely wider
than a stand, and a collapsed body is genuinely a different rectangle. **Bbox
aspect measures pose, not identity.** As a hard gate it would have rejected four
of four known-good sheets. It is demoted to advisory, with the numbers recorded
in the source so nobody re-derives it.

The same pass found death frames legitimately at 0.61–0.63× their idle's mass,
which is why off-floor clips are exempt from the hard area band rather than the
band being widened for everyone — widening would have stopped catching a dropped
weapon on a standing clip.

> **The honest limit of this calibration.** Reading shipped art to tune a gate
> that judges shipped art measures the pipeline against itself. It proves the
> gate is not insane. Only a real build whose flagged cells a human agrees were
> bad can prove it is *right*, and that evidence does not exist yet.

## Infrastructure that is known good

- **ComfyUI** 0.30.0, reachable, 26.5 GiB system RAM free at idle.
- **RAM guard** (`comfy/guard.mjs`) alive, heartbeat fresh, floors soft 1.2 / hard 0.5 GiB WSL, host hard 60 GB.
- **Leg-affinity scheduler** runs one job at a time and calls `/free` exactly once on a real model-family switch. Every keyframe job is the `qwen` leg, so a whole character build pays **zero** model swaps.
- **Deploy** `bash deploy.sh` → synology, 122 s, with `:previous` retained for rollback.

## Model stack in use

| leg | model | note |
|---|---|---|
| edits, rotation, keyframes | Qwen-Image-Edit-2511 Q4_K_M GGUF | ~20.4 GB peak, ~260 s/frame quality, ~100 s fast |
| motion | Wan 2.2 I2V A14B Q6_K, two experts | ~450 s / 21 frames |
| segmentation | BiRefNet (default) · Lucida (illustrations) | ~9 s |
| pixel style | `tarn59_pixel_art_style_qwen` | |
| turnaround / angles | `character_turnaround_sheet_v3` · fal 96-angle LoRA | |
| motion style | `wan2.2_pixel_animate_adapter` · `pix3lwalk` | as far as is known, the only pixel-specific motion adapters that exist |

Licences are **recorded, not enforced**. An earlier version of
`comfy/manifest.mjs` claimed a strict Apache-2.0 bar "the user set"; no such
ruling was ever made, and later sessions cited that comment back at themselves
to reject tools. Pick the model that makes the best sprite.
