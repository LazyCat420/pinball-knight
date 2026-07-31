#!/usr/bin/env bash
# with-cores.sh — give a browser perf run its own physical CPU cores.
#
#   scripts/with-cores.sh [CPUS=n|CPUS=all] [--timeout SECS] -- <command...>
#
# One flock lock pool at ~/.cache/bdb-cpu-slots/ (machine-global: every
# worktree's copy of this script contends on the same files), one lock per
# PHYSICAL core. The index of the contiguous window a run wins determines
# everything downstream — the Windows affinity mask, the CDP port, the
# Chrome profile dir — so cores and port can never disagree. Liveness is
# the kernel's: a lock held through an open fd is released however the
# process tree dies. There are no pid files and no stale-lock cleanup.
#
# The grant is NOT elastic. A perf run that quietly got one core instead of
# four measured a different thing; we wait for the exact ask or exit 75.
#
# RESERVED HEADROOM: BDB_SLOT_RESERVE (default 2) physical cores are never
# allocatable, so the desktop/IDE always has somewhere to run and a CPUS=all
# run cannot freeze the box. CPUS=all takes the whole POOL (PHYS - RESERVE),
# which still means nothing else can start — exclusivity without the lockup.
#
# Exports to the command: BDB_SLOT_FIRST, BDB_SLOT_COUNT, BDB_CDP_PORT,
# BDB_WIN_AFFINITY_HEX, BDB_SLOT_DIR. scripts/lib/host-chrome.mjs consumes
# these to launch host Chrome pinned (cmd.exe start /affinity — the browser
# is a WINDOWS process; taskset from WSL would pin the interop stub).
#
# HONEST LIMITS — pinning narrows variance, it does not remove bias:
#   - Boost clocks drop for everyone when several instances are live, so
#     concurrent numbers are not comparable to solo baselines. Interleave a
#     control arm beside each treatment WITHIN the same run.
#   - Only the Windows Chrome tree is pinned. WSL-side work (this harness,
#     dev servers, vitest) runs on guest vCPUs the hypervisor may place on
#     host cores a pinned Chrome owns.
#   - Shared GPU and shared last-level cache are not partitioned. The L3
#     groups are detected at runtime (L3GROUPS in the topology cache); on a
#     5900X they are cores 0..5 and 6..11, i.e. slots on opposite sides are
#     NOT equal hardware — keep an A/B inside ONE slot window.
set -euo pipefail

LOCKDIR="${BDB_SLOT_LOCKDIR:-$HOME/.cache/bdb-cpu-slots}"
mkdir -p "$LOCKDIR"

# ── args ────────────────────────────────────────────────────────────────────
ASK=1 TIMEOUT=300
while [ $# -gt 0 ]; do
  case "$1" in
    CPUS=all) ASK=all; shift ;;
    CPUS=*)   ASK="${1#CPUS=}"; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "with-cores.sh: unknown arg '$1'" >&2; exit 64 ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: with-cores.sh [CPUS=n|all] [--timeout s] -- cmd..." >&2; exit 64; }

# ── topology, from WINDOWS (the scheduler that applies the mask; nproc in
#    WSL answers for the VM, which can be capped independently) ─────────────
TOPO="$LOCKDIR/topology"
read_topo() {
  [ -f "$TOPO" ] || return 1
  # shellcheck disable=SC1090
  . "$TOPO" 2>/dev/null || return 1
  [[ "${PHYS:-}" =~ ^[0-9]+$ && "${LOGICAL:-}" =~ ^[0-9]+$ && "$PHYS" -ge 1 && "$LOGICAL" -ge "$PHYS" \
     && -n "${L3GROUPS:-}" && -n "${COREFIRST:-}" ]]
}
if ! read_topo; then
  # GetLogicalProcessorInformationEx is the only source that gives BOTH the
  # SMT sibling sets and the last-level-cache groups. WMI's Win32_Processor
  # gives counts but no cache topology, and /sys inside WSL is a different
  # machine's answer — the hypervisor flattens a 5900X's two 32MiB L3 domains
  # into one "32MiB across 0-23", which would make every window look
  # cache-clean when half of them straddle a CCD.
  ps_src=$(cat <<'PSEOF'
$ProgressPreference='SilentlyContinue'
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Topo {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetLogicalProcessorInformationEx(int rel, IntPtr buf, ref uint len);
}
'@
Add-Type -TypeDefinition $sig
function Get-Rel($rel) {
  $len = 0
  [Topo]::GetLogicalProcessorInformationEx($rel, [IntPtr]::Zero, [ref]$len) | Out-Null
  $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$len)
  $res = @()
  if ([Topo]::GetLogicalProcessorInformationEx($rel, $buf, [ref]$len)) {
    $off = 0
    while ($off -lt $len) {
      $r    = [Runtime.InteropServices.Marshal]::ReadInt32($buf, $off)
      $size = [Runtime.InteropServices.Marshal]::ReadInt32($buf, $off + 4)
      if ($size -le 0) { break }
      # PROCESSOR_RELATIONSHIP puts GROUP_AFFINITY at +24; CACHE_RELATIONSHIP
      # at +32 (it carries level/assoc/lineSize/size/type first). Both sit
      # after the 8-byte {Relationship,Size} header.
      if ($r -eq 0 -and $rel -eq 0) {
        $res += [Runtime.InteropServices.Marshal]::ReadInt64($buf, $off + 8 + 24)
      } elseif ($r -eq 2 -and $rel -eq 2) {
        $lvl = [Runtime.InteropServices.Marshal]::ReadByte($buf, $off + 8)
        if ($lvl -eq 3) { $res += [Runtime.InteropServices.Marshal]::ReadInt64($buf, $off + 8 + 32) }
      }
      $off += $size
    }
  }
  [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
  return $res
}
$cores = @(Get-Rel 0)
$l3    = @(Get-Rel 2)
if ($cores.Count -lt 1) { Write-Output "ERR=no_cores"; exit 1 }
$all = 0L; foreach ($m in $cores) { $all = $all -bor $m }
$logical = 0; for ($i=0; $i -lt 64; $i++) { if ($all -band (1L -shl $i)) { $logical++ } }
$firsts = @()
foreach ($m in $cores) { for ($i=0; $i -lt 64; $i++) { if ($m -band (1L -shl $i)) { $firsts += $i; break } } }
$sorted = @($firsts | Sort-Object)
$groups = @()
foreach ($cm in $l3) {
  $idx = @()
  for ($c=0; $c -lt $sorted.Count; $c++) { if ($cm -band (1L -shl $sorted[$c])) { $idx += $c } }
  if ($idx.Count -gt 0) { $groups += ($idx -join "-") }
}
# Values are QUOTED: L3GROUPS contains ';', which both `eval` and `source`
# would otherwise read as a command separator.
Write-Output ("PHYS=" + $cores.Count)
Write-Output ("LOGICAL=" + $logical)
Write-Output ('COREFIRST="' + ($sorted -join ",") + '"')
Write-Output ('L3GROUPS="' + ($groups -join ";") + '"')
PSEOF
)
  enc="$(printf '%s' "$ps_src" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)"
  out="$(powershell.exe -NoProfile -EncodedCommand "$enc" 2>/dev/null | tr -d '\r' | grep -E "^(PHYS|LOGICAL|COREFIRST|L3GROUPS)=")" || true
  eval "$out"
  [[ "${PHYS:-}" =~ ^[0-9]+$ && "${LOGICAL:-}" =~ ^[0-9]+$ && -n "${L3GROUPS:-}" ]] \
    || { echo "with-cores.sh: Windows topology query failed: '$out'" >&2; exit 1; }
  printf '%s\n' "$out" > "$TOPO.tmp.$$" && mv "$TOPO.tmp.$$" "$TOPO"
fi
# Invalidate the cache by deleting $TOPO. Hardware does not change under us.
(( PHYS <= 31 )) || { echo "with-cores.sh: $PHYS cores needs a wider mask strategy (64-bit shell arithmetic)" >&2; exit 1; }
SMT=$(( LOGICAL / PHYS ))
# COREFIRST is the first logical CPU of each physical core, ascending. The mask
# builder below assumes core n owns logical SMT*n..SMT*n+SMT-1; verify that
# rather than trusting it, because a machine that numbers siblings in blocks
# (0..N-1 then N..2N-1) would silently get half-core masks.
expect=0; for f in ${COREFIRST//,/ }; do
  (( f == expect )) || { echo "with-cores.sh: unexpected CPU numbering (COREFIRST=$COREFIRST); masks would be wrong" >&2; exit 1; }
  expect=$(( expect + SMT ))
done

# ── reserved headroom: cores the pool NEVER hands out, so the desktop, the
#    IDE and this shell always have somewhere to run. Without it a CPUS=all
#    run takes every core and the box stops responding — which is the thing
#    we are trying to prevent, not a side effect we tolerate. ───────────────
RESERVE="${BDB_SLOT_RESERVE:-2}"
[[ "$RESERVE" =~ ^[0-9]+$ ]] && (( RESERVE >= 0 && RESERVE < PHYS )) \
  || { echo "with-cores.sh: BDB_SLOT_RESERVE=$RESERVE out of range 0..$((PHYS-1))" >&2; exit 64; }
POOL=$(( PHYS - RESERVE ))

# CPUS=all means the whole POOL — by construction nothing else can start, so
# the exclusive mode falls out for free without touching the reserve.
[ "$ASK" = all ] && ASK=$POOL
[[ "$ASK" =~ ^[0-9]+$ ]] && (( ASK >= 1 && ASK <= POOL )) \
  || { echo "with-cores.sh: CPUS=$ASK out of range 1..$POOL (${PHYS} cores minus ${RESERVE} reserved)" >&2; exit 64; }

slot_lock() { printf '%s/slot-%02d.lock' "$LOCKDIR" "$1"; }

# ── reaper: a chrome on a bdb-slot-NN profile whose slot lock is FREE is an
#    orphan (its owner died; the kernel released the flock). Ask the kernel,
#    never a file. One instance per slot means N immortal browsers otherwise,
#    each holding GPU memory.
#
#    Runs AFTER acquisition (see below): our own just-won slots fail the
#    flock -n probe, so the leftover browser on OUR slot survives to be
#    warm-reused (slot → mask is deterministic, so it is already pinned
#    right). Each kill happens WHILE HOLDING that slot's lock, so a
#    concurrent session can never adopt a browser mid-reap. ─────────────────
reap() {
  local slots s fd
  slots="$(powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | ForEach-Object { if ($_.Name -eq "chrome.exe" -and $_.CommandLine -match "bdb-slot-(\d+)") { $Matches[1] } } | Sort-Object -Unique' 2>/dev/null | tr -d '\r')" || return 0
  for s in $slots; do
    [[ "$s" =~ ^[0-9]+$ ]] || continue
    exec {fd}>"$LOCKDIR/slot-$s.lock"
    if flock -n "$fd"; then
      powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'chrome.exe' -and \$_.CommandLine -like '*bdb-slot-$s*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1 || true
      echo "with-cores.sh: reaped orphan browser on slot $s" >&2
      flock -u "$fd"
    fi
    exec {fd}>&-
  done
}

# ── window acquisition: fd 200+slot holds slot's lock (fixed scheme survives
#    the final exec). A partially won window is fully released — including
#    the fd whose flock failed — before trying the next. ────────────────────
try_window() {  # $1=first $2=width → 0 iff all w slots locked
  local first=$1 w=$2 i j fd
  for ((i = 0; i < w; i++)); do
    fd=$((200 + first + i))
    eval "exec $fd>'$(slot_lock $((first + i)))'"
    if ! flock -n "$fd"; then
      for ((j = 0; j <= i; j++)); do eval "exec $((200 + first + j))>&-"; done
      return 1
    fi
  done
  return 0
}

# Candidate windows, cache-clean first: a window straddling a last-level-cache
# boundary pays cross-complex latency and lands it on whichever run got
# unlucky. The groups come from the L3 masks Windows reports, so this is right
# on a 1-CCD laptop and on a 2-CCD 5900X without knowing which it is.
declare -a CCD_OF
gid=0
for g in ${L3GROUPS//;/ }; do
  for c in ${g//-/ }; do CCD_OF[$c]=$gid; done
  gid=$(( gid + 1 ))
done
ccd_clean() {  # $1=first $2=width → 0 iff the whole window shares one L3
  local f=$1 w=$2 i g0="${CCD_OF[$1]:-x}"
  for ((i = 1; i < w; i++)); do [ "${CCD_OF[$((f + i))]:-y}" = "$g0" ] || return 1; done
  return 0
}
windows=()
for ((f = 0; f + ASK <= POOL; f++)); do ccd_clean "$f" "$ASK" && windows+=("$f"); done
for ((f = 0; f + ASK <= POOL; f++)); do ccd_clean "$f" "$ASK" || windows+=("$f"); done

FIRST=-1
deadline=$(( SECONDS + TIMEOUT ))
while (( SECONDS < deadline )); do
  for f in "${windows[@]}"; do
    if try_window "$f" "$ASK"; then FIRST=$f; break 2; fi
  done
  sleep 0.5
done
(( FIRST >= 0 )) || { echo "with-cores.sh: could not acquire $ASK contiguous slot(s) in ${TIMEOUT}s — refusing to run unpinned or narrower" >&2; exit 75; }

reap

# ── the token IS the answer: mask, port, and profile dir all derive from
#    FIRST. fds 200+FIRST.. are inherited through exec; the kernel releases
#    the flocks however this process tree dies. ─────────────────────────────
mask=0
for ((i = 0; i < ASK; i++)); do
  for ((t = 0; t < SMT; t++)); do mask=$(( mask | (1 << (SMT * (FIRST + i) + t)) )); done
done
export BDB_SLOT_FIRST=$FIRST
export BDB_SLOT_COUNT=$ASK
export BDB_CDP_PORT=$(( 9400 + FIRST ))
export BDB_WIN_AFFINITY_HEX=$(printf '%X' "$mask")
export BDB_SLOT_DIR="$(printf 'bdb-slot-%02d' "$FIRST")"
ccd_clean "$FIRST" "$ASK" && ccd_note="" || ccd_note="  [STRADDLES an L3 boundary — do not A/B against another slot]"
echo "with-cores.sh: slots $FIRST..$((FIRST + ASK - 1)) of pool 0..$((POOL - 1)) (${PHYS} cores, ${RESERVE} reserved for the desktop)  port $BDB_CDP_PORT  affinity 0x$BDB_WIN_AFFINITY_HEX  dir $BDB_SLOT_DIR${ccd_note}" >&2
exec "$@"
