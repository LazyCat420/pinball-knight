/// WGSL vertex shader for solid-colour shapes.
pub const SOLID_VERT: &str = r#"
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    // NDC: x in [-1, 1], y in [-1, 1]
    // Our world space: x in [0, 1] left-to-right, y in [0, 1] bottom-to-top
    let ndc_x = in.position.x * 2.0 - 1.0;
    let ndc_y = in.position.y * 2.0 - 1.0;
    out.clip_position = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
    out.color = in.color;
    return out;
}
"#;

/// WGSL fragment shader for solid-colour shapes.
pub const SOLID_FRAG: &str = r#"
@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    return color;
}
"#;

/// Combined WGSL shader source (vert + frag in one module).
pub const SHADER_SOURCE: &str = r#"
struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let ndc_x = in.position.x * 2.0 - 1.0;
    let ndc_y = in.position.y * 2.0 - 1.0;
    out.clip_position = vec4<f32>(ndc_x, ndc_y, 0.0, 1.0);
    out.color = in.color;
    return out;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
    return color;
}
"#;
