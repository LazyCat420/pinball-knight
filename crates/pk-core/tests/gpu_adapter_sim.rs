// Parity test suite for GPU Adapter Hardware Detection.
// Replicates legacy/src/game/pinball-knight/engine/gpu-adapter.ts

use pk_core::profiler::gpu_adapter::{is_software_adapter, parse_gpu_adapter_info};

#[test]
fn hardware_gpu_adapters_are_trusted() {
    let nvidia = parse_gpu_adapter_info(
        "NVIDIA Corporation",
        "Ada Lovelace",
        "NVIDIA GeForce RTX 4090",
        "Direct3D12",
    );
    assert!(!nvidia.software);
    assert!(!is_software_adapter(Some(&nvidia)));

    let amd = parse_gpu_adapter_info(
        "AMD",
        "RDNA3",
        "AMD Radeon RX 7900 XTX",
        "Vulkan",
    );
    assert!(!amd.software);
    assert!(!is_software_adapter(Some(&amd)));
}

#[test]
fn cpu_software_rasterizers_are_flagged() {
    let swiftshader = parse_gpu_adapter_info(
        "Google Inc. (Google)",
        "",
        "Google SwiftShader",
        "SwiftShader driver",
    );
    assert!(swiftshader.software);
    assert!(is_software_adapter(Some(&swiftshader)));

    let llvmpipe = parse_gpu_adapter_info(
        "Mesa",
        "",
        "llvmpipe (LLVM 15.0.7, 256 bits)",
        "",
    );
    assert!(llvmpipe.software);
    assert!(is_software_adapter(Some(&llvmpipe)));

    let basic = parse_gpu_adapter_info(
        "Microsoft",
        "",
        "Microsoft Basic Render Driver",
        "",
    );
    assert!(basic.software);
    assert!(is_software_adapter(Some(&basic)));
}

#[test]
fn missing_adapter_is_untrusted() {
    assert!(is_software_adapter(None));
}
