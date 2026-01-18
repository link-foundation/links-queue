//! Tests for the client module.

use super::*;

mod unit_tests {
    use super::*;
    use crate::client::{EnqueueResult, QueueInfo};

    #[test]
    fn test_client_config_defaults() {
        let config = ClientConfig::default();
        assert!(config.auto_reconnect);
        assert_eq!(config.max_reconnect_attempts, 5);
    }

    #[test]
    fn test_subscription_lifecycle() {
        let mut sub = Subscription::<u64>::new("test-queue".to_string());
        assert!(sub.is_active());
        assert_eq!(sub.queue(), "test-queue");

        sub.cancel();
        assert!(!sub.is_active());
    }

    #[test]
    fn test_queue_info() {
        let info = QueueInfo::new("tasks".to_string(), 100);
        assert_eq!(info.name, "tasks");
        assert_eq!(info.depth, 100);
    }

    #[test]
    fn test_enqueue_result() {
        let result = EnqueueResult::new(42u64, 5);
        assert_eq!(result.id, 42);
        assert_eq!(result.position, 5);
    }
}
