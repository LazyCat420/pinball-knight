import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear(); vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());
describe('Clockwork emote selection', () => {
  it('offers every launch on a fresh profile and restores each after reload', async () => {
    let e = await import('./clockwork-emotes');
    expect(e.activeClockworkEmote()).toBe('bowling');
    for (const id of ['football', 'baseball', 'bowling'] as const) {
      expect(e.emoteUnlocked(id)).toBe(true);
      expect(e.equipClockworkEmote(id)).toBe(true);
      vi.resetModules();
      e = await import('./clockwork-emotes');
      expect(e.activeClockworkEmote()).toBe(id);
    }
  });
  it('migrates an equipped basketball reward to football without losing the unlock', async () => {
    saved.set('pinball-knight-clockwork-emote','basketball');
    const e=await import('./clockwork-emotes');
    expect(e.activeClockworkEmote()).toBe('football');
    expect(e.emoteUnlocked('football')).toBe(true);
  });
  it('rejects corrupt saved values', async () => {
    const e = await import('./clockwork-emotes');
    for (const value of ['unknown', '{}', '']) {
      saved.set('pinball-knight-clockwork-emote', value);
      expect(e.activeClockworkEmote()).toBe('bowling');
    }
  });
  it('keeps equipped emotes usable when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
    const e = await import('./clockwork-emotes');
    expect(e.equipClockworkEmote('baseball')).toBe(true);
    expect(e.activeClockworkEmote()).toBe('baseball');
  });
});
