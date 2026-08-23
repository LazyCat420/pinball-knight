// Parity test suite for Floor SVG Vector Exporter.
// Replicates legacy/src/game/pinball-knight/dev/floor-svg.ts

use pk_core::dev::floor_svg::{render_floor_svg, SvgOptions};
use pk_core::grid::{Grid, T_FLOOR};

#[test]
fn render_floor_svg_emits_valid_merged_rects() {
    let mut g = Grid::solid(6, 4);
    // Set a contiguous 3-tile run on row 1
    g.t[(1 * 6 + 1) as usize] = T_FLOOR;
    g.t[(1 * 6 + 2) as usize] = T_FLOOR;
    g.t[(1 * 6 + 3) as usize] = T_FLOOR;

    let opts = SvgOptions {
        px: 8,
        parts: true,
        groups: true,
        crop: None,
    };

    let svg = render_floor_svg(&g, &opts);
    assert!(svg.starts_with("<svg"));
    assert!(svg.ends_with("</svg>"));
    assert!(svg.contains(r#"viewBox="0 0 48 32""#));
    // Verify merged run width: 3 tiles * 8px = 24
    assert!(svg.contains(r#"<rect x="8" y="8" width="24" height="8"/>"#));
}
