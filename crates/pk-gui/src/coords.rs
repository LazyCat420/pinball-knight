//! Window to UI Pixel Coordinates — Maps browser mouse/pointer events to integer-scaled UI grid.
//!
//! PORTS: `gui/coords.ts`

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UiSizing {
    pub scale: f64,
    pub css_scale: f64,
    pub render_w: f64,
    pub render_h: f64,
    pub out_w: f64,
    pub out_h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UiPoint {
    pub x: f64,
    pub y: f64,
    pub inside: bool,
}

/// Computes the floored top-left CSS origin of the canvas within the window.
pub fn canvas_origin(sizing: &UiSizing, win_w: f64, win_h: f64) -> (f64, f64) {
    let css_w = (sizing.render_w * sizing.css_scale).round();
    let css_h = (sizing.render_h * sizing.css_scale).round();

    (
        ((win_w - css_w) / 2.0).floor(),
        ((win_h - css_h) / 2.0).floor(),
    )
}

/// Converts a window-space pointer coordinate (MouseEvent clientX/clientY) to UI pixels.
pub fn screen_to_ui(
    client_x: f64,
    client_y: f64,
    sizing: &UiSizing,
    win_w: f64,
    win_h: f64,
) -> UiPoint {
    let (left, top) = canvas_origin(sizing, win_w, win_h);
    let x = (client_x - left) / sizing.css_scale;
    let y = (client_y - top) / sizing.css_scale;

    let inside = x >= 0.0 && y >= 0.0 && x < sizing.render_w && y < sizing.render_h;

    UiPoint { x, y, inside }
}
