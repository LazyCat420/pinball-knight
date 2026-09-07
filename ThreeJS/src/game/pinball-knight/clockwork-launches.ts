import { CATAPULT_FLIGHT_DUR } from './constants/pinball';
/** Shared authored timing and gameplay benefits for the three launch moves. */
export const CLOCKWORK_LAUNCHES = {
  bowling: { enterFrames: 16, fps: 40, release: .85, speedMultiplier: 1, coastSeconds: 0, frictionMultiplier: 1, label: '🎳 BOWLING', benefit: 'Quick release · standard roll' },
  football: { enterFrames: 16, fps: 16, release: .6, speedMultiplier: 1.3, coastSeconds: 1.5, frictionMultiplier: .72, label: '🏈 LONG PASS', benefit: '+30% launch speed · 1.5s longer glide' },
  baseball: { enterFrames: 32, fps: 16 / CATAPULT_FLIGHT_DUR, release: .5, speedMultiplier: 1.6, coastSeconds: 2, frictionMultiplier: .5, label: '⚾ HOME RUN', benefit: '+60% launch speed · 2s longer glide' },
} as const;
export type ClockworkLaunchStyle = keyof typeof CLOCKWORK_LAUNCHES;
