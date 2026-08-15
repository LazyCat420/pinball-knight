// Parity test suite for Autonomous Playtest Bot.
// Replicates legacy/src/game/pinball-knight/playtest-bot.ts

use pk_core::playtest_bot::{PlaytestBot, PlaytestBotConfig};

#[test]
fn playtest_bot_traversal_and_stuck_detection() {
    let mut bot = PlaytestBot::new(PlaytestBotConfig {
        mode: "bounce".to_string(),
        duration: Some(10.0),
        profile: false,
    });

    bot.start();
    assert!(bot.running);

    // Step 60 frames (1 second) with stationary player to trigger stuck detection
    for _ in 0..120 {
        let (axes, _buttons) = bot.step(5.0, 5.0, false, 0, 0, 1.0 / 60.0);
        assert!(axes[0] >= -1.0 && axes[0] <= 1.0);
        assert!(axes[1] >= -1.0 && axes[1] <= 1.0);
    }

    // After 2 seconds stationary, at least 1 stuck event must be recorded
    assert!(bot.stuck_count >= 1);

    let report = bot.stop();
    assert_eq!(report.frames, 120);
    assert!(report.stuck_events >= 1);
    assert!(!bot.running);
}
