//! Named Depth Biomes — Rotational descent progression, lighting color grades, and chapter flavour strings.
//!
//! PORTS: `boot/biomes.ts`

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Biome {
    pub name: &'static str,
    pub flavour: &'static str,
    pub amb: u32,
    pub sky: u32,
    pub ground: u32,
}

pub const BIOMES: [Biome; 4] = [
    Biome {
        name: "The Cold Crypt",
        flavour: "damp stone · the dead stir",
        amb: 0x6b7d99,
        sky: 0x8fa3bd,
        ground: 0x1e2430,
    },
    Biome {
        name: "The Rotting Warren",
        flavour: "moss and marrow · things breed here",
        amb: 0x6d8a78,
        sky: 0x8fbda6,
        ground: 0x1e2a22,
    },
    Biome {
        name: "The Bloodworks",
        flavour: "the walls weep red · tread carefully",
        amb: 0x8a6f74,
        sky: 0xbd949a,
        ground: 0x2a1e20,
    },
    Biome {
        name: "The Arcane Deep",
        flavour: "cold light · something old is awake",
        amb: 0x6f74a0,
        sky: 0x97a0e0,
        ground: 0x1e2233,
    },
];

/// Identical to pk-core maze prefabs theme_index_for.
pub fn theme_index_for(level: u32, run_seed: u32) -> usize {
    ((level.saturating_sub(1) as usize) + ((run_seed as usize) % 4)) % 4
}

/// The biome for a given depth, 1:1 paired with theme index and run seed shuffle.
pub fn biome_for(level: u32, run_seed: u32) -> &'static Biome {
    &BIOMES[theme_index_for(level, run_seed)]
}
