# Chapter 18 — TS-to-Rust/WebGPU Conversion Blueprint

**Status: `IN PROGRESS` (2026-08-10)** · Produces: Full architecture roadmap for porting `braindeadbot-client` / `legacy` to native Rust & WebGPU in `pinball-knight`.

> **Executive Summary**: This blueprint documents the step-by-step technical conversion path from the legacy TypeScript/React/Three.js prototype (`braindeadbot-client`) to the production Rust workspace (`pinball-knight`), built on **Bevy ECS**, **Rapier3D**, and custom **WebGPU/WGSL shaders**.

---

## 1. Workspace Architecture & Crate Responsibilities

The Rust architecture in `pinball-knight` replaces the monolithic frontend with decoupled, performance-focused crates:

```
pinball-knight/
├── Cargo.toml                     # Workspace manifest
├── assets/                        # Target baked assets directory
│   ├── gui/                       # Rasterised UI fonts & icons
│   ├── sprites/                   # Multi-rung baked atlas pages & manifests
│   └── tavern/                    # Keeper art & tavern meshes
├── crates/
│   ├── pk-assets/                 # Asset schema parser & runtime atlas loader
│   ├── pk-game/                   # Main Bevy ECS game loop, input, physics, state
│   └── pk-render/                 # WebGPU / WGSL custom render pipelines & shaders
├── legacy/                        # Legacy TypeScript prototype & sprite-forge
├── scripts/                       # Windows runner & cross-compilation scripts
└── xtask/                         # Workspace task automation (`cargo xtask`)
```

---

## 2. Phase 1: Asset Baking & Sprite Atlas Pipeline

### 2.1 The Asset Contract (`pk-assets`)
The legacy TypeScript prototype uses runtime palette crushing per camera rung. In the Rust engine, `cargo xtask bake` pre-packs and pre-crushes all sprite sheets into static camera rungs (120, 108, 96, 84, 72 texels):

- **Published Input**: `legacy/public/sprites/<name>-<dir>.json` and `<name>-<dir>.png`.
- **Baked Target**: `assets/sprites/rung-<N>/manifest.json` + atlas page PNGs.

```rust
// Contract defined in crates/pk-assets/src/lib.rs
pub mod baked {
    #[derive(Debug, Clone, Serialize, Deserialize)]
    pub struct RungManifest {
        pub version: u32,
        pub rung: u32,
        pub pages: Vec<String>,
        pub sprites: BTreeMap<String, BTreeMap<String, BTreeMap<String, Vec<Frame>>>>,
        pub palettes: BTreeMap<String, Vec<String>>,
    }
}
```

### 2.2 Monster Reskin Palette Shaders
 Tint variants (e.g. `warden` as a tinted `brute` reskin, or `webspinner` as an acid-tinted `spider`) do not duplicate texture memory. The WebGPU render pipeline performs palette swaps in the fragment shader using `palettes` tables stored in `RungManifest`.

---

## 3. Phase 2: Physics Engine & Pinball Table Mechanics

The physics pipeline converts Rapier3D TypeScript bindings to native Rust Rapier3D in `crates/pk-game/src/physics.rs`:

| Pinball Mechanics | Legacy TS Implementation | Rust / Bevy ECS Target |
|---|---|---|
| **Marble Ball Physics** | `rapier3d-compat` RigidBody | `pk-game` Physics Plugin (`RigidBody::Dynamic`, `Collider::ball`) |
| **Flippers** | `RevoluteJoint` + spring impulse | `ImpulseJoint` + motor velocity control (`joint.set_motor_velocity`) |
| **Plunger / Spring** | Manual position lerp + impulse | `RigidBody::KinematicPositionBased` + spring release impulse |
| **Bumpers & Kickers** | Restitution collision triggers | `CollisionEvent::Started` event handler applying radial impulse |
| **Drop Targets** | Mesh visibility toggle + sensor | `Sensor` colliders toggling active mesh rendering & score events |
| **Glass Fracture** | `bake-glass-fracture.mjs` pre-baked mesh | Custom instanced fracture particle mesh in `pk-render` |

---

## 4. Phase 3: Bestiary & Spawning Engine

### 4.1 Roster Migration Roadmap
All 14 base monsters + 8 expansion kinds are mapped into strongly typed Rust enums:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EnemyKind {
    Zombie, Spider, Brute, Spitter, Ghost, Bat, Slime, Reaper,
    Goblin, Pin, Golem, Chomper, Sporeling, Jester, Croaker,
    Rotortail, Stiltneck, FishFeet, Magnet, Webspinner,
    // Expansion roster
    Hound, Bloater, Necromancer, Warden, Wisp, Sapper, Crystalback, Mimic,
}
```

### 4.2 Spawning & Loot Flow
1. **Spawn Factory**: `crates/pk-game/src/enemy.rs` spawns enemy entities with `Transform`, `Velocity`, `Health`, `AnimationState`, and `EnemyKind`.
2. **Loot Drops**: On enemy death, `drop_reagents` and `drop_cards` evaluate drop probabilities:
   - *Spider* → Silk + Fang
   - *Zombie* → Rotflesh
   - *Golem* → Ironshard
   - *Reaper* → Grimbone

---

## 5. Phase 4: WebGPU WGSL Render Pipeline

The custom renderer in `crates/pk-render` replaces Three.js with pure WGSL shaders executing directly on WebGPU / Vulkan:

```wgsl
// Shading parameters in WGSL cel-shader pipeline:
// cel = 1.0, steps = 10.0, curve = 0.5, saturation = 1.15, bloom = 0.90
struct CelParams {
    steps: f32,
    curve: f32,
    saturation: f32,
    bloom_intensity: f32,
};
```

1. **Cel Shader Pass**: Hard-stop gradient bands with cool-shifted SELOUT outlines (`inkFor`).
2. **Bloom & Post Processing**: `Rgba16Float` HDR buffer downsampled into a bloom pyramid with vignette.
3. **Particle Instancer**: GPU instanced rendering for damage numbers, swoosh arcs, and muzzle flashes.

---

## 6. Phase 5: Tavern & UI Systems

1. **Tavern Keepers**: Exported via `cargo xtask bake --tavern` into `assets/tavern/`.
2. **Bestiary Card UI**: Interactive holo-cards with 3D card tilt and rarity shimmer rendered via WebGPU card mesh shaders.
3. **HUD Readout**: Bevy UI text pipeline using custom vendored retro fonts rasterised by `cargo xtask bake --gui-font`.

---

## 7. Migration Checklist & Progress

- [x] **M0: Skeleton**: Cross-platform windowing, cross-compilation target (`x86_64-pc-windows-gnullvm`), WebGPU clear pass (`pk-game`).
- [x] **M1: Asset Engine**: `pk-assets` schema parsing and legacy manifest loading.
- [ ] **M2: Pinball Physics**: Port table colliders, flippers, and marble physics to Rapier3D Rust.
- [ ] **M3: Bestiary & AI**: Port 14 base monster animation state machines & spawning factory.
- [ ] **M4: WGSL Renderer**: Cel-shading pass, SELOUT outlines, and post-processing bloom.
- [ ] **M5: Tavern & Cards**: Complete UI deck builder and tavern shop.
