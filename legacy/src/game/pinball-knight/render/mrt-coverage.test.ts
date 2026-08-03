/**
 * THE ALBEDO ATTACHMENT HAS ONE BLIND SPOT, AND IT FAILS TO BLACK.
 *
 * `pixel-pass.ts` declares `mrt({ output, albedo: diffuseColor })` once, at the
 * renderer, for every material in the scene. `diffuseColor` is assigned by
 * three's `NodeMaterial.setupDiffuseColor`, which runs for every stock material
 * and for any `NodeMaterial` given a `colorNode`.
 *
 * It does NOT run for a `NodeMaterial` given a `fragmentNode`: that takes the
 * fragment-output shortcut and never builds a diffuse at all. Such a material
 * would write an unassigned albedo, the snap would choose from it, and the
 * object would render as VOID — a silhouette-shaped hole in the floor, with no
 * error anywhere and nothing in the suite to catch it, because the suite cannot
 * see a rendered frame.
 *
 * So the blind spot is guarded structurally instead: no scene material may use
 * `fragmentNode`. The post-processing quads in `pixel-pass.ts` do, and must —
 * they are fullscreen blits with no geometry and no material colour — but they
 * never draw into the scene target, so they are the one exemption.
 *
 * ── WHAT THIS TEST CANNOT SEE (learned the hard way, 2026-08-02) ─────────────
 *
 * A source scan only catches albedo failures that are visible in the SOURCE.
 * It is blind to the other way a material loses its albedo output: being BUILT
 * at a moment when no render target is bound. `NodeMaterial.setup` reads
 * `renderer.getRenderTarget()` once and gates the whole MRT block on it, so
 * such a build emits a 1-output shader — for a perfectly ordinary stock
 * `MeshBasicMaterial` with nothing odd about its source at all. That shipped
 * here for months as 9-13 Dawn validation failures per run and ~10 discarded
 * command buffers, and this file passed green throughout.
 *
 * The gate for THAT class is `pnpm playtest:gpu`, which exits non-zero on
 * renderer errors. It needs a real adapter, so it cannot live in this suite —
 * but it is the check that actually covers the attachment, and it passes as of
 * the `presentUi`/`withSceneContext` target-restore fixes. Do not read a green
 * run of this file as "the albedo attachment is fine".
 *
 * ── THIS TEST CAN FAIL, AND HERE IS THE PROOF ────────────────────────────────
 * A scan that greps for a pattern is worthless if the pattern is absent
 * everywhere; it passes on an empty repo and on a broken one alike. The first
 * case below therefore asserts the scan DOES find `fragmentNode` where it is
 * known to live. If someone deletes the post chain or renames the property, the
 * self-test fails rather than the coverage test silently going green forever.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
/** The post chain. Fullscreen quads, never drawn into the scene target. */
const EXEMPT = ["engine/render/pixel-pass.ts"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(ROOT);
const hits = FILES.filter((f) => /\.fragmentNode\s*=/.test(readFileSync(f, "utf8"))).map((f) =>
  f.slice(ROOT.length + 1).replace(/\\/g, "/"),
);

describe("MRT albedo coverage", () => {
  it("SELF-TEST: the scan finds fragmentNode where it is known to be", () => {
    // If this fails the scan is broken, and the assertion below proves nothing.
    expect(hits).toContain("engine/render/pixel-pass.ts");
  });

  it("no material outside the post chain uses fragmentNode", () => {
    // A fragmentNode material skips setupDiffuseColor, so the MRT's `albedo`
    // slot gets nothing and the object snaps to void. Use `colorNode` instead —
    // it feeds diffuseColor, which is exactly what the albedo attachment wants —
    // or give the material its own `mrtNode`.
    expect(hits.filter((f) => !EXEMPT.includes(f))).toEqual([]);
  });

  it("the fx materials that DO compute their own colour use colorNode", () => {
    // The seven elemental shaders (fire, water, goo, frost, rod, puffs,
    // particles) are the materials most likely to be rewritten as a fragmentNode
    // by someone reaching for "full control of the output". They must not be:
    // an unlit effect's colour IS its albedo, and colorNode is how it says so.
    const fx = FILES.filter((f) => f.includes(`${"fx"}/`));
    expect(fx.length).toBeGreaterThan(5);
    const withColour = fx.filter((f) => /\.colorNode\s*=/.test(readFileSync(f, "utf8")));
    expect(withColour.length).toBeGreaterThan(0);
  });
});
