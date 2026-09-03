import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state } from "../../state";
import { makeSkinned } from "../../spawn/factory";
import { sheetFor } from "../../boot/sheets";
import { killZombie, damageZombie } from "../../entities/combat";
import { animationPresentation } from "../../presentation/animation-system";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { importedPaints } from "../../render/imported-paints";
import { buildSpriteSheet } from "./sprite";
import { withRecoil } from "../../render/cel-painter";
import * as fs from "node:fs";
import { loadImage } from "canvas";
import type { Facing } from "../render/paint-types";

import * as THREE from "three";

describe("Goblin Death Single-Clock Presentation Progression (TDD Red/Green)", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    state.scene = new THREE.Scene();
    state.zombies = [];
    state.player = null;
    state.grid = {
      cols: 10,
      rows: 10,
      tiles: new Uint8Array(100),
      wallN: new Uint8Array(100),
      wallW: new Uint8Array(100),
      doorH: new Uint8Array(100),
      doorV: new Uint8Array(100),
    } as any;
  });

  afterEach(() => {
    restoreDom();
    state.zombies = [];
  });

  it("advances death animation through 4 stages and puddle-locks using ONLY animationPresentation.update", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 2, 2, 1);
    expect(g).toBeDefined();
    if (!g) return;
    state.zombies.push(g);

    // Lethal attack
    killZombie(g);

    expect(g.mode).toBe("dead");
    expect(g.anim.getClip()).toBe("death");
    expect(g.anim.getFrameIdx()).toBe(0);
    expect(g.anim.isFinished()).toBe(false);

    const visitedFrames = new Set<number>();
    visitedFrames.add(g.anim.getFrameIdx());

    // Step ONLY presentation clock (render frames) across 60 frames (~1.0 sec at 60fps)
    // Death clip is 4 frames at 6 fps (~0.66s to completion)
    // Note: updateZombies() is intentionally NOT called here! Presentation system alone owns animation clock.
    for (let f = 0; f < 60; f++) {
      animationPresentation.update(0.016);
      visitedFrames.add(g.anim.getFrameIdx());
    }

    expect(visitedFrames.has(0), "Must visit frame 0").toBe(true);
    expect(visitedFrames.has(1), "Must visit frame 1").toBe(true);
    expect(visitedFrames.has(2), "Must visit frame 2").toBe(true);
    expect(visitedFrames.has(3), "Must visit frame 3").toBe(true);
    expect(g.anim.getFrameIdx(), "Must hold final puddle frame").toBe(3);
    expect(g.anim.isFinished(), "Must mark death as finished").toBe(true);
  });

  it("continues death animation progression during hitstop when simulation is paused", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 2, 2, 1);
    expect(g).toBeDefined();
    if (!g) return;
    state.zombies.push(g);

    killZombie(g);
    expect(g.mode).toBe("dead");

    // Simulate hitstop: simulate() does not run during hitstop
    state.hitstopT = 0.09;

    // Advance 6 render frames (~0.1s) under presentation clock
    for (let f = 0; f < 6; f++) {
      animationPresentation.update(0.016);
    }

    // Complete the full presentation timeline
    for (let f = 0; f < 50; f++) {
      animationPresentation.update(0.016);
    }

    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);
  });

  it("correctly advances imported art sheet death for all 4 facings (S, N, E, W)", async () => {
    // Load real authored goblin sprite sheet
    const manifest = JSON.parse(fs.readFileSync("public/sprites/goblin-S.json", "utf8"));
    const image = (await loadImage("public/sprites/goblin-S.png")) as any;
    const paints = importedPaints([{ manifest, image }]);
    expect(paints).toBeDefined();
    const sheet = buildSpriteSheet(withRecoil(paints!));

    const facings: Facing[] = ["S", "N", "E", "W"];

    for (const facing of facings) {
      state.zombies = [];
      const g = makeSkinned("goblin", 2, 2, 1);
      expect(g).toBeDefined();
      if (!g) continue;

      g.sprite.setSheet(sheet);
      g.anim.reapply();
      g.anim.setFacing(facing);
      state.zombies.push(g);

      killZombie(g);
      expect(g.anim.getClip()).toBe("death");

      const visited = new Set<number>();
      for (let f = 0; f < 60; f++) {
        animationPresentation.update(0.016);
        visited.add(g.anim.getFrameIdx());
      }

      expect(visited.has(0), `Facing ${facing} must visit frame 0`).toBe(true);
      expect(visited.has(1), `Facing ${facing} must visit frame 1`).toBe(true);
      expect(visited.has(2), `Facing ${facing} must visit frame 2`).toBe(true);
      expect(visited.has(3), `Facing ${facing} must visit frame 3`).toBe(true);
      expect(g.anim.getFrameIdx(), `Facing ${facing} must lock on final frame`).toBe(3);
      expect(g.anim.isFinished(), `Facing ${facing} must be finished`).toBe(true);
    }
  });

  it("protects dying and dead goblin from re-attack and clip disruption", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 2, 2, 1);
    expect(g).toBeDefined();
    if (!g) return;
    state.zombies.push(g);

    killZombie(g);

    // Advance halfway through death (frame 1 or 2)
    for (let f = 0; f < 20; f++) {
      animationPresentation.update(0.016);
    }
    const midFrame = g.anim.getFrameIdx();
    expect(midFrame).toBeGreaterThanOrEqual(1);

    // Attempt to disrupt corpse with attack, damage, play, and facing changes
    damageZombie(g, 999, 0, 1, 1, true);
    g.anim.play("idle", { force: true });
    g.anim.play("walk", { force: true });
    g.anim.setFacing("W");

    // Clip must remain "death" and frame must not have reset to 0
    expect(g.anim.getClip()).toBe("death");
    expect(g.anim.getFrameIdx()).toBe(midFrame);

    // Finish presentation
    for (let f = 0; f < 40; f++) {
      animationPresentation.update(0.016);
    }
    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);
  });
});
