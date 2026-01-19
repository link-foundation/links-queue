//! Deduplication Example for links-queue
//!
//! This example demonstrates automatic link deduplication - one of the
//! unique features of Links Queue. When you create links with identical
//! source and target, the system automatically returns the existing link
//! instead of creating duplicates.
//!
//! Run with: `cargo run --example 04-deduplication`

use links_queue::{
    Link, LinkPattern, LinkRef, LinkStore, MemoryLinkStore, MemoryQueue, Queue, QueueOptions,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Links Queue: Deduplication ===\n");

    // =========================================================================
    // Part 1: Basic Deduplication in MemoryLinkStore
    // =========================================================================

    println!("--- Part 1: Basic Deduplication ---\n");

    let mut store = MemoryLinkStore::<u64>::new();

    // Create a link
    let link1 = store.create(LinkRef::Id(100), LinkRef::Id(200))?;
    println!("Created link 1: {link1:?}");
    println!("  ID: {}", link1.id);

    // Create another link with the same source and target
    let link2 = store.create(LinkRef::Id(100), LinkRef::Id(200))?;
    println!("\nCreated link 2 (same source/target): {link2:?}");
    println!("  ID: {}", link2.id);

    // They are the same link!
    println!("\nAre they the same link? {}", link1.id == link2.id); // true

    // Total count should be 1
    let count = store.total_count();
    println!("Total links in store: {count}"); // 1

    // Different source/target creates a new link
    let link3 = store.create(LinkRef::Id(100), LinkRef::Id(300))?;
    println!("\nCreated link 3 (different target): {link3:?}");
    println!("  ID: {}", link3.id); // Different ID

    let final_count = store.total_count();
    println!("Total links after link3: {final_count}"); // 2

    // =========================================================================
    // Part 2: Deduplication with Different ID Types
    // =========================================================================

    println!("\n--- Part 2: Deduplication with Different ID Types ---\n");

    // u32 IDs
    let mut store32 = MemoryLinkStore::<u32>::new();
    let u32_link1 = store32.create(LinkRef::Id(1), LinkRef::Id(2))?;
    let u32_link2 = store32.create(LinkRef::Id(1), LinkRef::Id(2))?;
    println!("u32 links deduplicated: {}", u32_link1.id == u32_link2.id); // true

    // u64 IDs
    let mut store64 = MemoryLinkStore::<u64>::new();
    let u64_link1 = store64.create(LinkRef::Id(1), LinkRef::Id(2))?;
    let u64_link2 = store64.create(LinkRef::Id(1), LinkRef::Id(2))?;
    println!("u64 links deduplicated: {}", u64_link1.id == u64_link2.id); // true

    // usize IDs
    let mut store_usize = MemoryLinkStore::<usize>::new();
    let usize_link1 = store_usize.create(LinkRef::Id(1), LinkRef::Id(2))?;
    let usize_link2 = store_usize.create(LinkRef::Id(1), LinkRef::Id(2))?;
    println!(
        "usize links deduplicated: {}",
        usize_link1.id == usize_link2.id
    ); // true

    println!(
        "Total unique links in each store: u32={}, u64={}, usize={}",
        store32.total_count(),
        store64.total_count(),
        store_usize.total_count()
    );

    // =========================================================================
    // Part 3: Nested Link Deduplication
    // =========================================================================

    println!("\n--- Part 3: Nested Link Deduplication ---\n");

    let mut store3 = MemoryLinkStore::<u64>::new();

    // Create inner links
    let inner1 = store3.create(LinkRef::Id(10), LinkRef::Id(20))?;
    let inner2 = store3.create(LinkRef::Id(10), LinkRef::Id(20))?; // Same, deduplicated

    println!("Inner links are same: {}", inner1.id == inner2.id); // true

    // Create outer links using the inner link as source
    let outer1 = store3.create(LinkRef::link(inner1.clone()), LinkRef::Id(30))?;
    let outer2 = store3.create(LinkRef::link(inner2.clone()), LinkRef::Id(30))?;

    println!(
        "Outer links with same nested source are same: {}",
        outer1.id == outer2.id
    ); // true
    println!("Total links (1 inner + 1 outer): {}", store3.total_count()); // 2

    // =========================================================================
    // Part 4: Universal Links - Deduplication Includes Values
    // =========================================================================

    println!("\n--- Part 4: Universal Links (Deduplication Includes Values) ---\n");

    let mut store4 = MemoryLinkStore::<u64>::new();

    // Universal links with same values are deduplicated
    let universal1 = store4.create_with_values(
        LinkRef::Id(100),
        LinkRef::Id(200),
        vec![LinkRef::Id(300), LinkRef::Id(400)],
    )?;
    let universal2 = store4.create_with_values(
        LinkRef::Id(100),
        LinkRef::Id(200),
        vec![LinkRef::Id(300), LinkRef::Id(400)],
    )?;

    println!("Universal link 1: {universal1:?}");
    println!("Universal link 2: {universal2:?}");
    println!(
        "Same ID (deduplication includes values): {}",
        universal1.id == universal2.id
    ); // true

    // Different values = different link
    let universal3 = store4.create_with_values(
        LinkRef::Id(100),
        LinkRef::Id(200),
        vec![LinkRef::Id(300), LinkRef::Id(500)], // Different value!
    )?;
    println!("\nUniversal link 3 (different values): {universal3:?}");
    println!("Different from link 1: {}", universal1.id != universal3.id); // true

    println!("Total universal links: {}", store4.total_count()); // 2

    // =========================================================================
    // Part 5: Practical Use Case - Event Deduplication
    // =========================================================================

    println!("\n--- Part 5: Practical Use Case - Event Deduplication ---\n");

    let mut event_store = MemoryLinkStore::<u64>::new();
    let queue = MemoryQueue::<u64>::new("events", QueueOptions::default());

    // Define event types
    const USER_LOGIN: u64 = 1;
    const USER_LOGOUT: u64 = 2;

    // Users
    const USER_123: u64 = 123;
    const USER_456: u64 = 456;

    // Simulate receiving duplicate events
    let events = vec![
        (USER_LOGIN, USER_123),
        (USER_LOGIN, USER_123), // Duplicate!
        (USER_LOGOUT, USER_123),
        (USER_LOGIN, USER_456),
        (USER_LOGIN, USER_123), // Duplicate!
    ];

    println!("Processing events with deduplication:");

    let mut processed_ids = std::collections::HashSet::new();
    for (event_type, user_id) in &events {
        // Create a link representing the event
        // Using source=type, target=userId creates unique event signatures
        let event_link = event_store.create(LinkRef::Id(*event_type), LinkRef::Id(*user_id))?;

        // Check if we've already processed this exact event
        if processed_ids.contains(&event_link.id) {
            let event_name = if *event_type == USER_LOGIN {
                "LOGIN"
            } else {
                "LOGOUT"
            };
            println!("  SKIPPED (duplicate): {event_name} - user {user_id}");
            continue;
        }

        // New event - enqueue and track
        let complete_link = Link::new(
            event_link.id,
            event_link.source.clone(),
            event_link.target.clone(),
        );
        queue.enqueue(complete_link).await?;
        processed_ids.insert(event_link.id);
        let event_name = if *event_type == USER_LOGIN {
            "LOGIN"
        } else {
            "LOGOUT"
        };
        println!(
            "  ENQUEUED: {} - user {} (id: {})",
            event_name, user_id, event_link.id
        );
    }

    println!("\nQueue stats:");
    let stats = queue.stats();
    println!("  Events in queue: {}", stats.depth);
    println!("  Unique events: {}", processed_ids.len());
    println!(
        "  Duplicates filtered: {}",
        events.len() - processed_ids.len()
    );

    // =========================================================================
    // Part 6: Pattern-Based Deduplication Check
    // =========================================================================

    println!("\n--- Part 6: Pattern-Based Duplicate Check ---\n");

    let mut store5 = MemoryLinkStore::<u64>::new();

    // Create some links representing API calls
    const API_CALL: u64 = 1;
    const DB_QUERY: u64 = 2;
    const USERS_ENDPOINT: u64 = 100;
    const PRODUCTS_ENDPOINT: u64 = 101;
    const ORDERS_ENDPOINT: u64 = 102;

    store5.create(LinkRef::Id(API_CALL), LinkRef::Id(USERS_ENDPOINT))?;
    store5.create(LinkRef::Id(API_CALL), LinkRef::Id(PRODUCTS_ENDPOINT))?;
    store5.create(LinkRef::Id(API_CALL), LinkRef::Id(ORDERS_ENDPOINT))?;
    store5.create(LinkRef::Id(DB_QUERY), LinkRef::Id(USERS_ENDPOINT))?;

    // Check if a specific pattern exists (deduplication check)
    let api_call_pattern = LinkPattern::with_source(LinkRef::Id(API_CALL));
    let existing_api_calls = store5.find(&api_call_pattern);
    println!("Existing API calls: {}", existing_api_calls.len());

    // Before creating a new link, check if it exists
    let new_endpoint = USERS_ENDPOINT; // This already exists!
    let existing = store5.find(&LinkPattern::with_source_target(
        LinkRef::Id(API_CALL),
        LinkRef::Id(new_endpoint),
    ));

    if existing.is_empty() {
        let new_link = store5.create(LinkRef::Id(API_CALL), LinkRef::Id(new_endpoint))?;
        println!("New API call tracked: {}", new_link.id);
    } else {
        println!(
            "API call to endpoint {} already tracked (id: {})",
            new_endpoint, existing[0].id
        );
    }

    println!("\n=== Deduplication Complete! ===");

    Ok(())
}
