# fx capture scripts

Restored 2026-08-30 from pre-split history (`8bc34180^:legacy/scripts/`) — they
were deleted at the ThreeJS/Rust repo split instead of moving here, while the
`fx/index.ts` header kept referencing them. Defaults updated: the standalone
app boots the dungeon at `/`, so `--url` now defaults to
`http://localhost:5174/` (the vite dev port).

What each proves is documented in its own header:

- `fx-motion.mjs` — proves a shader is not frozen, with a frozen control
- `fx-shot.mjs`   — full-frame contact sheet at real presented resolution
- `heat-ab.mjs`   — shimmer A/B (it has nothing of its own to look at)
- `fx-probe.mjs`  — ask the live page a question instead of guessing

Requirements (deliberately NOT in package.json — heavyweight, capture-only):

- `playwright` (all four) and `sharp` (all but fx-probe): `npm i -D playwright sharp`
- a host Chrome listening on CDP (`--remote-debugging-port=9345`, or set
  `BDB_CDP_PORT`). WSL/llvmpipe invents artefacts — connect to the HOST GPU
  browser, never a bundled headless Chromium.
- `npm run dev` serving the app at the `--url` you pass.
