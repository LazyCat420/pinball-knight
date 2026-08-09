//! Pinball Knight — Bevy shell.
//!
//! Scaffold stage: a headless App proving the sim-as-a-resource architecture
//! compiles and steps. The sim lives in pk-core behind a Resource; Bevy ECS
//! entities are views. M1 adds the window, WebGPU renderer, camera rig and the
//! GreaterDepth silhouette pass.

use bevy::app::ScheduleRunnerPlugin;
use bevy::prelude::*;
use pk_core::rng::Mulberry32;

/// The deterministic sim, owned whole — never mutated outside [`step_sim`].
/// (Grows into pk_core::SimState as the port proceeds.)
#[derive(Resource)]
struct Sim {
    rng: Mulberry32,
    tick: u64,
}

fn main() {
    App::new()
        .add_plugins(MinimalPlugins.set(ScheduleRunnerPlugin::run_once()))
        .insert_resource(Time::<Fixed>::from_hz(60.0))
        .insert_resource(Sim {
            rng: Mulberry32::new(7),
            tick: 0,
        })
        .add_systems(FixedUpdate, step_sim)
        .add_systems(Update, report)
        .run();
}

fn step_sim(mut sim: ResMut<Sim>) {
    sim.tick += 1;
    let _ = sim.rng.next_f64();
}

fn report(sim: Res<Sim>) {
    println!("pk-game scaffold: sim resource live at tick {}", sim.tick);
}
