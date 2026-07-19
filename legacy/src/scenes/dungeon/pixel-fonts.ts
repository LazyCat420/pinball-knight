/**
 * The pixel fonts moved to `src/pixel/pixel-font.ts` — the site room map wants
 * the same faces and must not import the game to get them.
 *
 * Re-exported from the old path so the dungeon's call sites keep working.
 */
export { ensurePixelFonts, awaitPixelFonts, labelFont, numFont, PIXEL_FONT_LABEL, PIXEL_FONT_NUM } from "../../pixel/pixel-font";
