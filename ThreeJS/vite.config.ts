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
    /**
     * `process` DOES NOT EXIST IN A BROWSER, and one module still reads it.
     *
     * `src/services/api-config.ts` is a leftover from when this game lived in a
     * Next app: it reads `process.env.NEXT_PUBLIC_BACKEND_URL` at MODULE SCOPE,
     * and `run/ledger.ts` pulls it into the game's import graph. `vite build`
     * already substitutes `process.env` with `{}` for a browser target, so the
     * SHIPPED bundle is fine — the deployed one reads
     * `var e={}; e.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5175"`.
     *
     * `vite dev` does not do that substitution, so the dev server served a page
     * that threw `ReferenceError: process is not defined` before it created a
     * canvas: a black screen, no error visible in the game, `npm run dev`
     * exiting 0 and looking healthy. Defining it here makes dev agree with the
     * build instead of being the only environment where the game cannot start.
     */
    "process.env": "{}",
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
