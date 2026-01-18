//! TCP client library for Links Queue.
//!
//! This module provides a client library for connecting to a Links Queue server
//! and performing queue operations over the network.
//!
//! # Overview
//!
//! - [`LinksQueueClient`] - Main client for connecting to a server
//! - [`ClientConfig`] - Configuration for the client (timeouts, reconnection)
//! - [`Subscription`] - Async stream for receiving queue updates
//!
//! # Example
//!
//! ```rust,ignore
//! use links_queue::client::{LinksQueueClient, ClientConfig};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let client = LinksQueueClient::connect("tcp://localhost:5000").await?;
//!
//!     // Queue operations over network
//!     client.create_queue("tasks", Default::default()).await?;
//!
//!     // Enqueue a link
//!     client.enqueue("tasks", (1, 2)).await?;
//!
//!     // Dequeue and process
//!     if let Some(link) = client.dequeue("tasks").await? {
//!         println!("Received: {:?}", link);
//!         client.acknowledge("tasks", link.id).await?;
//!     }
//!
//!     client.disconnect().await?;
//!     Ok(())
//! }
//! ```
//!
//! # Subscriptions
//!
//! ```rust,ignore
//! use links_queue::client::LinksQueueClient;
//!
//! async fn subscribe_example() -> Result<(), Box<dyn std::error::Error>> {
//!     let client = LinksQueueClient::connect("tcp://localhost:5000").await?;
//!
//!     // Subscribe to queue updates
//!     let mut subscription = client.subscribe("tasks").await?;
//!
//!     while let Some(link) = subscription.next().await {
//!         println!("Received: {:?}", link);
//!         client.acknowledge("tasks", link.id).await?;
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! # References
//!
//! - [ARCHITECTURE.md](../../../ARCHITECTURE.md) - Client/Server architecture
//! - [REQUIREMENTS.md](../../../REQUIREMENTS.md) - REQ-PROTO-020 through REQ-PROTO-022

mod connection;
mod traits;

#[cfg(test)]
mod tests;

pub use connection::{ClientConnection, ConnectionState as ClientConnectionState};
pub use traits::{
    ClientConfig, ClientError, ClientErrorCode, ClientResult, EnqueueResult, LinksQueueClient,
    QueueInfo, Subscription,
};
