//! Shockwave Ring Pool — 16-slot ring buffer for expanding/collapsing floor shockwaves.
//!
//! PORTS: `fx/pools/ring-pool.ts`

pub const RING_COUNT: usize = 16;
pub const RING_INNER: f32 = 0.78; // fat unit-ring inner radius -> a soft field band
pub const RING_INNER_THIN: f32 = 0.955; // sharp unit-ring inner radius -> a wave-front line

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RingOpts {
    pub delay: f32,
    pub inward: bool,
    pub thin: bool,
    pub opacity: f32,
}

impl Default for RingOpts {
    fn default() -> Self {
        Self {
            delay: 0.0,
            inward: false,
            thin: false,
            opacity: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RingInstance {
    pub active: bool,
    pub x: f32,
    pub z: f32,
    pub current_r: f32,
    pub max_r: f32,
    pub life: f32,
    pub max_life: f32,
    pub delay: f32,
    pub inward: bool,
    pub thin: bool,
    pub peak_opacity: f32,
    pub current_opacity: f32,
}

impl Default for RingInstance {
    fn default() -> Self {
        Self {
            active: false,
            x: 0.0,
            z: 0.0,
            current_r: 0.0,
            max_r: 1.0,
            life: 0.0,
            max_life: 0.0,
            delay: 0.0,
            inward: false,
            thin: false,
            peak_opacity: 1.0,
            current_opacity: 0.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RingPool {
    pub slots: [RingInstance; RING_COUNT],
    cursor: usize,
}

impl Default for RingPool {
    fn default() -> Self {
        Self::new()
    }
}

impl RingPool {
    pub fn new() -> Self {
        Self {
            slots: [RingInstance::default(); RING_COUNT],
            cursor: 0,
        }
    }

    pub fn spawn(&mut self, x: f32, z: f32, max_r: f32, duration: f32, opts: Option<RingOpts>) {
        let opt = opts.unwrap_or_default();
        let idx = self.cursor;
        self.cursor = (self.cursor + 1) % RING_COUNT;

        let slot = &mut self.slots[idx];
        slot.active = true;
        slot.x = x;
        slot.z = z;
        slot.max_r = max_r.max(0.1);
        slot.max_life = duration.max(0.01);
        slot.life = slot.max_life;
        slot.delay = opt.delay.max(0.0);
        slot.inward = opt.inward;
        slot.thin = opt.thin;
        slot.peak_opacity = opt.opacity.clamp(0.0, 1.0);
        slot.current_r = if opt.inward { slot.max_r } else { 0.0 };
        slot.current_opacity = 0.0;
    }

    pub fn step(&mut self, dt: f32) {
        for slot in &mut self.slots {
            if slot.life <= 0.0 {
                slot.active = false;
                continue;
            }

            if slot.delay > 0.0 {
                slot.delay -= dt;
                slot.current_opacity = 0.0;
                continue;
            }

            slot.life -= dt;
            if slot.life <= 0.0 {
                slot.active = false;
                slot.current_opacity = 0.0;
                continue;
            }

            let t = (1.0 - slot.life / slot.max_life).clamp(0.0, 1.0);
            // Outward: ease-out expansion (1 - (1-t)^2)
            // Inward: ease-in collapse (1 - t^2)
            let r = if slot.inward {
                slot.max_r * (1.0 - t * t)
            } else {
                slot.max_r * (1.0 - (1.0 - t) * (1.0 - t))
            };
            slot.current_r = r.max(0.05);
            slot.current_opacity = (t * std::f32::consts::PI).sin() * slot.peak_opacity;
        }
    }

    pub fn active_count(&self) -> usize {
        self.slots.iter().filter(|s| s.active).count()
    }
}
