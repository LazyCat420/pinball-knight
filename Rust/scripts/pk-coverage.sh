#!/usr/bin/env bash
# Two-signal coverage scan, re-implemented from one-to-one.md §2.3 so the number
# is reproducible at any commit:
#   a legacy file HAS a counterpart if
#     (1) a Rust module basename == its snake_cased basename, OR
#     (2) its filename or path appears anywhere inside a .rs file.
# Upper bound on coverage by construction (a mention counts).
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"
LEG=legacy/src/game/pinball-knight

# every rust module basename
find crates/*/src xtask/src -name '*.rs' -printf '%f\n' | sed 's/\.rs$//' | sort -u > /tmp/pk_rustmods.txt
# one blob of all rust source for the mention test
find crates/*/src xtask/src -name '*.rs' -exec cat {} + > /tmp/pk_rustblob.txt

declare -A dir_tot dir_cov
tot=0; cov=0; nfiles=0; ncov=0
: > /tmp/pk_uncovered.txt

while IFS= read -r f; do
  case "$f" in *.test.ts) continue;; esac
  case "$f" in $LEG/tools/*) continue;; esac
  rel="${f#$LEG/}"
  d="${rel%%/*}"
  [ "$d" = "$rel" ] && d="(root)"
  n=$(wc -l < "$f")
  base=$(basename "$f" .ts)
  snake=$(echo "$base" | tr '-' '_')
  hit=0
  grep -qx "$snake" /tmp/pk_rustmods.txt && hit=1
  if [ $hit -eq 0 ]; then
    grep -qF "$rel" /tmp/pk_rustblob.txt && hit=1
  fi
  if [ $hit -eq 0 ]; then
    grep -qF "$(basename "$f")" /tmp/pk_rustblob.txt && hit=1
  fi
  tot=$((tot+n)); nfiles=$((nfiles+1))
  dir_tot[$d]=$(( ${dir_tot[$d]:-0} + n ))
  if [ $hit -eq 1 ]; then
    cov=$((cov+n)); ncov=$((ncov+1))
    dir_cov[$d]=$(( ${dir_cov[$d]:-0} + n ))
  else
    printf '%6d  %s\n' "$n" "$rel" >> /tmp/pk_uncovered.txt
  fi
done < <(find $LEG -name '*.ts')

echo "portable lines: $tot in $nfiles files"
echo "with a counterpart: $cov ($ncov files)"
echo "NO counterpart: $((tot-cov)) ($((nfiles-ncov)) files) = $(( (tot-cov)*100/tot ))%"
echo
printf '%-12s %8s %8s %6s\n' DIR LINES COVERED PCT
for d in "${!dir_tot[@]}"; do
  t=${dir_tot[$d]}; c=${dir_cov[$d]:-0}
  printf '%-12s %8d %8d %5d%%\n' "$d" "$t" "$c" $(( c*100/t ))
done | sort -k2 -rn
echo
echo "=== 15 largest with no counterpart ==="
sort -rn /tmp/pk_uncovered.txt | head -15
