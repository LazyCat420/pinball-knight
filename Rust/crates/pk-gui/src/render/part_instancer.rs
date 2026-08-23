//! PART INSTANCER — Consolidated InstancedMesh draw calls for high-frequency table parts.
//!
//! Replaces per-part individual meshes with single-draw instanced mesh buckets carrying per-instance transform and emissive attributes.
//!
//! PORTS: `render/part-instancer.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct EmissiveSink {
    pub instance_idx: usize,
    pub intensity: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PartInstanceBucket {
    pub kind: String,
    pub transforms: Vec<[f32; 16]>,
    pub emissives: Vec<f32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PartInstancer {
    pub buckets: Vec<PartInstanceBucket>,
}

impl PartInstancer {
    pub fn new() -> Self {
        Self {
            buckets: Vec::new(),
        }
    }

    /// Adds a new instance to a part bucket, returning its instance index.
    pub fn add_instance(
        &mut self,
        kind: &str,
        transform: [f32; 16],
        initial_emissive: f32,
    ) -> usize {
        let bucket = match self.buckets.iter_mut().find(|b| b.kind == kind) {
            Some(b) => b,
            None => {
                self.buckets.push(PartInstanceBucket {
                    kind: kind.to_string(),
                    transforms: Vec::new(),
                    emissives: Vec::new(),
                });
                self.buckets.last_mut().unwrap()
            }
        };

        let idx = bucket.transforms.len();
        bucket.transforms.push(transform);
        bucket.emissives.push(initial_emissive);
        idx
    }

    /// Updates dynamic emissive intensity for an instance.
    pub fn set_emissive(&mut self, kind: &str, instance_idx: usize, intensity: f32) {
        if let Some(bucket) = self.buckets.iter_mut().find(|b| b.kind == kind) {
            if let Some(emissive) = bucket.emissives.get_mut(instance_idx) {
                *emissive = intensity;
            }
        }
    }

    pub fn count(&self, kind: &str) -> usize {
        self.buckets
            .iter()
            .find(|b| b.kind == kind)
            .map(|b| b.transforms.len())
            .unwrap_or(0)
    }

    pub fn total_instances(&self) -> usize {
        self.buckets.iter().map(|b| b.transforms.len()).sum()
    }

    pub fn clear(&mut self) {
        self.buckets.clear();
    }
}
