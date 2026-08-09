# Bake pipeline & manifest schema

**Decision (2026-08-09): bake, don't port.** The 15k lines of Canvas2D painter
code are not translated to Rust. Instead, `cargo xtask bake` drives a script in
`legacy/` that:

1. runs every painter × kind × direction × clip in headless Chromium
   (Playwright — painters need real browser Canvas2D fidelity; rasterization is
   CPU-side, so this is WSL-safe), honoring `IMPORTED_ART` overrides so AI
   sheets win exactly as in-game;
2. runs the existing crush (`commit.ts`: palette snap, pixel lattice, gutter
   checks) **per camera rung** (120/108/96/84/72 texels);
3. packs atlas pages and writes `assets/sprites/rung-<N>/{atlas-*.png, manifest.json}`.

None of `commit.ts`'s pixel math ships in Rust. The Rust side is only:
manifest deserialization (`pk-assets`), an `AtlasLibrary` resource, UV math,
rung selection (mirroring `engine/camera.ts`), and a ~100-line palette-swap
WGSL path for armor-styles/zombie-variant tints (sprites are palette-snapped,
so an exact-color LUT swap is safe).

Expected size: ~15–35 MB total across rungs; wasm lazy-loads the active rung.

## Manifest schema

Serde types live in `crates/pk-assets` (single source of truth). Two formats:

**Published** (current forge output, `legacy/public/sprites/<name>-<dir>.json`):
matted source sheet + cell rects — `{name, dir, image, source, grid?, scale?,
palette?, rows: [{clip, cells: [[x0,y0,x1,y1]…]}]}`. The known trap from the TS
era: the *inbox sidecar* JSON has a different shape; copying one where the
other belongs fails silently (loader gets `image: undefined` and drops to the
painter). The `pk-assets` test parses every published manifest so a shape
change fails loudly here.

**Baked** (the Rust game's food, `assets/sprites/rung-<N>/manifest.json`):

```jsonc
{
  "version": 1,
  "rung": 120,
  "pages": ["atlas-0.png"],
  "sprites": { "<kind>": { "S": { "idle": [ {"page":0, "rect":[x,y,w,h],
               "pivot":[px,py], "trim":[l,t,r,b]} ] } } },
  "palettes": { "<kind>": ["#0a0a12", "…"] }
}
```

## Warnings carried from the TS era

- **Runtime atlas generation in Bevy is painful** (asset mutation, texture
  re-upload, UV invalidation). The bake exists partly to delete this problem —
  do not let "just generate one little sprite at runtime" creep back. The
  palette-tint shader is the sanctioned runtime variation mechanism.
- W direction is never authored; the engine mirrors E. Diagonals are defined
  in the forge vocabulary but need a `Dir` change — port that fact, not a fix.
