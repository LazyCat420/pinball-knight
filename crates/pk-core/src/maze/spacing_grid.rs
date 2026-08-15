//! Uniform Spacing Grid — O(1) neighbourhood spatial hash accelerator for dungeon decoration placement.
//!
//! PORTS: `engine/spacing-grid.ts`

use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Metric {
    #[default]
    Euclid,
    Manhattan,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SpacingGrid {
    pub radius: f32,
    pub cell: i32,
    pub metric: Metric,
    pub buckets: HashMap<u64, Vec<(i32, i32)>>,
    pub count: usize,
}

impl SpacingGrid {
    pub fn new(radius: f32, metric: Metric) -> Self {
        let cell = 1.max(radius.ceil() as i32);
        Self {
            radius,
            cell,
            metric,
            buckets: HashMap::new(),
            count: 0,
        }
    }

    #[inline]
    fn key(bi: i32, bj: i32) -> u64 {
        let ubi = (bi + 32768) as u64;
        let ubj = (bj + 32768) as u64;
        (ubi << 32) | (ubj & 0xffffffff)
    }

    #[inline]
    fn close(&self, di: f32, dj: f32) -> bool {
        match self.metric {
            Metric::Manhattan => (di.abs() + dj.abs()) < self.radius,
            Metric::Euclid => (di * di + dj * dj).sqrt() < self.radius,
        }
    }

    /// Queries if any inserted point is strictly closer than `radius` to `(i, j)`.
    pub fn occupied(&self, i: i32, j: i32) -> bool {
        if self.radius <= 0.0 {
            return false;
        }

        let bi = if i >= 0 { i / self.cell } else { (i - self.cell + 1) / self.cell };
        let bj = if j >= 0 { j / self.cell } else { (j - self.cell + 1) / self.cell };

        for dbi in -1..=1 {
            for dbj in -1..=1 {
                let k = Self::key(bi + dbi, bj + dbj);
                if let Some(pts) = self.buckets.get(&k) {
                    for &(pi, pj) in pts {
                        if self.close((pi - i) as f32, (pj - j) as f32) {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }

    /// Inserts a point into the spatial hash grid.
    pub fn add(&mut self, i: i32, j: i32) {
        let bi = if i >= 0 { i / self.cell } else { (i - self.cell + 1) / self.cell };
        let bj = if j >= 0 { j / self.cell } else { (j - self.cell + 1) / self.cell };
        let k = Self::key(bi, bj);

        self.buckets.entry(k).or_default().push((i, j));
        self.count += 1;
    }

    /// Total count of points inserted so far.
    pub fn size(&self) -> usize {
        self.count
    }
}
