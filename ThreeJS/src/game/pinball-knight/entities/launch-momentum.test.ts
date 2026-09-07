import { describe, expect, it } from 'vitest';
import { CLOCKWORK_LAUNCHES, type ClockworkLaunchStyle } from '../clockwork-launches';
import { PINBALL_MAX_SPEED, PINBALL_FRICTION } from '../constants/pinball';
import { stepLaunchMomentum, resetLaunchMomentum } from './launch-momentum';
function actor(style: ClockworkLaunchStyle, speed = 8) {
  const p = CLOCKWORK_LAUNCHES[style];
  return { momSpeed: speed, sprite: { sheet: { rideTransition: { enterFrames: p.enterFrames, exitFrames: 4, fps: p.fps,
    ...(p.speedMultiplier > 1 ? { launch: { frame: Math.ceil((p.enterFrames-1)*p.release), speedMultiplier: p.speedMultiplier,
      coastSeconds: p.coastSeconds, frictionMultiplier: p.frictionMultiplier, label: p.label } } : {}) } } } };
}
describe('Clockwork launch momentum bonuses', () => {
  it.each(['football','baseball'] as const)('applies %s speed once at its release frame', style => {
    const a=actor(style), transition=a.sprite.sheet.rideTransition;
    const delay=transition.launch!.frame/transition.fps;
    expect(stepLaunchMomentum(a,delay-.01,PINBALL_MAX_SPEED).boosted).toBe(false);
    expect(a.momSpeed).toBe(8);
    expect(stepLaunchMomentum(a,.02,PINBALL_MAX_SPEED).boosted).toBe(true);
    expect(a.momSpeed).toBeCloseTo(8*CLOCKWORK_LAUNCHES[style].speedMultiplier);
    const boosted=a.momSpeed;
    for(let i=0;i<300;i++) expect(stepLaunchMomentum(a,1/60,PINBALL_MAX_SPEED).boosted).toBe(false);
    expect(a.momSpeed).toBe(boosted);
  });
  it('extends travel in an open lane: baseball farther than football, both farther than bowling', () => {
    function travel(style: ClockworkLaunchStyle) {
      const a=actor(style);let distance=0;
      for(let i=0;i<240;i++) {
        const bonus=stepLaunchMomentum(a,1/60,PINBALL_MAX_SPEED);
        distance+=a.momSpeed/60;
        a.momSpeed=Math.max(0,a.momSpeed-PINBALL_FRICTION*bonus.frictionMultiplier/60);
      }
      return distance;
    }
    expect(travel('football')).toBeGreaterThan(travel('bowling')*1.15);
    expect(travel('baseball')).toBeGreaterThan(travel('football')*1.1);
  });
  it('expires the glide, cancels on stopping, and rearms for a new ride', () => {
    const a=actor('football');
    expect(stepLaunchMomentum(a,1,PINBALL_MAX_SPEED).frictionMultiplier).toBeLessThan(1);
    expect(stepLaunchMomentum(a,2,PINBALL_MAX_SPEED).frictionMultiplier).toBe(1);
    a.momSpeed=0;stepLaunchMomentum(a,.1,PINBALL_MAX_SPEED);
    a.momSpeed=8;expect(stepLaunchMomentum(a,1,PINBALL_MAX_SPEED).boosted).toBe(true);
    resetLaunchMomentum(a);a.momSpeed=8;
    expect(stepLaunchMomentum(a,.1,PINBALL_MAX_SPEED).boosted).toBe(false);
  });
  it('honors material caps without slowing an existing machine overspeed', () => {
    const capped=actor('baseball',20);stepLaunchMomentum(capped,2,22);expect(capped.momSpeed).toBe(22);
    const stone=actor('football',10);stepLaunchMomentum(stone,1,12);expect(stone.momSpeed).toBe(12);
    const fast=actor('baseball',30);stepLaunchMomentum(fast,2,22);expect(fast.momSpeed).toBe(30);
  });
  it('does not give bowling or ordinary sheets an extra impulse', () => {
    const a=actor('bowling');stepLaunchMomentum(a,10,22);expect(a.momSpeed).toBe(8);
    const other={momSpeed:8,sprite:{sheet:{}}};stepLaunchMomentum(other,10,22);expect(other.momSpeed).toBe(8);
  });
});
