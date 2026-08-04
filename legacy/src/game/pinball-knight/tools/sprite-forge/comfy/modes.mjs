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
import { qwenEdit, qwenInpaint, wanI2V } from "./graphs.mjs";

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

const FACINGS = [
  { id: "E", label: "right — E, the authored side", phrase: "right, seen from the side", sks: "right side view" },
  { id: "left", label: "left side (engine mirrors E — for reference only)", phrase: "left, seen from the side", sks: "left side view" },
  { id: "S", label: "toward camera — S", phrase: "the camera (front view)", sks: "front view" },
  { id: "N", label: "away — N", phrase: "away from the camera (back view)", sks: "back view" },
];

const ANIMATE_PRESETS = [
  { id: "walk", label: "walk cycle", action: "walking in place, a steady side-view walk cycle", clip: "walk" },
  { id: "idle", label: "idle sway", action: "standing in place, breathing and swaying gently, an idle animation", clip: "idle" },
  { id: "attack", label: "attack", action: "attacking with its weapon, one full swing", clip: "attack" },
  { id: "stumble", label: "stumble (stagger)", action: "recoiling and stumbling backward as if struck", clip: "stumble" },
  { id: "death", label: "death", action: "dying and collapsing to the ground", clip: "death" },
  { id: "custom", label: "custom action…", action: "", clip: "" },
];

export const MODES = [
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
    etaS: { quality: 450, fast: 90 },
    presets: ANIMATE_PRESETS,
    prompt(params, ctx) {
      const preset = ANIMATE_PRESETS.find((p) => p.id === params.preset);
      const action = String(params.action || preset?.action || "moving");
      const trigger = params.preset === "walk" && ctx.has("pix3lwalk") ? "pix3lwalk, " : "";
      return (
        `${trigger}Pixel art game sprite ${action}, smooth looping animation, the character stays ` +
        `centered in frame, consistent colors, plain white background.`
      );
    },
    build(params, ctx) {
      return wanI2V({
        image: ctx.images.init,
        prompt: this.prompt(params, ctx),
        length: Number(params.frames) || 21,
        seed: ctx.seed,
        unetHigh: ctx.unet("anim-high") ?? undefined,
        unetLow: ctx.unet("anim-low") ?? undefined,
        ...wanBundle(ctx, { walk: params.preset === "walk" }),
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
        `the character stays centered in frame, consistent colors, plain white background.`
      );
    },
    build(params, ctx) {
      return wanI2V({
        image: ctx.images.init,
        endImage: ctx.images.end,
        prompt: this.prompt(params, ctx),
        length: Number(params.frames) || 17,
        seed: ctx.seed,
        unetHigh: ctx.unet("anim-high") ?? undefined,
        unetLow: ctx.unet("anim-low") ?? undefined,
        ...wanBundle(ctx),
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
    notes: [
      m.leg === "qwen" && has("tarn59-pixel-style") ? "pixel style lock riding along" : null,
      m.leg === "qwen" && m.id === "rotate" && has("fal-multi-angle") ? "deterministic angle grammar active" : null,
      m.leg === "wan" && has("styly-pixel-animate") ? "pixel motion adapter riding along" : null,
      m.id === "animate" && has("pix3lwalk") ? "walk preset uses the pix3lwalk specialist" : null,
    ].filter(Boolean),
  }));
}
