//! Web framework integrations for links-queue.
//!
//! This module provides integrations with popular Rust web frameworks,
//! making it easy to add queue functionality to web applications.
//!
//! # Available Integrations
//!
//! - **Axum** (`axum` feature): Layer and extractors for Axum web framework
//! - **Actix-web** (`actix` feature): Middleware and extractors for Actix-web
//!
//! # Example with Axum
//!
//! ```rust,ignore
//! use axum::{Router, routing::post};
//! use links_queue::integrations::axum::{LinksQueueLayer, LinksQueue};
//!
//! let app = Router::new()
//!     .route("/enqueue", post(enqueue_handler))
//!     .layer(LinksQueueLayer::new());
//!
//! async fn enqueue_handler(queue: LinksQueue) -> impl IntoResponse {
//!     // Use the queue...
//! }
//! ```
//!
//! # Example with Actix-web
//!
//! ```rust,ignore
//! use actix_web::{web, App, HttpServer};
//! use links_queue::integrations::actix::{LinksQueueMiddleware, LinksQueue};
//!
//! HttpServer::new(|| {
//!     App::new()
//!         .wrap(LinksQueueMiddleware::new())
//!         .route("/enqueue", web::post().to(enqueue_handler))
//! })
//! ```

#[cfg(feature = "axum")]
pub mod axum;

#[cfg(feature = "actix")]
pub mod actix;
