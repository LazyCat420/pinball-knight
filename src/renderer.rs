use crate::physics::{Knight, PhysicsWorld, Vec2};
use crate::shader::SHADER_SOURCE;
use bytemuck::{Pod, Zeroable};
use std::sync::Arc;
use wgpu::util::DeviceExt;

/// A single GPU vertex: 2D position + RGBA colour.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 2],
    pub color: [f32; 4],
}

impl Vertex {
    fn desc() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                wgpu::VertexAttribute {
                    offset: std::mem::size_of::<[f32; 2]>() as wgpu::BufferAddress,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x4,
                },
            ],
        }
    }
}

pub struct Renderer {
    pub surface: wgpu::Surface<'static>,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub config: wgpu::SurfaceConfiguration,
    pub size: (u32, u32),
    pub pipeline: wgpu::RenderPipeline,
}

impl Renderer {
    pub async fn new(window: Arc<winit::window::Window>) -> Self {
        let size = window.inner_size();
        let width = size.width.max(1);
        let height = size.height.max(1);

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let surface = instance
            .create_surface(Arc::clone(&window))
            .expect("Failed to create surface");

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::default(),
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .expect("Failed to find adapter");

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .expect("Failed to create device");

        let surface_caps = surface.get_capabilities(&adapter);
        let surface_format = surface_caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(surface_caps.formats[0]);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width,
            height,
            present_mode: surface_caps.present_modes[0],
            alpha_mode: surface_caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Pinball Shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER_SOURCE.into()),
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Pipeline Layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                buffers: &[Vertex::desc()],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format: config.format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        Self {
            surface,
            device,
            queue,
            config,
            size: (width, height),
            pipeline,
        }
    }

    pub fn resize(&mut self, new_width: u32, new_height: u32) {
        if new_width > 0 && new_height > 0 {
            self.size = (new_width, new_height);
            self.config.width = new_width;
            self.config.height = new_height;
            self.surface.configure(&self.device, &self.config);
        }
    }

    /// Build vertex data for the entire scene and submit a render pass.
    pub fn render(&self, world: &PhysicsWorld, score: u32, lives: u8) -> Result<(), wgpu::SurfaceError> {
        let output = self.surface.get_current_texture()?;
        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut vertices: Vec<Vertex> = Vec::new();
        let mut indices: Vec<u32> = Vec::new();

        // Background: dark navy
        push_quad(
            &mut vertices,
            &mut indices,
            Vec2::new(0.0, 0.0),
            Vec2::new(1.0, 1.0),
            [0.05, 0.05, 0.15, 1.0],
        );

        // Table border
        push_line_thick(&mut vertices, &mut indices, Vec2::new(0.05, 0.0), Vec2::new(0.05, 1.0), 0.008, [0.6, 0.6, 0.8, 1.0]);
        push_line_thick(&mut vertices, &mut indices, Vec2::new(0.95, 0.0), Vec2::new(0.95, 1.0), 0.008, [0.6, 0.6, 0.8, 1.0]);
        push_line_thick(&mut vertices, &mut indices, Vec2::new(0.05, 0.98), Vec2::new(0.95, 0.98), 0.008, [0.6, 0.6, 0.8, 1.0]);
        // Lower guide rails
        push_line_thick(&mut vertices, &mut indices, Vec2::new(0.05, 0.30), Vec2::new(0.28, 0.12), 0.008, [0.5, 0.5, 0.9, 1.0]);
        push_line_thick(&mut vertices, &mut indices, Vec2::new(0.95, 0.30), Vec2::new(0.72, 0.12), 0.008, [0.5, 0.5, 0.9, 1.0]);

        // Bumpers
        for bumper in &world.bumpers {
            let color = if bumper.is_lit() {
                [1.0, 0.9, 0.1, 1.0]
            } else {
                [0.9, 0.3, 0.3, 1.0]
            };
            push_circle(&mut vertices, &mut indices, bumper.position, bumper.radius, color, 20);
            // Inner ring
            push_circle_ring(&mut vertices, &mut indices, bumper.position, bumper.radius * 0.6, 0.01, [1.0, 1.0, 1.0, 0.5], 20);
        }

        // Flippers
        for flipper in &world.flippers {
            let tip = flipper.tip();
            let color = if flipper.active {
                [0.2, 0.9, 0.3, 1.0]
            } else {
                [0.3, 0.6, 1.0, 1.0]
            };
            push_line_thick(&mut vertices, &mut indices, flipper.pivot, tip, 0.025, color);
            // Flipper end cap
            push_circle(&mut vertices, &mut indices, tip, 0.018, color, 12);
            push_circle(&mut vertices, &mut indices, flipper.pivot, 0.018, color, 12);
        }

        // Knight character
        render_knight(&mut vertices, &mut indices, &world.knight);

        // Ball
        let ball_color = [0.95, 0.95, 1.0, 1.0];
        push_circle(&mut vertices, &mut indices, world.ball.position, world.ball.radius, ball_color, 20);
        // Shine
        let shine_offset = Vec2::new(world.ball.radius * 0.3, world.ball.radius * 0.35);
        push_circle(
            &mut vertices,
            &mut indices,
            world.ball.position + shine_offset,
            world.ball.radius * 0.3,
            [1.0, 1.0, 1.0, 0.7],
            10,
        );

        // Score and lives display (simple bar indicators)
        render_hud(&mut vertices, &mut indices, score, lives);

        // Upload and draw
        let vertex_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Vertex Buffer"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let index_buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Index Buffer"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Render Encoder"),
        });

        {
            let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.02,
                            g: 0.02,
                            b: 0.08,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });

            rp.set_pipeline(&self.pipeline);
            rp.set_vertex_buffer(0, vertex_buffer.slice(..));
            rp.set_index_buffer(index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            rp.draw_indexed(0..indices.len() as u32, 0, 0..1);
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();
        Ok(())
    }
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

fn push_quad(
    verts: &mut Vec<Vertex>,
    inds: &mut Vec<u32>,
    min: Vec2,
    max: Vec2,
    color: [f32; 4],
) {
    let base = verts.len() as u32;
    verts.extend_from_slice(&[
        Vertex { position: [min.x, min.y], color },
        Vertex { position: [max.x, min.y], color },
        Vertex { position: [max.x, max.y], color },
        Vertex { position: [min.x, max.y], color },
    ]);
    inds.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
}

fn push_line_thick(
    verts: &mut Vec<Vertex>,
    inds: &mut Vec<u32>,
    a: Vec2,
    b: Vec2,
    thickness: f32,
    color: [f32; 4],
) {
    let dir = (b - a).normalize();
    let perp = Vec2::new(-dir.y, dir.x) * (thickness * 0.5);
    let base = verts.len() as u32;
    verts.extend_from_slice(&[
        Vertex { position: [a.x - perp.x, a.y - perp.y], color },
        Vertex { position: [a.x + perp.x, a.y + perp.y], color },
        Vertex { position: [b.x + perp.x, b.y + perp.y], color },
        Vertex { position: [b.x - perp.x, b.y - perp.y], color },
    ]);
    inds.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
}

fn push_circle(
    verts: &mut Vec<Vertex>,
    inds: &mut Vec<u32>,
    center: Vec2,
    radius: f32,
    color: [f32; 4],
    segments: usize,
) {
    let base = verts.len() as u32;
    // Center vertex
    verts.push(Vertex { position: [center.x, center.y], color });
    for i in 0..segments {
        let angle = (i as f32) / (segments as f32) * std::f32::consts::TAU;
        verts.push(Vertex {
            position: [center.x + angle.cos() * radius, center.y + angle.sin() * radius],
            color,
        });
    }
    for i in 0..segments as u32 {
        let next = (i + 1) % segments as u32;
        inds.extend_from_slice(&[base, base + 1 + i, base + 1 + next]);
    }
}

fn push_circle_ring(
    verts: &mut Vec<Vertex>,
    inds: &mut Vec<u32>,
    center: Vec2,
    radius: f32,
    thickness: f32,
    color: [f32; 4],
    segments: usize,
) {
    let outer = radius + thickness * 0.5;
    let inner = (radius - thickness * 0.5).max(0.0);
    let base = verts.len() as u32;
    for i in 0..segments {
        let angle = (i as f32) / (segments as f32) * std::f32::consts::TAU;
        let cos = angle.cos();
        let sin = angle.sin();
        verts.push(Vertex { position: [center.x + cos * inner, center.y + sin * inner], color });
        verts.push(Vertex { position: [center.x + cos * outer, center.y + sin * outer], color });
    }
    for i in 0..segments as u32 {
        let next = (i + 1) % segments as u32;
        let a = base + i * 2;
        let b = base + i * 2 + 1;
        let c = base + next * 2;
        let d = base + next * 2 + 1;
        inds.extend_from_slice(&[a, b, d, a, d, c]);
    }
}

/// Draw a simple pixel-art-style knight figure.
fn render_knight(verts: &mut Vec<Vertex>, inds: &mut Vec<u32>, knight: &Knight) {
    let p = knight.position;
    let bounce = if knight.is_celebrating() { 0.015 } else { 0.0 };

    // Body (torso)
    push_quad(verts, inds,
        Vec2::new(p.x - 0.03, p.y + 0.02 + bounce),
        Vec2::new(p.x + 0.03, p.y + 0.07 + bounce),
        [0.5, 0.5, 0.7, 1.0],
    );
    // Head (helmet)
    push_circle(verts, inds,
        Vec2::new(p.x, p.y + 0.09 + bounce),
        0.025, [0.6, 0.6, 0.7, 1.0], 12,
    );
    // Visor
    push_quad(verts, inds,
        Vec2::new(p.x - 0.015, p.y + 0.082 + bounce),
        Vec2::new(p.x + 0.015, p.y + 0.095 + bounce),
        [0.1, 0.1, 0.15, 1.0],
    );
    // Sword
    push_line_thick(verts, inds,
        Vec2::new(p.x + 0.03, p.y + 0.04 + bounce),
        Vec2::new(p.x + 0.08, p.y + 0.09 + bounce),
        0.006,
        [0.85, 0.85, 0.95, 1.0],
    );
    // Shield
    push_quad(verts, inds,
        Vec2::new(p.x - 0.06, p.y + 0.02 + bounce),
        Vec2::new(p.x - 0.03, p.y + 0.065 + bounce),
        [0.8, 0.2, 0.2, 1.0],
    );
    // Shield emblem (cross)
    push_line_thick(verts, inds,
        Vec2::new(p.x - 0.045, p.y + 0.025 + bounce),
        Vec2::new(p.x - 0.045, p.y + 0.060 + bounce),
        0.006,
        [0.9, 0.9, 0.2, 1.0],
    );
}

/// Render HUD: life indicators (hearts) and a score bar.
fn render_hud(verts: &mut Vec<Vertex>, inds: &mut Vec<u32>, score: u32, lives: u8) {
    // Life orbs along the bottom
    for i in 0..3u8 {
        let color = if i < lives {
            [0.9, 0.2, 0.2, 1.0]
        } else {
            [0.3, 0.1, 0.1, 1.0]
        };
        let cx = 0.13 + i as f32 * 0.055;
        push_circle(verts, inds, Vec2::new(cx, 0.03), 0.018, color, 12);
    }

    // Score bar
    let max_score_display = 5000.0_f32;
    let frac = (score as f32 / max_score_display).min(1.0);
    // Background
    push_quad(verts, inds,
        Vec2::new(0.40, 0.01),
        Vec2::new(0.90, 0.04),
        [0.1, 0.1, 0.2, 1.0],
    );
    // Fill
    if frac > 0.0 {
        push_quad(verts, inds,
            Vec2::new(0.40, 0.01),
            Vec2::new(0.40 + frac * 0.50, 0.04),
            [0.2, 0.8, 0.4, 1.0],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vertex_layout_size() {
        assert_eq!(std::mem::size_of::<Vertex>(), 24);
    }

    #[test]
    fn push_quad_generates_6_indices() {
        let mut verts = Vec::new();
        let mut inds = Vec::new();
        push_quad(&mut verts, &mut inds, Vec2::new(0.0, 0.0), Vec2::new(1.0, 1.0), [1.0; 4]);
        assert_eq!(verts.len(), 4);
        assert_eq!(inds.len(), 6);
    }

    #[test]
    fn push_circle_vertex_count() {
        let mut verts = Vec::new();
        let mut inds = Vec::new();
        push_circle(&mut verts, &mut inds, Vec2::new(0.5, 0.5), 0.1, [1.0; 4], 20);
        // 1 center + 20 rim = 21 vertices, 20 * 3 = 60 indices
        assert_eq!(verts.len(), 21);
        assert_eq!(inds.len(), 60);
    }
}
