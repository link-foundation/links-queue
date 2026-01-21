#!/usr/bin/env node
/**
 * Links Queue CLI.
 *
 * Command-line interface for running and managing Links Queue.
 *
 * @module cli
 *
 * Usage:
 *   links-queue server [options]       Start the queue server
 *   links-queue queue <command>        Queue management commands
 *   links-queue messages <command>     Message operations
 *   links-queue cluster <command>      Cluster management commands
 *
 * See 'links-queue <command> --help' for more information on a command.
 */

import { readFileSync } from 'node:fs';
import { LinksQueueServer } from './server/server.js';
import { LinksQueueClient } from './client/client.js';

// =============================================================================
// Parse Arguments
// =============================================================================

/**
 * Parses command line arguments.
 *
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs(args) {
  const result = {
    command: null,
    subcommand: null,
    args: [],
    options: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      if (nextArg && !nextArg.startsWith('-')) {
        // Option with value
        if (
          key === 'port' ||
          key === 'max-connections' ||
          key === 'idle-timeout' ||
          key === 'count'
        ) {
          result.options[key] = parseInt(nextArg, 10);
        } else {
          result.options[key] = nextArg;
        }
        i += 2;
      } else {
        // Boolean option
        result.options[key] = true;
        i++;
      }
    } else if (arg.startsWith('-')) {
      // Short options
      const key = arg.slice(1);
      const nextArg = args[i + 1];

      if (key === 'h') {
        result.options.help = true;
      } else if (key === 'v') {
        result.options.version = true;
      } else if (key === 'p' && nextArg && !nextArg.startsWith('-')) {
        result.options.port = parseInt(nextArg, 10);
        i++;
      } else if (key === 'c' && nextArg && !nextArg.startsWith('-')) {
        result.options.config = nextArg;
        i++;
      } else if (key === 's' && nextArg && !nextArg.startsWith('-')) {
        result.options.server = nextArg;
        i++;
      }
      i++;
    } else if (!result.command) {
      result.command = arg;
      i++;
    } else if (!result.subcommand) {
      result.subcommand = arg;
      i++;
    } else {
      result.args.push(arg);
      i++;
    }
  }

  return result;
}

/**
 * Loads configuration from a JSON file.
 *
 * @param {string} path - Path to configuration file
 * @returns {Object} Configuration object
 */
function loadConfig(path) {
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading config file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Gets package version.
 *
 * @returns {string} Version string
 */
function getVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// =============================================================================
// Help Messages
// =============================================================================

/**
 * Shows main help message.
 */
function showHelp() {
  const version = getVersion();
  console.log(`
Links Queue CLI v${version}

Usage:
  links-queue <command> [options]

Commands:
  server              Start the Links Queue TCP server
  queue               Queue management (list, create, delete)
  messages            Message operations (peek, purge)
  cluster             Cluster management (status, nodes)
  version             Show version number
  help                Show this help message

Run 'links-queue <command> --help' for more information on a command.

Examples:
  links-queue server
  links-queue server --port 8080
  links-queue queue list -s tcp://localhost:5000
  links-queue queue create tasks --options '{"retryLimit": 3}'
`);
}

/**
 * Shows server help.
 */
function showServerHelp() {
  console.log(`
links-queue server - Start the Links Queue TCP server

Usage:
  links-queue server [options]

Options:
  --host              Host to bind to (default: 0.0.0.0)
  --port, -p          Port to listen on (default: 5000)
  --config, -c        Path to JSON configuration file
  --max-connections   Maximum concurrent connections (default: 1000)
  --idle-timeout      Connection idle timeout in ms (default: 60000)
  --help, -h          Show this help message

Examples:
  links-queue server
  links-queue server --port 8080
  links-queue server --config ./config.json
`);
}

/**
 * Shows queue help.
 */
function showQueueHelp() {
  console.log(`
links-queue queue - Queue management commands

Usage:
  links-queue queue <command> [options]

Commands:
  list                List all queues
  create <name>       Create a new queue
  delete <name>       Delete a queue
  stats <name>        Show queue statistics

Options:
  --server, -s        Server address (default: tcp://localhost:5000)
  --options           Queue options as JSON (for create)
  --help, -h          Show this help message

Examples:
  links-queue queue list
  links-queue queue create tasks
  links-queue queue create tasks --options '{"retryLimit": 3}'
  links-queue queue delete tasks
  links-queue queue stats tasks
`);
}

/**
 * Shows messages help.
 */
function showMessagesHelp() {
  console.log(`
links-queue messages - Message operations

Usage:
  links-queue messages <command> <queue> [options]

Commands:
  peek <queue>        View messages without removing them
  purge <queue>       Remove all messages from queue

Options:
  --server, -s        Server address (default: tcp://localhost:5000)
  --count             Number of messages to peek (default: 10)
  --help, -h          Show this help message

Examples:
  links-queue messages peek tasks
  links-queue messages peek tasks --count 5
  links-queue messages purge tasks
`);
}

/**
 * Shows cluster help.
 */
function showClusterHelp() {
  console.log(`
links-queue cluster - Cluster management commands

Usage:
  links-queue cluster <command> [options]

Commands:
  status              Show cluster status
  nodes               List cluster nodes

Options:
  --server, -s        Server address (default: tcp://localhost:5000)
  --help, -h          Show this help message

Examples:
  links-queue cluster status
  links-queue cluster nodes
`);
}

// =============================================================================
// Server Command
// =============================================================================

/**
 * Runs the server command.
 *
 * @param {Object} options - Server options
 */
async function runServer(options) {
  if (options.help) {
    showServerHelp();
    return;
  }

  // Load config file if specified
  let config = {};
  if (options.config) {
    config = loadConfig(options.config);
  }

  // Override with command line options
  if (options.host !== undefined) {
    config.host = options.host;
  }
  if (options.port !== undefined) {
    config.port = options.port;
  }
  if (options['max-connections'] !== undefined) {
    config.maxConnections = options['max-connections'];
  }
  if (options['idle-timeout'] !== undefined) {
    config.idleTimeout = options['idle-timeout'];
  }

  // Create and start server
  const server = new LinksQueueServer(config);

  // Handle events
  server.on('listening', (addr) => {
    console.log(`Links Queue server listening on ${addr.host}:${addr.port}`);
  });

  server.on('connection', (connection) => {
    console.log(
      `Client connected: ${connection.id} from ${connection.remoteAddress}`
    );
  });

  server.on('disconnection', (connection) => {
    console.log(`Client disconnected: ${connection.id}`);
  });

  server.on('error', (error) => {
    console.error(`Server error: ${error.message}`);
  });

  // Handle shutdown signals
  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await server.shutdown({ drainTimeout: 30000 });
    console.log('Server stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  try {
    await server.start();
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

// =============================================================================
// Queue Commands
// =============================================================================

/**
 * Creates a client and connects to server.
 *
 * @param {Object} options - Options with server address
 * @returns {Promise<LinksQueueClient>} Connected client
 */
async function createClient(options) {
  const serverUrl = options.server || 'tcp://localhost:5000';
  const client = new LinksQueueClient(serverUrl, {
    connectTimeout: 5000,
    requestTimeout: 10000,
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.error(`Failed to connect to server: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Runs queue commands.
 *
 * @param {string} subcommand - Queue subcommand
 * @param {string[]} args - Command arguments
 * @param {Object} options - Command options
 */
async function runQueueCommand(subcommand, args, options) {
  if (options.help || !subcommand) {
    showQueueHelp();
    return;
  }

  const client = await createClient(options);

  try {
    switch (subcommand) {
      case 'list': {
        const queues = await client.listQueues();
        if (queues.length === 0) {
          console.log('No queues found.');
        } else {
          console.log('Queues:');
          for (const q of queues) {
            console.log(`  ${q.name} (depth: ${q.depth})`);
          }
        }
        break;
      }

      case 'create': {
        const name = args[0];
        if (!name) {
          console.error('Error: Queue name is required');
          process.exit(1);
        }

        let queueOptions = {};
        if (options.options) {
          try {
            queueOptions = JSON.parse(options.options);
          } catch {
            console.error('Error: Invalid JSON in --options');
            process.exit(1);
          }
        }

        await client.createQueue(name, queueOptions);
        console.log(`Queue '${name}' created.`);
        break;
      }

      case 'delete': {
        const name = args[0];
        if (!name) {
          console.error('Error: Queue name is required');
          process.exit(1);
        }

        await client.deleteQueue(name);
        console.log(`Queue '${name}' deleted.`);
        break;
      }

      case 'stats': {
        const name = args[0];
        if (!name) {
          console.error('Error: Queue name is required');
          process.exit(1);
        }

        const stats = await client.getStats(name);
        console.log(`Queue: ${name}`);
        console.log(`  Depth: ${stats.depth}`);
        console.log(`  In-flight: ${stats.inFlight}`);
        console.log(`  Enqueued: ${stats.enqueued}`);
        console.log(`  Dequeued: ${stats.dequeued}`);
        console.log(`  Acknowledged: ${stats.acknowledged}`);
        console.log(`  Rejected: ${stats.rejected}`);
        console.log(`  Dead-lettered: ${stats.deadLettered}`);
        break;
      }

      default:
        console.error(`Unknown queue command: ${subcommand}`);
        showQueueHelp();
        process.exit(1);
    }
  } finally {
    await client.disconnect();
  }
}

// =============================================================================
// Messages Commands
// =============================================================================

/**
 * Runs messages commands.
 *
 * @param {string} subcommand - Messages subcommand
 * @param {string[]} args - Command arguments
 * @param {Object} options - Command options
 */
async function runMessagesCommand(subcommand, args, options) {
  if (options.help || !subcommand) {
    showMessagesHelp();
    return;
  }

  const client = await createClient(options);

  try {
    switch (subcommand) {
      case 'peek': {
        const queueName = args[0];
        if (!queueName) {
          console.error('Error: Queue name is required');
          process.exit(1);
        }

        const count = options.count || 10;
        console.log(`Peeking at ${count} message(s) from '${queueName}'...`);

        // Note: Current API only supports single peek
        // This is a simplified implementation
        const message = await client.peek(queueName);
        if (message) {
          console.log('Messages:');
          console.log(JSON.stringify(message, null, 2));
        } else {
          console.log('Queue is empty.');
        }
        break;
      }

      case 'purge': {
        const queueName = args[0];
        if (!queueName) {
          console.error('Error: Queue name is required');
          process.exit(1);
        }

        // Purge by repeatedly dequeuing
        let count = 0;
        let message;
        console.log(`Purging queue '${queueName}'...`);

        do {
          message = await client.dequeue(queueName);
          if (message) {
            await client.acknowledge(queueName, message.id);
            count++;
          }
        } while (message);

        console.log(`Purged ${count} message(s).`);
        break;
      }

      default:
        console.error(`Unknown messages command: ${subcommand}`);
        showMessagesHelp();
        process.exit(1);
    }
  } finally {
    await client.disconnect();
  }
}

// =============================================================================
// Cluster Commands
// =============================================================================

/**
 * Runs cluster commands.
 *
 * @param {string} subcommand - Cluster subcommand
 * @param {string[]} args - Command arguments
 * @param {Object} options - Command options
 */
async function runClusterCommand(subcommand, args, options) {
  if (options.help || !subcommand) {
    showClusterHelp();
    return;
  }

  const client = await createClient(options);

  try {
    switch (subcommand) {
      case 'status': {
        // Get server stats (includes basic cluster info)
        const queues = await client.listQueues();
        const stats = client.getClientStats();

        console.log('Cluster Status:');
        console.log(`  Connected: ${client.isConnected}`);
        console.log(`  State: ${client.state}`);
        console.log(`  Queues: ${queues.length}`);
        console.log(`  Requests: ${stats.requestsSent || 0}`);
        console.log(`  Responses: ${stats.responsesReceived || 0}`);
        break;
      }

      case 'nodes': {
        // For single-node setup, show local info
        console.log('Cluster Nodes:');
        console.log(
          `  Node 1: ${options.server || 'tcp://localhost:5000'} (connected)`
        );
        console.log(
          '\nNote: Multi-node cluster info requires cluster mode to be enabled.'
        );
        break;
      }

      default:
        console.error(`Unknown cluster command: ${subcommand}`);
        showClusterHelp();
        process.exit(1);
    }
  } finally {
    await client.disconnect();
  }
}

// =============================================================================
// Main
// =============================================================================

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.options.help && !parsed.command) {
    showHelp();
    return;
  }

  if (parsed.options.version) {
    console.log(`links-queue v${getVersion()}`);
    return;
  }

  switch (parsed.command) {
    case 'server':
      await runServer(parsed.options);
      break;

    case 'queue':
      await runQueueCommand(parsed.subcommand, parsed.args, parsed.options);
      break;

    case 'messages':
      await runMessagesCommand(parsed.subcommand, parsed.args, parsed.options);
      break;

    case 'cluster':
      await runClusterCommand(parsed.subcommand, parsed.args, parsed.options);
      break;

    case 'version':
      console.log(`links-queue v${getVersion()}`);
      break;

    case 'help':
      showHelp();
      break;

    case null:
    case undefined:
      showHelp();
      break;

    default:
      console.error(`Unknown command: ${parsed.command}`);
      showHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
