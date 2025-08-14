import type { TMessageParser, TLongPollEvent, TParsedMessage, TAttachment } from '../types';
import { parseMessageFlags } from '../utils';

/**
 * VK Long Poll event type constants
 * Based on VK API documentation: https://dev.vk.com/ru/api/user-long-poll/getting-started
 */
export const LONG_POLL_EVENT_TYPES = {
  MESSAGE_DELETE: 0,        // Удаление сообщения
  MESSAGE_FLAGS_REPLACE: 1, // Замена флагов сообщения
  MESSAGE_FLAGS_SET: 2,     // Установка флагов сообщения
  MESSAGE_FLAGS_RESET: 3,   // Сброс флагов сообщения
  NEW_MESSAGE: 4,           // Новое сообщение
  MESSAGE_EDIT: 5,          // Редактирование сообщения
  MESSAGE_READ_INCOMING: 6, // Прочтение входящих сообщений
  MESSAGE_READ_OUTGOING: 7, // Прочтение исходящих сообщений
  USER_ONLINE: 8,           // Пользователь онлайн
  USER_OFFLINE: 9,          // Пользователь офлайн
  CHAT_FLAGS_RESET: 10,     // Сброс флагов беседы
  CHAT_FLAGS_REPLACE: 11,   // Замена флагов беседы
  CHAT_FLAGS_SET: 12,       // Установка флагов беседы
} as const;

export class MessageParser implements TMessageParser {
  /**
   * Parses VK Long Poll event array into structured message data
   * @param event - Long Poll event array [type, ...data]
   * @returns Parsed message data
   */
  parseMessageEvent(event: TLongPollEvent): TParsedMessage {
    if (!Array.isArray(event) || event.length < 6) {
      throw new Error(`Invalid Long Poll event format: expected array with at least 6 elements, got ${event.length}`);
    }

    const [eventType, messageId, flags, peerId, timestamp, text, ...extraData] = event;

    // Validate event type
    if (eventType !== LONG_POLL_EVENT_TYPES.NEW_MESSAGE) {
      throw new Error(`Unsupported event type for message parsing: ${eventType}. Expected: ${LONG_POLL_EVENT_TYPES.NEW_MESSAGE}`);
    }

    // Validate required fields
    if (typeof messageId !== 'number' || messageId <= 0) {
      throw new Error(`Invalid message ID: ${messageId}`);
    }

    if (typeof flags !== 'number') {
      throw new Error(`Invalid flags: ${flags}`);
    }

    if (typeof peerId !== 'number') {
      throw new Error(`Invalid peer ID: ${peerId}`);
    }

    if (typeof timestamp !== 'number' || timestamp <= 0) {
      throw new Error(`Invalid timestamp: ${timestamp}`);
    }

    if (typeof text !== 'string') {
      throw new Error(`Invalid message text: expected string, got ${typeof text}`);
    }

    // Parse extra data for attachments and metadata
    const messageFlags = parseMessageFlags(flags);
    const extraInfo = (extraData[0] && typeof extraData[0] === 'object' ? extraData[0] : {}) as Record<string, any>;
    const attachmentData = (extraData[1] && typeof extraData[1] === 'object' ? extraData[1] : {}) as Record<string, any>;

    // Extract author ID from extra info or flags
    let fromId: number;
    if (extraInfo.from && typeof extraInfo.from === 'string') {
      fromId = parseInt(extraInfo.from, 10);
    } else if (messageFlags.outbox) {
      // For outgoing messages, we need to get current user ID somehow
      // For now, use a placeholder that will be handled by UserManager
      fromId = 0; // Will be resolved later
    } else {
      // For incoming messages in private chats, from_id = peer_id
      // For group chats, we need to extract from extra data
      fromId = peerId < 2000000000 ? peerId : 0; // Will be resolved later
    }

    const attachments = this.parseAttachments(attachmentData);

    return {
      messageId,
      peerId,
      fromId,
      timestamp,
      text,
      attachments,
      flags: messageFlags,
      conversationMessageId: extraInfo.conversation_message_id,
    };
  }

  /**
   * Parses attachment data from Long Poll event
   * @param attachmentData - Attachment data object from Long Poll event
   * @returns Array of parsed attachments
   */
  parseAttachments(attachmentData: Record<string, any>): TAttachment[] {
    const attachments: TAttachment[] = [];

    if (!attachmentData || typeof attachmentData !== 'object') {
      return attachments;
    }

    // Parse attachments based on attach{N}_type pattern
    let attachmentIndex = 1;
    while (attachmentData[`attach${attachmentIndex}_type`]) {
      const type = attachmentData[`attach${attachmentIndex}_type`] as string;
      const id = attachmentData[`attach${attachmentIndex}`] as string;

      if (this.isValidAttachmentType(type) && id) {
        const attachment: TAttachment = {
          type: type as TAttachment['type'],
          id,
        };

        // Add type-specific data
        switch (type) {
        case 'photo':
          attachment.url = this.extractPhotoUrl(id);
          break;
        case 'link':
          attachment.url = attachmentData[`attach${attachmentIndex}_url`];
          attachment.title = attachmentData[`attach${attachmentIndex}_title`];
          attachment.metadata = {
            description: attachmentData[`attach${attachmentIndex}_desc`],
            photo: attachmentData[`attach${attachmentIndex}_photo`],
          };
          break;
        case 'sticker':
          attachment.metadata = {
            product_id: attachmentData[`attach${attachmentIndex}_product_id`],
          };
          break;
        case 'geo':
          attachment.metadata = {
            provider_id: attachmentData['geo_provider'],
          };
          break;
        default:
          // Generic attachment metadata
          attachment.metadata = {
            raw_data: attachmentData[`attach${attachmentIndex}`],
          };
        }

        attachments.push(attachment);
      }

      attachmentIndex++;

      // Safety limit to prevent infinite loops
      if (attachmentIndex > 10) {
        break;
      }
    }

    return attachments;
  }

  /**
   * Checks if attachment type is valid
   */
  private isValidAttachmentType(type: string): boolean {
    const validTypes = ['photo', 'audio', 'video', 'doc', 'sticker', 'link', 'geo'];
    return validTypes.includes(type);
  }

  /**
   * Extracts photo URL from VK photo ID
   * @param photoId - VK photo ID in format "owner_id_photo_id"
   * @returns Photo URL or undefined
   */
  private extractPhotoUrl(photoId: string): string | undefined {
    // For now, return a placeholder URL
    // In real implementation, we might need to call photos.getById API
    return `https://vk.com/photo${photoId}`;
  }

  /**
   * Extracts conversation message ID from event extra data
   * @param extraData - Extra data from Long Poll event
   * @returns Conversation message ID if present
   */
  public extractConversationMessageId(extraData: Record<string, any>): number | undefined {
    return extraData?.conversation_message_id;
  }

  /**
   * Checks if Long Poll event is a message event
   * @param event - Long Poll event array
   * @returns True if event is a message-related event
   */
  public isMessageEvent(event: TLongPollEvent): boolean {
    if (!Array.isArray(event) || event.length === 0) {
      return false;
    }

    const eventType = event[0];
    return eventType === LONG_POLL_EVENT_TYPES.NEW_MESSAGE ||
           eventType === LONG_POLL_EVENT_TYPES.MESSAGE_EDIT ||
           eventType === LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_REPLACE ||
           eventType === LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_SET ||
           eventType === LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_RESET;
  }

  /**
   * Gets human-readable event type description
   * @param eventType - Numeric event type from Long Poll
   * @returns Event type description
   */
  public getEventTypeDescription(eventType: number): string {
    switch (eventType) {
    case LONG_POLL_EVENT_TYPES.MESSAGE_DELETE: return 'MESSAGE_DELETE';
    case LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_REPLACE: return 'MESSAGE_FLAGS_REPLACE';
    case LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_SET: return 'MESSAGE_FLAGS_SET';
    case LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_RESET: return 'MESSAGE_FLAGS_RESET';
    case LONG_POLL_EVENT_TYPES.NEW_MESSAGE: return 'NEW_MESSAGE';
    case LONG_POLL_EVENT_TYPES.MESSAGE_EDIT: return 'MESSAGE_EDIT';
    case LONG_POLL_EVENT_TYPES.MESSAGE_READ_INCOMING: return 'MESSAGE_READ_INCOMING';
    case LONG_POLL_EVENT_TYPES.MESSAGE_READ_OUTGOING: return 'MESSAGE_READ_OUTGOING';
    case LONG_POLL_EVENT_TYPES.USER_ONLINE: return 'USER_ONLINE';
    case LONG_POLL_EVENT_TYPES.USER_OFFLINE: return 'USER_OFFLINE';
    case LONG_POLL_EVENT_TYPES.CHAT_FLAGS_RESET: return 'CHAT_FLAGS_RESET';
    case LONG_POLL_EVENT_TYPES.CHAT_FLAGS_REPLACE: return 'CHAT_FLAGS_REPLACE';
    case LONG_POLL_EVENT_TYPES.CHAT_FLAGS_SET: return 'CHAT_FLAGS_SET';
    default: return `UNKNOWN_EVENT_${eventType}`;
    }
  }
}
