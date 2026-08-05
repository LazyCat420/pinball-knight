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
 * Attach a stack of LoRAs between a unet loader and whatever samples from it.
 * Returns the model ref the sampler should take. Order is the caller's chain
 * discipline: on the Wan leg the ModelSamplingSD3 shift must wrap the LAST
 * lora (see wanI2V); on the Qwen leg the sampler takes this ref directly.
 */
function chainLoras(g, modelRef, loras, prefix) {
  let model = modelRef;
  for (let i = 0; i < (loras?.length ?? 0); i++) {
    const l = loras[i];
    g[`${prefix}${i}`] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model, lora_name: l.name, strength_model: l.strength ?? 0.8 },
    };
    model = [`${prefix}${i}`, 0];
  }
  return model;
}

/**
 * Qwen-Image-Edit: one init image + an instruction → an edited image with
 * the character preserved. This is the rotation / pose-keyframe leg.
 *
 * TextEncodeQwenImageEditPlus is the 2509+ conditioning node: it takes the
 * reference image(s) alongside the prompt, which is what holds identity —
 * plain img2img denoise does not. It accepts up to three references;
 * `image2`/`image3` are how a style ref (e.g. a committed sheet) rides along
 * with the content image — the prompt then addresses them as "Figure 2" etc.
 *
 * `loras` is [{name, strength}] stacked model-only between the unet and the
 * sampler — the style lock, the angles grammar, and the Lightning distill
 * all attach here. Lightning changes the OPERATING POINT, not just speed:
 * callers that attach it must also pass its coupled steps/cfg (modes.mjs
 * owns those bundles; do not scatter them).
 */
export function qwenEdit({
  image,
  image2 = null,
  image3 = null,
  prompt,
  negative = "blurry, deformed, extra limbs, watermark, text",
  width = 1024,
  height = 1024,
  seed = 7,
  steps = 20,
  cfg = 2.5,
  loras = [],
  unet = MODELS.qwenUnet,
} = {}) {
  if (!image) throw new Error("[graphs] qwenEdit needs an uploaded image name");
  if (!prompt) throw new Error("[graphs] qwenEdit needs a prompt");
  const g = {
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
  // Extra references feed BOTH encoders — asymmetric refs would make the
  // negative conditioning contradict the positive on what the images mean.
  if (image2) {
    g.img2 = { class_type: "LoadImage", inputs: { image: image2 } };
    g.pos.inputs.image2 = ["img2", 0];
    g.neg.inputs.image2 = ["img2", 0];
  }
  if (image3) {
    g.img3 = { class_type: "LoadImage", inputs: { image: image3 } };
    g.pos.inputs.image3 = ["img3", 0];
    g.neg.inputs.image3 = ["img3", 0];
  }
  g.k.inputs.model = chainLoras(g, ["u", 0], loras, "l");
  return g;
}

/**
 * Qwen-Image-Edit, but only inside a mask: brush over the wrong hand, say
 * what should be there, keep every other pixel byte-identical.
 *
 * SetLatentNoiseMask confines the sampler's noise to the masked latents; the
 * conditioning still sees the WHOLE clean init through image1, which is what
 * keeps the untouched region's identity flowing into the regenerated patch.
 * The final ImageCompositeMasked guarantees the unmasked area is the source
 * pixels, not a VAE round-trip of them — a crush-bound frame cannot afford
 * even one lossy re-encode outside the brush.
 *
 * `mask` is an uploaded grayscale PNG: white = regenerate, black = keep.
 */
export function qwenInpaint({
  image,
  mask,
  prompt,
  negative = "blurry, deformed, extra limbs, watermark, text",
  seed = 7,
  steps = 20,
  cfg = 2.5,
  loras = [],
  unet = MODELS.qwenUnet,
} = {}) {
  if (!image) throw new Error("[graphs] qwenInpaint needs an uploaded image name");
  if (!mask) throw new Error("[graphs] qwenInpaint needs an uploaded mask image name");
  if (!prompt) throw new Error("[graphs] qwenInpaint needs a prompt");
  const g = {
    u: { class_type: "UnetLoaderGGUF", inputs: { unet_name: unet } },
    c: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.qwenClip, type: "qwen_image", device: "default" } },
    v: { class_type: "VAELoader", inputs: { vae_name: MODELS.qwenVae } },
    img: { class_type: "LoadImage", inputs: { image } },
    mimg: { class_type: "LoadImage", inputs: { image: mask } },
    m: { class_type: "ImageToMask", inputs: { image: ["mimg", 0], channel: "red" } },
    enc: { class_type: "VAEEncode", inputs: { pixels: ["img", 0], vae: ["v", 0] } },
    nm: { class_type: "SetLatentNoiseMask", inputs: { samples: ["enc", 0], mask: ["m", 0] } },
    pos: {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["c", 0], vae: ["v", 0], image1: ["img", 0], prompt },
    },
    neg: {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: { clip: ["c", 0], vae: ["v", 0], image1: ["img", 0], prompt: negative },
    },
    k: {
      class_type: "KSampler",
      inputs: {
        model: ["u", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["nm", 0],
        seed, steps, cfg, sampler_name: "euler", scheduler: "simple", denoise: 1,
      },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["v", 0] } },
    comp: {
      class_type: "ImageCompositeMasked",
      inputs: { destination: ["img", 0], source: ["dec", 0], x: 0, y: 0, resize_source: false, mask: ["m", 0] },
    },
    out: { class_type: "SaveImage", inputs: { images: ["comp", 0], filename_prefix: "spriteforge/inpaint" } },
  };
  g.k.inputs.model = chainLoras(g, ["u", 0], loras, "l");
  return g;
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
 * `lorasHigh`/`lorasLow` are stacked [{name, strength}] arrays; the old
 * single loraHigh/loraLow spelling is still accepted.
 *
 * `endImage` turns this into the native first/last-frame graph: the same
 * experts, the same conditioning, but WanFirstLastFrameToVideo pins the
 * clip's final frame too — the in-betweening leg. Two keyframes from the
 * Qwen leg + this = a controlled move set, no new models.
 *
 * length is FRAMES (Wan wants 4k+1: 17, 21, 33...). 640x640 @ length 21 is
 * the sane sprite default: ~5s of motion at 16fps costs nothing to crop.
 */
export function wanI2V({
  image,
  endImage = null,
  prompt,
  negative = "static, frozen, watermark, text, extra character, split screen",
  width = 640,
  height = 640,
  length = 21,
  seed = 7,
  steps = 20,
  cfg = 3.5,
  shift = 5.0,
  loraHigh = null,
  loraLow = null,
  loraStrength = 0.8,
  lorasHigh = null,
  lorasLow = null,
  unetHigh = MODELS.wanHigh,
  unetLow = MODELS.wanLow,
} = {}) {
  if (!image) throw new Error("[graphs] wanI2V needs an uploaded image name");
  if (!prompt) throw new Error("[graphs] wanI2V needs a prompt");
  if ((length - 1) % 4 !== 0) throw new Error(`[graphs] wan length must be 4k+1 frames, got ${length}`);
  const half = Math.floor(steps / 2);
  const high = lorasHigh ?? (loraHigh ? [{ name: loraHigh, strength: loraStrength }] : []);
  const low = lorasLow ?? (loraLow ? [{ name: loraLow, strength: loraStrength }] : []);
  // ModelSamplingSD3 sets Wan's sigma shift; every working Wan 2.2 workflow
  // (official template AND the pixel-animate community one) carries it, and
  // omitting it skews the noise schedule toward mush.
  const g = {
    uh: { class_type: "UnetLoaderGGUF", inputs: { unet_name: unetHigh } },
    ul: { class_type: "UnetLoaderGGUF", inputs: { unet_name: unetLow } },
    sh: { class_type: "ModelSamplingSD3", inputs: { model: ["uh", 0], shift } },
    sl: { class_type: "ModelSamplingSD3", inputs: { model: ["ul", 0], shift } },
    c: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.wanClip, type: "wan", device: "default" } },
    v: { class_type: "VAELoader", inputs: { vae_name: MODELS.wanVae } },
    img: { class_type: "LoadImage", inputs: { image } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["c", 0], text: prompt } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["c", 0], text: negative } },
    i2v: {
      class_type: endImage ? "WanFirstLastFrameToVideo" : "WanImageToVideo",
      inputs: {
        positive: ["pos", 0], negative: ["neg", 0], vae: ["v", 0],
        width, height, length, batch_size: 1, start_image: ["img", 0],
      },
    },
    kh: {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["sh", 0], positive: ["i2v", 0], negative: ["i2v", 1], latent_image: ["i2v", 2],
        add_noise: "enable", noise_seed: seed, steps, cfg, sampler_name: "euler", scheduler: "simple",
        start_at_step: 0, end_at_step: half, return_with_leftover_noise: "enable",
      },
    },
    kl: {
      class_type: "KSamplerAdvanced",
      inputs: {
        model: ["sl", 0], positive: ["i2v", 0], negative: ["i2v", 1], latent_image: ["kh", 0],
        add_noise: "disable", noise_seed: seed, steps, cfg, sampler_name: "euler", scheduler: "simple",
        start_at_step: half, end_at_step: steps, return_with_leftover_noise: "disable",
      },
    },
    // DECODE FENCE + TILED decode. Two measured RAM cliffs live between the
    // last sampler step and the frames (2026-08-05, guard.log):
    //   1. decoding a whole 17-33 frame batch at once — bounded by tiling
    //      (256px tiles, ≤8 frames per temporal chunk; seams are a non-issue
    //      for art headed into the pixel crush);
    //   2. the expert→VAE transition itself — "Requested to load WanVAE"
    //      with an 11.6GB expert still resident cratered the capped VM from
    //      9GiB available to 1.5 in ten seconds. The KJNodes passthrough
    //      unloads every model BEFORE the VAE stage loads; the latent rides
    //      through it, which is what forces the ordering.
    purge: {
      class_type: "VRAM_Debug",
      inputs: { empty_cache: true, gc_collect: true, unload_all_models: true, any_input: ["kl", 0] },
    },
    dec: {
      class_type: "VAEDecodeTiled",
      inputs: { samples: ["purge", 0], vae: ["v", 0], tile_size: 256, overlap: 32, temporal_size: 8, temporal_overlap: 4 },
    },
    out: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "spriteforge/wan" } },
  };
  if (endImage) {
    g.imgEnd = { class_type: "LoadImage", inputs: { image: endImage } };
    g.i2v.inputs.end_image = ["imgEnd", 0];
  }
  // Chain order matters: unet → lora(s) → sigma shift → sampler. The LoRAs
  // must sit UNDER the shift so ModelSamplingSD3 wraps the patched model.
  g.sh.inputs.model = chainLoras(g, ["uh", 0], high, "lh");
  g.sl.inputs.model = chainLoras(g, ["ul", 0], low, "ll");
  return g;
}
