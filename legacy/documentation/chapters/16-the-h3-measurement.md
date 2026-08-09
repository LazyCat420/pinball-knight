# The H3 measurement — Phase 0 passed, Phase 1 failed

**Run 2026-08-09.** Chapter 14 wrote the acceptance and kill criteria before
any output existed. This is the result against them. Short version: every
Phase 0 disqualifier cleared, the model loads and samples well, and **it dies
at the VAE decode** — the same place Wan dies, for a mechanically different
reason.

**Chapter 14's central assumption is false as observed**, and that is the
finding worth keeping even if H3 is never revisited.

---

## 1. Phase 0 — all three answered YES, from source, before downloading

Chapter 14 said any "no" ends it. None of them was a no.

| question | answer | where it was settled |
|---|---|---|
| Does H3 do image-to-video with an identity-preserving reference? | **Yes** — `MiniMaxH3ImageToVideo(… first_frame, last_frame)`. It takes **both ends**, so it does the end pin natively — the exact lever chapter 15 §1 wants. | `comfy_extras/nodes_minimax_h3.py` |
| Is there a loader that runs? | **Yes, without patching anything.** `CLIPLoader` has `minimax` in its type enum natively. The community pruned unet is a GGUF whose header declares arch **`wan`**, which is what gets it past city96's `IMG_ARCH_LIST` — and ComfyUI detects H3 from tensor keys (`video_patch_proj` + `audio_patch_proj`), not the header, so the mislabel is load-bearing rather than a bug. | `ComfyUI-GGUF/loader.py:12`, `comfy/model_detection.py:362` |
| Can the audio branch be skipped? | **Partly, and the useful part yes.** The latent is a NestedTensor pair and the audio half is generated regardless — that cost cannot be removed. But `MiniMaxH3ImageToVideo` takes no `audio_vae`, so the audio VAE need not be downloaded or decoded. | `nodes_minimax_h3.py`, `_empty_av_latent` |

### The one door that IS shut: a GGUF text encoder

Worth recording because it is the obvious cost-saving idea and it does not work
here. `comfy/text_encoders/minimax.py` calls `self.visual(...)` on the keyframe
path, so the Qwen3-VL vision tower is **mandatory for fl2va**. Every community
GGUF encoder splits that tower into a separate `mmproj` file in llama.cpp
style, and reassembling it needs **Nif00's fork of ComfyUI-GGUF** — swapping the
fork in would put the Wan and Qwen legs, which both depend on city96's loader,
behind an untested third-party build.

The MiniStack's 2.5 GB `qwen3vl-4b-h3student` encoder is a further trap: it is
**text-only with no vision path at all**, so it cannot do fl2va under any
loader. The official 15.7 GB nvfp4 file carries the tower in one piece and is
what this test used.

nvfp4 compute needs Blackwell (`supports_nvfp4_compute` wants `props.major >=
10`); this box is an sm_86 3090 Ti, so ComfyUI puts it in "emulated ops" —
weights stay packed at 15.7 GB and dequant happens per matmul. That turned out
not to matter: speed was never the problem.

### What was downloaded — 29.8 GB, no audio VAE

```
models/unet/MiniMax-H3-FL2VA-Pruned-Q3_K_M.gguf              8.90 GB
models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors  15.69 GB
models/vae/minimax_h3_video_vae_fp16.safetensors             5.21 GB
```

## 2. Phase 1 — three runs, one variable each, all dead

`node cli.mjs h3 --init <approved E master> --preset walk4 --frames 5 --canvas
576x576 --seed 7`. Five frames is H3's floor (`align_frame_count`: 17k+5) and
576 is the texel budget on a 32 grid — **the cheapest ask the model accepts.**

| # | graph | min `MemAvailable` | how it ended | frames |
|---|---|---|---|---|
| 1 | ComfyUI's own template wiring | **0.96 GiB** | interrupted at the decode | 0 |
| 2 | + `VRAM_Debug` purge before the decode | **1.29 GiB** | guard **HARD** — ComfyUI stopped outright | 0 |
| 3 | + a second purge right after conditioning | **1.09 GiB** | guard **SOFT** — interrupted at the decode | 0 |

Chapter 14's kill criterion was **peak WSL available below 3 GiB**. All three
runs are less than half of it, at the smallest generation the model can be
asked for. **Acceptance criterion 1 fails, and 2–4 cannot even be evaluated
because no frames exist to look at.**

## 3. What actually happens — the assumption that was wrong

Chapter 14's whole case was: *Wan is a two-expert model and both experts were
measured resident at once; a single-model H3 can encode, free the encoder, then
load unet+VAE, and peak below what we run today.*

ComfyUI does not do that. The log reads, in order, with **no unload between
them**:

```
Requested to load MiniMaxH3TEModel_   14960.20 MB
Requested to load MiniMaxH3VideoVAE    4966.19 MB
Requested to load MiniMaxH3            8783.23 MB
```

28.7 GB of weights against 24 GB of VRAM. The encoder is not freed — it is
**offloaded**, and ComfyUI's offload device is the CPU. So 15 GB of a text
encoder that will never be called again lands in system RAM: the one resource
this box does not have.

**And the fix has the same shape as the disease.** `unload_all_models()` is
also a *move to the offload device*, not a delete. Purging before the decode
(run 2) and after conditioning (run 3) both do reduce VRAM — VRAM fell 19.3 →
3.6 GB on cue — but what they reduce it *into* is system RAM. Run 3's explicit
encoder purge worked exactly as designed and the run still died, which is the
cleanest possible demonstration that the offload target is the problem, not the
offload timing.

## 4. The part that is genuinely good, and should not be lost

**Sampling is fast and comfortable.** 20 steps at **4.07 s/it — 81 s total** for
5 frames at 576², sitting at **5–8 GiB available** throughout. Wan A14B's
sampling on the same box runs 16–22 s/it across 10+10 steps, roughly 390 s.

So the model is not too big to *run* here. Load and decode are too big. That is
a narrower problem than "H3 does not fit", and it is the one the next attempt
should attack.

## 5. The next lever, named and untried

**`VAEDecodeTiled` on the H3 video VAE.** It is the same lever that saved the
Wan decode, it is one node, and nobody has tried it. The H3 video VAE is a
ViT3D decoder — 36 transformer layers, patch 16, `patch_size_t` 4 — so whether
tiling is even meaningful for it is an open question rather than a formality.

If that fails, H3 goes into chapter 10 as settled rather than "under review",
and the answer is the one chapter 14 already suspected: **the free experiments
on the model we already ship** — `EasyCache`, `PathchSageAttentionKJ`,
`--cache-lru 1`, `--frames 4` — none of which have been run.

## 6. Two process notes, both mine, both cost time

- **I started the guard with `> /dev/null`.** `guard.mjs`'s `log()` is
  `console.log`; `~/comfy/guard.log` is only ever a shell redirect. So run 1's
  strike line went nowhere and I read a clean log as "the guard did not fire",
  which is the exact opposite of what the standing rule is for. **The guard
  must be started as `node guard.mjs >> ~/comfy/guard.log 2>&1`.**
- **The guard was not running at all** when this session started — pid 37253
  from `guard.json` was dead, and the last real log line was from the previous
  evening. Nothing checks this. A sweep can run for hours with no failsafe and
  look completely normal.
