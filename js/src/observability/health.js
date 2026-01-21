/**
 * Health check module for links-queue.
 *
 * Provides liveness and readiness endpoints with component health details,
 * compatible with Kubernetes health probes.
 *
 * @module observability/health
 *
 * @see REQUIREMENTS.md - REQ-OBS-020 through REQ-OBS-022
 */

/**
 * Health status values.
 */
export const HealthStatus = Object.freeze({
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  DEGRADED: 'degraded',
  UNKNOWN: 'unknown',
});

/**
 * Component health check result.
 *
 * @typedef {Object} ComponentHealth
 * @property {string} status - Health status
 * @property {number} [latency] - Response latency in ms
 * @property {string} [message] - Additional message
 * @property {Object} [details] - Additional details
 */

/**
 * Overall health check result.
 *
 * @typedef {Object} HealthCheckResult
 * @property {string} status - Overall health status
 * @property {number} timestamp - Check timestamp
 * @property {string} version - Application version
 * @property {number} uptime - Uptime in milliseconds
 * @property {Object<string, ComponentHealth>} components - Component health
 */

/**
 * A component health checker.
 */
export class ComponentChecker {
  /**
   * Creates a new ComponentChecker.
   *
   * @param {Object} options - Configuration options
   * @param {string} options.name - Component name
   * @param {Function} options.check - Health check function (async, returns ComponentHealth)
   * @param {boolean} [options.critical=true] - Whether this component is critical for overall health
   * @param {number} [options.timeout=5000] - Check timeout in ms
   */
  constructor(options) {
    this._name = options.name;
    this._check = options.check;
    this._critical = options.critical !== false;
    this._timeout = options.timeout ?? 5000;
  }

  /**
   * Gets the component name.
   *
   * @returns {string} Component name
   */
  get name() {
    return this._name;
  }

  /**
   * Gets whether this component is critical.
   *
   * @returns {boolean} True if critical
   */
  get critical() {
    return this._critical;
  }

  /**
   * Runs the health check.
   *
   * @returns {Promise<ComponentHealth>} Health check result
   */
  async check() {
    const start = Date.now();
    try {
      const result = await Promise.race([
        this._check(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Health check timeout')),
            this._timeout
          )
        ),
      ]);

      return {
        status: result.status ?? HealthStatus.HEALTHY,
        latency: Date.now() - start,
        ...result,
      };
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        latency: Date.now() - start,
        message: error.message,
      };
    }
  }
}

/**
 * Health checker for links-queue.
 *
 * Provides liveness, readiness, and detailed health checks
 * compatible with Kubernetes health probes.
 */
export class HealthChecker {
  /**
   * Creates a new HealthChecker.
   *
   * @param {Object} [options] - Configuration options
   * @param {string} [options.version] - Application version
   * @param {Object<string, ComponentChecker>} [options.components] - Pre-registered components
   */
  constructor(options = {}) {
    this._version = options.version ?? '0.0.0';
    this._startTime = Date.now();
    /** @type {Map<string, ComponentChecker>} */
    this._components = new Map();

    // Pre-register components if provided
    if (options.components) {
      for (const [name, checker] of Object.entries(options.components)) {
        this._components.set(name, checker);
      }
    }

    // Internal state
    this._ready = false;
    this._alive = true;
  }

  /**
   * Gets the uptime in milliseconds.
   *
   * @returns {number} Uptime
   */
  get uptime() {
    return Date.now() - this._startTime;
  }

  /**
   * Sets the liveness state.
   *
   * @param {boolean} alive - Whether the service is alive
   */
  setAlive(alive) {
    this._alive = alive;
  }

  /**
   * Sets the readiness state.
   *
   * @param {boolean} ready - Whether the service is ready
   */
  setReady(ready) {
    this._ready = ready;
  }

  /**
   * Registers a component health checker.
   *
   * @param {string} name - Component name
   * @param {Function|ComponentChecker} checker - Health check function or ComponentChecker
   * @param {Object} [options] - Options for function-style checkers
   */
  registerComponent(name, checker, options = {}) {
    if (checker instanceof ComponentChecker) {
      this._components.set(name, checker);
    } else {
      this._components.set(
        name,
        new ComponentChecker({
          name,
          check: checker,
          ...options,
        })
      );
    }
  }

  /**
   * Unregisters a component health checker.
   *
   * @param {string} name - Component name
   * @returns {boolean} True if removed
   */
  unregisterComponent(name) {
    return this._components.delete(name);
  }

  /**
   * Checks liveness.
   * A service is alive if the process is running and not deadlocked.
   *
   * @returns {Promise<{status: string, timestamp: number}>} Liveness result
   */
  async isAlive() {
    // Async for API consistency with other health check methods
    return Promise.resolve({
      status: this._alive ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      timestamp: Date.now(),
    });
  }

  /**
   * Checks readiness.
   * A service is ready if it can accept requests.
   *
   * @returns {Promise<{status: string, timestamp: number}>} Readiness result
   */
  async isReady() {
    // If explicit readiness is set, use it
    if (!this._ready) {
      return {
        status: HealthStatus.UNHEALTHY,
        timestamp: Date.now(),
        message: 'Service not ready',
      };
    }

    // Check critical components
    for (const [name, checker] of this._components) {
      if (checker.critical) {
        const result = await checker.check();
        if (result.status === HealthStatus.UNHEALTHY) {
          return {
            status: HealthStatus.UNHEALTHY,
            timestamp: Date.now(),
            message: `Critical component ${name} is unhealthy`,
            component: name,
          };
        }
      }
    }

    return {
      status: HealthStatus.HEALTHY,
      timestamp: Date.now(),
    };
  }

  /**
   * Gets detailed health status for all components.
   *
   * @returns {Promise<HealthCheckResult>} Detailed health result
   */
  async getHealthDetails() {
    const components = {};
    let overallStatus = HealthStatus.HEALTHY;
    let hasDegraded = false;

    // Check all components in parallel
    const checks = await Promise.all(
      Array.from(this._components.entries()).map(async ([name, checker]) => {
        const result = await checker.check();
        return { name, result, critical: checker.critical };
      })
    );

    for (const { name, result, critical } of checks) {
      components[name] = result;

      if (result.status === HealthStatus.UNHEALTHY) {
        if (critical) {
          overallStatus = HealthStatus.UNHEALTHY;
        } else {
          hasDegraded = true;
        }
      } else if (result.status === HealthStatus.DEGRADED) {
        hasDegraded = true;
      }
    }

    // If not unhealthy but has degraded components, set to degraded
    if (overallStatus === HealthStatus.HEALTHY && hasDegraded) {
      overallStatus = HealthStatus.DEGRADED;
    }

    // Check basic liveness/readiness
    if (!this._alive) {
      overallStatus = HealthStatus.UNHEALTHY;
    } else if (!this._ready && overallStatus === HealthStatus.HEALTHY) {
      overallStatus = HealthStatus.DEGRADED;
    }

    return {
      status: overallStatus,
      timestamp: Date.now(),
      version: this._version,
      uptime: this.uptime,
      ready: this._ready,
      alive: this._alive,
      components,
    };
  }

  /**
   * Registers a queue backend health check.
   *
   * @param {string} name - Backend name
   * @param {Object} backend - Backend instance with isConnected() method
   * @param {Object} [options] - Check options
   */
  registerBackend(name, backend, options = {}) {
    this.registerComponent(
      name,
      () => {
        const isConnected =
          typeof backend.isConnected === 'function'
            ? backend.isConnected()
            : true;

        if (!isConnected) {
          return Promise.resolve({
            status: HealthStatus.UNHEALTHY,
            message: 'Backend disconnected',
          });
        }

        // Try to get stats if available
        if (typeof backend.getStats === 'function') {
          const stats = backend.getStats();
          return Promise.resolve({
            status: HealthStatus.HEALTHY,
            details: {
              connections: stats.connections ?? 1,
              operations: stats.operations ?? {},
            },
          });
        }

        return Promise.resolve({ status: HealthStatus.HEALTHY });
      },
      { critical: true, ...options }
    );
  }

  /**
   * Registers a cluster node health check.
   *
   * @param {string} name - Cluster name
   * @param {Object} cluster - Cluster coordinator instance
   * @param {Object} [options] - Check options
   */
  registerCluster(name, cluster, options = {}) {
    this.registerComponent(
      name,
      () => {
        if (typeof cluster.getStats === 'function') {
          const stats = cluster.getStats();
          const nodeCount = stats.nodeCount ?? 0;

          if (nodeCount === 0) {
            return Promise.resolve({
              status: HealthStatus.UNHEALTHY,
              message: 'No cluster nodes',
            });
          }

          return Promise.resolve({
            status: HealthStatus.HEALTHY,
            details: {
              nodes: nodeCount,
              leader: stats.leader ?? null,
            },
          });
        }

        return Promise.resolve({ status: HealthStatus.UNKNOWN });
      },
      { critical: false, ...options }
    );
  }

  /**
   * Registers a queue health check.
   *
   * @param {string} name - Queue name
   * @param {Object} queue - Queue instance
   * @param {Object} [options] - Check options
   */
  registerQueue(name, queue, options = {}) {
    this.registerComponent(
      name,
      () => {
        if (typeof queue.getStats === 'function') {
          const stats = queue.getStats();
          return Promise.resolve({
            status: HealthStatus.HEALTHY,
            details: {
              depth: stats.depth ?? 0,
              inFlight: stats.inFlight ?? 0,
            },
          });
        }

        return Promise.resolve({ status: HealthStatus.HEALTHY });
      },
      { critical: false, ...options }
    );
  }
}

/**
 * Express/Fastify compatible middleware for health endpoints.
 *
 * @param {Object} options - Middleware options
 * @param {HealthChecker} options.checker - Health checker instance
 * @param {string} [options.livePath='/health/live'] - Liveness endpoint path
 * @param {string} [options.readyPath='/health/ready'] - Readiness endpoint path
 * @param {string} [options.detailsPath='/health/details'] - Details endpoint path
 * @returns {Function} Middleware function
 */
export const healthMiddleware = (options) => {
  const { checker } = options;
  const livePath = options.livePath ?? '/health/live';
  const readyPath = options.readyPath ?? '/health/ready';
  const detailsPath = options.detailsPath ?? '/health/details';

  return async (req, res, next) => {
    // Support both Express-style (req.path) and raw HTTP (req.url)
    const requestPath =
      req.path ?? new URL(req.url, 'http://localhost').pathname;

    const setJsonResponse = (statusCode, body) => {
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (requestPath === livePath) {
      const result = await checker.isAlive();
      setJsonResponse(
        result.status === HealthStatus.HEALTHY ? 200 : 503,
        result
      );
      return;
    }

    if (requestPath === readyPath) {
      const result = await checker.isReady();
      setJsonResponse(
        result.status === HealthStatus.HEALTHY ? 200 : 503,
        result
      );
      return;
    }

    if (requestPath === detailsPath) {
      const result = await checker.getHealthDetails();
      let statusCode = 200;
      if (result.status === HealthStatus.UNHEALTHY) {
        statusCode = 503;
      } else if (result.status === HealthStatus.DEGRADED) {
        statusCode = 200; // Degraded is still operational
      }
      setJsonResponse(statusCode, result);
      return;
    }

    if (typeof next === 'function') {
      next();
    }
  };
};

/**
 * Creates a health checker pre-configured for a queue server.
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.version] - Application version
 * @param {Object} [options.backend] - Backend instance to monitor
 * @param {Object} [options.cluster] - Cluster coordinator to monitor
 * @param {Object<string, Object>} [options.queues] - Queues to monitor
 * @returns {HealthChecker} Configured health checker
 */
export const createServerHealthChecker = (options = {}) => {
  const checker = new HealthChecker({
    version: options.version,
  });

  // Register backend if provided
  if (options.backend) {
    checker.registerBackend('backend', options.backend);
  }

  // Register cluster if provided
  if (options.cluster) {
    checker.registerCluster('cluster', options.cluster);
  }

  // Register queues if provided
  if (options.queues) {
    for (const [name, queue] of Object.entries(options.queues)) {
      checker.registerQueue(`queue_${name}`, queue);
    }
  }

  return checker;
};
