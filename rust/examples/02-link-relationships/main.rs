//! Link Relationships Example for links-queue
//!
//! This example demonstrates nested links and graph structures.
//! Links Queue uses a unique link-based data model where:
//! - Each link has an id, source, and target
//! - Source and target can be IDs or nested links
//! - This allows representing complex relationships and graph structures
//!
//! Run with: `cargo run --example 02-link-relationships`

use links_queue::{Link, LinkPattern, LinkRef, MemoryQueue, Queue, QueueOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Links Queue: Link Relationships ===\n");

    // =========================================================================
    // Part 1: Basic Links as Relations
    // =========================================================================

    println!("--- Part 1: Basic Links as Relations ---\n");

    // Links naturally represent relationships (edges in a graph)
    // Link structure: (id: source -> target)

    // Example: Representing "Alice knows Bob" using IDs
    // Let's say: Alice = 1, Bob = 2
    let alice_id: u64 = 1;
    let bob_id: u64 = 2;
    let knows_relation = Link::new(100, LinkRef::Id(alice_id), LinkRef::Id(bob_id));
    println!("Alice knows Bob: {knows_relation:?}");

    // Example: Representing a typed relationship
    // "Person Alice has Name property"
    // Type IDs: Person = 1000, Name = 1001
    let person_type: u64 = 1000;
    let name_property: u64 = 1001;
    let alice_person = Link::new(101, LinkRef::Id(person_type), LinkRef::Id(alice_id));
    let alice_name = Link::new(
        102,
        LinkRef::link(alice_person.clone()),
        LinkRef::Id(name_property),
    );
    println!("Alice person link: {alice_person:?}");
    println!("Alice name link: {alice_name:?}");

    // =========================================================================
    // Part 2: Nested Links (Recursive Structures)
    // =========================================================================

    println!("\n--- Part 2: Nested Links (Recursive Structures) ---\n");

    // Links can contain other links as source or target
    // This allows representing complex, hierarchical data

    // Example: Representing a statement about a relationship
    // "The fact that Alice knows Bob was established in 2024"

    // First, the base relationship
    let alice_knows_bob = Link::new(10, LinkRef::Id(alice_id), LinkRef::Id(bob_id));

    // Then, a link about that relationship (meta-link)
    let year_2024: u64 = 2024;
    let established_in = Link::new(
        11,
        LinkRef::link(alice_knows_bob.clone()),
        LinkRef::Id(year_2024),
    );
    println!("Nested link (statement about relationship):");
    println!("  Base: {alice_knows_bob:?}");
    println!("  Meta: {established_in:?}");

    // Accessing nested data
    if established_in.source.is_link() {
        if let Some(inner) = established_in.source.as_link() {
            println!(
                "  Established relationship: {} -> {}",
                inner.source_id(),
                inner.target_id()
            );
        }
    }
    println!("  In year: {}", established_in.target_id());

    // =========================================================================
    // Part 3: Universal Links (Multiple Values)
    // =========================================================================

    println!("\n--- Part 3: Universal Links (Multiple Values) ---\n");

    // Universal links extend beyond binary relationships
    // They can have additional values array for n-ary relations

    // Example: RDF-like triple with additional metadata
    // (Subject, Predicate, Object1, Object2, ...)
    // Let's represent: Earth(10) orbits(20) Sun(30) with confidence(99)
    let subject: u64 = 10; // Earth
    let predicate: u64 = 20; // orbits
    let object: u64 = 30; // Sun
    let confidence: u64 = 99; // confidence score
    let source_id: u64 = 40; // data source

    let universal_link = Link::with_values(
        200,
        LinkRef::Id(subject),
        LinkRef::Id(predicate),
        vec![
            LinkRef::Id(object),
            LinkRef::Id(confidence),
            LinkRef::Id(source_id),
        ],
    );
    println!("Universal link (n-ary relation): {universal_link:?}");
    println!("  Subject: {}", universal_link.source_id());
    println!("  Predicate: {}", universal_link.target_id());
    println!("  Has values: {}", universal_link.has_values());
    if let Some(values) = &universal_link.values {
        println!(
            "  Values: {:?}",
            values
                .iter()
                .map(links_queue::LinkRef::get_id)
                .collect::<Vec<_>>()
        );
    }

    // =========================================================================
    // Part 4: Graph Structures
    // =========================================================================

    println!("\n--- Part 4: Graph Structures ---\n");

    // Building a simple social graph
    // Users: alice=1, bob=2, charlie=3
    let charlie_id: u64 = 3;

    let graph = vec![
        Link::new(30, LinkRef::Id(alice_id), LinkRef::Id(bob_id)), // Alice -> Bob
        Link::new(31, LinkRef::Id(bob_id), LinkRef::Id(charlie_id)), // Bob -> Charlie
        Link::new(32, LinkRef::Id(alice_id), LinkRef::Id(charlie_id)), // Alice -> Charlie
        Link::new(33, LinkRef::Id(charlie_id), LinkRef::Id(alice_id)), // Charlie -> Alice (cycle)
    ];

    println!("Social graph edges:");
    for link in &graph {
        println!("  {} -> {}", link.source_id(), link.target_id());
    }

    // Find all connections from Alice using pattern matching
    let alice_pattern = LinkPattern::with_source(LinkRef::Id(alice_id));
    let alice_connections: Vec<_> = graph.iter().filter(|l| alice_pattern.matches(l)).collect();
    println!("\nAlice (1) is connected to:");
    for link in &alice_connections {
        println!("  {}", link.target_id());
    }

    // Find all connections to Charlie
    let charlie_incoming_pattern = LinkPattern::with_target(LinkRef::Id(charlie_id));
    let charlie_incoming: Vec<_> = graph
        .iter()
        .filter(|l| charlie_incoming_pattern.matches(l))
        .collect();
    println!("\nCharlie (3) receives connections from:");
    for link in &charlie_incoming {
        println!("  {}", link.source_id());
    }

    // =========================================================================
    // Part 5: Using Links in a Queue
    // =========================================================================

    println!("\n--- Part 5: Processing Graph Operations via Queue ---\n");

    let queue = MemoryQueue::<u64>::new("graph-operations", QueueOptions::default());

    // Define operation types as IDs
    const ADD_EDGE: u64 = 1;
    const REMOVE_EDGE: u64 = 2;
    const QUERY: u64 = 3;

    // Queue up some graph operations as links
    // Operation link: (op_id: operation_type -> edge_link)
    let edge1 = Link::new(101, LinkRef::Id(100), LinkRef::Id(200)); // node100 -> node200
    let edge2 = Link::new(102, LinkRef::Id(200), LinkRef::Id(300)); // node200 -> node300

    let operations = vec![
        Link::new(1001, LinkRef::Id(ADD_EDGE), LinkRef::link(edge1.clone())),
        Link::new(1002, LinkRef::Id(ADD_EDGE), LinkRef::link(edge2.clone())),
        Link::new(1003, LinkRef::Id(QUERY), LinkRef::Id(100)), // Query from node 100
        Link::new(1004, LinkRef::Id(REMOVE_EDGE), LinkRef::link(edge1)),
    ];

    // Enqueue operations
    for op in &operations {
        queue.enqueue(op.clone()).await?;
        let op_type = match op.source_id() {
            ADD_EDGE => "ADD_EDGE",
            REMOVE_EDGE => "REMOVE_EDGE",
            QUERY => "QUERY",
            _ => "UNKNOWN",
        };
        let op_data = if op.target.is_link() {
            if let Some(edge) = op.target.as_link() {
                format!("{}->{}", edge.source_id(), edge.target_id())
            } else {
                "?".to_string()
            }
        } else {
            format!("node {}", op.target_id())
        };
        println!("Queued: {op_type} {op_data}");
    }

    // Process operations
    println!("\nProcessing operations:");
    while let Some(item) = queue.dequeue().await? {
        let operation = item.source_id();
        match operation {
            ADD_EDGE => {
                if let Some(edge) = item.target.as_link() {
                    println!("  ADD: {} -> {}", edge.source_id(), edge.target_id());
                }
            }
            REMOVE_EDGE => {
                if let Some(edge) = item.target.as_link() {
                    println!("  REMOVE: {} -> {}", edge.source_id(), edge.target_id());
                }
            }
            QUERY => {
                println!("  QUERY: from node {}", item.target_id());
            }
            _ => {
                println!("  UNKNOWN: {operation}");
            }
        }
        queue.acknowledge(item.id).await?;
    }

    println!("\n=== Link Relationships Complete! ===");

    Ok(())
}
