import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  CRAWLING_HAND_HP,
  CRAWLING_HAND_DAMAGE,
  CRAWLING_HAND_R,
  CRAWLING_HAND_CONTACT_RANGE,
  CRAWLING_HAND_WINDUP,
  CRAWLING_HAND_COOLDOWN,
  CRAWLING_HAND_ESCAPE_COUNT,
  CRAWLING_HAND_GRAB_DURATION,
  CRAWLING_HAND_SPEED_MULT,
  PLAYER_R,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { hitPlayer } from "./combat";
import { updatePlayer } from "./player";
import type { InputHandle } from "../engine/input";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeCrawlingHandPaints } from "../render/monsters/crawling-hand";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // floor is walkable
  return g;
}

function mockMesh() {
  return {
    position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    scale: { setScalar: () => {}, multiplyScalar: () => {} },
  };
}

function makeMockInput(opts: { attack?: boolean; dodge?: boolean; ax?: number; az?: number } = {}): InputHandle {
  let attackConsumed = false;
  let dodgeConsumed = false;
  return {
    axis: () => ({ x: opts.ax ?? 0, z: opts.az ?? 0 }),
    consumeAttack: () => {
      if (opts.attack && !attackConsumed) {
        attackConsumed = true;
        return true;
      }
      return false;
    },
    attackHeldNow: () => false,
    consumeAttackTap: () => false,
    sprintHeld: () => false,
    consumeDodge: () => {
      if (opts.dodge && !dodgeConsumed) {
        dodgeConsumed = true;
        return true;
      }
      return false;
    },
    dodgeHeld: () => false,
    consumeFlip: () => false,
    flipHeld: () => false,
    turnAxis: () => 0,
    consumeMouseDelta: () => ({ dx: 0, dy: 0 }),
    aimScreen: () => null,
    aimStick: () => null,
    poll: () => {},
    padConnected: () => false,
  } as unknown as InputHandle;
}

describe("Crawling Hand ('Thing' from Addams Family) Mechanics, Sprite Sheet & Grab Attack", () => {
  let restoreDom: () => void;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
    state.scene = {
      add: () => {},
      remove: () => {},
    } as any;
    state.gear = {
      head: { id: "leather_cap", level: 1, currentHp: 5, maxHp: 5 },
      chest: { id: "leather_vest", level: 1, currentHp: 8, maxHp: 8 },
    };
    state.vfx = {
      sparks: () => {},
      damage: () => {},
      blood: () => {},
      burst: () => {},
      dust: () => {},
    } as any;

    state.player = {
      x: 5,
      z: 5,
      hp: 10,
      maxHp: 10,
      dir: "S",
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      rollT: -1,
      rollDirX: 0,
      rollDirZ: 0,
      sprintCharge: 0,
      overcharge: 0,
      ramT: 0,
      bounceCombo: 0,
      bounceComboT: 0,
      grooveHopT: 0,
      grooveHopDur: 0,
      grooveHopCdT: 0,
      grabT: 0,
      grabX: 0,
      grabZ: 0,
      throwDirX: 0,
      throwDirZ: 0,
      throwSpeed: 0,
      hopT: 0,
      hopStartX: 0,
      hopStartZ: 0,
      hopLandX: 0,
      hopLandZ: 0,
      hopDirX: 0,
      hopDirZ: 0,
      hopSpeed: 0,
      oilT: 0,
      webbedT: 0,
      curveT: 0,
      magBootsT: 0,
      multiBallT: 0,
      springT: 0,
      material: null,
      materialT: 0,
      fuseMaterial: null,
      fuseT: 0,
      materialEmitT: 0,
      squashT: 0,
      squashAmp: 0,
      squashHx: 0,
      squashHy: 0,
      vampCdT: 0,
      phaseStuckT: 0,
      ricochetT: 0,
      ricochetFlavor: "bolt",
      ricochetTickT: 0,
      regenT: 0,
      regenTickT: 0,
      venomT: 0,
      venomTickT: 0,
      greedT: 0,
      ghostT: 0,
      freezeT: 0,
      staticT: 0,
      shieldT: 0,
      stoneT: 0,
      rageT: 0,
      iframes: 0,
      flashT: 0,
      railT: 0,
      railIdx: -1,
      railPos: 0,
      railSpeed: 0,
      railDir: 1,
      railDismountT: 0,
      sprite: {
        mesh: mockMesh(),
        setFacing: () => {},
        setTint: () => {},
        clearTint: () => {},
      } as any,
      anim: {
        play: () => {},
        update: () => {},
      } as any,
    } as Player;
  });

  it("publishes valid crawling_hand-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/crawling_hand-S.json");
    expect(existsSync(jsonPath), "public/sprites/crawling_hand-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("crawling_hand");
    expect(data.dir).toBe("S");

    const clipNames = data.rows.map((r: { clip: string }) => r.clip);
    expect(clipNames).toEqual(["idle", "walk", "attack", "death"]);
    expect(data.rows.length).toBe(4);

    for (const row of data.rows) {
      expect(row.cells.length).toBe(4);
      for (const cell of row.cells) {
        expect(cell.length).toBe(4);
        expect(cell[2]).toBeGreaterThan(cell[0]);
        expect(cell[3]).toBeGreaterThan(cell[1]);
      }
    }
  });

  it("configures STATS.crawling_hand and constants correctly", () => {
    const st = STATS.crawling_hand;
    expect(st.ranged).toBe(false);
    expect(st.contactRange).toBe(CRAWLING_HAND_CONTACT_RANGE);
    expect(st.bodyR).toBe(CRAWLING_HAND_R);
    expect(st.windup).toBe(CRAWLING_HAND_WINDUP);
    expect(st.cooldown).toBe(CRAWLING_HAND_COOLDOWN);

    expect(CRAWLING_HAND_HP).toBe(4);
    expect(CRAWLING_HAND_DAMAGE).toBe(1);
    expect(CRAWLING_HAND_SPEED_MULT).toBe(1.35);
    expect(CRAWLING_HAND_ESCAPE_COUNT).toBe(5);
    expect(CRAWLING_HAND_GRAB_DURATION).toBe(4.0);

    expect(MOVEMENT_BY_KIND.crawling_hand).toBe("flanker");
    expect(PAIN_BY_KIND.crawling_hand).toBe(0.65);
    expect(KIND_SKIN.crawling_hand?.scale).toBe(0.95);
  });

  it("registers crawling_hand in Bestiary, Reagents drops, Manifest, and Painters", () => {
    expect(KIND_INFO.crawling_hand.label).toBe("Crawling Hand");
    expect(KIND_INFO.crawling_hand.icon).toBe("🖐️");
    expect(KIND_INFO.crawling_hand.blurb).toContain("Addams Family");

    const drops = ENEMY_DROPS.crawling_hand;
    expect(drops).toBeDefined();
    expect(drops.some(d => d.id === "rotflesh")).toBe(true);
    expect(drops.some(d => d.id === "grimbone")).toBe(true);

    expect(IMPORTED_FACINGS.crawling_hand).toEqual(["S"]);
    expect(SHEET_PAINTERS.crawling_hand).toBeDefined();
    expect(KIND_PAINTS.crawling_hand).toBeDefined();
  });

  it("initiates grab and locks player when crawling_hand bites the player", () => {
    const hand: Zombie = {
      x: 5.2,
      z: 5.2,
      hp: 4,
      kind: "crawling_hand",
      mode: "idle",
      speed: 3.0,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: true,
      burnT: 0,
      sprite: {
        mesh: mockMesh(),
        setFacing: () => {},
        setTint: () => {},
        clearTint: () => {},
      } as any,
      anim: {
        play: () => {},
        update: () => {},
      } as any,
    };

    const p = state.player!;
    expect(p.handGrabT ?? 0).toBe(0);

    // Hand hits player
    hitPlayer(hand);

    expect(p.handGrabT).toBe(CRAWLING_HAND_GRAB_DURATION);
    expect(p.handGrabEscape).toBe(CRAWLING_HAND_ESCAPE_COUNT);
    expect(p.handGrabHost).toBe(hand);
  });

  it("allows other monsters to attack and damage player while grabbed, without displacing player away", () => {
    const hand: Zombie = {
      x: 5.0,
      z: 5.0,
      hp: 4,
      kind: "crawling_hand",
      mode: "idle",
      speed: 3.0,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: true,
      burnT: 0,
      sprite: { mesh: mockMesh(), setFacing: () => {}, setTint: () => {}, clearTint: () => {} } as any,
      anim: { play: () => {}, update: () => {} } as any,
    };

    const brute: Zombie = {
      x: 4.5,
      z: 5.0,
      hp: 20,
      kind: "brute",
      mode: "idle",
      speed: 2.0,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: true,
      burnT: 0,
      sprite: { mesh: mockMesh(), setFacing: () => {}, setTint: () => {}, clearTint: () => {} } as any,
      anim: { play: () => {}, update: () => {} } as any,
    };

    const p = state.player!;
    p.handGrabT = 4.0;
    p.handGrabEscape = 5;
    p.handGrabHost = hand;
    p.x = 5.0;
    p.z = 5.0;
    p.iframes = 0; // vulnerable to attacks

    const initialHp = p.hp;
    // Brute attacks pinned player!
    hitPlayer(brute);

    // Player took damage or lost armor durability
    const totalHealthLost = (initialHp - p.hp) + (5 - state.gear.head!.currentHp);
    expect(totalHealthLost).toBeGreaterThan(0);

    // Knockback displacement was suppressed: player remains at hand position!
    expect(p.x).toBe(5.0);
    expect(p.z).toBe(5.0);
  });

  it("escapes grab and stuns crawling hand when player spams buttons", () => {
    const hand: Zombie = {
      x: 5.0,
      z: 5.0,
      hp: 4,
      kind: "crawling_hand",
      mode: "idle",
      speed: 3.0,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: true,
      burnT: 0,
      sprite: { mesh: mockMesh(), setFacing: () => {}, setTint: () => {}, clearTint: () => {} } as any,
      anim: { play: () => {}, update: () => {} } as any,
    };

    const p = state.player!;
    p.handGrabT = 4.0;
    p.handGrabEscape = 3;
    p.handGrabHost = hand;

    // Simulate button inputs
    updatePlayer(0.016, makeMockInput({ attack: true }));
    expect(p.handGrabEscape).toBe(2);

    updatePlayer(0.016, makeMockInput({ dodge: true }));
    expect(p.handGrabEscape).toBe(1);

    updatePlayer(0.016, makeMockInput({ attack: true }));
    // Escaped!
    expect(p.handGrabT).toBe(0);
    expect(p.handGrabHost).toBeNull();
    expect(p.iframes).toBe(0.35);
    // Hand was stunned and put on cooldown
    expect(hand.cooldown).toBe(1.0);
    expect(hand.slipT).toBe(0.8);
  });

  it("breaks grab immediately if the crawling hand dies while holding the player", () => {
    const hand: Zombie = {
      x: 5.0,
      z: 5.0,
      hp: 0,
      kind: "crawling_hand",
      mode: "dead",
      speed: 3.0,
      windupT: 0,
      cooldown: 0,
      flashT: 0,
      aggro: true,
      burnT: 0,
      sprite: { mesh: mockMesh(), setFacing: () => {}, setTint: () => {}, clearTint: () => {} } as any,
      anim: { play: () => {}, update: () => {} } as any,
    };

    const p = state.player!;
    p.handGrabT = 3.5;
    p.handGrabEscape = 4;
    p.handGrabHost = hand;

    updatePlayer(0.016, makeMockInput());

    expect(p.handGrabT).toBe(0);
    expect(p.handGrabEscape).toBe(0);
    expect(p.handGrabHost).toBeNull();
  });
});
