/**
 * API-format graph builders — the two legs of the sprite pipeline.
 *
 * A ComfyUI "API format" graph is {id: {class_type, inputs}} with cross-node
 * references as ["otherId", outputIndex]. These builders are the ONLY place
 * node class names appear; cli.mjs runs client.assertNodes() before queueing
 * so a renamed node fails with its name, not an opaque 400.
 *
 * Model filenames are pinned here to what setup downloaded into
 * ~/comfy/ComfyUI/models — see README.md. Override per call if a model is
 * re-quantized; do not silently rename files on disk.
 *
 * ── WHY THE OUTPUT IS NOT PIXEL ART ──────────────────────────────────────
 * Both legs return soft ~512-1024px renderings ON PURPOSE. No open model
 * emits a true pixel grid; the pipeline's contract is: generate large, then
 * let sprite-forge's own reduce + palette snap make it pixel art. Keeping
 * that step in sprite-forge (not a server node) means imported sheets and
 * generated sheets go through ONE canonical crush. Feed outputs to the
 * inbox exactly like any other generated sheet.
 */

export const MODELS = {
  qwenUnet: "qwen-image-edit-2511-Q4_K_M.gguf",
  qwenClip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  qwenVae: "qwen_image_vae.safetensors",
  wanHigh: "Wan2.2-I2V-A14B-HighNoise-Q6_K.gguf",
  wanLow: "Wan2.2-I2V-A14B-LowNoise-Q6_K.gguf",
  wanClip: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  wanVae: "wan_2.1_vae.safetensors",
  pixelWalkLoraHigh: "pixel_walk_lora_v1_high_noise.safetensors",
};

/**
 * Qwen-Image-Edit: one init image + an instruction → an edited image with
 * the character preserved. This is the rotation / pose-keyframe leg.
 *
 * TextEncodeQwenImageEditPlus is the 2509+ conditioning node: it takes the
 * reference image(s) alongside the prompt, which is what holds identity —
 * plain img2img denoise does not.
 */
export function qwenEdit({
  image,
  prompt,
  negative = "blurry, deformed, extra limbs, watermark, text",
  width = 1024,
  height = 1024,
  seed = 7,
  steps = 20,
  cfg = 2.5,
  unet = MODELS.qwenUnet,
} = {}) {
  if (!image) throw new Error("[graphs] qwenEdit needs an uploaded image name");
  if (!prompt) throw new Error("[graphs] qwenEdit needs a prompt");
  return {
    u: { class_type: "UnetLoaderGGUF", inputs: { unet_name: unet } },
    c: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.qwenClip, type: "qwen_image", device: "default" } },
    v: { class_type: "VAELoader", inputs: { vae_name: MODELS.qwenVae } },
    img: { class_type: "LoadImage", inputs: { image } },
    pos: {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["c", 0], vae: ["v", 0], image1: ["img", 0], prompt },
    },
    neg: {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["c", 0], vae: ["v", 0], image1: ["img", 0], prompt: negative },
    },
    lat: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    k: {
      class_type: "KSampler",
      inputs: {
        model: ["u", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["lat", 0],
        seed, steps, cfg, sampler_name: "euler", scheduler: "simple", denoise: 1,
      },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["v", 0] } },
    out: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "spriteforge/qwen" } },
  };
}

/**
 * Wan 2.2 I2V: one init frame → a short motion clip, decoded as a BATCH of
 * PNG frames (SaveImage writes each batch item separately — which is
 * exactly what a sprite sheet wants; no video container involved).
 *
 * Two-expert MoE: the high-noise unet takes the first half of the steps,
 * the low-noise unet finishes. LoRAs attach per-expert; the pix3lwalk
 * community LoRA ships a high-noise half only — attaching it low too would
 * double-style the refinement, so each side is optional and independent.
 *
 * length is FRAMES (Wan wants 4k+1: 17, 21, 33...). 640x640 @ length 21 is
 * the sane sprite default: ~5s of motion at 16fps costs nothing to crop.
 */
export function wanI2V({
  image,
  prompt,
  negative = "static, frozen, watermark, text, extra character, split screen",
  width = 640,
  height = 640,
  length = 21,
  seed = 7,
  steps = 20,
  cfg = 3.5,
  loraHigh = null,
  loraLow = null,
  loraStrength = 0.8,
} = {}) {
  if (!image) throw new Error("[graphs] wanI2V needs an uploaded image name");
  if (!prompt) throw new Error("[graphs] wanI2V needs a prompt");
  if ((length - 1) % 4 !== 0) throw new Error(`[graphs] wan length must be 4k+1 frames, got ${length}`);
  const half = Math.floor(steps / 2);
  const g = {
    uh: { class_type: "UnetLoaderGGUF", inputs: { unet_name: MODELS.wanHigh } },
    ul: { class_type: "UnetLoaderGGUF", inputs: { unet_name: MODELS.wanLow } },
    c: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.wanClip, type: "wan", device: "default" } },
    v: { class_type: "VAELoader", inputs: { vae_name: MODELS.wanVae } },
    img: { class_type: "LoadImage", inputs: { image } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["c", 0], text: prompt } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["c", 0], text: negative } },
    i2v: {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["pos", 0], negative: ["neg", 0], vae: ["v", 0],
        width, height, length, batch_size: 1, start_image: ["img", 0],
      },
    },
    kh: {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["uh", 0], positive: ["i2v", 0], negative: ["i2v", 1], latent_image: ["i2v", 2],
        add_noise: "enable", noise_seed: seed, steps, cfg, sampler_name: "euler", scheduler: "simple",
        start_at_step: 0, end_at_step: half, return_with_leftover_noise: "enable",
      },
    },
    kl: {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["ul", 0], positive: ["i2v", 0], negative: ["i2v", 1], latent_image: ["kh", 0],
        add_noise: "disable", noise_seed: seed, steps, cfg, sampler_name: "euler", scheduler: "simple",
        start_at_step: half, end_at_step: steps, return_with_leftover_noise: "disable",
      },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["kl", 0], vae: ["v", 0] } },
    out: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "spriteforge/wan" } },
  };
  if (loraHigh) {
    g.lh = { class_type: "LoraLoaderModelOnly", inputs: { model: ["uh", 0], lora_name: loraHigh, strength_model: loraStrength } };
    g.kh.inputs.model = ["lh", 0];
  }
  if (loraLow) {
    g.ll = { class_type: "LoraLoaderModelOnly", inputs: { model: ["ul", 0], lora_name: loraLow, strength_model: loraStrength } };
    g.kl.inputs.model = ["ll", 0];
  }
  return g;
}
