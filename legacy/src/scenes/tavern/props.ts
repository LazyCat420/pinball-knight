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
import { PALETTE_HEX } from "../../game/pinball-knight/render/palette";
import { OBSTACLES, ROOM, WARM, COLD, GOLD } from "./layout";

/** Just inside the south wall — where the dartboard hangs. */
const ROOM_MAX_Z_PROP = ROOM.maxZ - 0.2;
import { CARDS, RARITY_HEX, type CardId, type CardRarity } from "../../game/pinball-knight/cards";
import { activeWeapon } from "../../game/pinball-knight/state";

/** Most socket plates the vice can show — matches the max weapon card slots. */
const VICE_MAX_PLATES = 3;

/** Rarity order, for picking the emitter's colour from the best card fitted. */
const RARITY_ORDER: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];

/**
 * Draw a lit marquee legend onto a canvas, for the one sign the room carries.
 *
 * Texel density is chosen to survive the pixel post-pass: at 1024x208 across a
 * 3.1-unit plane the glyphs land near the pass's own grid, so the strokes stay
 * crisp instead of shimmering as the camera eases. Alpha, not a background
 * colour — the housing behind it is real geometry and should light normally.
 *
 * Falls back to a plain (untextured) panel if 2D canvas is unavailable, which is
 * the headless/probe path: the sign loses its letters, never the whole scene.
 */
export function makeSignTexture(text: string): THREE.CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 220; // ~= the 4.2 x 0.9 panel's aspect, so glyphs stay square
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // MEASURE, then fit. 'Press Start 2P' may or may not have loaded by the time
  // the tavern builds (it is a webfont and this runs on scene open), and the
  // monospace fallback is a different width per em. Picking a size by eye means
  // the word overflows the plane in one case and floats in a sea of alpha in the
  // other, and the second is what the first render actually looked like. Binary-
  // free fit: measure at a reference size and scale to 92% of the canvas width.
  // The word gets the middle 74% and the two arrow gutters take the rest.
  const TEXT_FRAC = 0.74;
  const REF = 100;
  ctx.font = `${REF}px 'Press Start 2P', monospace`;
  const refW = ctx.measureText(text).width || canvas.width;
  const size = Math.min((canvas.width * TEXT_FRAC * REF) / refW, canvas.height * 0.6);
  ctx.font = `${Math.round(size)}px 'Press Start 2P', monospace`;

  // Three passes, dark to light. The wide dark stroke is what keeps the legend
  // readable against the tavern's warm bloom; without it the cyan fill blows out
  // to white at the edges and the word turns into a bar of light.
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#06181f";
  ctx.lineWidth = Math.max(8, size * 0.24);
  ctx.strokeText(text, cx, cy);
  ctx.shadowColor = "#6fd0e8";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#6fd0e8";
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#eafaff";
  ctx.fillText(text, cx, cy - Math.round(size * 0.04));

  // A down-arrow in each gutter, pointing at the board below the sign.
  //
  // NARROW AND TALL, not the squat equilateral triangle drawn first. The sign's
  // plane is foreshortened to roughly half-height by the iso camera, so a wide
  // shallow arrowhead comes out of the projection wider than it is tall and
  // reads as a sideways pennant — which is exactly what the first render showed.
  // Half as wide and with a stem, the vertical axis survives the squash.
  const gutter = canvas.width * (1 - TEXT_FRAC) * 0.5;
  const aw = Math.min(gutter * 0.34, canvas.height * 0.2);
  const top = canvas.height * 0.14;
  const bot = canvas.height * 0.86;
  for (const side of [-1, 1]) {
    const ax = side < 0 ? gutter * 0.52 : canvas.width - gutter * 0.52;
    ctx.beginPath();
    ctx.moveTo(ax - aw * 0.42, top); // stem
    ctx.lineTo(ax + aw * 0.42, top);
    ctx.lineTo(ax + aw * 0.42, bot - aw * 1.5);
    ctx.lineTo(ax + aw, bot - aw * 1.5); // head
    ctx.lineTo(ax, bot);
    ctx.lineTo(ax - aw, bot - aw * 1.5);
    ctx.lineTo(ax - aw * 0.42, bot - aw * 1.5);
    ctx.closePath();
    ctx.strokeStyle = "#06181f";
    ctx.lineWidth = Math.max(6, aw * 0.5);
    ctx.stroke();
    // Filled at the LETTERS' brightness, not the accent's. At plain COLD the
    // arrows came back visibly dimmer than the word beside them, because the
    // glyphs get a third white pass on top and the arrows did not — the eye read
    // that as two different signs sharing a panel.
    ctx.fillStyle = "#bfeef8";
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Default flipY stays TRUE. The inverted glyphs this sign shipped with were
  // the PIXEL PASS flipping the whole presented frame (rtUv in
  // engine/render/pixel-pass.ts) — setting flipY=false here made the sign read
  // correctly inside a frame that was still upside down, which is how the
  // "everything else is still upside down" report happened.
  return tex;
}

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
  /** The ENTER MAZE legend. Owned here so dispose() frees the GPU texture too. */
  let signTex: THREE.CanvasTexture | null = null;

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
  //
  // REBUILT 2026-07-20, from a screenshot rather than from reasoning. The old
  // one read as a COUCH, and once you have seen it you cannot unsee it: a wide
  // shallow timber body, a flat dark top, a low panel across the back and five
  // glowing caps that landed exactly where cushions would be. Four things were
  // wrong, and each of them is fixed here:
  //
  //  1. IT WAS LANDSCAPE. 3.6 wide by 2.0 deep is a sofa's footprint. A pinball
  //     machine is narrow and deep with the long axis pointing away from you.
  //     The rect in layout.ts is now 2.3 x 3.2. This is the single change that
  //     did most of the work.
  //  2. THE RAKE WAS BACKWARDS. `field.rotation.x = -0.13` with +z toward the
  //     camera raises the NEAR edge and drops the far one — the opposite of the
  //     comment above it, and it tilted the playfield away from the viewer so
  //     the slope was invisible. It is +RAKE now, and steeper.
  //  3. THE MARQUEE WAS OCCLUDED BY ITS OWN BACKGLASS. The gold sign sat at
  //     z -2.58 and the dark glass panel at z -2.50, i.e. the sign was BEHIND
  //     the thing it was supposed to be lighting up, from a camera at +z. The
  //     one gold accent in the room's furniture never rendered a pixel.
  //  4. THERE WAS NO BACKBOX. A 0.9-high panel leaning back off the rear edge is
  //     a sofa back. A backbox is a tall vertical head standing proud of the
  //     cabinet with a lit face — it is most of the silhouette.
  // ══════════════════════════════════════════════════════════
  const t = OBSTACLES[0]; // { x: 0, z: -1.6, w: 2.3, d: 3.2 }
  /** Playfield slope. ~11°, well over life-size, because the read matters more. */
  const RAKE = 0.2;
  /** Top of the legs / bottom of the cabinet body. */
  const CAB_BOT = 0.5;
  /** Deck height at the near (player) end, and at the far end after the rake. */
  const DECK_FRONT = 1.02;
  const DECK_BACK = DECK_FRONT + t.d * Math.sin(RAKE);
  /** How far the cabinet sides stand proud of the deck — the ball-return lip. */
  const SIDE_LIP = 0.16;
  const SIDE_TOP_BACK = DECK_BACK + SIDE_LIP;

  const cabMat = mat(TIMBER_DK);
  const chromeMat = mat(STEEL, { metalness: 0.9, roughness: 0.2 });

  // Legs: four, equal, chrome, and actually visible. The old ones were 0.22
  // timber blocks tucked under a body that overhung them, so the machine looked
  // like it was sitting on the floor.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(0.14, CAB_BOT, 0.14, chromeMat, t.x + sx * (t.w / 2 - 0.12), CAB_BOT / 2, t.z + sz * (t.d / 2 - 0.12));
    }
  }

  // ── The cabinet, as a WEDGE ── two extruded side panels whose top edge climbs
  // from front to back. This is the profile that reads "pinball" from any angle,
  // and a box cannot fake it: a level body with a raked lid leaves a triangular
  // void down each flank that the iso camera looks straight into.
  const sideShape = new THREE.Shape();
  sideShape.moveTo(t.d / 2, CAB_BOT); // front bottom
  sideShape.lineTo(t.d / 2, DECK_FRONT + SIDE_LIP); // front top
  sideShape.lineTo(-t.d / 2, SIDE_TOP_BACK); // back top
  sideShape.lineTo(-t.d / 2, CAB_BOT); // back bottom
  sideShape.closePath();
  const sideGeo = new THREE.ExtrudeGeometry(sideShape, { depth: 0.14, bevelEnabled: false });
  geos.push(sideGeo);
  // The shape is authored in (z, y) and extruded along its own +z, so a -90° yaw
  // maps shape-x onto world +z and pushes the thickness toward world -x.
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(sideGeo, cabMat);
    side.rotation.y = -Math.PI / 2;
    side.position.set(t.x + sx * (t.w / 2) + (sx > 0 ? 0 : 0.14), 0, t.z);
    side.castShadow = true;
    side.receiveShadow = true;
    group.add(side);
  }
  // Back and front panels closing the wedge, plus a floor pan so you never see
  // daylight under the machine.
  box(t.w, SIDE_TOP_BACK - CAB_BOT, 0.14, cabMat, t.x, (CAB_BOT + SIDE_TOP_BACK) / 2, t.z - t.d / 2 + 0.07);
  box(t.w, DECK_FRONT + SIDE_LIP - CAB_BOT, 0.14, cabMat, t.x, (CAB_BOT + DECK_FRONT + SIDE_LIP) / 2, t.z + t.d / 2 - 0.07);
  box(t.w, 0.1, t.d, mat(0x141018), t.x, CAB_BOT + 0.05, t.z);
  // The lockdown bar — the brass lip you rest your hands on. Reads as the front
  // of a machine and nothing else.
  box(t.w + 0.04, 0.1, 0.16, mat(BRASS, { metalness: 0.8, roughness: 0.3 }), t.x, DECK_FRONT + SIDE_LIP, t.z + t.d / 2 - 0.08);

  // ── The playfield ── a raked group. Everything on the machine's top surface
  // is a child of this, so it all follows the slope for free.
  const field = new THREE.Group();
  field.position.set(t.x, (DECK_FRONT + DECK_BACK) / 2, t.z);
  field.rotation.x = RAKE;
  group.add(field);

  /** Deck half-extents in FIELD space — everything below is placed against these. */
  const fW = (t.w - 0.28) / 2;
  const fD = t.d / Math.cos(RAKE) / 2;
  // Lit rather than merely dark: at this exposure a plain 0x11202b deck was the
  // same value as the timber around it, which is half of why the top read as a
  // cushion instead of glass over a light box.
  box(fW * 2, 0.06, fD * 2, mat(0x14283a, { roughness: 0.4, emissive: 0x0d2233, emissiveIntensity: 0.6 }), 0, 0, 0, field);

  // Lit bumper caps — these are the run's completed targets.
  // ONE MATERIAL PER CAP, deliberately. They used to share a single instance,
  // which meant the loop's per-cap `emissiveIntensity` writes all landed on the
  // same object and the last one won: five caps that always lit and dimmed in
  // perfect unison, while the code that wrote them looked like a chase.
  // Clustered in the UPPER half now, where a real bumper field lives — spread
  // evenly over a wide table they were exactly a row of scatter cushions.
  for (const [bx, bz] of [
    [-0.5, -0.95],
    [0.48, -1.0],
    [0, -0.55],
    [-0.55, -0.1],
    [0.52, -0.15],
  ]) {
    const b = cyl(0.15, 0.16, emissive(COLD, 0.5), bx, 0.12, bz, field);
    bumpers.push(b);
  }

  // A pair of flippers at the near end, in brass, splayed into the drain. These
  // are the closest thing on the machine to the camera and the first shape the
  // eye lands on, so they are oversized and sit proud of the deck.
  const flipperMat = mat(BRASS, { metalness: 0.7, roughness: 0.35, emissive: BRASS, emissiveIntensity: 0.25 });
  for (const sx of [-1, 1]) {
    const f = box(0.46, 0.1, 0.12, flipperMat, sx * 0.34, 0.1, fD - 0.36, field);
    f.rotation.y = sx * 0.5;
  }

  // The ball — parked until a strong run sends it round (see core's loop).
  const ballGeo = new THREE.SphereGeometry(0.075, 10, 8);
  geos.push(ballGeo);
  const ballMat = mat(0xd8dee9, { metalness: 0.9, roughness: 0.15 });
  const dioramaBall = new THREE.Mesh(ballGeo, ballMat);
  dioramaBall.position.set(0, 0.13, 0.2);
  field.add(dioramaBall);

  // ── The bits that make it a PINBALL playfield rather than a lit table ──
  // A shooter lane, lane guides, a ramp, a spinner and drop targets. All of it
  // lives inside the cabinet footprint, so the rect in layout.ts is untouched.
  const guideMat = mat(STEEL, { metalness: 0.75, roughness: 0.3 });
  // THE PLUNGER LANE: a full-length divider down the east flank with the ball
  // shooter poking out through the apron. On a real machine this is the one lane
  // that runs the whole depth of the table, and from above it is the stripe that
  // tells you which way the machine faces. Kept at x 0.92 so the diorama ball's
  // 0.85-radius lap (core.ts) runs inside it rather than through it.
  box(0.06, 0.22, fD * 1.7, guideMat, 0.92, 0.12, -0.1, field);
  const shooterRod = cyl(0.045, 0.34, chromeMat, 0.92, 0.06, fD + 0.08, field);
  shooterRod.rotation.x = Math.PI / 2;
  const shooterKnob = cyl(0.09, 0.09, emissive(BLOOD, 0.9), 0.92, 0.06, fD + 0.26, field);
  shooterKnob.rotation.x = Math.PI / 2;
  // Curved outlanes sweeping from the top arch down toward the flippers — the
  // funnel shape that says the ball drains toward you.
  const guideGeo = new THREE.TorusGeometry(0.7, 0.025, 6, 12, Math.PI * 0.7);
  geos.push(guideGeo);
  for (const sx of [-1, 1]) {
    const guide = new THREE.Mesh(guideGeo, guideMat);
    guide.position.set(sx * (fW - 0.22), 0.1, 0.35);
    guide.rotation.set(-Math.PI / 2, 0, sx > 0 ? -Math.PI * 0.85 : Math.PI * 0.15);
    field.add(guide);
  }
  // A habitrail ramp climbing toward the back arch — the one piece with real
  // height on it, so the field reads as three-dimensional and not printed.
  const rampMat = mat(0x2a4a5c, { metalness: 0.4, roughness: 0.45 });
  const ramp = box(0.3, 0.05, 1.3, rampMat, -0.52, 0.26, -0.35, field);
  ramp.rotation.x = 0.34;
  for (const rz of [-0.85, 0.1]) box(0.05, 0.34, 0.05, guideMat, -0.52, 0.16, rz, field);
  // Drop-target bank: three blades standing in a row across the upper field.
  const targetMat = emissive(COLD, 0.4);
  for (let i = -1; i <= 1; i++) box(0.2, 0.14, 0.03, targetMat, i * 0.26, 0.12, -1.34, field);
  // The spinner — a blade hung edge-on between two posts across a lane.
  for (const sx of [-1, 1]) box(0.04, 0.22, 0.04, guideMat, sx * 0.16, 0.15, 0.75, field);
  const spinner = box(0.28, 0.18, 0.015, mat(BRASS, { metalness: 0.8, roughness: 0.3 }), 0, 0.17, 0.75, field);
  spinner.rotation.x = 0.35;
  // Slingshot kickers above the flippers, angled in toward the drain.
  const slingMat = mat(BLOOD, { roughness: 0.6, emissive: BLOOD, emissiveIntensity: 0.35 });
  for (const sx of [-1, 1]) {
    const s = box(0.4, 0.11, 0.08, slingMat, sx * 0.74, 0.11, fD - 0.75, field);
    s.rotation.y = sx * -0.9;
  }

  // ── THE BACKBOX ── tall, vertical, standing proud of the cabinet with a lit
  // marquee facing the camera. Leaned FORWARD (+x rotation tips the top toward
  // +z) so the face is presented to a camera that looks down from the south
  // rather than skewed away from it. Gold is reserved for rewards, so this is
  // the one place it appears in the room's furniture.
  const head = new THREE.Group();
  head.position.set(t.x, SIDE_TOP_BACK - 0.05, t.z - t.d / 2 + 0.16);
  head.rotation.x = 0.12;
  group.add(head);
  const HEAD_H = 1.35;
  box(t.w - 0.04, HEAD_H, 0.24, cabMat, 0, HEAD_H / 2, 0, head); // housing
  box(t.w - 0.2, HEAD_H - 0.18, 0.03, mat(0x120e0a), 0, HEAD_H / 2, 0.13, head); // bezel
  // 0.95 came back from the render as a flat cream-white rectangle — the pixel
  // pass's bloom takes an emissive this large well past the palette's gold and
  // into paper. 0.45 is where it still reads as LIT but keeps its hue.
  box(t.w - 0.34, HEAD_H - 0.36, 0.05, emissive(GOLD, 0.22), 0, HEAD_H / 2 + 0.02, 0.15, head); // the marquee
  for (const sx of [-1, 1]) box(0.07, HEAD_H, 0.28, chromeMat, sx * (t.w / 2 - 0.05), HEAD_H / 2, 0.02, head); // chrome side trim
  box(t.w - 0.3, 0.09, 0.12, emissive(COLD, 0.5), 0, HEAD_H + 0.02, 0.1, head); // topper strip
  // Score reels under the marquee — three small cold windows, which is what
  // makes the head read as a READOUT rather than a painted board.
  for (let i = -1; i <= 1; i++) box(0.2, 0.16, 0.04, emissive(COLD, 0.7), i * 0.28, 0.3, 0.16, head);

  // Two accents, not one: the head lights itself from the front (so the marquee
  // is never a flat unlit rectangle at this exposure) and the playfield glows up
  // out of the cabinet. The map key stays "table" — stations.ts pulses by id.
  accent("table", COLD, t.x, DECK_BACK + 0.35, t.z + 0.2, 3.4);
  const headGlow = new THREE.PointLight(GOLD, 2.4, 5, 2);
  headGlow.position.set(t.x, SIDE_TOP_BACK + 0.9, t.z - t.d / 2 + 0.9);
  group.add(headGlow);

  // ══════════════════════════════════════════════════════════
  // FORGE — west/northwest. Warm, loud, metal.
  // ══════════════════════════════════════════════════════════
  const f = OBSTACLES[1]; // { x: -7.2, z: -2.6 }
  // The hearth is NOT the room's generic STONE. It used to be, and the render
  // showed why that fails: palette index 2 is a cold blue-grey, so the forge's
  // whole mass sat in the cold half of the palette with a 0.95 x 0.75 orange
  // sliver on top of it — the one prop that is supposed to anchor the warm side
  // of the room was the bluest object in frame. Fire-stained brick instead.
  const HEARTH = 0x5a4436;
  box(f.w, 1.3, f.d, mat(HEARTH), f.x, 0.65, f.z); // hearth block
  box(1.1, 0.22, 0.9, mat(0x120c08), f.x + 0.4, 1.35, f.z); // coal bed recess
  const coals = box(0.95, 0.1, 0.75, emissive(WARM, 1.6), f.x + 0.4, 1.42, f.z);
  // Anvil, on a stump, in front of the hearth.
  box(0.5, 0.4, 0.5, mat(TIMBER_DK), f.x + 1.0, 0.2, f.z + 1.3);
  box(0.62, 0.2, 0.3, mat(STEEL_DK, { metalness: 0.75, roughness: 0.35 }), f.x + 1.0, 0.5, f.z + 1.3);
  // Chimney hood.
  box(1.6, 1.1, 1.6, mat(0x2b2521, { metalness: 0.1, roughness: 1 }), f.x + 0.2, 2.5, f.z);

  // ── What makes it read FORGE and not "lit fireplace" ──
  // Everything here sits either on top of the hearth block (which fills the
  // whole obstacle rect, so nothing can be walked into) or hangs under the hood
  // above head height. The rect in layout.ts is untouched.
  const ironMat = mat(STEEL_DK, { metalness: 0.7, roughness: 0.4 });
  const hotMat = emissive(WARM, 1.2);
  // Mantel lip along the front edge, so the block has a top rather than a face.
  box(f.w, 0.14, 0.18, mat(HEARTH), f.x, 1.36, f.z + f.d / 2 - 0.12);
  // The bellows — a fat wedge on the hearth's far side with a nozzle into the
  // coals. Two stacked boxes read as the leather concertina at this distance.
  box(0.62, 0.3, 0.5, mat(TIMBER_DK), f.x - 0.85, 1.62, f.z - 0.15);
  box(0.5, 0.18, 0.38, mat(BLOOD, { roughness: 0.95 }), f.x - 0.85, 1.42, f.z - 0.15);
  const nozzle = cyl(0.05, 0.55, ironMat, f.x - 0.4, 1.4, f.z - 0.05);
  nozzle.rotation.z = Math.PI / 2;
  box(0.1, 0.34, 0.1, mat(TIMBER), f.x - 1.05, 1.92, f.z - 0.15); // bellows handle
  // Tool bar under the hood: tongs, a hammer and a poker hanging in a row.
  box(1.5, 0.05, 0.05, ironMat, f.x + 0.2, 1.92, f.z + 0.3);
  for (const [tx, len] of [
    [-0.42, 0.42],
    [0.1, 0.3],
    [0.62, 0.5],
  ]) {
    box(0.05, len, 0.05, ironMat, f.x + 0.2 + tx, 1.9 - len / 2, f.z + 0.3);
  }
  box(0.2, 0.1, 0.09, ironMat, f.x + 0.3, 1.6, f.z + 0.3); // that one's a hammer
  box(0.16, 0.05, 0.16, ironMat, f.x - 0.22, 1.5, f.z + 0.3); // and that one's tongs
  // Quench trough sunk into the hearth top — the still dark water beside the
  // coals is the whole reason a smithy looks like a smithy.
  box(0.52, 0.24, 0.72, mat(0x0e1418), f.x - 0.75, 1.4, f.z + 0.45);
  box(0.42, 0.02, 0.62, mat(0x1b3a48, { roughness: 0.25, metalness: 0.3 }), f.x - 0.75, 1.51, f.z + 0.45);
  // Stock on the lip: two horseshoes and a couple of glowing billets pulled
  // half out of the fire.
  const shoeGeo = new THREE.TorusGeometry(0.1, 0.028, 5, 9, Math.PI * 1.45);
  geos.push(shoeGeo);
  for (const hz of [-0.75, -0.45]) {
    const shoe = new THREE.Mesh(shoeGeo, ironMat);
    shoe.position.set(f.x - 0.6, 1.38, f.z + hz);
    shoe.rotation.x = -Math.PI / 2;
    group.add(shoe);
  }
  box(0.5, 0.06, 0.08, hotMat, f.x + 0.95, 1.4, f.z - 0.25); // billet, still orange
  box(0.4, 0.06, 0.08, ironMat, f.x + 0.95, 1.4, f.z + 0.05); // and one gone cold
  // Embers on the anvil face, so the strike beat has somewhere to land.
  box(0.3, 0.03, 0.16, hotMat, f.x + 1.0, 0.61, f.z + 1.3);
  // THE FORGE IS THE ROOM'S WARM ANCHOR and it was reading as a dim grey box —
  // the coal bed is a 0.95 x 0.75 sliver sunk in a recess, so almost none of its
  // emissive reached the stone around it. Three lights instead of one: the
  // station accent (which stations.ts pulses on focus), a wide low-falloff wash
  // that actually lifts the northwest quarter of the room, and a tight one
  // sitting IN the coals so the hearth has a visible hot core.
  accent("forge", WARM, f.x + 0.8, 1.5, f.z + 0.6, 4.2);
  const forgeWash = new THREE.PointLight(WARM, 5.5, 13, 2);
  forgeWash.position.set(f.x + 1.2, 2.0, f.z + 1.0);
  group.add(forgeWash);
  const coalGlow = new THREE.PointLight(0xff8a3c, 3.6, 5, 2);
  coalGlow.position.set(f.x + 0.4, 1.55, f.z);
  group.add(coalGlow);

  // ══════════════════════════════════════════════════════════
  // BAR — east. Bottles, brass rail, warm lamps.
  // ══════════════════════════════════════════════════════════
  const b = OBSTACLES[2]; // { x: 7.2, z: -2.6 }
  box(b.w, 1.1, b.d, mat(TIMBER), b.x, 0.55, b.z); // counter
  // The top lip used to be b.w+0.2 by b.d+0.2 and the foot rail hung 0.14 off
  // the counter's west face — both outside the obstacle rect, so you clipped
  // through the overhang walking past. Pulled inside; the lip still reads as a
  // lip because it is a different tone, not because it sticks out.
  box(b.w, 0.1, b.d, mat(TIMBER_DK), b.x, 1.15, b.z); // top lip
  box(0.08, 0.08, b.d - 0.1, mat(BRASS, { metalness: 0.8, roughness: 0.3 }), b.x - b.w / 2 + 0.07, 0.95, b.z); // foot rail
  // Back shelf with bottles — a cluster of thin cylinders reads unmistakably.
  box(0.4, 1.8, b.d, mat(TIMBER_DK), b.x + 1.0, 0.9, b.z);
  const bottleMats = [emissive(0x3f9d5a, 0.35), emissive(BLOOD, 0.3), emissive(COLD, 0.3)];
  for (let i = 0; i < 7; i++) {
    cyl(0.07, 0.34, bottleMats[i % 3], b.x + 0.85, 1.15 + (i % 2) * 0.55, b.z - 0.8 + i * 0.26);
  }

  // ── What makes it read BAR and not "long table" ──
  // Taps are the single most legible bar shape there is, so they get the front
  // edge of the counter where nothing occludes them. Everything sits on the
  // counter top (1.2) or hangs above it, inside the existing obstacle rect.
  const brassMat = mat(BRASS, { metalness: 0.8, roughness: 0.3 });
  const pewterMat = mat(0x9aa4b4, { metalness: 0.5, roughness: 0.5 });
  box(0.14, 0.2, 1.1, brassMat, b.x - 0.35, 1.3, b.z - 0.1); // tap manifold
  for (let i = 0; i < 3; i++) {
    const tz = b.z - 0.55 + i * 0.45;
    cyl(0.035, 0.34, brassMat, b.x - 0.35, 1.55, tz); // tap column
    const spout = cyl(0.03, 0.26, brassMat, b.x - 0.47, 1.66, tz);
    spout.rotation.z = Math.PI / 2.6;
    cyl(0.055, 0.1, mat(TIMBER_DK), b.x - 0.35, 1.76, tz); // pull handle
  }
  // Tankards waiting to be filled, and one knocked over.
  for (const [tx, tz] of [
    [0.18, -0.7],
    [0.3, -0.42],
    [0.16, 0.5],
  ]) {
    cyl(0.075, 0.17, pewterMat, b.x + tx, 1.29, b.z + tz);
  }
  const spilled = cyl(0.075, 0.17, pewterMat, b.x + 0.05, 1.24, b.z + 0.85);
  spilled.rotation.z = Math.PI / 2;
  box(0.24, 0.01, 0.3, mat(0x2c2418, { roughness: 0.3 }), b.x + 0.12, 1.21, b.z + 0.85); // the spill
  box(0.2, 0.03, 0.16, mat(0x6d6350), b.x - 0.1, 1.23, b.z + 0.62); // and the rag
  // A keg on its side at the back of the counter — the other unmistakable shape.
  const keg = cyl(0.26, 0.6, mat(TIMBER_DK), b.x + 0.35, 1.46, b.z - 0.85);
  keg.rotation.z = Math.PI / 2;
  for (const kx of [-0.18, 0.18]) {
    const hoop = cyl(0.275, 0.05, brassMat, b.x + 0.35 + kx, 1.46, b.z - 0.85);
    hoop.rotation.z = Math.PI / 2;
  }
  // Glasses hanging stem-down from a rack over the counter — above head height,
  // so it hangs in the walk-up sightline without being in the way.
  box(0.5, 0.06, 1.6, mat(TIMBER_DK), b.x - 0.1, 2.16, b.z);
  for (let i = 0; i < 5; i++) {
    cyl(0.05, 0.16, pewterMat, b.x - 0.22 + (i % 2) * 0.24, 2.03, b.z - 0.62 + i * 0.31);
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

  // ── What makes it read CARD TABLE and not "desk" ──
  // A dealing shoe, chip stacks and cards face-down on the felt. All of it on
  // the table top, inside the existing rect.
  const shoe = box(0.3, 0.24, 0.42, mat(TIMBER_DK), d.x + 0.9, 1.02, d.z + 0.35);
  shoe.rotation.x = -0.3;
  box(0.24, 0.02, 0.3, mat(STEEL, { metalness: 0.7, roughness: 0.35 }), d.x + 0.9, 1.14, d.z + 0.42);
  // Chip stacks, in the run's own rarity colours so the table shares a language
  // with the cards it sells. Short cylinders in a cluster read as chips even
  // when each one is barely a dozen pixels.
  const chipMats = [mat(0x9aa4b4), mat(BLOOD), mat(0x2e6d8f)];
  for (const [cx, cz, tall, tone] of [
    [-0.85, 0.45, 4, 0],
    [-0.72, 0.62, 3, 1],
    [-0.55, 0.4, 5, 2],
    [0.35, 0.55, 2, 1],
  ] as Array<[number, number, number, number]>) {
    for (let s = 0; s < tall; s++) cyl(0.075, 0.03, chipMats[tone], d.x + cx, 0.94 + s * 0.032, d.z + cz);
  }
  // A dealt hand scattered face-down across the felt.
  const faceDown = mat(0x1b2a3a, { roughness: 0.7 });
  for (const [cx, cz, rot] of [
    [-0.2, 0.1, 0.4],
    [0.05, 0.22, -0.9],
    [0.28, 0.05, 0.15],
  ]) {
    const card = box(0.17, 0.012, 0.24, faceDown, d.x + cx, 0.93, d.z + cz);
    card.rotation.y = rot;
  }
  // A lamp hung LOW over the table — the pool of light is what says "game in
  // progress". Hangs above the table footprint, which is solid, so it is never
  // in the player's way.
  box(0.06, 0.9, 0.06, mat(STEEL_DK), d.x, 2.25, d.z);
  cyl(0.34, 0.26, mat(0x241a12, { roughness: 0.9 }), d.x, 1.72, d.z);
  cyl(0.28, 0.04, emissive(COLD, 1.1), d.x, 1.6, d.z);
  accent("dealer", COLD, d.x, 1.5, d.z + 0.5, 2.4);

  // ══════════════════════════════════════════════════════════
  // ARMORY BENCH — southwest. Vice, racks, discarded plate.
  // ══════════════════════════════════════════════════════════
  const a = OBSTACLES[4]; // { x: -7.2, z: 3.05, w: 2.6, d: 2.5 }
  /** Where the bench proper stops and the keeper's crate bank begins. */
  const benchD = a.d - 0.7;
  const benchZ = a.z - 0.35;
  box(a.w, 0.16, benchD, mat(TIMBER), a.x, 0.88, benchZ); // bench top
  for (const sx of [-1, 1]) {
    box(0.18, 0.88, benchD - 0.3, mat(TIMBER_DK), a.x + sx * (a.w / 2 - 0.2), 0.44, benchZ);
  }
  // A repair vice, and YOUR weapon held in it — the physical home for upgrades.
  // The rune plates on it are the socketed cards (see syncViceCards below), so a
  // card is something you can SEE on the blade before you open any UI.
  box(0.3, 0.26, 0.3, mat(STEEL_DK, { metalness: 0.7 }), a.x + 0.7, 1.06, benchZ - 0.4);
  const held = box(0.1, 0.9, 0.1, mat(STEEL, { metalness: 0.8, roughness: 0.3 }), a.x + 0.7, 1.55, benchZ - 0.4);
  held.rotation.z = 0.22;

  // Socket plates + the emitter at the hilt. Built once at max capacity and
  // shown/hidden on sync, so socketing a card never allocates mid-scene.
  const viceGroup = new THREE.Group();
  viceGroup.position.set(a.x + 0.7, 0, benchZ - 0.4);
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
  viceLight.position.set(a.x + 0.7, 1.5, benchZ - 0.3);
  group.add(viceLight);
  // Rack of plate behind, against the wall.
  box(0.3, 1.7, benchD, mat(TIMBER_DK), a.x - 1.0, 0.85, benchZ);
  for (let i = 0; i < 3; i++) {
    box(0.14, 0.44, 0.36, mat(STEEL_DK, { metalness: 0.6 }), a.x - 0.8, 1.5 - i * 0.5, benchZ - 0.5 + i * 0.5);
  }

  // ── What makes it read ARMORY and not "workbench" ──
  // A helmet on a stand is the one silhouette nobody misreads, so it gets the
  // clearest corner of the bench. Everything else sits on the bench top or
  // hangs on the wall above the rack, inside the existing obstacle rect.
  const plateMatArm = mat(STEEL, { metalness: 0.7, roughness: 0.35 });
  const darkPlate = mat(STEEL_DK, { metalness: 0.65, roughness: 0.45 });
  cyl(0.06, 0.3, mat(TIMBER_DK), a.x + 0.15, 1.11, benchZ + 0.6); // helm stand post
  cyl(0.16, 0.05, mat(TIMBER_DK), a.x + 0.15, 0.98, benchZ + 0.6); // its base
  const helmGeo = new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  geos.push(helmGeo);
  const helm = new THREE.Mesh(helmGeo, plateMatArm);
  helm.position.set(a.x + 0.15, 1.28, benchZ + 0.6);
  helm.castShadow = true;
  group.add(helm);
  box(0.3, 0.07, 0.05, darkPlate, a.x + 0.15, 1.25, benchZ + 0.76); // visor slit
  box(0.06, 0.16, 0.06, mat(BLOOD), a.x + 0.15, 1.46, benchZ + 0.6); // a stub of crest
  // A shield leaning against the end of the bench.
  const shield = box(0.55, 0.68, 0.07, darkPlate, a.x + 1.05, 0.36, benchZ + 0.7);
  shield.rotation.set(0.22, 0, 0.15);
  box(0.14, 0.5, 0.03, plateMatArm, a.x + 1.05, 0.4, benchZ + 0.74); // boss band
  // Gauntlets, a whetstone and a scatter of rivets on the bench top.
  for (const gz of [-0.62, -0.4]) box(0.16, 0.1, 0.2, darkPlate, a.x - 0.2, 1.01, benchZ + gz);
  const stone = box(0.26, 0.08, 0.12, mat(0x555a63, { roughness: 1 }), a.x + 0.05, 1.0, benchZ - 0.05);
  stone.rotation.y = 0.4;
  box(0.16, 0.03, 0.16, mat(BRASS, { metalness: 0.7, roughness: 0.5 }), a.x - 0.5, 0.98, benchZ + 0.3);
  // Pegboard of tools on the wall above the rack — above head height.
  box(0.06, 0.85, 1.5, mat(TIMBER_DK), a.x - 1.24, 2.25, benchZ);
  for (const [ty, tz, th] of [
    [2.4, -0.5, 0.4],
    [2.35, -0.1, 0.5],
    [2.42, 0.35, 0.36],
    [2.3, 0.66, 0.55],
  ]) {
    box(0.05, th, 0.05, darkPlate, a.x - 1.16, ty - th / 2, benchZ + tz);
  }
  box(0.06, 0.09, 0.22, darkPlate, a.x - 1.16, 2.14, benchZ - 0.1); // a hammer head on one
  // ── The keeper's end of the bench ──
  // The bench grew south (layout.ts) to reach its keeper, who used to sit on
  // bare floor with the bench floating behind and above him. The first attempt
  // put a crate, a barrel and a grindstone on the FLOOR in the new depth — and
  // the render showed none of it, because the bench top is a solid slab over the
  // whole rect and it roofed the lot. So the bench top now stops short (benchD)
  // and the southern strip is a crate bank at the keeper's own height, which is
  // both visible and still solid all the way to the rect's edge.
  const bankZ = benchZ + benchD / 2 + 0.35;
  box(a.w, 0.62, 0.7, mat(TIMBER), a.x, 0.31, bankZ);
  box(a.w + 0.04, 0.07, 0.74, mat(TIMBER_DK), a.x, 0.65, bankZ); // its lid
  for (const bx of [-0.72, 0, 0.72]) box(0.08, 0.62, 0.74, mat(TIMBER_DK), a.x + bx, 0.31, bankZ); // slat seams
  // A barrel of quench oil and a grindstone standing ON the bank, at the east
  // end — which is exactly where the keeper stands, so he has work at his hands.
  const barrel = cyl(0.26, 0.56, mat(TIMBER_DK), a.x - 0.85, 0.96, bankZ);
  for (const hy of [0.78, 1.14]) cyl(0.27, 0.05, mat(BRASS, { metalness: 0.7, roughness: 0.4 }), a.x - 0.85, hy, bankZ);
  barrel.castShadow = true;
  const wheel = cyl(0.26, 0.08, mat(0x555a63, { roughness: 1 }), a.x + 0.9, 0.97, bankZ);
  wheel.rotation.z = Math.PI / 2;
  for (const wz of [-0.16, 0.16]) box(0.08, 0.34, 0.08, mat(TIMBER_DK), a.x + 0.9, 0.85, bankZ + wz);
  box(0.5, 0.06, 0.1, darkPlate, a.x + 0.2, 0.72, bankZ - 0.1); // stock waiting to be ground
  accent("armory", WARM, a.x + 0.9, 1.4, a.z + 0.8, 3.4);

  // ══════════════════════════════════════════════════════════
  // NOTICE BOARD + DESCENT PLUNGER — north wall. The way out.
  // ══════════════════════════════════════════════════════════
  const n = OBSTACLES[5]; // { x: 0, z: -6.4 }
  box(n.w, 2.2, 0.3, mat(TIMBER_DK), n.x, 1.1, n.z - 0.2); // board backing
  box(n.w - 0.3, 1.7, 0.06, mat(0x241a12), n.x, 1.25, n.z - 0.02); // cork face
  // Pinned notices — pale scraps, deliberately uneven in SIZE and tone as well
  // as angle. A grid of identical rectangles reads as a texture, not as paper
  // somebody pinned up one at a time.
  const paperMats = [mat(0xb9ae94), mat(0xa39779), mat(0xc9c0a8)];
  for (let i = 0; i < 8; i++) {
    const w = 0.3 + ((i * 29) % 4) * 0.06;
    const h = 0.3 + ((i * 17) % 5) * 0.07;
    const p = box(w, h, 0.02, paperMats[i % 3], n.x - 1.5 + (i % 4) * 0.8, 1.05 + Math.floor(i / 4) * 0.62 + ((i * 37) % 3) * 0.06, n.z + 0.02);
    p.rotation.z = (((i * 53) % 7) - 3) * 0.05;
    box(0.05, 0.05, 0.04, mat(BLOOD), p.position.x, p.position.y + h / 2 - 0.05, n.z + 0.04); // the pin
  }
  // A hooded lantern on the board's post, so the notices are lit from somewhere.
  // Dropped from y 2.35 to 2.05 when the ENTER MAZE sign went in above the board:
  // the sign hangs at the wall plane behind it, and at the old height the hood
  // projected straight over the sign's left arrow. Lower is also the better
  // light — it rakes across the notices instead of washing them from overhead.
  const lanternY = 2.05;
  box(0.09, 0.34, 0.09, mat(STEEL_DK), n.x - 2.0, lanternY, n.z + 0.1);
  box(0.18, 0.2, 0.18, emissive(WARM, 1.3), n.x - 2.0, lanternY - 0.23, n.z + 0.1);
  box(0.24, 0.06, 0.24, mat(STEEL_DK), n.x - 2.0, lanternY - 0.11, n.z + 0.1); // the hood
  // ── "ENTER MAZE" SIGN ── the one place the room breaks its own no-labels rule.
  //
  // TAVERN_PLAN says stations read from shape and accent colour, never from text,
  // and every other station honours that. The way DOWN is the exception because
  // it is the only prop a first-time player MUST find: everything else is
  // optional, and a player who never locates the forge just plays without a
  // socket, while a player who never locates the board never starts a run at all.
  // Shape alone was not carrying it — a corkboard reads as scenery, and the cold
  // floor lane points at the plunger from a metre away, which you only notice
  // once you are already standing in it.
  //
  // Hung ABOVE the board rather than pinned to it, at 2.62: clear of the board's
  // 2.2 top and its lantern, and under WALL_HEIGHT 3.2 so it never clips the wall
  // cap. Leaned forward 0.16rad for the same reason the pinball backbox is — the
  // camera looks down at 38 degrees, so a panel flat against the wall presents
  // its face edge-on and the letters foreshorten into a smear.
  // SIZED FROM THE RENDER, NOT FROM THE UNITS. The first pass was 3.1 x 0.62
  // with the word inset in its canvas, and on screen the caps stood about ten
  // pixels tall — the iso projection foreshortens a wall-mounted panel's height
  // hard, and then the pixel pass quantises what is left. It read as a smudge.
  // 4.2 x 1.15 with the glyphs filling their canvas edge to edge is what makes
  // the word legible from the spawn stair, which is the only test that matters.
  signTex = makeSignTexture("ENTER MAZE");
  const SIGN_W = 4.2;
  const SIGN_H = 0.8;
  const signPivot = new THREE.Group();
  // POSITIONED IN SCREEN SPACE, NOT WORLD SPACE — and those disagree here.
  //
  // Under a 45-degree-yaw iso camera, +z (toward the room) also projects DOWNWARD
  // on screen. The first placement leaned the sign forward 0.16rad and stood it
  // 0.06 proud of the board, both of which push it toward the viewer, and the
  // render came back with the legend lying across the top row of notices — it
  // read as painted ON the corkboard rather than hung above it. Height alone
  // could not fix that, because the wall caps at WALL_HEIGHT 3.2.
  //
  // So it is pushed BACK to the wall face (z -6.72, behind the board's -6.6
  // backing) and up to 3.0, and the lean is cut to 0.06 — just enough to catch
  // the light, not enough to drop the panel onto the board. Housing now spans
  // y 2.5..3.5 at the wall plane, which projects clear ABOVE the board's 2.2 top.
  signPivot.position.set(n.x, 3.0, n.z - 0.32);
  signPivot.rotation.x = 0.06;
  group.add(signPivot);
  box(SIGN_W + 0.22, SIGN_H + 0.2, 0.18, mat(TIMBER_DK), 0, 0, -0.07, signPivot); // the housing
  // A near-black inlay behind the letters. Without it the glyphs sit on timber
  // that the hearth lights to roughly their own value, and a cyan word on a warm
  // brown of equal brightness is exactly the contrast the pixel pass destroys.
  box(SIGN_W + 0.02, SIGN_H + 0.02, 0.04, mat(0x0a1418), 0, 0, 0.035, signPivot);
  box(SIGN_W + 0.26, 0.09, 0.24, mat(STEEL_DK, { metalness: 0.6 }), 0, SIGN_H / 2 + 0.13, -0.05, signPivot); // top rail
  // The face is UNLIT (MeshBasicMaterial): a standard material would take the
  // room's warm hearth light across the glyphs and the pixel pass's bloom would
  // then eat the thin strokes. Basic keeps the letters at exactly the contrast
  // the canvas drew them at, which is the whole point of a sign.
  const signMat = new THREE.MeshBasicMaterial({
    map: signTex ?? undefined,
    color: signTex ? 0xffffff : COLD,
    transparent: true,
  });
  mats.push(signMat);
  const signGeo = new THREE.PlaneGeometry(SIGN_W, SIGN_H);
  geos.push(signGeo);
  const signFace = new THREE.Mesh(signGeo, signMat);
  signFace.position.set(0, 0, 0.075);
  signPivot.add(signFace);
  // Two bulbs on the rail, aimed at the face, so the sign reads as a fixture the
  // tavern installed rather than a decal floating on the wall.
  for (const sx of [-1, 1]) {
    box(0.07, 0.18, 0.07, mat(STEEL_DK), sx * (SIGN_W / 2 - 0.2), SIGN_H / 2 + 0.24, 0.02, signPivot);
    cyl(0.1, 0.08, emissive(COLD, 1.1), sx * (SIGN_W / 2 - 0.2), SIGN_H / 2 + 0.36, 0.07, signPivot);
  }
  // A dedicated light on the sign itself. The station accent below is pulsed by
  // stations.ts when you are in range; this one is always on, because the sign's
  // job is to be legible from the spawn stair BEFORE you are anywhere near it.
  const signGlow = new THREE.PointLight(COLD, 2.2, 5, 2);
  signGlow.position.set(n.x, 2.6, n.z + 1.0);
  group.add(signGlow);
  // The down-arrows that flank the word are PAINTED INTO THE TEXTURE, not built
  // as geometry. Two earlier attempts at real chevrons both failed on the same
  // constraint: the only free wall is the ~0.1 strip between the board's top
  // notices (y ~2.0) and the sign's bottom edge, and anything thin enough to fit
  // there disappears into the pixel pass. In the texture they get the sign's own
  // contrast and cost nothing.
  // THE PLUNGER — a real launcher housing set into the wall beside the board.
  // Pulling it sends you back into the machine.
  const plungerX = n.x + n.w / 2 + 0.5;
  box(0.5, 1.0, 0.5, mat(STEEL_DK, { metalness: 0.6 }), plungerX, 0.5, n.z);
  const rod = cyl(0.06, 0.8, mat(STEEL, { metalness: 0.9, roughness: 0.2 }), plungerX, 1.3, n.z);
  rod.rotation.x = 0;
  cyl(0.16, 0.16, emissive(BLOOD, 0.9), plungerX, 1.75, n.z); // the knob
  // The SPRING. A plunger without a visible coil is just a rod with a lid on
  // it; the stack of rings is the entire "this is a launcher" read, and it is
  // the shape the pinball table's own plunger lane rhymes with.
  const springMat = mat(STEEL_DK, { metalness: 0.85, roughness: 0.3 });
  const coilGeo = new THREE.TorusGeometry(0.11, 0.022, 5, 10);
  geos.push(coilGeo);
  for (let i = 0; i < 7; i++) {
    const coil = new THREE.Mesh(coilGeo, springMat);
    coil.position.set(plungerX, 1.08 + i * 0.075, n.z);
    coil.rotation.x = Math.PI / 2;
    group.add(coil);
  }
  // A scored gauge plate beside it — pull depth, which is how a machine tells
  // you a control has a RANGE rather than an on/off.
  const gauge = box(0.04, 0.7, 0.16, mat(0x2a2f39, { metalness: 0.4 }), plungerX + 0.2, 1.35, n.z);
  gauge.rotation.y = 0.1;
  const tickMat = emissive(COLD, 0.7);
  for (let i = 0; i < 5; i++) box(0.02, 0.025, 0.11, tickMat, plungerX + 0.22, 1.08 + i * 0.14, n.z);
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

  // ══════════════════════════════════════════════════════════
  // THE GAMBLER'S CORNER — southeast, beside the arrival stair.
  // A broken-down arcade cabinet rather than a card table: this is a casino
  // built out of the same machine internals as the rest of the room.
  // ══════════════════════════════════════════════════════════
  const gx = 3.9;
  const gz = 5.9;
  box(1.5, 1.5, 0.9, mat(TIMBER_DK), gx, 0.75, gz); // cabinet body
  box(1.6, 0.16, 1.0, mat(TIMBER), gx, 1.56, gz); // top lip
  // The screen — cold arcade glow, angled toward the player.
  const screen = box(1.15, 0.8, 0.06, emissive(COLD, 0.55), gx, 1.15, gz + 0.44);
  screen.rotation.x = 0.24;
  // Three reel windows behind the glass, in gold.
  for (let i = -1; i <= 1; i++) {
    const r = box(0.24, 0.34, 0.03, emissive(GOLD, 0.5), gx + i * 0.3, 1.16, gz + 0.5);
    r.rotation.x = 0.24;
  }
  // The lever: a chrome rod with a blood-red knob, unmistakably a slot machine.
  // Was at gx+0.92 with the knob at gx+1.06 — the cabinet's rect only reaches
  // gx+0.8, so the whole lever hung out over walkable floor and you clipped it.
  const lever = cyl(0.05, 0.55, mat(STEEL, { metalness: 0.9, roughness: 0.2 }), gx + 0.64, 1.3, gz);
  lever.rotation.z = -0.3;
  cyl(0.11, 0.11, emissive(BLOOD, 0.9), gx + 0.76, 1.55, gz);

  // ── What makes it read ARCADE CABINET and not "lit box" ──
  // A marquee, a coin slot, a button panel and a speaker grille. The marquee
  // sits above head height and everything else is flush with the body's front
  // face or on the top lip, so nothing extends past the cabinet's obstacle rect.
  // The marquee is COLD, not GOLD: gold stays reserved for the jackpot sign and
  // for the reels behind the glass, which are the actual reward read here.
  box(1.5, 0.4, 0.24, mat(TIMBER_DK), gx, 1.94, gz + 0.3); // marquee housing
  box(1.3, 0.28, 0.04, emissive(COLD, 0.9), gx, 1.94, gz + 0.42); // its lit face
  for (const bx of [-0.45, 0.45]) box(0.06, 0.36, 0.28, mat(TIMBER), gx + bx, 1.94, gz + 0.28); // side posts
  // Speaker grille above the screen — four slats, the cheapest possible tell.
  for (let i = 0; i < 4; i++) box(0.7, 0.04, 0.03, mat(0x14181f), gx, 1.66 + i * 0.07, gz + 0.42);
  // Coin slot and return, low on the front face where a real one lives.
  box(0.26, 0.3, 0.05, mat(BRASS, { metalness: 0.8, roughness: 0.3 }), gx + 0.42, 0.72, gz + 0.43);
  box(0.11, 0.02, 0.03, mat(0x0b0d12), gx + 0.42, 0.8, gz + 0.46); // the slot itself
  box(0.2, 0.12, 0.04, mat(0x14181f), gx + 0.42, 0.58, gz + 0.44); // coin return cup
  // Button panel on the top lip, angled toward whoever is standing at it.
  const panel = box(0.9, 0.05, 0.32, mat(0x14181f), gx - 0.2, 1.68, gz + 0.18);
  panel.rotation.x = 0.2;
  const buttonMats = [emissive(BLOOD, 0.9), emissive(COLD, 0.9), emissive(WARM, 0.9)];
  for (let i = 0; i < 3; i++) cyl(0.07, 0.05, buttonMats[i], gx - 0.44 + i * 0.24, 1.73, gz + 0.16);
  // A dartboard — advertises the other games. It is NOT hung on a wall, because
  // there is no wall here to hang it on: build.ts only raises the north and west
  // walls, and the south side is a knee-high rim. The old version floated at
  // head height on nothing, directly behind the cabinet's marquee on screen, so
  // it read as part of the arcade machine. It is now a freestanding board on a
  // timber frame, moved east clear of the cabinet's screen silhouette and of the
  // tout who throws at it.
  // FIRST ATTEMPT AT THIS WAS WORSE THAN THE BUG. Putting it on a 2.3-high
  // timber frame at x 7.0 turned it into a tall dark slab standing in the one
  // gap between the two keepers, splitting that corner of the frame in half.
  // Low posts, further east into the empty south-east floor, and a pale rim so
  // the board reads as a target instead of another brown rectangle.
  const boardZ = ROOM_MAX_Z_PROP;
  const dartX = 8.0;
  const frameMat = mat(TIMBER_DK);
  for (const px of [-0.5, 0.5]) box(0.1, 1.5, 0.1, frameMat, dartX + px, 0.75, boardZ);
  box(0.86, 0.86, 0.05, mat(TIMBER), dartX, 1.15, boardZ - 0.05); // backing plank
  const dartRings = [0xc9c0a8, BLOOD, 0xc9c0a8, 0x1a1410];
  for (let i = 0; i < 4; i++) {
    cyl(0.4 - i * 0.095, 0.03, mat(dartRings[i]), dartX, 1.15, boardZ).rotation.x = Math.PI / 2;
  }
  cyl(0.07, 0.035, emissive(GOLD, 0.5), dartX, 1.15, boardZ + 0.01).rotation.x = Math.PI / 2; // the bull
  for (const [dx, dy] of [
    [-0.12, 0.08],
    [0.1, -0.14],
  ]) {
    const dart = cyl(0.02, 0.24, mat(STEEL), dartX + dx, 1.15 + dy, boardZ + 0.14);
    dart.rotation.x = Math.PI / 2;
  }
  accent("gambler", GOLD, gx, 1.7, gz - 0.6, 2.4);

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
      signTex?.dispose();
    },
  };
}
