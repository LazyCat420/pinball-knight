//! Sprite Animation State Machine & Clip Controller.
//!
//! PORTS: `engine/render/animator.ts`

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Facing {
    #[default]
    S,
    N,
    E,
    W,
}

impl Facing {
    pub fn as_str(&self) -> &'static str {
        match self {
            Facing::S => "S",
            Facing::N => "N",
            Facing::E => "E",
            Facing::W => "W",
        }
    }
}

pub fn is_ride_clip(clip: &str) -> bool {
    clip == "ride" || clip == "ride_spin" || clip == "ride_fast"
}

pub fn facing_from_velocity(vx: f64, vz: f64, fallback: Facing) -> Facing {
    let speed_sq = vx * vx + vz * vz;
    if speed_sq < 0.01 {
        return fallback;
    }

    if vx.abs() > vz.abs() {
        if vx > 0.0 {
            Facing::E
        } else {
            Facing::W
        }
    } else if vz > 0.0 {
        Facing::S
    } else {
        Facing::N
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AnimationClip {
    pub name: String,
    pub frame_count: usize,
    pub fps: f64,
    pub loops: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Animator {
    pub current_clip: String,
    pub current_frame: usize,
    pub timer: f64,
    pub facing: Facing,
    pub is_playing: bool,
    pub speed: f64,
}

impl Default for Animator {
    fn default() -> Self {
        Self::new()
    }
}

impl Animator {
    pub fn new() -> Self {
        Self {
            current_clip: "idle".to_string(),
            current_frame: 0,
            timer: 0.0,
            facing: Facing::S,
            is_playing: true,
            speed: 1.0,
        }
    }

    pub fn play(&mut self, clip: &str, loops: bool) {
        if self.current_clip != clip {
            self.current_clip = clip.to_string();
            self.current_frame = 0;
            self.timer = 0.0;
            self.is_playing = true;
        }
        let _ = loops;
    }

    pub fn update(&mut self, dt: f64, frame_count: usize, fps: f64) {
        if !self.is_playing || frame_count == 0 {
            return;
        }

        self.timer += dt * self.speed;
        let frame_duration = 1.0 / fps;

        while self.timer >= frame_duration {
            self.timer -= frame_duration;
            self.current_frame = (self.current_frame + 1) % frame_count;
        }
    }

    pub fn set_facing(&mut self, facing: Facing) {
        self.facing = facing;
    }
}
