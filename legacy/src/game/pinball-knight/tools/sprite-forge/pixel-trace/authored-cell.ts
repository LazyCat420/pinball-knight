/**
 * A hand-editable pixel-art cell: a small grid of characters, each mapped to
 * a hex colour. `trace.mjs` produces one as a STARTING POINT by downsampling
 * and quantising a reference image; a human or an agent edits it afterwards
 * by moving characters around, or writes one from scratch with no image at
 * all. Nothing at runtime falls back to a source PNG — the rows ARE the art.
 *
 * `resolveJsonModule` is on in this project, so a traced/authored file can
 * be imported directly: `import cell from "./traced/torch.json"` typed as
 * `AuthoredCell`.
 */
export interface AuthoredCell {
  id: string;
  grid: string;
  ink: Record<string, string>;
  rows: string[];
}

/** A directory of poses traced together, e.g. `trace-set some-dir/`. */
export interface TracedSet {
  id: string;
  grid: string;
  source: string;
  cells: Record<string, AuthoredCell>;
}
