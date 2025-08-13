// Export all service classes
export { VKApi } from './VKApi/index.js';
export { LongPollCollector } from './LongPollCollector.js';
export { EventProcessor } from './EventProcessor.js';
export { UserManager } from './UserManager.js';
export { ChatManager } from './ChatManager.js';
export { MessageParser } from './MessageParser.js';
export { ErrorHandler } from './ErrorHandler.js';
export { Logger } from './Logger.js';

// Re-export service interface contracts
export type {
  TLongPollCollector,
  TEventProcessor,
  TChatManager,
  TUserManager,
  TMessageParser,
} from '../types/index.js';
