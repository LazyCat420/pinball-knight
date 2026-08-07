# /dungeon renders blank for the site owner — investigation record (2026-08-07)

**Status: NOT FIXED. Cause not found.** Nothing from this session is deployed;
the tree was reverted to its pre-session state. This document exists so the next
dev does not re-run the twelve hours of tests that came back green.

Read the **Harness traps** section before writing any browser repro. Three of my
"reproductions" were artefacts of my own test rig, and each one cost hours.

---

## The symptom

`https://braindeadbot.com/dungeon`, reported by the site owner:

- The page is a flat, uniform dark-green rectangle. No canvas content, no HUD,
  no error dialog, no loading text.
- Reported as happening "when the intro ends".
- Reproduces in a normal window **and in a private window**.
- Persists across reloads and across a full revert of the day's commits.

Two later observations from the owner, seen while playing in a browser window I
had launched (see traps): in the maze the intro's **SKIP button was still drawn
bottom-right**, and **the floor-loading screen never appeared** on descent.
Neither has been reproduced independently.

---

## What is deployed

`main@2a52eed` — two revert commits on top of `2d61bde`.

```
$ git diff --name-only edc0261 HEAD
(empty)
```

The served tree is **byte-identical to `edc0261`**, the last commit before this
session. The two commits made during the session and then reverted were:

| commit | what it did | why reverted |
|---|---|---|
| `c3e7e26` | removed the `CHOOSE YOUR CHARACTER` modal from `openLobby`, moved it to the menu's GEAR tab | did not fix the report |
| `2d61bde` | routed all 7 `renderer.init()` sites through a `startGPURenderer` helper that catches, retries and surfaces a notice | did not fix the report |

**Both are defensible changes and both are described accurately in their commit
messages.** They were reverted only because the owner asked for a known-good
baseline, not because they were found to be wrong. `git revert` them back if you
want them; `2d61bde` in particular fixes a real latent defect (six renderers
whose `init()` rejection had nowhere to go — see
[the uncaught-init section](#the-uncaught-init-defect-real-but-not-this-bug)).

---

## Ruled out — with the method, so you can trust or redo it

Every row below was run against the **live deployed build** on a real WebGPU
adapter (NVIDIA Ampere), and every row **rendered correctly**: tavern alive,
4 canvases, hundreds of distinct colours in the frame.

| axis | values tried | result |
|---|---|---|
| Intro handling | played to completion; SKIP button at 2s/4s/5s/9s/10s/13s; key-skip | renders |
| Viewport × DPR | 1400×900@1, 1440×900@2, 1288×600@1, 1288×600@2, 2576×1200@1, 2404×1253@1.5, 3606×1880@1, 3840×2160@1 | renders |
| Persisted state | `cameraZoom` close/normal/widest, pre-retirement settings blob, `playerSheet` mario, `playerSheet` bogus | renders |
| Descend path | `?autostart=1`; tavern fully built → `__dungeonStartRun()`; skip-intro → descend | renders, **and the floor-loading screen appears** (`["hud","toasts","floor-loading"]`) |
| Audio | `--mute-audio` vs unmuted + a real click gesture | renders |
| Adapter refusal | `requestAdapter()` forced to return null from the Nth call | reproduces a flat screen — **but the site owner sees no notice, so this is not their path** |
| Entry route | direct `/dungeon`; root `/` → SPA-navigate to `/dungeon` | renders |
| Browser | Chrome headless, Chrome headed, **Edge headless** | renders |
| Chrome profile | `chrome://flags` overrides, hardware-acceleration setting, per-site content settings | all default/absent — **and the wrong profile anyway, see below** |
| Edge profile | flags, hardware acceleration, per-site content settings for braindeadbot.com | all default/absent |

Concurrent render loops were also measured, as a side question about CPU:
**4 rAF callbacks per frame during the intro and in the maze, 5 in the tavern.**
`main.ts:509 animate()` starts at boot and never stops — on `/dungeon` no room is
ever mounted, but it still calls `renderer.render(scene, camera)` on the site
renderer every frame underneath the game's canvas. That is a real, independent
perf bug and it is **not fixed**.

---

## Harness traps — read this before writing a repro

These produced three convincing false leads. They are properties of driving a
browser from this repo, not of the game.

### 1. Check WHICH BROWSER the report came from, first

The single largest error of the session. The whole diagnosis rested on *"a
browser I launched works on the owner's own machine, theirs doesn't, so it must
be their profile."* That comparison was void — **the owner uses Edge and every
test was Google Chrome.** The `chrome://flags` / hardware-acceleration /
content-settings audit that "ruled out the profile" read Chrome's `Preferences`
while the failing browser was Edge.

```bash
for p in "/mnt/c/Users/<u>/AppData/Local/Google/Chrome/User Data/Default" \
         "/mnt/c/Users/<u>/AppData/Local/Microsoft/Edge/User Data/Default" \
         "/mnt/c/Users/<u>/AppData/Local/BraveSoftware/Brave-Browser/User Data/Default"; do
  [ -e "$p/Preferences" ] && echo "$(stat -c '%y' "$p/Preferences" | cut -c1-19)  $p"
done
```

Chrome came back **2026-06-22**; Edge came back **the same minute as the report**.
Edge lives at `/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.

### 2. A headed window lands on the user's desktop and steals their keystrokes

`scripts/webgpu-check.mjs` and `playtest.mjs --gpu` drive the *host* browser over
CDP. A `--new-window` launch is a real window in front of the user. I traced an
apparently spontaneous `keydown "e"` that closed the tavern and descended — with
a full minified stack proving it came through the tavern's `onKey` → `interact()`
→ descend station → `closeTavern()`. It was the owner typing a chat message into
my window: the letters walked the knight (WASD) and `E` hit the plunger.

If you must run headed, say so out loud first, and treat any input-driven state
change as suspect.

### 3. Automation never performs a user gesture

So anything gated on one never executes: the AudioContext never starts, and the
DOS boot sits forever at `C:\> SYSTEM READY. PRESS ANY KEY OR CLICK TO START…`.
I read that as "the intro hangs and the loading screen never lifts" and confirmed
it for 123 seconds. It is correct behaviour. On the root path the overlay is
`#loading-screen`, `flex / opacity 1 / z-index 1000 / rgb(0,0,0)`, and it is
supposed to sit there until you press a key.

### 4. Chrome refuses the debugging port on an already-open profile

The failure looks like a **connect timeout**, not a conflict. Use a
per-port `--user-data-dir`. Two of my runs died on this before I spotted it.

### 5. Detached host browsers outlive the run and hold the CPU grant

`pk-run.sh` grants are held through inherited fds, so a leaked `chrome.exe` keeps
a `webgpu` grant forever and the next run reports *"could not get 4 threads … the
box is full"*. Find the holder and kill it:

```bash
for f in ~/.cache/bdb-cpu-slots/gpu-0*.lock ~/.cache/bdb-cpu-slots/slot-0*.lock; do
  fuser -v "$f" 2>&1; done
```

---

## The uncaught-init defect: real, but not this bug

Worth knowing about even though it is currently reverted out.

`createGPURenderer` nulls `_getFallback` on purpose (`fd1c547`) so
`renderer.init()` **rejects** when no adapter can be had, instead of silently
resolving on WebGL2. But every call site was written as
`void renderer.init().then(...)` — the shape from before that change, when
`init()` could not reject and the only failure was the synchronous constructor,
which each site wraps in `try/catch`.

`main.ts` was fixed in isolation (its `.catch()` carries the comment *"Previously
an unhandled rejection: the boot screen would just sit there"*). The other **six**
sites never got it: `scenes/tavern/core.ts`, `game/pinball-knight/boot/renderer.ts`,
`objects/mouse-room.ts`, `game/mouse-game/core.ts`, `game/mahjong/mahjong-crazy-3d.ts`,
`game/cosmic-pool/index.ts`.

Consequence at each: the rejection goes nowhere, `rendererReady` stays `false`
forever, and a present gate written for the few invisible frames while a backend
warms up skips **every** frame instead. Verified by fault injection — refusing
`requestAdapter()` gives a permanently flat screen, no console line, no notice,
and a `__tavernProbe()` that still reports a healthy room at (0, 5.4).

`git revert` of `2d61bde`'s revert restores the fix (helper + a source-scan test
that was checked against a reverted call site and does flag it).

**Why it is not the owner's bug:** the deployed fix showed no notice on their
machine, so their `init()` is not rejecting.

---

## Where to go next

Ordered by expected value.

1. **Dark Reader.** The owner's Edge has Dark Reader 4.9.129 with `<all_urls>`
   injection. It works by applying a global CSS filter/inversion, which is
   plausibly how a canvas-only page becomes a flat wash, and it is absent from
   every fresh profile tested. It would also apply in InPrivate if enabled there,
   which is the only candidate found that survives the private-window result.
   **Unconfirmed** — loading that exact build into a clean Edge headlessly left
   it inert (`drNodes=0`, `htmlFilter=none`), so the test proved nothing.
   Confirm by toggling it off for the site, or by driving a *headed* Edge with
   the extension genuinely active.
   Enumerate extensions from `Default/Secure Preferences` → `extensions.settings`
   and look for `<all_urls>` / `*://*/*` in `host_permissions` or
   `content_scripts[].matches`.

2. **Drive the owner's real Edge profile.** Edge refuses the debug port on a live
   profile, so: close Edge, copy `…/Edge/User Data` to a temp dir, launch with
   `--user-data-dir=<copy>` and `--remote-debugging-port`. This is the only way
   to get their console, which was never obtained and is still the single most
   valuable missing datum.

3. **Restore a WebGL2 fallback.** The durable fix regardless of cause: a browser
   that cannot give us WebGPU should degrade, not show a blank page. `fd1c547`
   deleted ~400 lines of GLSL twins from `shaders/glass/glass-material.ts` and
   `room/window-caustic.ts` along with `GLASS_FN_SIGNATURES` and the
   twin-comparison tests, so this is real work, not a flag. See
   `src/render/WEBGPU_ONLY_HANDOFF.md`.

4. **Stop `animate()` rendering when a full-screen game owns the display**
   (`main.ts:509`). Measured, self-contained, verifiable without the owner's
   machine: 4–5 concurrent rAF loops on `/dungeon`, at least two of them full
   WebGPU render+present.

---

## Tooling written during the session

All in the session scratchpad, none committed — rewrite rather than hunt for
them. What is worth keeping is the *shape*:

- **Measure the frame, do not eyeball it.** Load the screenshot with the repo's
  `canvas` dep, sample every Nth pixel, and report `distinct` colour count plus
  the dominant colour and its share. `distinct <= 3` is "flat"; a working frame
  is 100–4000. This is what finally made "is it blank" a number instead of an
  argument, and it survives image-viewing limits.
- **Read the app's own probes** rather than inferring from pixels:
  `__gui()` (callable — returns `{open, top, paused, frames, painted}`; there is
  no `__gui.stack()`), `__tavernProbe()`, `__dungeonProbe()`,
  `__dungeonIntroPhase`, `__renderBackendResolved`, `__dungeonStartRun()`.
- **`frames` vs `painted` from `__gui()`** distinguishes "the UI layer is frozen"
  from "the UI layer is fine and the compositor is not showing it".
- **rAF callbacks per *frame tick*, not per second** — headless rAF is not
  vsync-locked, so callbacks/sec is meaningless across environments; callbacks
  sharing a timestamp are one frame, and the ratio is the loop count.
