import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attackPhase, gaitParameters, sampleGaitFoot, sampleKnightPose } from './knight-motion';
import { KnightAnimation } from './knight-animation';
import { createArmoredKnight } from './armored-knight';

describe('authored knight rig and motion', () => {
  it('plants the stance foot while the root advances, without stretching either leg bone', () => {
    const rig = createArmoredKnight(), point = new THREE.Vector3(), hip = new THREE.Vector3(), knee = new THREE.Vector3();
    const speed = 1.1, gait = gaitParameters(speed), contacts: number[] = [];
    try {
      for (let i = 0; i < 12; i++) {
        const phase = i / 12 * gait.stance * .65;
        rig.root.position.z = phase * gait.travel;
        rig.pose('walk', phase, 'bowling', { speed });
        const leg = rig.joints.legs[0];
        leg.hip.getWorldPosition(hip); leg.knee.getWorldPosition(knee); leg.ankle.getWorldPosition(point);
        expect(hip.distanceTo(knee)).toBeCloseTo(.58, 5); expect(knee.distanceTo(point)).toBeCloseTo(.58, 5);
        expect(point.y).toBeCloseTo(.16, 4); contacts.push(point.z);
      }
      expect(Math.max(...contacts) - Math.min(...contacts)).toBeLessThan(.001);
    } finally { rig.dispose(); }
  });
  it('bends the knees and preserves a continuous heel/toe cycle in walking and sprinting', () => {
    for (const speed of [1.1, 4.2, 6.9]) {
      const stance = gaitParameters(speed).stance;
      for (const seam of [stance, 1]) {
        const before = sampleGaitFoot(seam - 1e-6, -1, speed), after = sampleGaitFoot(seam + 1e-6, -1, speed);
        expect(new THREE.Vector3(...before.position).distanceTo(new THREE.Vector3(...after.position))).toBeLessThan(.0001);
        expect(Math.abs(before.pitch - after.pitch)).toBeLessThan(.0001);
      }
    }
    const rig = createArmoredKnight();
    try {
      const bends = [];
      for (let i = 0; i < 40; i++) { rig.pose('run', i / 40, 'bowling', { speed: 4.2 }); bends.push(rig.joints.legs[0].knee.quaternion.angleTo(new THREE.Quaternion())); }
      expect(Math.max(...bends) - Math.min(...bends)).toBeGreaterThan(.4);
    } finally { rig.dispose(); }
  });
  it('maps every weapon timing to the authored contact and recovery beats', () => {
    for (const timing of [{ windup: .08, active: .1, recovery: .12 }, { windup: .55, active: .24, recovery: .7 }]) {
      expect(attackPhase(timing.windup, timing)).toBeCloseTo(.34);
      expect(attackPhase(timing.windup + timing.active, timing)).toBeCloseTo(.62);
      expect(attackPhase(timing.windup + timing.active + timing.recovery, timing)).toBeCloseTo(1, 12);
    }
    const left = sampleKnightPose('attack', .45, { variant: 0 }), right = sampleKnightPose('attack', .45, { variant: 1 });
    expect(left.chest[1] * right.chest[1]).toBeLessThan(0);
  });
  it('does not walk against a wall or advance a paused attack', () => {
    const animation = new KnightAnimation();
    const frame = { dt: 1 / 60, clip: 'walk' as const, heading: 0, speed: 0, distance: 0, worldScale: .375, weapon: 'sword' as const };
    for (let i = 0; i < 120; i++) animation.update(frame);
    expect(animation.inspect().phase).toBe(0);
    const attack = { ...frame, clip: 'attack' as const, attackTime: .2 };
    for (let i = 0; i < 20; i++) animation.update(attack);
    const before = animation.update({ ...attack, dt: 0 });
    for (let i = 0; i < 60; i++) expect(animation.update({ ...attack, dt: 0 })).toEqual(before);
  });
  it('turns through the short arc and keeps walk/run changes on the same gait clock', () => {
    const animation = new KnightAnimation();
    const frame = { dt: 1 / 60, clip: 'walk' as const, heading: Math.PI - .05, speed: 2, distance: 2 / 60, worldScale: .375, weapon: 'sword' as const };
    for (let i = 0; i < 60; i++) animation.update(frame);
    const phase = animation.inspect().phase, heading = animation.heading;
    animation.update({ ...frame, clip: 'run', heading: -Math.PI + .05 });
    expect(animation.inspect().phase).toBeGreaterThan(phase);
    expect(Math.abs(animation.heading - heading)).toBeLessThan(.05);
  });
});
