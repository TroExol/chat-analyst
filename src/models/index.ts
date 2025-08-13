// Re-export data model interfaces for easier imports
export type {
  TUser,
  TMessage,
  TAttachment,
  TChat,
  TStoredChatData,
  TCachedUser,
  TParsedMessage,
  TMessageFlags,
} from '../types';

// Export model validation functions
export {
  validateUser,
  validateMessage,
  validateChat,
  validateAttachment,
  validateMessageFlags,
  validateParsedMessage,
  validateLongPollServerConfig,
  validateStoredChatData,
} from './validators';
