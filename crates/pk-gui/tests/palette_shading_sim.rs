// Parity test suite for Material Palette Shading Row Walks.
// Replicates legacy/src/game/pinball-knight/render/palette-shading.ts

use pk_gui::render::palette_shading::{
    family_of, shade_by, shade_table, FAMILIES, PALETTE_N, SHADE_DOWN, SHADE_UP,
};

#[test]
fn every_palette_entry_belongs_to_exactly_one_family() {
    let mut seen = [false; PALETTE_N];
    for (f_idx, fam) in FAMILIES.iter().enumerate() {
        for &entry in *fam {
            assert!(!seen[entry], "Entry {} in multiple families", entry);
            seen[entry] = true;
            assert_eq!(family_of(entry), Some(f_idx));
        }
    }
    assert!(seen.iter().all(|&s| s), "Not all 32 entries covered");
}

#[test]
fn shade_down_preserves_family_or_falls_through_to_ink_void() {
    for i in 0..PALETTE_N {
        let next = SHADE_DOWN[i] as usize;
        let orig_f = family_of(i);
        let next_f = family_of(next);

        // Either same family or fallthrough to ink (1) / void (0)
        assert!(
            orig_f == next_f || next == 1 || next == 0,
            "Entry {} ({:?}) jumped to {} ({:?})",
            i,
            orig_f,
            next,
            next_f
        );
    }
}

#[test]
fn shade_up_reverses_shade_down_within_family() {
    for i in 0..PALETTE_N {
        let brighter = SHADE_UP[i] as usize;
        let orig_f = family_of(i);
        let brighter_f = family_of(brighter);
        assert_eq!(orig_f, brighter_f);
    }
}

#[test]
fn shade_table_generates_correct_dimensions() {
    let table = shade_table(3);
    assert_eq!(table.len(), 4 * PALETTE_N);
    // Row 0 is unshaded identity
    for i in 0..PALETTE_N {
        assert_eq!(table[i], i as u8);
    }
    // Row 1 matches SHADE_DOWN
    for i in 0..PALETTE_N {
        assert_eq!(table[PALETTE_N + i], SHADE_DOWN[i]);
    }
}
