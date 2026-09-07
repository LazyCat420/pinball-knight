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
- Local batch: shared maze author, density repairs, earlier corner/shuffle fixes,
  and the previously developed Clockwork and intro changes.
- Resolved overlaps: retain Cigarette and all three Clockwork variants in the
  sprite inventory; retain pinned pnpm 11.8.0 and frozen dependency installation.
- Deployment remains on hold while the user brings in the other developers'
  commits. This integration is a checkpoint, not a claim that their branches are
  finished. Recheck branch heads before the next merge or deployment.

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
