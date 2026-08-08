/**
 * MODE REGISTRY — every generation task the forge offers, declaratively.
 *
 * The panel is deliberately NOT a ComfyUI mirror: a mode is a task (turn the
 * character, animate it, fix its hand), its `fields` are the few decisions a
 * sprite author actually makes, and everything else — CFG, samplers, sigma
 * shift, LoRA placement — is baked into the graph builders at the measured
 * sweet spots. Re-tuning those belongs in ComfyUI's own frontend against
 * the same server; once a value wins there, it gets baked HERE.
 *
 * One mode = one entry: prompt template, which LoRAs ride along and when,
 * which graph builds, and the coupled quality/fast parameter bundles. The
 * route and the CLI both dispatch through this table, so a prompt tweak
 * lands everywhere at once (they used to be duplicated verbatim).
 *
 * `ctx` is injected by the caller so this file stays import-pure over
 * graphs.mjs (testable without a filesystem):
 *   ctx.has(optionId)   manifest option installed on disk?
 *   ctx.lora(optionId)  its filename relative to models/loras/, or null
 *   ctx.unet(slotId)    the chosen unet filename for a pick-one slot, or null
 *   ctx.fast            use the Lightning bundle (caller verified installed)
 *   ctx.images          uploaded server-side names {init, end, mask, style}
 *   ctx.seed
 */
import { bgRemove, qwenEdit, qwenInpaint, wanI2V, wanTi2v5B } from "./graphs.mjs";

/**
 * Lightning distills change the OPERATING POINT — steps and cfg move
 * together with the LoRA or the output is mush. These are the only two
 * sampler-parameter bundles in the system; they live here so no route or
 * panel can half-apply one.
 */
const QWEN_FAST = { optionId: "qwen-lightning-8step", strength: 1.0, steps: 8, cfg: 1.0 };
const WAN_FAST = {
  highId: "wan-lightning-high",
  lowId: "wan-lightning-low",
  strength: 1.0,
  steps: 4,
  cfg: 1.0,
};

/** Qwen leg: style lock + optional fast bundle → {loras, steps, cfg}. */
function qwenBundle(ctx, { styleLock = true } = {}) {
  const loras = [];
  if (styleLock && ctx.has("tarn59-pixel-style")) {
    loras.push({ name: ctx.lora("tarn59-pixel-style"), strength: 0.8 });
  }
  if (ctx.fast && ctx.has(QWEN_FAST.optionId)) {
    loras.push({ name: ctx.lora(QWEN_FAST.optionId), strength: QWEN_FAST.strength });
    return { loras, steps: QWEN_FAST.steps, cfg: QWEN_FAST.cfg };
  }
  return { loras, steps: 20, cfg: 2.5 };
}

/** Wan leg: pixel-motion adapter (+walk specialist) + optional fast pair. */
function wanBundle(ctx, { walk = false } = {}) {
  const high = [];
  const low = [];
  if (ctx.has("styly-pixel-animate")) {
    const styly = { name: ctx.lora("styly-pixel-animate"), strength: 0.8 };
    high.push(styly);
    low.push(styly);
  }
  // pix3lwalk ships a HIGH-NOISE half only — attaching it low too would
  // double-style the refinement (the f8c2086 lesson).
  if (walk && ctx.has("pix3lwalk")) {
    high.push({ name: ctx.lora("pix3lwalk"), strength: 0.8 });
  }
  if (ctx.fast && ctx.has(WAN_FAST.highId) && ctx.has(WAN_FAST.lowId)) {
    high.push({ name: ctx.lora(WAN_FAST.highId), strength: WAN_FAST.strength });
    low.push({ name: ctx.lora(WAN_FAST.lowId), strength: WAN_FAST.strength });
    return { lorasHigh: high, lorasLow: low, steps: WAN_FAST.steps, cfg: WAN_FAST.cfg };
  }
  return { lorasHigh: high, lorasLow: low, steps: 20, cfg: 3.5 };
}

/** Is the fast bundle actually installable for a leg right now? */
export function fastAvailable(leg, has) {
  if (leg === "qwen") return has(QWEN_FAST.optionId);
  return has(WAN_FAST.highId) && has(WAN_FAST.lowId);
}

/**
 * THE SMALL WAN LEG — TI2V-5B instead of the A14B expert pair.
 *
 * Both quant ids are accepted so a Q6 install is not silently ignored; the
 * caller takes whichever is present, Q8 first because it is the recommended
 * one. `wan22-vae` is in the AND rather than being assumed, because the 2.1
 * VAE decodes 5B to garbage instead of raising — an availability check that
 * omits it would report "5B is ready" for a setup that produces noise.
 */
const WAN_SMALL = { unetIds: ["wan-ti2v-5b-q8", "wan-ti2v-5b-q6"], vaeId: "wan22-vae", steps: 20, cfg: 3.5 };

export function smallAvailable(leg, has) {
  if (leg !== "wan") return false;
  return WAN_SMALL.unetIds.some((id) => has(id)) && has(WAN_SMALL.vaeId);
}

/**
 * The 5B bundle: which weights, and the LoRA list — which is EMPTY, on purpose.
 *
 * `wanBundle` above attaches `styly pixel-animate` and `pix3lwalk`; both are
 * A14B adapters (one applied to both experts, one a high-noise half) and
 * neither can load on a single dense model. Returning an empty list here is the
 * honest version of that, and `graphs.wanTi2v5B` throws if one is passed
 * anyway — the two together mean a 5B run cannot quietly become an unstyled
 * run that nobody notices.
 */
function wanSmallBundle(ctx) {
  const unetId = WAN_SMALL.unetIds.find((id) => ctx.has(id));
  return {
    loras: [],
    steps: WAN_SMALL.steps,
    cfg: WAN_SMALL.cfg,
    unet: unetId ? ctx.fileOf(unetId) : undefined,
    vae: ctx.fileOf(WAN_SMALL.vaeId) ?? undefined,
    /** Surfaced so the panel can say what was given up, rather than it being invisible. */
    droppedLoras: ["styly-pixel-animate", "pix3lwalk"].filter((id) => ctx.has(id)),
  };
}

/**
 * Build a Wan clip on whichever animation leg the request asked for.
 *
 * Both wan modes route through here so the leg choice cannot be made in one
 * mode and forgotten in the other — the drift that this file's header already
 * complains about for prompts.
 *
 * ⚠️ THE SMALL LEG CANNOT PIN A LAST FRAME, AND THAT IS NOT A WIRING GAP.
 * `WanFirstLastFrameToVideo` builds 2.1-format conditioning for the A14B pair.
 * The 2.2 latent path has exactly one node, `Wan22ImageToVideoLatent`, and its
 * schema has `start_image` and no `end_image` — first/last pinning does not
 * exist for TI2V-5B in this ComfyUI. So `inbetween` — step 5 of
 * PLAN_KEYFRAME_PIPELINE, and the step that stops Wan inventing where a motion
 * is going — is A14B-only. Refusing loudly here is the whole point: silently
 * dropping `end_image` would return a free-running clip that LOOKS like an
 * in-between and is exactly the failure the plan exists to end.
 */
function buildWanClip({ image, endImage = null, prompt, extraNegative = null, length, ctx, walk = false }) {
  if (ctx.small) {
    if (endImage) {
      throw new Error(
        "[modes] the small leg (TI2V-5B) cannot pin a last frame — Wan22ImageToVideoLatent has no end_image " +
          "input, so an in-between would silently become a free-running clip. Run in-betweens on the A14B pair.",
      );
    }
    const small = wanSmallBundle(ctx);
    return wanTi2v5B({
      image, prompt, extraNegative, length, seed: ctx.seed,
      unet: small.unet, vae: small.vae, loras: small.loras, steps: small.steps, cfg: small.cfg,
    });
  }
  return wanI2V({
    image, endImage, prompt, extraNegative, length, seed: ctx.seed,
    unetHigh: ctx.unet("anim-high") ?? undefined,
    unetLow: ctx.unet("anim-low") ?? undefined,
    ...wanBundle(ctx, { walk }),
  });
}

const FACINGS = [
  { id: "E", label: "right — E, the authored side", phrase: "right, seen from the side", sks: "right side view" },
  { id: "left", label: "left side (engine mirrors E — for reference only)", phrase: "left, seen from the side", sks: "left side view" },
  { id: "S", label: "toward camera — S", phrase: "the camera (front view)", sks: "front view" },
  { id: "N", label: "away — N", phrase: "away from the camera (back view)", sks: "back view" },
];

/**
 * The move-set preprompts: one entry per base movement a game character
 * needs. `action` is what gets injected into the animate template; `clip`
 * is the game clip the frames land under (stagger is `stumble` never
 * `hurt`; a block maps onto the game's `crouch`). Tune the words HERE —
 * the one-click batch below and the preset dropdown both read this table.
 */
const ANIMATE_PRESETS = [
  { id: "idle", label: "idle sway", action: "standing in place, breathing and swaying gently, an idle animation", clip: "idle" },
  // Walk/run describe MECHANICS, not mood: "walking in place, smooth" reads
  // as "keep everything anchored" and the model glides the feet along the
  // floor (measured on the frog, 08-05). Lift-and-plant language plus an
  // explicit slide ban in `avoid` is what buys visible leg motion.
  {
    id: "walk",
    label: "walk cycle",
    action:
      "walking with a springy exaggerated stride, knees lifting high, each foot clearly rising off the ground and planting down again, a full two-step side-view walk cycle",
    avoid: "feet sliding along the ground, gliding, ice skating, floating, shuffling, legs merging",
    clip: "walk",
  },
  /**
   * THE SAME MECHANICS, FOR AN ANIMAL — because `walk` is written for a biped
   * and a dog was being asked to perform it.
   *
   * The shipped `walk` says "a full TWO-STEP side-view walk cycle", which is
   * bipedal vocabulary. Handed to a quadruped it is not merely unhelpful, it
   * describes a different gait: a dog's walk is a FOUR-beat lateral sequence,
   * and asking for two steps invites the model to animate two of the four legs
   * and let the others follow. "the legs are mismatching how they are walking"
   * was the report, and this is the first thing to rule out.
   *
   * The anatomy clauses are not decoration. A quadruped's front leg bends
   * BACKWARD at the elbow and the hind leg bends FORWARD at the hock, which is
   * the single most common thing generative models get wrong on animals — they
   * draw four identical knees. The extra-leg ban is here for the same reason
   * `avoid` exists on `walk`: it is a failure this family of models has.
   *
   * Kept OUT of `MOVESET` (see `alt`) so the one-click batch does not generate
   * two walks and file both under the `walk` clip.
   */
  {
    id: "walk4",
    label: "walk cycle — four legs",
    alt: true,
    action:
      "walking on four legs in a steady four-beat gait, each paw lifting clearly off the ground and planting down again, " +
      "front legs and hind legs alternating on opposite sides, elbows bending backward and hocks bending forward, " +
      "the spine level and the head steady, a full side-view quadruped walk cycle",
    avoid:
      "feet sliding along the ground, gliding, ice skating, floating, shuffling, legs merging, " +
      "extra legs, five legs, missing leg, bipedal, standing upright, rearing, hopping",
    clip: "walk",
  },
  {
    id: "run",
    label: "run cycle",
    action:
      "sprinting with a forward lean, knees driving high, feet clearly leaving the ground with a moment of flight in each stride, a full two-step side-view run cycle",
    avoid: "feet sliding along the ground, gliding, ice skating, floating, shuffling, legs merging",
    clip: "run",
  },
  { id: "attack", label: "attack", action: "attacking with its weapon, one full swing", clip: "attack" },
  { id: "stumble", label: "getting hit (stagger)", action: "recoiling and stumbling backward as if struck, hurt", clip: "stumble" },
  { id: "defend", label: "defend (block)", action: "bracing defensively, guarding against an incoming blow, hunkering down", clip: "crouch" },
  { id: "death", label: "death", action: "dying and collapsing to the ground", clip: "death" },
  { id: "custom", label: "custom action…", action: "", clip: "" },
];

/**
 * The one-click batch: every base movement, one job each, in this order.
 *
 * `alt` presets are body-plan variants of a move that is already in the list —
 * they target the SAME game clip, so including them would generate two takes
 * and file both under one clip name. They are dropdown choices, not batch
 * entries.
 */
const MOVESET = ANIMATE_PRESETS.filter((p) => p.id !== "custom" && !p.alt);

/**
 * Pose scripts for the keyframe-sheet mode: 4 EXTREME poses per move —
 * the classic animator's keys, not in-betweens. The in-between mode fills
 * the middles later, so these deliberately disagree with each other as
 * much as the move allows; timid keys are what make motion slide.
 * `clip` files the cut cells under the right game clip, like the animate
 * presets do.
 *
 * ── EVERY KEY IS THE SAME CAMERA ────────────────────────────────────────
 * First measured run (frog, 2026-08-05): the four keys came back
 * front-facing → side → three-quarter → front, so the in-between animated
 * a TURN rather than a stride. Asked for "right foot planted far forward"
 * with no camera pinned, an edit model expresses the stride the easiest
 * way it can — by rotating the character. `camera` states the viewpoint
 * once per move and the prompt forbids turning between frames; a walk
 * reads from the side, a death reads better toward the camera.
 */
/**
 * THE CAMERA BELONGS TO THE FACING, NOT THE MOVE.
 *
 * Every move here used to pin its own viewpoint — walk and run from a true
 * side, attack and death from three-quarter — because each reads best that way
 * IN ISOLATION. In isolation is the problem: the game does not play one clip,
 * it cuts between them, and a creature that walks in profile and attacks in
 * three-quarter visibly teleports the moment combat starts. Every contact sheet
 * looked perfect while the sheet as a whole was broken.
 *
 * So the viewpoint is a property of the facing being built. An E sheet is
 * side-on for idle AND attack; an S sheet faces the camera throughout. It costs
 * the attack some drama and buys two things: the creature never pops, and every
 * cell in a facing becomes geometrically comparable — which is what lets
 * `drift.ts` compare them at all. A drift metric across mixed cameras measures
 * the camera.
 *
 * ⚠️ MIRRORED IN `build-plan.ts` as `CAMERA_BY_DIR`, because that file is
 * TypeScript and this one is plain ESM the route imports directly — neither can
 * import the other without dragging a build step into the generation path.
 * `camera-sync.test.ts` asserts the two agree, so a change here that is not
 * echoed there fails the suite rather than silently splitting the contract.
 */
export const CAMERA_BY_DIR = {
  E: "true side view, facing right, camera at eye level",
  S: "front view, facing the camera, camera at eye level",
  N: "back view, facing away from the camera, camera at eye level",
};

/** The facings a sheet may be authored for. W is drawn by flipping E. */
export const KEYFRAME_FACINGS = [
  { id: "E", label: "E — right, the authored side" },
  { id: "S", label: "S — toward the camera" },
  { id: "N", label: "N — away from the camera" },
];

const KEYFRAME_MOVES = [
  {
    // FIRST, and not optional in practice: `importedPaints` requires an
    // `idle` clip, and a sheet without one is dropped in SILENCE — the
    // stiltneck shipped for weeks and never once drew for exactly this.
    // Idle keys are small on purpose; a breathing loop that swings as hard
    // as a walk reads as a twitch.
    id: "idle",
    label: "idle keys (required clip)",
    clip: "idle",
    // camera: now CAMERA_BY_DIR[facing]. Set `cameraOverride` to pin one deliberately.
    poses: [
      "standing at rest, weight settled, body at its lowest",
      "breathing in: chest and shoulders lifted, body at its tallest, head slightly raised",
      "standing at rest again, weight settled, a small sway to the other side",
      "breathing out: shoulders dropping, head tilting slightly down",
    ],
  },
  {
    id: "walk",
    label: "walk cycle keys",
    clip: "walk",
    // camera: now CAMERA_BY_DIR[facing]. Set `cameraOverride` to pin one deliberately.
    poses: [
      "right foot planted far forward, left leg trailing behind, body leaning into the step",
      "passing pose: left knee lifted high in front, standing tall on the right foot",
      "left foot planted far forward, right leg trailing behind, body leaning into the step",
      "passing pose: right knee lifted high in front, standing tall on the left foot",
    ],
  },
  {
    id: "run",
    label: "run cycle keys",
    clip: "run",
    // camera: now CAMERA_BY_DIR[facing]. Set `cameraOverride` to pin one deliberately.
    poses: [
      "full sprint stride, right leg extended far forward, left leg kicked back, both feet off the ground",
      "touchdown: right foot landing under the body, left knee driving forward, deep forward lean",
      "full sprint stride mirrored, left leg extended far forward, right leg kicked back, both feet off the ground",
      "touchdown mirrored: left foot landing under the body, right knee driving forward, deep forward lean",
    ],
  },
  {
    id: "attack",
    label: "attack keys",
    clip: "attack",
    // camera: now CAMERA_BY_DIR[facing]. Set `cameraOverride` to pin one deliberately.
    poses: [
      "ready stance, weapon held low and coiled",
      "wind-up: twisted back, weapon raised high behind the head",
      "strike: weapon swung fully forward and extended, body lunging",
      "follow-through: weapon past the target, body unwinding off balance",
    ],
  },
  {
    id: "stumble",
    label: "getting-hit keys",
    clip: "stumble",
    // camera: now CAMERA_BY_DIR[facing]. Set `cameraOverride` to pin one deliberately.
    poses: [
      "upright, flinching as if just struck in the chest",
      "reeling backward, arms flung out, one foot lifting",
      "deep backward lean, almost falling, face turned away",
      "catching balance again, crouched, one hand low for support",
    ],
  },
  {
    /**
     * THE TELEGRAPH, and the reason this list is seven long as of 2026-08-08.
     *
     * `render/tell-clips.ts` resolves the leaper telegraph to the clip
     * `crouch`, and unlike `wake` there is NO painter fallback for it — an
     * unauthored crouch plays `idle` through CLIP_FALLBACK, so the one warning
     * the player has to read fast becomes a monster standing still. It was
     * missing from this list while the animate leg's `defend` preset already
     * authored it, which is the drift `clip-contract.test.ts` now catches.
     *
     * The keys are a HELD pose rather than a movement: the gather is the whole
     * read, so the four keys tighten the same crouch instead of travelling.
     * `anim.crouch` plays at 7fps ≈ 0.43s against LEAP_WINDUP's 0.45s, so a key
     * that wanders is a telegraph that finishes somewhere the pounce does not
     * start from.
     */
    id: "defend",
    label: "defend / telegraph keys (the leaper crouch)",
    clip: "crouch",
    poses: [
      "standing alert, weight settling back, knees just beginning to bend",
      "crouching low, haunches loaded, chest dropped toward the ground",
      "coiled at its lowest, every limb gathered under the body, about to spring",
      "still coiled, head and shoulders angled forward at its target, holding",
    ],
  },
  {
    id: "death",
    label: "death keys",
    clip: "death",
    // camera: now CAMERA_BY_DIR[facing]. Set `cameraOverride` to pin one deliberately.
    poses: [
      "struck hard, arching backward",
      "crumpling, knees buckling under the body",
      "collapsed onto knees, slumping forward",
      "lying flat on the ground, fully collapsed",
    ],
  },
  { id: "custom", label: "custom poses…", clip: "", cameraOverride: "the same view as the reference image", poses: [] },
];

/**
 * The one-click branch: ONE idle frame in, a keyframe sheet per animation
 * category out. Every job reads the SAME init — never the previous sheet —
 * so a row can never inherit another row's drift, and a sheet that already
 * holds four figures can never be mistaken for a character reference.
 * Ordered idle-first because idle is the clip the game refuses to import
 * without.
 */
const KEYFRAME_SET = KEYFRAME_MOVES.filter((m) => m.id !== "custom");

export const MODES = [
  {
    id: "segment",
    title: "cut out",
    blurb: "lift the subject off ANY background — a photo, a render, a screenshot — in about a second",
    // `leg` is the /free key: a new leg id would unload the 13GB Qwen stack
    // between cutting out and styling, which is exactly the thrash the
    // leg-affinity scheduler exists to prevent. BiRefNet is 444MB and sits
    // beside Qwen on a 24GB card.
    leg: "qwen",
    needs: { init: true },
    fields: [],
    etaS: { quality: 10, fast: 10 },
    prompt() {
      return "background removal (no prompt — this is a segmentation model)";
    },
    build(params, ctx) {
      // The panel's radio decides; fall back to whichever is actually on disk
      // so a box with only Lucida installed still works.
      const pick = ctx.chosen?.("intake-bgremove");
      const model = pick === "lucida" || (!ctx.has("birefnet") && ctx.has("lucida")) ? "lucida" : "birefnet";
      return bgRemove({ image: ctx.images.init, model: `${model}.safetensors` });
    },
  },
  {
    id: "intake-style",
    title: "to pixel art",
    blurb: "the cut-out becomes a sprite — framing is already fixed, so this only changes the LOOK",
    leg: "qwen",
    needs: { init: true, style: "optional" },
    fields: [{ id: "hint", label: "subject (optional)", type: "text", placeholder: "a knight in blue armor…" }],
    etaS: { quality: 260, fast: 100 },
    prompt(params, ctx) {
      // DELIBERATELY NOT asking for "one full-body character, centered, plain
      // white background" the way `pixelize` does. By the time this runs, the
      // reframe has GUARANTEED all three — and asking an edit model to centre
      // an already-centred figure is how it gets moved.
      const hint = params.hint ? ` of ${params.hint}` : "";
      const style = ctx.images.style
        ? " Match the pixel art style, palette and proportions of Figure 2."
        : " 16-bit game sprite style, crisp pixel clusters, hard palette, no anti-aliasing.";
      return `Redraw this character as clean pixel art${hint}, same pose, same size, same position.${style}`;
    },
    build(params, ctx) {
      return qwenEdit({
        image: ctx.images.init,
        image2: ctx.images.style ?? null,
        prompt: this.prompt(params, ctx),
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...qwenBundle(ctx),
      });
    },
  },
  {
    id: "rotate",
    title: "rotate",
    blurb: "same character, another facing — the game wants E, S and N",
    leg: "qwen",
    needs: { init: true },
    fields: [
      { id: "facing", label: "facing", type: "select", options: FACINGS.map((f) => ({ id: f.id, label: f.label })), default: "S" },
      { id: "custom", label: "custom angle", type: "text", placeholder: "three-quarter view from the back left…", showIf: { facing: "custom" } },
    ],
    batch: { id: "facings", label: "make all three facings (E + S + N)", values: [{ facing: "E" }, { facing: "S" }, { facing: "N" }] },
    etaS: { quality: 260, fast: 100 },
    prompt(params, ctx) {
      const f = FACINGS.find((x) => x.id === params.facing);
      // The fal angles LoRA replaces freeform turning with a fixed grammar it
      // was trained on; when it is installed the prompt IS the grammar.
      if (ctx.has("fal-multi-angle")) {
        const view = f ? f.sks : String(params.custom ?? "front view");
        return `<sks> ${view} eye-level shot medium shot, plain white background`;
      }
      const dir = f ? f.phrase : String(params.custom ?? "the camera (front view)");
      return (
        `Turn the character to face ${dir}. Same character, same colors, same pixel art style, ` +
        `same size and position, plain white background, full body visible.`
      );
    },
    build(params, ctx) {
      const b = qwenBundle(ctx);
      if (ctx.has("fal-multi-angle")) b.loras.push({ name: ctx.lora("fal-multi-angle"), strength: 0.9 });
      return qwenEdit({
        image: ctx.images.init,
        prompt: this.prompt(params, ctx),
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...b,
      });
    },
  },
  {
    id: "animate",
    title: "animate",
    blurb: "one frame in, a motion clip out — pick the frames worth keeping after",
    leg: "wan",
    needs: { init: true },
    fields: [
      { id: "preset", label: "move", type: "select", options: ANIMATE_PRESETS.map((p) => ({ id: p.id, label: p.label })), default: "walk" },
      { id: "action", label: "action (editable)", type: "text", placeholder: "hopping forward / attacking with claws…", prefillFrom: "preset" },
      { id: "frames", label: "frames", type: "select", options: [{ id: "17", label: "17 — short" }, { id: "21", label: "21 — default" }, { id: "33", label: "33 — long" }], default: "21" },
    ],
    // action: "" in every batch entry so the preset's own preprompt wins over
    // whatever the action box holds from the last single run.
    batch: {
      id: "moveset",
      label: `make the full move set (${MOVESET.length} clips)`,
      values: MOVESET.map((p) => ({ preset: p.id, action: "" })),
    },
    etaS: { quality: 450, fast: 90 },
    presets: ANIMATE_PRESETS,
    prompt(params, ctx) {
      const preset = ANIMATE_PRESETS.find((p) => p.id === params.preset);
      const action = String(params.action || preset?.action || "moving");
      // KEYED ON THE CLIP, NOT THE PRESET ID. `walk4` is a walk and must get
      // the walk specialist; an id equality test silently dropped it the moment
      // a second walk preset existed, and a LoRA that loads without its trigger
      // word is the quietest failure there is — the run succeeds and the
      // adapter simply does nothing.
      const isWalk = ANIMATE_PRESETS.find((p) => p.id === params.preset)?.clip === "walk";
      // …AND THE LEG HAS TO BE ABLE TO LOAD IT. `ctx.has()` answers "is this
      // weight on disk", which is a different question from "will this run
      // attach it": the small leg REFUSES every A14B adapter, so on 5B the
      // trigger word went out for a LoRA that was never loaded. Observed on the
      // first real 5B run (2026-08-08) — the prompt read
      // `pix3lwalk, Pixel art game sprite walking…` with no adapter behind it.
      //
      // Looks harmless, is not: a trigger is a token the model was trained to
      // associate with weights that are absent, so it is noise in the
      // conditioning — and it silently contaminates any A/B between the two
      // legs, because the arms would then differ by a PROMPT as well as by a
      // model. Same defect as the id-vs-clip test above, one level out: the
      // LoRA and the word that fires it decided by two different rules.
      const trigger = isWalk && ctx.has("pix3lwalk") && !ctx.small ? "pix3lwalk, " : "";
      return (
        `${trigger}Pixel art game sprite ${action}, smooth looping animation, the character stays ` +
        `centered in frame, consistent colors, plain white background.`
      );
    },
    build(params, ctx) {
      const preset = ANIMATE_PRESETS.find((p) => p.id === params.preset);
      return buildWanClip({
        image: ctx.images.init,
        /**
         * A CYCLE HAS TO CLOSE, and until now nothing asked it to.
         *
         * `wanI2V` has carried the first/last-frame graph since it was written
         * and `animate` never passed an end, so every walk this forge has made
         * free-runs to wherever frame 21 happens to land. Played on a loop that
         * pops: frame 21 does not lead back into frame 1.
         *
         * Pin the SAME image at both ends and the model has to come home. Two
         * things follow for free — Wan's measured 6-8 frame ease-out of the
         * init has somewhere to go, and the whole clip becomes one period of
         * the gait instead of an arbitrary slice of it.
         *
         * The init to hand it is a MID-STRIDE frame, not the standing master:
         * pinning a standing pose at both ends makes the clip stand → walk →
         * stand, which is not a cycle and burns frames at both ends.
         */
        endImage: ctx.images.end ?? null,
        prompt: this.prompt(params, ctx),
        extraNegative: preset?.avoid ?? null,
        length: Number(params.frames) || 21,
        // Same clip test as the trigger above — the LoRA and the word that
        // fires it must never be decided by two different rules. Keyed on the
        // CLIP and not the preset id because `walk4` is a second walk preset
        // (the quadruped four-beat gait) and an id test silently excludes it.
        walk: ANIMATE_PRESETS.find((p) => p.id === params.preset)?.clip === "walk",
        ctx,
      });
    },
  },
  {
    id: "inbetween",
    title: "in-between",
    blurb: "pin the first AND last pose, let the model fill the middle — two rotate/edit keyframes become a move",
    leg: "wan",
    needs: { init: true, end: true },
    fields: [
      { id: "hint", label: "motion hint (optional)", type: "text", placeholder: "raising the sword in one clean arc…" },
      { id: "frames", label: "frames", type: "select", options: [{ id: "17", label: "17 — short" }, { id: "21", label: "21 — default" }], default: "17" },
    ],
    etaS: { quality: 450, fast: 90 },
    prompt(params) {
      const hint = params.hint ? `, ${params.hint}` : "";
      return (
        `Pixel art game sprite moving smoothly from its starting pose to its final pose${hint}, ` +
        `locked-off camera, the character stays the same size and stays centered in frame, ` +
        `consistent colors, plain white background.`
      );
    },
    build(params, ctx) {
      return buildWanClip({
        image: ctx.images.init,
        endImage: ctx.images.end,
        prompt: this.prompt(params, ctx),
        length: Number(params.frames) || 17,
        ctx,
      });
    },
  },
  {
    id: "keyframes",
    title: "keyframes",
    blurb:
      "ONE idle frame in → a sheet of 4 poses per move, denoised together so they can't drift. " +
      "The init must be a single standing character, never a sheet.",
    leg: "qwen",
    needs: { init: true },
    fields: [
      { id: "preset", label: "move", type: "select", options: KEYFRAME_MOVES.map((p) => ({ id: p.id, label: p.label })), default: "walk" },
      // The facing decides the camera for EVERY clip of a sheet. It defaults to
      // E because that is the facing the intake master is framed in — the only
      // one that needs no rotation first.
      { id: "facing", label: "facing (sets the camera)", type: "select", options: KEYFRAME_FACINGS, default: "E" },
      { id: "custom", label: "custom poses (numbered)", type: "text", placeholder: "(1) crouched low (2) leaping (3) mid-air tuck (4) landing…", showIf: { preset: "custom" } },
    ],
    // Every row branches off the SAME idle init — no chaining, so no row can
    // inherit another's drift.
    batch: {
      id: "moveset",
      label: `every move set (${KEYFRAME_SET.length} sheets)`,
      values: KEYFRAME_SET.map((m) => ({ preset: m.id, custom: "" })),
      // NB: a batch is one FACING's move set. A whole character is this batch
      // once per facing, off that facing's own master — which is the planner's
      // job, not a field on this mode.
    },
    etaS: { quality: 260, fast: 100 },
    presets: KEYFRAME_MOVES,
    prompt(params) {
      const move = KEYFRAME_MOVES.find((p) => p.id === params.preset);
      const list = params.preset === "custom" ? String(params.custom ?? "") : move?.poses.map((p, i) => `(${i + 1}) ${p}`).join(", ") ?? "";
      // An explicit per-move override wins; otherwise the FACING decides. A
      // move with neither (only `custom`) inherits the reference image's view.
      const cam =
        move?.cameraOverride ??
        CAMERA_BY_DIR[String(params.facing ?? "E")] ??
        CAMERA_BY_DIR.E;
      // Labels stay OUT of the pixels on purpose: the slicer imports
      // beside-row text as a frame (README), and the row's identity
      // already travels on the job as metadata.
      //
      // The camera sentence is load-bearing, not decoration: without it
      // the model expresses a stride by TURNING the character, and the
      // row comes back as a turnaround instead of a move (measured).
      return (
        `A pixel art sprite sheet: the same character drawn 4 times in a single horizontal row, evenly spaced ` +
        `on a plain white background, identical size and colors in every frame, feet on one shared baseline. ` +
        `Every frame is drawn from the SAME camera angle — ${cam} — the character never turns or rotates ` +
        `between frames, only its pose changes. The four poses, left to right: ${list}. ` +
        // MEASURED 2026-08-05: without this clause the knight's walk row came
        // back at 0.61-0.68x the master's body mass — the model had quietly
        // put his sword away. An edit model asked only for a POSE treats held
        // equipment as scenery it may drop to make the pose read better, and
        // a missing weapon is invisible at thumbnail size while being the
        // whole silhouette in game.
        `The character keeps everything it is wearing and holding in the reference image — ` +
        `weapon, shield, cape, helmet, pack — visible in EVERY frame; nothing is dropped, ` +
        `sheathed, put away or hidden behind the body. ` +
        `Large, clearly different poses — no text, no labels, no numbers in the image.`
      );
    },
    build(params, ctx) {
      return qwenEdit({
        image: ctx.images.init,
        prompt: this.prompt(params, ctx),
        width: 1344,
        height: 768,
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...qwenBundle(ctx),
      });
    },
  },
  {
    id: "retarget",
    title: "retarget (pose reference)",
    blurb:
      "SHOW the poses instead of describing them: a reference row in, your character out, same poses. " +
      "Init is the pose row from the library; the style image is your character's approved idle.",
    leg: "qwen",
    // Both are REQUIRED, and that is the whole mode. `keyframes` needs only an
    // init because it describes the poses in words; this one exists precisely
    // because that does not work, so a run without the character to retarget
    // onto would just redraw the reference.
    needs: { init: true, style: true },
    fields: [
      { id: "subject", label: "the character (what Figure 2 is)", type: "text", required: true, placeholder: "a hooded skeleton archer…" },
    ],
    etaS: { quality: 260, fast: 100 },
    prompt(params) {
      const subject = String(params.subject ?? "").trim().replace(/\.$/, "");
      // FIGURE 1 IS THE POSES, FIGURE 2 IS THE IDENTITY, and saying which is
      // which is load-bearing — the edit model will happily return Figure 2
      // standing still if the instruction leaves the roles ambiguous.
      //
      // The count and layout are asserted rather than requested: the reference
      // already HAS them, so this is describing the image the model is looking
      // at, which it follows far more reliably than a target it must invent.
      return (
        `Figure 1 is a pixel art pose reference: one character drawn several times in a row, ` +
        `each frame a different pose, all from the same camera angle. ` +
        `Redraw that ENTIRE row as ${subject} — the character in Figure 2 — matching Figure 1 ` +
        `pose for pose, frame for frame, in the same order, at the same size and spacing, ` +
        `feet on the same shared baseline, on a plain white background. ` +
        `Keep Figure 2's colours, proportions and equipment in every frame; ` +
        `keep Figure 1's poses, framing and facing direction exactly. ` +
        `The character faces the same way as Figure 1 in every frame and never turns between frames. ` +
        `No text, no labels, no numbers in the image.`
      );
    },
    build(params, ctx) {
      // ⚠️ THE CANVAS SHAPE IS LOAD-BEARING, MEASURED 2026-08-06.
      //
      // Built without width/height first, so it took the square default — and a
      // 3-pose row asked for on a 1:1 canvas came back as a 3x3 GRID, nine cells
      // of which three were the character and the rest invented quadrupeds to
      // fill the space. The poses were correctly DIFFERENT (the whole point),
      // but the layout was unusable.
      //
      // An edit model lays out to fill what it is given, so the canvas has to
      // carry the same aspect as the reference row. `keyframes` learnt this and
      // hardcodes 1344x768 for its 4-up; a retarget row can be any length, so
      // the caller passes the reference's own shape and this only supplies the
      // wide default.
      const width = Number(params.width) || 1344;
      const height = Number(params.height) || 768;
      return qwenEdit({
        image: ctx.images.init,
        image2: ctx.images.style,
        prompt: this.prompt(params, ctx),
        width,
        height,
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...qwenBundle(ctx),
      });
    },
  },
  {
    id: "edit",
    title: "edit",
    blurb: "free instruction over the whole frame — pose tweaks, gear swaps, cleanup",
    leg: "qwen",
    needs: { init: true, style: "optional" },
    fields: [{ id: "prompt", label: "instruction", type: "text", required: true, placeholder: "raise both arms overhead / give him a torch…" }],
    etaS: { quality: 260, fast: 100 },
    prompt(params, ctx) {
      const base = String(params.prompt ?? "").trim().replace(/\.?$/, ".");
      return ctx.images.style ? `${base} Keep the pixel art style of Figure 2.` : base;
    },
    build(params, ctx) {
      return qwenEdit({
        image: ctx.images.init,
        image2: ctx.images.style ?? null,
        prompt: this.prompt(params, ctx),
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...qwenBundle(ctx),
      });
    },
  },
  {
    id: "touchup",
    title: "touch-up",
    blurb: "brush over the wrong part, say what belongs there — everything outside the brush is untouched",
    leg: "qwen",
    needs: { init: true, mask: true },
    fields: [{ id: "prompt", label: "what should be there", type: "text", required: true, placeholder: "a gauntleted hand gripping the sword…" }],
    etaS: { quality: 260, fast: 100 },
    prompt(params) {
      return String(params.prompt ?? "");
    },
    build(params, ctx) {
      return qwenInpaint({
        image: ctx.images.init,
        mask: ctx.images.mask,
        prompt: this.prompt(params, ctx),
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...qwenBundle(ctx),
      });
    },
  },
  {
    id: "pixelize",
    title: "pixelize",
    blurb: "any image — photo, render, drawing — into a clean sprite-style frame; add a committed sheet as the style to match",
    leg: "qwen",
    needs: { init: true, style: "optional" },
    fields: [{ id: "hint", label: "subject (optional)", type: "text", placeholder: "a knight in blue armor…" }],
    etaS: { quality: 260, fast: 100 },
    prompt(params, ctx) {
      const hint = params.hint ? ` of ${params.hint}` : "";
      const style = ctx.images.style
        ? " Match the pixel art style, palette and proportions of Figure 2."
        : " 16-bit game sprite style, crisp pixel clusters, hard palette.";
      return (
        `Convert this image into clean pixel art${hint}: one full-body game character on a plain ` +
        `white background, centered.${style}`
      );
    },
    build(params, ctx) {
      return qwenEdit({
        image: ctx.images.init,
        image2: ctx.images.style ?? null,
        prompt: this.prompt(params, ctx),
        seed: ctx.seed,
        unet: ctx.unet("rot-unet") ?? undefined,
        ...qwenBundle(ctx),
      });
    },
  },
];

export function modeById(id) {
  return MODES.find((m) => m.id === id) ?? null;
}

/**
 * The panel's view of the registry: fields and availability, no builders.
 * `has` decides fast-mode availability and which advisory notes show, so
 * the UI can say "style lock riding along" without knowing LoRA filenames.
 */
export function serializeModes(has) {
  return MODES.map((m) => ({
    id: m.id,
    title: m.title,
    blurb: m.blurb,
    leg: m.leg,
    needs: m.needs,
    fields: m.fields,
    batch: m.batch ?? null,
    presets: m.presets ?? null,
    etaS: m.etaS,
    fastAvailable: fastAvailable(m.leg, has),
    // `inbetween` is excluded on purpose rather than by omission: the 5B latent
    // node has no `end_image`, so offering the small leg there would advertise
    // a control the executor cannot honour.
    smallAvailable: m.id !== "inbetween" && smallAvailable(m.leg, has),
    notes: [
      m.leg === "qwen" && has("tarn59-pixel-style") ? "pixel style lock riding along" : null,
      m.leg === "qwen" && m.id === "rotate" && has("fal-multi-angle") ? "deterministic angle grammar active" : null,
      m.leg === "wan" && has("styly-pixel-animate") ? "pixel motion adapter riding along" : null,
      m.id === "animate" && has("pix3lwalk") ? "walk preset uses the pix3lwalk specialist" : null,
      // Gated on the PER-MODE availability, not the leg's. Keyed on the leg it
      // advertised the small option on `inbetween` — which cannot use it — and
      // then contradicted itself on the next line. A panel that offers a
      // control the executor will refuse is worse than one that offers nothing.
      m.leg === "wan" && m.id !== "inbetween" && smallAvailable(m.leg, has)
        ? "small leg (TI2V-5B) available — 13.6GB of reads instead of 31, and NO pixel LoRAs"
        : null,
      m.id === "inbetween" && smallAvailable(m.leg, has) ? "A14B only — 5B cannot pin a last frame" : null,
    ].filter(Boolean),
  }));
}
