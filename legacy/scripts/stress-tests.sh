#!/usr/bin/env bash
#
# Run the whole suite N times under real CPU contention, and report which tests
# fail. This is how the roulette `planSpin` flake was caught: it reddened ~2% of
# runs, would not reproduce idle across 20 consecutive clean runs, and only came
# out under load — where the extra wall-clock gave the dice more chances to be
# observed alongside the timeout-sensitive floor-pipeline tests.
#
#   bash scripts/stress-tests.sh [runs=10] [burners=14]
#
# Logs land in .stress/ (gitignored); a failing run prints the failing test
# names inline so you never lose them to a truncated pipe.
cd "$(dirname "$0")/.." || exit 1
OUT=.stress
mkdir -p "$OUT"
N=${1:-10}
# The burners are the POINT here — this harness exists to run the suite under
# contention — but they used to be a flat 14 spinners, which on a 24-thread box
# is the desktop and every concurrent session too. Half the box is enough
# contention to have caught the flake this was written for, and the suite side
# is metered below so the two together stay inside the budget.
BURNERS=${2:-$(( $(nproc) / 2 ))}
fails=0
for i in $(seq 1 "$N"); do
  pids=()
  for _ in $(seq 1 "$BURNERS"); do
    ( while :; do :; done ) & pids+=($!)
  done
  scripts/ops/pk-run.sh --class test -- npx vitest run > "$OUT/run$i.log" 2>&1
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
  wait 2>/dev/null
  line=$(grep -E '^ +Tests' "$OUT/run$i.log")
  echo "run $i: $line"
  if echo "$line" | grep -q failed; then
    fails=$((fails+1))
    echo "  >>> FAILING TESTS:"
    grep -E "^ +(FAIL|×|✕)" "$OUT/run$i.log" | head -5
    grep -E "Test timed out|AssertionError" "$OUT/run$i.log" | head -3
  fi
done
echo "TOTAL: $fails/$N runs failed"
