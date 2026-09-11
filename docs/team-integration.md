# Parallel development and integration

Each developer owns a branch and worktree. Shared files can still produce Git
conflicts; the integration owner resolves those conflicts before release.
Separate worktrees prevent one developer's uncommitted edits or dependency
installation from changing another developer's files.

## Current integration

- Integration branch: `fix/shared-author-release`.
- Worktree: `.worktrees/wt-shared-author-release`.
- Imported committed batch: `feat/maze-pipeline` at `26664121`, including the
  merged monster additions and main through `295efdd1`.
- Published follow-up: `origin/main` at `14cdc544` adds Milkshake. Merge commit
  `3fc6c0f9` preserves it alongside the earlier monster batch.
- Maze batch: `d8ab8444` shares live authoring, repairs excess ambient density,
  and includes the earlier corner/shuffle fixes.
- Clockwork and intro batch: `5b1966d9`.
- Worktree and release coordination: `8aafc39b`.
- Resolved overlaps: retain Cigarette and all three Clockwork variants in the
  sprite inventory; combine Milkshake with all existing sheet keys and enemy
  kinds; retain pinned pnpm 11.8.0 and frozen dependency installation.
- The user authorized deployment of this integration while the other developers
  continue working. Published Sumo Ninja commit `80791fd4` was merged as
  `3a49bc2f` to preserve its already-public sprite. Release this checkpoint;
  later developer batches can be integrated separately.

## Working agreement

1. Create a named branch/worktree from the agreed base. Do not reuse another
   developer's directory or its node_modules.
2. Announce the files or subsystem you are changing. Coordinate ownership before
   editing shared rosters, manifests, dependency files, or deployment scripts.
3. Commit a finished batch and provide the branch and exact commit for handoff.
4. The integration owner reviews the diff, merges it into the integration
   worktree, resolves overlapping intent, and runs combined checks.
5. Only the integration owner builds/releases the shared NAS image. The project
   wrapper serializes these actions with a lock in the common Git directory and
   installs dependencies once before starting parallel test shards.
6. Deploy after the user's release hold ends. Check the container, public health
   endpoint and actual browser build before reporting success.

No developer's working directory is reset or deleted by this workflow. Conflicts
are resolved in integration, and feature branches retain their original commits.

## Validation of the integration checkpoint

- Production build at `3fc6c0f9` passed (367 modules). Vite reports its existing
  large-bundle warning.
- All 18 Clockwork and new-monster manifest/PNG pairs match their source files
  byte for byte in the production output, including Milkshake.
- The updated production build reached gameplay in a browser with Clockwork
  visible, only the HUD/toasts open, no script exceptions and no failed network
  requests (browser build `2026-09-07T05:47:42Z`).
- Full suite at `3fc6c0f9`: **326 test files passed, 5 skipped; 3,881 tests
  passed, 12 skipped; zero failures**. The completed run exited 0 in 479.75s.
  Earlier command sessions were interrupted by SIGTERM; the final independent
  run completed and wrote its JSON report and exit status.
- The release wrapper passed shell syntax validation. A held lock in the Git
  common directory caused a second release invocation to stop before building.
  Older developer checkouts must adopt this wrapper for mutual exclusion.
- This was the initial integration validation; the completed release is recorded
  below.

## Completed NAS release

The user lifted the deployment hold and requested the integrated game for testing.
The project deploy-kit wrapper released `e4ff8dcc` on 2026-09-06 at 23:55 PDT
(2026-09-07 06:55 UTC), including the Sumo Ninja merge.

- All release tests passed: 327 files passed, 5 skipped; 3,889 tests passed,
  12 skipped; zero failures.
- Docker build passed in 191 seconds. Image transfer completed in 9 seconds;
  the NAS container restarted and reached `running / healthy`.
- Both NAS and public `/health` endpoints returned `healthy`.
- Built-image, NAS and public `index.html` files matched byte for byte.
- All 19 relevant public sprite manifests and PNGs matched the source files.
- Public browser build `2026-09-07T06:54:55Z` reached gameplay with Clockwork
  visible, HUD/toasts open, no script exceptions and no failed network requests.
- Previous image retained as `pinball-knight-web:previous` for rollback.

Play: https://pinballknight.braindeadbot.com/

## Six-Armed God & Crawling Hand Released to NAS

- Commit: `4aa5b82f`.
- Merged `main` (`860c9638`), cleanly unifying:
  - **Six-Armed Indian God ("Mahadeva Asura")** boss with mouth fire stream (`mouthFire`) and 6-arm dagger volley (`daggerVolley`).
  - **Crawling Hand** monster with grab-and-pin mechanic.
  - All sprite forge assets, manifests, and tests for both entities.
- Zero conflicts: `boot/lazy-sheets.test.ts`, `boot/sheets.ts`, `boss.ts`, `spawn/factory.ts`, and `state.ts` resolved cleanly.
- Full sharded test suite passed: 334 test files across 3 shards (zero failures).
- Docker release image built, transferred via SSH to Synology NAS, and container restarted to `running / healthy`.
- Both NAS (`http://10.0.0.16:8789/health`) and public (`https://pinballknight.braindeadbot.com/health`) endpoints verified healthy (HTTP 200).
- Windows release executable ready at `dist/pinball-knight-windows-x86_64/pk-game.exe`.

Play: https://pinballknight.braindeadbot.com/ (Local NAS: http://10.0.0.16:8789)



## Intro and tavern loading release handoff

- Branch: `fix/intro-tavern-loading`, worktree `.worktrees/wt-intro-tavern-loading`.
- Base: `8c67adb0`; includes the completed Six-Armed God/Crawling Hand merge.
- Fix commit: `cd96423c`; removes tavern monster backfill, moves required art
  loading behind visible descent progress, and preserves all intro phases.
- Follow-up corrects the new boss fallback death frames and arm shading, plus
  the Crawling Hand debug label, after the full release gate exposed failures.
- Focused regression tests and production browser checks passed; follow-up
  integration suites passed all 63 tests. Full release gate is being repeated.
- Merged the other owner's released monster corrections and handoff `bd1f28b9`
  via `376af872`, preserving their exact fallback painter and short label.
- Released `b9c68ff2` on 2026-09-07 at 00:57 PDT; full suite passed (332 files,
  3,919 tests; 5 files / 12 tests skipped). Build, transfer and restart succeeded.
- NAS runs healthy at `b9c68ff2`; NAS/public health and image/NAS/public HTML
  equality verified. All 21 checked public sprite pairs match source bytes.
- Public build `2026-09-07T07:57:11Z`: complete intro, zero tavern monster
  imports, and successful first-floor gameplay without script/network errors.
- Release wrapper now explicitly unlocks on exit to prevent orphan SSH agents
  from retaining its descriptor. Adopt this wrapper before subsequent releases.
- This branch is the latest verified NAS release and must be integrated before
  another branch releases, to preserve the intro and tavern loading correction.
- Other developers' worktrees and uncommitted work have not been modified.

## Recovery from a divergent follow-up release

The NAS was subsequently overwritten by `0e60c8cc`, whose ancestry omitted the
Clockwork Knight, cinematic intro, maze integration, and tavern correction.
The previous release verification was accurate at its completion, but the
project-local lock did not protect against a later release from an older branch.

- Recovery merge: `0a6a2634`, preserving the complete release plus the latest
  Buddha debugger fix and Fry Sentinel transparency correction from `main`.
- Shared deploy-kit guard: `d1cdb39`. It runs for Pinball Knight even from older
  project wrappers, requires both the integrated baseline and running NAS commit
  in the candidate's ancestry, checks the actual image label, and blocks release
  if the NAS cannot be verified. It also provides the common release lock.
- Regression checks: all 12 guard tests passed against real divergent Git
  history. The actual regressing revision `0e60c8cc` was rejected; recovery
  `0a6a2634` passed against the running NAS. All 31 focused game tests passed.
- Recovery deployed at `63d9def9` on 2026-09-07 at 01:22 PDT. Full suite:
  333 files passed / 5 skipped; 3,924 tests passed / 12 skipped; zero failures.
- Public browser build `2026-09-07T08:22:26Z` played all seven cinematic phases
  and entered the tavern with zero monster imports and no script errors.
- Clockwork Knight was explicitly selected and reached active dungeon gameplay;
  the character identity and screenshot were checked, with no script or network
  failures. All 21 relevant public sprite pairs match the source bytes.
- Image, NAS and public HTML match; NAS is running / healthy at `63d9def9`.
- Remote `main` was fast-forwarded from `0e60c8cc` to `d2e6f5ca`, including the
  complete game and a wrapper check that refuses an outdated deploy-kit without
  `release-guard.sh`. This host-only wrapper change needs no new container image.
- Confirmed the guard rejects both the regressing branch `0e60c8cc` and the
  previously good release `b9c68ff2` against the restored running release.
- Shared deploy-kit `master` is updated locally to `d1cdb39`. Pushing that
  separate repository to its configured origin returned “Repository not found”;
  the guard is installed and active on this deployment host. The Pinball Knight
  main push succeeded. Other hosts must install the updated shared kit; the new
  game wrapper fails closed if the guard is missing.

## Intro, character selection, and tavern controls release — 2026-09-10

- Feature branch: `fix/intro-tavern-controls`, dedicated worktree
  `.worktrees/wt-intro-tavern-controls`; completed commits `96f3ab39` and `6571c463`.
- Fixes: retain clicked/tapped character-card focus through confirmation; open
  the picker focused on the current character; refresh tavern art when async
  loading finishes; reject stale character loads; capture key releases even when
  menus intercept input; stop movement immediately when a panel opens; ignore
  held-key repeats when skipping the intro.
- Dedicated integration branch: `release/tavern-controls`, worktree
  `.worktrees/wt-tavern-release`. Release `ce5f6330` includes main `2b124f53`, both
  fix commits, and running NAS release `093fc5fb`, preserving its monster updates.
- The user's explicit website testing request authorized this deployment.
  The existing project deploy-kit wrapper and release lock were used; the
  ancestry guard correctly rejected the initial branch before integration.
- Full release gate: 349 test files passed, 5 skipped; 4,099 tests passed,
  12 skipped, zero failures. Docker build, NAS transfer and restart succeeded.
- Verified NAS `ce5f6330` is running/healthy. NAS and public health endpoints
  respond healthy; image, NAS and public HTML SHA-256 hashes are identical.
- Public build `2026-09-11T01:30:43Z` played all seven intro phases. Actual
  Clockwork card click and Confirm left Clockwork visible in the tavern; opening
  a menu while holding left, releasing left inside it, closing it and pressing
  right moved right and faced east. No browser script errors. Mario was also
  verified in the local browser before deployment.
- Source push remains pending: automatic approval review rejected GitHub pushes
  pending explicit authorization for `LazyCat420/pinball-knight`. Local commits
  and the website deployment are complete. Other developers' worktrees were not
  modified. Future releases must include `ce5f6330` to preserve these fixes.
