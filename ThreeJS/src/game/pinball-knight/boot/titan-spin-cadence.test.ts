import { it, expect } from 'vitest';
import { imported, paintsFor } from './sheets';
import { makePinballBossPaints } from '../render/monsters/pinball-boss';
import { MonsterAnimator } from '../engine/render/monster-animator';

it('plays all dense Titan spin paths at the same cadence and preserves death locking', () => {
  const previous = imported.get('pinball_boss');
  try {
    const art = makePinballBossPaints();
    for (const dir of ['S', 'E', 'N'] as const) for (const clip of ['attack', 'roll', 'ball'] as const)
      art[dir][clip] = Array.from({length: 32}, () => art[dir].idle![0]);
    imported.set('pinball_boss', art);
    const paints = paintsFor('pinball_boss');
    for (const clip of ['attack', 'roll', 'ball'] as const) {
      const clips = new Map<string, number[]>();
      for (const dir of ['S', 'E', 'N']) {
        clips.set(`${dir}:${clip}`, Array.from({length: 32}, (_, i) => i));
        clips.set(`${dir}:idle`, [0]); clips.set(`${dir}:death`, [0, 1, 2, 3, 4]);
      }
      const sprite = { sheet: {clips, beats: paints.beats}, setFrame() {}, setFlipped() {} };
      const anim = new MonsterAnimator(sprite as never);
      anim.play(clip, {loop: true});
      for (let i = 0; i < 64; i++) anim.update(1 / 64);
      expect(anim.getFrameIdx()).toBe(0);
      expect(anim.isFinished()).toBe(false);
      anim.setRate(2);
      for (let i = 0; i < 16; i++) anim.update(1 / 64);
      expect(anim.getFrameIdx()).toBe(16);
      anim.triggerDeath('S');
      anim.play(clip, {loop: true});
      expect(anim.getClip()).toBe('death');
    }
    imported.delete('pinball_boss');
    expect(paintsFor('pinball_boss').beats).toBeUndefined();
  } finally {
    if (previous) imported.set('pinball_boss', previous); else imported.delete('pinball_boss');
  }
});
