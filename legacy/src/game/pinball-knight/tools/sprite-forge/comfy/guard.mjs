#!/usr/bin/env node
/**
 * RAM GUARD — the failsafe that keeps generation from freezing the box.
 *
 * On 2026-08-05 ComfyUI (model swaps parked in system RAM) plus a test run
 * filled all 64GB and froze the HOST. WSL only sees its own ~47GiB slice,
 * so this guard watches BOTH sides:
 *
 *   WSL  /proc/meminfo MemAvailable, every 2s — fast, free, catches spikes.
 *   HOST PowerShell interop (Win32_OperatingSystem), every 5s — the real
 *        64GB number the freeze actually hit. Skipped quietly where
 *        interop is unavailable.
 *
 * Rules, in escalation order (rendering is always the sacrifice — a lost
 * frame re-queues, a frozen host loses everything):
 *
 *   SOFT   wsl avail < 3GiB   (instant)  → interrupt + drop cached models
 *          host used > 58GB   (instant)  → same
 *   HARD   wsl avail < 1.5GiB (instant)  → stop the ComfyUI server
 *          wsl avail < 4GiB   sustained 30s → stop
 *          host used > 60GB   sustained ~15s (3 samples) → stop
 *
 * WSL floors are calibrated to the 40GB-CAPPED VM (post-.wslconfig) by
 * three measured retunes on 2026-08-05: a healthy Wan run's deepest
 * transient leaves ~4-6GiB available, and every floor above that has
 * interrupted a WORKING job. With the cap, the host tripwire is the real
 * freeze protection; the WSL floors only catch true runaway.
 *
 *   node guard.mjs [--soft 3] [--hard 1.5] [--sustain 4] [--sustain-secs 30]
 *                  [--host-soft-used 58] [--host-hard-used 60] [--once]
 *
 * State for the panel: heartbeat ~/comfy/guard.json each poll (with
 * hostUsedGB when known), trip record ~/comfy/guard-tripped.json (cleared
 * by the next server start). Zero dependencies; pid at ~/comfy/guard.pid.
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
// Floors sit UNDER the measured Wan envelope on the 40GB-capped VM: a
// healthy Wan job's deepest transient (both experts churning + tiled
// decode) leaves ~4-6GiB available — the 5GiB soft floor interrupted a
// working run (2026-08-05, smoke 4). Below these, it is genuinely a
// runaway; the kernel OOM-killing the comfy python (recoverable) and the
// HOST tripwire (the real freeze protection) are the layers underneath.
const SOFT_GIB = arg("soft", 3);
const HARD_GIB = arg("hard", 1.5);
const SUSTAIN_GIB = arg("sustain", 4);
const SUSTAIN_SECS = arg("sustain-secs", 30);
// 58, not lower: with .wslconfig capping WSL at 40GB, a fully loaded but
// HEALTHY box peaks ~57GB host used (40 + Windows baseline) — a softer
// floor would strike legitimate generation on every run.
const HOST_SOFT_USED_GB = arg("host-soft-used", 58);
const HOST_HARD_USED_GB = arg("host-hard-used", 60);
const POLL_MS = arg("poll", 2000);
const HOST_POLL_MS = 5000;
const HOST_HARD_SAMPLES = 3; // 3 × 5s ≈ the "sustained" the freeze needs
const COOLDOWN_MS = 30_000;

function availGiB() {
  const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync("/proc/meminfo", "utf8"));
  return m ? Number(m[1]) / 2 ** 20 : NaN;
}

/** Host-side memory via WSL interop; resolves null where unavailable. */
function hostMem() {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-CimInstance Win32_OperatingSystem | Select-Object -Property FreePhysicalMemory,TotalVisibleMemorySize | ConvertTo-Json"],
      { timeout: 4000 },
      (err, out) => {
        if (err) return resolve(null);
        try {
          const j = JSON.parse(String(out).replace(/\r/g, ""));
          resolve({ used: (j.TotalVisibleMemorySize - j.FreePhysicalMemory) / 2 ** 20, total: j.TotalVisibleMemorySize / 2 ** 20 });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

const log = (s) => console.log(`[guard ${new Date().toISOString()}] ${s}`);

let lastSoft = 0;
async function softStrike(why) {
  if (Date.now() - lastSoft < COOLDOWN_MS) return;
  lastSoft = Date.now();
  log(`SOFT (${why}) — interrupting + dropping cached models`);
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

function hardStrike(why, detail) {
  log(`HARD (${why}) — stopping ComfyUI`);
  writeFileSync(
    join(COMFY, "guard-tripped.json"),
    JSON.stringify({ when: new Date().toISOString(), ...detail, action: `stopped ComfyUI (${why})` }, null, 1),
  );
  execFile("bash", [join(COMFY, "stop.sh")], (err, out) => log(`stop.sh: ${err ? err.message : String(out).trim()}`));
}

if (process.argv.includes("--once")) {
  const a = availGiB();
  const h = await hostMem();
  console.log(
    JSON.stringify({
      wslAvailGiB: +a.toFixed(2),
      host: h ? { usedGB: +h.used.toFixed(1), totalGB: +h.total.toFixed(1) } : "interop unavailable",
      verdict:
        a < HARD_GIB || (h && h.used > HOST_HARD_USED_GB) ? "HARD" : a < SOFT_GIB || (h && h.used > HOST_SOFT_USED_GB) ? "SOFT" : "ok",
    }),
  );
  process.exit(0);
}

const hostProbe = await hostMem();
log(
  `watching — wsl: soft ${SOFT_GIB} / hard ${HARD_GIB} / sustained <${SUSTAIN_GIB}GiB for ${SUSTAIN_SECS}s · ` +
    (hostProbe
      ? `host (${hostProbe.total.toFixed(0)}GB): soft >${HOST_SOFT_USED_GB}GB used / hard >${HOST_HARD_USED_GB}GB used sustained ${(HOST_HARD_SAMPLES * HOST_POLL_MS) / 1000}s`
      : "host: interop unavailable, WSL rules only"),
);
writeFileSync(join(COMFY, "guard.pid"), String(process.pid));

let sustainSince = null;
let host = hostProbe;
let hostHardStreak = 0;

const tick = () => {
  const avail = availGiB();
  try {
    writeFileSync(
      join(COMFY, "guard.json"),
      JSON.stringify({
        pid: process.pid,
        at: Date.now(),
        availGiB: +avail.toFixed(2),
        softGiB: SOFT_GIB,
        hardGiB: HARD_GIB,
        ...(host ? { hostUsedGB: +host.used.toFixed(1), hostTotalGB: +host.total.toFixed(1), hostHardUsedGB: HOST_HARD_USED_GB } : {}),
      }),
    );
  } catch {
    /* heartbeat is best-effort */
  }

  if (avail < HARD_GIB) {
    return hardStrike("wsl hard floor", { availGiB: +avail.toFixed(2) });
  }
  // The creep case: nothing spikes below the hard floor, but the box sits
  // squeezed — exactly how the freeze looked from inside for its last minute.
  if (avail < SUSTAIN_GIB) {
    sustainSince ??= Date.now();
    if (Date.now() - sustainSince > SUSTAIN_SECS * 1000) {
      return hardStrike("wsl sustained pressure", {
        availGiB: +avail.toFixed(2),
        sustainedS: Math.round((Date.now() - sustainSince) / 1000),
      });
    }
  } else {
    sustainSince = null;
  }
  if (avail < SOFT_GIB) void softStrike(`wsl ${avail.toFixed(1)}GiB available`);
};

const hostTick = async () => {
  const h = await hostMem();
  if (!h) return;
  host = h;
  if (h.used > HOST_HARD_USED_GB) {
    hostHardStreak++;
    if (hostHardStreak >= HOST_HARD_SAMPLES) {
      return hardStrike(`host sustained >${HOST_HARD_USED_GB}GB used`, { hostUsedGB: +h.used.toFixed(1) });
    }
  } else {
    hostHardStreak = 0;
  }
  if (h.used > HOST_SOFT_USED_GB) void softStrike(`host ${h.used.toFixed(1)}GB used`);
};

setInterval(tick, POLL_MS);
if (hostProbe) setInterval(hostTick, HOST_POLL_MS);
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
