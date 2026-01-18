#!/usr/bin/env node
/**
 * Debug script for integration testing.
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

    // Create a queue
    const createResult = await client.createQueue('tasks');
    console.log('Create queue result:', JSON.stringify(createResult, null, 2));

    // Enqueue items
    const enqueueResult1 = await client.enqueue('tasks', { action: '1' });
    console.log('Enqueue result 1:', JSON.stringify(enqueueResult1, null, 2));

    const enqueueResult2 = await client.enqueue('tasks', { action: '2' });
    console.log('Enqueue result 2:', JSON.stringify(enqueueResult2, null, 2));

    // Get stats
    console.log('\n=== Getting stats ===');
    const stats = await client.getStats('tasks');
    console.log('Stats result:', JSON.stringify(stats, null, 2));
    console.log('stats.depth:', stats?.depth);
    console.log('typeof stats:', typeof stats);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.disconnect();
    await server.stop();
  }
}

main().catch(console.error);
