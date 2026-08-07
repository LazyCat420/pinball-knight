# TSL → WGSL: what converts, what cannot, and what it buys

Everything below was verified against three r185's source or measured on the real
GPU. Where a claim is inferred rather than checked, it says so.

## 0. The short answer

**TSL is not an alternative to WGSL. It is a graph that compiles to WGSL**, and on
the WebGPU backend that compiled WGSL is the only thing the GPU ever sees.

It is also not optional. `WebGPURenderer` rejects a raw `THREE.ShaderMaterial`
outright — *"Material ShaderMaterial is not compatible"* — and renders a black
screen while the game keeps ticking. Node materials are the only accepted input.
`wgslFn` is the escape hatch, and it takes **one function**, not a shader.

**Converting buys readability, not speed.** Measured (`npm run playtest:gpu`, real
GPU, three consecutive runs identical to the µs):

| | 1920×1080 | 1280×720 |
|---|---|---|
| GPU, all six passes | **0.79 ms** | 0.39 ms |
| ├ scene | 0.33–0.39 ms | 0.20 ms |
| ├ post composite | **0.39 ms** | 0.20 ms |
| └ bloom ×3 | 0.066 ms each | |
| FRAME total (CPU) | 6.6–9.3 ms | 6.0 ms |
| `pixelPass.render` (CPU submission) | **5.7–7.6 ms** | 4.9 ms |

Shaders are ~10% of the frame; submitting them is ~85%. And the node builder emits
**flat SSA — 188 non-trivial assignments in the 1758-line composite, none computed
twice** — so hand-writing removes no codegen waste. Dump it yourself with
`__dungeonShaders()` or `scripts/tsl-wgsl-dump.mjs`.

## 1. The split

The dividing line is *"is it a binding, or is it maths?"*

| Stays TSL — no exceptions | Moves into the `.wgsl` |
|---|---|
| `uniform()` — a `.wgsl` file cannot declare a binding | the per-pixel arithmetic |
| `uv()`, `positionWorld`, `normalWorld` — varying accessors | branches, loops, helpers |
| `texture(...)` sampling | anything expressible as a pure function of its params |
| `material.colorNode = …`, blending, MRT, `alphaTest` | |

### Sample in TSL, pass the sampled value in

A `wgslFn` **can** declare `texture_2d<f32>` / `sampler` params — verified at
`WGSLNodeFunction.js:53-73` (the type table), `NodeBuilder.js:1575-1578`
(`isReference`) and `TextureNode.js:557-563` (a reference output generates the bare
binding name, a `sampler` output appends `_sampler`).

**Do not.** Taking the raw handle means re-implementing three's flip-Y, its
wrap-mode polyfills, its colour-space decode and its mip selection by hand.
`src/shaders/glass/glass-material.ts:679-706` settled this the right way: sample in
TSL, hand the resulting `vec3 backdrop` to `fn.shade({ …, backdrop })`. Follow that.

## 2. The contract every `.wgsl` file obeys

Stated in full at `src/shaders/jungle-organics.ts:12-40`, enforced over every
`.wgsl` in the tree by `src/shaders/wgsl-contract.test.ts`:

1. **The file opens with `fn`.** `WGSLNodeFunction.parse()` anchors its declaration
   regex at index 0 of the trimmed source, so a leading comment throws *inside*
   `renderer.render`. This is why the prose about a shader lives beside its
   **import**, not at the top of the file it describes.
2. **One function per file**, named after the file. Everything after the first
   declaration is emitted verbatim; a second `fn` is an unbound extra, and one
   called `main` collides with three's own `@fragment fn main` and the pipeline
   never builds.
3. **Parameters bind by name.** A key the signature does not declare is dropped and
   filled with `float(0)` — three raises a `THREE.` error (`FunctionCallNode.js:159`),
   but the surface still renders black rather than failing the build.
4. **Includes dedupe by node identity**, not by text, so build each helper once and
   share it. Building `wgslFn(HASH_WGSL)` per call site declares the function twice.

Loading is wired in four places that must agree — see `src/types/wgsl.d.ts`.

## 3. The one genuinely new capability

`${shaderData.codes}` is interpolated at **module scope**, above `@fragment fn main`
(verified, `WGSLNodeBuilder.js:2557-2582`). Combined with rule 2's verbatim tail, a
`.wgsl` file may legally carry module-scope declarations *after* its function:

```wgsl
fn paletteSnap( c: vec3<f32> ) -> f32 { /* a real loop over PAL */ }

const PAL = array<vec3<f32>, 32>( vec3f(…), … );
```

A compile-time constant table with a real loop over it. TSL cannot express this:
`uniformArray` exists but turns folded constants into uniform-buffer loads, and a
LUT texture quantises the input. If the screen-space palette snap is ever revived,
this is the form — with a mirror test against `PALETTE_HEX` in the contract test,
because the palette would then live in two places.

**Never legal in a `.wgsl` file:** `@group`/`@binding`, `enable` directives, `override`
constants, a second entry point.

## 4. MaterialX noise is a copy, not an art re-tune

The elemental shaders reach `mx_noise_float`, `mx_fractal_noise_float`,
`mx_fractal_noise_vec3` and `mx_worley_noise_float` through
`src/game/pinball-knight/fx/elements/noise.ts` (7 call sites; the six element files
have none directly).

It is tempting to assume porting these means rewriting noise by hand and re-tuning
every effect by eye. **It does not.** Three defines them as TSL
`Fn(...).setLayout({ name, type, inputs })` (`nodes/materialx/lib/mx_noise.js:610-652`),
and `WGSLNodeBuilder.buildFunctionCode` (`:1435-1465`) emits exactly that as a
standalone named WGSL function. So the port is: **dump the generated WGSL and lift
the functions verbatim** — the compiler's own output, bit-identical semantics.

Two things break identity if you are careless:

- `mx_noise_float` / `mx_worley_noise_float` are `overloadingFn` dispatching on vec2
  vs vec3. The dump only contains the overload the graph used. Every call site here
  passes vec3 — confirm from the dump, do not assume.
- `mx_fractal_noise_*` takes `octaves` as an `int` from JS and loops on it. In the
  dump that bound is a **literal**, because the JS value was constant. Preserve the
  per-call-site bounds (2, 3, 4 depending on caller) or the amplitude sum changes.

The chain is ~25 functions: `mx_hash_int` → `mx_gradient_*` → `mx_perlin_noise_*` →
`mx_fractal_*` → `mx_worley_*`.

## 5. What WGSL unlocks that TSL does not — the honest list

Checked against `three/src/Three.TSL.js`'s export surface before claiming anything is
impossible. Already **in TSL**: `textureGather` (`TextureNode.gather()`), subgroup ops,
atomics, storage buffers, compute, workgroup memory, `bitcast`, `countOneBits`,
`dpdx`/`dpdy`/`fwidth`, `textureLoad`, `textureSize`, pack/unpack 2×16, `Loop`,
`If/Else`, `Switch`, `uniformArray`.

Reachable **only** through `wgslFn`:

1. **Pointer parameters** — `ptr<…>` maps to `'pointer'` and the call emits `&arg`.
   TSL's `Fn` has no out-parameters.
2. **Module-scope `const` / `var<private>` arrays** — §3, the one that matters.
3. **Statement-level control** — `let` vs `var`, explicit `select` vs a branch, loop
   shape, and functions the reader chose rather than the ones `setLayout` produced.
4. **`pack4x8unorm` / `unpack4x8unorm` / `pack4xI8`** — TSL exposes only the 2×16 family.

**`wgslFn` does not unlock a class of GPU work.** It unlocks a way of writing it.

## 6. So what is worth converting?

Of ~116 lines of actual maths across the six element shaders (in 870 lines of file —
the rest is prose and factory boilerplate), **one candidate pays**:

`fx/elements/water.ts:128-141`. `H(p)` is a plain JS closure called **six times** —
once directly and five inside the central-difference gradient — so ~24 transcendental
evaluations get inlined into the graph at each site.

**Try `Fn().setLayout()` in TSL first.** It emits the same single WGSL function, with
no new files and no port risk. Compare the two dumps before writing a `.wgsl`.

Do not convert fire, frost, goo, molten or rod. Read them with the comments stripped:
12–17 lines of arithmetic each, already legible. Converting them costs a MaterialX
lift and a visual-regression campaign per effect, and buys nothing measurable.

## 7. If you want the frame faster, look here instead

Not at shaders. `__dungeonDraws()` (`dev/draw-census.ts`, driven by
`scripts/draw-census.mjs`) attributes the draw calls, reimplementing three's own cull
because `Object3D.traverse` walks children of an invisible parent and
`_projectObject` skips the subtree — the difference between 753 meshes and 248 draws.

Floor 1, seed 42, 1080p: **248 camera draws (+35 shadow), 505 culled.** Pinball parts
are **130 of them**; boosters alone 66.

**Merging them does not work — measured, 130 → 124.** A booster is 6 meshes and 5
carry `stdOwn` materials the animator pokes individually (each chevron has its own
wave phase). A mesh that animates cannot be merged, so the thing that makes parts
expensive is the thing that forbids merging them. Cutting that 130 means moving the
animation **into the shader** — one instanced pad with the wave driven by a
per-instance attribute, the way `fx/pools/particle-pool.ts` and `fx/puffs.ts` already
do it. That is a redesign of the part builders, not a wiring change.
