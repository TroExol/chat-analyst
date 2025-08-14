import { describe, it, expect, beforeEach } from '@jest/globals';
import { MessageParser, LONG_POLL_EVENT_TYPES } from '../MessageParser';
import type { TLongPollEvent } from '../../types';

describe('MessageParser', () => {
  let parser: MessageParser;

  beforeEach(() => {
    parser = new MessageParser();
  });

  describe('parseMessageEvent', () => {
    it('should parse new message event correctly', async () => {
      // Example: [4, 123456, 49, 2000000001, 1755105000, "Тестовое сообщение", {"from": "123"}]
      const event: TLongPollEvent = [
        LONG_POLL_EVENT_TYPES.NEW_MESSAGE,
        123456,
        49, // UNREAD + CHAT flags
        2000000001,
        1755105000,
        'Тестовое сообщение',
        { from: '123', conversation_message_id: 456 },
        {},
      ];

      const parsed = await await parser.parseMessageEvent(event);

      expect(parsed.messageId).toBe(123456);
      expect(parsed.peerId).toBe(2000000001);
      expect(parsed.fromId).toBe(123);
      expect(parsed.timestamp).toBe(1755105000);
      expect(parsed.text).toBe('Тестовое сообщение');
      expect(parsed.conversationMessageId).toBe(456);
      expect(parsed.flags.unread).toBe(true);
      expect(parsed.flags.chat).toBe(true);
    });

    it('should parse message with attachments', async () => {
      const event: TLongPollEvent = [
        LONG_POLL_EVENT_TYPES.NEW_MESSAGE,
        123457,
        561, // UNREAD + CHAT + MEDIA flags
        123456,
        1755105001,
        'Фото',
        { from: '456' },
        {
          attach1_type: 'photo',
          attach1: '123_456',
          attach2_type: 'link',
          attach2: 'link123',
          attach2_url: 'https://example.com',
          attach2_title: 'Test Link',
        },
      ];

      const parsed = await parser.parseMessageEvent(event);

      expect(parsed.attachments).toHaveLength(2);
      expect(parsed.attachments[0].type).toBe('photo');
      expect(parsed.attachments[0].id).toBe('123_456');
      expect(parsed.attachments[1].type).toBe('link');
      expect(parsed.attachments[1].url).toBe('https://example.com');
      expect(parsed.attachments[1].title).toBe('Test Link');
    });

    it('should throw error for invalid event format', () => {
      const invalidEvent: TLongPollEvent = [4, 123]; // Too few elements

      expect(() => parser.parseMessageEvent(invalidEvent)).toThrow('Invalid Long Poll event format');
    });

    it('should throw error for unsupported event type', () => {
      const userOnlineEvent: TLongPollEvent = [
        LONG_POLL_EVENT_TYPES.USER_ONLINE,
        123456,
        1,
        0,
        1755105000,
        '',
      ];

      expect(() => parser.parseMessageEvent(userOnlineEvent)).toThrow('Unsupported event type');
    });

    it('should throw error for invalid message ID', () => {
      const event: TLongPollEvent = [
        LONG_POLL_EVENT_TYPES.NEW_MESSAGE,
        0, // Invalid message ID
        49,
        2000000001,
        1755105000,
        'Test',
      ];

      expect(async () => await parser.parseMessageEvent(event)).toThrow('Invalid message ID');
    });

    it('should handle outgoing messages correctly', async () => {
      const event: TLongPollEvent = [
        LONG_POLL_EVENT_TYPES.NEW_MESSAGE,
        123456,
        2, // OUTBOX flag
        123456,
        1755105000,
        'Исходящее сообщение',
        {},
      ];

      const parsed = await parser.parseMessageEvent(event);

      expect(parsed.flags.outbox).toBe(true);
      expect(parsed.flags.unread).toBe(false);
      expect(parsed.fromId).toBe(0); // Will be resolved later
    });
  });

  describe('parseAttachments', () => {
    it('should parse photo attachment', () => {
      const attachmentData = {
        attach1_type: 'photo',
        attach1: '123_456',
      };

      const attachments = parser.parseAttachments(attachmentData);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].type).toBe('photo');
      expect(attachments[0].id).toBe('123_456');
      expect(attachments[0].url).toBe('https://vk.com/photo123_456');
    });

    it('should parse link attachment with metadata', () => {
      const attachmentData = {
        attach1_type: 'link',
        attach1: 'link123',
        attach1_url: 'https://example.com',
        attach1_title: 'Example Link',
        attach1_desc: 'Test description',
        attach1_photo: 'preview123',
      };

      const attachments = parser.parseAttachments(attachmentData);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].type).toBe('link');
      expect(attachments[0].url).toBe('https://example.com');
      expect(attachments[0].title).toBe('Example Link');
      expect(attachments[0].metadata).toEqual({
        description: 'Test description',
        photo: 'preview123',
      });
    });

    it('should parse sticker attachment', () => {
      const attachmentData = {
        attach1_type: 'sticker',
        attach1: 'sticker123',
        attach1_product_id: '456',
      };

      const attachments = parser.parseAttachments(attachmentData);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].type).toBe('sticker');
      expect(attachments[0].metadata).toEqual({
        product_id: '456',
      });
    });

    it('should parse multiple attachments', () => {
      const attachmentData = {
        attach1_type: 'photo',
        attach1: '123_456',
        attach2_type: 'audio',
        attach2: '789_101112',
      };

      const attachments = parser.parseAttachments(attachmentData);

      expect(attachments).toHaveLength(2);
      expect(attachments[0].type).toBe('photo');
      expect(attachments[1].type).toBe('audio');
    });

    it('should return empty array for no attachments', () => {
      const attachments = parser.parseAttachments({});
      expect(attachments).toEqual([]);
    });

    it('should skip invalid attachment types', () => {
      const attachmentData = {
        attach1_type: 'invalid_type',
        attach1: '123_456',
        attach2_type: 'photo',
        attach2: '789_101',
      };

      const attachments = parser.parseAttachments(attachmentData);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].type).toBe('photo');
    });

    it('should handle safety limit for attachments', () => {
      const attachmentData: Record<string, any> = {};

      // Add 15 attachments (more than safety limit of 10)
      for (let i = 1; i <= 15; i++) {
        attachmentData[`attach${i}_type`] = 'photo';
        attachmentData[`attach${i}`] = `${i}_${i}`;
      }

      const attachments = parser.parseAttachments(attachmentData);

      expect(attachments.length).toBeLessThanOrEqual(10);
    });
  });

  describe('isMessageEvent', () => {
    it('should identify message events correctly', () => {
      expect(parser.isMessageEvent([LONG_POLL_EVENT_TYPES.NEW_MESSAGE])).toBe(true);
      expect(parser.isMessageEvent([LONG_POLL_EVENT_TYPES.MESSAGE_EDIT])).toBe(true);
      expect(parser.isMessageEvent([LONG_POLL_EVENT_TYPES.MESSAGE_FLAGS_REPLACE])).toBe(true);
    });

    it('should reject non-message events', () => {
      expect(parser.isMessageEvent([LONG_POLL_EVENT_TYPES.USER_ONLINE])).toBe(false);
      expect(parser.isMessageEvent([LONG_POLL_EVENT_TYPES.USER_OFFLINE])).toBe(false);
    });

    it('should handle invalid events', () => {
      expect(parser.isMessageEvent([])).toBe(false);
      expect(parser.isMessageEvent([999])).toBe(false);
    });
  });

  describe('getEventTypeDescription', () => {
    it('should return correct descriptions for known events', () => {
      expect(parser.getEventTypeDescription(LONG_POLL_EVENT_TYPES.NEW_MESSAGE)).toBe('NEW_MESSAGE');
      expect(parser.getEventTypeDescription(LONG_POLL_EVENT_TYPES.USER_ONLINE)).toBe('USER_ONLINE');
    });

    it('should return unknown description for unknown events', () => {
      expect(parser.getEventTypeDescription(999)).toBe('UNKNOWN_EVENT_999');
    });
  });

  describe('Real VK Long Poll examples', () => {
    it('should parse real incoming chat message', async () => {
      // Based on provided example: [4, 4155970, 532481, 2000000219]
      const event: TLongPollEvent = [
        4, 4155970, 532481, 2000000219, 1755104990,
        'Для [id848610903|Лены Ивановы] на номер #phone422729271500:\n293702',
        { from: '100' },
        {},
      ];

      const parsed = await parser.parseMessageEvent(event);

      expect(parsed.messageId).toBe(4155970);
      expect(parsed.peerId).toBe(2000000219);
      expect(parsed.fromId).toBe(100);
      expect(parsed.text).toContain('293702');
    });

    it('should parse real message with photo attachment', async () => {
      // Based on provided example with photo attachment
      const event: TLongPollEvent = [
        4, 4155980, 532481, 2000000192, 1755105418,
        '',
        { from: '-209183708' },
        {
          attach1_type: 'photo',
          attach1: '-209183708_461380846',
        },
      ];

      const parsed = await parser.parseMessageEvent(event);

      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].type).toBe('photo');
      expect(parsed.fromId).toBe(-209183708);
      expect(parsed.text).toBe('');
    });
  });
});
