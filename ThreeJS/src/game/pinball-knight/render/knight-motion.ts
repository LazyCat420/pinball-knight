/** Authored movement curves for the plate-armour rig; no imported motion clips. */
import type { WeaponId } from '../items';
import type { ClockworkPose } from './clockwork-knight';

export type V3 = [number, number, number];
export type KnightClip = ClockworkPose;
export interface ArmPose { shoulder: V3; elbow: number; twist: number; wrist: V3 }
export interface FootPose { position: V3; pitch: number; toe: number }
export interface KnightPose {
  pelvisPosition: V3; pelvisRotation: V3; spine: V3; chest: V3; neck: V3;
  arms: [ArmPose, ArmPose]; feet: [FootPose, FootPose]; tassets: [number, number];
  headPosition: V3; headRotation: V3; detachedHead: boolean; bodyVisible: boolean;
  weaponRotation: V3; weaponVisible: boolean;
  handTargets: [V3, V3] | null;
}
export interface MotionOptions { speed?: number; weapon?: WeaponId; variant?: number; charge?: number }
const TAU = Math.PI * 2;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (x: number) => x - Math.floor(x);

/** Cubic Hermite interpolation with authored tangents, including the cyclic seam. */
function curve(t: number, knots: readonly (readonly [number, number, number])[]): number {
  if (t <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [end, b, mb] = knots[i], [start, a, ma] = knots[i - 1];
    if (t > end) continue;
    const span = end - start, u = (t - start) / span, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * span * ma
      + (-2 * u3 + 3 * u2) * b + (u3 - u2) * span * mb;
  }
  return knots[knots.length - 1][1];
}

export function restKnightPose(): KnightPose {
  return {
    pelvisPosition: [0, 1.28, 0], pelvisRotation: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0],
    arms: [
      { shoulder: [-.18, .08, -.12], elbow: -.24, twist: 0, wrist: [0, 0, .08] },
      { shoulder: [-.42, -.12, .12], elbow: -.72, twist: -.12, wrist: [.12, 0, -.12] },
    ],
    feet: [{ position: [-.225, .16, .06], pitch: 0, toe: 0 }, { position: [.225, .16, -.08], pitch: 0, toe: 0 }],
    tassets: [0, 0], headPosition: [0, 0, 0], headRotation: [0, 0, 0], detachedHead: false,
    bodyVisible: true, weaponRotation: [1.15, 0, -.15], weaponVisible: true, handTargets: null,
  };
}

/** Full-cycle travel: the planted foot moves back at exactly the root's forward rate. */
export function gaitParameters(speed: number) {
  const run = ease((speed - 1.1) / 3.1), sprint = ease((speed - 4.2) / 2.7);
  const reach = mix(.38, .70, run) + .10 * sprint;
  const stance = mix(.60, .28, run) - .035 * sprint;
  return { run, sprint, reach, stance, travel: 2 * reach / stance };
}

export function sampleGaitFoot(cycle: number, side: number, speed: number): FootPose {
  const { run, reach, stance } = gaitParameters(speed);
  const p = fract(cycle), stroke = 2 * reach, velocity = -stroke / stance;
  let z: number, y = .16, pitch = 0, toe = 0;
  if (p < stance) {
    z = reach + velocity * p;
    // Heel settles first; the heel rises over the planted toe before lift-off.
    const heel = ease((p / stance - .72) / .28);
    pitch = -.10 * (1 - ease(p / (stance * .18))) + .28 * heel;
    y += .28 * Math.sin(.28 * heel);
    toe = -.28 * heel;
  } else {
    const u = (p - stance) / (1 - stance);
    z = curve(u, [[0, -reach, velocity * (1 - stance)], [.52, .08, stroke * 2], [1, reach, velocity * (1 - stance)]]);
    y = curve(u, [[0, .16 + .28 * Math.sin(.28), 0], [.46, mix(.36, .64, run), 0], [1, .16, 0]]);
    pitch = curve(u, [[0, .28, 0], [.40, -.38 - run * .2, 0], [1, -.10, 0]]);
    toe = -.28 * (1 - ease(u / .3));
  }
  return { position: [side * (.225 + run * .018), y, z], pitch, toe };
}

/** Shared attack clock: contact begins at .34 and recovery begins at .62. */
export function attackPhase(elapsed: number, timing?: { windup: number; active: number; recovery: number } | null): number {
  const m = timing ?? { windup: .14, active: .12, recovery: .22 };
  if (elapsed < 0) return 0;
  if (elapsed < m.windup) return .34 * elapsed / Math.max(.001, m.windup);
  if (elapsed < m.windup + m.active) return .34 + .28 * (elapsed - m.windup) / Math.max(.001, m.active);
  return .62 + .38 * clamp01((elapsed - m.windup - m.active) / Math.max(.001, m.recovery));
}

/** Loop clips take cycles; one-shots take normalized progress. */
export function sampleKnightPose(clip: KnightClip, time: number, options: MotionOptions = {}): KnightPose {
  const p = restKnightPose(), weapon = options.weapon ?? 'sword';
  p.weaponVisible = weapon !== 'fists';
  if (clip === 'idle') {
    const breath = Math.sin(time * TAU * .32), shift = Math.sin(time * TAU * .11);
    p.pelvisPosition[0] = shift * .012; p.pelvisPosition[1] += breath * .006;
    p.spine[0] = breath * .009; p.chest[0] = -breath * .014;
    p.chest[2] = shift * .008; p.neck[1] = Math.sin(time * .72) * .028;
    p.arms[0].shoulder[0] += breath * .014; p.arms[1].elbow += breath * .018;
    if ((options.charge ?? 0) > 0) {
      const charge = ease(options.charge!);
      p.chest[1] = -.25 * charge; p.arms[1].shoulder[0] -= charge * .85;
      p.arms[1].elbow -= charge * .15; p.pelvisPosition[1] -= charge * .045;
    }
  } else if (clip === 'walk' || clip === 'run') {
    const speed = options.speed ?? (clip === 'run' ? 4.2 : 1.1);
    const { run, sprint, stance } = gaitParameters(speed), phase = time * TAU;
    const stepPhase = fract(time * 2);
    const flight = run * Math.sin(Math.PI * clamp01((stepPhase - stance * 2) / (1 - stance * 2)));
    p.feet = [sampleGaitFoot(time, -1, speed), sampleGaitFoot(time + .5, 1, speed)];
    p.pelvisPosition = [Math.sin(phase) * mix(.026, .018, run), mix(1.21, 1.00, run) - .06 * sprint + .025 * Math.cos(phase * 2) + .085 * flight, 0];
    p.pelvisRotation = [run * .08, Math.sin(phase) * .085, Math.sin(phase) * .035];
    p.spine = [mix(.035, .13, run), -Math.sin(phase - .2) * .09, -p.pelvisRotation[2] * .6];
    p.chest = [-.02, -Math.sin(phase - .35) * .09, -Math.sin(phase - .18) * .025];
    p.neck = [-p.spine[0] * .7, -p.chest[1] * .65, -p.chest[2]];
    for (let i = 0; i < 2; i++) {
      const swing = Math.sin(phase + i * Math.PI - .2), arm = p.arms[i];
      arm.shoulder[0] = -.22 - swing * mix(.28, .58, run);
      arm.shoulder[2] = (i === 0 ? -.12 : .12) + Math.cos(phase + i * Math.PI) * .025;
      arm.elbow = -.32 - run * .7 - Math.max(0, swing) * .12;
      arm.wrist[0] = .06 + Math.sin(phase + i * Math.PI - .55) * .055;
      if (i === 1 && weapon !== 'fists') { arm.shoulder[0] -= .12; arm.elbow -= .22; }
      p.tassets[i] = Math.sin(phase + i * Math.PI - .42) * .12;
    }
    p.weaponRotation[0] += .12 * run;
  } else if (clip === 'attack') {
    const t = clamp01(time), variant = (options.variant ?? 0) % 3;
    const wind = ease(t / .22), cut = ease((t - .22) / .24), settle = ease((t - .62) / .38);
    const envelope = 1 - settle, reverse = variant === 1 ? -1 : 1;
    const heavy = variant === 2 || weapon === 'warhammer' || weapon === 'greatsword';
    const turn = (-.38 * wind + .92 * cut) * envelope * reverse;
    p.pelvisRotation[1] = turn * .55;
    p.spine[1] = turn * .36;
    p.chest[1] = turn * .50;
    p.chest[0] = (-.08 * wind + .23 * cut) * envelope;
    p.neck[1] = -turn * .65;
    p.pelvisPosition[1] -= (.055 * wind + .025 * cut) * envelope;
    p.pelvisPosition[2] += .16 * cut * envelope;
    p.feet[0].position[2] = .06 + .18 * cut * envelope;
    p.feet[1].position[2] = -.12 - .10 * wind * envelope;
    p.feet[1].pitch = .16 * cut * envelope;
    const arm = p.arms[1];
    arm.shoulder = [
      mix(-.42, heavy ? -2.25 : -1.52, wind) + (heavy ? 1.55 : .70) * cut,
      -.12 + (.60 * wind - 1.12 * cut) * reverse,
      .12 + (.48 * wind - .80 * cut) * reverse,
    ].map((v, i) => mix(v, restKnightPose().arms[1].shoulder[i], settle)) as V3;
    arm.elbow = mix(-.72 - .30 * wind, -.20, cut) * envelope - .72 * settle;
    arm.twist = (-.12 - .45 * wind + .85 * cut) * envelope;
    arm.wrist = [.12 + .20 * cut * envelope, .12 * reverse * cut * envelope, (-.12 - .32 * wind + .55 * cut) * envelope];
    p.arms[0].shoulder = [-.18 - .42 * wind * envelope, -.25 * turn, -.12 - .20 * cut * envelope];
    p.arms[0].elbow = -.24 - .50 * wind * envelope;
    p.weaponRotation[0] = 1.15 - .35 * wind * envelope + 2.6 * cut * envelope;
    if (weapon === 'fists') {
      arm.shoulder = [-.42 - 1.15 * cut * envelope, -.2, .12];
      arm.elbow = -.72 + .64 * cut * envelope;
      p.arms[0].shoulder[0] = -.75; p.arms[0].elbow = -1.1;
    } else if (weapon === 'gun' || weapon === 'flamethrower' || weapon === 'bow') {
      arm.shoulder = [-1.3 + Math.sin(t * Math.PI) * .12, -.1, .12];
      arm.elbow = -.25 - Math.sin(t * Math.PI) * .13;
      p.weaponRotation = [0, 0, 0];
      p.chest[0] = -.06 * Math.sin(t * Math.PI);
    }
  } else if (clip === 'remove' || clip === 'roll') {
    const t = clamp01(time), reach = ease(t / .28), lift = ease((t - .22) / .24), release = ease((t - .60) / .40);
    p.detachedHead = true;
    p.headPosition = [release * .2, 2.83 + lift * .32 - release * 2.75, release * 1.55];
    p.headRotation[0] = release * 6;
    p.chest[0] = -.04 * reach + .20 * release;
    p.pelvisPosition[1] -= .035 * reach;
    p.weaponVisible = false;
    p.handTargets = [-1, 1].map(side => [side * (.49 - .19 * reach), mix(1.5, 2.85 + lift * .32, reach) - release * 1.7, .10 + release * .85]) as [V3, V3];
  } else if (clip === 'ball') {
    p.bodyVisible = false; p.detachedHead = true; p.headPosition = [0, .4, 0]; p.headRotation[0] = time * TAU;
  } else if (clip === 'return') {
    p.detachedHead = true; p.headPosition = [0, mix(.4, 2.83, ease(time)), 0];
  } else if (clip === 'death') {
    const drop = ease(time / .55), fall = ease((time - .22) / .78);
    p.pelvisPosition = [.10 * fall, 1.28 - .86 * drop, .18 * fall];
    p.pelvisRotation = [.22 * fall, .12 * fall, -.15 * fall];
    p.spine[0] = .45 * fall; p.chest[0] = .6 * fall; p.neck[0] = .25 * fall;
    p.arms[0].shoulder = [-.6 * fall, 0, -.55 * fall]; p.arms[1].shoulder = [-.5 * fall, 0, .45 * fall];
    p.arms.forEach(arm => arm.elbow = -.18 - .9 * drop);
    p.weaponRotation[2] = -.15 - 1.1 * fall;
    p.feet[0].position[2] = -.3 * drop; p.feet[1].position[2] = -.4 * drop;
  }
  return p;
}

export function blendKnightPoses(a: KnightPose, b: KnightPose, t: number): KnightPose {
  const v = (x: V3, y: V3): V3 => [mix(x[0], y[0], t), mix(x[1], y[1], t), mix(x[2], y[2], t)];
  return { ...b,
    pelvisPosition: v(a.pelvisPosition, b.pelvisPosition), pelvisRotation: v(a.pelvisRotation, b.pelvisRotation),
    spine: v(a.spine, b.spine), chest: v(a.chest, b.chest), neck: v(a.neck, b.neck),
    headPosition: v(a.headPosition, b.headPosition), headRotation: v(a.headRotation, b.headRotation),
    weaponRotation: v(a.weaponRotation, b.weaponRotation), tassets: [mix(a.tassets[0], b.tassets[0], t), mix(a.tassets[1], b.tassets[1], t)],
    arms: a.arms.map((arm, i) => ({ shoulder: v(arm.shoulder, b.arms[i].shoulder), elbow: mix(arm.elbow, b.arms[i].elbow, t), twist: mix(arm.twist, b.arms[i].twist, t), wrist: v(arm.wrist, b.arms[i].wrist) })) as [ArmPose, ArmPose],
    feet: a.feet.map((foot, i) => ({ position: v(foot.position, b.feet[i].position), pitch: mix(foot.pitch, b.feet[i].pitch, t), toe: mix(foot.toe, b.feet[i].toe, t) })) as [FootPose, FootPose],
  };
}
