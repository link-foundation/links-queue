//! TCP server module for Links Queue.
//!
//! This module provides a TCP server that allows Links Queue to run as a standalone
//! service. Clients can connect and perform queue operations over the network using
//! the Links Notation protocol.
//!
//! # Overview
//!
//! - [`LinksQueueServer`] - Main TCP server that accepts client connections
//! - [`ServerConfig`] - Configuration for the server (host, port, backend, limits)
//! - [`Connection`] - Represents a client connection with request/response handling
//! - [`Router`] - Routes incoming requests to appropriate queue operations
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::server::{LinksQueueServer, ServerConfig};
//! use links_queue::BackendConfig;
//! use std::time::Duration;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let config = ServerConfig::new("0.0.0.0".to_string(), 5000)
//!         .with_backend(BackendConfig::memory())
//!         .with_max_connections(1000)
//!         .with_idle_timeout(Duration::from_secs(60));
//!
//!     let server = LinksQueueServer::new(config);
//!
//!     server.on_connection(|client| {
//!         println!("Client connected: {}", client.id());
//!     });
//!
//!     server.start().await?;
//!     println!("Server listening on port 5000");
//!
//!     // Graceful shutdown
//!     tokio::select! {
//!         _ = tokio::signal::ctrl_c() => {
//!             server.shutdown(Duration::from_secs(30)).await?;
//!         }
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! # Protocol
//!
//! The server uses Links Notation for message framing:
//! - Each message is length-prefixed (4 bytes big-endian)
//! - Request format: `{"op": "enqueue", "queue": "tasks", "link": "(1 2)"}`
//! - Response format: `{"ok": true, "result": ...}` or `{"ok": false, "error": ...}`
//!
//! # References
//!
//! - [ARCHITECTURE.md](../../../ARCHITECTURE.md) - Deployment Patterns
//! - [REQUIREMENTS.md](../../../REQUIREMENTS.md) - REQ-PROTO-020 through REQ-PROTO-022
//! - [ROADMAP.md](../../../ROADMAP.md) - Phase 5: Server Mode

mod connection;
mod router;
mod traits;

#[cfg(test)]
mod tests;

pub use connection::{Connection, ConnectionId, ConnectionInfo, ConnectionState};
pub use router::{LinkData, Operation, Request, Response, ResponseData, Router};
pub use traits::{
    LinksQueueServer, ServerConfig, ServerError, ServerErrorCode, ServerEvent, ServerResult,
    ServerStats,
};
