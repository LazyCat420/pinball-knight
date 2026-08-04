# comfy/ — the generation backend driver

Sprite GENERATION happens on a local ComfyUI server; everything after
generation (matte → slice → resample → crush → publish) is the existing
sprite-forge pipeline and did not move. This folder is only the bridge.

Research + model approval trail: the 2026-08-03 report
(claude.ai/code/artifact/706bb106-3eac-4876-bfcb-27bcf231bad0) and the
`comfyui-sprite-pipeline-research` memory.

## The backend (lives OUTSIDE the repo, on the WSL box)

    ~/comfy/ComfyUI        headless ComfyUI checkout (+ venv at ~/comfy/venv)
    ~/comfy/run.sh -d      start   (127.0.0.1:8188; log ~/comfy/comfy.log)
    ~/comfy/stop.sh        stop
    ~/comfy/ComfyUI/models/{unet,text_encoders,vae,loras}   the weights

`run.sh` carries `--disable-pinned-memory` — WSL2 caps pinned host memory
and cudaHostRegister is unsupported; without the flag model load can OOM
the distro (Comfy-Org/ComfyUI#11531).

Custom nodes installed: ComfyUI-GGUF (required loader for every model
below), KJNodes, VideoHelperSuite.

Models (all Apache-2.0 / commercial-clean; ~45 GB):

| file (models/…) | role |
|---|---|
| unet/qwen-image-edit-2511-Q4_K_M.gguf | rotation / identity-preserving edits |
| unet/Wan2.2-I2V-A14B-{High,Low}Noise-Q6_K.gguf | animation (two-expert MoE) |
| text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors | Qwen TE |
| text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors | Wan TE |
| vae/qwen_image_vae.safetensors, vae/wan_2.1_vae.safetensors | VAEs |
| loras/pixel_walk_lora_v1_high_noise.safetensors | pix3lwalk (Civitai 2172038, Sell-granted) |
| loras/wan2.2_pixel_animate_adapter.safetensors | styly-agents pixel-animate |
| loras/tarn59_pixel_art_style_qwen.safetensors | pixel style for Qwen leg |

## Using it

    node cli.mjs stats
    node cli.mjs rotate  --init frame.png --to "left"
    node cli.mjs animate --init frame.png --action "walking"   # 21 PNG frames
    node cli.mjs edit    --init frame.png --prompt "raise the sword overhead"

Outputs land in `../work/comfy/<run>/` (gitignored). They are SOFT
high-res frames by design — no open model emits a true pixel grid, so the
contract is generate-large-then-crush, and the crush stays in sprite-forge
(one canonical reduce + palette snap for imported AND generated art).
Assemble frames into a sheet, drop it in `inbox/`, `npm run sprites`.

Init images: upscale the source frame (nearest) to ~512-1024 px on a plain
background first — every working sprite model expects big soft input, not
raw 32-128 px art. `prep/` has the tooling.

## Contracts and failure modes

- `client.mjs` polls `/history`; a sampler error is rethrown with the
  server's own payload — never reported as "no outputs".
- `cli.mjs` runs `assertNodes()` before queueing: a missing/renamed node
  class (ComfyUI renames things across releases) fails by NAME instead of
  an opaque 400.
- Node class names live ONLY in `graphs.mjs`.
- This is a manual tool. Nothing under vitest may reach the network, so no
  `.test.ts` here may import the server side of this folder.
