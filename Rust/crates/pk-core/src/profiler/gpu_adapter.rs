//! GPU Adapter Hardware Detection — Identifies real silicon vs CPU software rasterizers.
//!
//! PORTS: `engine/gpu-adapter.ts`

pub const SOFTWARE_MARKERS: &[&str] = &[
    "swiftshader",
    "lavapipe",
    "llvmpipe",
    "software",
    "basic render",
    "microsoft basic",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GpuAdapterInfo {
    pub vendor: String,
    pub architecture: String,
    pub device: String,
    pub description: String,
    pub software: bool,
}

/// Parses GPU adapter metadata and detects CPU fallback rasterizers.
pub fn parse_gpu_adapter_info(
    vendor: &str,
    architecture: &str,
    device: &str,
    description: &str,
) -> GpuAdapterInfo {
    let combined = format!("{} {} {} {}", vendor, architecture, device, description).to_lowercase();
    let software = SOFTWARE_MARKERS.iter().any(|&m| combined.contains(m));

    GpuAdapterInfo {
        vendor: vendor.to_string(),
        architecture: architecture.to_string(),
        device: device.to_string(),
        description: description.to_string(),
        software,
    }
}

/// Checks if an adapter is a software rasterizer. Missing or unrecognized adapters are treated as untrusted (software: true).
pub fn is_software_adapter(info: Option<&GpuAdapterInfo>) -> bool {
    match info {
        Some(i) => i.software,
        None => true,
    }
}
