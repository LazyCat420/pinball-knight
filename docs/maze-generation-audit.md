# Maze generation audit and expansion plan

Audit date: 2026-09-06. Scope: the ThreeJS game, including outer side walls,
internal corners, pinball furniture, and the path toward larger procedural floors.
The Rust implementation is a separate parity project and was not audited here.

Follow-up: the user authorized fixing the release blockers and deploying on
2026-09-06. See the release follow-up at the end; findings below retain the
original audit's before-change evidence.

## Findings before changes

The game already has a track-first generator, reservations, doorway clearways,
arc backing checks, and a wall-run compiler. Extend those components. Adding
another independent corner detector would increase the existing drift problem.

| Priority | Finding and evidence | Consequence | Action |
| --- | --- | --- | --- |
| P1 | `spawn/floor-authoring.ts` passes `wallLook() !== "legacy"` into `decorateMaze`. The option changes `grid.shapes`, which collision reads. Existing `wall-grammar-veto.test.ts` confirms that the option removes shapes. | Players with the same seed can get different collision geometry from a URL/localStorage visual preference. | Make the placement policy common to all looks; test the actual `authorFloor` output under every look. |
| P1 | `track-carve.ts:growMazeAround` randomizes directions with `.sort(() => rng() - 0.5)`. A comparator that changes its answer consumes different RNG draws under different sort implementations. An isolated L1/seed1 probe produced different tile hashes and 54 versus 51 parts under Node 24.14.1 and 26.1.0. | Seed reproduction depends on the JavaScript runtime, which can also affect co-op clients. | Replace random-comparator sorting with a seeded Fisher–Yates shuffle in the next generator revision, then migrate and validate the seed corpus. A temporary bundled probe of that replacement gave identical tile/shape hashes and 52 parts on both runtimes. This migration is **not** included in the corner-only patch. |
| P1 | `decorate.ts:assignCornerShapes` defines an `opp` diagonal for each concave corner and promises a 2×2 open pocket, but never reads `opp`. | Tight doglegs can receive a corner treatment intended for wide pockets. | Require the far diagonal in all four orientations; test narrow and wide pockets. |
| P2 | Corner backing uses `!isWalkable`, accepting breakable/cracked tiles as permanent backing. | Breaking a support can leave an unsupported curved wall shell. | Require full, ordinary wall tiles for both backing legs. Preserve existing multi-tile arcs. |
| P2 | Shape rules V1/V2 already reject curves in wall-run interiors and on one/two-tile fragments, but the default live look disables them. | Small fragments receive rounded ornament; long wall surfaces become segmented. | Enable the existing rules as the common generation default. Keep render styling independently selectable. |
| P1 | Baseline tests: 333 passed, 14 failed across 7 files. Twelve seed fixtures differ in their combined tile/shape hash (named `tileHash`). `piece-rules` also finds chute side leaks on 5/150 raw floors and 2/30 decorated floors. Decorated examples: L1 Great Hall seed 21986 at (3,23), L6 Cavern seed 27992 at (19,21). | Current baseline cannot certify a clean generator. Some chute doors preserve connectivity by design; sealing them blindly could strand floor pockets. | Retain failing evidence. Follow up with explicit chute access-port metadata and zero *unexplained* breaches. Do not raise tolerances or regenerate fixtures to hide failures. |
| P2 | Live generation calls `authorFloor`; `maze/floor-plan.ts:buildFloorPlan` has no live caller despite its “authoritative” description. `testkit/live-floor.ts` and `regression-census.ts` also reconstruct simplified pipelines. | Different tools can audit different floors for the same seed. | Consolidate onto a pure authoring core in phase 2, preserving RNG order. The more complete `dev/headless-floor.ts` already has live parity tests and is the preferred interim harness. |
| P2 | `sockets.ts` promises one straight socket per run but emits a socket at every straight tile; `piece-contracts.ts:validatePiecePlacement` has no production callers and accepts missing runway measurements. | The proposed reusable placement system is not yet an enforced contract. It cannot be treated as protection for future modules. | Before adopting sockets, merge straight runs, require measured clearance, enforce symmetric conflicts, and wire the validator into placement. |
| P2 | Default wall rendering uses per-tile legacy panels; `wall-runs.ts` already provides deterministic side ownership, junction roles and cap masks for alternative looks. | A structurally continuous wall can still look like disconnected blocks. | Compare the existing `runs` treatment with the fixed geometry in-game; keep one owner per wall tile and shared geometry for rendering/collision. |

Baseline command: `npm test -- maze/wall-runs.test.ts wall-grammar-veto.test.ts
piece-rules.test.ts piece-contracts.test.ts floor-plan.test.ts
regression-census.test.ts track-fallback.test.ts` (347 tests, 93.91 seconds).
This is a targeted baseline, not the complete repository suite. The seed
snapshot mismatches were present before this audit's changes. Runtime-dependent
random sorting is now a confirmed contributor to reproduction differences;
the historical fixtures also need reconciliation with the actual live pipeline.

## Side and corner placement contract

1. Outer perimeter tiles stay solid and square. Shape candidates are interior
   ordinary walls only; cracked walls and arc slices cannot become single-tile corners.
2. A convex end needs two adjacent open sides and their shared open diagonal.
   The other two sides supply permanent square wall backing.
3. A concave corner needs the complete 2×2 open pocket facing it. A one-tile
   dogleg remains square. Evaluate all four orientations with the same rule.
4. Both backing legs must be full ordinary walls and must survive the candidate
   pass. A candidate cannot rely on another candidate or an arc slice.
5. Round/bevel only the end of a useful wall run: reject run interiors and
   fragments of two tiles or fewer. Never alter multi-tile arc ownership.
6. Compile wall sides, exposed caps and junction ownership from the completed
   grid. Each renderable box has exactly one run owner. Style does not choose
   placement, consume generation RNG, or change collision shapes.
7. For future modules, expose oriented entrances/exits, footprint, clearance,
   wall backing, supported widths and allowed rotations. Reserve the complete
   footprint and run-out before committing it. Failed placement returns a
   structured rejection; it does not partly carve a module.

## Implementation sequence

### Phase 1 — corner correctness and deterministic geometry (this change)

Extract the single-tile shape pass into a small maze module; fix the missing
diagonal and permanent backing checks; use the existing wall-run rules by
default; remove the live visual-preference dependency. Add synthetic tests for
all rotations, borders, short stubs, backing and existing arcs, plus actual live
authoring tests comparing tiles, shapes, arcs and oriented parts across looks.
Retain the explicit headless on/off option for historical A/B diagnostics.

This intentionally changes corner collision shapes for newly generated floors.
It must not change the RNG stream, base tile topology or furniture draw order.
Clients in a co-op session must use the same deployed game build. Persistent
replays/save layouts need a generator-version field before compatibility with
multiple generation revisions is promised.

### Phase 2 — one floor authoring core and honest diagnostics

First replace the invalid random comparator in `growMazeAround` with a seeded
Fisher–Yates shuffle. This changes the RNG draw count and rerolls base topology;
it is a separate generator revision, unlike the local shape-only corrections
in phase 1. Run the same corpus under supported Node and browser engines before
accepting new fixtures. Do not combine an unreviewed topology reroll with larger
floor sizing.

Extract pure generation inputs `{seed, level, bonusRoom, config, version}` and
return geometry, endpoints, rooms, doorways, parts and diagnostics. Keep state,
lighting and spawning in the live wrapper. Make live play, preview, census and
tests call that core. Preserve the existing RNG draw order during extraction;
compare complete outputs before removing duplicates. Then replace stale census
fixtures through an explicitly reviewed generation-version migration.

Record stage timing, rejected module reasons, actual part density and relaxed
constraints. Distinguish an intentional chute access port from a damaged sealed
wall; preserve reachability while repairing any unplanned leak.

### Phase 3 — reusable side/corner/module library

Use a shared socket graph for straight runs, turns, junctions, room thresholds,
launch lanes and returns. Wall rendering owns edge/cap geometry; gameplay
modules bind to compatible sockets. Start with straight bank, 90° bank,
dead-end spring, doorway, and room-corner rail modules. Specify exit direction,
minimum swept-ball clearance, legal mirrored variants and conflict radius.
Validate placement order independence and rotated/mirrored fixtures before
enabling each module. Migrate one existing placement pass at a time.

### Phase 4 — larger connected regions

Use the existing mega-floor harness to establish timing/memory/render baselines
at current size, 2× area and 4× area. These measurements are required; this audit
does not claim larger floors have been profiled or proven fast enough.

Allocate regions and connection ports first, reserve main routes and module
footprints second, then fill local mazes. Scale population by reachable area and
route length, with regional caps. Introduce independent deterministic RNG
streams only with a new generator version, so adding a room does not reroll all
other content. Add spatial lookup and regional rendering/physics activation
where measured cost justifies them. Test cross-region port alignment, reciprocal
connections, spawn-to-exit reachability and no duplicate boundary owners.

## Acceptance gates

- All four corner rotations obey the same open-pocket/backing rules.
- Side/perimeter walls remain closed; every rendered wall box has one owner.
- A visual setting cannot change tiles, collision shapes, arcs or oriented parts.
- Headless and live authoring agree on geometry and full content for pinned seeds.
- Seed corpus covers every archetype, both size regimes and known failures;
  diagnostics include seed, stage, coordinates and rejection reason.
- Larger-area rollout waits for measured generation, memory and frame budgets.

## Verification and delivery

Phase 1 is implemented in `maze/corner-shapes.ts`, called by the live decorator.
The original rule code was extracted before behavioral edits; the new regression
tests then failed in 10 cases: four narrow pockets, four breakable backing legs,
and two live floor comparisons across rendering preferences. All now pass.

Post-change targeted validation:

- 127/127 passed: corner fixtures, actual live authoring across all three wall
  looks, headless/live parity, and wall-grammar veto sweeps.
- 232 passed and 12 failed in the remaining six baseline files. All 12 failures
  are the previously observed census combined tile/shape-hash assertions. Fixtures were not
  regenerated. The two chute tests passed in this rerun; this change does not
  explain the raw-track result, so the initial leak evidence remains open.
- `npm run build` passed (8.79 seconds), with Vite's large-bundle warning.
- Browser smoke check reached gameplay after the loading overlay closed, on
  seeded floor 1 with a 75×53 grid and 188 shaped tiles. The rendered curved
  bank and connecting side walls were inspected; no JavaScript exceptions were observed during startup. This does not
  establish a frame-rate budget or large-floor performance.

The central NAS registry `vault-service/projects.json` has no Pinball Knight
service entry. The existing project wrapper **does** resolve
`../../deploy-kit/lib.sh`, and the running `pinball-knight-web` container was
located through SSH. Its configured endpoint returned HTTP 200 before deployment.
The scoped deployment command is therefore run from `ThreeJS` using its existing
wrapper: `SKIP_ENV_DEPLOY=true npm run deploy -- --skip-pull`. This static client
does not need the shared service secrets file.

**Deployment blocked:** the wrapper aborted at its full test gate before image
build, transfer or restart. Across 321 files: 3,789 tests passed, 14 failed and
12 were skipped (313 files passed, 3 failed, 5 skipped). The failures were the
12 census fixtures plus two Clockwork sprite checks: sidecar hashes use 16
hex characters while the publication contract expects 12, and the north-facing
walk/run animations are too similar. These sprite failures belong to the earlier
Clockwork changes, outside this corner patch. The gate was not bypassed.
After the abort, the existing NAS container remained healthy; both `/` and
`/health` returned HTTP 200. The local corner fixes are **not deployed**.

Runtime probe details, L1/seed1, current corner patch, same bundled census code:

| Runtime | Tile bytes FNV-1a | Shape bytes FNV-1a | Parts |
| --- | --- | --- | --- |
| Node 24.14.1 | `9c4078d1` | `541ff67a` | 54 |
| Node 26.1.0 | `8d7d7b1f` | `eb8b080c` | 51 |
| Both runtimes, temporary Fisher–Yates probe | `38b93183` | `20c139ec` | 52 |

The first baseline used Node 24; the later default-nvm checks and deployment gate
used Node 26. This matters when comparing the chute sweep results. Both runtime
versions still fail all 12 old census fixtures after the corner patch. The
combined hash also includes shapes, so changing a corner correctly changes that
hash even when the floor tile bytes are unchanged.

## Release follow-up — fixes for the deployment gate

- Replaced the random sort comparator in `growMazeAround` with Fisher–Yates.
  A new regression test substitutes another valid sort implementation and
  requires identical maze tiles and subsequent RNG draws for three seeds.
- Changed `captureFloorSnapshot` to use `authorHeadlessPlan`, whose tile,
  shape, arc and complete part output is checked against live `authorFloor`.
  The census now includes modifier draws, rooms, doorway reservations, secret
  pruning and lamp parts. Its piece validator receives full parts, preserving
  intentional runway exceptions that its reduced reporting format had lost.
- Compared all 12 complete snapshots under Node 24.14.1 and 26.1.0: identical
  outputs, with 2,471 placed parts across the corpus. All exits are reachable.
  Two required chute-side openings are recorded as access ports in the snapshots;
  they are not hidden or silently sealed at the cost of connectivity.
- Migrated the 12 reference JSON/SVG pairs with the explicit generation marker
  `fisher-yates-live-v1`. Fixture tests now compare the complete snapshot and
  require explicit `UPDATE_FIXTURES=1`; a missing fixture is no longer written
  automatically during an ordinary test run.
- Corrected the Clockwork baker and asset test to the existing 12-character
  SHA-256 publication convention. Re-baked all nine sheets with a distinct
  sprint: forward lean, bent pumping arms, larger stride and flight phase.
  Publication, clip-distinction and Clockwork asset checks pass without changing
  their thresholds or adding duplicate-animation exceptions.
- Fixed a wall-stub cleanup error exposed by the new layouts: a plain box with
  an obsolete arc index was incorrectly exempt from cleanup. The exemption now
  requires an actual arc shape. A regression protects both the former rim and
  a real rim that must survive.
- `resealChute` now records a required access port only after its reachability
  callback proves sealing would strand a pocket. The piece validator accepts
  those explicit ports and still rejects undeclared openings. The existing
  150-floor rate limit includes declared ports, so this does not weaken the
  launch-lane quality budget. The 150-floor raw and 30-floor decorated piece
  sweeps pass, as do synthetic port/cleanup regressions.
- Corrected cleanup priority so an authored circuit wins over conflicting loose
  spine furniture. The previous priority order deleted two circuit boosters on
  L12/987654321; the circuit survival gate now passes with its existing limits.
- Made the wall-grammar test capture the actual pre-shape grid. Reconstructing
  that input from the completed floor missed subsequent secret/lamp changes and
  falsely reported an unexplained veto. All 111 circuit and wall-grammar checks
  pass with the original assertions.
- The complete deployment gate passes: 318 test files passed, 5 skipped;
  3,808 tests passed, 12 skipped, zero failures. Docker then exposed a separate
  packaging error: the unpinned pnpm release rejected `--frozen-lockfile=false`.
  The Dockerfile now pins pnpm 11.8.0 (the validated host version) and uses
  `--frozen-lockfile` to install the checked-in dependency versions.

The direction shuffle intentionally changes generated layouts. This release is
a generation revision; players should reload before starting a shared run.
The larger-region work and extraction of one pure authoring core remain future
phases.

### Deployment result

Deployed successfully on 2026-09-06 at 21:46 Pacific. After the full test gate
passed, the corrected Dockerfile built successfully; deploy-kit resumed with
`--deploy-only --skip-pull`, transferred the image over SSH and restarted the
NAS container. No failed tests were bypassed.

- NAS container `pinball-knight-web`: running and healthy.
- NAS and public `/health` endpoints: HTTP 200, `healthy`.
- Public URL: <https://pinballknight.braindeadbot.com/>.
- Browser build stamp: `2026-09-07T04:45:05Z`; image build label:
  `2026-09-07T04:45:33Z`.
- Fresh public browser session reached rendered Depth 1 gameplay after the
  loading screen; no JavaScript exceptions or failed network requests.
- All nine public Clockwork manifests and PNGs match local release files
  byte for byte.

## Shared author follow-up — 2026-09-06

The remaining pipeline inconsistency is fixed by extracting the live sequence
into `maze/author-floor.ts`. `spawn/floor-authoring.ts` now handles run bookkeeping,
co-op setup and lighting, then delegates geometry and content to that author.
The headless plan, mega-floor preview, validated `buildFloorPlan` adapter and
`testkit/live-floor` use the same function. Raw geometry probes and the floor-rule
sweep use its topology stage explicitly, rather than reimplementing RNG setup.
The legacy fallback is also owned by the shared author; track-only diagnostic
adapters still report a declined track as null by their documented API contract.

Before extraction, five complete live captures covered shallow and deep floors,
a bonus room and a forced legacy fallback. Their grids (including surfaces),
full plans, lamps, modifiers, doorways and next eight population RNG draws matched
byte for byte after extraction. These outputs now have permanent digest tests.
The twelve existing census fixtures also passed unchanged after extraction.
Diagnostic parity checks now compare full plans and surfaces, not only part
counts, and the validated adapter requires no piece violations on its corpus.

Running the density gate through the actual live author exposed five failures
that its old helper hid. Four modifier floors had 37–38 spawns per 1,000 walkable
tiles against the existing limit of 28. One Spine floor had 19 marked route parts
among 207 total parts, below the existing 10% route share. A final deterministic
content repair removes surplus ambient spawns and loose furniture. Rooms,
authored spawn anchors, connected machines, chains, routes and puzzle lamps are
protected. It consumes no RNG and records the removed coordinates. The existing
density limits are unchanged. This content correction is distinct from the
layout-preserving extraction and may reduce crowding on affected seeds.

Release checks and deployment verification are pending for this follow-up.

Additional verification:

- 30 focused tests passed, covering the density repair, shared-author digests,
  unchanged census fixtures and mega-floor behavior.
- The eight shared-author checks and three shuffle checks also passed under
  Node 24.14.1, in addition to the Node 26 checks.
- The new author and adapters have no TypeScript diagnostics. A whole-project
  type-check still reports existing errors in unrelated rendering, input-test
  stubs and sprite-forge modules; it is not claimed as a passing check.
- Deployment exposed concurrent pnpm auto-installs racing over `node_modules`
  before a test shard could start. The project wrapper now prepares frozen
  dependencies once in `PRE_TEST` and sets `verify_deps_before_run=error` for
  subsequent scripts. This preserves validation while preventing parallel
  test shards from mutating their dependency tree.
