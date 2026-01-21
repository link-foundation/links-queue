//! Tests for the pub/sub module.

use super::pubsub::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[tokio::test]
async fn test_message_filter() {
    let filter = MessageFilter::<String>::new()
        .with_header("priority", "high")
        .with_custom(|msg: &PublishedMessage<String>| msg.data.len() > 3);

    let mut headers = HashMap::new();
    headers.insert("priority".to_string(), "high".to_string());

    let msg1 = PublishedMessage {
        id: "1".to_string(),
        topic: "test".to_string(),
        data: "hello".to_string(),
        timestamp: Instant::now(),
        headers: headers.clone(),
    };

    let msg2 = PublishedMessage {
        id: "2".to_string(),
        topic: "test".to_string(),
        data: "hi".to_string(), // Too short
        timestamp: Instant::now(),
        headers: headers.clone(),
    };

    let msg3 = PublishedMessage {
        id: "3".to_string(),
        topic: "test".to_string(),
        data: "hello".to_string(),
        timestamp: Instant::now(),
        headers: HashMap::new(), // Missing header
    };

    assert!(filter.matches(&msg1));
    assert!(!filter.matches(&msg2));
    assert!(!filter.matches(&msg3));
}

#[tokio::test]
async fn test_broker_topic_management() {
    let broker = PubSubBroker::<String>::new(BrokerOptions {
        auto_create_topics: false,
        message_retention: None,
    });

    // Create topic
    let topic = broker.create_topic("events").await.unwrap();
    assert_eq!(topic.name, "events");
    assert_eq!(topic.subscriber_count, 0);

    // Duplicate topic should fail
    let result = broker.create_topic("events").await;
    assert!(matches!(result, Err(PubSubError::TopicExists(_))));

    // Get topic
    let topic = broker.get_topic("events").await;
    assert!(topic.is_some());

    // List topics
    let topics = broker.list_topics().await;
    assert_eq!(topics.len(), 1);

    // Delete topic
    let deleted = broker.delete_topic("events").await.unwrap();
    assert!(deleted);

    let topics = broker.list_topics().await;
    assert!(topics.is_empty());
}

#[tokio::test]
async fn test_broker_subscribe_unsubscribe() {
    let broker = PubSubBroker::<String>::new(BrokerOptions::default());

    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();

    // Subscribe
    let sub_id = broker
        .subscribe(
            "events",
            move |_msg| {
                let c = counter_clone.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                }
            },
            None,
        )
        .await
        .unwrap();

    // Verify subscription
    let sub = broker.get_subscription(&sub_id).await;
    assert!(sub.is_some());
    assert_eq!(sub.unwrap().topic, "events");

    // Publish
    let result = broker.publish("events", "test".to_string(), None).await.unwrap();
    assert_eq!(result.delivered, 1);

    // Wait a bit for async delivery
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(counter.load(Ordering::SeqCst), 1);

    // Unsubscribe
    let unsubbed = broker.unsubscribe(&sub_id).await.unwrap();
    assert!(unsubbed);

    // Publish again (no subscribers)
    let result = broker.publish("events", "test2".to_string(), None).await.unwrap();
    assert_eq!(result.delivered, 0);
}

#[tokio::test]
async fn test_broker_pause_resume() {
    let broker = PubSubBroker::<String>::new(BrokerOptions::default());

    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();

    let sub_id = broker
        .subscribe(
            "events",
            move |_msg| {
                let c = counter_clone.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                }
            },
            None,
        )
        .await
        .unwrap();

    // Pause
    broker.pause(&sub_id).await;

    // Publish (should not deliver)
    broker.publish("events", "test".to_string(), None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(counter.load(Ordering::SeqCst), 0);

    // Resume
    broker.resume(&sub_id).await;

    // Publish (should deliver)
    broker.publish("events", "test".to_string(), None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(counter.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn test_broker_filtering() {
    let broker = PubSubBroker::<String>::new(BrokerOptions::default());

    let counter = Arc::new(AtomicUsize::new(0));
    let counter_clone = counter.clone();

    // Subscribe with filter
    let filter = MessageFilter::new()
        .with_header("priority", "high");

    broker
        .subscribe(
            "events",
            move |_msg| {
                let c = counter_clone.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                }
            },
            Some(filter),
        )
        .await
        .unwrap();

    // Publish without matching header (should filter)
    let result = broker.publish("events", "test".to_string(), None).await.unwrap();
    assert_eq!(result.filtered, 1);
    assert_eq!(result.delivered, 0);

    // Publish with matching header
    let mut headers = HashMap::new();
    headers.insert("priority".to_string(), "high".to_string());
    let result = broker.publish("events", "test".to_string(), Some(headers)).await.unwrap();
    assert_eq!(result.filtered, 0);
    assert_eq!(result.delivered, 1);
}

#[tokio::test]
async fn test_broker_message_retention() {
    let broker = PubSubBroker::<String>::new(BrokerOptions {
        auto_create_topics: true,
        message_retention: Some(Duration::from_secs(60)),
    });

    // Publish some messages
    broker.publish("events", "msg1".to_string(), None).await.unwrap();
    broker.publish("events", "msg2".to_string(), None).await.unwrap();
    broker.publish("events", "msg3".to_string(), None).await.unwrap();

    // Get history
    let history = broker.get_history("events", 10).await;
    assert_eq!(history.len(), 3);
    assert_eq!(history[0].data, "msg1");
    assert_eq!(history[2].data, "msg3");

    // Get limited history
    let history = broker.get_history("events", 2).await;
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].data, "msg2");
}

#[tokio::test]
async fn test_broker_stats() {
    let broker = PubSubBroker::<String>::new(BrokerOptions::default());

    // Create topics and subscriptions
    broker.create_topic("topic1").await.unwrap();
    broker.create_topic("topic2").await.unwrap();

    broker
        .subscribe("topic1", |_| async {}, None)
        .await
        .unwrap();
    broker
        .subscribe("topic1", |_| async {}, None)
        .await
        .unwrap();

    // Publish
    broker.publish("topic1", "test".to_string(), None).await.unwrap();

    let stats = broker.get_stats().await;
    assert_eq!(stats.topics, 2);
    assert_eq!(stats.subscriptions, 2);
    assert_eq!(stats.published, 1);
    assert_eq!(stats.delivered, 2);
}

#[tokio::test]
async fn test_broker_auto_create_topics() {
    // With auto-create enabled
    let broker = PubSubBroker::<String>::new(BrokerOptions {
        auto_create_topics: true,
        message_retention: None,
    });

    // Should auto-create topic on publish
    broker.publish("auto-topic", "test".to_string(), None).await.unwrap();
    let topic = broker.get_topic("auto-topic").await;
    assert!(topic.is_some());

    // With auto-create disabled
    let broker = PubSubBroker::<String>::new(BrokerOptions {
        auto_create_topics: false,
        message_retention: None,
    });

    // Should fail on publish to non-existent topic
    let result = broker.publish("auto-topic", "test".to_string(), None).await;
    assert!(matches!(result, Err(PubSubError::TopicNotFound(_))));
}

#[tokio::test]
async fn test_publish_many() {
    let broker = PubSubBroker::<String>::new(BrokerOptions::default());

    broker.create_topic("topic1").await.unwrap();
    broker.create_topic("topic2").await.unwrap();

    let results = broker
        .publish_many(&["topic1", "topic2"], "test".to_string(), None)
        .await;

    assert_eq!(results.len(), 2);
    assert!(results.get("topic1").unwrap().is_ok());
    assert!(results.get("topic2").unwrap().is_ok());
}
