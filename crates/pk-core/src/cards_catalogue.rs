// GENERATED from legacy/src/game/pinball-knight/cards.ts — do not hand-edit.
//
// 25 cards, exactly 5 per rarity. Every non-mythic is the essence of ONE
// monster; the eight zombie SUB-TYPES each get their own card, because a Hulk
// and a Midget are different monsters and should not drop the same chip.
//
// MECHANIC COVERAGE RULE: every mechanic needs at least TWO cards or its
// two-card set bonus is unreachable. bolt -> wispspark + tempestcrown;
// material -> crystalshard + golemcore; crit -> goblintooth, flailerjaw,
// bloodpact; pierce -> venomgland + webspinnersilk; lifesteal ->
// ectoplasmcore, grimscythe, bloodpact; pinball -> runnersinew + timeripper.
//
// PORTS: `cards.ts`

pub static CARDS: [CardDef; 25] = [
    CardDef {
        id: "shamblerhide",
        label: "Shambler Hide",
        icon: "🧟",
        rarity: CardRarity::Common,
        description: "+35% durability",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Shambler),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            durability_mult: Some(1.35),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "midgetclaw",
        label: "Midget Claw",
        icon: "🦴",
        rarity: CardRarity::Common,
        description: "−12% cooldown",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Midget),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            cooldown_mult: Some(0.88),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "hobblerbrace",
        label: "Hobbler Brace",
        icon: "🦯",
        rarity: CardRarity::Common,
        description: "+25% durability, −5% cooldown",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Hobbler),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            cooldown_mult: Some(0.95),
            durability_mult: Some(1.25),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "batwingchip",
        label: "Bat Wing",
        icon: "🦇",
        rarity: CardRarity::Common,
        description: "−10% cooldown, +15% durability",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Bat),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            cooldown_mult: Some(0.9),
            durability_mult: Some(1.15),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "spidersilk",
        label: "Spider Silk",
        icon: "🕸️",
        rarity: CardRarity::Common,
        description: "+20% damage",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Spider),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.2),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "runnersinew",
        label: "Runner Sinew",
        icon: "🏃",
        rarity: CardRarity::Rare,
        description: "+35% damage while riding momentum",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Runner),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            pinball_mult: Some(1.35),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "lurcherspine",
        label: "Lurcher Spine",
        icon: "🦴",
        rarity: CardRarity::Rare,
        description: "+1 dmg, +80% durability",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Lurcher),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_flat: Some(1),
            durability_mult: Some(1.8),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "goblintooth",
        label: "Goblin Tooth",
        icon: "👺",
        rarity: CardRarity::Rare,
        description: "20% chance to CRIT (×2)",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Goblin),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            crit_chance: Some(0.2),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "venomgland",
        label: "Venom Gland",
        icon: "🤮",
        rarity: CardRarity::Rare,
        description: "shots pierce 2 more foes, hits BURN",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Spitter),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            on_hit: Some(OnHit::Burn),
            pierce: Some(2),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "wispspark",
        label: "Wisp Spark",
        icon: "✨",
        rarity: CardRarity::Rare,
        description: "hits arc a THUNDERBOLT through foes ahead",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Wisp),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            bolt: true,
            ..NEUTRAL
        },
    },
    CardDef {
        id: "hulkknuckle",
        label: "Hulk Knuckle",
        icon: "💪",
        rarity: CardRarity::Epic,
        description: "+60% damage, but +15% cooldown",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Hulk),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.6),
            cooldown_mult: Some(1.15),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "crawlergrip",
        label: "Crawler Grip",
        icon: "🖐️",
        rarity: CardRarity::Epic,
        description: "+40% dmg and hits CHILL",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Crawler),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.4),
            on_hit: Some(OnHit::Chill),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "ectoplasmcore",
        label: "Ectoplasm Core",
        icon: "👻",
        rarity: CardRarity::Epic,
        description: "+25% dmg, hits CHILL, heal 1/hit",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Ghost),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.25),
            on_hit: Some(OnHit::Chill),
            lifesteal: Some(1),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "crystalshard",
        label: "Crystal Shard",
        icon: "🔷",
        rarity: CardRarity::Epic,
        description: "+50% dmg while a MARBLE is active",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Crystalback),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            material_mult: Some(1.5),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "webspinnersilk",
        label: "Webspinner Silk",
        icon: "🕸️",
        rarity: CardRarity::Epic,
        description: "shots pierce 3 more foes, −15% cooldown",
        weapon_kinds: WeaponKinds::Ranged,
        source: Some(EnemyKind::Webspinner),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            cooldown_mult: Some(0.85),
            pierce: Some(3),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "flailerjaw",
        label: "Flailer Jaw",
        icon: "😬",
        rarity: CardRarity::Legendary,
        description: "+50% dmg, 30% CRIT for ×2.5",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Zombie),
        sub_type: Some(ZombieType::Flailer),
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.5),
            crit_chance: Some(0.3),
            crit_mult: Some(2.5),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "grimscythe",
        label: "Grim Scythe",
        icon: "☠️",
        rarity: CardRarity::Legendary,
        description: "+2 dmg, +45% dmg, heal 1/hit",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Reaper),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_flat: Some(2),
            damage_mult: Some(1.45),
            lifesteal: Some(1),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "necrosigil",
        label: "Necro Sigil",
        icon: "🕯️",
        rarity: CardRarity::Legendary,
        description: "+40% dmg, hits BURN",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Necromancer),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.4),
            on_hit: Some(OnHit::Burn),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "golemcore",
        label: "Golem Core",
        icon: "🗿",
        rarity: CardRarity::Legendary,
        description: "+2 dmg, +35% dmg while a MARBLE is active, +100% durability",
        weapon_kinds: WeaponKinds::Both,
        source: Some(EnemyKind::Golem),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_flat: Some(2),
            durability_mult: Some(2.0),
            material_mult: Some(1.35),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "brutecleaver",
        label: "Brute Cleaver",
        icon: "🪓",
        rarity: CardRarity::Legendary,
        description: "+70% damage (melee)",
        weapon_kinds: WeaponKinds::Melee,
        source: Some(EnemyKind::Brute),
        sub_type: None,
        type_line: None,
        flavour: None,
        modifier: CardModifier {
            damage_mult: Some(1.7),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "worldbreaker",
        label: "World Breaker",
        icon: "🌋",
        rarity: CardRarity::Mythic,
        description: "+2 dmg, +75% dmg, hits BURN",
        weapon_kinds: WeaponKinds::Both,
        source: None,
        sub_type: None,
        type_line: Some("Cataclysm"),
        flavour: Some("it was a mountain once, and it remembers being one"),
        modifier: CardModifier {
            damage_flat: Some(2),
            damage_mult: Some(1.75),
            on_hit: Some(OnHit::Burn),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "timeripper",
        label: "Time Ripper",
        icon: "⏳",
        rarity: CardRarity::Mythic,
        description: "−40% cooldown, +60% dmg, DOUBLE on momentum",
        weapon_kinds: WeaponKinds::Both,
        source: None,
        sub_type: None,
        type_line: Some("Paradox"),
        flavour: Some("the swing lands before you decide to make it"),
        modifier: CardModifier {
            damage_mult: Some(1.6),
            cooldown_mult: Some(0.6),
            pinball_mult: Some(2.0),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "tempestcrown",
        label: "Tempest Crown",
        icon: "🌀",
        rarity: CardRarity::Mythic,
        description: "+50% dmg, hits BURN and arc a THUNDERBOLT",
        weapon_kinds: WeaponKinds::Both,
        source: None,
        sub_type: None,
        type_line: Some("Regalia"),
        flavour: Some("worn once, by something the storm answered to"),
        modifier: CardModifier {
            damage_mult: Some(1.5),
            on_hit: Some(OnHit::Burn),
            bolt: true,
            ..NEUTRAL
        },
    },
    CardDef {
        id: "gladeath",
        label: "Glass Cannon",
        icon: "🩻",
        rarity: CardRarity::Mythic,
        description: "+120% dmg, but −60% durability",
        weapon_kinds: WeaponKinds::Both,
        source: None,
        sub_type: None,
        type_line: Some("Bargain"),
        flavour: Some("hits like a falling star; holds like one too"),
        modifier: CardModifier {
            damage_mult: Some(2.2),
            durability_mult: Some(0.4),
            ..NEUTRAL
        },
    },
    CardDef {
        id: "bloodpact",
        label: "Blood Pact",
        icon: "🖤",
        rarity: CardRarity::Mythic,
        description: "50% CRIT ×3 and heal 1/hit, but −40% durability",
        weapon_kinds: WeaponKinds::Both,
        source: None,
        sub_type: None,
        type_line: Some("Bargain"),
        flavour: Some("the wound is the price, and it is always paid"),
        modifier: CardModifier {
            durability_mult: Some(0.6),
            crit_chance: Some(0.5),
            crit_mult: Some(3.0),
            lifesteal: Some(1),
            ..NEUTRAL
        },
    },
];
