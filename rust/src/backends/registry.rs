//! Backend registry for links-queue.
//!
//! This module provides a registry for storage backend implementations,
//! allowing backends to be registered and instantiated by name via configuration.
//!
//! # Design
//!
//! The registry uses type-erased factory functions to allow dynamic backend
//! creation without requiring trait objects for the backends themselves.
//!
//! # Example
//!
//! ```rust
//! use links_queue::{BackendRegistry, MemoryBackend, BackendConfig};
//!
//! // Create a registry
//! let mut registry = BackendRegistry::<u64>::new();
//!
//! // Built-in "memory" backend is pre-registered
//! assert!(registry.has("memory"));
//!
//! // Create a backend from config
//! let backend = registry.create(&BackendConfig::memory()).unwrap();
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use crate::LinkType;

use super::memory_backend::MemoryBackend;
use super::traits::{BackendError, BackendResult, StorageBackend};

// =============================================================================
// Backend Configuration
// =============================================================================

/// Configuration for backend creation.
///
/// This struct holds the backend type name and any type-specific options
/// needed to create a backend instance.
///
/// # Example
///
/// ```rust
/// use links_queue::BackendConfig;
///
/// // Memory backend (default)
/// let config = BackendConfig::memory();
///
/// // Memory backend with capacity hint
/// let config = BackendConfig::memory_with_capacity(10000);
///
/// // Custom backend
/// let config = BackendConfig::new("my-custom")
///     .with_option("host", "localhost")
///     .with_option("port", "6379");
/// ```
#[derive(Debug, Clone)]
pub struct BackendConfig {
    /// The backend type name.
    pub backend_type: String,

    /// Type-specific options as key-value pairs.
    pub options: HashMap<String, String>,
}

impl BackendConfig {
    /// Creates a new backend configuration.
    ///
    /// # Arguments
    ///
    /// * `backend_type` - The name of the backend type
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::BackendConfig;
    ///
    /// let config = BackendConfig::new("redis");
    /// ```
    #[must_use]
    pub fn new(backend_type: impl Into<String>) -> Self {
        Self {
            backend_type: backend_type.into(),
            options: HashMap::new(),
        }
    }

    /// Creates a configuration for the memory backend.
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::BackendConfig;
    ///
    /// let config = BackendConfig::memory();
    /// ```
    #[must_use]
    pub fn memory() -> Self {
        Self::new("memory")
    }

    /// Creates a configuration for the memory backend with a capacity hint.
    ///
    /// # Arguments
    ///
    /// * `capacity` - Initial capacity for the link storage
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::BackendConfig;
    ///
    /// let config = BackendConfig::memory_with_capacity(10000);
    /// ```
    #[must_use]
    pub fn memory_with_capacity(capacity: usize) -> Self {
        Self::new("memory").with_option("capacity", capacity.to_string())
    }

    /// Adds an option to the configuration (builder pattern).
    ///
    /// # Arguments
    ///
    /// * `key` - Option name
    /// * `value` - Option value
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::BackendConfig;
    ///
    /// let config = BackendConfig::new("redis")
    ///     .with_option("host", "localhost")
    ///     .with_option("port", "6379");
    /// ```
    #[must_use]
    pub fn with_option(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.options.insert(key.into(), value.into());
        self
    }

    /// Gets an option value.
    ///
    /// # Arguments
    ///
    /// * `key` - Option name
    ///
    /// # Returns
    ///
    /// The option value if present.
    #[must_use]
    pub fn get_option(&self, key: &str) -> Option<&str> {
        self.options.get(key).map(String::as_str)
    }
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self::memory()
    }
}

// =============================================================================
// Backend Factory
// =============================================================================

/// Type alias for backend factory functions.
///
/// Factory functions create a boxed backend from a configuration.
type BackendFactory<T> =
    Arc<dyn Fn(&BackendConfig) -> BackendResult<T, Box<dyn StorageBackendDyn<T>>> + Send + Sync>;

/// Object-safe version of `StorageBackend` for use with registry.
///
/// This trait allows storing backends as trait objects while maintaining
/// the async interface through boxed futures.
#[allow(clippy::type_complexity)]
pub trait StorageBackendDyn<T: LinkType>: Send + Sync {
    /// Connects to the backend.
    fn connect_dyn(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, ()>> + Send + '_>>;

    /// Disconnects from the backend.
    fn disconnect_dyn(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, ()>> + Send + '_>>;

    /// Checks if connected.
    fn is_connected_dyn(&self) -> bool;

    /// Saves a link.
    fn save_dyn(
        &mut self,
        link: crate::Link<T>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, T>> + Send + '_>>;

    /// Loads a link.
    fn load_dyn(
        &self,
        id: T,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = BackendResult<T, Option<crate::Link<T>>>> + Send + '_>,
    >;

    /// Deletes a link.
    fn delete_dyn(
        &mut self,
        id: T,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, bool>> + Send + '_>>;

    /// Queries links.
    fn query_dyn<'a>(
        &'a self,
        pattern: &'a crate::LinkPattern<T>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = BackendResult<T, Vec<crate::Link<T>>>> + Send + 'a>,
    >;

    /// Returns capabilities.
    fn capabilities_dyn(&self) -> super::traits::BackendCapabilities;

    /// Returns stats.
    fn stats_dyn(&self) -> super::traits::BackendStats;
}

impl<T: LinkType, B: StorageBackend<T> + 'static> StorageBackendDyn<T> for B {
    fn connect_dyn(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, ()>> + Send + '_>>
    {
        Box::pin(self.connect())
    }

    fn disconnect_dyn(
        &mut self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, ()>> + Send + '_>>
    {
        Box::pin(self.disconnect())
    }

    fn is_connected_dyn(&self) -> bool {
        self.is_connected()
    }

    fn save_dyn(
        &mut self,
        link: crate::Link<T>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, T>> + Send + '_>> {
        Box::pin(self.save(link))
    }

    fn load_dyn(
        &self,
        id: T,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = BackendResult<T, Option<crate::Link<T>>>> + Send + '_>,
    > {
        Box::pin(self.load(id))
    }

    fn delete_dyn(
        &mut self,
        id: T,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = BackendResult<T, bool>> + Send + '_>>
    {
        Box::pin(self.delete(id))
    }

    fn query_dyn<'a>(
        &'a self,
        pattern: &'a crate::LinkPattern<T>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = BackendResult<T, Vec<crate::Link<T>>>> + Send + 'a>,
    > {
        Box::pin(self.query(pattern))
    }

    fn capabilities_dyn(&self) -> super::traits::BackendCapabilities {
        self.capabilities()
    }

    fn stats_dyn(&self) -> super::traits::BackendStats {
        self.stats()
    }
}

// =============================================================================
// Backend Registry
// =============================================================================

/// Registry for storage backend implementations.
///
/// The registry allows backends to be registered by name and created
/// from configuration. Built-in backends (like `memory`) are pre-registered.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`])
///
/// # Example
///
/// ```rust
/// use links_queue::{BackendRegistry, BackendConfig, MemoryBackend};
///
/// let mut registry = BackendRegistry::<u64>::new();
///
/// // Memory backend is pre-registered
/// let backend = registry.create(&BackendConfig::memory()).unwrap();
///
/// // List available backends
/// for name in registry.list_types() {
///     println!("Available: {}", name);
/// }
/// ```
pub struct BackendRegistry<T: LinkType> {
    /// Map of backend names to factory functions.
    factories: HashMap<String, BackendFactory<T>>,
}

impl<T: LinkType + 'static> Default for BackendRegistry<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: LinkType + 'static> BackendRegistry<T> {
    /// Creates a new backend registry with built-in backends registered.
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::BackendRegistry;
    ///
    /// let registry = BackendRegistry::<u64>::new();
    /// assert!(registry.has("memory"));
    /// ```
    #[must_use]
    pub fn new() -> Self {
        let mut registry = Self {
            factories: HashMap::new(),
        };

        // Register built-in memory backend
        registry.register_memory_backend();

        registry
    }

    /// Registers the built-in memory backend.
    fn register_memory_backend(&mut self) {
        self.factories.insert(
            "memory".to_string(),
            Arc::new(|config: &BackendConfig| {
                let capacity = config
                    .get_option("capacity")
                    .and_then(|s| s.parse::<usize>().ok());

                let backend =
                    capacity.map_or_else(MemoryBackend::new, MemoryBackend::with_capacity);

                Ok(Box::new(backend) as Box<dyn StorageBackendDyn<T>>)
            }),
        );
    }

    /// Registers a custom backend factory.
    ///
    /// # Arguments
    ///
    /// * `name` - The name to register the backend under
    /// * `factory` - A function that creates backend instances from config
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::{BackendRegistry, BackendConfig, MemoryBackend};
    /// use std::sync::Arc;
    ///
    /// let mut registry = BackendRegistry::<u64>::new();
    ///
    /// // Register a custom backend factory
    /// registry.register("custom", Arc::new(|config: &BackendConfig| {
    ///     Ok(Box::new(MemoryBackend::<u64>::new()) as _)
    /// }));
    /// ```
    pub fn register<F>(&mut self, name: impl Into<String>, factory: Arc<F>)
    where
        F: Fn(&BackendConfig) -> BackendResult<T, Box<dyn StorageBackendDyn<T>>>
            + Send
            + Sync
            + 'static,
    {
        self.factories.insert(name.into(), factory);
    }

    /// Unregisters a backend.
    ///
    /// # Arguments
    ///
    /// * `name` - The name of the backend to unregister
    ///
    /// # Returns
    ///
    /// True if the backend was unregistered, false if it wasn't registered.
    pub fn unregister(&mut self, name: &str) -> bool {
        self.factories.remove(name).is_some()
    }

    /// Checks if a backend is registered.
    ///
    /// # Arguments
    ///
    /// * `name` - The backend name to check
    ///
    /// # Returns
    ///
    /// True if registered.
    #[must_use]
    pub fn has(&self, name: &str) -> bool {
        self.factories.contains_key(name)
    }

    /// Creates a backend instance from configuration.
    ///
    /// # Arguments
    ///
    /// * `config` - Backend configuration
    ///
    /// # Returns
    ///
    /// A boxed backend instance.
    ///
    /// # Errors
    ///
    /// Returns an error if the backend type is not registered or creation fails.
    ///
    /// # Example
    ///
    /// ```rust
    /// use links_queue::{BackendRegistry, BackendConfig};
    ///
    /// let registry = BackendRegistry::<u64>::new();
    /// let backend = registry.create(&BackendConfig::memory()).unwrap();
    /// ```
    pub fn create(
        &self,
        config: &BackendConfig,
    ) -> BackendResult<T, Box<dyn StorageBackendDyn<T>>> {
        let factory = self.factories.get(&config.backend_type).ok_or_else(|| {
            BackendError::Other(format!(
                "Unknown backend type: \"{}\". Available types: {}",
                config.backend_type,
                self.list_types().join(", ")
            ))
        })?;

        factory(config)
    }

    /// Lists all registered backend types.
    ///
    /// # Returns
    ///
    /// Vector of registered backend type names.
    #[must_use]
    pub fn list_types(&self) -> Vec<String> {
        self.factories.keys().cloned().collect()
    }

    /// Resets the registry to default state (only built-in backends).
    pub fn reset(&mut self) {
        self.factories.clear();
        self.register_memory_backend();
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_config_new() {
        let config = BackendConfig::new("test");
        assert_eq!(config.backend_type, "test");
        assert!(config.options.is_empty());
    }

    #[test]
    fn test_backend_config_memory() {
        let config = BackendConfig::memory();
        assert_eq!(config.backend_type, "memory");
    }

    #[test]
    fn test_backend_config_with_capacity() {
        let config = BackendConfig::memory_with_capacity(1000);
        assert_eq!(config.backend_type, "memory");
        assert_eq!(config.get_option("capacity"), Some("1000"));
    }

    #[test]
    fn test_backend_config_with_option() {
        let config = BackendConfig::new("redis")
            .with_option("host", "localhost")
            .with_option("port", "6379");

        assert_eq!(config.get_option("host"), Some("localhost"));
        assert_eq!(config.get_option("port"), Some("6379"));
        assert_eq!(config.get_option("nonexistent"), None);
    }

    #[test]
    fn test_registry_new() {
        let registry = BackendRegistry::<u64>::new();
        assert!(registry.has("memory"));
    }

    #[test]
    fn test_registry_create_memory() {
        let registry = BackendRegistry::<u64>::new();
        let result = registry.create(&BackendConfig::memory());
        assert!(result.is_ok());
    }

    #[test]
    fn test_registry_create_unknown() {
        let registry = BackendRegistry::<u64>::new();
        let result = registry.create(&BackendConfig::new("nonexistent"));
        assert!(result.is_err());
    }

    #[test]
    fn test_registry_list_types() {
        let registry = BackendRegistry::<u64>::new();
        let types = registry.list_types();
        assert!(types.contains(&"memory".to_string()));
    }

    #[test]
    fn test_registry_unregister() {
        let mut registry = BackendRegistry::<u64>::new();
        assert!(registry.has("memory"));
        assert!(registry.unregister("memory"));
        assert!(!registry.has("memory"));
        assert!(!registry.unregister("memory")); // Already unregistered
    }

    #[test]
    fn test_registry_reset() {
        let mut registry = BackendRegistry::<u64>::new();
        registry.unregister("memory");
        assert!(!registry.has("memory"));

        registry.reset();
        assert!(registry.has("memory"));
    }

    #[tokio::test]
    async fn test_created_backend_works() {
        let registry = BackendRegistry::<u64>::new();
        let mut backend = registry.create(&BackendConfig::memory()).unwrap();

        backend.connect_dyn().await.unwrap();
        assert!(backend.is_connected_dyn());

        let link = crate::Link::new(0, crate::LinkRef::Id(1), crate::LinkRef::Id(2));
        let id = backend.save_dyn(link).await.unwrap();
        assert_ne!(id, 0);

        let loaded = backend.load_dyn(id).await.unwrap();
        assert!(loaded.is_some());

        backend.disconnect_dyn().await.unwrap();
    }
}
