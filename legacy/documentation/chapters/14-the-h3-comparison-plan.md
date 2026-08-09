# The H3 comparison plan

**Written 2026-08-09, to be run in a later session.** A plan, not a result —
nothing here has been measured yet, and the point of writing it down is that
the acceptance and kill criteria are fixed *before* anyone sees an output.

---

## What we run today, stated correctly

The animate leg is **Wan 2.2 I2V-A14B**, and the **I** matters: it is
**image**-to-video. It takes the approved master PNG plus a sentence, and that
image is what preserves the hound's identity across clips. It is not
text-to-video, and `Wan2.2-TI2V-5B` (text+image) is only the fallback leg.

**This is the first gate on any replacement.** A model that cannot be
conditioned on a reference image cannot do this job at all, however good its
video is — we would be generating a *different dog* per clip.

## Why the existing dead-end entry is being challenged

Chapter 10 records H3 as "larger, not lighter: 39.6 GB". Those were **totals**,
and the quantity that binds this box is **peak resident**:

| | Wan 2.2 A14B (today) | H3, community Q3 GGUF |
|---|---|---|
| unet | 11.2 + 11.2 — **two experts** | 15.6 — **one model** |
| text encoder | 6.3 | 14.6 |
| VAE | 1.3 | 5.8 |
| total weights | 30.0 GB | 36.0 GB |
| **peak if the encoder frees first** | **~30 GB (measured)** | **~21.4 GB (predicted)** |

Wan's ceiling problem is that it is a two-expert model and **both experts were
measured resident at once** — WSL available stepped 26.9 → 19.6 → 8.4 GiB as
each loaded. A single-model H3 can encode, free the encoder, then load
unet+VAE. If ComfyUI actually frees in that order, H3-Q3 peaks *below* what we
run now, on a box whose ceiling is 31.3 GB of WSL RAM.

That "if" is the whole experiment. It is not established.

## What changed that makes this worth testing at all

Three things, none of which were true when the audit was written:

1. **We only need 3–4 frames.** Shipped clips are 2–6 cells (brute: idle 2,
   walk 4; knight: walk 3, run 3, death 3). H3's cost scales with frame count,
   and a 4-frame generation is its cheapest possible ask.
2. **Community GGUF quants exist** — Q2–Q5, plus pruned INT4/INT8 and NVFP4 —
   where the audit only had the official INT8/NVFP4 stack.
3. **We know what "better" means now.** Four gates plus a shipped-size eye
   check, and 21 labelled rows of Wan output to compare against.

## The acceleration stack — and why it is the FIRST experiment, not part of H3

The operator supplied the node chain people are actually running for H3:

```
Patch Sage Attention KJ  (KJNodes)   sageattn_qk_int8_pv_fp8_cuda++, allow_compile false
   -> Patch Sol-Attn     (SolAttn_triton)  tau 1.20, 0.20->0.90, min_tokens 4096,
                                           int8_qk false, sink_conditioning exact_kv,
                                           morton true, morton_curve 3d
   -> EasyCache                            reuse_threshold 0.30, 0.20->0.90
model loader: <...>_pruned_int8_convrot.safetensors
```

**Almost none of that is H3-specific.** Sage Attention and EasyCache are
model-agnostic ComfyUI patches. They reduce attention memory and skip
recomputable steps on *whatever model is loaded* — including Wan 2.2. So the
stack the operator found is not an argument for switching models; it is an
argument that **our current pipeline is running unaccelerated**.

What this box already has, checked 2026-08-09:

| | state |
|---|---|
| `ComfyUI-KJNodes` | **installed** — provides `PathchSageAttentionKJ` |
| `triton` 3.7.1 | **installed** — the dependency Sage and Sol-Attn need |
| `sageattention` (pip) | **NOT installed** — the one missing piece |
| `EasyCache`, `LazyCache` | **already exposed by ComfyUI**, no install needed |
| `TorchCompileModel`, `ModelMemoryUsageFactorOverride` | already exposed |
| `MiniMaxH3MemoryEfficientSageAttentionPatch` | already exposed — ComfyUI has native H3 support |

That last row matters for the H3 question: ComfyUI ships a *memory-efficient*
attention patch specifically for H3, which is exactly the lever the 39.6 GB
audit could not account for.

### Experiment A — EasyCache on Wan, costs nothing

`EasyCache` needs no install. A sweep row currently takes 500–600 s; community
reports put block-caching at ~45% off. On 21 rows that is 3.3 h → 1.8 h.

One variable, on E:walk, against the approved clip:

```
reuse_threshold 0.30, start_percent 0.20, end_percent 0.90   (the operator's values)
```

**It trades quality for speed by reusing computed steps, so it gets the same
discipline as everything else here**: four gates, rendered at 96 texels, and the
eye. A 45% speedup that softens the gait is not a win — this pipeline has
already nearly shipped two "improvements" that measured better and looked worse.

### Experiment B — Sage Attention on Wan

`pip install sageattention` into `~/comfy/venv`, then `PathchSageAttentionKJ`
with `sageattn_qk_int8_pv_fp8_cuda++`. Reported ~30% faster and, more
interestingly for this box, **lower attention peak memory** — and peak RAM is
the ceiling that has cost this project three sessions.

Measure peak WSL available during a run, not just wall-clock. If Sage drops the
peak materially, it may be worth more as headroom than as speed.

Keep `allow_compile: false` initially, matching the reference chain — torch
compile is a separate variable and adds a long first-run warmup.

**Run A and B before touching H3.** If they get the current pipeline to 4 usable
frames in ~150 s at a lower peak, the case for a 36 GB download largely
evaporates.

## The test

### Phase 0 — the disqualifiers, before downloading 36 GB

Run experiments A and B (above) FIRST. They are free, they apply to the model
we already ship, and if they succeed the rest of this chapter is optional.

Answer these from documentation alone. Any "no" ends it:

- **Does H3 do image-to-video with an identity-preserving reference?** If it is
  T2V-only, stop. This is the requirement that matters most and the one most
  likely to fail.
- **Is there a ComfyUI loader for the community GGUF that actually runs?**
  Comfy-Org publishes no official H3 GGUF workflow; third-party loaders have
  "unestablished quality, compatibility and speed".
- **Can the audio branch be skipped entirely?** It is pure dead weight for a
  sprite, and if it cannot be detached it inflates every number above.

### Phase 1 — does it fit, measured not predicted

Download Q3 first, not Q4. The question is *whether it fits at all*; quality
comes later.

```bash
# baseline, box idle, models unloaded
curl -s -X POST localhost:8188/free -H 'Content-Type: application/json' \
  -d '{"unload_models":true,"free_memory":true}'
free -g            # expect ~24 GiB available on this box

# then, DURING a 4-frame generation, sample every 5s:
while true; do free -m | awk '/Mem:/{print $7}'; sleep 5; done
```

**Kill criterion: peak WSL available below 3 GiB.** The guard interrupts at
1.2 GiB and a run that gets that close will die on a busy desktop even if it
completes once. Do not tune around this; it is the same ceiling that has cost
this project three separate sessions.

Record: peak resident, whether the text encoder freed before the unet loaded
(the assumption the whole plan rests on), and wall-clock for 4 frames against
Wan's ~450–600 s for 21.

### Phase 2 — the same clip, both models

One clip, one facing, and the facing must be **E** — chapter 13 §4 established
that S and N foreshorten motion along the view axis, so a comparison run there
measures the facing rather than the model.

- init: the approved `sources/dog-2026-08-07` master
- clip: **walk**, because it is the only clip with an approved Wan result to
  compare against, and **attack**, because it is the one the operator has
  rejected by eye
- frames: 4, curated by `prep/pick-frames.mjs` for BOTH arms, so the comparison
  is between shipped clips and not between candidate pools

Seeds are **not** comparable across models. Run 3 seeds per arm and compare
distributions, not pairs.

### Phase 3 — judge it the way we now know to judge

- All four gates: `motion` (frozen), `ghost` (dissolve toward field), `fade`
  (marking absorbed into body), `scale` (swing + trend).
- **Rendered at 96 texels at each clip's own playback rate**, never at 640 px —
  chapter 13 §9. Reviewing at generation resolution systematically over-rejects.
- Side by side with the Wan arm, and **the eye decides.** Every metric in this
  pipeline has now been wrong in both directions at least once.

## Acceptance, written before the outputs exist

H3 replaces Wan only if **all** hold:

1. Peak WSL available stays above 3 GiB for a 4-frame run.
2. It is image-conditioned and the hound is recognisably the same animal.
3. It is no worse on the four gates than the Wan arm on the same clip.
4. The operator prefers it by eye at shipped size.
5. Wall-clock for 4 usable frames beats Wan's current ~450 s.

**Anything less than all five and H3 goes back into chapter 10 with the
measurement that killed it** — which is the standing rule for this file, and the
reason the previous entry has to be marked "under review" rather than quietly
deleted.

## The cheaper thing to try first

Worth stating plainly, because a model swap is the most expensive possible
answer: **the same 3–4 frame insight applies to Wan right now, for free.**
Generating 4 frames instead of 21 should cut the VAE decode staging
substantially, and the decode is where the guard has struck every time. Nobody
has tried `--frames 4` on the A14B leg. If that alone brings peak resident down
and speeds the sweep 5×, the case for H3 gets much weaker.

Run that experiment before downloading 36 GB.
