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
    testTimeout: 60000,
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
