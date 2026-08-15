// Parity test suite for Pickup Toasts.
// Replicates legacy/src/game/pinball-knight/pickup-toast.ts

use pk_gui::pickup_toast::ToastQueue;

#[test]
fn toast_queue_collects_plain_and_card_notifications() {
    let mut queue = ToastQueue::new();
    assert!(queue.entries.is_empty());

    // Push plain toast
    queue.push_toast("+50 Gold");
    assert_eq!(queue.entries.len(), 1);
    assert_eq!(queue.entries[0].text, "+50 Gold");
    assert_eq!(queue.entries[0].card_id, None);
    assert_eq!(queue.entries[0].note, None);

    // Push card toast
    queue.push_card_toast("blade_echo", "Extra Slash Added");
    assert_eq!(queue.entries.len(), 2);
    assert_eq!(queue.entries[1].text, "blade_echo: Extra Slash Added");
    assert_eq!(queue.entries[1].card_id, Some("blade_echo".to_string()));
    assert_eq!(queue.entries[1].note, Some("Extra Slash Added".to_string()));

    // Clear toasts
    queue.clear();
    assert!(queue.entries.is_empty());
}
