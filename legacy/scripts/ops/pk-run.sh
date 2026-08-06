#!/usr/bin/env bash
# pk-run.sh — meter every Pinball Knight run against ONE box budget.
#
#   scripts/ops/pk-run.sh --status [--json] [--fast]
#   scripts/ops/pk-run.sh --class test    [--threads n]      -- vitest run …
#   scripts/ops/pk-run.sh --class webgpu  [--cpus n|all]     -- node scripts/playtest.mjs …
#   scripts/ops/pk-run.sh --class perf    [--cpus n|all]     -- node <guest-side bench> …
#   scripts/ops/pk-run.sh --class dev|tool                   -- next dev …
#
# THE RULE THIS ENFORCES: a unit-test or perf run never gets the whole box.
# BDB_SLOT_RESERVE physical cores (default 2 → 4 threads) are held back for the
# humans, always, and everything metered shares what is left. An unmetered
# `vitest run` sizes its pool from nproc, takes all 24 logical CPUs, and makes
# the desktop — and every concurrent session's measurement — worse.
#
# TWO POOLS, ONE BUDGET. Both are flock pools under ~/.cache/bdb-cpu-slots/,
# so every worktree's copy of this script contends on the same files:
#   threads/   one lock per allocatable THREAD. This is the budget. Everything
#              metered takes threads, including a pinned browser.
#   slots/     one lock per PHYSICAL core (owned by scripts/with-cores.sh).
#              Taking a core-slot means OWNING those CPUs — a pinned browser's
#              cores cannot be handed to anything else metered.
# A pinned class takes W core-slots AND is charged W×SMT threads, so what the
# Windows side takes is exactly what this side is not handed. Locks are always
# taken threads-first, then slots — one global order, so two runs cannot
# deadlock holding half of each other's grant.
#
# LIVENESS IS THE KERNEL'S. A lock held through an open fd is released however
# the process dies; there are no pid files and no stale-lock sweep. The class /
# pid / cwd label is written THROUGH the held fd, so --status can only ever
# read a label off a lock that is still held.
#
# ELASTIC vs EXACT, and the difference is not cosmetic:
#   test / dev / tool   ELASTIC. Fewer threads makes the suite slower, not
#                       wrong, so a busy box shrinks the grant (floor
#                       PK_MIN_THREADS, default 2) instead of failing a deploy
#                       gate. The grant is echoed on stderr — a run that took
#                       2 workers is not a timing datapoint.
#   perf / webgpu       EXACT, via with-cores.sh: a perf run that quietly got
#                       one core instead of four measured a different thing.
#                       Exit 75 rather than run narrower.
#
# ENV: PK_CPUS=<n>|all (core width for perf/webgpu) · PK_TEST_THREADS (the test
#      grant; default is HALF the budget) · PK_CLASS · PK_MIN_THREADS ·
#      PK_GPU_CONTEXTS · BDB_SLOT_RESERVE
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib/topology.sh
. "$SCRIPTS_DIR/lib/topology.sh"

LOCKDIR="${BDB_SLOT_LOCKDIR:-$HOME/.cache/bdb-cpu-slots}"
mkdir -p "$LOCKDIR"

# ── args ────────────────────────────────────────────────────────────────────
CLASS="${PK_CLASS:-tool}" THREADS="" CPUS="${PK_CPUS:-}" TIMEOUT=300 LABEL="" MODE=run
STATUS_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --status)  MODE=status; shift ;;
    --json|--fast) STATUS_ARGS+=("$1"); shift ;;
    --class)   CLASS="$2"; shift 2 ;;
    --threads) THREADS="$2"; shift 2 ;;
    --cpus)    CPUS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --label)   LABEL="$2"; shift 2 ;;
    --) shift; break ;;
    -h|--help) sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "pk-run.sh: unknown arg '$1'" >&2; exit 64 ;;
  esac
done

if [ "$MODE" = status ]; then
  exec node "$SCRIPTS_DIR/ops/pk-status.mjs" ${STATUS_ARGS[@]+"${STATUS_ARGS[@]}"}
fi
[ ${#STATUS_ARGS[@]} -eq 0 ] || { echo "pk-run.sh: ${STATUS_ARGS[*]} only means something with --status" >&2; exit 64; }
[ $# -gt 0 ] || { echo "usage: pk-run.sh [--class c] [--threads n] [--cpus n] -- cmd…   (--status for the report)" >&2; exit 64; }

topo_load "$LOCKDIR" || exit 1
RESERVE="${BDB_SLOT_RESERVE:-2}"
[[ "$RESERVE" =~ ^[0-9]+$ ]] && (( RESERVE >= 0 && RESERVE < PHYS )) \
  || { echo "pk-run.sh: BDB_SLOT_RESERVE=$RESERVE out of range 0..$((PHYS-1))" >&2; exit 64; }
POOL=$(( PHYS - RESERVE ))          # allocatable physical cores
BUDGET=$(( POOL * SMT ))            # allocatable threads — the budget

# ── class defaults ──────────────────────────────────────────────────────────
# PIN=""    threads only (dev servers, unit tests, one-shot tools)
# PIN=wsl   guest-side timing run: taskset + exact grant, via with-cores.sh
# PIN=win   host-Chrome run: Windows affinity + exact grant, and a GPU context
PIN="" ELASTIC=1 GPU=0
case "$CLASS" in
  dev)    : "${THREADS:=1}" ;;
  tool)   : "${THREADS:=1}" ;;
  # HALF the budget, not a magic constant: it scales with the box, it leaves
  # room for a second suite (or a perf run) to start without either being
  # blocked, and the elastic floor covers the case where it doesn't.
  test)   : "${THREADS:=${PK_TEST_THREADS:-$(( BUDGET / 2 > 1 ? BUDGET / 2 : 2 ))}}" ;;
  perf)   PIN=wsl ELASTIC=0; : "${CPUS:=4}" ;;
  webgpu) PIN=win ELASTIC=0 GPU=1; : "${CPUS:=2}" ;;
  *) echo "pk-run.sh: unknown class '$CLASS' (dev|tool|test|perf|webgpu)" >&2; exit 64 ;;
esac

if [ -n "$PIN" ]; then
  # The core width is the ask; the thread charge follows from it. Charging the
  # SMT siblings too is the honest number: a pinned run owns whole cores, so
  # its siblings are not available to anyone else either.
  [ "$CPUS" = all ] && CPUS=$POOL
  [[ "$CPUS" =~ ^[0-9]+$ ]] && (( CPUS >= 1 && CPUS <= POOL )) \
    || { echo "pk-run.sh: --cpus $CPUS out of range 1..$POOL (${PHYS} cores minus ${RESERVE} reserved)" >&2; exit 64; }
  THREADS=$(( CPUS * SMT ))
fi
[[ "$THREADS" =~ ^[0-9]+$ ]] && (( THREADS >= 1 )) || { echo "pk-run.sh: --threads must be a positive integer" >&2; exit 64; }
if (( THREADS > BUDGET )); then
  (( ELASTIC )) || { echo "pk-run.sh: asked $THREADS threads, budget is $BUDGET (${PHYS}×${SMT} minus ${RESERVE} cores held back)" >&2; exit 64; }
  THREADS=$BUDGET
fi
MIN=${PK_MIN_THREADS:-2}
(( MIN > THREADS )) && MIN=$THREADS
(( ELASTIC )) || MIN=$THREADS

[ -n "$LABEL" ] || LABEL="$(basename -- "$1")"
META="v1|$CLASS|$$|$PWD|$LABEL"

# ── thread pool ─────────────────────────────────────────────────────────────
# fd 300+i holds thread i. Numeric fds (not {var}>) because the whole point is
# that they survive the final exec into the real command; the kernel then holds
# the grant for exactly as long as that command lives. Locks open <> and never
# > : `>` truncates AT OPEN, so merely probing a busy lock would erase the
# label of the run that holds it. GOT is set in place, never through a command
# substitution — a subshell's fds die with the subshell and the grant with them.
GOT=()
grab_threads() {  # best effort, no waiting; leaves what it won held in GOT
  local i fd
  GOT=()
  for ((i = 0; i < BUDGET && ${#GOT[@]} < THREADS; i++)); do
    fd=$((300 + i))
    eval "exec $fd<>'$LOCKDIR/thread-$(printf '%02d' "$i").lock'"
    if flock -n "$fd"; then GOT+=("$i"); else eval "exec $fd>&-"; fi
  done
}
drop_threads() {
  local i
  for i in ${GOT[@]+"${GOT[@]}"}; do eval "exec $((300 + i))>&-"; done
  GOT=()
}

deadline=$(( SECONDS + TIMEOUT ))
while :; do
  grab_threads
  (( ${#GOT[@]} >= MIN )) && break
  drop_threads
  (( SECONDS < deadline )) || {
    echo "pk-run.sh: could not get $MIN thread(s) of the $BUDGET-thread budget in ${TIMEOUT}s — the box is full, nothing was started" >&2
    exit 75
  }
  sleep 0.5
done
got=${#GOT[@]}
for i in "${GOT[@]}"; do
  truncate -s 0 "$LOCKDIR/thread-$(printf '%02d' "$i").lock" 2>/dev/null || true
  eval "printf '%s\n' \"\$META\" >&$((300 + i))"
done

# ── GPU contexts ────────────────────────────────────────────────────────────
# The GPU is NOT partitionable — this cap does not isolate anything, it only
# stops absurd fan-out from thrashing VRAM. Threads remain the binding
# constraint, which is why the cap sits just under the core-slot pool.
GPU_CAP=${PK_GPU_CONTEXTS:-$(( POOL > 1 ? POOL - 1 : 1 ))}
if (( GPU )); then
  gpu_got=0
  for ((i = 0; i < GPU_CAP; i++)); do
    fd=$((400 + i))
    eval "exec $fd<>'$LOCKDIR/gpu-$(printf '%02d' "$i").lock'"
    if flock -n "$fd"; then
      truncate -s 0 "$LOCKDIR/gpu-$(printf '%02d' "$i").lock" 2>/dev/null || true
      eval "printf '%s\n' \"\$META\" >&$fd"
      gpu_got=1; break
    fi
    eval "exec $fd>&-"
  done
  (( gpu_got )) || { echo "pk-run.sh: all $GPU_CAP GPU contexts are held — refusing to add another browser to the GPU" >&2; exit 75; }
fi

# ── grant → env. BDB_JOBS is what vitest.config.js sizes its worker pool from:
#    a process confined to part of the box still sees all $LOGICAL CPUs via
#    nproc and would otherwise spawn that many workers to timeshare the few
#    threads it was actually given. ────────────────────────────────────────
export PK_CLASS="$CLASS" PK_THREADS_GRANTED="$got" PK_BUDGET="$BUDGET"
export BDB_JOBS="$got"

# vitest takes --maxWorkers on the CLI, and a CLI flag beats the config file —
# the deploy gate passes --maxWorkers=$(nproc), which is precisely the thing
# this script exists to stop. Clamp it to the grant rather than dropping it, so
# a caller asking for FEWER than the grant still gets what it asked for.
args=()
for a in "$@"; do
  case "$a" in
    --maxWorkers=*)
      n="${a#--maxWorkers=}"
      if [[ "$n" =~ ^[0-9]+$ ]] && (( n > got )); then
        echo "pk-run.sh: clamped --maxWorkers=$n to the $got-thread grant" >&2
        a="--maxWorkers=$got"
      fi ;;
  esac
  args+=("$a")
done
set -- "${args[@]}"

free_now=$(( BUDGET - got ))
if [ -n "$PIN" ]; then
  echo "pk-run.sh: [$CLASS] $got thread(s) of $BUDGET (${free_now} left for everyone else) → handing to with-cores.sh for $CPUS pinned core-slot(s)" >&2
  [ "$PIN" = wsl ] && exec "$SCRIPTS_DIR/with-cores.sh" "CPUS=$CPUS" --wsl --timeout "$TIMEOUT" -- "$@"
  exec "$SCRIPTS_DIR/with-cores.sh" "CPUS=$CPUS" --timeout "$TIMEOUT" -- "$@"
fi

if (( got < THREADS )); then
  echo "pk-run.sh: [$CLASS] $got thread(s) of $BUDGET — SHRUNK from $THREADS, the box was busy. Slower, not wrong; do not quote this run as a timing." >&2
else
  echo "pk-run.sh: [$CLASS] $got thread(s) of $BUDGET (${free_now} left for everyone else)" >&2
fi
exec "$@"
