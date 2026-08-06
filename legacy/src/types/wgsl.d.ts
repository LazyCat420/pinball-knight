/**
 * `import SOMETHING_WGSL from "./wgsl/something.wgsl"` — the shader arrives as
 * the file's raw text.
 *
 * WHAT HAS TO AGREE FOR THAT IMPORT TO WORK. Three separate toolchains load
 * this codebase's `src/`, and a `.wgsl` file is not JavaScript to any of them,
 * so each needs telling. Miss one and the failure is a build error in that one
 * context only, which is why they are listed together here:
 *
 *   1. `next.config.js`   — `turbopack.rules["*.wgsl"] = { type: "raw" }`.
 *      Turbopack's built-in raw module type; no loader package involved.
 *   2. `vitest.config.js` — the `wgsl-raw` plugin. Vite serves `?raw` imports
 *      natively but has no opinion about a bare `.wgsl` specifier.
 *   3. `scripts/*.mjs`    — esbuild fails a bundle outright when an extension
 *      it has no loader for turns up in the graph, so any script whose entry
 *      point can REACH a shader needs `loader: { ".wgsl": "text" }` (or
 *      `--loader:.wgsl=text` on the CLI form). Today only
 *      `bake-glass-fracture.mjs` is anywhere near one, and it carries it
 *      pre-emptively; the census scripts bundle `game/pinball-knight`, whose
 *      shaders are TSL node graphs rather than files.
 *   4. This file — TypeScript itself, which otherwise reports TS2307.
 *
 * The WGSL is then handed to `wgslFn`, whose parser has rules of its own that
 * no loader can enforce: one function per file, the declaration on line 1, no
 * leading comment. `src/shaders/wgsl-contract.test.ts` checks all of that
 * against three's own parser, over every `.wgsl` file in the tree.
 */
declare module "*.wgsl" {
  const source: string;
  export default source;
}
