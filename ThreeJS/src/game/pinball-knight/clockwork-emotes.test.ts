import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./unlocked-depths', () => ({ loadUnlockedDepth: () => depth }));
let depth = 1;
const saved = new Map<string, string>();
beforeEach(() => {
  depth = 1; saved.clear(); vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());
describe('Clockwork emote rewards', () => {
  it('starts with bowling and rejects locked selections', async () => {
    const e = await import('./clockwork-emotes');
    expect(e.activeClockworkEmote()).toBe('bowling');
    expect(e.equipClockworkEmote('football')).toBe(false);
    expect(e.equipClockworkEmote('baseball')).toBe(false);
    expect(saved.size).toBe(0);
  });
  it('unlocks by reached floor and restores the equipped reward after reload', async () => {
    const e = await import('./clockwork-emotes');
    depth = 2;
    expect(e.equipClockworkEmote('football')).toBe(true);
    expect(e.emoteUnlocked('baseball')).toBe(false);
    vi.resetModules();
    expect((await import('./clockwork-emotes')).activeClockworkEmote()).toBe('football');
    depth = 3;
    expect(e.equipClockworkEmote('baseball')).toBe(true);
    expect(e.activeClockworkEmote()).toBe('baseball');
  });
  it('migrates an equipped basketball reward to football without losing the unlock', async () => {
    depth=2;saved.set('pinball-knight-clockwork-emote','basketball');
    const e=await import('./clockwork-emotes');
    expect(e.activeClockworkEmote()).toBe('football');
    expect(e.emoteUnlocked('football')).toBe(true);
  });
  it('rejects corrupt or locked saved values', async () => {
    const e = await import('./clockwork-emotes');
    for (const value of ['baseball', 'unknown', '{}']) {
      saved.set('pinball-knight-clockwork-emote', value);
      expect(e.activeClockworkEmote()).toBe('bowling');
    }
  });
  it('keeps equipped emotes usable when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
    const e = await import('./clockwork-emotes'); depth = 3;
    expect(e.equipClockworkEmote('baseball')).toBe(true);
    expect(e.activeClockworkEmote()).toBe('baseball');
  });
});
