# Selective scenery pixels

In the Three.js client, open **Esc → Options → Pixel look → Scenery pixels**.
The control cycles **Off → Subtle → Chunky** and applies immediately. New or
invalid preferences default to Subtle; the selected mode persists across reloads.

- Off preserves the original scene sampling.
- Subtle samples opted-in scenery on a 2×2 scene-pixel grid.
- Chunky uses a 4×4 grid.
- Camera framing, sprite atlas resolution and UI resolution stay the same.

Dungeon geometry and the tavern room opt in using
`group.userData.pixelEnvironment = true`. Other objects are protected by default;
a child can explicitly opt out with `pixelEnvironment = false`. Cutout,
transparent and unlit MeshBasic materials are protected even inside opted-in
scenery. Tavern props, actors, pickups and effects retain their existing detail.

The existing TSL pipeline writes an alpha-blended protection mask in a third
RGBA8 attachment during its normal scene draw. Both the original pixel and the
proposed block sample must be unprotected before sampling moves. This prevents
actors from expanding into adjacent blocks and retains the existing depth
occlusion. A subtle depth edge darkens scenery only; the UI is composited later.
Global palette quantization, dithering and the retired outline switch remain off.

This is a visual setting, not a low-resolution performance mode. It retains the
full-resolution scene, adds one mask attachment (about 3.5 MiB at 1280×720), and
adds mask/depth texture reads. Off also retains that attachment and shader graph,
so toggling modes does not compile or reallocate rendering resources.

## Validation

- 77 focused unit/regression tests covering settings, keyboard/controller
  activation, menu reachability, material protection, render sizing, engine
  boundaries, MRT coverage, heat, and scene/UI warmup.
- Production Vite build passes.
- Real WebGPU fixture passes at 1280×720, 1366×768 and 800×600. Both modes change
  scenery with zero changed protected pixels or opaque UI pixels, maintain wall
  occlusion, and restore the Off image exactly. The fixture handles WebGPU's
  256-byte readback row alignment.
- Loaded dungeon captured at all three settings on WebGPU with no script,
  GPU-validation or HTTP errors in the final gameplay run.
- The repository-wide type check has existing errors; see the handoff record for
  the comparison against this task's baseline.

To repeat GPU validation, run the normal Vite dev server, open
`/scripts/pixel-filter-check.html` in a WebGPU-capable browser, then run
`await window.checkPixelFilter()` in its console. Use a muted, dedicated profile
for headless runs and close it when finished. The fixture disposes its renderer
and render targets after each check.

This batch is a handoff for the integration owner. It has not been merged or
released; the current deployment hold remains in effect.
