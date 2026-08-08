# Session plan — 2026-08-08

_Where the repo actually is, and what to spend today on. Written from
`HANDOFF.md`, `documentation/chapters/*`, `docs/*`, and the git/branch/test state
measured this morning. Delete this file when the checklist is spent._

---

## 0. Measured state, not assumed

| | |
|---|---|
| branch | `main @ fd26594`, working tree **clean**, `origin/main` in sync (0/0) |
| suite | **GREEN — 2912 passed / 7 skipped, 262 files, 136 s** (`npm test`, 09:54) |
| box | **idle** — `ops:status` reports 0/20 threads, 0/10 core-slots, 0/9 GPU contexts |
| WSL | restarted ~13 min ago; `memory=32GB` cap **is now applied** (total 31 GiB) |
| live site | `braindeadbot.com` 200, `/dungeon` 200 server-side. `/docs` 404 publicly — **by design**, the route is host-gated to localhost/LAN |
| docs build | `build_docs.py --check` → up to date |
| `tsc` | 6131 errors baseline, `ignoreBuildErrors` on — **not a gate, never will be** |
| `npm run lint` | **dead**: script is `next lint` (removed in Next 16) against eslint ^9 with no flat config. Zero lint coverage in this repo |

**The one deploy uncertainty:** the last documented deploy is `main@2a52eed`
(blank-screen doc). Two commits landed after it — `97eb184` (hound crouch fix,
**user-visible**) and `fd26594` (forge intake, tooling only). Nothing recorded
whether they shipped. Assume the hound fix is **not live** until proven.

---

## 1. Three tracks, and only one of them is on `main`

**Track A — the site / dungeon renderer.** On `main`. WebGPU migration done,
booster instancing landed (66 → 3 draws), WGSL in files. Blocked on one
unsolved user-facing bug and carrying two known-unfixed defects.

**Track B — the sprite forge.** **Stranded on `brute-ragnarok-sources`: 26
commits ahead of main, 11 behind, pushed to origin, worktree already deleted.**
Deliberately unmerged, with the reason stated in `4a6a774`: *"merging art tooling
that has not produced art is how the 08-07 drop happened."* Its own
`HANDOFF_2026-08-08.md` leads with the unblock command.

**Track C — documentation.** The `/documentation` chapters were last verified
**2026-08-05 against `57b0511`** and describe only the forge and the character
builder. Three days of WebGPU / instancing / WGSL / glass / blank-screen work has
no chapter at all. `HANDOFF.md` is 254 KB / 4560 lines and absorbed all of it.

### Branch inventory — 13 of 14 are already merged

```
brute-ragnarok-sources          26 unmerged   <-- the only real one
tmp-cn                           1 unmerged   <-- ControlNet-Union manifest entry, 08-04
everything else                  0 unmerged   (12 local + 5 remote, all fully in main)
```

Plus one **prunable worktree stub** pointing at a deleted `/tmp` scratchpad.

---

## 2. The checklist

### P0 — decisions that unblock everything else

- [ ] **P0.1 — Decide what to do with `brute-ragnarok-sources` (26 commits).**
      It is not one thing. Split it:
      - *Pure tooling/bug fixes, independent of the art question* — the runaway
        `/forge` poll loop (5.6 GB in one renderer), the leaked headless browsers
        (9 GB), the host-browser close fix, the glibc retained-RSS trim, the
        pixel-lattice check that was written `pass: true` and could never fail,
        `?resolve=`, the panel throwing away its own failure reason. **These have
        no bearing on whether the art is good and are all bug fixes to a tool we
        use every session.**
      - *Art tooling that has never produced accepted art* — `--loop`, the
        `walk4` preset, `⟳ all angles`, the guard's page-cache drop, the reaper's
        signal-handler half. The commit message labels every one of these
        **written but never exercised**. These are what the "do not merge"
        applies to.
      - It is **11 behind main** — merge `main` in first, do not fast-forward.
      - `1cc67f8 fix(dungeon): the tavern's black screen had no way to report
        itself, and no end` is on this branch and may bear on P0.2. **Read it
        before doing P0.2.**

- [ ] **P0.2 — `/dungeon` is blank for the site owner. Still unsolved.**
      Top user-facing issue. Read `docs/dungeon-blank-screen-investigation-2026-08-07.md`
      **first** — do not re-run its green rows, there are a lot of them.
      Next steps in the order the doc ranks them:
      1. **Check the Edge profile mtimes before anything else.** The last session
         burned twelve hours because every test drove Chrome and the owner uses
         Edge.
      2. Dark Reader 4.9.129 with `<all_urls>` injection — the only candidate
         that survives the private-window result. Unconfirmed.
      3. Copy the owner's Edge profile, drive it over CDP, **get their console** —
         which was never obtained.
      4. Restore a WebGL2 fallback so a browser without WebGPU degrades instead
         of blanking (`src/render/WEBGPU_ONLY_HANDOFF.md`).
      ⚠️ Harness traps: a **headed** window sits on the owner's desktop and eats
      their keystrokes, and automation never performs a user gesture.

- [ ] **P0.3 — Settle the WSL cap while the box is freshly booted.**
      The 32 GB cap fixed the host freeze (peak 46.2 vs 62.5 guard) but **moved
      the constraint inside**: no Wan `animate` completes — the VAE decode drops
      WSL available to 0.7 GiB and the guard soft-interrupts. 1024²/21f and
      640²/17f die identically. The Qwen leg is fine (~19 GiB spare).
      The right cap is a **function of the Windows baseline, which is not a
      constant** — 27.3 GB on a long-uptime desktop, **14 GB fresh-booted**.
      WSL is minutes old right now, so measure it *now*:
      ```
      powershell.exe -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem) | ForEach-Object { ($_.TotalVisibleMemorySize-$_.FreePhysicalMemory)/1MB }"
      ```
      Then pick a cap with the real number, and **re-record it in `.wslconfig`'s
      comment** — the last drift lasted three days because `guard.mjs` was
      retuned and `.wslconfig` was not.

### P1 — finish what is half-done on `main`

- [ ] **P1.1 — Restore the `renderer.init()` fix.** `2d61bde` routes all seven
      init sites through a helper that catches, retries and surfaces a notice.
      `createGPURenderer` nulls `_getFallback`, so `init()` **rejects**, and every
      site except `main.ts` was `void renderer.init().then(...)` with no catch —
      a refused adapter leaves `rendererReady` false for ever and the present gate
      skips every frame in silence. **Proven by fault injection.** It was reverted
      (`da040da`) only because the owner asked for a known-good baseline, not
      because it was wrong. `git revert da040da` restores it plus its 160-line test.

- [ ] **P1.2 — Kill the 4–5 concurrent rAF loops on `/dungeon`.**
      `src/main.ts:591` starts `animate()` at boot and it never stops, so the site
      renderer presents an empty scene every frame *underneath* the game.
      Measured as callbacks per frame tick. **This is the answer to "why is the
      CPU pinned".** Unfixed, and nothing depends on P0.2 being solved first.

- [ ] **P1.3 — Settle the booster-instancing frame time. The box is idle RIGHT
      NOW and that is perishable.** Three interleaved A/B pairs disagreed:
      p50 5.6→4.8, 6.3→5.5, **6.2→6.2**, with the null pair's p95 nearly doubling
      (contamination, not regression). Wall-clock fps swung 38→97 on the same
      build. Every measurement so far shared the machine. Do this before anyone
      else takes threads.

- [ ] **P1.4 — One-line fix in `scripts/draw-census.mjs:46`.** The census prints
      `renderer says 0` every run because it reads `renderer.info` from an
      out-of-frame `page.evaluate()`, after three's per-frame `info.reset()` and
      before the next frame's draws. The counter itself works — the playtest
      profiler gets 349/389 off it. Written down and left undone.

- [ ] **P1.5 — Sweep the roster for tell-clip mismatches** (generalise
      `hound.test.ts`, which currently derives the clip demand for the hound
      only). What the sweep already shows on inspection, to be confirmed:
      - `leaper` → `crouch`: hound only. **Fixed `97eb184`.** `crouch` has **no
        painter fallback** — this is the class that fails silently.
      - `strafer`/`ambusher` → `wake` (wisp, sapper): `cel-painter.ts:301`
        synthesises `wake` for any actor that has not authored it, so these
        degrade rather than vanish. Worth *looking at* rather than only testing.
      - `packhunter` → `wait`: **no kind in `MOVEMENT_BY_KIND` uses
        `packhunter`.** A whole movement policy with zero users. Assign it or
        write down that it is a shelf item.

- [ ] **P1.6 — `floor-density.test.ts`'s `liveFloor()` harness drift** — no
      `rollModifier`, no `stampSecretBands`. The **last of four** harnesses that
      did not build the floor that ships; the other three are fixed.

### P2 — cleanup the repo has been deferring

- [ ] **P2.1 — Collapse `HANDOFF.md`. The blocker is gone.** It has been
      prepended-not-collapsed for five-plus sessions with the same stated reason:
      *"`bdb-mapgen` and `bdb-mobile` are live worktrees in this repo right now."*
      **They are not.** `git worktree list` shows one prunable stub and nothing
      else; `feat/mobile-touch-controls` does not exist in any ref, and
      `fix/map-generation-rules` survives on origin. Nothing is at risk of being
      deleted. 254 KB → chapters.

- [ ] **P2.2 — Bring `documentation/chapters/` up to `main`.** Currently "last
      verified 2026-08-05 against `57b0511`". Missing entirely: the WebGPU
      migration and one-renderer-type invariant, the draw census + part
      instancing, WGSL-in-files and the turbopack `raw` → `undefined` loader
      trap, the glass system, the `buildMaze` crash that shipped green, and the
      blank-screen incident. Also **stale**: open item 6 says two source PNGs are
      dirty in the working tree — the tree is clean.

- [ ] **P2.3 — Retire the root plan docs.**
      - `CHANGES.md` (May) documents `src/main.js`, `WebGLRenderer`, mobile
        antialias and jungle-room staggered mount. **None of that describes this
        repo any more.** Delete or fold the still-true parts into a chapter.
      - `MAP_PLAN.md` says in its own header *"Live plan — delete this file when
        both tracks ship"*, and warns about becoming the fifth un-retired plan
        doc. Check both tracks and act on it.
      - `LOAD_PLAN.md` (07-27) — same question.

- [ ] **P2.4 — Branch and worktree cleanup.** `git worktree prune` for the dead
      stub, then delete the 12 local + 5 remote branches with **0 unmerged
      commits**. Keep `brute-ragnarok-sources` until P0.1 is decided; decide
      `tmp-cn` (1 commit — the InstantX ControlNet-Union manifest entry, which is
      chapter 04's "Native 2511 ControlNet" lever) on its own merits.

- [ ] **P2.5 — Fix or delete `npm run lint`.** `next lint` was removed in Next
      16 and there is no eslint flat config, so the script is a **gate that reads
      as real and runs nothing**. Either add `eslint.config.mjs` or remove the
      script; a broken lint command in `package.json` is worse than none.

- [ ] **P2.6 — Root debris** (all gitignored, so cosmetic): `build_output.log`,
      `build_output2.log` (May), `.black-screen-probe{,2}.mjs`, `.freeze-probe.mjs`,
      `.scratch/venv`, stale `dist/`.

### P3 — known art gaps, unchanged since 2026-08-05

Carried from `documentation/chapters/03-open-items.md` and `04-not-built-yet.md`.
Listed so they are not rediscovered; none is a today item unless the art call is
today's work.

- [ ] `frog-E` and `stiltneck-E` are **front views published under an E label** —
      a mirror cannot fix a front view; they need `/forge` rotate.
- [ ] The E walk cycle plays at **half speed** — 6 frames against S/N's 3 at one
      fps, and no `beats` declared.
- [ ] Co-op peers render **marble rides as a walk cycle** — `MIRRORED_CLIPS` in
      `render/remote-party.ts` should use `isRideClip()` instead of its own list.
- [ ] `__dungeonClips("player")` returns null — resolves through
      `SHEET_KEY_BY_KIND` and `"player"` is not an `EnemyKind`.
- [ ] **Partial sheets play the painter for what they omit** — jester 5/18,
      zombie 6/18, rotortail/croaker/fish_feet 8/18, and the **brute is 3/18
      S-only with no death row**. The 08-07 three-facing drop (`417d043`) was
      rejected on sight and reverted by `7035534` — *both of which live on
      `brute-ragnarok-sources`, so `main` never carried either.*
      `docs/PLAN_KEYFRAME_PIPELINE.md`, also on that branch, is the replacement
      approach: prompt → master → keyframes → cut → inbetween, with a pixel gate
      on the **raw** generation rather than after the commit.

---

## 3. Suggested order for today

1. **P1.3 first** — the box is idle and that is the one thing that cannot be
   scheduled. It is a short A/B and it settles a claim the handoff has twice
   refused to state.
2. **P0.3** while the boot is fresh — one measurement, then a cap decision.
3. **P1.1 + P1.2 + P1.4** — three small, independently-proven fixes on `main`
   with no dependency on the blank-screen mystery. Ship them together.
4. **P0.1** — read `1cc67f8`, then split the forge branch into "bug fixes" and
   "unexercised art tooling" and merge only the first half.
5. **P2.1 + P2.2** — collapse `HANDOFF.md` into the chapters it should have been
   written into, which is also how (3) and (4) get documented.
6. **P0.2** only with the Edge-profile check done first.
