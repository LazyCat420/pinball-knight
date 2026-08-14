---
part: Operations
status: reference
updated: 2026-08-08
---

# The sprite pipeline playbook

> **Picking up work?** The current job and its order are in
> *Next: the full dog moveset*. This chapter is the how; that one is the what.

**The ordered procedure for taking a creature from nothing to animating in the
game, with the gate at each step.** Read *Dead ends* alongside it — this chapter
says what to do, that one says what not to try again.

This exists because the procedure kept living in plan documents on branches, so
each session re-derived it. **It is the one copy. Update it in the same change
that changes the pipeline.**

---

## 0. Before anything: is the box able to run?

The single most common failure is not a modelling failure.

```bash
~/comfy/run.sh -d                      # start ComfyUI
curl -s localhost:8188/system_stats    # confirm it is up
```

Then, and only if a run is going to touch the **A14B** leg, free the host RAM:
close browsers, ideally reboot Windows. The Windows baseline is **14 GB
fresh-booted against 27.3 GB on a loaded desktop**, browsers are 14.65 of that,
and the difference decides whether the run finishes. Measure rather than assume:

```powershell
(Get-CimInstance Win32_OperatingSystem) | ForEach-Object {
  ($_.TotalVisibleMemorySize - $_.FreePhysicalMemory)/1MB }
```

**When a run fails, read `~/comfy/guard.log` FIRST.** It names the cause in one
line. A SOFT strike writes no `guard-tripped.json`, so that file's absence
proves nothing. Two sessions were lost to theorising past this.

### Which leg to run on

| | A14B pair | TI2V-5B ("small") |
|---|---|---|
| reads per run | ~31 GB | **~13.6 GB** |
| finishes at a 32 GB WSL cap? | **only with host RAM freed** | yes |
| first+last pinning (`--loop`) | **yes** | **no** — `Wan22ImageToVideoLatent` has no `end_image` |
| `pix3lwalk` / `styly` pixel LoRAs | **yes** | **no** — both are A14B-keyed; refused, not skipped |
| Lightning 4-step (`--fast`) | yes | no |

**So the two legs are not interchangeable.** The small leg is for new masters and
for proving a run completes; the levers that improve a *walk* are A14B-only.

---

## 1. The master — generate it, do not restyle a photo of it

One image, from a prompt, at the size it will ship at.

- **Canvas: 576 px.** It satisfies both constraints — `576/8 = 72` texels, the
  documented budget, and `576/32 = 18`, so it is on Wan's canvas grid. ⚠️ The
  older plans say 560; that is ×8-exact but **off the 5B grid** (560/32 = 17.5)
  and would be silently rounded. 544 (68 texels) is the other legal neighbour.
- **Magenta field, not white.** `isChroma` keys the magenta family exactly and
  for free; a pale field needs the tolerance matte and leaves a fringe.
- **`tarn59_pixel_art_style_qwen` on the Qwen leg** — this is the one place a
  pixel LoRA belongs.
- **GATE — `detectPixelGrid` on the RAW output.** Reject and re-roll unless it
  reports a real lattice at the intended factor. Do **not** fix downstream: the
  same check after the crush reads 100% for every sheet.

> ⚠️ **A text-to-image mode does not exist yet.** `app/api/comfy/generate/route.ts`
> rejects every request without an init and every mode declares `needs.init`.
> Until that is built, step 1 starts from an existing frame instead.

## 2. Rotate to the other facings — always off the ONE master

Never branch a facing off another facing: Qwen-Image-Edit identity drift
compounds over serial edits. `CAMERA_BY_DIR` pins one camera per facing and
`camera-sync.test.ts` keeps its two copies in agreement.

Re-run the step-1 gate per facing. A rotation that comes back anti-aliased has
left the lattice and everything downstream inherits it.

## 3. Keyframes — 4–6 poses per clip, one generation

`keyframes` mode, one call per (facing, clip). The poses are deliberately extreme
— timid keys are what make motion slide.

**GATE: the poses must measurably DIFFER.** `gaitSignals` lean should alternate
for a walk, and consecutive cells should differ by the 60–75% a good sheet shows,
not 14%. Measure it; do not eyeball it.

⚠️ If the poses regress toward each other, the escalation is ControlNet — which
**does not bind on 2511**. The untested lever is running the pose leg on
**Qwen-Image-Edit-2509**, which is on disk.

## 4. Cut

`op: "cut"` — the real matte + slicer, the same code the import runs. Cells land
on one canvas sized to the widest and tallest, feet on a shared baseline.

⚠️ Do not switch to tight per-cell crops: they arrive at different scales and the
video leg then interpolates a slow zoom.

## 5. In-between — keyframe to keyframe

`inbetween` mode. For keys K1..Kn run K1→K2, K2→K3, … and Kn→K1 to close the
loop; take 1–2 frames from the middle of each gap.

**A14B only** — the 5B latent node cannot pin a last frame.

Wan spends its first ~6–8 frames easing out of the init (measured three times:
idle 8, attack 7, walk 6). With a pinned END that should shrink — verify it
rather than assuming, because pinning both ends is exactly what removes the
model's need to invent where it is going.

## 6. Assemble and commit

`prep/prep-clips.mjs` with a `recipe-<DIR>.json` — the assembler that cannot emit
the assembly defect. Then `npm run sprites`, which runs `driftRow` as a hard gate
and prints the coverage census.

**If step 1 held the lattice, `commit` becomes a no-op that confirms it rather
than a crush that manufactures it. That is the test of whether any of this
worked.**

## 7. Publish into the game

For a **reskin** of an existing `EnemyKind` this is one line in
`boot/sheets.ts`:

```js
IMPORTED_ART = { ..., hound: "dog" }
```

For a **new kind** it is nine compile-enforced `Record<EnemyKind, X>` tables plus
a `spawnKind` case and biome weights; `npx tsc --noEmit` catches the tables and
`scripts/hooks/registry-drift.mjs` catches the rest.

**Two traps that have both shipped:**

- **`idle` is mandatory.** `importedPaints` returns null without it and says
  nothing — the stiltneck shipped for weeks never drawing.
- **Unauthored clips fall through to the PAINTER, per clip.** A restyled
  creature therefore changes species for any clip its sheet omits. Read the
  sidecar's `rows`, not the picture: `published.test.ts` prints the whole
  roster's coverage.

## The verified recipe for a quadruped walk

Measured and eye-approved 2026-08-08. This is the command, not an example:

```bash
cd src/game/pinball-knight/tools/sprite-forge/comfy
node cli.mjs animate \
  --init ../sources/dog-2026-08-07/12_wan_00699_.png \
  --preset walk4 --loop --frames 21 --seed 7 --file-as dog
```

451 s on A14B, ghost worst 0.36% against a 1% floor, no guard strike at a
15.1 GB Windows baseline. `walk4` is the four-beat quadruped gait; `--loop` pins
first and last so the cycle closes; `--file-as` is what makes the run visible in
`/forge`.

Use `walk` for bipeds and `--small` only when A14B cannot finish — the small leg
can do neither `--loop` nor the pixel LoRAs.

**Pick the init deliberately: a clean mid-stride frame, never a standing
master.** Pinning a stand at both ends animates stand → walk → stand.

## 8. THE EYE

**Play the clip at the game's frame rate and watch it.** No number replaces this.

```bash
ffmpeg -y -framerate 8 -pattern_type glob -i "<run-dir>/*.png" \
  -vf "scale=320:-1:flags=neighbor,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif
```

8 fps is the game's walk rate (`engine/config.ts`). For an A/B, compose the two
arms into one frame side by side and judge them together — a clip looks fine
alone and obviously worse beside its alternative.

**This gate has now failed in both directions**, which is why it is a gate and
not a formality:

- a census printed "BETTER than the painted roster" for art rejected on sight,
  and a 14%-motion idle survived review because nobody watched it move;
- and a motion metric scored `walk4 + --loop` at 37% against a free-run's 36%
  and would have retired a lever that visibly works.

Metrics catch what the eye cannot — 0.3% ghosting, a lattice at ×8. They do not
decide what looks right.

---

## The clip contract

What the forge authors and what the game asks for must be the same list. Three
copies exist (`MOVESET` and `KEYFRAME_SET` in `comfy/modes.mjs`, `DEFAULT_CLIPS`
in `build-plan.ts`) and `clip-contract.test.ts` pins them to each other.

**Seven clips:** `idle` (required), `walk`, `run`, `attack`, `stumble`, `crouch`,
`death`.

`crouch` is there because `render/tell-clips.ts` resolves the **leaper**
telegraph to it and — unlike `wake`, which `withRecoil` synthesizes — it has **no
fallback**. An unauthored `crouch` plays `idle`, which is how a hound charged for
weeks with no tell. `tell-clips-roster.test.ts` derives every kind's demand from
its policy and requires the painter or sheet to answer it.
