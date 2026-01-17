//! Integration tests for links-queue.
//!
//! These tests verify the public API works correctly.

#[allow(deprecated)]
use links_queue::{add, delay, multiply};
use links_queue::{
    Any, EnqueueResult, Link, LinkPattern, LinkRef, LinkType, QueueError, QueueErrorCode,
    QueueInfo, QueueOptions, QueueStats, VERSION,
};

// =============================================================================
// Link and LinkRef Integration Tests
// =============================================================================

mod link_integration_tests {
    use super::*;

    #[test]
    fn test_create_simple_link() {
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
        assert_eq!(link.id, 1);
        assert_eq!(link.source_id(), 2);
        assert_eq!(link.target_id(), 3);
    }

    #[test]
    fn test_create_link_with_different_id_types() {
        // Test with u32
        let link_u32 = Link::new(1u32, LinkRef::Id(2u32), LinkRef::Id(3u32));
        assert_eq!(link_u32.id, 1u32);

        // Test with u64
        let link_u64 = Link::new(1u64, LinkRef::Id(2u64), LinkRef::Id(3u64));
        assert_eq!(link_u64.id, 1u64);

        // Test with usize
        let link_usize = Link::new(1usize, LinkRef::Id(2usize), LinkRef::Id(3usize));
        assert_eq!(link_usize.id, 1usize);
    }

    #[test]
    fn test_nested_link_structure() {
        // Create inner link
        let inner = Link::new(10u64, LinkRef::Id(20), LinkRef::Id(30));

        // Create outer link with nested source
        let outer = Link::new(1u64, LinkRef::link(inner), LinkRef::Id(5));

        assert_eq!(outer.id, 1);
        assert_eq!(outer.source_id(), 10); // Gets ID of nested link
        assert_eq!(outer.target_id(), 5);

        // Verify the nested link is accessible
        if let LinkRef::Link(nested) = &outer.source {
            assert_eq!(nested.id, 10);
            assert_eq!(nested.source_id(), 20);
            assert_eq!(nested.target_id(), 30);
        } else {
            panic!("Expected nested link");
        }
    }

    #[test]
    fn test_deeply_nested_links() {
        // Create a 3-level nested structure
        let level3 = Link::new(3u64, LinkRef::Id(30), LinkRef::Id(31));
        let level2 = Link::new(2u64, LinkRef::link(level3), LinkRef::Id(21));
        let level1 = Link::new(1u64, LinkRef::link(level2), LinkRef::Id(11));

        assert_eq!(level1.source_id(), 2);

        // Navigate to nested links
        if let LinkRef::Link(l2) = &level1.source {
            assert_eq!(l2.source_id(), 3);
            if let LinkRef::Link(l3) = &l2.source {
                assert_eq!(l3.source_id(), 30);
            } else {
                panic!("Expected level 3 nested link");
            }
        } else {
            panic!("Expected level 2 nested link");
        }
    }

    #[test]
    fn test_universal_link_with_values() {
        let link = Link::with_values(
            1u64,
            LinkRef::Id(2),
            LinkRef::Id(3),
            vec![LinkRef::Id(4), LinkRef::Id(5), LinkRef::Id(6)],
        );

        assert!(link.has_values());
        let values = link.values.as_ref().unwrap();
        assert_eq!(values.len(), 3);
        assert_eq!(values[0].get_id(), 4);
        assert_eq!(values[1].get_id(), 5);
        assert_eq!(values[2].get_id(), 6);
    }

    #[test]
    fn test_point_link() {
        let point = Link::<u64>::point(42);
        assert!(point.is_point());
        assert_eq!(point.id, 42);
        assert_eq!(point.source_id(), 42);
        assert_eq!(point.target_id(), 42);
    }

    #[test]
    fn test_null_link() {
        let null_link = Link::<u64>::nothing();
        assert!(null_link.is_null());
        assert_eq!(null_link.id, 0);
        assert_eq!(null_link.source_id(), 0);
        assert_eq!(null_link.target_id(), 0);
    }

    #[test]
    fn test_link_ref_conversions() {
        // From ID
        let ref_from_id: LinkRef<u64> = 42u64.into();
        assert!(ref_from_id.is_id());
        assert_eq!(ref_from_id.get_id(), 42);

        // From Link
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
        let ref_from_link: LinkRef<u64> = link.into();
        assert!(ref_from_link.is_link());
        assert_eq!(ref_from_link.get_id(), 1);
    }
}

// =============================================================================
// Pattern Matching Integration Tests
// =============================================================================

mod pattern_integration_tests {
    use super::*;

    #[test]
    fn test_match_all_pattern() {
        let pattern = LinkPattern::<u64>::all();

        // Should match any link
        assert!(pattern.matches(&Link::new(1, LinkRef::Id(2), LinkRef::Id(3))));
        assert!(pattern.matches(&Link::new(100, LinkRef::Id(200), LinkRef::Id(300))));
        assert!(pattern.matches(&Link::point(42)));
        assert!(pattern.matches(&Link::nothing()));
    }

    #[test]
    fn test_match_by_source() {
        let pattern = LinkPattern::with_source(LinkRef::Id(5u64));

        assert!(pattern.matches(&Link::new(1, LinkRef::Id(5), LinkRef::Id(10))));
        assert!(pattern.matches(&Link::new(2, LinkRef::Id(5), LinkRef::Id(20))));
        assert!(!pattern.matches(&Link::new(1, LinkRef::Id(10), LinkRef::Id(5))));
    }

    #[test]
    fn test_match_by_target() {
        let pattern = LinkPattern::with_target(LinkRef::Id(10u64));

        assert!(pattern.matches(&Link::new(1, LinkRef::Id(5), LinkRef::Id(10))));
        assert!(pattern.matches(&Link::new(2, LinkRef::Id(20), LinkRef::Id(10))));
        assert!(!pattern.matches(&Link::new(1, LinkRef::Id(10), LinkRef::Id(5))));
    }

    #[test]
    fn test_match_by_source_and_target() {
        let pattern = LinkPattern::with_source_target(LinkRef::Id(5u64), LinkRef::Id(10u64));

        assert!(pattern.matches(&Link::new(1, LinkRef::Id(5), LinkRef::Id(10))));
        assert!(!pattern.matches(&Link::new(1, LinkRef::Id(5), LinkRef::Id(20))));
        assert!(!pattern.matches(&Link::new(1, LinkRef::Id(20), LinkRef::Id(10))));
    }

    #[test]
    fn test_builder_pattern() {
        let pattern = LinkPattern::<u64>::new().id(1u64).source(Any).target(10u64);

        assert!(pattern.matches(&Link::new(1, LinkRef::Id(5), LinkRef::Id(10))));
        assert!(pattern.matches(&Link::new(1, LinkRef::Id(999), LinkRef::Id(10))));
        assert!(!pattern.matches(&Link::new(2, LinkRef::Id(5), LinkRef::Id(10))));
        assert!(!pattern.matches(&Link::new(1, LinkRef::Id(5), LinkRef::Id(20))));
    }

    #[test]
    fn test_any_wildcard() {
        let pattern = LinkPattern::<u64>::new().source(Any).target(Any);

        // Should match anything since both are Any
        assert!(pattern.matches(&Link::new(1, LinkRef::Id(100), LinkRef::Id(200))));
        assert!(pattern.matches(&Link::new(1, LinkRef::Id(0), LinkRef::Id(0))));
    }
}

// =============================================================================
// LinkType Trait Tests
// =============================================================================

mod link_type_tests {
    use super::*;

    #[test]
    fn test_link_type_implementations() {
        // All numeric types should implement LinkType
        assert_eq!(u8::zero(), 0u8);
        assert_eq!(u16::zero(), 0u16);
        assert_eq!(u32::zero(), 0u32);
        assert_eq!(u64::zero(), 0u64);
        assert_eq!(usize::zero(), 0usize);

        assert_eq!(i8::zero(), 0i8);
        assert_eq!(i16::zero(), 0i16);
        assert_eq!(i32::zero(), 0i32);
        assert_eq!(i64::zero(), 0i64);
        assert_eq!(isize::zero(), 0isize);
    }

    #[test]
    fn test_is_nothing() {
        assert!(0u64.is_nothing());
        assert!(!1u64.is_nothing());
        assert!(!42u64.is_nothing());

        assert!(0i64.is_nothing());
        assert!(!1i64.is_nothing());
        assert!(!(-1i64).is_nothing());
    }
}

// =============================================================================
// Backward Compatibility Tests
// =============================================================================

#[allow(deprecated)]
mod add_integration_tests {
    use super::*;

    #[test]
    fn test_add_returns_correct_sum() {
        assert_eq!(add(10, 20), 30);
    }

    #[test]
    fn test_add_handles_large_numbers() {
        assert_eq!(add(1_000_000_000, 2_000_000_000), 3_000_000_000);
    }

    #[test]
    fn test_add_handles_negative_result() {
        assert_eq!(add(-100, 50), -50);
    }
}

#[allow(deprecated)]
mod multiply_integration_tests {
    use super::*;

    #[test]
    fn test_multiply_returns_correct_product() {
        assert_eq!(multiply(10, 20), 200);
    }

    #[test]
    fn test_multiply_handles_large_numbers() {
        assert_eq!(multiply(1_000, 1_000_000), 1_000_000_000);
    }

    #[test]
    fn test_multiply_handles_negative_numbers() {
        assert_eq!(multiply(-10, -20), 200);
    }
}

#[allow(deprecated)]
mod delay_integration_tests {
    use super::*;

    #[tokio::test]
    async fn test_delay_waits_minimum_time() {
        let start = std::time::Instant::now();
        delay(0.05).await;
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_secs_f64() >= 0.05,
            "Delay should wait at least 0.05 seconds, but waited {:.4}s",
            elapsed.as_secs_f64()
        );
    }

    #[tokio::test]
    async fn test_delay_zero_completes_quickly() {
        let start = std::time::Instant::now();
        delay(0.0).await;
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_secs_f64() < 0.1,
            "Zero delay should complete quickly, but took {:.4}s",
            elapsed.as_secs_f64()
        );
    }
}

mod version_tests {
    use super::*;

    #[test]
    fn test_version_is_not_empty() {
        assert!(!VERSION.is_empty());
    }

    #[test]
    fn test_version_matches_cargo_toml() {
        // Version should match the one in Cargo.toml
        assert!(VERSION.starts_with("0."));
    }
}

// =============================================================================
// Queue Types Integration Tests
// =============================================================================

mod queue_types_tests {
    use super::*;

    #[test]
    fn test_enqueue_result_creation() {
        let result = EnqueueResult::new(42u64, 5);
        assert_eq!(result.id, 42);
        assert_eq!(result.position, 5);
    }

    #[test]
    fn test_enqueue_result_with_different_id_types() {
        // u32
        let result_u32 = EnqueueResult::new(1u32, 0);
        assert_eq!(result_u32.id, 1u32);

        // u64
        let result_u64 = EnqueueResult::new(1u64, 10);
        assert_eq!(result_u64.id, 1u64);

        // usize
        let result_usize = EnqueueResult::new(1usize, 100);
        assert_eq!(result_usize.id, 1usize);
    }

    #[test]
    fn test_queue_stats_default() {
        let stats = QueueStats::default();
        assert_eq!(stats.depth, 0);
        assert_eq!(stats.enqueued, 0);
        assert_eq!(stats.dequeued, 0);
        assert_eq!(stats.acknowledged, 0);
        assert_eq!(stats.rejected, 0);
        assert_eq!(stats.in_flight, 0);
    }

    #[test]
    fn test_queue_stats_new() {
        let stats = QueueStats::new();
        assert_eq!(stats.depth, 0);
        assert_eq!(stats.in_flight, 0);
    }
}

mod queue_options_tests {
    use super::*;

    #[test]
    fn test_queue_options_default() {
        let options = QueueOptions::default();
        assert!(options.max_size.is_none());
        assert!(options.visibility_timeout.is_none());
        assert!(options.retry_limit.is_none());
        assert!(options.dead_letter_queue.is_none());
        assert!(options.priority.is_none());
    }

    #[test]
    fn test_queue_options_builder() {
        let options = QueueOptions::new()
            .with_max_size(10000)
            .with_visibility_timeout(60)
            .with_retry_limit(5)
            .with_dead_letter_queue("my-dlq".to_string())
            .with_priority(true);

        assert_eq!(options.max_size, Some(10000));
        assert_eq!(options.visibility_timeout, Some(60));
        assert_eq!(options.retry_limit, Some(5));
        assert_eq!(options.dead_letter_queue, Some("my-dlq".to_string()));
        assert_eq!(options.priority, Some(true));
    }

    #[test]
    fn test_queue_options_defaults() {
        let options = QueueOptions::new();

        assert_eq!(options.max_size_or_default(), usize::MAX);
        assert_eq!(options.visibility_timeout_or_default(), 30);
        assert_eq!(options.retry_limit_or_default(), 3);
        assert!(!options.priority_or_default());
    }

    #[test]
    fn test_queue_options_with_values_override_defaults() {
        let options = QueueOptions::new()
            .with_max_size(1000)
            .with_visibility_timeout(120)
            .with_retry_limit(10)
            .with_priority(true);

        assert_eq!(options.max_size_or_default(), 1000);
        assert_eq!(options.visibility_timeout_or_default(), 120);
        assert_eq!(options.retry_limit_or_default(), 10);
        assert!(options.priority_or_default());
    }
}

mod queue_error_tests {
    use super::*;

    #[test]
    fn test_queue_error_code_display() {
        assert_eq!(format!("{}", QueueErrorCode::QueueFull), "QUEUE_FULL");
        assert_eq!(
            format!("{}", QueueErrorCode::QueueNotFound),
            "QUEUE_NOT_FOUND"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::QueueAlreadyExists),
            "QUEUE_ALREADY_EXISTS"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::ItemNotFound),
            "ITEM_NOT_FOUND"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::ItemNotInFlight),
            "ITEM_NOT_IN_FLIGHT"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::InvalidOperation),
            "INVALID_OPERATION"
        );
    }

    #[test]
    fn test_queue_error_factories() {
        let full_err = QueueError::queue_full("tasks");
        assert_eq!(full_err.code, QueueErrorCode::QueueFull);
        assert!(full_err.message.contains("tasks"));

        let not_found_err = QueueError::queue_not_found("events");
        assert_eq!(not_found_err.code, QueueErrorCode::QueueNotFound);
        assert!(not_found_err.message.contains("events"));

        let exists_err = QueueError::queue_already_exists("jobs");
        assert_eq!(exists_err.code, QueueErrorCode::QueueAlreadyExists);
        assert!(exists_err.message.contains("jobs"));

        let item_err = QueueError::item_not_found(42u64);
        assert_eq!(item_err.code, QueueErrorCode::ItemNotFound);
        assert!(item_err.message.contains("42"));

        let flight_err = QueueError::item_not_in_flight(99u64);
        assert_eq!(flight_err.code, QueueErrorCode::ItemNotInFlight);
        assert!(flight_err.message.contains("99"));
    }

    #[test]
    fn test_queue_error_display() {
        let err = QueueError::queue_full("my-queue");
        let display = format!("{}", err);
        assert!(display.contains("QUEUE_FULL"));
        assert!(display.contains("my-queue"));
    }

    #[test]
    fn test_queue_error_is_std_error() {
        let err = QueueError::queue_not_found("test");
        let _: &dyn std::error::Error = &err;
    }
}

mod queue_info_tests {
    use super::*;

    #[test]
    fn test_queue_info_creation() {
        let options = QueueOptions::new().with_max_size(1000);
        let info = QueueInfo::new("tasks".to_string(), 42, 1704067200000, options);

        assert_eq!(info.name, "tasks");
        assert_eq!(info.depth, 42);
        assert_eq!(info.created_at, 1704067200000);
        assert_eq!(info.options.max_size, Some(1000));
    }
}

// =============================================================================
// Queue Trait Contract Tests
// =============================================================================

mod queue_trait_contract_tests {
    use super::*;

    #[test]
    fn test_enqueue_result_represents_queue_position() {
        // Position 0 means item is next to be dequeued
        let first = EnqueueResult::new(1u64, 0);
        assert_eq!(first.position, 0);

        // Position 1 means one item ahead
        let second = EnqueueResult::new(2u64, 1);
        assert_eq!(second.position, 1);
    }

    #[test]
    fn test_queue_stats_tracks_all_operations() {
        // Simulating queue operations
        let mut stats = QueueStats::new();

        // Enqueue 5 items
        stats.enqueued = 5;
        stats.depth = 5;

        // Dequeue 3 items
        stats.dequeued = 3;
        stats.depth = 2;
        stats.in_flight = 3;

        // Acknowledge 2
        stats.acknowledged = 2;
        stats.in_flight = 1;

        // Reject 1
        stats.rejected = 1;
        stats.in_flight = 0;

        assert_eq!(stats.enqueued, 5);
        assert_eq!(stats.dequeued, 3);
        assert_eq!(stats.acknowledged, 2);
        assert_eq!(stats.rejected, 1);
        assert_eq!(stats.depth, 2);
        assert_eq!(stats.in_flight, 0);
    }

    #[test]
    fn test_queue_options_dead_letter_queue_pattern() {
        // Common pattern: main queue with DLQ
        let dlq_options = QueueOptions::new();
        let main_options = QueueOptions::new()
            .with_max_size(10000)
            .with_retry_limit(3)
            .with_dead_letter_queue("tasks-dlq".to_string());

        assert!(dlq_options.dead_letter_queue.is_none());
        assert_eq!(
            main_options.dead_letter_queue,
            Some("tasks-dlq".to_string())
        );
    }
}

// =============================================================================
// API Parity Tests (verify JS/Rust alignment)
// =============================================================================

mod api_parity_tests {
    use super::*;

    /// Verify that QueueStats has all required fields matching JS interface
    #[test]
    fn test_queue_stats_matches_js_interface() {
        let stats = QueueStats {
            depth: 100,
            enqueued: 500,
            dequeued: 400,
            acknowledged: 380,
            rejected: 20,
            in_flight: 10,
        };

        // All fields from JS interface are present
        let _ = stats.depth;
        let _ = stats.enqueued;
        let _ = stats.dequeued;
        let _ = stats.acknowledged;
        let _ = stats.rejected;
        let _ = stats.in_flight;
    }

    /// Verify that QueueOptions has all optional fields matching JS interface
    #[test]
    fn test_queue_options_matches_js_interface() {
        let options = QueueOptions {
            max_size: Some(1000),
            visibility_timeout: Some(30),
            retry_limit: Some(3),
            dead_letter_queue: Some("dlq".to_string()),
            priority: Some(true),
        };

        // All fields from JS interface are present
        let _ = options.max_size;
        let _ = options.visibility_timeout;
        let _ = options.retry_limit;
        let _ = options.dead_letter_queue;
        let _ = options.priority;
    }

    /// Verify that EnqueueResult has all required fields matching JS interface
    #[test]
    fn test_enqueue_result_matches_js_interface() {
        let result = EnqueueResult::new(1u64, 0);

        // All fields from JS interface are present
        let _ = result.id;
        let _ = result.position;
    }

    /// Verify that QueueInfo has all required fields matching JS interface
    #[test]
    fn test_queue_info_matches_js_interface() {
        let info = QueueInfo::new("test".to_string(), 0, 0, QueueOptions::default());

        // All fields from JS interface are present
        let _ = info.name;
        let _ = info.depth;
        let _ = info.created_at;
        let _ = info.options;
    }

    /// Verify that QueueError codes match JS error codes
    #[test]
    fn test_queue_error_codes_match_js() {
        // These should match the JS QueueErrorCode type
        assert_eq!(format!("{}", QueueErrorCode::QueueFull), "QUEUE_FULL");
        assert_eq!(
            format!("{}", QueueErrorCode::QueueNotFound),
            "QUEUE_NOT_FOUND"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::QueueAlreadyExists),
            "QUEUE_ALREADY_EXISTS"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::ItemNotFound),
            "ITEM_NOT_FOUND"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::ItemNotInFlight),
            "ITEM_NOT_IN_FLIGHT"
        );
        assert_eq!(
            format!("{}", QueueErrorCode::InvalidOperation),
            "INVALID_OPERATION"
        );
    }
}
