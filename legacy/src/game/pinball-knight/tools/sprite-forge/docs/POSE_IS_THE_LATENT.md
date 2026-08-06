# Pose is the latent

**Measured 2026-08-05 on the real adapter — 5 runs, ~40 min GPU on the 3090 Ti,
driving `comfy/cli.mjs edit` against the shipped `inbox/zombie-E.png`.**
The task was a new `brute`: a giant crazy zombie, built from the zombie sheet.
It is not shippable yet, and the reason is worth more than the art would have been.

## Three failures, one cause

Three separate roads have now lost the pose, and they were treated as three problems:

| road | what was handed over | result |
|---|---|---|
| `keyframes` | four poses named in a SENTENCE | rows came back 97-99% identical |
| `retarget` | a pose ROW as a second reference image | identity transferred, pose never did |
| `edit` (this run) | the pose row as the image BEING EDITED | four identical front-facing statues |

The third one is the tell. If pose is lost even when the model is editing the very
image the poses are drawn in, the problem was never the prompt, the reference, or
the layout. It is the graph.

`qwenEdit` builds `EmptySD3LatentImage` and samples at `denoise: 1`. Every image
in that graph — `image1`, `image2`, `image3` — enters through
`TextEncodeQwenImageEditPlus` as **conditioning**. Nothing about an init's
geometry is binding on the sampler, which starts from pure noise every time. The
word "init" in the panel means "the thing the prompt talks about", not "the thing
the sampler starts from". Three roads, one empty latent.

## The dial that was never exposed

`qwenEdit` now takes `denoise`. Below 1 it scales the init to the requested canvas,
`VAEEncode`s it, and samples from THAT latent instead of from noise — structure
from where the sampler starts, identity still from the conditioning. On the CLI:

```
node comfy/cli.mjs edit --init row.png --ref character.png \
  --canvas init --denoise 0.72 --prompt "..."
```

`--canvas init` derives the output canvas from the init's own aspect (a 4-pose row
asked for on the square default returns a GRID — the same aspect rule `retarget`
already documents). `--ref` rides a second image in as Figure 2.

## What the dial actually does

All five runs: same row, same seed (11), same prompt family.

| run | init | denoise | ref | pose | brute bulk |
|---|---|---|---|---|---|
| 1 | idle row | 1.0 | — | **lost** — 4 identical front statues | **excellent** — a real hulk |
| 2 | idle row | 0.6 | — | **kept** — 4 distinct side strides | none — the original skinny zombie |
| 3 | idle row | 0.8 | brute | **kept** | none |
| 4 | row pre-widened ×1.5 | 0.72 | brute | **kept** | only the width already drawn in |
| 5 | row tapered ×2.0 at the shoulders | 0.72 | brute | **kept** | only what was drawn in, and blockier |

Runs 1 and 2 are the whole finding. **Pose and silhouette are the same
low-frequency information in the latent.** A denoise low enough to hold the pose
is also low enough to hold the build, and a denoise high enough to rebuild the
body throws the pose away with it. There is no value in between that keeps one
and changes the other, and runs 3-5 say so from three directions: adding an
identity reference does not move it, and neither does pre-drawing the bulk into
the init.

Run 5 is worth calling out because it is the one that looked most likely to work.
Widening the figure before the encode puts brute proportions into exactly the
place structure comes from — and the model kept them and declined to resolve them
into muscle. Above the pose threshold the sampler **re-renders** the latent's
silhouette; it does not reinterpret it. The prompt and the reference reach the
surface — flesh tone, rot, teeth, shading — and stop there.

## What this means

For the brute specifically: the art from run 1 is genuinely good and completely
unusable, because a monster needs `idle` before it draws at all
(`importedPaints` requires it) and four identical frames animate as a freeze —
which is what `drift.ts`'s `distinct` gate exists to catch.

The next lever is the one the pose-library commit already named, and it is now the
only one left standing: **structural conditioning the sampler is bound to**
(ControlNet pose / lineart / depth) with the row as the control image. That is the
one mechanism that separates the two signals this measurement just proved are
fused — it constrains where the limbs are without constraining how wide the body
is. It is a `graphs.mjs` build plus a model install, and it should be A/B'd on
pixel art before it is trusted, exactly as the manifest note says.

Do not re-run the five above. Re-read this.

## Round two: the painter as the init, and the surface does not move either

**2026-08-05, same session.** The obvious answer to "the sampler invents neither
pose nor bulk" is to hand it an init that already has both — and the PAINTER is
exactly that source, free and at any resolution. `scripts/brute-init.mjs` renders
any painter's clips to per-clip rows on the magenta key for this.

It does not work either, and the reason completes the picture. Run 6: the painted
brute's own 4-frame walk row at denoise 0.75, asked only to repaint the surface as
rotting pixel-art flesh. It came back as **the painter's flat cel art, essentially
untouched** — no texture, no rot, no pixel detail.

So the dial is not "structure below, surface above". Below the pose threshold the
sampler re-renders the latent *entirely*, surface included; above it, it discards
the latent entirely. There is no band where structure is kept and appearance is
restyled. `denoise` on this graph is closer to a crossfade between "copy the init"
and "ignore the init" than to a structure/detail split.

What DOES work, and is worth keeping: at denoise 1.0 with a painted brute cell as
the conditioning image, the model returned an excellent giant zombie brute that
visibly descends from the painter (green flesh, spurred pauldrons, belly wound).
Identity conditioning is real. It is only ever ONE pose.

## The Wan leg is the right tool, and it is currently blocked

The frog in `sources/frog-2026-08-05` shipped through `animate` — Wan I2V, a
VIDEO model, which is the only leg here that generates genuine motion. That, not
qwen, is how a new creature gets animated.

Three attempts (21, 17 and 9 frames, 640², ~8 min each) all died the same way:

```
execution_interrupted  node_id: dec  node_type: VAEDecodeTiled
```

**SOLVED, and the first diagnosis was wrong.** It was the RAM guard all along.
I ruled the guard out because `~/comfy/guard-tripped.json` was never written —
but **only `hardStrike()` writes that file; `softStrike()` interrupts silently.**
The absence of that file is not evidence the guard stayed out of it, and treating
it as evidence cost two more failed runs. `guard.log` had the answer the whole
time, one strike per attempt:

```
SOFT (wsl 1.1GiB available) — interrupting + dropping cached models
SOFT (wsl 0.7GiB available)
SOFT (wsl 0.8GiB available)
```

The guard was right. The box genuinely was out of system RAM at decode.

**The real driver is not the decode — it is ComfyUI's own retained RSS.** After
9h47m and a long run of qwen jobs, the python process held **13.1 GB RSS with
every model already unloaded** (the `purge` node frees the VRAM; the host
allocator keeps the pages). That left ~20 GB against a decode that wants ~19, so
the transient hit the guard's 1.2 GiB floor. Frame count made no difference —
9 frames failed identically — and neither did dropping the decode tile to 64,
which is the tell that the batch was never the term that mattered.

**The fix is a restart, not a knob.** Stopping the stale server returned
20.4 → 31.5 GiB available (an 11 GB reclaim, exactly the retained RSS). On the
fresh server the same job ran first try: **17 frames in 307s**, identity held
end to end.

So: before a Wan run on a long-lived server, bounce ComfyUI. `tileSize` is now a
caller knob anyway (it did not fix this, and it is not the lever to reach for
first). And when a forge job dies with a bare `execution_interrupted`, read
`guard.log` before theorising — it names the cause in one line.

Related: `ANY_IMAGE_TO_CHARACTER.md` §6.2 (`drift.ts`, the `distinct` gate),
`comfy/modes.mjs` (`keyframes`, `retarget`), `comfy/cli.mjs` (`retarget`'s note on
canvas aspect).
