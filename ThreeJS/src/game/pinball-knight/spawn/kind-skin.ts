/**
 * ONE SKIN TABLE — which atlas a kind wears, dyed how, at what display scale.
 *
 * A LEAF MODULE ON PURPOSE: no THREE, no `state`, no `sheetFor` — only the
 * `SheetKey` type. Both the spawner (`spawn/factory.ts`) and the bestiary
 * portrait painter (`render/monster-portrait.ts`) read it, and a table those
 * two share cannot live in either of them without an import cycle. That cycle
 * is the whole reason the portrait used to RESTATE the tint and scale columns
 * by hand, with a comment begging the next reader to keep them in step.
 *
 * It replaces `EXPANSION_SKIN` (borrowed sheet + tint + scale) and `RESKIN`
 * (bespoke sheet + scale), which were the same table minus a column with two
 * near-identical constructors behind them.
 *
 * ── THE COLUMNS ────────────────────────────────────────────────────────────
 *
 *  `sheetKey`  The atlas worn. OMITTED means the kind wears its OWN sheet —
 *              i.e. the kind's name is itself a `SheetKey`. Eleven of the
 *              twelve old RESKIN rows were `sheetFor("<its own name>")`, so
 *              the column is absent far more often than it is present.
 *              registry-drift check H fails if a row omits it while naming a
 *              kind that is not a SheetKey.
 *
 *  `tint`      A BAKED dye, and the marker that this kind borrows another
 *              monster's art (art is placeholder; behaviour in zombie.ts
 *              carries identity). Absent means the art carries its own
 *              identity and must not be recoloured.
 *
 *  `scale`     Display multiplier on the sprite mesh. ⚠️ SEE `stiltneck`.
 *              `render/monster-portrait.ts` READS this column rather than
 *              restating it, so the bestiary card cannot disagree with what
 *              you actually meet. It used to restate it, and it had drifted:
 *              rotortail 0.95 vs 1.0, and stiltneck 1.0 vs 1.1 — the second of
 *              those reproducing, in the portrait, the exact moiré bug the
 *              epitaph below describes, four weeks after it was fixed in the
 *              world. registry-drift check C guarded the OTHER pairing
 *              (EXPANSION_SKIN ↔ KIND_PORTRAIT) and so never saw it.
 */
import type { SheetKey } from "../boot/sheets";
import type { EnemyKind } from "../state";

export interface KindSkin {
  /** The atlas worn; omit when the kind wears its own same-named sheet. */
  sheetKey?: SheetKey;
  /** Baked dye. Present ⇒ this kind BORROWS another monster's art. */
  tint?: number;
  /** Display multiplier on the sprite mesh. */
  scale: number;
}

export const KIND_SKIN: Partial<Record<EnemyKind, KindSkin>> = {
  // ── Bespoke atlases: the art carries the identity, so no tint ────────────
  //
  // texel-exempt: LENGTH is the read. A long low quadruped has to look long at
  // gameplay distance, because its length is the cue you dodge a charge by.
  // (`hound` used to be a red-tinted SPIDER; it graduated to its own painter
  // in render/monsters/hound.ts.)
  hound: { scale: 1.05 },
  goblin: { scale: 1.0 },
  // texel-exempt: a bowling pin is a SET-DRESSING silhouette — small, plural,
  // and never inspected up close; the crew reads as a cluster, not as twelve
  // individuals.
  pin: { scale: 0.85 },
  // texel-exempt: UNEXAMINED. Inherited from the placeholder-art table and
  // never measured against the texel rule. A golem that reads "heavy" may or
  // may not need the 12%; nobody has looked since it was written.
  golem: { scale: 1.12 },
  // texel-exempt: UNEXAMINED — as golem.
  chomper: { scale: 1.35 },
  // texel-exempt: UNEXAMINED — as golem.
  magnet: { scale: 0.95 },
  // texel-exempt: UNEXAMINED — as golem.
  webspinner: { scale: 1.05 },
  jester: { scale: 1.0 },
  croaker: { scale: 0.72 },
  // texel-exempt: the rotor makes the sprite WIDE, and at 1.0 the disc read as
  // the creature's body rather than as the thing bolted on top of it.
  rotortail: { scale: 0.95 },
  stiltneck: { scale: 1.0 },
  fish_feet: { scale: 1.0 },
  warden: { scale: 1.05 },
  necromancer: { scale: 1.0 },
  crystalback: { scale: 1.0 },
  mimic: { scale: 1.0 },
  bloater: { scale: 1.1 },
  platypus: { scale: 0.95 },

  // ── Borrowed atlases, re-dyed: placeholder art, behaviour carries identity ─
  //
  // Every scale below is a DISTORTED BORROWED SILHOUETTE — the kind wears
  // another monster's body and is stretched to stop reading as that monster.
  // texel-exempt on those grounds, and all seven are provisional: the moment
  // one of these gets a bespoke painter (as hound did) its scale should go to
  // 1.0 and the exemption should be deleted, not carried over.
  wisp: { sheetKey: "ghost", tint: 0x6fe8e8, scale: 0.9 }, // cyan will-o-wisp — texel-exempt: distorted borrowed ghost
  sapper: { sheetKey: "magnet", tint: 0xf0e05a, scale: 0.95 }, // yellow charge-thief — texel-exempt: distorted borrowed magnet
};

/**
 * The atlas key a kind wears. `warden` is the row that proves the default is
 * not merely cosmetic sugar: it borrows a tint but owns its sheet key, so the
 * two columns really are independent.
 */
export function skinSheetKey(kind: EnemyKind): SheetKey {
  return KIND_SKIN[kind]?.sheetKey ?? (kind as SheetKey);
}
