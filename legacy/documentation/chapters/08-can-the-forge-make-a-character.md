# Can the forge make a character yet?

**No — and the reason is not one thing.** Audited 2026-08-08 against
`main@c9c8144` and `brute-ragnarok-sources@4a6a774`, where all the current forge
work lives.

Three separate walls stand between "a prompt" and "a monster animating in the
game", and each one has been mistaken for the whole problem at least once:

| | wall | state |
|---|---|---|
| 1 | **Nothing in the pipeline generates pixel art.** The lattice is manufactured at the end by block-reducing a painting. | diagnosed, plan written, **not built** |
| 2 | **The clip list the forge can author is smaller than the clip list the game demands**, and the two lists disagree in a way no test checks. | **found in this audit** |
| 3 | **The animation leg does not fit the box.** Not VRAM — host RAM. | measured, and there is a model swap that fixes it |

Read this before proposing a fix to any one of them, because fixing one leaves
the other two standing.

---

## 1. What actually works today

Verified in this audit, not inherited from an older note.

| stage | state |
|---|---|
| **Intake** — any image → clean, keyed, correctly-framed idle frame | **works.** Ten checks, and `fd26594` fixed the last structural refusal: a creature wider than it is tall (every quadruped) was rejected by a height-only check and then had its own back erased as a ruled border. The styled hound goes REJECT → READY on all ten. |
| **Segment / matte** — BiRefNet cut-out | **works.** 1–2 s, coexists with the Qwen stack on 24 GB, so intake costs seconds rather than a model swap. |
| **Rotate** — one facing → another, identity held | **works.** Proven on the croaker; `CAMERA_BY_DIR` pins one camera per facing and `camera-sync.test.ts` keeps the two copies of that table in agreement. |
| **Keyframes** — N named poses in one generation | **built, and bypassed.** `modes.mjs` has it; `animate` was easier to call. |
| **In-between** — first frame + LAST frame, gap filled | **built, and never used in anger.** |
| **Cut** — sheet → cells on one shared canvas, feet on a baseline | **works.** |
| **Crush / commit** — ×8 lattice + 20-colour derive | **works, and is the problem.** See §2. |
| **Publish → in-game** | **works.** `npm run sprites`, `driftRow` as a hard gate, coverage census printed. |
| **The player, end to end** | **The only complete actor in the game** — and it was hand-*repaired*, never generated. |

The animate leg (Wan 2.2 I2V) also works in the sense that it produces frames.
Whether those frames are usable is §2, and whether it can finish a run at all is
§4.

---

## 2. Wall 1 — nothing generates pixel art

Four measurements, all in-repo, all reproducible. The full argument is in
`tools/sprite-forge/docs/PLAN_KEYFRAME_PIPELINE.md`; this is the short form.

**The forge says so itself.** On the sheet published 2026-08-07 its own report
read:

```
GRID  NOT PIXEL ART — no lattice (best x3 at 1.2%, need 90%) and only 44%
      flat neighbours. Continuous/anti-aliased art: it will be RESAMPLED,
      not reduced, and CANNOT import 1:1.
```

**The gate cannot tell good from bad, because it runs after the crush.**
Post-commit, the rejected 08-07 sheet and the liked 08-06 one *both* measure
`grid x8, confidence 100%, cell purity 100%`. `detectPixelGrid` is measuring the
reduce, not the art. This is how a rejected drop passed every check and left with
a "BETTER than the painted roster" verdict.

**Asking harder makes it worse.** Capitals demanding no-AA / flat fills /
≤16 colours produced **301,541 distinct colours**. Wording is not the dial, and
neither is the game's resolution.

**The quality in the liked sheet was never generated — it was inherited.** A real
Ragnarok Online sprite, drawn by a human at ~70 texels, went in at `55f98e2`.
Every generation since is a restyle of a restyle, and each hop loses edge
hardness. The figure ships at ~70 texels; generations run at 640–1024 px. That is
a 9.5:1 crush, and `7c8036f` already named the result "mush".

> **The rule this bought:** art authored above the texel budget cannot be rescued
> downstream. Generate *for* ~70 texels — a 560 px canvas is ×8 and reduces
> exactly — or accept a painting that has been averaged.

### And the animation does not play

Share of the sprite box that changes between consecutive published frames, on the
cells the game actually draws:

| row | liked (`55f98e2`) | rejected (08-07) |
|---|---|---|
| idle | 63% | **14%** |
| walk | 69% | 53% |
| attack | 75% | 65% |

Idle is what a monster does most of the time on screen, and the rejected one is
effectively a still. The cause is upstream of frame-picking: the S idle clip
measured **479×588 for all 21 frames**, gait lean flat at +0.068. Wan I2V,
free-running from one image and a sentence, produced no motion at all — and the
prompt it was given even contains *"the character stays centered in frame"*.

> **A pose is not something you hope for. It is something you draw and then ask
> the model to reach.** That is what the keyframe path is for, and it is why
> `pose`/ControlNet exists as the escalation — except ControlNet **does not bind
> on Qwen-Image-Edit 2511** (benched `4689d57`: tripling the strength moves the
> output 1.08 → 1.85 out of 255, which is structural, not tuning). The untested
> lever is running the pose leg on **2509**, which is already on disk.

### What is missing, concretely

1. **A text-to-image mode.** The one real gap. `app/api/comfy/generate/route.ts`
   rejects every request without an init, and every mode declares `needs.init`.
   **There is no path in this repo that generates from a prompt alone**, so step
   one of the plan cannot be run today.
2. **A pixel gate on the GENERATION, not the crush.** Run `detectPixelGrid` on
   the raw output and fail there. On the 08-07 frames it reads
   `grid x1, confidence 0%, flat 36%` — it would have stopped the drop on the
   first image.
3. **Nothing renders a clip as a clip.** Every judgement in this repo is made on
   still contact sheets. A 4-frame loop at the game's frame rate is the only
   honest preview of a walk cycle, and the reason a 14%-motion idle survived
   review is that nobody watched it move.

---

## 3. Wall 2 — the clip lists disagree, and nothing checks it

**This is new in this audit.** It is the same defect class as the hound's charge
tell (`97eb184`), which was drawn carefully, published under the wrong name, and
never once appeared on screen.

### What the roster actually has

`npm test -- tools/sprite-forge/published.test.ts`, measured today:

```
brute            3/18 rows · facings S · no E/N art · NO DEATH
jester           5/18 rows · facings S · no E/N art
rotortail        8/18 rows · facings S+E · no N art
croaker          8/18 rows · facings S+E · no N art
fish_feet        8/18 rows · facings S+E · no N art
zombie           6/18 rows · facings E · no S/N art
player:pinball_knight  21/18 rows · facings S+N+E     <- the only complete one
player:mario     10/18 rows · facings S+N · no E art
```

A missing clip does not fail. `paintsFor` merges imported art **over** painted
art *per clip*, so an unauthored clip silently falls through to the old painter —
a restyled creature changes species the moment it dies. `withRecoil` goes further
and *synthesizes* a `stumble` from three shoves of idle frame 0, which the census
prints as `stumble: synthesized by withRecoil` and reads as covered.

### And the target itself is short

Three lists describe "what a character needs", and they do not agree:

| list | file | clips |
|---|---|---|
| `MOVESET` (the panel's one-click batch) | `comfy/modes.mjs` | idle, walk, run, attack, stumble, **crouch** (as `defend`), death — **7** |
| `KEYFRAME_SET` (the keyframe batch) | `comfy/modes.mjs` | idle, walk, run, attack, stumble, death — **6** |
| `DEFAULT_CLIPS` (the build plan, and what the census scores against) | `tools/sprite-forge/build-plan.ts` | idle, walk, run, attack, stumble, death — **6** |

`DEFAULT_CLIPS` is introduced by a comment that reads:

> *Mirrors `MOVESET`/`KEYFRAME_SET` in `comfy/modes.mjs` — **the same six moves,
> the same clip mapping** (stagger is `stumble`, **a block is `crouch`**),
> because two lists of what a character needs is how they drift apart.*

**The comment names `crouch` as part of the mapping and the list it introduces
does not contain it, and `MOVESET` has seven entries, not six.** They have
already drifted, and the comment is what makes the drift invisible.
`camera-sync.test.ts` pins `CAMERA_BY_DIR` across the same two files — **nothing
pins the clip lists**, and `DEFAULT_CLIPS` is only ever used for arithmetic
(`DEFAULT_CLIPS.length * BUILD_DIRS.length`), never compared to `MOVESET`.

### What the game demands that no list authors

Movement policies raise a telegraph, and `render/tell-clips.ts` turns the tell's
colour into a clip:

| tell | clip | which kinds | authored anywhere? |
|---|---|---|---|
| `MOVE_TELL.leap` | `crouch` | `hound` | **only via the animate `defend` preset.** Not in the keyframe path, not in the build plan. **No painter fallback either** — this is the one that fails silently, and it is exactly what `97eb184` fixed by hand |
| `MOVE_TELL.commit` | `wake` | `sapper` (ambusher), `wisp` (strafer) | **no.** Survives only because `cel-painter.ts:301` synthesizes a `wake` for any actor that has not authored one |
| `MOVE_TELL.pack` | `wait` | **nobody** — `packhunter` is a fully implemented movement policy with **zero kinds assigned in `MOVEMENT_BY_KIND`** | no, and nothing asks |

So even a *perfect* 18/18 build — every clip in `DEFAULT_CLIPS`, all three
facings — would still ship a hound whose charge tell plays a breathing idle. The
generation target was never the game's contract.

**Fix shape**, in the order that removes the most silence per unit work:

1. Make `DEFAULT_CLIPS` the single source, add `crouch`, and add the missing
   `camera-sync`-style test that pins `MOVESET` / `KEYFRAME_SET` /
   `DEFAULT_CLIPS` together. Correct the comment that claims they already agree.
2. Generalise `hound.test.ts` across the roster: read each kind's policy out of
   `MOVEMENT_BY_KIND`, run it, ask `clipForSteer` what it demands, and require the
   painter **or** the sheet to author every answer in all three facings.
3. Decide `packhunter` — assign it a kind or record it as a shelf item. A policy
   with no users is a clip demand nobody can see.

---

## 4. Wall 3 — the box, and what fits on it

**The constraint is host RAM, not VRAM.** This is the part that has been
misdiagnosed most often, because everything inside WSL looks fine while it
happens.

### The hardware

```
GPU            RTX 3090 Ti · 24,564 MiB VRAM
Host RAM       63.9 GB physical · RAM guard HARD at 62.5
WSL cap        32 GB   (.wslconfig, was 40, changed 2026-08-08)
Model store    74 GB on disk (47 GB of it in unet/), 756 GB free
```

### Why a Wan run cannot finish

The two Wan 2.2 experts are 12.0 GB each, so a run **reads 24 GB of GGUF**, and
Linux page-caches every byte. `free` reports that cache as AVAILABLE — it is
reclaimable — so nothing inside WSL ever looks wrong, while Windows counts the
balloon as used. Traced on a real clip:

```
host used      35.32 -> 60.65 GB   (+25.3)
comfy RSS       1.02 -> 11.11 GB   (+10.1)
wsl available  31.28 -> 23.50 GB   ( -7.8 ONLY)
```

25 GB of host growth against 10 GB of ComfyUI growth. The gap is page cache.

**At the old 40 GB cap the failure was on the host** — 40 GB WSL + a 27.3 GB
Windows baseline is 67.3 GB worst case against a 63.9 GB machine, so the cap was
larger than the machine and any run that filled it had to cross the ceiling.
Guaranteed by arithmetic, not bad luck.

**At the new 32 GB cap the host is safe and the failure moved inside.** Host peak
46.2 GB, never near 62.5. But WSL available steps down as each expert loads
(26.9 → 19.6 → 8.4 GiB), holds flat through all ten sampling steps, and then
**the VAE decode takes it to 0.7 GiB** and the guard soft-interrupts at its
1.2 GiB floor. 1024²/21f and 640²/17f die identically — **resolution and frame
count barely move it**, because the cost is both experts resident plus decode
buffers, about 24 GB of working set.

**The Qwen leg is unaffected.** `intake`, `rotate`, `segment` and `keyframes` all
complete with ~19 GiB still available, peaking 20.4 GB VRAM. **The leg that works
is the leg that fits**, and it is also the leg the keyframe plan depends on.

⚠️ The Windows baseline is **not a constant** — 27.3 GB on a long-uptime desktop
against **14 GB fresh-booted** (browsers alone are 14.65 of the 27.3). That is
the whole reason the right cap is contested: 40 GB is safe on a fresh boot and
was the freeze three days ago, on the same machine. Re-measure before nudging:

```
host used (Win32_OperatingSystem) − (Get-Process vmmemWSL).WorkingSet64
```

### The current animation stack, itemised

| file | GB |
|---|---|
| `Wan2.2-I2V-A14B-HighNoise-Q6_K.gguf` | 12.00 |
| `Wan2.2-I2V-A14B-LowNoise-Q6_K.gguf` | 12.00 |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6.74 |
| `wan_2.1_vae.safetensors` | 0.25 |
| `wan2.2_pixel_animate_adapter.safetensors` (applied to BOTH experts) | 2.45 |
| **read per run** | **~33.4** |

---

## 5. Models evaluated as a way out

### MiniMax H3 — **no. It makes the binding constraint worse.**

Open weights, day-0 ComfyUI support 2026-08-03, 2K video with native stereo
audio, 33.1B dense omni transformer with a **Qwen3-VL-32B** text encoder. The
smallest configurations that exist:

| component | smallest official | community |
|---|---|---|
| diffusion (FL2VA, pruned INT8) | 19.5 GB | INT4: 11.3 GB |
| text encoder (NVFP4 AWQ) | 14.6 GB | — |
| video VAE fp16 | 4.9 GB | — |
| audio VAE fp32 | 0.6 GB | — |
| **total** | **39.6 GB** | **31.4 GB** |

ComfyUI's own launch post quotes the optimized total footprint as **42.5 GB**,
down from 123.6 GB in full precision.

Three reasons it is the wrong direction *for this repo*, in order of weight:

1. **Its low-VRAM story is dynamic offload and block-swap into system RAM.** The
   "runs on a 3060" claim is offloading, not shrinking. System RAM is the exact
   resource that is already the binding constraint here — a Wan run already dies
   to page cache inside a 32 GB VM. H3 would arrive with 31–40 GB of weights
   against Wan's 24 GB and offload *harder*.
2. **The text encoder alone is 14.6 GB** — more than twice UMT5-XXL's 6.7 GB —
   and it is a 32B VLM being asked to condition a 70-texel sprite.
3. **Minimum resolution is 384p and 256p "fails completely";** the native canvas
   is a 768 px short edge. The plan needs generation *at* ~560 px so the reduce
   is exact. H3 is built for the opposite end of the range, and the native audio
   branch is pure dead weight for a sprite sheet.

**None of this is a quality judgement on H3.** It is a good model aimed at 2K
cinematic clips with sound. The failure here is a 70-texel sprite that will not
animate, and a bigger model does not make a pose appear.

### Wan 2.2 TI2V-5B — **yes, and it is not registered in the manifest**

The same family, one dense model instead of two experts, and it does **both**
text-to-video and image-to-video:

| | current A14B pair | TI2V-5B |
|---|---|---|
| diffusion weights | 12.0 + 12.0 = **24.0 GB** | **5.4 GB** (Q8_0) / **4.2 GB** (Q6_K) |
| text encoder | UMT5-XXL fp8, 6.74 GB | same |
| VAE | Wan 2.1, 0.25 GB | **Wan 2.2** VAE — a different file, small |
| read per run | ~31–33 GB | **~12.6 GB** |

That is a **4.4× cut on the diffusion weights** and it takes the whole run below
the working set that is currently killing it — including the VAE decode spike,
which is the step that actually strikes. The manifest already knows this model
exists; the `anim-vae` note says *"the '2.2 VAE' belongs to the small 5B model"*
— **and no 5B option was ever added to `LEGS`.**

**Two real costs, both to be verified rather than assumed:**

- **The pixel LoRAs are architecture-bound.** `styly-agents pixel-animate` is a
  Wan 2.2 **A14B** adapter applied to both experts, and `pix3lwalk` ships a
  **high-noise half only**. The 5B is a single dense model with no high/low
  split, so neither will load. `styly` is the proven pixel-motion default, and
  losing it is the main risk — check for a 5B-compatible pixel adapter before
  committing.
- **5B is a weaker model than A14B.** In general video that matters. Here the
  output is reduced to ~70 texels **by design**, so most of what A14B buys is
  thrown away downstream — and §2 says the current failure is *no motion at all*,
  which is not a capability problem.

### Two levers already on disk, unwired

- **Lightning 4-step LoRAs** for both Wan experts (1.23 GB each) are downloaded
  and the manifest says *"not yet wired into generation"*. Wiring them
  (`steps=4, cfg=1`) should cut ~450 s to ~90 s. It does not lower the peak, but
  it shortens the window in which the guard can strike, and it makes the A/Bs
  §2 needs affordable.
- **Qwen-Image-Edit 2509** (13.07 GB, verified on disk) is the only untested
  variable for the pose leg. If ControlNet binds there, `keyframes` becomes
  viable and a creature can be *posed* instead of curated out of a video.

---

## 6. What to do next, in order

The ordering matters: **1 and 2 are cheap and unblock measurement; 3 is the one
that decides whether any of this works.**

1. **Register Wan 2.2 TI2V-5B in `comfy/manifest.mjs`** as a choice on the
   animation leg (Q8_0, 5.4 GB, plus the Wan 2.2 VAE). Check for a
   5B-compatible pixel LoRA in the same pass. This is a manifest entry and a
   graph variant, and it is the difference between a leg that finishes and one
   that does not.
2. **Wire the Lightning 4-step LoRAs.** Both halves are on disk. ~450 s → ~90 s
   makes every A/B below affordable.
3. **Build the two missing gates, then run the keyframe plan.**
   `PLAN_KEYFRAME_PIPELINE.md` is the design and it is complete; what it needs is
   a `txt2img` mode (drop the hard init requirement for modes declaring
   `needs.init === false`), a `detectPixelGrid` gate on the **raw** generation,
   and a master generated at **560 px, on a magenta field**, with
   `tarn59_pixel_art_style_qwen` on the Qwen leg.
4. **Close the clip contract** — §3's three-step fix. It is small, it is pure
   TypeScript, it needs no GPU, and it is the difference between "the sheet is
   complete" and "the sheet is complete *and the game asks for what it has*".
5. **Play a clip as a clip.** A 4-frame loop at the game's frame rate, in the
   panel. Every gate in §2 exists because a still contact sheet passed and the
   motion was never watched.

> **Gate 7 of `PLAN_KEYFRAME_PIPELINE.md`, restated because it is the one that
> keeps being skipped: THE EYE.** No number replaces it. A census verdict of
> "BETTER than the painted roster" was printed for art that was rejected on
> sight.
