import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Some suites do heavy per-test work (e.g. floor-pipeline runs full BFS
    // reachability across 68 floors in a single `it`). Under a loaded CI box
    // running 6 workers, a single such test can exceed the 5s default and flake
    // the deploy even though its assertions pass. Give them room.
    testTimeout: 30000,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
