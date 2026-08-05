import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Worker count comes from the CPU broker when the run was launched through
 * `scripts/with-cores.sh CPUS=n --wsl --`, which grants PHYSICAL cores.
 *
 * Left to itself under taskset the pool is sized from logical CPUs, and the
 * two APIs disagree — measured inside a 3-core grant: os.cpus().length still
 * reports 24 (it ignores affinity) while os.availableParallelism() reports 6.
 * The optimistic reading oversubscribes the grant 8x; even the correct one
 * puts two workers on every granted physical core, so SMT siblings fight over
 * one core's execution units on CPU-bound suites. BDB_JOBS pins the pool to
 * the cores actually granted and makes the number match the budget.
 *
 * Unset (an unbrokered `npm test`) keeps vitest's own default.
 */
const jobs = Number(process.env.BDB_JOBS) > 0 ? Number(process.env.BDB_JOBS) : undefined;

export default defineConfig({
  test: {
    ...(jobs ? { maxWorkers: jobs, minWorkers: 1 } : {}),
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
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.claude/worktrees/**",
      /**
       * DEPLOY_SKIP_FORGE_TOOLS=1 — deploy-gate escape hatch, OFF by default.
       *
       * tools/sprite-forge is dev tooling: none of it ships in the site
       * bundle (`next build` doesn't touch it), but its suites run in the
       * deploy gate and a red forge WIP on main blocks shipping unrelated
       * site work. Set the env var on the deploy invocation ONLY — normal
       * `pnpm test` keeps covering the forge.
       */
      ...(process.env.DEPLOY_SKIP_FORGE_TOOLS === "1" ? ["**/tools/sprite-forge/**"] : []),
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
