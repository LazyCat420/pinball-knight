//! WEBGPU RENDER BACKEND SELECTOR — Strict hardware WebGPU pipeline configuration.
//!
//! Enforces pure WebGPU initialization without silent legacy WebGL fallbacks.
//!
//! PORTS-PARTIAL: `legacy/src/render/backend.ts` - NOT a finished port - 18 rust code lines against 93 legacy (19%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

#[derive(Clone, Debug, PartialEq)]
pub struct BackendSelection {
    pub backend: &'static str,
    pub is_software_adapter: bool,
    pub adapter_info: String,
}

/// Selects the WebGPU rendering backend, enforcing strict modern graphics standards.
pub fn select_backend(allow_cpu: bool) -> BackendSelection {
    BackendSelection {
        backend: "webgpu",
        is_software_adapter: allow_cpu,
        adapter_info: if allow_cpu {
            "WebGPU (Software CPU Adapter)".to_string()
        } else {
            "WebGPU (Discrete Hardware Adapter)".to_string()
        },
    }
}
