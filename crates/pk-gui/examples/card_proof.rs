//! A LOOK at the baked card faces, drawn by the PORT's own painter.
//!
//!   cargo run -p pk-gui --example card_proof -- /tmp/card-proof.png
//!
//! The bake's contact sheet is the BROWSER drawing its own canvases; it proves
//! the art was produced, not that this crate can put it on screen. This draws
//! through `im::draw_card` at zoom 1 and zoom 2 — the two the vendor counters
//! reach — so what comes out is what the dealer's shelf will look like.
//!
//! Deliberately an example, not a test: there is no golden to compare against
//! (the goldens are baked from the legacy sheet, and no legacy sheet paints a
//! shelf yet), and a test that renders without asserting is a test that defines
//! its own subject. This is for a human to open.

use pk_gui::cards;
use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, draw_card, empty_ui_input, fill_rect, rect, text, TextOpts};
use pk_gui::painter::{Painter, Rgba};
use pk_gui::theme::Ui;

/// The tavern's own cell, from `gui/screens/tavern.ts`.
const SLOT_W: f64 = 56.0;

fn main() {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/card-proof.png".to_string());
    let fonts = Fonts::load_embedded();

    // A row of five cards, plain then shiny, at each zoom.
    let show = [
        "goblintooth",
        "crystalshard",
        "wispspark",
        "grimscythe",
        "worldbreaker",
    ];
    let slot_h = f64::from(cards::card_face_height(SLOT_W as u32));
    let cols = show.len() as f64;
    let ui_w = cols * (SLOT_W + 8.0) + 8.0;
    let ui_h = 2.0 * (slot_h + 22.0) + 30.0;

    for zoom in [1u32, 2u32] {
        let gw = (ui_w * f64::from(zoom)) as u32;
        let gh = (ui_h * f64::from(zoom)) as u32;
        let mut p = Painter::new(gw, gh);
        {
            let mut f = begin_ui(&mut p, &fonts, ui_w, ui_h, empty_ui_input(), -1, zoom);
            fill_rect(
                &mut f,
                &rect(0.0, 0.0, ui_w, ui_h),
                Rgba {
                    r: 11,
                    g: 13,
                    b: 18,
                    a: 255,
                },
            );
            text(
                &mut f,
                &format!("zoom {zoom} — draw_card at {SLOT_W}px cells"),
                8.0,
                6.0,
                TextOpts {
                    size: 8,
                    colour: Some(Ui::HEADING),
                    ..Default::default()
                },
            );
            // The width to ASK the bake for: the cell in DEVICE pixels, so at
            // zoom 2 a 56px cell selects the 112 tier and blits 1:1.
            let want = cards::baked_width((SLOT_W * f64::from(zoom)) as u32);
            for (row, shiny) in [false, true].into_iter().enumerate() {
                let y = 22.0 + row as f64 * (slot_h + 22.0);
                for (i, base) in show.iter().enumerate() {
                    let x = 8.0 + i as f64 * (SLOT_W + 8.0);
                    match cards::face(base, shiny, want) {
                        Some(face) => draw_card(&mut f, face, x, y, SLOT_W),
                        None => panic!("no baked face for {base} shiny={shiny} at {want}"),
                    }
                    text(
                        &mut f,
                        if shiny { "shiny" } else { "plain" },
                        x,
                        y + slot_h + 2.0,
                        TextOpts {
                            size: 8,
                            colour: Some(Ui::TEXT_FAINT),
                            ..Default::default()
                        },
                    );
                }
            }
        }
        let path = if zoom == 1 {
            out.clone()
        } else {
            out.replace(".png", "-zoom2.png")
        };
        write_png(&path, gw, gh, &p.buf);
        println!("wrote {path} ({gw}x{gh})");
    }
}

fn write_png(path: &str, w: u32, h: u32, rgba: &[u8]) {
    let file = std::fs::File::create(path).expect("create");
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()
        .expect("header")
        .write_image_data(rgba)
        .expect("data");
}
