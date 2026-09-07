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
- No NAS deployment has been performed for this integration checkpoint.

## Release in progress

The user lifted the deployment hold and requested the integrated game for testing.
The project deploy-kit wrapper will validate and deploy the Sumo-inclusive
checkpoint. Record the actual NAS and public checks after it completes.
