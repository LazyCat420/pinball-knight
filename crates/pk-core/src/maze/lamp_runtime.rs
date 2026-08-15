//! Light Puzzle Runtime — Sealed vault chest, progressive brazier lighting, and payout dispatch.
//!
//! PORTS: `lamp-puzzle.ts`

pub const CHEST_UNLIT: u32 = 0x6b1f2a; // Dim blood-iron while sealed
pub const CHEST_LIT: u32 = 0xf0c040;   // Gold as braziers light
pub const CHEST_OPEN: u32 = 0xa050e0;  // Arcane portal-violet on open

#[derive(Clone, Debug, PartialEq)]
pub struct VaultChest {
    pub x: f64,
    pub z: f64,
    pub emissive_hex: u32,
    pub open: bool,
    pub sigil_rot_y: f64,
}

impl VaultChest {
    pub fn new(x: f64, z: f64) -> Self {
        Self {
            x,
            z,
            emissive_hex: CHEST_UNLIT,
            open: false,
            sigil_rot_y: 0.0,
        }
    }

    pub fn tick(&mut self, dt: f64) {
        if !self.open {
            self.sigil_rot_y += dt * 1.5;
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LampRuntimeState {
    pub total: usize,
    pub lit: usize,
    pub unlocked: bool,
    pub vault_coord: (usize, usize),
    pub chest: VaultChest,
    pub lit_mask: Vec<bool>,
}

impl LampRuntimeState {
    pub fn new(total: usize, vault_i: usize, vault_j: usize, vault_x: f64, vault_z: f64) -> Self {
        Self {
            total,
            lit: 0,
            unlocked: false,
            vault_coord: (vault_i, vault_j),
            chest: VaultChest::new(vault_x, vault_z),
            lit_mask: vec![false; total],
        }
    }

    /// Lights a brazier at `lamp_idx`. Returns `true` if this was a new lamp hit.
    /// If all lamps become lit, unlocks the chest and changes its emissive state.
    pub fn light_lamp(&mut self, idx: usize) -> bool {
        if idx >= self.total || self.lit_mask[idx] {
            return false;
        }

        self.lit_mask[idx] = true;
        self.lit += 1;

        if self.lit == self.total {
            self.unlocked = true;
            self.chest.open = true;
            self.chest.emissive_hex = CHEST_OPEN;
        } else {
            self.chest.emissive_hex = CHEST_LIT;
        }

        true
    }

    pub fn is_solved(&self) -> bool {
        self.unlocked
    }
}
