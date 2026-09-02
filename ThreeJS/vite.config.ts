import { defineConfig } from "vitest/config";
import path from "path";

/**
 * `import SRC from "./x.wgsl"` — transforms shader files to JS raw string exports.
 */
const wgslRaw = {
  name: "wgsl-raw",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith(".wgsl")) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

export default defineConfig({
  plugins: [wgslRaw],
  /**
   * The build stamp the page prints at boot and `__dungeonBuild()` returns.
   *
   * Deliberately changes on every build, so the bundle's content hash does
   * too: "did my fix reach the browser" stops being a guess. See the docblock
   * in src/main.ts for the incident that earned it.
   */
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().replace(/\.\d+Z$/, "Z")),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    testTimeout: 180000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.worktrees/**",
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
