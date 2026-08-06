#!/usr/bin/env bash
# with-cores.sh — give a browser perf run its own physical CPU cores.
#
#   scripts/with-cores.sh [CPUS=n|CPUS=all] [--wsl] [--timeout SECS] -- <cmd...>
#
# TWO MODES, and the difference is not cosmetic:
#   (default)  a WINDOWS browser run. The mask is applied by the Windows
#              scheduler to a real process → genuine host-core ISOLATION.
#   --wsl      a guest-side job (vitest, builds). taskset + BDB_JOBS bound how
#              MUCH of the box it draws, but NOT which part — see the measured
#              numbers at the --wsl branch below. Use it to stop a suite
#              lagging the machine, never to make two guest runs comparable.
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
# shellcheck source=lib/topology.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/topology.sh"

# ── args ────────────────────────────────────────────────────────────────────
ASK=1 TIMEOUT=300 MODE=win
while [ $# -gt 0 ]; do
  case "$1" in
    CPUS=all) ASK=all; shift ;;
    CPUS=*)   ASK="${1#CPUS=}"; shift ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --wsl)    MODE=wsl; shift ;;
    --) shift; break ;;
    *) echo "with-cores.sh: unknown arg '$1'" >&2; exit 64 ;;
  esac
done
[ $# -gt 0 ] || { echo "usage: with-cores.sh [CPUS=n|all] [--wsl] [--timeout s] -- cmd..." >&2; exit 64; }

# ── topology: PHYS / LOGICAL / SMT / COREFIRST / L3GROUPS, answered by
#    WINDOWS and cached. scripts/lib/topology.sh is the only writer of that
#    cache — the thread meter (scripts/ops/pk-run.sh) reads the same numbers
#    from it, so the two brokers cannot disagree about the size of the box.
topo_load "$LOCKDIR" || exit 1

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
    exec {fd}<>"$LOCKDIR/slot-$s.lock"   # <> : probing must not truncate a live holder's label
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
    # <> not > : `>` truncates AT OPEN, so probing a slot another run holds
    # would erase the label it wrote for `pk-run.sh --status`.
    eval "exec $fd<>'$(slot_lock $((first + i)))'"
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

# ── label the won slots so `scripts/ops/pk-run.sh --status` can say WHO holds
#    them. The label is written THROUGH the held fd, so it is only ever read
#    off a lock the kernel says is still held — a stale label is unreachable
#    by construction, and an unlabelled lock (an older copy of this script in
#    another worktree) simply reads as "unlabelled", never as free.
for ((i = 0; i < ASK; i++)); do
  truncate -s 0 "$(slot_lock $((FIRST + i)))" 2>/dev/null || true
  eval "printf 'v1|%s|%s|%s|%s\n' \"\${PK_CLASS:-cores}\" \"\$\$\" \"\$PWD\" \"\$(basename -- \"\$1\")\" >&$((200 + FIRST + i))" || true
done

# ── the token IS the answer: mask, port, and profile dir all derive from
#    FIRST. fds 200+FIRST.. are inherited through exec; the kernel releases
#    the flocks however this process tree dies. ─────────────────────────────
mask=0
for ((i = 0; i < ASK; i++)); do
  for ((t = 0; t < SMT; t++)); do mask=$(( mask | (1 << (SMT * (FIRST + i) + t)) )); done
done
cpulist=""
for ((i = 0; i < ASK; i++)); do
  for ((t = 0; t < SMT; t++)); do cpulist+="${cpulist:+,}$(( SMT * (FIRST + i) + t ))"; done
done
export BDB_SLOT_FIRST=$FIRST
export BDB_SLOT_COUNT=$ASK
export BDB_CDP_PORT=$(( 9400 + FIRST ))
export BDB_WIN_AFFINITY_HEX=$(printf '%X' "$mask")
export BDB_SLOT_DIR="$(printf 'bdb-slot-%02d' "$FIRST")"
export BDB_SLOT_CPULIST="$cpulist"
# Physical cores granted. Test runners size their worker pool from this — a
# process confined by taskset still sees all 24 logical CPUs via nproc and
# would otherwise spawn 24 workers to timeshare the few it may use.
export BDB_JOBS=$ASK
ccd_clean "$FIRST" "$ASK" && ccd_note="" || ccd_note="  [STRADDLES an L3 boundary — do not A/B against another slot]"

if [ "$MODE" = wsl ]; then
  # WSL-side work: bound CONSUMPTION, do not claim isolation.
  #
  # MEASURED on this box, do not re-litigate: pinning a guest process to
  # vCPUs 20-23 put only 13% of its load on host CPUs 20-23 — an UNPINNED
  # control put 15% there, and an even smear across 24 predicts 17%. The
  # Hyper-V root scheduler floats guest vCPU threads across every host core,
  # so `taskset` in here buys ZERO host-core isolation. Fencing the VM itself
  # is not available either: vmwp/vmmemWSL affinity reads 0x0 and writes are
  # denied (protected process).
  #
  # What it DOES buy, also measured: 8 spinners confined to 4 vCPUs drew ~4.4
  # host CPUs where unconfined they drew ~7.5. The cap is honoured almost
  # exactly, which is what keeps a test suite from making the desktop lag.
  #
  # Taking real slot locks matters even without isolation: it makes WSL work
  # and browser runs contend for ONE budget, so the box cannot be sold twice.
  echo "with-cores.sh: [wsl] slots $FIRST..$((FIRST + ASK - 1)) of pool 0..$((POOL - 1)) (${PHYS} cores, ${RESERVE} reserved)  cpus $cpulist  jobs $BDB_JOBS" >&2
  echo "with-cores.sh: [wsl] bounds CONSUMPTION only — guest pinning gives NO host-core isolation, so this run can still land on a pinned browser's cores." >&2
  exec taskset -c "$cpulist" "$@"
fi

echo "with-cores.sh: slots $FIRST..$((FIRST + ASK - 1)) of pool 0..$((POOL - 1)) (${PHYS} cores, ${RESERVE} reserved for the desktop)  port $BDB_CDP_PORT  affinity 0x$BDB_WIN_AFFINITY_HEX  dir $BDB_SLOT_DIR${ccd_note}" >&2
exec "$@"
