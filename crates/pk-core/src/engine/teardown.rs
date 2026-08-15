//! Engine Teardown & Resource Disposal — Clean floor transitions and full application reset.
//!
//! PORTS: `dispose.ts`

#[derive(Clone, Debug, PartialEq)]
pub struct TransientFloorState {
    pub zombies: usize,
    pub ground_items: usize,
    pub props: usize,
    pub projectiles: usize,
    pub floor_fx: usize,
    pub multiball_echoes: usize,
    pub lamp_puzzles: usize,
    pub maze_active: bool,
    pub grid_active: bool,
    pub flow_field_active: bool,
}

impl Default for TransientFloorState {
    fn default() -> Self {
        Self {
            zombies: 0,
            ground_items: 0,
            props: 0,
            projectiles: 0,
            floor_fx: 0,
            multiball_echoes: 0,
            lamp_puzzles: 0,
            maze_active: false,
            grid_active: false,
            flow_field_active: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PersistentGameState {
    pub player_hp: i32,
    pub player_gold: u32,
    pub player_level: u32,
    pub floor_index: u32,
    pub multiball_time_remaining: f32,
}

impl Default for PersistentGameState {
    fn default() -> Self {
        Self {
            player_hp: 100,
            player_gold: 0,
            player_level: 1,
            floor_index: 1,
            multiball_time_remaining: 0.0,
        }
    }
}

/// Tears down one depth: the maze geometry, the horde (including corpses), any
/// loot still on the floor and anything mid-flight. The player actor and progression
/// survive level changes.
pub fn dispose_level(floor: &mut TransientFloorState) {
    floor.zombies = 0;
    floor.ground_items = 0;
    floor.props = 0;
    floor.projectiles = 0;
    floor.floor_fx = 0;
    floor.multiball_echoes = 0;
    floor.lamp_puzzles = 0;
    floor.maze_active = false;
    floor.grid_active = false;
    floor.flow_field_active = false;
}

/// Full game reset: tears down the floor and resets all persistent player run progression.
pub fn dispose_all(floor: &mut TransientFloorState, game: &mut PersistentGameState) {
    dispose_level(floor);
    *game = PersistentGameState::default();
}
