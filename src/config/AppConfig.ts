import { TLoggerConfig } from '../services/Logger';
import { TErrorHandlerConfig } from '../services/ErrorHandler';
import { TEventProcessorConfig } from '../services/EventProcessor';
import { TLongPollCollectorConfig } from '../services/LongPollCollector';
import { TFileStorageConfig } from '../storage/FileStorage';
import { TChatFileManagerConfig } from '../storage/ChatFileManager';

/**
 * Application configuration interface
 */
export interface TAppConfig {
  // VK API Configuration
  vk: {
    accessToken: string;
    cookie?: string;
    apiVersion: string;
  };

  // Component configurations
  logger: TLoggerConfig;
  errorHandler: TErrorHandlerConfig;
  eventProcessor: TEventProcessorConfig;
  longPollCollector: TLongPollCollectorConfig;
  fileStorage: TFileStorageConfig;
  chatFileManager: TChatFileManagerConfig;

  // Application settings
  app: {
    gracefulShutdownTimeout: number;
    statisticsReportInterval: number;
    enablePerformanceMetrics: boolean;
    enableDebugMode: boolean;
  };
}

/**
 * Default application configuration
 */
export const DEFAULT_APP_CONFIG: TAppConfig = {
  vk: {
    accessToken: process.env.VK_ACCESS_TOKEN || 'some_token',
    cookie: process.env.VK_COOKIE,
    apiVersion: '5.199',
  },

  logger: {
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    enableConsoleOutput: process.env.ENABLE_CONSOLE_OUTPUT !== 'false',
    enableFileOutput: process.env.ENABLE_FILE_OUTPUT !== 'false',
    logDirectory: process.env.LOG_DIRECTORY || './data/logs',
    logFileName: process.env.LOG_FILE_NAME || 'app.log',
    maxFileSize: parseInt(process.env.MAX_LOG_FILE_SIZE || '10485760'), // 10MB
    maxFiles: parseInt(process.env.MAX_LOG_FILES || '5'),
    dateFormat: process.env.LOG_DATE_FORMAT || 'YYYY-MM-DD HH:mm:ss',
  },

  errorHandler: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
    baseDelay: parseInt(process.env.BASE_RETRY_DELAY || '1000'),
    maxDelay: parseInt(process.env.MAX_RETRY_DELAY || '30000'),
    backoffMultiplier: parseFloat(process.env.BACKOFF_MULTIPLIER || '2'),
    bufferSize: parseInt(process.env.ERROR_BUFFER_SIZE || '1000'),
    stateSaveInterval: parseInt(process.env.STATE_SAVE_INTERVAL || '30000'),
    enableBuffering: process.env.ENABLE_ERROR_BUFFERING !== 'false',
    bufferFlushInterval: parseInt(process.env.BUFFER_FLUSH_INTERVAL || '5000'),
    errorClassificationRules: new Map([
      ['NetworkError', 'network' as any],
      ['TimeoutError', 'network' as any],
      ['ValidationError', 'validation' as any],
      ['FileSystemError', 'file_system' as any],
      ['VKAPIError', 'vk_api' as any],
    ]),
  },

  eventProcessor: {
    enableMessageLogging: process.env.ENABLE_MESSAGE_LOGGING !== 'false',
    enableUserActivityTracking: process.env.ENABLE_USER_ACTIVITY_TRACKING !== 'false',
    enableDataValidation: process.env.ENABLE_DATA_VALIDATION !== 'false',
    maxConcurrentProcessing: parseInt(process.env.MAX_CONCURRENT_PROCESSING || '10'),
    processingTimeout: parseInt(process.env.PROCESSING_TIMEOUT || '30000'),
  },

  longPollCollector: {
    maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '10'),
    baseReconnectDelay: parseInt(process.env.BASE_RECONNECT_DELAY || '1000'),
    maxReconnectDelay: parseInt(process.env.MAX_RECONNECT_DELAY || '30000'),
    pollTimeout: parseInt(process.env.POLL_TIMEOUT || '25'),
    connectionHealthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000'),
    enableConnectionPersistence: process.env.ENABLE_CONNECTION_PERSISTENCE !== 'false',
    enableMissedEventsRecovery: process.env.ENABLE_MISSED_EVENTS_RECOVERY !== 'false',
  },

  fileStorage: {
    baseDataPath: process.env.DATA_DIRECTORY || './data',
    chatsPath: process.env.CHATS_PATH || 'chats',
    cachePath: process.env.CACHE_PATH || 'cache',
    logsPath: process.env.LOGS_PATH || 'logs',
    maxRetries: parseInt(process.env.FILE_MAX_RETRIES || '3'),
    retryBaseDelay: parseInt(process.env.FILE_RETRY_DELAY || '1000'),
  },

  chatFileManager: {
    maxMemoryCacheSize: parseInt(process.env.CHAT_CACHE_SIZE || '100'),
    autoSaveInterval: parseInt(process.env.AUTO_SAVE_INTERVAL || '30000'),
    enableBackups: process.env.ENABLE_FILE_BACKUP !== 'false',
    membersUpdateInterval: parseInt(process.env.MEMBERS_UPDATE_INTERVAL || '1200000'), // 20 minutes
  },

  app: {
    gracefulShutdownTimeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '30000'),
    statisticsReportInterval: parseInt(process.env.STATS_REPORT_INTERVAL || '300000'), // 5 minutes
    enablePerformanceMetrics: process.env.ENABLE_PERFORMANCE_METRICS === 'true',
    enableDebugMode: process.env.DEBUG_MODE === 'true',
  },
};

/**
 * Load and validate configuration from environment
 */
export function loadConfig(): TAppConfig {
  const config: TAppConfig = { ...DEFAULT_APP_CONFIG };

  // Validate required environment variables
  if (!config.vk.cookie) {
    throw new Error('VK_COOKIE environment variable is required');
  }

  // Additional validation
  if (config.errorHandler.maxRetries < 1 || config.errorHandler.maxRetries > 20) {
    throw new Error('MAX_RETRIES must be between 1 and 20');
  }

  if (config.longPollCollector.pollTimeout < 5 || config.longPollCollector.pollTimeout > 60) {
    throw new Error('POLL_TIMEOUT must be between 5 and 60 seconds');
  }

  if (config.chatFileManager.maxMemoryCacheSize < 10 || config.chatFileManager.maxMemoryCacheSize > 1000) {
    throw new Error('CHAT_CACHE_SIZE must be between 10 and 1000');
  }

  return config;
}

/**
 * Environment configuration helper
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: TAppConfig;

  private constructor() {
    this.config = loadConfig();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  getConfig(): TAppConfig {
    return this.config;
  }

  getVKConfig() {
    return this.config.vk;
  }

  getLoggerConfig(): TLoggerConfig {
    return this.config.logger;
  }

  getErrorHandlerConfig(): TErrorHandlerConfig {
    return this.config.errorHandler;
  }

  getEventProcessorConfig(): TEventProcessorConfig {
    return this.config.eventProcessor;
  }

  getLongPollCollectorConfig(): TLongPollCollectorConfig {
    return this.config.longPollCollector;
  }

  getFileStorageConfig(): TFileStorageConfig {
    return this.config.fileStorage;
  }

  getChatFileManagerConfig(): TChatFileManagerConfig {
    return this.config.chatFileManager;
  }

  getAppConfig() {
    return this.config.app;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<TAppConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = loadConfig();
  }
}
