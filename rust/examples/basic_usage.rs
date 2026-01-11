//! Basic usage example for links-mq.
//!
//! This example demonstrates the core Link and LinkStore interfaces.
//!
//! Run with: `cargo run --example basic_usage`

use links_mq::{Any, Link, LinkPattern, LinkRef};

fn main() {
    // =========================================================================
    // Creating Links
    // =========================================================================

    println!("=== Creating Links ===\n");

    // Simple link with u64 IDs
    let simple_link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
    println!("Simple link: {:?}", simple_link);

    // Link with u32 IDs (smaller memory footprint)
    let u32_link = Link::new(1u32, LinkRef::Id(2u32), LinkRef::Id(3u32));
    println!("u32 link: {:?}", u32_link);

    // Link with usize IDs (platform-native size)
    let usize_link = Link::new(1usize, LinkRef::Id(2usize), LinkRef::Id(3usize));
    println!("usize link: {:?}", usize_link);

    // =========================================================================
    // Nested Links (Recursive Structures)
    // =========================================================================

    println!("\n=== Nested Links ===\n");

    // Create nested link structures for complex relationships
    let inner = Link::new(10u64, LinkRef::Id(20), LinkRef::Id(30));
    let outer = Link::new(1u64, LinkRef::link(inner.clone()), LinkRef::Id(5));
    println!("Outer link with nested source: {:?}", outer);
    println!("  Outer source ID: {}", outer.source_id()); // 10

    // Deep nesting: (1: (2: (3: 30 31)))
    let level3 = Link::new(3u64, LinkRef::Id(30), LinkRef::Id(31));
    let level2 = Link::new(2u64, LinkRef::link(level3), LinkRef::Id(21));
    let level1 = Link::new(1u64, LinkRef::link(level2), LinkRef::Id(11));
    println!("Deeply nested: {:?}", level1);
    println!("  Level 1 source ID: {}", level1.source_id()); // 2

    // =========================================================================
    // Universal Links (Variable Number of References)
    // =========================================================================

    println!("\n=== Universal Links ===\n");

    // Universal link with additional values beyond source/target
    let universal = Link::with_values(
        100u64,
        LinkRef::Id(1), // subject
        LinkRef::Id(2), // predicate
        vec![LinkRef::Id(3), LinkRef::Id(4), LinkRef::Id(5)], // objects
    );
    println!("Universal link: {:?}", universal);
    println!("  Has values: {}", universal.has_values());

    // =========================================================================
    // Special Link Types
    // =========================================================================

    println!("\n=== Special Link Types ===\n");

    // Point link (self-referential: id == source == target)
    let point = Link::<u64>::point(42);
    println!("Point link: {:?}", point);
    println!("  Is point: {}", point.is_point()); // true

    // Null/nothing link (all zeros)
    let null_link = Link::<u64>::nothing();
    println!("Null link: {:?}", null_link);
    println!("  Is null: {}", null_link.is_null()); // true

    // =========================================================================
    // LinkRef Operations
    // =========================================================================

    println!("\n=== LinkRef Operations ===\n");

    // Create refs from IDs
    let ref_id: LinkRef<u64> = LinkRef::Id(42);
    println!("ID ref: {:?}", ref_id);
    println!("  Is ID: {}", ref_id.is_id()); // true
    println!("  Get ID: {}", ref_id.get_id()); // 42

    // Create refs from links
    let ref_link: LinkRef<u64> = LinkRef::link(simple_link.clone());
    println!("Link ref: {:?}", ref_link);
    println!("  Is link: {}", ref_link.is_link()); // true
    println!("  Get ID: {}", ref_link.get_id()); // 1 (the link's ID)

    // Using From trait
    let from_id: LinkRef<u64> = 99u64.into();
    let from_link: LinkRef<u64> = simple_link.clone().into();
    println!("From ID: {:?}", from_id);
    println!("From link: {:?}", from_link);

    // =========================================================================
    // Pattern Matching
    // =========================================================================

    println!("\n=== Pattern Matching ===\n");

    let links = vec![
        Link::new(1u64, LinkRef::Id(10), LinkRef::Id(20)),
        Link::new(2u64, LinkRef::Id(10), LinkRef::Id(30)),
        Link::new(3u64, LinkRef::Id(20), LinkRef::Id(30)),
        Link::new(4u64, LinkRef::Id(30), LinkRef::Id(40)),
    ];

    // Match all links
    let all_pattern = LinkPattern::<u64>::all();
    let all_matched: Vec<_> = links.iter().filter(|l| all_pattern.matches(l)).collect();
    println!("All links count: {}", all_matched.len()); // 4

    // Match by source
    let source_pattern = LinkPattern::with_source(LinkRef::Id(10u64));
    let with_source_10: Vec<_> = links
        .iter()
        .filter(|l| source_pattern.matches(l))
        .map(|l| l.id)
        .collect();
    println!("Links with source=10: {:?}", with_source_10); // [1, 2]

    // Match by target
    let target_pattern = LinkPattern::with_target(LinkRef::Id(30u64));
    let with_target_30: Vec<_> = links
        .iter()
        .filter(|l| target_pattern.matches(l))
        .map(|l| l.id)
        .collect();
    println!("Links with target=30: {:?}", with_target_30); // [2, 3]

    // Match with Any wildcard (builder pattern)
    let any_source_pattern = LinkPattern::<u64>::new()
        .source(Any)
        .target(30u64);
    let any_source_target_30: Vec<_> = links
        .iter()
        .filter(|l| any_source_pattern.matches(l))
        .map(|l| l.id)
        .collect();
    println!("Links with Any source, target=30: {:?}", any_source_target_30); // [2, 3]

    // Match by source AND target
    let exact_pattern = LinkPattern::with_source_target(
        LinkRef::Id(10u64),
        LinkRef::Id(20u64),
    );
    let exact_match: Vec<_> = links
        .iter()
        .filter(|l| exact_pattern.matches(l))
        .map(|l| l.id)
        .collect();
    println!("Links with source=10, target=20: {:?}", exact_match); // [1]

    println!("\n=== Done ===\n");
}
