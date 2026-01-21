//! Tests for the router module.

use super::router::*;
use std::collections::HashMap;

mod topic_matcher_tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        assert!(TopicMatcher::matches("logs.error", "logs.error"));
        assert!(!TopicMatcher::matches("logs.error", "logs.info"));
    }

    #[test]
    fn test_star_wildcard() {
        assert!(TopicMatcher::matches("logs.*", "logs.error"));
        assert!(TopicMatcher::matches("logs.*", "logs.info"));
        assert!(!TopicMatcher::matches("logs.*", "logs.error.db"));
        assert!(TopicMatcher::matches("*.error", "logs.error"));
        assert!(TopicMatcher::matches("*.error", "app.error"));
    }

    #[test]
    fn test_hash_wildcard() {
        assert!(TopicMatcher::matches("logs.#", "logs.error"));
        assert!(TopicMatcher::matches("logs.#", "logs.error.db"));
        assert!(TopicMatcher::matches("logs.#", "logs.a.b.c.d"));
    }

    #[test]
    fn test_hash_at_beginning() {
        assert!(TopicMatcher::matches("#.error", "logs.error"));
        assert!(TopicMatcher::matches("#.error", "a.b.c.error"));
    }

    #[test]
    fn test_hash_alone() {
        assert!(TopicMatcher::matches("#", "anything"));
        assert!(TopicMatcher::matches("#", "a.b.c"));
    }

    #[test]
    fn test_complex_patterns() {
        assert!(TopicMatcher::matches("*.system.*", "app.system.startup"));
        assert!(TopicMatcher::matches("*.system.*", "db.system.shutdown"));
        assert!(!TopicMatcher::matches("*.system.*", "system.startup"));
    }

    #[test]
    fn test_specificity() {
        let exact = TopicMatcher::specificity("logs.error.db");
        let star = TopicMatcher::specificity("logs.*.db");
        let hash = TopicMatcher::specificity("logs.#");

        assert!(exact > star);
        assert!(star > hash);
    }
}

mod exchange_tests {
    use super::*;

    #[test]
    fn test_direct_exchange() {
        let exchange = DirectExchange::new("logs");

        exchange.bind("errors-queue", "error", None);
        exchange.bind("info-queue", "info", None);

        assert_eq!(exchange.route("error", None), vec!["errors-queue".to_string()]);
        assert_eq!(exchange.route("info", None), vec!["info-queue".to_string()]);
        assert!(exchange.route("debug", None).is_empty());
    }

    #[test]
    fn test_direct_exchange_unbind() {
        let exchange = DirectExchange::new("logs");

        exchange.bind("queue", "key", None);
        assert!(exchange.unbind("queue", "key"));
        assert!(exchange.route("key", None).is_empty());
    }

    #[test]
    fn test_topic_exchange() {
        let exchange = TopicExchange::new("events");

        exchange.bind("all-logs", "logs.#", None);
        exchange.bind("errors-only", "logs.error", None);

        let queues = exchange.route("logs.error", None);
        assert!(queues.contains(&"all-logs".to_string()));
        assert!(queues.contains(&"errors-only".to_string()));
    }

    #[test]
    fn test_fanout_exchange() {
        let exchange = FanoutExchange::new("notifications");

        exchange.bind("email-queue", "", None);
        exchange.bind("sms-queue", "", None);
        exchange.bind("push-queue", "", None);

        let queues = exchange.route("", None);
        assert_eq!(queues.len(), 3);
    }

    #[test]
    fn test_headers_exchange_match_all() {
        let exchange = HeadersExchange::new("tasks");

        let mut headers = HashMap::new();
        headers.insert("priority".to_string(), "high".to_string());
        headers.insert("type".to_string(), "system".to_string());

        exchange.bind("urgent-system", "", Some((headers.clone(), true)));

        // Must match all headers
        assert_eq!(
            exchange.route("", Some(&headers)),
            vec!["urgent-system".to_string()]
        );

        // Missing header - no match
        let mut partial = HashMap::new();
        partial.insert("priority".to_string(), "high".to_string());
        assert!(exchange.route("", Some(&partial)).is_empty());
    }

    #[test]
    fn test_headers_exchange_match_any() {
        let exchange = HeadersExchange::new("tasks");

        let mut headers = HashMap::new();
        headers.insert("priority".to_string(), "high".to_string());
        headers.insert("type".to_string(), "system".to_string());

        exchange.bind("special", "", Some((headers.clone(), false)));

        // Any header matches
        let mut partial = HashMap::new();
        partial.insert("priority".to_string(), "high".to_string());
        assert_eq!(
            exchange.route("", Some(&partial)),
            vec!["special".to_string()]
        );
    }
}

mod router_tests {
    use super::*;

    #[test]
    fn test_declare_exchange() {
        let router = Router::new();

        let result = router.declare_exchange("logs", ExchangeType::Direct);
        assert!(result.is_ok());

        let result = router.declare_exchange("logs", ExchangeType::Direct);
        assert!(result.is_ok()); // Same type - OK

        let result = router.declare_exchange("logs", ExchangeType::Topic);
        assert!(result.is_err()); // Different type - Error
    }

    #[test]
    fn test_get_exchange() {
        let router = Router::new();
        router.declare_exchange("logs", ExchangeType::Direct).unwrap();

        assert!(router.get_exchange("logs").is_some());
        assert!(router.get_exchange("nonexistent").is_none());
    }

    #[test]
    fn test_delete_exchange() {
        let router = Router::new();
        router.declare_exchange("logs", ExchangeType::Direct).unwrap();

        assert!(router.delete_exchange("logs"));
        assert!(!router.delete_exchange("logs")); // Already deleted
    }

    #[test]
    fn test_bind_unbind() {
        let router = Router::new();
        router.declare_exchange("logs", ExchangeType::Direct).unwrap();

        router.bind("logs", "queue", "key", None).unwrap();
        assert_eq!(router.route("logs", "key", None), vec!["queue".to_string()]);

        router.unbind("logs", "queue", "key");
        assert!(router.route("logs", "key", None).is_empty());
    }

    #[test]
    fn test_list_exchanges() {
        let router = Router::new();
        router.declare_exchange("logs", ExchangeType::Direct).unwrap();
        router.declare_exchange("events", ExchangeType::Topic).unwrap();

        let exchanges = router.list_exchanges();
        assert_eq!(exchanges.len(), 2);
    }

    #[test]
    fn test_clear() {
        let router = Router::new();
        router.declare_exchange("logs", ExchangeType::Direct).unwrap();
        router.declare_exchange("events", ExchangeType::Topic).unwrap();

        router.clear();
        assert!(router.list_exchanges().is_empty());
    }
}
