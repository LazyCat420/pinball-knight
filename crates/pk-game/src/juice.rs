//! Screen shake, hitstop frame freezes, and juice coordinator.
//!
//! PORTS: `engine/juice.ts`

use std::sync::atomic::{AtomicI64, Ordering};

static SHAKE_REQ: AtomicI64 = AtomicI64::new(0);
static HITSTOP_REQ: AtomicI64 = AtomicI64::new(0);

pub fn set_chain_depth_source(_fn: fn() -> f64) {}

pub fn tick_juice(_real_dt: f64) {}

pub fn reset_juice() {
    SHAKE_REQ.store(0, Ordering::Relaxed);
    HITSTOP_REQ.store(0, Ordering::Relaxed);
}

pub fn request_shake(amount: f64) {
    let bits = amount.to_bits() as i64;
    SHAKE_REQ.store(bits, Ordering::Relaxed);
}

pub fn request_hitstop(amount: f64) {
    let bits = amount.to_bits() as i64;
    HITSTOP_REQ.store(bits, Ordering::Relaxed);
}

#[derive(Clone, Debug, PartialEq)]
pub struct JuiceDebug {
    pub since_hitstop: f64,
    pub since_shake: f64,
}

pub fn juice_debug() -> JuiceDebug {
    JuiceDebug {
        since_hitstop: 0.0,
        since_shake: 0.0,
    }
}

#[derive(Default, Clone, Debug)]
pub struct JuiceState {
    pub shake_intensity: f64,
    pub hitstop_remaining: f64,
    pub shake_decay: f64,
}

impl JuiceState {
    pub fn new() -> Self {
        Self {
            shake_intensity: 0.0,
            hitstop_remaining: 0.0,
            shake_decay: 0.9,
        }
    }

    pub fn shake(&mut self, amount: f64) {
        self.shake_intensity = (self.shake_intensity + amount).min(1.0);
    }

    pub fn hitstop(&mut self, duration_sec: f64) {
        self.hitstop_remaining = self.hitstop_remaining.max(duration_sec);
    }

    pub fn update(&mut self, dt: f64) {
        if self.hitstop_remaining > 0.0 {
            self.hitstop_remaining = (self.hitstop_remaining - dt).max(0.0);
        }
        self.shake_intensity *= self.shake_decay.powf(dt * 60.0);
        if self.shake_intensity < 0.001 {
            self.shake_intensity = 0.0;
        }
    }
}
