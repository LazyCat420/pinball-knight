//! 🔌 NetClient — Socket endpoint resolution and reconnection backoff.
//!
//! PORTS: `legacy/src/net/socket.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum NetStatus {
    #[default]
    Idle,
    Connecting,
    Open,
    Closed,
}

pub const BACKOFF_MS: [u64; 5] = [1000, 2000, 4000, 8000, 15000];

pub fn backoff_for_attempt(attempt: usize) -> u64 {
    let idx = attempt.min(BACKOFF_MS.len() - 1);
    BACKOFF_MS[idx]
}

pub fn realtime_url(host: Option<&str>, is_https: bool) -> Option<String> {
    let h = host?;
    let proto = if is_https { "wss" } else { "ws" };
    Some(format!("{}://{}/ws", proto, h.trim_end_matches('/')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_progression_and_clamp() {
        assert_eq!(backoff_for_attempt(0), 1000);
        assert_eq!(backoff_for_attempt(1), 2000);
        assert_eq!(backoff_for_attempt(4), 15000);
        assert_eq!(backoff_for_attempt(10), 15000);
    }

    #[test]
    fn realtime_url_resolution() {
        assert_eq!(
            realtime_url(Some("braindeadbot.com"), true),
            Some("wss://braindeadbot.com/ws".into())
        );
        assert_eq!(
            realtime_url(Some("10.0.0.16:5174"), false),
            Some("ws://10.0.0.16:5174/ws".into())
        );
        assert_eq!(realtime_url(None, false), None);
    }
}
