/**
 * The mixer, the mute gates, and the fail-silent contract.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────────────
 * Every one of the 28 stings used to connect its own gain node straight to
 * `ctx.destination`. That meant there was no such thing as "the volume": each
 * sting's loudness was a float literal baked into its body, 28 of them, with no
 * way to scale them together and no way for a settings screen to touch them. The
 * entire mixing surface was one `muted` boolean.
 *
 * Now: per-sting gain → CATEGORY bus → master (owned by `utils/audio-manager`,
 * so it can eventually cover the tavern too) → destination.
 *
 * ── THE 28 VOLUME LITERALS DO NOT MOVE ───────────────────────────────────────
 * They stay exactly as they were, and every category trim ships at 1.0. A unity
 * gain node is mathematically transparent, so the reorganisation is PROVABLY
 * inaudible at full volume — which is what `sfx-snapshot.test.ts` asserts. Any
 * actual level change has to be its own commit, where it can be reviewed by ear
 * instead of hiding inside a 30-file move.
 *
 * The category buses exist so that "pinball is too loud" is one number rather
 * than five literals. `pinball` is by far the densest category — 18 call sites
 * in `entities/pinball-collide.ts` alone — which is why the seam is worth having
 * before anyone needs it.
 *
 * ── TWO MUTE LAYERS, BOTH PRESERVED ──────────────────────────────────────────
 * `sfxMuted` is this game's own switch, set from the settings screen. It gates
 * `bus()` here AND mutes the master in `utils/audio-manager`, because the game is
 * bigger than this folder: the tavern and the gambler route through the master
 * without ever calling `bus()`, and for a while the switch missed all of them.
 * Above it, `getAudioCtx()` returns null whenever the app is globally silenced
 * (`?mute=1`, `?playtest=1`, `window.__setMute`), so the game inherits that for
 * free and neither layer knows about the other.
 */
import { getAudioCtx, getSfxMaster, setMasterMuted, setMasterVolume } from "../../../utils/audio-manager";

/**
 * Mixer groups. These name where a sound comes from in the GAME, not what it
 * sounds like, so the split matches how the code reaches for them.
 */
export type SfxCategory = "combat" | "weapons" | "pinball" | "monsters" | "world" | "run" | "ambience";

/**
 * Per-category trim. ALL 1.0 ON PURPOSE — see the header. Shipping a non-unity
 * value here in the same change as the folder move would make the diff
 * unreviewable by ear.
 */
const TRIM: Record<SfxCategory, number> = {
  combat: 1,
  weapons: 1,
  pinball: 1,
  monsters: 1,
  world: 1,
  run: 1,
  ambience: 1,
};

/** What a sting needs in order to make a sound: a clock and somewhere to go. */
export interface Bus {
  c: AudioContext;
  out: AudioNode;
}

let sfxMuted = false;
let volume = 1;

/**
 * One mute gate for every sting. Set from the menu's Settings tab, persisted
 * via settings-save.ts, applied by gui/apply-settings.ts.
 *
 * It also mutes the MASTER, which is what carries the switch out of this folder.
 * `sfxMuted` alone only gates `bus()`, i.e. this game's 28 stings — the tavern,
 * the smith and the gambler reach the speakers through `sfxCtx`/`sfxDestination`
 * instead, so a player who turned "Sound FX" off still heard the hub blipping at
 * them. The master is the one node both paths share.
 */
export function setSfxMuted(v: boolean): void {
  sfxMuted = v;
  setMasterMuted(v);
}

export function isSfxMuted(): boolean {
  return sfxMuted;
}

/**
 * 0..1. Kept INDEPENDENT of mute: turning sound off and back on must restore the
 * level the player chose, not jump to full.
 */
export function setSfxVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  // The perceptual curve lives on the master node in audio-manager; this just
  // hands it the linear value. Called synchronously on purpose — a deferred
  // volume change means the next sting is still at the old level.
  setMasterVolume(volume);
}

export function getSfxVolume(): number {
  return volume;
}

/**
 * Node creation is guarded, not just context acquisition.
 *
 * The module contract is "fail-silent — audio must never be able to break the
 * game", but only context acquisition used to be wrapped. A context that
 * resolves and then throws on createOscillator/createBuffer (an exhausted
 * context, a hostile or partial implementation, a browser that has torn the
 * context down mid-frame) would throw straight into the game loop from whatever
 * was mid-swing. Every sting runs its body through here so the promise holds.
 */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch (_e) {
    // Silence is the correct failure mode for a sound effect.
  }
}

let cats: Partial<Record<SfxCategory, GainNode>> = {};
let owner: unknown = null;

/**
 * Acquire the context and the category's output node, or null to stay silent.
 *
 * `volume <= 0` is a HARD gate, checked before any node is created. That is what
 * makes the `catch` below safe: without it, a context that failed to build a
 * GainNode would fall back to `destination` and play at FULL VOLUME when the
 * player had asked for silence — worse than the failure it was papering over.
 */
export function bus(cat: SfxCategory): Bus | null {
  if (sfxMuted || volume <= 0) return null;
  const c = getAudioCtx();
  if (!c) return null;
  try {
    // A GainNode belongs to exactly one AudioContext. If the context has been
    // replaced, every cached node is dead and connecting across the two throws.
    if (owner !== c) {
      owner = c;
      cats = {};
    }
    const cached = cats[cat];
    if (cached) return { c, out: cached };
    const master = getSfxMaster();
    const g: GainNode = c.createGain();
    g.gain.value = TRIM[cat];
    g.connect(master ?? c.destination);
    cats[cat] = g;
    return { c, out: g };
  } catch {
    // Degrade to the old graph rather than going silent. The volume gate above
    // means this can never be louder than the player asked for.
    return { c, out: c.destination };
  }
}

/** Drop every cached node. Floor teardown, and test determinism. */
export function resetBus(): void {
  cats = {};
  owner = null;
}
