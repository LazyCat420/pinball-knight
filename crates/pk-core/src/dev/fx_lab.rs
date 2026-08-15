//! FX LAB — Developer inspection harness for elemental decals, shaders, and visual clock controls.
//!
//! PORTS: `dev/fx-lab.ts`

pub const LAB_LIFE: f64 = 999.0;
pub const LAB_RADIUS: f64 = 1.2;

pub const FX_ROSTER: &[&str] = &[
    "fire",
    "slick",
    "frost",
    "poison",
    "holy",
    "lightning",
    "sludge",
];

#[derive(Clone, Debug, PartialEq)]
pub struct FxLabDecal {
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub radius: f64,
    pub life: f64,
    pub hostile: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FxLabState {
    pub decals: Vec<FxLabDecal>,
    pub clock_frozen: bool,
}

impl FxLabState {
    pub fn new() -> Self {
        Self {
            decals: Vec::new(),
            clock_frozen: false,
        }
    }

    pub fn roster(&self) -> Vec<&'static str> {
        FX_ROSTER.to_vec()
    }

    pub fn is_valid_kind(&self, kind: &str) -> bool {
        FX_ROSTER.contains(&kind)
    }

    /// Spawns a decal at a relative player offset.
    pub fn spawn(&mut self, kind: &str, dx: f64, dz: f64) -> Result<usize, String> {
        if !self.is_valid_kind(kind) {
            return Err(format!("Unknown FX kind: {}", kind));
        }
        self.decals.push(FxLabDecal {
            kind: kind.to_string(),
            x: dx,
            z: dz,
            radius: LAB_RADIUS,
            life: LAB_LIFE,
            hostile: false,
        });
        Ok(self.decals.len())
    }

    /// Creates a fixed lattice grid with one of every decal kind for contact-sheet inspection.
    pub fn grid(&mut self) -> usize {
        self.decals.clear();
        for (i, &kind) in FX_ROSTER.iter().enumerate() {
            let row = (i / 3) as f64;
            let col = (i % 3) as f64;
            self.decals.push(FxLabDecal {
                kind: kind.to_string(),
                x: (col - 1.0) * 3.0,
                z: (row - 1.0) * 3.0,
                radius: LAB_RADIUS,
                life: LAB_LIFE,
                hostile: false,
            });
        }
        self.decals.len()
    }

    /// Spawns two decal kinds side by side for direct hue/value comparison.
    pub fn pair(&mut self, kind_a: &str, kind_b: &str) -> Result<(), String> {
        if !self.is_valid_kind(kind_a) || !self.is_valid_kind(kind_b) {
            return Err("Invalid FX kind in pair request".to_string());
        }
        self.decals.clear();
        self.spawn(kind_a, -1.5, 0.0)?;
        self.spawn(kind_b, 1.5, 0.0)?;
        Ok(())
    }

    pub fn freeze(&mut self) {
        self.clock_frozen = true;
    }

    pub fn thaw(&mut self) {
        self.clock_frozen = false;
    }

    pub fn clear(&mut self) {
        self.decals.clear();
    }
}
