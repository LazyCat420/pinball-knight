import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./imported-paints', () => ({ loadImportedSheet: mock.load, importedPaints: (s: unknown[]) => s[0], sheetPalette: () => null }));
vi.mock('../state', () => ({ state: { playerSheets: new Map(), playerArtKey: null } }));
beforeEach(() => {
  vi.resetModules(); mock.load.mockReset();
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());
describe('player art loading identity', () => {
  it('changes the atlas identity when the same selected character finishes loading', async () => {
    const art = await import('./knight-sheets');
    const look = { armor: 0, helmet: 0, boots: 0 } as any;
    const before = art.playerArtKey('sword', look);
    mock.load.mockResolvedValue({ S: {} });
    await art.loadImportedKnightArt();
    expect(art.playerArtKey('sword', look)).not.toBe(before);
  });
  it('does not let an old load replace a more recent character', async () => {
    const art = await import('./knight-sheets');
    const pending: Array<(value: unknown) => void> = [];
    mock.load.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const old = art.loadImportedKnightArt();
    mock.load.mockResolvedValue({ S: {} });
    await art.switchPlayerSheet('mario');
    const look = { armor: 0, helmet: 0, boots: 0 } as any;
    const current = art.playerArtKey('sword', look);
    pending.forEach(resolve => resolve({ S: {} }));
    expect(await old).toBeNull();
    expect(art.playerArtKey('sword', look)).toBe(current);
    expect(art.playerSheetName()).toBe('mario');
  });
});
