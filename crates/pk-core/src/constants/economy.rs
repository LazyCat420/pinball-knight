//! Coins, gold, rolling cart merchant, and pickup physics constants.
//!
//! PORTS: `constants/economy.ts`

// ── Wave-J shop (Rolling Cart Merchant) ─────────────────────────
pub const MERCHANT_FROM_LEVEL: u32 = 2;
pub const MERCHANT_SPEED: f64 = 2.2;
pub const MERCHANT_FLEE_SPEED: f64 = 4.6;
pub const MERCHANT_FLEE_RANGE: f64 = 4.0;
pub const MERCHANT_CATCH_RANGE: f64 = 0.7;
pub const MERCHANT_BOUNCE_DWELL: f64 = 0.45;
pub const MERCHANT_BELL_PERIOD: f64 = 3.5;
pub const MERCHANT_BELL_RANGE: f64 = 26.0;
pub const MERCHANT_SPAWN_MIN_RING: u32 = 5;

// ── Coin drops — the kill payout physics ────────────────────────
pub const COIN_MAGNET_RANGE: f64 = 2.6;
pub const COIN_AURA_RANGE_MULT: f64 = 3.0;
pub const COIN_MAGNET_TIME: f64 = 0.42;
pub const COIN_CHEST_Y: f64 = 0.62;
pub const COIN_MAGNET_ARC: f64 = 0.34;
pub const COIN_BURST_VY: f64 = 2.4;
pub const COIN_GRAVITY: f64 = 13.0;
pub const COIN_BOUNCE: f64 = 0.42;
pub const COIN_BURST_SPREAD: f64 = 1.25;
pub const COIN_BURST_DRAG: f64 = 3.2;
pub const COIN_SETTLE_VY: f64 = 0.5;
