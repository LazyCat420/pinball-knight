//! Indexed Lighting — Shadow as a palette row walk, not a continuous multiply.
//!
//! PORTS: `render/palette-shading.ts`

pub const FAMILIES: [&[usize]; 8] = [
    &[5, 4, 3, 2, 1, 0],   // Stone / void — 1 is ink, 0 is void
    &[9, 8, 7, 6],         // Rot green
    &[13, 12, 11, 10],     // Blood
    &[18, 17, 16, 15, 14], // Torch
    &[22, 21, 20, 19],     // Steel
    &[25, 24, 23],         // Skin
    &[28, 27, 26],         // Leather / wood
    &[31, 30, 29],         // Arcane
];

pub const PALETTE_N: usize = 32;

/// Returns the family index (0..7) for a given palette entry.
pub fn family_index_of(idx: usize) -> Option<usize> {
    for (f, fam) in FAMILIES.iter().enumerate() {
        if fam.contains(&idx) {
            return Some(f);
        }
    }
    None
}

/// Precomputed one-step darker lookup table.
pub const fn compute_shade_down() -> [u8; PALETTE_N] {
    let mut t = [0u8; PALETTE_N];
    // Stone
    t[5] = 4;
    t[4] = 3;
    t[3] = 2;
    t[2] = 1;
    t[1] = 0;
    t[0] = 0;

    // Rot
    t[9] = 8;
    t[8] = 7;
    t[7] = 6;
    t[6] = 1; // Fallthrough to ink

    // Blood
    t[13] = 12;
    t[12] = 11;
    t[11] = 10;
    t[10] = 1; // Fallthrough to ink

    // Torch
    t[18] = 17;
    t[17] = 16;
    t[16] = 15;
    t[15] = 14;
    t[14] = 1; // Fallthrough to ink

    // Steel
    t[22] = 21;
    t[21] = 20;
    t[20] = 19;
    t[19] = 1; // Fallthrough to ink

    // Skin
    t[25] = 24;
    t[24] = 23;
    t[23] = 1; // Fallthrough to ink

    // Leather
    t[28] = 27;
    t[27] = 26;
    t[26] = 1; // Fallthrough to ink

    // Arcane
    t[31] = 30;
    t[30] = 29;
    t[29] = 1; // Fallthrough to ink

    t
}

pub const SHADE_DOWN: [u8; PALETTE_N] = compute_shade_down();

/// Precomputed one-step brighter lookup table.
pub const fn compute_shade_up() -> [u8; PALETTE_N] {
    let mut t = [0u8; PALETTE_N];
    let mut i = 0;
    while i < PALETTE_N {
        t[i] = i as u8;
        i += 1;
    }

    // Stone
    t[4] = 5;
    t[3] = 4;
    t[2] = 3;
    t[1] = 1; // Ink stays ink going up
    t[0] = 0; // Void stays void

    // Rot
    t[8] = 9;
    t[7] = 8;
    t[6] = 7;

    // Blood
    t[12] = 13;
    t[11] = 12;
    t[10] = 11;

    // Torch
    t[17] = 18;
    t[16] = 17;
    t[15] = 16;
    t[14] = 15;

    // Steel
    t[21] = 22;
    t[20] = 21;
    t[19] = 20;

    // Skin
    t[24] = 25;
    t[23] = 24;

    // Leather
    t[27] = 28;
    t[26] = 27;

    // Arcane
    t[30] = 31;
    t[29] = 30;

    t
}

pub const SHADE_UP: [u8; PALETTE_N] = compute_shade_up();

/// Walks `n` rows down (n > 0) or up (n < 0), clamping at the ends.
pub fn shade_by(idx: usize, n: i32) -> u8 {
    if idx >= PALETTE_N {
        return 0;
    }

    let mut v = idx as u8;
    for _ in 0..n.abs() {
        v = if n > 0 {
            SHADE_DOWN[v as usize]
        } else {
            SHADE_UP[v as usize]
        };
    }
    v
}

/// Generates a flattened `(steps + 1) * PALETTE_N` GPU shading lookup table.
pub fn shade_table(steps: usize) -> Vec<u8> {
    let mut t = vec![0u8; (steps + 1) * PALETTE_N];
    for i in 0..PALETTE_N {
        t[i] = i as u8;
    }

    for s in 1..=steps {
        for i in 0..PALETTE_N {
            let prev = t[(s - 1) * PALETTE_N + i];
            t[s * PALETTE_N + i] = SHADE_DOWN[prev as usize];
        }
    }
    t
}
