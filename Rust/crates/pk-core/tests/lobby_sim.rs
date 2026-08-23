// Parity test suite for Lobby Session Lifecycle Gate.
// Replicates legacy/src/game/pinball-knight/run/lobby.ts

use pk_core::run::lobby::LobbySession;

#[test]
fn prompt_character_fires_once_per_session() {
    let mut session = LobbySession::new();

    // First visit in fresh session
    assert!(session.should_prompt_character(false, false));
    assert!(session.asked_character);

    // Re-entering tavern after death / abandon
    assert!(!session.should_prompt_character(false, false));

    // Resetting session seam enables re-prompt
    session.reset_character_prompt();
    assert!(session.should_prompt_character(false, false));
}

#[test]
fn active_player_or_harness_bypasses_character_modal() {
    let mut session = LobbySession::new();

    // Run already in progress
    assert!(!session.should_prompt_character(true, false));
    assert!(!session.asked_character);

    // Headless automated test harness autostart
    assert!(!session.should_prompt_character(false, true));
    assert!(!session.asked_character);
}
