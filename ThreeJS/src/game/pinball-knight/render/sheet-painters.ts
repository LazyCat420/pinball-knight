/**
 * SheetKey → the painter that draws its atlas. The one copy.
 *
 * This column was written twice: `BUILDERS` in `boot/sheets.ts` (which builds
 * the atlases the game spawns from) and `ROSTER` in `testkit/atlas-census.ts`
 * (which measures them). Same twenty-two keys, same painter per key, down to
 * the same two quirks — `warden` painting from `makeBrutePaints`, and `zombie`
 * needing `ZOMBIE_VARIANTS[0]` picked for it. Their import blocks were
 * byte-identical.
 *
 * The copy was not laziness. The testkit imports node-canvas and must stay out
 * of the client bundle (`testkit/testkit-boundary.test.ts`), and reaching for
 * `boot/sheets.ts` would have dragged THREE and the whole mutable `state` into
 * a census that only wants to paint cels. So this module is deliberately
 * SMALL: painters in, painters out, no THREE, no state, no sprite packing.
 * Both sides can import it.
 *
 * The two consumers do different things with it and keep their own tables for
 * that — `boot/sheets.ts` owns ESSENTIAL/BACKFILL ordering, the census owns
 * its Subject shape. What they no longer each own is which painter a key uses.
 */
import {
  ZOMBIE_VARIANTS,
  makeBatPaints,
  makeBossPaints,
  makeBrutePaints,
  makeChomperPaints,
  makeGhostPaints,
  makeGoblinPaints,
  makeGolemPaints,
  makeMagnetPaints,
  makePinPaints,
  makeSlimePaints,
  makeSpiderPaints,
  makeSpitterPaints,
  makeWebspinnerPaints,
  makeReaperPaints,
  makeZombiePaints,
  type ActorPaints,
} from "./cel-painter";
import { makeSporelingPaints } from "./monsters/sporeling";
import { makeJesterPaints } from "./monsters/jester";
import { makeCroakerPaints } from "./monsters/croaker";
import { makeRotortailPaints } from "./monsters/rotortail";
import { makeStiltneckPaints } from "./monsters/stiltneck";
import { makeFishFeetPaints } from "./monsters/fish_feet";
import { makeHoundPaints } from "./monsters/hound";
import { makeBloaterPaints } from "./monsters/bloater";
import { makeWardenPaints } from "./monsters/warden";
import { makeNecroPaints } from "./monsters/necro";
import { makePlatypusPaints } from "./monsters/platypus";
import { makeEspressoPaints } from "./monsters/espresso";
import type { SheetKey } from "../boot/sheets";

export const SHEET_PAINTERS: Record<SheetKey, () => ActorPaints> = {
  // A VARIANT FAMILY that shares one key: every variant is built from the same
  // paints, so variant 0 is the representative both the builder and the census
  // want.
  zombie: () => makeZombiePaints(ZOMBIE_VARIANTS[0]),
  spider: makeSpiderPaints,
  brute: makeBrutePaints,
  warden: makeWardenPaints,
  spitter: makeSpitterPaints,
  ghost: makeGhostPaints,
  bat: makeBatPaints,
  slime: makeSlimePaints,
  boss: makeBossPaints,
  goblin: makeGoblinPaints,
  pin: makePinPaints,
  golem: makeGolemPaints,
  chomper: makeChomperPaints,
  magnet: makeMagnetPaints,
  webspinner: makeWebspinnerPaints,
  sporeling: makeSporelingPaints,
  hound: makeHoundPaints,
  jester: makeJesterPaints,
  croaker: makeCroakerPaints,
  rotortail: makeRotortailPaints,
  stiltneck: makeStiltneckPaints,
  fish_feet: makeFishFeetPaints,
  necromancer: makeNecroPaints,
  crystalback: makeGolemPaints,
  mimic: makeGolemPaints,
  // The Death Dealer, and the Reaper King who wears his coat.
  reaper: makeReaperPaints,
  broodmother: makeSpiderPaints,
  overlord: makeBossPaints,
  archivist: makeGhostPaints,
  dragon: makeBossPaints,
  trex: makeBossPaints,
  bloater: makeBloaterPaints,
  platypus: makePlatypusPaints,
  espresso: makeEspressoPaints,
  jade_buddha: makeBossPaints,
};
