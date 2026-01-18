//! Storage backend implementations for links-queue.
//!
//! This module provides various storage backends that implement the [`StorageBackend`] trait.
//! Each backend offers different tradeoffs between performance, durability, and features.
//!
//! # Available Backends
//!
//! - [`MemoryLinkStore`] - Low-level in-memory link store implementing [`LinkStore`]
//! - [`MemoryBackend`] - In-memory storage backend implementing [`StorageBackend`]
//! - [`LinkCliBackend`] - Persistent storage backend using link-cli
//!
//! # Backend Selection
//!
//! Use [`BackendRegistry`] to create backends from configuration:
//!
//! ```rust
//! use links_queue::{BackendRegistry, BackendConfig};
//!
//! let registry = BackendRegistry::<u64>::new();
//!
//! // Create memory backend (default)
//! let backend = registry.create(&BackendConfig::memory()).unwrap();
//!
//! // Create memory backend with capacity hint
//! let backend = registry.create(&BackendConfig::memory_with_capacity(10000)).unwrap();
//! ```
//!
//! # Using `StorageBackend` Directly
//!
//! ```rust
//! use links_queue::{MemoryBackend, StorageBackend, Link, LinkRef, LinkPattern};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let mut backend = MemoryBackend::<u64>::new();
//!     backend.connect().await?;
//!
//!     // Save a link
//!     let link = Link::new(0, LinkRef::Id(2), LinkRef::Id(3));
//!     let id = backend.save(link).await?;
//!     println!("Created link with ID: {}", id);
//!
//!     // Query links
//!     let results = backend.query(&LinkPattern::with_source(LinkRef::Id(2))).await?;
//!     println!("Found {} matching links", results.len());
//!
//!     backend.disconnect().await?;
//!     Ok(())
//! }
//! ```
//!
//! # Using Link-CLI Backend
//!
//! ```rust,ignore
//! use links_queue::{LinkCliBackend, LinkCliConfig, StorageBackend, Link, LinkRef};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let config = LinkCliConfig::new("./data/db.links");
//!     let mut backend = LinkCliBackend::<u64>::new(config);
//!
//!     backend.connect().await?;
//!
//!     // All operations are durable
//!     let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
//!     let id = backend.save(link).await?;
//!
//!     backend.disconnect().await?;
//!     Ok(())
//! }
//! ```
//!
//! # Custom Backends
//!
//! Implement the [`StorageBackend`] trait for custom storage:
//!
//! ```rust,ignore
//! use links_queue::{StorageBackend, Link, LinkPattern, LinkType, BackendResult};
//!
//! struct MyBackend<T: LinkType> {
//!     // ... fields
//! }
//!
//! impl<T: LinkType> StorageBackend<T> for MyBackend<T> {
//!     // ... implement required methods
//! }
//!
//! // Register with the registry
//! let mut registry = BackendRegistry::<u64>::new();
//! registry.register("my-backend", Arc::new(|config| {
//!     Ok(Box::new(MyBackend::new()) as _)
//! }));
//! ```

mod link_cli;
mod link_cli_notation;
mod link_cli_process;
mod memory;
mod memory_backend;
mod registry;
mod traits;

#[cfg(test)]
mod memory_tests;

// Re-export low-level link store
pub use memory::MemoryLinkStore;

// Re-export storage backend trait and types
pub use traits::{
    BackendCapabilities, BackendError, BackendResult, BackendStats, DurabilityLevel,
    OperationStats, StorageBackend,
};

// Re-export memory backend
pub use memory_backend::MemoryBackend;

// Re-export link-cli backend
pub use link_cli::{LinkCliBackend, LinkCliConfig};
pub use link_cli_notation::{LinksNotation, NotationParseError, NotationResult, ParsedLink};
pub use link_cli_process::{LinkCliProcess, ProcessConfig, ProcessError, ProcessResult};

// Re-export registry
pub use registry::{BackendConfig, BackendRegistry, StorageBackendDyn};
