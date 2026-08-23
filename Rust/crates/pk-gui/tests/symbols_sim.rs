// Parity test suite for Pixel Slot Machine Symbols.
// Replicates legacy/src/scenes/tavern/gambler/symbols.ts

use pk_gui::gambler::symbols::{get_symbol_runs, SlotSymbol, Tone, SYM_GRID};

#[test]
fn symbols_pixel_runs_bounding_and_shading() {
    let symbols = [
        SlotSymbol::Ball,
        SlotSymbol::Flipper,
        SlotSymbol::Star,
        SlotSymbol::Skull,
        SlotSymbol::Crown,
        SlotSymbol::Cherry,
    ];

    for sym in symbols {
        let runs = get_symbol_runs(sym);
        assert!(!runs.is_empty(), "Symbol runs must not be empty");

        for r in &runs {
            assert!(r.x + r.w <= SYM_GRID, "X overflow: {} + {} > 16", r.x, r.w);
            assert!(r.y + r.h <= SYM_GRID, "Y overflow: {} + {} > 16", r.y, r.h);
        }

        // Must contain both ink outline and base fill
        assert!(runs.iter().any(|r| r.tone == Tone::Ink));
        assert!(runs.iter().any(|r| r.tone == Tone::Base));
    }
}
