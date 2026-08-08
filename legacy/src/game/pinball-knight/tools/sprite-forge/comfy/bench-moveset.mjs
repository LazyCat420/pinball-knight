#!/usr/bin/env node
/**
 * THE WHOLE MATRIX, UNATTENDED — every clip × every facing for one creature.
 *
 *   node bench-moveset.mjs --character dog --master ../sources/dog-2026-08-07/09_wan_00696_.png
 *   node bench-moveset.mjs --character dog --master <png> --facings E --clips idle,run
 *   node bench-moveset.mjs --character dog --master <png> --resume
 *
 * 7 clips × 3 facings = 21 runs at 6–15 min each, so a full sweep is 3–5 hours
 * of GPU. It prints a matrix at the end and writes `bench-<character>.json`.
 *
 * ── IT SHELLS OUT TO cli.mjs, DELIBERATELY ──────────────────────────────────
 *
 * Every run goes through `cli.mjs animate` as a subprocess rather than calling
 * the graph builders directly. This repo has been bitten three separate times
 * by a second caller that drifted from the first — `animate` never reached
 * MODES and so lost its `avoid` clauses, `retarget` passed a stub ctx that
 * silently disabled every LoRA, and `rotate` restated its prompt and never
 * loaded the multi-angle LoRA at all. A benchmark that re-implemented the
 * generation path would be measuring a pipeline nobody ships.
 *
 * The cost is process startup per run, which against a 600-second generation is
 * nothing.
 *
 * ── THE --loop POLICY IS THE POINT OF THIS FILE ─────────────────────────────
 *
 * Measured 2026-08-08: `--loop` pins frame 1 == frame 21, and on a clip with no
 * strong intrinsic motion "never move" satisfies both endpoints perfectly.
 * `idle4 --loop` produced 2 distinct bounding boxes across 21 frames; the same
 * command without it produced 12. `run4 --loop` produced ONE.
 *
 * So the pin is applied per clip, from `LOOPING`, and never globally. Getting
 * this wrong costs the whole sweep — twenty corpses that all pass the ghost
 * gate. See `documentation/chapters/12-the-clip-that-does-not-move.md`.
 *
 * ── QUADRUPED PRESETS ───────────────────────────────────────────────────────
 *
 * `--body quadruped` (the default here) maps each clip to its `*4` preset. The
 * unnumbered presets are written in biped vocabulary — `attack` hands the
 * creature a WEAPON, `run` asks for a "two-step run cycle", `defend` describes
 * a shield block. Pass `--body biped` for a humanoid.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const has = (n) => args.includes(`--${n}`);

/**
 * The clip contract, in play order. `crouch` is the leaper telegraph and has NO
 * painter fallback; `idle` is the one `importedPaints` refuses a sheet without.
 */
const CLIPS = ["idle", "walk", "run", "attack", "stumble", "crouch", "death"];

/** Clips whose motion genuinely returns to its start pose. ONLY these get the pin. */
const LOOPING = new Set(["walk", "run"]);

/** clip -> preset id, per body plan. */
const PRESET = {
  quadruped: { idle: "idle4", walk: "walk4", run: "run4", attack: "attack4", stumble: "stumble4", crouch: "defend4", death: "death4" },
  biped: { idle: "idle", walk: "walk", run: "run", attack: "attack", stumble: "stumble", crouch: "defend", death: "death" },
};

const character = opt("character", "dog");
const master = opt("master");
const body = opt("body", "quadruped");
const facings = opt("facings", "E,S,N").split(",").map((s) => s.trim()).filter(Boolean);
const clips = opt("clips", CLIPS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const frames = opt("frames", "21");
const seed = opt("seed", "7");
const resultsPath = join(HERE, `bench-${character}.json`);

if (!master) throw new Error("bench-moveset needs --master <png> (the ONE approved master; facings are rotated from it)");
if (!PRESET[body]) throw new Error(`--body must be quadruped|biped, got "${body}"`);

/** Prior results, so a killed sweep can pick up where it stopped. */
const results = has("resume") && existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : {};
const save = () => writeFileSync(resultsPath, JSON.stringify(results, null, 1) + "\n");

const sh = (args_) => execFileSync("node", args_, { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 24 });

/**
 * Drop the resident models between runs.
 *
 * Not a superstition: the A14B pair is ~31GB of reads and the guard interrupts
 * at 1.2GiB WSL-available. Runs in this session took 343s and 913s for the SAME
 * work, and the slow ones followed a run that had left weights resident. This
 * costs a reload and buys a predictable sweep.
 */
async function freeModels() {
  try {
    await fetch("http://127.0.0.1:8188/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    await new Promise((r) => setTimeout(r, 4000));
  } catch { /* a benchmark must not die because a housekeeping call failed */ }
}

/** Newest run directory under work/comfy, so we can read the job.json the CLI wrote. */
function newestRun(prefix) {
  const root = join(HERE, "..", "work", "comfy");
  const dirs = readdirSync(root).filter((d) => d.startsWith(prefix));
  if (!dirs.length) return null;
  dirs.sort();
  return join(root, dirs[dirs.length - 1]);
}

/** ── 1. the masters ───────────────────────────────────────────────────────
 * Every facing is rotated from the ONE approved master, never from another
 * facing: Qwen-Image-Edit identity drift compounds over serial edits, so a
 * chain E->S->N puts two generations of drift on N.
 */
const masters = { E: master };
for (const f of facings.filter((x) => x !== "E")) {
  if (results[`master:${f}`]?.ok && existsSync(results[`master:${f}`].file)) {
    masters[f] = results[`master:${f}`].file;
    console.log(`master ${f}: reusing ${masters[f]}`);
    continue;
  }
  console.log(`\n=== master ${f} — rotate ===`);
  await freeModels();
  try {
    const out = sh(["cli.mjs", "rotate", "--init", master, "--to", f, "--file-as", character, "--seed", seed]);
    process.stdout.write(out);
    const dir = newestRun(`rotate-${f}-`);
    const pngs = dir ? readdirSync(dir).filter((n) => n.endsWith(".png")).sort() : [];
    if (!pngs.length) throw new Error("rotate produced no PNG");
    masters[f] = join(dir, pngs[0]);
    results[`master:${f}`] = { ok: true, file: masters[f], loraBanner: /fal-multi-angle LoRA/.test(out) };
  } catch (err) {
    console.error(`master ${f} FAILED: ${err.message}`);
    results[`master:${f}`] = { ok: false, error: String(err.message).slice(0, 400) };
  }
  save();
}

/** ── 2. the matrix ──────────────────────────────────────────────────────── */
for (const facing of facings) {
  if (!masters[facing]) {
    console.error(`\n### skipping facing ${facing} — no master`);
    continue;
  }
  for (const clip of clips) {
    const key = `${facing}:${clip}`;
    if (results[key]?.ok) { console.log(`${key}: already done, skipping`); continue; }
    const preset = PRESET[body][clip];
    const loop = LOOPING.has(clip);
    console.log(`\n=== ${key} — preset ${preset}${loop ? " --loop" : " (no loop: not a cycle)"} ===`);
    await freeModels();
    const t0 = Date.now();
    try {
      const argv = ["cli.mjs", "animate", "--init", masters[facing], "--preset", preset,
        "--frames", frames, "--seed", seed, "--file-as", character];
      if (loop) argv.push("--loop");
      const out = sh(argv);
      process.stdout.write(out);
      const dir = newestRun(`animate-${preset}-`);
      const job = dir && existsSync(join(dir, "job.json")) ? JSON.parse(readFileSync(join(dir, "job.json"), "utf8")) : null;
      const m = job?.motion, g = job?.ghost;
      const churn = m?.churn?.length ? [...m.churn].sort((a, b) => a - b)[m.churn.length >> 1] : null;
      results[key] = {
        ok: true, dir, preset, loop, tookS: Math.round((Date.now() - t0) / 1000),
        motion: m?.level ?? null, churnMedian: churn, boxes: m?.boxes ?? null, seam: m?.seam ?? null,
        ghost: g?.level ?? null, ghostWorst: g?.pct?.length ? Math.max(...g.pct) : null,
        frozen: m?.level === "reject",
      };
    } catch (err) {
      console.error(`${key} FAILED: ${err.message}`);
      results[key] = { ok: false, preset, loop, error: String(err.message).slice(0, 400), tookS: Math.round((Date.now() - t0) / 1000) };
    }
    save();
  }
}

/** ── 3. the matrix report ────────────────────────────────────────────────── */
const cell = (r) => {
  if (!r) return "    —    ";
  if (!r.ok) return "  ERROR  ";
  if (r.frozen) return " FROZEN  ";
  return `${String(r.churnMedian ?? "?").padStart(5)}%  `;
};
console.log(`\n\n=== ${character} — churn median by clip x facing ===\n`);
console.log("clip      " + facings.map((f) => f.padEnd(9)).join(""));
for (const clip of clips) {
  console.log(clip.padEnd(10) + facings.map((f) => cell(results[`${f}:${clip}`])).join(""));
}
const all = clips.flatMap((c) => facings.map((f) => results[`${f}:${c}`])).filter(Boolean);
const frozen = all.filter((r) => r.frozen).length;
const errored = all.filter((r) => !r.ok).length;
const mins = Math.round(all.reduce((s, r) => s + (r.tookS ?? 0), 0) / 60);
console.log(`\n${all.length} runs · ${frozen} FROZEN · ${errored} errored · ${mins} min of GPU`);
console.log(`results -> ${resultsPath}`);
console.log("\nA churn number is NOT approval. Render each survivor at 8fps and look at it.");
