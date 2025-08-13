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
} from '../types/index.js';

// Export model validation functions
export { validateUser, validateMessage, validateChat } from './validators.js';
