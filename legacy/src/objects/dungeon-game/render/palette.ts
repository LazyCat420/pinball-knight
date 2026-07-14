/**
 * Dungeon — "Cold Crypt" palette.
 *
 * 32 colours, hand-picked. The ONLY warm hues in the entire palette are the
 * torch ramp (14-18) — everything else is cold stone, rot, steel and blood.
 * That's deliberate: it makes torchlight feel like the only comfort down here,
 * and it contrasts hard with the mouse room's warm earth palette (`P` in
 * mouse-room.ts) so descending feels like going somewhere else.
 *
 * These are raw sRGB values (NOT THREE.Color — we must not let three.js
 * colour-manage them into linear space, since the quantize shader compares
 * against them in sRGB).
 *
 * Sprite art references these by index via the CHARS legend in sprite-data.ts.
 */

export const PALETTE_HEX: number[] = [
  // ── Stone / void (0-5) ──
  0x0b0d12, // 0  void black
  0x171a22, // 1  outline
  0x2b303b, // 2  stone dark
  0x454f5e, // 3  stone mid
  0x6b7688, // 4  stone light
  0x9aa4b4, // 5  stone highlight

  // ── Rot green (6-9) ──
  0x1e2f1f, // 6  rot shadow
  0x3d5c3a, // 7  rot dark
  0x5f8a4f, // 8  rot mid
  0x8fc46b, // 9  rot light

  // ── Blood (10-13) ──
  0x3a0f18, // 10 blood shadow
  0x6b1f2a, // 11 blood dark
  0xa83244, // 12 blood mid
  0xd95763, // 13 blood light

  // ── Torch (14-18) — the only warmth ──
  0x7a3b12, // 14 ember
  0xd97b29, // 15 flame dark
  0xf0a63c, // 16 flame
  0xffd98a, // 17 flame light
  0xfff3c8, // 18 flame core

  // ── Steel (19-22) ──
  0x4a5364, // 19 steel dark
  0x8a94a6, // 20 steel mid
  0xc8ccd4, // 21 steel light
  0xeef1f5, // 22 steel highlight

  // ── Skin (23-25) ──
  0x6b4436, // 23 skin shadow
  0xa9705a, // 24 skin mid
  0xd69f7e, // 25 skin light

  // ── Leather / wood (26-28) ──
  0x2a1c14, // 26 leather shadow
  0x4a3222, // 27 leather dark
  0x6b4a2e, // 28 leather mid

  // ── Cold accent / arcane (29-31) ──
  0x1f3d52, // 29 arcane dark
  0x2e6d8f, // 30 arcane mid
  0x6fd0e8, // 31 arcane light
];

export const PALETTE_SIZE = PALETTE_HEX.length; // 32

/** Flat Float32Array of sRGB triplets, for the quantize shader uniform. */
export function paletteToFloatArray(): Float32Array {
  const out = new Float32Array(PALETTE_SIZE * 3);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const hex = PALETTE_HEX[i];
    out[i * 3 + 0] = ((hex >> 16) & 0xff) / 255;
    out[i * 3 + 1] = ((hex >> 8) & 0xff) / 255;
    out[i * 3 + 2] = (hex & 0xff) / 255;
  }
  return out;
}

/** `#rrggbb` for canvas 2D fillStyle (used when painting sprite atlases). */
export function paletteCss(index: number): string {
  return `#${PALETTE_HEX[index].toString(16).padStart(6, "0")}`;
}
