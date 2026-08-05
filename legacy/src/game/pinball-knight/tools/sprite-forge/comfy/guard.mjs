#!/usr/bin/env node
/**
 * RAM GUARD — the failsafe that keeps generation from freezing the box.
 *
 * On 2026-08-05 ComfyUI (model swaps parked in system RAM) plus a test run
 * filled all 64GB and froze the HOST — WSL takes ~47GB of it, and once
 * that balloons the Windows side has nothing left. This process is the
 * dead-man's switch: rendering is always the thing to sacrifice, because
 * a lost frame re-queues and a frozen host loses everything.
 *
 *   node guard.mjs                      run with defaults (soft 8, hard 4 GiB)
 *   node guard.mjs --soft 10 --hard 5   custom floors
 *   node guard.mjs --once               one sample + verdict, then exit
 *
 * Two floors on MemAvailable (/proc/meminfo — what the kernel could give
 * out without swapping, the honest number):
 *
 *   SOFT  interrupt the running prompt + drop every cached model
 *         (POST /interrupt, POST /free). Generation degrades to a cold
 *         start; the box stays healthy. 30s cooldown between strikes.
 *   HARD  stop the ComfyUI server outright (~/comfy/stop.sh) and leave a
 *         tripped marker the /forge panel surfaces. Whatever is eating
 *         the rest of the RAM, the 20GB+ generation stack is no longer
 *         part of the problem.
 *
 * State for the panel: heartbeat at ~/comfy/guard.json every poll, trip
 * record at ~/comfy/guard-tripped.json (cleared on the next server start).
 * Zero dependencies; killed by pid from ~/comfy/guard.pid.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COMFY = process.env.COMFY_HOME ?? join(homedir(), "comfy");
const URL = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const SOFT_GIB = arg("soft", 8);
const HARD_GIB = arg("hard", 4);
const POLL_MS = arg("poll", 2000);
const COOLDOWN_MS = 30_000;

function availGiB() {
  const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
  return m ? Number(m[1]) / 2 ** 20 : NaN;
}

const log = (s) => console.log(`[guard ${new Date().toISOString()}] ${s}`);

async function softStrike(avail) {
  log(`SOFT floor: ${avail.toFixed(1)}GiB available < ${SOFT_GIB}GiB — interrupting + dropping models`);
  try {
    await fetch(`${URL}/interrupt`, { method: "POST" });
    await fetch(`${URL}/free`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
  } catch (e) {
    log(`comfy unreachable during soft strike (${e.message}) — nothing to free`);
  }
}

function hardStrike(avail) {
  log(`HARD floor: ${avail.toFixed(1)}GiB available < ${HARD_GIB}GiB — stopping ComfyUI`);
  writeFileSync(
    join(COMFY, "guard-tripped.json"),
    JSON.stringify({ when: new Date().toISOString(), availGiB: +avail.toFixed(2), action: "stopped ComfyUI (hard floor)" }, null, 1),
  );
  execFile("bash", [join(COMFY, "stop.sh")], (err, out) => log(`stop.sh: ${err ? err.message : String(out).trim()}`));
}

if (process.argv.includes("--once")) {
  const a = availGiB();
  console.log(JSON.stringify({ availGiB: +a.toFixed(2), softGiB: SOFT_GIB, hardGiB: HARD_GIB, verdict: a < HARD_GIB ? "HARD" : a < SOFT_GIB ? "SOFT" : "ok" }));
  process.exit(0);
}

log(`watching MemAvailable — soft ${SOFT_GIB}GiB (interrupt+free), hard ${HARD_GIB}GiB (stop server), poll ${POLL_MS}ms`);
writeFileSync(join(COMFY, "guard.pid"), String(process.pid));
let lastSoft = 0;
const tick = async () => {
  const avail = availGiB();
  try {
    writeFileSync(join(COMFY, "guard.json"), JSON.stringify({ pid: process.pid, at: Date.now(), availGiB: +avail.toFixed(2), softGiB: SOFT_GIB, hardGiB: HARD_GIB }));
  } catch {
    /* heartbeat is best-effort */
  }
  if (avail < HARD_GIB) {
    hardStrike(avail);
  } else if (avail < SOFT_GIB && Date.now() - lastSoft > COOLDOWN_MS) {
    lastSoft = Date.now();
    await softStrike(avail);
  }
};
setInterval(tick, POLL_MS);
void tick();
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      rmSync(join(COMFY, "guard.json"), { force: true });
      rmSync(join(COMFY, "guard.pid"), { force: true });
    } catch {
      /* leave stale files rather than die noisily */
    }
    process.exit(0);
  });
}
