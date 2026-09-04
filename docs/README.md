# Pinball Knight — documentation index

This repository holds **two parallel implementations** of the same game, and
nothing at the root said so until now. Start here.

| Tree | What it is | Its documentation |
| --- | --- | --- |
| `ThreeJS/` | The original. TypeScript + Next.js, three.js for the dungeon, Canvas 2D for the tavern's screens. The **oracle** every port is measured against. | `ThreeJS/src/game/pinball-knight/*_PLAN.md`, `ThreeJS/src/scenes/tavern/**/PLAN.md` |
| `Rust/` | The port in progress. Bevy + a CPU pixel toolkit (`pk-gui`) that answers to the oracle's own raster. | `Rust/docs/` (mdBook — `docs/src/SUMMARY.md` is its table of contents) |

## Why this file exists

doc-client discovers documentation by checking whether the **first** component
of a path is one of `documentation/`, `docs/`, `plan/`, `.agents/`, `reports/`
— or a root-level `*.md` (`app/doc_policy.py: is_doc_path`). Every document in
this repo lives under `Rust/docs/…` or `ThreeJS/…`, so `parts[0]` is `Rust` or
`ThreeJS` and **none of it was discoverable**. Searching doc-client for
`roulette` returned a hit in another repo entirely; the only indexed file here
was the root `README.md`.

That is a structural mismatch between a two-project monorepo and a
one-project-per-repo convention, not a missing document. This directory is the
seam: it is discoverable, and it names where the real trees are.

**If you add documentation, put it in the nested tree that owns the code** —
`Rust/docs/src/status/` for port work, the plan files for the TypeScript side.
Add a line here only when a new tree or a new top-level document appears.

## The Rust port's status documents

Read in this order:

- `Rust/docs/src/status/one-to-one-route.md` — what is left, in what order
- `Rust/docs/src/status/board.md` — the status board
- `Rust/docs/src/status/tavern-one-to-one.md` — the tavern, station by station
- `Rust/docs/src/status/incidents.md` — **diagnoses that outlive their patches**
- `Rust/docs/src/status/baselines.md` — every recorded number, generated

## Recent work

- `death-animation-audit.md` — **2026-09-04.** The monster death pipeline was
  never broken; three broken *measurements* made it look that way. What was
  measured against the deployed build, the probe defects that produced 26 false
  reds, the co-op fix that was unreachable code, and the open items.

### 2026-08-30 — VFX Tier A: the ten invisible events (`ThreeJS/`)

A coverage audit of every item, move, powerup and brew found a specific set of
game-state changes with zero visual output — the freeze potion chief among
them (the table halted indistinguishably from a hang). All ten got their look,
each a handful of `state.vfx` calls at an existing seam; the four fx capture
scripts the repo split deleted were restored under `ThreeJS/scripts/`. Full
write-up + the unverified player test list in **`docs/vfx-tier-a.md`**; the
remaining roadmap (gold-as-dust coins, the vault loot fountain) was filed into
`ThreeJS/src/game/pinball-knight/OPEN_WORK.md` Tier 5.

### 2026-08-29 — The vault chest (`ThreeJS/`)

The sealed loot vault stands in the boss chamber by construction and could only
be opened by lighting every brazier — a mechanic the HUD never mentions, on an
object with no collider, so bumping it did nothing. Reported from the live site
as "the chest can't be opened". The overlord's death now opens it, and the chest
was rebuilt as one: a hinged barrel lid over a strapped plank carcass. Full
write-up in **`docs/vault-chest.md`**, including the four visual defects a green
suite could not see and what is still open.

### 2026-08-27 — The gambler's roulette wheel

The tavern's roulette wheel is now rasterised in Rust rather than stubbed.
Full write-up in `Rust/docs/src/status/incidents.md`; the short version:

- `pk_gui::gambler::roulette_art` was 172 lines that *look* like a port —
  constants, colour ramps, `project()` — with `draw_wheel`, `draw_panel` and
  `clear_table` as **empty bodies**, `build_wheel_layers` returning two
  integers, and `paint_disc` (the rasteriser that IS the wheel) never written.
  Nothing imported the module.
- Its guard test asserted `project → unproject` returns its input. That holds
  for any invertible map and **cannot fail when nothing is drawn**. The status
  board read `✅ DONE — all four playable`.
- Repaired: the scanline rasteriser, the three baked layers, the depth sort,
  and a `GamePrim::Blit` seam that carries a rasterised surface from a game to
  the screen. Measured **99.79% pixel parity** with the TypeScript oracle
  (15 560 of 15 592 non-transparent pixels identical).
- The 32 differing pixels are the **oracle anti-aliasing itself** — an odd
  callout width puts `fillRect` on a half-pixel. The port stays crisp
  deliberately.

**Still stubbed**, same shape, same risk: `darts_art` (`draw_number`,
`draw_dart`, `build_board`), `blackjack_art` (`draw_chip`,
`draw_betting_circle`) and `cards_art` (`draw_card`). The plumbing is no longer
the blocker.

**The rule that came out of it:** a test for procedural art must be able to
fail if the function body it covers were deleted. Ask that of any green art
test before believing the art exists.
