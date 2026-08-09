# Incidents

Diagnoses that outlive their patches. Write the reasoning, not just the fix.

## 2026-08-09 — SwiftShader WebGPU fails 4-byte mapped buffers

Headless WSL Chrome with `--use-webgpu-adapter=swiftshader` panics the wasm
build in `createBuffer`: *"size (4) is too large for the implementation when
mappedAtCreation == true"*. Instrumenting every `createBuffer` showed only
3.3 MB total allocated, 0.1 MB of it mapped, before a **4-byte** mapped
allocation failed — and the same call succeeds on a fresh device. Not memory
pressure, not our textures (reproduced with ÷8 sheets): a SwiftShader defect
in mapped-buffer allocation after ~35 buffers of Bevy device setup.

**Rule:** SwiftShader cannot smoke-test this Bevy app at all — it isn't just
wrong-perf, it's wrong-correctness. All wasm verification goes through real
Windows host Chrome over CDP (`legacy/scripts/lib/host-chrome.mjs`, same infra
the TS playtest used). That path verified the slice end-to-end the same day.

## Inherited from the TS era (so the port doesn't relive them)

- **2026-08-08 — "A port that deletes ships green."** A sub-phase 6/7 "native
  WebGPU" conversion in braindeadbot-client deleted the renderer and room art
  it claimed to port; new tests certified the stubs; it shipped live and was
  reverted (`7937bfe`). Lesson for THIS port: parity fixtures against the
  legacy oracle, in the same PR as the ported code — a green suite over stubs
  proves nothing unless the suite is the oracle's.
- **Inbox sidecar vs published manifest.** Two JSON shapes; conflating them
  fails silently (loader falls back to the painter with no error). `pk-assets`
  now owns both shapes in the type system.
- **WSL GPU mirages.** SwiftShader (headless) and WSLg/llvmpipe render
  wrong-perf truth; every GPU timing must come from Windows host Chrome or a
  host-native build.

*(new incidents go above this line, newest first)*
