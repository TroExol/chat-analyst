import { Logger } from '../services/Logger';

/**
 * Environment types for different deployment scenarios
 */
export type TEnvironment = 'development' | 'staging' | 'production' | 'testing';

/**
 * Operational modes for different feature sets
 */
export type TOperationalMode = 'collect-only' | 'monitor' | 'full-features' | 'maintenance';

/**
 * Feature flags for conditional functionality
 */
export interface TFeatureFlags {
  enableAdvancedLogging: boolean;
  enablePerformanceMetrics: boolean;
  enableDataValidation: boolean;
  enableFileIntegrityChecks: boolean;
  enableAutoRecovery: boolean;
  enableBackupCreation: boolean;
  enableStatisticsReporting: boolean;
  enableHealthChecks: boolean;
  enableGracefulShutdown: boolean;
  enableMemoryOptimization: boolean;
}

/**
 * Environment-specific configuration
 */
export interface TEnvironmentConfig {
  environment: TEnvironment;
  operationalMode: TOperationalMode;
  featureFlags: TFeatureFlags;

  // Performance settings
  performance: {
    maxMemoryUsageMB: number;
    gcOptimization: boolean;
    connectionPoolSize: number;
    requestTimeoutMs: number;
  };

  // Security settings
  security: {
    enableSecureMode: boolean;
    maxLoginAttempts: number;
    sessionTimeoutMs: number;
    enableRateLimiting: boolean;
  };

  // Monitoring settings
  monitoring: {
    enableHealthChecks: boolean;
    healthCheckPort: number;
    metricsCollectionInterval: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * Default configurations for different environments
 */
const DEVELOPMENT_CONFIG: TEnvironmentConfig = {
  environment: 'development',
  operationalMode: 'full-features',
  featureFlags: {
    enableAdvancedLogging: true,
    enablePerformanceMetrics: true,
    enableDataValidation: true,
    enableFileIntegrityChecks: true,
    enableAutoRecovery: true,
    enableBackupCreation: true,
    enableStatisticsReporting: true,
    enableHealthChecks: true,
    enableGracefulShutdown: true,
    enableMemoryOptimization: false,
  },
  performance: {
    maxMemoryUsageMB: 512,
    gcOptimization: false,
    connectionPoolSize: 5,
    requestTimeoutMs: 30000,
  },
  security: {
    enableSecureMode: false,
    maxLoginAttempts: 10,
    sessionTimeoutMs: 3600000, // 1 hour
    enableRateLimiting: false,
  },
  monitoring: {
    enableHealthChecks: true,
    healthCheckPort: 8080,
    metricsCollectionInterval: 60000, // 1 minute
    logLevel: 'debug',
  },
};

const PRODUCTION_CONFIG: TEnvironmentConfig = {
  environment: 'production',
  operationalMode: 'collect-only',
  featureFlags: {
    enableAdvancedLogging: false,
    enablePerformanceMetrics: false,
    enableDataValidation: true,
    enableFileIntegrityChecks: true,
    enableAutoRecovery: true,
    enableBackupCreation: true,
    enableStatisticsReporting: true,
    enableHealthChecks: true,
    enableGracefulShutdown: true,
    enableMemoryOptimization: true,
  },
  performance: {
    maxMemoryUsageMB: 1024,
    gcOptimization: true,
    connectionPoolSize: 10,
    requestTimeoutMs: 15000,
  },
  security: {
    enableSecureMode: true,
    maxLoginAttempts: 3,
    sessionTimeoutMs: 1800000, // 30 minutes
    enableRateLimiting: true,
  },
  monitoring: {
    enableHealthChecks: false,
    healthCheckPort: 8080,
    metricsCollectionInterval: 300000, // 5 minutes
    logLevel: 'info',
  },
};

const STAGING_CONFIG: TEnvironmentConfig = {
  ...PRODUCTION_CONFIG,
  environment: 'staging',
  operationalMode: 'monitor',
  featureFlags: {
    ...PRODUCTION_CONFIG.featureFlags,
    enableAdvancedLogging: true,
  },
  monitoring: {
    ...PRODUCTION_CONFIG.monitoring,
    logLevel: 'debug',
    metricsCollectionInterval: 120000, // 2 minutes
  },
};

const TESTING_CONFIG: TEnvironmentConfig = {
  environment: 'testing',
  operationalMode: 'full-features',
  featureFlags: {
    enableAdvancedLogging: true,
    enablePerformanceMetrics: false,
    enableDataValidation: true,
    enableFileIntegrityChecks: false,
    enableAutoRecovery: false,
    enableBackupCreation: false,
    enableStatisticsReporting: false,
    enableHealthChecks: false,
    enableGracefulShutdown: true,
    enableMemoryOptimization: false,
  },
  performance: {
    maxMemoryUsageMB: 256,
    gcOptimization: false,
    connectionPoolSize: 2,
    requestTimeoutMs: 5000,
  },
  security: {
    enableSecureMode: false,
    maxLoginAttempts: 100,
    sessionTimeoutMs: 7200000, // 2 hours
    enableRateLimiting: false,
  },
  monitoring: {
    enableHealthChecks: false,
    healthCheckPort: 8081,
    metricsCollectionInterval: 10000, // 10 seconds
    logLevel: 'debug',
  },
};

/**
 * Configuration validation rules
 */
interface TValidationRule {
  field: string;
  // eslint-disable-next-line no-unused-vars
  validator: (value: any) => boolean;
  message: string;
}

const VALIDATION_RULES: TValidationRule[] = [
  {
    field: 'performance.maxMemoryUsageMB',
    validator: (value: number) => value > 0 && value <= 8192,
    message: 'Memory usage must be between 1MB and 8GB',
  },
  {
    field: 'performance.connectionPoolSize',
    validator: (value: number) => value > 0 && value <= 50,
    message: 'Connection pool size must be between 1 and 50',
  },
  {
    field: 'performance.requestTimeoutMs',
    validator: (value: number) => value >= 1000 && value <= 300000,
    message: 'Request timeout must be between 1 second and 5 minutes',
  },
  {
    field: 'security.maxLoginAttempts',
    validator: (value: number) => value > 0 && value <= 100,
    message: 'Max login attempts must be between 1 and 100',
  },
  {
    field: 'monitoring.healthCheckPort',
    validator: (value: number) => value >= 1024 && value <= 65535,
    message: 'Health check port must be between 1024 and 65535',
  },
  {
    field: 'monitoring.metricsCollectionInterval',
    validator: (value: number) => value >= 10000 && value <= 3600000,
    message: 'Metrics collection interval must be between 10 seconds and 1 hour',
  },
];

/**
 * Environment Configuration Manager
 * Handles environment-specific settings and feature flags
 */
export class EnvironmentConfigManager {
  private config: TEnvironmentConfig;
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
    this.config = this.loadEnvironmentConfig();
  }

  /**
   * Load configuration based on NODE_ENV
   */
  private loadEnvironmentConfig(): TEnvironmentConfig {
    const env = (process.env.NODE_ENV as TEnvironment) || 'development';
    const operationalMode = (process.env.OPERATIONAL_MODE as TOperationalMode) || undefined;

    let baseConfig: TEnvironmentConfig;

    switch (env) {
    case 'production':
      baseConfig = { ...PRODUCTION_CONFIG };
      break;
    case 'staging':
      baseConfig = { ...STAGING_CONFIG };
      break;
    case 'testing':
      baseConfig = { ...TESTING_CONFIG };
      break;
    default:
      baseConfig = { ...DEVELOPMENT_CONFIG };
    }

    // Override operational mode if specified
    if (operationalMode) {
      baseConfig.operationalMode = operationalMode;
      this.applyOperationalModeDefaults(baseConfig, operationalMode);
    }

    // Apply environment variable overrides
    this.applyEnvironmentOverrides(baseConfig);

    return baseConfig;
  }

  /**
   * Apply operational mode specific defaults
   */
  private applyOperationalModeDefaults(config: TEnvironmentConfig, mode: TOperationalMode): void {
    switch (mode) {
    case 'collect-only':
      config.featureFlags.enableAdvancedLogging = false;
      config.featureFlags.enablePerformanceMetrics = false;
      config.featureFlags.enableHealthChecks = false;
      break;
    case 'monitor':
      config.featureFlags.enableDataValidation = false;
      config.featureFlags.enableFileIntegrityChecks = false;
      config.featureFlags.enableBackupCreation = false;
      break;
    case 'maintenance':
      config.featureFlags.enableAdvancedLogging = true;
      config.featureFlags.enablePerformanceMetrics = true;
      config.featureFlags.enableDataValidation = false;
      config.featureFlags.enableAutoRecovery = false;
      break;
    }
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(config: TEnvironmentConfig): void {
    // Feature flags overrides
    if (process.env.ENABLE_ADVANCED_LOGGING !== undefined) {
      config.featureFlags.enableAdvancedLogging = process.env.ENABLE_ADVANCED_LOGGING === 'true';
    }
    if (process.env.ENABLE_PERFORMANCE_METRICS !== undefined) {
      config.featureFlags.enablePerformanceMetrics = process.env.ENABLE_PERFORMANCE_METRICS === 'true';
    }
    if (process.env.ENABLE_DATA_VALIDATION !== undefined) {
      config.featureFlags.enableDataValidation = process.env.ENABLE_DATA_VALIDATION === 'true';
    }
    if (process.env.ENABLE_FILE_INTEGRITY_CHECKS !== undefined) {
      config.featureFlags.enableFileIntegrityChecks = process.env.ENABLE_FILE_INTEGRITY_CHECKS === 'true';
    }
    if (process.env.ENABLE_AUTO_RECOVERY !== undefined) {
      config.featureFlags.enableAutoRecovery = process.env.ENABLE_AUTO_RECOVERY === 'true';
    }
    if (process.env.ENABLE_BACKUP_CREATION !== undefined) {
      config.featureFlags.enableBackupCreation = process.env.ENABLE_BACKUP_CREATION === 'true';
    }
    if (process.env.ENABLE_STATISTICS_REPORTING !== undefined) {
      config.featureFlags.enableStatisticsReporting = process.env.ENABLE_STATISTICS_REPORTING === 'true';
    }
    if (process.env.ENABLE_HEALTH_CHECKS !== undefined) {
      config.featureFlags.enableHealthChecks = process.env.ENABLE_HEALTH_CHECKS === 'true';
    }

    // Performance overrides
    if (process.env.MAX_MEMORY_USAGE_MB) {
      config.performance.maxMemoryUsageMB = parseInt(process.env.MAX_MEMORY_USAGE_MB, 10);
    }
    if (process.env.CONNECTION_POOL_SIZE) {
      config.performance.connectionPoolSize = parseInt(process.env.CONNECTION_POOL_SIZE, 10);
    }
    if (process.env.REQUEST_TIMEOUT_MS) {
      config.performance.requestTimeoutMs = parseInt(process.env.REQUEST_TIMEOUT_MS, 10);
    }

    // Monitoring overrides
    if (process.env.HEALTH_CHECK_PORT) {
      config.monitoring.healthCheckPort = parseInt(process.env.HEALTH_CHECK_PORT, 10);
    }
    if (process.env.METRICS_COLLECTION_INTERVAL) {
      config.monitoring.metricsCollectionInterval = parseInt(process.env.METRICS_COLLECTION_INTERVAL, 10);
    }
    if (process.env.LOG_LEVEL) {
      config.monitoring.logLevel = process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
    }
  }

  /**
   * Validate configuration on startup
   */
  validateConfiguration(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      for (const rule of VALIDATION_RULES) {
        const value = this.getNestedValue(this.config, rule.field);

        if (value === undefined) {
          errors.push(`Missing required field: ${rule.field}`);
          continue;
        }

        if (!rule.validator(value)) {
          errors.push(`Invalid ${rule.field}: ${rule.message}`);
        }
      }

      // Additional custom validations
      if (this.config.featureFlags.enableHealthChecks && this.config.monitoring.healthCheckPort <= 0) {
        errors.push('Health checks enabled but invalid port specified');
      }

      if (this.config.operationalMode === 'maintenance' && this.config.featureFlags.enableAutoRecovery) {
        errors.push('Auto recovery should be disabled in maintenance mode');
      }

    } catch (error) {
      errors.push(`Configuration validation error: ${(error as Error).message}`);
    }

    const isValid = errors.length === 0;

    if (this.logger) {
      if (isValid) {
        this.logger.info('EnvironmentConfig', 'Configuration validation passed', {
          environment: this.config.environment,
          operationalMode: this.config.operationalMode,
        });
      } else {
        this.logger.error('EnvironmentConfig', 'Configuration validation failed', { errors });
      }
    }

    return { isValid, errors };
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current && current[key], obj);
  }

  /**
   * Get current configuration
   */
  getConfig(): TEnvironmentConfig {
    return { ...this.config };
  }

  /**
   * Check if a feature flag is enabled
   */
  isFeatureEnabled(feature: keyof TFeatureFlags): boolean {
    return this.config.featureFlags[feature];
  }

  /**
   * Get current environment
   */
  getEnvironment(): TEnvironment {
    return this.config.environment;
  }

  /**
   * Get operational mode
   */
  getOperationalMode(): TOperationalMode {
    return this.config.operationalMode;
  }

  /**
   * Check if running in production
   */
  isProduction(): boolean {
    return this.config.environment === 'production';
  }

  /**
   * Check if running in development
   */
  isDevelopment(): boolean {
    return this.config.environment === 'development';
  }

  /**
   * Get performance settings
   */
  getPerformanceConfig() {
    return { ...this.config.performance };
  }

  /**
   * Get monitoring settings
   */
  getMonitoringConfig() {
    return { ...this.config.monitoring };
  }

  /**
   * Get security settings
   */
  getSecurityConfig() {
    return { ...this.config.security };
  }

  /**
   * Print current configuration (safe for logging)
   */
  getConfigSummary(): Record<string, any> {
    return {
      environment: this.config.environment,
      operationalMode: this.config.operationalMode,
      featuresEnabled: Object.entries(this.config.featureFlags)
        .filter(([, enabled]) => enabled)
        .map(([feature]) => feature),
      performance: {
        maxMemoryMB: this.config.performance.maxMemoryUsageMB,
        connectionPool: this.config.performance.connectionPoolSize,
        timeoutMs: this.config.performance.requestTimeoutMs,
      },
      monitoring: {
        logLevel: this.config.monitoring.logLevel,
        healthChecks: this.config.featureFlags.enableHealthChecks,
        metricsInterval: this.config.monitoring.metricsCollectionInterval,
      },
    };
  }
}
