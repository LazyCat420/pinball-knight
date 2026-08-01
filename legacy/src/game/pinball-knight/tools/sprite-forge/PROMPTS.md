# Generation prompts for imported sheets

The two creatures with imported art are `jester` and `rotortail` (whose sheet is
named `beaver`). See `IMPORTED_ART` in `boot/sheets.ts`.

**Generate ONE IMAGE PER CLIP ROW**, not one image per sheet. A 6-frame row of
432px-tall figures is ~2900px wide, which no generator will give you in one
shot at usable fidelity. Strips composite cleanly — `slice.ts` finds rows.

**What to optimise for.** Not the pixel lattice — no generator emits one, and
the gate will keep saying NOT PIXEL ART. Optimise for **flat fills and a low
colour count**, because that is the failure the census actually reports
(jester: 26.6 entries against the 20-entry atlas lock, 41.5% isolated pixels
against the roster's 22.5%).

Background must be **pure magenta `#FF00FF`**. The current sheets used near-white
`#fdfdfd`, which collided with the cream ruff and left 1,760 enclosed pockets
opaque.

---

## Shared preamble — prepend to every prompt

    16-bit SNES-era pixel art sprite strip for a dungeon crawler.

    STYLE: hard-edged pixel art. NO anti-aliasing, NO soft edges, NO gradients,
    NO blur, NO glow, NO dithering, NO texture noise. Every region is a FLAT
    fill of a single solid colour. One solid 1-pixel dark outline around the
    silhouette and around each major form. Chunky, readable, high contrast.

    COLOUR: use AT MOST 16 distinct colours in the whole image. Do not blend,
    do not shade smoothly — shade in 3 discrete steps per material only.

    BACKGROUND: solid pure magenta #FF00FF, perfectly flat, edge to edge.
    No ground plane, no shadow, no vignette, no border.

    COMPOSITION: all frames in ONE horizontal row, evenly spaced, same scale,
    feet on a common baseline, facing the viewer (front / south facing).
    NO text, NO numbers, NO labels, NO grid lines, NO panel borders.

---

## jester — `jester-S.png`

A harlequin mounted on a **coiled steel spring instead of legs**, standing on a
round base plate. Threat is read off its HEIGHT: the spring compresses on the
wind-up and extends at full stretch on release.

    SUBJECT: a grinning harlequin jester whose lower body is a COILED STEEL
    SPRING instead of legs, mounted on a round metal base plate stamped with a
    star. Diamond-lattice motley costume in DARK MAROON RED and GOLD. A large
    scalloped CREAM ruff collar at the neck, cream gloves, cream stockings.
    Belled jester cap. Pale mask-like face with CYAN diamond greasepaint over
    the eyes and a bright red nose. Dark brown curl-toe shoes on the base plate.

    PALETTE (use these exact colours):
    maroon  #3a0f18 #6b1f2a #a83244
    gold    #7a3b12 #d97b29 #f0a63c
    cream   #f0a63c #ffd98a #fff3c8
    steel   #4a5364 #8a94a6 #c8ccd4   (the spring only)
    leather #2a1c14 #4a3222 #6b4a2e   (shoes)
    accent  #6fd0e8 (greasepaint)  #d95763 (nose)
    outline #171a22

    The spring must read as a HELIX, not a grey bar: back half of each coil in
    #4a5364, front half in #8a94a6 with a #c8ccd4 specular. Keep the spring
    clear of the base plate rim.

Rows to generate, in this order — the sidecar depends on it:

| row | clip | frames | direction |
|---|---|---|---|
| 1 | `idle` | 4 | spring at rest, slight bob |
| 2 | `attack` | 4 | crouch/compress → launch → full stretch → recover |
| 3 | `walk` | 6 | hopping cycle on the spring |
| 4 | `stumble` | 2 | staggered back, off balance |
| 5 | `death` | 4 | spring buckles, collapses flat |

Sidecar `inbox/jester-S.json`:

```json
{ "rows": ["idle", "attack", "walk", "stumble", "death"] }
```

---

## rotortail — `beaver-S.png`

An armoured beaver sapper with a **bladed rotor for a tail**.

    SUBJECT: a stocky armoured BEAVER with a spinning bladed ROTOR where its
    flat tail should be. Dark brown pelt, lighter tan belly, big chisel front
    teeth. Wears a riveted steel skullcap helm and round brass-rimmed glass
    goggles with a glowing cyan lens. The rotor is dark timber blades set at an
    angle on a brass hub.

    PALETTE (use these exact colours):
    pelt    #4a3222 #6b4a2e #a9705a
    belly   #a9705a #d69f7e
    timber  #2a1c14 #4a3222 #6b4a2e
    steel   #4a5364 #8a94a6            (helm)
    brass   #7a3b12 #f0a63c #ffd98a    (goggle rims, rotor hub)
    glass   #1f3d52 #2e6d8f #6fd0e8    (lens)
    teeth   #eef1f5
    outline #171a22

Rows to generate, in this order:

| row | clip | frames | direction |
|---|---|---|---|
| 1 | `idle` | 4 | rotor idling slowly |
| 2 | `walk` | 4 | waddle cycle |
| 3 | `attack` | 4 | rotor spins up, lunge |
| 4 | `death` | 4 | rotor seizes, topples |

Sidecar `inbox/beaver-S.json`:

```json
{ "rows": ["idle", "walk", "attack", "death"] }
```

---

## After generating

1. Drop the strips in `inbox/`. If you generated per-row, hand them over to be
   composited into a single `<name>-S.png` — the slicer wants one image.
2. `npm run sprites`
3. Read `work/report.txt`. The line that matters is not GRID (it will still
   fail) but the census:

       MEAN   entries <20  isolated <25%
       ROSTER entries 20.1 isolated 22.5%

   Beating the roster on `entries` and `isolated%` is the win condition for a
   regenerated sheet. GRID passing needs a grid-commit step, not a better prompt.

**Naming.** `<creature>-S.png` is south / toward camera. `-E` is the true side
profile, `-N` is away. W is never authored — the engine mirrors E.
