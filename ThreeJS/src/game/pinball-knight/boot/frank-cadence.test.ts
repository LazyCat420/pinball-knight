import { describe, it, expect } from 'vitest';
import { imported, paintsFor } from './sheets';
import { makeBlasterFrankPaints } from '../render/monsters/blaster-frank';

describe('Frank imported walk cadence', () => {
  it('preserves the one-second walk and 0.8-second run when adding in-betweens', () => {
    const previous = imported.get('blaster_frank');
    try {
      const paints = makeBlasterFrankPaints();
      for (const dir of ['S', 'N', 'E'] as const) {
        paints[dir].walk = Array.from({ length: 24 }, () => paints[dir].idle![0]);
        paints[dir].run = paints[dir].walk;
      }
      imported.set('blaster_frank', paints);
      const result = paintsFor('blaster_frank');
      expect(result.S.walk).toHaveLength(24);
      expect(result.beats?.walk! / 8).toBe(1);
      expect(result.beats?.run! / 10).toBe(0.8);
      imported.delete('blaster_frank');
      expect(paintsFor('blaster_frank').beats).toBeUndefined();
      imported.set('blaster_frank', makeBlasterFrankPaints());
      expect(paintsFor('blaster_frank').beats).toBeUndefined();
    } finally {
      if (previous) imported.set('blaster_frank', previous);
      else imported.delete('blaster_frank');
    }
  });
});
