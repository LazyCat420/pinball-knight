# Parallel development and integration

Each developer owns a branch and worktree. Shared files can still produce Git
conflicts; the integration owner resolves those conflicts before release.
Separate worktrees prevent one developer's uncommitted edits or dependency
installation from changing another developer's files.

## Current integration

- Integration branch: `fix/shared-author-release`.
- Worktree: `.worktrees/wt-shared-author-release`.
- Imported committed batch: `feat/maze-pipeline` at `26664121`, including the
  merged monster additions and main through `295efdd1`.
- Published follow-up: `origin/main` at `14cdc544` adds Milkshake. Merge commit
  `3fc6c0f9` preserves it alongside the earlier monster batch.
- Maze batch: `d8ab8444` shares live authoring, repairs excess ambient density,
  and includes the earlier corner/shuffle fixes.
- Clockwork and intro batch: `5b1966d9`.
- Worktree and release coordination: `8aafc39b`.
- Resolved overlaps: retain Cigarette and all three Clockwork variants in the
  sprite inventory; combine Milkshake with all existing sheet keys and enemy
  kinds; retain pinned pnpm 11.8.0 and frozen dependency installation.
- The user authorized deployment of this integration while the other developers
  continue working. Published Sumo Ninja commit `80791fd4` was merged as
  `3a49bc2f` to preserve its already-public sprite. Release this checkpoint;
  later developer batches can be integrated separately.

## Working agreement

1. Create a named branch/worktree from the agreed base. Do not reuse another
   developer's directory or its node_modules.
2. Announce the files or subsystem you are changing. Coordinate ownership before
   editing shared rosters, manifests, dependency files, or deployment scripts.
3. Commit a finished batch and provide the branch and exact commit for handoff.
4. The integration owner reviews the diff, merges it into the integration
   worktree, resolves overlapping intent, and runs combined checks.
5. Only the integration owner builds/releases the shared NAS image. The project
   wrapper serializes these actions with a lock in the common Git directory and
   installs dependencies once before starting parallel test shards.
6. Deploy after the user's release hold ends. Check the container, public health
   endpoint and actual browser build before reporting success.

No developer's working directory is reset or deleted by this workflow. Conflicts
are resolved in integration, and feature branches retain their original commits.

## Validation of the integration checkpoint

- Production build at `3fc6c0f9` passed (367 modules). Vite reports its existing
  large-bundle warning.
- All 18 Clockwork and new-monster manifest/PNG pairs match their source files
  byte for byte in the production output, including Milkshake.
- The updated production build reached gameplay in a browser with Clockwork
  visible, only the HUD/toasts open, no script exceptions and no failed network
  requests (browser build `2026-09-07T05:47:42Z`).
- Full suite at `3fc6c0f9`: **326 test files passed, 5 skipped; 3,881 tests
  passed, 12 skipped; zero failures**. The completed run exited 0 in 479.75s.
  Earlier command sessions were interrupted by SIGTERM; the final independent
  run completed and wrote its JSON report and exit status.
- The release wrapper passed shell syntax validation. A held lock in the Git
  common directory caused a second release invocation to stop before building.
  Older developer checkouts must adopt this wrapper for mutual exclusion.
- This was the initial integration validation; the completed release is recorded
  below.

## Completed NAS release

The user lifted the deployment hold and requested the integrated game for testing.
The project deploy-kit wrapper released `e4ff8dcc` on 2026-09-06 at 23:55 PDT
(2026-09-07 06:55 UTC), including the Sumo Ninja merge.

- All release tests passed: 327 files passed, 5 skipped; 3,889 tests passed,
  12 skipped; zero failures.
- Docker build passed in 191 seconds. Image transfer completed in 9 seconds;
  the NAS container restarted and reached `running / healthy`.
- Both NAS and public `/health` endpoints returned `healthy`.
- Built-image, NAS and public `index.html` files matched byte for byte.
- All 19 relevant public sprite manifests and PNGs matched the source files.
- Public browser build `2026-09-07T06:54:55Z` reached gameplay with Clockwork
  visible, HUD/toasts open, no script exceptions and no failed network requests.
- Previous image retained as `pinball-knight-web:previous` for rollback.

Play: https://pinballknight.braindeadbot.com/

## Six-Armed God & Crawling Hand Released to NAS

- Commit: `4aa5b82f`.
- Merged `main` (`860c9638`), cleanly unifying:
  - **Six-Armed Indian God ("Mahadeva Asura")** boss with mouth fire stream (`mouthFire`) and 6-arm dagger volley (`daggerVolley`).
  - **Crawling Hand** monster with grab-and-pin mechanic.
  - All sprite forge assets, manifests, and tests for both entities.
- Zero conflicts: `boot/lazy-sheets.test.ts`, `boot/sheets.ts`, `boss.ts`, `spawn/factory.ts`, and `state.ts` resolved cleanly.
- Full sharded test suite passed: 334 test files across 3 shards (zero failures).
- Docker release image built, transferred via SSH to Synology NAS, and container restarted to `running / healthy`.
- Both NAS (`http://10.0.0.16:8789/health`) and public (`https://pinballknight.braindeadbot.com/health`) endpoints verified healthy (HTTP 200).
- Windows release executable ready at `dist/pinball-knight-windows-x86_64/pk-game.exe`.

Play: https://pinballknight.braindeadbot.com/ (Local NAS: http://10.0.0.16:8789)



## Intro and tavern loading release handoff

- Branch: `fix/intro-tavern-loading`, worktree `.worktrees/wt-intro-tavern-loading`.
- Base: `8c67adb0`; includes the completed Six-Armed God/Crawling Hand merge.
- Fix commit: `cd96423c`; removes tavern monster backfill, moves required art
  loading behind visible descent progress, and preserves all intro phases.
- Follow-up corrects the new boss fallback death frames and arm shading, plus
  the Crawling Hand debug label, after the full release gate exposed failures.
- Focused regression tests and production browser checks passed; follow-up
  integration suites passed all 63 tests. Full release gate is being repeated.
- Merged the other owner's released monster corrections and handoff `bd1f28b9`
  via `376af872`, preserving their exact fallback painter and short label.
- Released `b9c68ff2` on 2026-09-07 at 00:57 PDT; full suite passed (332 files,
  3,919 tests; 5 files / 12 tests skipped). Build, transfer and restart succeeded.
- NAS runs healthy at `b9c68ff2`; NAS/public health and image/NAS/public HTML
  equality verified. All 21 checked public sprite pairs match source bytes.
- Public build `2026-09-07T07:57:11Z`: complete intro, zero tavern monster
  imports, and successful first-floor gameplay without script/network errors.
- Release wrapper now explicitly unlocks on exit to prevent orphan SSH agents
  from retaining its descriptor. Adopt this wrapper before subsequent releases.
- This branch is the latest verified NAS release and must be integrated before
  another branch releases, to preserve the intro and tavern loading correction.
- Other developers' worktrees and uncommitted work have not been modified.

## Recovery from a divergent follow-up release

The NAS was subsequently overwritten by `0e60c8cc`, whose ancestry omitted the
Clockwork Knight, cinematic intro, maze integration, and tavern correction.
The previous release verification was accurate at its completion, but the
project-local lock did not protect against a later release from an older branch.

- Recovery merge: `0a6a2634`, preserving the complete release plus the latest
  Buddha debugger fix and Fry Sentinel transparency correction from `main`.
- Shared deploy-kit guard: `d1cdb39`. It runs for Pinball Knight even from older
  project wrappers, requires both the integrated baseline and running NAS commit
  in the candidate's ancestry, checks the actual image label, and blocks release
  if the NAS cannot be verified. It also provides the common release lock.
- Regression checks: all 12 guard tests passed against real divergent Git
  history. The actual regressing revision `0e60c8cc` was rejected; recovery
  `0a6a2634` passed against the running NAS. All 31 focused game tests passed.
- Recovery deployed at `63d9def9` on 2026-09-07 at 01:22 PDT. Full suite:
  333 files passed / 5 skipped; 3,924 tests passed / 12 skipped; zero failures.
- Public browser build `2026-09-07T08:22:26Z` played all seven cinematic phases
  and entered the tavern with zero monster imports and no script errors.
- Clockwork Knight was explicitly selected and reached active dungeon gameplay;
  the character identity and screenshot were checked, with no script or network
  failures. All 21 relevant public sprite pairs match the source bytes.
- Image, NAS and public HTML match; NAS is running / healthy at `63d9def9`.
- Remote `main` was fast-forwarded from `0e60c8cc` to `d2e6f5ca`, including the
  complete game and a wrapper check that refuses an outdated deploy-kit without
  `release-guard.sh`. This host-only wrapper change needs no new container image.
- Confirmed the guard rejects both the regressing branch `0e60c8cc` and the
  previously good release `b9c68ff2` against the restored running release.
- Shared deploy-kit `master` is updated locally to `d1cdb39`. Pushing that
  separate repository to its configured origin returned “Repository not found”;
  the guard is installed and active on this deployment host. The Pinball Knight
  main push succeeded. Other hosts must install the updated shared kit; the new
  game wrapper fails closed if the guard is missing.

## Level 5 boss disappearance fix — 2026-09-10

- Feature branch `fix/level5-boss-disappearance`, worktree `.worktrees/wt-level5-boss`,
  completed fix `66c2faff` (based on main `59421a32`).
- Root cause: Reaper King teleport fallback returned unchecked coordinates when
  all eight candidates failed. On generated level 5 maps, those coordinates
  overlap solid walls, leaving a living, unreachable guardian and a locked exit.
  Reproduced by failing regression tests on seeds 1, 777, and 12345.
- Fix: require full body clearance, cancel when no safe destination exists, and
  recheck the landing after wind-up. Cancel teleport state on disengagement so
  it cannot block walking home; clean the old tell on a phase transition.
- Regression coverage includes real level 5 map candidates, blocked teleport
  fight-to-exit completion, and disengagement during a teleport wind-up.
  All 29 focused boss tests passed.
- Dedicated release branch `release/level5-boss`, worktree
  `.worktrees/wt-level5-boss-release`, based on running release `a68f4065`.
  Only the completed fix was cherry-picked as `b0b76e9f`; unrelated newer main
  features were not included in this release.
- Existing project deploy-kit wrapper/guard/lock: full suite passed, 350 files
  passed / 5 skipped, 4,106 tests passed / 12 skipped, zero failures. Production
  image build, transfer and NAS restart succeeded.
- Verified NAS `b0b76e9f` running/healthy; public and NAS health endpoints healthy.
  Image, NAS and public HTML hashes match exactly.
- Isolated muted public browser (multiplayer networking blocked) entered level 5,
  kept the Reaper King present through several attack cycles, then killed it via
  the normal damage hook. Exit reported `locked: false` and `haulShown: true`.
  Zero script errors. Future releases must preserve `b0b76e9f`.

## Fluid armored knight — completed batch (2026-09-11)

- Branch `feat/fluid-knight-animation`, worktree `.worktrees/wt-fluid-knight`.
- Ready for integration: articulated rigid-armor bone hierarchy; two-bone leg
  IK; distance-driven walking/running with heel/toe motion; continuous turning
  and pose transitions; authored diagonal, reverse and heavy sword motions tied
  to actual combat timing; breathing, recoil, and helmet-removal arm IK.
- Dungeon and tavern supply achieved travel and the simulation clock. The intro
  uses the same rig. Existing physics and attack hitboxes remain unchanged.
- Added standalone `ThreeJS/scripts/knight-motion-preview.html` for motion review.
- Validation: 46 focused tests passed, production build passed, no new TypeScript
  diagnostics in changed files. Muted browser verified tavern and dungeon walking,
  light attacks, all seven intro phases and return to tavern, with zero script
  errors. Recorded slow-motion walking/running and three sword variants.
- Integrate this committed batch onto verified NAS release `035a23b6`, preserving
  the newer Fry Sentinel changes; run the project release gate before publishing.

### Fluid knight release verification

- Completed feature commit `af2d4861`; merged onto verified NAS `035a23b6` in
  dedicated branch `release/fluid-knight-animation`, release commit `1e8971f7`.
- Project deploy-kit wrapper with release lock and ancestry guard passed:
  355 test files passed, 5 skipped; 4,160 tests passed, 12 skipped; zero failures.
  Production image build, transfer and NAS restart succeeded.
- NAS `1e8971f7` reports healthy. Public and container `/health` return healthy.
  Public and NAS HTML SHA-256 match:
  `5ed6426ca6da58941ae87478c0d5cf65d3cb9b533163ea7827c343108d4dcf85`.
- Future releases must preserve `1e8971f7`. Shared main and other developers'
  branches were not changed by this task.

## Forged armor and full-body rolling — completed batch (2026-09-11)

- Branch `feat/forged-knight-roll`, worktree `.worktrees/wt-forged-knight-roll`,
  based on the verified fluid-knight release and its documentation `12c9be32`.
- Ready for integration: six-view generated armor reference and prompt; custom
  curved plate geometry, articulated armor details, updated selection portrait;
  live full-body tuck/tumble/ball and chrome-ball transformations with recovery.
- `roll`, `ball`, and `steelball` now stay on the live 3D layer. Distinct magical
  marble and ricochet artwork, gameplay physics and damage timing are preserved.
- Validation: 38 focused tests passed; no changed-file TypeScript diagnostics
  (existing unrelated repository diagnostics remain). Muted browser confirmed
  all three gameplay roll/ball clips hide the old sprite, recovery stays live,
  and all seven intro phases return to tavern, with zero script errors.
- Workshop recording includes the new armor, walking, tuck, continuous tumble,
  chrome transformation and recovery. Full project release gate remains required.

- Follow-up ready for integration: preserve the current tumble orientation when
  a new roll interrupts recovery. The added regression and all 12 focused motion/
  live-layer tests pass; this avoids snapping to zero rotation mid-transition.

### Forged knight validation and release status

- Feature batches `b7c7fe7b` and `b8bfc372` integrated into dedicated
  `release/forged-knight-roll`, candidate `f666fdab`, containing NAS `1e8971f7`.
- Full local suite: 4,162 tests passed, 12 skipped, with one fresh-worktree
  fixture-order failure in `sandbox-death-runtime.test.ts`. The existing sprite
  inbox test subsequently generated `work/goblin-S/S-death3.png`; rerunning the
  failed test passed without changing its assertions or supplying substitute art.
- After the rotation-continuity follow-up, all 13 targeted tests (motion, live
  pixel layer and goblin death runtime) passed. Final ordinary Vite build passed.
  No unresolved test failure remains. The deploy wrapper will rerun the full gate.
- NOT DEPLOYED: automatic approval review rejected NAS deployment because it
  requires explicit integration-owner designation. Earlier publishing requests
  and standing deploy-after-validation instructions were supplied to review;
  the ownership rejection remained. No release lock or guard was bypassed.
- Awaiting user authorization to act as integration owner for this completed
  release. Current verified NAS remains `1e8971f7`; other developers' worktrees
  and the shared main checkout were not edited. Test browsers and Vite stopped.

## Compact HUD and automatic chrome pinball — completed batch (2026-09-11)

- Branch `fix/compact-hud-chrome-ball`, isolated worktree
  `.worktrees/wt-compact-hud-chrome-ball`, ready for integration.
- UI presentation and pointer coordinates share a 0.9 density factor. HUD/text
  are 10% smaller; floor-map clearance uses the actual scaled HUD footprint.
- Style kills update one 168×20 notice instead of stacking four 260×30 cards.
  Floating combos are smaller, capped at three and correctly converted from
  projected grid coordinates into the zoomed UI. Center banners are smaller.
- Full pinball `ball` mode now blends into polished chrome without a potion;
  the slower `roll` keeps the articulated body tumble. Studio reflections make
  the sphere read as metal. Speed ghosts sample the live 3D layer and inherit
  its world transform, eliminating old sprite frames in the trail.
- 186 focused UI/rig/VFX tests passed; production Vite build passed. No changed-
  file TypeScript diagnostics. Muted browser verified compact HUD, menu open/
  close, automatic ball mode, and every sampled ghost using the live texture;
  zero script errors.
- NAS advanced to `c9bd868b` during development (animated tavern keepers and maze
  merchant). Integrate this committed batch onto that verified release before
  running the full deploy gate; preserve all its content.

### Compact HUD / chrome pinball deployed — 2026-09-11

- Feature handoff: `a0f4c793`, `8b4dc061`; release `49503fd2` on `release/compact-hud-chrome-ball`. Preserves deployed NPC release `c9bd868b` and maze atlas performance fix `77b61be4`.
- Full release gate: 4,188 tests passed, 12 skipped; 360 test files passed, 5 skipped. Docker build, transfer, restart and release guard succeeded through the existing deploy wrapper.
- NAS container verified `49503fd2`, healthy. NAS and public HTML SHA-256 both `48556dde4a1df97681985c1aeb68fd2bd7ce2e7524407ba9c89b1e67df530ea0`.
- Muted browser checks: compact single style-combo card, HUD scale 1.8, Escape menu, automatic ball and live-character trail; final chrome workshop and public gameplay reported no JavaScript errors.

### Camera pullback — 2026-09-11

- Branch `fix/camera-pullback-20`: reduce every saved camera rung to the nearest even PPU to old PPU / 1.2; default 56 -> 46 shows 21.7% more corridor. HUD scaling stays independent. Engine fallback matches the default.
- Validation: 48 tests passed across sprite scale, render sizing, engine config mirror and atlas sizing; diff check passed. Ready for release integration with the deployed HUD/chrome fixes.

### Camera pullback deployed — 2026-09-11

- Feature `a5ed5a0c`; integrated release `a6626512` includes deployed Doppelganger boss `a02c784f` and all earlier HUD/chrome/NPC/performance changes.
- Full release gate passed: 4,194 tests, 12 skipped; 361 test files passed, 5 skipped. Existing deploy wrapper completed image build, NAS transfer and restart. NAS `git.sha=a6626512`, healthy.
- Public and NAS HTTP responses match SHA-256 `1333a3247a10cf9615ab6588771b3a55f43dc418b622c6427446a99264895eaa`.
- Muted browser visual validation: 1280x944 shows 27.83 tiles across at PPU 46 (previously 22.86 at 56); HUD zoom remains 1.8; no JavaScript exceptions. Test-owned browser and loopback preview stopped.

### Live player camera controls — 2026-09-11

- Branch `feat/live-camera-zoom`: Options camera row has bounded Zoom Out / Zoom In buttons, applies immediately, persists the existing cameraZoom setting, and adds Panorama / Overview (PPU 32 / 24).
- Live camera multiplier is selected PPU / boot PPU; projection and camera snapping honor zoom, while atlases remain intact. New cameras reapply the preference; reload bakes the saved PPU with the same framing. Live resampling prioritizes immediate framing over rebuilding atlases mid-run.
- Validation: camera projection and new-camera restoration tests plus Options reachability passed (8); existing render sizing, sprite scale, atlas and config checks passed (50, including the two new zoom rungs). Ready for integrated release validation.

### Blaster Frank likeness and natural rig — 2026-09-12

- Task branch `fix/frank-natural-rig`, isolated worktree `.worktrees/wt-frank-natural-rig`, based on NAS/main `f69aba55`.
- Full articulated shoulders/elbows/wrists and hips/knees/ankles; two-bone leg solve, opposing arm arcs visible from the front, smooth torso/head counter-motion and delayed coat/wrist motion.
- Refined bald hairline, nose, cheeks/chin, eyes and glasses; removed the moustache for a closer Frank Reynolds likeness.
- Rebuilt all three gameplay atlases. Walk now has 24 samples over the original eight beats, retaining walk/run cadence; fallback art and attack/death timing retain their existing rates.
- Focused rig/combat/cadence checks passed (37 tests across four files); production build passed. Rig checks cover all facings, loop closure, clip reset, hand arcs, joint articulation, attack and death framing, and matching published PNG/manifest hashes.
- Release integration and full gate pending below.

#### Frank rig release verification

- Feature `fca507f8`; integrated with the incoming loading-screen release on `main`, deployed revision `2f1979b0`.
- Combined focused checks: 50 tests passed; production build passed. No TypeScript diagnostics in changed files; existing unrelated repository diagnostics remain.
- Full guarded release: 372 files passed / 5 skipped; 4,312 tests passed / 12 skipped; zero failures. The first fresh-worktree attempt exposed deploy-kit's ignored Canvas install script; rebuilt the local native Canvas dependency and reran the complete gate successfully.
- Muted isolated browser: front/side/back animated previews and actual dungeon Frank spawn, 24 walk frames and `{walk:8,run:8}` beats, no JavaScript errors. Multiplayer connections were blocked during local gameplay validation.
- Existing deploy wrapper completed Docker build, image transfer, and restart. Verified NAS `2f1979b0` running/healthy and both NAS/public health endpoints healthy. All six public Frank PNG/JSON files match the integrated source bytes exactly.
- Main integration pushed; later loading-screen comment-only commit preserved. Test-owned browser/server stopped and this worktree's generated test reports restored.

### Tilt Titan shark face and varied power-up spins — 2026-09-12

- Task branch `fix/titan-shark-spin`, isolated worktree `.worktrees/wt-titan-shark-spin`, based on NAS/main `2fb28366`.
- Round red eyes with focused dark pupils; broad interleaved triangular shark teeth; spherical mouth surface keeps teeth visible and avoids clipping during full-body rotation.
- Three closed multi-axis quaternion paths: tornado precession, curved corkscrew, and tumbling spin. Charge selects a non-repeating random path once per activation and keeps it through rev/release. All 32-frame loops preserve the original base cycle and acceleration; charge telegraph, collisions, damage and movement remain intact.
- Rebuilt S/N/E atlases and added all paths to the animated preview. Fallback painter retains usable attack art for every variant. Bake runner tolerates the browser's initial execution-context race.
- 27 focused rig, charge, debug-spawn and real-animator cadence/death tests passed. Muted front/side/back browser previews had no JavaScript errors. No changed-file TypeScript diagnostics (existing unrelated diagnostics remain).
- Ready for integration and the full guarded NAS release gate.

#### Tilt Titan release verification

- Feature `be6c68be`; integrated and deployed `0a4b2c27`, preserving NAS/main `2fb28366`. Main merge pushed.
- Full release gate: 376 files passed / 5 skipped; 4,349 tests passed / 12 skipped, zero failures. Guarded Docker build, image transfer and NAS restart completed.
- NAS `0a4b2c27` running/healthy; both public and NAS health endpoints healthy. All six public Titan PNG/JSON files exactly match the integrated source.
- Muted isolated gameplay loaded 32 frames in all three spin clips and exercised tornado, corkscrew and tumble during real boss charges. Zero browser exceptions. Preview server and test browser stopped; local test-generated reports restored.
## 2026-09-10 — armored pixel knight release

`release/armored-pixel-knight@06ba12cd` is deployed and healthy on the NAS. It contains the armored knight batches (`0526e1b6`, `78a262b0`, cherry-picked as `06986faf`, `e17e7ab6`) plus the verified live slime release `0e569b41`, preserving both updates. The feature worktree is `wt-armored-knight`; release integration is isolated in `wt-armored-knight-release`. Full release validation passed 4,145 tests with 12 skips. See [the armor rendering notes](art/armored-knight.md) for behavior and verification.
