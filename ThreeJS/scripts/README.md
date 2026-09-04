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
- `death-lab.mjs` — spawn a monster, kill it, and prove what the SCREEN showed:
  the animator's frame, the frame the texture is really sampling, and a cropped
  contact sheet of the death. `--all` runs the whole roster. It also needs
  `canvas`, which IS in package.json.

  **Use `--kill force` for the roster.** `--kill ram` lands its launch on the
  FIRST kind and misses every one after it (open item — the trigger is not
  re-armed between entries). The probe no longer scores a survivor as broken
  art: a kind that never died prints
  `⚠ NEVER DIED — the ram trigger did not land …` and drops out of the
  denominator. It once printed 26 of those as death-animation failures, on a
  build whose deaths were verified working by every other measurement.

  The terminal cel is read off the DYING ACTOR, not off the kind's atlas — a
  reaper is a brute wearing the boss atlas, so its death cels are 50-53 while
  the kind's own `S:death` reads 12-15.

- `audit-death-live.mjs` — the same question asked of ORDINARY PLAY instead of
  a lab: no god mode, no `__dungeonKill`, no wait for imported art. Runs
  `__dungeonBot` against a deployed URL and transcribes every death from the
  build's own `[death:step]` / `[death:done]` logging, scoring whether the
  texture reached and held each actor's terminal cel. `--gpu webgpu|cpu|none`
  picks the backend, `--intro` keeps the full title sequence and drops every
  query parameter, so it can measure the entry a player actually takes.
  See `docs/death-animation-audit.md`.

- `audit-ram-kill.mjs` — does a pinball RAM (and a melee swing) actually kill?
  Spawns one goblin, drives each mechanism, prints hp/mode/texFrame. Written
  because a probe that cannot land its kill reports a live monster as a frozen
  death clip.

Requirements (deliberately NOT in package.json — heavyweight, capture-only):

- `playwright` (all four) and `sharp` (all but fx-probe): `npm i -D playwright sharp`
- a host Chrome listening on CDP (`--remote-debugging-port=9345`, or set
  `BDB_CDP_PORT`). WSL/llvmpipe invents artefacts — connect to the HOST GPU
  browser, never a bundled headless Chromium.
- `npm run dev` serving the app at the `--url` you pass.
