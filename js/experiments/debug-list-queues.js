#!/usr/bin/env node
/**
 * Debug script for listing queues.
 */

import { LinksQueueServer } from '../src/server/index.js';
import { LinksQueueClient } from '../src/client/index.js';

async function main() {
  // Start server on random port
  const server = new LinksQueueServer({ port: 0 });
  await server.start();
  const serverPort = server.address.port;
  console.log('Server started on port:', serverPort);

  // Create client
  const client = new LinksQueueClient({
    host: 'localhost',
    port: serverPort,
    reconnect: false,
  });

  try {
    // Connect
    await client.connect();
    console.log('Client connected');

    // Create queues
    console.log('\n=== Creating queues ===');
    const createResult1 = await client.createQueue('tasks');
    console.log(
      'Create queue "tasks" result:',
      JSON.stringify(createResult1, null, 2)
    );

    const createResult2 = await client.createQueue('queue2');
    console.log(
      'Create queue "queue2" result:',
      JSON.stringify(createResult2, null, 2)
    );

    // List queues
    console.log('\n=== Listing queues ===');
    const queues = await client.listQueues();
    console.log('List queues result:', JSON.stringify(queues, null, 2));
    console.log('Is array:', Array.isArray(queues));

    if (Array.isArray(queues)) {
      const names = queues.map((q) => q.name);
      console.log('Queue names:', names);
    }
  } catch (error) {
    console.error('Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    await client.disconnect();
    await server.stop();
  }
}

main().catch(console.error);
