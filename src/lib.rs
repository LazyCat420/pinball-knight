pub mod game;
pub mod physics;
pub mod renderer;
pub mod shader;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub async fn wasm_main() {
    use winit::event_loop::EventLoop;
    console_error_panic_hook::set_once();
    console_log::init_with_level(log::Level::Info).expect("Couldn't initialize logger");

    let event_loop = EventLoop::new().expect("Failed to create event loop");
    let mut app = game::App::new();
    event_loop.run_app(&mut app).expect("Failed to run app");
}
