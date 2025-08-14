// Export all service classes
export { VKApi } from './VKApi/index';
export { LongPollCollector, DEFAULT_LONGPOLL_COLLECTOR_CONFIG } from './LongPollCollector';
export { EventProcessor, VK_EVENT_TYPES, DEFAULT_EVENT_PROCESSOR_CONFIG } from './EventProcessor';
export { UserManager } from './UserManager';
export { ChatManager } from './ChatManager';
export { MessageParser } from './MessageParser';
export { ErrorHandler, ErrorType, DEFAULT_ERROR_HANDLER_CONFIG } from './ErrorHandler';
export { Logger, DEFAULT_LOGGER_CONFIG } from './Logger';
export { DataValidator, DEFAULT_VALIDATOR_CONFIG } from './DataValidator';
export { FileIntegrityChecker, DEFAULT_FILE_INTEGRITY_CONFIG } from './FileIntegrityChecker';
export { HealthCheckService, DEFAULT_HEALTH_CHECK_CONFIG } from './HealthCheckService';
export { SystemMonitor, DEFAULT_SYSTEM_MONITOR_CONFIG } from './SystemMonitor';

// Re-export service related types
export type { TLoggerConfig } from './Logger';
export type { TErrorHandlerConfig } from './ErrorHandler';
export type { TEventProcessorConfig, EventHandler } from './EventProcessor';
export type { TLongPollCollectorConfig, TConnectionStats } from './LongPollCollector';
export type { TDataValidatorConfig, TValidationResult } from './DataValidator';
export type { TFileIntegrityConfig, TIntegrityCheckResult } from './FileIntegrityChecker';
export type { THealthCheckConfig, TSystemHealth, TComponentHealth, THealthStatus, THealthCheckFunction } from './HealthCheckService';
export type { TSystemMonitorConfig, TSystemMetrics, TLoadMetrics } from './SystemMonitor';

// Re-export service interface contracts
export type {
  TLongPollCollector,
  TEventProcessor,
  TChatManager,
  TUserManager,
  TMessageParser,
} from '../types';
