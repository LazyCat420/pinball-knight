/**
 * THE GAME MUST NOT GROW A DOM UI AGAIN.
 *
 * Every screen in Pinball Knight now paints inside the pixel pass. That is a
 * property with no compiler behind it: one `document.createElement("div")`
 * added in a hurry compiles, works, ships — and quietly reintroduces an overlay
 * that floats above the palette snap, ignores the gamepad, and stores modality
 * in the document tree. Nothing else in this repo would catch it.
 *
 * So the rule is asserted against the source, in the style of
 * `engine/purity.test.ts` and `core-boundary.test.ts`, including their
 * anti-vacuity guard — a source-scanning rule whose walker silently matches
 * nothing passes forever while protecting nothing.
 *
 * ── WHAT IS STILL ALLOWED, AND WHY ──
 * `document.createElement("canvas")` is NOT a UI overlay. A canvas is how this
 * codebase allocates a pixel buffer: sprite atlases, card faces, the knight
 * portrait, the minimap, floor FX, damage text and the UI layer's own backing
 * store are all canvases that are never parented to the page. The banned thing
 * is building INTERFACE out of elements — divs, buttons, inputs, stylesheets,
 * innerHTML — not allocating pixels.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const GAME_DIR = join(__dirname, "..");
/**
 * The tavern SCENE is in scope too. Its overlays (station prompt, arrival
 * banner, run summary, lobby board, the gambler cabinet) were the last
 * interface in the app built out of elements, and they sat on top of the
 * scene's OWN pixel pass — the exact thing this migration exists to stop.
 */
const SCENES_DIR = join(__dirname, "..", "..", "..", "scenes");

/**
 * Files exempt from the rule, each for a stated reason. Keep this list SHORT
 * and justified — an exemption added without a reason is the rule dying.
 */
const ALLOWED: Array<{ file: string; why: string }> = [
  {
    file: "core.ts",
    why: "creates state.container, the host div the WebGPU canvas is appended to. That is the mount point for the renderer, not an interface.",
  },
  {
    file: "intro/index.ts",
    why: "the intro's two 2D canvases are its RENDERING SURFACE for the side-scroller gag, not interface — its chrome (skip, title, fade) is gui/screens/intro-chrome.ts. Converting the surface itself would mean re-projecting a 480-wide virtual space onto the pixel grid; worth doing, not done.",
  },
];

/** Element-building, as opposed to pixel-buffer allocation. */
const BANNED: Array<{ re: RegExp; what: string }> = [
  { re: /\.innerHTML\s*=/, what: "innerHTML assignment" },
  { re: /document\.createElement\(\s*["'](?!canvas)/, what: "createElement of a non-canvas element" },
  { re: /document\.body\.appendChild/, what: "appending to document.body" },
  { re: /document\.head\.appendChild/, what: "injecting a stylesheet" },
  { re: /document\.getElementById/, what: "reaching for an element by id" },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules") continue;
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Strip comments, so the many notes ABOUT the old DOM UI do not trip the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The SITE boot sequence is exempt, and structurally so: the DOS boot screen
 * and the toucan flight run BEFORE any renderer or pixel pass exists, so there
 * is literally nothing to composite into. They are also not part of the game.
 */
const SCENE_ALLOWED = ["app-bootstrap.ts", "intro-scene.ts"];

describe("no DOM UI", () => {
  const files = [...tsFiles(GAME_DIR), ...tsFiles(SCENES_DIR)];

  it("finds the sources (guards against the walker matching nothing)", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it("builds no interface out of elements", () => {
    const violations: string[] = [];
    for (const file of files) {
      const inScenes = file.startsWith(SCENES_DIR);
      const rel = relative(inScenes ? SCENES_DIR : GAME_DIR, file).split("\\").join("/");
      if (inScenes ? SCENE_ALLOWED.includes(rel) : ALLOWED.some((a) => a.file === rel)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const { re, what } of BANNED) {
        if (re.test(src)) violations.push(`${rel}: ${what}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a file that no longer needs one is an exemption that
    // will quietly cover a future mistake. Every entry must still contain DOM.
    const stale: string[] = [];
    for (const { file } of ALLOWED) {
      const full = join(GAME_DIR, file);
      const src = stripComments(readFileSync(full, "utf8"));
      if (!BANNED.some(({ re }) => re.test(src))) stale.push(file);
    }
    expect(stale).toEqual([]);
  });
});
