/**
 * Generation jobs — every mode the panel offers, server-side.
 *
 *   POST {mode, params, imageB64, ...}   → {jobIds}  (returns immediately)
 *   GET  ?id=<jobId>                     → job status: progress, frames, prompt
 *   GET  ?id=<jobId>&frame=<filename>    → one output PNG
 *   GET  ?id=<jobId>&preview=1           → latest live sampler preview (JPEG)
 *   GET  (bare)                          → every job this server knows
 *   DELETE ?id=<jobId>                   → interrupt (running) / dequeue (pending)
 *
 * A rotation is minutes even in fast mode, so this is a job store, not a
 * held-open request. Frames land in sprite-forge's gitignored
 * work/comfy/<job>/ — the same place the CLI writes — and stream back
 * through this route so the browser needs no other path into the
 * filesystem. Each job also writes a job.json there: the in-memory Map
 * dies on dev reload, and a recovered job should keep its mode, prompt and
 * params, not just its frames.
 *
 * WHAT DECIDES A JOB IS DONE: /history polling (client.waitFor), exactly as
 * before. The websocket only feeds the progress fields — ComfyUI documents
 * progress traffic can trail completion (#9330), so it must never drive
 * state.
 *
 * The graphs come from modes.mjs — the one registry of prompts, LoRA
 * policy and coupled sampler bundles. This route's job is transport:
 * uploads in, jobs out.
 */
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  assertNodes,
  cancelPrompt,
  fetchImage,
  freeMemory,
  outputImages,
  queuePrompt,
  setComfyUrl,
  uploadImage,
  waitFor,
  watchProgress,
} from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/client.mjs";
import { modeById, fastAvailable } from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/modes.mjs";
import { optionById, chosenOption } from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/manifest.mjs";
import {
  backendPresent,
  installState,
  loadSettings,
  modelsDir,
} from "../../../../src/game/pinball-knight/tools/sprite-forge/comfy/forge-config.mjs";

export const dynamic = "force-dynamic";

const WORK = join(process.cwd(), "src/game/pinball-knight/tools/sprite-forge/work/comfy");

type Progress = { node: string | null; value: number; max: number };
type Job = {
  state: "queued" | "running" | "done" | "error" | "cancelled";
  /** Which model stack this job needs — the scheduler groups by it. */
  leg?: string;
  mode: string;
  label: string;
  startedAt: number;
  params?: Record<string, unknown>;
  resolvedPrompt?: string;
  seed?: number;
  fast?: boolean;
  /** Library filing: which project/character this generation belongs to. */
  project?: string;
  character?: string;
  /** The game clip the preset targets — pre-selects the sheet tray's dropdown. */
  clip?: string;
  promptId?: string;
  progress?: Progress;
  previewB64?: string;
  frames?: string[];
  error?: string;
  tookS?: number;
};
const jobs: Map<string, Job> = (globalThis as any).__forgeGen ?? new Map();
(globalThis as any).__forgeGen = jobs;

/** What survives a dev-server reload, minus the volatile fields. */
function persistJob(id: string) {
  const j = jobs.get(id);
  if (!j) return;
  const { previewB64: _p, progress: _g, ...keep } = j;
  try {
    mkdirSync(join(WORK, id), { recursive: true });
    writeFileSync(join(WORK, id, "job.json"), JSON.stringify(keep, null, 1));
  } catch {
    /* job dir may not exist yet on early errors — the Map still has it */
  }
}

async function uploadB64(b64: string, tag: string): Promise<string> {
  const tmp = join(tmpdir(), `forge-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
  writeFileSync(tmp, Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ""), "base64"));
  return uploadImage(tmp, `forge-${tag}-${Date.now()}.png`);
}

async function runJob(id: string, graph: any, clientId: string) {
  const t0 = Date.now();
  const job = jobs.get(id)!;
  try {
    await assertNodes(graph);
    const promptId = await queuePrompt(graph, { clientId });
    job.promptId = promptId;
    persistJob(id);
    const stopWatch = watchProgress(promptId, clientId, {
      onProgress: (p: Progress) => {
        const j = jobs.get(id);
        if (j && j.state === "running") j.progress = p;
      },
      onPreview: (buf: Buffer) => {
        const j = jobs.get(id);
        if (j && j.state === "running") j.previewB64 = buf.toString("base64");
      },
    });
    let history;
    try {
      history = await waitFor(promptId);
    } finally {
      stopWatch();
    }
    const dir = join(WORK, id);
    mkdirSync(dir, { recursive: true });
    const frames: string[] = [];
    for (const im of outputImages(history)) {
      const name = im.filename.replace(/.*\//, "");
      writeFileSync(join(dir, name), await fetchImage(im));
      frames.push(name);
    }
    Object.assign(job, { state: "done", frames, tookS: Math.round((Date.now() - t0) / 1000), progress: undefined, previewB64: undefined });
  } catch (e: any) {
    // A cancel surfaces here as an interrupted history or a timeout — keep
    // the cancelled state if DELETE already set it.
    if (jobs.get(id)?.state !== "cancelled") {
      Object.assign(job, { state: "error", error: e.message ?? String(e) });
    }
  }
  persistJob(id);
}

/**
 * LEG-AFFINITY SCHEDULER — the model-switch lag fix.
 *
 * A Qwen↔Wan switch costs a full unload + a 12-15GB reload, minutes each
 * way. ComfyUI's own queue is FIFO and doesn't know legs exist, so a
 * mixed queue (a move-set batch plus one rotate) used to thrash:
 * load Wan, unload, load Qwen, unload, load Wan…
 *
 * This scheduler runs ONE job at a time and drains every parked job of
 * the RESIDENT leg before switching; /free happens exactly once per real
 * switch, never per job. While the resident leg samples (GPU-bound), the
 * OTHER leg's model files are read into the page cache at idle priority —
 * page cache is reclaimable (it cannot re-create the freeze; the kernel
 * evicts it under pressure), so when the switch finally happens the
 * "reload from disk" is mostly a copy from RAM.
 *
 * Parked graphs live in memory only: a dev reload loses them, and GET
 * reports such jobs as errors with a re-roll hint — recovery would need
 * re-uploaded images, which is the user's one click anyway.
 */
type Parked = { id: string; graph: unknown; clientId: string; leg: string };
type Sched = {
  resident: string | null;
  runningId: string | null;
  parked: Parked[];
  warmedLeg: string | null;
  gateTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
};
const sched: Sched = (globalThis as any).__forgeSched ?? {
  resident: null,
  runningId: null,
  parked: [],
  warmedLeg: null,
  gateTimer: null,
  idleTimer: null,
};
(globalThis as any).__forgeSched = sched;

/**
 * Idle hygiene: on the 40GB-capped VM an idle ComfyUI with cached stacks
 * rests LOW — ~2.8GiB after one leg, ~1.5-2.4 after a two-leg session,
 * which sits under the guard's sustained rule (2.5GiB/60s) and tripped
 * an idle healthy server twice on 08-05. So the grace is conditional:
 * a drained queue on a squeezed box frees NOW (a warm cache below the
 * watchdog line is worth less than the fragility), and only a box with
 * real headroom keeps the 5-minute warm-cache window for rapid
 * iteration. resident goes null so the next dispatch knows nothing
 * needs freeing.
 */
const IDLE_KEEP_WARM_GIB = 4;
function idleFree() {
  sched.resident = null;
  freeMemory().catch(() => {
    /* server already down — nothing cached anyway */
  });
}
function scheduleIdleFree() {
  if (sched.idleTimer) clearTimeout(sched.idleTimer);
  const avail = ramAvailGiB();
  if (avail !== null && avail < IDLE_KEEP_WARM_GIB) return idleFree();
  sched.idleTimer = setTimeout(() => {
    sched.idleTimer = null;
    if (sched.runningId || sched.parked.length) return;
    idleFree();
  }, 5 * 60_000);
}

/** The chosen model files a leg loads — what prefetch warms. */
function legFiles(leg: string): string[] {
  const chosen = loadSettings().chosen;
  const slots = leg === "wan" ? ["anim-high", "anim-low", "anim-te", "anim-vae"] : ["rot-unet", "rot-te", "rot-vae"];
  return slots
    .map((s) => chosenOption(s, chosen)?.file)
    .filter((f): f is string => !!f)
    .map((f) => join(modelsDir(), f))
    .filter((p) => existsSync(p));
}

/**
 * Idle-priority read of a leg's files into the page cache — OFF by default.
 *
 * Measured on 2026-08-05: warming Wan's 24GB while Qwen loaded pushed HOST
 * used memory to 62GB and the guard (correctly) killed the stack. Inside
 * WSL the page cache is reclaimable; to Windows the ballooned VM is just
 * gone — an unconfigured WSL2 never hands cache back. Only enable this
 * (FORGE_PREFETCH=1) after capping WSL in .wslconfig with
 * autoMemoryReclaim=gradual, which makes the cache actually returnable.
 */
function prefetchLeg(leg: string) {
  if (process.env.FORGE_PREFETCH !== "1") return;
  if (sched.warmedLeg === leg) return;
  sched.warmedLeg = leg;
  const files = legFiles(leg);
  if (!files.length) return;
  // stdio "ignore" wires cat's stdout to /dev/null — the bytes only ever
  // touch the page cache, which is the entire point.
  const p = spawn("nice", ["-n", "19", "cat", ...files], { stdio: ["ignore", "ignore", "ignore"], detached: true });
  p.unref();
}

function pump() {
  if (sched.runningId || !sched.parked.length) return;
  // Dispatch-time RAM gate: a dispatch is the moment 15-25GB gets promised,
  // so tightness here means WAIT (the job stays queued and visible), not
  // fail — load transients pass in seconds.
  const avail = ramAvailGiB();
  if (avail !== null && avail < RAM_GATE_GIB) {
    if (!sched.gateTimer) {
      sched.gateTimer = setTimeout(() => {
        sched.gateTimer = null;
        pump();
      }, 15_000);
    }
    return;
  }
  // A dispatch is imminent — the warm cache is about to be wanted again.
  if (sched.idleTimer) {
    clearTimeout(sched.idleTimer);
    sched.idleTimer = null;
  }
  // Drain the resident leg first; switch only when it has nothing left.
  let idx = sched.parked.findIndex((p) => p.leg === sched.resident);
  const switching = idx < 0;
  if (switching) idx = 0;
  const next = sched.parked.splice(idx, 1)[0];
  const job = jobs.get(next.id);
  if (!job || job.state !== "queued") return pump();
  sched.runningId = next.id;
  job.state = "running";
  persistJob(next.id);
  void (async () => {
    try {
      if (switching && sched.resident !== null) {
        // The 24GB card cannot hold both stacks (measured OOM on 08-04);
        // exactly one /free per real switch, then the cold start.
        try {
          await freeMemory();
        } catch {
          /* server down surfaces at queue time with its own message */
        }
        sched.warmedLeg = null;
      }
      sched.resident = next.leg;
      // Warm the OTHER pending leg while this one holds the GPU.
      const other = sched.parked.find((p) => p.leg !== next.leg);
      if (other) prefetchLeg(other.leg);
      await runJob(next.id, next.graph, next.clientId);
    } finally {
      sched.runningId = null;
      pump();
      if (!sched.runningId && !sched.parked.length) scheduleIdleFree();
    }
  })();
}

/**
 * The dispatch-time RAM gate: tightness means the queued job WAITS, so
 * this floor decides "is the box being eaten by something ELSE" — and it
 * must sit BELOW the loaded-model steady state or it deadlocks the queue.
 * Measured on the 40GB-capped VM: a finished Qwen job idles at 9.3-9.5GiB
 * available (a 10GiB floor waited on headroom that can never appear —
 * the next dispatch's own /free is what releases it). 6 clears that state
 * while still catching genuinely external pressure above the guard's
 * soft floor (5).
 */
const RAM_GATE_GIB = Number(process.env.FORGE_RAM_GATE_GIB ?? 6);
function ramAvailGiB(): number | null {
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
    return m ? Number(m[1]) / 2 ** 20 : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!backendPresent()) return NextResponse.json({ error: "no backend on this machine" }, { status: 404 });
  // Accepting a job costs nothing until dispatch (the scheduler holds it),
  // so POST only refuses when the box is ALREADY squeezed past the guard's
  // own soft floor — everything milder waits in the queue instead.
  const avail = ramAvailGiB();
  if (avail !== null && avail < 4) {
    return NextResponse.json(
      {
        error:
          `RAM guard: only ${avail.toFixed(1)}GiB of system RAM is available — the box is squeezed. ` +
          `Close whatever is eating RAM (tests, other sessions), or stop/start the backend to drop cached models.`,
      },
      { status: 503 },
    );
  }
  const body = await req.json();
  const mode = modeById(body.mode ?? body.kind); // `kind` — pre-modes clients
  if (!mode) return NextResponse.json({ error: `unknown mode ${body.mode ?? body.kind}` }, { status: 400 });
  if (!body.imageB64) return NextResponse.json({ error: "imageB64 is required — pick an init frame first" }, { status: 400 });
  if (mode.needs.end && !body.endB64) return NextResponse.json({ error: "this mode needs a last frame too" }, { status: 400 });
  if (mode.needs.mask && !body.maskB64) return NextResponse.json({ error: "this mode needs a brushed mask" }, { status: 400 });

  const settings = loadSettings();
  setComfyUrl(settings.comfyUrl);

  const images: Record<string, string | null> = { init: null, end: null, mask: null, style: null };
  try {
    images.init = await uploadB64(body.imageB64, "init");
    if (body.endB64) images.end = await uploadB64(body.endB64, "end");
    if (body.maskB64) images.mask = await uploadB64(body.maskB64, "mask");
    if (body.styleB64) images.style = await uploadB64(body.styleB64, "style");
  } catch (e: any) {
    return NextResponse.json({ error: `ComfyUI unreachable at ${settings.comfyUrl}: ${e.message}` }, { status: 502 });
  }

  const has = (optionId: string) => {
    const o = optionById(optionId);
    return o ? installState(o).state === "installed" : false;
  };
  const baseSeed = Number.isFinite(+body.seed) ? +body.seed : Math.floor(Math.random() * 1e9);
  const fast = !!body.fast && fastAvailable(mode.leg, has);

  // A batch is N independent jobs, not one graph: the scheduler runs them
  // in turn and each gets its own card, cancel and re-roll in the panel.
  const batch = body.batch && mode.batch && mode.batch.id === body.batch ? mode.batch : null;
  const runs: Array<Record<string, unknown>> = batch
    ? batch.values.map((v: Record<string, unknown>) => ({ ...body.params, ...v }))
    : [{ ...(body.params ?? {}) }];

  const jobIds: string[] = [];
  for (const params of runs) {
    const ctx = {
      has,
      lora: (optionId: string) => optionById(optionId)?.file.replace(/^loras\//, "") ?? null,
      unet: (slotId: string) => chosenOption(slotId, settings.chosen)?.file.replace(/^unet\//, "") ?? null,
      fast,
      images,
      seed: baseSeed,
    };
    let graph, resolvedPrompt;
    try {
      resolvedPrompt = mode.prompt(params, ctx);
      graph = mode.build(params, ctx);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    const facet =
      typeof params.facing === "string" ? `-${params.facing}` : typeof params.preset === "string" && params.preset !== "custom" ? `-${params.preset}` : "";
    const preset = mode.presets?.find((p: { id: string }) => p.id === params.preset);
    const id = `${mode.id}${facet}-${Date.now().toString(36)}-${jobIds.length}`;
    const clientId = randomUUID();
    jobs.set(id, {
      state: "queued",
      leg: mode.leg,
      mode: mode.id,
      label: `${mode.title}${facet}`,
      startedAt: Date.now(),
      params,
      resolvedPrompt,
      seed: baseSeed,
      fast,
      // The clip these frames are destined for — the sheet tray's default.
      clip: preset?.clip || undefined,
      // Filing tags flow into job.json, which is what the library scans —
      // a tagged generation shows up under its character with no file moves.
      project: typeof body.project === "string" ? body.project : undefined,
      character: typeof body.character === "string" ? body.character : undefined,
    });
    persistJob(id);
    sched.parked.push({ id, graph, clientId, leg: mode.leg });
    jobIds.push(id);
  }
  pump();
  return NextResponse.json({ jobIds, jobId: jobIds[0] });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const frame = url.searchParams.get("frame");
  if (!id) {
    // Union of memory and disk: the Map knows live jobs, the disk knows
    // everything that ever finished (job.json survives reloads).
    const all: Record<string, unknown> = {};
    try {
      for (const dir of readdirSync(WORK)) {
        try {
          const meta = JSON.parse(readFileSync(join(WORK, dir, "job.json"), "utf8"));
          // Disk copies of live states are stale by definition — the Map
          // overwrites survivors below; what remains died in a reload.
          all[dir] =
            meta.state === "queued" || meta.state === "running"
              ? { ...meta, state: "error", error: "lost in a dev-server reload — re-roll it" }
              : meta;
        } catch {
          all[dir] = { state: "done", mode: "cli", label: dir, startedAt: 0 };
        }
      }
    } catch {
      /* no work dir yet */
    }
    for (const [k, v] of jobs) {
      const { previewB64: _p, ...lean } = v;
      all[k] = lean;
    }
    return NextResponse.json({ jobs: all });
  }
  if (frame) {
    // No traversal: the frame must be a bare .png name that really exists in
    // this job's dir (disk is the authority — the job map dies on dev reload).
    try {
      const ok = /^[\w.-]+\.png$/.test(frame) && /^[\w-]+$/.test(id) && readdirSync(join(WORK, id)).includes(frame);
      if (!ok) return NextResponse.json({ error: "no such frame" }, { status: 404 });
      let buf: Buffer = readFileSync(join(WORK, id, frame));
      // ?w= serves a nearest-neighbour thumbnail: a 56px strip thumb must not
      // cost a 400KB decode ×21 — that is what made the jobs board drop
      // images under load. Full-size stays the default.
      const w = Number(url.searchParams.get("w"));
      if (Number.isFinite(w) && w >= 16 && w <= 1024) {
        const mod = await import("canvas");
        const img = await mod.loadImage(buf);
        if (img.width > w) {
          const cv = mod.createCanvas(w, Math.round((img.height / img.width) * w));
          const ctx = cv.getContext("2d");
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          buf = cv.toBuffer("image/png");
        }
      }
      // A job's frames never change after it finishes — let the browser keep
      // them instead of refetching megabytes on every poll-driven rerender.
      return new NextResponse(new Uint8Array(buf), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400, immutable" },
      });
    } catch {
      return NextResponse.json({ error: "no such frame" }, { status: 404 });
    }
  }
  if (url.searchParams.get("preview")) {
    const b64 = jobs.get(id)?.previewB64;
    if (!b64) return NextResponse.json({ error: "no preview yet" }, { status: 404 });
    return new NextResponse(new Uint8Array(Buffer.from(b64, "base64")), { headers: { "content-type": "image/jpeg" } });
  }
  const job = jobs.get(id);
  if (!job) {
    // Survive a dev-server reload: job.json + frames on disk rebuild it.
    // A job that was queued/running when the server reloaded is gone for
    // good — its graph lived in memory — so report it honestly.
    try {
      const meta = JSON.parse(readFileSync(join(WORK, id, "job.json"), "utf8"));
      const frames = readdirSync(join(WORK, id)).filter((f) => f.endsWith(".png"));
      if ((meta.state === "queued" || meta.state === "running") && !frames.length) {
        return NextResponse.json({ ...meta, state: "error", error: "lost in a dev-server reload — re-roll it", frames });
      }
      return NextResponse.json({ ...meta, ...(meta.state === "running" ? { state: "done" } : {}), frames, note: "recovered from disk" });
    } catch {
      /* fall through */
    }
    try {
      const frames = readdirSync(join(WORK, id)).filter((f) => f.endsWith(".png"));
      if (frames.length) return NextResponse.json({ state: "done", frames, note: "recovered from disk" });
    } catch {
      /* genuinely unknown */
    }
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }
  const { previewB64: _p, ...lean } = job;
  return NextResponse.json({ ...lean, hasPreview: !!job.previewB64 });
}

export async function DELETE(req: Request) {
  if (!backendPresent()) return NextResponse.json({ error: "no backend on this machine" }, { status: 404 });
  const id = new URL(req.url).searchParams.get("id");
  const job = id ? jobs.get(id) : null;
  if (!id || !job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  if (job.state === "queued") {
    // Never reached ComfyUI — just unpark it.
    sched.parked = sched.parked.filter((p) => p.id !== id);
    Object.assign(job, { state: "cancelled" });
    persistJob(id);
    return NextResponse.json({ ok: true, how: "unparked" });
  }
  if (job.state !== "running") return NextResponse.json({ error: `job is ${job.state}` }, { status: 400 });
  const settings = loadSettings();
  setComfyUrl(settings.comfyUrl);
  try {
    const how = job.promptId ? await cancelPrompt(job.promptId) : "dequeued";
    Object.assign(job, { state: "cancelled", error: undefined, progress: undefined, previewB64: undefined });
    persistJob(id);
    return NextResponse.json({ ok: true, how });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
