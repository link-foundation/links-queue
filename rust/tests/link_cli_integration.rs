//! Integration tests for the link-cli backend.
//!
//! These tests require link-cli (clink) to be installed on the system.
//! Install with: `dotnet tool install --global clink`
//!
//! Run with: `cargo test --test link_cli_integration`
//!
//! To skip these tests if clink is not installed, set the environment variable:
//! `SKIP_LINK_CLI_TESTS=1`

use links_queue::{
    BackendConfig, BackendRegistry, Link, LinkCliBackend, LinkCliConfig, LinkPattern, LinkRef,
    StorageBackend,
};
use std::env;
use tempfile::tempdir;

/// Checks if clink is available in PATH.
fn clink_available() -> bool {
    std::process::Command::new("clink")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Checks if tests should be skipped.
fn should_skip_tests() -> bool {
    env::var("SKIP_LINK_CLI_TESTS").is_ok() || !clink_available()
}

/// Helper macro to skip tests if clink is not available.
macro_rules! skip_if_no_clink {
    () => {
        if should_skip_tests() {
            eprintln!("Skipping test: clink not available or SKIP_LINK_CLI_TESTS is set");
            return;
        }
    };
}

#[tokio::test]
async fn test_link_cli_backend_connect_disconnect() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let config = LinkCliConfig::new(&db_path);
    let mut backend = LinkCliBackend::<u64>::new(config);

    assert!(!backend.is_connected());

    backend.connect().await.unwrap();
    assert!(backend.is_connected());

    backend.disconnect().await.unwrap();
    assert!(!backend.is_connected());
}

#[tokio::test]
async fn test_link_cli_backend_save_and_load() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let config = LinkCliConfig::new(&db_path);
    let mut backend = LinkCliBackend::<u64>::new(config);

    backend.connect().await.unwrap();

    // Save a link
    let link = Link::new(0, LinkRef::Id(10), LinkRef::Id(20));
    let id = backend.save(link).await.unwrap();
    assert_ne!(id, 0);

    // Load it back
    let loaded = backend.load(id).await.unwrap();
    assert!(loaded.is_some());
    let loaded = loaded.unwrap();
    assert_eq!(loaded.source_id(), 10);
    assert_eq!(loaded.target_id(), 20);

    backend.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_link_cli_backend_delete() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let config = LinkCliConfig::new(&db_path);
    let mut backend = LinkCliBackend::<u64>::new(config);

    backend.connect().await.unwrap();

    // Save and delete
    let link = Link::new(0, LinkRef::Id(10), LinkRef::Id(20));
    let id = backend.save(link).await.unwrap();

    assert!(backend.delete(id).await.unwrap());
    assert!(!backend.delete(id).await.unwrap()); // Already deleted

    // Verify it's gone
    let loaded = backend.load(id).await.unwrap();
    assert!(loaded.is_none());

    backend.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_link_cli_backend_query() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let config = LinkCliConfig::new(&db_path);
    let mut backend = LinkCliBackend::<u64>::new(config);

    backend.connect().await.unwrap();

    // Save multiple links
    backend
        .save(Link::new(0, LinkRef::Id(10), LinkRef::Id(20)))
        .await
        .unwrap();
    backend
        .save(Link::new(0, LinkRef::Id(10), LinkRef::Id(30)))
        .await
        .unwrap();
    backend
        .save(Link::new(0, LinkRef::Id(20), LinkRef::Id(30)))
        .await
        .unwrap();

    // Query by source
    let results = backend
        .query(&LinkPattern::with_source(LinkRef::Id(10)))
        .await
        .unwrap();
    assert_eq!(results.len(), 2);

    // Query by target
    let results = backend
        .query(&LinkPattern::with_target(LinkRef::Id(30)))
        .await
        .unwrap();
    assert_eq!(results.len(), 2);

    // Query all
    let results = backend.query(&LinkPattern::new()).await.unwrap();
    assert_eq!(results.len(), 3);

    backend.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_link_cli_backend_persistence() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    // Create and save some links
    {
        let config = LinkCliConfig::new(&db_path);
        let mut backend = LinkCliBackend::<u64>::new(config);
        backend.connect().await.unwrap();

        backend
            .save(Link::new(0, LinkRef::Id(100), LinkRef::Id(200)))
            .await
            .unwrap();
        backend
            .save(Link::new(0, LinkRef::Id(300), LinkRef::Id(400)))
            .await
            .unwrap();

        backend.disconnect().await.unwrap();
    }

    // Reconnect and verify data persisted
    {
        let config = LinkCliConfig::new(&db_path);
        let mut backend = LinkCliBackend::<u64>::new(config);
        backend.connect().await.unwrap();

        let results = backend.query(&LinkPattern::new()).await.unwrap();
        assert_eq!(results.len(), 2);

        backend.disconnect().await.unwrap();
    }
}

#[tokio::test]
async fn test_link_cli_backend_stats() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let config = LinkCliConfig::new(&db_path);
    let mut backend = LinkCliBackend::<u64>::new(config);

    backend.connect().await.unwrap();

    backend
        .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2)))
        .await
        .unwrap();
    backend
        .save(Link::new(0, LinkRef::Id(3), LinkRef::Id(4)))
        .await
        .unwrap();

    let stats = backend.stats();
    assert!(stats.connected_at.is_some());
    assert_eq!(stats.operations.writes, 2);

    backend.disconnect().await.unwrap();
}

#[tokio::test]
async fn test_link_cli_backend_capabilities() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let config = LinkCliConfig::new(&db_path);
    let backend = LinkCliBackend::<u64>::new(config);

    let caps = backend.capabilities();
    assert!(!caps.supports_transactions);
    assert!(!caps.supports_batch_operations);
    assert_eq!(caps.durability_level, links_queue::DurabilityLevel::Fsync);
    assert!(caps.supports_pattern_queries);
}

#[tokio::test]
async fn test_link_cli_via_registry() {
    skip_if_no_clink!();

    let temp = tempdir().unwrap();
    let db_path = temp.path().join("test.links");

    let registry = BackendRegistry::<u64>::new();
    let config = BackendConfig::link_cli(db_path.to_string_lossy().to_string());

    let mut backend = registry.create(&config).unwrap();

    backend.connect_dyn().await.unwrap();
    assert!(backend.is_connected_dyn());

    let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
    let id = backend.save_dyn(link).await.unwrap();
    assert_ne!(id, 0);

    backend.disconnect_dyn().await.unwrap();
}
