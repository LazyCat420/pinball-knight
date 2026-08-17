//! PORTS: `dev/draw-census.ts`, `engine/gpu-adapter.ts`
//! PORTS-PARTIAL: `engine/profiler.ts` - NOT a finished port - 18 rust code lines against 169 legacy (11%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

pub mod draw_census;
pub mod gpu_adapter;

pub use draw_census::*;
pub use gpu_adapter::*;

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct StageTiming {
    pub current_ms: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct EngineProfiler {
    pub stages: HashMap<String, StageTiming>,
}

impl EngineProfiler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records the execution duration of a named engine stage in milliseconds.
    pub fn record_stage(&mut self, stage: &str, elapsed_ms: f64) {
        let entry = self.stages.entry(stage.to_string()).or_insert(StageTiming {
            current_ms: elapsed_ms,
            avg_ms: elapsed_ms,
            max_ms: elapsed_ms,
        });

        entry.current_ms = elapsed_ms;
        entry.avg_ms = entry.avg_ms * 0.9 + elapsed_ms * 0.1;
        entry.max_ms = entry.max_ms.max(elapsed_ms);
    }
}
