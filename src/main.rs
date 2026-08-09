use pinball_knight::game;
use winit::event_loop::EventLoop;

fn main() {
    env_logger::init();
    let event_loop = EventLoop::new().expect("Failed to create event loop");
    let mut app = game::App::new();
    event_loop.run_app(&mut app).expect("Failed to run app");
}
