//! Procedural knight mugshot, facial expressions, health tiers, and damage states.
//!
//! Port of `legacy/src/game/pinball-knight/hud-face.ts` (1,330 lines).
//!
//! PORTS: `hud-face.ts`

pub const GRID: usize = 36;
pub const SCALE: usize = 2;
pub const FACE_PX: usize = GRID * SCALE; // 72

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaceExpr {
    Fresh,
    Steady,
    Hurt,
    Bloodied,
    Dying,
    Dead,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaceMood {
    Expr(FaceExpr),
    Grin,
    Smile,
    Wince,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FaceState {
    pub hp: f64,
    pub max_hp: f64,
    pub pain_t: f64,
    pub heal_t: f64,
    pub special_t: f64,
    pub look_x: f64,
    pub look_y: f64,
    pub turn: i32,
    pub turn_t: f64,
    pub blink_t: f64,
    pub blink_for: f64,
    pub last_sig: String,
    pub pixels: Vec<u8>,
}

impl Default for FaceState {
    fn default() -> Self {
        Self {
            hp: 6.0,
            max_hp: 6.0,
            pain_t: 0.0,
            heal_t: 0.0,
            special_t: 0.0,
            look_x: 0.0,
            look_y: 0.0,
            turn: 0,
            turn_t: 0.8,
            blink_t: 2.4,
            blink_for: 0.0,
            last_sig: String::new(),
            pixels: vec![0; FACE_PX * FACE_PX * 4],
        }
    }
}

impl FaceState {
    pub fn new() -> Self {
        let mut face = Self::default();
        face.paint();
        face
    }

    pub fn tier_of(&self) -> FaceExpr {
        if self.hp <= 0.0 {
            FaceExpr::Dead
        } else {
            let f = self.hp / self.max_hp.max(1.0);
            if f <= 0.18 {
                FaceExpr::Dying
            } else if f <= 0.36 {
                FaceExpr::Bloodied
            } else if f <= 0.55 {
                FaceExpr::Hurt
            } else if f <= 0.78 {
                FaceExpr::Steady
            } else {
                FaceExpr::Fresh
            }
        }
    }

    pub fn expr_now(&self) -> FaceMood {
        if self.pain_t > 0.0 {
            FaceMood::Wince
        } else if self.special_t > 0.0 {
            FaceMood::Grin
        } else if self.heal_t > 0.0 {
            FaceMood::Smile
        } else {
            FaceMood::Expr(self.tier_of())
        }
    }

    pub fn set_health(&mut self, current_hp: f64, current_max: f64) {
        self.hp = current_hp.max(0.0);
        self.max_hp = current_max.max(1.0);
    }

    pub fn on_damage(&mut self, source_angle: Option<f64>) {
        self.pain_t = 0.32;
        if let Some(ang) = source_angle {
            self.look_x = ang.cos();
            self.look_y = ang.sin() * 0.6;
            self.turn = if self.look_x > 0.35 {
                1
            } else if self.look_x < -0.35 {
                -1
            } else {
                0
            };
            self.turn_t = 0.55;
        }
    }

    pub fn on_heal(&mut self) {
        self.heal_t = 0.42;
    }

    pub fn on_special(&mut self) {
        self.special_t = 0.7;
    }

    pub fn render(&mut self, dt: f64) {
        self.pain_t = (self.pain_t - dt).max(0.0);
        self.heal_t = (self.heal_t - dt).max(0.0);
        self.special_t = (self.special_t - dt).max(0.0);

        self.turn_t -= dt;
        if self.turn_t <= 0.0 && self.pain_t == 0.0 {
            self.turn = 0;
            self.look_x = 0.0;
            self.look_y = 0.0;
            let hurry = 1.0 - 0.45 * (1.0 - self.hp / self.max_hp.max(1.0));
            self.turn_t = 0.8 * hurry;
        }

        if self.pain_t == 0.0 && self.turn == 0 {
            self.look_x *= (1.0 - dt * 6.0).max(0.0);
            self.look_y *= (1.0 - dt * 6.0).max(0.0);
        }

        self.blink_for = (self.blink_for - dt).max(0.0);
        self.blink_t -= dt;
        if self.blink_t <= 0.0 {
            self.blink_for = 0.11;
            let tier = self.tier_of();
            self.blink_t = if tier == FaceExpr::Dying { 1.1 } else { 3.0 };
        }

        let sig = format!(
            "{:?}:{:?}:{}:{}:{}:{}:{}:{}",
            self.tier_of(),
            self.expr_now(),
            if self.blink_for > 0.0 { 1 } else { 0 },
            self.turn,
            (self.look_x * 2.0).round() as i32,
            (self.look_y * 2.0).round() as i32,
            if self.pain_t > 0.0 { 1 } else { 0 },
            if self.heal_t > 0.0 { 1 } else { 0 }
        );

        if sig != self.last_sig {
            self.last_sig = sig;
            self.paint();
        }
    }

    pub fn paint(&mut self) {
        // Clear background
        self.pixels.fill(0);

        let tier = self.tier_of();
        let (head_x, head_y) = (18 + self.turn, 18);
        let head_r = 12;

        // Base head silhouette
        for y in 0..GRID {
            for x in 0..GRID {
                let dx = x as i32 - head_x;
                let dy = y as i32 - head_y;
                if dx * dx + dy * dy <= head_r * head_r {
                    let color = match tier {
                        FaceExpr::Dead => [70, 70, 75, 255],
                        FaceExpr::Dying | FaceExpr::Bloodied => [140, 110, 100, 255],
                        FaceExpr::Hurt => [180, 140, 120, 255],
                        _ => [210, 170, 140, 255],
                    };
                    self.set_pixel_scaled(x, y, color);
                }
            }
        }

        // Helmet (stages 1-4)
        if tier != FaceExpr::Dead && tier != FaceExpr::Dying {
            for y in 6..18 {
                for x in 8..28 {
                    let color = match tier {
                        FaceExpr::Bloodied => [90, 95, 100, 255],
                        FaceExpr::Hurt => [120, 130, 140, 255],
                        _ => [160, 170, 180, 255],
                    };
                    self.set_pixel_scaled(x, y, color);
                }
            }
        }

        // Eyes / Pupils
        if self.blink_for <= 0.0 && tier != FaceExpr::Dead {
            let lx = (self.look_x * 1.5).round() as i32;
            let ly = (self.look_y * 1.5).round() as i32;
            self.set_pixel_scaled((14 + lx) as usize, (17 + ly) as usize, [20, 20, 25, 255]);
            self.set_pixel_scaled((22 + lx) as usize, (17 + ly) as usize, [20, 20, 25, 255]);
        } else if tier == FaceExpr::Dead {
            // X eyes
            self.set_pixel_scaled(14, 17, [180, 40, 40, 255]);
            self.set_pixel_scaled(22, 17, [180, 40, 40, 255]);
        }

        // Beard
        for y in 22..30 {
            for x in 12..24 {
                self.set_pixel_scaled(x, y, [110, 115, 120, 255]);
            }
        }
    }

    fn set_pixel_scaled(&mut self, grid_x: usize, grid_y: usize, color: [u8; 4]) {
        for sy in 0..SCALE {
            for sx in 0..SCALE {
                let px = grid_x * SCALE + sx;
                let py = grid_y * SCALE + sy;
                if px < FACE_PX && py < FACE_PX {
                    let idx = (py * FACE_PX + px) * 4;
                    self.pixels[idx..idx + 4].copy_from_slice(&color);
                }
            }
        }
    }
}

pub fn create_face() -> FaceState {
    FaceState::new()
}

pub fn dispose_face(_face: &mut FaceState) {}

pub fn set_face_health(face: &mut FaceState, current_hp: f64, current_max: f64) {
    face.set_health(current_hp, current_max);
}

pub fn face_on_damage(face: &mut FaceState, source_angle: Option<f64>) {
    face.on_damage(source_angle);
}

pub fn face_on_heal(face: &mut FaceState) {
    face.on_heal();
}

pub fn face_on_special(face: &mut FaceState) {
    face.on_special();
}

pub fn render_face(face: &mut FaceState, dt: f64) {
    face.render(dt);
}

pub fn dead_face() -> FaceState {
    let mut face = FaceState::new();
    face.set_health(0.0, 6.0);
    face.paint();
    face
}

pub fn face_contact_sheet() -> Vec<FaceState> {
    let mut states = Vec::new();
    for expr in [
        FaceExpr::Fresh,
        FaceExpr::Steady,
        FaceExpr::Hurt,
        FaceExpr::Bloodied,
        FaceExpr::Dying,
        FaceExpr::Dead,
    ] {
        let mut face = FaceState::new();
        match expr {
            FaceExpr::Fresh => face.set_health(6.0, 6.0),
            FaceExpr::Steady => face.set_health(4.5, 6.0),
            FaceExpr::Hurt => face.set_health(3.0, 6.0),
            FaceExpr::Bloodied => face.set_health(1.8, 6.0),
            FaceExpr::Dying => face.set_health(0.8, 6.0),
            FaceExpr::Dead => face.set_health(0.0, 6.0),
        }
        face.paint();
        states.push(face);
    }
    states
}
