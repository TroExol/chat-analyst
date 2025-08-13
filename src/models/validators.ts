import type { TUser, TMessage, TChat } from '../types/index.js';

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
 * Validates message data structure
 */
export function validateMessage(message: unknown): message is TMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const m = message as Record<string, unknown>;

  return (
    typeof m.id === 'number' &&
    validateUser(m.author) &&
    typeof m.date === 'string' &&
    typeof m.content === 'string' &&
    typeof m.flags === 'object'
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
    Array.isArray(c.activeUsers) &&
    Array.isArray(c.messages) &&
    c.createdAt instanceof Date &&
    c.updatedAt instanceof Date
  );
}
