//! WHAT ACTUALLY FITS IN THE DEALER'S 338px BOX?
//!
//!   cargo run -p pk-gui --example dealer_fit
//!
//! Two open questions the plan flagged, both answered by measuring rather than
//! by eye:
//!
//!   1. A card cell is 56px and the baked text floor is 8px. How many
//!      characters fit under a cell — i.e. can a price, a name, or both go
//!      there?
//!   2. The oracle's `cardsBody` stacks a shelf, a reroll, one row per weapon
//!      and a stash grid. The port's vendor box is 338px tall and does not
//!      scroll. Does that stack fit, and if not, what has to give?

use pk_gui::cards;
use pk_gui::font::Fonts;

/// The oracle's own cell (`gui/screens/tavern.ts`).
const SLOT_W: f64 = 56.0;
/// The vendor design box the port's counters are authored in (`pk_game::gui`).
const BOX_H: f64 = 338.0;
const BOX_W: f64 = 600.0;

fn main() {
    let fonts = Fonts::load_embedded();
    let slot_h = f64::from(cards::card_face_height(SLOT_W as u32));

    println!("== 1. TEXT UNDER A {SLOT_W}px CELL, at the 8px floor ==");
    for s in [
        "125g",
        "1250g",
        "SPIDER SILK",
        "Spider Silk",
        "MYTHIC",
        "LEGENDARY",
        "+5",
        "Lv10",
    ] {
        let w = fonts.measure(s, 8);
        let fits = if w <= SLOT_W { "fits" } else { "OVERFLOWS" };
        println!("  {s:14} {w:6.1}px  {fits}");
    }
    // How many average characters?
    let m = fonts.measure("MMMMMMMMMM", 8) / 10.0;
    let n = fonts.measure("nnnnnnnnnn", 8) / 10.0;
    println!(
        "  → per char: 'M' {m:.2}px, 'n' {n:.2}px ⇒ {:.0}-{:.0} chars in {SLOT_W}px",
        SLOT_W / m,
        SLOT_W / n
    );

    println!("\n== 2. THE ORACLE'S STACK IN A {BOX_H}px BOX ==");
    // Row heights the port's other counters use (theme::GRID-derived), and the
    // oracle's own section structure for cardsBody.
    let head = 14.0; // heading
    let items: [(&str, f64); 7] = [
        ("heading: THE SHELF", head),
        ("shelf row (card + price)", slot_h + 26.0),
        ("REROLL SHELF button", 28.0),
        ("heading: YOUR WEAPONS", head),
        ("one weapon row", slot_h + 24.0),
        ("heading: STASH", head),
        ("one stash row", slot_h + 18.0),
    ];
    let mut total = 0.0;
    for (label, h) in items {
        total += h;
        println!("  {label:28} {h:6.1}   running {total:6.1}");
    }
    println!("  ---------------------------------------------");
    println!("  ONE of each                     {total:6.1} / {BOX_H}");
    if total > BOX_H {
        println!(
            "  ⇒ OVERFLOWS by {:.1}px with a SINGLE weapon and a SINGLE stash row",
            total - BOX_H
        );
    } else {
        println!(
            "  ⇒ fits, with {:.1}px spare for more weapons/stash rows",
            BOX_H - total
        );
    }

    // How many cards fit across, and so how many stash rows a 30-card stash needs.
    let per_row = (BOX_W / (SLOT_W + 6.0)).floor().max(1.0);
    println!("\n== 3. THE STASH GRID ==");
    println!("  {per_row:.0} cards per row at {SLOT_W}px + 6 gap in {BOX_W}px");
    for stash in [3, 10, 20, 30] {
        let rows = (f64::from(stash) / per_row).ceil();
        let h = rows * (slot_h + 18.0);
        println!("  {stash:2} cards ⇒ {rows:.0} rows ⇒ {h:6.1}px of grid");
    }

    // ── THE FIX: two tabs, the way the alchemist beat the same squeeze ──
    // A buying half and a managing half. Check EACH fits on its own, at the
    // WORST case (three weapons, a full stash), not the empty case.
    println!("\n== 4. TWO TABS — does each half fit? ==");
    let tabs = 24.0; // the alchemist's tab strip
    let msg = 12.0; // the flash line every counter carries

    let buy = tabs + head + (slot_h + 26.0) + 28.0 + msg;
    println!(
        "  SHELF tab: tabs {tabs} + head {head} + shelf {:.0} + reroll 28 + msg {msg}",
        slot_h + 26.0
    );
    println!("    = {buy:.1} / {BOX_H}  {}", verdict(buy, BOX_H));

    // The managing half is the hard one: three weapons AND the stash.
    for weapons in [1, 3] {
        for stash_rows in [1, 2, 3] {
            let manage = tabs
                + head
                + f64::from(weapons) * (slot_h + 24.0)
                + head
                + f64::from(stash_rows) * (slot_h + 18.0)
                + msg;
            println!(
                "  MANAGE tab: {weapons} weapon(s) + {stash_rows} stash row(s) = {manage:6.1} / {BOX_H}  {}",
                verdict(manage, BOX_H)
            );
        }
    }

    // If even that overflows, the cells themselves must shrink. What cell width
    // makes 3 weapons + 2 stash rows fit?
    println!("\n== 5. SHRINKING THE CELL DOES NOT RESCUE IT ==");
    for w in [56u32, 48, 44, 40, 36] {
        let h = f64::from(cards::card_face_height(w));
        let manage = tabs + head + 3.0 * (h + 24.0) + head + 2.0 * (h + 18.0) + msg;
        let per = (BOX_W / (f64::from(w) + 6.0)).floor();
        println!(
            "  cell {w}x{h:.0}: 3 weapons + 2 stash rows = {manage:6.1} / {BOX_H}  {}  ({per:.0}/row)",
            verdict(manage, BOX_H)
        );
    }

    // ── THE REAL FIX ──
    // The stack is tall because WEAPONS and STASH are both card grids stacked
    // vertically, one weapon per row. But three weapons at three sockets is
    // NINE cells — one row's worth, not three rows'. Lay the sockets out as a
    // single row of cells with the weapon named above each group, and the
    // weapons section collapses from 3 rows to 1.
    println!("\n== 6. SOCKETS AS ONE ROW ==");
    println!("  3 weapons x 3 sockets = 9 cells; {per_row:.0} fit across at {SLOT_W}px");
    for w in [56u32, 48, 44] {
        let h = f64::from(cards::card_face_height(w));
        let per = (BOX_W / (f64::from(w) + 6.0)).floor();
        let socket_rows = (9.0f64 / per).ceil();
        for stash_rows in [2.0, 3.0] {
            let manage =
                tabs + head + socket_rows * (h + 24.0) + head + stash_rows * (h + 18.0) + msg;
            println!(
                "  cell {w}: sockets {socket_rows:.0} row + stash {stash_rows:.0} rows = {manage:6.1} / {BOX_H}  {}",
                verdict(manage, BOX_H)
            );
        }
    }

    // ── BUT THE CELL CANNOT SHRINK ──
    // Only 56 blits 1:1. `cards::baked_width` selects a TIER, it does not
    // scale: a 48px cell asks for 48 (zoom 1) or 96 (zoom 2) and gets the 56
    // tier both times, i.e. a 0.857x / 1.71x resample of card art whose whole
    // job is carrying a title and four stat rows. That is precisely what the
    // two-tier bake exists to prevent, so shrinking the cell is not on the
    // table and the STASH has to give instead.
    println!("\n== 7. CELL PINNED AT 56 — how many stash rows are left? ==");
    let socket_row = slot_h + 24.0;
    for stash_rows in [1.0, 2.0] {
        let manage = tabs + head + socket_row + head + stash_rows * (slot_h + 18.0) + msg;
        println!(
            "  sockets 1 row + stash {stash_rows:.0} row(s) = {manage:6.1} / {BOX_H}  {}  ⇒ {:.0} cards visible",
            verdict(manage, BOX_H),
            stash_rows * per_row
        );
    }
    // A pager costs one line and buys the whole stash.
    let pager = 14.0;
    let manage = tabs + head + socket_row + head + 2.0 * (slot_h + 18.0) + pager + msg;
    println!(
        "  + a {pager:.0}px PAGER line, stash 2 rows   = {manage:6.1} / {BOX_H}  {}",
        verdict(manage, BOX_H)
    );
    let manage1 = tabs + head + socket_row + head + 1.0 * (slot_h + 18.0) + pager + msg;
    println!(
        "  + a {pager:.0}px PAGER line, stash 1 row    = {manage1:6.1} / {BOX_H}  {}  ⇒ {per_row:.0}/page",
        verdict(manage1, BOX_H)
    );
}

fn verdict(got: f64, budget: f64) -> String {
    if got <= budget {
        format!("fits, {:.0}px spare", budget - got)
    } else {
        format!("OVERFLOWS by {:.0}px", got - budget)
    }
}
