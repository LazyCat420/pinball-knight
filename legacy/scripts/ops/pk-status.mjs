#!/usr/bin/env node
/**
 * pk-status.mjs — what this box is handing out right now.
 *
 *   scripts/ops/pk-run.sh --status [--json] [--fast]
 *
 * Every number here is read back off the KERNEL, not off a registry:
 *   - a thread/core/GPU lock is "held" iff `flock -n` on it fails, so a run
 *     that was killed -9 frees its grant with no cleanup pass and no lie;
 *   - the class/pid/cwd label is only ever read off a lock that is held, so a
 *     stale label is unreachable by construction;
 *   - the process rollup at the bottom comes from /proc, not from the locks —
 *     it is there precisely to show work that is NOT metered. A row in the
 *     rollup with no matching row in the table above it is somebody running
 *     `vitest` bare, which is what the meter exists to stop.
 *
 * --fast skips the two host round-trips (nvidia-smi, Windows Chrome).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const JSON_MODE = process.argv.includes("--json");
const FAST = process.argv.includes("--fast");
const LOCKDIR = process.env.BDB_SLOT_LOCKDIR ?? join(homedir(), ".cache", "bdb-cpu-slots");

// ── topology (scripts/lib/topology.sh is the only writer of this cache) ─────
let PHYS = 0, LOGICAL = 0;
try {
  const t = readFileSync(join(LOCKDIR, "topology"), "utf8");
  PHYS = Number(/^PHYS=(\d+)/m.exec(t)?.[1]);
  LOGICAL = Number(/^LOGICAL=(\d+)/m.exec(t)?.[1]);
} catch { /* cold cache — fall back to the guest's own view */ }
if (!PHYS || !LOGICAL) {
  LOGICAL = Number(execFileSync("nproc").toString().trim()) || 1;
  PHYS = Math.max(1, LOGICAL >> 1);
}
const SMT = Math.max(1, Math.floor(LOGICAL / PHYS));
const RESERVE = Number(process.env.BDB_SLOT_RESERVE ?? 2);
const POOL = PHYS - RESERVE;                 // allocatable physical cores
const BUDGET = POOL * SMT;                   // allocatable threads
const GPU_CAP = Number(process.env.PK_GPU_CONTEXTS ?? Math.max(1, POOL - 1));

// ── one shell round-trip for the whole lock table ───────────────────────────
// `flock -n <file> -c true` opens O_RDONLY|O_CREAT — it does NOT truncate, so
// probing cannot damage a live holder's label.
function probe(names) {
  if (!names.length) return [];
  const script = names
    .map((n) => `f="${LOCKDIR}/${n}"; if [ -e "$f" ] && ! flock -n "$f" -c true 2>/dev/null; then printf 'HELD %s %s\\n' "${n}" "$(head -c 400 "$f" | head -1)"; fi`)
    .join("\n");
  const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
  return out.split("\n").filter(Boolean).map((line) => {
    const [, name, ...rest] = line.split(" ");
    const [, cls = "?", pid = "?", cwd = "?", label = ""] = rest.join(" ").split("|");
    return { name, cls, pid, cwd, label };
  });
}

const pad2 = (i) => String(i).padStart(2, "0");
const threads = probe([...Array(BUDGET).keys()].map((i) => `thread-${pad2(i)}.lock`));
const slots = probe([...Array(POOL).keys()].map((i) => `slot-${pad2(i)}.lock`));
const gpus = probe([...Array(GPU_CAP).keys()].map((i) => `gpu-${pad2(i)}.lock`));

// ── rows: one per metered RUN, grouped by the pid that holds the locks ──────
const rows = new Map();
const rowFor = (h) => {
  const key = h.pid;
  if (!rows.has(key)) rows.set(key, { cls: h.cls, pid: h.pid, cwd: h.cwd, label: h.label, threads: 0, cores: 0, gpu: 0 });
  return rows.get(key);
};
for (const h of threads) rowFor(h).threads++;
for (const h of slots) { const r = rowFor(h); r.cores++; if (r.cls === "?" || r.cls === "cores") r.cls = h.cls; }
for (const h of gpus) rowFor(h).gpu++;

// ── the unmetered side: what is actually running out of this repo family ────
// Scoped to braindeadbot-client checkouts (primary + .claude/worktrees), which
// is the same scope the locks cover; another repo's dev server is not ours to
// count. A run visible here but absent from the table above is unmetered.
const meteredPids = new Set([...rows.keys()]);
const OURS = /braindeadbot-client|lazycat-jungle-room/;
const INTERESTING = /node|next|vitest|playwright|chrome|esbuild|tsc/;

const label = (cmd) => {
  if (/vitest[/\\][^ ]*worker/.test(cmd)) return "vitest/dist/workers";
  if (/vitest/.test(cmd)) return "vitest";
  if (/next-server/.test(cmd)) return "next-server";
  if (/\bnext\b.*\b(dev|start)\b/.test(cmd)) return "next dev";
  const script = /(?:scripts|tools)\/(\S+\.(?:mjs|js|ts))/.exec(cmd);
  if (script) return script[1].split("/").pop();
  if (/\besbuild\b/.test(cmd)) return "esbuild";
  if (/\bnode\b/.test(cmd)) return "node";
  return null;
};

// pid → ppid, so a vitest worker can be charged to the metered run that
// spawned it. Without the walk every worker reads as unmetered and the
// UNMETERED line — the one that is supposed to mean "somebody bypassed the
// meter" — would be permanently lit during a perfectly well-behaved run.
const ppid = new Map();
const procs = [];
for (const pid of readdirSync("/proc")) {
  if (!/^\d+$/.test(pid)) continue;
  let cmd = "", parent = "0";
  try {
    cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
    // /proc/PID/stat: comm is parenthesised and may contain spaces, so split
    // after the LAST ')' — field 4 from there is ppid.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    parent = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1];
  } catch { continue; }
  ppid.set(pid, parent);
  if (!cmd || !INTERESTING.test(cmd)) continue;
  let cwd = "";
  try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* not ours to read */ }
  procs.push({ pid, cmd, cwd });
}
const meteredAncestor = (pid) => {
  for (let p = pid, hops = 0; p && p !== "0" && hops < 64; p = ppid.get(p), hops++) {
    if (meteredPids.has(p)) return true;
  }
  return false;
};

const rollup = new Map();
const unmetered = [];
for (const { pid, cmd, cwd } of procs) {
  if (!OURS.test(cwd) && !OURS.test(cmd)) continue;
  const l = label(cmd);
  if (!l) continue;
  rollup.set(l, (rollup.get(l) ?? 0) + 1);
  if (!meteredAncestor(pid)) unmetered.push({ pid, label: l });
}

// ── host round-trips ────────────────────────────────────────────────────────
// The GPU's NAME is hardware and never changes, so it is cached beside the
// topology — that is what lets --fast still name the card it is talking about.
const GPU_NAME_CACHE = join(LOCKDIR, "gpu-name");
let gpuName = "GPU";
try { gpuName = readFileSync(GPU_NAME_CACHE, "utf8").trim() || gpuName; } catch { /* cold */ }
let winChrome = null;
if (!FAST) {
  try {
    gpuName = execFileSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { encoding: "utf8", timeout: 8000 })
      .split("\n")[0].trim() || gpuName;
    writeFileSync(GPU_NAME_CACHE, gpuName + "\n");
  } catch { /* no nvidia-smi in this WSL */ }
  try {
    const n = execFileSync("powershell.exe", ["-NoProfile", "-Command", "@(Get-Process chrome -ErrorAction SilentlyContinue).Count"], { encoding: "utf8", timeout: 15000 }).trim();
    winChrome = /^\d+$/.test(n) ? Number(n) : null;
  } catch { /* host unreachable — say so rather than guess */ }
}

const held = threads.length;
const state = {
  budget: { threads: BUDGET, held, free: BUDGET - held, logical: LOGICAL, physical: PHYS, smt: SMT, reserveCores: RESERVE },
  cores: { pinned: slots.length, pool: POOL },
  gpu: { held: gpus.length, cap: GPU_CAP, name: gpuName },
  runs: [...rows.values()],
  rollup: [...rollup.entries()].map(([label, count]) => ({ label, count })),
  unmetered,
};
if (JSON_MODE) {
  console.log(JSON.stringify(state, null, 2));
  process.exit(0);
}

// ── the report ──────────────────────────────────────────────────────────────
const heldBackThreads = RESERVE * SMT;
const firstPinnable = 0;
const lastPinnable = POOL * SMT - 1;
console.log(
  `${held} thread(s) metered, ${BUDGET - held} free right now  ` +
  `(budget ${BUDGET} of ${LOGICAL} threads, ${heldBackThreads} held back for the humans)`,
);
console.log(
  `CORES    ${slots.length}/${POOL} core-slot(s) pinned  (${PHYS} physical / ${LOGICAL} logical, SMT ${SMT}; CPUs ${firstPinnable}..${lastPinnable} are pinnable,\n` +
  `         ${RESERVE} core(s) held back). A pinned browser owns its CPUs; nothing else metered\n` +
  `         can be given them. PK_CPUS=<n>|all picks the width.`,
);
console.log(`GPU      ${gpus.length}/${GPU_CAP} contexts held on ${gpuName} (WSL browsers cost ${SMT} thread(s) per core-slot)`);
if (FAST) {
  console.log(`WebGPU   (--fast: host not asked)`);
} else if (winChrome === null) {
  console.log(`WebGPU   Windows host unreachable from here — treat any webgpu number as unattributed.`);
} else if (winChrome === 0) {
  console.log(`WebGPU   No Windows Chrome. A webgpu run will launch one, PINNED to a core-slot above.`);
} else {
  console.log(
    `WebGPU   Windows Chrome present (${winChrome} process(es)). Its CPU cost is no longer off-book: a webgpu\n` +
    `         run is PINNED to a core-slot above and charged that width in threads,\n` +
    `         so what Windows takes is what this side is not handed. Still true\n` +
    `         that the process is not in /proc or loadavg, and that it outlives\n` +
    `         its run (detached) and can hold VRAM after exit.`,
  );
}
console.log("");
console.log(`CLASS    THREADS PID     WHERE`);
const shorten = (p) => (p.length > 58 ? "…" + p.slice(-57) : p);
for (const r of [...rows.values()].sort((a, b) => b.threads - a.threads || Number(a.pid) - Number(b.pid))) {
  const cores = r.cores ? `  [${r.cores} core-slot(s)]` : "";
  const gpu = r.gpu ? "  [gpu]" : "";
  console.log(
    `${r.cls.padEnd(8)} ${String(r.threads).padEnd(7)} ${String(r.pid).padEnd(7)} ${shorten(r.cwd)}${cores}${gpu}`,
  );
}
if (!rows.size) console.log("(nothing metered — the box is idle as far as this meter can tell)");
for (const { label, count } of state.rollup.sort((a, b) => b.count - a.count)) {
  console.log(`${label.padEnd(28)} ${count} process(es)`);
}
if (unmetered.length) {
  const labels = [...new Set(unmetered.map((u) => u.label))].join(", ");
  console.log(`\nUNMETERED  ${unmetered.length} process(es) out of this repo hold no grant (${labels}).`);
  console.log(`           Started outside pk-run.sh — their load is real but nobody budgeted for it.`);
}
