//! Integration tests for links-queue.
//!
//! These tests verify the public API works correctly.

#[allow(deprecated)]
use links_queue::{add, delay, multiply};
use links_queue::{Any, Link, LinkPattern, LinkRef, LinkType, VERSION};

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
