//! LOOK at the dealer's three tabs.
//!
//!   cargo run -p pk-gui --example dealer_shot -- /tmp/dealer
//!
//! Ten green tests say the layout fits, the focus rects land on the sheet and
//! the indices are absolute. None of them says it looks like a counter — the
//! alchemist shipped a tab 266px off the sheet with seven tests passing. This
//! is for a human to open.

use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input};
use pk_gui::painter::Painter;
use pk_gui::screens::dealer::*;

fn card(base: &str, shiny: bool, level: i32) -> StashCell {
    StashCell {
        base: base.into(),
        shiny,
        level,
    }
}

fn main() {
    let stem = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/dealer".into());
    let fonts = Fonts::load_embedded();

    let base = DealerView {
        tab: DealerTab::Shelf,
        gold: 1200,
        offers: vec![
            OfferCell {
                base: "spidersilk".into(),
                shiny: false,
                level: 1,
                price: 30,
                affordable: true,
            },
            OfferCell {
                base: "goblintooth".into(),
                shiny: true,
                level: 4,
                price: 80,
                affordable: true,
            },
            OfferCell {
                base: "worldbreaker".into(),
                shiny: false,
                level: 1,
                price: 5000,
                affordable: false,
            },
        ],
        reroll_price: 15,
        reroll_ok: true,
        weapons: vec![
            WeaponGroup {
                name: "SWORD".into(),
                sockets: vec![
                    SocketCell {
                        card: Some(card("crystalshard", false, 3)),
                    },
                    SocketCell {
                        card: Some(card("wispspark", true, 1)),
                    },
                    SocketCell { card: None },
                ],
            },
            WeaponGroup {
                name: "BOW".into(),
                sockets: vec![
                    SocketCell {
                        card: Some(card("batwingchip", false, 1)),
                    },
                    SocketCell { card: None },
                ],
            },
        ],
        stash: vec![
            card("grimscythe", false, 7),
            card("bloodpact", true, 1),
            card("golemcore", false, 1),
            card("venomgland", false, 2),
            card("necrosigil", true, 5),
            card("timeripper", false, 1),
            card("hulkknuckle", false, 1),
            card("brutecleaver", true, 9),
            card("shamblerhide", false, 1),
            card("midgetclaw", false, 1),
        ],
        picked: Some(4),
        page: 0,
        message: Some("bought Necro Sigil".into()),
    };

    for (tab, name) in [
        (DealerTab::Shelf, "shelf"),
        (DealerTab::Sockets, "sockets"),
        (DealerTab::Stash, "stash"),
    ] {
        // Zoom 2, the size a real window gives these counters.
        let zoom = 2;
        let (w, h) = (600u32 * zoom, 338u32 * zoom);
        let mut p = Painter::new(w, h);
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), -1, zoom);
            let v = DealerView {
                tab,
                ..base.clone()
            };
            paint_dealer(&mut f, &v);
        }
        let path = format!("{stem}-{name}.png");
        write_png(&path, w, h, &p.buf);
        println!("wrote {path}");
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
