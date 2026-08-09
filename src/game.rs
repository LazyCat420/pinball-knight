use crate::physics::PhysicsWorld;
use crate::renderer::Renderer;
use std::sync::Arc;
use std::time::Instant;
use winit::{
    application::ApplicationHandler,
    dpi::PhysicalSize,
    event::{ElementState, KeyEvent, WindowEvent},
    event_loop::ActiveEventLoop,
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

/// The possible states of the game.
#[derive(Debug, Clone, PartialEq)]
pub enum GameState {
    /// Show the start screen
    StartScreen,
    /// Ball in play
    Playing,
    /// Brief pause after ball lost
    BallLost,
    /// Game over
    GameOver,
}

pub struct App {
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    world: PhysicsWorld,
    state: GameState,
    last_time: Option<Instant>,
    high_score: u32,
}

impl App {
    pub fn new() -> Self {
        Self {
            window: None,
            renderer: None,
            world: PhysicsWorld::new(),
            state: GameState::StartScreen,
            last_time: None,
            high_score: 0,
        }
    }

    fn handle_key(&mut self, key: KeyCode, pressed: bool) {
        match key {
            KeyCode::ArrowLeft | KeyCode::KeyZ | KeyCode::ShiftLeft => {
                self.world.flippers[0].active = pressed;
            }
            KeyCode::ArrowRight | KeyCode::KeyX | KeyCode::ShiftRight => {
                self.world.flippers[1].active = pressed;
            }
            KeyCode::Space | KeyCode::Enter => {
                if pressed {
                    match self.state {
                        GameState::StartScreen => {
                            self.world = PhysicsWorld::new();
                            self.world.reset_ball();
                            self.state = GameState::Playing;
                            self.last_time = Some(Instant::now());
                        }
                        GameState::BallLost => {
                            if self.world.lives > 0 {
                                self.world.reset_ball();
                                self.state = GameState::Playing;
                            } else {
                                self.state = GameState::GameOver;
                            }
                        }
                        GameState::GameOver => {
                            self.high_score = self.high_score.max(self.world.score);
                            self.world = PhysicsWorld::new();
                            self.state = GameState::StartScreen;
                        }
                        GameState::Playing => {}
                    }
                }
            }
            _ => {}
        }
    }

    fn update(&mut self) {
        if self.state != GameState::Playing {
            return;
        }

        let now = Instant::now();
        let dt = if let Some(last) = self.last_time {
            now.duration_since(last).as_secs_f32().min(0.05)
        } else {
            0.016
        };
        self.last_time = Some(now);

        let events = self.world.step(dt);
        for event in events {
            match event {
                crate::physics::GameEvent::BallLost => {
                    self.state = GameState::BallLost;
                    log::info!(
                        "Ball lost! Lives remaining: {}  Score: {}",
                        self.world.lives,
                        self.world.score
                    );
                }
                crate::physics::GameEvent::BumperHit(pts) => {
                    log::debug!("Bumper hit! +{} points  Total: {}", pts, self.world.score);
                }
            }
        }
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            let window_attrs = Window::default_attributes()
                .with_title("Pinball Knight ⚔️")
                .with_inner_size(PhysicalSize::new(600u32, 800u32));
            let window = Arc::new(
                event_loop
                    .create_window(window_attrs)
                    .expect("Failed to create window"),
            );
            let renderer = pollster::block_on(Renderer::new(Arc::clone(&window)));
            self.window = Some(window);
            self.renderer = Some(renderer);
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                if let Some(renderer) = &mut self.renderer {
                    renderer.resize(size.width, size.height);
                }
            }
            WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key: PhysicalKey::Code(key_code),
                        state,
                        ..
                    },
                ..
            } => {
                self.handle_key(key_code, state == ElementState::Pressed);
            }
            WindowEvent::RedrawRequested => {
                self.update();
                if let Some(renderer) = &self.renderer {
                    match renderer.render(&self.world, self.world.score, self.world.lives) {
                        Ok(_) => {}
                        Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                            if let Some(r) = &mut self.renderer {
                                let (w, h) = r.size;
                                r.resize(w, h);
                            }
                        }
                        Err(wgpu::SurfaceError::OutOfMemory) => {
                            log::error!("Out of GPU memory");
                            event_loop.exit();
                        }
                        Err(e) => {
                            log::warn!("Render error: {:?}", e);
                        }
                    }
                }
                if let Some(w) = &self.window {
                    w.request_redraw();
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_creates() {
        let app = App::new();
        assert_eq!(app.state, GameState::StartScreen);
        assert_eq!(app.high_score, 0);
    }

    #[test]
    fn game_state_transitions() {
        let mut app = App::new();
        // Space on start screen -> Playing
        app.handle_key(KeyCode::Space, true);
        assert_eq!(app.state, GameState::Playing);
    }

    #[test]
    fn flipper_input() {
        let mut app = App::new();
        app.handle_key(KeyCode::ArrowLeft, true);
        assert!(app.world.flippers[0].active);
        app.handle_key(KeyCode::ArrowLeft, false);
        assert!(!app.world.flippers[0].active);
        app.handle_key(KeyCode::ArrowRight, true);
        assert!(app.world.flippers[1].active);
    }
}
