#!/usr/bin/env node
/**
 * Links Queue CLI.
 *
 * Command-line interface for running Links Queue server.
 *
 * @module cli
 *
 * Usage:
 *   links-queue server [options]
 *   links-queue server --config config.json
 *
 * Options:
 *   --host, -h        Host to bind to (default: 0.0.0.0)
 *   --port, -p        Port to listen on (default: 5000)
 *   --config, -c      Path to JSON configuration file
 *   --max-connections Maximum concurrent connections (default: 1000)
 *   --idle-timeout    Connection idle timeout in ms (default: 60000)
 *   --help            Show help
 *   --version         Show version
 */

import { readFileSync } from 'node:fs';
import { LinksQueueServer } from './server/server.js';

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
    options: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === 'server') {
      result.command = 'server';
    } else if (arg === '--help' || arg === '-h') {
      result.options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.options.version = true;
    } else if (arg === '--host') {
      result.options.host = args[++i];
    } else if (arg === '--port' || arg === '-p') {
      result.options.port = parseInt(args[++i], 10);
    } else if (arg === '--config' || arg === '-c') {
      result.options.config = args[++i];
    } else if (arg === '--max-connections') {
      result.options.maxConnections = parseInt(args[++i], 10);
    } else if (arg === '--idle-timeout') {
      result.options.idleTimeout = parseInt(args[++i], 10);
    }

    i++;
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
 * Shows help message.
 */
function showHelp() {
  console.log(`
Links Queue CLI

Usage:
  links-queue server [options]

Commands:
  server    Start the Links Queue TCP server

Server Options:
  --host              Host to bind to (default: 0.0.0.0)
  --port, -p          Port to listen on (default: 5000)
  --config, -c        Path to JSON configuration file
  --max-connections   Maximum concurrent connections (default: 1000)
  --idle-timeout      Connection idle timeout in ms (default: 60000)

General Options:
  --help, -h          Show this help message
  --version, -v       Show version number

Examples:
  links-queue server
  links-queue server --port 8080
  links-queue server --config ./config.json

Configuration File Format:
  {
    "host": "0.0.0.0",
    "port": 5000,
    "maxConnections": 1000,
    "idleTimeout": 60000,
    "backend": {
      "type": "memory"
    }
  }
`);
}

/**
 * Shows version.
 */
function showVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    console.log(`links-queue v${pkg.version}`);
  } catch {
    console.log('links-queue (version unknown)');
  }
}

/**
 * Runs the server command.
 *
 * @param {Object} options - Server options
 */
async function runServer(options) {
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
  if (options.maxConnections !== undefined) {
    config.maxConnections = options.maxConnections;
  }
  if (options.idleTimeout !== undefined) {
    config.idleTimeout = options.idleTimeout;
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
// Main
// =============================================================================

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.options.help) {
    showHelp();
    return;
  }

  if (parsed.options.version) {
    showVersion();
    return;
  }

  if (parsed.command === 'server') {
    await runServer(parsed.options);
  } else if (!parsed.command) {
    // Default to showing help if no command
    showHelp();
  } else {
    console.error(`Unknown command: ${parsed.command}`);
    showHelp();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
