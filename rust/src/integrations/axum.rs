//! Axum integration for links-queue.
//!
//! This module provides middleware and extractors for using links-queue
//! with the Axum web framework.
//!
//! # Features
//!
//! - [`LinksQueueLayer`]: Tower layer for adding queue functionality
//! - [`LinksQueue`]: Extractor for accessing the queue manager in handlers
//! - [`create_queue_router`]: Pre-built router with `RESTful` queue endpoints
//!
//! # Quick Start
//!
//! ```rust,ignore
//! use axum::{Router, routing::post, Json};
//! use links_queue::integrations::axum::{LinksQueueLayer, LinksQueue, create_queue_router};
//! use serde_json::Value;
//!
//! #[tokio::main]
//! async fn main() {
//!     let app = Router::new()
//!         .route("/enqueue/:queue", post(enqueue_handler))
//!         .nest("/api/queues", create_queue_router())
//!         .layer(LinksQueueLayer::new());
//!
//!     let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
//!     axum::serve(listener, app).await.unwrap();
//! }
//!
//! async fn enqueue_handler(
//!     queue: LinksQueue,
//!     axum::extract::Path(queue_name): axum::extract::Path<String>,
//!     Json(payload): Json<Value>,
//! ) -> impl axum::response::IntoResponse {
//!     // Access queue operations via the extractor
//!     let manager = queue.manager();
//!     // ...
//! }
//! ```

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::extract::{FromRequestParts, Path, State};
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower::{Layer, Service};

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
        let mut opts = Self::new();
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
// LinksQueue State
// =============================================================================

/// Shared state for the links-queue integration.
#[derive(Debug, Clone)]
pub struct LinksQueueState {
    /// The queue manager instance.
    manager: Arc<MemoryQueueManager<u64>>,
}

impl LinksQueueState {
    /// Creates a new state with a fresh queue manager.
    #[must_use]
    pub fn new() -> Self {
        Self {
            manager: Arc::new(MemoryQueueManager::new()),
        }
    }

    /// Creates a new state with the provided queue manager.
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

impl Default for LinksQueueState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// LinksQueue Extractor
// =============================================================================

/// Axum extractor for accessing the links-queue manager.
///
/// This extractor provides access to the queue manager in route handlers.
///
/// # Example
///
/// ```rust,ignore
/// use axum::Json;
/// use links_queue::integrations::axum::LinksQueue;
///
/// async fn list_queues(queue: LinksQueue) -> impl IntoResponse {
///     let queues = queue.manager().list_queues().await.unwrap();
///     Json(queues)
/// }
/// ```
#[derive(Debug, Clone)]
pub struct LinksQueue {
    state: LinksQueueState,
}

impl LinksQueue {
    /// Returns a reference to the queue manager.
    #[must_use]
    pub fn manager(&self) -> &MemoryQueueManager<u64> {
        self.state.manager()
    }
}

impl<S> FromRequestParts<S> for LinksQueue
where
    S: Send + Sync,
    LinksQueueState: FromRequestParts<S>,
{
    type Rejection = <LinksQueueState as FromRequestParts<S>>::Rejection;

    fn from_request_parts<'life0, 'life1, 'async_trait>(
        parts: &'life0 mut axum::http::request::Parts,
        state: &'life1 S,
    ) -> Pin<Box<dyn Future<Output = Result<Self, Self::Rejection>> + Send + 'async_trait>>
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        Self: 'async_trait,
    {
        Box::pin(async move {
            let queue_state = LinksQueueState::from_request_parts(parts, state).await?;
            Ok(Self { state: queue_state })
        })
    }
}

// =============================================================================
// LinksQueueLayer
// =============================================================================

/// Tower layer for adding links-queue functionality to an Axum application.
///
/// This layer adds the queue manager to the request extensions, making it
/// available to route handlers via the [`LinksQueue`] extractor.
///
/// # Example
///
/// ```rust,ignore
/// use axum::Router;
/// use links_queue::integrations::axum::LinksQueueLayer;
///
/// let app = Router::new()
///     .route("/api/queues", get(list_queues))
///     .layer(LinksQueueLayer::new());
/// ```
#[derive(Debug, Clone)]
pub struct LinksQueueLayer {
    state: LinksQueueState,
}

impl LinksQueueLayer {
    /// Creates a new layer with a default queue manager.
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: LinksQueueState::new(),
        }
    }

    /// Creates a new layer with the provided queue manager.
    #[must_use]
    pub fn with_manager(manager: MemoryQueueManager<u64>) -> Self {
        Self {
            state: LinksQueueState::with_manager(manager),
        }
    }
}

impl Default for LinksQueueLayer {
    fn default() -> Self {
        Self::new()
    }
}

impl<S> Layer<S> for LinksQueueLayer {
    type Service = LinksQueueService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        LinksQueueService {
            inner,
            state: self.state.clone(),
        }
    }
}

/// Tower service that adds links-queue state to requests.
#[derive(Debug, Clone)]
pub struct LinksQueueService<S> {
    inner: S,
    state: LinksQueueState,
}

impl<S, ReqBody> Service<Request<ReqBody>> for LinksQueueService<S>
where
    S: Service<Request<ReqBody>> + Clone + Send + 'static,
    S::Future: Send,
    ReqBody: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut req: Request<ReqBody>) -> Self::Future {
        // Insert the queue state into request extensions
        req.extensions_mut().insert(self.state.clone());

        let future = self.inner.call(req);
        Box::pin(future)
    }
}

// =============================================================================
// Router Factory
// =============================================================================

/// Creates a router with `RESTful` queue endpoints.
///
/// # Endpoints
///
/// - `GET /` - List all queues
/// - `POST /` - Create a new queue
/// - `GET /:name` - Get queue info
/// - `DELETE /:name` - Delete a queue
/// - `GET /:name/stats` - Get queue statistics
/// - `POST /:name/messages` - Enqueue a message
/// - `GET /:name/messages` - Dequeue a message
/// - `GET /:name/messages/peek` - Peek at next message
/// - `POST /:name/messages/:id/ack` - Acknowledge a message
/// - `POST /:name/messages/:id/reject` - Reject a message
///
/// # Example
///
/// ```rust,ignore
/// use axum::Router;
/// use links_queue::integrations::axum::{LinksQueueLayer, create_queue_router};
///
/// let app = Router::new()
///     .nest("/api/queues", create_queue_router())
///     .layer(LinksQueueLayer::new());
/// ```
pub fn create_queue_router() -> Router<LinksQueueState> {
    Router::new()
        .route("/", get(list_queues_handler))
        .route("/", post(create_queue_handler))
        .route("/{name}", get(get_queue_handler))
        .route("/{name}", delete(delete_queue_handler))
        .route("/{name}/stats", get(get_stats_handler))
        .route("/{name}/messages", post(enqueue_handler))
        .route("/{name}/messages", get(dequeue_handler))
        .route("/{name}/messages/peek", get(peek_handler))
        .route("/{name}/messages/{id}/ack", post(ack_handler))
        .route("/{name}/messages/{id}/reject", post(reject_handler))
}

// =============================================================================
// Route Handlers
// =============================================================================

async fn list_queues_handler(
    State(state): State<LinksQueueState>,
) -> Result<Json<Vec<QueueInfoResponse>>, (StatusCode, Json<ErrorResponse>)> {
    let queues = state.manager().list_queues().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    Ok(Json(
        queues
            .into_iter()
            .map(|q| QueueInfoResponse {
                name: q.name,
                depth: q.depth,
                created_at: q.created_at,
            })
            .collect(),
    ))
}

async fn create_queue_handler(
    State(state): State<LinksQueueState>,
    Json(req): Json<CreateQueueRequest>,
) -> Result<(StatusCode, Json<QueueInfoResponse>), (StatusCode, Json<ErrorResponse>)> {
    let options = req.options.map(Into::into).unwrap_or_default();
    let queue = state
        .manager()
        .create_queue(&req.name, options)
        .await
        .map_err(|e| {
            let status = match e.code {
                crate::QueueErrorCode::QueueAlreadyExists => StatusCode::CONFLICT,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (
                status,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?;

    Ok((
        StatusCode::CREATED,
        Json(QueueInfoResponse {
            name: queue.name().to_string(),
            depth: queue.stats().depth,
            created_at: queue.created_at(),
        }),
    ))
}

async fn get_queue_handler(
    State(state): State<LinksQueueState>,
    Path(name): Path<String>,
) -> Result<Json<QueueInfoResponse>, (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{name}' not found"),
                }),
            )
        })?;

    Ok(Json(QueueInfoResponse {
        name: queue.name().to_string(),
        depth: queue.stats().depth,
        created_at: queue.created_at(),
    }))
}

async fn delete_queue_handler(
    State(state): State<LinksQueueState>,
    Path(name): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let deleted = state.manager().delete_queue(&name).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                code: "QUEUE_NOT_FOUND".to_string(),
                message: format!("Queue '{name}' not found"),
            }),
        ))
    }
}

async fn get_stats_handler(
    State(state): State<LinksQueueState>,
    Path(name): Path<String>,
) -> Result<Json<QueueStatsResponse>, (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{name}' not found"),
                }),
            )
        })?;

    let queue_stats = queue.stats();
    Ok(Json(QueueStatsResponse {
        name: name.clone(),
        depth: queue_stats.depth,
        enqueued: queue_stats.enqueued,
        dequeued: queue_stats.dequeued,
        acknowledged: queue_stats.acknowledged,
        rejected: queue_stats.rejected,
        in_flight: queue_stats.in_flight,
    }))
}

async fn enqueue_handler(
    State(state): State<LinksQueueState>,
    Path(name): Path<String>,
    Json(req): Json<EnqueueRequest>,
) -> Result<(StatusCode, Json<EnqueueResponse>), (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{name}' not found"),
                }),
            )
        })?;

    let link = if let Some(values) = req.values {
        Link::with_values(
            0u64, // ID will be assigned by the queue
            LinkRef::Id(req.source),
            LinkRef::Id(req.target),
            values.into_iter().map(LinkRef::Id).collect(),
        )
    } else {
        Link::new(0u64, LinkRef::Id(req.source), LinkRef::Id(req.target))
    };

    let result = queue.enqueue(link).await.map_err(|e| {
        let status = match e.code {
            crate::QueueErrorCode::QueueFull => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(EnqueueResponse {
            id: result.id,
            position: result.position,
        }),
    ))
}

async fn dequeue_handler(
    State(state): State<LinksQueueState>,
    Path(name): Path<String>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{name}' not found"),
                }),
            )
        })?;

    let message = queue.dequeue().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    match message {
        Some(link) => Ok(Json(MessageResponse {
            id: link.id,
            source: link.source_id(),
            target: link.target_id(),
            values: link.values.as_ref().map(|vals| {
                vals.iter()
                    .map(super::super::traits::LinkRef::get_id)
                    .collect()
            }),
        })
        .into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

async fn peek_handler(
    State(state): State<LinksQueueState>,
    Path(name): Path<String>,
) -> Result<Response, (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{name}' not found"),
                }),
            )
        })?;

    let message = queue.peek().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    match message {
        Some(link) => Ok(Json(MessageResponse {
            id: link.id,
            source: link.source_id(),
            target: link.target_id(),
            values: link.values.as_ref().map(|vals| {
                vals.iter()
                    .map(super::super::traits::LinkRef::get_id)
                    .collect()
            }),
        })
        .into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

#[derive(Deserialize)]
struct MessagePath {
    name: String,
    id: u64,
}

async fn ack_handler(
    State(state): State<LinksQueueState>,
    Path(path): Path<MessagePath>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&path.name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{}' not found", path.name),
                }),
            )
        })?;

    queue.acknowledge(path.id).await.map_err(|e| {
        let status = match e.code {
            crate::QueueErrorCode::ItemNotFound | crate::QueueErrorCode::ItemNotInFlight => {
                StatusCode::NOT_FOUND
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RejectRequest {
    #[serde(default)]
    requeue: bool,
}

async fn reject_handler(
    State(state): State<LinksQueueState>,
    Path(path): Path<MessagePath>,
    Json(req): Json<RejectRequest>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let queue = state
        .manager()
        .get_queue(&path.name)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    code: format!("{}", e.code),
                    message: e.message,
                }),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    code: "QUEUE_NOT_FOUND".to_string(),
                    message: format!("Queue '{}' not found", path.name),
                }),
            )
        })?;

    queue.reject(path.id, req.requeue).await.map_err(|e| {
        let status = match e.code {
            crate::QueueErrorCode::ItemNotFound | crate::QueueErrorCode::ItemNotInFlight => {
                StatusCode::NOT_FOUND
            }
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                code: format!("{}", e.code),
                message: e.message,
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
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
    fn test_links_queue_state_default() {
        let state = LinksQueueState::default();
        assert_eq!(state.manager().queue_count(), 0);
    }

    #[test]
    fn test_links_queue_layer_default() {
        let layer = LinksQueueLayer::default();
        assert_eq!(layer.state.manager().queue_count(), 0);
    }
}
