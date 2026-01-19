//! Actix-web integration for links-queue.
//!
//! This module provides middleware and extractors for using links-queue
//! with the Actix-web framework.
//!
//! # Features
//!
//! - [`LinksQueueMiddleware`]: Middleware for adding queue functionality
//! - [`LinksQueue`]: Extractor for accessing the queue manager in handlers
//! - [`configure_queue_routes`]: Configure RESTful queue endpoints
//!
//! # Quick Start
//!
//! ```rust,ignore
//! use actix_web::{web, App, HttpServer};
//! use links_queue::integrations::actix::{LinksQueueMiddleware, LinksQueue, configure_queue_routes};
//!
//! #[actix_web::main]
//! async fn main() -> std::io::Result<()> {
//!     let queue_data = LinksQueueMiddleware::new_data();
//!
//!     HttpServer::new(move || {
//!         App::new()
//!             .app_data(queue_data.clone())
//!             .configure(configure_queue_routes)
//!             .route("/enqueue/{queue}", web::post().to(enqueue_handler))
//!     })
//!     .bind("0.0.0.0:8080")?
//!     .run()
//!     .await
//! }
//!
//! async fn enqueue_handler(queue: LinksQueue) -> impl actix_web::Responder {
//!     // Access queue operations via the extractor
//!     let manager = queue.manager();
//!     // ...
//!     actix_web::HttpResponse::Ok()
//! }
//! ```

use std::sync::Arc;

use actix_web::web::{self, Data, Json, Path};
use actix_web::{HttpResponse, Responder};
use serde::{Deserialize, Serialize};

use crate::{Link, LinkRef, MemoryQueueManager, Queue, QueueManager, QueueOptions};

// =============================================================================
// Serialization Types
// =============================================================================

/// Request body for creating a queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateQueueRequest {
    /// Queue name.
    pub name: String,
    /// Optional queue options.
    #[serde(default)]
    pub options: Option<QueueOptionsDto>,
}

/// Queue options DTO for serialization.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueueOptionsDto {
    /// Maximum queue size.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_size: Option<usize>,
    /// Visibility timeout in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility_timeout: Option<u64>,
    /// Maximum retry attempts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_limit: Option<u32>,
    /// Dead letter queue name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dead_letter_queue: Option<String>,
    /// Enable priority ordering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<bool>,
}

impl From<QueueOptionsDto> for QueueOptions {
    fn from(dto: QueueOptionsDto) -> Self {
        let mut opts = QueueOptions::new();
        if let Some(v) = dto.max_size {
            opts = opts.with_max_size(v);
        }
        if let Some(v) = dto.visibility_timeout {
            opts = opts.with_visibility_timeout(v);
        }
        if let Some(v) = dto.retry_limit {
            opts = opts.with_retry_limit(v);
        }
        if let Some(v) = dto.dead_letter_queue {
            opts = opts.with_dead_letter_queue(v);
        }
        if let Some(v) = dto.priority {
            opts = opts.with_priority(v);
        }
        opts
    }
}

/// Response for queue info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueInfoResponse {
    /// Queue name.
    pub name: String,
    /// Current queue depth.
    pub depth: usize,
    /// Creation timestamp.
    pub created_at: u64,
}

/// Response for queue statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStatsResponse {
    /// Queue name.
    pub name: String,
    /// Current depth.
    pub depth: usize,
    /// Total enqueued.
    pub enqueued: usize,
    /// Total dequeued.
    pub dequeued: usize,
    /// Total acknowledged.
    pub acknowledged: usize,
    /// Total rejected.
    pub rejected: usize,
    /// Currently in-flight.
    pub in_flight: usize,
}

/// Request body for enqueueing a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnqueueRequest {
    /// Source ID for the link.
    pub source: u64,
    /// Target ID for the link.
    pub target: u64,
    /// Optional additional values.
    #[serde(default)]
    pub values: Option<Vec<u64>>,
}

/// Response for enqueue operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnqueueResponse {
    /// The assigned message ID.
    pub id: u64,
    /// Position in the queue.
    pub position: usize,
}

/// Response for a dequeued message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResponse {
    /// Message ID.
    pub id: u64,
    /// Source ID.
    pub source: u64,
    /// Target ID.
    pub target: u64,
    /// Additional values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<u64>>,
}

/// Error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
    /// Error code.
    pub code: String,
    /// Error message.
    pub message: String,
}

// =============================================================================
// LinksQueue Data
// =============================================================================

/// Shared data for the links-queue integration.
#[derive(Debug, Clone)]
pub struct LinksQueueData {
    /// The queue manager instance.
    manager: Arc<MemoryQueueManager<u64>>,
}

impl LinksQueueData {
    /// Creates a new data with a fresh queue manager.
    #[must_use]
    pub fn new() -> Self {
        Self {
            manager: Arc::new(MemoryQueueManager::new()),
        }
    }

    /// Creates a new data with the provided queue manager.
    #[must_use]
    pub fn with_manager(manager: MemoryQueueManager<u64>) -> Self {
        Self {
            manager: Arc::new(manager),
        }
    }

    /// Returns a reference to the queue manager.
    #[must_use]
    pub fn manager(&self) -> &MemoryQueueManager<u64> {
        &self.manager
    }
}

impl Default for LinksQueueData {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// LinksQueue Extractor
// =============================================================================

/// Actix-web extractor for accessing the links-queue manager.
///
/// This extractor provides access to the queue manager in route handlers.
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::{web::Json, Responder};
/// use links_queue::integrations::actix::LinksQueue;
///
/// async fn list_queues(queue: LinksQueue) -> impl Responder {
///     let queues = queue.manager().list_queues().await.unwrap();
///     Json(queues)
/// }
/// ```
#[derive(Debug, Clone)]
pub struct LinksQueue {
    data: LinksQueueData,
}

impl LinksQueue {
    /// Returns a reference to the queue manager.
    #[must_use]
    pub fn manager(&self) -> &MemoryQueueManager<u64> {
        self.data.manager()
    }
}

impl actix_web::FromRequest for LinksQueue {
    type Error = actix_web::Error;
    type Future = std::future::Ready<Result<Self, Self::Error>>;

    fn from_request(
        req: &actix_web::HttpRequest,
        _payload: &mut actix_web::dev::Payload,
    ) -> Self::Future {
        match req.app_data::<Data<LinksQueueData>>() {
            Some(data) => std::future::ready(Ok(Self {
                data: data.get_ref().clone(),
            })),
            None => std::future::ready(Err(actix_web::error::ErrorInternalServerError(
                "LinksQueueData not configured. Did you forget to add app_data?",
            ))),
        }
    }
}

// =============================================================================
// LinksQueueMiddleware
// =============================================================================

/// Middleware helper for adding links-queue functionality to an Actix-web application.
///
/// This is a convenience struct that provides methods to create the necessary
/// app data for the queue integration.
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::{App, HttpServer};
/// use links_queue::integrations::actix::LinksQueueMiddleware;
///
/// let queue_data = LinksQueueMiddleware::new_data();
///
/// HttpServer::new(move || {
///     App::new()
///         .app_data(queue_data.clone())
///         .route("/api/queues", web::get().to(list_queues))
/// })
/// ```
pub struct LinksQueueMiddleware;

impl LinksQueueMiddleware {
    /// Creates a new `Data<LinksQueueData>` with a default queue manager.
    #[must_use]
    pub fn new_data() -> Data<LinksQueueData> {
        Data::new(LinksQueueData::new())
    }

    /// Creates a new `Data<LinksQueueData>` with the provided queue manager.
    #[must_use]
    pub fn with_manager(manager: MemoryQueueManager<u64>) -> Data<LinksQueueData> {
        Data::new(LinksQueueData::with_manager(manager))
    }
}

// =============================================================================
// Route Configuration
// =============================================================================

/// Configures RESTful queue routes for an Actix-web application.
///
/// # Routes
///
/// - `GET /queues` - List all queues
/// - `POST /queues` - Create a new queue
/// - `GET /queues/{name}` - Get queue info
/// - `DELETE /queues/{name}` - Delete a queue
/// - `GET /queues/{name}/stats` - Get queue statistics
/// - `POST /queues/{name}/messages` - Enqueue a message
/// - `GET /queues/{name}/messages` - Dequeue a message
/// - `GET /queues/{name}/messages/peek` - Peek at next message
/// - `POST /queues/{name}/messages/{id}/ack` - Acknowledge a message
/// - `POST /queues/{name}/messages/{id}/reject` - Reject a message
///
/// # Example
///
/// ```rust,ignore
/// use actix_web::{App, HttpServer};
/// use links_queue::integrations::actix::{LinksQueueMiddleware, configure_queue_routes};
///
/// let queue_data = LinksQueueMiddleware::new_data();
///
/// HttpServer::new(move || {
///     App::new()
///         .app_data(queue_data.clone())
///         .configure(configure_queue_routes)
/// })
/// ```
pub fn configure_queue_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/queues")
            .route("", web::get().to(list_queues_handler))
            .route("", web::post().to(create_queue_handler))
            .route("/{name}", web::get().to(get_queue_handler))
            .route("/{name}", web::delete().to(delete_queue_handler))
            .route("/{name}/stats", web::get().to(get_stats_handler))
            .route("/{name}/messages", web::post().to(enqueue_handler))
            .route("/{name}/messages", web::get().to(dequeue_handler))
            .route("/{name}/messages/peek", web::get().to(peek_handler))
            .route("/{name}/messages/{id}/ack", web::post().to(ack_handler))
            .route(
                "/{name}/messages/{id}/reject",
                web::post().to(reject_handler),
            ),
    );
}

// =============================================================================
// Route Handlers
// =============================================================================

async fn list_queues_handler(queue: LinksQueue) -> impl Responder {
    match queue.manager().list_queues().await {
        Ok(queues) => HttpResponse::Ok().json(
            queues
                .into_iter()
                .map(|q| QueueInfoResponse {
                    name: q.name,
                    depth: q.depth,
                    created_at: q.created_at,
                })
                .collect::<Vec<_>>(),
        ),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

async fn create_queue_handler(queue: LinksQueue, req: Json<CreateQueueRequest>) -> impl Responder {
    let options = req.options.clone().map(Into::into).unwrap_or_default();
    match queue.manager().create_queue(&req.name, options).await {
        Ok(q) => HttpResponse::Created().json(QueueInfoResponse {
            name: q.name().to_string(),
            depth: q.stats().depth,
            created_at: q.created_at(),
        }),
        Err(e) => {
            let mut status = match e.code {
                crate::QueueErrorCode::QueueAlreadyExists => HttpResponse::Conflict(),
                _ => HttpResponse::InternalServerError(),
            };
            status.json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            })
        }
    }
}

async fn get_queue_handler(queue: LinksQueue, path: Path<String>) -> impl Responder {
    let name = path.into_inner();
    match queue.manager().get_queue(&name).await {
        Ok(Some(q)) => HttpResponse::Ok().json(QueueInfoResponse {
            name: q.name().to_string(),
            depth: q.stats().depth,
            created_at: q.created_at(),
        }),
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

async fn delete_queue_handler(queue: LinksQueue, path: Path<String>) -> impl Responder {
    let name = path.into_inner();
    match queue.manager().delete_queue(&name).await {
        Ok(true) => HttpResponse::NoContent().finish(),
        Ok(false) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

async fn get_stats_handler(queue: LinksQueue, path: Path<String>) -> impl Responder {
    let name = path.into_inner();
    match queue.manager().get_queue(&name).await {
        Ok(Some(q)) => {
            let stats = q.stats();
            HttpResponse::Ok().json(QueueStatsResponse {
                name: name.clone(),
                depth: stats.depth,
                enqueued: stats.enqueued,
                dequeued: stats.dequeued,
                acknowledged: stats.acknowledged,
                rejected: stats.rejected,
                in_flight: stats.in_flight,
            })
        }
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

async fn enqueue_handler(
    queue: LinksQueue,
    path: Path<String>,
    req: Json<EnqueueRequest>,
) -> impl Responder {
    let name = path.into_inner();
    match queue.manager().get_queue(&name).await {
        Ok(Some(q)) => {
            let link = if let Some(ref values) = req.values {
                Link::with_values(
                    0u64,
                    LinkRef::Id(req.source),
                    LinkRef::Id(req.target),
                    values.iter().map(|&v| LinkRef::Id(v)).collect(),
                )
            } else {
                Link::new(0u64, LinkRef::Id(req.source), LinkRef::Id(req.target))
            };

            match q.enqueue(link).await {
                Ok(result) => HttpResponse::Created().json(EnqueueResponse {
                    id: result.id,
                    position: result.position,
                }),
                Err(e) => {
                    let mut status = match e.code {
                        crate::QueueErrorCode::QueueFull => HttpResponse::ServiceUnavailable(),
                        _ => HttpResponse::InternalServerError(),
                    };
                    status.json(ErrorResponse {
                        code: format!("{}", e.code),
                        message: e.message,
                    })
                }
            }
        }
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

async fn dequeue_handler(queue: LinksQueue, path: Path<String>) -> impl Responder {
    let name = path.into_inner();
    match queue.manager().get_queue(&name).await {
        Ok(Some(q)) => match q.dequeue().await {
            Ok(Some(link)) => HttpResponse::Ok().json(MessageResponse {
                id: link.id,
                source: link.source_id(),
                target: link.target_id(),
                values: link.values.as_ref().map(|vals| vals.iter().map(|v| v.get_id()).collect()),
            }),
            Ok(None) => HttpResponse::NoContent().finish(),
            Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        },
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

async fn peek_handler(queue: LinksQueue, path: Path<String>) -> impl Responder {
    let name = path.into_inner();
    match queue.manager().get_queue(&name).await {
        Ok(Some(q)) => match q.peek().await {
            Ok(Some(link)) => HttpResponse::Ok().json(MessageResponse {
                id: link.id,
                source: link.source_id(),
                target: link.target_id(),
                values: link.values.as_ref().map(|vals| vals.iter().map(|v| v.get_id()).collect()),
            }),
            Ok(None) => HttpResponse::NoContent().finish(),
            Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        },
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

#[derive(Deserialize)]
struct MessagePath {
    name: String,
    id: u64,
}

async fn ack_handler(queue: LinksQueue, path: Path<MessagePath>) -> impl Responder {
    let path = path.into_inner();
    match queue.manager().get_queue(&path.name).await {
        Ok(Some(q)) => match q.acknowledge(path.id).await {
            Ok(()) => HttpResponse::NoContent().finish(),
            Err(e) => {
                let mut status = match e.code {
                    crate::QueueErrorCode::ItemNotFound
                    | crate::QueueErrorCode::ItemNotInFlight => HttpResponse::NotFound(),
                    _ => HttpResponse::InternalServerError(),
                };
                status.json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", path.name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

#[derive(Deserialize)]
struct RejectRequest {
    #[serde(default)]
    requeue: bool,
}

async fn reject_handler(
    queue: LinksQueue,
    path: Path<MessagePath>,
    req: Json<RejectRequest>,
) -> impl Responder {
    let path = path.into_inner();
    match queue.manager().get_queue(&path.name).await {
        Ok(Some(q)) => match q.reject(path.id, req.requeue).await {
            Ok(()) => HttpResponse::NoContent().finish(),
            Err(e) => {
                let mut status = match e.code {
                    crate::QueueErrorCode::ItemNotFound
                    | crate::QueueErrorCode::ItemNotInFlight => HttpResponse::NotFound(),
                    _ => HttpResponse::InternalServerError(),
                };
                status.json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                })
            }
        },
        Ok(None) => HttpResponse::NotFound().json(ErrorResponse {
            code: "QUEUE_NOT_FOUND".to_string(),
            message: format!("Queue '{}' not found", path.name),
        }),
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            code: format!("{}", e.code),
            message: e.message,
        }),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_options_dto_conversion() {
        let dto = QueueOptionsDto {
            max_size: Some(1000),
            visibility_timeout: Some(60),
            retry_limit: Some(5),
            dead_letter_queue: Some("dlq".to_string()),
            priority: Some(true),
        };

        let options: QueueOptions = dto.into();
        assert_eq!(options.max_size, Some(1000));
        assert_eq!(options.visibility_timeout, Some(60));
        assert_eq!(options.retry_limit, Some(5));
        assert_eq!(options.dead_letter_queue, Some("dlq".to_string()));
        assert_eq!(options.priority, Some(true));
    }

    #[test]
    fn test_links_queue_data_default() {
        let data = LinksQueueData::default();
        assert_eq!(data.manager().queue_count(), 0);
    }

    #[test]
    fn test_links_queue_middleware_new_data() {
        let data = LinksQueueMiddleware::new_data();
        assert_eq!(data.manager().queue_count(), 0);
    }
}
