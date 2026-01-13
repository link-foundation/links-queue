//! Storage backend implementations for links-queue.
//!
//! This module provides various storage backends that implement the [`LinkStore`] trait.
//! Each backend offers different tradeoffs between performance, durability, and features.
//!
//! # Available Backends
//!
//! - [`MemoryLinkStore`] - In-memory storage with O(1) lookups, ideal for testing and development.
//!
//! # Example
//!
//! ```rust
//! use links_queue::{MemoryLinkStore, LinkStore, LinkRef, LinkPattern};
//!
//! let mut store = MemoryLinkStore::<u64>::new();
//!
//! // Create a link
//! let link = store.create(LinkRef::Id(2), LinkRef::Id(3)).unwrap();
//! println!("Created link: {:?}", link);
//!
//! // Find links by pattern
//! let results = store.find(&LinkPattern::with_source(LinkRef::Id(2)));
//! assert_eq!(results.len(), 1);
//! ```

mod memory;

pub use memory::MemoryLinkStore;
