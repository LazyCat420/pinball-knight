# Next wave — instancing, the assembly placer, and what NOT to build

_Written 2026-07-24, after the perf/assembly wave merged at `fbecb4c`._

Three tracks, in the order they should be done. Every claim about the codebase
below was checked against the source; every performance number was **measured**,
not estimated, and where a measurement contradicted a plan the plan lost.

---

## Track 0 — Play the build first (blocking, ~15 minutes of your time)

Nothing below this line is worth starting until one question is answered:
**is the stutter gone?**

The reported symptom was "lag when I go super fast and interact with multiple
things". That was diagnosed as hitstop stacking (`entities/juice.ts`), not frame
rate, and fixed. If the fix worked, **Track 1 is optional** — it targets
sustained frame rate, which may never have been the problem.

Headless QA cannot answer this. Under swiftshader the game runs at 2-5 fps
regardless of what the code does, so every frame-rate claim in this repo is
reasoning, not measurement.

**What to check, in one run:**

| Check | What it tells us |
|---|---|
| Ricochet fast through a bumper cluster. Smooth, or still stuttery? | Did the juice governor fix it? |
| Does a *single* bumper still feel punchy? | Did the governor over-damp? (It should not — a lone hit is bit-identical.) |
| Descend several floors. Is the pause between floors shorter after floor 1? | Texture cache (~82ms/descent, now paid once) |
| Play one floor for 3+ minutes. Any periodic hitch every few seconds? | GC pauses from the flow field (was 246MB/floor, now 0.1MB) |
| Deep floor (10+), many enemies on screen. Sustained frame rate OK? | Whether Track 1 is needed at all |

If the answer to the last row is "fine", **skip Track 1 and go to Track 2.**

---

## Track 1 — Full sprite instancing (only if deep floors still chug)

### What exists now

- `render/blob-pool.ts` — built, tested (9 tests), **not wired in**. Draws every
  contact shadow as one `InstancedMesh`.
- `render/sprite.ts` — quad geometry, blob geometry and blob material are now
  module singletons shared by every actor.
- Still per-actor: one `Mesh`, one **cloned texture**, one material. At the
  ~175-zombie cap that is ~175 meshes + ~175 textures.

### Why the texture clone is the whole problem

`createActorSprite` clones the sheet texture per actor because **the animation
frame offset lives on the texture object** (`tex.offset.x`, `tex.repeat.x`).
Share one texture and the entire horde animates in lockstep. So instancing
requires moving frame state off the texture and into per-instance vertex data.

### The seam that makes this tractable

`render/animator.ts:126-132` — `apply()` is the **single choke point** where
every actor's frame and flip are set:

```ts
private apply(): void {
  const { flip } = resolve(this.facing);
  const indices = this.indices();
  if (!indices.length) return;
  this.sprite.setFlipped(flip);
  this.sprite.setFrame(indices[...]);
}
```

Everything funnels through `setFrame` / `setFlipped` on the `ActorSprite`
interface. **52 call sites across 5 modules use that interface.** If the
interface is preserved, none of them change — the instanced path can be swapped
in underneath. That is the design constraint for this whole track.

### Grouping: one InstancedMesh per sheet

Sheets are built once at boot (`core.ts:428-441`, ~14 of them) and are per-kind,
plus zombie variants. So the natural grouping is **one instanced mesh per
sheet**, which collapses ~350 draw calls to roughly 15-20. A kind with one live
instance still costs one draw call, so this is a win at horde scale and a wash
for rare kinds — acceptable.

### Verified available in three r185

Checked in `node_modules/three`:

- `Material.onBeforeCompile` — `materials/Material.js:532`
- `InstancedMesh.instanceColor` / `setColorAt` — `objects/InstancedMesh.js:62-67`
- `BufferAttribute.addUpdateRange` / `updateRanges` — `core/BufferAttribute.js:119,181`
  (partial buffer upload — avoids re-uploading the whole instance buffer when
  one actor changes frame)

### Implementation sketch

Shader-chunk details below were verified by reading `node_modules/three/src/`
directly, **not** from forum posts — several widely-copied snippets are wrong
for r185 (see "the vUv trap" below).

1. **`render/sprite-instances.ts`** (new) — an `InstancedMesh` per sheet, with:
   - `InstancedBufferAttribute` **`aFrame` as a `vec4`** — `(u0, v0, uScale,
     vScale)`. Offset *and* scale per instance costs nothing extra over a vec2
     and is the established idiom; flip becomes a negative `uScale`, so it
     needs no separate attribute.
   - `onBeforeCompile` **appending after** `#include <uv_vertex>`:
     ```glsl
     #include <uv_vertex>
     #ifdef USE_MAP
       vMapUv = aFrame.xy + vMapUv * aFrame.zw;
     #endif
     ```
     **Append, never replace the chunk.** Replacing it silently drops every
     other map's UV varying (`vAlphaMapUv`, `vNormalMapUv`…) — harmless today
     since `map` is the only texture, fatal the moment anyone adds an alphaMap.
   - `instanceColor` via `setColorAt` for the damage-flash tint.
   - slot claim/release/recycle, mirroring `blob-pool.ts`'s proven shape.
2. **Billboarding is FREE here — do not write a billboard shader.** The
   orthographic camera never rotates, so the correction is constant. A
   `PlaneGeometry` already faces +Z and an ortho camera looks down −Z: they
   already face each other. Any fixed tilt is baked once with `geo.rotateX()`
   at construction and every instance inherits it. No vertex-shader maths, no
   per-frame CPU rotation, no per-instance quaternion. (The naive
   billboard-in-shader snippets on the forum are also a known trap — they drop
   the per-instance translation and render one visible object.)
3. **`ActorSprite` becomes a thin handle** over `{pool, slot}` implementing the
   same interface. `setFrame` writes `aFrame`, `setTint` calls `setColorAt`,
   `setElevation`/`setBlobVisible` drive the blob pool.
4. **Keep the per-actor path** as a fallback for the intro scene and tests,
   which build sprites with no dungeon around them.
5. **Wire the blob pool** at the same time — it is already built and tested.

### The tint ports over cleanly — verified, not assumed

This is usually the blocker that makes people abandon instancing, so it was
traced through the r185 shader chain: `instancingColor` switches on `USE_COLOR`
in the **fragment** shader (`WebGLProgram.js` ~738), `color_vertex` does
`vColor.rgb *= instanceColor.rgb`, and `color_fragment` does `diffuseColor *=
vColor`. Final colour is `material.color × instanceColor × textureSample` —
**identical multiplicative semantics to the current per-mesh `mat.color` damage
flash.** It is a true drop-in.

Two caveats: `instanceColor` is **RGB only** (no per-instance alpha), and
`setColorAt` does *not* colour-space-convert the way `material.color` setters
do — build flash colours with `new THREE.Color().setHex(0xff0000,
THREE.SRGBColorSpace)` or they look washed out.

### The vUv trap (why old examples fail silently)

three.js renamed `vUv` → `vMapUv` (per-map varyings) around **r151-r152**, so
every atlas snippet written before then is wrong on r185 and fails *silently* —
the shader compiles and renders the wrong frame. Related: r185's `uv_vertex`
uses a `MAP_UV` macro, not a literal `uv`, so hardcoding `uv` only works while
`map.channel === 0`.

**Always assert the patch matched**, because a no-op `.replace()` is the single
most common failure mode here:
```js
if (!shader.vertexShader.includes('aFrame')) throw new Error('atlas patch failed');
```
Also set `customProgramCacheKey` so patched and unpatched materials cannot
collide in three's program cache.

### Texture setup

`NearestFilter` (already used) **plus `ClampToEdgeWrapping`** — the common
example uses `RepeatWrapping`, which bleeds neighbouring atlas cells at frame
edges. Leave `texture.offset`/`repeat` at defaults: `mapTransform` folds into
`vMapUv` and would double-apply.

### Pitfalls to design against

- **Transparency sorting — the material flags matter.** Instanced sprites
  cannot be depth-sorted per-instance (three sorts per *object*, and the horde
  is one object). `alphaTest` sidesteps this entirely because it is a **cutout,
  not a blend**: surviving fragments are fully opaque, so the depth buffer
  resolves ordering order-independently. The configuration must be
  `alphaTest: 0.5` with **`transparent: false`** and `depthWrite: true`.
  Setting `transparent: true` *alongside* alphaTest is the classic mistake — it
  pushes the mesh into the transparent pass and reintroduces the sorting
  problem for no benefit. **`createActorSprite` does exactly this today**
  (`sprite.ts:428-433`: `transparent: true` **and** `alphaTest: 0.5`), so the
  instanced path should drop `transparent`.
  ⚠️ **But verify against the occlusion silhouette before changing it.**
  `createOcclusionSilhouette` (`sprite.ts:517-540`) draws the player through
  walls using `depthFunc: THREE.GreaterDepth`, which depends on what does and
  does not write depth in which pass. Flipping `transparent` moves actors
  between the transparent and opaque passes and can therefore change when the
  silhouette appears. Test the see-through-wall effect explicitly after the
  change; this is a visual regression no unit test will catch.
- **Frustum culling**: an `InstancedMesh`'s bounding sphere covers every
  instance, so it is culled only when *every* sprite is offscreen — effectively
  never. Set `frustumCulled = false` and accept it; the draw is one call
  regardless. `blob-pool.ts` already does this deliberately.
- **Bounding sphere is not auto-updated.** `setMatrixAt` does not recompute it,
  so raycasting against a stale volume misbehaves (the classic symptom is the
  sphere acting "as if at the origin"). Irrelevant if nothing raycasts the
  horde — worth confirming before relying on it.
- **Buffer growth**: `InstancedMesh` count is fixed at construction and
  reallocating must copy existing matrices across, or every live actor
  teleports. `blob-pool.test.ts` already pins that regression. Better:
  **over-allocate** (capacity ~512 for a 175 cap) and drive `mesh.count`, which
  doubles as a free "hide the tail" mechanism.
- **Hiding instances**: there is no native API (three.js issue #30403 was
  closed as *not planned*). Zero-scale matrix is standard and fine at this
  scale; shrinking `mesh.count` genuinely skips work if a dense alive-prefix is
  maintained.
- **Upload cost is a non-issue — do not over-engineer it.** 175 instances × 16
  floats = **11 KB per frame**. `addUpdateRange` exists for partial uploads
  (note `updateRange` was *removed* in r169; ranges accumulate and need
  `clearUpdateRanges()`), but many small `bufferSubData` calls are often slower
  than one full upload at this size. Just upload the whole buffer.
- **Custom vertex shaders break shadows/depth prepass.** `onBeforeCompile`
  patches only that material; shadow maps use `MeshDepthMaterial`, which knows
  nothing about the UV patch. Only relevant if actors cast shadows — they
  currently do not.

### Expected payoff

~350 actor draw calls → **~15-20** (one per sheet), or 1 per sheet actually on
screen. Per-frame cost becomes ~11 KB of matrix upload plus ~8 KB of frame
data — both negligible. Also removes ~175 texture clones, which is GPU memory
as well as draw calls.

### Effort / risk

Largest remaining item. ~1-2 focused sessions. **Medium-high risk** — it touches
what every actor looks like, and a subtle UV bug shows as the wrong animation
frame rather than a crash. Mitigations: the `ActorSprite` interface is
preserved so it can be feature-flagged and reverted wholesale; assert the
shader patch matched; and QA the occlusion silhouette explicitly.

If this ever needs to go further (per-instance culling, sorting, real
visibility), `agargaro/instanced-mesh` is the maintained library that adds
exactly those — worth knowing about rather than hand-rolling them.

---

## Track 2 — The assembly placer (the "plumbing system")

This is the one that answers the original complaint: *"generations look like a
mess or patterns that don't make much sense."*

### What exists now

`maze/assembly.ts`, `assembly-lib.ts`, `assembly-check.ts` — merged, 41 tests.
Authored relative facings that rotate with the shape, typed ports carrying the
ball's travel vector, eight real machines, and the named real-table feel bugs as
build-failing predicates. **Nothing is wired into generation yet.**

### The problem being solved

Parts are placed by 20 sequential passes, and the last three **rewrite what the
earlier ones authored**:

- `polishParts` (`decorate.ts:1262-1272`) **deletes** bumpers closer than
  Chebyshev 3
- runway re-aim (`decorate.ts:2013-2032`) **rewrites facings**
- `breakLaunchDuels` (`decorate.ts:2038`) **rewrites or demotes**

So an authored machine does not survive to the end of the pipeline. Three
incompatible ad-hoc group encodings already exist (`orbit/orbitSeq`,
`bank/seq`, `lane/laneSeq`) — proof the concept is wanted but was never
generalised.

### Decisions already made (confirmed with you)

1. **Reserve-early + narrow exemption.** Assemblies claim their footprint before
   the scatter passes; grouped parts are exempt from de-clumping and runway
   re-aim, but **`breakLaunchDuels` still runs** — it guards a genuine soft-lock
   (a ball ping-ponging between two launchers is unrecoverable, and 54.5% of
   floors used to carry one). Aesthetics yield to authoring; the soft-lock guard
   does not.
2. **Authored relative facings** — already built.
3. **Scope: assemblies + placement coherence**, not the full ROUTE_MATH graph
   rewrite.

### Where it hooks

`core.ts:1492-1497` already demonstrates the exact pattern, for the floor's
one landmark:

```ts
const landmark = stampLandmark(raw, rng, theme);   // priority, wide mortar
const focus = pickFocusCells(raw, rng);
const stamped = stampPrefabs(raw, rng, prefabCount, theme, landmark.claimed, focus);
```

`landmark.claimed` is a `ClaimRect[]` that later stamps must avoid. **The
assembly placer is the same idea one level up**: place machines first, pass
their claims down.

### What the research changed (read before implementing)

Two findings from surveying shipped generators (Enter the Gungeon, Spelunky,
TinyKeep, Diablo 1, Unexplored, Wolverson's roguelike tutorial) that improve
the design as planned:

**1. Place the MOST-CONSTRAINED machine first, not a random draw.** Gungeon
begins final assembly "with the room with the most connections" — the
most-constrained-variable heuristic from constraint satisfaction. A machine
with four typed ports has far fewer legal positions than a two-port lane, so
placing it late means placing it into a space that no longer fits it. Sort the
draw by port count descending. This is the single highest-leverage ordering
decision and it is nearly free to implement.

**2. Author a GUTTER into each machine.** Wolverson's room vaults carry a
1-tile walkable border in the template itself, explicitly to maintain
connectivity. It is the cheapest possible fix for the "stamped structure seals
a corridor" failure — the most commonly reported prefab pitfall. Our
`Assembly.floor` should include that border, or `assembly-check.ts` should
grow a rule requiring one.

**3. Do NOT rotate machines at runtime — mirror only.** This is the pitfall
most relevant to us and the one I would otherwise have walked into. Gungeon
treats orientation as risky enough to *defer* connector choice entirely,
because "picking one with a sensible orientation is vital". Our machines are
gravity- and flow-directional: a ramp has an up-flow. `orientationsOf` already
produces all 8 orientations, and every one is validated — but a machine that is
*mechanically* sensible upside-down is a separate question from one that
*validates*. Recommend restricting the placer's draw to rotations that keep
down-flow sane, and leaning on horizontal mirroring for variety.

**4. A `MustConnect` assertion.** Modular-kit systems flag every connector that
must terminate in a matched port or an explicit cap, and fail loudly in debug
builds — it "catches doorways-to-nowhere before ship". Our port model already
has the data; add the assertion at generation time.

### Steps

1. **`maze/assembly-place.ts`** — draw machines **ordered by port count
   descending** (most-constrained-first), pick an orientation from the
   flow-safe subset, score candidate positions like `stampFrom` does (clash
   test **inside** the candidate loop, not after — that bug is documented at
   `prefabs.ts:553-560`), carve, emit `PinballPartSpot[]` with `AssemblyRef`.
2. **Reserve**: return `ClaimRect[]` and thread it through `stampPrefabs` and the
   corridor deal, so nothing else lands inside a machine. Every subsequent
   tile-writing pass should take the claim map as an **explicit parameter, not
   a convention** — "later passes trample authored content" is a named,
   recurring failure in the literature.
3. **Exempt**: grouped parts skip `polishParts` de-clumping and runway re-aim.
   One field check, three call sites.
4. **Two unambiguous fixes, independent of the above:**
   - `ANCHOR_KINDS` (`prefabs.ts:413-430`) has **no glyph for `booster`**, so the
     canonical ramp→booster→ramp lane cannot be authored as a prefab at all —
     it exists only as a hardcoded loop at `decorate.ts:951-980`.
   - `tilttable` (`prefabs.ts:203-215`) authors a `TTT` target row that emits
     three **loose** targets with no `bank`/`seq` tags, so it silently never
     becomes a functioning bank.
5. **Behind a flag**, defaults bit-identical, so existing floors do not reroll on
   the day it merges (the standing repo rule, `ROUTE_MATH_PLAN.md` Part 8).

### Invariants that must not break

`maze/floor-pipeline.test.ts` pins these; the placer must keep them green:

- every depth on every seed is **buildable and solvable** start→stairs (`:72`)
- **determinism** — same seed and depth rebuild identically (`:124`)
- every floor gets its set piece and usable content (`:94`)
- the exit is not pinned to a corner (`:136`) and is a genuine trek (`:158`)

Assemblies are **carve-only**, like prefabs — that is what keeps reachability
true by construction rather than by a check that must be re-run.

### Effort / risk

~1 session. **Medium risk** — it edits load-bearing generation code, but the
model and validator are already built and tested, and the flag makes it
reversible.

### Track 2b — the upgrade path, once 2 works

Two ideas from the research worth banking now and building later. Neither
blocks Track 2; both make it much stronger.

**Port signatures (the Spelunky trick) — the cheapest variety multiplier.**
Spelunky never validates solvability after the fact; it makes failure
impossible. It plans a solution path, tags each slot with a *type* describing
its exits, then loads any hand-authored template matching that signature.
Because every type-1 template has exits in the same places, **any** type-1
template is substitutable and the path is correct by construction.

Applied here: type each machine slot by its **port signature** (`IN:W,
OUT:E-ramp`). Author several machines per signature. Plan flow in terms of
signatures, then fill each slot with any machine matching it. Chaining becomes
guaranteed rather than checked, and N machines per signature across M slots
gives N^M layouts from a modest authoring budget. This directly addresses the
"repetition with a small prefab pool" pitfall — for scale, Gungeon ships ~300
authored rooms for its *first stage*.

**Cyclic skeletons (Dormans / Unexplored) — the right answer for pinball.**
Tree-shaped generation produces dead ends; a dead end in pinball is a drain.
Cyclic generation instead draws a **loop** with entrance and goal on it, so the
two arcs are alternative routes between the same endpoints, and expansion
inserts nodes *into* cycles rather than branching off them. Pinball flow is
literally cyclic — launch → orbit → return lane → re-launch — so this is
structurally aligned with the mechanic in a way branching generation is not.

The cheap version already exists in the codebase's reach: TinyKeep's
MST-plus-re-added-edges (Delaunay for sensible neighbours, MST as the
reachability floor, then re-add a fraction of discarded edges for loops).
TinyKeep uses 15%; for pinball loops are the goal rather than the garnish, so
that dial wants to be far higher.

**Cap the ambition deliberately.** Unexplored 1 ships ~5,000 rewrite rules and
Unexplored 2 over 20,000 — and Ludomotion published a paper on the resulting
maintenance burden. Take the structural insight (loops-first, mission/space
split), not the general-purpose grammar engine. Dormans' **24 major cycle
types** is the right order of magnitude for a hand-authored template library.

---

## Track 3 — Chunked wall meshes: RECOMMENDED AGAINST (for now)

This was lever 3 of 3 on the repo's own perf watchlist, and I am arguing to
**not do it next**.

**The real finding:** merging the walls into three `InstancedMesh`es (the
deliberate design, documented in `BLUEPRINT.md:483-485`) means their bounding
volumes span the whole floor, so three.js **never frustum-culls them**. The GPU
runs vertex shaders on ~240k triangles while the camera shows under 0.5% of a
cap floor. That waste is real.

**Why not now:**

- The maze is already only **~25-40 draw calls**. Walls are not the draw-call
  problem; actors, torches and parts are ~90% of object count.
- The cost is vertex throughput, not draw calls — and vertex throughput has
  never been measured here, because nobody can measure frame rate headlessly.
- Two likelier causes were just fixed (hitstop stacking, 246MB/floor of GC
  garbage). This may be solving a problem that no longer exists.

**When to revisit:** if Track 0 says deep floors still chug *after* Track 1.
Then the minimal correct version is splitting the wall instanced meshes into
~32×32-tile chunks **at build time** so the existing per-object culling starts
working. Generation stays eager and whole; only submission is culled. This is
explicitly *not* "generate on demand" — see below.

---

## On WFC and Game of Life (the cellular-automata question)

Raised during planning: could Conway's Game of Life / cellular automata drive
cave shapes, monster clustering and ore veins, and could Wave Function Collapse
place the machines?

**WFC is the wrong tool for placing machines.** Its value is emergent local
texture from many small pieces; we have the opposite problem — a few large
pieces whose *global* relationships (this ramp feeds that orbit) are the entire
point. Boris the Brave's summary is the decisive one: *"Because WFC only
constrains nearby tiles, it rarely generates large scale structures, which can
give large levels a homogenous, unplanned look."* Encoding "ramp A must chain
into orbit B" as local tile adjacency is possible and miserable, and it is
exactly the distant-constraint interaction that drives contradiction and
backtracking cost up. Academic assessment is blunter still: exponential
worst-case backtracking makes plain WFC "unsuitable for commercial games" at
scale.

**Where both ARE legitimately useful — as a later fill pass, not a placer:**

- Pre-placing and **locking** tiles is trivially supported in WFC: *"It's very
  easy to fix certain tiles before generation… They then get seamlessly
  integrated."* So the hybrid is: stamp machines, lock those cells, let WFC (or
  cellular automata, or the existing maze generator) fill the **interstitial
  texture** around them. Caves of Qud is the shipped proof — it uses WFC for
  hut/crypt/lair interiors, while zone-level structure comes from other passes.
- **DeBroglie's Path Constraint** forces a path to exist between annotated
  tiles during solving, which is a real answer to WFC's connectivity blindness
  — annotate machine ports and let it guarantee they connect.
- Standard 4-5 smoothing CA (`B5678/S45678`) is the established cave-shaping
  rule; plain Life (`B3/S23`) is tuned for gliders and produces sparse
  disconnected debris, which is the opposite of a playable floor.

**Two hard constraints if this is ever built:** CA output is not guaranteed
connected, so it must be followed by a flood fill that keeps the largest region
(Wolverson's `cull_unreachable_areas` idiom, which converts orphaned floor to
wall) — and that cull **must be gated on the claim map**, or it will happily
delete authored machine tiles. That is precisely the "later pass tramples
authored content" failure.

**Verdict: not scheduled.** It adds geometry and variety to a generator whose
current problem is coherence, not texture. Revisit after Track 2, as a
cavern-archetype fill pass with machines locked.

## Explicitly NOT doing: lazy / chunked generation

The original idea was "only generate the parts of the map we can see". The
measurements kill it:

| Depth | Grid | Decorate | Total CPU |
|---|---|---|---|
| 1 | 15,900 t | 85ms | 102ms |
| 10 | 44,500 t | 151ms | 170ms |
| 20 | 53,732 t | 160ms | 195ms |
| 30 | 53,732 t | 168ms | 190ms |

Generation is **bounded work that scales sub-linearly** — floors grow 3.4× from
L1 to L20 while cost grows 1.9×, because placement is capped by budgets (135
zombies, 80 torches), not by tile count.

And it would cost correctness: the pipeline guarantees every floor is solvable
via **whole-floor flood fills**. You cannot verify a floor you have only
half-generated. Trading occasional unsolvable levels for a fraction of a
190ms one-time cost is a bad deal — especially when the texture cache removed
~82ms of that for free.

---

## Suggested order

1. **Track 0** — play it. 15 minutes, and it decides whether Track 1 happens.
2. **Track 2** — the assembly placer. This is the one that answers the original
   design complaint, and it is independent of all the perf work.
3. **Track 1** — sprite instancing, *if* Track 0 says deep floors still chug.
4. **Track 3** — chunked walls, only if still needed after 1.

Track 2 before Track 1 is deliberate: it delivers visible design value, while
Track 1 optimises something that may already be fine.

---

## Method note (the reusable part)

Three planned optimisations this wave turned out to be worth less than the
static analysis predicted, and one turned out to be a completely different
problem:

- "7.1M distance calls in decorate" — **unreachable**; the loops `break` when
  the budget fills, so the real number is ~400 candidates. The bucketed grid
  bought nothing measurable.
- "the flow field is O(tiles) at 4Hz" — the **CPU time was fine** (1% of a
  frame). The *allocation* was the problem: 246MB per floor.
- "lag when going fast" — **not a performance problem at all**. Deliberate
  game-feel code stacking on itself.

Measure the specific thing before optimising it. A worst-case bound is not a
measurement, and a plausible-sounding cause is not a diagnosis.
