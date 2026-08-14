//! FLOOR RULES — placement weights and invariants for generated maze floors.
//!
//! Port of `legacy/src/game/pinball-knight/maze/floor-rules.ts` (430 lines).
//!
//! PORTS: `maze/floor-rules.ts`


#[derive(Clone, Debug, PartialEq)]
pub struct FloorRuleWeights {
    pub perimeter_bias: f64,
    pub min_boss_tiles: i32,
    pub min_boss_euclid: f64,
    pub min_doorway_clearance: f64,
}

impl Default for FloorRuleWeights {
    fn default() -> Self {
        Self {
            perimeter_bias: 0.85,
            min_boss_tiles: 35,
            min_boss_euclid: 18.0,
            min_doorway_clearance: 2.0,
        }
    }
}

/// Scores a candidate spawn tile (i, j) based on distance from grid perimeter.
pub fn score_spawn_perimeter(w: i32, h: i32, i: i32, j: i32, bias: f64) -> f64 {
    let edge_dist_x = i.min(w - 1 - i);
    let edge_dist_z = j.min(h - 1 - j);
    let corner_dist = (edge_dist_x * edge_dist_x + edge_dist_z * edge_dist_z) as f64;
    // Lower corner_dist is better when perimeter bias is high
    1.0 / (1.0 + corner_dist * bias)
}

/// Verifies that spawn and exit are separated by minimum euclidean and topological distance.
pub fn check_endpoint_separation(
    start_i: i32,
    start_j: i32,
    exit_i: i32,
    exit_j: i32,
    path_len: usize,
    weights: &FloorRuleWeights,
) -> bool {
    let di = (exit_i - start_i) as f64;
    let dj = (exit_j - start_j) as f64;
    let euclid = (di * di + dj * dj).sqrt();

    euclid >= weights.min_boss_euclid && path_len as i32 >= weights.min_boss_tiles
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_perimeter_scoring() {
        let w = 50;
        let h = 50;
        let corner_score = score_spawn_perimeter(w, h, 1, 1, 1.0);
        let center_score = score_spawn_perimeter(w, h, 25, 25, 1.0);
        assert!(corner_score > center_score);
    }
}
