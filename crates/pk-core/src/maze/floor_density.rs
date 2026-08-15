//! Floor Density — Object count analysis, furniture budgets, and distribution gates per 1,000 walkable tiles.
//!
//! PORTS: `maze/floor-density.ts`

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DensityInput {
    pub parts: usize,
    pub route_parts: usize,
    pub spawns: usize,
    pub torches: usize,
    pub props: usize,
    pub items: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct DensityMetrics {
    pub walkable: usize,
    pub parts: usize,
    pub route_parts: usize,
    pub spawns: usize,
    pub torches: usize,
    pub props: usize,
    pub items: usize,
    pub parts_per_1k: f64,
    pub route_parts_per_1k: f64,
    pub spawns_per_1k: f64,
    pub torches_per_1k: f64,
    pub props_per_1k: f64,
    pub furniture_per_1k: f64,
    pub route_share: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DensityBudget {
    pub max_parts_per_1k: f64,
    pub max_spawns_per_1k: f64,
    pub min_route_share: f64,
    pub max_route_share: f64,
    pub max_furniture_per_1k: f64,
}

impl Default for DensityBudget {
    fn default() -> Self {
        Self {
            max_parts_per_1k: 80.0,
            max_spawns_per_1k: 45.0,
            min_route_share: 0.25,
            max_route_share: 0.85,
            max_furniture_per_1k: 220.0,
        }
    }
}

/// Measures the object density per 1,000 walkable tiles for a given floor.
pub fn measure_density(input: &DensityInput, walkable: usize) -> DensityMetrics {
    if walkable == 0 {
        return DensityMetrics::default();
    }

    let scale = 1000.0 / walkable as f64;
    let parts_per_1k = input.parts as f64 * scale;
    let route_parts_per_1k = input.route_parts as f64 * scale;
    let spawns_per_1k = input.spawns as f64 * scale;
    let torches_per_1k = input.torches as f64 * scale;
    let props_per_1k = input.props as f64 * scale;
    let furniture_per_1k = (input.parts + input.spawns + input.torches + input.props) as f64 * scale;

    let route_share = if input.parts == 0 {
        0.0
    } else {
        input.route_parts as f64 / input.parts as f64
    };

    DensityMetrics {
        walkable,
        parts: input.parts,
        route_parts: input.route_parts,
        spawns: input.spawns,
        torches: input.torches,
        props: input.props,
        items: input.items,
        parts_per_1k,
        route_parts_per_1k,
        spawns_per_1k,
        torches_per_1k,
        props_per_1k,
        furniture_per_1k,
        route_share,
    }
}

/// Checks measured floor metrics against a density budget, returning validation errors if exceeded.
pub fn check_density(metrics: &DensityMetrics, budget: &DensityBudget) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();

    if metrics.parts_per_1k > budget.max_parts_per_1k {
        errors.push(format!(
            "Parts density ({:.1}/1k) exceeds max ({:.1}/1k)",
            metrics.parts_per_1k, budget.max_parts_per_1k
        ));
    }

    if metrics.spawns_per_1k > budget.max_spawns_per_1k {
        errors.push(format!(
            "Spawns density ({:.1}/1k) exceeds max ({:.1}/1k)",
            metrics.spawns_per_1k, budget.max_spawns_per_1k
        ));
    }

    if metrics.parts > 0 {
        if metrics.route_share < budget.min_route_share {
            errors.push(format!(
                "Route share ({:.1}%) below min ({:.1}%)",
                metrics.route_share * 100.0,
                budget.min_route_share * 100.0
            ));
        } else if metrics.route_share > budget.max_route_share {
            errors.push(format!(
                "Route share ({:.1}%) exceeds max ({:.1}%)",
                metrics.route_share * 100.0,
                budget.max_route_share * 100.0
            ));
        }
    }

    if metrics.furniture_per_1k > budget.max_furniture_per_1k {
        errors.push(format!(
            "Total furniture ({:.1}/1k) exceeds max ({:.1}/1k)",
            metrics.furniture_per_1k, budget.max_furniture_per_1k
        ));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}
