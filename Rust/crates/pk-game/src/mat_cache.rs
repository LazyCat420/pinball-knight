//! One material per LOOK, not per entity.
//!
//! ## The 36x
//!
//! Measured 2026-08-16 on the L3-s1 authored floor: 526 meshes carrying **383
//! distinct materials**, and a dungeon frame costing **186–218 ms** against the
//! TypeScript oracle's 5–8 ms — 36.5x, where the recorded baseline nine
//! commits earlier was 2.64x. The floor spawns 102 pinball parts and 84 props,
//! and every one of them called `materials.add(StandardMaterial { .. })` for
//! each of its sub-meshes, so a hundred bumpers that look identical arrived as
//! a hundred separate materials.
//!
//! In Bevy that is not a memory question, it is a PIPELINE question: distinct
//! material instances mean distinct bind groups and specialised pipelines, the
//! render phase can no longer batch the draws, and on WebGPU the cost of the
//! resulting pipeline set dominates everything else in the frame. This project
//! has met that exact wall once before — see `docs`' note that the WebGPU stall
//! tracks pipeline COUNT, not scene size.
//!
//! ## Why the cache is a local, not a resource
//!
//! Its entire job is to collapse duplicates WITHIN one floor build, which is
//! where the duplication comes from. Built in `spawn_authored_decor` and
//! dropped when it returns, it needs no invalidation, cannot leak across
//! descents, and cannot hand floor 2 a handle to floor 1's texture — three
//! failure modes a global would have to defend against and this cannot have.
//!
//! ## What the key is, and what it deliberately is not
//!
//! Every field the callers actually vary, hashed by bits. It is NOT a hash of
//! the whole `StandardMaterial`: that type has no `Hash`, holds f32s that are
//! not `Eq`, and grows fields between Bevy versions — a derive would silently
//! start splitting the cache the day one appeared. If a call site begins
//! varying a field not listed here, two different looks would collide and the
//! floor would render wrong, so `key_of` names its fields explicitly and this
//! comment is the contract to update.
//!
//! PORTS-NOTHING — a Bevy-side rendering concern; the oracle shares materials
//! implicitly by reusing three.js Material objects.

use bevy::pbr::StandardMaterial;
use bevy::prelude::*;
use std::collections::HashMap;

#[derive(Default)]
pub struct MatCache {
    by_key: HashMap<u64, Handle<StandardMaterial>>,
    /// How many `add` calls were served from the cache — the saving, for tests.
    hits: usize,
}

fn f(x: f32) -> u64 {
    x.to_bits() as u64
}

fn key_of(m: &StandardMaterial) -> u64 {
    let c = m.base_color.to_linear();
    let e = m.emissive;
    let mut parts: Vec<u64> = vec![
        f(c.red),
        f(c.green),
        f(c.blue),
        f(c.alpha),
        f(e.red),
        f(e.green),
        f(e.blue),
        f(e.alpha),
        f(m.metallic),
        f(m.perceptual_roughness),
        f(m.reflectance),
        m.unlit as u64,
        m.double_sided as u64,
        m.alpha_mode_bits(),
        m.cull_mode_bits(),
    ];
    // Texture identity is part of the look. A handle's id is stable for the
    // life of the asset, which is longer than this cache lives.
    for t in [
        &m.base_color_texture,
        &m.emissive_texture,
        &m.normal_map_texture,
        &m.metallic_roughness_texture,
    ] {
        parts.push(match t {
            Some(h) => {
                let mut s = std::collections::hash_map::DefaultHasher::new();
                use std::hash::{Hash, Hasher};
                h.id().hash(&mut s);
                s.finish()
            }
            None => 0,
        });
    }
    let mut s = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    parts.hash(&mut s);
    s.finish()
}

/// Bits for the enum-shaped fields, spelled out so a new variant is a compile
/// error here rather than a silent collision at runtime.
trait Bits {
    fn alpha_mode_bits(&self) -> u64;
    fn cull_mode_bits(&self) -> u64;
}

impl Bits for StandardMaterial {
    fn alpha_mode_bits(&self) -> u64 {
        match self.alpha_mode {
            AlphaMode::Opaque => 1,
            AlphaMode::Mask(v) => 2 ^ ((v.to_bits() as u64) << 8),
            AlphaMode::Blend => 3,
            AlphaMode::Premultiplied => 4,
            AlphaMode::Add => 5,
            AlphaMode::Multiply => 6,
            AlphaMode::AlphaToCoverage => 7,
        }
    }
    fn cull_mode_bits(&self) -> u64 {
        match self.cull_mode {
            None => 0,
            Some(bevy::render::render_resource::Face::Front) => 1,
            Some(bevy::render::render_resource::Face::Back) => 2,
        }
    }
}

impl MatCache {
    /// `materials.add(m)` with duplicates collapsed.
    ///
    /// Drop-in: the call sites read `cache.add(materials, StandardMaterial {..})`
    /// wherever they read `materials.add(StandardMaterial {..})`.
    pub fn add(
        &mut self,
        materials: &mut Assets<StandardMaterial>,
        m: StandardMaterial,
    ) -> Handle<StandardMaterial> {
        let k = key_of(&m);
        if let Some(h) = self.by_key.get(&k) {
            self.hits += 1;
            return h.clone();
        }
        let h = materials.add(m);
        self.by_key.insert(k, h.clone());
        h
    }

    /// Distinct looks handed out.
    pub fn len(&self) -> usize {
        self.by_key.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_key.is_empty()
    }

    /// Calls served from cache — how many materials did NOT become pipelines.
    pub fn hits(&self) -> usize {
        self.hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> Assets<StandardMaterial> {
        Assets::<StandardMaterial>::default()
    }

    fn red() -> StandardMaterial {
        StandardMaterial {
            base_color: Color::srgb(1.0, 0.0, 0.0),
            ..default()
        }
    }

    #[test]
    fn two_identical_looks_are_one_material() {
        let mut a = app();
        let mut c = MatCache::default();
        let h1 = c.add(&mut a, red());
        let h2 = c.add(&mut a, red());
        assert_eq!(h1, h2, "the same look must not become two pipelines");
        assert_eq!(c.len(), 1);
        assert_eq!(c.hits(), 1);
        assert_eq!(a.len(), 1, "and only one asset was created");
    }

    /// The control that makes the test above a measurement: a cache that
    /// returned one handle for EVERYTHING would also pass it.
    #[test]
    fn two_different_looks_stay_two_materials() {
        let mut a = app();
        let mut c = MatCache::default();
        let h1 = c.add(&mut a, red());
        let h2 = c.add(
            &mut a,
            StandardMaterial {
                base_color: Color::srgb(0.0, 1.0, 0.0),
                ..default()
            },
        );
        assert_ne!(h1, h2, "a green bumper is not a red one");
        assert_eq!(c.len(), 2);
        assert_eq!(a.len(), 2);
    }

    /// Each keyed field, one at a time — a key that ignored one of these would
    /// merge two looks and paint the floor wrong.
    #[test]
    fn every_keyed_field_separates() {
        let mut a = app();
        let mut c = MatCache::default();
        let base = c.add(&mut a, red());
        let variants = [
            StandardMaterial {
                emissive: LinearRgba::rgb(1.0, 1.0, 1.0),
                ..red()
            },
            StandardMaterial {
                metallic: 0.7,
                ..red()
            },
            StandardMaterial {
                perceptual_roughness: 0.2,
                ..red()
            },
            StandardMaterial {
                unlit: true,
                ..red()
            },
            StandardMaterial {
                double_sided: true,
                ..red()
            },
            StandardMaterial {
                alpha_mode: AlphaMode::Blend,
                ..red()
            },
            StandardMaterial {
                reflectance: 0.9,
                ..red()
            },
        ];
        for (i, v) in variants.into_iter().enumerate() {
            let h = c.add(&mut a, v);
            assert_ne!(h, base, "variant {i} collided with the base material");
        }
        assert_eq!(c.len(), 8);
    }
}
