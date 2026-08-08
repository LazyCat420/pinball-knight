/**
 * Drive the HOST's real Chrome over CDP.
 *
 * WHY: WSL2 has no GPU-backed browser of its own, and Playwright's bundled
 * Chromium falls back to SwiftShader — a software rasteriser on which GPU work
 * reads as free and CPU work reads as catastrophic. Any run that quotes a
 * millisecond has to happen on real silicon, which means Windows Chrome,
 * launched from WSL and connected back through a loopback debugging port.
 *
 * Extracted from scripts/playtest.mjs so the profiling harnesses share one
 * copy of the connect/rewrite/teardown dance rather than three drifting ones.
 *
 * CPU PINNING: when launched under scripts/with-cores.sh, the env vars
 * BDB_CDP_PORT / BDB_WIN_AFFINITY_HEX / BDB_SLOT_DIR are set and Chrome is
 * started through `cmd.exe /c start "" /affinity <hex> /b` — affinity is set
 * at CreateProcess time so the GPU process and renderers inherit it (setting
 * it after launch reaches only the parent). The browser is a WINDOWS process:
 * taskset from WSL would pin the interop stub, which exits immediately.
 * Without the env vars, behavior is exactly the pre-pinning code path.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Windows Chrome locations, as seen from WSL2. */
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const CMD_EXE = "/mnt/c/Windows/System32/cmd.exe";

/** Slot env from scripts/with-cores.sh; all null/absent when unwrapped. */
const ENV_PORT = process.env.BDB_CDP_PORT ? Number(process.env.BDB_CDP_PORT) : null;
const ENV_AFFINITY = process.env.BDB_WIN_AFFINITY_HEX || null;
const ENV_SLOT_DIR = process.env.BDB_SLOT_DIR || null;

/** Profile dir name — doubles as the teardown scope, so a run can only ever
 *  kill its own slot's browsers, never a concurrent run's. */
const userDataDirName = () => ENV_SLOT_DIR ?? "bdb-playtest";

/** Run a PowerShell script on the host without shell-quoting hazards. */
function psRun(script, { timeout = 20_000, stdio } = {}) {
  const enc = Buffer.from(`$ProgressPreference='SilentlyContinue'\n${script}`, "utf16le").toString("base64");
  return execSync(`powershell.exe -NoProfile -EncodedCommand ${enc}`, { timeout, stdio }).toString();
}

/** True when a CDP endpoint is already answering on the port. */
export async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// In the pinned path the cmd.exe trampoline exits instantly and the chrome
// pid is never known to us, so "did THIS run launch it" is a boolean, not a
// child handle. Teardown finds pids via CommandLine queries, never spawn().
let launchedThisRun = false;

/**
 * Read the live root browser's affinity mask back off the Windows process
 * tree. Attaching is not pinning: a reused endpoint inherits whatever mask
 * the browser was started with, so reuse is allowed only when the mask
 * matches the slot's. Unreadable counts as wrong (respawn pinned).
 */
/**
 * Every process query below MUST be constrained to the browser executables.
 * A CommandLine-only match also hits the things that merely MENTION the slot:
 * the with-cores.sh wrapper, the cmd.exe trampoline, an agent's shell, this
 * very harness. Matching those is harmless for a read, but `Stop-Process` on
 * them kills the run that owns the slot — and a null CommandLine (access
 * denied on someone else's process) must not fall through either.
 */
const BROWSERS = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine }`;

async function affinityMatches(port, hex) {
  try {
    const out = psRun(
      `$p = ${BROWSERS} | Where-Object { $_.CommandLine -match '--remote-debugging-port=${port}\\b' -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
       if ($p) { '{0:X}' -f [int64](Get-Process -Id $p.ProcessId).ProcessorAffinity }`,
    ).trim();
    return out !== "" && BigInt("0x" + out) === BigInt("0x" + hex);
  } catch {
    return false;
  }
}

/** Kill whatever owns this CDP port (used only when its mask is wrong). */
function killByCdpPort(port) {
  psRun(
    `${BROWSERS} | Where-Object { $_.CommandLine -match '--remote-debugging-port=${port}\\b' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    { stdio: "ignore" },
  );
}

function killByUserDataDir(name) {
  psRun(
    `${BROWSERS} | Where-Object { $_.CommandLine -like '*--user-data-dir=*${name}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
    { stdio: "ignore" },
  );
}

/**
 * Launch (or reuse) a real-GPU browser and connect over CDP. Returns null when
 * no host browser can be found, so a caller can fall back loudly rather than
 * silently measuring software rendering.
 */
export async function connectRealGpu({ port = ENV_PORT ?? 9333, headed = false, sound = false, log = console.log } = {}) {
  if (await cdpAlive(port)) {
    if (ENV_AFFINITY && !(await affinityMatches(port, ENV_AFFINITY))) {
      log(`▶ live browser on :${port} has the wrong affinity — killing and respawning pinned`);
      try { killByCdpPort(port); } catch { /* best effort */ }
      for (let i = 0; i < 20 && (await cdpAlive(port)); i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } else {
      // A leftover from the last run on this slot is both correctly pinned
      // (slot → mask is deterministic) AND warm — the best case.
      log(`▶ reusing existing CDP browser on :${port}`);
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 120_000 });
    }
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;

  // Armed before the spawn, so a browser started here is collected even if the
  // caller dies between now and its own teardown. Reaping runs at the same
  // moment because this is the one point every harness passes through.
  armReaper();
  reapStaleProfiles({ log });

  const chromeArgs = [
    headed ? "--new-window" : "--headless=new",
    ...(sound ? [] : ["--mute-audio"]),
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    // A dedicated profile dir keeps this from colliding with the user's
    // everyday Chrome session (which would refuse the debugging port).
    `--user-data-dir=C:\\Temp\\${userDataDirName()}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];

  if (ENV_AFFINITY) {
    // cmd.exe cannot exec /mnt/c paths — hand it the Windows-native one.
    const winExe = execSync(`wslpath -w '${exe}'`).toString().trim();
    log(`▶ launching host browser pinned (affinity 0x${ENV_AFFINITY})\n    ${winExe}`);
    // The empty "" is the window title — without it the quoted exe path
    // becomes the title and nothing launches. start /b returns immediately;
    // the cdpAlive poll below is the readiness signal.
    //
    // The bash hop first closes fds >= 200: with-cores.sh holds its slot
    // flocks on exactly those fds, and the cmd.exe interop stub lives as long
    // as the browser shares its console — an inherited lock fd there would
    // make every live browser hold its own slot hostage (no reaping, no
    // handover) long after the run that owned it died.
    spawn(
      "bash",
      ["-c", 'for ((fd=200; fd<256; fd++)); do eval "exec $fd>&-"; done 2>/dev/null; exec "$@"', "bash",
       CMD_EXE, "/c", "start", "", "/affinity", ENV_AFFINITY, "/b", winExe, ...chromeArgs],
      { detached: true, stdio: "ignore", cwd: "/mnt/c/" },
    ).unref();
  } else {
    log(`▶ launching host browser for real-GPU timings\n    ${exe}`);
    spawn(exe, chromeArgs, { detached: true, stdio: "ignore" }).unref();
  }
  launchedThisRun = true;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(port)) {
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 120_000 });
    }
  }
  return null;
}

export function closeHostBrowser() {
  if (!launchedThisRun) return;
  try {
    // The detached Windows process is not ours to signal from WSL; ask
    // Windows — scoped to THIS run's profile dir only.
    killByUserDataDir(userDataDirName());
  } catch {
    /* best effort — a stray headless browser is not worth failing the run */
  }
  launchedThisRun = false;
}

/**
 * ── CLOSING ON THE HAPPY PATH IS NOT CLOSING ────────────────────────────────
 *
 * `closeHostBrowser()` was correct and was only ever reached when a harness
 * ran to completion and remembered to call it. Every Ctrl-C, every throw, every
 * agent that walked away from a probe left a detached Windows browser alive
 * forever — and the browser is DETACHED and `unref()`d precisely so that it
 * outlives us, so nothing else was going to collect it.
 *
 * Measured 2026-08-07: **18 headless Chrome instances and 2 Edge instances**
 * still running, 164 processes holding **9.0 GB**, plus **92 abandoned profile
 * directories in C:\Temp using 24.5 GB of disk**. Names like `bdb-descend-9385`
 * and `bdb-audio-9411` come from one-off debug scripts that no longer exist, so
 * this was never one harness misbehaving — it is every caller of this file, and
 * the count grew across sessions (47 → 122 → 163 processes) until it was eating
 * enough host RAM to make the sprite forge's own RAM guard strike every Wan run.
 *
 * The fix belongs HERE rather than in seventeen callers, and it has to fire on
 * the paths a caller cannot: process exit, both interrupt signals, and an
 * unhandled throw.
 *
 * `exit` handlers must be synchronous — `killByUserDataDir` uses `execSync`,
 * which is why this works at all. On the signal paths we re-raise the default
 * behaviour after cleaning up rather than swallowing the signal.
 */
let reaperArmed = false;
function armReaper() {
  if (reaperArmed) return;
  reaperArmed = true;
  process.on("exit", () => closeHostBrowser());
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      closeHostBrowser();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
  process.on("uncaughtException", (err) => {
    closeHostBrowser();
    console.error(err);
    process.exit(1);
  });
}

/**
 * Delete abandoned `C:\Temp\bdb-*` profile directories — the ones no live
 * browser is using.
 *
 * DIRECTORIES ONLY, NEVER PROCESSES. A concurrent run holds its own slot dir
 * and this file's whole teardown design rests on "a run can only ever kill its
 * own slot's browsers" (see `userDataDirName`). A reaper that killed by name
 * would break exactly the parallel harnesses the slot broker exists to enable,
 * so live dirs are read off the process list and skipped.
 *
 * Failure is silent by design: this is housekeeping, and no probe should fail
 * because a leftover directory was locked.
 */
export function reapStaleProfiles({ log = () => {} } = {}) {
  try {
    const out = psRun(
      `$live = @(${BROWSERS} | ForEach-Object {
         if ($_.CommandLine -match '--user-data-dir=\\"?([^\\" ]+)') { Split-Path $matches[1] -Leaf }
       } | Sort-Object -Unique)
       $gone = Get-ChildItem 'C:\\Temp' -Directory -Filter 'bdb-*' -ErrorAction SilentlyContinue |
               Where-Object { $live -notcontains $_.Name }
       $gone | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
       $gone.Count`,
      { timeout: 60_000 },
    ).trim();
    const n = Number(out);
    if (n > 0) log(`▶ reaped ${n} abandoned browser profile dir(s) from C:\\Temp`);
  } catch {
    /* housekeeping only — never fail a run over it */
  }
}

/**
 * WSL2 + host browser: Windows forwards its own localhost into WSL, but it
 * cannot reach the WSL subnet IP (the default firewall drops it). Rewrite a
 * WSL-local address to `localhost`, which is the path Windows actually routes.
 */
export function rewriteForHostBrowser(url, log = console.log) {
  const u = new URL(url, "http://localhost");
  if (u.hostname !== "localhost" && /^(127\.|0\.0\.0\.0|10\.|100\.|172\.|192\.168\.)/.test(u.hostname)) {
    u.hostname = "localhost";
    log(`▶ rewrote host → localhost for the host browser (WSL2 port forwarding)`);
    return u.toString();
  }
  return url;
}
