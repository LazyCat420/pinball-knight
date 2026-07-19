/**
 * Station props — the furniture that makes each system a PLACE.
 *
 * The rule from TAVERN_PLAN: every interactable must be readable from shape plus
 * light colour, never from a permanent text label. So each station gets a
 * distinct silhouette (anvil vs bottles vs card table) and an accent light in
 * either the warm or the cold half of the palette.
 *
 * The centrepiece is a real pinball table used as the run diorama. That prop is
 * the tavern's identity test: the hub has to say "this is a pinball game" before
 * the player reads a single word of UI. It is built from the same vocabulary as
 * the dungeon's parts — a sloped playfield, rails, bumper caps, a plunger.
 */
import * as THREE from "three";
import { PALETTE_HEX } from "../dungeon/render/palette";
import { OBSTACLES, WARM, COLD, GOLD } from "./layout";
import { CARDS, RARITY_HEX, type CardId, type CardRarity } from "../dungeon/cards";
import { activeWeapon } from "../dungeon/state";

/** Most socket plates the vice can show — matches the max weapon card slots. */
const VICE_MAX_PLATES = 3;

/** Rarity order, for picking the emitter's colour from the best card fitted. */
const RARITY_ORDER: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

const STONE = PALETTE_HEX[2];
const TIMBER = PALETTE_HEX[26];
const TIMBER_DK = PALETTE_HEX[27] ?? PALETTE_HEX[26];
const STEEL = PALETTE_HEX[20];
const STEEL_DK = PALETTE_HEX[19];
const BRASS = PALETTE_HEX[15];
const BLOOD = PALETTE_HEX[11];

export interface BuiltProps {
  group: THREE.Group;
  /** Bumper caps on the diorama — pulsed by the loop to show a live machine. */
  bumpers: THREE.Mesh[];
  /** The ball that trundles around the diorama after a good run. */
  dioramaBall: THREE.Mesh;
  /** Forge coals, flickered warm. */
  coals: THREE.Mesh | null;
  /** Per-station accent lights, keyed by station id, for the focus pulse. */
  accents: Map<string, THREE.PointLight>;
  /**
   * Re-read the active weapon's socketed cards onto the vice.
   *
   * Called when the tavern opens and again whenever a station panel closes,
   * because socketing happens INSIDE those panels — the whole point is that you
   * shut the counter and see the card now sitting on the blade.
   */
  syncViceCards(): void;
  /** How many rune plates are currently lit on the vice (for QA/probes). */
  plateCount(): number;
  dispose(): void;
}

export function buildProps(scene: THREE.Scene): BuiltProps {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const bumpers: THREE.Mesh[] = [];
  const accents = new Map<string, THREE.PointLight>();

  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15, ...opts });
    mats.push(m);
    return m;
  };
  const emissive = (color: number, intensity = 1): THREE.MeshStandardMaterial =>
    mat(color, { emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group): THREE.Mesh => {
    const g = new THREE.BoxGeometry(w, h, d);
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cyl = (r: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group): THREE.Mesh => {
    const g = new THREE.CylinderGeometry(r, r, h, 10);
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  /** A station's accent light — the colour-coded "you can use this" tell. */
  const accent = (id: string, color: number, x: number, y: number, z: number, intensity = 2.2): void => {
    const l = new THREE.PointLight(color, intensity, 6, 2);
    l.position.set(x, y, z);
    group.add(l);
    accents.set(id, l);
  };

  // ══════════════════════════════════════════════════════════
  // CENTRAL PINBALL TABLE — the run diorama, and the room's thesis.
  // ══════════════════════════════════════════════════════════
  const t = OBSTACLES[0]; // { x: 0, z: -1.6, w: 3.6, d: 2.0 }
  const tableTop = 0.92;

  // Cabinet: heavy timber body on squat legs, like a real machine.
  box(t.w, 0.5, t.d, mat(TIMBER_DK), t.x, tableTop - 0.25, t.z);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(0.22, tableTop - 0.5, 0.22, mat(TIMBER), t.x + sx * (t.w / 2 - 0.2), (tableTop - 0.5) / 2, t.z + sz * (t.d / 2 - 0.2));
    }
  }

  // Playfield: a glass-topped slope, tilted so the far end sits higher — the
  // read that says "pinball table" rather than "dining table" at a glance.
  const field = new THREE.Group();
  field.position.set(t.x, tableTop, t.z);
  field.rotation.x = -0.13;
  group.add(field);

  box(t.w - 0.3, 0.06, t.d - 0.2, mat(0x11202b, { roughness: 0.5 }), 0, 0, 0, field);

  // Side rails in oxidised steel.
  for (const sx of [-1, 1]) {
    box(0.1, 0.16, t.d - 0.2, mat(STEEL_DK, { metalness: 0.6, roughness: 0.5 }), sx * (t.w / 2 - 0.2), 0.1, 0, field);
  }

  // Lit bumper caps — these are the run's completed targets.
  const bumperMat = emissive(COLD, 0.5);
  for (const [bx, bz] of [
    [-0.75, -0.35],
    [0, -0.6],
    [0.75, -0.35],
    [-0.4, 0.25],
    [0.5, 0.3],
  ]) {
    const b = cyl(0.16, 0.14, bumperMat, bx, 0.11, bz, field);
    bumpers.push(b);
  }

  // A pair of flippers at the near end, in brass.
  const flipperMat = mat(BRASS, { metalness: 0.7, roughness: 0.35 });
  for (const sx of [-1, 1]) {
    const f = box(0.42, 0.08, 0.11, flipperMat, sx * 0.42, 0.09, t.d / 2 - 0.42, field);
    f.rotation.y = sx * 0.42;
  }

  // The ball — parked until a strong run sends it round (see core's loop).
  const ballGeo = new THREE.SphereGeometry(0.075, 10, 8);
  geos.push(ballGeo);
  const ballMat = mat(0xd8dee9, { metalness: 0.9, roughness: 0.15 });
  const dioramaBall = new THREE.Mesh(ballGeo, ballMat);
  dioramaBall.position.set(0, 0.13, 0.2);
  field.add(dioramaBall);

  // Plunger lane on the right edge, aimed at the notice board — the visual rhyme
  // with the descent gate.
  box(0.12, 0.1, 0.5, mat(STEEL), t.w / 2 - 0.32, 0.1, t.d / 2 - 0.3, field);

  // Backglass: a distressed jackpot sign, half-broken. Gold is reserved for
  // rewards, so this is the one place it appears in the room's furniture.
  const glass = box(t.w - 0.4, 0.9, 0.12, mat(0x1a1410), t.x, tableTop + 0.45, t.z - t.d / 2 + 0.1);
  glass.rotation.x = -0.16;
  const signMat = emissive(GOLD, 0.75);
  box(t.w - 0.9, 0.26, 0.04, signMat, t.x, tableTop + 0.62, t.z - t.d / 2 + 0.02);

  accent("table", COLD, t.x, tableTop + 0.7, t.z + 0.4, 1.8);

  // ══════════════════════════════════════════════════════════
  // FORGE — west/northwest. Warm, loud, metal.
  // ══════════════════════════════════════════════════════════
  const f = OBSTACLES[1]; // { x: -7.2, z: -2.6 }
  box(f.w, 1.3, f.d, mat(STONE), f.x, 0.65, f.z); // hearth block
  box(1.1, 0.22, 0.9, mat(0x120c08), f.x + 0.4, 1.35, f.z); // coal bed recess
  const coals = box(0.95, 0.1, 0.75, emissive(WARM, 1.6), f.x + 0.4, 1.42, f.z);
  // Anvil, on a stump, in front of the hearth.
  box(0.5, 0.4, 0.5, mat(TIMBER_DK), f.x + 1.0, 0.2, f.z + 1.3);
  box(0.62, 0.2, 0.3, mat(STEEL_DK, { metalness: 0.75, roughness: 0.35 }), f.x + 1.0, 0.5, f.z + 1.3);
  // Chimney hood.
  box(1.6, 1.1, 1.6, mat(STEEL_DK, { metalness: 0.5 }), f.x + 0.2, 2.5, f.z);
  accent("forge", WARM, f.x + 0.8, 1.5, f.z + 0.6, 3.2);

  // ══════════════════════════════════════════════════════════
  // BAR — east. Bottles, brass rail, warm lamps.
  // ══════════════════════════════════════════════════════════
  const b = OBSTACLES[2]; // { x: 7.2, z: -2.6 }
  box(b.w, 1.1, b.d, mat(TIMBER), b.x, 0.55, b.z); // counter
  box(b.w + 0.2, 0.1, b.d + 0.2, mat(TIMBER_DK), b.x, 1.15, b.z); // top lip
  box(0.08, 0.08, b.d, mat(BRASS, { metalness: 0.8, roughness: 0.3 }), b.x - b.w / 2 - 0.1, 0.95, b.z); // foot rail
  // Back shelf with bottles — a cluster of thin cylinders reads unmistakably.
  box(0.4, 1.8, b.d, mat(TIMBER_DK), b.x + 1.0, 0.9, b.z);
  const bottleMats = [emissive(0x3f9d5a, 0.35), emissive(BLOOD, 0.3), emissive(COLD, 0.3)];
  for (let i = 0; i < 7; i++) {
    cyl(0.07, 0.34, bottleMats[i % 3], b.x + 0.85, 1.15 + (i % 2) * 0.55, b.z - 0.8 + i * 0.26);
  }
  accent("bar", WARM, b.x - 0.6, 1.7, b.z, 2.6);

  // ══════════════════════════════════════════════════════════
  // CARD DEALER — southeast. Felt table, card trays, cold glow.
  // ══════════════════════════════════════════════════════════
  const d = OBSTACLES[3]; // { x: 7.2, z: 2.8 }
  box(d.w, 0.12, d.d, mat(0x18313f, { roughness: 0.9 }), d.x, 0.86, d.z); // felt top
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(0.16, 0.86, 0.16, mat(TIMBER_DK), d.x + sx * (d.w / 2 - 0.2), 0.43, d.z + sz * (d.d / 2 - 0.2));
    }
  }
  // Oversized engraved steel cards, standing in a tray — the spec's "no floating
  // UI cards until you interact".
  const plateMat = mat(STEEL, { metalness: 0.7, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const c = box(0.36, 0.52, 0.03, plateMat, d.x - 0.5 + i * 0.5, 1.18, d.z - 0.2);
    c.rotation.z = (i - 1) * 0.09;
    c.rotation.x = -0.22;
  }
  accent("dealer", COLD, d.x, 1.5, d.z + 0.5, 2.4);

  // ══════════════════════════════════════════════════════════
  // ARMORY BENCH — southwest. Vice, racks, discarded plate.
  // ══════════════════════════════════════════════════════════
  const a = OBSTACLES[4]; // { x: -7.2, z: 2.8 }
  box(a.w, 0.16, a.d, mat(TIMBER), a.x, 0.88, a.z); // bench top
  for (const sx of [-1, 1]) {
    box(0.18, 0.88, a.d - 0.3, mat(TIMBER_DK), a.x + sx * (a.w / 2 - 0.2), 0.44, a.z);
  }
  // A repair vice, and YOUR weapon held in it — the physical home for upgrades.
  // The rune plates on it are the socketed cards (see syncViceCards below), so a
  // card is something you can SEE on the blade before you open any UI.
  box(0.3, 0.26, 0.3, mat(STEEL_DK, { metalness: 0.7 }), a.x + 0.7, 1.06, a.z - 0.4);
  const held = box(0.1, 0.9, 0.1, mat(STEEL, { metalness: 0.8, roughness: 0.3 }), a.x + 0.7, 1.55, a.z - 0.4);
  held.rotation.z = 0.22;

  // Socket plates + the emitter at the hilt. Built once at max capacity and
  // shown/hidden on sync, so socketing a card never allocates mid-scene.
  const viceGroup = new THREE.Group();
  viceGroup.position.set(a.x + 0.7, 0, a.z - 0.4);
  group.add(viceGroup);
  const vicePlates: THREE.Mesh[] = [];
  for (let i = 0; i < VICE_MAX_PLATES; i++) {
    const g = new THREE.BoxGeometry(0.17, 0.13, 0.05);
    geos.push(g);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.4 });
    mats.push(m);
    const plate = new THREE.Mesh(g, m);
    // Down the blade, following its lean.
    plate.position.set(-0.055 - i * 0.03, 1.78 - i * 0.26, 0.06);
    plate.rotation.z = 0.22;
    plate.visible = false;
    viceGroup.add(plate);
    vicePlates.push(plate);
  }
  const emitterGeo = new THREE.SphereGeometry(0.075, 8, 6);
  geos.push(emitterGeo);
  const emitterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.3 });
  mats.push(emitterMat);
  const viceEmitter = new THREE.Mesh(emitterGeo, emitterMat);
  viceEmitter.position.set(0.02, 1.14, 0.03);
  viceEmitter.visible = false;
  viceGroup.add(viceEmitter);
  const viceLight = new THREE.PointLight(0xffffff, 0, 2.4, 2);
  viceLight.position.set(a.x + 0.7, 1.5, a.z - 0.3);
  group.add(viceLight);
  // Rack of plate behind, against the wall.
  box(0.3, 1.7, a.d, mat(TIMBER_DK), a.x - 1.0, 0.85, a.z);
  for (let i = 0; i < 3; i++) {
    box(0.14, 0.44, 0.36, mat(STEEL_DK, { metalness: 0.6 }), a.x - 0.8, 1.5 - i * 0.5, a.z - 0.5 + i * 0.5);
  }
  accent("armory", WARM, a.x + 0.6, 1.6, a.z + 0.5, 2.4);

  // ══════════════════════════════════════════════════════════
  // NOTICE BOARD + DESCENT PLUNGER — north wall. The way out.
  // ══════════════════════════════════════════════════════════
  const n = OBSTACLES[5]; // { x: 0, z: -6.4 }
  box(n.w, 2.2, 0.3, mat(TIMBER_DK), n.x, 1.1, n.z - 0.2); // board backing
  box(n.w - 0.3, 1.7, 0.06, mat(0x241a12), n.x, 1.25, n.z - 0.02); // cork face
  // Pinned notices — pale scraps, deliberately uneven.
  for (let i = 0; i < 5; i++) {
    const p = box(0.42, 0.5, 0.02, mat(0xb9ae94), n.x - 1.3 + i * 0.66, 1.3 + ((i * 37) % 3) * 0.12, n.z + 0.02);
    p.rotation.z = (((i * 53) % 7) - 3) * 0.04;
  }
  // THE PLUNGER — a real launcher housing set into the wall beside the board.
  // Pulling it sends you back into the machine.
  const plungerX = n.x + n.w / 2 + 0.5;
  box(0.5, 1.0, 0.5, mat(STEEL_DK, { metalness: 0.6 }), plungerX, 0.5, n.z);
  const rod = cyl(0.06, 0.8, mat(STEEL, { metalness: 0.9, roughness: 0.2 }), plungerX, 1.3, n.z);
  rod.rotation.x = 0;
  cyl(0.16, 0.16, emissive(BLOOD, 0.9), plungerX, 1.75, n.z); // the knob
  // A cold lane of light on the floor pointing at the plunger — the "way down"
  // reading, without a label.
  const laneGeo = new THREE.PlaneGeometry(0.8, 2.4);
  geos.push(laneGeo);
  const laneMat = new THREE.MeshBasicMaterial({ color: COLD, transparent: true, opacity: 0.14, depthWrite: false });
  mats.push(laneMat);
  const lane = new THREE.Mesh(laneGeo, laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(plungerX, 0.02, n.z + 1.6);
  group.add(lane);
  accent("board", COLD, n.x, 1.8, n.z + 0.8, 2.6);

  // Bent rails and chrome bumpers mounted into the walls, so the tavern itself
  // looks built out of old machine internals (TAVERN_PLAN §Rules).
  const railMat = mat(STEEL_DK, { metalness: 0.65, roughness: 0.4 });
  for (const [rx, rz, rw] of [
    [-4.5, -6.6, 3.0],
    [4.5, -6.6, 3.0],
  ]) {
    box(rw, 0.12, 0.12, railMat, rx, 2.3, rz);
    box(rw, 0.12, 0.12, railMat, rx, 1.9, rz);
  }
  const capMat = emissive(COLD, 0.35);
  for (const cx of [-3.2, -1.8, 1.8, 3.2]) {
    cyl(0.2, 0.12, capMat, cx, 2.65, -6.6);
  }

  scene.add(group);

  return {
    group,
    bumpers,
    dioramaBall,
    coals,
    accents,
    plateCount(): number {
      return vicePlates.reduce((n, p) => n + (p.visible ? 1 : 0), 0);
    },
    syncViceCards(): void {
      const w = activeWeapon();
      const ids = (w?.cards ?? []) as CardId[];
      let best = -1;

      for (let i = 0; i < vicePlates.length; i++) {
        const def = i < ids.length ? CARDS[ids[i]] : undefined;
        const plate = vicePlates[i];
        plate.visible = !!def;
        if (!def) continue;
        const hex = RARITY_HEX[def.rarity];
        const m = plate.material as THREE.MeshStandardMaterial;
        m.color.set(hex);
        m.emissive.set(hex);
        best = Math.max(best, RARITY_ORDER.indexOf(def.rarity));
      }

      // The emitter takes the BEST card's colour — one glance tells you the
      // grade of what is fitted, without counting plates.
      if (best >= 0) {
        const hex = RARITY_HEX[RARITY_ORDER[best]];
        emitterMat.color.set(hex);
        emitterMat.emissive.set(hex);
        viceEmitter.visible = true;
        viceLight.color.set(hex);
        viceLight.intensity = 1.6;
      } else {
        viceEmitter.visible = false;
        viceLight.intensity = 0;
      }
    },
    dispose(): void {
      scene.remove(group);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
