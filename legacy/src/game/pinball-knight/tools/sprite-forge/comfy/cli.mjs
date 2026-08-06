#!/usr/bin/env node
/**
 * sprite-forge ↔ ComfyUI driver CLI.
 *
 *   node cli.mjs stats
 *   node cli.mjs rotate  --init frame.png --to "left"        [--out DIR] [--seed N]
 *   node cli.mjs edit    --init frame.png --prompt "..."     [--out DIR] [--seed N]
 *   node cli.mjs animate --init frame.png --action "walking" [--out DIR] [--seed N]
 *                        [--frames 21] [--no-lora]
 *   node cli.mjs retarget --poses row.png --character idle.png --subject "a spotted frog"
 *
 * Outputs land in work/comfy/<run-name>/ (gitignored, like every other
 * sprite-forge scratch). What comes back is SOFT high-res art — feed it to
 * prep/ + inbox/ for the real pixel crush; this tool deliberately does not
 * pixelize (one canonical crush, and it lives in sprite-forge proper).
 *
 * Manual tool, not a test: nothing under vitest may ever reach the network.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodes, fetchImage, outputImages, queuePrompt, systemStats, uploadImage, waitFor } from "./client.mjs";
import { qwenEdit, wanI2V } from "./graphs.mjs";
// The prompt comes from the MODE, not from a second copy here. A CLI that
// restates a mode's prompt is the drift the registry exists to prevent — the
// panel and the CLI already dispatch through this table for that reason.
import { MODES } from "./modes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

/**
 * A canvas with the REFERENCE ROW's aspect, at roughly the model's trained area.
 *
 * PNG dimensions come from the IHDR at a fixed offset — no image library, and
 * this file is a manual driver that must not grow a dependency for one header.
 * Snapped to /16 because the latent is 1/8 and an odd size gets padded, which
 * shifts the row off the canvas edge it is supposed to fill.
 */
function canvasFor(pngPath) {
  const buf = readFileSync(pngPath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const area = 1344 * 768;
  const s = Math.sqrt(area / (w * h));
  const snap = (v) => Math.max(256, Math.round((v * s) / 16) * 16);
  return { width: snap(w), height: snap(h) };
}

function outDir(kind) {
  const dir = opt("out", join(HERE, "..", "work", "comfy", `${kind}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function run(graph, dir) {
  await assertNodes(graph);
  const t0 = Date.now();
  const id = await queuePrompt(graph);
  console.log(`queued ${id}`);
  const history = await waitFor(id);
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  const images = outputImages(history);
  for (const im of images) {
    const buf = await fetchImage(im);
    writeFileSync(join(dir, im.filename.replace(/.*\//, "")), buf);
  }
  console.log(`${images.length} frame(s) in ${took}s -> ${dir}`);
  return { images, took };
}

const main = {
  async stats() {
    const s = await systemStats();
    const d = s.devices?.[0] ?? {};
    console.log(`comfyui ${s.system?.comfyui_version} on ${d.name}`);
    console.log(`vram free ${(d.vram_free / 2 ** 30).toFixed(1)} / ${(d.vram_total / 2 ** 30).toFixed(1)} GiB`);
  },

  /** Identity-preserving rotation via the edit model. */
  async rotate() {
    const init = opt("init");
    const to = opt("to");
    if (!init || !to) throw new Error("rotate needs --init <png> and --to <left|right|back|front|three-quarter ...>");
    const dir = outDir(`rotate-${to.replace(/\s+/g, "_")}`);
    const image = await uploadImage(init, basename(init));
    const prompt =
      `Turn the character to face ${to}. Same character, same colors, same pixel art style, ` +
      `same size and position, plain white background, full body visible.`;
    await run(qwenEdit({ image, prompt, seed: Number(opt("seed", 7)) }), dir);
  },

  /** Free-form instruction edit — inpaint-class fixes, pose keyframes. */
  async edit() {
    const init = opt("init");
    const prompt = opt("prompt");
    if (!init || !prompt) throw new Error("edit needs --init <png> and --prompt <instruction>");
    const dir = outDir("edit");
    const image = await uploadImage(init, basename(init));
    await run(qwenEdit({ image, prompt, seed: Number(opt("seed", 7)) }), dir);
  },

  /**
   * SHOW the poses instead of describing them.
   *
   * `keyframes` names its four poses in a sentence, and four poses sharing one
   * denoising pass regress toward each other — every row so far came back
   * 97-99% identical. A pose ROW from the reference library does not have that
   * problem: an animator drew those poses to be different, so the diversity is
   * in the pixels rather than in an adjective.
   *
   *   node cli.mjs retarget --poses .poses/mario/walk/E/row.png \
   *                         --character frog-idle.png --subject "a spotted frog"
   */
  async retarget() {
    const poses = opt("poses");
    const character = opt("character");
    const subject = opt("subject");
    if (!poses || !character || !subject) {
      throw new Error("retarget needs --poses <row.png> --character <idle.png> --subject <what it is>");
    }
    const dir = outDir("retarget");
    // Figure 1 is the pose row, Figure 2 is the character. qwenEdit feeds them
    // in that order, and the prompt names them the same way — swap either and
    // the model redraws the reference instead of the character.
    const image = await uploadImage(poses, basename(poses));
    const image2 = await uploadImage(character, basename(character));
    const mode = MODES.find((m) => m.id === "retarget");
    // The canvas takes the REFERENCE ROW's aspect. Asking for a 3-wide row on a
    // square canvas returned a 3x3 grid — see the note in the mode's build().
    const { width, height } = canvasFor(poses);
    const graph = mode.build({ subject, width, height }, { images: { init: image, style: image2 }, seed: Number(opt("seed", 7)), has: () => false, lora: () => null, unet: () => null, fast: false });
    console.log(`canvas ${width}x${height} from the reference row`);
    await run(graph, dir);
  },

  /** Move-set clip from one frame; frames come back as separate PNGs. */
  async animate() {
    const init = opt("init");
    const action = opt("action");
    if (!init || !action) throw new Error("animate needs --init <png> and --action <walking|attacking|jumping ...>");
    const dir = outDir(`animate-${action.replace(/\s+/g, "_")}`);
    const image = await uploadImage(init, basename(init));
    const prompt =
      `Pixel art game sprite ${action}, smooth looping animation, the character stays ` +
      `centered in frame, consistent colors, plain white background.`;
    // The styly-agents adapter is a whole-model pixel-motion LoRA; its own
    // reference workflow attaches it to BOTH experts, so we do too. (The
    // pix3lwalk high-noise-only LoRA is Civitai-gated — swap it in for
    // loraHigh once a token exists.)
    const pixelLora = has("no-lora") ? null : "wan2.2_pixel_animate_adapter.safetensors";
    await run(
      wanI2V({
        image,
        prompt,
        length: Number(opt("frames", 21)),
        seed: Number(opt("seed", 7)),
        loraHigh: pixelLora,
        loraLow: pixelLora,
      }),
      dir,
    );
  },
};

if (!main[cmd]) {
  console.error("usage: cli.mjs <stats|rotate|edit|animate> [--flags]  (see file header)");
  process.exit(2);
}
main[cmd]().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
