import { afterEach, expect, it, vi } from 'vitest';
import { createInput } from './engine/input';
afterEach(() => vi.unstubAllGlobals());
it('releases a movement key while a modal blocks bubbling events', () => {
  const listeners: Array<{type: string; fn: (event: any) => void; capture: boolean}> = [];
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: any, capture = false) => listeners.push({type,fn,capture}),
    removeEventListener: (type: string, fn: any, capture = false) => {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
  });
  const input = createInput({addEventListener() {}, removeEventListener() {}} as any);
  const dispatch = (type: string, key: string, modal = false) => {
    for (const l of listeners) if (l.type === type && (!modal || l.capture)) l.fn({key, preventDefault() {}});
  };
  dispatch('keydown', 'a'); expect(input.axis().x).toBe(-1);
  dispatch('keyup', 'a', true);
  dispatch('keydown', 'd'); expect(input.axis().x).toBe(1);
  dispatch('keyup', 'd', true); expect(input.axis().x).toBe(0);
  input.dispose(); expect(listeners).toHaveLength(0);
});
