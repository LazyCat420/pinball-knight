# Lag probes (docs/perf/maze-lag-audit.md)

Raw-CDP harnesses that measured the 2026-09-10 maze lag audit. Each expects
Vite serving the checkout (`--url`, default `http://localhost:5183`) and host
Chrome started with `--remote-debugging-port` (`--cdp`, default
`http://127.0.0.1:9353`). None of them is a test; nothing under vitest runs them.

- `lag-cdp.mjs` — the profile: V8 sampling sliced to hitch frames, WebGPU
  call log, long tasks, pacing table. `--secs --mode --seed --out`.
- `lag-probe.mjs` — the in-page half (copied from braindeadbot-client).
- `readback-trace.mjs` / `redress-trace.mjs` — every slow `getImageData`
  with its canvas and caller; the re-dress variant forces weapon gives
  (`WEAPONS=bow,gun`) and gear changes (`GEAR=helmet,armor`).
- `backfill-probe.mjs` — drives the game's own idle-callback backfill.
- `atlas-cost.mjs` — per-atlas build cost and worst single readback.
- `raster-vs-readback.mjs`, `build-variants.mjs`, `strip-effect.mjs`,
  `readback-bench.mjs` — the discriminating experiments described in the audit.

Check `nvidia-smi` before quoting any number: another process on the GPU
turns every idle-wait figure into noise.
