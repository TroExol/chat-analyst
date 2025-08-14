import { Logger } from './Logger';
import type { EnvironmentConfigManager } from '../config/EnvironmentConfig';
import type { HealthCheckService, TComponentHealth } from './HealthCheckService';

/**
 * System metrics interface
 */
export interface TSystemMetrics {
  timestamp: Date;
  memory: {
    used: number;
    free: number;
    total: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    percentUsed: number;
  };
  cpu: {
    user: number;
    system: number;
    percentUsed?: number;
  };
  process: {
    pid: number;
    uptime: number;
    platform: string;
    nodeVersion: string;
    arch: string;
  };
  performance: {
    eventLoopLag?: number;
    gcCount?: number;
    gcDuration?: number;
  };
}

/**
 * Load metrics interface
 */
export interface TLoadMetrics {
  timestamp: Date;
  requests: {
    total: number;
    perSecond: number;
    errors: number;
    errorRate: number;
  };
  response: {
    averageTime: number;
    p95Time: number;
    p99Time: number;
  };
  connections: {
    active: number;
    waiting: number;
    total: number;
  };
}

/**
 * Configuration for system monitor
 */
export interface TSystemMonitorConfig {
  enabled: boolean;
  metricsCollectionInterval: number;
  memoryWarningThreshold: number; // percentage
  memoryErrorThreshold: number; // percentage
  enableGCOptimization: boolean;
  enableEventLoopMonitoring: boolean;
  maxMetricsHistory: number;
}

/**
 * Default system monitor configuration
 */
export const DEFAULT_SYSTEM_MONITOR_CONFIG: TSystemMonitorConfig = {
  enabled: true,
  metricsCollectionInterval: 60000, // 1 minute
  memoryWarningThreshold: 80,
  memoryErrorThreshold: 95,
  enableGCOptimization: false,
  enableEventLoopMonitoring: true,
  maxMetricsHistory: 100,
};

/**
 * SystemMonitor provides system-level monitoring and resource management
 * Requirements: 6.1, 6.4
 */
export class SystemMonitor {
  private logger: Logger;
  private envConfig: EnvironmentConfigManager;
  private healthCheckService?: HealthCheckService;
  private config: TSystemMonitorConfig;
  private metricsHistory: TSystemMetrics[] = [];
  private loadHistory: TLoadMetrics[] = [];
  private monitorTimer?: ReturnType<typeof setInterval>;
  private startTime = new Date();
  private isRunning = false;

  // Performance tracking
  private lastCpuUsage = process.cpuUsage();
  private requestCount = 0;
  private errorCount = 0;
  private responseTimes: number[] = [];
  private eventLoopLag?: number;
  private gcStats?: { count: number; duration: number };

  constructor(
    logger: Logger,
    envConfig: EnvironmentConfigManager,
    healthCheckService?: HealthCheckService,
    config: Partial<TSystemMonitorConfig> = {},
  ) {
    this.logger = logger;
    this.envConfig = envConfig;
    this.healthCheckService = healthCheckService;

    // Apply environment-specific configuration
    const perfConfig = this.envConfig.getPerformanceConfig();
    const monitoringConfig = this.envConfig.getMonitoringConfig();

    this.config = {
      ...DEFAULT_SYSTEM_MONITOR_CONFIG,
      ...config,
      enabled: this.envConfig.isFeatureEnabled('enablePerformanceMetrics'),
      metricsCollectionInterval: monitoringConfig.metricsCollectionInterval,
      enableGCOptimization: perfConfig.gcOptimization,
      memoryWarningThreshold: (perfConfig.maxMemoryUsageMB * 0.8) / 1024, // 80% of max
      memoryErrorThreshold: (perfConfig.maxMemoryUsageMB * 0.95) / 1024, // 95% of max
    };

    this.logger.info('SystemMonitor', 'Initialized', {
      enabled: this.config.enabled,
      metricsInterval: this.config.metricsCollectionInterval,
      memoryThresholds: {
        warning: this.config.memoryWarningThreshold,
        error: this.config.memoryErrorThreshold,
      },
    });
  }

  /**
   * Start system monitoring
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('SystemMonitor', 'System monitoring disabled');
      return;
    }

    try {
      this.isRunning = true;

      // Setup GC monitoring if enabled
      if (this.config.enableGCOptimization) {
        this.setupGCMonitoring();
      }

      // Setup event loop monitoring if enabled
      if (this.config.enableEventLoopMonitoring) {
        this.setupEventLoopMonitoring();
      }

      // Register health checks
      if (this.healthCheckService) {
        this.registerHealthChecks();
      }

      // Start periodic metrics collection
      this.startMetricsCollection();

      this.logger.info('SystemMonitor', 'Started system monitoring', {
        features: {
          gcOptimization: this.config.enableGCOptimization,
          eventLoopMonitoring: this.config.enableEventLoopMonitoring,
          healthChecks: !!this.healthCheckService,
        },
      });

    } catch (error) {
      this.logger.error('SystemMonitor', 'Failed to start monitoring', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop system monitoring
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }

    this.logger.info('SystemMonitor', 'Stopped system monitoring');
  }

  /**
   * Collect current system metrics
   */
  collectSystemMetrics(): TSystemMetrics {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    const uptime = process.uptime();

    // Calculate memory percentage
    const totalMemory = memoryUsage.heapTotal + memoryUsage.external;
    const usedMemory = memoryUsage.heapUsed + memoryUsage.external;
    const percentUsed = (usedMemory / totalMemory) * 100;

    const metrics: TSystemMetrics = {
      timestamp: new Date(),
      memory: {
        used: usedMemory,
        free: totalMemory - usedMemory,
        total: totalMemory,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        percentUsed,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
        percentUsed: this.calculateCpuPercent(cpuUsage, uptime),
      },
      process: {
        pid: process.pid,
        uptime,
        platform: process.platform,
        nodeVersion: process.version,
        arch: process.arch,
      },
      performance: {
        eventLoopLag: this.eventLoopLag,
        gcCount: this.gcStats?.count,
        gcDuration: this.gcStats?.duration,
      },
    };

    this.lastCpuUsage = process.cpuUsage();
    return metrics;
  }

  /**
   * Collect load metrics
   */
  collectLoadMetrics(): TLoadMetrics {
    const now = Date.now();
    const timeSinceStart = (now - this.startTime.getTime()) / 1000;

    // Calculate request rate
    const requestsPerSecond = timeSinceStart > 0 ? this.requestCount / timeSinceStart : 0;
    const errorRate = this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0;

    // Calculate response time percentiles
    const sortedTimes = this.responseTimes.slice().sort((a, b) => a - b);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p99Index = Math.floor(sortedTimes.length * 0.99);

    return {
      timestamp: new Date(),
      requests: {
        total: this.requestCount,
        perSecond: requestsPerSecond,
        errors: this.errorCount,
        errorRate,
      },
      response: {
        averageTime: this.responseTimes.length > 0
          ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
          : 0,
        p95Time: sortedTimes[p95Index] || 0,
        p99Time: sortedTimes[p99Index] || 0,
      },
      connections: {
        active: 0, // Would need to be updated by connection managers
        waiting: 0,
        total: 0,
      },
    };
  }

  /**
   * Track request performance
   */
  trackRequest(responseTime: number, isError = false): void {
    this.requestCount++;
    if (isError) {
      this.errorCount++;
    }

    this.responseTimes.push(responseTime);

    // Keep only recent response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-500);
    }
  }

  /**
   * Get current system status summary
   */
  getSystemStatus(): {
    status: 'healthy' | 'degraded' | 'critical';
    metrics: TSystemMetrics;
    load: TLoadMetrics;
    alerts: string[];
    } {
    const metrics = this.collectSystemMetrics();
    const load = this.collectLoadMetrics();
    const alerts: string[] = [];
    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';

    // Memory checks
    if (metrics.memory.percentUsed > this.config.memoryErrorThreshold) {
      status = 'critical';
      alerts.push(`Critical memory usage: ${metrics.memory.percentUsed.toFixed(1)}%`);
    } else if (metrics.memory.percentUsed > this.config.memoryWarningThreshold) {
      if (status === 'healthy') status = 'degraded';
      alerts.push(`High memory usage: ${metrics.memory.percentUsed.toFixed(1)}%`);
    }

    // CPU checks
    if (metrics.cpu.percentUsed && metrics.cpu.percentUsed > 90) {
      status = 'critical';
      alerts.push(`Critical CPU usage: ${metrics.cpu.percentUsed.toFixed(1)}%`);
    } else if (metrics.cpu.percentUsed && metrics.cpu.percentUsed > 70) {
      if (status === 'healthy') status = 'degraded';
      alerts.push(`High CPU usage: ${metrics.cpu.percentUsed.toFixed(1)}%`);
    }

    // Event loop lag checks
    if (metrics.performance.eventLoopLag && metrics.performance.eventLoopLag > 100) {
      status = 'critical';
      alerts.push(`Critical event loop lag: ${metrics.performance.eventLoopLag.toFixed(1)}ms`);
    } else if (metrics.performance.eventLoopLag && metrics.performance.eventLoopLag > 50) {
      if (status === 'healthy') status = 'degraded';
      alerts.push(`High event loop lag: ${metrics.performance.eventLoopLag.toFixed(1)}ms`);
    }

    // Error rate checks
    if (load.requests.errorRate > 10) {
      status = 'critical';
      alerts.push(`Critical error rate: ${load.requests.errorRate.toFixed(1)}%`);
    } else if (load.requests.errorRate > 5) {
      if (status === 'healthy') status = 'degraded';
      alerts.push(`High error rate: ${load.requests.errorRate.toFixed(1)}%`);
    }

    return { status, metrics, load, alerts };
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): { system: TSystemMetrics[]; load: TLoadMetrics[] } {
    return {
      system: this.metricsHistory.slice(),
      load: this.loadHistory.slice(),
    };
  }

  /**
   * Start periodic metrics collection
   */
  private startMetricsCollection(): void {
    this.monitorTimer = setInterval(() => {
      try {
        const systemMetrics = this.collectSystemMetrics();
        const loadMetrics = this.collectLoadMetrics();

        // Add to history
        this.metricsHistory.push(systemMetrics);
        this.loadHistory.push(loadMetrics);

        // Trim history
        if (this.metricsHistory.length > this.config.maxMetricsHistory) {
          this.metricsHistory = this.metricsHistory.slice(-this.config.maxMetricsHistory);
        }
        if (this.loadHistory.length > this.config.maxMetricsHistory) {
          this.loadHistory = this.loadHistory.slice(-this.config.maxMetricsHistory);
        }

        // Check for alerts
        const status = this.getSystemStatus();
        if (status.alerts.length > 0) {
          this.logger.warn('SystemMonitor', 'System alerts detected', {
            status: status.status,
            alerts: status.alerts,
          });
        }

        // Log periodic status in development
        if (this.envConfig.isDevelopment()) {
          this.logger.debug('SystemMonitor', 'System metrics collected', {
            memory: `${systemMetrics.memory.percentUsed.toFixed(1)}%`,
            cpu: `${systemMetrics.cpu.percentUsed?.toFixed(1) || 'N/A'}%`,
            requests: loadMetrics.requests.perSecond.toFixed(1),
            errorRate: `${loadMetrics.requests.errorRate.toFixed(1)}%`,
          });
        }

      } catch (error) {
        this.logger.error('SystemMonitor', 'Error collecting metrics', {
          error: (error as Error).message,
        });
      }
    }, this.config.metricsCollectionInterval);
  }

  /**
   * Setup garbage collection monitoring
   */
  private setupGCMonitoring(): void {
    if (process.env.NODE_ENV === 'production') {
      // Enable GC optimization flags
      this.logger.info('SystemMonitor', 'GC optimization enabled for production');
    }

    // Track GC stats if available (would need gc-stats package in real implementation)
    this.gcStats = { count: 0, duration: 0 };
  }

  /**
   * Setup event loop lag monitoring
   */
  private setupEventLoopMonitoring(): void {
    const measureEventLoopLag = () => {
      const start = process.hrtime.bigint();

      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
        this.eventLoopLag = lag;
      });
    };

    // Measure every 5 seconds
    setInterval(measureEventLoopLag, 5000);
  }

  /**
   * Register health checks with health check service
   */
  private registerHealthChecks(): void {
    if (!this.healthCheckService) return;

    // System health check
    this.healthCheckService.registerHealthCheck('system', async (): Promise<TComponentHealth> => {
      const status = this.getSystemStatus();

      let healthStatus: 'healthy' | 'degraded' | 'unhealthy';
      switch (status.status) {
      case 'critical':
        healthStatus = 'unhealthy';
        break;
      case 'degraded':
        healthStatus = 'degraded';
        break;
      default:
        healthStatus = 'healthy';
      }

      return {
        name: 'system',
        status: healthStatus,
        message: status.alerts.length > 0 ? status.alerts.join('; ') : 'System resources healthy',
        lastCheck: new Date(),
        metadata: {
          memoryUsage: `${status.metrics.memory.percentUsed.toFixed(1)}%`,
          cpuUsage: `${status.metrics.cpu.percentUsed?.toFixed(1) || 'N/A'}%`,
          uptime: status.metrics.process.uptime,
          requestRate: status.load.requests.perSecond.toFixed(1),
          errorRate: `${status.load.requests.errorRate.toFixed(1)}%`,
        },
      };
    });

    // Memory health check
    this.healthCheckService.registerHealthCheck('memory', async (): Promise<TComponentHealth> => {
      const metrics = this.collectSystemMetrics();
      const percentUsed = metrics.memory.percentUsed;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let message = `Memory usage: ${percentUsed.toFixed(1)}%`;

      if (percentUsed > this.config.memoryErrorThreshold) {
        status = 'unhealthy';
        message = `Critical memory usage: ${percentUsed.toFixed(1)}%`;
      } else if (percentUsed > this.config.memoryWarningThreshold) {
        status = 'degraded';
        message = `High memory usage: ${percentUsed.toFixed(1)}%`;
      }

      return {
        name: 'memory',
        status,
        message,
        lastCheck: new Date(),
        metadata: {
          heapUsed: `${(metrics.memory.heapUsed / 1024 / 1024).toFixed(1)} MB`,
          heapTotal: `${(metrics.memory.heapTotal / 1024 / 1024).toFixed(1)} MB`,
          external: `${(metrics.memory.external / 1024 / 1024).toFixed(1)} MB`,
          percentUsed: `${percentUsed.toFixed(1)}%`,
        },
      };
    });
  }

  /**
   * Calculate CPU percentage usage
   */
  private calculateCpuPercent(cpuUsage: ReturnType<typeof process.cpuUsage>, uptime: number): number {
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    const totalTime = uptime * 1000000; // Convert to microseconds
    return (totalCpuTime / totalTime) * 100;
  }
}
