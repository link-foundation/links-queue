//! Health check module for links-queue.
//!
//! Provides liveness and readiness endpoints with component health details,
//! compatible with Kubernetes health probes.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Health status values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HealthStatus {
    Healthy,
    Unhealthy,
    Degraded,
    Unknown,
}

impl HealthStatus {
    /// Returns the string representation.
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Unhealthy => "unhealthy",
            Self::Degraded => "degraded",
            Self::Unknown => "unknown",
        }
    }
}

impl std::fmt::Display for HealthStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl Default for HealthStatus {
    fn default() -> Self {
        Self::Unknown
    }
}

/// Component health check result.
#[derive(Debug, Clone)]
pub struct ComponentHealth {
    /// Health status.
    pub status: HealthStatus,
    /// Response latency in milliseconds.
    pub latency: Option<u64>,
    /// Additional message.
    pub message: Option<String>,
    /// Additional details.
    pub details: HashMap<String, serde_json::Value>,
}

impl ComponentHealth {
    /// Creates a healthy result.
    #[must_use]
    pub fn healthy() -> Self {
        Self {
            status: HealthStatus::Healthy,
            latency: None,
            message: None,
            details: HashMap::new(),
        }
    }

    /// Creates an unhealthy result.
    #[must_use]
    pub fn unhealthy(message: impl Into<String>) -> Self {
        Self {
            status: HealthStatus::Unhealthy,
            latency: None,
            message: Some(message.into()),
            details: HashMap::new(),
        }
    }

    /// Creates a degraded result.
    #[must_use]
    pub fn degraded(message: impl Into<String>) -> Self {
        Self {
            status: HealthStatus::Degraded,
            latency: None,
            message: Some(message.into()),
            details: HashMap::new(),
        }
    }

    /// Sets the latency.
    #[must_use]
    pub const fn with_latency(mut self, latency_ms: u64) -> Self {
        self.latency = Some(latency_ms);
        self
    }

    /// Adds a detail field.
    #[must_use]
    pub fn with_detail(
        mut self,
        key: impl Into<String>,
        value: impl Into<serde_json::Value>,
    ) -> Self {
        self.details.insert(key.into(), value.into());
        self
    }

    /// Converts to JSON.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        let mut obj = serde_json::Map::new();
        obj.insert(
            "status".to_string(),
            serde_json::json!(self.status.as_str()),
        );

        if let Some(latency) = self.latency {
            obj.insert("latency".to_string(), serde_json::json!(latency));
        }
        if let Some(ref msg) = self.message {
            obj.insert("message".to_string(), serde_json::json!(msg));
        }
        if !self.details.is_empty() {
            obj.insert("details".to_string(), serde_json::json!(self.details));
        }

        serde_json::Value::Object(obj)
    }
}

/// Overall health check result.
#[derive(Debug, Clone)]
pub struct HealthCheckResult {
    /// Overall health status.
    pub status: HealthStatus,
    /// Check timestamp (milliseconds since Unix epoch).
    pub timestamp: u64,
    /// Application version.
    pub version: String,
    /// Uptime in milliseconds.
    pub uptime: u64,
    /// Whether the service is ready.
    pub ready: bool,
    /// Whether the service is alive.
    pub alive: bool,
    /// Component health results.
    pub components: HashMap<String, ComponentHealth>,
}

impl HealthCheckResult {
    /// Converts to JSON.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        let mut components = serde_json::Map::new();
        for (name, health) in &self.components {
            components.insert(name.clone(), health.to_json());
        }

        serde_json::json!({
            "status": self.status.as_str(),
            "timestamp": self.timestamp,
            "version": self.version,
            "uptime": self.uptime,
            "ready": self.ready,
            "alive": self.alive,
            "components": components
        })
    }
}

/// Type alias for health check function.
pub type HealthCheckFn =
    Box<dyn Fn() -> Pin<Box<dyn Future<Output = ComponentHealth> + Send>> + Send + Sync>;

/// A component health checker.
pub struct ComponentChecker {
    name: String,
    check: HealthCheckFn,
    critical: bool,
    timeout: Duration,
}

impl ComponentChecker {
    /// Creates a new ComponentChecker.
    pub fn new<F, Fut>(name: impl Into<String>, check: F) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ComponentHealth> + Send + 'static,
    {
        Self {
            name: name.into(),
            check: Box::new(move || Box::pin(check())),
            critical: true,
            timeout: Duration::from_secs(5),
        }
    }

    /// Sets whether this component is critical.
    #[must_use]
    pub fn with_critical(mut self, critical: bool) -> Self {
        self.critical = critical;
        self
    }

    /// Sets the check timeout.
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Gets the component name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Gets whether this component is critical.
    #[must_use]
    pub fn is_critical(&self) -> bool {
        self.critical
    }

    /// Runs the health check.
    pub async fn check(&self) -> ComponentHealth {
        let start = Instant::now();

        let check_future = (self.check)();

        // Use tokio timeout
        match tokio::time::timeout(self.timeout, check_future).await {
            Ok(result) => result.with_latency(start.elapsed().as_millis() as u64),
            Err(_) => ComponentHealth::unhealthy("Health check timeout")
                .with_latency(start.elapsed().as_millis() as u64),
        }
    }
}

/// Health checker for links-queue.
pub struct HealthChecker {
    version: String,
    start_time: Instant,
    components: Arc<RwLock<HashMap<String, ComponentChecker>>>,
    ready: Arc<RwLock<bool>>,
    alive: Arc<RwLock<bool>>,
}

impl HealthChecker {
    /// Creates a new HealthChecker.
    #[must_use]
    pub fn new(version: impl Into<String>) -> Self {
        Self {
            version: version.into(),
            start_time: Instant::now(),
            components: Arc::new(RwLock::new(HashMap::new())),
            ready: Arc::new(RwLock::new(false)),
            alive: Arc::new(RwLock::new(true)),
        }
    }

    /// Gets the uptime in milliseconds.
    #[must_use]
    pub fn uptime(&self) -> u64 {
        self.start_time.elapsed().as_millis() as u64
    }

    /// Sets the liveness state.
    pub fn set_alive(&self, alive: bool) {
        if let Ok(mut a) = self.alive.write() {
            *a = alive;
        }
    }

    /// Sets the readiness state.
    pub fn set_ready(&self, ready: bool) {
        if let Ok(mut r) = self.ready.write() {
            *r = ready;
        }
    }

    /// Gets the alive state.
    #[must_use]
    pub fn is_alive(&self) -> bool {
        self.alive.read().map(|a| *a).unwrap_or(false)
    }

    /// Gets the ready state.
    #[must_use]
    pub fn is_ready(&self) -> bool {
        self.ready.read().map(|r| *r).unwrap_or(false)
    }

    /// Registers a component health checker.
    pub fn register_component(&self, checker: ComponentChecker) {
        if let Ok(mut components) = self.components.write() {
            components.insert(checker.name.clone(), checker);
        }
    }

    /// Unregisters a component.
    pub fn unregister_component(&self, name: &str) -> bool {
        if let Ok(mut components) = self.components.write() {
            components.remove(name).is_some()
        } else {
            false
        }
    }

    /// Checks liveness.
    #[must_use]
    pub fn check_alive(&self) -> LivenessResult {
        let alive = self.alive.read().map(|a| *a).unwrap_or(false);
        LivenessResult {
            status: if alive {
                HealthStatus::Healthy
            } else {
                HealthStatus::Unhealthy
            },
            timestamp: current_timestamp(),
        }
    }

    /// Checks readiness.
    pub async fn check_ready(&self) -> ReadinessResult {
        let ready = self.ready.read().map(|r| *r).unwrap_or(false);

        if !ready {
            return ReadinessResult {
                status: HealthStatus::Unhealthy,
                timestamp: current_timestamp(),
                message: Some("Service not ready".to_string()),
                component: None,
            };
        }

        // Check critical components
        let components = self.components.read().ok();
        if let Some(components) = components {
            for (name, checker) in components.iter() {
                if checker.is_critical() {
                    let result = checker.check().await;
                    if result.status == HealthStatus::Unhealthy {
                        return ReadinessResult {
                            status: HealthStatus::Unhealthy,
                            timestamp: current_timestamp(),
                            message: Some(format!("Critical component {} is unhealthy", name)),
                            component: Some(name.clone()),
                        };
                    }
                }
            }
        }

        ReadinessResult {
            status: HealthStatus::Healthy,
            timestamp: current_timestamp(),
            message: None,
            component: None,
        }
    }

    /// Gets detailed health status for all components.
    pub async fn get_health_details(&self) -> HealthCheckResult {
        let mut component_results = HashMap::new();
        let mut overall_status = HealthStatus::Healthy;
        let mut has_degraded = false;

        // Check all components
        let components = self.components.read().ok();
        if let Some(components) = components {
            for (name, checker) in components.iter() {
                let result = checker.check().await;

                if result.status == HealthStatus::Unhealthy {
                    if checker.is_critical() {
                        overall_status = HealthStatus::Unhealthy;
                    } else {
                        has_degraded = true;
                    }
                } else if result.status == HealthStatus::Degraded {
                    has_degraded = true;
                }

                component_results.insert(name.clone(), result);
            }
        }

        // If not unhealthy but has degraded components
        if overall_status == HealthStatus::Healthy && has_degraded {
            overall_status = HealthStatus::Degraded;
        }

        // Check basic liveness/readiness
        let alive = self.alive.read().map(|a| *a).unwrap_or(false);
        let ready = self.ready.read().map(|r| *r).unwrap_or(false);

        if !alive {
            overall_status = HealthStatus::Unhealthy;
        } else if !ready && overall_status == HealthStatus::Healthy {
            overall_status = HealthStatus::Degraded;
        }

        HealthCheckResult {
            status: overall_status,
            timestamp: current_timestamp(),
            version: self.version.clone(),
            uptime: self.uptime(),
            ready,
            alive,
            components: component_results,
        }
    }

    /// Registers a backend health check.
    pub fn register_backend<F, Fut>(&self, name: &str, check: F, critical: bool)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ComponentHealth> + Send + 'static,
    {
        let checker = ComponentChecker::new(name, check).with_critical(critical);
        self.register_component(checker);
    }

    /// Registers a simple sync check as a component.
    pub fn register_sync_check<F>(&self, name: &str, check: F, critical: bool)
    where
        F: Fn() -> ComponentHealth + Send + Sync + 'static,
    {
        let check = Arc::new(check);
        let checker = ComponentChecker::new(name, move || {
            let check = Arc::clone(&check);
            async move { check() }
        })
        .with_critical(critical);
        self.register_component(checker);
    }
}

impl Default for HealthChecker {
    fn default() -> Self {
        Self::new("0.0.0")
    }
}

impl Clone for HealthChecker {
    fn clone(&self) -> Self {
        Self {
            version: self.version.clone(),
            start_time: self.start_time,
            components: Arc::clone(&self.components),
            ready: Arc::clone(&self.ready),
            alive: Arc::clone(&self.alive),
        }
    }
}

/// Liveness check result.
#[derive(Debug, Clone)]
pub struct LivenessResult {
    pub status: HealthStatus,
    pub timestamp: u64,
}

impl LivenessResult {
    /// Converts to JSON.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "status": self.status.as_str(),
            "timestamp": self.timestamp
        })
    }
}

/// Readiness check result.
#[derive(Debug, Clone)]
pub struct ReadinessResult {
    pub status: HealthStatus,
    pub timestamp: u64,
    pub message: Option<String>,
    pub component: Option<String>,
}

impl ReadinessResult {
    /// Converts to JSON.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        let mut obj = serde_json::Map::new();
        obj.insert(
            "status".to_string(),
            serde_json::json!(self.status.as_str()),
        );
        obj.insert("timestamp".to_string(), serde_json::json!(self.timestamp));

        if let Some(ref msg) = self.message {
            obj.insert("message".to_string(), serde_json::json!(msg));
        }
        if let Some(ref comp) = self.component {
            obj.insert("component".to_string(), serde_json::json!(comp));
        }

        serde_json::Value::Object(obj)
    }
}

/// Gets the current timestamp in milliseconds.
fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_status() {
        assert_eq!(HealthStatus::Healthy.as_str(), "healthy");
        assert_eq!(HealthStatus::Unhealthy.as_str(), "unhealthy");
        assert_eq!(HealthStatus::Degraded.as_str(), "degraded");
        assert_eq!(HealthStatus::Unknown.as_str(), "unknown");
    }

    #[test]
    fn test_component_health() {
        let health = ComponentHealth::healthy()
            .with_latency(10)
            .with_detail("connections", 5);

        assert_eq!(health.status, HealthStatus::Healthy);
        assert_eq!(health.latency, Some(10));
        assert!(health.details.contains_key("connections"));
    }

    #[test]
    fn test_component_health_unhealthy() {
        let health = ComponentHealth::unhealthy("Connection failed");

        assert_eq!(health.status, HealthStatus::Unhealthy);
        assert_eq!(health.message, Some("Connection failed".to_string()));
    }

    #[test]
    fn test_health_checker_basic() {
        let checker = HealthChecker::new("1.0.0");

        assert!(!checker.is_ready());
        assert!(checker.is_alive());

        checker.set_ready(true);
        assert!(checker.is_ready());

        checker.set_alive(false);
        assert!(!checker.is_alive());
    }

    #[test]
    fn test_liveness_result() {
        let checker = HealthChecker::new("1.0.0");
        let result = checker.check_alive();

        assert_eq!(result.status, HealthStatus::Healthy);
        assert!(result.timestamp > 0);
    }

    #[test]
    fn test_liveness_result_unhealthy() {
        let checker = HealthChecker::new("1.0.0");
        checker.set_alive(false);
        let result = checker.check_alive();

        assert_eq!(result.status, HealthStatus::Unhealthy);
    }

    #[test]
    fn test_health_check_result_json() {
        let result = HealthCheckResult {
            status: HealthStatus::Healthy,
            timestamp: 1234567890,
            version: "1.0.0".to_string(),
            uptime: 60000,
            ready: true,
            alive: true,
            components: HashMap::new(),
        };

        let json = result.to_json();
        assert_eq!(json["status"], "healthy");
        assert_eq!(json["version"], "1.0.0");
        assert_eq!(json["uptime"], 60000);
    }

    #[test]
    fn test_register_sync_check() {
        let checker = HealthChecker::new("1.0.0");

        checker.register_sync_check("test", || ComponentHealth::healthy(), true);

        let components = checker.components.read().unwrap();
        assert!(components.contains_key("test"));
        assert!(components.get("test").unwrap().is_critical());
    }
}
