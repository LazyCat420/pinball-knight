#!/usr/bin/env node
/**
 * Read CPU affinity BACK off the live host browsers and report who owns what.
 *
 * Pinning claims are worthless without a read-back: `start /affinity` can
 * silently misfire, and a child spawned before a late affinity call keeps the
 * full mask forever. So this asks Windows for every chrome/edge root with a
 * --remote-debugging-port, walks its child tree, and reads ProcessorAffinity
 * off every process in it.
 *
 *   node scripts/cpu-slots-verify.mjs        human report, exit code = verdict
 *   node scripts/cpu-slots-verify.mjs --json raw rows for tooling
 *
 * FAIL (exit 1):
 *   - two PINNED browsers whose masks intersect (isolation is broken), or
 *   - any child process whose mask differs from its root's (trap: affinity
 *     applied after launch reaches the parent and misses the workers).
 * NOTE (exit 0):
 *   - an UNPINNED browser spanning all CPUs. That is the pre-existing shared
 *     browser, not a pinning failure — a check that is red whenever the
 *     legacy browser is up is a check nobody reads.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const JSON_MODE = process.argv.includes("--json");

function psRun(script, timeout = 60_000) {
  const enc = Buffer.from(`$ProgressPreference='SilentlyContinue'\n${script}`, "utf16le").toString("base64");
  return execSync(`powershell.exe -NoProfile -EncodedCommand ${enc}`, { timeout }).toString();
}

// ── topology: prefer the broker's cache; fall back to asking Windows ────────
const LOCKDIR = process.env.BDB_SLOT_LOCKDIR ?? join(homedir(), ".cache", "bdb-cpu-slots");
let PHYS, LOGICAL;
try {
  const topo = readFileSync(join(LOCKDIR, "topology"), "utf8");
  PHYS = Number(/^PHYS=(\d+)/m.exec(topo)?.[1]);
  LOGICAL = Number(/^LOGICAL=(\d+)/m.exec(topo)?.[1]);
} catch { /* cold cache */ }
if (!Number.isInteger(PHYS) || !Number.isInteger(LOGICAL) || PHYS < 1) {
  const line = psRun(
    `$cs = Get-CimInstance Win32_Processor; "{0} {1}" -f (($cs | Measure-Object NumberOfCores -Sum).Sum), (($cs | Measure-Object NumberOfLogicalProcessors -Sum).Sum)`,
  ).trim();
  [PHYS, LOGICAL] = line.split(/\s+/).map(Number);
}
const SMT = Math.floor(LOGICAL / PHYS);
const FULL_MASK = (1n << BigInt(LOGICAL)) - 1n;

// ── one round-trip: roots + child trees + affinities ────────────────────────
const raw = psRun(`
$all = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe' }
$roots = $all | Where-Object { $_.CommandLine -match '--remote-debugging-port=(\\d+)' -and $_.CommandLine -notmatch '--type=' }
$out = @()
foreach ($r in $roots) {
  $port = [regex]::Match($r.CommandLine, '--remote-debugging-port=(\\d+)').Groups[1].Value
  $udd  = [regex]::Match($r.CommandLine, '--user-data-dir=([^\\s]+)').Groups[1].Value
  $tree = @($r); $queue = @($r.ProcessId)
  while ($queue.Count -gt 0) {
    $head = $queue[0]; $queue = @($queue | Select-Object -Skip 1)
    $kids = @($all | Where-Object { $_.ParentProcessId -eq $head })
    if ($kids.Count -gt 0) { $tree += $kids; $queue += @($kids | ForEach-Object { $_.ProcessId }) }
  }
  foreach ($p in $tree) {
    try { $aff = '{0:X}' -f [int64](Get-Process -Id $p.ProcessId -ErrorAction Stop).ProcessorAffinity }
    catch { $aff = '?' }
    $out += [pscustomobject]@{ port = $port; udd = $udd; procid = $p.ProcessId; root = ($p.ProcessId -eq $r.ProcessId); aff = $aff }
  }
}
if ($out.Count -gt 0) { ConvertTo-Json @($out) -Compress } else { '[]' }
`).trim();

const rows = JSON.parse(raw || "[]");
if (JSON_MODE) {
  console.log(JSON.stringify({ PHYS, LOGICAL, SMT, rows }, null, 2));
}

// ── group by root browser ───────────────────────────────────────────────────
const browsers = new Map();
for (const r of rows) {
  const key = `${r.port}`;
  if (!browsers.has(key)) browsers.set(key, { port: r.port, udd: r.udd, rootAff: null, rootPid: null, children: [] });
  const b = browsers.get(key);
  if (r.root) { b.rootAff = r.aff; b.rootPid = r.procid; b.udd = r.udd; }
  else b.children.push(r);
}

const coresOf = (mask) => {
  const cores = [];
  for (let c = 0; c < PHYS; c++) {
    let owned = false;
    for (let t = 0; t < SMT; t++) if (mask & (1n << BigInt(SMT * c + t))) owned = true;
    if (owned) cores.push(c);
  }
  return cores;
};
// Whole-sibling-pair decomposition confirms the "core n = logical SMT*n.."
// numbering assumption the broker's masks are built on.
const wholePairs = (mask) => {
  for (let c = 0; c < PHYS; c++) {
    let set = 0;
    for (let t = 0; t < SMT; t++) if (mask & (1n << BigInt(SMT * c + t))) set++;
    if (set !== 0 && set !== SMT) return false;
  }
  return true;
};
const contiguous = (cores) => cores.every((c, i) => i === 0 || c === cores[i - 1] + 1);

let failures = 0;
const pinned = [];
console.log(`topology: ${PHYS} physical cores, SMT ${SMT}, full mask 0x${FULL_MASK.toString(16).toUpperCase()}`);
if (browsers.size === 0) console.log("no debug-port browsers are running.");

for (const b of [...browsers.values()].sort((x, y) => Number(x.port) - Number(y.port))) {
  if (b.rootAff === null) { console.log(`:${b.port}  (root not found — stale child rows?)`); continue; }
  if (b.rootAff === "?") { console.log(`:${b.port}  WARN affinity unreadable (>32 logical CPUs makes ProcessorAffinity unreliable)`); continue; }
  const mask = BigInt("0x" + b.rootAff);
  const isPinned = mask !== FULL_MASK;
  const cores = coresOf(mask);
  const badKids = b.children.filter((k) => k.aff !== b.rootAff);
  const shape = isPinned
    ? `PINNED  cores ${cores.join(",")}${contiguous(cores) ? "" : "  [NON-CONTIGUOUS]"}${wholePairs(mask) ? "" : "  [SPLITS SMT PAIRS — numbering assumption violated]"}`
    : `UNPINNED (all CPUs) — pre-existing shared browser, not a failure`;
  console.log(`:${b.port}  ${b.udd}  root ${b.rootPid}  mask 0x${b.rootAff}  ${shape}  [${b.children.length} children]`);
  for (const k of badKids) {
    console.log(`  FAIL child ${k.procid} mask 0x${k.aff} ≠ root 0x${b.rootAff} — a worker escaped the pin`);
    failures++;
  }
  if (isPinned) pinned.push({ port: b.port, mask, cores });
}

for (let i = 0; i < pinned.length; i++) {
  for (let j = i + 1; j < pinned.length; j++) {
    if (pinned[i].mask & pinned[j].mask) {
      console.log(`FAIL :${pinned[i].port} and :${pinned[j].port} overlap on cores ${pinned[i].cores.filter((c) => pinned[j].cores.includes(c)).join(",")}`);
      failures++;
    }
  }
}

console.log(failures ? `\n${failures} failure(s).` : `\nok — ${pinned.length} pinned browser(s), no overlaps, all children carry their root's mask.`);
process.exit(failures ? 1 : 0);
