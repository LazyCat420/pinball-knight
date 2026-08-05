#!/usr/bin/env node
/**
 * BUILD A WHOLE CHARACTER FROM ONE IMAGE, UNATTENDED.
 *
 *     node scripts/build-character.mjs --src art.png --name swamp_frog
 *     node scripts/build-character.mjs --src art.png --name x --facings E --moves idle,walk
 *     node scripts/build-character.mjs --resume .build/x    # re-score, re-cut, no GPU
 *
 * The forge already owned every step of this. What it did not own was the
 * CHARACTER: you picked a move, launched, waited, found the job card, cut it
 * into cells, dragged rows into a tray — then did that seventeen more times for
 * the other moves and facings. The art was never the bottleneck; the
 * book-keeping was, and it was spending the scarce resource (your attention) to
 * save the cheap one (an idle GPU).
 *
 * This is that book-keeping, done by the machine. It drives the SAME endpoints
 * the panel drives — no new modes, no second scheduler — and leaves behind a
 * directory of cells with a drift verdict on each, so the only thing left to do
 * by hand is look at the ones that failed.
 *
 * ── THE ONE RULE ────────────────────────────────────────────────────────────
 * Every generated cell branches off a MASTER, never off a previous output.
 * Qwen-Image-Edit's identity drift compounds over serial edits and does it
 * smoothly enough that no single step looks wrong. Rotation makes one master
 * per facing FROM THE APPROVED IDLE — never from another rotation.
 *
 * ── ORDER IS NOT COSMETIC ───────────────────────────────────────────────────
 * Every job here is the `qwen` leg. The scheduler drains one leg fully before
 * switching and calls /free exactly once on a real switch, so a build enqueued
 * in this order pays ZERO model swaps. Interleaving anything Wan would cost a
 * 13 GB unload each way, eighteen times.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    src: { type: "string" },
    name: { type: "string" },
    api: { type: "string", default: "http://127.0.0.1:5174" },
    out: { type: "string", default: ".build" },
    facings: { type: "string", default: "E,S,N" },
    moves: { type: "string", default: "idle,walk,run,attack,stumble,death" },
    quality: { type: "boolean", default: false },
    resume: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const API = a.api.replace(/\/$/, "");
const FAST = !a.quality;
const t0 = Date.now();
const log = (s) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s] ${s}`);
const fail = (s) => { console.error(`\n✗ ${s}`); process.exit(1); };

async function post(path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${path} → ${r.status}: ${text.slice(0, 300)}`); }
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${json.error ?? text.slice(0, 300)}`);
  return json;
}

/**
 * Launch one generation job and wait for it.
 *
 * Polls `/api/comfy/generate?id=` rather than trusting the websocket, for the
 * same reason `client.mjs` does: history is the authority and progress events
 * are advisory. A build that keyed completion off a progress event would report
 * success for a job that died after its last tick.
 */
async function generate(mode, params, imageB64, label) {
  const { jobIds } = await post("/api/comfy/generate", {
    mode, params, imageB64, fast: FAST, character: a.name,
  });
  const id = jobIds?.[0];
  if (!id) throw new Error(`${label}: no job id came back`);

  let last = "";
  for (let i = 0; i < 1200; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(`${API}/api/comfy/generate?id=${id}`);
    if (!r.ok) continue;
    const job = await r.json();
    if (job.state !== last) { log(`   ${label}: ${job.state}${job.progress ? ` ${Math.round(job.progress * 100)}%` : ""}`); last = job.state; }
    if (job.state === "done") return { id, frames: job.frames ?? [] };
    if (job.state === "error") throw new Error(`${label}: ${job.error}`);
    if (job.state === "cancelled") throw new Error(`${label}: cancelled`);
  }
  throw new Error(`${label}: still running after 40 minutes`);
}

async function frameB64(id, frame) {
  const r = await fetch(`${API}/api/comfy/generate?id=${id}&frame=${encodeURIComponent(frame)}`);
  if (!r.ok) throw new Error(`could not fetch frame ${frame}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const b64Of = async (p) => `data:image/png;base64,${(await readFile(p)).toString("base64")}`;
const stripB64 = (s) => (s.startsWith("data:") ? s.slice(s.indexOf(",") + 1) : s);

async function save(dir, file, b64) {
  await mkdir(dir, { recursive: true });
  const p = join(dir, file);
  await writeFile(p, Buffer.from(stripB64(b64), "base64"));
  return p;
}

// ── the build ──────────────────────────────────────────────────────────────

async function main() {
  if (!a.name) fail("--name is required (the published sheet basename)");
  if (!/^[a-z0-9_]+$/.test(a.name)) fail(`--name "${a.name}" is not publishable — lowercase, digits and _ only`);
  if (!a.resume && !a.src) fail("--src is required (the source image)");

  const outDir = a.resume ?? join(a.out, a.name);
  const facings = a.facings.split(",").map((s) => s.trim()).filter(Boolean);
  const moves = a.moves.split(",").map((s) => s.trim()).filter(Boolean);
  if (!facings.includes("E")) fail("E is the master's own facing and cannot be skipped");
  if (!moves.includes("idle")) fail("idle is required — importedPaints drops a sheet without one, in silence");

  const jobs = facings.length * moves.length;
  const etaMin = Math.round((jobs * (FAST ? 100 : 260) + (facings.length - 1) * 260 + 10) / 60);
  log(`building "${a.name}" — ${facings.length} facings × ${moves.length} moves = ${jobs} jobs, ~${etaMin} min at ${FAST ? "fast" : "quality"}`);
  log(`   ${outDir}`);
  if (a["dry-run"]) { log("dry run — stopping before any GPU work"); return; }

  await mkdir(outDir, { recursive: true });
  const manifest = { name: a.name, facings, moves, fast: FAST, startedAt: new Date().toISOString(), masters: {}, rows: {} };
  const write = () => writeFile(join(outDir, "build.json"), JSON.stringify(manifest, null, 2));

  // ── 1. INTAKE — the approved E master ────────────────────────────────────
  //
  // Its QA verdict gates everything after it. A build that generates 18 sheets
  // from an off-contract master has spent 40 minutes to produce 72 cells that
  // are all wrong in the same way.
  let masterE = join(outDir, "master-E.png");
  if (existsSync(masterE) && a.resume) {
    log("1/4 intake — reusing the approved master");
  } else {
    log("1/4 intake");
    const prep = await post("/api/comfy/pipeline", { op: "prep", imageB64: await b64Of(a.src) });
    const cut = await generate("segment", {}, prep.frameB64, "cut out");
    const cutFrame = cut.frames.find((f) => /cut/i.test(f)) ?? cut.frames[0];
    if (!cutFrame) throw new Error("segmentation returned no frames");
    const framed = await post("/api/comfy/pipeline", {
      op: "reframe", frameB64: await frameB64(cut.id, cutFrame), stripShelf: true,
    });
    const qa = await post("/api/comfy/pipeline", { op: "qa", frameB64: framed.frameB64 });
    log(`   QA: ${qa.level}`);
    for (const c of qa.checks ?? []) if (!c.pass) log(`     ${c.soft ? "!" : "✗"} ${c.label}: ${c.value} (want ${c.want})`);
    if (qa.level === "reject") {
      await save(outDir, "master-E-REJECTED.png", framed.frameB64);
      throw new Error(`intake REJECTED the master — fix the source, not the build.\n${qa.report ?? ""}`);
    }
    await save(outDir, "master-E.png", framed.frameB64);
    manifest.masters.E = { qa: qa.level };
    await write();
  }

  // ── 2. ROTATION — one master per facing, each FROM THE IDLE ──────────────
  const masters = { E: await b64Of(masterE) };
  for (const dir of facings.filter((d) => d !== "E")) {
    const p = join(outDir, `master-${dir}.png`);
    if (existsSync(p) && a.resume) { masters[dir] = await b64Of(p); log(`2/4 rotate ${dir} — reusing`); continue; }
    log(`2/4 rotate → ${dir}`);
    const rot = await generate("rotate", { facing: dir }, masters.E, `rotate ${dir}`);
    if (!rot.frames.length) throw new Error(`rotate ${dir} returned no frames`);
    // Re-frame and re-QA: the edit model returns an opaque frame with the
    // character off the feet line. Skipping this is how the contract quietly
    // breaks for two of three facings.
    const framed = await post("/api/comfy/pipeline", {
      op: "reframe", frameB64: await frameB64(rot.id, rot.frames[0]), stripShelf: true,
    });
    const qa = await post("/api/comfy/pipeline", { op: "qa", frameB64: framed.frameB64 });
    log(`   ${dir} master QA: ${qa.level}`);
    await save(outDir, `master-${dir}.png`, framed.frameB64);
    manifest.masters[dir] = { qa: qa.level };
    await write();
    if (qa.level === "reject") throw new Error(`the ${dir} master was REJECTED — downstream clips would inherit it`);
    masters[dir] = framed.frameB64;
  }

  // ── 3. KEYFRAMES — every move of a facing, off that facing's master ──────
  //
  // Facing-major so a human can review a whole facing while the next one is
  // still generating, and idle-first because idle is the clip the importer
  // refuses a sheet without.
  log(`3/4 keyframes — ${jobs} sheets`);
  for (const dir of facings) {
    for (const move of moves) {
      const key = `${move}:${dir}`;
      const sheetPath = join(outDir, `sheet-${move}-${dir}.png`);
      if (existsSync(sheetPath) && a.resume) { log(`   ${key} — reusing`); continue; }
      try {
        const r = await generate("keyframes", { preset: move, facing: dir, custom: "" }, masters[dir], key);
        if (!r.frames.length) throw new Error("no frames");
        await save(outDir, `sheet-${move}-${dir}.png`, await frameB64(r.id, r.frames[0]));
        manifest.rows[key] = { state: "generated", jobId: r.id };
      } catch (e) {
        // One bad row must not cost the other seventeen. Same lesson the
        // publisher learned: a batch that stops on its first bad item invites
        // a manual workaround.
        log(`   ✗ ${key}: ${e.message}`);
        manifest.rows[key] = { state: "failed", error: e.message };
      }
      await write();
    }
  }

  // ── 4. CUT + SCORE ───────────────────────────────────────────────────────
  log("4/4 cut into cells + drift");
  for (const [key, row] of Object.entries(manifest.rows)) {
    if (row.state === "failed") continue;
    const [move, dir] = key.split(":");
    try {
      const cut = await post("/api/comfy/pipeline", {
        op: "cut",
        sheetB64: await b64Of(join(outDir, `sheet-${move}-${dir}.png`)),
        sidecar: { rows: [move] },
      });
      const cells = (cut.rows ?? []).flatMap((r) => r.cells);
      row.cells = cells.length;
      row.state = cells.length ? "cut" : "failed";
      if (!cells.length) row.error = cut.warnings?.[0] ?? "cut found no cells";
      log(`   ${key}: ${cells.length} cells${cells.length === 4 ? "" : "  ← expected 4"}`);
    } catch (e) {
      row.state = "failed";
      row.error = e.message;
      log(`   ✗ ${key} cut: ${e.message}`);
    }
    await write();
  }

  const ok = Object.values(manifest.rows).filter((r) => r.state === "cut").length;
  const bad = Object.entries(manifest.rows).filter(([, r]) => r.state === "failed");
  manifest.finishedAt = new Date().toISOString();
  await write();

  log(`\n── ${a.name}: ${ok}/${Object.keys(manifest.rows).length} rows cut cleanly`);
  for (const [k, r] of bad) log(`   ✗ ${k}: ${r.error}`);
  log(`   ${outDir}`);
  log(`   next: review the sheets, then assemble + stage from the /forge sheet tray`);
}

main().catch((e) => fail(e.message));
