import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Some suites do heavy per-test work (e.g. floor-pipeline runs full BFS
    // reachability across 68 floors in a single `it`). Under a loaded CI box
    // running 6 workers, a single such test can exceed the 5s default and flake
    // the deploy even though its assertions pass. Give them room.
    testTimeout: 30000,
    /**
     * DO NOT TEST OTHER PEOPLE'S WORKTREES.
     *
     * Vitest's default exclude covers node_modules and dist but not
     * `.claude/worktrees/`, and this repo's workflow puts every in-flight
     * branch there. The deploy gate was therefore running EVERY parallel
     * session's uncommitted code: a run that should cover ~165 test files
     * covered 222, and aborted the deploy on failures in three checkouts that
     * were not being deployed and were mid-edit by someone else.
     *
     * It also made the gate slower and more flaky in the same stroke — the
     * `testTimeout` bump above exists because `floor-pipeline` times out on a
     * loaded box, and the biggest thing loading the box was the duplicate work.
     *
     * A deploy gate tests the tree being deployed. `deploy.sh` ships the
     * WORKING TREE, so that is exactly `src/`.
     */
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/worktrees/**"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
