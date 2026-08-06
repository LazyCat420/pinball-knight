#!/usr/bin/env bash
# topology.sh — the ONE place that answers "what is this box?", and the one
# writer of the topology cache at $LOCKDIR/topology.
#
#   source scripts/lib/topology.sh
#   topo_load            # → PHYS LOGICAL SMT COREFIRST L3GROUPS, or exit 1
#
# Extracted from with-cores.sh so the CPU-slot broker and the thread meter
# (scripts/ops/pk-run.sh) read the same numbers from the same cache. Two
# copies of this probe would be two writers of one cache file, and the first
# time they disagreed — a different reserve, a stale copy in a worktree — the
# box would be sold twice with both halves looking correct.
#
# The answer comes from WINDOWS, deliberately. GetLogicalProcessorInformationEx
# is the only source giving BOTH the SMT sibling sets and the last-level-cache
# groups. WMI's Win32_Processor has counts but no cache topology, and /sys
# inside WSL answers for a different machine: the hypervisor flattens a 5900X's
# two 32 MiB L3 domains into one "32 MiB across 0-23", which would make every
# core window look cache-clean when half of them straddle a CCD.

# Cache invalidation is `rm $LOCKDIR/topology`. Hardware does not change under us.
topo_load() {
  local lockdir="${1:-${BDB_SLOT_LOCKDIR:-$HOME/.cache/bdb-cpu-slots}}"
  local topo="$lockdir/topology"
  mkdir -p "$lockdir"

  if ! _topo_read "$topo"; then
    _topo_probe_windows "$topo" || return 1
  fi

  (( PHYS <= 31 )) || { echo "topology: $PHYS cores needs a wider mask strategy (64-bit shell arithmetic)" >&2; return 1; }
  SMT=$(( LOGICAL / PHYS ))

  # COREFIRST is the first logical CPU of each physical core, ascending. Mask
  # builders assume core n owns logical SMT*n..SMT*n+SMT-1; verify that rather
  # than trusting it, because a machine that numbers siblings in blocks
  # (0..N-1 then N..2N-1) would silently get half-core masks.
  local expect=0 f
  for f in ${COREFIRST//,/ }; do
    (( f == expect )) || { echo "topology: unexpected CPU numbering (COREFIRST=$COREFIRST); masks would be wrong" >&2; return 1; }
    expect=$(( expect + SMT ))
  done
  return 0
}

_topo_read() {
  [ -f "$1" ] || return 1
  # shellcheck disable=SC1090
  . "$1" 2>/dev/null || return 1
  [[ "${PHYS:-}" =~ ^[0-9]+$ && "${LOGICAL:-}" =~ ^[0-9]+$ && "$PHYS" -ge 1 && "$LOGICAL" -ge "$PHYS" \
     && -n "${L3GROUPS:-}" && -n "${COREFIRST:-}" ]]
}

_topo_probe_windows() {
  local topo="$1" ps_src enc out
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
    || { echo "topology: Windows topology query failed: '$out'" >&2; return 1; }
  printf '%s\n' "$out" > "$topo.tmp.$$" && mv "$topo.tmp.$$" "$topo"
}
