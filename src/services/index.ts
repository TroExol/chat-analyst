// Export all service classes
export { VKApi } from './VKApi/index';
export { LongPollCollector } from './LongPollCollector';
export { EventProcessor } from './EventProcessor';
export { UserManager } from './UserManager';
export { ChatManager } from './ChatManager';
export { MessageParser } from './MessageParser';
export { ErrorHandler } from './ErrorHandler';
export { Logger } from './Logger';

// Re-export service interface contracts
export type {
  TLongPollCollector,
  TEventProcessor,
  TChatManager,
  TUserManager,
  TMessageParser,
} from '../types';
