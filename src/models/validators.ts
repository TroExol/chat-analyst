import type {
  TUser,
  TMessage,
  TChat,
  TAttachment,
  TMessageFlags,
  TParsedMessage,
  TLongPollServerConfig,
  TStoredChatData,
} from '../types';

/**
 * Validates user data structure
 */
export function validateUser(user: unknown): user is TUser {
  if (!user || typeof user !== 'object') {
    return false;
  }

  const u = user as Record<string, unknown>;

  return (
    typeof u.id === 'number' &&
    typeof u.name === 'string' &&
    u.name.length > 0 &&
    (u.lastActivity === undefined || u.lastActivity instanceof Date)
  );
}

/**
 * Validates attachment data structure
 */
export function validateAttachment(attachment: unknown): attachment is TAttachment {
  if (!attachment || typeof attachment !== 'object') {
    return false;
  }

  const a = attachment as Record<string, unknown>;
  const validTypes = ['photo', 'audio', 'video', 'doc', 'sticker', 'link', 'geo'];

  return (
    typeof a.type === 'string' &&
    validTypes.includes(a.type) &&
    typeof a.id === 'string' &&
    a.id.length > 0 &&
    (a.url === undefined || typeof a.url === 'string') &&
    (a.title === undefined || typeof a.title === 'string') &&
    (a.metadata === undefined || typeof a.metadata === 'object')
  );
}

/**
 * Validates message flags structure
 */
export function validateMessageFlags(flags: unknown): flags is TMessageFlags {
  if (!flags || typeof flags !== 'object') {
    return false;
  }

  const f = flags as Record<string, unknown>;

  return (
    typeof f.unread === 'boolean' &&
    typeof f.outbox === 'boolean' &&
    typeof f.replied === 'boolean' &&
    typeof f.important === 'boolean' &&
    typeof f.chat === 'boolean' &&
    typeof f.friends === 'boolean' &&
    typeof f.spam === 'boolean' &&
    typeof f.delUser === 'boolean' &&
    typeof f.fixed === 'boolean' &&
    typeof f.media === 'boolean'
  );
}

/**
 * Validates message data structure
 */
export function validateMessage(message: unknown): message is TMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const m = message as Record<string, unknown>;

  const isValid = (
    typeof m.id === 'number' &&
    validateUser(m.author) &&
    typeof m.date === 'string' &&
    typeof m.content === 'string' &&
    (m.attachments === undefined ||
     (Array.isArray(m.attachments) && m.attachments.every(validateAttachment)))
  );

  // Additional validation for date format (ISO string)
  if (isValid && typeof m.date === 'string') {
    try {
      const date = new Date(m.date);
      return !isNaN(date.getTime());
    } catch {
      return false;
    }
  }

  return isValid;
}

/**
 * Validates parsed message data structure from Long Poll
 */
export function validateParsedMessage(message: unknown): message is TParsedMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const m = message as Record<string, unknown>;

  return (
    typeof m.messageId === 'number' &&
    typeof m.peerId === 'number' &&
    typeof m.fromId === 'number' &&
    typeof m.timestamp === 'number' &&
    typeof m.text === 'string' &&
    Array.isArray(m.attachments) &&
    m.attachments.every(validateAttachment) &&
    validateMessageFlags(m.flags) &&
    (m.conversationMessageId === undefined || typeof m.conversationMessageId === 'number')
  );
}

/**
 * Validates Long Poll server configuration
 */
export function validateLongPollServerConfig(config: unknown): config is TLongPollServerConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;

  return (
    typeof c.server === 'string' &&
    c.server.length > 0 &&
    typeof c.key === 'string' &&
    c.key.length > 0 &&
    typeof c.ts === 'number' &&
    (c.pts === undefined || typeof c.pts === 'number')
  );
}

/**
 * Validates chat data structure
 */
export function validateChat(chat: unknown): chat is TChat {
  if (!chat || typeof chat !== 'object') {
    return false;
  }

  const c = chat as Record<string, unknown>;

  return (
    typeof c.name === 'string' &&
    c.name.length > 0 &&
    typeof c.id === 'number' &&
    Array.isArray(c.users) &&
    c.users.every(validateUser) &&
    Array.isArray(c.activeUsers) &&
    c.activeUsers.every(validateUser) &&
    Array.isArray(c.messages) &&
    c.messages.every(validateMessage) &&
    c.createdAt instanceof Date &&
    c.updatedAt instanceof Date
  );
}

/**
 * Validates stored chat data structure (with metadata)
 */
export function validateStoredChatData(data: unknown): data is TStoredChatData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Record<string, unknown>;

  if (!validateChat(d)) {
    return false;
  }

  return (
    typeof d.version === 'string' &&
    d.version.length > 0 &&
    typeof d.metadata === 'object' &&
    d.metadata !== null &&
    typeof (d.metadata as any).fileCreated === 'object' &&
    (d.metadata as any).fileCreated instanceof Date &&
    typeof (d.metadata as any).lastMessageId === 'number' &&
    typeof (d.metadata as any).messageCount === 'number' &&
    typeof (d.metadata as any).participantCount === 'number'
  );
}
