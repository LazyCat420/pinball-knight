#!/usr/bin/env node
/**
 * sprite-forge ↔ ComfyUI driver CLI.
 *
 *   Add --file-as <sheet-name> to ANY run to file it under that creature in
 *   the /forge library (frog, brute, pinball_knight…). Untagged stays unfiled.
 *
 *   node cli.mjs stats
 *   node cli.mjs create  --prompt "a mangy dog monster"      [--canvas WxH] [--seed N]
 *                        [--no-style] [--steps N]        TEXT -> IMAGE, no init
 *   node cli.mjs rotate  --init frame.png --to "left"        [--out DIR] [--seed N]
 *   node cli.mjs edit    --init frame.png --prompt "..."     [--out DIR] [--seed N]
 *                        [--canvas init|WxH]
 *   node cli.mjs animate --init frame.png --action "walking" [--out DIR] [--seed N]
 *                        [--frames 21] [--no-lora] [--tile 128]
 *   node cli.mjs retarget --poses row.png --character idle.png --subject "a spotted frog"
 *   node cli.mjs refile  --dir <folder of PNGs> --file-as brute [--label "..."] [--mode animate]
 *
 * Outputs land in work/comfy/<run-name>/ (gitignored, like every other
 * sprite-forge scratch). What comes back is SOFT high-res art — feed it to
 * prep/ + inbox/ for the real pixel crush; this tool deliberately does not
 * pixelize (one canonical crush, and it lives in sprite-forge proper).
 *
 * Manual tool, not a test: nothing under vitest may ever reach the network.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNodes, fetchImage, outputImages, queuePrompt, systemStats, uploadImage, waitFor } from "./client.mjs";
import { controlMap, qwenEdit, qwenText2Image, wanI2V } from "./graphs.mjs";
// The prompt comes from the MODE, not from a second copy here. A CLI that
// restates a mode's prompt is the drift the registry exists to prevent — the
// panel and the CLI already dispatch through this table for that reason.
import { MODES, fastAvailable } from "./modes.mjs";
import { optionById, chosenOption } from "./manifest.mjs";
import { installState, loadSettings } from "./forge-config.mjs";
// The gate runs HERE, on the raw frames, because this is the only place that
// sees them before anything mattes or crops them — and `ghost.ts` measured its
// own separation collapsing from 95x to 2x once a matte is applied.
import { ghostClip } from "../ghost.ts";

/**
 * THE SAME `ctx` THE PANEL ROUTE BUILDS — LoRAs, unet choices and all.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * `retarget` used to pass a stub — `has: () => false, lora: () => null,
 * unet: () => null, fast: false` — which is not "no options", it is EVERY
 * option silently off. A CLI run therefore had no `tarn59-pixel-style`, no
 * chosen unet, and no fast bundle, while the identical mode driven from the
 * panel had all three. Two different pictures from one mode id.
 *
 * `animate` was worse: it never reached `MODES` at all. It restated the mode's
 * prompt verbatim (so `preset.avoid` — the "feet sliding along the ground,
 * gliding, ice skating, floating" ban that exists precisely because the frog
 * glided — never applied), hardcoded the pixel LoRA onto BOTH experts (when
 * `wanBundle` puts `pix3lwalk` on the HIGH expert only), and passed no
 * `extraNegative`. The file's own header already said "The prompt comes from
 * the MODE, not from a second copy here."
 *
 * Reads the same `~/comfy/forge-settings.json` the panel writes, so a unet
 * chosen in the UI is honoured on the command line.
 */
function buildCtx({ images = {}, seed = 7, fast = false, leg = "qwen" } = {}) {
  const settings = loadSettings();
  const has = (optionId) => {
    const o = optionById(optionId);
    return o ? installState(o).state === "installed" : false;
  };
  return {
    has,
    lora: (optionId) => optionById(optionId)?.file.replace(/^loras\//, "") ?? null,
    unet: (slotId) => chosenOption(slotId, settings.chosen)?.file.replace(/^unet\//, "") ?? null,
    chosen: (slotId) => chosenOption(slotId, settings.chosen)?.id ?? null,
    fast: fast && fastAvailable(leg, has),
    images,
    seed,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The clip names the animator packs — READ from `labels.ts`, not restated.
 *
 * `KNOWN_CLIPS` there is typed `ReadonlySet<ClipName>` precisely so a wrong
 * name is a compile error, and its own docblock records what a hand-mirror
 * cost last time (`hurt` for `stumble`, an actor silently missing its
 * stagger). A second copy in this file would be that mirror again, one level
 * out and beyond tsc's reach. `published.test.ts` reads `IMPORTED_ART` out of
 * `boot/sheets.ts` the same way and for the same reason.
 */
const CLIP_NAMES = (() => {
  const src = readFileSync(join(HERE, "..", "labels.ts"), "utf8");
  const block = /KNOWN_CLIPS[^=]*=\s*new Set<ClipName>\(\[([\s\S]*?)\]\)/.exec(src);
  if (!block) throw new Error("[forge] could not find KNOWN_CLIPS in labels.ts");
  return [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
})();
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

/**
 * Every run writes a `job.json` beside its frames, exactly like the panel's
 * own jobs do.
 *
 * Without it a CLI generation is INVISIBLE in /forge: the library route scans
 * `work/comfy/*` and skips any directory whose job.json is missing or carries
 * no `character` ("CLI runs have no job.json — they stay unfiled"). So work
 * done here could never be viewed, re-rolled or cut into a sheet through the
 * panel — the two halves of the forge could not see each other.
 *
 * `--character <sheet-name>` is what files it. Untagged runs still write the
 * record (so the frames survive and the mode/label are recoverable) and still
 * stay unfiled, which is the honest state for a generation that belongs to no
 * creature yet.
 *
 * THE RECORD MUST CARRY `frames`, `params` AND `clip` — they are what make the
 * panel's job card an editing surface rather than a receipt. Frames draw the
 * thumbnails (and with them → init / + sheet / ✎ fix), params arm ↻ re-roll,
 * and clip pre-labels the row the tray files these frames under. A twelve-clip
 * move-set generated here once landed in /forge as twelve untouchable "done"
 * lines because this object held none of the three. (The generate route now
 * also reads the directory for frames, so older records self-heal; writing
 * them is still what keeps job.json a complete record on its own.)
 */
async function run(graph, dir, meta = {}) {
  await assertNodes(graph);
  const t0 = Date.now();
  const id = await queuePrompt(graph);
  console.log(`queued ${id}`);
  const history = await waitFor(id);
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  const images = outputImages(history);
  const frames = [];
  for (const im of images) {
    const buf = await fetchImage(im);
    const name = im.filename.replace(/.*\//, "");
    writeFileSync(join(dir, name), buf);
    frames.push(name);
  }
  // ── A RUN THAT PRODUCED NOTHING IS A FAILED RUN ──────────────────────────
  //
  // ComfyUI answers a guard-interrupted job with HTTP 200 and an empty output
  // list, so this used to write `state: "done"` with `frames: []` and exit 0.
  // `build-character.mjs` fires 18 of these unattended; every one of them could
  // report success having produced nothing, which is the exact failure mode a
  // green exit code is supposed to rule out. Read `~/comfy/guard.log` when this
  // throws — a SOFT strike writes no `guard-tripped.json` and the log is the
  // only place the cause is named.
  if (frames.length === 0) {
    writeFileSync(
      join(dir, "job.json"),
      JSON.stringify({ source: "cli", state: "failed", startedAt: t0, tookS: Math.round(Number(took)), promptId: id, frames: [], ...meta }, null, 1),
    );
    throw new Error(
      `no frames after ${took}s — the backend returned an empty output. ` +
      `Check ~/comfy/guard.log for a SOFT/HARD strike (it writes no guard-tripped.json on SOFT).`,
    );
  }

  // ── THE GHOST GATE ───────────────────────────────────────────────────────
  //
  // Advisory here, on purpose: the frames are already paid for and dropping
  // them is a curation decision, not a reason to throw away 435 seconds of
  // GPU. What this MUST do is refuse to be silent, so the record carries the
  // per-frame numbers and the panel can exclude the bad cells by default.
  let ghost = null;
  if (frames.length > 1) {
    try {
      const cells = [];
      for (const name of frames) cells.push(await rawPng(join(dir, name)));
      const v = ghostClip(cells, { label: meta.label ?? "clip" });
      ghost = { pct: v.pct.map((p) => Number((p * 100).toFixed(2))), flagged: v.flagged, soft: v.soft, level: v.level };
      if (v.flagged.length || v.soft.length) console.log(v.report);
    } catch (err) {
      // A scoring failure must not lose the frames. Say so and move on.
      console.warn(`ghost gate skipped: ${err.message}`);
    }
  }

  // NB: `--file-as`, not `--character` — `retarget` already owns that flag
  // for its character IMAGE, and filing a run under a .png path would put
  // a junk row in the library.
  const character = opt("file-as");
  writeFileSync(
    join(dir, "job.json"),
    JSON.stringify(
      {
        source: "cli",
        state: "done",
        startedAt: t0,
        tookS: Math.round(Number(took)),
        promptId: id,
        frames: frames.sort(),
        ...meta,
        ...(character ? { character } : {}),
        ...(ghost ? { ghost } : {}),
      },
      null,
      1,
    ),
  );
  console.log(`${images.length} frame(s) in ${took}s -> ${dir}${character ? `  (filed under ${character})` : ""}`);
  return { images, took };
}

/** Decode a PNG to the `RawImage` the pure QA modules take. */
async function rawPng(path) {
  const { loadImage, createCanvas } = await import("canvas");
  const img = await loadImage(path);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  const d = c.getContext("2d").getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, data: d.data };
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
    await run(qwenEdit({ image, prompt, seed: Number(opt("seed", 7)) }), dir, {
      mode: "rotate",
      label: `rotate → ${to}`,
      params: { facing: to },
      resolvedPrompt: prompt,
      seed: Number(opt("seed", 7)),
    });
  },

  /**
   * Free-form instruction edit — inpaint-class fixes, pose keyframes.
   *
   * `--canvas init` derives the output canvas from the init's own aspect.
   * Editing a 4-pose ROW on the square default returns a GRID, for the same
   * reason `retarget` documents: the canvas aspect dictates the layout, and it
   * outranks the sentence. Left opt-in so a plain single-figure edit keeps the
   * square it has always had.
   */
  /**
   * TEXT → IMAGE. The master, from nothing.
   *
   * Every other command here starts from a picture somebody else made — a
   * photo, a painter's render, another game's sprite. This is step 1 of
   * docs/PLAN_KEYFRAME_PIPELINE.md, and it is what makes the rest of that plan
   * mean anything: once the master is ours, every keyframe and in-between
   * downstream is conditioned on art this pipeline produced at the size it
   * ships at.
   *
   * The style LoRAs are doing more work here than anywhere else in the forge —
   * there is no init to inherit a look from, so `tarn59-pixel-style` IS the
   * style decision. `--no-style` turns it off to see what the base model does
   * unaided, which is the A/B worth having before trusting any of this.
   *
   *   node cli.mjs create --prompt "a mangy dog monster, side view" --file-as dog
   *   node cli.mjs create --prompt "..." --canvas 768x1024 --seed 3
   */
  async create() {
    const prompt = opt("prompt");
    if (!prompt) throw new Error("create needs --prompt <description>");
    const dir = outDir("create");
    const canvas = opt("canvas", "1024x1024");
    const [width, height] = canvas.split("x").map(Number);
    if (!width || !height) throw new Error(`--canvas takes WxH, got "${canvas}"`);
    const ctx = buildCtx({ images: {}, seed: Number(opt("seed", 7)), fast: has("fast"), leg: "qwen" });
    // Same resolution path the panel uses, so a CLI master and a panel master
    // are the same picture — the drift this file's header exists to prevent.
    const loras = has("no-style") || !ctx.has("tarn59-pixel-style")
      ? []
      : [{ name: ctx.lora("tarn59-pixel-style"), strength: 0.8 }];
    const seed = Number(opt("seed", 7));
    console.log(`create ${width}x${height} seed ${seed}${loras.length ? " + pixel style lock" : " (NO style lora)"}`);
    await run(
      qwenText2Image({ prompt, width, height, seed, steps: Number(opt("steps", 20)), loras }),
      dir,
      { mode: "create", label: "create", params: { prompt }, resolvedPrompt: prompt, seed },
    );
  },

  async edit() {
    const init = opt("init");
    const prompt = opt("prompt");
    if (!init || !prompt) throw new Error("edit needs --init <png> and --prompt <instruction>");
    const dir = outDir("edit");
    const image = await uploadImage(init, basename(init));
    const canvas = opt("canvas");
    let size = {};
    if (canvas === "init") {
      size = canvasFor(init);
      console.log(`canvas ${size.width}x${size.height} from the init's aspect`);
    } else if (canvas) {
      const [w, h] = canvas.split("x").map(Number);
      if (!w || !h) throw new Error(`--canvas takes "init" or WxH, got "${canvas}"`);
      size = { width: w, height: h };
    }
    // `--ref` rides along as Figure 2. With `--denoise` it is the other half of
    // the split: the LATENT carries structure (pose, facing, layout) and the
    // reference carries identity (who this creature is). Neither alone does
    // both — that is the whole measurement in docs/POSE_IS_THE_LATENT.md.
    const ref = opt("ref");
    const image2 = ref ? await uploadImage(ref, basename(ref)) : null;
    await run(
      qwenEdit({ image, image2, prompt, seed: Number(opt("seed", 7)), denoise: Number(opt("denoise", 1)), ...size }),
      dir,
      { mode: "edit", label: `edit${ref ? " + ref" : ""}`, params: { prompt }, resolvedPrompt: prompt, seed: Number(opt("seed", 7)) },
    );
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
    // Through the real ctx, not a stub. `has: () => false` is not "no options",
    // it is every option silently off — so this ran without the pixel-style
    // LoRA and without the chosen unet while the panel's identical mode had
    // both, and the two produced different pictures from one mode id.
    const graph = mode.build(
      { subject, width, height },
      buildCtx({ images: { init: image, style: image2 }, seed: Number(opt("seed", 7)), fast: has("fast"), leg: "qwen" }),
    );
    console.log(`canvas ${width}x${height} from the reference row`);
    await run(graph, dir, { mode: "retarget", label: `retarget → ${subject}` });
  },

  /**
   * Render a control map and STOP, so it can be looked at before any sampling
   * is paid for.
   *
   *   node cli.mjs posemap --init posed.png [--type openpose|canny|lineart|depth]
   *
   * An openpose pass that finds no skeleton returns a BLACK frame. ControlNet
   * then conditions on nothing, the output is indistinguishable from "this
   * mechanism does not help", and a working lever gets abandoned on the
   * strength of a failed detection. Look at the map first.
   */
  async posemap() {
    const init = opt("init");
    if (!init) throw new Error("posemap needs --init <png>");
    const type = opt("type", "openpose");
    const dir = outDir(`controlmap-${type}`);
    const image = await uploadImage(init, basename(init));
    await run(controlMap({ image, type, resolution: Number(opt("resolution", 1024)) }), dir, {
      mode: "controlmap",
      label: `control map · ${type}`,
    });
  },

  /**
   * A posed frame in, the SAME creature in that pose out — the ControlNet leg.
   *
   *   node cli.mjs pose --init master.png --control posed.png \
   *                     --prompt "..." [--type openpose] [--strength 0.8]
   *
   * `--init` is the IDENTITY (who this creature is, as conditioning) and
   * `--control` is the STRUCTURE (where the limbs go, bound to the sampler).
   * Those are two different slots on purpose: handing a pose in as the init is
   * the thing POSE_IS_THE_LATENT.md measured failing six ways.
   */
  async pose() {
    const init = opt("init");
    const controlPath = opt("control");
    if (!init || !controlPath) throw new Error("pose needs --init <identity png> and --control <posed png>");
    const type = opt("type", "openpose");
    const dir = outDir(`pose-${type}`);
    const image = await uploadImage(init, basename(init));
    const control = await uploadImage(controlPath, basename(controlPath));
    const prompt = opt("prompt") ?? "The same character in the pose shown, full body, pixel art, plain white background.";
    await run(
      qwenEdit({
        image,
        prompt,
        control,
        controlType: type,
        controlStrength: Number(opt("strength", 0.8)),
        controlEnd: Number(opt("end", 0.8)),
        seed: Number(opt("seed", 7)),
        denoise: Number(opt("denoise", 1)),
      }),
      dir,
      { mode: "pose", label: `pose · ${type} @ ${opt("strength", "0.8")}` },
    );
  },

  /**
   * File EXISTING frames as a done job, so /forge can see work that was made
   * before `--file-as` existed (or outside the CLI entirely).
   *
   * The brute is the motivating case: its Wan picks and prepped cells were
   * built before runs wrote job.json, so the jobs board and the library's
   * "recent" strip could never show them — the `--file-as` fix only covered
   * runs that had not happened yet. This is the migration half that was
   * missing. Copies rather than moves: the source directory stays what it
   * was (a sources drop stays tracked, a prep dir stays a prep dir).
   */
  async refile() {
    const src = opt("dir");
    const character = opt("file-as");
    if (!src || !character) throw new Error("refile needs --dir <folder of PNGs> and --file-as <sheet-name>");
    const all = readdirSync(src).filter((f) => f.endsWith(".png")).sort();
    if (!all.length) throw new Error(`no PNGs in ${src}`);
    const mode = opt("mode", "cli");
    const baseLabel = opt("label", `refiled · ${basename(src)}`);

    // ── ONE JOB PER CLIP, NOT ONE JOB PER DIRECTORY ──────────────────────────
    //
    // A job card carries ONE clip selector, and the board defaults it to `idle`
    // for anything that is not an `animate` run (JobsBoard.tsx `clipGuess`). So
    // filing a prep directory as a single job labelled every frame in it `idle`
    // — and a prep directory is exactly where the clips are already SEPARATE:
    // `S-idle0.png`, `S-walk2.png`, `S-death4.png`. The card then showed a
    // death sprawl playing under the word "idle", which is worse than not
    // showing it, because it reads as a generated result rather than a
    // mislabel.
    //
    // The clip token is taken from the filename against CLIP_NAMES, and a
    // directory with no recognisable tokens stays ONE untagged job — the
    // honest answer for a folder of loose frames, rather than guessing.
    const clipOf = (f) => CLIP_NAMES.find((c) => new RegExp(`(^|[^a-z])${c}(\\d|[^a-z]|$)`, "i").test(f)) ?? null;
    const groups = new Map();
    for (const f of all) {
      const c = clipOf(f);
      const key = c ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    // A single unlabelled group is the no-clip-tokens case: file it as one job.
    const tagged = [...groups.keys()].some(Boolean);
    const plan = tagged ? [...groups] : [["", all]];

    for (const [clip, frames] of plan) {
      const suffix = clip ? `-${clip}` : "";
      const dir = outDir(`refile-${character}${suffix}-${basename(src).replace(/[^\w-]/g, "_")}`);
      for (const f of frames) copyFileSync(join(src, f), join(dir, f));
      // The earliest source mtime, so the jobs board sorts this where the work
      // actually happened rather than pretending it was made just now.
      const startedAt = Math.min(...frames.map((f) => Math.round(statSync(join(src, f)).mtimeMs)));
      writeFileSync(
        join(dir, "job.json"),
        JSON.stringify(
          {
            source: "refile",
            state: "done",
            mode,
            label: `${baseLabel}${clip ? ` · ${clip}` : ""}`.slice(0, 60),
            startedAt,
            character,
            ...(clip ? { clip } : {}),
            frames,
          },
          null,
          1,
        ),
      );
      console.log(`${frames.length} frame(s)${clip ? ` as ${clip}` : ""} filed under ${character} -> ${dir}`);
    }
  },

  /** Move-set clip from one frame; frames come back as separate PNGs. */
  /**
   * One motion clip, through the MODE — not through a copy of it.
   *
   *   node cli.mjs animate --init master.png --preset walk [--frames 33]
   *   node cli.mjs animate --init master.png --action "hopping forward"
   *
   * `--preset` is what you almost always want: it carries the pose wording the
   * mode has already been tuned with, AND the per-clip `avoid` negative. The
   * walk preset's ban on "feet sliding along the ground, gliding, ice skating,
   * floating, shuffling, legs merging" is the whole reason the frog stopped
   * gliding; the old hand-copied prompt in this file never applied it.
   *
   * `--action` still works and overrides the preset's wording, which is what
   * the mode's own `action` field does.
   */
  async animate() {
    const init = opt("init");
    const preset = opt("preset", "walk");
    const action = opt("action");
    if (!init) throw new Error("animate needs --init <png> [--preset walk|run|attack|death|idle|stumble|defend] [--action ...]");
    const label = action || preset;
    const dir = outDir(`animate-${String(label).replace(/\s+/g, "_")}`);
    const image = await uploadImage(init, basename(init));
    const mode = MODES.find((m) => m.id === "animate");
    const params = { preset, action: action ?? "", frames: opt("frames", "21") };
    const ctx = buildCtx({
      images: { init: image },
      seed: Number(opt("seed", 7)),
      fast: has("fast"),
      leg: "wan",
    });
    // `--no-lora` is kept: it is how the pixel adapter gets A/B'd, and commit
    // 55f78f9's measurement (pix3lwalk drove the background black and produced
    // 0/21 usable frames) is exactly the run it exists for.
    if (has("no-lora")) ctx.has = () => false;
    const graph = mode.build(params, ctx);
    // Post-build patches, same idiom `--tile` already used: the mode owns the
    // prompt and the LoRA stack, these are the decode/canvas knobs an A/B needs
    // to vary without inventing a second prompt path.
    if (opt("tile")) graph.dec.inputs.tile_size = Number(opt("tile"));
    // One window for the whole clip is now the DEFAULT — this flag is how you
    // go back to a windowed decode on a box too loaded to afford it, and it
    // reintroduces the cross-fade seams `ghost.ts` flags. It is a headroom
    // trade with a measured cost in ruined frames, not a tuning knob. See
    // graphs.mjs's `dec` note and docs/PLAN_DOG_WALK.md §1.
    if (opt("temporal")) {
      graph.dec.inputs.temporal_size = Number(opt("temporal"));
      graph.dec.inputs.temporal_overlap = Number(opt("temporal-overlap", "4"));
    }
    if (opt("canvas")) {
      const [w, h] = String(opt("canvas")).split("x").map(Number);
      if (!w || !h) throw new Error(`--canvas takes WxH, got "${opt("canvas")}"`);
      graph.i2v.inputs.width = w;
      graph.i2v.inputs.height = h;
    }
    console.log(`prompt: ${mode.prompt(params, ctx)}`);
    await run(graph, dir, {
      mode: "animate",
      label: `animate · ${label}`.slice(0, 60),
      params,
      // The preset's declared clip — the panel's tray dropdown reads it, and a
      // `custom` action declares none, which is the honest "— pick a clip —".
      clip: mode.presets?.find((p) => p.id === preset)?.clip || undefined,
      resolvedPrompt: mode.prompt(params, ctx),
      seed: Number(opt("seed", 7)),
    });
  },
};

if (!main[cmd]) {
  console.error("usage: cli.mjs <stats|create|rotate|edit|animate|retarget|posemap|pose|refile> [--flags]  (see file header)");
  process.exit(2);
}
main[cmd]().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
