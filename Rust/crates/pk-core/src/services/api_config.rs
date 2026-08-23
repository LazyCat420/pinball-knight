//! 🌐 API CONFIG — Backend endpoints and origin resolution.
//!
//! PORTS: `legacy/src/services/api-config.ts`

pub const BACKEND_API_URL: &str = "http://192.168.1.134:3000";
pub const DEFAULT_LOCAL_BACKEND: &str = "http://192.168.1.134:3000";

pub fn is_remote_backend_enabled() -> bool {
    true
}

pub fn isRemoteBackendEnabled() -> bool {
    is_remote_backend_enabled()
}

pub fn leaderboard_base(origin: Option<&str>) -> String {
    if let Some(o) = origin {
        if o.starts_with("http://") || o.starts_with("https://") {
            return o.trim_end_matches('/').to_string();
        }
    }
    DEFAULT_LOCAL_BACKEND.to_string()
}

pub fn leaderboardBase() -> String {
    leaderboard_base(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_leaderboard_base() {
        assert_eq!(leaderboard_base(Some("https://lazycat.lan:8080/")), "https://lazycat.lan:8080");
        assert_eq!(leaderboard_base(None), DEFAULT_LOCAL_BACKEND);
        assert_eq!(leaderboardBase(), DEFAULT_LOCAL_BACKEND);
        assert!(isRemoteBackendEnabled());
    }
}
