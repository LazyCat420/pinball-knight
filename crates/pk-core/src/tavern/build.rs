//! Tavern Room Shell Geometry — Floor, timber spine, stone walls, hearth, and stairs.
//!
//! PORTS: `legacy/src/scenes/tavern/build.ts`

pub const STONE_DK: u8 = 1;
pub const STONE: u8 = 2;
pub const TIMBER: u8 = 26;
pub const TIMBER_DK: u8 = 27;
pub const FLAME: u8 = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TavernBox {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
    pub h: f64,
    pub d: f64,
    pub palette_idx: u8,
}

impl TavernBox {
    pub const fn new(x: f64, y: f64, z: f64, w: f64, h: f64, d: f64, palette_idx: u8) -> Self {
        Self {
            x,
            y,
            z,
            w,
            h,
            d,
            palette_idx,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BuiltTavernRoom {
    pub boxes: Vec<TavernBox>,
    pub fire_pos: (f64, f64, f64),
    pub stairs_pos: (f64, f64, f64),
}

/// Builds the bounding volume boxes for the tavern sanctuary room shell.
pub fn build_tavern_room() -> BuiltTavernRoom {
    let mut boxes = Vec::new();

    // 1. Floor: 16.0 x 12.0 dark timber
    boxes.push(TavernBox::new(0.0, -0.1, 0.0, 16.0, 0.2, 12.0, TIMBER_DK));

    // 2. Floor central spine inlay: 2.0 x 10.0 timber
    boxes.push(TavernBox::new(0.0, -0.05, 0.0, 2.0, 0.1, 10.0, TIMBER));

    // 3. Walls: 4.0m height stone
    // North wall (back)
    boxes.push(TavernBox::new(0.0, 2.0, -6.0, 16.0, 4.0, 0.5, STONE_DK));
    // South wall (front entrance)
    boxes.push(TavernBox::new(0.0, 2.0, 6.0, 16.0, 4.0, 0.5, STONE_DK));
    // West wall
    boxes.push(TavernBox::new(-8.0, 2.0, 0.0, 0.5, 4.0, 12.0, STONE));
    // East wall
    boxes.push(TavernBox::new(8.0, 2.0, 0.0, 0.5, 4.0, 12.0, STONE));

    // 4. Fireplace & Chimney
    // Chimney column against north wall
    boxes.push(TavernBox::new(0.0, 2.0, -5.5, 3.0, 4.0, 1.0, STONE));
    // Mantle piece
    boxes.push(TavernBox::new(0.0, 1.5, -5.0, 3.4, 0.2, 0.6, TIMBER));
    // Glowing ember hearth bed
    boxes.push(TavernBox::new(0.0, 0.1, -5.2, 2.0, 0.2, 0.8, FLAME));

    // 5. Stairs leading back down to dungeon (southeast corner)
    for i in 0..4 {
        let step_y = (3 - i) as f64 * 0.25;
        let step_z = 3.5 + (i as f64 * 0.5);
        boxes.push(TavernBox::new(6.0, step_y, step_z, 2.0, 0.25, 0.5, STONE));
    }

    BuiltTavernRoom {
        boxes,
        fire_pos: (0.0, 0.5, -5.2),
        stairs_pos: (6.0, 0.0, 4.5),
    }
}
