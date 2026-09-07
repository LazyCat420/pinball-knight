import type { SpriteSheet } from '../engine/render/sprite';
interface LaunchActor { momSpeed: number; sprite: { sheet: Pick<SpriteSheet, 'rideTransition'> } }
type Launch = NonNullable<NonNullable<SpriteSheet['rideTransition']>['launch']>;
interface Ride { elapsed: number; applied: boolean; delay: number; launch: Launch }
const rides = new WeakMap<LaunchActor, Ride>();
/** Call when momentum stops, the player dies, or a floor/run resets. */
export function resetLaunchMomentum(actor: LaunchActor): void { rides.delete(actor); }
/** One impulse per ride at the authored release frame, followed by a finite coast. */
export function stepLaunchMomentum(actor: LaunchActor, dt: number, maxSpeed: number) {
  const transition = actor.sprite.sheet.rideTransition;
  if (actor.momSpeed <= 0 || !transition?.launch) {
    rides.delete(actor); return { boosted: false, frictionMultiplier: 1, label: '' };
  }
  let ride = rides.get(actor);
  if (!ride) {
    ride = { elapsed: 0, applied: false, delay: transition.launch.frame / transition.fps, launch: { ...transition.launch } };
    rides.set(actor, ride);
  }
  ride.elapsed += Math.max(0, dt);
  const boosted = !ride.applied && ride.elapsed >= ride.delay;
  if (boosted) {
    ride.applied = true;
    // Preserve an existing machine overspeed; a launch reward must never slow it down.
    actor.momSpeed = Math.max(actor.momSpeed, Math.min(maxSpeed, actor.momSpeed * ride.launch.speedMultiplier));
  }
  const coasting = ride.applied && ride.elapsed - ride.delay < ride.launch.coastSeconds;
  return { boosted, frictionMultiplier: coasting ? ride.launch.frictionMultiplier : 1, label: ride.launch.label };
}
