//! Link-CLI storage backend implementing [`StorageBackend`].
//!
//! This module provides [`LinkCliBackend`], a persistent storage backend that
//! communicates with link-cli (clink) for durable link storage.
//!
//! # Features
//!
//! - **Persistent storage**: Data is stored in a SQLite-like database file
//! - **Process isolation**: Link-cli runs as a separate process
//! - **Automatic recovery**: Handles process crashes with restart capability
//! - **Links Notation**: Uses the standard Links Notation protocol
//!
//! # Requirements
//!
//! Link-cli must be installed on the system:
//! ```bash
//! dotnet tool install --global clink
//! ```
//!
//! # Example
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
//!     println!("Saved link with ID: {}", id);
//!
//!     backend.disconnect().await?;
//!     Ok(())
//! }
//! ```
//!
//! # See Also
//!
//! - [`MemoryBackend`](super::MemoryBackend) - In-memory backend for comparison
//! - [link-cli](https://github.com/link-foundation/link-cli) - The link-cli tool

use std::fmt::Display;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{Link, LinkPattern, LinkRef, LinkType, PatternField};

use super::link_cli_notation::{LinksNotation, ParsedLink};
use super::link_cli_process::{LinkCliProcess, ProcessConfig, ProcessError};
use super::traits::{
    BackendCapabilities, BackendError, BackendResult, BackendStats, DurabilityLevel,
    OperationStats, StorageBackend,
};

// =============================================================================
// Link CLI Configuration
// =============================================================================

/// Configuration for the link-cli backend.
///
/// # Example
///
/// ```rust,ignore
/// use links_queue::LinkCliConfig;
/// use std::path::PathBuf;
///
/// let config = LinkCliConfig::new("./data/db.links")
///     .with_binary_path("/usr/bin/clink")
///     .with_timeout(10_000);
/// ```
#[derive(Debug, Clone)]
pub struct LinkCliConfig {
    /// Path to the database file.
    pub path: PathBuf,

    /// Path to the link-cli binary (None for default "clink").
    pub binary_path: Option<PathBuf>,

    /// Command timeout in milliseconds.
    pub timeout_ms: u64,

    /// Whether to auto-restart on process crash.
    pub auto_restart: bool,
}

impl LinkCliConfig {
    /// Creates a new configuration with the given database path.
    ///
    /// # Arguments
    ///
    /// * `path` - Path to the database file
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::LinkCliConfig;
    ///
    /// let config = LinkCliConfig::new("./data/db.links");
    /// ```
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            binary_path: None,
            timeout_ms: 30_000,
            auto_restart: true,
        }
    }

    /// Sets a custom binary path for link-cli.
    #[must_use]
    pub fn with_binary_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.binary_path = Some(path.into());
        self
    }

    /// Sets the command timeout in milliseconds.
    #[must_use]
    pub const fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms;
        self
    }

    /// Sets whether to auto-restart on crash.
    #[must_use]
    pub const fn with_auto_restart(mut self, auto_restart: bool) -> Self {
        self.auto_restart = auto_restart;
        self
    }

    /// Converts to process configuration.
    fn to_process_config(&self) -> ProcessConfig {
        let mut config = ProcessConfig::new(&self.path)
            .with_timeout(self.timeout_ms)
            .with_auto_restart(self.auto_restart);

        if let Some(ref binary) = self.binary_path {
            config = config.with_binary_path(binary);
        }

        config
    }
}

impl Default for LinkCliConfig {
    fn default() -> Self {
        Self::new("db.links")
    }
}

// =============================================================================
// Link CLI Backend
// =============================================================================

/// Link-CLI storage backend implementing [`StorageBackend`].
///
/// This backend communicates with link-cli (clink) to provide persistent
/// storage for links. Data is stored in a SQLite-like database file.
///
/// # Type Parameters
///
/// * `T` - The link ID type (must implement [`LinkType`], [`FromStr`], and [`Display`])
///
/// # Thread Safety
///
/// `LinkCliBackend` is `Send + Sync`. The underlying process communication
/// is protected by internal mutexes.
///
/// # Example
///
/// ```rust,ignore
/// use links_queue::{LinkCliBackend, LinkCliConfig, StorageBackend, Link, LinkRef};
///
/// #[tokio::main]
/// async fn main() {
///     let config = LinkCliConfig::new("./data/db.links");
///     let mut backend = LinkCliBackend::<u64>::new(config);
///
///     backend.connect().await.unwrap();
///
///     let link = Link::new(0, LinkRef::Id(1), LinkRef::Id(2));
///     let id = backend.save(link).await.unwrap();
///
///     let stats = backend.stats();
///     println!("Total links: {}", stats.total_links);
/// }
/// ```
pub struct LinkCliBackend<T: LinkType> {
    /// Backend configuration.
    config: LinkCliConfig,

    /// The link-cli process manager.
    process: LinkCliProcess,

    /// Whether the backend is connected.
    connected: bool,

    /// Timestamp when connected (Unix millis).
    connected_at: Option<u64>,

    /// Operation statistics.
    stats: OperationStats,

    /// In-memory cache for link count (refreshed on operations).
    cached_link_count: usize,

    /// Type marker.
    _marker: std::marker::PhantomData<T>,
}

impl<T: LinkType> std::fmt::Debug for LinkCliBackend<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LinkCliBackend")
            .field("config", &self.config)
            .field("connected", &self.connected)
            .field("connected_at", &self.connected_at)
            .field("stats", &self.stats)
            .field("cached_link_count", &self.cached_link_count)
            .finish_non_exhaustive()
    }
}

impl<T: LinkType + FromStr + Display> LinkCliBackend<T> {
    /// Creates a new link-cli backend with the given configuration.
    ///
    /// # Arguments
    ///
    /// * `config` - Backend configuration
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// use links_queue::{LinkCliBackend, LinkCliConfig};
    ///
    /// let config = LinkCliConfig::new("./data/db.links");
    /// let backend = LinkCliBackend::<u64>::new(config);
    /// ```
    #[must_use]
    pub fn new(config: LinkCliConfig) -> Self {
        let process = LinkCliProcess::new(config.to_process_config());
        Self {
            config,
            process,
            connected: false,
            connected_at: None,
            stats: OperationStats::default(),
            cached_link_count: 0,
            _marker: std::marker::PhantomData,
        }
    }

    /// Gets the backend configuration.
    #[must_use]
    pub const fn config(&self) -> &LinkCliConfig {
        &self.config
    }

    /// Gets the current Unix timestamp in milliseconds.
    #[allow(clippy::cast_possible_truncation)]
    fn current_time_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Ensures the backend is connected.
    const fn ensure_connected(&self) -> BackendResult<T, ()> {
        if self.connected {
            Ok(())
        } else {
            Err(BackendError::NotConnected)
        }
    }

    /// Converts a process error to a backend error.
    fn map_process_error(err: ProcessError) -> BackendError<T> {
        match err {
            ProcessError::NotRunning => BackendError::NotConnected,
            ProcessError::BinaryNotFound(path) => {
                BackendError::ConnectionFailed(format!("link-cli binary not found: {path}"))
            }
            ProcessError::SpawnFailed(e) => {
                BackendError::ConnectionFailed(format!("Failed to start link-cli: {e}"))
            }
            ProcessError::Timeout => BackendError::Other("Command timed out".to_string()),
            ProcessError::ProcessCrashed(code) => {
                BackendError::Other(format!("link-cli process crashed with code {code:?}"))
            }
            ProcessError::MaxRestartsExceeded => {
                BackendError::Other("Maximum restart attempts exceeded".to_string())
            }
            ProcessError::WriteFailed(e) => {
                BackendError::Other(format!("Failed to send command: {e}"))
            }
            ProcessError::ReadFailed(e) => {
                BackendError::Other(format!("Failed to read response: {e}"))
            }
        }
    }

    /// Executes a command and returns the response.
    async fn execute(&self, command: &str) -> BackendResult<T, String> {
        self.process
            .execute(command)
            .await
            .map_err(Self::map_process_error)
    }

    /// Parses a response into links.
    fn parse_response(response: &str) -> BackendResult<T, Vec<ParsedLink<T>>> {
        LinksNotation::parse(response).map_err(|e| BackendError::Other(e.to_string()))
    }

    /// Converts a parsed link to a Link<T>.
    fn parsed_to_link(parsed: &ParsedLink<T>) -> Link<T> {
        let id = parsed.id.unwrap_or_else(T::zero);
        Link::new(id, LinkRef::Id(parsed.source), LinkRef::Id(parsed.target))
    }

    /// Gets the ID from a `LinkRef`.
    fn get_ref_id(link_ref: &LinkRef<T>) -> T {
        match link_ref {
            LinkRef::Id(id) => *id,
            LinkRef::Link(link) => link.id,
        }
    }

    /// Refreshes the cached link count.
    async fn refresh_link_count(&mut self) -> BackendResult<T, ()> {
        let command = LinksNotation::read_all_command();
        let response = self.execute(&command).await?;
        let links = Self::parse_response(&response)?;
        self.cached_link_count = links.len();
        Ok(())
    }

    /// Builds a query command from a pattern.
    fn build_query_command(pattern: &LinkPattern<T>) -> String {
        match (&pattern.source, &pattern.target) {
            (PatternField::Value(source_ref), PatternField::Value(target_ref)) => {
                let source = Self::get_ref_id(source_ref);
                let target = Self::get_ref_id(target_ref);
                LinksNotation::query_by_source_and_target_command(source, target)
            }
            (PatternField::Value(source_ref), PatternField::Any) => {
                let source = Self::get_ref_id(source_ref);
                LinksNotation::query_by_source_command(source)
            }
            (PatternField::Any, PatternField::Value(target_ref)) => {
                let target = Self::get_ref_id(target_ref);
                LinksNotation::query_by_target_command(target)
            }
            (PatternField::Any, PatternField::Any) => LinksNotation::read_all_command(),
        }
    }
}

// =============================================================================
// StorageBackend Implementation
// =============================================================================

impl<T: LinkType + FromStr + Display + 'static> StorageBackend<T> for LinkCliBackend<T> {
    async fn connect(&mut self) -> BackendResult<T, ()> {
        if self.connected {
            return Ok(());
        }

        self.process
            .start()
            .await
            .map_err(Self::map_process_error)?;

        self.connected = true;
        self.connected_at = Some(Self::current_time_ms());

        // Refresh link count on connect
        let _ = self.refresh_link_count().await;

        Ok(())
    }

    async fn disconnect(&mut self) -> BackendResult<T, ()> {
        if !self.connected {
            return Ok(());
        }

        self.process.stop().await.map_err(Self::map_process_error)?;

        self.connected = false;
        self.connected_at = None;

        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    async fn save(&mut self, link: Link<T>) -> BackendResult<T, T> {
        self.ensure_connected()?;
        self.stats.writes += 1;

        let source = Self::get_ref_id(&link.source);
        let target = Self::get_ref_id(&link.target);

        // Create command to save the link
        let command = LinksNotation::create_command(source, target);
        let response = self.execute(&command).await?;

        // Parse the response to get the assigned ID
        let links = Self::parse_response(&response)?;

        if let Some(parsed) = links.first() {
            if let Some(id) = parsed.id {
                self.cached_link_count += 1;
                return Ok(id);
            }
        }

        // If no ID returned, try to find the link by source/target
        let query_cmd = LinksNotation::query_by_source_and_target_command(source, target);
        let query_response = self.execute(&query_cmd).await?;
        let query_links = Self::parse_response(&query_response)?;

        if let Some(parsed) = query_links.first() {
            if let Some(id) = parsed.id {
                return Ok(id);
            }
        }

        Err(BackendError::Other(
            "Failed to save link: no ID returned".to_string(),
        ))
    }

    async fn load(&self, id: T) -> BackendResult<T, Option<Link<T>>> {
        self.ensure_connected()?;

        let command = LinksNotation::read_by_id_command(id);
        let response = self.execute(&command).await?;
        let links = Self::parse_response(&response)?;

        Ok(links.into_iter().next().map(|p| Self::parsed_to_link(&p)))
    }

    async fn delete(&mut self, id: T) -> BackendResult<T, bool> {
        self.ensure_connected()?;
        self.stats.deletes += 1;

        // First, load the link to get its source and target
        let link = self.load(id).await?;

        let Some(link) = link else {
            return Ok(false);
        };

        let source = Self::get_ref_id(&link.source);
        let target = Self::get_ref_id(&link.target);

        // Delete the link
        let command = LinksNotation::delete_command(id, source, target);
        let _response = self.execute(&command).await?;

        // Verify deletion
        let verify = self.load(id).await?;
        let deleted = verify.is_none();

        if deleted && self.cached_link_count > 0 {
            self.cached_link_count -= 1;
        }

        Ok(deleted)
    }

    async fn query(&self, pattern: &LinkPattern<T>) -> BackendResult<T, Vec<Link<T>>> {
        self.ensure_connected()?;

        let command = Self::build_query_command(pattern);
        let response = self.execute(&command).await?;
        let links = Self::parse_response(&response)?;

        // Filter by ID pattern if specified
        let results: Vec<Link<T>> = links
            .into_iter()
            .map(|p| Self::parsed_to_link(&p))
            .filter(|link| {
                if let PatternField::Value(id_ref) = &pattern.id {
                    let pattern_id = Self::get_ref_id(id_ref);
                    link.id == pattern_id
                } else {
                    true
                }
            })
            .collect();

        Ok(results)
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            supports_transactions: false,
            supports_batch_operations: false,
            durability_level: DurabilityLevel::Fsync,
            max_link_size: 0, // Unlimited
            supports_pattern_queries: true,
        }
    }

    fn stats(&self) -> BackendStats {
        let now = Self::current_time_ms();
        let uptime = self.connected_at.map_or(0, |at| now - at);

        BackendStats {
            total_links: self.cached_link_count,
            used_space: 0, // Not tracked
            operations: self.stats.clone(),
            connected_at: self.connected_at,
            uptime_ms: uptime,
        }
    }
}

// =============================================================================
// Factory Function for Registry
// =============================================================================

/// Creates a `LinkCliBackend` from a `BackendConfig`.
///
/// This function is used by the registry to create link-cli backends.
///
/// # Configuration Options
///
/// - `path`: Database file path (required)
/// - `binary_path`: Path to clink binary (optional)
/// - `timeout`: Command timeout in milliseconds (optional)
/// - `auto_restart`: Whether to auto-restart on crash (optional)
///
/// # Example
///
/// ```rust,ignore
/// use links_queue::{BackendConfig, BackendRegistry};
///
/// let config = BackendConfig::new("link-cli")
///     .with_option("path", "./data/db.links");
///
/// let registry = BackendRegistry::<u64>::new();
/// let backend = registry.create(&config).unwrap();
/// ```
#[allow(clippy::unnecessary_wraps)]
pub fn create_link_cli_backend<T: LinkType + FromStr + Display + 'static>(
    config: &super::BackendConfig,
) -> BackendResult<T, Box<dyn super::StorageBackendDyn<T>>> {
    let path = config.get_option("path").unwrap_or("db.links");
    let mut cli_config = LinkCliConfig::new(path);

    if let Some(binary) = config.get_option("binary_path") {
        cli_config = cli_config.with_binary_path(binary);
    }

    if let Some(timeout) = config.get_option("timeout").and_then(|s| s.parse().ok()) {
        cli_config = cli_config.with_timeout(timeout);
    }

    if let Some(auto_restart) = config
        .get_option("auto_restart")
        .and_then(|s| s.parse().ok())
    {
        cli_config = cli_config.with_auto_restart(auto_restart);
    }

    Ok(Box::new(LinkCliBackend::<T>::new(cli_config)))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod config_tests {
        use super::*;

        #[test]
        fn test_config_new() {
            let config = LinkCliConfig::new("test.links");
            assert_eq!(config.path, PathBuf::from("test.links"));
            assert!(config.binary_path.is_none());
            assert_eq!(config.timeout_ms, 30_000);
            assert!(config.auto_restart);
        }

        #[test]
        fn test_config_builder() {
            let config = LinkCliConfig::new("test.links")
                .with_binary_path("/usr/bin/clink")
                .with_timeout(5000)
                .with_auto_restart(false);

            assert_eq!(config.binary_path, Some(PathBuf::from("/usr/bin/clink")));
            assert_eq!(config.timeout_ms, 5000);
            assert!(!config.auto_restart);
        }

        #[test]
        fn test_config_default() {
            let config = LinkCliConfig::default();
            assert_eq!(config.path, PathBuf::from("db.links"));
        }
    }

    mod backend_tests {
        use super::*;

        #[test]
        fn test_backend_new() {
            let config = LinkCliConfig::new("test.links");
            let backend = LinkCliBackend::<u64>::new(config);
            assert!(!backend.is_connected());
        }

        #[test]
        fn test_backend_capabilities() {
            let config = LinkCliConfig::new("test.links");
            let backend = LinkCliBackend::<u64>::new(config);
            let caps = backend.capabilities();

            assert!(!caps.supports_transactions);
            assert!(!caps.supports_batch_operations);
            assert_eq!(caps.durability_level, DurabilityLevel::Fsync);
            assert!(caps.supports_pattern_queries);
        }

        #[test]
        fn test_backend_stats_disconnected() {
            let config = LinkCliConfig::new("test.links");
            let backend = LinkCliBackend::<u64>::new(config);
            let stats = backend.stats();

            assert_eq!(stats.total_links, 0);
            assert!(stats.connected_at.is_none());
            assert_eq!(stats.uptime_ms, 0);
        }

        #[tokio::test]
        async fn test_backend_not_connected_error() {
            let config = LinkCliConfig::new("test.links");
            let mut backend = LinkCliBackend::<u64>::new(config);

            let result = backend
                .save(Link::new(0, LinkRef::Id(1), LinkRef::Id(2)))
                .await;
            assert!(matches!(result, Err(BackendError::NotConnected)));

            let result = backend.load(1).await;
            assert!(matches!(result, Err(BackendError::NotConnected)));

            let result = backend.delete(1).await;
            assert!(matches!(result, Err(BackendError::NotConnected)));

            let result = backend.query(&LinkPattern::new()).await;
            assert!(matches!(result, Err(BackendError::NotConnected)));
        }
    }

    mod query_command_tests {
        use super::*;

        #[test]
        fn test_build_query_command_both() {
            let pattern = LinkPattern::new()
                .source(LinkRef::Id(5u64))
                .target(LinkRef::Id(10u64));

            let cmd = LinkCliBackend::<u64>::build_query_command(&pattern);
            assert!(cmd.contains('5'));
            assert!(cmd.contains("10"));
        }

        #[test]
        fn test_build_query_command_source_only() {
            let pattern = LinkPattern::with_source(LinkRef::Id(5u64));

            let cmd = LinkCliBackend::<u64>::build_query_command(&pattern);
            assert!(cmd.contains('5'));
            assert!(cmd.contains("$t"));
        }

        #[test]
        fn test_build_query_command_target_only() {
            let pattern = LinkPattern::with_target(LinkRef::Id(10u64));

            let cmd = LinkCliBackend::<u64>::build_query_command(&pattern);
            assert!(cmd.contains("$s"));
            assert!(cmd.contains("10"));
        }

        #[test]
        fn test_build_query_command_all() {
            let pattern = LinkPattern::new();

            let cmd = LinkCliBackend::<u64>::build_query_command(&pattern);
            assert!(cmd.contains("$i"));
            assert!(cmd.contains("$s"));
            assert!(cmd.contains("$t"));
        }
    }
}
