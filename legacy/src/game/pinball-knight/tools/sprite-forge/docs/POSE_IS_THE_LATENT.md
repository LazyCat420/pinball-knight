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

Related: `ANY_IMAGE_TO_CHARACTER.md` §6.2 (`drift.ts`, the `distinct` gate),
`comfy/modes.mjs` (`keyframes`, `retarget`), `comfy/cli.mjs` (`retarget`'s note on
canvas aspect).
