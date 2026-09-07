import { it, expect, vi, afterEach } from 'vitest';
const calls = vi.hoisted(() => ({ order: [] as string[], load: vi.fn(), backfill: vi.fn() }));
vi.mock('../boot/sheets', () => ({ stopSheetBackfill: () => calls.order.push('stop-monsters'), loadMonsterSheetsForFloor: calls.load, applyImportedMonsterArt: calls.backfill }));
vi.mock('../../../scenes/tavern/core', () => ({ openTavernScene: () => { calls.order.push('tavern'); return true; }, closeTavern: vi.fn(), isTavernSceneOpen: vi.fn() }));
vi.mock('../GameEngine', () => ({ installEngine: vi.fn() }));
vi.mock('../gui/stack', () => ({ push: vi.fn() }));
vi.mock('../gui/screens/tavern', () => ({ tavernScreen: vi.fn() }));
vi.mock('../gui/screens/character-select', () => ({ characterSelectScreen: vi.fn() }));
import { openLobby } from './lobby';
afterEach(() => vi.unstubAllGlobals());
it('opens the tavern with monster work stopped and no roster rebuild scheduled', () => {
  const idle = vi.fn(); const timeout = vi.fn();
  vi.stubGlobal('requestIdleCallback', idle); vi.stubGlobal('setTimeout', timeout);
  vi.stubGlobal('window', { location: { search: '?autostart=1' } });
  openLobby({} as HTMLElement, { onDescend: vi.fn(), onAbandon: vi.fn() });
  expect(calls.order).toEqual(['stop-monsters', 'tavern']);
  expect(idle).not.toHaveBeenCalled(); expect(timeout).not.toHaveBeenCalled();
  expect(calls.load).not.toHaveBeenCalled(); expect(calls.backfill).not.toHaveBeenCalled();
});
