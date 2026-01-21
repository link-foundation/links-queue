//! Tests for the scheduler module.

use super::scheduler::*;
use crate::{Link, LinkRef};
use std::time::Duration;

mod cron_parser_tests {
    use super::*;

    #[test]
    fn test_parse_wildcard() {
        let values = CronParser::parse_field("*", 0, 5);
        assert_eq!(values, vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_parse_single_value() {
        let values = CronParser::parse_field("5", 0, 10);
        assert_eq!(values, vec![5]);
    }

    #[test]
    fn test_parse_comma_separated() {
        let values = CronParser::parse_field("1,3,5", 0, 10);
        assert_eq!(values, vec![1, 3, 5]);
    }

    #[test]
    fn test_parse_range() {
        let values = CronParser::parse_field("1-5", 0, 10);
        assert_eq!(values, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_parse_step() {
        let values = CronParser::parse_field("*/2", 0, 6);
        assert_eq!(values, vec![0, 2, 4, 6]);
    }

    #[test]
    fn test_parse_step_with_start() {
        let values = CronParser::parse_field("2/3", 0, 10);
        assert_eq!(values, vec![2, 5, 8]);
    }

    #[test]
    fn test_parse_filters_out_of_range() {
        let values = CronParser::parse_field("0,5,15", 0, 10);
        assert_eq!(values, vec![0, 5]);
    }

    #[test]
    fn test_parse_full_expression() {
        let result = CronParser::parse("0 * * * *");
        assert!(result.is_ok());
        let schedule = result.unwrap();
        assert_eq!(schedule.minutes, vec![0]);
        assert_eq!(schedule.hours.len(), 24);
        assert_eq!(schedule.days_of_month.len(), 31);
        assert_eq!(schedule.months.len(), 12);
        assert_eq!(schedule.days_of_week.len(), 7);
    }

    #[test]
    fn test_parse_invalid_field_count() {
        let result = CronParser::parse("0 * * *");
        assert!(result.is_err());
    }

    #[test]
    fn test_next_run() {
        let next = CronParser::next_run("* * * * *", None);
        assert!(next.is_some());
    }
}

mod scheduler_tests {
    use super::*;

    #[test]
    fn test_scheduler_creation() {
        let scheduler: Scheduler<u64> = Scheduler::new();
        assert!(!scheduler.is_running());
        assert_eq!(scheduler.pending_count(), 0);
    }

    #[test]
    fn test_schedule_item() {
        let scheduler: Scheduler<u64> = Scheduler::new();
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));

        let item = scheduler.schedule(link, Duration::from_secs(5), None);

        assert!(item.deliver_at > item.scheduled_at);
        assert_eq!(scheduler.pending_count(), 1);
    }

    #[test]
    fn test_schedule_with_ttl() {
        let scheduler: Scheduler<u64> = Scheduler::new();
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));

        let item = scheduler.schedule(link, Duration::from_secs(5), Some(Duration::from_secs(3)));

        assert!(item.expires_at.is_some());
        assert!(item.expires_at.unwrap() < item.deliver_at);
    }

    #[test]
    fn test_cancel_item() {
        let scheduler: Scheduler<u64> = Scheduler::new();
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));

        let item = scheduler.schedule(link, Duration::from_secs(5), None);
        assert_eq!(scheduler.pending_count(), 1);

        let result = scheduler.cancel(&item.id);
        assert!(result);
        assert_eq!(scheduler.pending_count(), 0);
    }

    #[test]
    fn test_cancel_nonexistent() {
        let scheduler: Scheduler<u64> = Scheduler::new();
        let result = scheduler.cancel(&999);
        assert!(!result);
    }

    #[test]
    fn test_get_item() {
        let scheduler: Scheduler<u64> = Scheduler::new();
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));

        let item = scheduler.schedule(link.clone(), Duration::from_secs(5), None);
        let retrieved = scheduler.get(&item.id);

        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().link.id, link.id);
    }

    #[test]
    fn test_add_cron_job() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let handler: fn(Link<u64>) = |_| {};

        let result = scheduler.add_cron_job("test-job", "* * * * *", handler);
        assert!(result.is_ok());

        let job = scheduler.get_cron_job("test-job");
        assert!(job.is_some());
    }

    #[test]
    fn test_add_invalid_cron_job() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let handler: fn(Link<u64>) = |_| {};

        let result = scheduler.add_cron_job("bad-job", "invalid", handler);
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_cron_job() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let handler: fn(Link<u64>) = |_| {};

        scheduler.add_cron_job("test-job", "* * * * *", handler).unwrap();
        let result = scheduler.remove_cron_job("test-job");
        assert!(result);

        let job = scheduler.get_cron_job("test-job");
        assert!(job.is_none());
    }

    #[test]
    fn test_enable_disable_cron_job() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let handler: fn(Link<u64>) = |_| {};

        scheduler.add_cron_job("test-job", "* * * * *", handler).unwrap();

        scheduler.set_cron_job_enabled("test-job", false);
        let job = scheduler.get_cron_job("test-job");
        assert!(!job.unwrap().1);

        scheduler.set_cron_job_enabled("test-job", true);
        let job = scheduler.get_cron_job("test-job");
        assert!(job.unwrap().1);
    }

    #[test]
    fn test_list_cron_jobs() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let handler: fn(Link<u64>) = |_| {};

        scheduler.add_cron_job("job1", "* * * * *", handler).unwrap();
        scheduler.add_cron_job("job2", "0 * * * *", handler).unwrap();

        let jobs = scheduler.list_cron_jobs();
        assert_eq!(jobs.len(), 2);
    }

    #[test]
    fn test_start_stop() {
        let scheduler: Scheduler<u64> = Scheduler::new();

        scheduler.start();
        assert!(scheduler.is_running());

        scheduler.stop();
        assert!(!scheduler.is_running());
    }

    #[test]
    fn test_stats() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));

        scheduler.schedule(link, Duration::from_secs(5), None);
        let handler: fn(Link<u64>) = |_| {};
        scheduler.add_cron_job("test", "* * * * *", handler).unwrap();

        let stats = scheduler.stats();
        assert_eq!(stats.scheduled, 1);
        assert_eq!(stats.pending, 1);
        assert_eq!(stats.cron_jobs, 1);
    }

    #[test]
    fn test_clear() {
        let scheduler: Scheduler<u64, fn(Link<u64>)> = Scheduler::new();
        let link = Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3));
        let handler: fn(Link<u64>) = |_| {};

        scheduler.schedule(link, Duration::from_secs(5), None);
        scheduler.add_cron_job("test", "* * * * *", handler).unwrap();
        scheduler.start();

        scheduler.clear();

        assert!(!scheduler.is_running());
        assert_eq!(scheduler.pending_count(), 0);
        assert_eq!(scheduler.list_cron_jobs().len(), 0);
    }

    #[test]
    fn test_get_pending_items() {
        let scheduler: Scheduler<u64> = Scheduler::new();

        scheduler.schedule(
            Link::new(1u64, LinkRef::Id(2), LinkRef::Id(3)),
            Duration::from_secs(5),
            None,
        );
        scheduler.schedule(
            Link::new(2u64, LinkRef::Id(4), LinkRef::Id(5)),
            Duration::from_secs(10),
            None,
        );

        let items = scheduler.get_pending_items();
        assert_eq!(items.len(), 2);
    }
}
