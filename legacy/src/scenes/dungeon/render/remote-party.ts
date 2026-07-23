/**
 * 🎭 Remote party renderer — the OTHER players' knights, in whatever scene is
 * asking. Shared by the tavern hub and the dungeon so both draw pool-mates the
 * same way: a tinted, nameplated, interpolated knight sprite.
 *
 * Scene-filtered: construct it with a predicate (`matchScene`) and feed it the
 * pool's raw presence events; it only ever renders peers whose reported scene
 * matches — so the tavern shows tavern-mates, floor 2 shows floor-2-mates, and a
 * peer walking from one to the other is dropped from the first and picked up by
 * the second automatically.
 */
import * as THREE from "three";
import { createActorSprite, type ActorSprite } from "./sprite";
import { getKnightSheet, type SheetConsumer } from "./knight-sheets";
import { lookFromGear } from "./knight-look";
import { Animator, facingFromVelocity, type Facing } from "./animator";
import { colorForSlot } from "../../../net/protocol";
import type { PeerInfo } from "../../../net/presence";
import { state as dungeonState, activeWeapon } from "../state";
import { SPRITE_UNITS } from "../constants";

const INTERP_RATE = 12;
const WALK_THRESHOLD = 0.4;
const NAMEPLATE_Y = SPRITE_UNITS * 1.18;

interface View {
  slot: number;
  sprite: ActorSprite;
  animator: Animator;
  nameplate: THREE.Mesh;
  tx: number;
  tz: number;
  tf: Facing;
  rx: number;
  rz: number;
  facing: Facing;
  seen: boolean;
  /** Last clip the peer reported ("ball"/"roll"/"attack" are mirrored 1:1). */
  mode: string;
}

/**
 * Clips mirrored verbatim from the peer instead of being derived from velocity.
 * The derive-from-velocity path renders a bouncing marble as a walk cycle
 * flip-flopping E/W on every wall hit — "running back and forth". Mirroring the
 * peer's actual clip is what makes a ball look like a ball.
 */
const MIRRORED_CLIPS = new Set(["ball", "roll", "attack", "run"]);

export class RemotePartyRenderer {
  private readonly views = new Map<string, View>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly consumer: SheetConsumer,
    private readonly matchScene: (peerScene: string) => boolean,
  ) {}

  /**
   * Reconcile the rendered knights against the current pool roster, then
   * interpolate. Poll-based: call once per frame with `presence.peers()`. Peers
   * that match this scene get a view (created on first sight); views whose peer
   * left the pool or changed scene are torn down.
   */
  sync(peers: PeerInfo[], dt: number): void {
    const live = new Set<string>();
    for (const p of peers) {
      if (!this.matchScene(p.scene)) continue;
      live.add(p.id);
      let v = this.views.get(p.id);
      if (!v) v = this.create(p.id, p.slot, p.name);
      v.tx = p.x;
      v.tz = p.z;
      v.tf = p.facing;
      v.mode = p.mode;
      if (!v.seen) {
        v.seen = true;
        v.rx = p.x;
        v.rz = p.z;
        v.sprite.mesh.position.set(p.x, 0, p.z);
        v.sprite.mesh.visible = true;
      }
      // Recolor if the roster corrected a move-learned peer's slot.
      if (v.slot !== p.slot) {
        v.slot = p.slot;
        v.sprite.setTint(colorForSlot(p.slot).hex);
      }
    }
    for (const id of [...this.views.keys()]) if (!live.has(id)) this.destroy(id);
    this.tick(dt);
  }

  private create(id: string, slot: number, name: string): View {
    const sheet = getKnightSheet(activeWeapon().id, lookFromGear(dungeonState.gear), this.consumer);
    const sprite = createActorSprite(sheet, false);
    sprite.setTint(colorForSlot(slot).hex);
    sprite.mesh.visible = false;
    const animator = new Animator(sprite);
    const nameplate = makeNameplate(name, colorForSlot(slot).hex);
    sprite.mesh.add(nameplate);
    this.scene.add(sprite.mesh);
    const v: View = { slot, sprite, animator, nameplate, tx: 0, tz: 0, tf: "S", rx: 0, rz: 0, facing: "S", seen: false, mode: "idle" };
    this.views.set(id, v);
    return v;
  }

  private destroy(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    v.sprite.mesh.remove(v.nameplate);
    (v.nameplate.geometry as THREE.BufferGeometry).dispose();
    const nm = v.nameplate.material as THREE.MeshBasicMaterial;
    nm.map?.dispose();
    nm.dispose();
    v.sprite.mesh.removeFromParent();
    v.sprite.dispose();
    this.views.delete(id);
  }

  /** Interpolate + animate every rendered knight. */
  private tick(dt: number): void {
    const k = Math.min(1, dt * INTERP_RATE);
    for (const v of this.views.values()) {
      if (!v.seen) continue;
      const px = v.rx;
      const pz = v.rz;
      v.rx += (v.tx - v.rx) * k;
      v.rz += (v.tz - v.rz) * k;
      const vx = (v.rx - px) / (dt || 1 / 60);
      const vz = (v.rz - pz) / (dt || 1 / 60);
      const speed = Math.hypot(vx, vz);
      if (MIRRORED_CLIPS.has(v.mode)) {
        // Peer is in a special clip (marble, tumble, swing) — mirror it and use
        // their REPORTED facing; velocity-derived facing flip-flops on bounces.
        v.animator.setFacing(v.tf);
        v.animator.play(v.mode as Parameters<Animator["play"]>[0]);
        v.animator.setRate(v.mode === "ball" ? 1 + Math.min(1.5, speed / 8) : 1);
      } else if (speed > WALK_THRESHOLD) {
        v.facing = facingFromVelocity(vx, vz, v.facing);
        v.animator.setFacing(v.facing);
        v.animator.play("walk");
        v.animator.setRate(0.7 + Math.min(1.5, speed / 4.2) * 0.6);
      } else {
        v.animator.setFacing(v.tf);
        v.animator.play("idle");
        v.animator.setRate(1);
      }
      v.animator.update(dt);
      v.sprite.mesh.position.set(v.rx, 0, v.rz);
    }
  }

  /** How many pool members are currently rendered here. */
  get count(): number {
    return this.views.size;
  }

  /** Interpolated positions + modes of every rendered knight (for collisions). */
  positions(): Array<{ x: number; z: number; mode: string }> {
    const out: Array<{ x: number; z: number; mode: string }> = [];
    for (const v of this.views.values()) if (v.seen) out.push({ x: v.rx, z: v.rz, mode: v.mode });
    return out;
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.destroy(id);
  }
}

function makeNameplate(name: string, hex: number): THREE.Mesh {
  const pad = 6;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = "16px 'Press Start 2P', monospace";
  const text = name.toUpperCase().slice(0, 12);
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = 24;
  const c = canvas.getContext("2d")!;
  c.font = "16px 'Press Start 2P', monospace";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(8,10,14,0.72)";
  c.fillRect(0, 0, w, 24);
  c.fillStyle = `#${(hex & 0xffffff).toString(16).padStart(6, "0")}`;
  c.fillText(text, pad, 13);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const h = 0.28;
  const geo = new THREE.PlaneGeometry(h * (w / 24), h);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = NAMEPLATE_Y;
  mesh.renderOrder = 20;
  return mesh;
}
