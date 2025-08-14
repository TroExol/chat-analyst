// Export all service classes
export { VKApi } from './VKApi/index';
export { LongPollCollector } from './LongPollCollector';
export { EventProcessor, VK_EVENT_TYPES, DEFAULT_EVENT_PROCESSOR_CONFIG } from './EventProcessor';
export { UserManager } from './UserManager';
export { ChatManager } from './ChatManager';
export { MessageParser } from './MessageParser';
export { ErrorHandler, ErrorType, DEFAULT_ERROR_HANDLER_CONFIG } from './ErrorHandler';
export { Logger, DEFAULT_LOGGER_CONFIG } from './Logger';

// Re-export service related types
export type { TLoggerConfig } from './Logger';
export type { TErrorHandlerConfig } from './ErrorHandler';
export type { TEventProcessorConfig, EventHandler } from './EventProcessor';

// Re-export service interface contracts
export type {
  TLongPollCollector,
  TEventProcessor,
  TChatManager,
  TUserManager,
  TMessageParser,
} from '../types';
