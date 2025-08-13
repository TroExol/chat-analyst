import { describe, it, expect } from '@jest/globals';
import {
  parseMessageFlags,
  encodeMessageFlags,
  isMessageDeleted,
  hasMediaContent,
  isFromChat,
  getActiveFlagsDescription,
  MESSAGE_FLAGS,
} from '../flagsParser';
import type { TMessageFlags } from '../../types/index';

describe('Message Flags Parser', () => {
  describe('parseMessageFlags', () => {
    it('should parse single flags correctly', () => {
      const unreadFlag = parseMessageFlags(MESSAGE_FLAGS.UNREAD);
      expect(unreadFlag.unread).toBe(true);
      expect(unreadFlag.outbox).toBe(false);
      expect(unreadFlag.chat).toBe(false);
    });

    it('should parse multiple flags correctly', () => {
      const flags = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.OUTBOX | MESSAGE_FLAGS.CHAT;
      const parsed = parseMessageFlags(flags);

      expect(parsed.unread).toBe(true);
      expect(parsed.outbox).toBe(true);
      expect(parsed.chat).toBe(true);
      expect(parsed.replied).toBe(false);
      expect(parsed.important).toBe(false);
    });

    it('should parse all flags when all are set', () => {
      const allFlags = MESSAGE_FLAGS.UNREAD |
                      MESSAGE_FLAGS.OUTBOX |
                      MESSAGE_FLAGS.REPLIED |
                      MESSAGE_FLAGS.IMPORTANT |
                      MESSAGE_FLAGS.CHAT |
                      MESSAGE_FLAGS.FRIENDS |
                      MESSAGE_FLAGS.SPAM |
                      MESSAGE_FLAGS.DELETED |
                      MESSAGE_FLAGS.FIXED |
                      MESSAGE_FLAGS.MEDIA;

      const parsed = parseMessageFlags(allFlags);

      expect(parsed.unread).toBe(true);
      expect(parsed.outbox).toBe(true);
      expect(parsed.replied).toBe(true);
      expect(parsed.important).toBe(true);
      expect(parsed.chat).toBe(true);
      expect(parsed.friends).toBe(true);
      expect(parsed.spam).toBe(true);
      expect(parsed.delUser).toBe(true);
      expect(parsed.fixed).toBe(true);
      expect(parsed.media).toBe(true);
    });

    it('should parse zero flags correctly', () => {
      const parsed = parseMessageFlags(0);

      expect(parsed.unread).toBe(false);
      expect(parsed.outbox).toBe(false);
      expect(parsed.replied).toBe(false);
      expect(parsed.important).toBe(false);
      expect(parsed.chat).toBe(false);
      expect(parsed.friends).toBe(false);
      expect(parsed.spam).toBe(false);
      expect(parsed.delUser).toBe(false);
      expect(parsed.fixed).toBe(false);
      expect(parsed.media).toBe(false);
    });
  });

  describe('encodeMessageFlags', () => {
    it('should encode flags back to numeric value', () => {
      const flags: TMessageFlags = {
        unread: true,
        outbox: true,
        replied: false,
        important: false,
        chat: true,
        friends: false,
        spam: false,
        delUser: false,
        fixed: false,
        media: false,
      };

      const encoded = encodeMessageFlags(flags);
      const expected = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.OUTBOX | MESSAGE_FLAGS.CHAT;

      expect(encoded).toBe(expected);
    });

    it('should encode all false flags to zero', () => {
      const flags: TMessageFlags = {
        unread: false,
        outbox: false,
        replied: false,
        important: false,
        chat: false,
        friends: false,
        spam: false,
        delUser: false,
        fixed: false,
        media: false,
      };

      expect(encodeMessageFlags(flags)).toBe(0);
    });

    it('should be reversible with parseMessageFlags', () => {
      const originalFlags = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.IMPORTANT | MESSAGE_FLAGS.MEDIA;
      const parsed = parseMessageFlags(originalFlags);
      const encoded = encodeMessageFlags(parsed);

      expect(encoded).toBe(originalFlags);
    });
  });

  describe('isMessageDeleted', () => {
    it('should detect deleted messages', () => {
      expect(isMessageDeleted(MESSAGE_FLAGS.DELETED)).toBe(true);
      expect(isMessageDeleted(MESSAGE_FLAGS.DELETED_ALL)).toBe(true);
    });

    it('should not detect non-deleted messages', () => {
      expect(isMessageDeleted(MESSAGE_FLAGS.UNREAD)).toBe(false);
      expect(isMessageDeleted(MESSAGE_FLAGS.OUTBOX)).toBe(false);
      expect(isMessageDeleted(0)).toBe(false);
    });

    it('should detect deleted messages with other flags', () => {
      const flagsWithDeleted = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.DELETED | MESSAGE_FLAGS.CHAT;
      expect(isMessageDeleted(flagsWithDeleted)).toBe(true);
    });
  });

  describe('hasMediaContent', () => {
    it('should detect media content', () => {
      expect(hasMediaContent(MESSAGE_FLAGS.MEDIA)).toBe(true);
    });

    it('should not detect media when not present', () => {
      expect(hasMediaContent(MESSAGE_FLAGS.UNREAD)).toBe(false);
      expect(hasMediaContent(0)).toBe(false);
    });

    it('should detect media with other flags', () => {
      const flagsWithMedia = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.MEDIA | MESSAGE_FLAGS.CHAT;
      expect(hasMediaContent(flagsWithMedia)).toBe(true);
    });
  });

  describe('isFromChat', () => {
    it('should detect chat messages', () => {
      expect(isFromChat(MESSAGE_FLAGS.CHAT)).toBe(true);
    });

    it('should not detect private messages', () => {
      expect(isFromChat(MESSAGE_FLAGS.UNREAD)).toBe(false);
      expect(isFromChat(MESSAGE_FLAGS.OUTBOX)).toBe(false);
      expect(isFromChat(0)).toBe(false);
    });

    it('should detect chat messages with other flags', () => {
      const chatFlags = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.CHAT | MESSAGE_FLAGS.MEDIA;
      expect(isFromChat(chatFlags)).toBe(true);
    });
  });

  describe('getActiveFlagsDescription', () => {
    it('should return empty array for zero flags', () => {
      expect(getActiveFlagsDescription(0)).toEqual([]);
    });

    it('should return single flag description', () => {
      expect(getActiveFlagsDescription(MESSAGE_FLAGS.UNREAD)).toEqual(['UNREAD']);
    });

    it('should return multiple flag descriptions', () => {
      const flags = MESSAGE_FLAGS.UNREAD | MESSAGE_FLAGS.OUTBOX | MESSAGE_FLAGS.CHAT;
      const descriptions = getActiveFlagsDescription(flags);

      expect(descriptions).toContain('UNREAD');
      expect(descriptions).toContain('OUTBOX');
      expect(descriptions).toContain('CHAT');
      expect(descriptions.length).toBe(3);
    });

    it('should return all flag descriptions when all are set', () => {
      const allFlags = MESSAGE_FLAGS.UNREAD |
                      MESSAGE_FLAGS.OUTBOX |
                      MESSAGE_FLAGS.REPLIED |
                      MESSAGE_FLAGS.IMPORTANT |
                      MESSAGE_FLAGS.CHAT |
                      MESSAGE_FLAGS.FRIENDS |
                      MESSAGE_FLAGS.SPAM |
                      MESSAGE_FLAGS.DELETED |
                      MESSAGE_FLAGS.FIXED |
                      MESSAGE_FLAGS.MEDIA |
                      MESSAGE_FLAGS.HIDDEN |
                      MESSAGE_FLAGS.DELETED_ALL;

      const descriptions = getActiveFlagsDescription(allFlags);

      expect(descriptions).toContain('UNREAD');
      expect(descriptions).toContain('OUTBOX');
      expect(descriptions).toContain('REPLIED');
      expect(descriptions).toContain('IMPORTANT');
      expect(descriptions).toContain('CHAT');
      expect(descriptions).toContain('FRIENDS');
      expect(descriptions).toContain('SPAM');
      expect(descriptions).toContain('DELETED');
      expect(descriptions).toContain('FIXED');
      expect(descriptions).toContain('MEDIA');
      expect(descriptions).toContain('HIDDEN');
      expect(descriptions).toContain('DELETED_ALL');
      expect(descriptions.length).toBe(12);
    });
  });

  describe('Real VK Long Poll examples', () => {
    it('should parse typical incoming chat message flags', () => {
      // Флаги для входящего сообщения в чате: UNREAD + CHAT
      const flags = 1 + 16; // UNREAD | CHAT
      const parsed = parseMessageFlags(flags);

      expect(parsed.unread).toBe(true);
      expect(parsed.outbox).toBe(false);
      expect(parsed.chat).toBe(true);
      expect(parsed.friends).toBe(false);
    });

    it('should parse typical outgoing message flags', () => {
      // Флаги для исходящего сообщения: OUTBOX + CHAT
      const flags = 2 + 16; // OUTBOX | CHAT
      const parsed = parseMessageFlags(flags);

      expect(parsed.unread).toBe(false);
      expect(parsed.outbox).toBe(true);
      expect(parsed.chat).toBe(true);
    });

    it('should parse message with media attachment flags', () => {
      // Флаги для сообщения с медиа: UNREAD + CHAT + MEDIA
      const flags = 1 + 16 + 512; // UNREAD | CHAT | MEDIA
      const parsed = parseMessageFlags(flags);

      expect(parsed.unread).toBe(true);
      expect(parsed.chat).toBe(true);
      expect(parsed.media).toBe(true);
      expect(hasMediaContent(flags)).toBe(true);
    });

    it('should parse important message flags', () => {
      // Флаги для важного сообщения: UNREAD + CHAT + IMPORTANT
      const flags = 1 + 16 + 8; // UNREAD | CHAT | IMPORTANT
      const parsed = parseMessageFlags(flags);

      expect(parsed.unread).toBe(true);
      expect(parsed.chat).toBe(true);
      expect(parsed.important).toBe(true);
    });
  });
});
