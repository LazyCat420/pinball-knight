//! 🏷️ PLAYER NAME — Persistent player handle for leaderboards.
//!
//! PORTS: `legacy/src/services/player-name.ts`

pub const NAME_MAX: usize = 12;
pub const DEFAULT_NAME: &str = "KNIGHT";

pub fn normalize_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_NAME.to_string();
    }
    trimmed.chars().take(NAME_MAX).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_name_length_and_whitespace() {
        assert_eq!(normalize_name("  Arthur Pendragon  "), "Arthur Pendr");
        assert_eq!(normalize_name("  Arthur  "), "Arthur");
        assert_eq!(normalize_name("   "), "KNIGHT");
        assert_eq!(normalize_name(""), "KNIGHT");
        assert_eq!(normalize_name("123456789012345"), "123456789012");
    }
}
