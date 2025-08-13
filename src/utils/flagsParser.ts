import type { TMessageFlags } from '../types';

/**
 * VK Long Poll message flags constants
 * Based on VK API documentation: https://dev.vk.com/ru/api/user-long-poll/getting-started
 */
export const MESSAGE_FLAGS = {
  UNREAD: 1,        // Сообщение не прочитано
  OUTBOX: 2,        // Исходящее сообщение
  REPLIED: 4,       // На сообщение был создан ответ
  IMPORTANT: 8,     // Помеченное сообщение
  CHAT: 16,         // Сообщение отправлено через диалог
  FRIENDS: 32,      // Сообщение отправлено другом
  SPAM: 64,         // Сообщение помечено как спам
  DELETED: 128,     // Сообщение удалено (у получателя)
  FIXED: 256,       // Сообщение проверено пользователем на спам
  MEDIA: 512,       // Сообщение содержит медиаконтент
  HIDDEN: 65536,    // Приветственное сообщение для беседы
  DELETED_ALL: 131072, // Сообщение удалено для всех получателей
} as const;

/**
 * Parses VK Long Poll message flags from numeric value to structured object
 * @param flagsValue - Numeric flags value from Long Poll event
 * @returns Structured TMessageFlags object
 */
export function parseMessageFlags(flagsValue: number): TMessageFlags {
  return {
    unread: Boolean(flagsValue & MESSAGE_FLAGS.UNREAD),
    outbox: Boolean(flagsValue & MESSAGE_FLAGS.OUTBOX),
    replied: Boolean(flagsValue & MESSAGE_FLAGS.REPLIED),
    important: Boolean(flagsValue & MESSAGE_FLAGS.IMPORTANT),
    chat: Boolean(flagsValue & MESSAGE_FLAGS.CHAT),
    friends: Boolean(flagsValue & MESSAGE_FLAGS.FRIENDS),
    spam: Boolean(flagsValue & MESSAGE_FLAGS.SPAM),
    delUser: Boolean(flagsValue & MESSAGE_FLAGS.DELETED),
    fixed: Boolean(flagsValue & MESSAGE_FLAGS.FIXED),
    media: Boolean(flagsValue & MESSAGE_FLAGS.MEDIA),
  };
}

/**
 * Converts TMessageFlags object back to numeric flags value
 * Useful for API calls or storage optimization
 * @param flags - Structured TMessageFlags object
 * @returns Numeric flags value
 */
export function encodeMessageFlags(flags: TMessageFlags): number {
  let flagsValue = 0;

  if (flags.unread) flagsValue |= MESSAGE_FLAGS.UNREAD;
  if (flags.outbox) flagsValue |= MESSAGE_FLAGS.OUTBOX;
  if (flags.replied) flagsValue |= MESSAGE_FLAGS.REPLIED;
  if (flags.important) flagsValue |= MESSAGE_FLAGS.IMPORTANT;
  if (flags.chat) flagsValue |= MESSAGE_FLAGS.CHAT;
  if (flags.friends) flagsValue |= MESSAGE_FLAGS.FRIENDS;
  if (flags.spam) flagsValue |= MESSAGE_FLAGS.SPAM;
  if (flags.delUser) flagsValue |= MESSAGE_FLAGS.DELETED;
  if (flags.fixed) flagsValue |= MESSAGE_FLAGS.FIXED;
  if (flags.media) flagsValue |= MESSAGE_FLAGS.MEDIA;

  return flagsValue;
}

/**
 * Checks if message is deleted based on flags
 * @param flagsValue - Numeric flags value from Long Poll event
 * @returns True if message is deleted
 */
export function isMessageDeleted(flagsValue: number): boolean {
  return Boolean(flagsValue & MESSAGE_FLAGS.DELETED) ||
         Boolean(flagsValue & MESSAGE_FLAGS.DELETED_ALL);
}

/**
 * Checks if message has media content based on flags
 * @param flagsValue - Numeric flags value from Long Poll event
 * @returns True if message contains media
 */
export function hasMediaContent(flagsValue: number): boolean {
  return Boolean(flagsValue & MESSAGE_FLAGS.MEDIA);
}

/**
 * Checks if message is from chat (not private dialog)
 * @param flagsValue - Numeric flags value from Long Poll event
 * @returns True if message is from chat
 */
export function isFromChat(flagsValue: number): boolean {
  return Boolean(flagsValue & MESSAGE_FLAGS.CHAT);
}

/**
 * Gets human-readable description of message flags
 * Useful for debugging and logging
 * @param flagsValue - Numeric flags value
 * @returns Array of active flag descriptions
 */
export function getActiveFlagsDescription(flagsValue: number): string[] {
  const activeFlags: string[] = [];

  if (flagsValue & MESSAGE_FLAGS.UNREAD) activeFlags.push('UNREAD');
  if (flagsValue & MESSAGE_FLAGS.OUTBOX) activeFlags.push('OUTBOX');
  if (flagsValue & MESSAGE_FLAGS.REPLIED) activeFlags.push('REPLIED');
  if (flagsValue & MESSAGE_FLAGS.IMPORTANT) activeFlags.push('IMPORTANT');
  if (flagsValue & MESSAGE_FLAGS.CHAT) activeFlags.push('CHAT');
  if (flagsValue & MESSAGE_FLAGS.FRIENDS) activeFlags.push('FRIENDS');
  if (flagsValue & MESSAGE_FLAGS.SPAM) activeFlags.push('SPAM');
  if (flagsValue & MESSAGE_FLAGS.DELETED) activeFlags.push('DELETED');
  if (flagsValue & MESSAGE_FLAGS.FIXED) activeFlags.push('FIXED');
  if (flagsValue & MESSAGE_FLAGS.MEDIA) activeFlags.push('MEDIA');
  if (flagsValue & MESSAGE_FLAGS.HIDDEN) activeFlags.push('HIDDEN');
  if (flagsValue & MESSAGE_FLAGS.DELETED_ALL) activeFlags.push('DELETED_ALL');

  return activeFlags;
}
