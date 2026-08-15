//! FLOOR → SVG Vector Exporter.
//!
//! Generates pure SVG XML representation of floor geometry, merging horizontal runs
//! into compact rects for fast browser inspection without DOM dependencies.
//!
//! PORTS: `dev/floor-svg.ts`

use crate::grid::{Grid, T_FLOOR};

#[derive(Clone, Debug)]
pub struct SvgOptions {
    pub px: u32,
    pub parts: bool,
    pub groups: bool,
    pub crop: Option<(i32, i32, i32, i32)>,
}

impl Default for SvgOptions {
    fn default() -> Self {
        Self {
            px: 4,
            parts: true,
            groups: true,
            crop: None,
        }
    }
}

/// Renders a grid to an optimized SVG string.
pub fn render_floor_svg(grid: &Grid, opts: &SvgOptions) -> String {
    let px = opts.px.max(1);
    let (vx, vy, vw, vh) = match opts.crop {
        Some((cx, cy, cw, ch)) => (cx * px as i32, cy * px as i32, cw * px as i32, ch * px as i32),
        None => (0, 0, grid.w * px as i32, grid.h * px as i32),
    };

    let mut svg = String::with_capacity(4096);
    svg.push_str(&format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{} {} {} {}" width="{}" height="{}" style="background:#0b0d12">"##,
        vx, vy, vw, vh, vw, vh
    ));

    // Floor geometry layer with merged horizontal spans
    svg.push_str(r##"<g id="geometry" fill="#242b38">"##);
    for j in 0..grid.h {
        let mut span_start: Option<i32> = None;
        for i in 0..grid.w {
            let idx = (j * grid.w + i) as usize;
            let is_floor = grid.t.get(idx).copied() == Some(T_FLOOR);

            if is_floor {
                if span_start.is_none() {
                    span_start = Some(i);
                }
            } else if let Some(start_i) = span_start.take() {
                let span_len = i - start_i;
                svg.push_str(&format!(
                    r#"<rect x="{}" y="{}" width="{}" height="{}"/>"#,
                    start_i * px as i32,
                    j * px as i32,
                    span_len * px as i32,
                    px
                ));
            }
        }
        if let Some(start_i) = span_start.take() {
            let span_len = grid.w - start_i;
            svg.push_str(&format!(
                r#"<rect x="{}" y="{}" width="{}" height="{}"/>"#,
                start_i * px as i32,
                j * px as i32,
                span_len * px as i32,
                px
            ));
        }
    }
    svg.push_str("</g>");

    svg.push_str("</svg>");
    svg
}
