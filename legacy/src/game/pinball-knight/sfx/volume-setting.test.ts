/**
 * The persisted volume, and the classic bugs a numeric setting attracts.
 *
 * Two of these are the reason the validation is range-checked rather than a bare
 * `typeof === "number"`:
 *
 *  · **`0` must survive.** It is the one legal value that is falsy, so any
 *    `p.volume || 1` or `if (p.volume)` shape silently turns "silent" into
 *    "full volume" — the single most annoying possible bug in a volume control.
 *  · **`NaN` must not reach a GainNode.** `typeof NaN === "number"` passes a bare
 *    typeof check, and assigning it to `gain.value` silences the graph
 *    PERMANENTLY in some implementations rather than merely sounding wrong.
 *
 * And one about migration: the field is absent from every blob saved before it
 * existed, which must land on 1 so a returning player hears exactly what they
 * heard before. That is the whole reason the reorganisation is inaudible to
 * anyone who has already played.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VOLUME_STEPS } from "../constants";

const KEY = "pinball-knight-settings";

/**
 * An in-memory localStorage. This suite runs in the node environment, where the
 * global does not exist at all — and `settings-save` reads it at call time inside
 * a try/catch, so without a stub every case would silently take the
 * "storage unavailable" path and pass by testing nothing.
 */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

/** `settings-save` caches on first read, so each case needs a fresh module. */
async function loadWith(blob: unknown): Promise<{ volume: number; muted: boolean }> {
  store.clear();
  if (blob !== undefined) store.set(KEY, JSON.stringify(blob));
  vi.resetModules();
  const mod = await import("../settings-save");
  return mod.getSettings();
}

beforeEach(() => {
  store.clear();
  vi.resetModules();
});

describe("the volume setting", () => {
  it("defaults to full when the key has never been saved", async () => {
    // The migration case: every blob written before this field existed. Anything
    // other than 1 here means the sfx/ reorganisation changed how the game sounds
    // for existing players, which it is explicitly not allowed to do.
    const s = await loadWith({ muted: false, quantize: true });
    expect(s.volume).toBe(1);
  });

  it("defaults to full with no stored settings at all", async () => {
    const s = await loadWith(undefined);
    expect(s.volume).toBe(1);
  });

  it("round-trips a legal value", async () => {
    const s = await loadWith({ volume: 0.5 });
    expect(s.volume).toBe(0.5);
  });

  it("KEEPS a stored 0 — the falsy trap", async () => {
    const s = await loadWith({ volume: 0 });
    expect(s.volume, "a stored 0 was coerced back to full volume").toBe(0);
  });

  it("rejects NaN before it can reach a GainNode", async () => {
    // JSON cannot carry NaN, so it arrives as null — which is exactly how a
    // hand-edited or corrupted blob presents. Either way it must not pass.
    const s = await loadWith({ volume: NaN });
    expect(Number.isFinite(s.volume)).toBe(true);
    expect(s.volume).toBe(1);
  });

  it("rejects out-of-range and wrong-typed values", async () => {
    for (const bad of [-1, 2, 1000, "loud", null, {}, [], true]) {
      const s = await loadWith({ volume: bad });
      expect(s.volume, `${JSON.stringify(bad)} was accepted`).toBe(1);
    }
  });

  it("snaps to a notch the slider can actually display", async () => {
    // A hand-edited 0.3333 would otherwise render as the same cell count as 0.3
    // while reading back a different number, so the control would look stuck.
    const s = await loadWith({ volume: 0.3333 });
    expect(s.volume).toBeCloseTo(Math.round(0.3333 * VOLUME_STEPS) / VOLUME_STEPS, 6);
  });

  it("does not entangle volume with mute", async () => {
    const s = await loadWith({ muted: true, volume: 0.7 });
    expect(s.muted).toBe(true);
    expect(s.volume, "muting must not clear the chosen level").toBe(0.7);
  });
});
