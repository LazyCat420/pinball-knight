# Intro and tavern loading correction

Worktree: `.worktrees/wt-intro-tavern-loading`, branch `fix/intro-tavern-loading`.
Base: `8c67adb0`, preserving the Six-Armed God and Crawling Hand integration.

The lobby scheduled imported art for the full monster roster. An idle callback
only delayed the start: each atlas rebuild still blocked the main thread.
Live profiling recorded 44 imports with repeated 300–600 ms stalls, and longer
outliers. The intro separately used unclamped wall-clock time and treated any
pointer-down or ordinary key as a skip.

Changes:

- Keep monster imports and optional painter backfill out of intro/tavern entry.
- Present the descent screen before loading required monster art, await each
  sheet with progress frames, then create the floor. Cancel stale continuations.
- Include the actual floor guardian and recent monster additions in that load.
- Warm all cinematic sets before playback; bound long-frame time and pause the
  clock while hidden so the arcade and machine shots cannot disappear in a stall.
- Skip only via the button or Escape/Enter/Space, preserving normal page clicks.

Validation before release:

- Focused clock, entry, warm-up, playback, loading-order and lobby tests passed.
- Production build passed. Browser comparison played every cinematic phase and
  reduced automatic monster imports during tavern entry from 44 to zero.
- The first dungeon descent reached gameplay with no script/network failures.
- This removes the repeated monster rebuild stalls; constructing and warming the
  tavern itself still takes time. No universal FPS improvement is claimed.

The first full release gate exposed three integration issues in the new monster
batch: inconsistent Six-Armed God death-frame counts, noisy small fallback arm
plates, and a debug label exceeding the existing length limit. The follow-up
uses four falling/spreading death frames in every facing, removes thin edge
lighting from the arm plates, and shortens Crawling Hand's debug label. Existing
test thresholds are unchanged. All 63 tests across the noise, imported-monster
pipeline, debug-panel and Six-Armed God boss suites passed.

The other integration owner released equivalent monster fixes at `4aa5b82f`
while this correction was being validated. Merge `bd1f28b9` preserves that
released fallback painter and short label; it supersedes the local follow-up
implementation. The intro, tavern and floor-loading fixes are retained.

Release `b9c68ff2` deployed successfully on 2026-09-07 at 00:57 PDT.

- Full gate: 332 test files passed, 5 skipped; 3,919 tests passed, 12 skipped;
  zero failures. Production image built and transferred in 7 seconds.
- NAS container: running / healthy at `b9c68ff2`; both NAS and public health
  endpoints pass. Image, NAS and public HTML hashes match exactly.
- All 21 relevant public sprite manifest/PNG pairs match source bytes.
- Public browser build `2026-09-07T07:57:11Z` played town, head-off, head-roll,
  arcade, machine, sweep and title, then entered the tavern with zero automatic
  monster imports and no script errors. The arcade and machine phases each
  remained visible for approximately three seconds.
- Public first-floor descent reached active gameplay with only HUD/toasts open,
  no script errors and no failed requests; screenshot visually checked.
- The release wrapper now explicitly unlocks on exit: an orphaned SSH agent
  from a finished release had retained the descriptor. Verified that concurrent
  releases remain blocked, inherited child processes no longer strand the lock,
  and the lock was available after this completed deployment.
