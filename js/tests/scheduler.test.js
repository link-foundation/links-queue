/**
 * Test file for Scheduler module
 * Tests for delayed messages, cron jobs, TTL, and message expiration
 */

import { describe, it, expect } from 'test-anywhere';
import {
  CronParser,
  Scheduler,
  ScheduledQueue,
} from '../src/features/scheduler.js';

// =============================================================================
// CronParser Tests
// =============================================================================

describe('CronParser', () => {
  describe('parseField', () => {
    it('should parse wildcard (*)', () => {
      const values = CronParser.parseField('*', 0, 5);
      expect(values).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('should parse single value', () => {
      const values = CronParser.parseField('5', 0, 10);
      expect(values).toEqual([5]);
    });

    it('should parse comma-separated values', () => {
      const values = CronParser.parseField('1,3,5', 0, 10);
      expect(values).toEqual([1, 3, 5]);
    });

    it('should parse range (1-5)', () => {
      const values = CronParser.parseField('1-5', 0, 10);
      expect(values).toEqual([1, 2, 3, 4, 5]);
    });

    it('should parse step values (*/2)', () => {
      const values = CronParser.parseField('*/2', 0, 6);
      expect(values).toEqual([0, 2, 4, 6]);
    });

    it('should parse step values with start (2/3)', () => {
      const values = CronParser.parseField('2/3', 0, 10);
      expect(values).toEqual([2, 5, 8]);
    });

    it('should filter out values outside range', () => {
      const values = CronParser.parseField('0,5,15', 0, 10);
      expect(values).toEqual([0, 5]);
    });
  });

  describe('parse', () => {
    it('should parse valid 5-field cron expression', () => {
      const result = CronParser.parse('0 * * * *');
      expect(result.minutes).toEqual([0]);
      expect(result.hours.length).toBe(24);
      expect(result.daysOfMonth.length).toBe(31);
      expect(result.months.length).toBe(12);
      expect(result.daysOfWeek.length).toBe(7);
    });

    it('should parse every 5 minutes expression', () => {
      const result = CronParser.parse('*/5 * * * *');
      expect(result.minutes).toEqual([
        0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
      ]);
    });

    it('should parse specific time (9:30 every day)', () => {
      const result = CronParser.parse('30 9 * * *');
      expect(result.minutes).toEqual([30]);
      expect(result.hours).toEqual([9]);
    });

    it('should parse weekdays only', () => {
      const result = CronParser.parse('0 9 * * 1-5');
      expect(result.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    });

    it('should throw on invalid expression (wrong field count)', () => {
      expect(() => CronParser.parse('0 * * *')).toThrow();
      expect(() => CronParser.parse('0 * * * * *')).toThrow();
    });
  });

  describe('nextRun', () => {
    it('should calculate next run time', () => {
      const expression = '* * * * *'; // Every minute
      const after = new Date('2024-01-01T10:00:00');
      const next = CronParser.nextRun(expression, after);

      expect(next).not.toBe(null);
      expect(next.getTime()).toBeGreaterThan(after.getTime());
    });

    it('should return null for impossible expression', () => {
      // February 30th doesn't exist
      const expression = '0 0 30 2 *';
      const next = CronParser.nextRun(expression);
      expect(next).toBe(null);
    });
  });
});

// =============================================================================
// Scheduler Tests
// =============================================================================

describe('Scheduler', () => {
  describe('constructor', () => {
    it('should create scheduler with default options', () => {
      const scheduler = new Scheduler();
      expect(scheduler.isRunning).toBe(false);
      expect(scheduler.pendingCount).toBe(0);
    });

    it('should create scheduler with custom options', () => {
      const onDue = async () => {};
      const scheduler = new Scheduler({
        checkInterval: 500,
        onDue,
      });
      expect(scheduler.isRunning).toBe(false);
    });
  });

  describe('schedule', () => {
    it('should schedule an item with delay', () => {
      const scheduler = new Scheduler();
      const link = { id: 1, source: 'test', target: 'item' };

      const item = scheduler.schedule(link, { delay: 5000 });

      expect(item.link).toBe(link);
      expect(item.deliverAt).toBeGreaterThan(Date.now());
      expect(scheduler.pendingCount).toBe(1);
    });

    it('should schedule an item with specific deliverAt time', () => {
      const scheduler = new Scheduler();
      const link = { id: 1, source: 'test', target: 'item' };
      const deliverAt = Date.now() + 10000;

      const item = scheduler.schedule(link, { deliverAt });

      expect(item.deliverAt).toBe(deliverAt);
    });

    it('should schedule an item with TTL', () => {
      const scheduler = new Scheduler();
      const link = { id: 1, source: 'test', target: 'item' };

      const item = scheduler.schedule(link, { delay: 5000, ttl: 3000 });

      expect(item.expiresAt).not.toBe(null);
      expect(item.expiresAt).toBeLessThan(item.deliverAt);
    });

    it('should use link ID if provided', () => {
      const scheduler = new Scheduler();
      const link = { id: 42, source: 'test', target: 'item' };

      const item = scheduler.schedule(link);

      expect(item.id).toBe(42);
    });

    it('should generate ID if not provided', () => {
      const scheduler = new Scheduler();
      const link = { source: 'test', target: 'item' };

      const item = scheduler.schedule(link);

      expect(typeof item.id).toBe('string');
      expect(item.id.startsWith('sched_')).toBe(true);
    });
  });

  describe('cancel', () => {
    it('should cancel a scheduled item', () => {
      const scheduler = new Scheduler();
      const link = { id: 1, source: 'test', target: 'item' };

      scheduler.schedule(link, { delay: 5000 });
      expect(scheduler.pendingCount).toBe(1);

      const result = scheduler.cancel(1);
      expect(result).toBe(true);
      expect(scheduler.pendingCount).toBe(0);
    });

    it('should return false for non-existent item', () => {
      const scheduler = new Scheduler();
      const result = scheduler.cancel(999);
      expect(result).toBe(false);
    });
  });

  describe('get', () => {
    it('should get a scheduled item by ID', () => {
      const scheduler = new Scheduler();
      const link = { id: 1, source: 'test', target: 'item' };

      scheduler.schedule(link, { delay: 5000 });
      const item = scheduler.get(1);

      expect(item).not.toBeUndefined();
      expect(item.link).toBe(link);
    });

    it('should return undefined for non-existent item', () => {
      const scheduler = new Scheduler();
      const item = scheduler.get(999);
      expect(item).toBeUndefined();
    });
  });

  describe('cron jobs', () => {
    it('should add a cron job', () => {
      const scheduler = new Scheduler();
      const handler = async () => {};

      const job = scheduler.addCronJob('test-job', '* * * * *', handler);

      expect(job.id).toBe('test-job');
      expect(job.expression).toBe('* * * * *');
      expect(job.enabled).toBe(true);
      expect(job.nextRun).not.toBe(null);
    });

    it('should throw on invalid cron expression', () => {
      const scheduler = new Scheduler();
      const handler = async () => {};

      expect(() =>
        scheduler.addCronJob('bad-job', 'invalid', handler)
      ).toThrow();
    });

    it('should get a cron job by ID', () => {
      const scheduler = new Scheduler();
      const handler = async () => {};

      scheduler.addCronJob('test-job', '* * * * *', handler);
      const job = scheduler.getCronJob('test-job');

      expect(job).not.toBeUndefined();
      expect(job.id).toBe('test-job');
    });

    it('should remove a cron job', () => {
      const scheduler = new Scheduler();
      const handler = async () => {};

      scheduler.addCronJob('test-job', '* * * * *', handler);
      const result = scheduler.removeCronJob('test-job');

      expect(result).toBe(true);
      expect(scheduler.getCronJob('test-job')).toBeUndefined();
    });

    it('should enable and disable a cron job', () => {
      const scheduler = new Scheduler();
      const handler = async () => {};

      scheduler.addCronJob('test-job', '* * * * *', handler);

      scheduler.setCronJobEnabled('test-job', false);
      expect(scheduler.getCronJob('test-job').enabled).toBe(false);

      scheduler.setCronJobEnabled('test-job', true);
      expect(scheduler.getCronJob('test-job').enabled).toBe(true);
    });

    it('should list all cron jobs', () => {
      const scheduler = new Scheduler();
      const handler = async () => {};

      scheduler.addCronJob('job1', '* * * * *', handler);
      scheduler.addCronJob('job2', '0 * * * *', handler);

      const jobs = scheduler.listCronJobs();
      expect(jobs.length).toBe(2);
    });
  });

  describe('start/stop', () => {
    it('should start and stop the scheduler', () => {
      const scheduler = new Scheduler({ checkInterval: 60000 }); // Long interval to avoid timer firing during test

      scheduler.start();
      expect(scheduler.isRunning).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it('should not start twice', () => {
      const scheduler = new Scheduler({ checkInterval: 60000 }); // Long interval to avoid timer firing during test

      scheduler.start();
      scheduler.start(); // Should be no-op
      expect(scheduler.isRunning).toBe(true);

      scheduler.stop();
    });
  });

  describe('getStats', () => {
    it('should return statistics', () => {
      const scheduler = new Scheduler();
      const link = { id: 1, source: 'test', target: 'item' };

      scheduler.schedule(link, { delay: 5000 });
      scheduler.addCronJob('test', '* * * * *', async () => {});

      const stats = scheduler.getStats();

      expect(stats.scheduled).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.cronJobs).toBe(1);
      expect(stats.delivered).toBe(0);
      expect(stats.expired).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      const scheduler = new Scheduler({ checkInterval: 60000 }); // Long interval to avoid timer firing during test
      const link = { id: 1, source: 'test', target: 'item' };

      scheduler.schedule(link, { delay: 5000 });
      scheduler.addCronJob('test', '* * * * *', async () => {});
      scheduler.start();

      scheduler.clear();

      expect(scheduler.isRunning).toBe(false);
      expect(scheduler.pendingCount).toBe(0);
      expect(scheduler.listCronJobs().length).toBe(0);
    });
  });

  describe('getPendingItems', () => {
    it('should return all pending items', () => {
      const scheduler = new Scheduler();

      scheduler.schedule({ id: 1, source: 'a', target: 'b' }, { delay: 5000 });
      scheduler.schedule({ id: 2, source: 'c', target: 'd' }, { delay: 10000 });

      const items = scheduler.getPendingItems();
      expect(items.length).toBe(2);
    });
  });
});

// =============================================================================
// ScheduledQueue Tests
// =============================================================================

describe('ScheduledQueue', () => {
  // Mock queue for testing
  const createMockQueue = () => ({
    name: 'test-queue',
    _items: [],
    async enqueue(link) {
      this._items.push(link);
      return { id: link.id, position: this._items.length - 1 };
    },
    async dequeue() {
      return this._items.shift() || null;
    },
    async peek() {
      return this._items[0] || null;
    },
    async acknowledge() {},
    async reject() {},
    getStats() {
      return {
        depth: this._items.length,
        enqueued: 0,
        dequeued: 0,
        acknowledged: 0,
        rejected: 0,
        inFlight: 0,
      };
    },
    getDepth() {
      return this._items.length;
    },
    async clear() {
      this._items = [];
    },
  });

  describe('constructor', () => {
    it('should create scheduled queue from base queue', () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue, {
        checkInterval: 60000,
      }); // Long interval to avoid timer firing during test

      expect(scheduledQueue.name).toBe('test-queue');

      scheduledQueue.stop();
    });
  });

  describe('enqueue', () => {
    it('should enqueue immediately without delay', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue);
      const link = { id: 1, source: 'test', target: 'item' };

      await scheduledQueue.enqueue(link);

      expect(mockQueue._items.length).toBe(1);
      scheduledQueue.stop();
    });

    it('should schedule with delay', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue, {
        checkInterval: 60000,
      }); // Long interval to avoid timer firing during test
      const link = { id: 1, source: 'test', target: 'item' };

      const result = await scheduledQueue.enqueue(link, { delay: 5000 });

      // Should not be in queue yet
      expect(mockQueue._items.length).toBe(0);
      // Should return scheduled item
      expect(result.deliverAt).toBeGreaterThan(Date.now());

      scheduledQueue.stop();
    });
  });

  describe('dequeue', () => {
    it('should dequeue from underlying queue', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue);
      const link = { id: 1, source: 'test', target: 'item' };

      await scheduledQueue.enqueue(link);
      const result = await scheduledQueue.dequeue();

      expect(result).toEqual(link);
      scheduledQueue.stop();
    });
  });

  describe('getStats', () => {
    it('should include scheduled count in stats', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue);

      await scheduledQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await scheduledQueue.enqueue(
        { id: 2, source: 'c', target: 'd' },
        { delay: 5000 }
      );

      const stats = scheduledQueue.getStats();

      expect(stats.depth).toBe(1);
      expect(stats.scheduled).toBe(1);

      scheduledQueue.stop();
    });
  });

  describe('getDepth', () => {
    it('should include scheduled items in depth', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue);

      await scheduledQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await scheduledQueue.enqueue(
        { id: 2, source: 'c', target: 'd' },
        { delay: 5000 }
      );

      const depth = scheduledQueue.getDepth();
      expect(depth).toBe(2);

      scheduledQueue.stop();
    });
  });

  describe('cancelScheduled', () => {
    it('should cancel a scheduled item', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue, {
        checkInterval: 60000,
      }); // Long interval to avoid timer firing during test

      await scheduledQueue.enqueue(
        { id: 1, source: 'a', target: 'b' },
        { delay: 5000 }
      );
      expect(scheduledQueue.getDepth()).toBe(1);

      const result = scheduledQueue.cancelScheduled(1);
      expect(result).toBe(true);
      expect(scheduledQueue.getDepth()).toBe(0);

      scheduledQueue.stop();
    });
  });

  describe('clear', () => {
    it('should clear both queue and scheduler', async () => {
      const mockQueue = createMockQueue();
      const scheduledQueue = new ScheduledQueue(mockQueue);

      await scheduledQueue.enqueue({ id: 1, source: 'a', target: 'b' });
      await scheduledQueue.enqueue(
        { id: 2, source: 'c', target: 'd' },
        { delay: 5000 }
      );

      await scheduledQueue.clear();

      expect(scheduledQueue.getDepth()).toBe(0);
      expect(mockQueue._items.length).toBe(0);
    });
  });
});
