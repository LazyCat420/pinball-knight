// Parity test suite for Pickup Toasts and Banner Notification Layer.
// Replicates legacy/src/game/pinball-knight/gui/screens/toasts.ts

use pk_gui::font::Fonts;
use pk_gui::im::{begin_ui, empty_ui_input, rect};
use pk_gui::painter::Painter;
use pk_gui::screens::toasts::{ToastQueue, CARD_HOLD_MS, HOLD_MS, MAX_ROWS};

#[test]
fn toasts_queue_caps_at_max_rows() {
    let mut q = ToastQueue::new();

    for i in 0..10 {
        q.push_toast(&format!("Toast {}", i), 1000);
    }

    assert_eq!(q.toasts.len(), MAX_ROWS);
    assert_eq!(q.toasts[0].text, "Toast 6");
    assert_eq!(q.toasts[MAX_ROWS - 1].text, "Toast 9");
}

#[test]
fn toasts_queue_holds_card_longer_and_prunes_expired() {
    let mut q = ToastQueue::new();

    q.push_toast("Iron Sword", 1000);
    q.push_card_toast("spidersilk#4s", "Spidersilk Boots", 1000);

    assert_eq!(q.toasts[0].until_ms, 1000 + HOLD_MS);
    assert_eq!(q.toasts[1].until_ms, 1000 + CARD_HOLD_MS);

    // Advance clock past plain toast, before card toast
    q.prune(1000 + HOLD_MS + 100);
    assert_eq!(q.toasts.len(), 1);
    assert_eq!(q.toasts[0].card_id.as_deref(), Some("spidersilk#4s"));

    // Advance clock past card toast
    q.prune(1000 + CARD_HOLD_MS + 100);
    assert_eq!(q.toasts.len(), 0);
}

#[test]
fn toasts_queue_paints_without_crashing() {
    let fonts = Fonts::load_embedded();
    let mut p = Painter::new(640, 338);

    let mut q = ToastQueue::new();
    q.push_toast("Acquired 50 Gold", 0);
    q.push_banner("FLOOR 3", "THE CATACOMBS", 0, 2400);

    let mut f = begin_ui(&mut p, &fonts, 640.0, 338.0, empty_ui_input(), 0, 1);
    q.paint_toasts(&mut f, rect(0.0, 0.0, 640.0, 338.0), 100);
}
