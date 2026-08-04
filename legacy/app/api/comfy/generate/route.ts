/**
 * Generation jobs — the panel's rotate/animate/edit, server-side.
 *
 *   POST {kind, imageB64, ...params}   → {jobId}   (returns immediately)
 *   GET  ?id=<jobId>                   → job status + frame list when done
 *   GET  ?id=<jobId>&frame=<filename>  → one output PNG
 *
 * A rotation is ~4-5 min and an animation ~7 on this card, so this is a
 * job store, not a held-open request. Frames land in sprite-forge's
 * gitignored work/comfy/<job>/ — the same place the CLI writes — and are
 * streamed back through this route so the browser needs no other path
 * into the filesystem.
 *
 * The graphs come from graphs.mjs (the CLI's builders, unchanged); the
 * user's quant choice from Settings is applied by filename override.
 */
import { NextResponse } from "next/server";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertNodes,
  fetchImage,
  outputImages,
  queuePrompt,
  setComfyUrl,
  uploadImage,
  waitFor,
} from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/client.mjs";
import { qwenEdit, wanI2V } from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/graphs.mjs";
import { chosenOption } from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/manifest.mjs";
import {
  backendPresent,
  installState,
  loadSettings,
} from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/forge-config.mjs";

export const dynamic = "force-dynamic";

const WORK = join(process.cwd(), "src/game/pinball-knight/tools/sprite-forge/work/comfy");

type Job = { state: "running" | "done" | "error"; kind: string; startedAt: number; frames?: string[]; error?: string; tookS?: number };
const jobs: Map<string, Job> = (globalThis as any).__forgeGen ?? new Map();
(globalThis as any).__forgeGen = jobs;

function buildGraph(kind: string, image: string, body: any, chosen: Record<string, string>) {
  const seed = Number.isFinite(+body.seed) ? +body.seed : 7;
  if (kind === "rotate" || kind === "edit") {
    const unet = chosenOption("rot-unet", chosen);
    const prompt =
      kind === "rotate"
        ? `Turn the character to face ${body.to}. Same character, same colors, same pixel art style, ` +
          `same size and position, plain white background, full body visible.`
        : String(body.prompt ?? "");
    if (!prompt) throw new Error("edit needs a prompt; rotate needs a direction");
    return qwenEdit({ image, prompt, seed, unet: unet?.file.replace(/^unet\//, "") });
  }
  if (kind === "animate") {
    if (!body.action) throw new Error("animate needs an action");
    const high = chosenOption("anim-high", chosen);
    const low = chosenOption("anim-low", chosen);
    // The pixel LoRA rides along only when it is actually installed —
    // a fresh box can still animate, just without the style lock.
    const lora = { id: "styly-pixel-animate", file: "loras/wan2.2_pixel_animate_adapter.safetensors", bytes: 2453769592 };
    const haveLora = installState(lora).state === "installed";
    const g = wanI2V({
      image,
      prompt:
        `Pixel art game sprite ${body.action}, smooth looping animation, the character stays ` +
        `centered in frame, consistent colors, plain white background.`,
      length: Number.isFinite(+body.frames) ? +body.frames : 21,
      seed,
      loraHigh: haveLora ? "wan2.2_pixel_animate_adapter.safetensors" : null,
      loraLow: haveLora ? "wan2.2_pixel_animate_adapter.safetensors" : null,
    });
    (g as any).uh.inputs.unet_name = high?.file.replace(/^unet\//, "");
    (g as any).ul.inputs.unet_name = low?.file.replace(/^unet\//, "");
    return g;
  }
  throw new Error(`unknown kind ${kind}`);
}

async function runJob(id: string, kind: string, graph: any) {
  const t0 = Date.now();
  try {
    await assertNodes(graph);
    const promptId = await queuePrompt(graph);
    const history = await waitFor(promptId);
    const dir = join(WORK, id);
    mkdirSync(dir, { recursive: true });
    const frames: string[] = [];
    for (const im of outputImages(history)) {
      const name = im.filename.replace(/.*\//, "");
      writeFileSync(join(dir, name), await fetchImage(im));
      frames.push(name);
    }
    jobs.set(id, { state: "done", kind, startedAt: t0, frames, tookS: Math.round((Date.now() - t0) / 1000) });
  } catch (e: any) {
    jobs.set(id, { state: "error", kind, startedAt: t0, error: e.message ?? String(e) });
  }
}

export async function POST(req: Request) {
  if (!backendPresent()) return NextResponse.json({ error: "no backend on this machine" }, { status: 404 });
  const body = await req.json();
  const { kind, imageB64 } = body;
  if (!imageB64) return NextResponse.json({ error: "imageB64 is required — pick an init frame first" }, { status: 400 });

  const settings = loadSettings();
  setComfyUrl(settings.comfyUrl);

  // Init image → temp file → ComfyUI's input dir, so LoadImage can see it.
  const tmp = join(tmpdir(), `forge-init-${Date.now()}.png`);
  writeFileSync(tmp, Buffer.from(String(imageB64).replace(/^data:image\/\w+;base64,/, ""), "base64"));
  let image: string;
  try {
    image = await uploadImage(tmp, `forge-init-${Date.now()}.png`);
  } catch (e: any) {
    return NextResponse.json({ error: `ComfyUI unreachable at ${settings.comfyUrl}: ${e.message}` }, { status: 502 });
  }

  let graph;
  try {
    graph = buildGraph(kind, image, body, settings.chosen);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const id = `${kind}-${Date.now().toString(36)}`;
  jobs.set(id, { state: "running", kind, startedAt: Date.now() });
  void runJob(id, kind, graph);
  return NextResponse.json({ jobId: id });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const frame = url.searchParams.get("frame");
  if (!id) return NextResponse.json({ jobs: Object.fromEntries(jobs) });
  if (frame) {
    // No traversal: the frame must be a bare .png name that really exists in
    // this job's dir (disk is the authority — the job map dies on dev reload).
    try {
      const ok = /^[\w.-]+\.png$/.test(frame) && /^[\w-]+$/.test(id) && readdirSync(join(WORK, id)).includes(frame);
      if (!ok) return NextResponse.json({ error: "no such frame" }, { status: 404 });
      const buf = readFileSync(join(WORK, id, frame));
      return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "image/png" } });
    } catch {
      return NextResponse.json({ error: "no such frame" }, { status: 404 });
    }
  }
  const job = jobs.get(id);
  if (!job) {
    // Survive a dev-server reload: if the frames are on disk, report them.
    try {
      const frames = readdirSync(join(WORK, id)).filter((f) => f.endsWith(".png"));
      if (frames.length) return NextResponse.json({ state: "done", frames, note: "recovered from disk" });
    } catch {
      /* genuinely unknown */
    }
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  return NextResponse.json(job);
}
