// Parity test suite for Tavern Boot Failure Notice Overlay.
// Replicates legacy/src/scenes/tavern/boot-notice.ts

use pk_gui::screens::tavern_notice::{
    evaluate_fault_injection, TavernBootNotice, TavernBootState, COLOR_CRIMSON, COLOR_GOLD,
};

#[test]
fn tavern_notice_loading_state_attributes() {
    let notice = TavernBootNotice::loading();
    assert_eq!(notice.state, TavernBootState::Loading);
    assert_eq!(notice.heading, "OPENING THE TAVERN…");
    assert_eq!(notice.detail, None);
    assert_eq!(notice.reload_button, false);
    assert_eq!(COLOR_GOLD, "#c8a24a");
}

#[test]
fn tavern_notice_failed_state_attributes() {
    let notice = TavernBootNotice::failed(None);
    assert_eq!(notice.state, TavernBootState::Failed);
    assert_eq!(notice.heading, "THE TAVERN COULD NOT START");
    assert!(notice.detail.as_ref().unwrap().contains("webgpu context"));
    assert_eq!(notice.reload_button, true);
    assert_eq!(COLOR_CRIMSON, "#c4453f");
}

#[test]
fn fault_injection_flag_evaluates_correctly() {
    assert_eq!(evaluate_fault_injection(false), Ok(()));
    assert!(evaluate_fault_injection(true).is_err());
}
