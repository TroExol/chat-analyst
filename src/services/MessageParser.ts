// Placeholder for MessageParser class - will be implemented in later tasks
import type { TMessageParser, TLongPollEvent, TParsedMessage, TAttachment } from '../types/index.js';

export class MessageParser implements TMessageParser {
  parseMessageEvent(_event: TLongPollEvent): TParsedMessage {
    // Implementation will be added in task 3.2
    throw new Error('Not implemented yet');
  }

  parseAttachments(_attachmentData: Record<string, any>): TAttachment[] {
    // Implementation will be added in task 7.2
    throw new Error('Not implemented yet');
  }
}
