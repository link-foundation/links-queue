/**
 * Producer-Consumer Example for links-queue
 *
 * This example demonstrates the classic producer-consumer pattern using
 * Links Queue as a work queue. Multiple producers generate tasks and
 * multiple consumers process them concurrently.
 *
 * Run with any runtime:
 * - Node.js: node examples/03-producer-consumer/index.js
 * - Bun: bun examples/03-producer-consumer/index.js
 * - Deno: deno run examples/03-producer-consumer/index.js
 */

import {
  createLink,
  MemoryLinkStore,
  LinksQueue,
  delay,
} from '../../src/index.js';

// Simulated processing time (50-200ms)
const simulateWork = () => delay(Math.floor(Math.random() * 150) + 50);

/**
 * Producer: generates tasks and enqueues them
 */
async function producer(queue, producerId, taskCount) {
  console.log(
    `Producer ${producerId}: Starting, will create ${taskCount} tasks`
  );

  for (let i = 0; i < taskCount; i++) {
    // Create a task link
    // source = task type/category
    // target = task payload
    const taskLink = createLink(
      `${producerId}-${i}`, // unique task ID
      `task-type-${(i % 3) + 1}`, // task type (1, 2, or 3)
      { data: `payload-${producerId}-${i}`, priority: i % 5 } // task data
    );

    const result = await queue.enqueue(taskLink);
    console.log(
      `Producer ${producerId}: Enqueued task ${taskLink.id} at position ${result.position}`
    );

    // Small delay between producing tasks
    await delay(10);
  }

  console.log(`Producer ${producerId}: Finished producing`);
}

/**
 * Consumer: processes tasks from the queue
 */
async function consumer(queue, consumerId, stopSignal) {
  console.log(`Consumer ${consumerId}: Starting`);
  let processed = 0;

  while (!stopSignal.stopped) {
    const task = await queue.dequeue();

    if (task === null) {
      // No tasks available, wait a bit
      await delay(50);
      continue;
    }

    console.log(
      `Consumer ${consumerId}: Processing task ${task.id} (type: ${task.source})`
    );

    // Simulate processing work
    await simulateWork();

    // Acknowledge successful processing
    await queue.acknowledge(task.id);
    processed++;
    console.log(`Consumer ${consumerId}: Completed task ${task.id}`);
  }

  console.log(
    `Consumer ${consumerId}: Stopped after processing ${processed} tasks`
  );
  return processed;
}

/**
 * Monitor: periodically reports queue status
 */
async function monitor(queue, stopSignal) {
  while (!stopSignal.stopped) {
    const stats = queue.getStats();
    console.log(
      `\n[Monitor] Queue depth: ${stats.depth}, ` +
        `Enqueued: ${stats.enqueued}, Dequeued: ${stats.dequeued}, ` +
        `Acked: ${stats.acknowledged}, In-flight: ${stats.inFlight}\n`
    );
    await delay(500);
  }
}

async function main() {
  console.log('=== Links Queue: Producer-Consumer Pattern ===\n');

  // Create queue
  const store = new MemoryLinkStore();
  const queue = new LinksQueue({
    name: 'work-queue',
    store,
    options: {
      visibilityTimeout: 60,
      retryLimit: 3,
    },
  });

  // Stop signal for consumers
  const stopSignal = { stopped: false };

  // Configuration
  const PRODUCER_COUNT = 2;
  const CONSUMER_COUNT = 3;
  const TASKS_PER_PRODUCER = 5;

  console.log(`Configuration:`);
  console.log(`  Producers: ${PRODUCER_COUNT}`);
  console.log(`  Consumers: ${CONSUMER_COUNT}`);
  console.log(`  Tasks per producer: ${TASKS_PER_PRODUCER}`);
  console.log(`  Total tasks: ${PRODUCER_COUNT * TASKS_PER_PRODUCER}\n`);

  // Start monitor in background (intentionally not awaited)
  monitor(queue, stopSignal);

  // Start consumers
  const consumerPromises = [];
  for (let i = 1; i <= CONSUMER_COUNT; i++) {
    consumerPromises.push(consumer(queue, i, stopSignal));
  }

  // Start producers
  const producerPromises = [];
  for (let i = 1; i <= PRODUCER_COUNT; i++) {
    producerPromises.push(producer(queue, i, TASKS_PER_PRODUCER));
  }

  // Wait for all producers to finish
  await Promise.all(producerPromises);
  console.log('\n--- All producers finished ---\n');

  // Wait for queue to drain
  while (queue.getStats().depth > 0 || queue.getStats().inFlight > 0) {
    await delay(100);
  }

  // Stop consumers
  stopSignal.stopped = true;
  await delay(100); // Allow consumers to exit

  // Final results
  const totalProcessed = await Promise.all(consumerPromises);
  const stats = queue.getStats();

  console.log('\n=== Final Results ===');
  console.log(`Total tasks enqueued: ${stats.enqueued}`);
  console.log(`Total tasks dequeued: ${stats.dequeued}`);
  console.log(`Total tasks acknowledged: ${stats.acknowledged}`);
  console.log(`Tasks processed per consumer: ${totalProcessed.join(', ')}`);
  console.log(`Total processed: ${totalProcessed.reduce((a, b) => a + b, 0)}`);

  console.log('\n=== Producer-Consumer Complete! ===');
}

// Run the example
main().catch(console.error);
