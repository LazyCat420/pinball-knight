/// 2D vector math helpers
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0 }
    }

    pub fn length(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub fn normalize(self) -> Self {
        let len = self.length();
        if len < 1e-6 {
            self
        } else {
            Self {
                x: self.x / len,
                y: self.y / len,
            }
        }
    }

    pub fn dot(self, other: Vec2) -> f32 {
        self.x * other.x + self.y * other.y
    }

    pub fn reflect(self, normal: Vec2) -> Self {
        self - normal * (2.0 * self.dot(normal))
    }
}

impl std::ops::Add for Vec2 {
    type Output = Vec2;
    fn add(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl std::ops::Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, rhs: Vec2) -> Vec2 {
        Vec2::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl std::ops::Mul<f32> for Vec2 {
    type Output = Vec2;
    fn mul(self, rhs: f32) -> Vec2 {
        Vec2::new(self.x * rhs, self.y * rhs)
    }
}

impl std::ops::AddAssign for Vec2 {
    fn add_assign(&mut self, rhs: Vec2) {
        self.x += rhs.x;
        self.y += rhs.y;
    }
}

/// The pinball
pub struct Ball {
    pub position: Vec2,
    pub velocity: Vec2,
    pub radius: f32,
}

impl Ball {
    pub fn new(x: f32, y: f32) -> Self {
        Self {
            position: Vec2::new(x, y),
            velocity: Vec2::new(0.0, -4.0),
            radius: 0.035,
        }
    }

    /// Integrate one physics step with gravity and damping.
    pub fn update(&mut self, dt: f32) {
        const GRAVITY: f32 = 9.8;
        const DAMPING: f32 = 0.998;
        self.velocity.y -= GRAVITY * dt;
        self.velocity = self.velocity * DAMPING;
        self.position += self.velocity * dt;
    }
}

/// Flipper orientation
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum FlipperSide {
    Left,
    Right,
}

/// A flipper paddle
pub struct Flipper {
    /// Pivot position in normalised [0,1]² screen space
    pub pivot: Vec2,
    pub side: FlipperSide,
    pub length: f32,
    /// Current angle in radians (0 = resting, positive = raised)
    pub angle: f32,
    pub rest_angle: f32,
    pub active_angle: f32,
    pub active: bool,
}

impl Flipper {
    pub fn new_left(x: f32, y: f32) -> Self {
        Self {
            pivot: Vec2::new(x, y),
            side: FlipperSide::Left,
            length: 0.22,
            angle: -0.45,
            rest_angle: -0.45,
            active_angle: 0.35,
            active: false,
        }
    }

    pub fn new_right(x: f32, y: f32) -> Self {
        Self {
            pivot: Vec2::new(x, y),
            side: FlipperSide::Right,
            length: 0.22,
            angle: std::f32::consts::PI + 0.45,
            rest_angle: std::f32::consts::PI + 0.45,
            active_angle: std::f32::consts::PI - 0.35,
            active: false,
        }
    }

    pub fn update(&mut self, dt: f32) {
        let target = if self.active {
            self.active_angle
        } else {
            self.rest_angle
        };
        let speed = 15.0_f32;
        let diff = target - self.angle;
        if diff.abs() < speed * dt {
            self.angle = target;
        } else {
            self.angle += diff.signum() * speed * dt;
        }
    }

    /// Returns the tip position of the flipper.
    pub fn tip(&self) -> Vec2 {
        Vec2::new(
            self.pivot.x + self.angle.cos() * self.length,
            self.pivot.y + self.angle.sin() * self.length,
        )
    }

    /// Closest point on the flipper line segment to a given point.
    pub fn closest_point(&self, p: Vec2) -> (Vec2, f32) {
        let tip = self.tip();
        let ab = tip - self.pivot;
        let ap = p - self.pivot;
        let t = (ap.dot(ab) / ab.dot(ab)).clamp(0.0, 1.0);
        let closest = Vec2::new(
            self.pivot.x + ab.x * t,
            self.pivot.y + ab.y * t,
        );
        let dist = (p - closest).length();
        (closest, dist)
    }
}

/// A circular bumper
pub struct Bumper {
    pub position: Vec2,
    pub radius: f32,
    pub lit_timer: f32,
    pub points: u32,
}

impl Bumper {
    pub fn new(x: f32, y: f32, points: u32) -> Self {
        Self {
            position: Vec2::new(x, y),
            radius: 0.06,
            lit_timer: 0.0,
            points,
        }
    }

    pub fn update(&mut self, dt: f32) {
        if self.lit_timer > 0.0 {
            self.lit_timer -= dt;
        }
    }

    pub fn is_lit(&self) -> bool {
        self.lit_timer > 0.0
    }
}

/// A wall segment (line)
pub struct Wall {
    pub a: Vec2,
    pub b: Vec2,
}

impl Wall {
    pub fn new(ax: f32, ay: f32, bx: f32, by: f32) -> Self {
        Self {
            a: Vec2::new(ax, ay),
            b: Vec2::new(bx, by),
        }
    }

    /// Returns the outward-facing normal of this wall.
    pub fn normal(&self) -> Vec2 {
        let dir = self.b - self.a;
        Vec2::new(-dir.y, dir.x).normalize()
    }

    pub fn closest_point(&self, p: Vec2) -> (Vec2, f32) {
        let ab = self.b - self.a;
        let ap = p - self.a;
        let t = (ap.dot(ab) / ab.dot(ab)).clamp(0.0, 1.0);
        let closest = Vec2::new(
            self.a.x + ab.x * t,
            self.a.y + ab.y * t,
        );
        let dist = (p - closest).length();
        (closest, dist)
    }
}

/// Knight character — visual only, sits at the bottom of the table
pub struct Knight {
    pub position: Vec2,
    /// celebration animation timer
    pub celebrate_timer: f32,
}

impl Knight {
    pub fn new(x: f32, y: f32) -> Self {
        Self {
            position: Vec2::new(x, y),
            celebrate_timer: 0.0,
        }
    }

    pub fn celebrate(&mut self) {
        self.celebrate_timer = 0.5;
    }

    pub fn update(&mut self, dt: f32) {
        if self.celebrate_timer > 0.0 {
            self.celebrate_timer -= dt;
        }
    }

    pub fn is_celebrating(&self) -> bool {
        self.celebrate_timer > 0.0
    }
}

/// Physics world: runs collision detection and resolution.
pub struct PhysicsWorld {
    pub ball: Ball,
    pub flippers: [Flipper; 2],
    pub bumpers: Vec<Bumper>,
    pub walls: Vec<Wall>,
    pub knight: Knight,
    pub score: u32,
    pub lives: u8,
    pub ball_lost: bool,
}

impl PhysicsWorld {
    pub fn new() -> Self {
        let walls = vec![
            // Left wall
            Wall::new(0.05, 0.0, 0.05, 1.0),
            // Right wall
            Wall::new(0.95, 0.0, 0.95, 1.0),
            // Top wall
            Wall::new(0.05, 0.98, 0.95, 0.98),
            // Left lower guide
            Wall::new(0.05, 0.30, 0.28, 0.12),
            // Right lower guide
            Wall::new(0.95, 0.30, 0.72, 0.12),
        ];

        let bumpers = vec![
            Bumper::new(0.35, 0.72, 100),
            Bumper::new(0.65, 0.72, 100),
            Bumper::new(0.50, 0.82, 150),
            Bumper::new(0.30, 0.58, 75),
            Bumper::new(0.70, 0.58, 75),
        ];

        Self {
            ball: Ball::new(0.5, 0.25),
            flippers: [
                Flipper::new_left(0.28, 0.12),
                Flipper::new_right(0.72, 0.12),
            ],
            bumpers,
            walls,
            knight: Knight::new(0.5, 0.05),
            score: 0,
            lives: 3,
            ball_lost: false,
        }
    }

    pub fn reset_ball(&mut self) {
        self.ball = Ball::new(0.88, 0.20);
        self.ball.velocity = Vec2::new(-0.5, 5.0);
        self.ball_lost = false;
    }

    /// Step the world by dt seconds.
    pub fn step(&mut self, dt: f32) -> Vec<GameEvent> {
        let mut events = Vec::new();

        self.ball.update(dt);
        for f in self.flippers.iter_mut() {
            f.update(dt);
        }
        for b in self.bumpers.iter_mut() {
            b.update(dt);
        }
        self.knight.update(dt);

        // Ball lost (fell below table)
        if self.ball.position.y < 0.0 {
            self.ball_lost = true;
            if self.lives > 0 {
                self.lives -= 1;
            }
            events.push(GameEvent::BallLost);
            return events;
        }

        // Wall collisions
        let ball_r = self.ball.radius;
        for wall in &self.walls {
            let (closest, dist) = wall.closest_point(self.ball.position);
            if dist < ball_r {
                let n = wall.normal();
                // Push ball out
                let overlap = ball_r - dist;
                self.ball.position += n * overlap;
                // Reflect velocity
                let vn = self.ball.velocity.dot(n);
                if vn < 0.0 {
                    self.ball.velocity = self.ball.velocity - n * (2.0 * vn * 0.75);
                }
                let _ = closest;
            }
        }

        // Bumper collisions
        for bumper in &mut self.bumpers {
            let diff = self.ball.position - bumper.position;
            let dist = diff.length();
            let min_dist = ball_r + bumper.radius;
            if dist < min_dist {
                let n = diff.normalize();
                self.ball.position = bumper.position + n * min_dist;
                let speed = self.ball.velocity.length().max(3.0) * 1.2;
                self.ball.velocity = n * speed;
                bumper.lit_timer = 0.3;
                self.score += bumper.points;
                events.push(GameEvent::BumperHit(bumper.points));
                self.knight.celebrate();
            }
        }

        // Flipper collisions
        let flipper_thickness = 0.018_f32;
        for flipper in &self.flippers {
            let (closest, dist) = flipper.closest_point(self.ball.position);
            if dist < ball_r + flipper_thickness {
                let n = (self.ball.position - closest).normalize();
                let overlap = (ball_r + flipper_thickness) - dist;
                self.ball.position += n * overlap;
                let vn = self.ball.velocity.dot(n);
                if vn < 0.0 {
                    self.ball.velocity = self.ball.velocity - n * (2.0 * vn * 0.80);
                    // Add flipper kick when active
                    if flipper.active {
                        self.ball.velocity += n * 3.0;
                    }
                }
            }
        }

        events
    }
}

impl Default for PhysicsWorld {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub enum GameEvent {
    BumperHit(u32),
    BallLost,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vec2_length() {
        let v = Vec2::new(3.0, 4.0);
        assert!((v.length() - 5.0).abs() < 1e-5);
    }

    #[test]
    fn vec2_normalize() {
        let v = Vec2::new(3.0, 4.0).normalize();
        assert!((v.length() - 1.0).abs() < 1e-5);
    }

    #[test]
    fn vec2_reflect() {
        let vel = Vec2::new(1.0, -1.0);
        let normal = Vec2::new(0.0, 1.0);
        let reflected = vel.reflect(normal);
        assert!((reflected.x - 1.0).abs() < 1e-5);
        assert!((reflected.y - 1.0).abs() < 1e-5);
    }

    #[test]
    fn ball_gravity() {
        let mut ball = Ball::new(0.5, 0.5);
        ball.velocity = Vec2::zero();
        ball.update(0.1);
        assert!(ball.velocity.y < 0.0, "Ball should fall under gravity");
    }

    #[test]
    fn physics_world_creates() {
        let world = PhysicsWorld::new();
        assert_eq!(world.lives, 3);
        assert_eq!(world.score, 0);
        assert_eq!(world.bumpers.len(), 5);
    }

    #[test]
    fn physics_world_step() {
        let mut world = PhysicsWorld::new();
        let events = world.step(0.016);
        // Ball should still be in play after one step
        assert!(!world.ball_lost);
        let _ = events;
    }

    #[test]
    fn flipper_movement() {
        let mut f = Flipper::new_left(0.28, 0.12);
        f.active = true;
        for _ in 0..60 {
            f.update(0.016);
        }
        assert!(
            (f.angle - f.active_angle).abs() < 0.01,
            "Flipper should reach active angle"
        );
    }

    #[test]
    fn bumper_lit_timer() {
        let mut b = Bumper::new(0.5, 0.5, 100);
        assert!(!b.is_lit());
        b.lit_timer = 0.3;
        assert!(b.is_lit());
        b.update(0.5);
        assert!(!b.is_lit());
    }
}
