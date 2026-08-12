//! LOOK at the gambler's cabinet, one shot per game.
//!
//!   cargo run -p pk-gui --example gambler_shot -- /tmp/gambler
//!
//! Fourteen green tests say the layout fits, every focusable lands on the
//! sheet, all nine roulette bets are reachable and a rogue game cannot paint
//! over the chrome. None of them says it looks like a machine.

use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input};
use pk_gui::painter::Painter;
use pk_gui::screens::gambler::*;

const GOLD: u32 = 0x00f0_c040;
const COLD: u32 = 0x006f_d0e8;
const WARM: u32 = 0x00d9_5763;
const BONE: u32 = 0x00c9_bfa4;
const DIM: u32 = 0x003a_4152;

fn ctl(id: &str, label: &str, on: bool, disabled: bool) -> GameControl {
    GameControl {
        id: id.into(),
        label: label.into(),
        on,
        disabled,
    }
}

fn main() {
    let stem = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/gambler".into());
    let fonts = Fonts::load_embedded();

    let base = GamblerView {
        game: GamblerGame::Slots,
        gold: 1200,
        stake: 25,
        stake_options: vec![5, 10, 25, 50, 100],
        rounds_left: 4,
        net: -30,
        blurb: String::new(),
        paint: GamePaint::default(),
        controls: Vec::new(),
        busy: false,
        can_play: true,
        play_label: "SPIN".into(),
        message: Some("PAIR OF BUMPERS".into()),
    };

    // SLOTS — two reels down, the third still turning.
    let mut slots = base.clone();
    slots.blurb = "three reels, one payline — STOP pulls a reel in early".into();
    slots.busy = true;
    slots.play_label = "STOP".into();
    {
        let mut p = Vec::new();
        let (rw, rh, gap) = (92.0, 76.0, 14.0);
        let x0 = (GAME_W - (rw * 3.0 + gap * 2.0)) / 2.0;
        for i in 0..3 {
            let x = x0 + f64::from(i) * (rw + gap);
            p.push(GamePrim::Well {
                x,
                y: 30.0,
                w: rw,
                h: rh,
            });
            if i < 2 {
                p.push(GamePrim::Label {
                    x: x + rw / 2.0,
                    y: 30.0 + rh / 2.0 - 8.0,
                    s: if i == 0 { "BUMPER" } else { "BUMPER" }.into(),
                    size: 8,
                    colour: 0x008f_d06f,
                    centre: true,
                });
            } else {
                for b in 0..3 {
                    p.push(GamePrim::Fill {
                        x: x + 8.0,
                        y: 44.0 + f64::from(b) * 20.0,
                        w: rw - 16.0,
                        h: 10.0,
                        colour: DIM,
                    });
                }
            }
        }
        slots.paint = GamePaint { prims: p };
    }

    // ROULETTE — the strip, a ball, all nine bets.
    let mut roul = base.clone();
    roul.game = GamblerGame::Roulette;
    roul.blurb = "pick a bet, then SPIN — 0 is the house's".into();
    roul.play_label = "SPIN".into();
    roul.message = Some("RED PAYS 2x".into());
    roul.controls = vec![
        ctl("red", "RED", true, false),
        ctl("black", "BLACK", false, false),
        ctl("odd", "ODD", false, false),
        ctl("even", "EVEN", false, false),
        ctl("low", "1-9", false, false),
        ctl("high", "10-18", false, false),
        ctl("t1", "1-6", false, false),
        ctl("t2", "7-12", false, false),
        ctl("t3", "13-18", false, false),
    ];
    {
        let mut p = vec![GamePrim::Well {
            x: 24.0,
            y: 54.0,
            w: GAME_W - 48.0,
            h: 26.0,
        }];
        let bar_w = GAME_W - 48.0;
        let w = bar_w / 19.0;
        for i in 0..19 {
            let colour = if i == 0 {
                0x002f_7d4f
            } else if i % 2 == 1 {
                WARM
            } else {
                0x000d_1018
            };
            p.push(GamePrim::Fill {
                x: 24.0 + f64::from(i) * w + 1.0,
                y: 55.0,
                w: w - 2.0,
                h: 24.0,
                colour,
            });
        }
        p.push(GamePrim::Stroke {
            x: 24.0 + 7.0 * w,
            y: 54.0,
            w,
            h: 26.0,
            colour: GOLD,
        });
        p.push(GamePrim::Fill {
            x: 24.0 + 7.4 * w,
            y: 46.0,
            w: 4.0,
            h: 8.0,
            colour: BONE,
        });
        p.push(GamePrim::Label {
            x: GAME_W / 2.0,
            y: 88.0,
            s: "POCKET 7".into(),
            size: 8,
            colour: GOLD,
            centre: true,
        });
        p.push(GamePrim::Label {
            x: 24.0,
            y: 88.0,
            s: "ON RED".into(),
            size: 8,
            colour: COLD,
            centre: false,
        });
        roul.paint = GamePaint { prims: p };
    }

    // DARTS — two in the board, the sweep live.
    let mut darts = base.clone();
    darts.game = GamblerGame::Darts;
    darts.blurb = "THROW locks the sweep: across, then down. three darts".into();
    darts.play_label = "THROW".into();
    darts.busy = true;
    darts.message = None;
    {
        let (cx, cy, r) = (GAME_W / 2.0, 74.0, 46.0);
        let mut p = Vec::new();
        for (i, colour) in [(0, 0x001c_3024), (1, DIM), (2, WARM), (3, GOLD)] {
            let k = r * (1.0 - f64::from(i) * 0.25);
            p.push(GamePrim::Stroke {
                x: cx - k,
                y: cy - k,
                w: k * 2.0,
                h: k * 2.0,
                colour,
            });
        }
        for (dx, dy) in [(-0.2, 0.1), (0.35, -0.3)] {
            p.push(GamePrim::Fill {
                x: cx + dx * r - 1.5,
                y: cy + dy * r - 1.5,
                w: 3.0,
                h: 3.0,
                colour: BONE,
            });
        }
        p.push(GamePrim::Fill {
            x: cx + 0.15 * r - 1.0,
            y: cy - r,
            w: 2.0,
            h: r * 2.0,
            colour: COLD,
        });
        p.push(GamePrim::Label {
            x: 8.0,
            y: 110.0,
            s: "2 DARTS  84".into(),
            size: 8,
            colour: BONE,
            centre: false,
        });
        darts.paint = GamePaint { prims: p };
    }

    // BLACKJACK — a live hand, hole card down.
    let mut bj = base.clone();
    bj.game = GamblerGame::Blackjack;
    bj.blurb = "beat the dealer without going over 21".into();
    bj.play_label = "DEAL".into();
    bj.busy = true;
    bj.message = None;
    bj.controls = vec![
        ctl("hit", "HIT", false, false),
        ctl("stand", "STAND", false, false),
        ctl("double", "DOUBLE +25g", false, false),
    ];
    {
        let mut p = Vec::new();
        let mut row = |p: &mut Vec<GamePrim>, cards: &[&str], y: f64, hide: bool| {
            for (i, c) in cards.iter().enumerate() {
                let x = 24.0 + i as f64 * 31.0;
                let down = hide && i == 1;
                p.push(GamePrim::Fill {
                    x,
                    y,
                    w: 26.0,
                    h: 36.0,
                    colour: if down { DIM } else { BONE },
                });
                if !down {
                    p.push(GamePrim::Label {
                        x: x + 2.0,
                        y: y + 4.0,
                        s: (*c).into(),
                        size: 8,
                        colour: 0x000d_1018,
                        centre: false,
                    });
                }
            }
        };
        p.push(GamePrim::Label {
            x: 8.0,
            y: 22.0,
            s: "DEALER".into(),
            size: 8,
            colour: COLD,
            centre: false,
        });
        row(&mut p, &["K", "?"], 32.0, true);
        p.push(GamePrim::Label {
            x: 8.0,
            y: 74.0,
            s: "YOU".into(),
            size: 8,
            colour: GOLD,
            centre: false,
        });
        row(&mut p, &["9", "7"], 84.0, false);
        bj.paint = GamePaint { prims: p };
    }

    for (v, name) in [
        (slots, "slots"),
        (roul, "roulette"),
        (darts, "darts"),
        (bj, "blackjack"),
    ] {
        let zoom = 2u32;
        let (w, h) = (600 * zoom, 338 * zoom);
        let mut p = Painter::new(w, h);
        {
            let mut f = begin_ui(&mut p, &fonts, 600.0, 338.0, empty_ui_input(), -1, zoom);
            paint_gambler(&mut f, &v);
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
