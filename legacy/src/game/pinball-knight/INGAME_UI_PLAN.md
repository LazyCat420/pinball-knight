# IN-GAME UI — retiring every DOM overlay

**Goal.** Pinball Knight currently draws its menu, HUD, tavern, shop, card
reader, toasts, map and loading screen as HTML overlays stacked on top of the
WebGPU canvas. They sit OUTSIDE the pixel pipeline, so they are the only things
on screen that are not quantized, not dithered, not scanlined — the game looks
like a pixel game wearing a web page. This plan moves all of it inside the
renderer, through the pixel pass, driven by the same input the game already has.

**Decided up front (2026-07-28):** all of it, and it renders THROUGH the pixel
pass. Nothing stays DOM.

**SHIPPED 2026-07-29 as `main@5bf8d39`.** All five phases are done and the DOM
UI is deleted. `gui/no-dom.test.ts` now enforces it. What this plan predicted
and what actually happened differ in three places worth reading before trusting
any other prediction in here:

  · The composite needed PLAIN `uv()`, not `rtUv()`. The rule is one flip per
    RENDER-TARGET hop and an uploaded canvas has taken none. The plan asserted
    the opposite, confidently, with reasoning — and the probe disproved it.
  · Two input bugs the design did not anticipate: repeats collapsing in a Set,
    and keyboard capture gated on openness rather than on pausing (which the
    always-on HUD turned into "the game cannot be played").
  · The tavern needed its economy EXTRACTED first (`economy/tavern-shop.ts`).
    The plan treated it as a layout port; its twenty-four handlers were welded
    to `innerHTML` and `render()` calls and had to be separated before anything
    could be drawn.

Outstanding: the card hover FX are not rebuilt — see HANDOFF.md.

---

## What is actually there

8,285 lines across the UI surface, but they are not all the same kind of code.

**Already canvas painters — these port by re-hosting, not rewriting:**

| file | lines | what it is |
|---|---|---|
| `render/holo-card.ts` | 809 | paints a card face into a canvas |
| `render/card-glyphs.ts` | 538 | path glyphs (emblems), already font-free |
| `hud-face.ts` | 539 | the portrait, painted per frame |
| `map-render.ts` | 431 | `drawFloorMap(ctx, …)` — pure painter |
| `hud-minimap.ts` | 83 | painter + repaint guard |

That is ~2,400 lines that keep working; only their *mount point* changes.

**HTML-string UI — these get rewritten:**

| file | lines | screen |
|---|---|---|
| `tavern.ts` | 1,119 | tavern + vendor counter |
| `ui.ts` | 865 | HUD bits, toasts, game-over, shop, boss bar, plunger, fps overlay |
| `menu.ts` | 745 | the Esc/I knight sheet, six tabs |
| `hud-diablo.ts` | 658 | the iso HUD panel |
| `intro/index.ts` | 655 | already three.js; only the SKIP chrome is DOM |
| `ui-cards.ts` | 391 | shared card/button/icon HTML + the CSS hover engine |
| `card-reader.ts` | 387 | floor haul screen |
| `debug-panel.ts` | 329 | the backtick dev panel |
| `floor-loading.ts` | 303 | descent bar |
| `pickup-toast.ts` | 221 | pickup toasts |
| `map-overlay.ts` | 150 | chrome around `map-render`'s painter |
| `hud-wolf.ts` | 55 | the rampage bar |

**The rules are already separate.** `menu.ts` owns layout and dispatch only —
skills, cards, legacy, bestiary, settings and the economy all live in their own
modules and are untouched by this work. This is a rendering + input port, not a
gameplay rewrite.

---

## Architecture

### 1. Where the pixels go

`engine/render/pixel-pass.ts` renders scene → `sceneTarget` → bloom chain →
`finalNode` composite. `finalNode`'s comment states the order IS the look:

```
aberration → AO → bloom → linear→sRGB → vignette → ink outline
  → flash → dither → palette snap → scanlines
```

The UI texture is mixed in **after the ink outline, immediately before the
flash**:

```js
col = mix(col, ui.rgb, ui.a);   // ← new
col = mix(col, vec3(1,1,1), u.flash);
```

Why exactly there:

- **After the outline.** The outline is a depth-edge ink pass. A flat UI plane
  has no depth, so an outline over it either does nothing or (worse, if the UI
  writes no depth) inks the *scene behind it* straight through the menu. Sitting
  after the outline sidesteps depth entirely — no UI geometry, no depth writes,
  no interaction with AO.
- **Before dither / palette snap / scanlines.** That is the whole point of the
  request: the menu snaps to the same 32 colours and wears the same scanlines as
  the art.
- **After linear→sRGB.** `col` is already sRGB at that point and canvas2D
  authors in sRGB, so the mix is a straight blend. The UI texture must therefore
  be declared `LinearSRGBColorSpace` so three does NOT decode it — this is the
  same double-encode trap the file already documents (a shader read (26,40,27)
  offscreen and (54,59,70) on canvas). Getting this backwards washes the entire
  UI out, and it will look like a CSS problem.

The UI canvas is sized to `sizing.renderW × sizing.renderH` — the pixel pass's
logical grid, not the window. One `CanvasTexture`, `needsUpdate` only on a dirty
frame.

### 2. The toolkit — `ui/im.ts`

An immediate-mode layer over canvas2D. Dear-ImGui shaped, deliberately small:

- `panel / row / label / button / toggle / pips / icon / sprite / cardFace`
- widget identity by call order, so hover / focus / press state is one integer
- **layout on an 8px grid.** Press Start 2P has an 8px cell; text drawn off the
  grid gets antialiased, and this repo has already paid for that lesson
  (`fillText` AA needs native-grid sizes). Sizes are 8/16/24, never 9 or 13.
- `awaitPixelFonts()` before the first paint — the fonts are self-hosted base64
  woff2, but injecting `@font-face` is not enough for canvas.

### 3. Input — this is the "logic into the game" half

- **Focus/nav model.** Focusable widgets register per frame into a flat list.
  D-pad / arrows move focus, A / Enter activates, B / Esc pops the screen. The
  existing `VirtualPad` (`engine/virtual-pad.ts`, `engine/gamepad.ts`,
  `engine/touch-controls.ts`) feeds it directly — **the menus become fully
  gamepad- and touch-navigable, which the DOM versions never were.** That is a
  capability gain, not just a port.
- **Mouse.** `engine/input.ts` already tracks mousemove/mousedown on the attack
  surface. One `screenToUi(x, y)` converts window px → logical UI px through
  `sizing.scale` plus the letterbox offset. A bug here is invisible until
  something refuses to click, so it gets its own unit test next to the existing
  `render-sizing.test.ts`.
- **Modality becomes state.** `state.menuEl / shopEl / tavernEl / cardReaderEl /
  gameOverEl / bossBarEl / plungerMeterEl / fpsOverlayEl` collapse into
  `state.ui.stack: UiScreen[]`. `core.isSimPaused()` (currently "is any of these
  four DOM nodes non-null") becomes "does the top of the stack pause". The
  keyboard cascade in `input/keymap.ts` — whose comment correctly warns that the
  ORDER of its checks is the design — is preserved exactly, just re-expressed
  against the stack instead of against DOM nodes.

### 4. Icons — the largest content sub-task

The UI is full of emoji (`🗡️ 🃏 ✨ 📖 📜 ⚙️`, every ability, skill, reagent and
gear row). `holo-card.ts` already documents why that cannot survive: emoji drawn
with `fillText` is font-dependent, and a headless render drew ✗-in-a-circle
where the emblem belonged on nearly every card. Every emoji in the UI needs a
real mark.

Supply that already exists: `render/card-glyphs.ts` (538 lines of path glyphs)
and `ITEM_PAINTS` in `render/cel-painter.ts`, which `ui-cards.itemIcon()`
already rasterises for weapons/gear/potions. The gap is tabs, skills, abilities,
reagents and perks. Phase 1 inventories the exact list before drawing anything.

---

## Phases

Each is independently shippable and gated behind `?ui2=1` until its screen is at
parity.

**P0 · Foundation.** UI texture + `finalNode` composite + `im.ts` + focus/nav +
`screenToUi` + the `state.ui.stack` modality model. Proven on the smallest real
screen: the menu shell with only the SETTINGS tab live (pure toggles, no icons).
Tests: layout math, hit-testing, focus order, `screenToUi` under every scale.

**P1 · The knight menu.** All six tabs of `menu.ts`. Pulls in card faces
(already canvas), the skill tree, the bestiary, and the icon inventory. Retires
`menu.ts` and the menu's slice of `ui-cards.ts`.

**P2 · The other modal sheets.** Shop + game-over (from `ui.ts`), the floor haul
`card-reader.ts`, `tavern.ts` + the vendor counter.

**P3 · The always-on HUD.** `hud-diablo.ts`, `hud-wolf.ts`, boss bar, plunger
meter, fps overlay, floating combos. `hud-face.ts` and `hud-minimap.ts` are
re-hosted painters — their canvases stop being DOM children and start being
sub-rects of the UI canvas. The face's "physically move the same DOM node
between HUDs so health never resets" trick in `hud.ts` is no longer needed; the
face state simply stops being tied to a node.

**P4 · The rest.** `pickup-toast.ts`, `map-overlay.ts` (the 431-line
`map-render.ts` painter carries over unchanged), `floor-loading.ts`,
`debug-panel.ts`.

**P5 · Teardown.** Delete the DOM fields from `state.ts`, the matching
`dispose.ts` paths, `injectCardStyles`, and every `document.*` under
`src/game/pinball-knight/`. Add a guard — the repo already runs
`scripts/hooks/registry-drift.mjs` for exactly this class of invariant — that
fails if `document.createElement` reappears anywhere outside the UI layer's own
canvas allocation.

---

## What this costs — decide before P1

1. **The CSS holo-card hover engine goes.** `ui-cards.ts` spends ~200 lines on
   rarity-scaled hover: tilt, pointer-tracking glare, prismatic foil, parallax
   between face and frame, a sparkle field for mythics. It is a deliberate,
   documented rarity tell. None of it survives without DOM. Re-implementing it
   as canvas transforms in `im.ts` is real work — it is also very achievable,
   since it is all affine transforms and gradients. **Rebuild it, or drop hover
   FX?** My call: rebuild the tilt + glare, drop the sparkle field, revisit.
2. **Text gets bigger.** Today's sheets use 9–13px CSS text against a 1080p
   window. On the pixel-pass grid the logical resolution is 1280×720 at common
   window sizes, and text must be 8px Press Start 2P on the grid. Roughly: fewer
   rows fit per screen. The bestiary and the skill tree in particular will need
   scrolling or pagination rather than one long sheet. This is a layout redesign
   for those two tabs, not a straight port.
3. **`debug-panel.ts` is the one worth an exception.** It is session-only dev
   tooling that nobody sees in a build, and DOM is genuinely the cheaper host
   for it. Scope says all of it, so it is in P4 — but I would rather leave it
   DOM and spend the time on the hover FX. Flagging, not deciding.
4. **Lost for free:** text selection, browser zoom, screen readers, and `<img>`
   icon caching. None of these are load-bearing for this game, but they are
   gone rather than degraded.

## Tests

`menu-dispatch.test.ts`, `ui-cards.test.ts`, `card-face.test.ts` and
`debug-panel.test.ts` currently assert against DOM and HTML strings. The
dispatch tables survive as-is (that is the part `menu-dispatch.test.ts` actually
guards, and the bug it was written for — an empty `data-idx` shadowing the act
suffix — disappears entirely when identity stops being a string attribute). The
rest are rewritten against the IM layer's pure parts, plus golden-image tests
through node-canvas for the painted screens.

Suite is 88s today (59s of it `maze/`); this should not move that much.
