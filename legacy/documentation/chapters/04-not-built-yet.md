# What is not built yet

*Open items* is what is broken. This is what was never built — the road from
here, in the order it should be walked. Each section says what it is for, what
already exists to build it on, and how you would know it worked.

## The Character Builder

One sentence: **a `CharacterBuild` is a durable record naming a master frame, a
camera, a set of facings and a set of clips; a build runs itself to completion on
the existing scheduler, measures every frame it produces, and shows you only what
failed.**

Almost nothing new happens on the GPU. The first version adds **no new
generation modes** — it is orchestration, persistence, measurement and review
over `segment` → `rotate` → `keyframes` → `cut` → `crush` → `stage` → `publish`
→ `ingame`, all of which already work.

### 6.3 The planner route — not started

`app/api/comfy/build/route.ts`. A **planner, not a second scheduler**: it turns a
build into `POST /api/comfy/generate` calls and lets the existing leg-affinity
scheduler order them. Adding a second queue would fight the first.

Order matters and the existing scheduler already rewards it: all 18 keyframe jobs
are the `qwen` leg, so enqueuing them together pays **one** model load instead of
eighteen. Any Wan work belongs after all Qwen work, never interleaved.

The build must **stop at the first blocking gate**. If the S master fails QA, do
not spend ten minutes generating six clips from it.

**Needs first:** open item 3 (surviving a dev-server reload).

**Done when:** a build queued from the panel completes unattended, and its row
states are still accurate after a hot reload mid-run.

### 6.4 The review workspace — not started

A `build` tab: rows × facings, each cell green / advisory / blocked, with the
master as a **ghost overlay** behind the selected cell. Identity drift is
invisible in a single image and obvious against its own reference.

Every repair control already exists — the work is routing them at a *cell*
instead of a *job*:

| control | reuse |
|---|---|
| re-roll one key | `mode:"keyframes"` with a single pose, new seed |
| alternatives | same, batch of 3, pick one |
| masked repair | `MaskEditor.tsx` verbatim → `mode:"touchup"` |
| geometry fix | `op:"reframe"` — free, no GPU, offered first |
| re-run QA | `op:"qa"` + drift — free |

Two invariants: a repair writes a **new revision** and never overwrites an
approved cell; and fixes are offered in **cost order**, free geometry before a
100-second style pass.

**Done when:** a user can cull a build's bad cells without reading a job feed.

### 6.5 A character built end to end — not started

**This has never been run, and the distinction matters:** the knight in
`57b0511` was *repaired*, not *regenerated*. Until a full intake → keyframes →
cut → crush → publish run has been executed through the builder, 6.3 and 6.4 are
untested against real generated art and the drift thresholds have no honest
validation.

**Done when:** an image goes in, ~40 minutes pass unattended, a handful of
flagged cells get culled, and the boot line prints for the result.

## A brand-new monster kind

A published sheet is art. Turning it into a *monster* means nine
compile-enforced tables:

| table | file |
|---|---|
| `STATS` | `entities/zombie.ts` |
| `HP_BY_KIND` | `spawn/factory.ts` |
| `DMG_BY_KIND` | `entities/combat.ts` |
| `MOVEMENT_BY_KIND` | `entities/enemy-rules.ts` |
| `PAIN_BY_KIND` | `entities/stagger.ts` |
| `ENEMY_DROPS` | `reagents.ts` |
| `KIND_INFO` | `bestiary.ts` |
| `KIND_STYLE` | `render/card-styles.ts` |
| `KIND_PORTRAIT` | `render/monster-portrait.ts` |

Plus a `spawnKind` case, a ~8-value constants block, and an art route. Two gates
already catch the rest: `npx tsc --noEmit` for the nine tables, and
`node scripts/hooks/registry-drift.mjs` (~50 ms) for union coverage, biome
weights, portrait agreement, floor-1 atlases and debug-panel spawn routes.

> **A scaffold gets a kind from "does not compile" to "compiles, spawns, drops,
> has a card, drift-clean". It cannot produce a monster anyone would notice was
> added.** `MOVEMENT_BY_KIND` — one of eleven steering modes — *is* the
> creature's identity. `PAIN_BY_KIND` is a ranking decision calibrated off Doom.
> The scaffold must prompt with sensible neighbours and label its output
> "mechanically valid default", never invent.

## Vision-driven planning

Use a Jetson-hosted VLM as a **prompt compiler that emits typed data** — never a
prompt author, and never with authority over geometry.

**Model:** Qwen3-VL-8B-Instruct, AWQ 4-bit, served by vLLM — the path NVIDIA
lists for Orin. Fall back to the 4B if it does not fit.

**Schema:** vLLM's default structured-output backend is XGrammar; pass a JSON
Schema and valid JSON is guaranteed. Keep the schema **flat and shallow with
enums over free strings** — a nested output shape is how a parser silently takes
the wrong sub-object. The validator **rejects rather than repairs**: a malformed
analysis falls back to a generic archetype and says so.

```
CAN influence:  prompt wording, mustPreserve clauses, negatives,
                suggested archetype / clip set / name
CANNOT touch:   target grid, feet anchor, subject height, canvas size,
                frame counts, camera, the required-clip list
```

Two traps to design around, both verified: NVIDIA publishes the Orin support
matrix with an **empty benchmark table**, so measure throughput yourself rather
than assuming; and `llama.cpp` + Qwen3-VL GGUF + mmproj on the Jetson CUDA
backend has a live garbage-output bug — test that path before building on it.

## Consistency work, gated on measurement

Do none of these until a real build has run and been culled. Each is justified by
a number that build will produce.

| lever | buys | cost | gate |
|---|---|---|---|
| **FLF looping** for idle/walk | seamless loops — a hard game requirement the current I2V path cannot guarantee. Also pins in-betweens at *both* ends, halving drift by construction. `WanFirstLastFrameToVideo` is already wired. | a graph change | how many loops visibly snap at the wrap |
| **Per-character LoRA** | the only thing that makes identity survive extreme poses. Dataset is `(master, on-model frame, instruction)` **pairs**, which a culled build produces for free. Note the 2511-specific `zero_cond_t` config param — a 2509 config will not train correctly. | ~2–5 h/character | the measured cull rate: below ~20% not worth it, above ~40% it is the only fix |
| **Native 2511 ControlNet** | 2511 accepts depth/edge/keypoint maps as reference slots without loading the 3.5 GB union — **3.5 GB of headroom back** on a card peaking at 20.4 GB | a bench, no download | three arms: native / union / neither |
| **`comfyui_controlnet_aux`** | `AnimalPosePreprocessor` (AP-10K, 17 keypoints) — the only pose signal that does not assume a biped. OpenPose reads a quadruped's body as a leg. | a node install | whether frogs and bosses stop rotating instead of striding |
| **SAM3 text-prompted rescue** | "the spear", "the antennae" — *rescues* thin features a saliency head amputated, at generation resolution, **before** the reduce | a node install | thin-feature survival through the crush |
| **Nunchaku INT4 (SVDQuant)** | GGUF dequantises every forward pass; SVDQuant runs true 4-bit kernels. Plausibly 2–3× against the measured 260 s baseline. | a bench | **test LoRA fusion first** — this stack leans on three LoRAs, and that is Nunchaku's historic rough edge |

**Not worth pursuing:** IP-Adapter / InstantID / PuLID (face-only, SDXL-era, no
Qwen support — useless for a frog in a helmet); AnimateDiff (superseded by the
Wan 2.2 stack already running); Wan 2.6 (API-only, no weights exist to
download).

## One environmental risk to keep watching

Recent ComfyUI enables **DynamicVRAM** by default, and users report models being
unloaded after every step. The entire cost model here is "pay the family swap
deliberately" — DynamicVRAM makes it happen constantly and non-deterministically,
which would look like an unexplained 260 s → 400 s regression with no code
change. Grep the ComfyUI startup log for `DynamicVRAM`. The
`--disable-dynamic-vram` workaround exists but is slated for removal.
