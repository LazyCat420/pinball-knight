# Pinball Knight team coordination

- Make edits in a dedicated Git worktree and branch for each developer/task. Keep
  the main checkout free of feature edits so incoming commits can integrate.
- Work only in your assigned worktree. Do not reset, clean, stash, switch branches,
  alter dependencies, or restart processes in another developer's worktree.
- Install dependencies inside each worktree. Do not share a writable node_modules
  directory: pnpm can replace it during installation.
- Commit related work in focused commits. Before integration, inspect the branch
  diff and confirm the developer's batch is ready; do not merge worktrees merely
  because they exist. Never rewrite another developer's branch.
- Integrate committed batches in a dedicated integration worktree. Merge one
  branch at a time, resolve overlaps semantically, and validate the combined
  result. Preserve both additions to shared registries, manifests and rosters.
- Reserve NAS release work for the designated integration owner. Use the project
  deploy.sh wrapper; its Git-common-directory lock serializes release builds and
  deployment across worktrees. Do not bypass the lock with direct image pushes.
  All older checkouts must adopt this wrapper before relying on the lock.
- Follow the user's current release hold. A request to continue development or
  integrate branches does not by itself end a hold on deployment.
- Record handoff details in docs/team-integration.md: branch, commit, changed
  areas, validation, and integration status. A record is a handoff, not evidence
  that another developer has read it or finished working.
