// Parity test suite for Maze Floor Density Metrics.
// Replicates legacy/src/game/pinball-knight/maze/floor-density.ts

use pk_core::maze::floor_density::{check_density, measure_density, DensityBudget, DensityInput};

#[test]
fn floor_density_measures_rates_per_thousand_walkable() {
    let input = DensityInput {
        parts: 40,
        route_parts: 20,
        spawns: 20,
        torches: 10,
        props: 10,
        items: 5,
    };

    let metrics = measure_density(&input, 1000);
    assert_eq!(metrics.walkable, 1000);
    assert_eq!(metrics.parts_per_1k, 40.0);
    assert_eq!(metrics.route_parts_per_1k, 20.0);
    assert_eq!(metrics.spawns_per_1k, 20.0);
    assert_eq!(metrics.torches_per_1k, 10.0);
    assert_eq!(metrics.props_per_1k, 10.0);
    assert_eq!(metrics.furniture_per_1k, 80.0);
    assert_eq!(metrics.route_share, 0.5);

    // Verify passing budget
    let budget = DensityBudget::default();
    assert!(check_density(&metrics, &budget).is_ok());
}

#[test]
fn floor_density_flags_overcrowded_floor() {
    let overcrowded = DensityInput {
        parts: 200,
        route_parts: 10,
        spawns: 100,
        torches: 50,
        props: 100,
        items: 20,
    };

    let metrics = measure_density(&overcrowded, 1000);
    let budget = DensityBudget::default();
    let res = check_density(&metrics, &budget);

    assert!(res.is_err());
    let errs = res.unwrap_err();
    assert!(errs.iter().any(|e| e.contains("Parts density")));
    assert!(errs.iter().any(|e| e.contains("Spawns density")));
    assert!(errs.iter().any(|e| e.contains("Route share")));
}
