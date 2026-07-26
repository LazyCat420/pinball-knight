# Handoff — braindeadbot-client

_Replaced on each deploy. Not a log; if something here is done, delete it._

## 🪧 "ENTER MAZE" SIGN above the tavern notice board (2026-07-25, this session)

**Commit `7d503cc`** · pushed to `main` · deployed **`main@7d503cc` → synology**
**Live:** http://10.0.0.16:5174/dungeon — container verified `healthy` after deploy.

267 tavern tests pass · `tsc` clean on the touched file.

### What was reported

> "in the pinball knight game … make it more obvious where the user has to go to
> start the game. I want a sign above that bulletin board that says Enter Maze"

Shipped exactly that: a lit marquee reading **ENTER MAZE** hangs above the notice
board on the north wall, with a cyan down-arrow in each gutter pointing at the
`board` station. All of it in `src/scenes/tavern/props.ts` — the sign geometry
sits in the NOTICE BOARD block, the legend is drawn by `makeSignTexture()` near
the top of the file.

### Why the room breaks its own rule for this one prop

`TAVERN_PLAN` says stations read from **shape plus accent colour, never text**,
and every other station still honours that. The way down is the exception
because it is the only station a first-time player *must* find: skipping the
forge costs you a socket, skipping the board means no run ever starts. The two
existing cues were not carrying it — a corkboard reads as scenery, and the cold
floor lane only points at the plunger once you are already standing in it.

### Three things the RENDER corrected that reasoning did not

Each of these shipped wrong first and was caught by screenshotting the live
tavern. **If you touch this sign, screenshot it again** — the iso projection does
not do what the world-space numbers suggest.

1. **SIZE.** First pass was 3.1 × 0.62 with the word inset in its canvas. On
   screen the caps stood ~10 pixels tall: a wall-mounted panel is foreshortened
   hard by the 38° camera, and the pixel post-pass quantises whatever survives.
   Now 4.2 × 0.8, and the glyphs are **measured and fitted** to 74% of the canvas
   width rather than sized by eye — `Press Start 2P` is a webfont that may not
   have loaded when the tavern builds, and the monospace fallback has a different
   width per em, so a hardcoded px size overflows in one case and floats in the
   other.
2. **PLACEMENT — `+z` PROJECTS DOWNWARD.** The sign leaned forward 0.16 rad and
   stood 0.06 proud of the board; both push it toward the viewer, and under a
   45°-yaw camera that also pushes it *down the screen*. The legend landed across
   the top row of notices and read as painted **on** the corkboard. Raising it
   could not fix that — the wall caps at `WALL_HEIGHT` 3.2. It now sits back at
   the wall plane (z −6.72, behind the board's −6.6 backing) at y 3.0, lean cut
   to 0.06.
3. **THE ARROWS.** Two failed attempts. Real chevron geometry beside the board
   turned into unreadable diagonal slashes (the 45° yaw rotates anything built in
   the XY plane), and the only free wall — the ~0.1 strip between the notices and
   the sign — is too thin for anything that survives the pixel pass. They are
   **painted into the texture** now. The first texture version used squat
   triangles, which came out of the projection wider than tall and read as
   sideways pennants; they are narrow with a stem so the vertical axis survives
   the squash, and filled at the letters' brightness rather than plain `COLD`
   (the glyphs get a third near-white pass and the arrows did not, which read as
   two different signs sharing a panel).

### Other edits in the same commit

- The board's hooded lantern drops **y 2.35 → 2.05**. Its hood projected directly
  over the sign's left arrow. Lower is the better light anyway — it rakes across
  the notices instead of washing them from overhead.
- `dispose()` now frees `signTex`. It disposed geometries and materials but never
  textures, because until now nothing in the tavern owned one.

### Known-good, deliberately NOT changed

**The interaction prompt still says `[E] DESCEND`,** from `STATIONS[0].label` in
`src/scenes/tavern/layout.ts:110`. The sign and the prompt therefore use
different words for the same action. Left alone as out of scope — if you want
them to agree, change that one `label` field (and the `blurb` under it);
`layout.test.ts` does not assert on the copy.

### Verification

Headless screenshot of the live tavern at spawn (x 0, z 5.4), 1400×900: the
legend is readable **at full frame without zooming**, which was the bar — the
sign has to work from the spawn stair, not just up close.

Recipe: playwright at `HTML-Notes/.venv/bin/python`, chromium with
`--use-gl=swiftshader --enable-unsafe-swiftshader --no-sandbox`, `goto /dungeon`,
then poll for `window.__tavernProbe` (`__dungeonProbe` does **not** exist in the
lobby). Do **not** add `?no-intro=1` to `/dungeon` — it breaks chunk loading.
Run against `next dev` on a spare port, never a rebuild under the live
`next start`, which pins its own manifest and yields phantom missing chunks.
