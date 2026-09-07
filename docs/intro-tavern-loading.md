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

The project deployment gate and public verification are pending.
