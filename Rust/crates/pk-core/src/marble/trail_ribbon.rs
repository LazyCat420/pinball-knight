//! The ricochet trail — a glowing ribbon along a ball or laser path.
//!
//! PORTS: `fx/pools/trail-ribbon.ts`

pub const TRAIL_PUSH_RATE: usize = 180; // points/sec: 3 substeps × 60Hz
pub const TRAIL_CAPACITY: usize = 448; // ≥ 180 × 1.9s (longest tail for laser)
pub const TRAIL_LIFE: f64 = 0.45; // Default tail lifespan in seconds
pub const LASER_TRAIL_LIFE: f64 = 1.9;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct TrailPoint {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub time: f64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrailRibbon {
    pub points: Vec<TrailPoint>,
    pub head: usize,
    pub count: usize,
    pub life: f64,
    pub color: [f32; 3],
}

impl Default for TrailRibbon {
    fn default() -> Self {
        Self::new(TRAIL_LIFE, [1.0, 0.8, 0.2])
    }
}

impl TrailRibbon {
    pub fn new(life: f64, color: [f32; 3]) -> Self {
        Self {
            points: vec![TrailPoint::default(); TRAIL_CAPACITY],
            head: 0,
            count: 0,
            life,
            color,
        }
    }

    /// Appends a newly sampled trajectory point to the ring buffer.
    pub fn push_point(&mut self, x: f64, y: f64, z: f64, now: f64) {
        self.points[self.head] = TrailPoint {
            x,
            y,
            z,
            time: now,
            active: true,
        };
        self.head = (self.head + 1) % TRAIL_CAPACITY;
        if self.count < TRAIL_CAPACITY {
            self.count += 1;
        }
    }

    /// Advances the trail ribbon clock and prunes points exceeding the configured lifespan.
    pub fn step(&mut self, now: f64) {
        for pt in self.points.iter_mut() {
            if pt.active && (now - pt.time) > self.life {
                pt.active = false;
            }
        }
    }

    /// Returns active points in chronological order with computed alpha falloff (1.0 = newest, 0.0 = oldest).
    pub fn active_points(&self, now: f64) -> Vec<(f64, f64, f64, f32)> {
        let mut result = Vec::with_capacity(self.count);

        for i in 0..self.count {
            // Read from oldest to newest
            let idx = (self.head + TRAIL_CAPACITY - self.count + i) % TRAIL_CAPACITY;
            let pt = &self.points[idx];
            if pt.active {
                let age = (now - pt.time).max(0.0);
                let alpha = (1.0 - (age / self.life)).clamp(0.0, 1.0) as f32;
                result.push((pt.x, pt.y, pt.z, alpha));
            }
        }

        result
    }

    /// Clears all active points in the ribbon.
    pub fn clear(&mut self) {
        for pt in self.points.iter_mut() {
            pt.active = false;
        }
        self.head = 0;
        self.count = 0;
    }
}
