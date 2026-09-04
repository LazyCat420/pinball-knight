/**
 * 🎬 Animation Presentation System — The SINGLE animation clock owner in the game.
 *
 * INVARIANT:
 * No gameplay, AI, network, entity, combat, or test-integration module may call
 * `Animator.update()`. Only `AnimationPresentationSystem.update(renderDt)` may do
 * so in production.
 *
 * Simulation decides state (mode = "dead", clip = "death", facing = locked).
 * Presentation decides visuals (advances animation timers, steps indices, applies UVs).
 */
import { state } from "../state";
import type { Animator } from "../engine/render/animator";
import type { MonsterAnimator } from "../engine/render/monster-animator";
import type { ActorSprite } from "../engine/render/sprite";
import { getMultiBallEchoes } from "../entities/multiball";
import { updateDeathDebugOverlay, recordDeathTrace } from "../dev/death-debug";

export interface AnimatableEntity {
  readonly id?: string;
  readonly anim: Animator | MonsterAnimator;
  readonly sprite?: ActorSprite;
  mode?: string;
}

export class AnimationPresentationSystem {
  private extraActors = new Set<AnimatableEntity>();
  private currentFrameId = 0;
  private updatedThisFrame = new Set<Animator | MonsterAnimator>();

  /**
   * Register a transient entity (e.g., multiball echoes, co-op replicas).
   * Returns an unregister cleanup function.
   */
  register(actor: AnimatableEntity): () => void {
    this.extraActors.add(actor);
    return () => this.extraActors.delete(actor);
  }

  unregister(actor: AnimatableEntity): void {
    this.extraActors.delete(actor);
  }

  clear(): void {
    this.extraActors.clear();
  }

  /**
   * Advances every registered and world animator EXACTLY ONCE per rendered frame.
   */
  update(renderDt: number): void {
    this.currentFrameId++;
    this.updatedThisFrame.clear();

    // 1. Local Player
    const p = state.player;
    if (p?.anim) {
      this.tickActor(p.anim, renderDt);
    }

    // 2. World Monsters (Zombies, Goblins, Bosses, Corpses)
    for (const z of state.zombies) {
      if (z?.anim) {
        const prevFrame = z.anim.getFrameIdx();
        const prevFinished = z.anim.isFinished();
        this.tickActor(z.anim, renderDt);
        if (z.mode === "dead" || (z.anim as any).isDying?.() || (z.anim as any).isDead?.()) {
          const nextFrame = z.anim.getFrameIdx();
          const nextFinished = z.anim.isFinished();
          if (prevFrame !== nextFrame || (nextFinished && !prevFinished)) {
            const id = z.dbgId || z.nid || z.kind;
            const indices = (z.anim as any).debugIndices?.() ?? [];
            const texFrame = indices[nextFrame] ?? nextFrame;
            if (prevFrame !== nextFrame) {
              console.log(`[death:step] 🎞 ${id} (${z.kind}) cel ${prevFrame} -> ${nextFrame} (texFrame: ${texFrame})`);
            }
            if (nextFinished && !prevFinished) {
              console.log(`[death:done] ✔ ${id} (${z.kind}) finished: held terminal cel ${texFrame} (cels: [${indices.join(", ")}])`);
            }
            recordDeathTrace(z, "tick", { prevFrame, nextFrame, clip: z.anim.getClip(), finished: z.anim.isFinished() });
          }
        }
      }
    }

    // 3. Multiball Echoes
    for (const echo of getMultiBallEchoes()) {
      if (echo?.anim) {
        this.tickActor(echo.anim, renderDt);
      }
    }

    // 4. Registered Extra Entities (Replicas, transients)
    for (const actor of this.extraActors) {
      if (actor?.anim) {
        this.tickActor(actor.anim, renderDt);
      }
    }

    updateDeathDebugOverlay();
  }

  private tickActor(anim: Animator | MonsterAnimator, dt: number): void {
    if (this.updatedThisFrame.has(anim)) {
      console.warn("[AnimationPresentationSystem] Duplicate update prevented on frame", this.currentFrameId);
      return;
    }
    this.updatedThisFrame.add(anim);
    anim.update(dt);
  }

  /** Read current render frame ID (for diagnostics) */
  getFrameId(): number {
    return this.currentFrameId;
  }
}

export const animationPresentation = new AnimationPresentationSystem();
