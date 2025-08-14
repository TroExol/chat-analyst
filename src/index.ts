import { config } from 'dotenv';
// Load environment variables
config();

import { ConfigManager, type TAppConfig, EnvironmentConfigManager } from './config';
import { VKApi } from './services/VKApi';
import { Logger } from './services/Logger';
import { ErrorHandler } from './services/ErrorHandler';
import { EventProcessor } from './services/EventProcessor';
import { LongPollCollector } from './services/LongPollCollector';
import { MessageParser } from './services/MessageParser';
import { UserManager } from './services/UserManager';
import { DataValidator } from './services/DataValidator';
import { FileIntegrityChecker } from './services/FileIntegrityChecker';
import { HealthCheckService } from './services/HealthCheckService';
import { SystemMonitor } from './services/SystemMonitor';
import { FileStorage } from './storage/FileStorage';
import { ChatFileManager } from './storage/ChatFileManager';
import { UserCacheManager } from './storage/UserCacheManager';

/**
 * Main application class integrating all VK Message Collector components
 * Requirements: 1.1, 1.2, 6.4
 */
class ChatAnalyzer {
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  private config: TAppConfig;
  private envConfig: EnvironmentConfigManager = new EnvironmentConfigManager();

  // Core services
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private vkApi!: VKApi;

  // Storage components
  private fileStorage!: FileStorage;
  private userCacheManager!: UserCacheManager;
  private chatFileManager!: ChatFileManager;

  // Processing components
  private messageParser!: MessageParser;
  private userManager!: UserManager;
  private eventProcessor!: EventProcessor;
  private longPollCollector!: LongPollCollector;

  // Data validation and integrity
  private dataValidator!: DataValidator;
  private fileIntegrityChecker!: FileIntegrityChecker;

  // Production monitoring and health checks
  private healthCheckService!: HealthCheckService;
  private systemMonitor!: SystemMonitor;

  // Statistics and monitoring
  private startTime: Date | null = null;
  private statisticsTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatsReport: Date | null = null;

  constructor() {
    try {
      // Load configuration
      this.config = ConfigManager.getInstance().getConfig();

      // Initialize core services first
      this.logger = new Logger(this.config.logger);
      this.errorHandler = new ErrorHandler(this.logger, this.config.errorHandler);

      this.logger.info('ChatAnalyzer', '🚀 Chat Analyzer initialized', {
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        debugMode: this.config.app.enableDebugMode,
      });

      // Initialize components in dependency order
      this.initializeComponents();

    } catch (error) {
      console.error('❌ Failed to initialize ChatAnalyzer:', error);
      throw error;
    }
  }

  /**
   * Initialize all application components
   */
  private initializeComponents(): void {
    try {
      // VK API
      this.vkApi = new VKApi();
      if (this.config.vk.accessToken) {
        this.vkApi.setAccessToken(this.config.vk.accessToken);
      }

      // Storage layer
      this.fileStorage = new FileStorage(this.config.fileStorage);
      this.userCacheManager = new UserCacheManager({
        cacheFilePath: this.fileStorage.generateCacheFilePath('users'),
      });

      // Initialize userManager before chatFileManager
      this.userManager = new UserManager(
        this.vkApi,
        {},
        {
          cacheFilePath: this.fileStorage.generateCacheFilePath('users'),
        },
      );

      this.chatFileManager = new ChatFileManager(
        this.fileStorage,
        this.userManager,
        this.config.chatFileManager,
      );

      // Processing layer
      this.messageParser = new MessageParser();

      // Data validation and integrity systems
      this.dataValidator = new DataValidator(this.logger, {
        strictMode: false,
        enableMessageContentValidation: true,
        enableFileSizeValidation: true,
      });

      this.fileIntegrityChecker = new FileIntegrityChecker(
        this.logger,
        this.dataValidator,
        this.fileStorage,
        {
          enableChecksumValidation: this.envConfig.isFeatureEnabled('enableFileIntegrityChecks'),
          enableBackupCreation: this.envConfig.isFeatureEnabled('enableBackupCreation'),
        },
      );

      // Set cache managers for recovery after they're initialized
      this.fileIntegrityChecker.setCacheManagers(this.chatFileManager, this.userCacheManager);

      // Production monitoring and health checks
      if (this.envConfig.isFeatureEnabled('enableHealthChecks')) {
        this.healthCheckService = new HealthCheckService(
          this.logger,
          this.envConfig,
        );

        // Register component health checks
        this.registerComponentHealthChecks();
      }

      if (this.envConfig.isFeatureEnabled('enablePerformanceMetrics')) {
        this.systemMonitor = new SystemMonitor(
          this.logger,
          this.envConfig,
          this.healthCheckService,
        );
      }

      this.eventProcessor = new EventProcessor(
        this.logger,
        this.errorHandler,
        this.messageParser,
        this.userManager,
        this.chatFileManager,
        this.config.eventProcessor,
      );
      this.longPollCollector = new LongPollCollector(
        this.vkApi,
        this.logger,
        this.errorHandler,
        this.config.longPollCollector,
      );

      // Connect EventProcessor to LongPollCollector
      this.longPollCollector.onEvent(event => this.eventProcessor.processEvent(event));

      this.logger.info('ChatAnalyzer', 'All components initialized successfully');

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Failed to initialize components', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start the Chat Analyzer system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('ChatAnalyzer', 'System already running, ignoring start request');
      return;
    }

    if (this.isShuttingDown) {
      throw new Error('System is shutting down, cannot start');
    }

    try {
      this.logger.info('ChatAnalyzer', '✅ Starting VK Message Collector system');
      this.startTime = new Date();
      this.isRunning = true;

      // Initialize storage
      await this.initializeStorage();

      // Perform startup integrity checks
      await this.performStartupChecks();

      // Start production services
      await this.startProductionServices();

      // Start core components
      await this.startComponents();

      // Start monitoring and statistics
      this.startStatisticsReporting();

      this.logger.info('ChatAnalyzer', '🎉 VK Message Collector started successfully', {
        startTime: this.startTime.toISOString(),
        configuration: {
          enableMessageLogging: this.config.eventProcessor.enableMessageLogging,
          enableUserTracking: this.config.eventProcessor.enableUserActivityTracking,
          pollTimeout: this.config.longPollCollector.pollTimeout,
          maxReconnectAttempts: this.config.longPollCollector.maxReconnectAttempts,
        },
      });

    } catch (error) {
      this.isRunning = false;
      this.logger.error('ChatAnalyzer', '❌ Failed to start Chat Analyzer', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop the Chat Analyzer system gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning && !this.isShuttingDown) {
      this.logger.warn('ChatAnalyzer', 'System not running, ignoring stop request');
      return;
    }

    if (this.isShuttingDown) {
      this.logger.warn('ChatAnalyzer', 'System already shutting down');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('ChatAnalyzer', '🔄 Starting graceful shutdown...');

    try {
      // Stop statistics reporting
      if (this.statisticsTimer) {
        clearInterval(this.statisticsTimer);
        this.statisticsTimer = null;
      }

      // Report final statistics
      await this.reportFinalStatistics();

      // Stop components in reverse order
      await this.stopComponents();

      this.isRunning = false;
      this.isShuttingDown = false;

      const uptime = this.startTime
        ? Date.now() - this.startTime.getTime()
        : 0;

      this.logger.info('ChatAnalyzer', '🛑 Chat Analyzer stopped successfully', {
        uptime,
        shutdownTime: new Date().toISOString(),
      });

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Error during shutdown', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Initialize storage systems
   */
  private async initializeStorage(): Promise<void> {
    this.logger.info('ChatAnalyzer', 'Initializing storage systems...');

    try {
      await this.fileStorage.initialize();
      await this.userManager.initialize();
      await this.chatFileManager.initialize();

      this.logger.info('ChatAnalyzer', 'Storage systems initialized successfully');
    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Failed to initialize storage', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start production-ready services (health checks, monitoring)
   */
  private async startProductionServices(): Promise<void> {
    try {
      // Start health check service
      if (this.healthCheckService) {
        await this.healthCheckService.start();
        this.logger.info('ChatAnalyzer', 'Health check service started', {
          port: this.envConfig.getMonitoringConfig().healthCheckPort,
        });
      }

      // Start system monitoring
      if (this.systemMonitor) {
        await this.systemMonitor.start();
        this.logger.info('ChatAnalyzer', 'System monitoring started');
      }

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Failed to start production services', {
        error: (error as Error).message,
      });
      // Don't throw - continue with degraded monitoring
    }
  }

  /**
   * Perform startup integrity checks and validation
   */
  private async performStartupChecks(): Promise<void> {
    this.logger.info('ChatAnalyzer', 'Performing startup integrity checks...');

    try {
      // Check integrity of data directories
      const directoriesToCheck = [
        this.fileStorage['config'].chatsPath,
        this.fileStorage['config'].cachePath,
      ];

      const integrityResults = await this.fileIntegrityChecker.performStartupIntegrityCheck(directoriesToCheck);

      // Report integrity check results
      const totalFiles = integrityResults.length;
      const corruptedFiles = integrityResults.filter(r => r.isCorrupted).length;
      const healthyFiles = totalFiles - corruptedFiles;

      this.logger.info('ChatAnalyzer', 'Startup integrity check completed', {
        totalFiles,
        healthyFiles,
        corruptedFiles,
        healthPercentage: totalFiles > 0 ? ((healthyFiles / totalFiles) * 100).toFixed(1) + '%' : '100%',
      });

      // Warn if there are corrupted files
      if (corruptedFiles > 0) {
        this.logger.warn('ChatAnalyzer', `Found ${corruptedFiles} corrupted files during startup`, {
          corruptedFiles: integrityResults
            .filter(r => r.isCorrupted)
            .map(r => ({ path: r.filePath, issues: r.issues })),
        });
      }

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Startup integrity checks failed', {
        error: (error as Error).message,
      });
      // Don't throw - continue with degraded reliability
    }
  }

  /**
   * Start core processing components
   */
  private async startComponents(): Promise<void> {
    this.logger.info('ChatAnalyzer', 'Starting core components...');

    try {
      // Start Long Poll collector (this will handle all event processing)
      await this.longPollCollector.start();

      this.logger.info('ChatAnalyzer', 'Core components started successfully');
    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Failed to start components', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop all components gracefully
   */
  private async stopComponents(): Promise<void> {
    this.logger.info('ChatAnalyzer', 'Stopping components...');

    try {
      // Stop Long Poll collector first
      if (this.longPollCollector) {
        await this.longPollCollector.stop();
      }

      // Destroy components with cleanup
      if (this.chatFileManager) {
        await this.chatFileManager.destroy();
      }

      if (this.userManager) {
        await this.userManager.destroy();
      }

      if (this.errorHandler) {
        await this.errorHandler.destroy();
      }

      this.logger.info('ChatAnalyzer', 'All components stopped successfully');
    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Error stopping components', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Start periodic statistics reporting
   */
  private startStatisticsReporting(): void {
    if (this.config.app.statisticsReportInterval <= 0) {
      return;
    }

    this.statisticsTimer = setInterval(() => {
      this.reportStatistics();
    }, this.config.app.statisticsReportInterval);

    this.logger.debug('ChatAnalyzer', 'Statistics reporting started', {
      interval: this.config.app.statisticsReportInterval,
    });
  }

  /**
   * Report current system statistics
   */
  private reportStatistics(): void {
    try {
      const now = new Date();
      const uptime = this.startTime ? now.getTime() - this.startTime.getTime() : 0;

      // Collect statistics from all components
      const longPollStats = this.longPollCollector.getStats();
      const eventProcessorStats = this.eventProcessor.getStats();
      const userManagerStats = this.userManager.getDetailedStats();
      const chatManagerStats = this.chatFileManager.getCacheStats();
      const errorHandlerStats = this.errorHandler.getErrorStats();

      const systemStats = {
        uptime,
        timestamp: now.toISOString(),
        longPoll: longPollStats,
        eventProcessor: eventProcessorStats,
        userManager: userManagerStats,
        chatManager: chatManagerStats,
        errorHandler: {
          totalErrors: errorHandlerStats.totalErrors,
          successfulRecoveries: errorHandlerStats.successfulRecoveries,
          errorsByType: Object.fromEntries(errorHandlerStats.errorsByType),
        },
        performance: this.config.app.enablePerformanceMetrics ? {
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
        } : undefined,
      };

      this.logger.info('ChatAnalyzer', '📊 System Statistics Report', systemStats);
      this.lastStatsReport = now;

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Failed to report statistics', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Report final statistics before shutdown
   */
  private async reportFinalStatistics(): Promise<void> {
    try {
      this.logger.info('ChatAnalyzer', '📋 Final System Report');
      this.reportStatistics();

      // Give some time for final statistics to be written
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Failed to report final statistics', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get current system status
   */
  getStatus(): {
    isRunning: boolean;
    isShuttingDown: boolean;
    uptime: number;
    startTime: Date | null;
    lastStatsReport: Date | null;
    componentsStatus: {
      longPollConnected: boolean;
      eventsProcessed: number;
      messagesCollected: number;
    };
    } {
    const uptime = this.startTime
      ? Date.now() - this.startTime.getTime()
      : 0;

    return {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      uptime,
      startTime: this.startTime,
      lastStatsReport: this.lastStatsReport,
      componentsStatus: {
        longPollConnected: this.longPollCollector?.getConnectionState().connected || false,
        eventsProcessed: this.eventProcessor?.getStats().eventsProcessed || 0,
        messagesCollected: this.eventProcessor?.getStats().messagesSaved || 0,
      },
    };
  }

  /**
   * Register health checks for all components
   */
  private registerComponentHealthChecks(): void {
    if (!this.healthCheckService) return;

    // VK API health check
    this.healthCheckService.registerHealthCheck('vk-api', async () => {
      try {
        // Simple API check (could call a lightweight method)
        const isConnected = this.vkApi && this.longPollCollector.getConnectionState().connected;

        return {
          name: 'vk-api',
          status: isConnected ? 'healthy' : 'unhealthy',
          message: isConnected ? 'VK API connection healthy' : 'VK API connection failed',
          lastCheck: new Date(),
          metadata: {
            connectionState: this.longPollCollector?.getConnectionState(),
          },
        };
      } catch (error) {
        return {
          name: 'vk-api',
          status: 'unhealthy',
          message: `VK API check failed: ${(error as Error).message}`,
          lastCheck: new Date(),
        };
      }
    });

    // Long Poll Collector health check
    this.healthCheckService.registerHealthCheck('longpoll-collector', async () => {
      try {
        const connectionState = this.longPollCollector.getConnectionState();
        const stats = this.longPollCollector.getStats();

        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        let message = 'Long Poll collector healthy';

        if (!connectionState.connected) {
          status = 'unhealthy';
          message = 'Long Poll collector disconnected';
        } else if (stats.reconnectionAttempts > 5) {
          status = 'degraded';
          message = `Frequent reconnections: ${stats.reconnectionAttempts}`;
        }

        return {
          name: 'longpoll-collector',
          status,
          message,
          lastCheck: new Date(),
          metadata: {
            connected: connectionState.connected,
            reconnectionAttempts: stats.reconnectionAttempts,
            totalEventsReceived: stats.totalEventsReceived,
            lastEventTime: stats.lastEventTime,
            uptime: stats.uptime,
          },
        };
      } catch (error) {
        return {
          name: 'longpoll-collector',
          status: 'unhealthy',
          message: `Long Poll check failed: ${(error as Error).message}`,
          lastCheck: new Date(),
        };
      }
    });

    // Event Processor health check
    this.healthCheckService.registerHealthCheck('event-processor', async () => {
      try {
        const stats = this.eventProcessor.getStats();
        const performance = this.eventProcessor.getPerformanceReport();

        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        let message = 'Event processor healthy';

        if (performance.errors.rate > 10) {
          status = 'unhealthy';
          message = `High error rate: ${performance.errors.rate.toFixed(1)}%`;
        } else if (performance.errors.rate > 5) {
          status = 'degraded';
          message = `Elevated error rate: ${performance.errors.rate.toFixed(1)}%`;
        } else if (performance.processing.averageTime > 1000) {
          status = 'degraded';
          message = `Slow processing: ${performance.processing.averageTime.toFixed(1)}ms avg`;
        }

        return {
          name: 'event-processor',
          status,
          message,
          lastCheck: new Date(),
          metadata: {
            eventsProcessed: stats.eventsProcessed,
            messagesSaved: stats.messagesSaved,
            errorRate: performance.errors.rate,
            averageProcessingTime: performance.processing.averageTime,
            uniqueChats: stats.uniqueChatsCount,
          },
        };
      } catch (error) {
        return {
          name: 'event-processor',
          status: 'unhealthy',
          message: `Event processor check failed: ${(error as Error).message}`,
          lastCheck: new Date(),
        };
      }
    });

    // Storage health check
    this.healthCheckService.registerHealthCheck('storage', async () => {
      try {
        const chatStats = this.chatFileManager.getCacheStats();

        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        let message = 'Storage systems healthy';

        // Simple storage health check based on cache status
        if (chatStats.cachedChats > chatStats.maxCacheSize * 0.9) {
          status = 'degraded';
          message = `Cache nearing capacity: ${chatStats.cachedChats}/${chatStats.maxCacheSize}`;
        }

        return {
          name: 'storage',
          status,
          message,
          lastCheck: new Date(),
          metadata: {
            cachedChats: chatStats.cachedChats,
            maxCacheSize: chatStats.maxCacheSize,
            cacheUtilization: `${((chatStats.cachedChats / chatStats.maxCacheSize) * 100).toFixed(1)}%`,
          },
        };
      } catch (error) {
        return {
          name: 'storage',
          status: 'unhealthy',
          message: `Storage check failed: ${(error as Error).message}`,
          lastCheck: new Date(),
        };
      }
    });

    this.logger.info('ChatAnalyzer', 'Component health checks registered', {
      totalChecks: 4,
      components: ['vk-api', 'longpoll-collector', 'event-processor', 'storage'],
    });
  }

  /**
   * Stop production services
   */
  private async stopProductionServices(): Promise<void> {
    try {
      // Stop system monitoring
      if (this.systemMonitor) {
        await this.systemMonitor.stop();
      }

      // Stop health check service
      if (this.healthCheckService) {
        await this.healthCheckService.stop();
      }

      this.logger.info('ChatAnalyzer', 'Production services stopped');

    } catch (error) {
      this.logger.error('ChatAnalyzer', 'Error stopping production services', {
        error: (error as Error).message,
      });
    }
  }
}

// Initialize and start application
async function main(): Promise<void> {
  let analyzer: ChatAnalyzer | null = null;

  try {
    // Create analyzer instance
    analyzer = new ChatAnalyzer();

    // Setup graceful shutdown handlers
    const gracefulShutdown = async (signal: string): Promise<void> => {
      console.log(`\n🔄 Received ${signal} signal, starting graceful shutdown...`);

      if (analyzer) {
        try {
          // Give components time to shut down gracefully
          const shutdownTimeout = analyzer['config']?.app?.gracefulShutdownTimeout || 30000;

          const shutdownPromise = analyzer.stop();
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Graceful shutdown timeout (${shutdownTimeout}ms)`));
            }, shutdownTimeout);
          });

          await Promise.race([shutdownPromise, timeoutPromise]);
          console.log('✅ Graceful shutdown completed');
        } catch (error) {
          console.error('⚠️  Error during graceful shutdown:', error);
        }
      }

      process.exit(0);
    };

    // Handle shutdown signals
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      if (analyzer) {
        analyzer.stop().finally(() => process.exit(1));
      } else {
        process.exit(1);
      }
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
      if (analyzer) {
        analyzer.stop().finally(() => process.exit(1));
      } else {
        process.exit(1);
      }
    });

    // Start the analyzer
    await analyzer.start();

    // Keep the process running
    process.stdout.write('🚀 VK Message Collector is now running. Press Ctrl+C to stop.\n');

  } catch (error) {
    console.error('❌ Fatal error during startup:', error);

    if (analyzer) {
      try {
        await analyzer.stop();
      } catch (stopError) {
        console.error('❌ Error during cleanup:', stopError);
      }
    }

    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Failed to start application:', error);
    process.exit(1);
  });
}
