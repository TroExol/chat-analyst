import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { Logger } from './Logger';
import type { EnvironmentConfigManager } from '../config/EnvironmentConfig';

/**
 * Health check status levels
 */
export type THealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'maintenance';

/**
 * Individual component health check result
 */
export interface TComponentHealth {
  name: string;
  status: THealthStatus;
  message?: string;
  lastCheck: Date;
  responseTime?: number;
  metadata?: Record<string, any>;
}

/**
 * Overall system health check result
 */
export interface TSystemHealth {
  status: THealthStatus;
  timestamp: Date;
  uptime: number;
  version: string;
  environment: string;
  components: TComponentHealth[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    total: number;
  };
}

/**
 * Health check function type
 */
export type THealthCheckFunction = () => Promise<TComponentHealth>;

/**
 * Configuration for health check service
 */
export interface THealthCheckConfig {
  enabled: boolean;
  port: number;
  endpoint: string;
  checkInterval: number;
  timeout: number;
  gracePeriod: number; // Grace period before marking as unhealthy
}

/**
 * Default health check configuration
 */
export const DEFAULT_HEALTH_CHECK_CONFIG: THealthCheckConfig = {
  enabled: true,
  port: 8080,
  endpoint: '/health',
  checkInterval: 30000, // 30 seconds
  timeout: 5000, // 5 seconds
  gracePeriod: 60000, // 1 minute
};

/**
 * HealthCheckService provides HTTP endpoints for system monitoring
 * Requirements: 6.1, 6.4
 */
export class HealthCheckService {
  private logger: Logger;
  private envConfig: EnvironmentConfigManager;
  private config: THealthCheckConfig;
  private server?: Server;
  private healthChecks = new Map<string, THealthCheckFunction>();
  private lastResults = new Map<string, TComponentHealth>();
  private checkTimer?: ReturnType<typeof setInterval>;
  private startTime = new Date();
  private isShuttingDown = false;

  constructor(
    logger: Logger,
    envConfig: EnvironmentConfigManager,
    config: Partial<THealthCheckConfig> = {},
  ) {
    this.logger = logger;
    this.envConfig = envConfig;
    this.config = { ...DEFAULT_HEALTH_CHECK_CONFIG, ...config };

    // Override with environment config
    const monitoringConfig = this.envConfig.getMonitoringConfig();
    this.config.enabled = this.envConfig.isFeatureEnabled('enableHealthChecks');
    this.config.port = monitoringConfig.healthCheckPort;

    this.logger.info('HealthCheckService', 'Initialized', {
      enabled: this.config.enabled,
      port: this.config.port,
      endpoint: this.config.endpoint,
    });
  }

  /**
   * Start health check service
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('HealthCheckService', 'Health checks disabled, skipping start');
      return;
    }

    try {
      // Create HTTP server
      this.server = createServer((req, res) => this.handleRequest(req, res));

      // Start server
      await new Promise<void>((resolve, reject) => {
        this.server!.listen(this.config.port, (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Start periodic health checks
      this.startPeriodicChecks();

      this.logger.info('HealthCheckService', 'Started successfully', {
        port: this.config.port,
        endpoint: this.config.endpoint,
      });

    } catch (error) {
      this.logger.error('HealthCheckService', 'Failed to start', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop health check service
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;

    try {
      // Stop periodic checks
      if (this.checkTimer) {
        clearInterval(this.checkTimer);
        this.checkTimer = undefined;
      }

      // Close HTTP server
      if (this.server) {
        await new Promise<void>((resolve) => {
          this.server!.close(() => resolve());
        });
        this.server = undefined;
      }

      this.logger.info('HealthCheckService', 'Stopped successfully');

    } catch (error) {
      this.logger.error('HealthCheckService', 'Error during shutdown', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Register a health check for a component
   */
  registerHealthCheck(name: string, checkFunction: THealthCheckFunction): void {
    this.healthChecks.set(name, checkFunction);

    this.logger.debug('HealthCheckService', `Registered health check: ${name}`, {
      totalChecks: this.healthChecks.size,
    });
  }

  /**
   * Unregister a health check
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
    this.lastResults.delete(name);

    this.logger.debug('HealthCheckService', `Unregistered health check: ${name}`);
  }

  /**
   * Perform all health checks and return system status
   */
  async performHealthCheck(): Promise<TSystemHealth> {
    const startTime = Date.now();
    const components: TComponentHealth[] = [];

    // Run all registered health checks
    for (const [name, checkFunction] of this.healthChecks) {
      try {
        const componentStart = Date.now();

        // Run check with timeout
        const result = await Promise.race([
          checkFunction(),
          this.createTimeoutPromise(name),
        ]);

        result.responseTime = Date.now() - componentStart;
        result.lastCheck = new Date();

        components.push(result);
        this.lastResults.set(name, result);

      } catch (error) {
        const failedResult: TComponentHealth = {
          name,
          status: 'unhealthy',
          message: `Health check failed: ${(error as Error).message}`,
          lastCheck: new Date(),
          responseTime: Date.now() - startTime,
        };

        components.push(failedResult);
        this.lastResults.set(name, failedResult);

        this.logger.warn('HealthCheckService', `Health check failed for ${name}`, {
          error: (error as Error).message,
        });
      }
    }

    // Calculate overall status
    const summary = {
      healthy: components.filter(c => c.status === 'healthy').length,
      degraded: components.filter(c => c.status === 'degraded').length,
      unhealthy: components.filter(c => c.status === 'unhealthy').length,
      total: components.length,
    };

    let overallStatus: THealthStatus = 'healthy';
    if (this.isShuttingDown) {
      overallStatus = 'maintenance';
    } else if (summary.unhealthy > 0) {
      overallStatus = 'unhealthy';
    } else if (summary.degraded > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: this.envConfig.getEnvironment(),
      components,
      summary,
    };
  }

  /**
   * Handle HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';

    try {
      // Handle health check endpoint
      if (url === this.config.endpoint && method === 'GET') {
        await this.handleHealthCheckRequest(res);
        return;
      }

      // Handle readiness check
      if (url === '/ready' && method === 'GET') {
        await this.handleReadinessCheck(res);
        return;
      }

      // Handle liveness check
      if (url === '/live' && method === 'GET') {
        await this.handleLivenessCheck(res);
        return;
      }

      // Handle metrics endpoint
      if (url === '/metrics' && method === 'GET') {
        await this.handleMetricsRequest(res);
        return;
      }

      // 404 for unknown endpoints
      this.sendResponse(res, 404, { error: 'Not Found' });

    } catch (error) {
      this.logger.error('HealthCheckService', 'Request handling error', {
        url,
        method,
        error: (error as Error).message,
      });

      this.sendResponse(res, 500, { error: 'Internal Server Error' });
    }
  }

  /**
   * Handle health check request
   */
  private async handleHealthCheckRequest(res: ServerResponse): Promise<void> {
    const health = await this.performHealthCheck();
    const statusCode = this.getStatusCode(health.status);

    this.sendResponse(res, statusCode, health);
  }

  /**
   * Handle readiness check (are we ready to serve requests?)
   */
  private async handleReadinessCheck(res: ServerResponse): Promise<void> {
    if (this.isShuttingDown) {
      this.sendResponse(res, 503, {
        status: 'not ready',
        reason: 'shutting down',
        timestamp: new Date(),
      });
      return;
    }

    const health = await this.performHealthCheck();
    const isReady = health.status === 'healthy' || health.status === 'degraded';
    const statusCode = isReady ? 200 : 503;

    this.sendResponse(res, statusCode, {
      status: isReady ? 'ready' : 'not ready',
      timestamp: new Date(),
      components: health.components.length,
      healthy: health.summary.healthy,
    });
  }

  /**
   * Handle liveness check (are we still alive?)
   */
  private async handleLivenessCheck(res: ServerResponse): Promise<void> {
    // Simple liveness check - if we can respond, we're alive
    this.sendResponse(res, 200, {
      status: 'alive',
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
    });
  }

  /**
   * Handle metrics request
   */
  private async handleMetricsRequest(res: ServerResponse): Promise<void> {
    const health = await this.performHealthCheck();

    // Convert to Prometheus-like metrics format
    const metrics = this.convertToMetrics(health);

    res.setHeader('Content-Type', 'text/plain');
    this.sendResponse(res, 200, metrics, false);
  }

  /**
   * Convert health data to metrics format
   */
  private convertToMetrics(health: TSystemHealth): string {
    const lines: string[] = [];

    // System metrics
    lines.push('# HELP system_health_status Overall system health status (0=unhealthy, 1=degraded, 2=healthy)');
    lines.push('# TYPE system_health_status gauge');
    lines.push(`system_health_status ${this.healthStatusToNumber(health.status)}`);

    lines.push('# HELP system_uptime_seconds System uptime in seconds');
    lines.push('# TYPE system_uptime_seconds counter');
    lines.push(`system_uptime_seconds ${Math.floor(health.uptime / 1000)}`);

    // Component metrics
    lines.push('# HELP component_health_status Health status of individual components');
    lines.push('# TYPE component_health_status gauge');

    for (const component of health.components) {
      const status = this.healthStatusToNumber(component.status);
      lines.push(`component_health_status{component="${component.name}"} ${status}`);

      if (component.responseTime) {
        lines.push(`component_response_time_ms{component="${component.name}"} ${component.responseTime}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Convert health status to number for metrics
   */
  private healthStatusToNumber(status: THealthStatus): number {
    switch (status) {
    case 'healthy': return 2;
    case 'degraded': return 1;
    case 'unhealthy': return 0;
    case 'maintenance': return -1;
    default: return 0;
    }
  }

  /**
   * Start periodic health checks
   */
  private startPeriodicChecks(): void {
    this.checkTimer = setInterval(async () => {
      try {
        const health = await this.performHealthCheck();

        if (health.status === 'unhealthy') {
          this.logger.warn('HealthCheckService', 'System health degraded', {
            unhealthyComponents: health.components
              .filter(c => c.status === 'unhealthy')
              .map(c => ({ name: c.name, message: c.message })),
          });
        }

      } catch (error) {
        this.logger.error('HealthCheckService', 'Periodic health check failed', {
          error: (error as Error).message,
        });
      }
    }, this.config.checkInterval);
  }

  /**
   * Create timeout promise for health checks
   */
  private createTimeoutPromise(componentName: string): Promise<TComponentHealth> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timeout for ${componentName}`));
      }, this.config.timeout);
    });
  }

  /**
   * Get HTTP status code for health status
   */
  private getStatusCode(status: THealthStatus): number {
    switch (status) {
    case 'healthy': return 200;
    case 'degraded': return 200;
    case 'unhealthy': return 503;
    case 'maintenance': return 503;
    default: return 500;
    }
  }

  /**
   * Send HTTP response
   */
  private sendResponse(res: ServerResponse, statusCode: number, data: any, json = true): void {
    res.statusCode = statusCode;

    if (json) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data, null, 2));
    } else {
      res.end(data);
    }
  }

  /**
   * Get current health status
   */
  getLastHealthCheck(): TSystemHealth | null {
    if (this.lastResults.size === 0) {
      return null;
    }

    const components = Array.from(this.lastResults.values());
    const summary = {
      healthy: components.filter(c => c.status === 'healthy').length,
      degraded: components.filter(c => c.status === 'degraded').length,
      unhealthy: components.filter(c => c.status === 'unhealthy').length,
      total: components.length,
    };

    let status: THealthStatus = 'healthy';
    if (this.isShuttingDown) {
      status = 'maintenance';
    } else if (summary.unhealthy > 0) {
      status = 'unhealthy';
    } else if (summary.degraded > 0) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: this.envConfig.getEnvironment(),
      components,
      summary,
    };
  }
}
