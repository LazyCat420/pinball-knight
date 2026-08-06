/**
 * `import SRC from "./x.wgsl"` -> the file's text, as the default export.
 *
 * A webpack-compatible loader, which is what Turbopack takes (next.config.js,
 * `turbopack.rules`). It is four lines of our own rather than a dependency
 * because the two obvious dependencies are both wrong here: `raw-loader` is
 * deprecated and unmaintained, and Turbopack's built-in `type: "raw"` module
 * type — which the Next 16 typings advertise as "return raw file contents as a
 * string" — resolves the import to `undefined` at runtime. That failure is
 * silent all the way to the GPU: `wgslFn(undefined)` builds a material that
 * renders nothing, with no error anywhere in the build.
 *
 * JSON.stringify does the escaping. Shader text is exactly where a hand-rolled
 * template literal would corrupt a backslash or swallow a newline.
 */
module.exports = function wgslLoader(source) {
  return `export default ${JSON.stringify(source)};`;
};
